// Mã truy cập chung cho phần chơi từ xa. Thuần JS (Web Crypto), test được bằng Node.
//
//   POST /api/login   { code }  -> đúng: đặt cookie đã ký (HttpOnly, 12 giờ); sai: 401; khóa: 429
//   GET  /api/session           -> { ok, configured }
//   POST /api/logout            -> xóa cookie
// Mã nằm trong secret SITE_PASSWORD của Cloudflare. Cookie ký bằng HMAC dẫn xuất từ mã đó,
// nên đổi mã là mọi cookie cũ mất hiệu lực.

export const COOKIE = 'ct_access';
export const TTL_MS = 12 * 60 * 60 * 1000; // chỉ đủ cho một lần chơi; client luôn hỏi lại mã mỗi lần vào
export const MAX_FAILS = 5;
export const LOCK_MS = 5 * 60 * 1000;
const MAX_CODE = 128;

const enc = new TextEncoder();

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode('covua3d:v1:' + secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(text))));
}

export function sameText(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// So mã bằng cách so băm của hai chuỗi (độ dài cố định, không lộ độ dài mã thật).
export async function codeMatches(secret, given) {
  if (typeof given !== 'string') return false;
  const a = await hmac(secret, 'code:' + secret);
  const b = await hmac(secret, 'code:' + given.slice(0, MAX_CODE));
  return sameText(a, b);
}

export async function makeToken(secret, now = Date.now(), ttl = TTL_MS) {
  const exp = String(now + ttl);
  return exp + '.' + (await hmac(secret, 'tok:' + exp));
}

export async function verifyToken(secret, token, now = Date.now()) {
  if (!secret || typeof token !== 'string') return false;
  const i = token.indexOf('.');
  if (i < 1) return false;
  const exp = token.slice(0, i);
  if (!/^\d{10,16}$/.test(exp) || Number(exp) <= now) return false;
  return sameText(token.slice(i + 1), await hmac(secret, 'tok:' + exp));
}

export function readCookie(request, name = COOKIE) {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return '';
}

export async function isAuthorized(request, env, now = Date.now()) {
  if (!env.SITE_PASSWORD) return false; // chưa cấu hình thì khóa hẳn
  return verifyToken(env.SITE_PASSWORD, readCookie(request), now);
}

// ---- giới hạn thử sai, theo từng IP. Thuần số học: Gate (Durable Object) chỉ lo lưu trữ. ----
export function gateStatus(state, now) {
  if (state && state.lockUntil && now < state.lockUntil) {
    return { locked: true, retryAfter: Math.ceil((state.lockUntil - now) / 1000) };
  }
  return { locked: false, retryAfter: 0 };
}

export function gateFail(state, now) {
  const s = { fails: (state && state.fails) || 0, lockUntil: (state && state.lockUntil) || 0 };
  if (s.lockUntil && now >= s.lockUntil) {
    s.lockUntil = 0;
    s.fails = 0;
  }
  s.fails += 1;
  if (s.fails >= MAX_FAILS) {
    s.fails = 0;
    s.lockUntil = now + LOCK_MS;
  }
  return s;
}

const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

function cookieHeader(value, maxAgeSec, secure) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}` + (secure ? '; Secure' : '');
}

// limiter: { status(ip) -> {locked, retryAfter}, fail(ip), reset(ip) } (bất đồng bộ)
export async function handleApi(request, env, limiter, now = Date.now()) {
  const url = new URL(request.url);
  const secure = url.protocol === 'https:';
  const ip = request.headers.get('CF-Connecting-IP') || 'local';

  if (url.pathname === '/api/session' && request.method === 'GET') {
    const configured = !!env.SITE_PASSWORD;
    return json({ configured, ok: configured && (await isAuthorized(request, env, now)) });
  }

  if (url.pathname === '/api/logout' && request.method === 'POST') {
    return json({ ok: true }, 200, { 'set-cookie': cookieHeader('', 0, secure) });
  }

  if (url.pathname === '/api/login' && request.method === 'POST') {
    if (!env.SITE_PASSWORD) return json({ error: 'not_configured' }, 503);
    const origin = request.headers.get('Origin');
    if (origin) {
      let host = '';
      try {
        host = new URL(origin).host;
      } catch (e) {
        /* origin hỏng */
      }
      if (host !== url.host) return json({ error: 'forbidden' }, 403);
    }
    const st = await limiter.status(ip);
    if (st.locked) return json({ error: 'locked', retryAfter: st.retryAfter }, 429, { 'retry-after': String(st.retryAfter) });

    let body = null;
    try {
      const text = await request.text();
      if (text.length > 1024) return json({ error: 'bad_request' }, 400);
      body = JSON.parse(text);
    } catch (e) {
      return json({ error: 'bad_request' }, 400);
    }
    if (!body || typeof body.code !== 'string' || !body.code) return json({ error: 'bad_request' }, 400);

    if (await codeMatches(env.SITE_PASSWORD, body.code)) {
      await limiter.reset(ip);
      const token = await makeToken(env.SITE_PASSWORD, now);
      return json({ ok: true }, 200, { 'set-cookie': cookieHeader(token, Math.floor(TTL_MS / 1000), secure) });
    }
    await limiter.fail(ip);
    return json({ error: 'bad_code' }, 401);
  }

  return null;
}
