import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { getEntry, deleteEntry } from "@/lib/entries";
import { ApiError, assertOrigin, handleError, json } from "@/lib/http";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  try {
    await requireOwner();
    const id = z.uuid().parse((await context.params).id);
    const entry = await getEntry(id);
    if (!entry) throw new ApiError(404, "This entry could not be found.");
    return json({ entry });
  } catch (error) {
    return handleError(error);
  }
}
export async function DELETE(request: Request, context: Context) {
  try {
    await requireOwner();
    assertOrigin(request);
    const id = z.uuid().parse((await context.params).id);
    return json({ deleted: true, photosRemoved: await deleteEntry(id) });
  } catch (error) {
    return handleError(error);
  }
}
