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
 * Run a query, retrying once after a short delay. The managed DB's proxy
 * answers "instance is unavailable, please retry" while a suspended instance
 * resumes — one retry converts that cold start into a slow response instead
 * of a 5xx.
 */
export async function query<R extends object>(
  text: string,
  values: unknown[] = [],
): Promise<R[]> {
  const pool = getPool();
  try {
    return (await pool.query(text, values)).rows as R[];
  } catch (first) {
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    try {
      return (await pool.query(text, values)).rows as R[];
    } catch {
      throw first;
    }
  }
}
