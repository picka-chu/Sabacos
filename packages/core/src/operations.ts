import { createId } from "./ids";
import { createMedia } from "./factories";
import type {
  Animatable,
  CameraMove,
  ColorGradePreset,
  Composition,
  Easing,
  Effect,
  Keyframe,
  Layer,
  LayerTransition,
  MediaAsset,
  Project,
  Transform,
  Vec2,
} from "./types";

export const COLOR_GRADE_PRESETS_PARAMS: Record<
  ColorGradePreset,
  { brightness: number; contrast: number; saturation: number; hue: number }
> = {
  cinematic: { brightness: -0.02, contrast: 0.15, saturation: -0.1, hue: 0 },
  warm: { brightness: 0.02, contrast: 0.05, saturation: 0.15, hue: 0.02 },
  cool: { brightness: 0, contrast: 0.05, saturation: 0.1, hue: -0.03 },
  tealOrange: { brightness: 0, contrast: 0.12, saturation: 0.12, hue: 0 },
  vintage: { brightness: 0.03, contrast: -0.05, saturation: -0.2, hue: 0.01 },
  mono: { brightness: 0, contrast: 0.1, saturation: -1, hue: 0 },
  bleach: { brightness: 0.05, contrast: 0.18, saturation: -0.15, hue: 0.01 },
};

export type TransformValues = {
  position: Vec2;
  scale: Vec2;
  rotation: number;
  opacity: number;
};

export type TransformPropKey = keyof TransformValues;

export type KeyframeInput<T> = { time: number; value: T; easing: Easing };

export function getComposition(project: Project, compId: string): Composition | undefined {
  return project.compositions.find((c) => c.id === compId);
}

export function getLayer(comp: Composition, layerId: string): Layer | undefined {
  return comp.layers.find((l) => l.id === layerId);
}

export function getLayerInProject(
  project: Project,
  compId: string,
  layerId: string,
): Layer | undefined {
  const comp = getComposition(project, compId);
  return comp ? getLayer(comp, layerId) : undefined;
}

export function getMedia(project: Project, mediaId: string): MediaAsset | undefined {
  return project.media.find((m) => m.id === mediaId);
}

export function touch(project: Project): Project {
  return { ...project, updatedAt: new Date().toISOString() };
}

/** Replaces a composition by id, returning a new project. */
export function withComposition(
  project: Project,
  compId: string,
  update: (comp: Composition) => Composition,
): Project {
  return touch({
    ...project,
    compositions: project.compositions.map((c) => (c.id === compId ? update(c) : c)),
  });
}

export function withLayer(
  comp: Composition,
  layerId: string,
  update: (layer: Layer) => Layer,
): Composition {
  return { ...comp, layers: comp.layers.map((l) => (l.id === layerId ? update(l) : l)) };
}

export function addComposition(project: Project, comp: Composition): Project {
  return touch({ ...project, compositions: [...project.compositions, comp] });
}

export function removeComposition(project: Project, compId: string): Project {
  return touch({
    ...project,
    compositions: project.compositions.filter((c) => c.id !== compId),
  });
}

export function duplicateComposition(project: Project, compId: string): Project {
  const comp = getComposition(project, compId);
  if (!comp) return project;
  const copy = structuredClone(comp);
  copy.id = createId("comp");
  copy.name = `${comp.name} copy`;
  copy.layers = copy.layers.map((l) => ({ ...l, id: createId(l.kind) }));
  return touch({ ...project, compositions: [...project.compositions, copy] });
}

export function addLayer(project: Project, compId: string, layer: Layer): Project {
  return withComposition(project, compId, (comp) => ({
    ...comp,
    layers: [...comp.layers, layer],
  }));
}

export function removeLayer(project: Project, compId: string, layerId: string): Project {
  return withComposition(project, compId, (comp) => ({
    ...comp,
    layers: comp.layers.filter((l) => l.id !== layerId),
  }));
}

