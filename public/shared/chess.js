// Luật cờ vua dùng chung cho trình duyệt và máy chủ. Không phụ thuộc DOM.
//
// Bàn 64 ô, chỉ số = hàng * 8 + cột. Hàng 0 là hàng 8 (phía quân Đen, xa), hàng 7 là hàng 1 (phía quân Trắng, gần).
// Chữ hoa = Trắng, chữ thường = Đen, '.' = trống. Lượt: 'w' | 'b'.
// Nước đi: { from, to, promo? } với promo là 'q' | 'r' | 'b' | 'n' (chữ thường).

export const ROWS = 8;
export const COLS = 8;
export const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export const sq = (r, c) => r * 8 + c;
export const rowOf = (i) => i >> 3;
export const colOf = (i) => i & 7;
export const sideOf = (ch) => (ch === '.' ? null : ch === ch.toUpperCase() ? 'w' : 'b');
export const opponent = (s) => (s === 'w' ? 'b' : 'w');

const FILES = 'abcdefgh';
export const squareName = (i) => FILES[colOf(i)] + (8 - rowOf(i));
export const squareFromName = (n) => sq(8 - Number(n[1]), FILES.indexOf(n[0]));

export const toUCI = (m) => squareName(m.from) + squareName(m.to) + (m.promo || '');
export function fromUCI(str) {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(str)) return null;
  const m = { from: squareFromName(str.slice(0, 2)), to: squareFromName(str.slice(2, 4)) };
  if (str[4]) m.promo = str[4];
  return m;
}

export function parseFen(fen) {
  const parts = String(fen).trim().split(/\s+/);
  if (parts.length < 2) throw new Error('FEN không hợp lệ');
  const rows = parts[0].split('/');
  if (rows.length !== 8) throw new Error('FEN không hợp lệ');
  const board = [];
  for (const row of rows) {
    let n = 0;
    for (const ch of row) {
      if (/[1-8]/.test(ch)) {
        for (let k = 0; k < Number(ch); k++) board.push('.');
        n += Number(ch);
      } else if ('pnbrqkPNBRQK'.includes(ch)) {
        board.push(ch);
        n++;
      } else throw new Error('FEN không hợp lệ');
    }
    if (n !== 8) throw new Error('FEN không hợp lệ');
  }
  const turn = parts[1] === 'b' ? 'b' : 'w';
  const castling = parts[2] && parts[2] !== '-' ? parts[2] : '';
  const ep = parts[3] && parts[3] !== '-' ? squareFromName(parts[3]) : -1;
  return { board, turn, castling, ep, halfmove: Number(parts[4]) || 0, fullmove: Number(parts[5]) || 1 };
}

export function toFen(state) {
  const rows = [];
  for (let r = 0; r < 8; r++) {
    let s = '';
    let empty = 0;
    for (let c = 0; c < 8; c++) {
      const ch = state.board[r * 8 + c];
      if (ch === '.') empty++;
      else {
        if (empty) s += empty;
        empty = 0;
        s += ch;
      }
    }
    if (empty) s += empty;
    rows.push(s);
  }
  return `${rows.join('/')} ${state.turn} ${state.castling || '-'} ${state.ep >= 0 ? squareName(state.ep) : '-'} ${state.halfmove} ${state.fullmove}`;
}

const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];

