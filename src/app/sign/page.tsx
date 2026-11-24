import type { Metadata } from "next";
import { Header } from "@/components/shell";
import { SignForm } from "@/components/sign-form";
import { AuroraBackground } from "@/components/aurora-background";
export const metadata: Metadata = { title: "Sign the book" };
export default function SignPage() {
  return (
    <div className="sign-page">
      <AuroraBackground variant="form" />
      <Header simple />
      <main id="main" className="container sign-container">
        <SignForm />
      </main>
    </div>
  );
}
