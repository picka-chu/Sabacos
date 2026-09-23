/**
 * Minimal Chapa Transfer API client (payouts only — accepting payments goes
 * through Telegram invoices with CHAPA_PROVIDER_TOKEN, a different credential).
 *
 * Docs: https://developer.chapa.co/transfer/transfers
 * Auth: `Authorization: Bearer <CHAPA_SECRET_KEY>` (CHASECK-...).
 *
 * Notes that shaped this client:
 * - Transfer hours are Mon–Sat 08:30–16:30 EAT; outside them Chapa rejects,
 *   so callers treat failures as retryable-via-admin, never silent.
 * - `reference` must be unique per business; we use our referral_payouts.id,
 *   which doubles as the idempotency key on retry.
 * - Response shapes are parsed defensively — Chapa's docs omit exact verify/
 *   banks payloads, so anything unrecognized surfaces as an explicit error.
 */

const BASE = "https://api.chapa.co/v1";
const TIMEOUT_MS = 15_000;

export interface ChapaBank {
  code: string;
  name: string;
}

export interface ChapaTransferResult {
  ok: boolean;
  /** Chapa's own transfer id, when known. */
  transferId: string | null;
  /** "reference used before" needs different handling (verify instead). */
  referenceUsedBefore: boolean;
  message: string;
}

export type ChapaVerifyStatus = "success" | "pending" | "failed" | "unknown";

