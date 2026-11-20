// Vòng chơi cờ vua 3D: chơi online qua mã phòng, hoặc hai người chung một máy.
// Online: server là nơi quyết định, client chỉ gửi nước đi và hiển thị những gì server xác nhận.

import { createGame, legalMoves, applyMove, getResult, isInCheck, fromUCI, rowOf, colOf } from '../shared/chess.js';
import { createBestView } from './views.js';
import { capturedFromHistory } from './tray.js';
import { playClack, unlockAudio, setSoundEnabled } from './sound.js';
import { connect } from './net.js';
import { think as aiThink, cancel as aiCancel } from './ai.js';

const $ = (id) => document.getElementById(id);
let view = null; // 3D hoặc 2D, tạo ở phần khởi động
const BASE_TITLE = 'Cờ vua 3D';

// ---------- trạng thái chung ----------
let mode = 'local'; // 'local' | 'online'
let ai = null; // chơi với máy: { level, human } hoặc null
let thinking = false;
let states = [createGame()];
let selected = null;
let targetSet = new Set();
let busy = false;
let flipped = false;
let autoFlip = false;
let sound = true;
let lowQuality = false;
let uiHidden = false;
let autoHidden = false; // đã tự ẩn thanh nút sau nước đi đầu của ván này
let uiHiddenUser = null; // chỉ có giá trị khi người chơi tự bấm ẩn/hiện
let moreOpen = false;
let prefer2d = false;
let rotateOn = false;
let fullBoard = false; // nút "Bàn lớn"
let slowHinted = false;
let switching = false;
let pendingJoin = null;

// ---------- trạng thái online ----------
let net = null;
let roomCode = null;
let myId = null;
let mySide = null; // 'w' | 'b' | 'spectator'
let seats = { w: false, b: false };
let peers = { w: false, b: false }; // ai đang kết nối
let serverOver = null;
let drawOffer = null;
let rematch = { w: false, b: false };
let connStatus = 'closed';
let pending = false;
let pendingTimer = null;
let queue = [];
let epoch = 0;
let gotSnapshot = false;
let toastTimer = null;
let memId = null;

const cur = () => states[states.length - 1];
const sideName = (s) => (s === 'w' ? 'Trắng' : 'Đen');
const opp = (s) => (s === 'w' ? 'b' : 'w');
const isMine = (piece, turn) => piece !== '.' && (piece === piece.toUpperCase()) === (turn === 'w');
const isSeated = () => mySide === 'w' || mySide === 'b';
// Nước ăn quân (kể cả bắt tốt qua đường) và nước nhập thành, để vẽ hiệu ứng.
function isCapture(state, m) {
  if (state.board[m.to] !== '.') return true;
  return state.board[m.from].toLowerCase() === 'p' && colOf(m.from) !== colOf(m.to);
}
function castleRook(state, m) {
  if (state.board[m.from].toLowerCase() !== 'k' || Math.abs(colOf(m.to) - colOf(m.from)) !== 2) return null;
  const row = rowOf(m.from);
  return colOf(m.to) === 6 ? { from: row * 8 + 7, to: row * 8 + 5 } : { from: row * 8, to: row * 8 + 3 };
}
function isPromotion(state, from, to) {
  const p = state.board[from];
  return p.toLowerCase() === 'p' && (rowOf(to) === 0 || rowOf(to) === 7);
}

// ---------- cài đặt lưu trên máy ----------
// Màn hình nhỏ (điện thoại dọc hoặc ngang): thanh nút mặc định ẩn, nút phụ gom vào "Thêm".
function isSmallScreen() {
  return window.matchMedia('(max-width: 600px), (max-height: 520px)').matches;
}
function applySmall() {
  document.body.classList.toggle('small', isSmallScreen());
  document.body.classList.toggle('more-open', moreOpen);
  $('btnMore').setAttribute('aria-expanded', String(moreOpen));
  $('btnMore').textContent = moreOpen ? '✕ Thu gọn' : '⋯ Thêm';
}
window.addEventListener('resize', () => {
  applySmall();
  requestAnimationFrame(updateInsets);
});

function loadPrefs() {
  // màn hình nhỏ (điện thoại ngang): mặc định ẩn thanh nút để không che bàn cờ
  uiHidden = isSmallScreen();
  try {
    const raw = localStorage.getItem('covua3d.prefs');
    if (!raw) return;
    const p = JSON.parse(raw);
    sound = p.sound !== false;
    autoFlip = p.autoFlip === true;
    lowQuality = p.lowQuality === true;
    if (typeof p.uiHiddenUser === 'boolean') {
      uiHiddenUser = p.uiHiddenUser;
      uiHidden = p.uiHiddenUser;
    }
    prefer2d = p.prefer2d === true;
    rotateOn = p.rotateOn === true;
    fullBoard = p.fullBoard === true;
  } catch (e) {
    /* bỏ qua */
  }
}
function savePrefs() {
  try {
    localStorage.setItem(
      'covua3d.prefs',
      JSON.stringify({ sound, autoFlip, lowQuality, uiHiddenUser, prefer2d, rotateOn, fullBoard })
    );
  } catch (e) {
    /* bỏ qua */
  }
}

