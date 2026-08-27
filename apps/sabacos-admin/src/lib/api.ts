const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "/api/v1";

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function request<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    let code = "unknown_error";
    let message = `Request failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: { code?: string; message?: string } };
      code = data.error?.code ?? code;
      message = data.error?.message ?? message;
    } catch {
      /* ignore */
    }
    throw new ApiError(code, message, res.status);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string, token?: string) => request<T>("GET", path, undefined, token),
  post: <T>(path: string, body?: unknown, token?: string) => request<T>("POST", path, body, token),
  patch: <T>(path: string, body?: unknown, token?: string) => request<T>("PATCH", path, body, token),
  put: <T>(path: string, body?: unknown, token?: string) => request<T>("PUT", path, body, token),
  del: <T>(path: string, token?: string) => request<T>("DELETE", path, undefined, token),
};

export async function uploadImages(
  productId: string,
  files: File[],
  token: string,
): Promise<{ product: import("@sabacos/core").Product }> {
  const form = new FormData();
  for (const file of files) form.append("images", file);
  const res = await fetch(`${BASE}/admin/products/${productId}/images`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
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
  token: string,
): Promise<{ url: string; draft: ProductDraft | null }> {
  const resized = await resizeImage(file);
  const form = new FormData();
  form.append("image", resized);
  const res = await fetch(`${BASE}/admin/ai/product-image`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new ApiError("upload_failed", data?.error?.message ?? "Upload failed", res.status);
  }
  return (await res.json()) as { url: string; draft: ProductDraft | null };
}