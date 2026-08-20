import { z } from "zod";
import {
  addComposition,
  addEffect,
  addLayer,
  addMedia,
  applyCameraMove,
  applyColorGrade,
  clearTransformKeyframes,
  createId,
  duplicateComposition,
  duplicateLayer,
  easingSchema,
  effectSchema,
  layerSchema,
  moveLayerToIndex,
  parseProject,
  removeComposition,
  removeEffect,
  removeLayer,
  removeMedia,
  removeTransformKeyframe,
  renameLayer,
  setAudioStyle,
  setCompositionSettings,
  setEffectEnabled,
  setLayerLocked,
  setLayerRange,
  setLayerTransition,
  setLayerVisible,
  setProjectName,
  setShapeStyle,
  setTextContent,
  setTextStyle,
  setTransformKeyframe,
  setTransformStatic,
  setVideoStyle,
  updateEffect,
  compositionSchema,
  mediaSchema,
  rgbaSchema,
  vec2Schema,
  getComposition,
  getLayer,
  CAMERA_MOVES,
  COLOR_GRADE_PRESETS,
  TRANSITION_DIRECTIONS,
  TRANSITION_TYPES,
  type Composition,
  type Layer,
  type Project,
  type TransformPropKey,
  type TransformValues,
} from "@motion/core";

export type Operation = { op: string; args: Record<string, unknown> };

export class OpExecutionError extends Error {
  constructor(
    message: string,
    public readonly opName?: string,
    public readonly opIndex?: number,
  ) {
    super(message);
    this.name = "OpExecutionError";
  }
}

function zodIssues(error: z.ZodError): string {
  return error.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}

function requireComp(project: Project, compId: string): Composition {
  const comp = getComposition(project, compId);
  if (!comp) throw new OpExecutionError(`Composition "${compId}" not found`);
  return comp;
}

function requireLayer(project: Project, compId: string, layerId: string): Layer {
  const comp = requireComp(project, compId);
  const layer = getLayer(comp, layerId);
  if (!layer) throw new OpExecutionError(`Layer "${layerId}" not found in composition "${compId}"`);
  return layer;
}

const TRANSFORM_PROPS = ["position", "scale", "rotation", "opacity"] as const;
const propSchema = z.enum(TRANSFORM_PROPS);

const valueSchemaByProp: Record<TransformPropKey, z.ZodType> = {
  position: vec2Schema,
  scale: vec2Schema,
  rotation: z.number(),
  opacity: z.number(),
};

type ApplyResult = { project: Project; refs: Record<string, string> };

// args are validated by `schema` at runtime; typed as `any` here to keep the
// registry ergonomic (zod owns the real input types).
type OpDef = {
  doc: string;
  schema: z.ZodType;
  apply: (project: Project, args: any) => ApplyResult;
};

function idsAfter<T>(before: Set<string>, current: Iterable<{ id: string }>): string[] {
  const diff: string[] = [];
  for (const item of current) if (!before.has(item.id)) diff.push(item.id);
  return diff;
}

