import {
  Application,
  Container,
  Graphics,
  Sprite,
  Text,
  Texture,
  type TextStyleOptions,
} from "pixi.js";
import {
  evaluateLayerTransform,
  layerActiveAt,
  type Composition,
  type Layer,
  type ShapeLayer,
  type TextLayer,
} from "@motion/core";
import { blendModeToPixi, rgbaToHex } from "./blend";
import { createEffectHandles, type EffectHandle } from "./effects";
import type { MediaResolver, ResolvedMedia } from "./MediaCache";

export type RendererOptions = {
  /** Canvas to render into; if omitted a new canvas is appended to the mount. */
  canvas?: HTMLCanvasElement;
  antialias?: boolean;
  /** Rendering resolution; 1 = CSS pixel == canvas pixel. */
  resolution?: number;
  /** Color behind the letterboxed composition. */
  background?: string;
};

type LayerHandle = {
  id: string;
  kind: Layer["kind"];
  sourceKey: string | null;
  wrapper: Container;
  inner: Sprite | Text | Graphics;
  effects: EffectHandle[];
  media: ResolvedMedia | null;
  video: { video: HTMLVideoElement; lastTime: number } | null;
  textSig: string | null;
  shapeSig: string | null;
};

function sourceKeyOf(layer: Layer): string | null {
  if (layer.kind !== "image" && layer.kind !== "video") return null;
  return JSON.stringify(layer.source);
}

function textSignature(layer: TextLayer): string {
  return JSON.stringify([
    layer.text,
    layer.fontSize,
    layer.fontFamily,
    layer.fontWeight,
    layer.fill,
    layer.align,
    layer.letterSpacing,
    layer.lineHeight,
    layer.maxWidth,
  ]);
}

function shapeSignature(layer: ShapeLayer): string {
  return JSON.stringify([
    layer.shape,
    layer.width,
    layer.height,
    layer.fill,
    layer.stroke,
  ]);
}

function makeTextStyle(layer: TextLayer): TextStyleOptions {
  return {
    fontFamily: layer.fontFamily,
    fontSize: layer.fontSize,
    fontWeight: String(layer.fontWeight) as TextStyleOptions["fontWeight"],
    fill: rgbaToHex(layer.fill),
    align: layer.align as TextStyleOptions["align"],
    letterSpacing: layer.letterSpacing,
    lineHeight: layer.lineHeight,
    wordWrap: layer.maxWidth != null,
    wordWrapWidth: layer.maxWidth ?? 0,
  };
}

function drawShape(g: Graphics, layer: ShapeLayer): void {
  const w = layer.width;
  const h = layer.height;
  const ax = layer.transform.anchor.x;
  const ay = layer.transform.anchor.y;
  const cx = -ax * w;
  const cy = -ay * h;
  const fillHex = layer.fill ? rgbaToHex(layer.fill) : null;
  const strokeWidth = layer.stroke?.width ?? 0;

  g.clear();

  const fillPath = (draw: () => Graphics) => {
    if (fillHex && layer.fill) draw().fill({ color: fillHex, alpha: layer.fill.a });
  };
  const strokePath = (draw: () => Graphics) => {
    if (strokeWidth > 0 && layer.stroke) {
      draw().stroke({
        width: strokeWidth,
        color: rgbaToHex(layer.stroke.color),
        alpha: layer.stroke.color.a,
      });
    }
  };

  switch (layer.shape) {
    case "rect":
      fillPath(() => g.rect(cx, cy, w, h));
      strokePath(() => g.rect(cx, cy, w, h));
      break;
    case "ellipse":
      fillPath(() => g.ellipse(cx + w / 2, cy + h / 2, w / 2, h / 2));
      strokePath(() => g.ellipse(cx + w / 2, cy + h / 2, w / 2, h / 2));
      break;
    case "triangle":
      fillPath(() => g.poly([cx + w / 2, cy, cx + w, cy + h, cx, cy + h]));
      strokePath(() => g.poly([cx + w / 2, cy, cx + w, cy + h, cx, cy + h]));
      break;
    case "line":
      g.moveTo(cx, cy)
        .lineTo(cx + w, cy + h)
        .stroke({
          width: strokeWidth > 0 ? strokeWidth : 1,
          color: rgbaToHex(layer.stroke?.color ?? { r: 1, g: 1, b: 1, a: 1 }),
          alpha: layer.stroke?.color.a ?? 1,
        });
      break;
  }
}