// Ô (r,c) có bị bên `by` tấn công không.
export function isAttacked(board, r, c, by) {
  const up = by === 'w'; // quân trắng tiến lên = hàng giảm
  const pawn = up ? 'P' : 'p';
  const pr = r + (up ? 1 : -1);
  if (pr >= 0 && pr < 8) {
    if (c > 0 && board[pr * 8 + c - 1] === pawn) return true;
    if (c < 7 && board[pr * 8 + c + 1] === pawn) return true;
  }
  const kn = up ? 'N' : 'n';
  for (const [dr, dc] of KNIGHT) {
    const nr = r + dr, nc = c + dc;
    if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && board[nr * 8 + nc] === kn) return true;
  }
  const kg = up ? 'K' : 'k';
  for (const [dr, dc] of KING) {
    const nr = r + dr, nc = c + dc;
    if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && board[nr * 8 + nc] === kg) return true;
  }
  const R = up ? 'R' : 'r', B = up ? 'B' : 'b', Q = up ? 'Q' : 'q';
  for (const [dr, dc] of ORTHO) {
    let nr = r + dr, nc = c + dc;
    while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
      const p = board[nr * 8 + nc];
      if (p !== '.') {
        if (p === R || p === Q) return true;
        break;
      }
      nr += dr; nc += dc;
    }
  }
  for (const [dr, dc] of DIAG) {
    let nr = r + dr, nc = c + dc;
    while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
      const p = board[nr * 8 + nc];
      if (p !== '.') {
        if (p === B || p === Q) return true;
        break;
      }
      nr += dr; nc += dc;
    }
  }
  return false;
}

export function isInCheck(state, side) {
  const k = side === 'w' ? 'K' : 'k';
  const i = state.board.indexOf(k);
  if (i < 0) return false;
  return isAttacked(state.board, rowOf(i), colOf(i), opponent(side));
}

function pseudoMoves(state) {
  const { board, turn } = state;
  const moves = [];
  const white = turn === 'w';
  for (let i = 0; i < 64; i++) {
    const p = board[i];
    if (p === '.' || sideOf(p) !== turn) continue;
    const r = rowOf(i), c = colOf(i);
    const t = p.toLowerCase();
    const push = (to, promo) => moves.push(promo ? { from: i, to, promo } : { from: i, to });
    if (t === 'p') {
      const dir = white ? -1 : 1;
      const startRow = white ? 6 : 1;
      const lastRow = white ? 0 : 7;
      const addP = (to) => {
        if (rowOf(to) === lastRow) for (const pr of ['q', 'r', 'b', 'n']) push(to, pr);
        else push(to);
      };
      const r1 = r + dir;
      if (r1 >= 0 && r1 < 8 && board[r1 * 8 + c] === '.') {
        addP(r1 * 8 + c);
        if (r === startRow && board[(r + 2 * dir) * 8 + c] === '.') push((r + 2 * dir) * 8 + c);
      }
      for (const dc of [-1, 1]) {
        const nc = c + dc;
        if (nc < 0 || nc > 7 || r1 < 0 || r1 > 7) continue;
        const to = r1 * 8 + nc;
        const target = board[to];
        if (target !== '.' && sideOf(target) !== turn) addP(to);
        else if (to === state.ep && target === '.') push(to);
      }
    } else if (t === 'n' || t === 'k') {
      for (const [dr, dc] of t === 'n' ? KNIGHT : KING) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr > 7 || nc < 0 || nc > 7) continue;
        const target = board[nr * 8 + nc];
        if (target === '.' || sideOf(target) !== turn) push(nr * 8 + nc);
      }
      if (t === 'k') {
        const row = white ? 7 : 0;
        if (i === row * 8 + 4 && !isAttacked(board, r, c, opponent(turn))) {
          const rook = white ? 'R' : 'r';
          const ks = white ? 'K' : 'k';
          const qs = white ? 'Q' : 'q';
          if (state.castling.includes(ks) && board[row * 8 + 7] === rook && board[row * 8 + 5] === '.' && board[row * 8 + 6] === '.'
            && !isAttacked(board, row, 5, opponent(turn)) && !isAttacked(board, row, 6, opponent(turn))) push(row * 8 + 6);
          if (state.castling.includes(qs) && board[row * 8] === rook && board[row * 8 + 1] === '.' && board[row * 8 + 2] === '.' && board[row * 8 + 3] === '.'
            && !isAttacked(board, row, 3, opponent(turn)) && !isAttacked(board, row, 2, opponent(turn))) push(row * 8 + 2);
        }
      }
    } else {
      const dirs = t === 'b' ? DIAG : t === 'r' ? ORTHO : [...DIAG, ...ORTHO];
      for (const [dr, dc] of dirs) {
        let nr = r + dr, nc = c + dc;
        while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
          const target = board[nr * 8 + nc];
          if (target === '.') push(nr * 8 + nc);
          else {
            if (sideOf(target) !== turn) push(nr * 8 + nc);
            break;
          }
          nr += dr; nc += dc;
        }
      }
    }
  }
  return moves;
}

