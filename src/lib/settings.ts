import "server-only";
import { DEFAULT_WELCOME, type PublicSettings } from "@/lib/questions";
import { isConfigured, database } from "@/lib/database";
import { demoStore } from "@/lib/demo";
import { isLocalDemo } from "@/lib/demo-mode";

export async function publicSettings(): Promise<PublicSettings> {
  if (isLocalDemo()) return demoStore().settings();
  if (!isConfigured())
    return {
      submissions_open: false,
      welcome_text: DEFAULT_WELCOME,
      available: false,
    };
  try {
    const settings = await database().settings.findUnique({
      where: { id: 1 },
      select: { submissions_open: true, welcome_text: true },
    });
    if (settings) return { ...settings, available: true };
  } catch {
    // A database outage must never look like an accepted submission.
  }
  return {
    submissions_open: false,
    welcome_text: DEFAULT_WELCOME,
    available: false,
  };
}
