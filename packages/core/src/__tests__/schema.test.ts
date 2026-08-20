import { describe, expect, it } from "vitest";
import { parseProject, tryParseProject, ProjectValidationError } from "../schema";
import { createDemoProject } from "../demo";

describe("parseProject", () => {
  it("accepts a demo project", () => {
    const demo = createDemoProject();
    const parsed = parseProject(demo);
    expect(parsed.compositions.length).toBe(demo.compositions.length);
  });

  it("fills missing ids and defaults", () => {
    const parsed = parseProject({
      name: "Minimal",
      compositions: [
        {
          name: "Comp",
          layers: [{ kind: "text", text: "x" }],
        },
      ],
    });
    expect(parsed.id).toMatch(/^project_/);
    const comp = parsed.compositions[0]!;
    expect(comp.id).toMatch(/^comp_/);
    expect(comp.width).toBe(1920);
    expect(comp.fps).toBe(30);
    const layer = comp.layers[0]!;
    expect(layer.id).toMatch(/^text_/);
    expect(layer.transform).toEqual({
      anchor: { x: 0.5, y: 0.5 },
      position: { type: "static", value: { x: 0, y: 0 } },
      scale: { type: "static", value: { x: 1, y: 1 } },
      rotation: { type: "static", value: 0 },
      opacity: { type: "static", value: 1 },
      blendMode: "source-over",
    });
  });

  it("clamps outPoint to be greater than inPoint", () => {
    const parsed = parseProject({
      name: "clamp",
      compositions: [
        {
          layers: [{ kind: "shape", shape: "rect", inPoint: 5, outPoint: 2 }],
        },
      ],
    });
    const layer = parsed.compositions[0]!.layers[0]!;
    expect(layer.outPoint).toBe(6);
  });

  it("rejects invalid opacity", () => {
    const result = tryParseProject({
      name: "bad",
      compositions: [
        {
          layers: [{ kind: "text", transform: { opacity: 3 } }],
        },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeInstanceOf(ProjectValidationError);
  });

  it("rejects layers without a kind", () => {
    const result = tryParseProject({
      name: "bad",
      compositions: [{ layers: [{ name: "ghost" }] }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative duration", () => {
    const result = tryParseProject({
      name: "bad",
      compositions: [{ duration: -1 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-object input", () => {
    const result = tryParseProject("hello");
    expect(result.success).toBe(false);
  });

  it("accepts keyframed transforms", () => {
    const parsed = parseProject({
      name: "kf",
      compositions: [
        {
          layers: [
            {
              kind: "shape",
              shape: "ellipse",
              transform: {
                position: {
                  type: "animated",
                  keyframes: [
                    { time: 0, value: { x: 0, y: 0 } },
                    { time: 1, value: { x: 10, y: 10 }, easing: "easeOutBack" },
                  ],
                },
              },
            },
          ],
        },
      ],
    });
    const layer = parsed.compositions[0]!.layers[0]!;
    const pos = layer.transform.position;
    expect(pos.type).toBe("animated");
    if (pos.type === "animated") {
      expect(pos.keyframes[1]!.easing).toBe("easeOutBack");
    }
  });

  it("preserves unknown top-level fields for forward compatibility", () => {
    const parsed = parseProject({ name: "x", futureField: { a: 1 } } as unknown);
    expect(parsed).toMatchObject({ name: "x" });
  });
});
