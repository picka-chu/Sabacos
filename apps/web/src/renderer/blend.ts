import type { BLEND_MODES } from "pixi.js";
import type { BlendMode, Rgba } from "@motion/core";

export function rgbaToHex(color: Rgba): number {
  const r = Math.round(color.r * 255) & 0xff;
  const g = Math.round(color.g * 255) & 0xff;
  const b = Math.round(color.b * 255) & 0xff;
  return (r << 16) | (g << 8) | b;
}

const BLEND_MAP: Record<BlendMode, BLEND_MODES> = {
  "source-over": "normal",
  addition: "add",
  multiply: "multiply",
  screen: "screen",
  overlay: "overlay",
  darken: "darken",
  lighten: "lighten",
  difference: "difference",
};

export function blendModeToPixi(mode: BlendMode): BLEND_MODES {
  return BLEND_MAP[mode];
}
