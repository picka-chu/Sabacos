import { BlurFilter, ColorMatrixFilter, Filter, NoiseFilter } from "pixi.js";
import { evaluateAnimatable } from "@motion/core";
import type { Effect } from "@motion/core";
import { makeChromaKeyFilter } from "./chromaKeyFilter";

export type EffectHandle = {
  id: string;
  filter: Filter;
  update: (effect: Effect, time: number) => void;
};

export function createEffectHandles(effects: Effect[]): EffectHandle[] {
  return effects.map(createHandle);
}

function createHandle(effect: Effect): EffectHandle {
  switch (effect.type) {
    case "blur": {
      const filter = new BlurFilter({ strength: 1 });
      return {
        id: effect.id,
        filter,
        update: (e, t) => {
          const eff = e as Extract<Effect, { type: "blur" }>;
          const v = Math.max(0, evaluateAnimatable(eff.amount, t));
          filter.strength = v;
          filter.enabled = eff.enabled && v > 0;
        },
      };
    }
    case "colorAdjust": {
      const filter = new ColorMatrixFilter();
      return {
        id: effect.id,
        filter,
        update: (e, t) => {
          const eff = e as Extract<Effect, { type: "colorAdjust" }>;
          const b = evaluateAnimatable(eff.brightness, t);
          const c = evaluateAnimatable(eff.contrast, t);
          const s = evaluateAnimatable(eff.saturation, t);
          const h = evaluateAnimatable(eff.hue, t);
          filter.brightness(1 + b, false);
          filter.contrast(c, true);
          filter.saturate(s, true);
          filter.hue(h, true);
          filter.enabled = eff.enabled;
        },
      };
    }
    case "chromaKey": {
      const eff = effect as Extract<Effect, { type: "chromaKey" }>;
      const filter = makeChromaKeyFilter(eff.color, eff.similarity, eff.smoothness);
      return {
        id: effect.id,
        filter,
        update: (e) => {
          const fn = e as Extract<Effect, { type: "chromaKey" }>;
          filter.resources.uKeyColor.value = [fn.color.r, fn.color.g, fn.color.b];
          filter.resources.uSimilarity.value = fn.similarity;
          filter.resources.uSmoothness.value = fn.smoothness;
          filter.enabled = fn.enabled;
        },
      };
    }
    case "invert": {
      const filter = new ColorMatrixFilter();
      filter.negative(false);
      return {
        id: effect.id,
        filter,
        update: (e) => {
          filter.enabled = (e as Extract<Effect, { type: "invert" }>).enabled;
        },
      };
    }
    case "sepia": {
      const filter = new ColorMatrixFilter();
      filter.sepia(false);
      return {
        id: effect.id,
        filter,
        update: (e, t) => {
          const eff = e as Extract<Effect, { type: "sepia" }>;
          const v = Math.min(1, Math.max(0, evaluateAnimatable(eff.amount, t)));
          filter.alpha = v;
          filter.enabled = eff.enabled;
        },
      };
    }
    case "noise": {
      const filter = new NoiseFilter({ noise: 0.2, seed: Math.random() });
      return {
        id: effect.id,
        filter,
        update: (e, t) => {
          const eff = e as Extract<Effect, { type: "noise" }>;
          const v = Math.max(0, evaluateAnimatable(eff.amount, t));
          filter.noise = v;
          filter.enabled = eff.enabled && v > 0;
        },
      };
    }
  }
}