export function duplicateLayer(project: Project, compId: string, layerId: string): Project {
  const comp = getComposition(project, compId);
  const layer = comp && getLayer(comp, layerId);
  if (!comp || !layer) return project;
  const copy = structuredClone(layer);
  copy.id = createId(layer.kind);
  copy.name = `${layer.name} copy`;
  const index = comp.layers.findIndex((l) => l.id === layerId);
  const layers = [...comp.layers];
  layers.splice(index + 1, 0, copy);
  return withComposition(project, compId, () => ({ ...comp, layers }));
}

/** Moves a layer to an explicit index (0 = bottom of the stack). */
export function moveLayerToIndex(
  project: Project,
  compId: string,
  layerId: string,
  targetIndex: number,
): Project {
  const comp = getComposition(project, compId);
  if (!comp) return project;
  const from = comp.layers.findIndex((l) => l.id === layerId);
  if (from === -1) return project;
  const layers = [...comp.layers];
  const [layer] = layers.splice(from, 1);
  if (!layer) return project;
  const bounded = Math.max(0, Math.min(layers.length, targetIndex));
  layers.splice(bounded, 0, layer);
  return withComposition(project, compId, () => ({ ...comp, layers }));
}

export function renameLayer(project: Project, compId: string, layerId: string, name: string): Project {
  return withComposition(project, compId, (comp) =>
    withLayer(comp, layerId, (l) => ({ ...l, name })),
  );
}

export function setLayerVisible(
  project: Project,
  compId: string,
  layerId: string,
  visible: boolean,
): Project {
  return withComposition(project, compId, (comp) =>
    withLayer(comp, layerId, (l) => ({ ...l, visible })),
  );
}

export function setLayerLocked(
  project: Project,
  compId: string,
  layerId: string,
  locked: boolean,
): Project {
  return withComposition(project, compId, (comp) =>
    withLayer(comp, layerId, (l) => ({ ...l, locked })),
  );
}

export function setLayerRange(
  project: Project,
  compId: string,
  layerId: string,
  range: { inPoint?: number; outPoint?: number },
): Project {
  return withComposition(project, compId, (comp) =>
    withLayer(comp, layerId, (l) => ({ ...l, ...range })),
  );
}

export function withTransform(
  project: Project,
  compId: string,
  layerId: string,
  update: (t: Transform) => Transform,
): Project {
  return withComposition(project, compId, (comp) =>
    withLayer(comp, layerId, (l) => ({ ...l, transform: update(l.transform) })),
  );
}

export function setTransformStatic<K extends TransformPropKey>(
  project: Project,
  compId: string,
  layerId: string,
  prop: K,
  value: TransformValues[K],
): Project {
  return withTransform(project, compId, layerId, (t) => ({
    ...t,
    [prop]: { type: "static", value },
  }));
}

export function setTransformKeyframe<K extends TransformPropKey>(
  project: Project,
  compId: string,
  layerId: string,
  prop: K,
  time: number,
  value: TransformValues[K],
  easing: Easing = "easeInOut",
): Project {
  return withTransform(project, compId, layerId, (t) => {
    const current = t[prop];
    if (current.type === "static") {
      const keyframes =
        time === 0
          ? [{ time, value, easing }]
          : [
              { time: 0, value: current.value, easing: "linear" as const },
              { time, value, easing },
            ];
      return { ...t, [prop]: { type: "animated", keyframes } };
    }
    const keyframes = [...current.keyframes.filter((k) => k.time !== time), { time, value, easing }];
    keyframes.sort((a, b) => a.time - b.time);
    return { ...t, [prop]: { type: "animated", keyframes } };
  });
}

