import type { Metadata, Viewport } from "next";
import "@fontsource-variable/dm-sans";
import "./globals.css";
import { BOOK_TITLE } from "@/lib/questions";
import { isLocalDemo } from "@/lib/demo-mode";

export const metadata: Metadata = {
  title: { default: BOOK_TITLE, template: `%s · ${BOOK_TITLE}` },
  description:
    "A place for friends, favourite memories, inside jokes, and notes to look back on. Leave a page in Raghav’s Slambook.",
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f6f5f3",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {isLocalDemo() && (
          <div className="demo-banner">
            <strong>Local demo</strong>
            <span>Sample data · New entries stay on this computer</span>
          </div>
        )}
        {children}
      </body>
    </html>
  );
}
