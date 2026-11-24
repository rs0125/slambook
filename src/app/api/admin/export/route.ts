import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { ApiError, dbError, handleError } from "@/lib/http";
import { serviceClient, BUCKET } from "@/lib/supabase/service";
import {
  collectExportEntries,
  createExportStream,
  EXPORT_PAGE_SIZE,
} from "@/lib/export";
import type { EntryRecord } from "@/lib/questions";
import { demoStore } from "@/lib/demo";
import { isLocalDemo } from "@/lib/demo-mode";
import { quoteFilterValue } from "@/lib/postgrest-filters";
export const maxDuration = 300;
export async function GET(request: Request) {
  try {
    await requireOwner();
    const demo = isLocalDemo() ? demoStore() : null;
    const db = demo ? null : serviceClient();
    const rawId = new URL(request.url).searchParams.get("id");
    const id = rawId ? z.uuid().parse(rawId) : undefined;
    const snapshot = new Date().toISOString();
    const entries = demo
      ? await demo.exportEntries(id)
      : await collectExportEntries(async (cursor) => {
          let query = db!
            .from("entries")
            .select(
              "id,name,nickname,answers,contact_handle,created_at,questionnaire_version,entry_media(*)",
            )
            .is("deleted_at", null)
            .lte("created_at", snapshot)
            .order("created_at")
            .order("id")
            .limit(EXPORT_PAGE_SIZE)
            .abortSignal(request.signal);
          if (id) query = query.eq("id", id);
          if (cursor)
            query = query.or(
              `created_at.gt.${quoteFilterValue(cursor.created_at)},and(created_at.eq.${quoteFilterValue(cursor.created_at)},id.gt.${quoteFilterValue(cursor.id)})`,
            );
          const { data, error } = await query;
          dbError(error);
          if (!data)
            throw new ApiError(
              503,
              "Your export couldn’t be prepared. Please try again.",
            );
          return data as EntryRecord[];
        });
    if (id && !entries.length)
      throw new ApiError(404, "This entry could not be found.");
    entries.forEach((entry) =>
      entry.entry_media.sort((a, b) => a.sort_order - b.sort_order),
    );
    const stream = createExportStream(
      entries,
      async (path, signal) => {
        if (demo) return demo.download(path, signal);
        const { data, error } = await db!.storage
          .from(BUCKET)
          .download(path, {}, { signal });
        if (error || !data)
          throw new Error(
            "Export interrupted: a photo could not be downloaded.",
          );
        return new Uint8Array(await data.arrayBuffer());
      },
      request.signal,
    );
    return new Response(stream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="raghavs-slambook-${snapshot.slice(0, 10)}.zip"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
