import { profileRowSchema, type Profile, type ProfileRole } from "@sabacos/core";
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

export async function setProfileLanguage(
  db: Db,
  id: string,
  language: "en" | "am",
): Promise<Profile> {
  const { data, error } = await db.from("profiles").update({ language }).eq("id", id).select("*").single();
  if (error) throw new Error(`setProfileLanguage: ${error.message}`);
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

// ---- User management (admin) ----

export interface ListUsersFilters {
  role?: ProfileRole | null;
  search?: string | null;
  page?: number;
  pageSize?: number;
}

export interface ListUsersResult {
  items: Profile[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listUsers(db: Db, filters: ListUsersFilters = {}): Promise<ListUsersResult> {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = db.from("profiles").select("*", { count: "exact" });

  if (filters.role) {
    query = query.eq("role", filters.role);
  }
  if (filters.search) {
    const term = `%${filters.search}%`;
    query = query.or(`username.ilike.${term},first_name.ilike.${term},last_name.ilike.${term},phone.ilike.${term}`);
  }

  query = query.order("created_at", { ascending: false }).range(from, to);

  const { data, error, count } = await query;
  if (error) throw new Error(`listUsers: ${error.message}`);
  return {
    items: (data ?? []).map((row) => profileRowSchema.parse(row)),
    total: count ?? 0,
    page,
    pageSize,
  };
}

export async function updateUserRole(
  db: Db,
  userId: string,
  role: ProfileRole,
): Promise<Profile> {
  const { data, error } = await db
    .from("profiles")
    .update({ role })
    .eq("id", userId)
    .select("*")
    .single();
  if (error) throw new Error(`updateUserRole: ${error.message}`);
  return profileRowSchema.parse(data);
}

export async function inviteUserByTelegramId(
  db: Db,
  telegramId: number,
  role: ProfileRole,
): Promise<Profile> {
  // Check if user already exists
  const existing = await getProfileByTelegramId(db, telegramId);
  if (existing) {
    // Update role if different
    if (existing.role !== role) {
      return updateUserRole(db, existing.id, role);
    }
    return existing;
  }

  // Create placeholder profile — user will be upserted with real data on /start
  const { data, error } = await db
    .from("profiles")
    .insert({
      telegram_id: telegramId,
      role,
    })
    .select("*")
    .single();
  if (error) throw new Error(`inviteUserByTelegramId: ${error.message}`);
  return profileRowSchema.parse(data);
}

export async function deleteUser(db: Db, userId: string): Promise<void> {
  const { error } = await db.from("profiles").delete().eq("id", userId);
  if (error) throw new Error(`deleteUser: ${error.message}`);
}