export type Vec2 = { x: number; y: number };
export type Rgba = { r: number; g: number; b: number; a: number };

export const EASING_NAMES = [
  "linear",
  "easeIn",
  "easeOut",
  "easeInOut",
  "easeInBack",
  "easeOutBack",
  "easeInOutBack",
  "easeInBounce",
  "easeOutBounce",
  "easeInOutBounce",
] as const;

export type EasingName = (typeof EASING_NAMES)[number];

export const TRANSITION_TYPES = ["crossfade", "fade", "wipe", "slide", "dissolve"] as const;
export type TransitionType = (typeof TRANSITION_TYPES)[number];

export const TRANSITION_DIRECTIONS = ["left", "right", "up", "down"] as const;
export type TransitionDirection = (typeof TRANSITION_DIRECTIONS)[number];

export const CAMERA_MOVES = [
  "panLeft",
  "panRight",
  "tiltUp",
  "tiltDown",
  "zoomIn",
  "zoomOut",
  "parallax",
  "shake",
] as const;
export type CameraMove = (typeof CAMERA_MOVES)[number];

export const COLOR_GRADE_PRESETS = [
  "cinematic",
  "warm",
  "cool",
  "tealOrange",
  "vintage",
  "mono",
  "bleach",
] as const;
export type ColorGradePreset = (typeof COLOR_GRADE_PRESETS)[number];

export type CubicBezier = [number, number, number, number];

export type Easing = EasingName | { cubicBezier: CubicBezier };

export type Keyframe<T> = {
  /** Seconds from composition start. */
  time: number;
  value: T;
  easing: Easing;
};

export type Animatable<T> =
  | { type: "static"; value: T }
  | { type: "animated"; keyframes: Keyframe<T>[] };

export const BLEND_MODES = [
  "source-over",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "difference",
  "addition",
] as const;

export type BlendMode = (typeof BLEND_MODES)[number];

export type Transform = {
  /** Anchor as fraction (0..1) of the layer's bounds, default (0.5, 0.5). */
  anchor: Vec2;
  position: Animatable<Vec2>;
  scale: Animatable<Vec2>;
  /** Degrees. */
  rotation: Animatable<number>;
  /** 0..1 */
  opacity: Animatable<number>;
  blendMode: BlendMode;
};

export type EffectBase = {
  id: string;
  enabled: boolean;
};

export type Effect =
  | (EffectBase & { type: "blur"; amount: Animatable<number> })
  | (EffectBase & {
      type: "colorAdjust";
      brightness: Animatable<number>;
      contrast: Animatable<number>;
      saturation: Animatable<number>;
      hue: Animatable<number>;
    })
  | (EffectBase & {
      type: "chromaKey";
      color: Rgba;
      similarity: number;
      smoothness: number;
    })
  | (EffectBase & { type: "invert" })
  | (EffectBase & { type: "sepia"; amount: Animatable<number> })
  | (EffectBase & { type: "noise"; amount: Animatable<number> });

export type LayerKind = "image" | "video" | "text" | "shape" | "audio";

export type MediaSource = { type: "media"; mediaId: string } | { type: "url"; url: string };

/** How a layer enters/exits the timeline (transition at its in/out point). */
export type TransitionSpec = {
  type: TransitionType;
  /** Seconds over which the transition plays. */
  duration: number;
  /** Slide/wipe travel direction; ignored for crossfade/fade/dissolve. */
  direction?: TransitionDirection;
};

export type LayerTransition = {
  in?: TransitionSpec;
  out?: TransitionSpec;
};

export type LayerBase = {
  id: string;
  name: string;
  kind: LayerKind;
  visible: boolean;
  locked: boolean;
  /** Seconds into the composition when the layer becomes active. */
  inPoint: number;
  /** Seconds into the composition when the layer stops. */
  outPoint: number;
  transform: Transform;
  effects: Effect[];
  transition?: LayerTransition;
};

export type ImageLayer = LayerBase & {
  kind: "image";
  source: MediaSource;
  width: number;
  height: number;
};

export type VideoLayer = LayerBase & {
  kind: "video";
  source: MediaSource;
  width: number;
  height: number;
  volume: number;
};

export type TextLayer = LayerBase & {
  kind: "text";
  text: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: number;
  fill: Rgba;
  align: "left" | "center" | "right";
  letterSpacing: number;
  lineHeight: number;
  /** If set, text wraps at this width (px). */
  maxWidth: number | null;
};

export type ShapeLayer = LayerBase & {
  kind: "shape";
  shape: "rect" | "ellipse" | "triangle" | "line";
  width: number;
  height: number;
  fill: Rgba | null;
  stroke: { color: Rgba; width: number } | null;
};

export type AudioLayer = LayerBase & {
  kind: "audio";
  source: MediaSource;
  volume: number;
  playbackRate: number;
};

export type Layer = ImageLayer | VideoLayer | TextLayer | ShapeLayer | AudioLayer;

export type MediaAsset = {
  id: string;
  kind: "image" | "video" | "audio";
  name: string;
  mimeType: string;
  url: string;
  width?: number;
  height?: number;
  duration?: number;
};

export type Composition = {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  /** Seconds. */
  duration: number;
  backgroundColor: Rgba;
  layers: Layer[];
};

export type Project = {
  id: string;
  name: string;
  /** Document schema version (bump on breaking changes). */
  version: number;
  createdAt: string;
  updatedAt: string;
  media: MediaAsset[];
  compositions: Composition[];
};

export type TextAlign = TextLayer["align"];
export type ShapeKind = ShapeLayer["shape"];
