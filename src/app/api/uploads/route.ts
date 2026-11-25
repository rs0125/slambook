import {
  assertOrigin,
  handleError,
  json,
  rateLimit,
  readBody,
} from "@/lib/http";
import { uploadSchema } from "@/lib/questions";
import { authorizeUploads } from "@/lib/submissions";
import { database } from "@/lib/database";
import { isLocalDemo } from "@/lib/demo-mode";

export async function POST(request: Request) {
  try {
    if (!isLocalDemo()) database();
    assertOrigin(request);
    await rateLimit(request, "upload");
    return json(await authorizeUploads(await readBody(request, uploadSchema)));
  } catch (error) {
    return handleError(error);
  }
}