// Đi nước trên bảng sao chép, không kiểm tra luật. Trả về { board, castling, ep, captured, ... }.
function rawApply(state, m) {
  const board = state.board.slice();
  const piece = board[m.from];
  const t = piece.toLowerCase();
  const white = piece === piece.toUpperCase();
  let captured = board[m.to];
  let ep = -1;
  let castling = state.castling;
  board[m.from] = '.';
  if (t === 'p') {
    if (m.to === state.ep && captured === '.' && colOf(m.from) !== colOf(m.to)) {
      const capSq = rowOf(m.from) * 8 + colOf(m.to);
      captured = board[capSq];
      board[capSq] = '.';
    }
    if (Math.abs(rowOf(m.to) - rowOf(m.from)) === 2) ep = (rowOf(m.from) + rowOf(m.to)) / 2 * 8 + colOf(m.from);
  }
  board[m.to] = m.promo ? (white ? m.promo.toUpperCase() : m.promo) : piece;
  if (t === 'k') {
    castling = castling.replace(white ? /[KQ]/g : /[kq]/g, '');
    if (Math.abs(colOf(m.to) - colOf(m.from)) === 2) {
      const row = rowOf(m.from);
      if (colOf(m.to) === 6) { board[row * 8 + 5] = board[row * 8 + 7]; board[row * 8 + 7] = '.'; }
      else { board[row * 8 + 3] = board[row * 8]; board[row * 8] = '.'; }
    }
  }
  const touch = (i, flag) => { if (m.from === i || m.to === i) castling = castling.replace(flag, ''); };
  touch(63, 'K'); touch(56, 'Q'); touch(7, 'k'); touch(0, 'q'); touch(60, /[KQ]/g); touch(4, /[kq]/g);
  return { board, castling, ep, captured: captured === '.' ? null : captured, piece };
}

function legalFor(state) {
  const out = [];
  for (const m of pseudoMoves(state)) {
    const r = rawApply(state, m);
    const k = state.turn === 'w' ? 'K' : 'k';
    const ki = r.board.indexOf(k);
    if (!isAttacked(r.board, rowOf(ki), colOf(ki), opponent(state.turn))) out.push(m);
  }
  return out;
}

export const legalMoves = (state) => legalFor(state);

function epCapturePossible(board, ep, turn) {
  if (ep < 0) return false;
  const r = rowOf(ep), c = colOf(ep);
  const pawn = turn === 'w' ? 'P' : 'p';
  const pr = turn === 'w' ? r + 1 : r - 1;
  return (c > 0 && board[pr * 8 + c - 1] === pawn) || (c < 7 && board[pr * 8 + c + 1] === pawn);
}

export function positionKey(board, turn, castling, ep) {
  return `${board.join('')} ${turn} ${castling} ${epCapturePossible(board, ep, turn) ? ep : '-'}`;
}

export function createGame(fen = INITIAL_FEN) {
  const p = parseFen(fen);
  const state = { board: p.board, turn: p.turn, castling: p.castling, ep: p.ep, halfmove: p.halfmove, fullmove: p.fullmove, history: [], posCounts: {} };
  state.posCounts[positionKey(state.board, state.turn, state.castling, state.ep)] = 1;
  return state;
}

