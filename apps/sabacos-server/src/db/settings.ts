import {
  mergeDeliveryConfig,
  settingsRowSchema,
  type DeliveryConfig,
  type Settings,
} from "@sabacos/core";
import type { Db } from "./client.js";

let cache: Settings | null = null;
let cachedAt = 0;
const TTL_MS = 15_000;

export async function getSettings(db: Db, force = false): Promise<Settings> {
  if (!force && cache && Date.now() - cachedAt < TTL_MS) return cache;

  const { data, error } = await db.from("settings").select("value").eq("key", "store").single();
  if (error) throw new Error(`Failed to load settings: ${error.message}`);
  const parsed = settingsRowSchema.parse(data.value);
  cache = parsed;
  cachedAt = Date.now();
  return parsed;
}

export async function updateSettings(db: Db, patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings(db, true);
  const merged: Settings = {
    deliveryFeeHalala: patch.deliveryFeeHalala ?? current.deliveryFeeHalala,
    freeDeliveryThresholdHalala:
      patch.freeDeliveryThresholdHalala ?? current.freeDeliveryThresholdHalala,
    shopNameEn: patch.shopNameEn ?? current.shopNameEn,
    shopNameAm: patch.shopNameAm ?? current.shopNameAm,
    shopPhone: patch.shopPhone ?? current.shopPhone,
    adminChannelId:
      patch.adminChannelId === undefined ? current.adminChannelId : patch.adminChannelId,
    aiVisionModel:
      patch.aiVisionModel === undefined ? (current.aiVisionModel ?? null) : patch.aiVisionModel,
    deliveryConfig:
      patch.deliveryConfig === undefined
        ? (current.deliveryConfig ?? null)
        : mergeDeliveryConfig(patch.deliveryConfig),
  };

  const { error } = await db
    .from("settings")
    .update({
      value: {
        delivery_fee_halala: merged.deliveryFeeHalala,
        free_delivery_threshold_halala: merged.freeDeliveryThresholdHalala,
        shop_name_en: merged.shopNameEn,
        shop_name_am: merged.shopNameAm,
        shop_phone: merged.shopPhone,
        admin_channel_id: merged.adminChannelId,
        ai_vision_model: merged.aiVisionModel ?? null,
        ...(merged.deliveryConfig ? { delivery_config: merged.deliveryConfig } : {}),
      },
    })
    .eq("key", "store");
  if (error) throw new Error(`Failed to update settings: ${error.message}`);

  cache = merged;
  cachedAt = Date.now();
  return merged;
}

export function invalidateSettingsCache(): void {
  cache = null;
  cachedAt = 0;
}