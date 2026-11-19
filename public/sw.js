// Service worker nhỏ: ưu tiên mạng (luôn nhận bản mới khi online), rớt mạng thì dùng bản đã lưu.
// Không đụng tới WebSocket và các yêu cầu không phải GET.
const CACHE = 'covua3d-v1';
const THREE_HOST = 'cdn.jsdelivr.net';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && url.hostname !== THREE_HOST) return;
  if (sameOrigin && url.pathname.startsWith('/ws/')) return;

  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      // Thư viện Three.js có số phiên bản trong đường dẫn nên dùng bản lưu trước cho nhanh.
      if (!sameOrigin) {
        const hit = await cache.match(req);
        if (hit) return hit;
      }
      try {
        const res = await fetch(req);
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      } catch (err) {
        const hit = (await cache.match(req)) || (req.mode === 'navigate' && (await cache.match('/')));
        if (hit) return hit;
        throw err;
      }
    })()
  );
});
