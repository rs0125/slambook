import "server-only";
import { createClient } from "@supabase/supabase-js";
import { isLocalDemo } from "@/lib/demo-mode";

export const BUCKET = "slambook-photos";
export function isConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
    process.env.OWNER_USER_ID &&
    process.env.RATE_LIMIT_SECRET &&
    process.env.APP_ORIGIN,
  );
}
export function serviceClient() {
  if (isLocalDemo()) throw new Error("The local demo cannot access Supabase.");
  if (!isConfigured()) throw new Error("SETUP_REQUIRED");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
}
