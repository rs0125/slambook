import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createDatabaseClient } from "../src/lib/database-client";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const directUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
const owner = process.env.OWNER_USER_ID;
if (!directUrl || !owner || !/^[a-f0-9-]{36}$/i.test(owner))
  throw new Error(
    "Set DIRECT_URL and the confirmed owner's OWNER_USER_ID first.",
  );

const db = createDatabaseClient(directUrl);
try {
  const accounts = await db.$queryRaw<{ id: string }[]>`
    select id from auth.users where id = ${owner}::uuid and email_confirmed_at is not null
  `;
  if (accounts.length !== 1)
    throw new Error("The owner must be a confirmed Supabase Auth user.");
  const previous = await db.settings.findUniqueOrThrow({ where: { id: 1 } });
  if (previous.owner_id && previous.owner_id !== owner)
    throw new Error(
      "This database already belongs to another owner; no changes made.",
    );
  const roles = await db.$queryRaw<
    {
      rolsuper: boolean;
      rolcreaterole: boolean;
      rolcreatedb: boolean;
      rolbypassrls: boolean;
    }[]
  >`
    select rolsuper, rolcreaterole, rolcreatedb, rolbypassrls from pg_roles where rolname = 'slambook_app'
  `;
  if (roles.length !== 1 || Object.values(roles[0]).some(Boolean))
    throw new Error(
      "Apply the migrations first; the runtime role must be unprivileged.",
    );

  const current = process.env.DATABASE_URL
    ? new URL(process.env.DATABASE_URL)
    : null;
  const password =
    current?.username.split(".")[0] === "slambook_app"
      ? decodeURIComponent(current.password)
      : randomBytes(32).toString("hex");
  // Only a generated hexadecimal password can enter this DDL statement. SQL
  // does not accept bind parameters in ALTER ROLE. Never log the statement.
  if (!/^[a-f0-9]{64}$/.test(password))
    throw new Error(
      "The runtime credential is not a generated application password.",
    );
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `alter role slambook_app login password '${password}'`,
    );
    await tx.$executeRawUnsafe(
      "alter role slambook_app set statement_timeout = '15s'",
    );
    await tx.settings.update({ where: { id: 1 }, data: { owner_id: owner } });
  });

  const runtime = new URL(directUrl);
  const project = runtime.username.includes(".")
    ? runtime.username.split(".").slice(1).join(".")
    : "";
  runtime.username = project ? `slambook_app.${project}` : "slambook_app";
  runtime.password = password;
  let local = existsSync(".env.local")
    ? readFileSync(".env.local", "utf8")
    : "";
  const values: Record<string, string> = {
    DIRECT_URL: directUrl,
    DATABASE_URL: runtime.toString(),
    OWNER_USER_ID: owner,
    RATE_LIMIT_SECRET:
      process.env.RATE_LIMIT_SECRET || randomBytes(32).toString("hex"),
    CRON_SECRET: process.env.CRON_SECRET || randomBytes(32).toString("hex"),
  };
  local = local.replace(/^SUPABASE_SERVICE_ROLE_KEY=.*\n?/gm, "");
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${JSON.stringify(value)}`;
    const pattern = new RegExp(`^${key}=.*$`, "m");
    local = pattern.test(local)
      ? local.replace(pattern, () => line)
      : `${local.trimEnd()}\n${line}\n`;
  }
  writeFileSync(".env.local", local, { mode: 0o600 });
  chmodSync(".env.local", 0o600);
  console.log(
    "Owner configured. Restricted runtime credentials saved only in .env.local.",
  );
} catch (error) {
  // Prisma exceptions may contain queries and values. Keep credentials out of logs.
  console.error(
    "Database setup failed:",
    error instanceof Error && !error.name.startsWith("Prisma")
      ? error.message
      : "Database operation failed",
  );
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
