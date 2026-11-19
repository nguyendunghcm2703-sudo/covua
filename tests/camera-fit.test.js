import test from 'node:test';
import assert from 'node:assert/strict';
import { fitView, projectBox, boxPoints } from '../public/client/camera-fit.js';
import { layoutFor } from '../public/client/tray.js';

const SEAT = (33 * Math.PI) / 180;
const SIZES = [
  [375, 812, 0, 0], [375, 812, 70, 200], [390, 844, 60, 0], [844, 390, 40, 0], [844, 390, 40, 120],
  [1280, 720, 60, 0], [1920, 1080, 60, 90], [768, 1024, 60, 160], [320, 568, 60, 180],
];

for (const [w, h, top, bottom] of SIZES) {
  for (const [name, polar] of [['góc ngồi', SEAT], ['nhìn từ trên', 0.14]]) {
    test(`Camera vừa khít vùng trống: ${w}x${h} trên ${top} dưới ${bottom}, ${name}`, () => {
      const layout = layoutFor(w / Math.max(80, h - top - bottom));
      const f = fitView({ layout, w, h, top, bottom, polar });
      const bb = projectBox(boxPoints(layout), { distance: f.distance, polar, w, h });
      assert.ok(bb, 'không có điểm nào ở sau camera');
      const sx = bb.minX + f.ox;
      const ex = bb.maxX + f.ox;
      const sy = bb.minY + f.oy;
      const ey = bb.maxY + f.oy;
      assert.ok(sx >= -0.5 && ex <= w + 0.5, `ngang ${sx.toFixed(1)}..${ex.toFixed(1)} / ${w}`);
      assert.ok(sy >= top - 0.5 && ey <= h - bottom + 0.5, `dọc ${sy.toFixed(1)}..${ey.toFixed(1)} / ${top}..${h - bottom}`);
      // không quá nhỏ: một chiều phải chiếm gần hết vùng trống
      const fw = (ex - sx) / w;
      const fh = (ey - sy) / (h - top - bottom);
      assert.ok(Math.max(fw, fh) > 0.9, `quá nhỏ: ${fw.toFixed(2)} ${fh.toFixed(2)}`);
    });
  }
}

test('Ca ảnh lỗi trước đó (điện thoại dọc, thanh nút 4 hàng): bàn không tràn ngang', () => {
  const w = 375, h = 812, top = 70, bottom = 200;
  const f = fitView({ layout: 'tb', w, h, top, bottom, polar: SEAT });
  const bb = projectBox(boxPoints('tb'), { distance: f.distance, polar: SEAT, w, h });
  assert.ok(bb.maxX - bb.minX <= w, 'rộng vừa màn hình');
  assert.ok(bb.maxY - bb.minY <= h - top - bottom, 'cao vừa vùng trống');
});

test('Đổi góc ngang (azimuth) vẫn vừa khít', () => {
  for (const azim of [-0.8, 0.5, 0.9]) {
    const w = 844, h = 390;
    const f = fitView({ layout: 'lr', w, h, top: 0, bottom: 0, polar: SEAT, azim });
    const bb = projectBox(boxPoints('lr'), { distance: f.distance, polar: SEAT, azim, w, h });
    assert.ok(bb.maxX - bb.minX <= w && bb.maxY - bb.minY <= h);
  }
});

test('lật bàn: khối vẫn vừa khung và camera nhìn vào tâm bàn', () => {
  for (const layout of ['lr', 'tb']) {
    for (const rot of [0, Math.PI]) {
      const w = layout === 'lr' ? 1600 : 390;
      const h = layout === 'lr' ? 900 : 800;
      const f = fitView({ layout, w, h, top: 30, bottom: 50, polar: 1.2, rot });
      const bb = projectBox(boxPoints(layout, 0.6, rot), { distance: f.distance, polar: 1.2, w, h });
      assert.ok(bb.maxX - bb.minX <= w + 1e-6 && bb.maxY - bb.minY <= h - 80 + 1e-6);
      // tâm bàn (gốc) nằm ở giữa màn hình trước khi dời ống kính
      const c = projectBox([{ x: 0, y: 0, z: 0 }], { distance: f.distance, polar: 1.2, w, h });
      assert.ok(Math.abs(c.minX - w / 2) < 1e-6);
    }
  }
});
