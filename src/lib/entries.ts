import "server-only";
import { serviceClient, BUCKET } from "@/lib/supabase/service";
import { dbError } from "@/lib/http";
import type { EntryRecord } from "@/lib/questions";
import { demoStore } from "@/lib/demo";
import { isLocalDemo } from "@/lib/demo-mode";
import {
  literalSearchPattern,
  quoteFilterValue,
} from "@/lib/postgrest-filters";

export async function listEntries(search = "", page = 1) {
  if (isLocalDemo()) return demoStore().list(search, page);
  const db = serviceClient();
  let query = db
    .from("entries")
    .select(
      "id,name,nickname,answers,contact_handle,questionnaire_version,created_at,entry_media(id)",
      { count: "exact" },
    )
    .is("deleted_at", null);
  const clean = literalSearchPattern(search);
  if (clean)
    query = query.or(
      `name.imatch.${quoteFilterValue(clean)},nickname.imatch.${quoteFilterValue(clean)}`,
    );
  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range((page - 1) * 12, page * 12 - 1);
  dbError(error);
  return { entries: data ?? [], total: count ?? 0, page };
}
export async function getEntry(id: string): Promise<EntryRecord | null> {
  if (isLocalDemo()) return demoStore().get(id);
  const { data, error } = await serviceClient()
    .from("entries")
    .select("*,entry_media(*)")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  dbError(error);
  if (data)
    data.entry_media.sort(
      (a: { sort_order: number }, b: { sort_order: number }) =>
        a.sort_order - b.sort_order,
    );
  return data as EntryRecord | null;
}
export async function deleteEntry(id: string): Promise<boolean> {
  if (isLocalDemo()) return demoStore().delete(id);
  const db = serviceClient();
  // Hide immediately from every read, including the authenticated photo proxy.
  const { error: markError } = await db
    .from("entries")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  dbError(markError);
  const { data: media, error: mediaError } = await db
    .from("entry_media")
    .select("storage_path")
    .eq("entry_id", id);
  dbError(mediaError);
  if (media?.length) {
    const { error } = await db.storage
      .from(BUCKET)
      .remove(media.map((item) => item.storage_path));
    if (error) return false; // Durable tombstone; the daily cleanup retries deletion.
  }
  const { error } = await db.from("entries").delete().eq("id", id);
  dbError(error);
  return true;
}
