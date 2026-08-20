import { createId } from "./ids";
import type {
  AudioLayer,
  Composition,
  Effect,
  ImageLayer,
  MediaAsset,
  MediaSource,
  Project,
  Rgba,
  ShapeLayer,
  TextLayer,
  Transform,
  Vec2,
  VideoLayer,
} from "./types";

export const staticValue = <T>(value: T) => ({ type: "static" as const, value });

export function defaultTransform(overrides: Partial<Transform> = {}): Transform {
  return {
    anchor: { x: 0.5, y: 0.5 },
    position: staticValue<Vec2>({ x: 0, y: 0 }),
    scale: staticValue<Vec2>({ x: 1, y: 1 }),
    rotation: staticValue(0),
    opacity: staticValue(1),
    blendMode: "source-over",
    ...overrides,
  };
}

/** Creates a normalized 0-1 RGBA color from 0-255 channel inputs. */
export function rgba(r: number, g: number, b: number, a = 255): Rgba {
  return { r: r / 255, g: g / 255, b: b / 255, a: a / 255 };
}

export type CreateLayerBase = {
  id?: string;
  name?: string;
  visible?: boolean;
  locked?: boolean;
  inPoint?: number;
  outPoint?: number;
  transform?: Partial<Transform>;
  effects?: Effect[];
};

function baseLayer(input: CreateLayerBase, kind: string, outPoint: number) {
  return {
    id: input.id ?? createId(kind),
    name: input.name ?? `${kind} ${createId("")}`,
    visible: input.visible ?? true,
    locked: input.locked ?? false,
    inPoint: input.inPoint ?? 0,
    outPoint: input.outPoint ?? outPoint,
    transform: defaultTransform(input.transform),
    effects: input.effects ?? [],
  };
}

export type CreateImageLayer = CreateLayerBase & {
  source: MediaSource;
  width: number;
  height: number;
};

export function createImageLayer(input: CreateImageLayer): ImageLayer {
  return {
    ...baseLayer(input, "image", 5),
    kind: "image",
    source: input.source,
    width: input.width,
    height: input.height,
  };
}

export type CreateVideoLayer = CreateLayerBase & {
  source: MediaSource;
  width: number;
  height: number;
  volume?: number;
};

export function createVideoLayer(input: CreateVideoLayer): VideoLayer {
  return {
    ...baseLayer(input, "video", 5),
    kind: "video",
    source: input.source,
    width: input.width,
    height: input.height,
    volume: input.volume ?? 1,
  };
}

export type CreateTextLayer = CreateLayerBase & {
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: number;
  fill?: Rgba;
  align?: TextLayer["align"];
  letterSpacing?: number;
  lineHeight?: number;
  maxWidth?: number | null;
};

export function createTextLayer(input: CreateTextLayer): TextLayer {
  return {
    ...baseLayer(input, "text", 5),
    kind: "text",
    text: input.text ?? "Hello",
    fontSize: input.fontSize ?? 64,
    fontFamily: input.fontFamily ?? "Arial, sans-serif",
    fontWeight: input.fontWeight ?? 700,
    fill: input.fill ?? rgba(255, 255, 255),
    align: input.align ?? "center",
    letterSpacing: input.letterSpacing ?? 0,
    lineHeight: input.lineHeight ?? 1.2,
    maxWidth: input.maxWidth ?? null,
  };
}

export type CreateShapeLayer = CreateLayerBase & {
  shape: ShapeLayer["shape"];
  width: number;
  height: number;
  fill?: Rgba | null;
  stroke?: { color: Rgba; width: number } | null;
};

export function createShapeLayer(input: CreateShapeLayer): ShapeLayer {
  return {
    ...baseLayer(input, "shape", 5),
    kind: "shape",
    shape: input.shape,
    width: input.width,
    height: input.height,
    fill: input.fill ?? rgba(255, 255, 255),
    stroke: input.stroke ?? null,
  };
}

export type CreateAudioLayer = CreateLayerBase & {
  source: MediaSource;
  volume?: number;
  playbackRate?: number;
};

export function createAudioLayer(input: CreateAudioLayer): AudioLayer {
  return {
    ...baseLayer(input, "audio", 5),
    kind: "audio",
    source: input.source,
    volume: input.volume ?? 1,
    playbackRate: input.playbackRate ?? 1,
  };
}

export type CreateComposition = {
  id?: string;
  name?: string;
  width?: number;
  height?: number;
  fps?: number;
  duration?: number;
  backgroundColor?: Rgba;
};

export function createComposition(input: CreateComposition): Composition {
  return {
    id: input.id ?? createId("comp"),
    name: input.name ?? "New Composition",
    width: input.width ?? 1920,
    height: input.height ?? 1080,
    fps: input.fps ?? 30,
    duration: input.duration ?? 10,
    backgroundColor: input.backgroundColor ?? rgba(0, 0, 0),
    layers: [],
  };
}

export function createProject(input: {
  id?: string;
  name?: string;
  compositions?: Composition[];
  media?: MediaAsset[];
}): Project {
  const now = new Date().toISOString();
  return {
    id: input.id ?? createId("project"),
    name: input.name ?? "Untitled Project",
    version: 1,
    createdAt: now,
    updatedAt: now,
    media: input.media ?? [],
    compositions: input.compositions ?? [],
  };
}

export function createMedia(input: {
  id?: string;
  kind: MediaAsset["kind"];
  name: string;
  mimeType: string;
  url: string;
  width?: number;
  height?: number;
  duration?: number;
}): MediaAsset {
  return {
    id: input.id ?? createId("media"),
    kind: input.kind,
    name: input.name,
    mimeType: input.mimeType,
    url: input.url,
    width: input.width,
    height: input.height,
    duration: input.duration,
  };
}
