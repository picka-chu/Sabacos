import { HALALA_PER_ETB } from "./types.js";

export function toHalala(etb: number): number {
  return Math.round(etb * HALALA_PER_ETB);
}

export function halalaToEtb(halala: number): number {
  return halala / HALALA_PER_ETB;
}

export function formatETB(halala: number, locale = "en-US"): string {
  const value = halalaToEtb(halala);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "ETB",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatETBCompact(halala: number): string {
  const value = halalaToEtb(halala);
  return `ETB ${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatQty(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

export function isPositiveHalala(v: number): boolean {
  return Number.isInteger(v) && v >= 0;
}

export function assertHalala(v: number): void {
  if (!Number.isInteger(v)) throw new Error(`Expected integer halala, got ${v}`);
}

export function clampQty(qty: number): number {
  return Math.max(1, Math.min(99, Math.floor(qty)));
}