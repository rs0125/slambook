import { timingSafeEqual } from "node:crypto";
import { ApiError, handleError, json } from "@/lib/http";
import { database } from "@/lib/database";

export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const expected = process.env.CRON_SECRET
      ? `Bearer ${process.env.CRON_SECRET}`
      : "";
    const provided = request.headers.get("authorization") || "";
    if (
      !expected ||
      Buffer.byteLength(expected) !== Buffer.byteLength(provided) ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(provided))
    )
      throw new ApiError(401, "Unauthorised.");
    const db = database();
    const cutoff = new Date(Date.now() - 26 * 60 * 60 * 1000);
    const removed = await db.$transaction(async (tx) => {
      const deleted = await tx.entry.deleteMany({
        where: { deleted_at: { not: null } },
      });
      const candidates = await tx.$queryRaw<{ id: string }[]>`
        select id from public.abandoned_uploads(${cutoff}::timestamptz, 100)
      `;
      const uploads = await tx.uploadFile.deleteMany({
        where: { id: { in: candidates.map((row) => row.id) }, media: null },
      });
      await tx.rateLimit.deleteMany({
        where: {
          window_started_at: { lt: new Date(Date.now() - 48 * 60 * 60 * 1000) },
        },
      });
      await tx.$executeRaw`select public.prune_empty_attempts(${cutoff}::timestamptz)`;
      return deleted.count + uploads.count;
    });
    return json({ ok: true, removed });
  } catch (error) {
    return handleError(error);
  }
}
