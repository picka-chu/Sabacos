import { GoogleGenAI } from "@google/genai";
import type { AiBackend, ModelPart } from "./ai";

/** Real Gemini backend backed by @google/genai (isolated so tsc/tests stay fast). */
export function createGeminiBackend(): AiBackend {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  const ai = new GoogleGenAI({ apiKey });
  return {
    async generateContent({ model, contents, config }) {
      const response = await ai.models.generateContent({
        model,
        contents: contents as never,
        config: config as never,
      });
      const parts: ModelPart[] = (response.candidates?.[0]?.content?.parts ?? []).map((part) => ({
        text: part.text,
        thoughtSignature: part.thoughtSignature,
        functionCall: part.functionCall
          ? {
              name: part.functionCall.name ?? "",
              args: (part.functionCall.args ?? {}) as Record<string, unknown>,
              id: part.functionCall.id,
            }
          : undefined,
      }));
      return { text: response.text, parts };
    },
  };
}