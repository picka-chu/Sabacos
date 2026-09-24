const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "/api/v1";

export class ApiError extends Error {
  code: string;
  status: number;
  fields?: Record<string, string>;
  constructor(code: string, message: string, status: number, fields?: Record<string, string>) {
    super(message);
    this.code = code;
    this.status = status;
    this.fields = fields;
  }
}

/** Get Telegram initData if running inside Telegram WebApp. */
export function getTelegramInitData(): string | null {
  try {
    const tg = (window as unknown as Record<string, unknown>)?.Telegram;
    if (tg && typeof tg === "object" && "WebApp" in tg) {
      const webApp = (tg as { WebApp: { initData?: string } }).WebApp;
      return webApp?.initData ?? null;
    }
  } catch {
    /* not in Telegram */
  }
  return null;
}

async function request<T>(method: string, path: string, body?: unknown, token?: string, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  } else {
    // Try Telegram initData auth if no bearer token
    const initData = getTelegramInitData();
    if (initData) {
      headers["X-Telegram-Init-Data"] = initData;
    }
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });

  if (!res.ok) {
    let code = "unknown_error";
    let message = `Request failed (${res.status})`;
    try {
      const data = (await res.json()) as {
        error?: { code?: string; message?: string; fields?: Record<string, string> };
      };
      code = data.error?.code ?? code;
      message = data.error?.message ?? message;
      const fields = data.error?.fields;
      if (fields && Object.keys(fields).length > 0) {
        const detail = Object.entries(fields)
          .map(([k, v]) => `${k}: ${v}`)
          .join("; ");
        message = `${message} (${detail})`;
      }
    } catch {
      /* ignore */
    }
    throw new ApiError(code, message, res.status);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string, token?: string, signal?: AbortSignal) => request<T>("GET", path, undefined, token, signal),
  post: <T>(path: string, body?: unknown, token?: string, signal?: AbortSignal) => request<T>("POST", path, body, token, signal),
  patch: <T>(path: string, body?: unknown, token?: string, signal?: AbortSignal) => request<T>("PATCH", path, body, token, signal),
  put: <T>(path: string, body?: unknown, token?: string, signal?: AbortSignal) => request<T>("PUT", path, body, token, signal),
  del: <T>(path: string, token?: string, signal?: AbortSignal) => request<T>("DELETE", path, undefined, token, signal),
};

export function apiErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "An unexpected error occurred";
}

export async function uploadImages(
  productId: string,
  files: File[],
  token: string,
): Promise<{ product: import("@sabacos/core").Product }> {
  const form = new FormData();
  for (const file of files) form.append("images", file);
  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  } else {
    const initData = getTelegramInitData();
    if (initData) headers["X-Telegram-Init-Data"] = initData;
  }
  const res = await fetch(`${BASE}/admin/products/${productId}/images`, {
    method: "POST",
    headers,
    body: form,
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new ApiError("upload_failed", data?.error?.message ?? "Upload failed", res.status);
  }
  return (await res.json()) as { product: import("@sabacos/core").Product };
}

export interface ProductDraft {
  nameEn: string;
  nameAm: string;
  descriptionEn: string;
  descriptionAm: string;
}

/** Resize an image to max 1024px on the longest side, returns a new File. */
async function resizeImage(file: File, maxDim = 1024): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  const bitmap = await createImageBitmap(file);
  if (bitmap.width <= maxDim && bitmap.height <= maxDim) {
    bitmap.close();
    return file;
  }
  const scale = maxDim / Math.max(bitmap.width, bitmap.height);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
  return new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" });
}

/** Uploads a photo, stores it, and asks the AI to draft the product listing. */
export async function uploadAiImage(
  file: File,
  token?: string,
): Promise<{ url: string; draft: ProductDraft | null }> {
  const resized = await resizeImage(file);
  const form = new FormData();
  form.append("image", resized);
  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  } else {
    const initData = getTelegramInitData();
    if (initData) headers["X-Telegram-Init-Data"] = initData;
  }
  const res = await fetch(`${BASE}/admin/ai/product-image`, {
    method: "POST",
    headers,
    body: form,
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new ApiError("upload_failed", data?.error?.message ?? "Upload failed", res.status);
  }
  return (await res.json()) as { url: string; draft: ProductDraft | null };
}