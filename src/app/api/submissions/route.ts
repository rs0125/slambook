import {
  assertOrigin,
  handleError,
  json,
  rateLimit,
  readBody,
} from "@/lib/http";
import { submissionSchema } from "@/lib/questions";
import { finalizeSubmission } from "@/lib/submissions";
import { database } from "@/lib/database";
import { isLocalDemo } from "@/lib/demo-mode";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    if (!isLocalDemo()) database();
    assertOrigin(request);
    await rateLimit(request, "submit");
    return json(
      await finalizeSubmission(await readBody(request, submissionSchema)),
    );
  } catch (error) {
    return handleError(error);
  }
}
