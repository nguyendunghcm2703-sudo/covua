// Chạy máy đánh cờ trong luồng riêng để giao diện không bị đứng khi máy suy nghĩ.
import { chooseMove } from '../shared/engine.js';

self.onmessage = (e) => {
  const { id, level, ...state } = e.data;
  try {
    const mv = chooseMove(state, level);
    self.postMessage({ id, move: mv ? { from: mv.from, to: mv.to, promo: mv.promo } : null });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
