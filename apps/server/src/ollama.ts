import type { AiBackend, ModelPart } from "./ai";

type OllamaToolCall = {
  id?: string;
  type?: string;
  function: { name: string; arguments: unknown };
};

type OllamaMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: OllamaToolCall[];
  tool_call_id?: string;
};

type OllamaChatResponse = {
  message?: { role?: string; content?: string; tool_calls?: OllamaToolCall[] };
  done?: boolean;
};

function randomId(): string {
  return `call_${Math.random().toString(36).slice(2, 12)}`;
}

function parseArgs(args: unknown): Record<string, unknown> {
  if (typeof args === "string") {
    try {
      const parsed = JSON.parse(args);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return (args as Record<string, unknown>) ?? {};
}

function has(part: unknown, key: string): boolean {
  return !!part && typeof part === "object" && key in (part as Record<string, unknown>);
}

/** Converts the controller's Gemini-style contents to Ollama/OpenAI messages. */
export function toOllamaMessages(contents: unknown[]): OllamaMessage[] {
  const messages: OllamaMessage[] = [];
  for (const entry of contents as { role?: string; parts?: unknown[] }[]) {
    const parts = entry.parts ?? [];
    const role = entry.role;
    if (role === "user") {
      const text = parts
        .filter((p) => has(p, "text"))
        .map((p) => (p as { text: string }).text)
        .join("\n");
      const toolResponses = parts.filter((p) => has(p, "functionResponse")) as {
        functionResponse: { id?: string; name: string; response: unknown };
      }[];
      for (const tr of toolResponses) {
        messages.push({
          role: "tool",
          tool_call_id: tr.functionResponse.id ?? `call_${tr.functionResponse.name}`,
          content: JSON.stringify(tr.functionResponse.response),
        });
      }
      if (text.trim().length > 0) messages.push({ role: "user", content: text });
    } else if (role === "model") {
      const fcs = parts.filter((p) => has(p, "functionCall")) as {
        functionCall: { name: string; args?: Record<string, unknown>; id?: string };
      }[];
      const text = parts
        .filter((p) => has(p, "text"))
        .map((p) => (p as { text: string }).text)
        .join("\n");
      const msg: OllamaMessage = { role: "assistant", content: text };
      if (fcs.length > 0) {
        msg.tool_calls = fcs.map((fc) => ({
          id: fc.functionCall.id ?? randomId(),
          type: "function",
          function: { name: fc.functionCall.name, arguments: fc.functionCall.args ?? {} },
        }));
      }
      messages.push(msg);
    }
  }
  return messages;
}

/** Converts Gemini-style functionDeclarations to the Ollama/OpenAI tools format. */
export function toOllamaTools(config?: unknown): unknown[] {
  const cfg = config as { tools?: { functionDeclarations?: Record<string, unknown>[] }[] } | undefined;
  const decls = cfg?.tools?.[0]?.functionDeclarations ?? [];
  return decls.map((d) => ({
    type: "function",
    function: {
      name: d.name,
      description: d.description,
      parameters: d.parametersJsonSchema,
    },
  }));
}

export class OllamaBackend implements AiBackend {
  readonly model: string;
  constructor(
    private readonly baseUrl: string,
    model: string,
  ) {
    this.model = model;
  }

  async generateContent(params: {
    model: string;
    contents: unknown[];
    config?: unknown;
  }): Promise<{ text?: string; parts?: ModelPart[] }> {
    const cfg = params.config as { systemInstruction?: string } | undefined;
    const body: Record<string, unknown> = {
      model: params.model,
      messages: toOllamaMessages(params.contents),
      tools: toOllamaTools(params.config),
      stream: false,
    };
    if (cfg?.systemInstruction) body.system = cfg.systemInstruction;

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Ollama error ${response.status}: ${detail.slice(0, 500)}`);
    }
    const data = (await response.json()) as OllamaChatResponse;
    const message = data.message ?? {};
    const parts: ModelPart[] = [];
    if (message.content) parts.push({ text: message.content });
    for (const tc of message.tool_calls ?? []) {
      parts.push({
        functionCall: { name: tc.function.name, args: parseArgs(tc.function.arguments), id: tc.id ?? randomId() },
      });
    }
    return { text: message.content ?? "", parts };
  }
}

/** Detects the first Ollama model that supports tools (fallback: first model). */
export async function detectOllamaModel(baseUrl = "http://localhost:11434"): Promise<string> {
  const response = await fetch(`${baseUrl}/api/tags`);
  if (!response.ok) throw new Error(`Ollama not reachable at ${baseUrl} (${response.status})`);
  const data = (await response.json()) as { models?: { name: string; capabilities?: string[] }[] };
  const models = data.models ?? [];
  if (models.length === 0) throw new Error("No Ollama models installed");
  return (models.find((m) => (m.capabilities ?? []).includes("tools")) ?? models[0]!).name;
}

export async function createOllamaBackend(opts?: {
  baseUrl?: string;
  model?: string;
}): Promise<OllamaBackend> {
  const baseUrl = opts?.baseUrl ?? process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  const model = opts?.model ?? process.env.OLLAMA_MODEL ?? (await detectOllamaModel(baseUrl));
  return new OllamaBackend(baseUrl, model);
}
