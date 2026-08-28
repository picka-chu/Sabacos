import type { Db } from "./client.js";
import {
  walletCreditRowSchema,
  walletTransactionRowSchema,
  type WalletCredit,
  type WalletTransaction,
} from "@sabacos/core";

// ──────────────────────────────────────────────────────────────────────
// Wallet CRUD
// ──────────────────────────────────────────────────────────────────────

/** Get wallet by profile ID. */
export async function getWalletByProfileId(
  db: Db,
  profileId: string,
): Promise<WalletCredit | null> {
  const { data, error } = await db
    .from("wallet_credits")
    .select("*")
    .eq("profile_id", profileId)
    .single();

  if (error || !data) return null;
  return walletCreditRowSchema.parse(data);
}

/** Get or create wallet for a profile. */
export async function getOrCreateWallet(
  db: Db,
  profileId: string,
): Promise<WalletCredit> {
  // Try to get existing
  const existing = await getWalletByProfileId(db, profileId);
  if (existing) return existing;

  // Create new wallet
  const { data, error } = await db
    .from("wallet_credits")
    .insert({ profile_id: profileId, balance_halala: 0 })
    .select()
    .single();

  if (error) throw new Error(`getOrCreateWallet: ${error.message}`);
  return walletCreditRowSchema.parse(data);
}

/** Get wallet balance. */
export async function getWalletBalance(
  db: Db,
  profileId: string,
): Promise<number> {
  const wallet = await getWalletByProfileId(db, profileId);
  return wallet?.balanceHalala ?? 0;
}

/** Credit wallet using the atomic RPC function. */
export async function creditWallet(
  db: Db,
  profileId: string,
  amountHalala: number,
  description: string,
  referenceType?: string,
  referenceId?: string,
): Promise<{ walletId: string; newBalance: number }> {
  const { data, error } = await db.rpc("credit_wallet", {
    p_profile_id: profileId,
    p_amount_halala: amountHalala,
    p_description: description,
    p_reference_type: referenceType ?? null,
    p_reference_id: referenceId ?? null,
  });

  if (error) throw new Error(`creditWallet: ${error.message}`);
  return {
    walletId: data.wallet_id,
    newBalance: data.new_balance,
  };
}

/** Debit wallet using the atomic RPC function. */
export async function debitWallet(
  db: Db,
  profileId: string,
  amountHalala: number,
  description: string,
  referenceType?: string,
  referenceId?: string,
): Promise<{ walletId: string; newBalance: number }> {
  const { data, error } = await db.rpc("debit_wallet", {
    p_profile_id: profileId,
    p_amount_halala: amountHalala,
    p_description: description,
    p_reference_type: referenceType ?? null,
    p_reference_id: referenceId ?? null,
  });

  if (error) throw new Error(`debitWallet: ${error.message}`);
  return {
    walletId: data.wallet_id,
    newBalance: data.new_balance,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Wallet Transactions
// ──────────────────────────────────────────────────────────────────────

/** Get wallet transactions for a profile. */
export async function getWalletTransactions(
  db: Db,
  profileId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<WalletTransaction[]> {
  const { limit = 50, offset = 0 } = options;

  const { data: wallet } = await db
    .from("wallet_credits")
    .select("id")
    .eq("profile_id", profileId)
    .single();

  if (!wallet) return [];

  const { data, error } = await db
    .from("wallet_transactions")
    .select("*")
    .eq("wallet_id", wallet.id)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw new Error(`getWalletTransactions: ${error.message}`);
  return (data ?? []).map((r) => walletTransactionRowSchema.parse(r));
}

/** Get wallet transaction summary (total credited, debited, net). */
export async function getWalletSummary(
  db: Db,
  profileId: string,
): Promise<{ totalCredited: number; totalDebited: number; net: number }> {
  const wallet = await getWalletByProfileId(db, profileId);
  if (!wallet) return { totalCredited: 0, totalDebited: 0, net: 0 };

  const { data, error } = await db
    .from("wallet_transactions")
    .select("type, amount_halala")
    .eq("wallet_id", wallet.id);

  if (error) throw new Error(`getWalletSummary: ${error.message}`);

  let totalCredited = 0;
  let totalDebited = 0;

  for (const tx of data ?? []) {
    if (tx.type === "credit" || tx.type === "refund") {
      totalCredited += tx.amount_halala;
    } else {
      totalDebited += tx.amount_halala;
    }
  }

  return {
    totalCredited,
    totalDebited,
    net: totalCredited - totalDebited,
  };
}
