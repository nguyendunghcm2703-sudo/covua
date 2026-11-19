// Logic một phòng cờ vua online. Thuần JS, không phụ thuộc Cloudflare,
// nên test được bằng Node. Lớp Durable Object (room.js) chỉ lo kết nối và lưu trữ.
//
// Dữ liệu phòng (lưu nguyên vào storage của Durable Object):
//   seats:     { w: idNgườiChơi | null, b: ... }   (id là mã bí mật của từng trình duyệt)
//   game:      trạng thái ván cờ của shared/chess.js
//   over:      null | { winner: 'w'|'b'|null, reason }
//   drawOffer: null | 'w' | 'b'   (bên đang xin hòa)
//   rematch:   { w: bool, b: bool }  (bên nào đã bấm "chơi lại")

import { createGame, applyMove, getResult } from '../public/shared/chess.js';

const opp = (s) => (s === 'w' ? 'b' : 'w');
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export const isValidId = (id) => typeof id === 'string' && ID_RE.test(id);

export function newRoomData() {
  return {
    v: 1,
    gameNo: 1,
    seats: { w: null, b: null },
    game: createGame(),
    over: null,
    drawOffer: null,
    rematch: { w: false, b: false },
  };
}

export function roleOf(data, id) {
  if (id && data.seats.w === id) return 'w';
  if (id && data.seats.b === id) return 'b';
  return 'spectator';
}

// Xếp chỗ cho người vừa vào phòng. Trả về 'w' | 'b' | 'spectator'.
//   want:  'w' | 'b' | khác (ngẫu nhiên) — chỉ có tác dụng khi cả hai chỗ còn trống.
//   opts.prev:      id cũ của cùng trình duyệt (để lấy lại chỗ khi mở lại bằng tab mới).
//   opts.connected: Set các id đang có kết nối (không được "cướp" chỗ của người đang online).
export function join(data, id, want, opts = {}) {
  const { prev = null, connected = new Set(), rand = Math.random } = opts;

  const existing = roleOf(data, id);
  if (existing !== 'spectator') return existing;

  if (isValidId(prev) && prev !== id && !connected.has(prev)) {
    const prevRole = roleOf(data, prev);
    if (prevRole !== 'spectator') {
      data.seats[prevRole] = id;
      return prevRole;
    }
  }

  const free = ['w', 'b'].filter((s) => !data.seats[s]);
  if (free.length === 0) return 'spectator';

  let seat;
  if (free.length === 1) seat = free[0];
  else if (want === 'w' || want === 'b') seat = want;
  else seat = rand() < 0.5 ? 'w' : 'b';

  data.seats[seat] = id;
  return seat;
}

export function snapshot(data, role, online) {
  const g = data.game;
  return {
    t: 'state',
    you: role,
    gameNo: data.gameNo,
    seats: { w: !!data.seats.w, b: !!data.seats.b },
    online,
    turn: g.turn,
    moves: g.history.map((h) => h.uci),
    over: data.over,
    drawOffer: data.drawOffer,
    rematch: data.rematch,
  };
}

const isCell = (n) => Number.isInteger(n) && n >= 0 && n < 64;

// Xử lý một tin nhắn từ người chơi. Trả về:
//   events:  các tin cần gửi cho mọi người trong phòng ({t:'snapshot'} = gửi lại toàn bộ trạng thái)
//   changed: dữ liệu phòng đã đổi (cần lưu)
//   error:   mã lỗi gửi riêng cho người gửi
//   resync:  gửi lại toàn bộ trạng thái riêng cho người gửi
export function handle(data, role, msg) {
  const out = { events: [], changed: false, error: null, resync: false };
  const fail = (code) => {
    out.error = code;
    return out;
  };
  const seated = role === 'w' || role === 'b';
  const bothSeated = !!(data.seats.w && data.seats.b);

  switch (msg.t) {
    case 'sync':
      out.resync = true;
      return out;

    case 'move': {
      if (!seated) return fail('spectator');
      if (data.over) return fail('game_over');
      if (!bothSeated) return fail('waiting');
      if (data.game.turn !== role) return fail('not_your_turn');
      if (!isCell(msg.from) || !isCell(msg.to)) return fail('bad_move');
      const promo = msg.promo === undefined || msg.promo === null || msg.promo === '' ? undefined : msg.promo;
      if (promo !== undefined && !['q', 'r', 'b', 'n'].includes(promo)) return fail('bad_move');

      let next;
      try {
        next = applyMove(data.game, { from: msg.from, to: msg.to, promo });
      } catch (e) {
        out.resync = true;
        return fail('illegal');
      }
      data.game = next;
      data.drawOffer = null;
      const res = getResult(next);
      if (res.over) data.over = { winner: res.winner, reason: res.reason };
      out.changed = true;
      out.events.push({
        t: 'move',
        n: next.history.length,
        from: msg.from,
        to: msg.to,
        promo: promo || null,
        turn: next.turn,
        over: data.over,
      });
      return out;
    }

    case 'resign':
      if (!seated) return fail('spectator');
      if (data.over) return fail('game_over');
      data.over = { winner: opp(role), reason: 'resign' };
      data.drawOffer = null;
      out.changed = true;
      out.events.push({ t: 'over', over: data.over });
      return out;

    case 'draw_offer':
      if (!seated) return fail('spectator');
      if (data.over) return fail('game_over');
      if (!bothSeated) return fail('waiting');
      if (data.drawOffer === role) return out;
      if (data.drawOffer === opp(role)) {
        // đối phương đã xin hòa trước: coi như đồng ý
        data.over = { winner: null, reason: 'draw-agreed' };
        data.drawOffer = null;
        out.changed = true;
        out.events.push({ t: 'over', over: data.over });
        return out;
      }
      data.drawOffer = role;
      out.changed = true;
      out.events.push({ t: 'draw_offer', by: role });
      return out;

    case 'draw_accept':
      if (!seated) return fail('spectator');
      if (data.over) return fail('game_over');
      if (data.drawOffer !== opp(role)) return fail('no_offer');
      data.over = { winner: null, reason: 'draw-agreed' };
      data.drawOffer = null;
      out.changed = true;
      out.events.push({ t: 'over', over: data.over });
      return out;

    case 'draw_decline':
      if (!seated) return fail('spectator');
      if (data.drawOffer !== opp(role)) return fail('no_offer');
      data.drawOffer = null;
      out.changed = true;
      out.events.push({ t: 'draw_declined' });
      return out;

    case 'rematch':
      if (!seated) return fail('spectator');
      if (!data.over) return fail('not_over');
      data.rematch[role] = true;
      out.changed = true;
      if (data.rematch.w && data.rematch.b) {
        // ván mới, đổi bên
        data.seats = { w: data.seats.b, b: data.seats.w };
        data.game = createGame();
        data.over = null;
        data.drawOffer = null;
        data.rematch = { r: false, b: false };
        data.gameNo += 1;
        out.events.push({ t: 'snapshot' });
      } else {
        out.events.push({ t: 'rematch', rematch: data.rematch });
      }
      return out;

    default:
      return fail('unknown');
  }
}
