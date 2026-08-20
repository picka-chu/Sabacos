import { z } from "zod";
import { defaultTransform, rgba } from "./factories";
import { createId } from "./ids";
import type { Composition, Easing, Layer, MediaAsset, Project } from "./types";
import { BLEND_MODES, EASING_NAMES, TRANSITION_DIRECTIONS, TRANSITION_TYPES } from "./types";

export const vec2Schema = z.object({ x: z.number(), y: z.number() });
export const rgbaSchema = z.object({
  r: z.number().min(0).max(1),
  g: z.number().min(0).max(1),
  b: z.number().min(0).max(1),
  a: z.number().min(0).max(1),
});

export const easingSchema: z.ZodType<Easing> = z.union([
  z.enum(EASING_NAMES),
  z.object({ cubicBezier: z.tuple([z.number(), z.number(), z.number(), z.number()]) }),
]);

export const keyframeSchema = <T extends z.ZodType>(value: T) =>
  z.object({ time: z.number().min(0), value, easing: easingSchema.default("easeInOut") });

export const animatableSchema = <T extends z.ZodType>(value: T) =>
  z.union([
    z.object({ type: z.literal("static"), value }),
    z.object({ type: z.literal("animated"), keyframes: z.array(keyframeSchema(value)).min(1) }),
  ]);

export const animVec2 = animatableSchema(vec2Schema);
export const animNumber = animatableSchema(z.number());

export const transformSchema = z.object({
  anchor: vec2Schema.default({ x: 0.5, y: 0.5 }),
  position: animVec2.default({ type: "static", value: { x: 0, y: 0 } }),
  scale: animVec2.default({ type: "static", value: { x: 1, y: 1 } }),
  rotation: animNumber.default({ type: "static", value: 0 }),
  opacity: animNumber.default({ type: "static", value: 1 }),
  blendMode: z.enum(BLEND_MODES).default("source-over"),
});

const effectBase = {
  id: z.string().optional(),
  enabled: z.boolean().default(true),
};

export const effectSchema = z.discriminatedUnion("type", [
  z.object({ ...effectBase, type: z.literal("blur"), amount: animNumber.default({ type: "static", value: 0 }) }),
  z.object({
    ...effectBase,
    type: z.literal("colorAdjust"),
    brightness: animNumber.default({ type: "static", value: 0 }),
    contrast: animNumber.default({ type: "static", value: 0 }),
    saturation: animNumber.default({ type: "static", value: 0 }),
    hue: animNumber.default({ type: "static", value: 0 }),
  }),
  z.object({
    ...effectBase,
    type: z.literal("chromaKey"),
    color: rgbaSchema.default({ r: 0, g: 1, b: 0, a: 1 }),
    similarity: z.number().default(0.3),
    smoothness: z.number().default(0.05),
  }),
  z.object({ ...effectBase, type: z.literal("invert") }),
  z.object({ ...effectBase, type: z.literal("sepia"), amount: animNumber.default({ type: "static", value: 1 }) }),
  z.object({ ...effectBase, type: z.literal("noise"), amount: animNumber.default({ type: "static", value: 0.2 }) }),
]);

const mediaSourceSchema = z.union([
  z.object({ type: z.literal("media"), mediaId: z.string() }),
  z.object({ type: z.literal("url"), url: z.string() }),
]);

const transitionSpecSchema = z.object({
  type: z.enum(TRANSITION_TYPES),
  duration: z.number().positive(),
  direction: z.enum(TRANSITION_DIRECTIONS).optional(),
});

export const layerTransitionSchema = z
  .object({
    in: transitionSpecSchema.optional(),
    out: transitionSpecSchema.optional(),
  })
  .optional();

const layerBase = {
  id: z.string().optional(),
  name: z.string().optional(),
  visible: z.boolean().default(true),
  locked: z.boolean().default(false),
  inPoint: z.number().min(0).default(0),
  outPoint: z.number().min(0).default(5),
  transform: transformSchema.default(() => defaultTransform()),
  effects: z.array(effectSchema).default([]),
  transition: layerTransitionSchema,
};

