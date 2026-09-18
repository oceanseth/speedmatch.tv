import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTokenBrokerHandler,
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

test('handler: 401 without auth, mints for the session owner', async () => {
  const handler = createTokenBrokerHandler({
    authorize: async (req) =>
      req.headers.get('x-user') ? { userId: req.headers.get('x-user')! } : null,
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
});

test('handler: per-user rate limit returns 429', async () => {
  const handler = createTokenBrokerHandler({
    authorize: async () => ({ userId: 'u1' }),
    rateLimiter: new RateLimiter(2),
    mint: async () => ({ value: 'bai-eph-xyz', expiresAt: 999, sessionId: null }),
  });
  const req = () => new Request('http://x/api/realtime/token', { method: 'POST' });
  assert.equal((await handler(req())).status, 200);
  assert.equal((await handler(req())).status, 200);
  assert.equal((await handler(req())).status, 429);
});

test('handler: upstream failure is opaque 502', async () => {
  const handler = createTokenBrokerHandler({
    authorize: async () => ({ userId: 'u1' }),
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