// ---------- định danh và mã phòng ----------
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(n = 6) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return Array.from(a, (v) => CODE_ALPHABET[v % CODE_ALPHABET.length]).join('');
}

function randomId() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Mỗi tab có một id riêng (mở hai tab trên một máy sẽ thành hai người chơi).
// Id được nhớ theo phòng để mở lại bằng tab mới vẫn lấy lại được chỗ ngồi.
function tabId() {
  try {
    let id = sessionStorage.getItem('covua3d.sid');
    if (!id) {
      id = randomId();
      sessionStorage.setItem('covua3d.sid', id);
    }
    return id;
  } catch (e) {
    if (!memId) memId = randomId();
    return memId;
  }
}
function lastIdForRoom(code) {
  try {
    return localStorage.getItem('covua3d.room.' + code) || null;
  } catch (e) {
    return null;
  }
}
function rememberIdForRoom(code, id) {
  try {
    localStorage.setItem('covua3d.room.' + code, id);
  } catch (e) {
    /* bỏ qua */
  }
}

function normalizeCode(text) {
  return String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
const validCode = (c) => /^[A-Z0-9]{4,12}$/.test(c);

function setUrlRoom(code) {
  try {
    history.replaceState(null, '', code ? `?room=${code}` : location.pathname);
  } catch (e) {
    /* bỏ qua */
  }
}

function toast(text, ms = 2600) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, ms);
}

// ---------- view 3D / 2D ----------
function syncView(g) {
  view.sync(g.board, capturedFromHistory(g.history));
}

let down = null;
function bindPointer(v) {
  v.domElement.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
  });
  v.domElement.addEventListener('pointerup', (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const quick = performance.now() - down.t < 500;
    down = null;
    if (moved < 8 && quick) onTap(e.clientX, e.clientY);
  });
}

// Chừa chỗ cho thanh trạng thái phía trên và thanh nút phía dưới để không che bàn cờ.
function updateInsets() {
  if (!view) return;
  const bottomOf = (id) => {
    const el = $(id);
    if (!el || el.hidden) return 0;
    const r = el.getBoundingClientRect();
    return r.height > 0 ? r.bottom : 0;
  };
  const topOf = (id) => {
    const el = $(id);
    if (!el || el.hidden) return window.innerHeight;
    const r = el.getBoundingClientRect();
    return r.height > 0 ? r.top : window.innerHeight;
  };
  let top = 0;
  let bottom = 0;
  {
    top = Math.max(bottomOf('hud'), mode === 'online' ? bottomOf('roomBar') : 0);
    if (top) top += 6;
    const tt = topOf('toolbar');
    if (tt < window.innerHeight) bottom = window.innerHeight - tt + 20;
  }
  view.setInsets(top, bottom);
}
window.addEventListener('resize', () => requestAnimationFrame(updateInsets));

function renderViewUi() {
  const is3d = view && view.kind === '3d';
  document.body.dataset.view = is3d ? '3d' : '2d';
  $('btnView').textContent = `Chế độ: ${is3d ? '3D' : '2D'}`;
  $('btnRotate').textContent = `Xoay: ${rotateOn ? 'mở' : 'khóa'}`;
  $('btnRotate').setAttribute('aria-pressed', String(rotateOn));
}

function attachView(v) {
  view = v;
  v.onSlow = handleSlow;
  v.onContextLost = handleLost;
  v.onModelsLoaded = (ok, info) => {
    if (!ok) toast("Chưa tải đủ quân 3D (" + (info || "lỗi mạng") + ")");
  };
  bindPointer(v);
  v.setQuality(lowQuality);
  v.setFullBoard(fullBoard);
  v.setRotateEnabled(rotateOn);
  v.setFlipped(flipped, false);
  syncView(cur());
  renderViewUi();
  updateInsets();
}

async function mountView(use2d) {
  const r = await createBestView($('stage'), use2d);
  attachView(r.view);
  return r.reason;
}

async function switchView(use2d) {
  if (switching) return;
  switching = true;
  try {
    const t0 = performance.now();
    while (busy && performance.now() - t0 < 2000) await new Promise((r) => setTimeout(r, 50));
    if (busy) {
      toast('Đang đi quân, thử lại sau giây lát');
      return;
    }
    const old = view;
    old.onSlow = null;
    old.onContextLost = null;
    old.dispose();
    const reason = await mountView(use2d);
    refresh();
    if (!use2d && reason) toast('Thiết bị này chưa chạy được 3D, đang dùng 2D');
  } finally {
    switching = false;
  }
}

