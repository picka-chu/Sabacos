import { z } from "zod";

const CF_BASE = "https://api.cloudflare.com/client/v4";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

export type aiEnv = { CLOUDFLARE_ACCOUNT_ID?: string; CLOUDFLARE_API_TOKEN?: string; GEMINI_API_KEY?: string; GEMINI_MODEL?: string };

export const EMBED_MODEL = "@cf/baai/bge-small-en-v1.5"; // 384 dims
export const AD_COPY_MODEL = "@cf/meta/llama-3.2-3b-instruct";
export const NOTIFY_MODEL = "@cf/meta/llama-3.1-8b-instruct";
export const GEMINI_DEFAULT_MODEL = "gemini-3.5-flash-lite";
export const GEMINI_VISION_FALLBACKS = ["gemini-3.5-flash-lite", "gemini-2.5-flash", "gemini-2.0-flash"];

function geminiModel(env: aiEnv): string {
  return env.GEMINI_MODEL || GEMINI_DEFAULT_MODEL;
}

export function aiEnabled(env: { CLOUDFLARE_ACCOUNT_ID?: string; CLOUDFLARE_API_TOKEN?: string }): boolean {
  return Boolean(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN);
}

function geminiEnabled(env: aiEnv): boolean {
  return Boolean(env.GEMINI_API_KEY);
}

// ---------------------------------------------------------------------------
// Cloudflare Workers AI
// ---------------------------------------------------------------------------

interface CfResponse<T> {
  result?: T;
  success?: boolean;
  errors?: { code: number; message: string }[];
}

