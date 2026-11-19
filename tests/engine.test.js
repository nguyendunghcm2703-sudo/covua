import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, legalMoves, applyMove, getResult, fromUCI, toUCI, parseFen, toFen } from '../public/shared/chess.js';
import { Engine, chooseMove } from '../public/shared/engine.js';

function seeded(seed) { let s = seed; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function perftEng(e, d) {
  const moves = e.legalRootMoves(); // dùng gen ply 0 mỗi lần: gọi đệ quy bằng make/unmake
  if (d === 1) return moves.length;
  let n = 0;
  for (const m of moves) { e.make(m); n += perftEng(e, d - 1); e.unmake(m); }
  return n;
}

test('perft máy đánh khớp số chuẩn', () => {
  const e = new Engine();
  e.setFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  assert.equal(perftEng(e, 3), 8902);
  e.setFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
  assert.equal(perftEng(e, 3), 97862);
  e.setFen('r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1');
  assert.equal(perftEng(e, 3), 9467);
});

test('nước đi của máy khớp luật chuẩn trên nhiều thế ngẫu nhiên', () => {
  const rand = seeded(11);
  const eng = new Engine();
  let checked = 0;
  for (let g = 0; g < 40; g++) {
    let st = createGame();
    for (let ply = 0; ply < 100; ply++) {
      if (getResult(st).over) break;
      const ref = legalMoves(st).map((m) => `${m.from}-${m.to}-${m.promo || ''}`).sort();
      eng.setFen(toFen(st));
      const mine = eng.legalRootMoves().map((m) => `${m & 63}-${(m >> 6) & 63}-${['', '', 'n', 'b', 'r', 'q'][(m >> 12) & 15] || ''}`).sort();
      assert.deepEqual(mine, ref, `lệch ở ván ${g} nước ${ply}`);
      checked++;
      const mv = legalMoves(st);
      st = applyMove(st, mv[Math.floor(rand() * mv.length)]);
    }
  }
  assert.ok(checked > 1500);
});

test('máy tìm chiếu hết trong 1 nước và tránh để bị chiếu hết', () => {
  const st = createGame('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
  const mv = chooseMove(st, 'kho', { timeMs: 1500 });
  assert.equal(toUCI(mv), 'a1a8');
  const after = applyMove(st, mv);
  assert.equal(getResult(after).reason, 'checkmate');
});

test('máy luôn trả nước hợp lệ ở cả ba cấp (kể cả phong cấp)', () => {
  for (const lv of ['de', 'vua', 'kho']) {
    let st = createGame();
    for (let i = 0; i < 8; i++) {
      const mv = chooseMove(st, lv, { timeMs: 200 });
      assert.ok(legalMoves(st).some((m) => m.from === mv.from && m.to === mv.to && (m.promo || '') === (mv.promo || '')), lv);
      st = applyMove(st, mv);
    }
  }
  const promo = createGame('8/P6k/8/8/8/8/8/K7 w - - 0 1');
  const mv = chooseMove(promo, 'vua', { timeMs: 300 });
  assert.equal(mv.promo, 'q');
});
