import { profileRowSchema, type Profile } from "@sabacos/core";
import type { Db } from "./client.js";

export async function getProfileByTelegramId(db: Db, telegramId: number): Promise<Profile | null> {
  const { data, error } = await db
    .from("profiles")
    .select("*")
    .eq("telegram_id", telegramId)
    .single();
  if (error) {
    if (error.code === "PGRST116") return null;
    throw new Error(`getProfileByTelegramId: ${error.message}`);
  }
  return profileRowSchema.parse(data);
}

export async function upsertTelegramProfile(
  db: Db,
  info: { telegramId: number; firstName?: string | null; lastName?: string | null; username?: string | null },
): Promise<Profile> {
  const existing = await getProfileByTelegramId(db, info.telegramId);
  const row = {
    telegram_id: info.telegramId,
    first_name: info.firstName ?? existing?.firstName ?? null,
    last_name: info.lastName ?? existing?.lastName ?? null,
    username: info.username ?? existing?.username ?? null,
  };

  if (existing) {
    const { data, error } = await db
      .from("profiles")
      .update(row)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw new Error(`upsertTelegramProfile update: ${error.message}`);
    return profileRowSchema.parse(data);
  }

  const { data, error } = await db
    .from("profiles")
    .insert({ ...row, role: "customer" })
    .select("*")
    .single();
  if (error) throw new Error(`upsertTelegramProfile insert: ${error.message}`);
  return profileRowSchema.parse(data);
}

export async function getProfileById(db: Db, id: string): Promise<Profile | null> {
  const { data, error } = await db.from("profiles").select("*").eq("id", id).single();
  if (error) {
    if (error.code === "PGRST116") return null;
    throw new Error(`getProfileById: ${error.message}`);
  }
  return profileRowSchema.parse(data);
}

export async function saveProfileAddress(db: Db, id: string, phone: string, address: string): Promise<Profile> {
  const { data, error } = await db
    .from("profiles")
    .update({ phone, address })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(`saveProfileAddress: ${error.message}`);
  return profileRowSchema.parse(data);
}

export async function getProfileByAuthId(db: Db, authId: string): Promise<Profile | null> {
  const { data, error } = await db.from("profiles").select("*").eq("id", authId).single();
  if (error) {
    if (error.code === "PGRST116") return null;
    throw new Error(`getProfileByAuthId: ${error.message}`);
  }
  return profileRowSchema.parse(data);
}