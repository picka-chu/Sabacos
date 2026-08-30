import { Bot, InlineKeyboard, type Context } from "grammy";
import { isAdminRole, isFullAdmin, type ProfileRole } from "@sabacos/core";
import type { AppEnv } from "../env.js";
import { getDb } from "../db/client.js";
import { getProfileByTelegramId, upsertTelegramProfile } from "../db/profiles.js";
import { listActiveCategories } from "../db/catalog.js";
import { getSettings } from "../db/settings.js";
import { r2Config, r2Put } from "../services/r2.js";
import { aiEnabled, llamaVisionProduct } from "../services/ai.js";

/**
 * /addproduct — admin-only guided wizard for creating a product from
 * Telegram. The product photo comes first so the AI vision pipeline can
 * auto-fill name + description; the admin then sets price, stock and the
 * category (chosen from the available categories). Self-contained on purpose
 * (no imports from bot.ts at load time) to avoid a module cycle;
 * postProductToChannel is imported lazily.
 */

type DraftStep =
  | "photo" // waiting for a photo / image URL / manual name / /skip
  | "aiReview" // waiting for the AI-draft buttons
  | "name"
  | "description"
  | "price"
  | "stock"
  | "category"
  | "confirm";

interface ProductDraft {
  step: DraftStep;
  nameEn?: string;
  nameAm?: string;
  descriptionEn?: string;
  descriptionAm?: string;
  priceHalala?: number;
  stock?: number;
  categoryId?: string | null;
  categoryLabel?: string;
  imageBytes?: Uint8Array;
  imageMime?: string;
  imageUrl?: string | null;
}

const drafts = new Map<number, ProductDraft>();

const CANCEL = "/cancel";
const SKIP = "/skip";

function htmlEsc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseAdminTelegramIds(raw: string | undefined): Set<number> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0),
  );
}

/** Gate a chat's sender as admin (mirrors bot.ts ensureAdminRole). */
async function resolveAdminRole(
  ctx: Context,
  env: AppEnv,
): Promise<ProfileRole | null> {
  const from = ctx.from;
  if (!from) return null;
  const db = getDb(env);
  const adminIds = parseAdminTelegramIds(env.ADMIN_TELEGRAM_IDS);
  const profile =
    (await getProfileByTelegramId(db, from.id).catch(() => null)) ??
    (await upsertTelegramProfile(db, { telegramId: from.id }).catch(() => null));
  if (!profile) return null;
  let role = profile.role as ProfileRole;
  if (adminIds.has(profile.telegramId ?? -1) && !isFullAdmin(role)) {
    try {
      await db.from("profiles").update({ role: "admin" }).eq("id", profile.id);
      role = "admin";
    } catch (err) {
      console.error("addproduct: promote failed", err);
    }
  }
  return role;
}

function getDraft(chatId: number): ProductDraft | undefined {
  return drafts.get(chatId);
}

function setDraft(chatId: number, draft: ProductDraft): void {
  drafts.set(chatId, draft);
}

function clearDraft(chatId: number): void {
  drafts.delete(chatId);
}

/** True while a /addproduct wizard session is open for a chat. */
export function hasActiveDraft(chatId: number): boolean {
  return drafts.has(chatId);
}

function formatETB(halala: number): string {
  return (halala / 100).toFixed(2);
}

async function askName(ctx: Context): Promise<void> {
  await ctx.reply("📝 Send the product name (English):");
}

async function askDescription(ctx: Context): Promise<void> {
  await ctx.reply("📄 Send a short marketing description — or /skip for none.");
}

async function askPrice(ctx: Context): Promise<void> {
  await ctx.reply("💰 Send the price in ETB (e.g. 24.50):");
}

async function askStock(ctx: Context): Promise<void> {
  await ctx.reply("📦 Send the stock quantity — or /skip for 0.");
}

