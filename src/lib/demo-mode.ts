// This switch is server-only configuration, never a public browser variable.
export class DemoError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "DEMO_ERROR",
  ) {
    super(message);
  }
}

export function isLocalDemo(env = process.env) {
  return (
    env.SLAMBOOK_DEMO === "1" && env.NODE_ENV === "development" && !env.VERCEL
  );
}

export function isDemoHost(host: string | null) {
  if (!host) return false;
  const match = /^(localhost|127\.0\.0\.1|\[::1\]):([0-9]{1,5})$/i.exec(host);
  const port = process.env.SLAMBOOK_DEMO_PORT || "6001";
  return Boolean(
    match && match[2] === port && Number(port) > 0 && Number(port) <= 65535,
  );
}
