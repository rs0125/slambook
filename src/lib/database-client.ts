import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { rootCertificates } from "node:tls";
import { SUPABASE_CA } from "./database-ca";

// Shared by the server and maintenance scripts. Never import into a client component.
export function createDatabaseClient(connectionString: string) {
  const url = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw new Error("INVALID_DATABASE_URL");
  // URL SSL options override pg's SSL object; set verified TLS in one place.
  for (const key of [
    "sslmode",
    "sslcert",
    "sslkey",
    "sslrootcert",
    "sslaccept",
  ])
    url.searchParams.delete(key);
  const adapter = new PrismaPg({
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: true, ca: [...rootCertificates, SUPABASE_CA] },
    max: 2,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 10_000,
    maxLifetimeSeconds: 300,
    query_timeout: 15_000,
    allowExitOnIdle: true,
  });
  return new PrismaClient({
    adapter,
    log: [],
    errorFormat: "minimal",
    transactionOptions: { maxWait: 10_000, timeout: 15_000 },
  });
}
