import { describe, expect, it } from "vitest";
import { ease } from "../easing";
import { EASING_NAMES } from "../types";

describe("ease", () => {
  it("is identity for linear", () => {
    expect(ease(0, "linear")).toBe(0);
    expect(ease(0.5, "linear")).toBe(0.5);
    expect(ease(1, "linear")).toBe(1);
  });

  it("stays within a bounded range for all named easings", () => {
    for (const name of EASING_NAMES) {
      for (const t of [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1]) {
        const v = ease(t, name);
        // Back easings overshoot the [0,1] range slightly by design.
        expect(v).toBeGreaterThanOrEqual(-0.5);
        expect(v).toBeLessThanOrEqual(1.5);
      }
    }
  });

  it("anchors endpoints for all named easings", () => {
    for (const name of EASING_NAMES) {
      expect(Math.abs(ease(0, name))).toBeLessThan(1e-9);
      expect(Math.abs(ease(1, name) - 1)).toBeLessThan(1e-9);
    }
  });

  it("is monotonic for easeOut", () => {
    let prev = ease(0, "easeOut");
    for (let t = 0.05; t <= 1; t += 0.05) {
      const v = ease(t, "easeOut");
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });

  it("supports custom cubic bezier", () => {
    const v = ease(0.5, { cubicBezier: [0.42, 0, 0.58, 1] });
    expect(v).toBeGreaterThan(0.4);
    expect(v).toBeLessThan(0.6);
  });

  it("easeOutBounce exceeds the midpoint on the way down", () => {
    expect(ease(0.5, "easeOutBounce")).toBeGreaterThan(0.5);
  });
});
