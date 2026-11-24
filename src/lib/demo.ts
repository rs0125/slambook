import "server-only";
import { resolve } from "node:path";
import { isLocalDemo } from "./demo-mode";
import { DemoStore } from "./demo-store";

// Keep the mutation queue shared when Next.js reloads modules in development.
const shared = globalThis as typeof globalThis & { slambookDemo?: DemoStore };
export function demoStore() {
  if (process.env.NODE_ENV !== "development" || !isLocalDemo())
    throw new Error("Local demo is disabled.");
  return (shared.slambookDemo ??= new DemoStore(
    // This runtime development directory must never enter deployment traces.
    resolve(
      /* turbopackIgnore: true */ process.env.SLAMBOOK_DEMO_DIR ||
        ".local-demo",
    ),
  ));
}
