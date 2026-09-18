"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "../lib/authClient";

export default function AuthButton() {
  const router = useRouter();
  const { data: session, isPending } = useSession();

  if (isPending) {
    // Same footprint as the button so the header doesn't jump.
    return (
      <span className="rounded-full border border-card-border bg-card px-4 py-1.5 font-medium text-transparent">
        Sign in
      </span>
    );
  }

  if (!session) {
    return (
      <Link
        href="/login"
        className="rounded-full border border-card-border bg-card px-4 py-1.5 font-medium text-foreground transition hover:border-brand-purple"
      >
        Sign in
      </Link>
    );
  }

  return (
    <span className="flex items-center gap-3">
      <span className="hidden max-w-32 truncate text-foreground sm:block">
        {session.user.name}
      </span>
      <button
        type="button"
        onClick={async () => {
          await signOut();
          router.refresh();
        }}
        className="rounded-full border border-card-border bg-card px-4 py-1.5 font-medium text-foreground transition hover:border-brand-purple"
      >
        Sign out
      </button>
    </span>
  );
}