export const layerSchema = z.discriminatedUnion("kind", [
  z.object({
    ...layerBase,
    kind: z.literal("image"),
    source: mediaSourceSchema,
    width: z.number().default(640),
    height: z.number().default(360),
  }),
  z.object({
    ...layerBase,
    kind: z.literal("video"),
    source: mediaSourceSchema,
    width: z.number().default(640),
    height: z.number().default(360),
    volume: z.number().min(0).max(1).default(1),
  }),
  z.object({
    ...layerBase,
    kind: z.literal("text"),
    text: z.string().default("Hello"),
    fontSize: z.number().positive().default(64),
    fontFamily: z.string().default("Arial, sans-serif"),
    fontWeight: z.number().default(700),
    fill: rgbaSchema.default({ r: 1, g: 1, b: 1, a: 1 }),
    align: z.enum(["left", "center", "right"]).default("center"),
    letterSpacing: z.number().default(0),
    lineHeight: z.number().default(1.2),
    maxWidth: z.number().nullable().default(null),
  }),
  z.object({
    ...layerBase,
    kind: z.literal("shape"),
    shape: z.enum(["rect", "ellipse", "triangle", "line"]),
    width: z.number().default(200),
    height: z.number().default(200),
    fill: rgbaSchema.nullable().default({ r: 1, g: 1, b: 1, a: 1 }),
    stroke: z
      .object({ color: rgbaSchema, width: z.number().min(0).default(2) })
      .nullable()
      .default(null),
  }),
  z.object({
    ...layerBase,
    kind: z.literal("audio"),
    source: mediaSourceSchema,
    volume: z.number().min(0).max(1).default(1),
    playbackRate: z.number().default(1),
  }),
]);

export const compositionSchema = z.object({
  id: z.string().optional(),
  name: z.string().default("New Composition"),
  width: z.number().int().positive().default(1920),
  height: z.number().int().positive().default(1080),
  fps: z.number().int().positive().default(30),
  duration: z.number().positive().default(10),
  backgroundColor: rgbaSchema.default(() => rgba(0, 0, 0)),
  layers: z.array(layerSchema).default([]),
});

export const mediaSchema = z.object({
  id: z.string().optional(),
  kind: z.enum(["image", "video", "audio"]),
  name: z.string(),
  mimeType: z.string(),
  url: z.string(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  duration: z.number().positive().optional(),
});

export const projectSchema = z.object({
  id: z.string().optional(),
  name: z.string().default("Untitled Project"),
  version: z.number().int().default(1),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
  media: z.array(mediaSchema).default([]),
  compositions: z.array(compositionSchema).default([]),
});

export class ProjectValidationError extends Error {
  constructor(
    public readonly issues: { path: string; message: string }[],
    source?: string,
  ) {
    super(`Invalid project document${source ? ` (${source})` : ""}: ${issues.map((i) => i.path).join(", ")}`);
    this.name = "ProjectValidationError";
  }
}

function pathToString(path: PropertyKey[]): string {
  return path.map((p) => (typeof p === "number" ? `[${p}]` : String(p))).join(".");
}

function ensureIds(project: Project): Project {
  const assignLayerIds = (layers: Layer[]): Layer[] =>
    layers.map((l) => ({ ...l, id: l.id ?? createId(l.kind) }));
  const assignCompIds = (comps: Composition[]): Composition[] =>
    comps.map((c) => ({ ...c, id: c.id ?? createId("comp"), layers: assignLayerIds(c.layers) }));
  const assignMediaIds = (media: MediaAsset[]): MediaAsset[] =>
    media.map((m) => ({ ...m, id: m.id ?? createId("media") }));

  const compositions = assignCompIds(project.compositions);
  const clamped = compositions.map((c) => ({
    ...c,
    layers: c.layers.map((l) =>
      l.outPoint <= l.inPoint ? { ...l, outPoint: l.inPoint + 1 } : l,
    ),
  }));

  return {
    ...project,
    id: project.id ?? createId("project"),
    media: assignMediaIds(project.media),
    compositions: clamped,
  };
}

/** Validates and returns a fully-normalized Project (ids filled, defaults applied). */
export function parseProject(input: unknown): Project {
  const result = projectSchema.safeParse(input);
  if (!result.success) {
    throw new ProjectValidationError(
      result.error.issues.map((i) => ({ path: pathToString(i.path), message: i.message })),
    );
  }
  const data = result.data as unknown as Project;
  return ensureIds(data);
}

export function tryParseProject(input: unknown):
  | { success: true; data: Project }
  | { success: false; error: ProjectValidationError } {
  try {
    return { success: true, data: parseProject(input) };
  } catch (error) {
    return { success: false, error: error as ProjectValidationError };
  }
}
