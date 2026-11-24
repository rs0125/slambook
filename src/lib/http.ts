import "server-only";
import { createHash, createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { serviceClient } from "@/lib/supabase/service";
import { DemoError, isDemoHost, isLocalDemo } from "@/lib/demo-mode";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "REQUEST_FAILED",
  ) {
    super(message);
  }
}
export const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}
export async function readBody<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new ApiError(415, "Please send JSON.");
  if (Number(request.headers.get("content-length")) > 98_304)
    throw new ApiError(413, "This request is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "A request body is required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 98_304) {
      await reader.cancel();
      throw new ApiError(413, "This request is too large.");
    }
    chunks.push(value);
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError(400, "This request could not be read.");
  }
  return schema.parse(body);
}
export function assertOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (isLocalDemo()) {
    const host = request.headers.get("host");
    if (!isDemoHost(host) || origin !== `http://${host}`)
      throw new ApiError(
        403,
        "Open the local demo on this computer to make changes.",
      );
    return;
  }
  const expected = process.env.APP_ORIGIN;
  if (!expected || origin !== new URL(expected).origin)
    throw new ApiError(403, "This request must come from the slam book.");
}
export async function rateLimit(
  request: Request,
  action: "upload" | "submit" | "login",
) {
  if (isLocalDemo()) return;
  // Vercel overwrites x-vercel-forwarded-for. Never trust arbitrary x-forwarded-for.
  const header = process.env.VERCEL
    ? "x-vercel-forwarded-for"
    : process.env.TRUSTED_IP_HEADER;
  const ip =
    (header ? request.headers.get(header)?.split(",")[0]?.trim() : null) ||
    "shared-origin";
  const key = createHmac("sha256", process.env.RATE_LIMIT_SECRET!)
    .update(`${action}:${ip}`)
    .digest("hex");
  const { data, error } = await serviceClient().rpc("consume_rate_limit", {
    p_key: key,
    p_limit: action === "login" ? 10 : 30,
    p_window_seconds: 3600,
  });
  if (error) throw new ApiError(503, "Please try again in a moment.");
  if (!data)
    throw new ApiError(
      429,
      "A few too many attempts. Please try again in an hour.",
      "RATE_LIMITED",
    );
}
export function dbError(error: { message: string } | null) {
  if (!error) return;
  const codes: Record<string, [number, string]> = {
    SUBMISSIONS_CLOSED: [
      409,
      "This book is taking a little pause. New entries are closed.",
    ],
    ATTEMPT_EXPIRED: [
      410,
      "This submission attempt has expired. Your answers are safe; please try again.",
    ],
    INVALID_ATTEMPT: [403, "This submission attempt could not be verified."],
    INVALID_MEDIA: [400, "Please reselect your photos and try again."],
    INVALID_ENTRY: [400, "Please check your answers and try again."],
  };
  for (const [code, [status, message]] of Object.entries(codes))
    if (error.message.includes(code)) throw new ApiError(status, message, code);
  throw new ApiError(
    503,
    "The book couldn’t save that just now. Your answers are safe. Please try again.",
  );
}
export function handleError(error: unknown) {
  if (error instanceof z.ZodError)
    return json(
      {
        error: "Please check the highlighted answers.",
        fields: Object.fromEntries(
          error.issues.map((i) => [i.path.join("."), i.message]),
        ),
      },
      400,
    );
  if (error instanceof ApiError || error instanceof DemoError) {
    const response = json(
      { error: error.message, code: error.code },
      error.status,
    );
    if (error.status === 429) response.headers.set("Retry-After", "3600");
    return response;
  }
  if (error instanceof Error && error.message === "SETUP_REQUIRED")
    return json(
      {
        error:
          "Raghav is getting the book ready. Please come back soon — your text draft is saved on this device.",
        code: "SETUP_REQUIRED",
      },
      503,
    );
  // Never log submitted answers, tokens, contact details, or storage credentials.
  console.error(
    "Slambook request failed:",
    error instanceof Error ? error.name : "Unknown error",
  );
  return json(
    { error: "Something went wrong. Your answers are safe; please try again." },
    500,
  );
}
