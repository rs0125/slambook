import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "prisma/config";

// Match Next's local configuration without replacing deployment variables.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const connection = process.env.DIRECT_URL || process.env.DATABASE_URL;
const url = connection ? new URL(connection) : null;
if (url) {
  // Prisma Migrate uses the engine's TLS options, not the runtime pg adapter.
  url.searchParams.set("sslmode", "require");
  url.searchParams.set("sslaccept", "strict");
  url.searchParams.set("sslcert", resolve("config/supabase-ca.crt"));
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // Generation/builds don't need credentials. Deploying migrations does.
  datasource: { url: url?.toString() ?? "postgresql://localhost/slambook" },
});