export function removeTransformKeyframe<K extends TransformPropKey>(
  project: Project,
  compId: string,
  layerId: string,
  prop: K,
  time: number,
): Project {
  return withTransform(project, compId, layerId, (t) => {
    const current = t[prop];
    if (current.type !== "animated") return t;
    const keyframes = current.keyframes.filter((k) => k.time !== time);
    if (keyframes.length === 0) {
      // Fall back to a static value if we can't infer one from a remaining keyframe.
      const fallback: TransformValues[K] =
        typeof current.keyframes[0]?.value === "number"
          ? (0 as TransformValues[K])
          : ({ x: 0, y: 0 } as TransformValues[K]);
      return { ...t, [prop]: { type: "static", value: fallback } };
    }
    if (keyframes.length === 1) {
      return { ...t, [prop]: { type: "static", value: keyframes[0]!.value } };
    }
    return { ...t, [prop]: { type: "animated", keyframes } };
  });
}

export function clearTransformKeyframes<K extends TransformPropKey>(
  project: Project,
  compId: string,
  layerId: string,
  prop: K,
): Project {
  return withTransform(project, compId, layerId, (t) => {
    const current = t[prop];
    const value =
      current.type === "animated" && current.keyframes.length > 0
        ? current.keyframes[0]!.value
        : ((current as unknown as { value: TransformValues[K] }).value ?? ({ x: 0, y: 0 } as TransformValues[K]));
    return { ...t, [prop]: { type: "static", value } };
  });
}

export function addEffect(project: Project, compId: string, layerId: string, effect: Effect): Project {
  return withComposition(project, compId, (comp) =>
    withLayer(comp, layerId, (l) => ({ ...l, effects: [...l.effects, effect] })),
  );
}

export function removeEffect(
  project: Project,
  compId: string,
  layerId: string,
  effectId: string,
): Project {
  return withComposition(project, compId, (comp) =>
    withLayer(comp, layerId, (l) => ({
      ...l,
      effects: l.effects.filter((e) => e.id !== effectId),
    })),
  );
}

/** Patches an effect. Guards against changing the effect `type` or `id`. */
export function updateEffect(
  project: Project,
  compId: string,
  layerId: string,
  effectId: string,
  patch: Record<string, unknown>,
): Project {
  return withComposition(project, compId, (comp) =>
    withLayer(comp, layerId, (l) => ({
      ...l,
      effects: l.effects.map((e) => {
        if (e.id !== effectId) return e;
        const { type: _type, id: _id, ...safe } = patch;
        return { ...e, ...safe } as Effect;
      }),
    })),
  );
}

export function setEffectEnabled(
  project: Project,
  compId: string,
  layerId: string,
  effectId: string,
  enabled: boolean,
): Project {
  return updateEffect(project, compId, layerId, effectId, { enabled });
}

export function setTextContent(project: Project, compId: string, layerId: string, text: string): Project {
  return withComposition(project, compId, (comp) =>
    withLayer(comp, layerId, (l) => {
      if (l.kind !== "text") return l;
      return { ...l, text };
    }),
  );
}

export function setTextStyle(
  project: Project,
  compId: string,
  layerId: string,
  patch: Partial<
    Pick<
      Extract<Layer, { kind: "text" }>,
      "fontSize" | "fontFamily" | "fontWeight" | "fill" | "align" | "letterSpacing" | "lineHeight" | "maxWidth"
    >
  >,
): Project {
  return withComposition(project, compId, (comp) =>
    withLayer(comp, layerId, (l) => {
      if (l.kind !== "text") return l;
      return { ...l, ...patch };
    }),
  );
}

export function setShapeStyle(
  project: Project,
  compId: string,
  layerId: string,
  patch: Partial<Pick<Extract<Layer, { kind: "shape" }>, "shape" | "fill" | "stroke" | "width" | "height">>,
): Project {
  return withComposition(project, compId, (comp) =>
    withLayer(comp, layerId, (l) => {
      if (l.kind !== "shape") return l;
      return { ...l, ...patch };
    }),
  );
}