async function cfRun<T>(env: { CLOUDFLARE_ACCOUNT_ID?: string; CLOUDFLARE_API_TOKEN?: string }, model: string, input: unknown, timeoutMs = 15_000): Promise<T | null> {
  if (!aiEnabled(env)) return null;
  try {
    const res = await fetch(`${CF_BASE}/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${model}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[ai/cf] ${model} HTTP ${res.status}: ${body.slice(0, 500)}`);
      return null;
    }
    const json = (await res.json()) as CfResponse<T>;
    if (!json.success || json.result == null) {
      console.error(`[ai/cf] ${model} API error:`, JSON.stringify(json.errors));
      return null;
    }
    console.log(`[ai/cf] ${model} result type: ${typeof json.result}, keys: ${typeof json.result === "object" && json.result ? Object.keys(json.result).join(", ") : "N/A"}`);
    return json.result;
  } catch (err) {
    console.error(`[ai/cf] ${model} threw:`, err instanceof Error ? err.message : err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Gemini REST API (no SDK needed)
// ---------------------------------------------------------------------------

async function geminiGenerate(
  env: aiEnv,
  model: string,
  parts: { text?: string; inlineData?: { mimeType: string; data: string } }[],
  timeoutMs = 60_000,
  maxOutputTokens = 800,
): Promise<string | null> {
  if (!geminiEnabled(env)) return null;
  const url = `${GEMINI_BASE}/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { temperature: 0.4, maxOutputTokens },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[ai/gemini] ${model} HTTP ${res.status}: ${body.slice(0, 500)}`);
      return null;
    }
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      error?: { message?: string };
    };
    if (json.error) {
      console.error(`[ai/gemini] ${model} API error:`, json.error.message);
      return null;
    }
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      console.error(`[ai/gemini] ${model} returned empty response:`, JSON.stringify(json).slice(0, 500));
      return null;
    }
    return text;
  } catch (err) {
    console.error(`[ai/gemini] ${model} threw:`, err instanceof Error ? err.message : err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------

export async function embedText(
  env: { CLOUDFLARE_ACCOUNT_ID?: string; CLOUDFLARE_API_TOKEN?: string },
  text: string,
): Promise<number[] | null> {
  const result = await cfRun<{ data: number[][] }>(env, EMBED_MODEL, { text: [text.slice(0, 2000)] });
  return result?.data?.[0] ?? null;
}

// ---------------------------------------------------------------------------
// Ad copy / notification text
// ---------------------------------------------------------------------------

const COPY_JSON = z.object({ headline: z.string().min(1).max(80), cta: z.string().min(1).max(24) });

function extractJson(text: string): unknown {
  // Strip markdown code fences if present
  const cleaned = text.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) {
    console.error("[ai/extractJson] No JSON object found in:", cleaned.slice(0, 500));
    return null;
  }
  try {
    return JSON.parse(match[0]);
  } catch (err) {
    console.error("[ai/extractJson] JSON.parse failed:", err instanceof Error ? err.message : err);
    console.error("[ai/extractJson] Attempted to parse:", match[0].slice(0, 500));
    return null;
  }
}

/** Micro banner copy via Llama. Returns null on any failure (caller falls back to templates). */
export async function llamaAdCopy(
  env: { CLOUDFLARE_ACCOUNT_ID?: string; CLOUDFLARE_API_TOKEN?: string },
  product: { name: string; category?: string; discountPct: number | null },
  lang: "en" | "am",
): Promise<{ headline: string; cta: string } | null> {
  const language = lang === "am" ? "Amharic" : "English";
  const result = await cfRun<{ response: string }>(env, AD_COPY_MODEL, {
    messages: [
      {
        role: "system",
        content:
          "You are a micro-ad generator for a cosmetics shop. " +
          `Write a maximum-10-word banner headline and a 2-word call to action in ${language}. ` +
          'Return ONLY a JSON object: {"headline": "...", "cta": "..."}. No other text.',
      },
      {
        role: "user",
        content: `Product: "${product.name}"${product.category ? `, category: ${product.category}` : ""}${
          product.discountPct != null ? `, ${product.discountPct}% off` : ""
        }.`,
      },
    ],
    max_tokens: 120,
    temperature: 0.7,
  });
  if (!result?.response) return null;
  try {
    const parsed = COPY_JSON.safeParse(extractJson(result.response));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const NOTIFY_JSON = z.object({ text: z.string().min(1).max(400) });

/** Telegram notification copy via Llama. Returns null on any failure. */
export async function llamaNotifyText(
  env: { CLOUDFLARE_ACCOUNT_ID?: string; CLOUDFLARE_API_TOKEN?: string },
  product: { name: string; priceEtb: string; oldPriceEtb?: string; discountPct: number | null },
  interestHint: string,
  lang: "en" | "am",
): Promise<string | null> {
  const language = lang === "am" ? "Amharic" : "English";
  const result = await cfRun<{ response: string }>(env, NOTIFY_MODEL, {
    messages: [
      {
        role: "system",
        content:
          `You write short casual Telegram promo notifications in ${language}. Max 25 words, 1-2 emojis. ` +
          "Mention the product and price. End with the shop name Sabacos. " +
          'Return ONLY JSON: {"text": "..."}',
      },
      {
        role: "user",
        content:
          `Customer interests: ${interestHint}. Product on sale: "${product.name}", now ${product.priceEtb} ETB` +
          `${product.oldPriceEtb ? ` (was ${product.oldPriceEtb} ETB)` : ""}` +
          `${product.discountPct != null ? `, ${product.discountPct}% off` : ""}.`,
      },
    ],
    max_tokens: 160,
    temperature: 0.8,
  });
  if (!result?.response) return null;
  try {
    const parsed = NOTIFY_JSON.safeParse(extractJson(result.response));
    return parsed.success ? parsed.data.text : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Product vision — Cloudflare Llama → Gemini Flash fallback
// ---------------------------------------------------------------------------

export interface ProductDraft {
  nameEn: string;
  nameAm: string;
  descriptionEn: string;
  descriptionAm: string;
}

const DRAFT_JSON = z.object({
  name_en: z.string().min(1),
  name_am: z.string().min(1),
  description_en: z.string().min(1),
  description_am: z.string().min(1),
});

const VISION_PROMPT =
  "Identify this cosmetics/beauty product from the photo. " +
  "Write a full e-commerce product listing. Respond ONLY with JSON: " +
  '{"name_en": "product name in English (max 60 chars)", ' +
  '"name_am": "SAME name, do not translate — keep the brand name as-is. For Amharic script, optionally transliterate but do not translate the meaning.", ' +
  '"description_en": "An e-commerce product description in English: 3-4 sentences covering the main benefit, key features (formula/notes/finish/coverage as visible or commonly known for this type), how to use it briefly, and who it is ideal for. Write persuasively to drive a purchase decision, never a generic mention of the product name to describe itself.", ' +
  '"description_am": "The same e-commerce description in natural, marketing-friendly Amharic script (not a literal translation)".}';

function parseVisionResponse(raw: string): ProductDraft | null {
  console.log("[ai/vision/parse] Input length:", raw.length, "starts with:", raw.slice(0, 120));

  // Try to parse as JSON directly first (in case it's already a clean JSON string)
  let json: unknown = null;
  try {
    json = JSON.parse(raw);
    console.log("[ai/vision/parse] Direct JSON.parse succeeded");
  } catch {
    // Fall back to extractJson (find JSON embedded in text)
    console.log("[ai/vision/parse] Direct JSON.parse failed, trying extractJson");
    json = extractJson(raw);
  }

  if (!json || typeof json !== "object") {
    console.error("[ai/vision/parse] Failed to extract JSON object from response");
    return null;
  }

  const parsed = DRAFT_JSON.safeParse(json);
  if (!parsed.success) {
    console.error("[ai/vision/parse] Schema validation failed:", parsed.error.format());
    console.error("[ai/vision/parse] Parsed object:", JSON.stringify(json).slice(0, 500));
    return null;
  }

  return {
    nameEn: parsed.data.name_en.slice(0, 80),
    nameAm: parsed.data.name_am.slice(0, 80),
    descriptionEn: parsed.data.description_en.slice(0, 1000),
    descriptionAm: parsed.data.description_am.slice(0, 1000),
  };
}

/** Cloudflare Llama 3.2 11B vision */
async function cfVisionProduct(env: aiEnv, imageDataUrl: string): Promise<ProductDraft | null> {
  const imgSizeKb = Math.round(((imageDataUrl.length * 3) / 4) / 1024);
  console.log(`[ai/vision/cf] Starting — image ~${imgSizeKb}KB base64`);

  const result = await cfRun<{ response: unknown }>(
    env,
    "@cf/meta/llama-3.2-11b-vision-instruct",
    {
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: imageDataUrl } },
            { type: "text", text: VISION_PROMPT },
          ],
        },
      ],
      max_tokens: 600,
    },
    45_000,
  );

  if (result?.response == null) {
    console.error("[ai/vision/cf] No response returned from Cloudflare");
    return null;
  }

  // Cloudflare may return response as a string OR as an already-parsed object
  let rawText: string;
  if (typeof result.response === "string") {
    rawText = result.response;
  } else if (typeof result.response === "object") {
    rawText = JSON.stringify(result.response);
    console.log("[ai/vision/cf] Response was an object, stringified for parsing");
  } else {
    rawText = String(result.response);
  }

  console.log("[ai/vision/cf] Raw response type:", typeof result.response);
  console.log("[ai/vision/cf] Raw response (full):", rawText);
  return parseVisionResponse(rawText);
}

