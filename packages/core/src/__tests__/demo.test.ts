import { describe, expect, it } from "vitest";
import { createDemoProject } from "../demo";
import type { Animatable } from "../types";

function isAnimated(anim: Animatable<unknown>): boolean {
  return anim.type === "animated" && anim.keyframes.length >= 2;
}

function layerByName(compName: string, layerName: string) {
  const project = createDemoProject();
  const comp = project.compositions.find((c) => c.name === compName);
  expect(comp, `composition ${compName} exists`).toBeDefined();
  const layer = comp!.layers.find((l) => l.name === layerName);
  expect(layer, `layer ${layerName} exists`).toBeDefined();
  return { project, comp: comp!, layer: layer! };
}

describe("createDemoProject", () => {
  it("animates the title scale and opacity", () => {
    const { layer } = layerByName("Main", "Title");
    expect(isAnimated(layer.transform.scale)).toBe(true);
    expect(isAnimated(layer.transform.opacity)).toBe(true);
  });

  it("animates the subtitle opacity", () => {
    const { layer } = layerByName("Main", "Subtitle");
    expect(isAnimated(layer.transform.opacity)).toBe(true);
  });

  it("animates the bouncing ball position and rotation", () => {
    const { layer } = layerByName("Main", "Bouncing ball");
    expect(isAnimated(layer.transform.position)).toBe(true);
    expect(isAnimated(layer.transform.rotation)).toBe(true);
    expect(layer.transform.opacity).toEqual({ type: "static", value: 0.9 });
  });

  it("animates the outro thanks scale", () => {
    const { layer } = layerByName("Outro", "Thanks");
    expect(isAnimated(layer.transform.scale)).toBe(true);
  });
});