function handleSlow() {
  if (!view || view.kind !== '3d') return;
  if (!lowQuality) {
    lowQuality = true;
    view.setQuality(true);
    savePrefs();
    renderToggles();
    toast('Máy hơi chậm nên đã tự giảm đồ họa');
  } else if (!slowHinted) {
    slowHinted = true;
    toast('Vẫn chậm? Bấm "Chế độ: 3D" để chuyển sang 2D cho nhẹ', 5500);
  }
}

function handleLost() {
  toast('Màn hình 3D bị ngắt, đang chuyển sang 2D', 4000);
  prefer2d = false;
  switchView(true);
}

// ---------- hiển thị ----------
function currentResult() {
  if (mode === 'online') return serverOver;
  const r = getResult(cur());
  return r.over ? { winner: r.winner, reason: r.reason } : null;
}

function reasonText(res) {
  switch (res.reason) {
    case 'checkmate': return 'chiếu hết';
    case 'stalemate': return 'hết nước đi nhưng không bị chiếu (pat)';
    case 'insufficient': return 'không đủ quân để chiếu hết';
    case 'resign': return `${sideName(opp(res.winner))} xin thua`;
    case 'repetition': return 'lặp thế 3 lần';
    case 'fifty-move': return '50 nước không ăn quân hay đi tốt';
    case 'draw-agreed': return 'hai bên đồng ý hòa';
    default: return '';
  }
}

function resultText(res) {
  if (!res.winner) return `Hòa — ${reasonText(res)}`;
  const who =
    mode === 'online' && isSeated()
      ? res.winner === mySide ? 'Bạn thắng' : 'Bạn thua'
      : ai
        ? res.winner === ai.human ? 'Bạn thắng' : 'Máy thắng'
        : `${sideName(res.winner)} thắng`;
  return `${who} — ${reasonText(res)}`;
}

function renderRoomInfo() {
  const box = $('roomInfo');
  box.textContent = '';
  if (mode !== 'online' || !roomCode) return;
  const b = document.createElement('b');
  b.textContent = roomCode;
  box.append('Phòng ', b, ' · ', isSeated() ? `Bạn cầm ${sideName(mySide)}` : 'Bạn đang xem');
}

function refresh() {
  const s = cur();
  const res = currentResult();
  const checked = isInCheck(s, s.turn);
  const online = mode === 'online';
  const seated = online && isSeated();
  const bothSeated = seats.w && seats.b;
  const waiting = online && !bothSeated;

  $('turnDot').className = 'dot ' + (s.turn === 'w' ? 'white' : 'black');
  let turnText;
  if (res) turnText = 'Ván kết thúc';
  else if (waiting) turnText = 'Đang chờ đối thủ…';
  else turnText = `Lượt: ${sideName(s.turn)}` + ((seated && s.turn === mySide) || (ai && s.turn === ai.human) ? ' (bạn)' : '');
  $('turnText').textContent = turnText;

  let msg = '';
  if (online && connStatus !== 'open') msg = 'Mất kết nối, đang nối lại…';
  else if (thinking) msg = 'Máy đang nghĩ…';
  else if (!res && checked && !waiting) msg = 'Chiếu!';
  else if (seated && bothSeated && !res && !peers[opp(mySide)]) msg = 'Đối thủ mất kết nối';
  $('msg').textContent = msg;

  renderRoomInfo();

  // Màn nhỏ: sau nước đi đầu của người chơi thì ẩn thanh nút cho bàn rộng hơn (bấm ☰ để hiện lại).
  if (!autoHidden && isSmallScreen() && !uiHidden) {
    const firstOwn = ai && ai.human === 'b' ? 2 : 1;
    if (s.history.length >= firstOwn) {
      autoHidden = true;
      uiHidden = true;
      applyUi();
    }
  }

  const last = s.history[s.history.length - 1];
  view.setLastMove(last ? last.from : null, last ? last.to : null);
  view.setCheck(checked ? s.board.indexOf(s.turn === 'w' ? 'K' : 'k') : null);

  $('btnUndo').disabled = states.length < 2 || busy || thinking;
  const canAct = seated && bothSeated && !res;
  $('btnDraw').disabled = !canAct || drawOffer === mySide;
  $('btnDraw').textContent = seated && drawOffer === mySide ? 'Đã xin hòa…' : 'Xin hòa';
  $('btnResign').disabled = !canAct;

  const nb = $('bannerNew');
  if (res) {
    $('bannerText').textContent = resultText(res);
    if (online) {
      nb.hidden = !seated;
      nb.disabled = seated && !!rematch[mySide];
      nb.textContent = nb.disabled ? 'Đang chờ đối thủ…' : 'Chơi lại';
    } else {
      nb.hidden = false;
      nb.disabled = false;
      nb.textContent = 'Ván mới';
    }
    $('banner').hidden = false;
  } else {
    $('banner').hidden = true;
  }

  $('offer').hidden = !(seated && !res && drawOffer && drawOffer !== mySide);
  updateInsets();
}

