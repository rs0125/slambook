import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { ApiError, dbError, handleError } from "@/lib/http";
import { serviceClient, BUCKET } from "@/lib/supabase/service";
import { demoStore } from "@/lib/demo";
import { isLocalDemo } from "@/lib/demo-mode";
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireOwner();
    const id = z.uuid().parse((await context.params).id);
    if (isLocalDemo()) {
      const photo = await demoStore().photo(id);
      return new Response(new Uint8Array(photo.bytes), {
        headers: {
          "Content-Type": photo.mime,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    const db = serviceClient();
    const { data: media, error } = await db
      .from("entry_media")
      .select("storage_path,mime_type,entries!inner(deleted_at)")
      .eq("id", id)
      .is("entries.deleted_at", null)
      .maybeSingle();
    dbError(error);
    if (!media) throw new ApiError(404, "This photo could not be found.");
    const { data: file, error: downloadError } = await db.storage
      .from(BUCKET)
      .download(media.storage_path);
    if (downloadError || !file)
      throw new ApiError(404, "This photo is unavailable.");
    return new Response(file, {
      headers: {
        "Content-Type": media.mime_type,
        "Content-Length": String(file.size),
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
