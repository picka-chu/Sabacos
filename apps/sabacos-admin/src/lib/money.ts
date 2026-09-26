/**
 * Parse an ETB text/number input to integer halala.
 * Returns null for empty, non-numeric, infinite or negative input —
 * callers must reject null with a field error instead of sending 0/NaN
 * (which the server would accept as a free/zero amount).
 */
export function etbToHalala(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = typeof value === "number" ? String(value) : value;
  const n = Number(text.trim().replace(/,/g, ""));
  if (text.trim() === "" || !Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** Format integer halala as ETB with two decimals. */
export function formatHalala(halala: number): string {
  return `${(halala / 100).toFixed(2)} ETB`;
}
