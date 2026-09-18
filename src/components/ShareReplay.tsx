"use client";
import { useState } from "react";

export default function ShareReplay({ title, url }: { title: string; url: string }) {
  const [status, setStatus] = useState("");
  const [showLink, setShowLink] = useState(false);
  async function share() {
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        setStatus("Shared.");
      } else {
        await navigator.clipboard.writeText(url);
        setStatus("Link copied.");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setShowLink(true);
      setStatus("Copy the link below to share this recap.");
    }
  }
  return (
    <div>
      <button type="button" onClick={share} className="rounded-full border border-card-border bg-card px-5 py-2.5 text-sm font-semibold transition hover:border-brand-purple">Share this recap <span aria-hidden="true">↗</span></button>
      <span role="status" className="ml-3 text-xs text-muted">{status}</span>
      {showLink && <input aria-label="Recap link" readOnly value={url} onFocus={event => event.target.select()} className="mt-3 w-full rounded-lg border border-card-border bg-card p-3 text-sm" />}
    </div>
  );
}
