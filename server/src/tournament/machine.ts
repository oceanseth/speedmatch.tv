/**
 * Server-authoritative tournament state machine.
 *
 * LOBBY → ONBOARD → SEED → [PITCH_A → PITCH_B → USER_RESPONSE → DECIDE] × N → FINAL
 *
 * Design constraints (from the channel spec):
 * - Pure and serializable: state is plain JSON so it can be persisted in
 *   postgres (`tournaments.state`) and driven from any WS/route layer.
 * - Timers are server-authoritative: timed phases carry a `deadlineAt`
 *   epoch-ms stamp computed here; a TIMER_EXPIRED event before the deadline
 *   is rejected. Never trust the client (or a model) to time itself.
 * - Decisions are phase-validated here; *ownership* validation (is this the
 *   user whose tournament it is?) belongs to the transport layer.
 */

import { config } from '../config.ts';

export type Phase =
  | 'LOBBY'
  | 'ONBOARD'
  | 'SEED'
  | 'PITCH_A'
  | 'PITCH_B'
  | 'USER_RESPONSE'
  | 'DECIDE'
  | 'FINAL'
  /**
   * Terminal state for a session the user walked away from (ONBOARD or
   * DECIDE deadline lapsed with no input). An unfinished tournament is
   * honest; fabricating a winner the user never picked is not — so no
   * default-to-A, and My Matches can render it as abandoned.
   */
  | 'ABANDONED';

export interface Match {
  round: number;
  index: number;
  entrantA: string | null;
  entrantB: string | null;
  winner: string | null;
}

export interface TournamentState {
  phase: Phase;
  bracketSize: number;
  /** Persona ids in seed order; empty until SEEDED. */
  entrants: string[];
  /** rounds[r][i]; round 0 is the first. */
  rounds: Match[][];
  /** Pointer to the live match during PITCH_A/PITCH_B/USER_RESPONSE/DECIDE. */
  current: { round: number; index: number } | null;
  /** Epoch ms deadline for the current timed phase, else null. */
  deadlineAt: number | null;
  winner: string | null;
}

export type TournamentEvent =
  | { type: 'START_ONBOARD' }
  | { type: 'ONBOARD_COMPLETE' }
  | { type: 'SEEDED'; entrants: string[] }
  | { type: 'TIMER_EXPIRED' }
  | { type: 'USER_DECISION'; winner: 'A' | 'B' };

export class TransitionError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'WRONG_PHASE'
      | 'TIMER_NOT_EXPIRED'
      | 'BAD_SEED'
      | 'BAD_DECISION',
  ) {
    super(message);
    this.name = 'TransitionError';
  }
}

const TIMED_PHASE_SECONDS: Partial<Record<Phase, number>> = {
  ONBOARD: config.onboardSeconds,
  PITCH_A: config.pitchSeconds,
  PITCH_B: config.pitchSeconds,
  USER_RESPONSE: config.userResponseSeconds,
  DECIDE: config.decideSeconds,
};

export function createTournament(
  opts: { bracketSize?: number } = {},
): TournamentState {
  const bracketSize = opts.bracketSize ?? config.bracketSize;
  if (bracketSize < 2 || (bracketSize & (bracketSize - 1)) !== 0) {
    throw new TransitionError(
      `bracketSize must be a power of two >= 2, got ${bracketSize}`,
      'BAD_SEED',
    );
  }
  return {
    phase: 'LOBBY',
    bracketSize,
    entrants: [],
    rounds: [],
    current: null,
    deadlineAt: null,
    winner: null,
  };
}

function enterPhase(state: TournamentState, phase: Phase, now: number): TournamentState {
  const seconds = TIMED_PHASE_SECONDS[phase];
  return {
    ...state,
    phase,
    deadlineAt: seconds != null ? now + seconds * 1000 : null,
  };
}

function buildRounds(entrants: string[]): Match[][] {
  const rounds: Match[][] = [];
  let slots = entrants.length / 2;
  for (let r = 0; slots >= 1; r++, slots /= 2) {
    rounds.push(
      Array.from({ length: slots }, (_, i) => ({
        round: r,
        index: i,
        entrantA: r === 0 ? entrants[i * 2] : null,
        entrantB: r === 0 ? entrants[i * 2 + 1] : null,
        winner: null,
      })),
    );
  }
  return rounds;
}

