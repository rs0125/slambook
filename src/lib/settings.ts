import "server-only";
import { DEFAULT_WELCOME, type PublicSettings } from "@/lib/questions";
import { isConfigured, serviceClient } from "@/lib/supabase/service";
import { demoStore } from "@/lib/demo";
import { isLocalDemo } from "@/lib/demo-mode";

export async function publicSettings(): Promise<PublicSettings> {
  if (isLocalDemo()) return demoStore().settings();
  if (!isConfigured())
    return {
      submissions_open: false,
      welcome_text: DEFAULT_WELCOME,
      available: false,
    };
  const { data, error } = await serviceClient()
    .from("settings")
    .select("submissions_open, welcome_text")
    .eq("id", 1)
    .single();
  if (error || !data)
    return {
      submissions_open: false,
      welcome_text: DEFAULT_WELCOME,
      available: false,
    };
  return { ...data, available: true };
}
