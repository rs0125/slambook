import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { ApiError, handleError } from "@/lib/http";
import { readPhoto } from "@/lib/entries";
import { demoStore } from "@/lib/demo";
import { isLocalDemo } from "@/lib/demo-mode";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireOwner();
    const id = z.uuid().parse((await context.params).id);
    const photo = isLocalDemo()
      ? await demoStore().photo(id)
      : await readPhoto({ id }, request.signal);
    if (!photo) throw new ApiError(404, "This photo could not be found.");
    return new Response(new Uint8Array(photo.bytes), {
      headers: {
        "Content-Type": photo.mime,
        "Content-Length": String(photo.bytes.length),
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
