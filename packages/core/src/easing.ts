import type { CubicBezier, Easing, EasingName } from "./types";

const NAMED_EASINGS: Record<EasingName, CubicBezier | "bounce"> = {
  linear: [0, 0, 1, 1],
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
  easeInBack: [0.6, -0.28, 0.735, 0.045],
  easeOutBack: [0.175, 0.885, 0.32, 1.275],
  easeInOutBack: [0.68, -0.55, 0.265, 1.55],
  easeInBounce: "bounce",
  easeOutBounce: "bounce",
  easeInOutBounce: "bounce",
};

/** Normalizes an Easing into concrete control points for bezier-based curves. */
export function easingToBezier(easing: Easing): CubicBezier | null {
  if (typeof easing === "string") {
    const named = NAMED_EASINGS[easing];
    if (!named || named === "bounce") return null;
    return named;
  }
  return easing.cubicBezier;
}

export function isBounce(easing: Easing): boolean {
  return (
    typeof easing === "string" &&
    (easing === "easeInBounce" || easing === "easeOutBounce" || easing === "easeInOutBounce")
  );
}

function solveBounce(t: number, easing: EasingName): number {
  if (easing === "easeOutBounce") {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  }
  if (easing === "easeInBounce") return 1 - solveBounce(1 - t, "easeOutBounce");
  // easeInOutBounce
  return t < 0.5
    ? (1 - solveBounce(1 - 2 * t, "easeOutBounce")) / 2
    : (1 + solveBounce(2 * t - 1, "easeOutBounce")) / 2;
}

const NEWTON_ITERATIONS = 4;
const NEWTON_MIN_SLOPE = 0.001;
const SUBDIVISION_PRECISION = 1e-7;
const SUBDIVISION_MAX_ITERATIONS = 10;

function bezierCoefficients(x1: number, y1: number, x2: number, y2: number) {
  return {
    ax: 3 * x1 - 3 * x2 + 1,
    bx: 3 * x2 - 6 * x1,
    cx: 3 * x1,
    ay: 3 * y1 - 3 * y2 + 1,
    by: 3 * y2 - 6 * y1,
    cy: 3 * y1,
  };
}

function sampleCurveX(t: number, ax: number, bx: number, cx: number): number {
  return ((ax * t + bx) * t + cx) * t;
}

function sampleCurveY(t: number, ay: number, by: number, cy: number): number {
  return ((ay * t + by) * t + cy) * t;
}

function sampleCurveDerivativeX(t: number, ax: number, bx: number, cx: number): number {
  return (3 * ax * t + 2 * bx) * t + cx;
}

function solveCurveX(x: number, ax: number, bx: number, cx: number): number {
  let t0 = 0;
  let t1 = 1;
  let t2 = x;
  let i = 0;
  while (t2 > 0 && t2 < 1) {
    const x2 = sampleCurveX(t2, ax, bx, cx);
    if (Math.abs(x2 - x) < SUBDIVISION_PRECISION) return t2;
    const d = sampleCurveDerivativeX(t2, ax, bx, cx);
    if (Math.abs(d) < NEWTON_MIN_SLOPE) break;
    t2 -= (x2 - x) / d;
    if (++i > NEWTON_ITERATIONS) break;
  }
  if (t2 <= 0) return 0;
  if (t2 >= 1) return 1;
  while (t0 < t1) {
    const x2 = sampleCurveX(t2, ax, bx, cx);
    if (Math.abs(x2 - x) < SUBDIVISION_PRECISION) return t2;
    if (x > x2) t0 = t2;
    else t1 = t2;
    t2 = (t1 - t0) * 0.5 + t0;
    if (++i > SUBDIVISION_MAX_ITERATIONS + NEWTON_ITERATIONS) break;
  }
  return t2;
}

/** Maps a time fraction (0..1) through the easing curve. */
export function ease(t: number, easing: Easing): number {
  const clamped = Math.min(1, Math.max(0, t));
  if (typeof easing === "string" && isBounce(easing)) {
    return solveBounce(clamped, easing);
  }
  const bezier = easingToBezier(easing) ?? [0, 0, 1, 1];
  const [x1, y1, x2, y2] = bezier;
  if (x1 === y1 && x2 === y2) return clamped;
  const { ax, bx, cx, ay, by, cy } = bezierCoefficients(x1, y1, x2, y2);
  const tSolved = solveCurveX(clamped, ax, bx, cx);
  return sampleCurveY(tSolved, ay, by, cy);
}
