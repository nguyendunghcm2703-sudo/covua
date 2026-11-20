// Tính khoảng cách và độ dời của camera để toàn bộ bàn cờ và khay lọt vào vùng còn trống của màn hình,
// có tính phối cảnh (mép gần rộng hơn mép xa). Thuần số học, test được bằng Node.
//
// Hệ tọa độ: tâm bàn cờ ở (0,0,0), camera nhìn vào target từ góc (polar, azimuth).
// polar: góc từ phương thẳng đứng; azimuth: góc quanh trục đứng (0 = nhìn từ phía Đỏ).

import { layoutBox } from './tray.js';
import { BOARD_W, BOARD_D } from './geometry.js';

// 8 điểm góc của khối chứa bàn + khay + quân. Gốc là TÂM BÀN CỜ (camera luôn nhìn vào đây để
// trục giữa bàn thẳng đứng), rot là góc lật bàn quanh trục đứng (0 hoặc PI).
export function boxPoints(layout, height = 2.2, rot = 0, boardOnly = false) {
  // boardOnly: chỉ tính riêng bàn cờ (bỏ khay quân bị ăn) để bàn phóng to kín màn hình.
  const b = boardOnly ? { minX: -BOARD_W / 2, maxX: BOARD_W / 2, minZ: -BOARD_D / 2, maxZ: BOARD_D / 2 } : layoutBox(layout);
  const cs = Math.cos(rot);
  const sn = Math.sin(rot);
  const pts = [];
  for (const x of [b.minX, b.maxX]) {
    for (const z of [b.minZ, b.maxZ]) {
      for (const y of [-0.5, height]) pts.push({ x: x * cs + z * sn, y, z: -x * sn + z * cs });
    }
  }
  return pts;
}

function basis(dir) {
  // camera nhìn theo -dir, "lên" là trục y của thế giới
  const f = { x: -dir.x, y: -dir.y, z: -dir.z };
  let r = { x: f.y * 0 - f.z * 1, y: f.z * 0 - f.x * 0, z: f.x * 1 - f.y * 0 }; // f x (0,1,0)
  let rl = Math.hypot(r.x, r.y, r.z);
  if (rl < 1e-6) {
    r = { x: 1, y: 0, z: 0 };
    rl = 1;
  }
  r = { x: r.x / rl, y: r.y / rl, z: r.z / rl };
  const u = { x: r.y * f.z - r.z * f.y, y: r.z * f.x - r.x * f.z, z: r.x * f.y - r.y * f.x };
  return { f, r, u };
}

// Chiếu các điểm lên màn hình w x h (pixel, gốc ở góc trên trái). Trả về hộp bao hoặc null nếu có điểm sau lưng camera.
export function projectBox(points, { distance, polar, azim = 0, fov = 40, w, h, target = { x: 0, y: 0, z: 0 } }) {
  const dir = {
    x: Math.sin(polar) * Math.sin(azim),
    y: Math.cos(polar),
    z: Math.sin(polar) * Math.cos(azim),
  };
  const cam = { x: target.x + distance * dir.x, y: target.y + distance * dir.y, z: target.z + distance * dir.z };
  const { f, r, u } = basis(dir);
  const t = Math.tan((fov * Math.PI) / 360);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    const v = { x: p.x - cam.x, y: p.y - cam.y, z: p.z - cam.z };
    const zc = v.x * f.x + v.y * f.y + v.z * f.z;
    if (zc <= 0.01) return null;
    const xc = v.x * r.x + v.y * r.y + v.z * r.z;
    const yc = v.x * u.x + v.y * u.y + v.z * u.z;
    const px = (xc / (zc * t * (w / h)) * 0.5 + 0.5) * w;
    const py = (0.5 - (yc / (zc * t)) * 0.5) * h;
    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
    minY = Math.min(minY, py);
    maxY = Math.max(maxY, py);
  }
  return { minX, maxX, minY, maxY };
}

// Trả về { distance, ox, oy }: khoảng cách camera để vừa khít vùng trống, và độ dời ảnh (pixel)
// để đặt giữa vùng trống (dùng cho camera.setViewOffset(w, h, -ox, -oy, w, h)).
export function fitView({ layout, w, h, top = 0, bottom = 0, fov = 40, polar, azim = 0, pad = 3, rot = 0, boardOnly = false }) {
  const pts = boxPoints(layout, 2.2, rot, boardOnly);
  const freeW = Math.max(60, w - 2 * pad);
  const freeH = Math.max(60, h - top - bottom - 2 * pad);
  const opts = { polar, azim, fov, w, h };
  let lo = 2;
  let hi = 400;
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    const bb = projectBox(pts, { ...opts, distance: mid });
    const fits = bb && bb.maxX - bb.minX <= freeW && bb.maxY - bb.minY <= freeH;
    if (fits) hi = mid;
    else lo = mid;
  }
  const bb = projectBox(pts, { ...opts, distance: hi });
  return {
    distance: hi,
    ox: w / 2 - (bb.minX + bb.maxX) / 2,
    oy: top + (h - top - bottom) / 2 - (bb.minY + bb.maxY) / 2,
  };
}
