import test from 'node:test';
import assert from 'node:assert/strict';
import { cellToWorld, worldToCell, fitDistance } from '../public/client/geometry.js';

test('Ô cờ <-> tọa độ thế giới: đổi qua lại cho mọi ô', () => {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const { x, z } = cellToWorld(r, c);
      assert.deepEqual(worldToCell(x, z), { row: r, col: c });
    }
  }
});

test('Bên Trắng (hàng 7) ở phía gần camera (z dương), bên Đen (hàng 0) ở phía xa', () => {
  assert.ok(cellToWorld(7, 4).z > 0);
  assert.ok(cellToWorld(0, 4).z < 0);
  assert.equal(cellToWorld(5, 3.5).x, 0);
});

test('Điểm lệch vài phần ô vẫn về đúng ô gần nhất', () => {
  const { x, z } = cellToWorld(7, 1);
  assert.deepEqual(worldToCell(x + 0.3, z - 0.3), { row: 7, col: 1 });
});

test('Ngoài bàn cờ thì trả về null', () => {
  assert.equal(worldToCell(10, 0), null);
  assert.equal(worldToCell(0, 10), null);
  assert.equal(worldToCell(-5, 0), null);
});

test('Màn hình dọc cần camera xa hơn màn hình ngang', () => {
  assert.ok(fitDistance(0.5) > fitDistance(1.6));
  assert.ok(fitDistance(1.6) > 0);
});
