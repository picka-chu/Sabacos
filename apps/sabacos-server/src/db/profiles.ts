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
  info: {
    telegramId: number;
    firstName?: string | null;
    lastName?: string | null;
    username?: string | null;
    photoUrl?: string | null;
  },
): Promise<Profile> {
  const existing = await getProfileByTelegramId(db, info.telegramId);
  const row = {
    telegram_id: info.telegramId,
    first_name: info.firstName ?? existing?.firstName ?? null,
    last_name: info.lastName ?? existing?.lastName ?? null,
    username: info.username ?? existing?.username ?? null,
    photo_url: info.photoUrl ?? existing?.photoUrl ?? null,
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

export async function saveProfileContact(
  db: Db,
  id: string,
  input: {
    phone?: string;
    address?: string;
    lastLatitude?: number | null;
    lastLongitude?: number | null;
  },
): Promise<Profile> {
  const patch: Record<string, string | number> = {};
  if (input.phone !== undefined) patch.phone = input.phone;
  if (input.address !== undefined) patch.address = input.address;
  if (input.lastLatitude !== undefined && input.lastLatitude !== null) {
    patch.last_latitude = input.lastLatitude;
  }
  if (input.lastLongitude !== undefined && input.lastLongitude !== null) {
    patch.last_longitude = input.lastLongitude;
  }

  const { data, error } = await db.from("profiles").update(patch).eq("id", id).select("*").single();
  if (error) throw new Error(`saveProfileContact: ${error.message}`);
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