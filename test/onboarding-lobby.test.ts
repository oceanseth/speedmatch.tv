import { test } from "node:test";
import assert from "node:assert/strict";
import { enterPublicLobby } from "../src/lib/onboardingLobby";

const id = "12345678-1234-1234-1234-123456789abc";

test("public lobby creates the selected category and carries the returned tournament ID", async t => {
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "/api/tournaments");
    assert.equal(init.method, "POST");
    assert.deepEqual(JSON.parse(init.body as string), { category: "people", isPublic: true });
    return Response.json({ id }, { status: 201 });
  });
  assert.deepEqual(await enterPublicLobby("people"), { status: "ready", href: `/stage/people?tournament=${id}` });
});

test("existing live tournaments resume using their own category", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ id, category: "places" }, { status: 409 }));
  assert.deepEqual(await enterPublicLobby("people"), { status: "ready", href: `/stage/places?tournament=${id}` });
});

test("anonymous, unavailable and invalid create responses stay on the completed profile", async t => {
  const responses = [
    Response.json({}, { status: 401 }), Response.json({}, { status: 503 }),
    Response.json({ error: "live_tournament_exists" }, { status: 409 }),
    Response.json({ id: "../bad" }, { status: 201 }),
  ];
  t.mock.method(globalThis, "fetch", async () => responses.shift()!);
  assert.deepEqual(await enterPublicLobby("people"), { status: "signin" });
  for (let i = 0; i < 3; i++) assert.deepEqual(await enterPublicLobby("people"), { status: "failed" });
});
