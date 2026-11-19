import test from 'node:test';
import assert from 'node:assert/strict';
import { traySlot, trayBase, capturedFromHistory, layoutFor, layoutBox, trayCapacity } from '../public/client/tray.js';
import { BOARD_W, BOARD_D, fitDistance } from '../public/client/geometry.js';
import { createGame, applyMove, legalMoves } from '../public/shared/chess.js';

test('layoutFor: dọc -> tb, ngang -> lr', () => {
  assert.equal(layoutFor(0.5), 'tb');
  assert.equal(layoutFor(1.6), 'lr');
});

test('Khay nằm ngoài tấm bàn cờ, không ô nào trùng nhau', () => {
  for (const layout of ['tb', 'lr']) {
    for (const side of ['w', 'b']) {
      const seen = new Set();
      for (let i = 0; i < 16; i++) {
        const { x, z } = traySlot(side, i, layout);
        assert.ok(Math.abs(x) > BOARD_W / 2 || Math.abs(z) > BOARD_D / 2, `${layout}${side}${i}`);
        const k = `${x.toFixed(2)},${z.toFixed(2)}`;
        assert.ok(!seen.has(k));
        seen.add(k);
      }
    }
  }
});

test('Quân Đỏ bị ăn nằm phía Đen (z âm), quân Đen bị ăn nằm phía Đỏ (z dương), ở cả hai bố cục', () => {
  for (const layout of ['tb', 'lr']) {
    for (let i = 0; i < trayCapacity(layout); i++) {
      assert.ok(traySlot('w', i, layout).z < 0, `w ${layout} ${i}`);
      assert.ok(traySlot('b', i, layout).z > 0, `b ${layout} ${i}`);
    }
  }
});

test('Bố cục ngang: hai khay cùng một cột bên phải bàn và không chồng lên nhau', () => {
  const r = trayBase('w', 'lr');
  const b = trayBase('b', 'lr');
  assert.ok(r.cx - r.w / 2 > BOARD_W / 2 && b.cx - b.w / 2 > BOARD_W / 2);
  assert.ok(r.cz + r.d / 2 <= 0 && b.cz - b.d / 2 >= 0, 'hai khay chia hai nửa phía Đen và phía Đỏ');
});

test('Khay chứa đủ 16 quân mỗi bên và quân nằm trong tấm khay', () => {
  for (const layout of ['tb', 'lr']) {
    assert.ok(trayCapacity(layout) >= 16);
    for (const side of ['w', 'b']) {
      const base = trayBase(side, layout);
      for (let i = 0; i < 16; i++) {
        const s = traySlot(side, i, layout);
        assert.ok(Math.abs(s.x - base.cx) <= base.w / 2 && Math.abs(s.z - base.cz) <= base.d / 2, `${layout}${side}${i}`);
      }
    }
  }
});

test('layoutBox chứa cả bàn lẫn hai khay', () => {
  for (const layout of ['tb', 'lr']) {
    const box = layoutBox(layout);
    assert.ok(box.minX <= -BOARD_W / 2 && box.maxX >= BOARD_W / 2 && box.minZ <= -BOARD_D / 2 && box.maxZ >= BOARD_D / 2);
    for (const side of ['w', 'b']) {
      for (let i = 0; i < 16; i++) {
        const s = traySlot(side, i, layout);
        assert.ok(s.x >= box.minX && s.x <= box.maxX && s.z >= box.minZ && s.z <= box.maxZ);
      }
    }
  }
});

test('capturedFromHistory gom quân bị ăn theo bên', () => {
  let g = createGame();
  let n = 0;
  // chơi nước ăn quân tham lam cho tới khi có vài quân bị ăn
  while (n < 120) {
    const ms = legalMoves(g);
    if (!ms.length) break;
    const cap = ms.find((m) => g.board[m.to] !== '.');
    g = applyMove(g, cap || ms[(n * 7) % ms.length]);
    n++;
    if (capturedFromHistory(g.history).w.length >= 2 && capturedFromHistory(g.history).b.length >= 2) break;
  }
  const c = capturedFromHistory(g.history);
  assert.ok(c.w.every((ch) => ch === ch.toUpperCase()));
  assert.ok(c.b.every((ch) => ch === ch.toLowerCase()));
  assert.equal(c.w.length + c.b.length, g.history.filter((h) => h.captured).length);
});

test('fitDistance theo bố cục khay', () => {
  assert.ok(fitDistance(0.5, 40, 'tb') > 0);
  assert.ok(fitDistance(1.8, 40, 'lr') > 0);
  assert.ok(fitDistance(0.5, 40, 'tb') > fitDistance(1.6, 40, 'tb'));
});
