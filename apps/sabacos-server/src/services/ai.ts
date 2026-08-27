import { z } from "zod";

const CF_BASE = "https://api.cloudflare.com/client/v4";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

export type aiEnv = { CLOUDFLARE_ACCOUNT_ID?: string; CLOUDFLARE_API_TOKEN?: string; GEMINI_API_KEY?: string };

export const EMBED_MODEL = "@cf/baai/bge-small-en-v1.5"; // 384 dims
export const AD_COPY_MODEL = "@cf/meta/llama-3.2-3b-instruct";
export const NOTIFY_MODEL = "@cf/meta/llama-3.1-8b-instruct";

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
): Promise<string | null> {
  if (!geminiEnabled(env)) return null;
  const url = `${GEMINI_BASE}/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 800 },
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
  const match = text.match(/\{[\s\S]*\}/);
  return match ? JSON.parse(match[0]) : null;
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
  "Write a concise product listing. Respond ONLY with JSON: " +
  '{"name_en": "product name in English (max 60 chars)", ' +
  '"name_am": "the same name in Amharic script", ' +
  '"description_en": "2 sentence marketing description in English", ' +
  '"description_am": "the same description in Amharic script"}';

function parseVisionResponse(raw: string): ProductDraft | null {
  try {
    const parsed = DRAFT_JSON.safeParse(extractJson(raw));
    if (!parsed.success) {
      console.error("[ai/vision] JSON schema validation failed:", parsed.error.format());
      console.error("[ai/vision] Raw response:", raw.slice(0, 500));
      return null;
    }
    return {
      nameEn: parsed.data.name_en.slice(0, 80),
      nameAm: parsed.data.name_am.slice(0, 80),
      descriptionEn: parsed.data.description_en.slice(0, 1000),
      descriptionAm: parsed.data.description_am.slice(0, 1000),
    };
  } catch (err) {
    console.error("[ai/vision] JSON parse error:", err instanceof Error ? err.message : err);
    console.error("[ai/vision] Raw response:", raw.slice(0, 500));
    return null;
  }
}

/** Cloudflare Llama 3.2 11B vision */
async function cfVisionProduct(env: aiEnv, imageDataUrl: string): Promise<ProductDraft | null> {
  const imgSizeKb = Math.round(((imageDataUrl.length * 3) / 4) / 1024);
  console.log(`[ai/vision/cf] Starting — image ~${imgSizeKb}KB base64`);

  const result = await cfRun<{ response: string }>(
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

  if (!result?.response) {
    console.error("[ai/vision/cf] No response returned from Cloudflare");
    return null;
  }

  console.log("[ai/vision/cf] Raw response:", result.response.slice(0, 300));
  return parseVisionResponse(result.response);
}

/** Gemini 2.0 Flash vision via REST */
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

  const raw = await geminiGenerate(
    env,
    "gemini-2.0-flash",
    [
      { text: VISION_PROMPT },
      { inlineData: { mimeType, data: base64Data } },
    ],
    60_000,
  );

  if (!raw) {
    console.error("[ai/vision/gemini] No response returned from Gemini");
    return null;
  }

  console.log("[ai/vision/gemini] Raw response:", raw.slice(0, 300));
  return parseVisionResponse(raw);
}

/**
 * Analyzes a product photo and drafts bilingual name + description.
 * Tries Cloudflare Llama first, falls back to Gemini Flash.
 * Returns null only if both fail.
 */
export async function llamaVisionProduct(
  env: aiEnv,
  imageDataUrl: string,
): Promise<ProductDraft | null> {
  // 1. Try Cloudflare
  if (aiEnabled(env)) {
    const cf = await cfVisionProduct(env, imageDataUrl);
    if (cf) {
      console.log("[ai/vision] Cloudflare succeeded:", cf.nameEn);
      return cf;
    }
    console.warn("[ai/vision] Cloudflare failed, trying Gemini fallback…");
  } else {
    console.log("[ai/vision] Cloudflare not configured, going straight to Gemini");
  }

  // 2. Fallback to Gemini
  if (geminiEnabled(env)) {
    const gem = await geminiVisionProduct(env, imageDataUrl);
    if (gem) {
      console.log("[ai/vision] Gemini succeeded:", gem.nameEn);
      return gem;
    }
    console.error("[ai/vision] Both Cloudflare and Gemini failed");
  } else {
    console.error("[ai/vision] No AI provider available (neither Cloudflare nor Gemini configured)");
  }

  return null;
}
