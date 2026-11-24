import Link from "next/link";
import { Header, Footer } from "@/components/shell";
import { Icon } from "@/components/icons";
export default function NotFound() {
  return (
    <>
      <Header simple />
      <main id="main" className="center-page container">
        <Icon name="book" width="48" height="48" />
        <p className="eyebrow">A LITTLE LOST?</p>
        <h1>This page isn’t in the book.</h1>
        <p>Let’s get you back to a familiar place.</p>
        <Link className="button button-primary" href="/">
          Back to the beginning
        </Link>
      </main>
      <Footer />
    </>
  );
}
