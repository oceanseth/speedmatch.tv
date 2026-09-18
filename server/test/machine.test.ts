import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  advance,
  createTournament,
  msRemaining,
  TransitionError,
  type TournamentState,
} from '../src/tournament/machine.ts';
import { config } from '../src/config.ts';

const T0 = 1_000_000;

function seeded(bracketSize = 4, now = T0): TournamentState {
  let s = createTournament({ bracketSize });
  s = advance(s, { type: 'START_ONBOARD' }, now);
  s = advance(s, { type: 'ONBOARD_COMPLETE' }, now);
  const entrants = Array.from({ length: bracketSize }, (_, i) => `p${i + 1}`);
  return advance(s, { type: 'SEEDED', entrants }, now);
}

test('happy path: 4-bracket runs to FINAL with a winner', () => {
  let s = seeded(4);
  let now = T0;
  // 3 matches in a 4-bracket; decide each during USER_RESPONSE.
  for (let m = 0; m < 3; m++) {
    assert.equal(s.phase, 'PITCH_A');
    now = s.deadlineAt!;
    s = advance(s, { type: 'TIMER_EXPIRED' }, now);
    assert.equal(s.phase, 'PITCH_B');
    now = s.deadlineAt!;
    s = advance(s, { type: 'TIMER_EXPIRED' }, now);
    assert.equal(s.phase, 'USER_RESPONSE');
    s = advance(s, { type: 'USER_DECISION', winner: 'A' }, now);
  }
  assert.equal(s.phase, 'FINAL');
  // A picked every time: p1 beats p2, p3 beats p4, p1 beats p3.
  assert.equal(s.winner, 'p1');
  assert.equal(s.rounds[1][0].entrantA, 'p1');
  assert.equal(s.rounds[1][0].entrantB, 'p3');
  assert.equal(s.deadlineAt, null);
});

test('pitch legs carry the configured 15s server deadline', () => {
  const s = seeded(4, T0);
  assert.equal(s.phase, 'PITCH_A');
  assert.equal(s.deadlineAt, T0 + config.pitchSeconds * 1000);
  assert.equal(msRemaining(s, T0 + 5000), config.pitchSeconds * 1000 - 5000);
});

test('early TIMER_EXPIRED is rejected — server clock is authoritative', () => {
  const s = seeded(4, T0);
  assert.throws(
    () => advance(s, { type: 'TIMER_EXPIRED' }, s.deadlineAt! - 1),
    (e: unknown) => e instanceof TransitionError && e.code === 'TIMER_NOT_EXPIRED',
  );
});

test('decision outside USER_RESPONSE/DECIDE is rejected', () => {
  const s = seeded(4);
  assert.equal(s.phase, 'PITCH_A');
  assert.throws(
    () => advance(s, { type: 'USER_DECISION', winner: 'A' }, T0),
    (e: unknown) => e instanceof TransitionError && e.code === 'WRONG_PHASE',
  );
});

test('SEEDED validates count and uniqueness', () => {
  let s = createTournament({ bracketSize: 4 });
  s = advance(s, { type: 'START_ONBOARD' }, T0);
  s = advance(s, { type: 'ONBOARD_COMPLETE' }, T0);
  assert.throws(
    () => advance(s, { type: 'SEEDED', entrants: ['a', 'b', 'c'] }, T0),
    (e: unknown) => e instanceof TransitionError && e.code === 'BAD_SEED',
  );
  assert.throws(
    () => advance(s, { type: 'SEEDED', entrants: ['a', 'b', 'c', 'a'] }, T0),
    (e: unknown) => e instanceof TransitionError && e.code === 'BAD_SEED',
  );
});

test('bracketSize must be a power of two', () => {
  assert.throws(() => createTournament({ bracketSize: 6 }), TransitionError);
  assert.throws(() => createTournament({ bracketSize: 1 }), TransitionError);
});

test('DECIDE timeout abandons the tournament — never fabricates a winner', () => {
  let s = seeded(4);
  let now = s.deadlineAt!;
  s = advance(s, { type: 'TIMER_EXPIRED' }, now); // -> PITCH_B
  now = s.deadlineAt!;
  s = advance(s, { type: 'TIMER_EXPIRED' }, now); // -> USER_RESPONSE
  now = s.deadlineAt!;
  s = advance(s, { type: 'TIMER_EXPIRED' }, now); // -> DECIDE
  assert.equal(s.phase, 'DECIDE');
  now = s.deadlineAt!;
  s = advance(s, { type: 'TIMER_EXPIRED' }, now); // no pick -> ABANDONED
  assert.equal(s.phase, 'ABANDONED');
  assert.equal(s.rounds[0][0].winner, null);
  assert.equal(s.winner, null);
  assert.equal(s.deadlineAt, null);
});

test('ONBOARD carries a deadline and lapses to ABANDONED', () => {
  let s = createTournament({ bracketSize: 4 });
  s = advance(s, { type: 'START_ONBOARD' }, T0);
  assert.equal(s.deadlineAt, T0 + config.onboardSeconds * 1000);
  s = advance(s, { type: 'TIMER_EXPIRED' }, s.deadlineAt!);
  assert.equal(s.phase, 'ABANDONED');
});

test('8-bracket produces 3 rounds and 7 matches', () => {
  const s = seeded(8);
  assert.equal(s.rounds.length, 3);
  assert.equal(s.rounds.flat().length, 7);
});

test('advance never mutates the input state', () => {
  const s = seeded(4);
  const snapshot = JSON.stringify(s);
  advance(s, { type: 'TIMER_EXPIRED' }, s.deadlineAt!);
  assert.equal(JSON.stringify(s), snapshot);
});