async function askCategory(ctx: Context, env: AppEnv): Promise<void> {
  const chatId = ctx.chat!.id;
  const cats = await listActiveCategories(getDb(env)).catch(() => []);
  if (cats.length === 0) {
    const draft = getDraft(chatId);
    if (draft) {
      draft.categoryId = null;
      draft.categoryLabel = "None";
      draft.step = "confirm";
    }
    await sendConfirm(ctx, env);
    return;
  }
  const visible = cats.slice(0, 20);
  const kb = new InlineKeyboard();
  for (let i = 0; i < visible.length; i += 2) {
    const first = visible[i]!;
    const second = visible[i + 1];
    kb.text(htmlEsc(first.nameEn), `ap:cat:${first.id}`);
    if (second) kb.text(htmlEsc(second.nameEn), `ap:cat:${second.id}`);
    kb.row();
  }
  kb.text("⏭  Skip", "ap:cat:skip");
  await ctx.reply("🏷  Pick a category:", { reply_markup: kb });
}

async function sendConfirm(ctx: Context, env: AppEnv): Promise<void> {
  const draft = getDraft(ctx.chat!.id);
  if (!draft) return;
  draft.step = "confirm";
  const lines = [
    "📦 <b>Review your product</b>",
    "",
    `Name (EN): ${htmlEsc(draft.nameEn ?? "")}`,
    `Name (AM): ${htmlEsc(draft.nameAm ?? draft.nameEn ?? "")}`,
    `Description: ${htmlEsc((draft.descriptionEn ?? "none").slice(0, 120))}`,
    `Price: ${formatETB(draft.priceHalala ?? 0)} ETB`,
    `Stock: ${draft.stock ?? 0}`,
    `Category: ${htmlEsc(draft.categoryLabel ?? "None")}`,
    `Photo: ${draft.imageUrl ? "yes" : draft.imageBytes ? "yes" : "no"}`,
  ].join("\n");
  await ctx.reply(lines, {
    parse_mode: "HTML",
    reply_markup: new InlineKeyboard()
      .text("✅  Create", "ap:confirm")
      .text("❌  Cancel", "ap:cancel"),
  });
}

/** Runs the AI vision pipeline on the captured image and shows the draft. */
async function runVision(ctx: Context, env: AppEnv): Promise<void> {
  const draft = getDraft(ctx.chat!.id);
  if (!draft || !draft.imageBytes) return;

  const aiAvailable = aiEnabled(env) || Boolean(env.GEMINI_API_KEY);

  if (!aiAvailable) {
    draft.step = "name";
    await ctx.reply("AI isn't configured on this server — enter the details manually.");
    await askName(ctx);
    return;
  }

  await ctx.reply("🤖 Analyzing the image — this can take up to a minute…");

  try {
    const dataUrl = `data:${draft.imageMime ?? "image/jpeg"};base64,${Buffer.from(draft.imageBytes).toString("base64")}`;
    const ai = await llamaVisionProduct(env, dataUrl);
    if (!ai) throw new Error("vision returned no draft");

    draft.nameEn = ai.nameEn;
    draft.nameAm = ai.nameAm;
    draft.descriptionEn = ai.descriptionEn;
    draft.descriptionAm = ai.descriptionAm;
    draft.step = "aiReview";

    await ctx.reply(
      [
        "🤖 <b>AI draft from the image</b>",
        "",
        `📛 <b>${htmlEsc(ai.nameEn)}</b>`,
        `🗣  ${htmlEsc(ai.nameAm)}`,
        `📄 ${htmlEsc(ai.descriptionEn).slice(0, 220)}`,
        "",
        "Do you want to use these details?",
      ].join("\n"),
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard()
          .text("✅  Use it", "ap:ai:use")
          .text("✏️  Edit", "ap:ai:edit")
          .row()
          .text("🔁  Retry", "ap:ai:retry")
          .text("🚫  Skip AI", "ap:ai:skip"),
      },
    );
  } catch (err) {
    console.error("addproduct: vision failed", err);
    draft.step = "aiReview";
    await ctx.reply("🤖 I couldn't read that image. What do you want to do?", {
      reply_markup: new InlineKeyboard()
        .text("✏️  Enter manually", "ap:ai:edit")
        .text("🔁  Retry", "ap:ai:retry")
        .text("🚫  Skip AI", "ap:ai:skip"),
    });
  }
}