function setMode(m) {
  mode = m;
  document.body.dataset.mode = m;
}

function setFlip(flag, animate = true) {
  if (flag === flipped) return;
  flipped = flag;
  view.setFlipped(flag, animate);
}

// ---------- chọn quân ----------
function deselect() {
  selected = null;
  targetSet = new Set();
  view.select(null, []);
}

function selectPiece(idx) {
  const s = cur();
  const moves = legalMoves(s).filter((m) => m.from === idx);
  selected = idx;
  targetSet = new Set(moves.map((m) => m.to));
  view.select(
    idx,
    moves.filter((m, i, a) => a.findIndex((q) => q.to === m.to) === i).map((m) => ({ to: m.to, capture: isCapture(s, m) }))
  );
}

// Đưa mọi thứ về trạng thái ban đầu (dùng khi bắt đầu ván hoặc rời phòng).
function resetCommon() {
  epoch += 1;
  autoHidden = false;
  thinking = false;
  aiCancel();
  clearTimeout(pendingTimer);
  states = [createGame()];
  queue = [];
  busy = false;
  pending = false;
  mySide = null;
  seats = { w: false, b: false };
  peers = { w: false, b: false };
  serverOver = null;
  drawOffer = null;
  rematch = { w: false, b: false };
  gotSnapshot = false;
  deselect();
  syncView(cur());
  setFlip(false, false);
}

// ---------- đi nước ----------
function doMove(from, to, promo) {
  if (mode === 'online') {
    const msg = { t: 'move', from, to };
    if (promo) msg.promo = promo;
    if (!net || !net.send(msg)) {
      toast('Đang mất kết nối, thử lại sau giây lát');
      return;
    }
    pending = true;
    deselect();
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => {
      if (pending) {
        pending = false;
        if (net) net.send({ t: 'sync' });
      }
    }, 4000);
    return;
  }

  const prev = cur();
  const mv = { from, to, promo };
  const capture = isCapture(prev, mv);
  const rook = castleRook(prev, mv);
  const next = applyMove(prev, mv);
  busy = true;
  deselect();
  $('btnUndo').disabled = true;
  if (rook) view.animateMove(rook.from, rook.to, () => {});
  view.animateMove(from, to, () => {
    playClack(capture);
    states.push(next);
    syncView(next);
    busy = false;
    refresh();
    if (ai) maybeAiMove();
    else if (autoFlip) setFlip(next.turn === 'b');
  });
}

// Hỏi người chơi muốn phong thành quân nào, trả về 'q' | 'r' | 'b' | 'n' (hoặc null nếu hủy).
function askPromotion(side) {
  return new Promise((resolve) => {
    const box = $('promo');
    for (const btn of box.querySelectorAll('button[data-p]')) {
      btn.textContent = PROMO_GLYPH[side][btn.dataset.p];
      btn.onclick = () => {
        box.hidden = true;
        resolve(btn.dataset.p);
      };
    }
    $('promoCancel').onclick = () => {
      box.hidden = true;
      resolve(null);
    };
    box.hidden = false;
  });
}
const PROMO_GLYPH = {
  w: { q: '\u2655', r: '\u2656', b: '\u2657', n: '\u2658' },
  b: { q: '\u265B', r: '\u265C', b: '\u265D', n: '\u265E' },
};

function onTap(clientX, clientY) {
  unlockAudio();
  if (overlayOpen() || !$('promo').hidden || busy || pending || currentResult()) return;
  const s = cur();
  if (ai && (thinking || s.turn !== ai.human)) return;
  if (mode === 'online' && !(isSeated() && seats.w && seats.b && s.turn === mySide)) {
    deselect();
    return;
  }
  const cell = view.pickCell(clientX, clientY);
  if (!cell) {
    deselect();
    return;
  }
  const idx = cell.row * 8 + cell.col;
  if (selected !== null && targetSet.has(idx)) {
    if (isPromotion(s, selected, idx)) {
      const from = selected;
      const my = epoch;
      askPromotion(s.turn).then((p) => {
        if (my !== epoch) return;
        if (p) doMove(from, idx, p);
      });
    } else {
      doMove(selected, idx);
    }
  } else if (isMine(s.board[idx], s.turn)) {
    selectPiece(idx);
  } else {
    deselect();
  }
}

// ---------- online: nhận tin từ server ----------
const ERRORS = {
  waiting: 'Chưa có đối thủ trong phòng',
  not_your_turn: 'Chưa đến lượt bạn',
  illegal: 'Nước đi không hợp lệ',
  game_over: 'Ván đã kết thúc',
  spectator: 'Bạn đang ở chế độ xem',
  bad_id: 'Lỗi định danh, hãy tải lại trang',
};

function applyOrientation(animate) {
  setFlip(mySide === 'b', animate);
}

