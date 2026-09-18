"use client";
import Link from "next/link";
export default function ReplayError({ reset }: { reset: () => void }) {
  return <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-20"><h1 className="text-3xl font-bold">We couldn’t load this recap.</h1><p className="mt-4 text-muted">The results are temporarily unavailable. Please try again.</p><div className="mt-6 flex gap-5"><button type="button" onClick={reset} className="text-brand-pink">Try again</button><Link href="/" className="text-muted">Back to home</Link></div></main>;
}
