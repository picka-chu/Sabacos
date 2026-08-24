// Zone-based delivery pricing engine.
// Config is admin-editable (stored in the settings table as delivery_config);
// these defaults apply when keys are missing.

export interface DeliveryOrigin {
  lat: number;
  lng: number;
}

export interface DeliveryZone {
  /** Distance upper bound in km; null = unlimited (farthest zone). */
  maxKm: number | null;
  surchargeHalala: number;
}

export interface DeliveryBaseTier {
  /** Cart value strictly below this halala amount gets feeHalala. */
  belowHalala: number;
  feeHalala: number;
}

export interface DeliveryConfig {
  origin: DeliveryOrigin;
  zones: DeliveryZone[];
  baseTiers: DeliveryBaseTier[];
  freeThresholdHalala: number;
  expressMultiplier: number;
  fragileFeeHalala: number;
}

export const DEFAULT_DELIVERY_CONFIG: DeliveryConfig = {
  origin: { lat: 9.0107, lng: 38.7613 }, // Addis Ababa (Bole) — edit in admin settings
  zones: [
    { maxKm: 3, surchargeHalala: 0 },
    { maxKm: 7, surchargeHalala: 2500 },
    { maxKm: null, surchargeHalala: 4500 },
  ],
  baseTiers: [
    { belowHalala: 50000, feeHalala: 9000 },
    { belowHalala: 150000, feeHalala: 5500 },
    { belowHalala: 200000, feeHalala: 3000 },
    { belowHalala: Number.MAX_SAFE_INTEGER, feeHalala: 0 },
  ],
  freeThresholdHalala: 200000,
  expressMultiplier: 1.5,
  fragileFeeHalala: 1000,
};

/** Merges a partial stored config over the defaults. */
export function mergeDeliveryConfig(stored: unknown): DeliveryConfig {
  const d = DEFAULT_DELIVERY_CONFIG;
  if (stored == null || typeof stored !== "object") return structuredClone(d);
  const s = stored as Partial<DeliveryConfig>;
  return {
    origin:
      s.origin && typeof s.origin.lat === "number" && typeof s.origin.lng === "number"
        ? { lat: s.origin.lat, lng: s.origin.lng }
        : { ...d.origin },
    zones:
      Array.isArray(s.zones) && s.zones.length > 0
        ? s.zones.map((z) => ({
            maxKm: typeof z?.maxKm === "number" ? z.maxKm : null,
            surchargeHalala: Math.max(0, Math.round(z?.surchargeHalala ?? 0)),
          }))
        : structuredClone(d.zones),
    baseTiers:
      Array.isArray(s.baseTiers) && s.baseTiers.length > 0
        ? [...s.baseTiers]
            .map((t) => ({
              belowHalala: Math.max(0, Math.round(t?.belowHalala ?? 0)),
              feeHalala: Math.max(0, Math.round(t?.feeHalala ?? 0)),
            }))
            .sort((a, b) => a.belowHalala - b.belowHalala)
        : structuredClone(d.baseTiers),
    freeThresholdHalala: Math.max(0, Math.round(s.freeThresholdHalala ?? d.freeThresholdHalala)),
    expressMultiplier:
      typeof s.expressMultiplier === "number" && s.expressMultiplier >= 1
        ? s.expressMultiplier
        : d.expressMultiplier,
    fragileFeeHalala: Math.max(0, Math.round(s.fragileFeeHalala ?? d.fragileFeeHalala)),
  };
}

const EARTH_RADIUS_KM = 6371;

export function haversineKm(a: DeliveryOrigin, b: DeliveryOrigin): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** 1-based zone index for a distance, or null if it exceeds every bound. */
export function zoneForDistance(config: DeliveryConfig, distanceKm: number): number | null {
  for (let i = 0; i < config.zones.length; i++) {
    const max = config.zones[i]?.maxKm;
    if (max == null || distanceKm <= max) return i + 1;
  }
  return null;
}

export function zoneSurchargeFor(config: DeliveryConfig, zone: number | null): number {
  if (zone == null) return config.zones[Math.min(1, config.zones.length - 1)]?.surchargeHalala ?? 0;
  return config.zones[zone - 1]?.surchargeHalala ?? 0;
}

function baseFeeFor(config: DeliveryConfig, subtotalHalala: number): number {
  for (const tier of config.baseTiers) {
    if (subtotalHalala < tier.belowHalala) return tier.feeHalala;
  }
  return 0;
}

export interface DeliveryQuoteInput {
  subtotalHalala: number;
  /** Resolved zone (1-based), when known from GPS or manual picker. */
  zone?: number | null;
  express?: boolean;
  fragile?: boolean;
}

export interface DeliveryBreakdown {
  zone: number | null;
  baseFeeHalala: number;
  zoneSurchargeHalala: number;
  expressSurchargeHalala: number;
  fragileFeeHalala: number;
  totalDeliveryFeeHalala: number;
  freeDeliveryApplied: boolean;
  express: boolean;
}

/**
 * delivery_fee = (base + zone_surcharge) * (express ? multiplier : 1)
 *                [free threshold zeroes base+zone for standard, but an express
 *                 order still pays the 50% express surcharge]
 *              + fragile_fee (always applies)
 */
export function computeDelivery(
  config: DeliveryConfig,
  input: DeliveryQuoteInput,
): DeliveryBreakdown {
  const zone = input.zone ?? null;
  const express = input.express === true;
  const fragile = input.fragile === true;

  const baseFee = baseFeeFor(config, input.subtotalHalala);
  const zoneSurcharge = zoneSurchargeFor(config, zone);
  const standardComponent = baseFee + zoneSurcharge;
  const freeStandard =
    !express && input.subtotalHalala >= config.freeThresholdHalala;

  let component: number;
  let expressSurcharge = 0;
  if (freeStandard) {
    component = 0;
  } else if (express) {
    if (input.subtotalHalala >= config.freeThresholdHalala) {
      // Free standard still applies; keep only the express uplift.
      expressSurcharge = Math.round(standardComponent * (config.expressMultiplier - 1));
      component = expressSurcharge;
    } else {
      expressSurcharge = Math.round(
        standardComponent * config.expressMultiplier - standardComponent,
      );
      component = standardComponent + expressSurcharge;
    }
  } else {
    component = standardComponent;
  }

  const fragileFee = fragile ? config.fragileFeeHalala : 0;

  return {
    zone,
    baseFeeHalala: freeStandard ? 0 : baseFee,
    zoneSurchargeHalala: freeStandard ? 0 : zoneSurcharge,
    expressSurchargeHalala: expressSurcharge,
    fragileFeeHalala: fragileFee,
    totalDeliveryFeeHalala: component + fragileFee,
    freeDeliveryApplied: component === 0,
    express,
  };
}

/** Full quote pipeline: coordinates → zone → breakdown. */
export function quoteDelivery(
  config: DeliveryConfig,
  input: DeliveryQuoteInput & { latitude?: number | null; longitude?: number | null },
): DeliveryBreakdown {
  let zone = input.zone ?? null;
  if (
    zone == null &&
    typeof input.latitude === "number" &&
    typeof input.longitude === "number" &&
    Number.isFinite(input.latitude) &&
    Number.isFinite(input.longitude)
  ) {
    zone = zoneForDistance(
      config,
      haversineKm(config.origin, { lat: input.latitude, lng: input.longitude }),
    );
  }
  return computeDelivery(config, { ...input, zone });
}
