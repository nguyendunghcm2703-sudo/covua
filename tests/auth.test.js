import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeToken, verifyToken, codeMatches, handleApi, isAuthorized, readCookie,
  gateStatus, gateFail, MAX_FAILS, LOCK_MS, TTL_MS, COOKIE,
} from '../worker/auth.js';

globalThis.WebSocketRequestResponsePair = class {};
const { Gate } = await import('../worker/gate.js');
const index = (await import('../worker/index.js')).default;

function memLimiter() {
  const m = new Map();
  let now = Date.now();
  return {
    tick: (ms) => (now += ms),
    status: async (ip) => gateStatus(m.get(ip), now),
    fail: async (ip) => void m.set(ip, gateFail(m.get(ip), now)),
    reset: async (ip) => void m.delete(ip),
  };
}
const env = { SITE_PASSWORD: 'ma-bi-mat' };
const post = (path, body, headers = {}) =>
  new Request('https://x.test' + path, { method: 'POST', body: JSON.stringify(body), headers });

test('Token: đúng thì qua, sai chữ ký/hết hạn/đổi mã thì không', async () => {
  const now = 1_800_000_000_000;
  const t = await makeToken('a', now);
  assert.equal(await verifyToken('a', t, now + 1000), true);
  assert.equal(await verifyToken('b', t, now + 1000), false, 'đổi mã là cookie cũ mất hiệu lực');
  assert.equal(await verifyToken('a', t, now + TTL_MS + 1), false, 'hết hạn');
  assert.equal(await verifyToken('a', t.slice(0, -2) + 'xx', now), false);
  assert.equal(await verifyToken('a', '', now), false);
  assert.equal(await verifyToken('a', 'abc', now), false);
  assert.equal(await verifyToken('', t, now), false);
});

test('codeMatches chỉ đúng với đúng mã', async () => {
  assert.equal(await codeMatches('mã', 'mã'), true);
  assert.equal(await codeMatches('mã', 'mã '), false);
  assert.equal(await codeMatches('mã', ''), false);
  assert.equal(await codeMatches('mã', 5), false);
});

test('Đăng nhập đúng: đặt cookie HttpOnly và cookie đó dùng được', async () => {
  const lim = memLimiter();
  const res = await handleApi(post('/api/login', { code: 'ma-bi-mat' }), env, lim);
  assert.equal(res.status, 200);
  const sc = res.headers.get('set-cookie');
  assert.match(sc, /HttpOnly/);
  assert.match(sc, /SameSite=Strict/);
  assert.match(sc, /Secure/);
  const cookie = sc.split(';')[0];
  const req = new Request('https://x.test/api/session', { headers: { Cookie: cookie } });
  assert.deepEqual(await (await handleApi(req, env, lim)).json(), { configured: true, ok: true });
  assert.equal(await isAuthorized(req, env), true);
  assert.equal(await isAuthorized(req, { SITE_PASSWORD: 'khac' }), false);
  assert.equal(readCookie(req), cookie.split('=').slice(1).join('='));
});

test('Sai mã: 401; sai 5 lần thì khóa 5 phút kể cả khi nhập đúng; hết hạn khóa thì vào lại được', async () => {
  const lim = memLimiter();
  for (let i = 0; i < MAX_FAILS; i++) {
    const r = await handleApi(post('/api/login', { code: 'sai' + i }), env, lim);
    assert.equal(r.status, 401);
  }
  const locked = await handleApi(post('/api/login', { code: 'ma-bi-mat' }), env, lim);
  assert.equal(locked.status, 429);
  assert.ok(Number(locked.headers.get('retry-after')) > 0);
  lim.tick(LOCK_MS + 1000);
  assert.equal((await handleApi(post('/api/login', { code: 'ma-bi-mat' }), env, lim)).status, 200);
});

test('Chưa cấu hình SITE_PASSWORD: đăng nhập báo 503, phiên không hợp lệ', async () => {
  const lim = memLimiter();
  assert.equal((await handleApi(post('/api/login', { code: 'x' }), {}, lim)).status, 503);
  const s = await (await handleApi(new Request('https://x.test/api/session'), {}, lim)).json();
  assert.deepEqual(s, { configured: false, ok: false });
});

test('Từ chối đăng nhập từ trang lạ và dữ liệu hỏng', async () => {
  const lim = memLimiter();
  const evil = post('/api/login', { code: 'ma-bi-mat' }, { Origin: 'https://evil.test' });
  assert.equal((await handleApi(evil, env, lim)).status, 403);
  assert.equal((await handleApi(post('/api/login', {}), env, lim)).status, 400);
  const bad = new Request('https://x.test/api/login', { method: 'POST', body: 'không phải json' });
  assert.equal((await handleApi(bad, env, lim)).status, 400);
  assert.equal(await handleApi(new Request('https://x.test/khac'), env, lim), null);
});

test('Gate (Durable Object) đếm sai theo IP và khóa', async () => {
  const store = new Map();
  const ctx = {
    storage: {
      get: async (k) => store.get(k),
      put: async (k, v) => void store.set(k, structuredClone(v)),
      deleteAll: async () => store.clear(),
      setAlarm: async () => {},
    },
  };
  const g = new Gate(ctx, {});
  const call = async (op) => (await g.fetch(new Request('https://gate/' + op))).json();
  assert.equal((await call('status')).locked, false);
  for (let i = 0; i < MAX_FAILS; i++) await call('fail');
  assert.equal((await call('status')).locked, true);
  await call('reset');
  assert.equal((await call('status')).locked, false);
});

test('Worker: /ws cần cookie hợp lệ; có cookie thì chuyển tới phòng', async () => {
  const seen = [];
  const e = {
    SITE_PASSWORD: 'ma-bi-mat',
    ROOMS: { idFromName: (n) => n, get: (id) => ({ fetch: async () => (seen.push(id), new Response('room', { status: 200 })) }) },
    ASSETS: { fetch: async () => new Response('asset') },
    GATE: null,
  };
  const ws = (headers = {}) => new Request('https://x.test/ws/abcd12', { headers: { Upgrade: 'websocket', Origin: 'https://x.test', ...headers } });
  assert.equal((await index.fetch(ws(), e)).status, 401);
  const token = await makeToken('ma-bi-mat');
  const ok = await index.fetch(ws({ Cookie: `${COOKIE}=${token}` }), e);
  assert.equal(ok.status, 200);
  assert.deepEqual(seen, ['ABCD12']);
  assert.equal((await index.fetch(ws({ Cookie: `${COOKIE}=${token}`, Origin: 'https://evil.test' }), e)).status, 403);
  assert.equal((await index.fetch(ws({ Cookie: `${COOKIE}=${token}` }), { ...e, SITE_PASSWORD: '' })).status, 401, 'chưa đặt mã thì khóa');
  assert.equal(await (await index.fetch(new Request('https://x.test/'), e)).text(), 'asset');
});
