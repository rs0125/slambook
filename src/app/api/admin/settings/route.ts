import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { assertOrigin, handleError, json, readBody } from "@/lib/http";
import { database } from "@/lib/database";
import { demoStore } from "@/lib/demo";
import { isLocalDemo } from "@/lib/demo-mode";

export async function PATCH(request: Request) {
  try {
    await requireOwner();
    assertOrigin(request);
    const input = await readBody(
      request,
      z
        .object({
          submissions_open: z.boolean().optional(),
          welcome_text: z.string().trim().min(1).max(2000).optional(),
        })
        .strict()
        .refine((value) => Object.keys(value).length > 0),
    );
    if (isLocalDemo()) {
      await demoStore().updateSettings(input);
      return json({ ok: true });
    }
    await database().settings.update({ where: { id: 1 }, data: input });
    return json({ ok: true });
  } catch (error) {
    return handleError(error);
  }
}
