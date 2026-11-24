import type { z } from "zod";
import { IMAGE_TYPES, MAX_IMAGE_BYTES } from "./questions";

export class RequestError extends Error {
  constructor(
    message: string,
    public code?: string,
    public fields?: Record<string, string>,
    public status?: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  url: string,
  init?: RequestInit,
  options: { timeoutMs?: number; schema?: z.ZodType<T> } = {},
): Promise<T> {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(init?.signal?.reason);
  if (init?.signal?.aborted) forwardAbort();
  else init?.signal?.addEventListener("abort", forwardAbort, { once: true });
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 30_000,
  );
  try {
    const headers = new Headers(init?.headers);
    if (!headers.has("Content-Type"))
      headers.set("Content-Type", "application/json");
    const response = await fetch(url, {
      ...init,
      headers,
      cache: "no-store",
      signal: controller.signal,
    });
    const result: unknown = await response.json().catch(() => null);
    if (controller.signal.aborted) throw controller.signal.reason;
    const object =
      result && typeof result === "object" && !Array.isArray(result)
        ? (result as Record<string, unknown>)
        : null;
    if (!response.ok) {
      const fields =
        object?.fields && typeof object.fields === "object"
          ? (Object.fromEntries(
              Object.entries(object.fields).filter(
                ([, value]) => typeof value === "string",
              ),
            ) as Record<string, string>)
          : undefined;
      throw new RequestError(
        typeof object?.error === "string"
          ? object.error
          : "That didn’t go through. Please try again.",
        typeof object?.code === "string" ? object.code : undefined,
        fields,
        response.status,
      );
    }
    const contentType = response.headers
      .get("content-type")
      ?.split(";")[0]
      .trim()
      .toLowerCase();
    const parsed = options.schema?.safeParse(result);
    if (
      !object ||
      !contentType ||
      !(contentType === "application/json" || contentType.endsWith("+json")) ||
      (parsed && !parsed.success)
    )
      throw new RequestError(
        "The book returned an incomplete response. Please retry.",
        "INVALID_RESPONSE",
        undefined,
        response.status,
      );
    return (parsed?.success ? parsed.data : result) as T;
  } catch (error) {
    if (init?.signal?.aborted) throw init.signal.reason;
    if (controller.signal.aborted)
      throw new RequestError(
        "This is taking longer than expected. Please try again.",
        "REQUEST_TIMEOUT",
      );
    if (error instanceof RequestError) throw error;
    throw new RequestError(
      "Couldn’t reach the book. Check your connection and try again.",
    );
  } finally {
    clearTimeout(timer);
    init?.signal?.removeEventListener("abort", forwardAbort);
  }
}
export function newAttempt() {
  return {
    requestId: crypto.randomUUID(),
    attemptToken: Array.from(crypto.getRandomValues(new Uint8Array(32)), (n) =>
      n.toString(16).padStart(2, "0"),
    ).join(""),
  };
}
export async function compressPhoto(file: File): Promise<File> {
  if (!IMAGE_TYPES.some((type) => type === file.type))
    throw new Error(
      "Please choose a JPEG, PNG, or WebP photo. For HEIC photos, export a JPEG first.",
    );
  if (file.size > 20 * 1024 * 1024)
    throw new Error(
      "That original photo is over 20 MB. Please choose a smaller version.",
    );
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode().catch(() => {
      throw new Error(
        "We couldn’t open that photo. Please choose another one.",
      );
    });
    if (image.naturalWidth * image.naturalHeight > 40_000_000)
      throw new Error(
        "That photo is very large. Please resize it to under 40 megapixels first.",
      );
    const canvas = document.createElement("canvas");
    const scale = Math.min(
      1,
      2000 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context)
      throw new Error("Photo preparation is unavailable in this browser.");
    const draw = () => {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
    };
    let result: Blob | null = null;
    for (let pass = 0; pass < 7; pass++) {
      draw();
      result = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", Math.max(0.5, 0.86 - pass * 0.06)),
      );
      if (result && result.size <= 512_000) break;
      if (pass >= 2) {
        canvas.width = Math.max(1, Math.round(canvas.width * 0.8));
        canvas.height = Math.max(1, Math.round(canvas.height * 0.8));
      }
    }
    if (!result?.size || result.size > MAX_IMAGE_BYTES)
      throw new Error(
        "This photo couldn’t be made small enough. Please choose another version.",
      );
    return new File([result], `${file.name.replace(/\.[^.]+$/, "")}.jpg`, {
      type: "image/jpeg",
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
export function uploadPhoto(
  url: string,
  file: File,
  onProgress: (percentage: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.setRequestHeader("cache-control", "private, max-age=0");
    xhr.timeout = 120_000;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(
            new Error(
              "A photo didn’t finish uploading. Your answers are safe — please retry.",
            ),
          );
    xhr.onerror = xhr.ontimeout = () =>
      reject(
        new Error(
          "The photo upload was interrupted. Reconnect and retry; your answers are safe.",
        ),
      );
    xhr.send(file);
  });
}
