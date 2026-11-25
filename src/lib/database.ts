import "server-only";
import { isLocalDemo } from "@/lib/demo-mode";
import { createDatabaseClient } from "@/lib/database-client";

export function isConfigured() {
  return Boolean(
    process.env.DATABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
    process.env.OWNER_USER_ID &&
    process.env.RATE_LIMIT_SECRET &&
    process.env.APP_ORIGIN,
  );
}

const globalDatabase = globalThis as typeof globalThis & {
  slambookDatabase?: ReturnType<typeof createDatabaseClient>;
};

export function database() {
  if (isLocalDemo())
    throw new Error("The local demo cannot access the database.");
  if (!isConfigured()) throw new Error("SETUP_REQUIRED");
  return (globalDatabase.slambookDatabase ??= createDatabaseClient(
    process.env.DATABASE_URL!,
  ));
}
