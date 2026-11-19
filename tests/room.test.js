// Test lớp Durable Object "Room" bằng ctx và WebSocket giả (không cần Cloudflare).
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.WebSocketRequestResponsePair = class {
  constructor(request, response) {
    this.request = request;
    this.response = response;
  }
};

const { Room } = await import('../worker/room.js');

class FakeWs {
  constructor() {
    this.sent = [];
    this.att = null;
    this.closed = false;
  }
  send(m) {
    this.sent.push(JSON.parse(m));
  }
  serializeAttachment(a) {
    this.att = structuredClone(a);
  }
  deserializeAttachment() {
    return this.att;
  }
  close() {
    this.closed = true;
  }
  of(type) {
    return this.sent.filter((m) => m.t === type);
  }
  last(type) {
    const l = this.of(type);
    return l[l.length - 1];
  }
}

function makeCtx(store = new Map()) {
  const ctx = {
    store,
    alarm: null,
    sockets: [],
    storage: {
      get: async (k) => (store.has(k) ? structuredClone(store.get(k)) : undefined),
      put: async (k, v) => void store.set(k, structuredClone(v)),
      deleteAll: async () => store.clear(),
      setAlarm: async (t) => void (ctx.alarm = t),
    },
    acceptWebSocket: (ws) => ctx.sockets.push(ws),
    getWebSockets: () => ctx.sockets.slice(),
    setWebSocketAutoResponse: () => {},
    blockConcurrencyWhile: (fn) => (ctx.ready = fn()),
  };
  return ctx;
}

async function makeRoom(store) {
  const ctx = makeCtx(store);
  const room = new Room(ctx, {});
  await ctx.ready;
  return { ctx, room };
}

async function connect({ ctx, room }, id, want = 'any', prev) {
  const ws = new FakeWs();
  ctx.acceptWebSocket(ws);
  await room.webSocketMessage(ws, JSON.stringify({ t: 'join', id, want, prev }));
  return ws;
}

const send = (room, ws, obj) => room.webSocketMessage(ws, JSON.stringify(obj));
const ID_A = 'player-aaaa-0001';
const ID_B = 'player-bbbb-0002';
const ID_C = 'player-cccc-0003';

test('Hai người vào phòng: nhận chỗ, thấy nhau online, đi nước thì cả hai nhận được', async () => {
  const env = await makeRoom();
  const a = await connect(env, ID_A, 'w');
  assert.equal(a.last('state').you, 'w');
  assert.deepEqual(a.last('state').seats, { w: true, b: false });

  const b = await connect(env, ID_B);
  assert.equal(b.last('state').you, 'b');
  assert.deepEqual(b.last('state').online, { w: true, b: true });
  assert.deepEqual(a.last('presence').online, { w: true, b: true }, 'A được báo là B đã vào');

  await send(env.room, a, { t: 'move', from: 52, to: 36 });
  assert.equal(a.last('move').n, 1);
  assert.equal(b.last('move').n, 1);
  assert.equal(b.last('move').turn, 'b');

  await send(env.room, a, { t: 'move', from: 67, to: 70 });
  assert.equal(a.last('error').code, 'not_your_turn');
  assert.equal(b.of('error').length, 0, 'lỗi chỉ gửi cho người gửi');
});

test('Nước sai luật: báo lỗi và gửi lại trạng thái đúng cho người gửi', async () => {
  const env = await makeRoom();
  const a = await connect(env, ID_A, 'w');
  await connect(env, ID_B);
  const before = a.of('state').length;
  await send(env.room, a, { t: 'move', from: 56, to: 24 }); // xe a1 bị chặn
  assert.equal(a.last('error').code, 'illegal');
  assert.equal(a.of('state').length, before + 1);
});

test('Rớt mạng rồi vào lại bằng cùng id: giữ nguyên chỗ và thế cờ, đối thủ thấy mất/nối lại', async () => {
  const env = await makeRoom();
  const a = await connect(env, ID_A, 'w');
  const b = await connect(env, ID_B);
  await send(env.room, a, { t: 'move', from: 52, to: 36 });

  env.ctx.sockets = env.ctx.sockets.filter((s) => s !== a);
  await env.room.webSocketClose(a, 1006);
  assert.deepEqual(b.last('presence').online, { w: false, b: true });

  const a2 = await connect(env, ID_A, 'any');
  assert.equal(a2.last('state').you, 'w');
  assert.deepEqual(a2.last('state').moves, ['e2e4']);
  assert.deepEqual(b.last('presence').online, { w: true, b: true });
});

