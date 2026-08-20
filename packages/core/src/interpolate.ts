import { ease } from "./easing";
import type { Animatable, Rgba, Vec2 } from "./types";

export type Interpolable = number | Vec2 | Rgba;

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpVec2(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

export function lerpRgba(a: Rgba, b: Rgba, t: number): Rgba {
  return {
    r: lerp(a.r, b.r, t),
    g: lerp(a.g, b.g, t),
    b: lerp(a.b, b.b, t),
    a: lerp(a.a, b.a, t),
  };
}

export function isVec2(v: unknown): v is Vec2 {
  return typeof v === "object" && v !== null && "x" in v && "y" in v && !("r" in v);
}

export function isRgba(v: unknown): v is Rgba {
  return typeof v === "object" && v !== null && "r" in v && "g" in v && "b" in v && "a" in v;
}

export function interpolateValue(a: Interpolable, b: Interpolable, t: number): Interpolable {
  if (typeof a === "number" && typeof b === "number") return lerp(a, b, t);
  if (isRgba(a) && isRgba(b)) return lerpRgba(a, b, t);
  if (isVec2(a) && isVec2(b)) return lerpVec2(a, b, t);
  return t < 0.5 ? a : b;
}

/** Evaluates an Animatable at a given time (seconds), interpolating keyframes. */
export function evaluateAnimatable<T extends Interpolable>(anim: Animatable<T>, time: number): T {
  if (anim.type === "static") return anim.value;
  const kfs = anim.keyframes;
  if (kfs.length === 0) return undefined as unknown as T;
  if (kfs.length === 1) return kfs[0]!.value;
  if (time <= kfs[0]!.time) return kfs[0]!.value;
  const last = kfs[kfs.length - 1]!;
  if (time >= last.time) return last.value;

  let i = 1;
  while (i < kfs.length && kfs[i]!.time < time) i++;
  const k0 = kfs[i - 1]!;
  const k1 = kfs[i]!;
  const span = k1.time - k0.time;
  const local = span === 0 ? 0 : (time - k0.time) / span;
  const eased = ease(local, k0.easing);
  return interpolateValue(k0.value, k1.value, eased) as T;
}

export function isKeyframed<T>(anim: Animatable<T>): anim is Extract<Animatable<T>, { type: "animated" }> {
  return anim.type === "animated";
}
