import type { Context } from "hono";
import { z } from "zod";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const notFound = () => new ApiError(404, "not_found", "Resource not found");
export const badRequest = (message: string, fields?: Record<string, string>) =>
  new ApiError(400, "bad_request", message, fields);
export const unauthorized = (message = "Unauthorized") => new ApiError(401, "unauthorized", message);
export const forbidden = (message = "Forbidden") => new ApiError(403, "forbidden", message);
export const conflict = (message: string) => new ApiError(409, "conflict", message);

export function sendError(c: Context, err: unknown) {
  if (err instanceof ApiError) {
    return c.json(
      { error: { code: err.code, message: err.message, ...(err.fields ? { fields: err.fields } : {}) } },
      err.status as never,
    );
  }
  if (err instanceof z.ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of err.issues) {
      const path = issue.path.join(".");
      fields[path] = issue.message;
    }
    return c.json(
      { error: { code: "validation_error", message: "Invalid input", fields } },
      400,
    );
  }
  console.error("[api] unhandled error:", err);
  return c.json(
    { error: { code: "internal_error", message: "Internal server error" } },
    500,
  );
}

export function safeParse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) {
      fields[issue.path.join(".")] = issue.message;
    }
    throw new ApiError(400, "validation_error", "Invalid input", fields);
  }
  return result.data;
}