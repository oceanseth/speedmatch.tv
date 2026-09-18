import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Header from "../../../components/Header";
import AvatarGlyph from "../../../components/AvatarGlyph";
import ShareReplay from "../../../components/ShareReplay";
import { getPublicReplay, PUBLIC_SITE_URL } from "../../../lib/public-tournaments";
import { publicText, showDate } from "../../../lib/public-replays";
import { roundLabel } from "../../../lib/types";
import type { MatchRecord } from "../../../lib/matches";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ tournamentId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tournamentId } = await params;
  const show = await getPublicReplay(tournamentId);
  if (!show) notFound();
  const url = `${PUBLIC_SITE_URL}/watch/${show.id}`;
  const headline = publicText(show.summaryTitle, "A match worth watching");
  const title = `${headline} — SpeedMatch.tv`;
  const description = publicText(`${show.winner?.name ?? "The final decision"} takes the spotlight. Explore every round of this ${show.bracketSize}-contender ${show.category} tournament on SpeedMatch.tv.`, "Explore the tournament recap on SpeedMatch.tv.", 400);
  const images = [{ url: `${url}/share-image`, width: 1200, height: 630, alt: headline }];
  return {
    title, description, alternates: { canonical: url },
    openGraph: { type: "website", siteName: "SpeedMatch.tv", locale: "en_US", url, title, description, images },
    twitter: { card: "summary_large_image", title, description, images },
  };
}

function MatchCard({ match }: { match: MatchRecord }) {
  return (
    <li className="rounded-xl border border-card-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between text-[10px] font-semibold uppercase tracking-widest text-muted">
        <span>Match {match.matchIndex + 1}</span>
        <span>{match.winnerId ? "Decided" : "No decision recorded"}</span>
      </div>
      {[match.entrantA, match.entrantB].map((entrant, index) => {
        const won = entrant.id === match.winnerId;
        return (
          <div key={`${entrant.id}-${index}`} className={`flex min-w-0 items-center gap-3 rounded-lg px-3 py-3 ${won ? "bg-brand-purple/10" : "text-muted"}`}>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center text-2xl" aria-hidden="true"><AvatarGlyph avatar={entrant.avatar} size={28} /></span>
            <span className={`min-w-0 flex-1 break-words text-sm ${won ? "font-semibold text-foreground" : ""}`}>{entrant.name}</span>
            {won && <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-brand-pink">Won</span>}
          </div>
        );
      })}
    </li>
  );
}

export default async function WatchPage({ params }: Props) {
  const { tournamentId } = await params;
  const show = await getPublicReplay(tournamentId);
  if (!show) notFound();
  const rounds = [...new Set(show.matches.map(match => match.round))].sort((a, b) => a - b);
  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:py-14">
        <Link href="/#recent-shows-title" className="text-sm text-muted hover:text-foreground">← Recent shows</Link>
        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-center">
          <div className="min-w-0">
            <div className="mb-4 flex flex-wrap items-center gap-3 text-xs font-semibold uppercase tracking-widest text-muted">
              <span className="text-brand-pink">Tournament recap</span><span>·</span><span>{show.category}</span>
            </div>
            <h1 className="max-w-3xl break-words text-4xl font-bold leading-tight tracking-tight sm:text-5xl">{show.summaryTitle}</h1>
            <p className="mt-5 text-sm text-muted">{show.bracketSize} contenders · {show.matches.length} matchups · <time dateTime={show.finishedAt!}>{showDate(show.finishedAt!)}</time></p>
            <p className="mt-3 text-sm text-muted">The picks, the progression, the final match.</p>
            <div className="mt-6"><ShareReplay title={show.summaryTitle} url={`${PUBLIC_SITE_URL}/watch/${show.id}`} /></div>
          </div>
          <aside aria-label="Tournament winner" className="min-w-0 rounded-2xl border border-brand-purple/40 bg-gradient-to-br from-brand-purple/15 via-card to-brand-pink/10 p-7">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-pink">The winning match</p>
            <div className="mt-6 flex h-20 w-20 items-center justify-center rounded-2xl border border-card-border bg-background text-5xl" aria-hidden="true">
              {show.winner ? <AvatarGlyph avatar={show.winner.avatar} size={64} /> : "◇"}
            </div>
            <h2 className="mt-5 break-words text-2xl font-bold">{show.winner?.name ?? "No winner recorded"}</h2>
            <p className="mt-2 text-sm text-muted">{show.winner ? "One bracket. One final choice." : "The results below show the recorded decisions."}</p>
          </aside>
        </div>
        <section aria-labelledby="bracket-title" className="mt-14 border-t border-card-border pt-8">
          <h2 id="bracket-title" className="text-2xl font-bold">How the bracket unfolded</h2>
          {rounds.length === 0 ? <p className="mt-5 text-muted">No match results have been recorded for this recap.</p> : (
            <div className="mt-6 grid items-start gap-6 md:grid-cols-2">
              {rounds.map(round => (
                <section key={round} aria-label={roundLabel(round, Math.log2(show.bracketSize))} className="min-w-0">
                  <h3 className="mb-3 flex items-center gap-3 text-sm font-semibold">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full border border-card-border text-xs text-muted">{round + 1}</span>
                    {roundLabel(round, Math.log2(show.bracketSize))}
                  </h3>
                  <ol className="space-y-3">{show.matches.filter(match => match.round === round).map(match => <MatchCard key={match.id} match={match} />)}</ol>
                </section>
              ))}
            </div>
          )}
        </section>
        <section className="mt-12 flex flex-wrap items-center justify-between gap-5 rounded-2xl border border-card-border bg-card p-6">
          <div><h2 className="text-xl font-bold">Who would win you over?</h2><p className="mt-1 text-sm text-muted">Give your next match fifteen seconds.</p></div>
          <Link href="/session/new" className="rounded-full bg-gradient-to-r from-brand-pink to-brand-purple px-6 py-3 text-sm font-semibold text-white">Start your own show</Link>
        </section>
      </main>
    </>
  );
}
