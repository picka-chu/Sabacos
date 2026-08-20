import { evaluateAnimatable } from "./interpolate";
import type { Composition, Layer, Project, Rgba, Vec2 } from "./types";

export type ResolvedTransform = {
  position: Vec2;
  scale: Vec2;
  rotation: number;
  opacity: number;
};

export function evaluateLayerTransform(layer: Layer, time: number): ResolvedTransform {
  const t = layer.transform;
  return {
    position: evaluateAnimatable(t.position, time),
    scale: evaluateAnimatable(t.scale, time),
    rotation: evaluateAnimatable(t.rotation, time),
    opacity: evaluateAnimatable(t.opacity, time),
  };
}

export function layerActiveAt(layer: Layer, time: number): boolean {
  return time >= layer.inPoint && time < layer.outPoint;
}

export function compositionEnd(comp: Composition): number {
  return comp.duration;
}

export function rgbaToCss(color: Rgba): string {
  const { r, g, b, a } = color;
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
}

export type LayerSummary = {
  id: string;
  name: string;
  kind: Layer["kind"];
  inPoint: number;
  outPoint: number;
  visible: boolean;
  locked: boolean;
  /** e.g. text preview or layer size â€” kept tiny for AI context. */
  hint: string;
};

export type CompositionSummary = {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  layers: LayerSummary[];
};

export type ProjectSummary = {
  id: string;
  name: string;
  version: number;
  compositions: CompositionSummary[];
  media: { id: string; kind: string; name: string }[];
};

function layerHint(layer: Layer): string {
  switch (layer.kind) {
    case "text":
      return `"${layer.text}" ${layer.fontSize}px`;
    case "image":
    case "video":
      return `${layer.width}x${layer.height} (${layer.source.type})`;
    case "shape":
      return `${layer.shape} ${layer.width}x${layer.height}`;
    case "audio":
      return `volume ${layer.volume}`;
  }
}

/** Compact, stable snapshot of the project used as AI/LLM context. */
export function summarizeProject(project: Project): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    version: project.version,
    media: project.media.map((m) => ({ id: m.id, kind: m.kind, name: m.name })),
    compositions: project.compositions.map((comp) => ({
      id: comp.id,
      name: comp.name,
      width: comp.width,
      height: comp.height,
      fps: comp.fps,
      duration: comp.duration,
      layers: comp.layers.map((l) => ({
        id: l.id,
        name: l.name,
        kind: l.kind,
        inPoint: l.inPoint,
        outPoint: l.outPoint,
        visible: l.visible,
        locked: l.locked,
        hint: layerHint(l),
      })),
    })),
  };
}
