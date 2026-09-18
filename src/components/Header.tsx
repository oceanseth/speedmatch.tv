import Link from "next/link";
import Image from "next/image";

export default function Header() {
  return (
    <header className="sticky top-0 z-20 border-b border-card-border/60 bg-background/70 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" aria-label="SpeedMatch.tv home" className="brand-lockup">
          <Image src="/icon.svg" alt="" width={40} height={40} className="brand-symbol" priority />
          <span className="brand-wordmark" aria-hidden="true">speed<span>match</span></span>
          <span className="brand-tv" aria-hidden="true">.tv</span>
        </Link>
        <nav className="flex items-center gap-5 text-sm text-muted">
          <a href="#live" className="hidden hover:text-foreground sm:block">
            Live now
          </a>
          <a
            href="#how-it-works"
            className="hidden hover:text-foreground sm:block"
          >
            How it works
          </a>
          <Link href="/account/matches" className="hidden hover:text-foreground sm:block">
            My Matches
          </Link>
          <button
            type="button"
            className="rounded-full border border-card-border bg-card px-4 py-1.5 font-medium text-foreground transition hover:border-brand-purple"
          >
            Sign in
          </button>
        </nav>
      </div>
    </header>
  );
}
