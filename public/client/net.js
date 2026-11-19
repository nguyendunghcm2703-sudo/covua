// Kết nối WebSocket tới phòng cờ: tự nối lại khi rớt mạng, khóa màn hình, đổi sóng.

const PING_EVERY = 25000;
const PONG_TIMEOUT = 3500;

export function connect({ code, clientId, prevId, want, onMessage, onStatus }) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${proto}://${location.host}/ws/${code}`;

  let ws = null;
  let closed = false;
  let attempt = 0;
  let retryTimer = null;
  let pingTimer = null;
  let lastPong = 0;
  let failures = 0; // số lần liên tiếp chưa mở được kết nối

  function clearTimers() {
    clearInterval(pingTimer);
    pingTimer = null;
  }

  function schedule() {
    if (closed) return;
    attempt += 1;
    onStatus('reconnecting');
    const delay = Math.min(8000, 700 * 2 ** (attempt - 1));
    clearTimeout(retryTimer);
    retryTimer = setTimeout(open, delay);
  }

  function open() {
    if (closed) return;
    clearTimeout(retryTimer);
    onStatus(attempt === 0 ? 'connecting' : 'reconnecting');
    const sock = new WebSocket(url);
    ws = sock;

    sock.addEventListener('open', () => {
      sock.__opened = true;
      if (ws !== sock) return;
      attempt = 0;
      failures = 0;
      lastPong = Date.now();
      onStatus('open');
      sock.send(JSON.stringify({ t: 'join', id: clientId, prev: prevId || undefined, want }));
      clearTimers();
      pingTimer = setInterval(() => ping(sock), PING_EVERY);
    });

    sock.addEventListener('message', (e) => {
      if (e.data === 'pong') {
        lastPong = Date.now();
        return;
      }
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch (err) {
        return;
      }
      onMessage(msg);
    });

    sock.addEventListener('close', () => {
      if (ws !== sock) return;
      clearTimers();
      if (!sock.__opened) failures += 1;
      // Bị từ chối liên tiếp: có thể cookie truy cập đã hết hạn hoặc mã đã đổi.
      if (failures >= 2) {
        failures = 0;
        fetch('/api/session', { cache: 'no-store' })
          .then((r) => r.json())
          .then((s) => {
            if (closed) return;
            if (!s.ok) {
              closed = true;
              onMessage({ t: 'error', code: 'unauthorized' });
            } else schedule();
          })
          .catch(() => schedule());
        return;
      }
      schedule();
    });

    sock.addEventListener('error', () => {
      /* sự kiện close sẽ đến ngay sau đó */
    });
  }

  // Gửi ping; nếu không có pong thì coi như kết nối đã chết và nối lại.
  function ping(sock) {
    if (sock.readyState !== 1) return;
    const sentAt = Date.now();
    sock.send('ping');
    setTimeout(() => {
      if (ws === sock && lastPong < sentAt && sock.readyState === 1) sock.close();
    }, PONG_TIMEOUT);
  }

  function wake() {
    if (closed) return;
    if (!ws || ws.readyState > 1) {
      attempt = 0;
      open();
    } else if (ws.readyState === 1) {
      ping(ws); // sau khi khóa màn hình, kết nối có thể đã chết mà không báo
    }
  }

  const onVisible = () => {
    if (!document.hidden) wake();
  };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', wake);

  open();

  return {
    send(obj) {
      if (!ws || ws.readyState !== 1) return false;
      ws.send(JSON.stringify(obj));
      return true;
    },
    close() {
      closed = true;
      clearTimers();
      clearTimeout(retryTimer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', wake);
      try {
        if (ws) ws.close();
      } catch (err) {
        /* đã đóng */
      }
    },
  };
}
