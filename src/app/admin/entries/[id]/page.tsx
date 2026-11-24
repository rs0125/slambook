import { notFound } from "next/navigation";
import { z } from "zod";
import { AdminApp } from "@/components/admin-app";
import { isConfigured } from "@/lib/supabase/service";
export default async function EntryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  return <AdminApp configured={isConfigured()} entryId={id} />;
}
