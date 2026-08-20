import type { Db } from "./client.js";

export async function nextOrderSeq(db: Db): Promise<number> {
  const { data, error } = await db.rpc("next_order_seq");
  if (error) throw new Error(`next_order_seq failed: ${error.message}`);
  return data as number;
}