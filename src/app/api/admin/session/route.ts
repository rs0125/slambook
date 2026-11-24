import { requireOwner } from "@/lib/auth";
import { handleError, json } from "@/lib/http";
import { publicSettings } from "@/lib/settings";
import { isLocalDemo } from "@/lib/demo-mode";
export async function GET() {
  try {
    await requireOwner();
    return json({ settings: await publicSettings(), demo: isLocalDemo() });
  } catch (error) {
    return handleError(error);
  }
}
