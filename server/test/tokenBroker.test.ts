import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTokenBrokerHandler,
  defaultClientKey,
  mintClientSecret,
  RateLimiter,
  REALTIME_WS_URL,
} from '../src/boson/tokenBroker.ts';

const okUpstream = (async (url: RequestInfo | URL, init?: RequestInit) => {
  assert.equal(String(url), 'https://api.boson.ai/v1/realtime/client_secrets');
  assert.equal((init!.headers as Record<string, string>).Authorization, 'Bearer test-key');
  const body = JSON.parse(String(init!.body));
  assert.equal(typeof body.expires_after.seconds, 'number');
  return new Response(
    JSON.stringify({
      object: 'realtime.client_secret',
      value: 'bai-eph-abc123',
      expires_at: 1712345678,
      session: { id: 'sess_1' },
    }),
    { status: 200 },
  );
}) as typeof fetch;

test('mintClientSecret calls Boson with bearer key and clamps expiry', async () => {
  const secret = await mintClientSecret({
    apiKey: 'test-key',
    fetchImpl: okUpstream,
    expiresSeconds: 3, // below the documented 10s floor -> clamped
  });
  assert.equal(secret.value, 'bai-eph-abc123');
  assert.equal(secret.sessionId, 'sess_1');
});

test('mintClientSecret refuses to run without a key', async () => {
  delete process.env.BOSON_API_KEY;
  await assert.rejects(() => mintClientSecret({ fetchImpl: okUpstream }), /BOSON_API_KEY/);
});

test('handler: 401 without auth, mints for the session owner, audits', async () => {
  const minted: Array<{ userId: string; tournamentId: string }> = [];
  const handler = createTokenBrokerHandler({
    authorize: async (req) =>
      req.headers.get('x-user')
        ? { userId: req.headers.get('x-user')!, tournamentId: 't1' }
        : null,
    onMint: async (grant) => {
      minted.push(grant);
    },
    mint: async () => ({ value: 'bai-eph-xyz', expiresAt: 999, sessionId: null }),
  });

  const anon = await handler(new Request('http://x/api/realtime/token', { method: 'POST' }));
  assert.equal(anon.status, 401);

  const res = await handler(
    new Request('http://x/api/realtime/token', { method: 'POST', headers: { 'x-user': 'u1' } }),
  );
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.clientSecret, 'bai-eph-xyz');
  assert.equal(json.wsUrl, REALTIME_WS_URL);
  assert.deepEqual(json.subprotocols, ['realtime', 'bai-client-secret.bai-eph-xyz']);
  assert.deepEqual(minted, [{ userId: 'u1', tournamentId: 't1' }]);
});

test('handler: per-user rate limit returns 429', async () => {
  const handler = createTokenBrokerHandler({
    authorize: async () => ({ userId: 'u1', tournamentId: 't1' }),
    userLimiter: new RateLimiter(2),
    mint: async () => ({ value: 'bai-eph-xyz', expiresAt: 999, sessionId: null }),
  });
  const req = () => new Request('http://x/api/realtime/token', { method: 'POST' });
  assert.equal((await handler(req())).status, 200);
  assert.equal((await handler(req())).status, 200);
  assert.equal((await handler(req())).status, 429);
});

test('handler: rotating user ids cannot dodge the IP limit', async () => {
  let n = 0;
  const handler = createTokenBrokerHandler({
    authorize: async () => ({ userId: `rotated-${n++}`, tournamentId: 't1' }),
    ipLimiter: new RateLimiter(2),
    mint: async () => ({ value: 'bai-eph-xyz', expiresAt: 999, sessionId: null }),
  });
  const req = () =>
    new Request('http://x/api/realtime/token', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '203.0.113.7' },
    });
  assert.equal((await handler(req())).status, 200);
  assert.equal((await handler(req())).status, 200);
  assert.equal((await handler(req())).status, 429); // 3rd mint, 3rd distinct user
});

