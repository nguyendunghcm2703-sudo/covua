// Máy đánh cờ vua: bàn nhanh (make/unmake) + alpha-beta, quiescence, bảng băm.
// Thuần JS, chạy được trong Web Worker và trong Node.
//
// Ngoài giao tiếp bằng trạng thái của chess.js; trong máy dùng mã số cho nhanh.
// Mã quân: 1=Tốt 2=Mã 3=Tượng 4=Xe 5=Hậu 6=Vua, Đen = mã + 8.

import { parseFen, toFen, INITIAL_FEN } from './chess.js';

const P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6;
const VALUE = [0, 100, 320, 330, 500, 900, 0];
const MATE = 30000;
const INF = 32000;
const CODE = { p: P, n: N, b: B, r: R, q: Q, k: K };
const PROMO_CHAR = [null, null, 'n', 'b', 'r', 'q'];

const ROW = new Int8Array(64), COL = new Int8Array(64);
for (let i = 0; i < 64; i++) { ROW[i] = i >> 3; COL[i] = i & 7; }

const KN = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KG = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const DG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const OR = [[-1, 0], [1, 0], [0, -1], [0, 1]];

const CASTLE_MASK = new Int8Array(64).fill(15);
CASTLE_MASK[60] = 15 & ~3; // vua trắng: bỏ K,Q
CASTLE_MASK[63] = 15 & ~1;
CASTLE_MASK[56] = 15 & ~2;
CASTLE_MASK[4] = 15 & ~12;
CASTLE_MASK[7] = 15 & ~4;
CASTLE_MASK[0] = 15 & ~8;

// ---------- Zobrist ----------
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) | 0;
  };
}
const rnd = rng(77123);
const Z1 = new Int32Array(16 * 64), Z2 = new Int32Array(16 * 64);
for (let i = 0; i < Z1.length; i++) { Z1[i] = rnd(); Z2[i] = rnd(); }
const ZC1 = new Int32Array(16), ZC2 = new Int32Array(16);
for (let i = 0; i < 16; i++) { ZC1[i] = rnd(); ZC2[i] = rnd(); }
const ZE1 = new Int32Array(8), ZE2 = new Int32Array(8);
for (let i = 0; i < 8; i++) { ZE1[i] = rnd(); ZE2[i] = rnd(); }
const ZS1 = rnd(), ZS2 = rnd();

// ---------- Bảng điểm vị trí (Tomasz Michniewski), nhìn từ phía Trắng, hàng 8 ở trên ----------
const PST_P = [0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10, 5,5,10,25,25,10,5,5, 0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5, 5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0];
const PST_N = [-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40, -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30, -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30, -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50];
const PST_B = [-20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,10,10,5,0,-10, -10,5,5,10,10,5,5,-10, -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10, -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20];
const PST_R = [0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0];
const PST_Q = [-20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5, 0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10, -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20];
const PST_KM = [-30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10, 20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20];
const PST_KE = [-50,-40,-30,-20,-20,-30,-40,-50, -30,-20,-10,0,0,-10,-20,-30, -30,-10,20,30,30,20,-10,-30, -30,-10,30,40,40,30,-10,-30, -30,-10,30,40,40,30,-10,-30, -30,-10,20,30,30,20,-10,-30, -30,-30,0,0,0,0,-30,-30, -50,-30,-30,-30,-30,-30,-30,-50];
const PST = [null, PST_P, PST_N, PST_B, PST_R, PST_Q, PST_KM];

export const LEVELS = {
  de: { name: 'Dễ', maxDepth: 2, timeMs: 300, noise: 130, blunder: 0.2, opening: 0 },
  vua: { name: 'Vừa', maxDepth: 4, timeMs: 1500, noise: 10, blunder: 0, opening: 0 },
  kho: { name: 'Khó', maxDepth: 10, timeMs: 3000, noise: 0, blunder: 0, opening: 6 },
};

const TT_BITS = 18;
const TT_SIZE = 1 << TT_BITS;

// Mã nước đi: từ | đến<<6 | quân phong<<12 | cờ<<16 (1 = bắt tốt qua đường, 2 = nhập thành)
const mFrom = (m) => m & 63;
const mTo = (m) => (m >> 6) & 63;
const mPromo = (m) => (m >> 12) & 15;
const mFlag = (m) => m >> 16;

