import { z } from "zod";
import { authClient } from "@/lib/supabase/server";
import { database } from "@/lib/database";
import {
  ApiError,
  assertOrigin,
  handleError,
  json,
  rateLimit,
  readBody,
} from "@/lib/http";
import { requireOwner } from "@/lib/auth";
import { isLocalDemo } from "@/lib/demo-mode";

export async function POST(request: Request) {
  try {
    if (isLocalDemo()) {
      assertOrigin(request);
      await requireOwner();
      return json({ ok: true });
    }
    database();
    assertOrigin(request);
    await rateLimit(request, "login");
    const credentials = await readBody(
      request,
      z
        .object({
          email: z.email().max(254),
          password: z.string().min(1).max(200),
        })
        .strict(),
    );
    const client = await authClient();
    const { error } = await client.auth.signInWithPassword(credentials);
    if (error)
      throw new ApiError(
        401,
        "That email and password didn’t match. Please try again.",
      );
    try {
      await requireOwner();
    } catch {
      await client.auth.signOut({ scope: "local" });
      throw new ApiError(403, "This account isn’t the owner of this book.");
    }
    return json({ ok: true });
  } catch (error) {
    return handleError(error);
  }
}
