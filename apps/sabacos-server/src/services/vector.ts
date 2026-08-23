import { embedText, aiEnabled } from "./ai.js";

const VEC_INDEX = "sabacos-taste"; // 384 dims (bge-small-en-v1.5), cosine metric
const CF_BASE = "https://api.cloudflare.com/client/v4";

type Env = { CLOUDFLARE_ACCOUNT_ID?: string; CLOUDFLARE_API_TOKEN?: string };

export function vectorEnabled(env: Env): boolean {
  return aiEnabled(env);
}

async function vecRequest<T>(env: Env, path: string, body: unknown): Promise<T | null> {
  try {
    const res = await fetch(`${CF_BASE}/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/vectorize/v2/indexes/${VEC_INDEX}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error(`[vectorize] ${path} failed: ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.error(`[vectorize] ${path} threw:`, err);
    return null;
  }
}

/**
 * Rolling "taste" vector per profile: one vector whose id encodes the
 * profile id. Each product view re-embeds and upserts it.
 */
export async function updateUserTasteVector(
  env: Env,
  profileId: string,
  productText: string,
): Promise<void> {
  const values = await embedText(env, productText);
  if (!values) return;
  const res = await vecRequest<{ mutationId?: unknown }>(env, "/upsert", {
    vectors: [{ id: `profile:${profileId}`, values, namespace: "taste", metadata: { profileId } }],
  });
  if (!res) console.warn("[vectorize] taste upsert skipped");
}

/** Returns profile ids whose taste vector is nearest to the given text. */
export async function queryMatchingProfiles(
  env: Env,
  text: string,
  topK = 60,
): Promise<string[]> {
  const values = await embedText(env, text);
  if (!values) return [];
  interface QueryResult {
    result?: { matches?: { id: string; score: number }[] };
    success?: boolean;
  }
  const res = await vecRequest<QueryResult>(env, "/query", {
    vector: values,
    topK,
    namespace: "taste",
    returnMetadata: "none",
    returnValues: false,
  });
  const matches = res?.result?.matches ?? [];
  return matches
    .map((m) => m.id.replace(/^profile:/, ""))
    .filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
}
