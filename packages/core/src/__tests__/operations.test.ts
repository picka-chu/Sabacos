import { describe, expect, it } from "vitest";
import { createDemoProject } from "../demo";
import {
  createImageLayer,
  createProject,
  createShapeLayer,
  createTextLayer,
  createComposition,
  rgba,
  createMedia,
} from "../factories";
import {
  addComposition,
  addEffect,
  addLayer,
  addMedia,
  applyCameraMove,
  applyColorGrade,
  clearTransformKeyframes,
  duplicateLayer,
  moveLayerToIndex,
  removeEffect,
  removeLayer,
  removeMedia,
  removeTransformKeyframe,
  renameLayer,
  setCompositionSettings,
  setLayerRange,
  setLayerTransition,
  setLayerVisible,
  setTextContent,
  setTransformKeyframe,
  setTransformStatic,
  updateEffect,
} from "../operations";

function buildProject() {
  let project = createProject({ name: "test" });
  const comp = createComposition({ name: "Main", width: 1920, height: 1080, fps: 30, duration: 10 });
  project = addComposition(project, comp);
  return { project, comp };
}

describe("operations", () => {
  it("addLayer appends and is immutable", () => {
    const { project, comp } = buildProject();
    const layer = createTextLayer({ text: "Hi", transform: { position: { type: "static", value: { x: 100, y: 100 } } } });
    const next = addLayer(project, comp.id, layer);
    expect(project.compositions[0]!.layers).toHaveLength(0);
    expect(next.compositions[0]!.layers).toHaveLength(1);
  });

  it("removeLayer removes only the target", () => {
    const { project, comp } = buildProject();
    const a = createShapeLayer({ shape: "rect", width: 10, height: 10 });
    const b = createShapeLayer({ shape: "ellipse", width: 10, height: 10 });
    let next = addLayer(project, comp.id, a);
    next = addLayer(next, comp.id, b);
    next = removeLayer(next, comp.id, a.id);
    expect(next.compositions[0]!.layers.map((l) => l.id)).toEqual([b.id]);
  });

  it("duplicateLayer clones with a new id", () => {
    const { project, comp } = buildProject();
    const layer = createTextLayer({ text: "Original" });
    let next = addLayer(project, comp.id, layer);
    next = duplicateLayer(next, comp.id, layer.id);
    const layers = next.compositions[0]!.layers;
    expect(layers).toHaveLength(2);
    expect(layers[0]!.id).toBe(layer.id);
    expect(layers[1]!.id).not.toBe(layer.id);
    expect(layers[1]!.name).toContain("copy");
  });

  it("moveLayerToIndex reorders", () => {
    const { project, comp } = buildProject();
    const a = createShapeLayer({ shape: "rect", width: 1, height: 1 });
    const b = createShapeLayer({ shape: "rect", width: 1, height: 1 });
    const c = createShapeLayer({ shape: "rect", width: 1, height: 1 });
    let next = addLayer(project, comp.id, a);
    next = addLayer(next, comp.id, b);
    next = addLayer(next, comp.id, c);
    next = moveLayerToIndex(next, comp.id, c.id, 0);
    expect(next.compositions[0]!.layers.map((l) => l.id)).toEqual([c.id, a.id, b.id]);
  });

  it("setTransformStatic sets a static value", () => {
    const { project, comp } = buildProject();
    const layer = createTextLayer({});
    const next = addLayer(project, comp.id, layer);
    const result = setTransformStatic(next, comp.id, layer.id, "opacity", 0.5);
    expect(result.compositions[0]!.layers[0]!.transform.opacity).toEqual({ type: "static", value: 0.5 });
  });

  it("setTransformKeyframe on static seeds a keyframe at t=0", () => {
    const { project, comp } = buildProject();
    const layer = createTextLayer({});
    const next = addLayer(project, comp.id, layer);
    const result = setTransformKeyframe(next, comp.id, layer.id, "scale", 1, { x: 2, y: 2 });
    const anim = result.compositions[0]!.layers[0]!.transform.scale;
    expect(anim.type).toBe("animated");
    if (anim.type === "animated") {
      expect(anim.keyframes).toHaveLength(2);
      expect(anim.keyframes[0]).toMatchObject({ time: 0, value: { x: 1, y: 1 } });
      expect(anim.keyframes[1]).toMatchObject({ time: 1, value: { x: 2, y: 2 } });
    }
  });

  it("setTransformKeyframe replaces an existing keyframe at the same time", () => {
    const { project, comp } = buildProject();
    const layer = createShapeLayer({ shape: "ellipse", width: 5, height: 5 });
    let next = addLayer(project, comp.id, layer);
    next = setTransformKeyframe(next, comp.id, layer.id, "position", 1, { x: 1, y: 1 });
    next = setTransformKeyframe(next, comp.id, layer.id, "position", 1, { x: 9, y: 9 });
    const anim = next.compositions[0]!.layers[0]!.transform.position;
    if (anim.type === "animated") {
      expect(anim.keyframes.filter((k) => k.time === 1)).toHaveLength(1);
      expect(anim.keyframes.find((k) => k.time === 1)!.value).toEqual({ x: 9, y: 9 });
    }
  });

  it("setTransformKeyframe at t=0 on a static value does not duplicate t=0", () => {
    const { project, comp } = buildProject();
    const layer = createShapeLayer({ shape: "rect", width: 5, height: 5 });
    let next = addLayer(project, comp.id, layer);
    next = setTransformKeyframe(next, comp.id, layer.id, "opacity", 0, 0.5, "linear");
    const anim = next.compositions[0]!.layers[0]!.transform.opacity;
    if (anim.type === "animated") {
      expect(anim.keyframes).toHaveLength(1);
      expect(anim.keyframes[0]).toMatchObject({ time: 0, value: 0.5 });
    }
  });

  it("removeTransformKeyframe collapses to static when one remains", () => {
    const { project, comp } = buildProject();
    const layer = createTextLayer({});
    let next = addLayer(project, comp.id, layer);
    next = setTransformKeyframe(next, comp.id, layer.id, "rotation", 1, 45);
    next = setTransformKeyframe(next, comp.id, layer.id, "rotation", 2, 90);
    // The first set on a static value seeds a keyframe at t=0; remove both
    // t=0 and t=1 so only t=2 (value 90) remains.
    next = removeTransformKeyframe(next, comp.id, layer.id, "rotation", 1);
    next = removeTransformKeyframe(next, comp.id, layer.id, "rotation", 0);
    const anim = next.compositions[0]!.layers[0]!.transform.rotation;
    expect(anim).toEqual({ type: "static", value: 90 });
  });

  it("clearTransformKeyframes falls back to the first keyframe value", () => {
    const { project, comp } = buildProject();
    const layer = createTextLayer({});
    let next = addLayer(project, comp.id, layer);
    next = setTransformKeyframe(next, comp.id, layer.id, "opacity", 1, 0.25);
    next = clearTransformKeyframes(next, comp.id, layer.id, "opacity");
    expect(next.compositions[0]!.layers[0]!.transform.opacity).toEqual({ type: "static", value: 1 });
  });

  it("adds/removes effects", () => {
    const { project, comp } = buildProject();
    const layer = createTextLayer({});
    let next = addLayer(project, comp.id, layer);
    const blur = { id: "fx1", type: "blur" as const, enabled: true, amount: { type: "static" as const, value: 5 } };
    next = addEffect(next, comp.id, layer.id, blur);
    expect(next.compositions[0]!.layers[0]!.effects).toHaveLength(1);
    next = removeEffect(next, comp.id, layer.id, "fx1");
    expect(next.compositions[0]!.layers[0]!.effects).toHaveLength(0);
  });

  it("updateEffect patches a property but keeps type and id", () => {
    const { project, comp } = buildProject();
    const layer = createTextLayer({});
    let next = addLayer(project, comp.id, layer);
    next = addEffect(next, comp.id, layer.id, {
      id: "fx1",
      type: "blur",
      enabled: true,
      amount: { type: "static", value: 5 },
    });
    next = updateEffect(next, comp.id, layer.id, "fx1", {
      enabled: false,
      type: "invert", // must be ignored
      id: "hijack", // must be ignored
    });
    const effect = next.compositions[0]!.layers[0]!.effects[0]!;
    expect(effect).toMatchObject({ id: "fx1", type: "blur", enabled: false });
  });

  it("setTextContent only affects text layers", () => {
    const { project, comp } = buildProject();
    const text = createTextLayer({ text: "a" });
    const shape = createShapeLayer({ shape: "rect", width: 1, height: 1 });
    let next = addLayer(project, comp.id, text);
    next = addLayer(next, comp.id, shape);
    next = setTextContent(next, comp.id, shape.id, "nope");
    next = setTextContent(next, comp.id, text.id, "changed");
    const layers = next.compositions[0]!.layers;
    expect(layers.find((l) => l.id === text.id)!.kind).toBe("text");
    expect((layers.find((l) => l.id === text.id) as Extract<typeof text, { kind: "text" }>).text).toBe("changed");
    expect(layers.find((l) => l.id === shape.id)!.kind).toBe("shape");
  });

  it("setCompositionSettings and setLayerRange and renameLayer", () => {
    const { project, comp } = buildProject();
    const layer = createTextLayer({});
    let next = addLayer(project, comp.id, layer);
    next = renameLayer(next, comp.id, layer.id, "new name");
    next = setLayerRange(next, comp.id, layer.id, { inPoint: 2, outPoint: 6 });
    next = setLayerVisible(next, comp.id, layer.id, false);
    next = setCompositionSettings(next, comp.id, { width: 1280, height: 720, fps: 24 });
    const comp2 = next.compositions[0]!;
    expect(comp2.layers[0]).toMatchObject({ name: "new name", inPoint: 2, outPoint: 6, visible: false });
    expect(comp2).toMatchObject({ width: 1280, height: 720, fps: 24 });
  });

  it("addMedia stores media and removeMedia drops it", () => {
    const { project } = buildProject();
    let next = addMedia(project, { kind: "image", name: "pic", mimeType: "image/png", url: "/media/pic.png", width: 100, height: 50 });
    expect(next.media).toHaveLength(1);
    next = removeMedia(next, next.media[0]!.id);
    expect(next.media).toHaveLength(0);
  });

  it("image layers can reference media or urls", () => {
    const { project, comp } = buildProject();
    const layer = createImageLayer({ source: { type: "url", url: "https://example.com/a.png" }, width: 100, height: 100 });
    const next = addLayer(project, comp.id, layer);
    expect(next.compositions[0]!.layers[0]!.kind).toBe("image");
  });

  it("demo project parses and evaluates", () => {
    const demo = createDemoProject();
    expect(demo.compositions.length).toBeGreaterThan(0);
    const main = demo.compositions[0]!;
    expect(main.layers.length).toBeGreaterThan(0);
    // title scale at t=0 should be 0.4 (first keyframe)
    const title = main.layers.find((l) => l.name === "Title");
    expect(title).toBeDefined();
  });

  it("setLayerTransition stores and clears a transition", () => {
    const { project, comp } = buildProject();
    const layer = createShapeLayer({ shape: "rect", width: 100, height: 100 });
    let next = addLayer(project, comp.id, layer);
    next = setLayerTransition(next, comp.id, layer.id, {
      in: { type: "slide", duration: 0.6, direction: "left" },
      out: { type: "fade", duration: 0.4 },
    });
    expect(next.compositions[0]!.layers[0]!.transition).toEqual({
      in: { type: "slide", duration: 0.6, direction: "left" },
      out: { type: "fade", duration: 0.4 },
    });
    next = setLayerTransition(next, comp.id, layer.id, null);
    expect(next.compositions[0]!.layers[0]!.transition).toBeUndefined();
  });

  it("applyCameraMove pans a single layer with keyframes from its inPoint", () => {
    const { project, comp } = buildProject();
    const layer = createShapeLayer({ shape: "rect", width: 100, height: 100, transform: { position: { type: "static", value: { x: 0, y: 0 } } } });
    let next = addLayer(project, comp.id, layer);
    next = setLayerRange(next, comp.id, layer.id, { inPoint: 2 });
    next = applyCameraMove(next, comp.id, { layerId: layer.id, move: "panLeft", duration: 1, amount: 0.3 });
    const pos = next.compositions[0]!.layers[0]!.transform.position;
    expect(pos.type).toBe("animated");
    if (pos.type === "animated") {
      expect(pos.keyframes[0]!.time).toBe(2);
      expect(pos.keyframes[1]!.time).toBe(3);
      expect(pos.keyframes[1]!.value).toEqual({ x: -0.3 * 1920, y: 0 });
    }
  });

  it("applyCameraMove zoomIn scales the layer and parallax is proportional", () => {
    const { project, comp } = buildProject();
    const a = createShapeLayer({ shape: "rect", width: 50, height: 50 });
    const b = createShapeLayer({ shape: "ellipse", width: 50, height: 50 });
    let next = addLayer(project, comp.id, a);
    next = addLayer(next, comp.id, b);
    next = applyCameraMove(next, comp.id, { move: "zoomIn", duration: 2 });
    const scale = next.compositions[0]!.layers[0]!.transform.scale;
    expect(scale.type).toBe("animated");
    if (scale.type === "animated") expect(scale.keyframes[1]!.value).toEqual({ x: 1.3, y: 1.3 });

    next = applyCameraMove(next, comp.id, { move: "parallax", duration: 2 });
    const p1 = next.compositions[0]!.layers[0]!.transform.position;
    const p2 = next.compositions[0]!.layers[1]!.transform.position;
    expect(p1.type).toBe("animated");
    expect(p2.type).toBe("animated");
  });

  it("applyColorGrade adds a colorAdjust effect and updates it when re-applied", () => {
    const { project, comp } = buildProject();
    const layer = createShapeLayer({ shape: "rect", width: 100, height: 100 });
    let next = addLayer(project, comp.id, layer);
    next = applyColorGrade(next, comp.id, { layerId: layer.id, preset: "warm", intensity: 1 });
    const l1 = next.compositions[0]!.layers[0]!;
    const eff = l1.effects.find((e) => e.type === "colorAdjust");
    expect(eff).toBeDefined();
    if (eff && eff.type === "colorAdjust" && eff.saturation.type === "static") expect(eff.saturation.value).toBe(0.15);
    next = applyColorGrade(next, comp.id, { layerId: layer.id, preset: "warm", intensity: 0.5 });
    const l2 = next.compositions[0]!.layers[0]!;
    expect(l2.effects.filter((e) => e.type === "colorAdjust")).toHaveLength(1);
    const eff2 = l2.effects.find((e) => e.type === "colorAdjust");
    if (eff2 && eff2.type === "colorAdjust" && eff2.saturation.type === "static") expect(eff2.saturation.value).toBeCloseTo(0.075);
  });

  it("applyColorGrade with no layerId grades every layer", () => {
    const { project, comp } = buildProject();
    let next = addLayer(project, comp.id, createShapeLayer({ shape: "rect", width: 10, height: 10 }));
    next = addLayer(next, comp.id, createTextLayer({ text: "x" }));
    next = applyColorGrade(next, comp.id, { preset: "mono" });
    const layers = next.compositions[0]!.layers;
    expect(layers.every((l) => l.effects.some((e) => e.type === "colorAdjust"))).toBe(true);
  });
});
