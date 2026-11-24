import { requireOwner } from "@/lib/auth";
import { listEntries } from "@/lib/entries";
import { handleError, json } from "@/lib/http";
export async function GET(request: Request) {
  try {
    await requireOwner();
    const url = new URL(request.url);
    const page = Math.max(
      1,
      Math.min(
        10000,
        Number.parseInt(url.searchParams.get("page") || "1", 10) || 1,
      ),
    );
    return json(await listEntries(url.searchParams.get("q") || "", page));
  } catch (error) {
    return handleError(error);
  }
}
