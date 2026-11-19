// Âm thanh quân cờ tạo bằng WebAudio nên không cần file âm thanh.
//   playClack(false): tiếng "cộp" khi đặt quân xuống bàn.
//   playClack(true):  tiếng "chát" khi ăn quân: quân đập mạnh vào quân kia, sắc và vang hơn,
//                     có một tiếng nảy nhỏ ngay sau đó như ngoài đời.

let ctx = null;
let master = null;
let noiseBuf = null;
let enabled = true;

export function setSoundEnabled(value) {
  enabled = value;
}

function ensure() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    // bộ nén để tiếng đập mạnh không bị vỡ tiếng
    master = ctx.createDynamicsCompressor();
    master.threshold.value = -14;
    master.ratio.value = 6;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// Trình duyệt chỉ cho phát âm thanh sau một thao tác của người dùng.
export function unlockAudio() {
  ensure();
}

function noise(c) {
  if (!noiseBuf) {
    const len = Math.floor(c.sampleRate * 0.15);
    noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

// Một cú "xẹt" ngắn của nhiễu, lọc theo tần số: phần sắc của tiếng va chạm.
function burst(c, t, { type, freq, q = 0.8, dur, gain }) {
  const src = c.createBufferSource();
  src.buffer = noise(c);
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur + 0.02);
}

// Phần "thân gỗ" của tiếng gõ: tần số rơi nhanh.
function tone(c, t, { type = 'sine', f0, f1, dur, gain }) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export function playClack(capture = false) {
  if (!enabled) return;
  const c = ensure();
  if (!c) return;
  const t = c.currentTime + 0.005;

  if (!capture) {
    tone(c, t, { type: 'triangle', f0: 210, f1: 75, dur: 0.1, gain: 0.55 });
    burst(c, t, { type: 'lowpass', freq: 1800, dur: 0.035, gain: 0.25 });
    return;
  }

  // chát: cú đập sắc + thân gỗ vang + tiếng nảy lại
  burst(c, t, { type: 'highpass', freq: 1400, dur: 0.05, gain: 0.95 });
  burst(c, t, { type: 'bandpass', freq: 3200, q: 1.2, dur: 0.03, gain: 0.5 });
  tone(c, t, { type: 'sine', f0: 640, f1: 210, dur: 0.07, gain: 0.8 });
  tone(c, t, { type: 'triangle', f0: 330, f1: 110, dur: 0.14, gain: 0.6 });
  burst(c, t + 0.05, { type: 'bandpass', freq: 2400, q: 1, dur: 0.025, gain: 0.45 });
  tone(c, t + 0.05, { type: 'sine', f0: 420, f1: 180, dur: 0.05, gain: 0.35 });
}
