import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, fromUCI, sq } from '../public/shared/chess.js';
import { newRoomData, join, roleOf, snapshot, handle } from '../worker/room-logic.js';

const A = 'aaaaaaaa1';
const B = 'bbbbbbbb2';
const C = 'cccccccc3';

function twoPlayers(wantA = 'w') {
  const d = newRoomData();
  join(d, A, wantA);
  join(d, B, 'any');
  return d;
}

const move = (d, role, iccs) => handle(d, role, { t: 'move', ...fromUCI(iccs) });

test('Xếp chỗ: người đầu chọn bên, người sau nhận bên còn lại, người thứ ba là khán giả', () => {
  const d = newRoomData();
  assert.equal(join(d, A, 'b'), 'b');
  assert.equal(join(d, B, 'any'), 'w');
  assert.equal(join(d, C, 'any'), 'spectator');
});

test('Xếp chỗ: chọn ngẫu nhiên dùng bộ ngẫu nhiên được truyền vào', () => {
  assert.equal(join(newRoomData(), A, 'any', { rand: () => 0.1 }), 'w');
  assert.equal(join(newRoomData(), A, 'any', { rand: () => 0.9 }), 'b');
});

test('Vào lại cùng id thì giữ nguyên chỗ', () => {
  const d = twoPlayers();
  assert.equal(join(d, A, 'b'), 'w');
  assert.equal(join(d, B, 'w'), 'b');
});

test('Mở bằng tab mới: lấy lại chỗ qua id cũ nếu id cũ không còn kết nối', () => {
  const d = twoPlayers();
  assert.equal(join(d, C, 'any', { prev: A, connected: new Set([B]) }), 'w');
  assert.equal(roleOf(d, A), 'spectator');
  assert.equal(roleOf(d, C), 'w');
});

test('Mở thêm tab trong lúc id cũ còn online thì không cướp chỗ', () => {
  const d = newRoomData();
  join(d, A, 'w');
  assert.equal(join(d, C, 'any', { prev: A, connected: new Set([A]) }), 'b');
  assert.equal(roleOf(d, A), 'w');
});

test('id cũ không có chỗ thì không được lấy chỗ của người khác', () => {
  const d = twoPlayers();
  assert.equal(join(d, C, 'any', { prev: 'zzzzzzzz9', connected: new Set() }), 'spectator');
});

test('Chưa đủ hai người thì chưa được đi', () => {
  const d = newRoomData();
  join(d, A, 'w');
  assert.equal(move(d, 'w', 'e2e4').error, 'waiting');
});

test('Đi nước hợp lệ: đổi lượt, phát tin cho cả phòng, ghi lịch sử', () => {
  const d = twoPlayers();
  const r = move(d, 'w', 'e2e4');
  assert.equal(r.error, null);
  assert.equal(r.changed, true);
  assert.equal(r.events.length, 1);
  assert.deepEqual(r.events[0], {
    t: 'move', n: 1, from: sq(6, 4), to: sq(4, 4), promo: null, turn: 'b', over: null,
  });
  assert.equal(d.game.turn, 'b');
  assert.equal(snapshot(d, 'w', { w: true, b: true }).moves[0], 'e2e4');
});

test('Sai lượt, khán giả, nước sai luật, dữ liệu rác đều bị từ chối', () => {
  const d = twoPlayers();
  assert.equal(move(d, 'b', 'e7e5').error, 'not_your_turn');
  join(d, C, 'any');
  assert.equal(handle(d, 'spectator', { t: 'move', from: 0, to: 1 }).error, 'spectator');

  const bad = move(d, 'w', 'a1a5'); // xe Trắng ở a1, bị tốt chặn
  assert.equal(bad.error, 'illegal');
  assert.equal(bad.resync, true);

  assert.equal(handle(d, 'w', { t: 'move', from: -1, to: 5 }).error, 'bad_move');
  assert.equal(handle(d, 'w', { t: 'move', from: 'a', to: 5 }).error, 'bad_move');
  assert.equal(handle(d, 'w', { t: 'move', from: 3.5, to: 5 }).error, 'bad_move');
  assert.equal(handle(d, 'w', { t: 'xyz' }).error, 'unknown');
  assert.equal(d.game.history.length, 0, 'không có nước nào bị ghi nhầm');
});