/**
 * Gemini vision via REST — tries the configured model first, then falls back
 * through the known-good vision models so one bad/partial model name can't
 * sink the whole pipeline.
 */
async function geminiVisionProduct(env: aiEnv, imageDataUrl: string): Promise<ProductDraft | null> {
  // Parse data:image/jpeg;base64,... → mime + base64
  const match = imageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match || !match[1] || !match[2]) {
    console.error("[ai/vision/gemini] Invalid image data URL format");
    return null;
  }
  const mimeType = match[1];
  const base64Data = match[2];
  const imgSizeKb = Math.round((base64Data.length * 3) / 4 / 1024);
  console.log(`[ai/vision/gemini] Starting — image ~${imgSizeKb}KB, mime: ${mimeType}`);

  const models = [
    geminiModel(env),
    ...GEMINI_VISION_FALLBACKS,
  ];

  const seen = new Set<string>();
  for (const model of models) {
    if (seen.has(model)) continue;
    seen.add(model);
    console.log(`[ai/vision/gemini] Trying model ${model}`);

    const raw = await geminiGenerate(
      env,
      model,
      [
        { text: VISION_PROMPT },
        { inlineData: { mimeType, data: base64Data } },
      ],
      60_000,
      2048,
    );

    if (!raw) {
      console.error(`[ai/vision/gemini] No response from ${model}`);
      continue;
    }

    console.log(`[ai/vision/gemini] ${model} raw response length:`, raw.length);
    const parsed = parseVisionResponse(raw);
    if (parsed) {
      console.log(`[ai/vision/gemini] ${model} succeeded`);
      return parsed;
    }
  }

  console.error("[ai/vision/gemini] All models failed");
  return null;
}

