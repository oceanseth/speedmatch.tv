"use client";

import AvatarGlyph from "../AvatarGlyph";
import { sanitizeAnswer } from "../../lib/onboarding";
import { roundLabel } from "../../lib/types";
import type {
  BracketMatch,
  PersonaCard,
  TournamentStateSnapshot,
} from "../../lib/stage";
import { PHASE_LABELS } from "../../lib/stage";

interface Props {
  state: TournamentStateSnapshot | null;
  personas: Record<string, PersonaCard>;
}

function EntrantCell({
  id,
  match,
  personas,
}: {
  id: string | null;
  match: BracketMatch;
  personas: Record<string, PersonaCard>;
}) {
  if (!id) {
    return <div className="px-2 py-1 text-xs italic text-muted">TBD</div>;
  }
  const card = personas[id];
  // Persona names originate as user-derived text; sanitize at the render
  // boundary even though React escapes markup.
  const name = card ? sanitizeAnswer(card.name) : id.slice(0, 8);
  const decided = match.winner !== null;
  const won = match.winner === id;
  return (
    <div
      className={`flex items-center gap-1.5 px-2 py-1 text-xs ${
        decided && !won ? "opacity-40" : ""
      } ${won ? "font-semibold text-foreground" : ""}`}
    >
      {card && (
        <span className="text-sm leading-none">
          <AvatarGlyph avatar={card.avatar} size={16} />
        </span>
      )}
      <span className="truncate">{name}</span>
      {won && <span className="text-brand-pink">✓</span>}
    </div>
  );
}

export default function BracketPanel({ state, personas }: Props) {
  if (!state || state.rounds.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted">
        {state
          ? `${PHASE_LABELS[state.phase]} — the bracket appears once entrants are seeded.`
          : "No tournament on this stage yet."}
      </div>
    );
  }
  const totalRounds = state.rounds.length;
  return (
    <div className="flex h-full gap-4 overflow-x-auto p-4">
      {state.rounds.map((round, r) => (
        <div key={r} className="flex min-w-40 flex-1 flex-col justify-around gap-3">
          <div className="text-center text-[10px] font-bold uppercase tracking-widest text-muted">
            {roundLabel(r, totalRounds)}
          </div>
          {round.map((match) => {
            const live =
              state.current?.round === match.round &&
              state.current?.index === match.index;
            return (
              <div
                key={`${match.round}-${match.index}`}
                className={`divide-y divide-card-border/60 rounded-lg border bg-background ${
                  live
                    ? "border-brand-purple shadow-md shadow-brand-purple/20"
                    : "border-card-border"
                }`}
              >
                <EntrantCell id={match.entrantA} match={match} personas={personas} />
                <EntrantCell id={match.entrantB} match={match} personas={personas} />
              </div>
            );
          })}
        </div>
      ))}
      {state.winner && (
        <div className="flex min-w-36 flex-col items-center justify-center gap-1 rounded-lg border border-brand-pink/50 bg-background p-3 text-center">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted">
            Champion
          </div>
          {personas[state.winner] && (
            <span className="text-2xl">
              <AvatarGlyph avatar={personas[state.winner].avatar} size={28} />
            </span>
          )}
          <div className="text-sm font-semibold">
            {personas[state.winner]
              ? sanitizeAnswer(personas[state.winner].name)
              : state.winner.slice(0, 8)}
          </div>
        </div>
      )}
    </div>
  );
}