export class Engine {
  constructor() {
    this.b = new Int8Array(64);
    this.kingPos = [-1, -1];
    this.turn = 0;
    this.castle = 0;
    this.ep = -1;
    this.half = 0;
    this.h1 = 0;
    this.h2 = 0;
    this.stack = [];
    this.undo = [];
    this.ttKey = new Int32Array(TT_SIZE);
    this.ttData = new Int32Array(TT_SIZE * 2);
    this.killers = [];
    for (let i = 0; i < 80; i++) this.killers.push([0, 0]);
    this.moveBuf = [];
    for (let i = 0; i < 80; i++) this.moveBuf.push({ m: new Int32Array(256), s: new Int32Array(256) });
    this.nodes = 0;
    this.deadline = 0;
    this.aborted = false;
    this.clock = () => Date.now();
  }

  setFen(fen) {
    const p = parseFen(fen);
    this.b.fill(0);
    this.h1 = 0; this.h2 = 0;
    for (let i = 0; i < 64; i++) {
      const ch = p.board[i];
      if (ch === '.') continue;
      const white = ch === ch.toUpperCase();
      const code = CODE[ch.toLowerCase()] + (white ? 0 : 8);
      this.b[i] = code;
      this.h1 ^= Z1[code * 64 + i]; this.h2 ^= Z2[code * 64 + i];
      if ((code & 7) === K) this.kingPos[white ? 0 : 1] = i;
    }
    this.turn = p.turn === 'w' ? 0 : 1;
    this.castle = (p.castling.includes('K') ? 1 : 0) | (p.castling.includes('Q') ? 2 : 0) | (p.castling.includes('k') ? 4 : 0) | (p.castling.includes('q') ? 8 : 0);
    this.ep = p.ep;
    this.half = p.halfmove;
    this.h1 ^= ZC1[this.castle]; this.h2 ^= ZC2[this.castle];
    if (this.ep >= 0) { this.h1 ^= ZE1[COL[this.ep]]; this.h2 ^= ZE2[COL[this.ep]]; }
    if (this.turn) { this.h1 ^= ZS1; this.h2 ^= ZS2; }
    this.stack = [this.h1];
    this.undo = [];
  }

