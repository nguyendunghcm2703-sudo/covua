// Durable Object đếm số lần nhập sai mã theo từng IP (mỗi IP một object).
import { DurableObject } from 'cloudflare:workers';
import { gateStatus, gateFail } from './auth.js';

export class Gate extends DurableObject {
  async fetch(request) {
    const op = new URL(request.url).pathname.slice(1);
    const now = Date.now();
    const state = (await this.ctx.storage.get('s')) || { fails: 0, lockUntil: 0 };
    if (op === 'status') return Response.json(gateStatus(state, now));
    if (op === 'fail') {
      await this.ctx.storage.put('s', gateFail(state, now));
      await this.ctx.storage.setAlarm(now + 60 * 60 * 1000);
      return Response.json({ ok: true });
    }
    if (op === 'reset') {
      await this.ctx.storage.deleteAll();
      return Response.json({ ok: true });
    }
    return new Response('not found', { status: 404 });
  }

  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}
