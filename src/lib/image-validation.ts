import sharp from "sharp";
import { MAX_IMAGE_BYTES } from "./questions";

export async function validateImage(
  bytes: Uint8Array,
  expected: { size_bytes: number; mime_type: string },
) {
  if (
    !bytes.length ||
    bytes.length > MAX_IMAGE_BYTES ||
    bytes.length !== expected.size_bytes
  )
    throw new Error("INVALID_IMAGE_SIZE");
  const image = sharp(bytes, {
    limitInputPixels: 40_000_000,
    failOn: "warning",
  });
  const meta = await image.metadata();
  const types: Record<string, string> = {
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
  };
  if (
    !meta.format ||
    types[meta.format] !== expected.mime_type ||
    !meta.width ||
    !meta.height ||
    (meta.pages ?? 1) > 1
  )
    throw new Error("INVALID_IMAGE_TYPE");
  // Decode as well as inspect the header; reject corrupt/truncated or oversized images.
  await image.resize(1, 1).raw().toBuffer();
}
