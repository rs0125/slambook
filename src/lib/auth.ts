import "server-only";
import { authClient } from "@/lib/supabase/server";
import { isConfigured, serviceClient } from "@/lib/supabase/service";
import { ApiError } from "@/lib/http";
import { isOwnerIdentity } from "@/lib/questions";
import { headers } from "next/headers";
import { isDemoHost, isLocalDemo } from "@/lib/demo-mode";

export async function requireOwner() {
  if (isLocalDemo()) {
    if (!isDemoHost((await headers()).get("host")))
      throw new ApiError(403, "The dummy-data demo is only available locally.");
    return { id: "00000000-0000-4000-8000-000000000001" };
  }
  if (!isConfigured()) throw new ApiError(401, "Owner sign-in is required.");
  const client = await authClient();
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error || !user) throw new ApiError(401, "Owner sign-in is required.");
  if (!isOwnerIdentity(user.id, process.env.OWNER_USER_ID))
    throw new ApiError(403, "This book belongs to another owner.");
  const { data: settings, error: settingsError } = await serviceClient()
    .from("settings")
    .select("owner_id")
    .eq("id", 1)
    .single();
  if (settingsError || settings?.owner_id !== user.id)
    throw new ApiError(
      403,
      "The book’s owner configuration needs to be checked.",
    );
  return user;
}
