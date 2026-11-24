import "server-only";
import { serviceClient, BUCKET } from "@/lib/supabase/service";
import { ApiError, dbError, tokenHash } from "@/lib/http";
import { validateImage } from "@/lib/image-validation";
import { type SubmissionInput, type uploadSchema } from "@/lib/questions";
import type { z } from "zod";
import { demoStore } from "@/lib/demo";
import { isLocalDemo } from "@/lib/demo-mode";

type UploadRow = {
  id: string;
  attempt_id: string;
  storage_path: string;
  size_bytes: number;
  mime_type: string;
  verified: boolean;
};
export async function authorizeUploads(input: z.infer<typeof uploadSchema>) {
  if (isLocalDemo()) return demoStore().prepare(input);
  const db = serviceClient();
  const { data, error } = await db.rpc("prepare_uploads", {
    p_request_id: input.requestId,
    p_token_hash: tokenHash(input.attemptToken),
    p_files: input.files,
  });
  dbError(error);
  if (data.submitted) return { submitted: true, files: [] };
  const files = [];
  for (const file of data.files as UploadRow[]) {
    // Reuse completed uploads after a lost response; signed tokens never allow overwrite.
    const { data: existing } = await db.storage
      .from(BUCKET)
      .info(file.storage_path);
    if (existing) {
      files.push({ id: file.id, uploaded: true });
      continue;
    }
    const { data: signed, error: signError } = await db.storage
      .from(BUCKET)
      .createSignedUploadUrl(file.storage_path, { upsert: false });
    dbError(signError);
    if (!signed)
      throw new ApiError(
        503,
        "Couldn’t prepare your photos. Please try again.",
      );
    files.push({ id: file.id, uploaded: false, url: signed.signedUrl });
  }
  return { submitted: false, files };
}

export async function finalizeSubmission(input: SubmissionInput) {
  if (isLocalDemo()) return demoStore().submit(input);
  const db = serviceClient();
  const hash = tokenHash(input.attemptToken);
  const { data: attempt, error: attemptError } = await db
    .from("submission_attempts")
    .select("token_hash, completed_entry_id, expires_at")
    .eq("id", input.requestId)
    .maybeSingle();
  dbError(attemptError);
  if (!attempt || attempt.token_hash !== hash)
    throw new ApiError(
      403,
      "This submission attempt could not be verified.",
      "INVALID_ATTEMPT",
    );
  if (attempt.completed_entry_id) return { submitted: true };
  if (Date.parse(attempt.expires_at) < Date.now())
    throw new ApiError(
      410,
      "This attempt has expired. Please try again; your answers are safe.",
      "ATTEMPT_EXPIRED",
    );
  const { data: settings, error: settingsError } = await db
    .from("settings")
    .select("submissions_open")
    .eq("id", 1)
    .single();
  dbError(settingsError);
  if (!settings?.submissions_open)
    throw new ApiError(
      409,
      "New entries are currently closed.",
      "SUBMISSIONS_CLOSED",
    );
  const { data: files, error: filesError } = await db
    .from("upload_files")
    .select("*")
    .eq("attempt_id", input.requestId)
    .eq("active", true);
  dbError(filesError);
  if (
    !files ||
    files.length !== input.media.length ||
    input.media.some((media) => !files.some((file) => file.id === media.id))
  )
    throw new ApiError(
      400,
      "Please reselect your photos and try again.",
      "INVALID_MEDIA",
    );
  for (const file of files as UploadRow[]) {
    const { data: blob, error } = await db.storage
      .from(BUCKET)
      .download(file.storage_path);
    if (error || !blob)
      throw new ApiError(
        400,
        "One of your photos hasn’t finished uploading. Please retry.",
        "UPLOAD_INCOMPLETE",
      );
    try {
      await validateImage(new Uint8Array(await blob.arrayBuffer()), file);
    } catch {
      // Removing invalid bytes permits a retry with the same path-scoped token.
      const { error: removalError } = await db.storage
        .from(BUCKET)
        .remove([file.storage_path]);
      if (removalError)
        throw new ApiError(
          503,
          "We couldn’t reset this photo. Please try again.",
        );
      throw new ApiError(
        400,
        "A photo couldn’t be read. Please remove it and select a JPEG, PNG, or WebP photo.",
        "INVALID_MEDIA",
      );
    }
    const { error: verifyError } = await db
      .from("upload_files")
      .update({ verified: true })
      .eq("id", file.id)
      .eq("attempt_id", input.requestId);
    dbError(verifyError);
  }
  const { error } = await db.rpc("finalize_entry", {
    p_request_id: input.requestId,
    p_token_hash: hash,
    p_entry: input.entry,
    p_media: input.media,
  });
  dbError(error);
  return { submitted: true };
}
