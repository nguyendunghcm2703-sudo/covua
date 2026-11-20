// Chế độ 2D nhìn từ trên xuống, cùng giao diện với board3d.js. Dùng khi thiết bị không có WebGL,
// không tải được Three.js hoặc người chơi chọn chế độ 2D. Chỉ vẽ bằng canvas 2D.

import { rowOf, colOf } from '../shared/chess.js';
import { BOARD_W, BOARD_D, cellToWorld, worldToCell } from './geometry.js';
import { paintBoard, paintPiece, paintTable, paintTray, boardSize } from './art.js';
import { PAL } from './palette.js';
import { TRAY_SCALE, layoutFor, traySlot, trayBase, layoutBox, boxCenter } from './tray.js';

const PIECE_R = 0.42;
const FACE_R = 0.5;

const ease = (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);

export function createView(container) {
  const canvas = document.createElement('canvas');
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    canvas.remove();
    throw new Error('no-2d-context');
  }

  // ----- ảnh dựng sẵn -----
  const boardImg = document.createElement('canvas');
  const boardImgFlipped = document.createElement('canvas'); // chữ lộn ngược sẵn, dùng khi bàn lật
  for (const [img, fl] of [[boardImg, false], [boardImgFlipped, true]]) {
    const u = 120;
    const { W, H } = boardSize(u);
    img.width = W;
    img.height = H;
    paintBoard(img.getContext('2d'), u, fl);
  }
  const tableImg = document.createElement('canvas');
  tableImg.width = tableImg.height = 256;
  paintTable(tableImg.getContext('2d'), 256, 256);
  const trayImg = document.createElement('canvas');
  trayImg.width = trayImg.height = 128;
  paintTray(trayImg.getContext('2d'), 128, 128);
  const sprites = new Map();
  function sprite(ch) {
    let c = sprites.get(ch);
    if (!c) {
      c = document.createElement('canvas');
      c.width = c.height = 256;
      paintPiece(c.getContext('2d'), ch, 256);
      sprites.set(ch, c);
    }
    return c;
  }
  let tablePattern = null;
  let trayPattern = null;

  // ----- trạng thái -----
  let W = 1;
  let H = 1;
  let dpr = 1;
  let layout = 'tb';
  let scale = 30;
  let insetTop = 0;
  let insetBottom = 0;
  let cy = 0; // tâm bàn theo chiều dọc (px), nằm giữa vùng không bị nút che
  let angle = 0; // 0 hoặc PI khi lật bàn
  let pieces = []; // { ch, x, z, lift }
  let trayItems = []; // { ch, x, z, hidden }
  let lastTray = { w: [], b: [] };
  let selIdx = null;
  let targets = [];
  let lastFrom = null;
  let lastTo = null;
  let checkIdx = null;
  let pendingFlight = null;
  const flights = [];
  const tweens = [];
  let dirty = true;
  let alive = true;

  function tween(duration, onUpdate, onDone) {
    tweens.push({ t0: performance.now(), duration, onUpdate, onDone });
    dirty = true;
  }

  function layoutNow() {
    layout = layoutFor(W / H);
    const b = layoutBox(layout);
    const availH = Math.max(80, H - insetTop - insetBottom);
    scale = Math.max(8, Math.min((W - 16) / (b.maxX - b.minX), (availH - 16) / (b.maxZ - b.minZ)));
    cy = insetTop + availH / 2;
  }

  function resize() {
    W = Math.max(1, container.clientWidth);
    H = Math.max(1, container.clientHeight);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    const prev = layout;
    layoutNow();
    if (prev !== layout) buildTray(lastTray);
    dirty = true;
  }

  function buildTray(tray) {
    trayItems = [];
    for (const side of ['w', 'b']) {
      tray[side].forEach((ch, i) => {
        const s = traySlot(side, i, layout);
        trayItems.push({ ch, x: s.x, z: s.z, hidden: false, side, i });
      });
    }
  }

  // ----- vẽ -----
  function drawPiece(p, sc = 1, rot = 0) {
    const r = PIECE_R * sc;
    const lift = p.lift || 0;
    ctx.save();
    ctx.translate(p.x, p.z);
    if (lift > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.ellipse(0.06 + lift * 0.3, 0.1 + lift * 0.5, r, r * 0.95, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.22)'; // bóng mỏng dưới chân quân
      ctx.beginPath();
      ctx.ellipse(0, 0.3 * sc, r * 0.75, r * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    const k = 1 + lift * 0.5;
    ctx.scale(k, k);
    ctx.rotate(rot); // quân luôn xuôi khi bàn lật
    const d = FACE_R * 2 * sc;
    ctx.drawImage(sprite(p.ch), -d / 2, -d / 2, d, d);
    ctx.restore();
  }

  function ring(idx, inner, outer, color) {
    const { x, z } = cellToWorld(rowOf(idx), colOf(idx));
    ctx.strokeStyle = color;
    ctx.lineWidth = outer - inner;
    ctx.beginPath();
    ctx.arc(x, z, (inner + outer) / 2, 0, Math.PI * 2);
    ctx.stroke();
  }

  function draw(now) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!tablePattern) {
      tablePattern = ctx.createPattern(tableImg, 'repeat');
      trayPattern = ctx.createPattern(trayImg, 'repeat');
    }
    ctx.fillStyle = PAL.background;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = tablePattern;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(W / 2, cy);
    ctx.scale(scale, scale);
    ctx.rotate(angle);
    const bc = boxCenter(layout);
    ctx.translate(-bc.x, -bc.z);

    // khay
    for (const side of ['w', 'b']) {
      const b = trayBase(side, layout);
      ctx.fillStyle = trayPattern;
      ctx.save();
      ctx.scale(1 / scale, 1 / scale);
      ctx.fillStyle = trayPattern;
      ctx.restore();
      ctx.fillStyle = PAL.trayBase;
      ctx.fillRect(b.cx - b.w / 2, b.cz - b.d / 2, b.w, b.d);
      ctx.globalAlpha = 0.5;
      ctx.drawImage(trayImg, b.cx - b.w / 2, b.cz - b.d / 2, b.w, b.d);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(255,220,160,0.25)';
      ctx.lineWidth = 0.04;
      ctx.strokeRect(b.cx - b.w / 2, b.cz - b.d / 2, b.w, b.d);
    }

    // tấm bàn cờ
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(-BOARD_W / 2 + 0.12, -BOARD_D / 2 + 0.16, BOARD_W, BOARD_D);
    ctx.fillStyle = PAL.slab;
    ctx.fillRect(-BOARD_W / 2 - 0.06, -BOARD_D / 2 - 0.06, BOARD_W + 0.12, BOARD_D + 0.12);
    ctx.drawImage(Math.abs(angle) > 1.57 ? boardImgFlipped : boardImg, -BOARD_W / 2, -BOARD_D / 2, BOARD_W, BOARD_D);

    // dấu hiệu
    if (lastFrom !== null) {
      ring(lastFrom, 0.51, 0.58, 'rgba(255,210,63,0.95)');
      ring(lastTo, 0.51, 0.58, 'rgba(255,210,63,0.95)');
    }
    if (checkIdx !== null) {
      const a = 0.55 + 0.35 * Math.sin(now / 180);
      ring(checkIdx, 0.5, 0.64, `rgba(232,53,43,${a.toFixed(2)})`);
    }

    // quân trên bàn (quân đang nhấc vẽ sau cùng)
    const rot = -angle;
    const sorted = pieces.slice().sort((a, b) => (a.lift || 0) - (b.lift || 0));
    for (const p of sorted) drawPiece(p, 1, rot);

    if (selIdx !== null) ring(selIdx, 0.5, 0.62, 'rgba(46,200,120,0.95)');
    for (const t of targets) {
      if (t.capture) ring(t.to, 0.45, 0.58, 'rgba(232,53,43,0.95)');
      else {
        const { x, z } = cellToWorld(rowOf(t.to), colOf(t.to));
        ctx.fillStyle = 'rgba(46,200,120,0.85)';
        ctx.beginPath();
        ctx.arc(x, z, 0.17, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // quân trong khay và quân đang bay
    for (const t of trayItems) if (!t.hidden) drawPiece(t, TRAY_SCALE, rot);
    for (const f of flights) drawPiece(f, f.sc, rot);

    ctx.restore();
  }

  function frame(now) {
    if (!alive) return;
    requestAnimationFrame(frame);
    for (const tw of tweens.slice()) {
      const p = Math.min(1, (now - tw.t0) / tw.duration);
      tw.onUpdate(p);
      if (p >= 1) {
        tweens.splice(tweens.indexOf(tw), 1);
        if (tw.onDone) tw.onDone();
      }
    }
    if (dirty || checkIdx !== null || tweens.length) {
      dirty = false;
      draw(now);
    }
  }

  // ----- giao diện công khai -----
  function sync(board, tray = { w: [], b: [] }) {
    pieces = [];
    for (let i = 0; i < 64; i++) {
      if (board[i] === '.') continue;
      const { x, z } = cellToWorld(rowOf(i), colOf(i));
      pieces.push({ ch: board[i], x, z, lift: 0, idx: i });
    }
    lastTray = tray;
    buildTray(tray);
    selIdx = null;
    targets = [];

    const fl = pendingFlight;
    pendingFlight = null;
    if (fl && performance.now() - fl.at < 1500) {
      const side = fl.ch === fl.ch.toUpperCase() ? 'w' : 'b';
      const slot = trayItems.find((t) => t.side === side && t.i === tray[side].length - 1);
      if (slot && slot.ch === fl.ch) {
        slot.hidden = true;
        const f = { ch: fl.ch, x: fl.x, z: fl.z, lift: 0.4, sc: 1 };
        flights.push(f);
        tween(
          520,
          (p) => {
            const e = ease(p);
            f.x = fl.x + (slot.x - fl.x) * e;
            f.z = fl.z + (slot.z - fl.z) * e;
            f.lift = 0.4 + 0.5 * Math.sin(Math.PI * e);
            f.sc = 1 + (TRAY_SCALE - 1) * e;
          },
          () => {
            flights.splice(flights.indexOf(f), 1);
            slot.hidden = false;
            dirty = true;
          }
        );
      }
    }
    dirty = true;
  }

  function select(idx, tg = []) {
    for (const p of pieces) p.lift = 0;
    selIdx = idx === undefined ? null : idx;
    targets = tg;
    if (selIdx !== null) {
      const p = pieces.find((q) => q.idx === selIdx);
      if (p) p.lift = 0.12;
    }
    dirty = true;
  }

  function setLastMove(from, to) {
    lastFrom = from === null || from === undefined ? null : from;
    lastTo = lastFrom === null ? null : to;
    dirty = true;
  }

  function setCheck(idx) {
    checkIdx = idx === null || idx === undefined || idx < 0 ? null : idx;
    dirty = true;
  }

  function animateMove(from, to, onLand) {
    const mover = pieces.find((p) => p.idx === from);
    if (!mover) {
      onLand();
      return;
    }
    const captured = pieces.find((p) => p.idx === to);
    const a = cellToWorld(rowOf(from), colOf(from));
    const b = cellToWorld(rowOf(to), colOf(to));
    const startLift = mover.lift || 0;
    selIdx = null;
    targets = [];
    tween(
      340,
      (p) => {
        const e = ease(p);
        mover.x = a.x + (b.x - a.x) * e;
        mover.z = a.z + (b.z - a.z) * e;
        mover.lift = startLift * (1 - e) + 0.5 * Math.sin(Math.PI * e);
      },
      () => {
        mover.x = b.x;
        mover.z = b.z;
        mover.lift = 0;
        mover.idx = to;
        if (captured) {
          pieces.splice(pieces.indexOf(captured), 1);
          pendingFlight = { ch: captured.ch, x: b.x, z: b.z, at: performance.now() };
        }
        onLand();
      }
    );
  }

  function setFlipped(flag, animate = true) {
    const target = flag ? Math.PI : 0;
    if (!animate) {
      angle = target;
      dirty = true;
      return;
    }
    const from = angle;
    tween(650, (p) => {
      angle = from + (target - from) * ease(p);
    });
  }

  function pickCell(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const px = (clientX - rect.left - rect.width / 2) / scale;
    const py = (clientY - rect.top - cy) / scale;
    const c = Math.cos(-angle);
    const s = Math.sin(-angle);
    const bc = boxCenter(layout);
    return worldToCell(px * c - py * s + bc.x, px * s + py * c + bc.z);
  }

  // ----- hỗ trợ kiểm thử -----
  canvas.__cellToClient = (row, col) => {
    const rect = canvas.getBoundingClientRect();
    const w = cellToWorld(row, col);
    const bc = boxCenter(layout);
    const x = w.x - bc.x;
    const z = w.z - bc.z;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return {
      x: rect.left + rect.width / 2 + (x * c - z * s) * scale,
      y: rect.top + cy + (x * s + z * c) * scale,
    };
  };
  canvas.__debug = () => {
    const b = new Array(64).fill('.');
    for (const p of pieces) if (p.idx !== undefined) b[p.idx] = p.ch;
    return {
      board: b.join(''),
      flipped: Math.abs(angle) > 1.5,
      selected: selIdx,
      targets: targets.map((t) => t.to),
      tray: { w: lastTray.w.join(''), b: lastTray.b.join('') },
      lastFrom,
      lastTo,
      layout,
    };
  };

  const onResize = () => resize();
  window.addEventListener('resize', onResize);
  resize();
  requestAnimationFrame(frame);

  return {
    kind: '2d',
    domElement: canvas,
    onSlow: null,
    onContextLost: null,
    sync,
    select,
    setLastMove,
    setCheck,
    animateMove,
    setFlipped,
    pickCell,
    resetCamera() {},
    topView() {},
    setQuality() {},
    setRotateEnabled() {},
    setInsets(top, bottom) {
      insetTop = Math.max(0, top | 0);
      insetBottom = Math.max(0, bottom | 0);
      layoutNow();
      dirty = true;
    },
    dispose() {
      alive = false;
      window.removeEventListener('resize', onResize);
      canvas.remove();
    },
  };
}