/** Stores image bytes in Cloudflare R2 when configured, else Supabase Storage. */
async function storeImageBytes(
  env: AppEnv,
  db: ReturnType<typeof getDb>,
  path: string,
  bytes: Uint8Array,
  mime: string,
): Promise<string> {
  const r2 = r2Config(env);
  if (r2) {
    try {
      return await r2Put(r2, path, bytes, mime);
    } catch (err) {
      console.error("[r2] upload failed, falling back to Supabase:", err);
    }
  }
  const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], {
    type: mime,
  });
  const { error } = await db.storage
    .from("product-images")
    .upload(path, blob, { contentType: mime, upsert: true });
  if (error) throw new Error(`upload image: ${error.message}`);
  const { data } = db.storage.from("product-images").getPublicUrl(path);
  return data.publicUrl;
}

interface ProductRowShape {
  id: string;
  name_en: string;
  name_am: string;
  description_en: string;
  description_am: string;
  price_halala: number;
  image_urls: string[];
}

async function createProduct(ctx: Context, env: AppEnv): Promise<void> {
  const chatId = ctx.chat!.id;
  const draft = getDraft(chatId);
  if (!draft) return;

  const db = getDb(env);
  const sku = `SKU-${Date.now().toString(36).toUpperCase()}`;
  const nameEn = (draft.nameEn ?? "").trim();
  const nameAm = (draft.nameAm ?? "").trim() || nameEn;

  const { data, error } = await db
    .from("products")
    .insert({
      category_id: draft.categoryId ?? null,
      sku,
      name_en: nameEn,
      name_am: nameAm,
      description_en: draft.descriptionEn ?? "",
      description_am: draft.descriptionAm ?? "",
      price_halala: draft.priceHalala ?? 0,
      cost_halala: 0,
      compare_at_halala: null,
      stock: draft.stock ?? 0,
      image_urls: [],
      is_active: true,
      is_featured: false,
      is_fragile: false,
    })
    .select("*")
    .single();
  if (error) throw new Error(`create product: ${error.message}`);

  const product = data as unknown as ProductRowShape;

  if (draft.imageUrl) {
    const { error: imgErr } = await db
      .from("products")
      .update({ image_urls: [draft.imageUrl] })
      .eq("id", product.id);
    if (imgErr) console.error("addproduct: attach image url failed", imgErr);
    product.image_urls = [draft.imageUrl];
  } else if (draft.imageBytes) {
    try {
      const path = `products/${product.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      const url = await storeImageBytes(env, db, path, draft.imageBytes, draft.imageMime ?? "image/jpeg");
      const { error: imgErr } = await db.from("products").update({ image_urls: [url] }).eq("id", product.id);
      if (imgErr) console.error("addproduct: attach image failed", imgErr);
      product.image_urls = [url];
    } catch (err) {
      console.error("addproduct: upload failed", err);
      await ctx.reply("⚠️ Product created, but the photo could not be uploaded — add it later in the admin dashboard.");
    }
  }

  drafts.delete(chatId);

  const webAppUrl = `${env.WEBAPP_URL.replace(/\/$/, "")}/product/${product.id}`;
  await ctx.reply(
    [
      `✅ <b>${htmlEsc(nameEn)}</b> created!`,
      `💰 ${formatETB(product.price_halala)} ETB · Stock ${draft.stock ?? 0} · ${htmlEsc(draft.categoryLabel ?? "No category")}`,
    ].join("\n"),
    {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().webApp("🛍  View product", webAppUrl),
    },
  );

  const { postProductToChannel } = await import("./bot.js");
  postProductToChannel(env, {
    id: product.id,
    nameEn: product.name_en,
    nameAm: product.name_am,
    descriptionEn: product.description_en,
    descriptionAm: product.description_am,
    priceHalala: product.price_halala,
    imageUrls: product.image_urls,
  }).catch(() => undefined);
}

export function registerAddProductWizard(bot: Bot, env: AppEnv): void {
  bot.command("addproduct", async (ctx) => {
    const role = await resolveAdminRole(ctx, env);
    if (!role || !isAdminRole(role)) {
      await ctx.reply("You are not authorized to manage products.");
      return;
    }

    setDraft(ctx.chat!.id, { step: "photo" });
    await ctx.reply(
      [
        "🛍  <b>Add a product</b> — I'll guide you through it.",
        "",
        "Send a <b>photo</b> of the product (or paste an image URL), and I'll use AI to fill the name & description for you.",
        "",
        "Or send <code>/skip</code> to enter everything manually.",
        "Type <code>/cancel</code> anytime to stop.",
      ].join("\n"),
      { parse_mode: "HTML" },
    );
  });

  bot.callbackQuery(/^ap:/, async (ctx) => {
    const chatId = ctx.chat!.id;
    const data = ctx.callbackQuery.data;
    const draft = drafts.get(chatId);

    if (data === "ap:confirm") {
      if (!draft) return;
      await ctx.answerCallbackQuery();
      try {
        await createProduct(ctx, env);
      } catch (err) {
        console.error("addproduct: create failed", err);
        const msg = err instanceof Error ? err.message : String(err);
        await ctx.reply(`❌ Could not create the product: ${msg}\nUse /addproduct to start over.`);
        drafts.delete(chatId);
      }
      return;
    }

    if (data === "ap:cancel") {
      drafts.delete(chatId);
      await ctx.answerCallbackQuery("Cancelled.");
      await ctx.reply("Cancelled. Send /addproduct anytime to start again.");
      return;
    }

    if (data === "ap:ai:use") {
      await ctx.answerCallbackQuery();
      if (!draft) return;
      draft.step = "price";
      await askPrice(ctx);
      return;
    }

    if (data === "ap:ai:edit") {
      await ctx.answerCallbackQuery();
      if (!draft) return;
      draft.step = "name";
      await askName(ctx);
      return;
    }

    if (data === "ap:ai:retry") {
      await ctx.answerCallbackQuery();
      if (draft?.imageBytes) {
        await runVision(ctx, env);
      }
      return;
    }

    if (data === "ap:ai:skip") {
      await ctx.answerCallbackQuery();
      if (!draft) return;
      draft.nameEn = undefined;
      draft.nameAm = undefined;
      draft.descriptionEn = undefined;
      draft.descriptionAm = undefined;
      draft.step = "name";
      await askName(ctx);
      return;
    }

    if (data.startsWith("ap:cat:")) {
      await ctx.answerCallbackQuery();
      if (draft) {
        const id = data.slice("ap:cat:".length);
        draft.categoryId = id === "skip" ? null : id;
        draft.categoryLabel = id === "skip" ? "None" : draft.categoryLabel;
      }
      await sendConfirm(ctx, env);
      return;
    }
  });

  bot.on("message:text").filter((ctx) => !!drafts.get(ctx.chat.id), async (ctx) => {
    const draft = drafts.get(ctx.chat.id)!;
    const text = (ctx.message.text ?? "").trim();

    if (text.toLowerCase() === CANCEL) {
      drafts.delete(ctx.chat.id);
      await ctx.reply("Cancelled. Send /addproduct anytime to start again.");
      return;
    }

    try {
      switch (draft.step) {
        case "photo": {
          if (text.toLowerCase() === SKIP) {
            draft.step = "name";
            await askName(ctx);
            return;
          }
          if (/^https?:\/\//i.test(text)) {
            await ctx.reply("🔍 Downloading image…");
            try {
              const res = await fetch(text);
              if (!res.ok) throw new Error(`fetch failed (${res.status})`);
              const buf = await res.arrayBuffer();
              draft.imageUrl = text;
              draft.imageBytes = new Uint8Array(buf);
              draft.imageMime = res.headers.get("content-type") ?? "image/jpeg";
              await runVision(ctx, env);
            } catch (err) {
              console.error("addproduct: url download failed", err);
              await ctx.reply("⚠️ Couldn't download that URL. Send the photo directly as an image, or /skip to enter the details manually.");
            }
            return;
          }
          draft.nameEn = text.slice(0, 200);
          draft.nameAm = text.slice(0, 200);
          draft.step = "description";
          await askDescription(ctx);
          return;
        }
        case "aiReview":
        case "confirm":
          await ctx.reply("Use the buttons below, or /cancel to stop.");
          return;
        case "name":
          draft.nameEn = text.slice(0, 200);
          draft.nameAm = text.slice(0, 200);
          if (!draft.descriptionEn) {
            draft.step = "description";
            await askDescription(ctx);
          } else {
            draft.step = "price";
            await askPrice(ctx);
          }
          return;
        case "description":
          if (text.toLowerCase() === SKIP) {
            draft.descriptionEn = "";
            draft.descriptionAm = "";
          } else {
            draft.descriptionEn = text.slice(0, 2000);
            draft.descriptionAm = text.slice(0, 2000);
          }
          draft.step = "price";
          await askPrice(ctx);
          return;
        case "price": {
          const clean = text.replace(",", ".");
          const value = Number(clean);
          if (!Number.isFinite(value) || value <= 0 || value > 100000) {
            await ctx.reply("⚠️ That price doesn't look right. Send a number in ETB (e.g. 24.50):");
            return;
          }
          draft.priceHalala = Math.round(value * 100);
          draft.step = "stock";
          await askStock(ctx);
          return;
        }
        case "stock": {
          if (text.toLowerCase() === SKIP) {
            draft.stock = 0;
          } else {
            const value = Math.floor(Number(text));
            if (!Number.isFinite(value) || value < 0) {
              await ctx.reply("⚠️ Stock must be a whole number ≥ 0. Send /skip to leave it at 0.");
              return;
            }
            draft.stock = value;
          }
          await askCategory(ctx, env);
          return;
        }
        default:
          await ctx.reply("Use the buttons below, or /cancel to stop.");
      }
    } catch (err) {
      console.error("addproduct wizard error:", err);
      await ctx.reply("⚠️ Something went wrong. Send /cancel and try again.");
    }
  });

  bot.on("message:photo").filter((ctx) => {
    const draft = drafts.get(ctx.chat.id);
    return !!draft && draft.step === "photo";
  }, async (ctx) => {
    const chatId = ctx.chat.id;
    const draft = drafts.get(chatId)!;
    try {
      const photo = ctx.message.photo?.[ctx.message.photo.length - 1];
      if (!photo) throw new Error("no photo");
      const file = await ctx.api.getFile(photo.file_id);
      if (!file.file_path) throw new Error("no file path");
      const res = await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${file.file_path}`);
      if (!res.ok) throw new Error(`download failed (${res.status})`);
      const buf = await res.arrayBuffer();
      draft.imageUrl = null;
      draft.imageBytes = new Uint8Array(buf);
      draft.imageMime = (file as { mime_type?: string }).mime_type ?? "image/jpeg";
      await runVision(ctx, env);
    } catch (err) {
      console.error("addproduct: photo download failed", err);
      await ctx.reply("⚠️ Could not download that photo. Send it again, paste a URL, /skip to enter manually, or /cancel.");
    }
  });
}