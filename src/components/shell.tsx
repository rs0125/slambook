import Link from "next/link";
import { BrandMark, Icon } from "@/components/icons";

export function Header({ simple = false }: { simple?: boolean }) {
  return (
    <header className="site-header">
      <div className="container header-inner">
        <Link href="/" className="brand" aria-label="Raghav’s Slambook home">
          <span className="brand-mark">
            <BrandMark />
          </span>
          <span>
            Raghav’s<span className="brand-second">slambook.</span>
          </span>
        </Link>
        {!simple && (
          <span className="nav-note">Good friends. Unforgettable stories.</span>
        )}
        <Link
          href="/admin"
          className="button button-ghost owner-link"
          aria-label="Owner’s corner"
        >
          <Icon name="lock" />
          <span>Owner’s corner</span>
        </Link>
      </div>
    </header>
  );
}
export function Footer() {
  return (
    <footer className="site-footer">
      <div className="container footer-inner">
        <span>Good friends. Great memories.</span>
        <span>
          Made for memories <Icon name="heart" width="15" height="15" />
        </span>
      </div>
    </footer>
  );
}