function loadSnapshot(m) {
  epoch += 1;
  clearTimeout(pendingTimer);
  let g = createGame();
  try {
    for (const uci of m.moves) g = applyMove(g, fromUCI(uci));
  } catch (e) {
    toast('Không đọc được thế cờ từ server, hãy tải lại trang');
  }
  states = [g];
  queue = [];
  busy = false;
  pending = false;
  mySide = m.you;
  seats = m.seats;
  peers = m.online;
  serverOver = m.over;
  drawOffer = m.drawOffer;
  rematch = m.rematch;
  deselect();
  syncView(g);
  applyOrientation(gotSnapshot);
  gotSnapshot = true;
  if (isSeated() && roomCode) rememberIdForRoom(roomCode, myId);
  refresh();
}

function playServerMove(it) {
  const prev = cur();
  if (it.n <= prev.history.length) return; // đã có nước này rồi
  let next = null;
  if (it.n === prev.history.length + 1) {
    try {
      next = applyMove(prev, { from: it.from, to: it.to, promo: it.promo || undefined });
    } catch (e) {
      next = null;
    }
  }
  if (!next) {
    // lệch với server: xin lại toàn bộ trạng thái
    queue = [];
    if (net) net.send({ t: 'sync' });
    return;
  }
  const myEpoch = epoch;
  const smv = { from: it.from, to: it.to };
  const capture = isCapture(prev, smv);
  const srook = castleRook(prev, smv);
  busy = true;
  pending = false;
  clearTimeout(pendingTimer);
  deselect();
  if (srook) view.animateMove(srook.from, srook.to, () => {});
  view.animateMove(it.from, it.to, () => {
    if (myEpoch !== epoch) return; // trạng thái đã được thay bằng bản mới từ server
    playClack(capture);
    states = [next];
    syncView(next);
    drawOffer = null;
    if (it.over) serverOver = it.over;
    busy = false;
    refresh();
    notifyTurn();
    pump();
  });
}

function pump() {
  while (!busy && queue.length) {
    const it = queue.shift();
    if (it.kind === 'move') {
      playServerMove(it);
    } else if (it.kind === 'over') {
      serverOver = it.over;
      drawOffer = null;
      refresh();
    } else if (it.kind === 'offer') {
      drawOffer = it.by;
      refresh();
    } else if (it.kind === 'offer_clear') {
      const was = drawOffer;
      drawOffer = null;
      refresh();
      if (was === mySide && isSeated()) toast('Đối thủ từ chối hòa');
    }
  }
}

function notifyTurn() {
  if (mode !== 'online' || currentResult() || !isSeated() || cur().turn !== mySide) return;
  if (document.hidden) {
    document.title = '● Đến lượt bạn — ' + BASE_TITLE;
    try {
      if (navigator.vibrate) navigator.vibrate(150);
    } catch (e) {
      /* bỏ qua */
    }
  }
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) document.title = BASE_TITLE;
});

function onNetMessage(m) {
  switch (m.t) {
    case 'state':
      loadSnapshot(m);
      break;
    case 'move':
      queue.push({ kind: 'move', n: m.n, from: m.from, to: m.to, promo: m.promo, over: m.over });
      pump();
      break;
    case 'over':
      queue.push({ kind: 'over', over: m.over });
      pump();
      break;
    case 'draw_offer':
      queue.push({ kind: 'offer', by: m.by });
      pump();
      break;
    case 'draw_declined':
      queue.push({ kind: 'offer_clear' });
      pump();
      break;
    case 'rematch':
      rematch = m.rematch;
      refresh();
      break;
    case 'presence':
      seats = m.seats;
      peers = m.online;
      refresh();
      break;
    case 'error':
      if (m.code === 'unauthorized') {
        const c = roomCode;
        leaveRoom();
        toast('Mã truy cập không còn hiệu lực, hãy nhập lại', 4500);
        openRemote(c);
        break;
      }
      pending = false;
      toast(ERRORS[m.code] || 'Có lỗi, hãy thử lại');
      refresh();
      break;
    default:
      break;
  }
}

// ---------- bắt đầu / rời ván ----------
function startLocal() {
  ai = null;
  leaveRoom(false);
  setMode('local');
  resetCommon();
  refresh();
}

function startOnline(code, want) {
  ai = null;
  leaveRoom(false);
  resetCommon();
  setMode('online');
  roomCode = code;
  myId = tabId();
  connStatus = 'connecting';
  setUrlRoom(code);
  net = connect({
    code,
    clientId: myId,
    prevId: lastIdForRoom(code),
    want,
    onMessage: onNetMessage,
    onStatus: (s) => {
      connStatus = s;
      refresh();
    },
  });
  refresh();
}

function leaveRoom(toLocal = true) {
  if (net) net.close();
  net = null;
  roomCode = null;
  connStatus = 'closed';
  if (toLocal) {
    forgetAccess();
    setUrlRoom(null);
    startLocal();
    document.title = BASE_TITLE;
  }
}