test('Chiếu bí: server ghi kết quả và báo cho cả phòng', () => {
  const d = twoPlayers();
  d.game = createGame('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
  const r = move(d, 'w', 'a1a8');
  assert.deepEqual(d.over, { winner: 'w', reason: 'checkmate' });
  assert.deepEqual(r.events[0].over, { winner: 'w', reason: 'checkmate' });
  assert.equal(move(d, 'b', 'g8h8').error, 'game_over');
});

test('Xin thua', () => {
  const d = twoPlayers();
  const r = handle(d, 'b', { t: 'resign' });
  assert.deepEqual(d.over, { winner: 'w', reason: 'resign' });
  assert.deepEqual(r.events[0], { t: 'over', over: d.over });
  assert.equal(handle(d, 'b', { t: 'resign' }).error, 'game_over');
});

test('Xin hòa: đồng ý, từ chối, tự hết hiệu lực khi có nước đi', () => {
  const d = twoPlayers();
  assert.deepEqual(handle(d, 'w', { t: 'draw_offer' }).events, [{ t: 'draw_offer', by: 'w' }]);
  assert.equal(handle(d, 'w', { t: 'draw_accept' }).error, 'no_offer', 'không tự đồng ý lời xin của mình');

  assert.deepEqual(handle(d, 'b', { t: 'draw_decline' }).events, [{ t: 'draw_declined' }]);
  assert.equal(d.drawOffer, null);

  handle(d, 'w', { t: 'draw_offer' });
  move(d, 'w', 'e2e4');
  assert.equal(d.drawOffer, null, 'đi một nước thì lời xin hòa hết hiệu lực');

  handle(d, 'b', { t: 'draw_offer' });
  const acc = handle(d, 'w', { t: 'draw_accept' });
  assert.deepEqual(d.over, { winner: null, reason: 'draw-agreed' });
  assert.equal(acc.events[0].t, 'over');
});

test('Hai bên cùng xin hòa thì hòa luôn', () => {
  const d = twoPlayers();
  handle(d, 'w', { t: 'draw_offer' });
  handle(d, 'b', { t: 'draw_offer' });
  assert.deepEqual(d.over, { winner: null, reason: 'draw-agreed' });
});

test('Chơi lại: cần cả hai đồng ý, rồi đổi bên', () => {
  const d = twoPlayers();
  assert.equal(handle(d, 'w', { t: 'rematch' }).error, 'not_over');
  handle(d, 'b', { t: 'resign' });

  const first = handle(d, 'w', { t: 'rematch' });
  assert.equal(first.events[0].t, 'rematch');
  assert.ok(d.over, 'chưa đủ hai bên thì chưa chơi lại');

  const second = handle(d, 'b', { t: 'rematch' });
  assert.deepEqual(second.events, [{ t: 'snapshot' }]);
  assert.equal(d.over, null);
  assert.equal(d.gameNo, 2);
  assert.equal(roleOf(d, A), 'b');
  assert.equal(roleOf(d, B), 'w');
  assert.equal(d.game.history.length, 0);
});

test('Dữ liệu phòng sống sót qua JSON (như khi lưu vào storage rồi đọc lại)', () => {
  const d = twoPlayers();
  move(d, 'w', 'e2e4');
  move(d, 'b', 'e7e5');
  const copy = JSON.parse(JSON.stringify(d));
  assert.equal(move(copy, 'w', 'g1f3').error, null);
  assert.equal(copy.game.history.length, 3);
  assert.equal(copy.game.turn, 'b');
});
