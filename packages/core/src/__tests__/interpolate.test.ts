import { describe, expect, it } from "vitest";
import { evaluateAnimatable, lerp, lerpVec2, interpolateValue } from "../interpolate";

describe("evaluateAnimatable", () => {
  it("returns the static value", () => {
    expect(evaluateAnimatable({ type: "static", value: 5 }, 10)).toBe(5);
  });

  it("clamps before the first keyframe", () => {
    const anim = { type: "animated" as const, keyframes: [{ time: 2, value: 10, easing: "linear" as const }] };
    expect(evaluateAnimatable(anim, 0)).toBe(10);
  });

  it("clamps after the last keyframe", () => {
    const anim = {
      type: "animated" as const,
      keyframes: [
        { time: 0, value: 0, easing: "linear" as const },
        { time: 2, value: 10, easing: "linear" as const },
      ],
    };
    expect(evaluateAnimatable(anim, 100)).toBe(10);
  });

  it("interpolates between keyframes with linear easing", () => {
    const anim = {
      type: "animated" as const,
      keyframes: [
        { time: 0, value: 0, easing: "linear" as const },
        { time: 10, value: 100, easing: "linear" as const },
      ],
    };
    expect(evaluateAnimatable(anim, 5)).toBe(50);
  });

  it("interpolates vectors component-wise", () => {
    const anim = {
      type: "animated" as const,
      keyframes: [
        { time: 0, value: { x: 0, y: 0 }, easing: "linear" as const },
        { time: 2, value: { x: 100, y: -20 }, easing: "linear" as const },
      ],
    };
    expect(evaluateAnimatable(anim, 1)).toEqual({ x: 50, y: -10 });
  });

  it("applies easing of the left keyframe", () => {
    const anim = {
      type: "animated" as const,
      keyframes: [
        { time: 0, value: 0, easing: "easeOut" as const },
        { time: 1, value: 1, easing: "linear" as const },
      ],
    };
    const eased = evaluateAnimatable(anim, 0.5);
    expect(eased).toBeGreaterThan(0.5); // easeOut speeds early progress
  });
});

describe("lerp helpers", () => {
  it("lerp", () => {
    expect(lerp(10, 20, 0.25)).toBe(12.5);
  });

  it("lerpVec2", () => {
    expect(lerpVec2({ x: 0, y: 10 }, { x: 100, y: 20 }, 0.5)).toEqual({ x: 50, y: 15 });
  });

  it("interpolateValue dispatches by shape", () => {
    expect(interpolateValue(1, 3, 0.5)).toBe(2);
    expect(interpolateValue({ x: 0, y: 0 }, { x: 10, y: 10 }, 0.5)).toEqual({ x: 5, y: 5 });
    expect(interpolateValue({ r: 0, g: 0, b: 0, a: 0 }, { r: 1, g: 1, b: 1, a: 1 }, 0.5)).toEqual({
      r: 0.5,
      g: 0.5,
      b: 0.5,
      a: 0.5,
    });
  });
});
