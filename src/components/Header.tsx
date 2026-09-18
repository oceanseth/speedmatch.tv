import Link from "next/link";

export default function Header() {
  return (
    <header className="sticky top-0 z-20 border-b border-card-border/60 bg-background/70 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-baseline gap-1">
          <span className="text-xl font-bold tracking-tight brand-gradient-text">
            SpeedMatch
          </span>
          <span className="text-xl font-bold text-muted">.tv</span>
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
