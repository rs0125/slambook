"use client";
import Link from "next/link";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main id="main" className="center-page container">
      <p className="eyebrow">LET’S TRY THAT AGAIN</p>
      <h1>A page got a little stuck.</h1>
      <p>
        Please try again in a moment. Your saved text draft is still on this
        device.
      </p>
      <button className="button button-primary" onClick={reset}>
        Try again
      </button>
      <Link href="/" className="button button-ghost">
        Back to the beginning
      </Link>
    </main>
  );
}
