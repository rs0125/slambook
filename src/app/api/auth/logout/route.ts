import { authClient } from "@/lib/supabase/server";
import { ApiError, assertOrigin, handleError, json } from "@/lib/http";
import { isLocalDemo } from "@/lib/demo-mode";
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    if (isLocalDemo()) return json({ ok: true });
    const { error } = await (await authClient()).auth.signOut();
    if (error)
      throw new ApiError(503, "Sign-out couldn’t finish. Please try again.");
    return json({ ok: true });
  } catch (error) {
    return handleError(error);
  }
}
