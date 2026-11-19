// Khay quân bị ăn: quân đặt ngoài bàn cờ như ngoài đời. Thuần số học, test được bằng Node.
//
// Tọa độ trong hệ của bàn cờ (không xoay). Quân Đỏ bị ăn ('r') nằm phía người cầm Đen (z âm, phía xa),
// quân Đen bị ăn ('b') nằm phía người cầm Đỏ (z dương, phía gần). Bàn lật thì cả bàn và khay xoay cùng nhau.
//
// Hai bố cục:
//   'tb' (màn dọc):  hai khay nằm phía trên và phía dưới bàn.
//   'lr' (màn ngang): hai khay xếp chồng trong một cột bên phải bàn; nửa xa là phía Đen, nửa gần là phía Đỏ.

import { BOARD_W, BOARD_D } from './geometry.js';

export const TRAY_SCALE = 0.62;
const ROW_GAP = 0.85;
const COL_GAP = 0.9;
const TB_PER_ROW = 8;
const TB_ROWS = 2;
const LR_PER_ROW = 5; // theo chiều dọc của bàn
const LR_ROWS = 4;
const LR_START_Z = 0.8; // khe hở giữa hai khay ở giữa cột

export function layoutFor(aspect) {
  return aspect < 1 ? 'tb' : 'lr';
}

// Từ lịch sử nước đi: quân nào đã bị ăn. Trả về { w: [...quân Trắng bị ăn], b: [...quân Đen bị ăn] }.
export function capturedFromHistory(history) {
  const out = { w: [], b: [] };
  for (const h of history || []) {
    const ch = h && h.captured;
    if (!ch || ch === '.') continue;
    (ch === ch.toUpperCase() ? out.w : out.b).push(ch);
  }
  return out;
}

export function trayCapacity(layout) {
  return layout === 'lr' ? LR_PER_ROW * LR_ROWS : TB_PER_ROW * TB_ROWS;
}

// Vị trí ô thứ index của khay bên side ('w' = quân Trắng bị ăn, 'b' = quân Đen bị ăn). Trả về { x, z }.
export function traySlot(side, index, layout) {
  const sign = side === 'w' ? -1 : 1;
  if (layout === 'lr') {
    const row = Math.floor(index / LR_PER_ROW);
    const k = index % LR_PER_ROW;
    return { x: BOARD_W / 2 + 0.9 + row * ROW_GAP, z: sign * (LR_START_Z + k * COL_GAP) };
  }
  const row = Math.floor(index / TB_PER_ROW);
  const col = index % TB_PER_ROW;
  return {
    x: (col - (TB_PER_ROW - 1) / 2) * COL_GAP,
    z: sign * (BOARD_D / 2 + 0.85 + row * ROW_GAP),
  };
}

// Tấm khay (nền gỗ) mỗi bên: { cx, cz, w, d }.
export function trayBase(side, layout) {
  const sign = side === 'w' ? -1 : 1;
  if (layout === 'lr') {
    const x0 = BOARD_W / 2 + 0.9;
    return {
      cx: x0 + ((LR_ROWS - 1) * ROW_GAP) / 2,
      cz: sign * (LR_START_Z + ((LR_PER_ROW - 1) * COL_GAP) / 2),
      w: (LR_ROWS - 1) * ROW_GAP + 1.0,
      d: (LR_PER_ROW - 1) * COL_GAP + 1.0,
    };
  }
  return {
    cx: 0,
    cz: sign * (BOARD_D / 2 + 0.85 + ((TB_ROWS - 1) * ROW_GAP) / 2),
    w: (TB_PER_ROW - 1) * COL_GAP + 1.0,
    d: (TB_ROWS - 1) * ROW_GAP + 1.0,
  };
}

// Hình chữ nhật nhỏ nhất chứa bàn cờ và cả hai khay: { minX, maxX, minZ, maxZ }.
export function layoutBox(layout) {
  let minX = -BOARD_W / 2;
  let maxX = BOARD_W / 2;
  let minZ = -BOARD_D / 2;
  let maxZ = BOARD_D / 2;
  for (const side of ['w', 'b']) {
    const b = trayBase(side, layout);
    minX = Math.min(minX, b.cx - b.w / 2);
    maxX = Math.max(maxX, b.cx + b.w / 2);
    minZ = Math.min(minZ, b.cz - b.d / 2);
    maxZ = Math.max(maxZ, b.cz + b.d / 2);
  }
  return { minX, maxX, minZ, maxZ };
}

export function boxCenter(layout) {
  const b = layoutBox(layout);
  return { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
}
