import {
  assertOrigin,
  handleError,
  json,
  rateLimit,
  readBody,
} from "@/lib/http";
import { uploadSchema } from "@/lib/questions";
import { authorizeUploads } from "@/lib/submissions";
import { serviceClient } from "@/lib/supabase/service";
import { isLocalDemo } from "@/lib/demo-mode";

export async function POST(request: Request) {
  try {
    if (!isLocalDemo()) serviceClient();
    assertOrigin(request);
    await rateLimit(request, "upload");
    return json(await authorizeUploads(await readBody(request, uploadSchema)));
  } catch (error) {
    return handleError(error);
  }
}
