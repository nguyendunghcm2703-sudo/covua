// Cầu nối giữa giao diện và máy đánh cờ: ưu tiên Web Worker, không có thì chạy ngay trong trang.
let worker = null;
let nextId = 1;
let waiting = new Map();
let workerBroken = false;

function startWorker() {
  if (worker || workerBroken || typeof Worker === 'undefined') return worker;
  try {
    worker = new Worker(new URL('ai-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const w = waiting.get(e.data.id);
      if (!w) return;
      waiting.delete(e.data.id);
      if (e.data.error) w.reject(new Error(e.data.error));
      else w.resolve(e.data.move);
    };
    worker.onerror = () => {
      workerBroken = true;
      const pend = [...waiting.values()];
      waiting = new Map();
      worker = null;
      for (const w of pend) w.fallback();
    };
  } catch (e) {
    workerBroken = true;
    worker = null;
  }
  return worker;
}

async function inPage(state, level) {
  const { chooseMove } = await import('../shared/engine.js');
  await new Promise((r) => setTimeout(r, 30)); // nhường cho giao diện vẽ chữ "đang nghĩ"
  const mv = chooseMove(state, level);
  return mv ? { from: mv.from, to: mv.to, promo: mv.promo } : null;
}

export function think(state, level) {
  const payload = { board: state.board, turn: state.turn, castling: state.castling, ep: state.ep, halfmove: state.halfmove, fullmove: state.fullmove, history: state.history, level };
  const w = startWorker();
  if (!w) return inPage(payload, level);
  return new Promise((resolve, reject) => {
    const id = nextId++;
    waiting.set(id, { resolve, reject, fallback: () => inPage(payload, level).then(resolve, reject) });
    w.postMessage({ id, ...payload });
  });
}

// Hủy lượt đang nghĩ (đi lại, ván mới...) bằng cách tắt worker; lần sau tạo lại.
export function cancel() {
  waiting = new Map();
  if (worker) {
    worker.terminate();
    worker = null;
  }
}