/**
 * Renders a core Composition onto a PixiJS canvas. The renderer is a pure
 * function of the document: call `setComposition` after every project change
 * and `renderAt(time)` per frame. It owns a "viewport" container that fits
 * and letterboxes the composition inside the available screen space.
 */
export class CompositionRenderer {
  private app: Application | null = null;
  private viewport: Container | null = null;
  private bg: Graphics | null = null;
  private selectionGfx: Graphics | null = null;
  private selection: string | null = null;
  private comp: Composition | null = null;
  private handles = new Map<string, LayerHandle>();
  private mediaResolver: MediaResolver;
  private options: RendererOptions;
  private attachTo: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private lastTime = 0;
  private destroyed = false;

  constructor(mediaResolver: MediaResolver, options: RendererOptions = {}) {
    this.mediaResolver = mediaResolver;
    this.options = options;
  }

  async mount(attachTo: HTMLElement): Promise<void> {
    if (this.app || this.destroyed) return;
    const canvas = this.options.canvas ?? document.createElement("canvas");
    const app = new Application();
    await app.init({
      canvas,
      antialias: this.options.antialias ?? true,
      resolution: this.options.resolution ?? 1,
      background: this.options.background ?? "#141419",
      autoStart: false,
      preserveDrawingBuffer: true,
    });
    if (this.destroyed) {
      app.destroy({ removeView: false, releaseGlobalResources: false }, { children: true });
      return;
    }
    this.app = app;
    if (!this.options.canvas) attachTo.appendChild(canvas);
    this.attachTo = attachTo;

    this.viewport = new Container();
    this.bg = new Graphics();
    this.selectionGfx = new Graphics();
    app.stage.addChild(this.viewport);
    this.viewport.addChild(this.bg);
    this.viewport.addChild(this.selectionGfx);

    this.resizeObserver = new ResizeObserver(() => this.fitToContainer());
    this.resizeObserver.observe(attachTo);
    if (this.comp) {
      for (const layer of this.comp.layers) {
        const handle = this.handles.get(layer.id);
        if (handle && handle.wrapper.parent !== this.viewport) {
          this.viewport.addChild(handle.wrapper);
        }
      }
    }
    this.fitToContainer();
    if (this.comp) this.renderAt(this.lastTime);
  }

