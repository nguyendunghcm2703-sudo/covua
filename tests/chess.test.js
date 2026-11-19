import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, legalMoves, applyMove, getResult, toSAN, toFen, fromUCI } from '../public/shared/chess.js';

function perft(state, depth) {
  const moves = legalMoves(state);
  if (depth === 1) return moves.length;
  let n = 0;
  for (const m of moves) n += perft(applyMove(state, m), depth - 1);
  return n;
}

test('perft thế ban đầu', () => {
  const g = createGame();
  assert.equal(perft(g, 1), 20);
  assert.equal(perft(g, 2), 400);
  assert.equal(perft(g, 3), 8902);
});

test('perft Kiwipete (nhập thành, bắt tốt qua đường, phong cấp)', () => {
  const g = createGame('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
  assert.equal(perft(g, 1), 48);
  assert.equal(perft(g, 2), 2039);
  assert.equal(perft(g, 3), 97862);
});

test('perft vị trí 3 và 4', () => {
  const p3 = createGame('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1');
  assert.equal(perft(p3, 4), 43238);
  const p4 = createGame('r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1');
  assert.equal(perft(p4, 3), 9467);
});

test('chiếu hết kiểu Fool\'s mate', () => {
  let g = createGame();
  for (const u of ['f2f3', 'e7e5', 'g2g4', 'd8h4']) g = applyMove(g, fromUCI(u));
  const r = getResult(g);
  assert.equal(r.reason, 'checkmate');
  assert.equal(r.winner, 'b');
});

test('hết nước đi nhưng không bị chiếu là hòa', () => {
  const g = createGame('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  assert.equal(getResult(g).reason, 'stalemate');
});

test('không đủ quân để chiếu hết', () => {
  assert.equal(getResult(createGame('8/8/8/4k3/8/8/3K4/8 w - - 0 1')).reason, 'insufficient');
  assert.equal(getResult(createGame('8/8/8/4k3/8/8/3KB3/8 w - - 0 1')).reason, 'insufficient');
  assert.equal(getResult(createGame('8/8/8/4k3/8/8/3KR3/8 w - - 0 1')).over, false);
});

test('lặp thế 3 lần là hòa; 50 nước không ăn quân là hòa', () => {
  let g = createGame();
  for (const u of ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8']) g = applyMove(g, fromUCI(u));
  assert.equal(getResult(g).reason, 'repetition');
  assert.equal(getResult(createGame('8/8/8/4k3/8/8/3KR3/8 w - - 100 80')).reason, 'fifty-move');
});

test('phong cấp, bắt tốt qua đường, nhập thành đúng', () => {
  let g = createGame('4k3/P7/8/8/8/8/8/4K2R w K - 0 1');
  g = applyMove(g, fromUCI('a7a8q'));
  assert.equal(g.board[0], 'Q');
  g = createGame('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
  g = applyMove(g, fromUCI('e5d6'));
  assert.equal(g.board[3 * 8 + 3], '.'); // tốt đen bị bắt
  assert.equal(g.history[0].captured, 'p');
  g = createGame('4k3/8/8/8/8/8/8/4K2R w K - 0 1');
  g = applyMove(g, fromUCI('e1g1'));
  assert.equal(g.board[63 - 1], 'K');
  assert.equal(g.board[63 - 2], 'R');
  assert.throws(() => applyMove(createGame(), fromUCI('e2e5')));
});

test('SAN', () => {
  const g = createGame();
  assert.equal(toSAN(g, fromUCI('e2e4')), 'e4');
  assert.equal(toSAN(g, fromUCI('g1f3')), 'Nf3');
  assert.match(toFen(createGame()), /^rnbqkbnr/);
});
