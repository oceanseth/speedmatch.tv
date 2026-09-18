import type { Metadata } from "next";
import Header from "../../../components/Header";
import {
  DEMO_TOURNAMENTS,
  type MatchRecord,
  type PersonaLite,
  type TournamentSummary,
} from "../../../lib/matches";
import AvatarGlyph from "../../../components/AvatarGlyph";
import { roundLabel } from "../../../lib/types";

export const metadata: Metadata = {
  title: "My Matches — SpeedMatch.tv",
};

function Entrant({
  persona,
  won,
  pending,
}: {
  persona: PersonaLite;
  won: boolean;
  pending: boolean;
}) {
  return (
    <span
      className={
        won
          ? "font-semibold text-foreground"
          : pending
            ? "text-muted"
            : "text-muted line-through decoration-card-border"
      }
    >
      <span className="mr-1">
        <AvatarGlyph avatar={persona.avatar} size={16} />
      </span>
      {persona.name}
    </span>
  );
}

function MatchRow({ match }: { match: MatchRecord }) {
  const pending = match.winnerId === null;
  return (
    <li className="flex items-center gap-2 text-sm">
      <Entrant
        persona={match.entrantA}
        won={match.winnerId === match.entrantA.id}
        pending={pending}
      />
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
        vs
      </span>
      <Entrant
        persona={match.entrantB}
        won={match.winnerId === match.entrantB.id}
        pending={pending}
      />
      {pending && (
        <span className="text-xs italic text-muted">— never decided</span>
      )}
    </li>
  );
}

function TournamentCard({ t }: { t: TournamentSummary }) {
  const totalRounds = Math.log2(t.bracketSize);
  const rounds = [...new Set(t.matches.map((m) => m.round))].sort(
    (a, b) => a - b,
  );
  const date = new Date(t.createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return (
    <div className="rounded-xl border border-card-border bg-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-muted">
          <span className="capitalize">{t.category}</span> · bracket of{" "}
          {t.bracketSize} · {date}
        </div>
        {t.phase === "ABANDONED" && (
          <span className="rounded-full bg-card-border/60 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted">
            Abandoned
          </span>
        )}
      </div>
      {t.winner ? (
        <div className="mb-4 flex items-center gap-3 rounded-lg bg-background p-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-card text-2xl">
            <AvatarGlyph avatar={t.winner.avatar} size={36} />
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-muted">
              Your match
            </div>
            <div className="font-semibold brand-gradient-text">
              {t.winner.name}
            </div>
          </div>
        </div>
      ) : (
        <div className="mb-4 rounded-lg bg-background p-3 text-sm text-muted">
          This tournament ended without a decision — no winner was recorded.
        </div>
      )}
      <div className="space-y-3">
        {rounds.map((r) => (
          <div key={r}>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">
              {roundLabel(r, totalRounds)}
            </div>
            <ul className="space-y-1">
              {t.matches
                .filter((m) => m.round === r)
                .map((m) => (
                  <MatchRow key={m.id} match={m} />
                ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function MyMatches() {
  // Demo history until accounts land; becomes a per-user DB query
  // (tournaments + denormalized matches) behind auth.
  const tournaments = DEMO_TOURNAMENTS;
  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <h1 className="text-2xl font-bold">My Matches</h1>
        <p className="mt-1 text-sm text-muted">
          Every tournament you have run, and who won you over.
        </p>
        <div className="mt-4 rounded-lg border border-dashed border-card-border p-3 text-xs text-muted">
          Showing demo history — sign-in and personal match history land with
          accounts.
        </div>
        <div className="mt-6 space-y-5">
          {tournaments.map((t) => (
            <TournamentCard key={t.id} t={t} />
          ))}
        </div>
      </main>
    </>
  );
}
