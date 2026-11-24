import type { Metadata } from "next";
import { Header, Footer } from "@/components/shell";
export const metadata: Metadata = {
  title: "Owner’s corner",
  robots: { index: false, follow: false },
};
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Header simple />
      <main id="main" className="container admin-container">
        {children}
      </main>
      <Footer />
    </>
  );
}