async function invite() {
  const url = `${location.origin}${location.pathname}?room=${roomCode}`;
  const text = `Đánh cờ vua 3D với mình nhé! Mã phòng: ${roomCode}. Bạn cần mã truy cập mình đã gửi riêng.`;
  const touch = window.matchMedia('(pointer: coarse)').matches;
  if (touch && navigator.share) {
    try {
      await navigator.share({ title: BASE_TITLE, text, url });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('Đã sao chép link mời, hãy gửi cho bạn');
  } catch (e) {
    window.prompt('Sao chép link này rồi gửi cho bạn:', url);
  }
}

// ---------- nút: một máy ----------
function newGame() {
  if (busy) return;
  if (states.length > 1 && !currentResult() && !window.confirm('Bắt đầu ván mới?')) return;
  resetCommon();
  if (ai) setFlip(ai.human === 'b', false);
  refresh();
  if (ai) maybeAiMove();
}

function undo() {
  if (busy || thinking || states.length < 2) return;
  if (ai) {
    // lùi về lượt của người: bỏ nước của mình và nước máy đáp lại
    states.pop();
    while (states.length > 1 && cur().turn !== ai.human) states.pop();
  } else {
    states.pop();
  }
  deselect();
  syncView(cur());
  refresh();
  if (ai) maybeAiMove();
  else if (autoFlip) setFlip(cur().turn === 'b');
}

// ---------- chơi với máy ----------
function startAi(level, humanChoice) {
  const human = humanChoice === 'any' ? (Math.random() < 0.5 ? 'w' : 'b') : humanChoice;
  leaveRoom(false);
  setMode('local');
  resetCommon();
  ai = { level, human };
  setFlip(human === 'b', false);
  refresh();
  maybeAiMove();
}

function maybeAiMove() {
  if (!ai || mode !== 'local' || thinking) return;
  const s = cur();
  if (currentResult() || s.turn === ai.human) return;
  const my = epoch;
  thinking = true;
  refresh();
  const t0 = Date.now();
  aiThink(s, ai.level)
    .then(async (mv) => {
      const wait = Math.max(0, 350 - (Date.now() - t0));
      if (wait) await new Promise((r) => setTimeout(r, wait));
      if (my !== epoch || !thinking) return;
      thinking = false;
      if (!mv) return refresh();
      doMove(mv.from, mv.to, mv.promo);
    })
    .catch(() => {
      if (my !== epoch) return;
      thinking = false;
      toast('Máy gặp lỗi, hãy bấm Ván mới');
      refresh();
    });
}

function renderToggles() {
  $('btnAuto').textContent = `Tự lật: ${autoFlip ? 'bật' : 'tắt'}`;
  $('btnAuto').setAttribute('aria-pressed', String(autoFlip));
  $('btnSound').textContent = `Âm thanh: ${sound ? 'bật' : 'tắt'}`;
  $('btnSound').setAttribute('aria-pressed', String(sound));
  $('btnQuality').textContent = `Đồ họa: ${lowQuality ? 'thấp' : 'cao'}`;
  $('btnQuality').setAttribute('aria-pressed', String(lowQuality));
  $('btnWide').textContent = `Bàn lớn: ${fullBoard ? 'bật' : 'tắt'}`;
  $('btnWide').setAttribute('aria-pressed', String(fullBoard));
}

$('btnNew').addEventListener('click', newGame);
$('btnUndo').addEventListener('click', undo);
$('btnFlip').addEventListener('click', () => setFlip(!flipped));
$('btnAuto').addEventListener('click', () => {
  autoFlip = !autoFlip;
  if (autoFlip) setFlip(cur().turn === 'b');
  savePrefs();
  renderToggles();
});

// ---------- nút: online ----------
$('btnInvite').addEventListener('click', invite);
$('btnDraw').addEventListener('click', () => {
  if (net) net.send({ t: 'draw_offer' });
});
$('btnResign').addEventListener('click', () => {
  if (net && window.confirm('Bạn chắc chắn muốn xin thua?')) net.send({ t: 'resign' });
});
$('btnLeave').addEventListener('click', () => {
  if (window.confirm('Rời phòng? Bạn vẫn có thể vào lại bằng link hoặc mã phòng.')) leaveRoom();
});
$('bannerLeave').addEventListener('click', () => leaveRoom());
$('bannerNew').addEventListener('click', () => {
  if (mode === 'online') {
    if (net) net.send({ t: 'rematch' });
  } else {
    newGame();
  }
});
$('offerYes').addEventListener('click', () => {
  if (net) net.send({ t: 'draw_accept' });
});
$('offerNo').addEventListener('click', () => {
  if (net) net.send({ t: 'draw_decline' });
});

// ---------- ẩn/hiện menu và toàn màn hình ----------
function applyUi() {
  $('toolbar').hidden = uiHidden;
  $('btnMenu').textContent = uiHidden ? '☰' : '✕';
  $('btnMenu').setAttribute('aria-expanded', String(!uiHidden));
  updateInsets();
}

const fsRoot = document.documentElement;
const fsSupported = !!(fsRoot.requestFullscreen || fsRoot.webkitRequestFullscreen);
const isFull = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
// Đã mở từ biểu tượng ngoài màn hình chính: đang toàn màn hình sẵn, không cần nút.
const isStandalone =
  window.navigator.standalone === true || window.matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;
if (isStandalone) document.body.classList.add('standalone');

function updateFullBtn() {
  $('btnFull').textContent = isFull() ? 'Thoát toàn màn hình' : 'Toàn màn hình';
}

function showFsHelp() {
  $('fsHelpBody').innerHTML = isIOS
    ? 'iPhone không cho trang web tự bật toàn màn hình, nhưng bạn vẫn có thể dùng như ứng dụng toàn màn hình:' +
      '<ol><li>Mở trang này bằng <b>Safari</b>.</li><li>Bấm nút <b>Chia sẻ</b> (hình vuông có mũi tên lên).</li>' +
      '<li>Chọn <b>Thêm vào MH chính</b>, rồi <b>Thêm</b>.</li><li>Mở game từ biểu tượng mới trên màn hình chính.</li></ol>'
    : 'Trình duyệt này không bật được toàn màn hình. Hãy mở trang bằng <b>Chrome</b> (không mở trong ứng dụng Zalo, Facebook...), ' +
      'hoặc cài lên màn hình chính: menu ⋮ → <b>Cài đặt ứng dụng</b>.';
  $('fsHelp').hidden = false;
}
$('fsHelpOk').addEventListener('click', () => {
  $('fsHelp').hidden = true;
});

async function toggleFull() {
  if (!fsSupported) {
    showFsHelp();
    return;
  }
  try {
    if (isFull()) await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else if (fsRoot.requestFullscreen) await fsRoot.requestFullscreen({ navigationUI: 'hide' });
    else await fsRoot.webkitRequestFullscreen();
  } catch (e) {
    showFsHelp();
  }
}

$('btnMenu').addEventListener('click', () => {
  uiHidden = !uiHidden;
  uiHiddenUser = uiHidden;
  applyUi();
  savePrefs();
});
$('btnMore').addEventListener('click', () => {
  moreOpen = !moreOpen;
  applySmall();
  requestAnimationFrame(updateInsets);
});
$('btnFull').addEventListener('click', toggleFull);
document.addEventListener('fullscreenchange', updateFullBtn);
document.addEventListener('webkitfullscreenchange', updateFullBtn);

// ---------- nút: chung ----------
$('btnAI').addEventListener('click', () => {
  unlockAudio();
  $('aiSetup').hidden = false;
});
$('btnAiClose').addEventListener('click', () => {
  $('aiSetup').hidden = true;
  if (ai) {
    if (states.length > 1 && !currentResult() && !window.confirm('Bỏ ván với máy và chuyển sang cờ hai người một máy?')) return;
    startLocal();
  }
});
$('btnAiStart').addEventListener('click', () => {
  const level = document.querySelector('input[name="aiLevel"]:checked').value;
  const side = document.querySelector('input[name="aiSide"]:checked').value;
  if (!ai && states.length > 1 && !currentResult() && !window.confirm('Bắt đầu ván với máy sẽ bỏ ván đang chơi. Tiếp tục?')) return;
  $('aiSetup').hidden = true;
  startAi(level, side);
});
$('btnRemote').addEventListener('click', () => {
  unlockAudio();
  if (states.length > 1 && !currentResult() && !window.confirm('Vào phòng chơi từ xa sẽ bỏ ván một máy đang chơi. Tiếp tục?')) return;
  openRemote(null);
});
$('btnView').addEventListener('click', () => {
  const to2d = view.kind === '3d';
  prefer2d = to2d;
  savePrefs();
  switchView(to2d);
});
$('btnRotate').addEventListener('click', () => {
  rotateOn = !rotateOn;
  view.setRotateEnabled(rotateOn);
  savePrefs();
  renderViewUi();
});
$('btnSeat').addEventListener('click', () => view.resetCamera());
// Đã bỏ nút "Nhìn từ trên": nhìn thẳng từ trên xuống khó phân biệt các loại quân cờ vua.
$('btnSound').addEventListener('click', () => {
  sound = !sound;
  setSoundEnabled(sound);
  unlockAudio();
  savePrefs();
  renderToggles();
});
$('btnWide').addEventListener('click', () => {
  fullBoard = !fullBoard;
  view.setFullBoard(fullBoard);
  savePrefs();
  renderToggles();
});
$('btnQuality').addEventListener('click', () => {
  lowQuality = !lowQuality;
  view.setQuality(lowQuality);
  savePrefs();
  renderToggles();
});

// ---------- chơi từ xa: nhập mã truy cập rồi tới sảnh ----------
function overlayOpen() {
  return !$('gate').hidden || !$('lobby').hidden || !$('aiSetup').hidden;
}

function lobbyError(text) {
  $('lobbyErr').textContent = text;
}

function showGate(msg = '') {
  $('lobby').hidden = true;
  $('gate').hidden = false;
  $('gateErr').textContent = msg;
  $('gateInput').value = '';
  setTimeout(() => $('gateInput').focus(), 50);
}

function showLobby() {
  $('gate').hidden = true;
  $('lobby').hidden = false;
  lobbyError('');
  $('codeInput').value = '';
}

function closeRemote() {
  $('gate').hidden = true;
  $('lobby').hidden = true;
  if (mode !== 'online') setUrlRoom(null);
}

function afterAccess() {
  $('gate').hidden = true;
  if (pendingJoin) {
    const code = pendingJoin;
    pendingJoin = null;
    startOnline(code, 'any');
  } else {
    showLobby();
  }
}

// Mỗi lần vào phần chơi từ xa (qua nút hoặc qua link mời) đều phải nhập mã, kể cả khi trước đó đã nhập đúng.
// joinCode: mã phòng từ link mời (nếu có); nhập mã xong sẽ vào thẳng phòng đó.
async function openRemote(joinCode) {
  pendingJoin = joinCode;
  let st = null;
  try {
    st = await (await fetch('/api/session', { cache: 'no-store' })).json();
  } catch (e) {
    toast('Không kết nối được máy chủ, hãy kiểm tra mạng', 4000);
    pendingJoin = null;
    return;
  }
  if (!st.configured) {
    toast('Phần chơi từ xa chưa được cấu hình mã truy cập (SITE_PASSWORD)', 6000);
    pendingJoin = null;
    return;
  }
  await forgetAccess(); // xóa quyền cũ để buộc nhập lại
  showGate();
}

function forgetAccess() {
  return fetch('/api/logout', { method: 'POST', cache: 'no-store' }).catch(() => {});
}

async function submitGate() {
  const code = $('gateInput').value;
  if (!code) {
    $('gateErr').textContent = 'Hãy nhập mã';
    return;
  }
  $('gateGo').disabled = true;
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (res.ok) {
      afterAccess();
    } else if (res.status === 429) {
      const j = await res.json().catch(() => ({}));
      const min = Math.max(1, Math.ceil((j.retryAfter || 300) / 60));
      $('gateErr').textContent = `Nhập sai nhiều lần, hãy thử lại sau ${min} phút`;
    } else if (res.status === 503) {
      $('gateErr').textContent = 'Máy chủ chưa cấu hình mã truy cập';
    } else {
      $('gateErr').textContent = 'Mã không đúng';
      $('gateInput').select();
    }
  } catch (e) {
    $('gateErr').textContent = 'Không kết nối được máy chủ';
  } finally {
    $('gateGo').disabled = false;
  }
}
$('gateGo').addEventListener('click', submitGate);
$('gateInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitGate();
});
$('gateCancel').addEventListener('click', () => {
  pendingJoin = null;
  closeRemote();
});
$('btnLobbyClose').addEventListener('click', closeRemote);

