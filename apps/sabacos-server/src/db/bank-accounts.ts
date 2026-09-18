import { type BankAccount, type BankName, BANK_NAMES } from "@sabacos/core";
import type { Db } from "./client.js";

const BANK_ACCOUNT_COLUMNS = [
  "id",
  "bank_name",
  "account_name",
  "account_number",
  "is_active",
  "created_at",
  "updated_at",
].join(", ");

function parseBankAccountRow(row: Record<string, unknown>): BankAccount {
  return {
    id: row.id as string,
    bankName: row.bank_name as BankName,
    accountName: row.account_name as string,
    accountNumber: row.account_number as string,
    isActive: row.is_active as boolean,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export async function listBankAccounts(db: Db): Promise<BankAccount[]> {
  const { data, error } = await db
    .from("bank_accounts")
    .select(BANK_ACCOUNT_COLUMNS)
    .eq("is_active", true)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listBankAccounts: ${error.message}`);
  return (data as unknown as Record<string, unknown>[] ?? []).map(parseBankAccountRow);
}

export async function listAllBankAccounts(db: Db): Promise<BankAccount[]> {
  const { data, error } = await db
    .from("bank_accounts")
    .select(BANK_ACCOUNT_COLUMNS)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listAllBankAccounts: ${error.message}`);
  return (data as unknown as Record<string, unknown>[] ?? []).map(parseBankAccountRow);
}

export async function getBankAccountById(db: Db, id: string): Promise<BankAccount | null> {
  const { data, error } = await db
    .from("bank_accounts")
    .select(BANK_ACCOUNT_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getBankAccountById: ${error.message}`);
  return data ? parseBankAccountRow(data as unknown as Record<string, unknown>) : null;
}

export async function createBankAccount(
  db: Db,
  input: { bankName: BankName; accountName: string; accountNumber: string; isActive?: boolean },
): Promise<BankAccount> {
  if (!BANK_NAMES.includes(input.bankName)) {
    throw new Error(`Invalid bank name: ${input.bankName}`);
  }
  const { data, error } = await db
    .from("bank_accounts")
    .insert({
      bank_name: input.bankName,
      account_name: input.accountName,
      account_number: input.accountNumber,
      is_active: input.isActive ?? true,
    })
    .select(BANK_ACCOUNT_COLUMNS)
    .single();
  if (error) throw new Error(`createBankAccount: ${error.message}`);
  return parseBankAccountRow(data as unknown as Record<string, unknown>);
}

export async function updateBankAccount(
  db: Db,
  id: string,
  input: { bankName?: BankName; accountName?: string; accountNumber?: string; isActive?: boolean },
): Promise<BankAccount | null> {
  const update: Record<string, unknown> = {};
  if (input.bankName !== undefined) {
    if (!BANK_NAMES.includes(input.bankName)) throw new Error(`Invalid bank name: ${input.bankName}`);
    update.bank_name = input.bankName;
  }
  if (input.accountName !== undefined) update.account_name = input.accountName;
  if (input.accountNumber !== undefined) update.account_number = input.accountNumber;
  if (input.isActive !== undefined) update.is_active = input.isActive;

  const { data, error } = await db
    .from("bank_accounts")
    .update(update)
    .eq("id", id)
    .select(BANK_ACCOUNT_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(`updateBankAccount: ${error.message}`);
  return data ? parseBankAccountRow(data as unknown as Record<string, unknown>) : null;
}

export async function deleteBankAccount(db: Db, id: string): Promise<boolean> {
  const { error } = await db.from("bank_accounts").delete().eq("id", id);
  if (error) throw new Error(`deleteBankAccount: ${error.message}`);
  return true;
}

/** Update order with payment proof and notify admin. */
export async function submitPaymentProof(
  db: Db,
  orderId: string,
  proofUrl: string,
): Promise<void> {
  const { error } = await db
    .from("orders")
    .update({
      payment_proof_url: proofUrl,
      payment_proof_status: "pending",
    })
    .eq("id", orderId);
  if (error) throw new Error(`submitPaymentProof: ${error.message}`);
}

/** Admin action: approve or reject payment proof. */
export async function verifyPaymentProof(
  db: Db,
  orderId: string,
  action: "approved" | "rejected",
  rejectionReason?: string,
): Promise<void> {
  const update: Record<string, unknown> = {
    payment_proof_status: action,
  };
  if (action === "rejected" && rejectionReason) {
    update.payment_proof_rejection_reason = rejectionReason;
  }
  const { error } = await db
    .from("orders")
    .update(update)
    .eq("id", orderId);
  if (error) throw new Error(`verifyPaymentProof: ${error.message}`);
}

/** Finalize bank split deposit after admin approval. Calls the atomic RPC. */
export async function finalizeBankSplitDeposit(
  db: Db,
  orderId: string,
  bankAccountId: string,
): Promise<string> {
  const { data, error } = await db.rpc("finalize_bank_split_deposit", {
    p_order_id: orderId,
    p_bank_account_id: bankAccountId,
  });
  if (error) throw new Error(`finalizeBankSplitDeposit: ${error.message}`);
  return data as string;
}
