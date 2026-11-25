import { z } from "zod";
import {
  ApiError,
  assertOrigin,
  handleError,
  json,
  rateLimit,
} from "@/lib/http";
import { attemptSchema, MAX_IMAGE_BYTES } from "@/lib/questions";
import { pendingPhoto, savePhoto } from "@/lib/submissions";
import { isLocalDemo } from "@/lib/demo-mode";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    if (isLocalDemo()) throw new ApiError(404, "Not found.");
    assertOrigin(request);
    await rateLimit(request, "photo");
    const id = z.uuid().parse((await context.params).id);
    const attempt = attemptSchema.parse({
      requestId: new URL(request.url).searchParams.get("requestId"),
      attemptToken: request.headers.get("x-submission-token"),
    });
    const file = await pendingPhoto(attempt, id);
    if (
      request.headers.get("content-type")?.split(";")[0].trim() !==
      file.mime_type
    )
      throw new ApiError(
        415,
        "This photo type does not match the selected file.",
        "INVALID_MEDIA",
      );
    if (Number(request.headers.get("content-length")) > MAX_IMAGE_BYTES)
      throw new ApiError(413, "Photos must be under 2 MB.");
    const reader = request.body?.getReader();
    if (!reader) throw new ApiError(400, "Please select a photo.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > Math.min(file.size_bytes, MAX_IMAGE_BYTES)) {
        await reader.cancel();
        throw new ApiError(
          413,
          "This photo is larger than the selected file.",
          "INVALID_MEDIA",
        );
      }
      chunks.push(value);
    }
    await savePhoto(attempt, file, Buffer.concat(chunks));
    return json({ uploaded: true });
  } catch (error) {
    return handleError(error);
  }
}
