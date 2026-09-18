import { Pool } from "pg";

// One pool per server process, surviving dev-mode module reloads. The
// InstaCloud postgres scales to zero when idle: keep idle sockets short-lived
// (under the suspend window) and allow a generous connect timeout so the
// first query after a cold start waits for the instance instead of failing.
declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

export function getPool(): Pool {
  if (!globalThis.__pgPool) {
    globalThis.__pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 15_000,
    });
  }
  return globalThis.__pgPool;
}

/**
 * Only connection-ESTABLISHMENT failures are retryable: the query never
 * reached the server, so a retry cannot double-apply a write (this helper
 * will carry the stage loop's inserts and version bumps). The scale-to-zero
 * DB takes ~8-15s to resume; its proxy either refuses with "instance is
 * unavailable, please retry" or lets the connect hang into our timeout.
 * Everything else — SQL errors, constraint violations, mid-query drops
 * (ECONNRESET after connect) — surfaces immediately.
 */
function isRetryableConnectError(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  // ECONNREFUSED: TCP connect refused. 57P03: server starting up.
  // 53300: connection slots full while the instance warms.
  if (e?.code === "ECONNREFUSED" || e?.code === "57P03" || e?.code === "53300") {
    return true;
  }
  // All three connect-timeout strings pg can raise — which one fires is a
  // race between the client timer (client.js "timeout expired"), the pool's
  // own connectionTimeoutMillis timer (pg-pool "timeout exceeded when trying
  // to connect"), and pool teardown ("Connection terminated due to
  // connection timeout"). Missing any one makes cold-start retry a coin flip.
  return /instance is unavailable|timeout expired|timeout exceeded when trying to connect|Connection terminated due to connection timeout/i.test(
    e?.message ?? "",
  );
}

// Two waits + three 15s connect windows comfortably cover a cold resume.
const RETRY_DELAYS_MS = [2_000, 6_000];

// Single-flight warming: while one caller sits out a retry delay, concurrent
// callers await the SAME delay instead of stacking independent retry ladders
// against a max-5 pool during a resume.
let warming: Promise<void> | null = null;

function sharedDelay(ms: number): Promise<void> {
  if (!warming) {
    warming = new Promise<void>((resolve) => setTimeout(resolve, ms)).finally(() => {
      warming = null;
    });
  }
  return warming;
}

export async function query<R extends object>(
  text: string,
  values: unknown[] = [],
): Promise<R[]> {
  for (let attempt = 0; ; attempt++) {
    if (warming) await warming;
    try {
      return (await getPool().query(text, values)).rows as R[];
    } catch (err) {
      if (attempt >= RETRY_DELAYS_MS.length || !isRetryableConnectError(err)) {
        throw err;
      }
      await sharedDelay(RETRY_DELAYS_MS[attempt]);
    }
  }
}
