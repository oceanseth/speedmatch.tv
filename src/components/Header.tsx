import Link from "next/link";
import Image from "next/image";
import AuthButton from "./AuthButton";

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
          <Link href="/#live" className="hidden hover:text-foreground sm:block">
            Live now
          </Link>
          <Link
            href="/#how-it-works"
            className="hidden hover:text-foreground sm:block"
          >
            How it works
          </Link>
          <Link href="/account/matches" className="hidden hover:text-foreground sm:block">
            My Matches
          </Link>
          <AuthButton />
        </nav>
      </div>
    </header>
  );
}
