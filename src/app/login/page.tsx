"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Header from "../../components/Header";
import { signIn, signUp } from "../../lib/authClient";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res =
      mode === "signup"
        ? await signUp.email({ name: name.trim(), email, password })
        : await signIn.email({ email, password });
    setBusy(false);
    if (res.error) {
      setError(res.error.message ?? "Something went wrong — try again.");
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <>
      <Header />
      <main className="mx-auto flex max-w-md flex-col gap-6 px-4 py-16">
        <div>
          <h1 className="text-2xl font-bold">
            {mode === "signin" ? "Sign in" : "Create your account"}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {mode === "signin"
              ? "Welcome back to the show."
              : "Take the stage, keep your match history."}
          </p>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4">
          {mode === "signup" && (
            <label className="flex flex-col gap-1 text-sm">
              Display name
              <input
                required
                maxLength={40}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="rounded-lg border border-card-border bg-card px-3 py-2 text-foreground"
                autoComplete="nickname"
              />
            </label>
          )}
          <label className="flex flex-col gap-1 text-sm">
            Email
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-lg border border-card-border bg-card px-3 py-2 text-foreground"
              autoComplete="email"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Password
            <input
              required
              type="password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-lg border border-card-border bg-card px-3 py-2 text-foreground"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
            />
          </label>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="rounded-full border border-card-border bg-card px-4 py-2 font-medium text-foreground transition hover:border-brand-purple disabled:opacity-50"
          >
            {busy ? "One moment…" : mode === "signin" ? "Sign in" : "Sign up"}
          </button>
        </form>
        <button
          type="button"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
          }}
          className="text-sm text-muted hover:text-foreground"
        >
          {mode === "signin"
            ? "New here? Create an account"
            : "Already have an account? Sign in"}
        </button>
      </main>
    </>
  );
}
