import Link from "next/link";
import AvatarGlyph from "./AvatarGlyph";
import { getRecentShows } from "../lib/public-tournaments";
import { showDate, type PublicShow } from "../lib/public-replays";

export default async function RecentShows() {
  let shows: PublicShow[] = [];
  let unavailable = false;
  try { shows = await getRecentShows(); } catch { unavailable = true; }
  return (
    <section aria-labelledby="recent-shows-title" className="mx-auto max-w-6xl px-4 py-14">
      <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-brand-pink">The final word</p>
          <h2 id="recent-shows-title" className="text-3xl font-bold tracking-tight">Recent shows</h2>
        </div>
        <p className="max-w-sm text-sm text-muted">Big pitches. Tough calls. See who won.</p>
      </div>
      {shows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-card-border p-6 text-sm text-muted">
          {unavailable ? "Recent shows are temporarily unavailable. Please check back shortly." : "The next great match is still being decided. Public recaps will appear here when shows finish."}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shows.map(show => (
            <Link key={show.id} href={`/watch/${show.id}`} className="group flex min-w-0 flex-col rounded-2xl border border-card-border bg-card p-5 transition hover:border-brand-purple focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-pink">
              <div className="mb-5 flex items-center justify-between text-xs text-muted">
                <span className="rounded-full border border-card-border px-2.5 py-1 capitalize">{show.category}</span>
                <span>Finished · {show.bracketSize} contenders</span>
              </div>
              <h3 className="mb-6 break-words text-xl font-semibold leading-snug group-hover:text-brand-pink">{show.summaryTitle}</h3>
              <div className="mt-auto flex items-center gap-3 border-t border-card-border pt-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-background text-2xl" aria-hidden="true">
                  {show.winner ? <AvatarGlyph avatar={show.winner.avatar} size={32} /> : "◇"}
                </span>
                <div className="min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-muted">Winner</div>
                  <div className="break-words text-sm font-semibold">{show.winner?.name ?? "No winner recorded"}</div>
                </div>
              </div>
              <div className="mt-5 flex justify-between gap-2 text-xs text-muted">
                <time dateTime={show.finishedAt!}>{showDate(show.finishedAt!)}</time>
                <span className="font-semibold text-foreground">View recap <span aria-hidden="true">↗</span></span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
