// Chọn chế độ hiển thị: 3D nếu thiết bị chạy được, nếu không thì rơi về 2D nhìn từ trên.
// createBestView(container, prefer2d) -> { view, reason }
//   reason: 'chosen' (người chơi chọn 2D), 'no-webgl', 'error' (không tải được 3D), hoặc null (đang 3D).

const LOAD_TIMEOUT = 9000;

export function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl'));
  } catch (_) {
    return false;
  }
}

function clearCanvases(container) {
  for (const c of Array.from(container.querySelectorAll('canvas'))) c.remove();
}

async function make2d(container) {
  const m = await import('./board2d.js');
  return m.createView(container);
}

export async function createBestView(container, prefer2d = false) {
  if (prefer2d) return { view: await make2d(container), reason: 'chosen' };
  if (!hasWebGL()) return { view: await make2d(container), reason: 'no-webgl' };
  try {
    const mod = await Promise.race([
      import('./board3d.js'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), LOAD_TIMEOUT)),
    ]);
    return { view: mod.createView(container), reason: null };
  } catch (err) {
    console.warn('Không dùng được 3D, chuyển sang 2D:', err && err.message);
    clearCanvases(container);
    return { view: await make2d(container), reason: 'error' };
  }
}
