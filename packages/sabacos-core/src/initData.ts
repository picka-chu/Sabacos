import type { InitDataPayload } from "./schemas.js";
import { initDataPayloadSchema } from "./schemas.js";

export interface InitDataValidationResult {
  valid: boolean;
  payload: InitDataPayload | null;
  error?: string;
}

const MAX_AUTH_AGE_SECONDS = 60 * 60 * 24;

async function hmacSha256(secret: Uint8Array, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    secret as unknown as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data) as unknown as ArrayBuffer,
  );
  return new Uint8Array(sig);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.length % 2 === 1 ? `0${hex}` : hex;
  const out = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export async function verifyInitDataHash(
  initData: string,
  botToken: string,
): Promise<boolean> {
  const searchParams = new URLSearchParams(initData);
  const hash = searchParams.get("hash");
  if (!hash) return false;

  const pairs: string[] = [];
  for (const [key, value] of searchParams.entries()) {
    if (key === "hash") continue;
    if (key === "signature") continue;
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();

  const dataCheckString = pairs.join("\n");

  const secretKey = await hmacSha256(new TextEncoder().encode("WebAppData"), botToken);
  const calculated = await hmacSha256(secretKey, dataCheckString);
  const calculatedHex = bytesToHex(calculated);

  const a = hexToBytes(calculatedHex);
  const b = hexToBytes(hash);
  if (a.length !== b.length) return false;
  return timingSafeEqualBytes(a, b);
}

export function parseInitData(initData: string): InitDataPayload | null {
  const searchParams = new URLSearchParams(initData);
  const userRaw = searchParams.get("user");
  let userId: number | null = null;
  let firstName: string | null = null;
  let lastName: string | null = null;
  let username: string | null = null;
  let photoUrl: string | null = null;

  if (userRaw) {
    try {
      const user = JSON.parse(userRaw) as Record<string, unknown>;
      if (typeof user.id === "number") userId = user.id;
      if (typeof user.first_name === "string") firstName = user.first_name;
      if (typeof user.last_name === "string") lastName = user.last_name;
      if (typeof user.username === "string") username = user.username;
      if (typeof user.photo_url === "string") photoUrl = user.photo_url;
    } catch {
      return null;
    }
  }

  const queryId = searchParams.get("query_id");
  const authDateRaw = searchParams.get("auth_date");
  const hash = searchParams.get("hash");

  if (!queryId || !authDateRaw || !hash || userId === null) return null;

  const authDate = Number(authDateRaw);
  if (!Number.isInteger(authDate) || authDate <= 0) return null;

  return initDataPayloadSchema.parse({
    queryId,
    userId,
    authDate,
    firstName,
    lastName,
    username,
    photoUrl,
    hash,
    raw: initData,
  });
}

export async function validateInitData(
  initData: string,
  botToken: string,
): Promise<InitDataValidationResult> {
  const payload = parseInitData(initData);
  if (!payload) {
    return { valid: false, payload: null, error: "Malformed initData" };
  }
  if (!(await verifyInitDataHash(initData, botToken))) {
    return { valid: false, payload: null, error: "Invalid signature" };
  }
  const now = Math.floor(Date.now() / 1000);
  if (now - payload.authDate > MAX_AUTH_AGE_SECONDS) {
    return { valid: false, payload: null, error: "initData expired" };
  }
  return { valid: true, payload };
}