export function applyMove(state, move) {
  const legal = legalFor(state).find((m) => m.from === move.from && m.to === move.to && (m.promo || '') === (move.promo || ''));
  if (!legal) throw new Error('Nước đi không hợp lệ');
  const r = rawApply(state, legal);
  const turn = opponent(state.turn);
  const reset = r.captured || r.piece.toLowerCase() === 'p';
  const next = {
    board: r.board,
    turn,
    castling: r.castling,
    ep: r.ep,
    halfmove: reset ? 0 : state.halfmove + 1,
    fullmove: state.fullmove + (state.turn === 'b' ? 1 : 0),
    history: [],
    posCounts: { ...state.posCounts },
  };
  const key = positionKey(next.board, turn, next.castling, next.ep);
  next.posCounts[key] = (next.posCounts[key] || 0) + 1;
  const castle = r.piece.toLowerCase() === 'k' && Math.abs(colOf(legal.to) - colOf(legal.from)) === 2;
  next.history = state.history.concat({
    from: legal.from,
    to: legal.to,
    piece: r.piece,
    captured: r.captured,
    promo: legal.promo || null,
    castle,
    ep: r.piece.toLowerCase() === 'p' && legal.to === state.ep && colOf(legal.from) !== colOf(legal.to),
    uci: toUCI(legal),
    gaveCheck: isInCheck(next, turn),
    key,
  });
  return next;
}

function insufficientMaterial(board) {
  const minors = [];
  for (let i = 0; i < 64; i++) {
    const p = board[i];
    if (p === '.' || p.toLowerCase() === 'k') continue;
    const t = p.toLowerCase();
    if (t === 'p' || t === 'r' || t === 'q') return false;
    minors.push({ t, light: (rowOf(i) + colOf(i)) % 2 });
  }
  if (minors.length <= 1) return true;
  if (minors.every((m) => m.t === 'b') && minors.every((m) => m.light === minors[0].light)) return true;
  return false;
}

// { over: false } hoặc { over: true, winner: 'w'|'b'|null, reason }
export function getResult(state) {
  if (!legalFor(state).length) {
    if (isInCheck(state, state.turn)) return { over: true, winner: opponent(state.turn), reason: 'checkmate' };
    return { over: true, winner: null, reason: 'stalemate' };
  }
  if (insufficientMaterial(state.board)) return { over: true, winner: null, reason: 'insufficient' };
  const key = positionKey(state.board, state.turn, state.castling, state.ep);
  if ((state.posCounts[key] || 0) >= 3) return { over: true, winner: null, reason: 'repetition' };
  if (state.halfmove >= 100) return { over: true, winner: null, reason: 'fifty-move' };
  return { over: false };
}

// Ký hiệu đại số (SAN) của một nước đi, tính trên trạng thái TRƯỚC khi đi.
export function toSAN(state, move) {
  const piece = state.board[move.from];
  const t = piece.toLowerCase();
  const legal = legalFor(state);
  const next = applyMove(state, move);
  const suffix = getResult(next).reason === 'checkmate' ? '#' : isInCheck(next, next.turn) ? '+' : '';
  if (t === 'k' && Math.abs(colOf(move.to) - colOf(move.from)) === 2) return (colOf(move.to) === 6 ? 'O-O' : 'O-O-O') + suffix;
  const capture = state.board[move.to] !== '.' || (t === 'p' && colOf(move.from) !== colOf(move.to));
  let s = '';
  if (t === 'p') {
    if (capture) s += FILES[colOf(move.from)];
  } else {
    s += piece.toUpperCase();
    const others = legal.filter((m) => m.to === move.to && m.from !== move.from && state.board[m.from] === piece);
    if (others.length) {
      const sameFile = others.some((m) => colOf(m.from) === colOf(move.from));
      const sameRow = others.some((m) => rowOf(m.from) === rowOf(move.from));
      if (!sameFile) s += FILES[colOf(move.from)];
      else if (!sameRow) s += 8 - rowOf(move.from);
      else s += squareName(move.from);
    }
  }
  if (capture) s += 'x';
  s += squareName(move.to);
  if (move.promo) s += '=' + move.promo.toUpperCase();
  return s + suffix;
}
