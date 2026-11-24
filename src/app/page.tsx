import Link from "next/link";
import { Icon } from "@/components/icons";
import { publicSettings } from "@/lib/settings";
import { DEFAULT_WELCOME } from "@/lib/questions";
import { isLocalDemo } from "@/lib/demo-mode";
import styles from "./cover.module.css";
import { AuroraBackground } from "@/components/aurora-background";

export const dynamic = "force-dynamic";
export default async function Home() {
  const settings = await publicSettings();
  const closed = settings.available && !settings.submissions_open;
  const note =
    settings.welcome_text === DEFAULT_WELCOME
      ? "For old stories, inside jokes, and memories still to come."
      : settings.welcome_text;

  return (
    <>
      {!isLocalDemo() && (
        <div className="book-banner">
          A little book of old stories and new memories.
        </div>
      )}
      <main id="main" className={`book-cover ${styles.cover}`}>
        <AuroraBackground />
        <Link href="/admin" className={styles.owner}>
          <Icon name="lock" width="14" height="14" />
          Owner’s corner
        </Link>
        <div className={styles.center}>
          <h1 className={styles.title}>
            Raghav’s <span>Slambook</span>
          </h1>
          <Link href="/sign" className={`button button-primary ${styles.sign}`}>
            {closed ? "Visit the slam book" : "Sign my slam book"}
            <Icon name="chevron" width="16" height="16" />
          </Link>
        </div>
        <p className={styles.note}>{note}</p>
      </main>
    </>
  );
}
