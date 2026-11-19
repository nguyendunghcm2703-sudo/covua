// Build cho Cloudflare: gộp và nén JS của trang, làm rối (obfuscate) ở mức vừa, ghi ra dist/.
//   npm run build            gộp + nén + làm rối (dùng cho Cloudflare)
//   npm run build:plain      chỉ sao chép public/ sang dist/, không đụng vào mã (dùng khi phát triển)
//   node build.mjs --no-obfuscate   gộp + nén nhưng không làm rối
// Mã Worker (worker/) do wrangler tự đóng gói, không nằm trong bước này.

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const args = new Set(process.argv.slice(2));
const plain = args.has('--plain');
const noObf = args.has('--no-obfuscate');

const SRC = 'public';
const OUT = 'dist';

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// 1. Sao chép file tĩnh. Ở chế độ đầy đủ thì bỏ JS của client/shared vì sẽ được gộp lại.
const skipJs = (p) => {
  if (plain) return false;
  const rel = path.relative(SRC, p).split(path.sep);
  return (rel[0] === 'client' || rel[0] === 'shared') && p.endsWith('.js');
};
fs.cpSync(SRC, OUT, {
  recursive: true,
  filter: (p) => !skipJs(p),
});
if (!plain && fs.existsSync(path.join(OUT, 'shared'))) {
  fs.rmSync(path.join(OUT, 'shared'), { recursive: true, force: true });
}

// 2. Đổi tên cache của service worker theo mỗi lần build để máy người chơi nhận bản mới.
const swPath = path.join(OUT, 'sw.js');
if (fs.existsSync(swPath)) {
  const stamp = Date.now().toString(36);
  fs.writeFileSync(swPath, fs.readFileSync(swPath, 'utf8').replace(/covua3d-v\d+/, `covua3d-${stamp}`));
}

if (plain) {
  console.log('build:plain xong, không gộp và không làm rối.');
  process.exit(0);
}

// 3. Gộp bằng esbuild. Three.js để nguyên (tải từ CDN qua importmap trong index.html).
await build({
  entryPoints: [path.join(SRC, 'client/main.js')],
  outdir: path.join(OUT, 'client'),
  bundle: true,
  splitting: true, // board3d.js và board2d.js tải theo nhu cầu
  format: 'esm',
  target: 'es2020',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  external: ['three', 'three/addons/*'],
  chunkNames: 'c-[hash]',
  logLevel: 'info',
});

// 3b. Máy đánh cờ chạy trong Web Worker: gộp riêng thành client/ai-worker.js.
await build({
  entryPoints: [path.join(SRC, 'client/ai-worker.js')],
  outdir: path.join(OUT, 'client'),
  bundle: true,
  format: 'esm',
  target: 'es2020',
  minify: true,
  legalComments: 'none',
  logLevel: 'info',
});

// 4. Làm rối ở mức vừa.
if (noObf) {
  console.log('Bỏ qua bước làm rối (--no-obfuscate).');
} else {
  let JavaScriptObfuscator;
  try {
    ({ default: JavaScriptObfuscator } = await import('javascript-obfuscator'));
  } catch (e) {
    console.error('Thiếu gói javascript-obfuscator. Chạy "npm install" trước, hoặc dùng "node build.mjs --no-obfuscate".');
    process.exit(1);
  }
  const options = {
    sourceType: 'module',
    compact: true,
    simplify: true,
    identifierNamesGenerator: 'hexadecimal',
    renameGlobals: false,
    renameProperties: false, // giữ tên thuộc tính để không làm hỏng giao thức và API trình duyệt
    stringArray: true,
    stringArrayEncoding: ['base64'],
    stringArrayThreshold: 0.75,
    rotateStringArray: true,
    shuffleStringArray: true,
    stringArrayWrappersCount: 1,
    splitStrings: false,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.15,
    controlFlowFlattening: false, // nặng và làm chậm game
    selfDefending: false,
    debugProtection: false,
    disableConsoleOutput: false,
    transformObjectKeys: false,
    unicodeEscapeSequence: false,
    reservedStrings: ['^\\./', '^three', '^/'], // đường dẫn import không được đổi
    target: 'browser',
  };
  const dir = path.join(OUT, 'client');
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.js')) continue;
    const file = path.join(dir, f);
    const before = fs.statSync(file).size;
    const out = JavaScriptObfuscator.obfuscate(fs.readFileSync(file, 'utf8'), options).getObfuscatedCode();
    fs.writeFileSync(file, out);
    console.log(`  làm rối ${f}: ${before} -> ${out.length} byte`);
  }
}

console.log('build xong -> dist/');