const registry: Record<string, OpDef> = {
  setProjectName: {
    doc: "Rename the project.",
    schema: z.object({ name: z.string().min(1) }),
    apply: (project, { name }) => ({ project: setProjectName(project, name), refs: {} }),
  },
  addComposition: {
    doc: "Create a new (empty) composition from a partial spec.",
    schema: z.object({ composition: compositionSchema }),
    apply: (project, { composition }) => {
      const comp = { ...composition, id: composition.id ?? createId("comp") };
      return { project: addComposition(project, comp), refs: { compId: comp.id } };
    },
  },
  removeComposition: {
    doc: "Delete a composition by id.",
    schema: z.object({ compId: z.string().min(1) }),
    apply: (project, { compId }) => {
      requireComp(project, compId);
      return { project: removeComposition(project, compId), refs: {} };
    },
  },
  duplicateComposition: {
    doc: "Clone a composition (with new layer ids) and append it.",
    schema: z.object({ compId: z.string().min(1) }),
    apply: (project, { compId }) => {
      requireComp(project, compId);
      const before = new Set(project.compositions.map((c) => c.id));
      const next = duplicateComposition(project, compId);
      const refs: Record<string, string> = {};
      const [compIdNew] = idsAfter(before, next.compositions);
      if (compIdNew) refs.compId = compIdNew;
      return { project: next, refs };
    },
  },
  setCompositionSettings: {
    doc: "Patch composition name, dimensions, fps, duration or background color.",
    schema: z.object({
      compId: z.string().min(1),
      patch: z.object({
        name: z.string().optional(),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
        fps: z.number().int().positive().optional(),
        duration: z.number().positive().optional(),
        backgroundColor: rgbaSchema.optional(),
      }),
    }),
    apply: (project, { compId, patch }) => {
      requireComp(project, compId);
      return { project: setCompositionSettings(project, compId, patch), refs: {} };
    },
  },
  addLayer: {
    doc: "Add a layer (text/shape/image/video/audio) to a composition from a spec.",
    schema: z.object({ compId: z.string().min(1), layer: layerSchema }),
    apply: (project, { compId, layer }) => {
      requireComp(project, compId);
      const filled = { ...layer, id: layer.id ?? createId(layer.kind) };
      return { project: addLayer(project, compId, filled), refs: { layerId: filled.id } };
    },
  },
  removeLayer: {
    doc: "Delete a layer from a composition.",
    schema: z.object({ compId: z.string().min(1), layerId: z.string().min(1) }),
    apply: (project, { compId, layerId }) => {
      requireLayer(project, compId, layerId);
      return { project: removeLayer(project, compId, layerId), refs: {} };
    },
  },
  duplicateLayer: {
    doc: "Clone a layer directly above the original.",
    schema: z.object({ compId: z.string().min(1), layerId: z.string().min(1) }),
    apply: (project, { compId, layerId }) => {
      const comp = requireComp(project, compId);
      requireLayer(project, compId, layerId);
      const before = new Set(comp.layers.map((l) => l.id));
      const next = duplicateLayer(project, compId, layerId);
      const after = next.compositions.find((c) => c.id === compId);
      const refs: Record<string, string> = {};
      const [layerIdNew] = idsAfter(before, after?.layers ?? []);
      if (layerIdNew) refs.layerId = layerIdNew;
      return { project: next, refs };
    },
  },
  moveLayerToIndex: {
    doc: "Reorder a layer; index 0 is the bottom of the stack.",
    schema: z.object({ compId: z.string().min(1), layerId: z.string().min(1), index: z.number().int() }),
    apply: (project, { compId, layerId, index }) => {
      requireLayer(project, compId, layerId);
      return { project: moveLayerToIndex(project, compId, layerId, index), refs: {} };
    },
  },
  renameLayer: {
    doc: "Rename a layer.",
    schema: z.object({ compId: z.string().min(1), layerId: z.string().min(1), name: z.string().min(1) }),
    apply: (project, { compId, layerId, name }) => {
      requireLayer(project, compId, layerId);
      return { project: renameLayer(project, compId, layerId, name), refs: {} };
    },
  },
  setLayerVisible: {
    doc: "Show or hide a layer.",
    schema: z.object({ compId: z.string().min(1), layerId: z.string().min(1), visible: z.boolean() }),
    apply: (project, { compId, layerId, visible }) => {
      requireLayer(project, compId, layerId);
      return { project: setLayerVisible(project, compId, layerId, visible), refs: {} };
    },
  },
  setLayerLocked: {
    doc: "Lock or unlock a layer.",
    schema: z.object({ compId: z.string().min(1), layerId: z.string().min(1), locked: z.boolean() }),
    apply: (project, { compId, layerId, locked }) => {
      requireLayer(project, compId, layerId);
      return { project: setLayerLocked(project, compId, layerId, locked), refs: {} };
    },
  },
  setLayerRange: {
    doc: "Trim a layer's in/out points (seconds).",
    schema: z.object({
      compId: z.string().min(1),
      layerId: z.string().min(1),
      inPoint: z.number().min(0).optional(),
      outPoint: z.number().min(0).optional(),
    }),
    apply: (project, { compId, layerId, ...range }) => {
      requireLayer(project, compId, layerId);
      return { project: setLayerRange(project, compId, layerId, range), refs: {} };
    },
  },
  setLayerTransition: {
    doc: "Set how a layer enters/exits the timeline: in/out transition specs of type crossfade|fade|wipe|slide|dissolve with a duration (seconds) and a direction (left|right|up|down) for slide/wipe. Pass in/out as null/omit to clear.",
    schema: z.object({
      compId: z.string().min(1),
      layerId: z.string().min(1),
      transition: z
        .object({
          in: z
            .object({
              type: z.enum(TRANSITION_TYPES),
              duration: z.number().positive(),
              direction: z.enum(TRANSITION_DIRECTIONS).optional(),
            })
            .optional(),
          out: z
            .object({
              type: z.enum(TRANSITION_TYPES),
              duration: z.number().positive(),
              direction: z.enum(TRANSITION_DIRECTIONS).optional(),
            })
            .optional(),
        })
        .nullable()
        .optional(),
    }),
    apply: (project, { compId, layerId, transition }) => {
      requireLayer(project, compId, layerId);
      return { project: setLayerTransition(project, compId, layerId, transition), refs: {} };
    },
  },
  applyCameraMove: {
    doc: "Seed a camera move on a layer (or all layers when layerId is omitted): panLeft|panRight|tiltUp|tiltDown|zoomIn|zoomOut|parallax|shake over a duration (seconds) with a 0..1 amount (default 0.3). Adds position/scale keyframes.",
    schema: z.object({
      compId: z.string().min(1),
      move: z.enum(CAMERA_MOVES),
      duration: z.number().positive(),
      amount: z.number().min(0).max(2).optional(),
      layerId: z.string().min(1).optional(),
    }),
    apply: (project, { compId, move, duration, amount, layerId }) => {
      requireComp(project, compId);
      return { project: applyCameraMove(project, compId, { move, duration, amount, layerId }), refs: {} };
    },
  },
  applyColorGrade: {
    doc: "Add/update a colorAdjust grade preset (cinematic|warm|cool|tealOrange|vintage|mono|bleach) with a 0..1 intensity (default 1) on a layer, or every layer when layerId is omitted.",
    schema: z.object({
      compId: z.string().min(1),
      preset: z.enum(COLOR_GRADE_PRESETS),
      intensity: z.number().min(0).max(1).optional(),
      layerId: z.string().min(1).optional(),
    }),
    apply: (project, { compId, preset, intensity, layerId }) => {
      requireComp(project, compId);
      return { project: applyColorGrade(project, compId, { preset, intensity, layerId }), refs: {} };
    },
  },
  setTransformStatic: {
    doc: "Set a transform property to a fixed value (removes its keyframes).",
    schema: z.object({
      compId: z.string().min(1),
      layerId: z.string().min(1),
      prop: propSchema,
      value: z.union([z.number(), vec2Schema]),
    }),
    apply: (project, { compId, layerId, prop, value }) => {
      requireLayer(project, compId, layerId);
      const propKey = prop as TransformPropKey;
      const parsed = valueSchemaByProp[propKey].parse(value);
      return {
        project: setTransformStatic(project, compId, layerId, propKey, parsed as never),
        refs: {},
      };
    },
  },
  setTransformKeyframe: {
    doc: "Add/replace a keyframe for a transform property at a time (seconds).",
    schema: z.object({
      compId: z.string().min(1),
      layerId: z.string().min(1),
      prop: propSchema,
      time: z.number().min(0),
      value: z.union([z.number(), vec2Schema]),
      easing: easingSchema.optional(),
    }),
    apply: (project, { compId, layerId, prop, time, value, easing }) => {
      requireLayer(project, compId, layerId);
      const propKey = prop as TransformPropKey;
      const parsed = valueSchemaByProp[propKey].parse(value);
      return {
        project: setTransformKeyframe(
          project,
          compId,
          layerId,
          propKey,
          time,
          parsed as never,
          easing,
        ),
        refs: {},
      };
    },
  },
  removeTransformKeyframe: {
    doc: "Remove a keyframe at a time for a transform property.",
    schema: z.object({
      compId: z.string().min(1),
      layerId: z.string().min(1),
      prop: propSchema,
      time: z.number().min(0),
    }),
    apply: (project, { compId, layerId, prop, time }) => {
      requireLayer(project, compId, layerId);
      return { project: removeTransformKeyframe(project, compId, layerId, prop, time), refs: {} };
    },
  },
  clearTransformKeyframes: {
    doc: "Flatten a transform property to a static value (keeps its first keyframe value).",
    schema: z.object({
      compId: z.string().min(1),
      layerId: z.string().min(1),
      prop: propSchema,
    }),
    apply: (project, { compId, layerId, prop }) => {
      requireLayer(project, compId, layerId);
      return { project: clearTransformKeyframes(project, compId, layerId, prop), refs: {} };
    },
  },
  addEffect: {
    doc: "Add an effect (blur/colorAdjust/chromaKey/invert/sepia/noise) to a layer.",
    schema: z.object({ compId: z.string().min(1), layerId: z.string().min(1), effect: effectSchema }),
    apply: (project, { compId, layerId, effect }) => {
      requireLayer(project, compId, layerId);
      const filled = { ...effect, id: effect.id ?? createId("effect") };
      return { project: addEffect(project, compId, layerId, filled), refs: { effectId: filled.id } };
    },
  },
  removeEffect: {
    doc: "Remove an effect from a layer.",
    schema: z.object({
      compId: z.string().min(1),
      layerId: z.string().min(1),
      effectId: z.string().min(1),
    }),
    apply: (project, { compId, layerId, effectId }) => {
      const layer = requireLayer(project, compId, layerId);
      if (!layer.effects.some((e) => e.id === effectId)) {
        throw new OpExecutionError(`Effect "${effectId}" not found on layer "${layerId}"`);
      }
      return { project: removeEffect(project, compId, layerId, effectId), refs: {} };
    },
  },
  updateEffect: {
    doc: "Patch properties of an effect (type and id are immutable).",
    schema: z.object({
      compId: z.string().min(1),
      layerId: z.string().min(1),
      effectId: z.string().min(1),
      patch: z.record(z.string(), z.unknown()),
    }),
    apply: (project, { compId, layerId, effectId, patch }) => {
      const layer = requireLayer(project, compId, layerId);
      if (!layer.effects.some((e) => e.id === effectId)) {
        throw new OpExecutionError(`Effect "${effectId}" not found on layer "${layerId}"`);
      }
      return { project: updateEffect(project, compId, layerId, effectId, patch), refs: {} };
    },
  },
  setEffectEnabled: {
    doc: "Enable or disable an effect.",
    schema: z.object({
      compId: z.string().min(1),
      layerId: z.string().min(1),
      effectId: z.string().min(1),
      enabled: z.boolean(),
    }),
    apply: (project, { compId, layerId, effectId, enabled }) => {
      const layer = requireLayer(project, compId, layerId);
      if (!layer.effects.some((e) => e.id === effectId)) {
        throw new OpExecutionError(`Effect "${effectId}" not found on layer "${layerId}"`);
      }
      return { project: setEffectEnabled(project, compId, layerId, effectId, enabled), refs: {} };
    },
  },
  setTextContent: {
    doc: "Set the text of a text layer.",
    schema: z.object({ compId: z.string().min(1), layerId: z.string().min(1), text: z.string() }),
    apply: (project, { compId, layerId, text }) => {
      requireLayer(project, compId, layerId);
      return { project: setTextContent(project, compId, layerId, text), refs: {} };
    },
  },
  setTextStyle: {
    doc: "Patch text layer style (fontSize, fontFamily, fontWeight, fill, align, letterSpacing, lineHeight, maxWidth).",
    schema: z.object({
      compId: z.string().min(1),
      layerId: z.string().min(1),
      patch: z.object({
        fontSize: z.number().positive().optional(),
        fontFamily: z.string().optional(),
        fontWeight: z.number().optional(),
        fill: rgbaSchema.optional(),
        align: z.enum(["left", "center", "right"]).optional(),
        letterSpacing: z.number().optional(),
        lineHeight: z.number().optional(),
        maxWidth: z.number().nullable().optional(),
      }),
    }),
    apply: (project, { compId, layerId, patch }) => {
      requireLayer(project, compId, layerId);
      return { project: setTextStyle(project, compId, layerId, patch), refs: {} };
    },
  },
  setShapeStyle: {
    doc: "Patch shape layer style (shape, fill, stroke, width, height).",
    schema: z.object({
      compId: z.string().min(1),
      layerId: z.string().min(1),
      patch: z.object({
        shape: z.enum(["rect", "ellipse", "triangle", "line"]).optional(),
        fill: rgbaSchema.nullable().optional(),
        stroke: z
          .object({ color: rgbaSchema, width: z.number().min(0) })
          .nullable()
          .optional(),
        width: z.number().optional(),
        height: z.number().optional(),
      }),
    }),
    apply: (project, { compId, layerId, patch }) => {
      requireLayer(project, compId, layerId);
      return { project: setShapeStyle(project, compId, layerId, patch), refs: {} };
    },
  },
  setVideoStyle: {
    doc: "Patch video layer style (volume).",
    schema: z.object({
      compId: z.string().min(1),
      layerId: z.string().min(1),
      patch: z.object({ volume: z.number().min(0).max(1).optional() }),
    }),
    apply: (project, { compId, layerId, patch }) => {
      requireLayer(project, compId, layerId);
      return { project: setVideoStyle(project, compId, layerId, patch), refs: {} };
    },
  },
  setAudioStyle: {
    doc: "Patch audio layer style (volume, playbackRate).",
    schema: z.object({
      compId: z.string().min(1),
      layerId: z.string().min(1),
      patch: z.object({
        volume: z.number().min(0).max(1).optional(),
        playbackRate: z.number().optional(),
      }),
    }),
    apply: (project, { compId, layerId, patch }) => {
      requireLayer(project, compId, layerId);
      return { project: setAudioStyle(project, compId, layerId, patch), refs: {} };
    },
  },
  addMedia: {
    doc: "Register a media asset (image/video/audio) so layers can reference it.",
    schema: z.object({ media: mediaSchema }),
    apply: (project, { media }) => {
      const filled = { ...media, id: media.id ?? createId("media") };
      return { project: addMedia(project, filled), refs: { mediaId: filled.id } };
    },
  },
  removeMedia: {
    doc: "Remove a media asset by id.",
    schema: z.object({ mediaId: z.string().min(1) }),
    apply: (project, { mediaId }) => {
      if (!project.media.some((m) => m.id === mediaId)) {
        throw new OpExecutionError(`Media "${mediaId}" not found`);
      }
      return { project: removeMedia(project, mediaId), refs: {} };
    },
  },
} as const satisfies Record<string, OpDef>;