export function setVideoStyle(
  project: Project,
  compId: string,
  layerId: string,
  patch: Partial<Pick<Extract<Layer, { kind: "video" }>, "volume">>,
): Project {
  return withComposition(project, compId, (comp) =>
    withLayer(comp, layerId, (l) => {
      if (l.kind !== "video") return l;
      return { ...l, ...patch };
    }),
  );
}

export function setAudioStyle(
  project: Project,
  compId: string,
  layerId: string,
  patch: Partial<Pick<Extract<Layer, { kind: "audio" }>, "volume" | "playbackRate">>,
): Project {
  return withComposition(project, compId, (comp) =>
    withLayer(comp, layerId, (l) => {
      if (l.kind !== "audio") return l;
      return { ...l, ...patch };
    }),
  );
}

export function setCompositionSettings(
  project: Project,
  compId: string,
  patch: Partial<
    Pick<Composition, "name" | "width" | "height" | "fps" | "duration" | "backgroundColor">
  >,
): Project {
  return withComposition(project, compId, (comp) => ({ ...comp, ...patch }));
}

export function setProjectName(project: Project, name: string): Project {
  return touch({ ...project, name });
}

/** Sets the transition (in/out) for a layer. Pass null/empty to clear. */
export function setLayerTransition(
  project: Project,
  compId: string,
  layerId: string,
  transition?: LayerTransition | null,
): Project {
  return withComposition(project, compId, (comp) =>
    withLayer(comp, layerId, (l) => ({ ...l, transition: transition ?? undefined })),
  );
}

function setPropKeyframes<K extends keyof TransformValues>(
  t: Transform,
  prop: K,
  items: { time: number; value: TransformValues[K]; easing?: Easing }[],
): Transform {
  const current = t[prop] as Animatable<TransformValues[K]>;
  const normalized: Keyframe<TransformValues[K]>[] = items.map((it) => ({
    time: it.time,
    value: it.value,
    easing: it.easing ?? "easeInOut",
  }));
  const keyframes =
    current.type === "animated"
      ? [...current.keyframes, ...normalized]
      : [{ time: normalized[0]!.time, value: current.value, easing: "linear" as const }, ...normalized];
  const byTime = new Map<number, Keyframe<TransformValues[K]>>();
  for (const k of keyframes) byTime.set(k.time, k);
  const sorted = [...byTime.values()].sort((a, b) => a.time - b.time);
  return { ...t, [prop]: { type: "animated", keyframes: sorted } };
}

function propBase<K extends keyof TransformValues>(
  t: Transform,
  prop: K,
  fallback: TransformValues[K],
): TransformValues[K] {
  const current = t[prop] as Animatable<TransformValues[K]>;
  if (current.type === "animated" && current.keyframes.length > 0) return current.keyframes[0]!.value as TransformValues[K];
  if (current.type === "static") return current.value as TransformValues[K];
  return fallback;
}

/**
 * Applies a camera move to a layer (or every layer when layerId is omitted) by
 * seeding position/scale keyframes over `duration` seconds.
 */