async function chapaFetch(
  secret: string,
  path: string,
  init?: RequestInit,
): Promise<{ httpStatus: number; body: unknown }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = await res.text().catch(() => null);
    }
    return { httpStatus: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

// ──────────────────────────────────────────────────────────────────────
// Banks (cached 24h — codes change rarely, and we must not hammer Chapa)
// ──────────────────────────────────────────────────────────────────────

let banksCache: { at: number; banks: ChapaBank[] } | null = null;
const BANKS_TTL_MS = 24 * 60 * 60 * 1000;

function normalizeBanks(body: unknown): ChapaBank[] {
  const root = asRecord(body);
  const raw: unknown =
    (root && (root.data ?? root.banks)) ?? body;
  const list = Array.isArray(raw) ? raw : asRecord(raw) ? Object.values(raw as object) : [];
  const banks: ChapaBank[] = [];
  for (const item of list as unknown[]) {
    const r = asRecord(item);
    if (!r) continue;
    const code = r.code ?? r.id ?? r.bank_code ?? r.slug;
    const name = r.name ?? r.bank_name ?? r.title;
    if ((typeof code === "string" || typeof code === "number") && typeof name === "string") {
      banks.push({ code: String(code), name });
    }
  }
  return banks;
}

/**
 * Static fallback bank list (payout-capable methods from
 * https://developer.chapa.co/payment-methods). Served when the live
 * GET /v1/banks lookup fails so the payout-account form always works.
 *
 * Codes here are best-effort display values — Chapa's real numeric codes
 * come from the live endpoint and can change. resolveBankCode() below
 * upgrades any stored code to the live one right before a transfer, so a
 * stale fallback code can never send money to the wrong bank (Chapa also
 * rejects unknown codes outright — failures are safe, never misdirected).
 */
export const PAYOUT_METHODS_FALLBACK: ChapaBank[] = [
  { code: "telebirr", name: "Telebirr" },
  { code: "cbebirr", name: "CBE Birr" },
  { code: "awashbirr", name: "Awash Birr" },
  { code: "awash", name: "Awash Bank" },
  { code: "coopay-ebirr", name: "Coopay-Ebirr" },
  { code: "mpesa", name: "M-Pesa" },
  { code: "boa", name: "BOA Card" },
  { code: "amole", name: "Amole" },
  { code: "enat", name: "Enat Bank" },
  { code: "amhara", name: "Amhara Bank" },
  { code: "cbe-transfer", name: "CBE Bank Transfer" },
  { code: "coop", name: "COOP" },
];

/** Bank list for the payout-account form. Throws when Chapa is unreachable. */
export async function getChapaBanks(secret: string): Promise<ChapaBank[]> {
  if (banksCache && Date.now() - banksCache.at < BANKS_TTL_MS) return banksCache.banks;
  const { httpStatus, body } = await chapaFetch(secret, "/banks", { method: "GET" });
  const root = asRecord(body);
  if (httpStatus < 200 || httpStatus >= 300 || root?.status === "failed") {
    throw new Error(`Chapa banks lookup failed (http ${httpStatus})`);
  }
  const banks = normalizeBanks(body);
  if (banks.length === 0) throw new Error("Chapa returned an empty bank list");
  banksCache = { at: Date.now(), banks };
  return banks;
}

/**
 * Upgrade a stored bank code to Chapa's current live code, matching by stored
 * code first, then by bank name (case-insensitive). Returns null when the
 * live list is unreachable or contains neither — callers must NOT transfer
 * in that case. Throws when there is no secret key at all.
 */
export async function resolveBankCode(
  secret: string | undefined,
  storedCode: string,
  storedName: string,
): Promise<string | null> {
  if (!secret) throw new Error("CHAPA_SECRET_KEY not configured");
  let live: ChapaBank[];
  try {
    // Bypass the cache: money is about to move, so re-validate live.
    banksCache = null;
    live = await getChapaBanks(secret);
  } catch {
    return null;
  }
  const byCode = live.find((b) => b.code === storedCode);
  if (byCode) return byCode.code;
  const want = storedName.trim().toLowerCase();
  const byName = want ? live.find((b) => b.name.trim().toLowerCase() === want) : undefined;
  return byName?.code ?? null;
}

// ──────────────────────────────────────────────────────────────────────
// Transfer
// ──────────────────────────────────────────────────────────────────────

export async function createChapaTransfer(
  secret: string,
  params: {
    accountName: string;
    accountNumber: string;
    amountHalala: number;
    bankCode: string;
    reference: string;
  },
): Promise<ChapaTransferResult> {
  const amountEtb = (params.amountHalala / 100).toFixed(2);
  const bankCode = /^\d+$/.test(params.bankCode) ? Number(params.bankCode) : params.bankCode;
  let httpStatus = 0;
  let body: unknown = null;
  try {
    ({ httpStatus, body } = await chapaFetch(secret, "/transfers", {
      method: "POST",
      body: JSON.stringify({
        account_name: params.accountName,
        account_number: params.accountNumber,
        amount: amountEtb,
        currency: "ETB",
        reference: params.reference,
        bank_code: bankCode,
      }),
    }));
  } catch (err) {
    return {
      ok: false,
      transferId: null,
      referenceUsedBefore: false,
      message: err instanceof Error ? err.message : "Network error calling Chapa",
    };
  }

  const root = asRecord(body);
  const message =
    (typeof root?.message === "string" && root.message) || `Chapa http ${httpStatus}`;
  const data = asRecord(root?.data);
  if (root?.status === "success" || (httpStatus >= 200 && httpStatus < 300)) {
    const transferId =
      (typeof data?.id === "string" || typeof data?.id === "number"
        ? String(data.id)
        : null) ??
      (typeof data?.chapa_reference === "string" ? data.chapa_reference : null) ??
      (typeof data?.reference === "string" ? data.reference : null);
    return { ok: true, transferId, referenceUsedBefore: false, message };
  }
  const referenceUsedBefore = /reference.*(used|exist|duplicate)/i.test(message);
  return { ok: false, transferId: null, referenceUsedBefore, message };
}

// ──────────────────────────────────────────────────────────────────────
// Verify
// ──────────────────────────────────────────────────────────────────────

export async function verifyChapaTransfer(
  secret: string,
  txRef: string,
): Promise<{ status: ChapaVerifyStatus; message: string }> {
  let httpStatus = 0;
  let body: unknown = null;
  try {
    ({ httpStatus, body } = await chapaFetch(secret, `/transfers/verify/${encodeURIComponent(txRef)}`, {
      method: "GET",
    }));
  } catch (err) {
    return { status: "unknown", message: err instanceof Error ? err.message : "Network error" };
  }
  const root = asRecord(body);
  const data = asRecord(root?.data);
  const rawStatus = [root?.status, data?.status, data?.transfer_status]
    .map((v) => (typeof v === "string" ? v.toLowerCase() : ""))
    .find((v) => v.length > 0) ?? "";
  const message = (typeof root?.message === "string" && root.message) || `Chapa http ${httpStatus}`;
  if (/success|successful|completed|paid|sent/.test(rawStatus)) return { status: "success", message };
  if (/fail|error|rejected|reverted|cancel/.test(rawStatus)) return { status: "failed", message };
  if (/pend|process|queue/.test(rawStatus)) return { status: "pending", message };
  return { status: "unknown", message };
}
