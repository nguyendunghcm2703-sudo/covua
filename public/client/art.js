// Vẽ bàn, mặt bàn cờ và mặt quân bằng canvas 2D. Dùng chung cho 3D (làm texture) và 2D (vẽ thẳng).
// Chỉ phụ thuộc canvas context, không phụ thuộc Three.js.

import { PAL } from './palette.js';
import { BOARD_W, BOARD_D, GRID_MARGIN } from './geometry.js';

// Bộ sinh số ngẫu nhiên có hạt giống: vân gỗ luôn giống nhau giữa các lần tải.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function paintWood(ctx, w, h, base, grain, seed, strokes) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  const rand = rng(seed);
  for (let i = 0; i < strokes; i++) {
    const y = rand() * h;
    const amp = 4 + rand() * 14;
    ctx.strokeStyle = grain.replace('A', (0.04 + rand() * 0.09).toFixed(3));
    ctx.lineWidth = 0.6 + rand() * 2.4;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(
      w * 0.3, y + amp * (rand() - 0.5) * 2,
      w * 0.65, y + amp * (rand() - 0.5) * 2,
      w, y + amp * (rand() - 0.5) * 2
    );
    ctx.stroke();
  }
}

export function paintTable(ctx, w = 512, h = 512) {
  paintWood(ctx, w, h, PAL.tableBase, PAL.tableGrain, 7, 120);
}

export function paintTray(ctx, w = 256, h = 256) {
  paintWood(ctx, w, h, PAL.trayBase, PAL.trayGrain, 23, 80);
}

export function boardSize(u) {
  return { W: Math.round(BOARD_W * u), H: Math.round(BOARD_D * u) };
}

// Mặt bàn cờ: 1 ô = u pixel. Dòng trên cùng là hạng 8 (đầu Đen, phía xa), cột trái là cột a.
export function paintBoard(ctx, u = 160) {
  const { W, H } = boardSize(u);
  paintWood(ctx, W, H, PAL.frame, PAL.boardGrain, 11, 200);
  const g = (n) => u * (GRID_MARGIN + n);
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const light = (r + c) % 2 === 0;
      ctx.fillStyle = light ? PAL.light : PAL.dark;
      ctx.fillRect(g(c), g(r), u, u);
      ctx.fillStyle = light ? 'rgba(180,130,60,0.10)' : 'rgba(40,15,0,0.12)';
      for (let k = 0; k < 5; k++) ctx.fillRect(g(c), g(r) + ((k * 37 + r * 11 + c * 7) % 100) / 100 * u, u, u * 0.02);
    }
  }
  ctx.strokeStyle = '#2a1205';
  ctx.lineWidth = u * 0.035;
  ctx.strokeRect(g(0), g(0), u * 8, u * 8);
  ctx.fillStyle = PAL.label;
  ctx.font = `bold ${Math.round(u * 0.3)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < 8; i++) {
    const file = 'abcdefgh'[i];
    const rank = String(8 - i);
    ctx.fillText(file, g(i) + u / 2, g(8) + u * 0.3);
    ctx.fillText(file, g(i) + u / 2, g(0) - u * 0.3);
    ctx.fillText(rank, g(0) - u * 0.3, g(i) + u / 2);
    ctx.fillText(rank, g(8) + u * 0.3, g(i) + u / 2);
  }
}

// Quân cờ 2D (dùng khi không có 3D): ký tự cờ vua tô màu, viền tương phản. ch: chữ hoa = Trắng, chữ thường = Đen.
const GLYPH = { k: '\u265A', q: '\u265B', r: '\u265C', b: '\u265D', n: '\u265E', p: '\u265F' };
export function paintPiece(ctx, ch, size = 256) {
  const white = ch === ch.toUpperCase();
  const glyph = (GLYPH[ch.toLowerCase()] || '?') + '\uFE0E';
  ctx.clearRect(0, 0, size, size);
  ctx.font = `${Math.round(size * 0.9)}px "Segoe UI Symbol","Noto Sans Symbols 2","Apple Symbols","DejaVu Sans",serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = size * 0.07;
  ctx.strokeStyle = white ? '#3b2417' : '#f3e6c8';
  ctx.strokeText(glyph, size / 2, size * 0.54);
  ctx.fillStyle = white ? PAL.whitePiece : PAL.blackPiece;
  ctx.fillText(glyph, size / 2, size * 0.54);
}