test('handler: spoofed leftmost XFF cannot rotate the IP key', async () => {
  let n = 0;
  const handler = createTokenBrokerHandler({
    authorize: async () => ({ userId: 'u1', tournamentId: 't1' }),
    ipLimiter: new RateLimiter(2),
    userLimiter: new RateLimiter(100),
    mint: async () => ({ value: 'bai-eph-xyz', expiresAt: 999, sessionId: null }),
  });
  // Attacker types a fresh leftmost hop each request; the trusted proxy
  // appends the real IP last — the key must come from the rightmost hop.
  const req = () =>
    new Request('http://x/api/realtime/token', {
      method: 'POST',
      headers: { 'x-forwarded-for': `10.0.0.${n++}, 198.51.100.9` },
    });
  assert.equal((await handler(req())).status, 200);
  assert.equal((await handler(req())).status, 200);
  assert.equal((await handler(req())).status, 429);
});

test('defaultClientKey prefers CF-Connecting-IP over XFF', () => {
  const req = new Request('http://x/', {
    headers: {
      'cf-connecting-ip': '198.51.100.9',
      'x-forwarded-for': 'spoofed, 203.0.113.7',
    },
  });
  assert.equal(defaultClientKey(req), '198.51.100.9');
  assert.equal(
    defaultClientKey(new Request('http://x/', { headers: { 'x-forwarded-for': 'spoofed, 203.0.113.7' } })),
    '203.0.113.7',
  );
  assert.equal(defaultClientKey(new Request('http://x/')), 'unknown');
});

test('handler: unauthenticated junk cannot exhaust the mint budget', async () => {
  const handler = createTokenBrokerHandler({
    authorize: async (req) =>
      req.headers.get('x-user') ? { userId: 'u1', tournamentId: 't1' } : null,
    globalLimiter: new RateLimiter(1), // mint budget of exactly 1
    mint: async () => ({ value: 'bai-eph-xyz', expiresAt: 999, sessionId: null }),
  });
  // 20 junk requests answer 401 without touching the mint budget…
  for (let i = 0; i < 20; i++) {
    assert.equal(
      (await handler(new Request('http://x/t', { method: 'POST' }))).status,
      401,
    );
  }
  // …so the real user still mints.
  const real = await handler(
    new Request('http://x/t', { method: 'POST', headers: { 'x-user': 'u1' } }),
  );
  assert.equal(real.status, 200);
});

test('handler: pre-auth volume cap rejects raw floods before authorize', async () => {
  let authCalls = 0;
  const handler = createTokenBrokerHandler({
    authorize: async () => {
      authCalls++;
      return { userId: 'u1', tournamentId: 't1' };
    },
    preAuthLimiter: new RateLimiter(1),
    userLimiter: new RateLimiter(100),
    mint: async () => ({ value: 'bai-eph-xyz', expiresAt: 999, sessionId: null }),
  });
  const req = () => new Request('http://x/t', { method: 'POST' });
  assert.equal((await handler(req())).status, 200);
  assert.equal((await handler(req())).status, 429);
  assert.equal(authCalls, 1);
});

test('handler: upstream failure is opaque 502', async () => {
  const handler = createTokenBrokerHandler({
    authorize: async () => ({ userId: 'u1', tournamentId: 't1' }),
    mint: async () => {
      throw new Error('secret internal detail');
    },
  });
  const res = await handler(new Request('http://x/api/realtime/token', { method: 'POST' }));
  assert.equal(res.status, 502);
  const json = await res.json();
  assert.equal(json.error, 'mint_failed');
  assert.ok(!JSON.stringify(json).includes('secret internal detail'));
});

test('RateLimiter window slides', () => {
  const rl = new RateLimiter(1, 1000);
  assert.equal(rl.allow('k', 0), true);
  assert.equal(rl.allow('k', 500), false);
  assert.equal(rl.allow('k', 1501), true);
});

test('RateLimiter evicts stale keys — rotated ids cannot grow memory forever', () => {
  const rl = new RateLimiter(1, 1000);
  for (let i = 0; i < 500; i++) rl.allow(`rotated-${i}`, i);
  assert.equal(rl.trackedKeys, 500);
  rl.sweep(10_000);
  assert.equal(rl.trackedKeys, 0);
});