export function applyCameraMove(
  project: Project,
  compId: string,
  opts: { move: CameraMove; duration: number; amount?: number; layerId?: string },
): Project {
  const comp = getComposition(project, compId);
  if (!comp) return project;
  const amount = Math.max(0, opts.amount ?? 0.3);
  const targetLayers = opts.layerId
    ? comp.layers.filter((l) => l.id === opts.layerId)
    : [...comp.layers];
  if (targetLayers.length === 0) return project;

  let result = project;
  targetLayers.forEach((layer, index) => {
    const t0 = opts.layerId ? Math.max(layer.inPoint, 0) : 0;
    const t1 = t0 + Math.max(opts.duration, 0.1);
    const { width: cw, height: ch } = comp;
    result = withTransform(result, compId, layer.id, (t) => {
      const move = opts.move;
      const ease = "easeInOut" as const;
      const posBase = propBase(t, "position", { x: 0, y: 0 });
      const scaleBase = propBase(t, "scale", { x: 1, y: 1 });
      const next: Transform = { ...t };

      if (move === "panLeft" || move === "panRight" || move === "tiltUp" || move === "tiltDown") {
        const dx = move === "panLeft" ? -amount * cw : move === "panRight" ? amount * cw : 0;
        const dy = move === "tiltUp" ? -amount * ch : move === "tiltDown" ? amount * ch : 0;
        next.position = setPropKeyframes(next, "position", [
          { time: t0, value: posBase, easing: ease },
          { time: t1, value: { x: posBase.x + dx, y: posBase.y + dy }, easing: ease },
        ]).position;
      } else if (move === "zoomIn" || move === "zoomOut") {
        const factor = move === "zoomIn" ? 1 + amount : Math.max(0.1, 1 - amount);
        next.scale = setPropKeyframes(next, "scale", [
          { time: t0, value: scaleBase, easing: ease },
          { time: t1, value: { x: scaleBase.x * factor, y: scaleBase.y * factor }, easing: ease },
        ]).scale;
      } else if (move === "parallax") {
        const ratio = opts.layerId ? 0.5 : (index + 1) / targetLayers.length;
        const dx = -amount * cw * ratio;
        next.position = setPropKeyframes(next, "position", [
          { time: t0, value: posBase, easing: ease },
          { time: t1, value: { x: posBase.x + dx, y: posBase.y }, easing: ease },
        ]).position;
      } else if (move === "shake") {
        const a = amount * cw * 0.05;
        const d = (t1 - t0) / 3;
        next.position = setPropKeyframes(next, "position", [
          { time: t0, value: posBase, easing: "linear" as const },
          { time: t0 + d, value: { x: posBase.x + a, y: posBase.y }, easing: "linear" as const },
          { time: t0 + 2 * d, value: { x: posBase.x - a, y: posBase.y - a }, easing: "linear" as const },
          { time: t1, value: { x: posBase.x + a, y: posBase.y + a }, easing: "linear" as const },
        ]).position;
      }
      return next;
    });
  });
  return result;
}

/**
 * Adds or updates a colorAdjust effect with a preset grade (0..1 intensity
 * blends toward neutral). Applies to every layer when layerId is omitted.
 */
export function applyColorGrade(
  project: Project,
  compId: string,
  opts: { preset: ColorGradePreset; intensity?: number; layerId?: string },
): Project {
  const comp = getComposition(project, compId);
  if (!comp) return project;
  const intensity = Math.max(0, Math.min(1, opts.intensity ?? 1));
  const p = COLOR_GRADE_PRESETS_PARAMS[opts.preset];
  const targets = opts.layerId ? comp.layers.filter((l) => l.id === opts.layerId) : comp.layers;
  if (targets.length === 0) return project;

  let result = project;
  for (const layer of targets) {
    result = withComposition(result, compId, (comp) =>
      withLayer(comp, layer.id, (l) => {
        const patch = {
          brightness: { type: "static" as const, value: p.brightness * intensity },
          contrast: { type: "static" as const, value: p.contrast * intensity },
          saturation: { type: "static" as const, value: p.saturation * intensity },
          hue: { type: "static" as const, value: p.hue * intensity },
        };
        const existing = l.effects.find((e) => e.type === "colorAdjust");
        if (existing) {
          return {
            ...l,
            effects: l.effects.map((e) => (e.id === existing.id ? { ...e, ...patch } : e)),
          };
        }
        return {
          ...l,
          effects: [...l.effects, { id: createId("eff"), type: "colorAdjust", enabled: true, ...patch }],
        };
      }),
    );
  }
  return result;
}

export function addMedia(
  project: Project,
  media: Omit<MediaAsset, "id"> & { id?: string },
): Project {
  const asset = createMedia(media);
  return touch({ ...project, media: [...project.media, asset] });
}

export function removeMedia(project: Project, mediaId: string): Project {
  return touch({ ...project, media: project.media.filter((m) => m.id !== mediaId) });
}