  attacked(t, by) {
    const b = this.b;
    const r = ROW[t], c = COL[t];
    const base = by << 3;
    // tốt: Trắng (by=0) tiến lên (hàng giảm) nên tấn công từ hàng r+1
    const pr = by === 0 ? r + 1 : r - 1;
    if (pr >= 0 && pr < 8) {
      if (c > 0 && b[pr * 8 + c - 1] === base + P) return true;
      if (c < 7 && b[pr * 8 + c + 1] === base + P) return true;
    }
    for (let k = 0; k < 8; k++) {
      const nr = r + KN[k][0], nc = c + KN[k][1];
      if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && b[nr * 8 + nc] === base + N) return true;
    }
    for (let k = 0; k < 8; k++) {
      const nr = r + KG[k][0], nc = c + KG[k][1];
      if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && b[nr * 8 + nc] === base + K) return true;
    }
    for (let d = 0; d < 4; d++) {
      let nr = r + OR[d][0], nc = c + OR[d][1];
      while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
        const p = b[nr * 8 + nc];
        if (p) { if (p === base + R || p === base + Q) return true; break; }
        nr += OR[d][0]; nc += OR[d][1];
      }
      nr = r + DG[d][0]; nc = c + DG[d][1];
      while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
        const p = b[nr * 8 + nc];
        if (p) { if (p === base + B || p === base + Q) return true; break; }
        nr += DG[d][0]; nc += DG[d][1];
      }
    }
    return false;
  }

  inCheck(side) { return this.attacked(this.kingPos[side], side ^ 1); }

  gen(ply, capsOnly) {
    const buf = this.moveBuf[ply];
    const ms = buf.m, ss = buf.s;
    let n = 0;
    const b = this.b;
    const side = this.turn;
    const white = side === 0;
    const push = (from, to, promo, flag, score) => { ms[n] = from | (to << 6) | (promo << 12) | (flag << 16); ss[n] = score; n++; };
    const addMove = (from, to, attacker) => {
      const v = b[to];
      if (v) {
        if ((v >> 3) === side) return;
        push(from, to, 0, 0, 10000 + VALUE[v & 7] * 10 - VALUE[attacker]);
      } else if (!capsOnly) push(from, to, 0, 0, 0);
    };
    for (let i = 0; i < 64; i++) {
      const p = b[i];
      if (!p || (p >> 3) !== side) continue;
      const ty = p & 7;
      const r = ROW[i], c = COL[i];
      if (ty === P) {
        const dir = white ? -1 : 1;
        const startRow = white ? 6 : 1;
        const lastRow = white ? 0 : 7;
        const r1 = r + dir;
        if (r1 < 0 || r1 > 7) continue;
        const to1 = r1 * 8 + c;
        if (!b[to1]) {
          if (r1 === lastRow) {
            push(i, to1, Q, 0, 20000 + VALUE[Q]);
            if (!capsOnly) { push(i, to1, N, 0, 100); push(i, to1, R, 0, 50); push(i, to1, B, 0, 50); }
          } else if (!capsOnly) {
            push(i, to1, 0, 0, 0);
            if (r === startRow && !b[(r + 2 * dir) * 8 + c]) push(i, (r + 2 * dir) * 8 + c, 0, 0, 0);
          }
        }
        for (let dc = -1; dc <= 1; dc += 2) {
          const nc = c + dc;
          if (nc < 0 || nc > 7) continue;
          const to = r1 * 8 + nc;
          const v = b[to];
          if (v && (v >> 3) !== side) {
            const sc = 10000 + VALUE[v & 7] * 10 - 1;
            if (r1 === lastRow) {
              push(i, to, Q, 0, sc + 9000);
              if (!capsOnly) { push(i, to, N, 0, sc - 5000); push(i, to, R, 0, sc - 6000); push(i, to, B, 0, sc - 6000); }
            } else push(i, to, 0, 0, sc);
          } else if (!v && to === this.ep) push(i, to, 0, 1, 10000 + VALUE[P] * 10 - 1);
        }
      } else if (ty === N || ty === K) {
        const dl = ty === N ? KN : KG;
        for (let k = 0; k < 8; k++) {
          const nr = r + dl[k][0], nc = c + dl[k][1];
          if (nr < 0 || nr > 7 || nc < 0 || nc > 7) continue;
          addMove(i, nr * 8 + nc, ty);
        }
        if (ty === K && !capsOnly) {
          const row = white ? 7 : 0;
          if (i === row * 8 + 4 && !this.attacked(i, side ^ 1)) {
            const ks = white ? 1 : 4, qs = white ? 2 : 8;
            const rk = (white ? 0 : 8) + R;
            if ((this.castle & ks) && b[row * 8 + 7] === rk && !b[row * 8 + 5] && !b[row * 8 + 6]
              && !this.attacked(row * 8 + 5, side ^ 1) && !this.attacked(row * 8 + 6, side ^ 1)) push(i, row * 8 + 6, 0, 2, 50);
            if ((this.castle & qs) && b[row * 8] === rk && !b[row * 8 + 1] && !b[row * 8 + 2] && !b[row * 8 + 3]
              && !this.attacked(row * 8 + 3, side ^ 1) && !this.attacked(row * 8 + 2, side ^ 1)) push(i, row * 8 + 2, 0, 2, 50);
          }
        }
      } else {
        const bishop = ty === B || ty === Q, rook = ty === R || ty === Q;
        for (let d = 0; d < 4; d++) {
          if (bishop) {
            let nr = r + DG[d][0], nc = c + DG[d][1];
            while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
              const to = nr * 8 + nc;
              addMove(i, to, ty);
              if (b[to]) break;
              nr += DG[d][0]; nc += DG[d][1];
            }
          }
          if (rook) {
            let nr = r + OR[d][0], nc = c + OR[d][1];
            while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
              const to = nr * 8 + nc;
              addMove(i, to, ty);
              if (b[to]) break;
              nr += OR[d][0]; nc += OR[d][1];
            }
          }
        }
      }
    }
    return n;
  }

  make(m) {
    const from = mFrom(m), to = mTo(m), promo = mPromo(m), flag = mFlag(m);
    const b = this.b;
    const p = b[from];
    const side = this.turn;
    let cap = b[to];
    this.undo.push(m, cap, this.castle, this.ep, this.half, this.h1, this.h2);
    let h1 = this.h1 ^ ZC1[this.castle] ^ ZS1;
    let h2 = this.h2 ^ ZC2[this.castle] ^ ZS2;
    if (this.ep >= 0) { h1 ^= ZE1[COL[this.ep]]; h2 ^= ZE2[COL[this.ep]]; }
    h1 ^= Z1[p * 64 + from]; h2 ^= Z2[p * 64 + from];
    if (cap) { h1 ^= Z1[cap * 64 + to]; h2 ^= Z2[cap * 64 + to]; }
    b[from] = 0;
    let placed = p;
    if (promo) placed = (side << 3) + promo;
    b[to] = placed;
    h1 ^= Z1[placed * 64 + to]; h2 ^= Z2[placed * 64 + to];
    if (flag === 1) {
      const capSq = ROW[from] * 8 + COL[to];
      const cp = b[capSq];
      b[capSq] = 0;
      h1 ^= Z1[cp * 64 + capSq]; h2 ^= Z2[cp * 64 + capSq];
      cap = cp; // lưu để unmake: xử lý riêng qua cờ
    }
    if (flag === 2) {
      const row = ROW[from];
      const [rf, rt] = COL[to] === 6 ? [row * 8 + 7, row * 8 + 5] : [row * 8, row * 8 + 3];
      const rk = b[rf];
      b[rt] = rk; b[rf] = 0;
      h1 ^= Z1[rk * 64 + rf] ^ Z1[rk * 64 + rt]; h2 ^= Z2[rk * 64 + rf] ^ Z2[rk * 64 + rt];
    }
    if ((p & 7) === K) this.kingPos[side] = to;
    this.castle &= CASTLE_MASK[from] & CASTLE_MASK[to];
    this.ep = -1;
    if ((p & 7) === P && Math.abs(to - from) === 16) this.ep = (from + to) >> 1;
    h1 ^= ZC1[this.castle]; h2 ^= ZC2[this.castle];
    if (this.ep >= 0) { h1 ^= ZE1[COL[this.ep]]; h2 ^= ZE2[COL[this.ep]]; }
    this.half = (cap || (p & 7) === P) ? 0 : this.half + 1;
    this.h1 = h1; this.h2 = h2;
    this.turn = side ^ 1;
    this.stack.push(h1);
    return !this.attacked(this.kingPos[side], side ^ 1);
  }

  unmake(m) {
    const from = mFrom(m), to = mTo(m), flag = mFlag(m), promo = mPromo(m);
    const b = this.b;
    this.stack.pop();
    const u = this.undo;
    this.h2 = u.pop(); this.h1 = u.pop(); this.half = u.pop(); this.ep = u.pop(); this.castle = u.pop();
    const cap = u.pop();
    u.pop();
    const side = this.turn ^ 1;
    this.turn = side;
    let p = b[to];
    if (promo) p = (side << 3) + P;
    b[from] = p;
    b[to] = cap;
    if (flag === 1) {
      b[to] = 0;
      b[ROW[from] * 8 + COL[to]] = ((side ^ 1) << 3) + P;
    }
    if (flag === 2) {
      const row = ROW[from];
      const [rf, rt] = COL[to] === 6 ? [row * 8 + 7, row * 8 + 5] : [row * 8, row * 8 + 3];
      b[rf] = b[rt]; b[rt] = 0;
    }
    if ((p & 7) === K) this.kingPos[side] = from;
  }

  evaluate() {
    const b = this.b;
    let score = 0;
    let material = 0;
    for (let i = 0; i < 64; i++) {
      const p = b[i];
      if (!p) continue;
      const ty = p & 7;
      if (ty !== K && ty !== P) material += VALUE[ty];
    }
    const endgame = material <= 2600;
    for (let i = 0; i < 64; i++) {
      const p = b[i];
      if (!p) continue;
      const side = p >> 3, ty = p & 7;
      const idx = side === 0 ? i : i ^ 56;
      const table = ty === K && endgame ? PST_KE : PST[ty];
      const v = VALUE[ty] + table[idx];
      score += side === 0 ? v : -v;
    }
    return (this.turn === 0 ? score : -score) + 10;
  }

  legalRootMoves() {
    const n = this.gen(0, false);
    const out = [];
    const ms = this.moveBuf[0].m.slice(0, n);
    for (let i = 0; i < n; i++) {
      const m = ms[i];
      if (this.make(m)) out.push(m);
      this.unmake(m);
    }
    return out;
  }

  timeUp() {
    if ((this.nodes & 1023) === 0 && this.clock() > this.deadline) this.aborted = true;
    return this.aborted;
  }

  sortMoves(buf, n, ttMove, ply) {
    const ms = buf.m, ss = buf.s;
    for (let i = 0; i < n; i++) {
      if (ttMove && ms[i] === ttMove) ss[i] += 1000000;
      else if (ply >= 0 && ss[i] === 0) {
        if (ms[i] === this.killers[ply][0]) ss[i] = 9000;
        else if (ms[i] === this.killers[ply][1]) ss[i] = 8000;
      }
    }
    for (let i = 1; i < n; i++) {
      const m = ms[i], s = ss[i];
      let j = i - 1;
      while (j >= 0 && ss[j] < s) { ms[j + 1] = ms[j]; ss[j + 1] = ss[j]; j--; }
      ms[j + 1] = m; ss[j + 1] = s;
    }
  }

  quiesce(alpha, beta, ply, qd) {
    this.nodes++;
    if (this.timeUp()) return 0;
    const stand = this.evaluate();
    if (stand >= beta) return stand;
    if (qd >= 8 || ply >= 70) return stand;
    if (stand > alpha) alpha = stand;
    const n = this.gen(ply, true);
    const buf = this.moveBuf[ply];
    this.sortMoves(buf, n, 0, -1);
    for (let i = 0; i < n; i++) {
      const m = buf.m[i];
      if (!this.make(m)) { this.unmake(m); continue; }
      const sc = -this.quiesce(-beta, -alpha, ply + 1, qd + 1);
      this.unmake(m);
      if (this.aborted) return 0;
      if (sc >= beta) return sc;
      if (sc > alpha) alpha = sc;
    }
    return alpha;
  }

  repeated() {
    const st = this.stack;
    const cur = st[st.length - 1];
    const lim = Math.max(0, st.length - 1 - this.half);
    for (let i = st.length - 3; i >= lim; i -= 2) if (st[i] === cur) return true;
    return false;
  }

  negamax(depth, alpha, beta, ply) {
    this.nodes++;
    if (this.timeUp()) return 0;
    if (ply > 0 && (this.repeated() || this.half >= 100)) return 0;
    if (ply >= 68) return this.evaluate();
    const inChk = this.inCheck(this.turn);
    if (inChk && ply < 40) depth++;
    if (depth <= 0) return this.quiesce(alpha, beta, ply, 0);

    const idx = this.h1 & (TT_SIZE - 1);
    let ttMove = 0;
    if (this.ttKey[idx] === this.h2) {
      const d = this.ttData[idx * 2];
      const info = this.ttData[idx * 2 + 1];
      const flag = info & 3;
      let sc = info >> 2;
      ttMove = d & 0x3fffff;
      const dd = d >>> 22;
      if (dd >= depth && ply > 0) {
        if (sc > MATE - 100) sc -= ply; else if (sc < -MATE + 100) sc += ply;
        if (flag === 0) return sc;
        if (flag === 1 && sc >= beta) return sc;
        if (flag === 2 && sc <= alpha) return sc;
      }
    }
    const n = this.gen(ply, false);
    const buf = this.moveBuf[ply];
    this.sortMoves(buf, n, ttMove, ply);
    let best = -INF, bestMove = 0, legal = 0;
    const origAlpha = alpha;
    for (let i = 0; i < n; i++) {
      const m = buf.m[i];
      if (!this.make(m)) { this.unmake(m); continue; }
      legal++;
      const sc = -this.negamax(depth - 1, -beta, -alpha, ply + 1);
      this.unmake(m);
      if (this.aborted) return 0;
      if (sc > best) {
        best = sc; bestMove = m;
        if (sc > alpha) {
          alpha = sc;
          if (alpha >= beta) {
            if (!this.b[mTo(m)] && this.killers[ply][0] !== m) { this.killers[ply][1] = this.killers[ply][0]; this.killers[ply][0] = m; }
            break;
          }
        }
      }
    }
    if (legal === 0) return inChk ? -MATE + ply : 0; // hết nước đi: bị chiếu = thua, không thì hòa
    let flag = 0;
    if (best <= origAlpha) flag = 2; else if (best >= beta) flag = 1;
    let store = best;
    if (store > MATE - 100) store += ply; else if (store < -MATE + 100) store -= ply;
    this.ttKey[idx] = this.h2;
    this.ttData[idx * 2] = (bestMove & 0x3fffff) | (Math.min(depth, 60) << 22);
    this.ttData[idx * 2 + 1] = (store << 2) | flag;
    return best;
  }

  rootScores(depth, moves) {
    const out = [];
    for (const m of moves) {
      this.make(m);
      const sc = -this.negamax(depth - 1, -INF, INF, 1);
      this.unmake(m);
      if (this.aborted) return null;
      out.push({ m, score: sc });
    }
    return out;
  }

  think(levelKey, opts = {}) {
    const lv = LEVELS[levelKey] || LEVELS.vua;
    const rand = opts.random || Math.random;
    const plies = opts.plies || 0;
    const moves = this.legalRootMoves();
    if (moves.length === 0) return null;
    this.nodes = 0;
    this.aborted = false;
    this.deadline = this.clock() + (opts.timeMs ?? lv.timeMs);
    const done = (m, score, depth) => ({ from: mFrom(m), to: mTo(m), promo: PROMO_CHAR[mPromo(m)] || undefined, score, depth, nodes: this.nodes });
    if (moves.length === 1) return done(moves[0], 0, 0);

    const pickNoisy = (depth, noise, window) => {
      let sc = this.rootScores(depth, moves);
      if (!sc) return null;
      if (noise > 0) sc = sc.map((x) => ({ m: x.m, score: x.score + (rand() * 2 - 1) * noise }));
      sc.sort((a, b) => b.score - a.score);
      if (window > 0) {
        const pool = sc.filter((x) => x.score >= sc[0].score - window);
        const pick = pool[Math.floor(rand() * pool.length)];
        return done(pick.m, pick.score, depth);
      }
      return done(sc[0].m, sc[0].score, depth);
    };

    if (levelKey === 'de') {
      if (rand() < lv.blunder) {
        const sc = this.rootScores(1, moves);
        if (sc) {
          sc.sort((a, b) => b.score - a.score);
          const top = sc.slice(0, Math.max(3, Math.ceil(sc.length / 3)));
          const pick = top[Math.floor(rand() * top.length)];
          return done(pick.m, pick.score, 1);
        }
      }
      this.deadline = this.clock() + lv.timeMs;
      const r = pickNoisy(lv.maxDepth, lv.noise, 0);
      if (r) return r;
      return done(moves[Math.floor(rand() * moves.length)], 0, 0);
    }
    if (levelKey === 'kho' && plies < lv.opening) {
      const r = pickNoisy(3, 0, 20);
      if (r) return r;
    }
    let best = moves[0], bestScore = 0, reached = 0;
    for (let d = 1; d <= lv.maxDepth; d++) {
      let alpha = -INF, curBest = 0, curScore = -INF;
      const order = moves.slice().sort((a, b) => (a === best ? -1 : b === best ? 1 : 0));
      let firstDone = false;
      for (const m of order) {
        this.make(m);
        const sc = -this.negamax(d - 1, -INF, -alpha, 1);
        this.unmake(m);
        if (this.aborted) break;
        firstDone = true;
        if (sc > curScore) { curScore = sc; curBest = m; if (sc > alpha) alpha = sc; }
      }
      if (this.aborted) {
        if (d > 1 && firstDone && curBest && curScore >= bestScore - 30) { best = curBest; bestScore = curScore; }
        break;
      }
      best = curBest; bestScore = curScore; reached = d;
      if (Math.abs(bestScore) > MATE - 100) break;
      if (this.clock() > this.deadline) break;
    }
    return done(best, bestScore, reached);
  }

  // Tìm mã nước theo (từ, đến, quân phong) trong danh sách nước hợp lệ.
  findMove(from, to, promoChar) {
    const pr = promoChar ? PROMO_CHAR.indexOf(promoChar) : 0;
    for (const m of this.legalRootMoves()) if (mFrom(m) === from && mTo(m) === to && mPromo(m) === pr) return m;
    return 0;
  }
}

// state theo chess.js (có history). Phát lại ván từ thế ban đầu để máy biết các thế đã lặp.
export function chooseMove(state, levelKey, opts = {}) {
  const eng = opts.engine || new Engine();
  const hist = state.history || [];
  if (hist.length === 0) {
    eng.setFen(toFen(state));
  } else {
    eng.setFen(INITIAL_FEN);
    let ok = true;
    for (const h of hist) {
      const m = eng.findMove(h.from, h.to, h.promo || '');
      if (!m || !eng.make(m)) { ok = false; break; }
    }
    if (!ok) eng.setFen(toFen(state));
  }
  return eng.think(levelKey, { ...opts, plies: hist.length });
}