$('btnCreate').addEventListener('click', () => {
  unlockAudio();
  const want = document.querySelector('input[name="side"]:checked').value;
  $('lobby').hidden = true;
  startOnline(randomCode(), want);
});

function joinFromInput() {
  unlockAudio();
  const code = normalizeCode($('codeInput').value);
  if (!validCode(code)) {
    lobbyError('Mã phòng gồm 4 đến 12 chữ và số');
    return;
  }
  $('lobby').hidden = true;
  startOnline(code, 'any');
}
$('btnJoin').addEventListener('click', joinFromInput);
$('codeInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinFromInput();
});
$('codeInput').addEventListener('input', () => lobbyError(''));

// ---------- khởi động ----------
async function start() {
  loadPrefs();
  applySmall();
  setSoundEnabled(sound);
  renderToggles();
  applyUi();
  updateFullBtn();
  try {
    const reason = await mountView(prefer2d);
    if (reason === 'no-webgl' || reason === 'error') {
      toast('Thiết bị này chưa chạy được 3D, đang dùng chế độ 2D nhìn từ trên', 5000);
    }
  } catch (e) {
    $('loading').textContent = 'Không khởi tạo được bàn cờ. Hãy tải lại trang hoặc dùng trình duyệt khác.';
    throw e;
  }
  refresh();

  // Mặc định là cờ hai người một máy. Link mời (?room=MÃ) đi qua bước nhập mã truy cập rồi vào phòng.
  const roomFromUrl = normalizeCode(new URLSearchParams(location.search).get('room'));
  startLocal();
  if (validCode(roomFromUrl)) openRemote(roomFromUrl);
  else setUrlRoom(null);

  $('loading').hidden = true;
}

start();