function currentMatch(state: TournamentState): Match {
  if (!state.current) throw new TransitionError('no live match', 'WRONG_PHASE');
  return state.rounds[state.current.round][state.current.index];
}

/** Advance past a decided match: next match in round, next round, or FINAL. */
function afterDecision(state: TournamentState, now: number): TournamentState {
  const { round, index } = state.current!;
  const roundMatches = state.rounds[round];
  if (index + 1 < roundMatches.length) {
    return enterPhase({ ...state, current: { round, index: index + 1 } }, 'PITCH_A', now);
  }
  const winners = roundMatches.map((m) => m.winner!);
  if (winners.length === 1) {
    return { ...state, phase: 'FINAL', current: null, deadlineAt: null, winner: winners[0] };
  }
  const rounds = state.rounds.map((r) => r.map((m) => ({ ...m })));
  const next = rounds[round + 1];
  winners.forEach((w, i) => {
    const m = next[Math.floor(i / 2)];
    if (i % 2 === 0) m.entrantA = w;
    else m.entrantB = w;
  });
  return enterPhase({ ...state, rounds, current: { round: round + 1, index: 0 } }, 'PITCH_A', now);
}

function expectPhase(state: TournamentState, ...phases: Phase[]): void {
  if (!phases.includes(state.phase)) {
    throw new TransitionError(
      `event not valid in phase ${state.phase} (expected ${phases.join('|')})`,
      'WRONG_PHASE',
    );
  }
}

/**
 * Pure transition function. Returns a NEW state; never mutates.
 * `now` is epoch ms supplied by the caller (the server clock).
 */
export function advance(
  state: TournamentState,
  event: TournamentEvent,
  now: number,
): TournamentState {
  switch (event.type) {
    case 'START_ONBOARD': {
      expectPhase(state, 'LOBBY');
      return enterPhase(state, 'ONBOARD', now);
    }
    case 'ONBOARD_COMPLETE': {
      expectPhase(state, 'ONBOARD');
      return enterPhase(state, 'SEED', now);
    }
    case 'SEEDED': {
      expectPhase(state, 'SEED');
      if (
        event.entrants.length !== state.bracketSize ||
        new Set(event.entrants).size !== event.entrants.length
      ) {
        throw new TransitionError(
          `need ${state.bracketSize} distinct entrants, got ${event.entrants.length}`,
          'BAD_SEED',
        );
      }
      const rounds = buildRounds(event.entrants);
      return enterPhase(
        { ...state, entrants: [...event.entrants], rounds, current: { round: 0, index: 0 } },
        'PITCH_A',
        now,
      );
    }
    case 'TIMER_EXPIRED': {
      expectPhase(state, 'ONBOARD', 'PITCH_A', 'PITCH_B', 'USER_RESPONSE', 'DECIDE');
      if (state.deadlineAt == null || now < state.deadlineAt) {
        throw new TransitionError(
          'timer has not expired yet (server clock is authoritative)',
          'TIMER_NOT_EXPIRED',
        );
      }
      if (state.phase === 'PITCH_A') return enterPhase(state, 'PITCH_B', now);
      if (state.phase === 'PITCH_B') return enterPhase(state, 'USER_RESPONSE', now);
      if (state.phase === 'USER_RESPONSE') return enterPhase(state, 'DECIDE', now);
      // ONBOARD or DECIDE lapsed with no user input: the user is gone.
      return { ...state, phase: 'ABANDONED', current: null, deadlineAt: null };
    }
    case 'USER_DECISION': {
      expectPhase(state, 'USER_RESPONSE', 'DECIDE');
      return applyDecision(state, event.winner, now);
    }
  }
}

function applyDecision(
  state: TournamentState,
  pick: 'A' | 'B',
  now: number,
): TournamentState {
  const match = currentMatch(state);
  const winner = pick === 'A' ? match.entrantA : match.entrantB;
  if (!winner) throw new TransitionError('picked an empty slot', 'BAD_DECISION');
  const rounds = state.rounds.map((r) => r.map((m) => ({ ...m })));
  rounds[state.current!.round][state.current!.index].winner = winner;
  return afterDecision({ ...state, rounds }, now);
}

/** Convenience for the transport layer: ms until the current deadline, or null. */
export function msRemaining(state: TournamentState, now: number): number | null {
  return state.deadlineAt == null ? null : Math.max(0, state.deadlineAt - now);
}
