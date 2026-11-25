import "server-only";
import { database } from "@/lib/database";
import { ApiError, dbError, tokenHash } from "@/lib/http";
import { validateImage } from "@/lib/image-validation";
import {
  type SubmissionInput,
  type uploadSchema,
  type attemptSchema,
} from "@/lib/questions";
import type { z } from "zod";
import { demoStore } from "@/lib/demo";
import { isLocalDemo } from "@/lib/demo-mode";

type Attempt = z.infer<typeof attemptSchema>;
type Prepared = {
  submitted: boolean;
  files: { id: string; verified: boolean }[];
};

export async function authorizeUploads(input: z.infer<typeof uploadSchema>) {
  if (isLocalDemo()) return demoStore().prepare(input);
  const rows = await database().$queryRaw<{ result: Prepared }[]>`
    select public.prepare_uploads(${input.requestId}::uuid,
      ${tokenHash(input.attemptToken)}, ${JSON.stringify(input.files)}::jsonb) as result
  `.catch(dbError);
  const result = rows[0].result;
  if (result.submitted) return { submitted: true, files: [] };
  return {
    submitted: false,
    files: result.files.map((file) => ({
      id: file.id,
      uploaded: file.verified,
      // The proof travels in a header, never in access logs or a public URL.
      ...(!file.verified && {
        url: `/api/uploads/${file.id}?requestId=${input.requestId}`,
      }),
    })),
  };
}

export async function pendingPhoto(attempt: Attempt, id: string) {
  const db = database();
  const saved = await db.submissionAttempt.findUnique({
    where: { id: attempt.requestId },
  });
  if (!saved || saved.token_hash !== tokenHash(attempt.attemptToken))
    throw new ApiError(
      403,
      "This upload could not be verified.",
      "INVALID_ATTEMPT",
    );
  if (saved.completed_entry_id)
    throw new ApiError(
      409,
      "This entry has already been saved.",
      "ATTEMPT_COMPLETED",
    );
  if (saved.expires_at.getTime() < Date.now())
    throw new ApiError(
      410,
      "This attempt has expired. Please retry.",
      "ATTEMPT_EXPIRED",
    );
  const file = await db.uploadFile.findFirst({
    where: { id, attempt_id: saved.id, active: true },
  });
  if (!file)
    throw new ApiError(400, "Please reselect this photo.", "INVALID_MEDIA");
  return file;
}

export async function savePhoto(
  attempt: Attempt,
  file: { id: string; size_bytes: number; mime_type: string },
  bytes: Uint8Array,
) {
  try {
    await validateImage(bytes, file);
  } catch {
    throw new ApiError(
      400,
      "Please choose a readable JPEG, PNG, or WebP photo.",
      "INVALID_MEDIA",
    );
  }
  await database().$executeRaw`
    select public.store_photo(${attempt.requestId}::uuid, ${tokenHash(attempt.attemptToken)},
      ${file.id}::uuid, ${Buffer.from(bytes)}::bytea)
  `.catch(dbError);
}

export async function finalizeSubmission(input: SubmissionInput) {
  if (isLocalDemo()) return demoStore().submit(input);
  // This transaction checks ownership, expiry, every required answer,
  // verified photo bytes and the durable receipt before inserting anything.
  await database().$queryRaw`
    select public.finalize_entry(${input.requestId}::uuid, ${tokenHash(input.attemptToken)},
      ${JSON.stringify(input.entry)}::jsonb, ${JSON.stringify(input.media)}::jsonb)
  `.catch(dbError);
  return { submitted: true };
}
