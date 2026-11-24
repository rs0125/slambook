import { z } from "zod";
import { ApiError, assertOrigin, handleError, json } from "@/lib/http";
import { demoStore } from "@/lib/demo";
import { isLocalDemo } from "@/lib/demo-mode";
import { attemptSchema, MAX_IMAGE_BYTES } from "@/lib/questions";

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    if (!isLocalDemo()) throw new ApiError(404, "Not found.");
    assertOrigin(request);
    const id = z.uuid().parse((await context.params).id);
    const url = new URL(request.url);
    const attempt = attemptSchema.parse({
      requestId: url.searchParams.get("requestId"),
      attemptToken: url.searchParams.get("token"),
    });
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
      if (size > MAX_IMAGE_BYTES) {
        await reader.cancel();
        throw new ApiError(413, "Photos must be under 2 MB.");
      }
      chunks.push(value);
    }
    await demoStore().putPhoto(
      attempt.requestId,
      attempt.attemptToken,
      id,
      Buffer.concat(chunks),
      request.headers.get("content-type")?.split(";")[0].trim() || "",
    );
    return json({ uploaded: true });
  } catch (error) {
    return handleError(error);
  }
}
