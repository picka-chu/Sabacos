import { z } from "zod";

const CF_BASE = "https://api.cloudflare.com/client/v4";

export type aiEnv = { CLOUDFLARE_ACCOUNT_ID?: string; CLOUDFLARE_API_TOKEN?: string };

export const EMBED_MODEL = "@cf/baai/bge-small-en-v1.5"; // 384 dims
export const AD_COPY_MODEL = "@cf/meta/llama-3.2-3b-instruct";
export const NOTIFY_MODEL = "@cf/meta/llama-3.1-8b-instruct";

export function aiEnabled(env: { CLOUDFLARE_ACCOUNT_ID?: string; CLOUDFLARE_API_TOKEN?: string }): boolean {
  return Boolean(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN);
}

interface CfResponse<T> {
  result?: T;
  success?: boolean;
  errors?: { code: number; message: string }[];
}

async function cfRun<T>(env: { CLOUDFLARE_ACCOUNT_ID?: string; CLOUDFLARE_API_TOKEN?: string }, model: string, input: unknown): Promise<T | null> {
  if (!aiEnabled(env)) return null;
  try {
    const res = await fetch(`${CF_BASE}/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${model}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error(`[ai] ${model} failed: ${res.status}`);
      return null;
    }
    const json = (await res.json()) as CfResponse<T>;
    if (!json.success || json.result == null) {
      console.error(`[ai] ${model} error:`, json.errors);
      return null;
    }
    return json.result;
  } catch (err) {
    console.error(`[ai] ${model} threw:`, err);
    return null;
  }
}

export async function embedText(
  env: { CLOUDFLARE_ACCOUNT_ID?: string; CLOUDFLARE_API_TOKEN?: string },
  text: string,
): Promise<number[] | null> {
  const result = await cfRun<{ data: number[][] }>(env, EMBED_MODEL, { text: [text.slice(0, 2000)] });
  return result?.data?.[0] ?? null;
}

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
          'Return ONLY JSON: {"text": "..."}.',
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
