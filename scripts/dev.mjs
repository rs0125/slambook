import { spawn } from "node:child_process";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const demo = args.includes("--demo");
const forwarded = args.filter((arg) => arg !== "--demo");
const env = { ...process.env };
if (demo) {
  if (env.VERCEL || env.NODE_ENV === "production")
    throw new Error(
      "The dummy-data demo is only available in local development.",
    );
  const portFlag = forwarded.findIndex(
    (arg) => arg === "--port" || arg === "-p",
  );
  const port = portFlag >= 0 ? Number(forwarded[portFlag + 1]) : 6001;
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("Choose a valid local development port.");
  if (
    forwarded.some(
      (arg) =>
        arg === "--hostname" ||
        arg.startsWith("--hostname=") ||
        arg.startsWith("-H"),
    )
  )
    throw new Error("The local demo binds only to this computer.");
  if (portFlag < 0) forwarded.push("--port", String(port));
  env.SLAMBOOK_DEMO = "1";
  env.SLAMBOOK_DEMO_PORT = String(port);
  env.SLAMBOOK_DEMO_DIR = resolve(env.SLAMBOOK_DEMO_DIR || ".local-demo");
  env.APP_ORIGIN = `http://localhost:${port}`;
  console.log(
    `Local dummy-data demo: http://localhost:${port}\nOwner dashboard: http://localhost:${port}/admin\nData stays in ${env.SLAMBOOK_DEMO_DIR}`,
  );
}
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "dev",
    "--hostname",
    demo ? "127.0.0.1" : "0.0.0.0",
    ...forwarded,
  ],
  { stdio: "inherit", env },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