  setComposition(comp: Composition): void {
    this.comp = comp;

    const surviving = new Set<string>();
    for (const layer of comp.layers) {
      const existing = this.handles.get(layer.id);
      const sourceKey = sourceKeyOf(layer);
      if (existing && (existing.kind !== layer.kind || existing.sourceKey !== sourceKey)) {
        this.removeHandle(layer.id);
      }
      if (!this.handles.has(layer.id)) this.addHandle(layer);
      surviving.add(layer.id);
    }
    for (const id of [...this.handles.keys()]) {
      if (!surviving.has(id)) this.removeHandle(id);
    }

    // Keep render order aligned with the document (array order = bottom up).
    const order = new Map(comp.layers.map((layer, i) => [layer.id, i]));
    const sorted = [...this.handles.values()].sort(
      (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
    );
    const viewport = this.viewport;
    if (viewport) {
      sorted.forEach((handle, i) => {
        if (handle.wrapper.parent !== viewport) viewport.addChild(handle.wrapper);
        viewport.setChildIndex(handle.wrapper, i + 1);
      });
      if (this.selectionGfx) {
        if (this.selectionGfx.parent !== viewport) viewport.addChild(this.selectionGfx);
        viewport.setChildIndex(this.selectionGfx, viewport.children.length - 1);
      }
    }

    this.fitToContainer();
    this.renderAt(this.lastTime);
  }

  /**
   * Selects a layer for the highlight outline. Call whenever the UI selection
   * changes; the outline tracks animated bounds on every renderAt.
   */
  setSelection(layerId: string | null): void {
    this.selection = layerId;
    this.drawSelection();
  }

  /**
   * Picks the top-most visible layer under screen coordinates (CSS pixels
   * relative to the canvas). Returns the layer id, or null.
   */
  pickAt(screenX: number, screenY: number): string | null {
    const app = this.app;
    const comp = this.comp;
    if (!app || !comp) return null;
    for (const layer of [...comp.layers].reverse()) {
      const handle = this.handles.get(layer.id);
      if (!handle || !handle.wrapper.visible) continue;
      const b = handle.wrapper.getBounds();
      if (screenX >= b.x && screenX <= b.x + b.width && screenY >= b.y && screenY <= b.y + b.height) {
        return layer.id;
      }
    }
    return null;
  }

  renderAt(time: number): void {
    const app = this.app;
    const comp = this.comp;
    if (!app || !comp) return;
    this.lastTime = time;

    const bg = this.bg;
    if (bg) {
      bg.clear();
      bg.rect(0, 0, comp.width, comp.height).fill({
        color: rgbaToHex(comp.backgroundColor),
        alpha: comp.backgroundColor.a,
      });
    }

    for (const layer of comp.layers) {
      const handle = this.handles.get(layer.id);
      if (!handle) continue;

      const active = layerActiveAt(layer, time);
      const visible = active && layer.visible;
      handle.wrapper.visible = visible;
      if (!visible) continue;

      const resolved = evaluateLayerTransform(layer, time);
      handle.wrapper.position.set(resolved.position.x, resolved.position.y);
      handle.wrapper.scale.set(resolved.scale.x, resolved.scale.y);
      handle.wrapper.angle = resolved.rotation;
      handle.wrapper.alpha =
        resolved.opacity * (layer.kind === "text" ? layer.fill.a : 1);
      handle.wrapper.blendMode = blendModeToPixi(layer.transform.blendMode);

      if (layer.kind === "text") {
        const sig = textSignature(layer);
        if (handle.textSig !== sig) {
          const text = handle.inner as Text;
          text.text = layer.text;
          text.style = makeTextStyle(layer);
          handle.textSig = sig;
        }
      } else if (layer.kind === "shape") {
        const sig = shapeSignature(layer);
        if (handle.shapeSig !== sig) {
          drawShape(handle.inner as Graphics, layer);
          handle.shapeSig = sig;
        }
      } else if (layer.kind === "video" && handle.video) {
        const video = handle.video.video;
        if (isFinite(video.duration)) {
          const target = Math.min(Math.max(time, 0), Math.max(video.duration, 0));
          if (Math.abs(video.currentTime - target) > 0.001) {
            video.currentTime = target;
            (handle.media?.kind === "video" ? handle.media.texture.source : undefined)?.update();
          }
        }
      }

      updateEffectHandles(handle.effects, layer.effects, time);
      handle.wrapper.filters = handle.effects.length > 0 ? handle.effects.map((e) => e.filter) : [];
    }

    this.drawSelection();
    app.renderer.render(app.stage);
  }

  resize(width: number, height: number): void {
    this.app?.renderer.resize(width, height);
    this.fitToContainer();
    this.renderAt(this.lastTime);
  }

  destroy(): void {
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    for (const id of [...this.handles.keys()]) this.removeHandle(id);
    if (!this.options.canvas && this.attachTo) {
      const canvas = this.app?.canvas;
      if (canvas) this.attachTo.removeChild(canvas);
    }
    this.app?.destroy({ removeView: false, releaseGlobalResources: false }, { children: true });
    this.app = null;
    this.attachTo = null;
  }

  private fitToContainer(): void {
    const app = this.app;
    const comp = this.comp;
    if (!app || !this.attachTo) return;
    const rect = this.attachTo.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    app.renderer.resize(rect.width, rect.height);

    const viewport = this.viewport;
    if (!viewport || !comp) return;
    const scale = Math.min(rect.width / comp.width, rect.height / comp.height);
    viewport.scale.set(scale, scale);
    viewport.x = (rect.width - comp.width * scale) / 2;
    viewport.y = (rect.height - comp.height * scale) / 2;
  }

  private drawSelection(): void {
    const sel = this.selectionGfx;
    if (!sel || !this.app || !this.viewport) return;
    sel.clear();
    if (!this.selection) return;
    const handle = this.handles.get(this.selection);
    if (!handle || !handle.wrapper.visible) return;
    const b = handle.wrapper.getBounds();
    const tl = this.viewport.toLocal({ x: b.x, y: b.y }, this.app.stage);
    const br = this.viewport.toLocal({ x: b.x + b.width, y: b.y + b.height }, this.app.stage);
    sel.rect(tl.x, tl.y, br.x - tl.x, br.y - tl.y).stroke({
      width: 2,
      color: 0x35c4ff,
      alpha: 0.95,
    });
  }

  private addHandle(layer: Layer): void {
    const wrapper = new Container();
    wrapper.label = layer.name;
    const ax = layer.transform.anchor.x;
    const ay = layer.transform.anchor.y;

    let inner: Sprite | Text | Graphics;
    switch (layer.kind) {
      case "text": {
        const text = new Text({ text: layer.text, style: makeTextStyle(layer) });
        text.anchor.set(ax, ay);
        inner = text;
        break;
      }
      case "shape": {
        const g = new Graphics();
        drawShape(g, layer);
        inner = g;
        break;
      }
      case "image":
      case "video": {
        const sprite = new Sprite(Texture.EMPTY);
        sprite.anchor.set(ax, ay);
        sprite.width = layer.width;
        sprite.height = layer.height;
        inner = sprite;
        break;
      }
      case "audio": {
        inner = new Graphics();
        break;
      }
    }

    const handle: LayerHandle = {
      id: layer.id,
      kind: layer.kind,
      sourceKey: sourceKeyOf(layer),
      wrapper,
      inner,
      effects: createEffectHandles(layer.effects),
      media: null,
      video: null,
      textSig: null,
      shapeSig: null,
    };
    wrapper.addChild(inner);
    this.viewport?.addChild(wrapper);
    this.handles.set(layer.id, handle);

    if (layer.kind === "image" || layer.kind === "video") {
      void this.resolveLayerMedia(handle, layer);
    }
  }

  private async resolveLayerMedia(handle: LayerHandle, layer: Layer): Promise<void> {
    if (layer.kind !== "image" && layer.kind !== "video") return;
    let resolved: ResolvedMedia;
    try {
      resolved = await this.mediaResolver(layer.source, handle.kind);
    } catch {
      resolved = { kind: "missing" };
    }
    // Handle may have been removed or re-created while resolving.
    if (this.handles.get(handle.id) !== handle) return;
    handle.media = resolved;

    const sprite = handle.inner as Sprite;
    if (resolved.kind === "texture") {
      sprite.texture = resolved.texture;
    } else if (resolved.kind === "video") {
      sprite.texture = resolved.texture;
      handle.video = { video: resolved.video, lastTime: -1 };
    }
    sprite.width = layer.width;
    sprite.height = layer.height;
    sprite.anchor.set(layer.transform.anchor.x, layer.transform.anchor.y);
    this.renderAt(this.lastTime);
  }

  private removeHandle(id: string): void {
    const handle = this.handles.get(id);
    if (!handle) return;
    for (const effect of handle.effects) effect.filter.destroy();
    handle.wrapper.destroy({ children: true });
    this.handles.delete(id);
  }
}

function updateEffectHandles(
  handles: EffectHandle[],
  effects: Layer["effects"],
  time: number,
): void {
  for (const handle of handles) {
    const effect = effects.find((e) => e.id === handle.id);
    if (effect) handle.update(effect, time);
  }
}
