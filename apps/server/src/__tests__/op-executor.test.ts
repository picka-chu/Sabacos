import { describe, expect, it } from "vitest";
import { createProject, getComposition } from "@motion/core";
import { executeOperations, OpExecutionError, opNames } from "../op-executor";

function baseProject() {
  return createProject({ name: "Test" });
}

describe("op-executor", () => {
  it("creates a composition and returns its id", () => {
    const result = executeOperations(baseProject(), [
      { op: "addComposition", args: { composition: { name: "Main", width: 1280, height: 720, duration: 8 } } },
    ]);
    expect(result.refs.compId).toBeTruthy();
    const comp = getComposition(result.project, result.refs.compId!)!;
    expect(comp).toMatchObject({ name: "Main", width: 1280, height: 720, duration: 8 });
  });

  it("adds a text layer and keyframes with a caller-chosen id in one batch", () => {
    const first = executeOperations(baseProject(), [
      { op: "addComposition", args: { composition: { name: "Main" } } },
    ]);
    const compId = first.refs.compId!;
    const result = executeOperations(first.project, [
      {
        op: "addLayer",
        args: { compId, layer: { id: "l1", kind: "text", name: "Title", text: "Hi", fontSize: 80 } },
      },
      {
        op: "setTransformKeyframe",
        args: { compId, layerId: "l1", prop: "scale", time: 0, value: { x: 0, y: 0 }, easing: "linear" },
      },
      {
        op: "setTransformKeyframe",
        args: { compId, layerId: "l1", prop: "scale", time: 1, value: { x: 1, y: 1 }, easing: "easeOutBack" },
      },
      { op: "setTextContent", args: { compId, layerId: "l1", text: "Hello World" } },
    ]);
    expect(result.refs.layerId).toBe("l1");
    const layer = getComposition(result.project, compId)!.layers.find((l) => l.id === "l1")!;
    if (layer.kind === "text") {
      expect(layer.text).toBe("Hello World");
    } else {
      expect.unreachable("layer should be text");
    }
    if (layer.transform.scale.type === "animated") {
      expect(layer.transform.scale.keyframes.map((k) => k.time)).toEqual([0, 1]);
      expect(layer.transform.scale.keyframes[1]!.easing).toBe("easeOutBack");
    } else {
      expect.unreachable("scale should be animated");
    }
  });

  it("returns generated ids for addLayer/addEffect chained across batches", () => {
    const first = executeOperations(baseProject(), [
      { op: "addComposition", args: { composition: { name: "Main" } } },
    ]);
    const compId = first.refs.compId!;
    const added = executeOperations(first.project, [
      { op: "addLayer", args: { compId, layer: { kind: "shape", name: "Box", shape: "rect", width: 100, height: 50 } } },
    ]);
    expect(added.refs.layerId).toBeTruthy();
    const effect = executeOperations(added.project, [
      { op: "addEffect", args: { compId, layerId: added.refs.layerId!, effect: { type: "blur", amount: { type: "static", value: 4 } } } },
    ]);
    const layer = getComposition(effect.project, compId)!.layers.find((l) => l.id === added.refs.layerId)!;
    expect(layer.effects).toHaveLength(1);
    expect(layer.effects[0]!.type).toBe("blur");
  });

  it("duplicateLayer returns the new layer id", () => {
    const first = executeOperations(baseProject(), [
      { op: "addComposition", args: { composition: { name: "Main" } } },
    ]);
    const compId = first.refs.compId!;
    const added = executeOperations(first.project, [
      { op: "addLayer", args: { compId, layer: { id: "l1", kind: "shape", name: "Box", shape: "rect", width: 10, height: 10 } } },
    ]);
    const dup = executeOperations(added.project, [{ op: "duplicateLayer", args: { compId, layerId: "l1" } }]);
    expect(dup.refs.layerId).toBeTruthy();
    expect(dup.refs.layerId).not.toBe("l1");
    expect(getComposition(dup.project, compId)!.layers).toHaveLength(2);
  });

  it("throws on unknown operations", () => {
    expect(() => executeOperations(baseProject(), [{ op: "nope", args: {} }])).toThrow(OpExecutionError);
    expect(() => executeOperations(baseProject(), [{ op: "nope", args: {} }])).toThrow(/Unknown operation/);
  });

  it("throws on invalid args and leaves the base project untouched", () => {
    const base = baseProject();
    const snapshot = structuredClone(base);
    expect(() => executeOperations(base, [{ op: "setProjectName", args: { name: 42 } }])).toThrow(OpExecutionError);
    expect(base).toEqual(snapshot);
  });

  it("throws when referencing a missing composition or layer", () => {
    expect(() =>
      executeOperations(baseProject(), [
        { op: "setTextContent", args: { compId: "missing", layerId: "l", text: "x" } },
      ]),
    ).toThrow(/Composition "missing" not found/);

    const first = executeOperations(baseProject(), [{ op: "addComposition", args: { composition: { name: "Main" } } }]);
    expect(() =>
      executeOperations(first.project, [
        { op: "setTextContent", args: { compId: first.refs.compId, layerId: "ghost", text: "x" } },
      ]),
    ).toThrow(/Layer "ghost" not found/);
  });

  it("rejects a batch that produces an invalid document", () => {
    expect(() =>
      executeOperations(baseProject(), [
        { op: "addComposition", args: { composition: { name: "Main", width: -1, height: 0 } } },
      ]),
    ).toThrow(OpExecutionError);
  });

  it("rejects duplicate ids after a batch", () => {
    const first = executeOperations(baseProject(), [
      { op: "addComposition", args: { composition: { id: "c1", name: "Main" } } },
    ]);
    expect(() =>
      executeOperations(first.project, [
        { op: "addComposition", args: { composition: { id: "c1", name: "Other" } } },
      ]),
    ).toThrow(/Duplicate id/);
  });

  it("documents every registered operation", () => {
    const names = opNames();
    expect(names.length).toBeGreaterThan(10);
    for (const name of names) {
      expect(typeof name).toBe("string");
    }
  });
});
