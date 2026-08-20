import { describe, expect, it } from "vitest";
import { toOllamaMessages, toOllamaTools } from "../ollama";

describe("toOllamaMessages", () => {
  it("converts a user text turn", () => {
    expect(toOllamaMessages([{ role: "user", parts: [{ text: "add a title" }] }])).toEqual([
      { role: "user", content: "add a title" },
    ]);
  });

  it("converts a model functionCall turn into assistant tool_calls", () => {
    const messages = toOllamaMessages([
      { role: "model", parts: [{ functionCall: { name: "inspect", args: {}, id: "t1" } }] },
    ]);
    expect(messages[0]!.role).toBe("assistant");
    expect(messages[0]!.tool_calls).toEqual([
      { id: "t1", type: "function", function: { name: "inspect", arguments: {} } },
    ]);
  });

  it("converts functionResponses into tool messages and skips empty user text", () => {
    const messages = toOllamaMessages([
      { role: "user", parts: [{ functionResponse: { id: "t1", name: "inspect", response: { output: { ok: true } } } }] },
    ]);
    expect(messages).toEqual([
      { role: "tool", tool_call_id: "t1", content: JSON.stringify({ output: { ok: true } }) },
    ]);
  });

  it("preserves parallel function calls", () => {
    const messages = toOllamaMessages([
      {
        role: "model",
        parts: [
          { functionCall: { name: "addLayer", args: { a: 1 }, id: "x" } },
          { functionCall: { name: "addEffect", args: { b: 2 }, id: "y" } },
        ],
      },
    ]);
    expect(messages[0]!.tool_calls).toHaveLength(2);
  });

  it("falls back to generated ids for tool calls without one", () => {
    const messages = toOllamaMessages([
      { role: "model", parts: [{ functionCall: { name: "inspect", args: {} } }] },
    ]);
    expect(messages[0]!.tool_calls![0]!.id).toMatch(/^call_/);
  });
});

describe("toOllamaTools", () => {
  it("converts functionDeclarations into the Ollama tools format", () => {
    const tools = toOllamaTools({
      tools: [{ functionDeclarations: [{ name: "addLayer", description: "Adds a layer", parametersJsonSchema: { type: "object", properties: {} } }] }],
    });
    expect(tools).toEqual([
      {
        type: "function",
        function: {
          name: "addLayer",
          description: "Adds a layer",
          parameters: { type: "object", properties: {} },
        },
      },
    ]);
  });

  it("returns an empty array without tools", () => {
    expect(toOllamaTools(undefined)).toEqual([]);
    expect(toOllamaTools({})).toEqual([]);
  });
});
