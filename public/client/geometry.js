// Hình học bàn cờ vua: thuần số học, không phụ thuộc Three.js nên test được bằng Node.
//
// Hệ tọa độ thế giới (đơn vị = một ô cờ):
//   x: cột a -> h (trái -> phải), tâm bàn x = 0
//   z: hàng 0 (hạng 8, đầu Đen, phía xa) -> hàng 7 (hạng 1, đầu Trắng, phía gần camera)
//   y: hướng lên, mặt bàn cờ ở y = 0

export const S = 1;
export const BOARD_W = 9.2; // tấm gỗ: 8 ô + lề
export const BOARD_D = 9.2;
export const BOARD_H = 0.5;
export const GRID_MARGIN = 0.6; // từ mép tấm gỗ tới ô ngoài cùng

export function cellToWorld(row, col) {
  return { x: (col - 3.5) * S, z: (row - 3.5) * S };
}

// Ô gần nhất với điểm (x, z), hoặc null nếu ngoài bàn cờ.
export function worldToCell(x, z) {
  const col = Math.round(x / S + 3.5);
  const row = Math.round(z / S + 3.5);
  if (col < 0 || col > 7 || row < 0 || row > 7) return null;
  return { row, col };
}

export const EXTENT = {
  tb: { w: 9.6, h: 13 },
  lr: { w: 14, h: 9.6 },
};

export function fitDistance(aspect, vfovDeg = 40, layout = 'tb') {
  const e = EXTENT[layout] || EXTENT.tb;
  const t = Math.tan((vfovDeg * Math.PI) / 360);
  return Math.max(e.w / (2 * t * aspect), e.h / (2 * t));
}
