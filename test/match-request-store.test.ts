import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { persistMatchRequest, requestHistory, approvedMatchContext } from "../src/lib/matchRequestStore";
import { reviewedRequestSummary } from "../src/lib/matchRequests";

const profile = (goal: string, category = "products") => ({ version: 1, category, goal, interests: ["quiet"], preferences: ["under 200", "PRIVATE ORCHESTRATOR NOTE"], dealbreakers: ["PRIVATE LIMIT"] });

test("reviewed summaries include only values shown by the history UI", () => {
  assert.deepEqual(reviewedRequestSummary(profile("a grinder")), {
    version: 1, category: "products", goal: "a grinder", interests: ["quiet"], preferences: ["under 200"],
  });
});

test("Postgres: migration replay, immutable history, retries, rollback and owner-scoped selection", { skip: !process.env.MATCH_REQUEST_TEST_DATABASE_URL }, async () => {
  const schema = `test_requests_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: process.env.MATCH_REQUEST_TEST_DATABASE_URL });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: process.env.MATCH_REQUEST_TEST_DATABASE_URL, options: `-c search_path=${schema}`, max: 5 });
  globalThis.__pgPool = pool;
  try {
    await pool.query(await readFile("migrations/001_init.sql", "utf8"));
    const owner = randomUUID(), stranger = randomUUID(), legacy = profile("legacy goal");
    await pool.query("INSERT INTO users(id, display_name) VALUES ($1, 'owner'), ($2, 'stranger')", [owner, stranger]);
    await pool.query("INSERT INTO onboarding_profiles(user_id, profile) VALUES ($1, $2::jsonb)", [owner, JSON.stringify(legacy)]);
    const migration = await readFile("migrations/008_match_requests.sql", "utf8");
    await pool.query(migration); await pool.query(migration);
    assert.equal((await requestHistory(owner)).length, 1);
    const first = randomUUID(), second = randomUUID(), foreign = randomUUID();
    await Promise.all([persistMatchRequest(owner, first, profile("a bicycle")), persistMatchRequest(owner, first, profile("a bicycle"))]);
    assert.equal((await requestHistory(owner)).length, 2);
    await persistMatchRequest(owner, second, profile("a quiet cafe", "places"));
    await persistMatchRequest(stranger, foreign, profile("stranger private goal"));
    await persistMatchRequest(owner, first, profile("a bicycle"));
    const latest = await pool.query("SELECT profile FROM onboarding_profiles WHERE user_id = $1", [owner]);
    assert.equal(latest.rows[0].profile.goal, "a quiet cafe");
    await assert.rejects(() => persistMatchRequest(owner, first, profile("changed content")));
    await assert.rejects(() => persistMatchRequest(stranger, first, profile("a bicycle")));
    assert.equal((await requestHistory(owner)).length, 3);
    assert.equal(await approvedMatchContext(stranger, second, []), null);
    assert.equal(await approvedMatchContext(owner, second, [foreign]), null);
    assert.equal(await approvedMatchContext(owner, second, [first, first]), null);
    assert.equal(await approvedMatchContext(owner, second, [second]), null);
    assert.equal(await approvedMatchContext(owner, second, [first, first, first, first]), null);
    const context = await approvedMatchContext(owner, second, [first]);
    assert.equal(context?.current.goal, "a quiet cafe");
    assert.equal(context?.history[0].goal, "a bicycle");
    assert.ok(!JSON.stringify(context).includes("PRIVATE"));
    // Snapshot survives later requests, and current/old categories remain distinct.
    await pool.query("INSERT INTO tournaments(user_id, category, state, match_request_id, match_context) VALUES($1, 'places', '{\"phase\":\"LOBBY\"}', $2, $3)", [owner, second, JSON.stringify(context)]);
    await persistMatchRequest(owner, randomUUID(), profile("a hiking buddy", "people"));
    const savedContext = await pool.query("SELECT match_context FROM tournaments WHERE user_id = $1", [owner]);
    assert.equal(savedContext.rows[0].match_context.current.goal, "a quiet cafe");
    assert.equal(savedContext.rows[0].match_context.history[0].category, "products");
  } finally {
    await pool.end(); globalThis.__pgPool = undefined;
    await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
  }
});
