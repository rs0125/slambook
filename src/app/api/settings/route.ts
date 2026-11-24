import { json } from "@/lib/http";
import { publicSettings } from "@/lib/settings";
export async function GET() {
  return json(await publicSettings());
}