/** Translate English description to Amharic via Gemini */
async function geminiTranslateToAmharic(env: aiEnv, englishText: string): Promise<string | null> {
  console.log("[ai/translate/am] Translating description to Amharic, length:", englishText.length);
  const raw = await geminiGenerate(
    env,
    geminiModel(env),
    [
      {
        text:
          "Translate the following English product description to Amharic (አማርኛ). " +
          "Keep it natural and marketing-friendly. Only return the translated text, nothing else.\n\n" +
          englishText,
      },
    ],
    30_000,
    1024,
  );
  if (raw) {
    console.log("[ai/translate/am] Translation succeeded, length:", raw.length);
    return raw.trim();
  }
  console.error("[ai/translate/am] Translation failed");
  return null;
}

/**
 * Analyzes a product photo and drafts bilingual name + description.
 * Tries Gemini first (most reliable, best quality), falls back to
 * Cloudflare Llama vision. Uses Gemini for Amharic description translation
 * (name stays in English). Returns null only if all providers fail.
 */
export async function llamaVisionProduct(
  env: aiEnv,
  imageDataUrl: string,
): Promise<ProductDraft | null> {
  let draft: ProductDraft | null = null;

  // 1. Try Gemini first — best quality, most reliable
  if (geminiEnabled(env)) {
    draft = await geminiVisionProduct(env, imageDataUrl);
    if (draft) console.log("[ai/vision] Gemini succeeded:", draft.nameEn);
    else console.warn("[ai/vision] Gemini failed, trying Cloudflare…");
  } else {
    console.log("[ai/vision] Gemini not configured, going straight to Cloudflare");
  }

  // 2. Fallback to Cloudflare Llama for vision
  if (!draft && aiEnabled(env)) {
    draft = await cfVisionProduct(env, imageDataUrl);
    if (draft) console.log("[ai/vision] Cloudflare succeeded:", draft.nameEn);
    else console.error("[ai/vision] Cloudflare vision also failed");
  }

  if (!draft) {
    console.error("[ai/vision] All vision providers failed");
    return null;
  }

  // 3. Keep the model's Amharic name/description when provided — only fall
  //    back to the English name if the model left name_am empty, and use
  //    Gemini to refresh the Amharic description translation.
  draft = { ...draft, nameAm: (draft.nameAm ?? "").trim() ? draft.nameAm : draft.nameEn };

  if (geminiEnabled(env)) {
    const amDesc = await geminiTranslateToAmharic(env, draft.descriptionEn);
    if (amDesc) {
      draft = { ...draft, descriptionAm: amDesc };
      console.log("[ai/vision] Amharic description translated via Gemini");
    } else {
      console.warn("[ai/vision] Amharic translation failed, keeping original description_am");
    }
  }

  console.log("[ai/vision] Final draft:", JSON.stringify(draft).slice(0, 300));
  return draft;
}
