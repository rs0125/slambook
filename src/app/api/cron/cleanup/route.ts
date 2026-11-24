import { timingSafeEqual } from "node:crypto";
import { ApiError, dbError, handleError, json } from "@/lib/http";
import { serviceClient, BUCKET } from "@/lib/supabase/service";
import { deleteEntry } from "@/lib/entries";
export const maxDuration = 60;
export async function GET(request: Request) {
  try {
    const expected = process.env.CRON_SECRET
      ? `Bearer ${process.env.CRON_SECRET}`
      : "";
    const provided = request.headers.get("authorization") || "";
    if (
      !expected ||
      Buffer.byteLength(expected) !== Buffer.byteLength(provided) ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(provided))
    )
      throw new ApiError(401, "Unauthorised.");
    const db = serviceClient();
    let removed = 0;
    const { data: deleted, error: deletedError } = await db
      .from("entries")
      .select("id")
      .not("deleted_at", "is", null)
      .limit(50);
    dbError(deletedError);
    for (const entry of deleted ?? [])
      if (await deleteEntry(entry.id)) removed++;
    const cutoff = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
    const { data: candidates, error: candidateError } = await db.rpc(
      "abandoned_uploads",
      { p_before: cutoff, p_limit: 100 },
    );
    dbError(candidateError);
    if (candidates?.length) {
      const { error } = await db.storage
        .from(BUCKET)
        .remove(
          candidates.map((file: { storage_path: string }) => file.storage_path),
        );
      dbError(error);
      const { error: rowError } = await db
        .from("upload_files")
        .delete()
        .in(
          "id",
          candidates.map((file: { id: string }) => file.id),
        );
      dbError(rowError);
      removed += candidates.length;
    }
    const { error: limitError } = await db
      .from("rate_limits")
      .delete()
      .lt(
        "window_started_at",
        new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
      );
    dbError(limitError);
    const { error: attemptsError } = await db.rpc("prune_empty_attempts", {
      p_before: cutoff,
    });
    dbError(attemptsError);
    return json({ ok: true, removed });
  } catch (error) {
    return handleError(error);
  }
}
