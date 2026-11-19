// Worker: phục vụ file tĩnh, API mã truy cập, và chuyển kết nối /ws/<MÃ> tới đúng phòng cờ.
// Chỉ ai có cookie hợp lệ (đã nhập đúng SITE_PASSWORD) mới được mở WebSocket.

import { Room } from './room.js';
import { Gate } from './gate.js';
import { handleApi, isAuthorized } from './auth.js';

export { Room, Gate };

function limiterFor(env) {
  const stub = (ip) => env.GATE.get(env.GATE.idFromName(ip));
  const call = async (ip, op) => (await stub(ip).fetch('https://gate/' + op)).json();
  return {
    status: (ip) => call(ip, 'status'),
    fail: (ip) => call(ip, 'fail'),
    reset: (ip) => call(ip, 'reset'),
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      const res = await handleApi(request, env, limiterFor(env));
      return res || new Response('Không tìm thấy', { status: 404 });
    }

    const m = /^\/ws\/([A-Za-z0-9]{4,12})$/.exec(url.pathname);
    if (m) {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Cần kết nối WebSocket', { status: 426 });
      }
      // Chỉ nhận kết nối từ chính trang web này, chặn trang lạ dùng ké server.
      const origin = request.headers.get('Origin');
      if (origin) {
        let host = '';
        try {
          host = new URL(origin).host;
        } catch (e) {
          /* origin hỏng */
        }
        if (host !== url.host) return new Response('Không được phép', { status: 403 });
      }
      if (!(await isAuthorized(request, env))) return new Response('Cần mã truy cập', { status: 401 });
      const id = env.ROOMS.idFromName(m[1].toUpperCase());
      return env.ROOMS.get(id).fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};
