// Durable Object: mỗi phòng cờ là một object riêng (tên object = mã phòng).
// Dùng WebSocket Hibernation: khi phòng không có tin nhắn, object được "ngủ"
// để tiết kiệm hạn mức, kết nối WebSocket vẫn giữ nguyên.

import { DurableObject } from 'cloudflare:workers';
import { newRoomData, isValidId, roleOf, join, snapshot, handle } from './room-logic.js';

const MAX_SOCKETS = 12;
const MAX_MESSAGE = 2048;
const IDLE_MS = 24 * 60 * 60 * 1000; // dọn phòng bỏ trống sau 24 giờ

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.data = newRoomData();
    // "ping" -> "pong" do hệ thống trả lời, không đánh thức object đang ngủ.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get('room');
      if (saved) this.data = saved;
    });
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Cần kết nối WebSocket', { status: 426 });
    }
    if (this.ctx.getWebSockets().length >= MAX_SOCKETS) {
      return new Response('Phòng đã đầy', { status: 503 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  // ---------- gửi tin ----------

  send(ws, obj) {
    try {
      ws.send(JSON.stringify(obj));
    } catch (e) {
      /* kết nối đã đóng */
    }
  }

  joinedSockets() {
    return this.ctx.getWebSockets().filter((ws) => {
      const att = ws.deserializeAttachment();
      return att && att.id;
    });
  }

  connectedIds(exclude) {
    const ids = new Set();
    for (const ws of this.joinedSockets()) {
      if (ws !== exclude) ids.add(ws.deserializeAttachment().id);
    }
    return ids;
  }

  presence(exclude) {
    const ids = this.connectedIds(exclude);
    return {
      w: !!this.data.seats.w && ids.has(this.data.seats.w),
      b: !!this.data.seats.b && ids.has(this.data.seats.b),
    };
  }

  broadcast(obj, exclude) {
    for (const ws of this.joinedSockets()) {
      if (ws !== exclude) this.send(ws, obj);
    }
  }

  broadcastPresence(exclude) {
    this.broadcast(
      {
        t: 'presence',
        seats: { w: !!this.data.seats.w, b: !!this.data.seats.b },
        online: this.presence(exclude),
      },
      exclude
    );
  }

  sendSnapshot(ws, exclude) {
    const id = ws.deserializeAttachment().id;
    this.send(ws, snapshot(this.data, roleOf(this.data, id), this.presence(exclude)));
  }

  async save() {
    await this.ctx.storage.put('room', this.data);
    await this.ctx.storage.setAlarm(Date.now() + IDLE_MS);
  }

  // ---------- sự kiện WebSocket ----------

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE) return;
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      return;
    }
    if (!msg || typeof msg.t !== 'string') return;

    if (msg.t === 'join') {
      if (!isValidId(msg.id)) {
        this.send(ws, { t: 'error', code: 'bad_id' });
        return;
      }
      ws.serializeAttachment({ id: msg.id });
      const had = roleOf(this.data, msg.id);
      const role = join(this.data, msg.id, msg.want, {
        prev: msg.prev,
        connected: this.connectedIds(ws),
      });
      if (had !== role) await this.save();
      this.sendSnapshot(ws);
      this.broadcastPresence();
      return;
    }

    const att = ws.deserializeAttachment();
    if (!att || !att.id) {
      this.send(ws, { t: 'error', code: 'not_joined' });
      return;
    }

    const role = roleOf(this.data, att.id);
    const res = handle(this.data, role, msg);
    if (res.changed) await this.save();
    if (res.error) this.send(ws, { t: 'error', code: res.error });
    if (res.resync) this.sendSnapshot(ws);
    for (const ev of res.events) {
      if (ev.t === 'snapshot') {
        for (const s of this.joinedSockets()) this.sendSnapshot(s);
      } else {
        this.broadcast(ev);
      }
    }
  }

  async webSocketClose(ws, code) {
    try {
      ws.close(1000, 'bye');
    } catch (e) {
      /* đã đóng */
    }
    this.broadcastPresence(ws);
  }

  async webSocketError(ws) {
    this.broadcastPresence(ws);
  }

  // Dọn phòng bỏ trống quá lâu để không tốn dung lượng lưu trữ.
  async alarm() {
    if (this.ctx.getWebSockets().length > 0) {
      await this.ctx.storage.setAlarm(Date.now() + 6 * 60 * 60 * 1000);
      return;
    }
    await this.ctx.storage.deleteAll();
    this.data = newRoomData();
  }
}