function assertUniqueIds(project: Project): void {
  const seen = new Set<string>();
  const all: { id: string; where: string }[] = [
    ...project.media.map((m) => ({ id: m.id, where: "media" })),
    ...project.compositions.flatMap((c) => [
      { id: c.id, where: `composition "${c.name}"` },
      ...c.layers.flatMap((l) => [
        { id: l.id, where: `layer "${l.name}"` },
        ...l.effects.map((e) => ({ id: e.id, where: `effect on "${l.name}"` })),
      ]),
    ]),
  ];
  for (const item of all) {
    if (seen.has(item.id)) throw new OpExecutionError(`Duplicate id "${item.id}" (${item.where})`);
    seen.add(item.id);
  }
}

/**
 * Executes a batch of declarative operations atomically against a base
 * project, returning the resulting (validated) document plus any ids that
 * were created. Throws OpExecutionError on the first failure; the input
 * project is never mutated.
 */
export function executeOperations(
  base: Project,
  operations: Operation[],
): { project: Project; refs: Record<string, string> } {
  let project = base;
  const refs: Record<string, string> = {};
  operations.forEach((op, i) => {
    const def = registry[op.op];
    if (!def) throw new OpExecutionError(`Unknown operation "${op.op}"`, op.op, i);
    const parsed = def.schema.safeParse(op.args);
    if (!parsed.success) throw new OpExecutionError(zodIssues(parsed.error), op.op, i);
    const result = def.apply(project, parsed.data);
    project = result.project;
    Object.assign(refs, result.refs);
  });

  try {
    project = parseProject(project);
  } catch (error) {
    throw new OpExecutionError(`Resulting document is invalid: ${(error as Error).message}`);
  }
  assertUniqueIds(project);
  return { project, refs };
}

export function opNames(): string[] {
  return Object.keys(registry);
}

export function opDoc(op: string): string | undefined {
  return registry[op]?.doc;
}

export function opTools(): { name: string; doc: string; schema: z.ZodType }[] {
  return Object.entries(registry).map(([name, def]) => ({ name, doc: def.doc, schema: def.schema }));
}