test('Mở bằng tab mới sau khi mất kết nối: lấy lại chỗ qua id cũ', async () => {
  const env = await makeRoom();
  const a = await connect(env, ID_A, 'w');
  await connect(env, ID_B);
  env.ctx.sockets = env.ctx.sockets.filter((s) => s !== a);
  await env.room.webSocketClose(a, 1006);

  const a2 = await connect(env, ID_C, 'any', ID_A);
  assert.equal(a2.last('state').you, 'w');
});

test('Phòng "ngủ" rồi thức dậy (object mới, cùng storage): ván cờ còn nguyên', async () => {
  const store = new Map();
  const env1 = await makeRoom(store);
  const a = await connect(env1, ID_A, 'w');
  const b = await connect(env1, ID_B);
  await send(env1.room, a, { t: 'move', from: 52, to: 36 });
  await send(env1.room, b, { t: 'move', from: 12, to: 28 });

  const env2 = await makeRoom(store);
  const a2 = await connect(env2, ID_A);
  assert.equal(a2.last('state').you, 'w');
  assert.equal(a2.last('state').moves.length, 2);
  await send(env2.room, a2, { t: 'move', from: 62, to: 45 }); // đi tiếp được
  assert.equal(a2.last('move').n, 3);
});

test('Khán giả xem được nhưng không đi được', async () => {
  const env = await makeRoom();
  await connect(env, ID_A, 'w');
  await connect(env, ID_B);
  const c = await connect(env, ID_C);
  assert.equal(c.last('state').you, 'spectator');
  await send(env.room, c, { t: 'move', from: 52, to: 36 });
  assert.equal(c.last('error').code, 'spectator');
});

test('Chơi lại: cả hai nhận trạng thái mới với bên đã đổi', async () => {
  const env = await makeRoom();
  const a = await connect(env, ID_A, 'w');
  const b = await connect(env, ID_B);
  await send(env.room, b, { t: 'resign' });
  assert.equal(a.last('over').over.winner, 'w');
  await send(env.room, a, { t: 'rematch' });
  assert.equal(b.last('rematch').rematch.w, true);
  await send(env.room, b, { t: 'rematch' });
  assert.equal(a.last('state').you, 'b');
  assert.equal(b.last('state').you, 'w');
  assert.equal(a.last('state').moves.length, 0);
});

test('Tin nhắn rác bị bỏ qua, không làm sập phòng', async () => {
  const env = await makeRoom();
  const a = await connect(env, ID_A, 'w');
  await env.room.webSocketMessage(a, 'không phải json');
  await env.room.webSocketMessage(a, JSON.stringify({ x: 1 }));
  await env.room.webSocketMessage(a, 'x'.repeat(5000));
  await env.room.webSocketMessage(a, new ArrayBuffer(8));
  const raw = new FakeWs();
  env.ctx.acceptWebSocket(raw);
  await send(env.room, raw, { t: 'move', from: 52, to: 36 });
  assert.equal(raw.last('error').code, 'not_joined');
  await send(env.room, raw, { t: 'join', id: 'x', want: 'w' });
  assert.equal(raw.last('error').code, 'bad_id');
});

test('Phòng bỏ trống quá lâu bị dọn; còn người thì giữ lại', async () => {
  const env = await makeRoom();
  const a = await connect(env, ID_A, 'w');
  await connect(env, ID_B);
  assert.ok(env.ctx.alarm > Date.now(), 'có đặt báo thức dọn phòng');

  await env.room.alarm();
  assert.ok(env.ctx.store.has('room'), 'còn người trong phòng thì không xóa');

  env.ctx.sockets = [];
  await env.room.alarm();
  assert.equal(env.ctx.store.size, 0);
  assert.equal(env.room.data.seats.w, null);
  assert.ok(a);
});
