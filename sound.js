// ================================================================
// 핑키 소리 — 녹음 파일 없이 전부 직접 만들어 내는 소리 (WebAudio)
//  · 소리 하나하나는 순수 JS로 한 번 그려서(Float32Array) 버퍼에 담아 두고 조금씩 바꿔 가며 튼다
//  · main.js는 매 프레임 상태만 넘겨 주고(update), 언제 무슨 소리를 낼지는 여기서 정한다
//  · 말풍선 글자는 onSay로 들어와 소리로 바뀐다 (새 말풍선이 생겨도 낱말만 맞으면 소리가 난다)
// ================================================================
const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const db = (d) => Math.pow(10, d / 20);
const toDb = (g) => 20 * Math.log10(Math.max(g, 1e-6));
// 움직임과 박자를 맞추는 값 (main.js의 updateDog 안 sin(t * …)과 같아야 한다)
export const CHEW_W = 15, SNIFF_W = 15, LICK_W = 11, PANT_W = 14, SLEEP_W = 1.5, KNEAD_W = 8;
export const DAMI_PANT_W = 18; // 담이의 헥헥 (main.js updateDog의 담이 턱 sin(t * 18)과 같아야 한다)

function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------------------------------------------------------------- 소리 그리는 도구
let SR = 48000, R = Math.random;
const rr = (a, b) => a + (b - a) * R();
const ri = (a, b) => a + Math.floor(R() * (b - a + 1));
const N = (ms) => Math.max(8, Math.round((ms * SR) / 1000));
const P = (ms) => new Float32Array(N(ms));
function noise(n, kind = 'w') {
  const y = new Float32Array(n);
  if (kind === 'w') for (let i = 0; i < n; i++) y[i] = R() * 2 - 1;
  else if (kind === 'p') { // 분홍 잡음 (Paul Kellett)
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n; i++) {
      const w = R() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      y[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
    }
  } else { let b = 0; for (let i = 0; i < n; i++) { b = 0.995 * b + (R() * 2 - 1) * 0.1; y[i] = b; } } // 갈색 잡음
  return y;
}
// RBJ 바이쿼드. f, Q는 숫자거나 (ms) => 값 (32샘플마다 다시 계산)
function bq(x, type, f, Q = 0.707, gdb = 0) {
  const n = x.length, y = new Float32Array(n), fF = typeof f === 'function', qF = typeof Q === 'function', k = 1000 / SR;
  let b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0, x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const set = (fc, q) => {
    const w = (TAU * clamp(fc, 20, SR * 0.45)) / SR, c = Math.cos(w), al = Math.sin(w) / (2 * q); let a0;
    if (type === 'lp') { b1 = 1 - c; b0 = b2 = b1 / 2; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
    else if (type === 'hp') { b1 = -(1 + c); b0 = b2 = (1 + c) / 2; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
    else if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
    else { const A = Math.pow(10, gdb / 40); b0 = 1 + al * A; b1 = -2 * c; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * c; a2 = 1 - al / A; }
    b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  };
  for (let i = 0; i < n; i++) {
    if ((i & 31) === 0 && (i === 0 || fF || qF)) set(fF ? f(i * k) : f, qF ? Q(i * k) : Q);
    const xi = x[i], yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = yi; y[i] = yi;
  }
  return y;
}
const norm = (x, pk = 1) => { let m = 0; for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > m) m = a; } if (m > 1e-9) { const g = pk / m; for (let i = 0; i < x.length; i++) x[i] *= g; } return x; };
const mulf = (x, f) => { const k = 1000 / SR, n = x.length; let a = f(0); for (let i = 0; i < n; i += 8) { const b = f((i + 8) * k), d = (b - a) / 8, e = Math.min(n, i + 8); for (let j = i, g = a; j < e; j++, g += d) x[j] *= g; a = b; } return x; }; // 모양 함수는 8샘플마다만 계산하고 사이는 잇는다
const mix = (dst, src, atMs = 0, g = 1) => { const o = Math.round((atMs * SR) / 1000); for (let i = Math.max(0, -o); i < src.length && o + i < dst.length; i++) dst[o + i] += src[i] * g; return dst; };
const sum = (a, b, g = 1) => { for (let i = 0; i < a.length && i < b.length; i++) a[i] += b[i] * g; return a; };
// 꺾은선을 부드럽게 잇는 곡선: [[ms, 값], …] → (ms) => 값
function curve(pts) {
  return (m) => {
    if (m <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) if (m < pts[i][0]) { const [m0, v0] = pts[i - 1], [m1, v1] = pts[i], k = (m - m0) / (m1 - m0); return v0 + (v1 - v0) * (0.5 - 0.5 * Math.cos(Math.PI * k)); }
    return pts[pts.length - 1][1];
  };
}
const sweep = (a, b, dur) => (m) => a * Math.pow(b / a, clamp(m / dur, 0, 1));
const ad = (a, tau) => (m) => (m < a ? 0.5 - 0.5 * Math.cos((Math.PI * m) / a) : Math.exp(-(m - a) / tau)); // 빠르게 올라와 스르르 사라짐
const bell = (dur, p = 1) => (m) => Math.pow(Math.sin(Math.PI * clamp(m / dur, 0, 1)), p);
function sine(durMs, f, ph = 0) { const n = N(durMs), y = new Float32Array(n), fF = typeof f === 'function', k = 1000 / SR; let w = 0; for (let i = 0; i < n; i++) { if ((i & 7) === 0) w = (TAU * (fF ? f(i * k) : f)) / SR; y[i] = Math.sin(ph); ph += w; } return y; }
const nb = (durMs, kind, type, f, Q, g) => norm(bq(noise(N(durMs), kind), type, f, Q, g)); // 걸러 낸 잡음 (크기 1로 맞춤)
// 딱 소리 알갱이: 아주 짧은 잡음을 좁은 띠로 걸러 낸 것 (씹는 소리 · 발톱 · 사료)
function click(durMs, fc, Q) { const x = P(durMs + 3 + (Q * 1200) / fc), n = N(durMs); for (let i = 0; i < n; i++) x[i] = (R() * 2 - 1) * Math.exp((-3 * i) / n); return norm(bq(x, 'bp', fc, Q)); }
const chirp = (durMs, f0, f1) => mulf(sine(durMs, sweep(f0, f1, durMs)), (m) => Math.exp((-3.2 * m) / durMs) * Math.min(1, m / 0.6)); // 침방울 톡
// 성대: 로젠버그 펄스를 미분한 것. 주기마다 떨림(jit)·크기 흔들림(shim), sub는 한 주기 걸러 약하게(쉰 소리)
function glot(n, f0, o) {
  const v = new Float32Array(n), open = new Float32Array(n), k = 1000 / SR, oq = o.oq ?? 0.6, tp = oq * 0.7, tn = oq * 0.3;
  let ph = 1, amp = 1, fm = 1, cyc = 0, prev = 0, f = 0;
  for (let i = 0; i < n; i++) {
    const m = i * k; if ((i & 7) === 0) f = f0(m) / SR;
    if (ph >= 1) { ph -= 1; cyc++; fm = 1 + (o.jit || 0) * (R() * 2 - 1); const s = typeof o.sub === 'function' ? o.sub(m) : o.sub || 0; amp = (1 + (o.shim || 0) * (R() * 2 - 1)) * (cyc & 1 ? 1 - s : 1); }
    const g = ph < tp ? 0.5 * (1 - Math.cos((Math.PI * ph) / tp)) : ph < oq ? Math.cos((Math.PI / 2) * (ph - tp) / tn) : 0;
    v[i] = (g - prev) * amp; prev = g; open[i] = g;
    ph += f * fm;
  }
  return { v, open };
}
const TRB = [120, 180, 260, 350], TRG = [0, -3, -7, -12]; // 비글 성도(13~15cm) 포먼트 폭 · 세기
function tract(src, F, B = TRB, G = TRG, dry = 0.06) {
  const y = new Float32Array(src.length);
  F.forEach((f, i) => { const b = B[i], o = bq(src, 'bp', f, typeof f === 'function' ? (m) => f(m) / b : f / b); sum(y, o, db(G[i]) * (i & 1 ? -1 : 1)); });
  return sum(y, src, dry);
}
// 목소리 한 토막: 성대 → (숨 섞임 · 쉰 기운) → 성도
function voiced(durMs, o) {
  const n = N(durMs), g = glot(n, o.f0, o);
  let s = norm(bq(g.v, 'lp', o.tilt || 3000, 0.6));
  if (o.asp != null) { const a = nb(durMs, 'p', 'hp', 1500, 0.7), ga = db(o.asp); for (let i = 0; i < n; i++) s[i] += a[i] * ga * (0.35 + 0.65 * g.open[i]); }
  if (o.hoarse != null) sum(s, nb(durMs, 'p', 'bp', 1800, 0.8), db(o.hoarse));
  if (o.F) s = tract(s, o.F, o.B, o.G, o.dry);
  return norm(s);
}
// 낑 소리(코로 내는 소리): 배음을 살리고, 떨림은 규칙적인 비브라토 대신 느리고 불규칙하게, 군데군데 갈라지고 숨이 섞인다
const nasal = (y) => bq(bq(y, 'pk', 1500, 1.4, 5), 'lp', 5200, 0.7);
function whineTone(D, base, lvl = 1) {
  const p1 = rr(0, TAU), p2 = rr(0, TAU), r1 = rr(1, 1.9), r2 = rr(2.3, 3.4), s0 = rr(0, D * 0.55), sl = rr(40, 80);
  const y = nasal(voiced(D, { f0: (m) => base(m) * (1 + 0.013 * Math.sin((TAU * r1 * m) / 1000 + p1) + 0.008 * Math.sin((TAU * r2 * m) / 1000 + p2)), jit: 0.014, shim: 0.07, oq: 0.64, tilt: 3800, sub: (m) => (m > s0 && m < s0 + sl ? 0.32 : 0), asp: -15, hoarse: -24 }));
  mulf(norm(y, lvl), curve([[0, 0], [Math.min(60, D * 0.3), 1], [D - Math.min(150, D * 0.45), 0.85], [D, 0]]));
  return sum(y, mulf(nb(D, 'p', 'bp', 2300, 0.9), (m) => Math.sin(Math.PI * clamp(m / D, 0, 1)) ** 0.5 * (Math.exp(-m / 45) + Math.exp(-(D - m) / 70))), db(-15) * lvl); // 시작과 끝의 숨소리
}
// 마무리: 직류 빼기 · 앞 2ms 뒤 5ms 다듬기 · 정해진 크기로
function finish(x, pkDb) {
  let m = 0; for (let i = 0; i < x.length; i++) m += x[i]; m /= x.length;
  const a = N(2), b = N(5), n = x.length;
  for (let i = 0; i < n; i++) { x[i] -= m; if (!Number.isFinite(x[i])) x[i] = 0; }
  for (let i = 0; i < a && i < n; i++) x[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / a);
  for (let i = 0; i < b && i < n; i++) x[n - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / b);
  return norm(x, db(pkDb));
}

// ---------------------------------------------------------------- 소리 목록 (이름, 가짓수, 크기 dBFS, 묶음, 그리는 법)
const DEF = {};
const def = (name, v, pk, bus, f, x = {}) => { DEF[name] = { name, v, pk, bus, f, ...x }; };

// --- 목소리
def('bark_yip', 4, -15, 'dog', () => { // 왈! — 신나서 한 번 (높고 맑고 짧게: 반가운 소리로 들리게)
  const D = rr(170, 210), top = 620 + rr(-40, 40), fs = rr(0.97, 1.03), rel = rr(70, 90);
  const y = voiced(D, { f0: curve([[0, 430], [35, top], [90, top * 0.985], [D, 380]]), jit: 0.02, shim: 0.08, oq: 0.6, tilt: 5200, sub: (m) => (m < 40 ? 0.3 : 0), asp: -13, hoarse: -17, dry: 0.16,
    F: [curve([[0, 700 * fs], [55, 1000 * fs], [D, 750 * fs]]), curve([[0, 1900 * fs], [55, 2150 * fs], [D, 1900 * fs]]), 3100 * fs, 4300 * fs, 5600 * fs], B: [120, 180, 260, 350, 500], G: [0, -3, -7, -11, -15] });
  mulf(y, curve([[0, 0], [8, 1], [D - rel, 0.8], [D, 0]]));
  return mix(y, mulf(nb(8, 'w', 'bp', 2500, 1.5), ad(0.6, 1.4)), 0, db(-10));
}, { voiced: 1, vocal: 1, gap: 1.2 });
def('bark_woof', 4, -15, 'dog', () => { // 멍 — 낮고 숨 섞인 인사 (늙은 강아지라 첫머리가 살짝 쉰다)
  const D = rr(200, 260), fs = rr(0.97, 1.03), top = 400 + rr(-25, 25);
  const y = voiced(D, { f0: curve([[0, 300], [40, top], [D, 250]]), jit: 0.025, shim: 0.09, oq: 0.62, tilt: 5200, sub: (m) => (m < 80 ? 0.45 : 0), asp: -10, hoarse: -15, dry: 0.12,
    F: [curve([[0, 600 * fs], [60, 850 * fs], [D, 600 * fs]]), curve([[0, 1750 * fs], [60, 1950 * fs], [D, 1700 * fs]]), 3000 * fs, 4200 * fs], G: [0, 1, -2, -6] });
  mulf(y, curve([[0, 0], [7, 1], [D * 0.55, 0.8], [D, 0]]));
  mix(y, mulf(nb(8, 'w', 'bp', 2500, 1.5), ad(0.6, 1.4)), 0, db(-12));
  return mix(mix(P(D + 45), y), mulf(nb(60, 'p', 'bp', 1200, 1.2), bell(60)), D - 28, db(-18)); // 입을 닫으며 "ㅍ"
}, { voiced: 1, vocal: 1, gap: 1.2 });
def('bay_aroo', 2, -19, 'dog', () => { // 아루— 비글 특유의 길게 뽑는 소리 (드물게). 노래처럼 고르지 않게: 첫머리가 쉬고, 뒤에서 목소리가 한 번 꺾여 올라간다
  const D = rr(900, 1250), tb = D * rr(0.58, 0.66), up = rr(1.2, 1.3), p1 = rr(0, TAU), r1 = rr(1.2, 2.2);
  const base = curve([[0, 330], [250, 520], [tb, 505], [tb + 14, 505 * up], [D - 170, 500 * up], [D, 400]]);
  const y = voiced(D, { f0: (m) => base(m) * (1 + 0.012 * Math.sin((TAU * r1 * m) / 1000 + p1)), jit: 0.028, shim: 0.1, oq: 0.6, tilt: 4500, sub: (m) => (m < 150 ? 0.4 : Math.abs(m - tb) < 25 ? 0.5 : 0.14), asp: -10, hoarse: -12, dry: 0.3,
    F: [curve([[0, 950], [250, 950], [450, 560], [D, 520]]), curve([[0, 2100], [250, 2100], [450, 1250], [D, 1150]]), 2900, 4000], G: [0, -2, -5, -10] });
  return mulf(y, curve([[0, 0], [40, 1], [tb - 10, 0.9], [tb + 4, 0.6], [tb + 30, 0.95], [D - 180, 0.85], [D, 0]]));
}, { voiced: 1, vocal: 1, gap: 1.2 });
def('whine', 4, -22, 'dog', (v) => { // 낑… (0·1: 끝이 올라가는 물음, 2·3: 내려가는 조름). 가짓수마다 높이가 꽤 다르다
  const D = rr(380, 600), k = [0.92, 1.3, 1.0, 1.36][v] * rr(0.96, 1.05);
  return whineTone(D, v < 2 ? curve([[0, 620 * k], [D * rr(0.45, 0.62), 900 * k], [D, 780 * k]]) : curve([[0, 850 * k], [D * 0.2, 865 * k], [D, 600 * k]]));
}, { voiced: 1, vocal: 1, fat: 0.3, gap: 6 });
def('whimper', 2, -26, 'dog', () => { const k = rr(0.95, 1.08); return whineTone(180, curve([[0, 720 * k], [80, 850 * k], [180, 760 * k]])); }, { voiced: 1, gap: 2 }); // 꿈꾸며 낑
def('gasp_alert', 3, -22, 'dog', () => { // ! — 코로 훅 들이쉬고 "음?"
  const out = P(215), k = rr(0.95, 1.06);
  mix(out, mulf(nb(90, 'w', 'bp', sweep(1800, 3200, 90), 1.2), curve([[0, 0], [55, 1], [90, 0]])));
  return mix(out, whineTone(110, curve([[0, 500 * k], [110, 680 * k]])), 98, db(-6));
}, { gap: 2.5 });
def('chomp_ball', 3, -14, 'dog', () => { // 앙! — 공을 덥석
  const out = P(190);
  mix(out, mulf(sine(25, sweep(160, 90, 25)), ad(2, 8)), 0, 0.6);
  mix(out, click(12, 2200 * rr(0.9, 1.1), 3), 1, 1);
  mix(out, mulf(nb(60, 'p', 'bp', 750, 1.6), ad(4, 16)), 4, 1.15); // 이빨이 펠트에 닿는 소리
  const g = bq(bq(voiced(120, { f0: curve([[0, 270], [120, 235]]), jit: 0.02, shim: 0.08, oq: 0.7, tilt: 900, asp: -18 }), 'pk', 400, 2, 8), 'lp', 1500, 0.7);
  return mix(out, mulf(norm(g), bell(120, 0.8)), 35, db(-10));
}, { gap: 0.5 });
def('growl_play', 3, -18, 'dog', () => { // 으르릉 — 장난으로 (짧게 두 번 부풀었다 꺼진다)
  const D = rr(500, 800), f = rr(105, 135), am = rr(28, 34), w = rr(0.7, 1.5), ph = rr(0, TAU);
  let y = voiced(D, { f0: (m) => f * (1 + 0.06 * Math.sin((TAU * w * m) / 1000 + ph)), jit: 0.04, shim: 0.12, oq: 0.55, tilt: 1800, sub: 0.4, asp: -13, F: [700, 1750, 2900], B: [220, 340, 480], G: [0, -5, -11], dry: 0.1 });
  y = norm(bq(y, 'lp', 2500, 0.7));
  return mulf(y, (m) => (0.55 + 0.45 * Math.sin((TAU * am * m) / 1000)) * (0.3 + 0.7 * Math.pow(Math.abs(Math.sin((Math.PI * m) / (D / 2))), 0.8)) * Math.min(1, m / 80, (D - m) / 80));
}, { voiced: 1, vocal: 1, gap: 1.5, lo: 1 });
def('sigh', 3, -20, 'dog', (v) => { // 후우… — 코로 길게 내쉬는 숨
  const D = rr(900, 1300), n0 = noise(N(D), 'p'), gl = (m) => 1 - (0.2 * m) / D;
  const y = sum(norm(bq(n0, 'bp', (m) => 900 * gl(m), 0.8)), norm(bq(n0, 'bp', (m) => 2400 * gl(m), 1.5)), db(-8));
  mulf(y, (m) => (m < 120 ? 0.5 - 0.5 * Math.cos((Math.PI * m) / 120) : m < 420 ? 1 - (0.1 * (m - 120)) / 300 : 0.9 * Math.exp((-3.4 * (m - 420)) / (D - 420))));
  if (v === 2) mix(y, mulf(norm(bq(voiced(400, { f0: curve([[0, 140], [400, 110]]), jit: 0.03, shim: 0.1, oq: 0.65, tilt: 700, sub: 0.2 }), 'lp', 900, 0.7)), bell(400)), 30, db(-14)); // 늙은 강아지의 "흠…"
  return y;
}, { voiced: 1, gap: 3 });
const breath = (D, fc, sk) => mulf(norm(((n0) => sum(bq(n0, 'bp', fc, 0.7), bq(n0, 'bp', fc * 2.1, 1), 0.45))(sum(noise(N(D), 'b'), noise(N(D), 'p'), 1.6))), (m) => { const e = Math.sin(Math.PI * (sk === 1 ? m / D : Math.pow(m / D, sk))); return e * Math.sqrt(e); });
def('sleep_in', 3, -25, 'sleep', () => breath(1300, 760 * rr(0.92, 1.08), 1), { lo: 1 }); // 자는 숨 들이쉬기
def('sleep_out', 3, -28, 'sleep', () => breath(1600, 560 * rr(0.92, 1.08), 0.7), { lo: 1 }); // 내쉬기 (더 낮고 더 작게)
def('snore', 3, -22, 'sleep', () => { // 쿨… — 들이쉴 때 여린입천장이 떨리는 소리
  const D = 1300, fl = rr(24, 32), n0 = sum(noise(N(D), 'b'), noise(N(D), 'p'), 0.8), dr = rr(-3, 3);
  const pu = mulf(Float32Array.from(n0), (m) => Math.pow(Math.max(0, Math.sin((TAU * (fl + (dr * m) / D) * m) / 1000)), 1.5) * Math.min(1, m / 30));
  const y = sum(sum(sum(norm(bq(pu, 'bp', 180, 2), 0.55), norm(bq(pu, 'bp', 900, 3)), 0.4), norm(bq(pu, 'bp', 820, 1.1)), 0.8), norm(bq(n0, 'bp', 600, 0.7)), 0.22); // 600~1200Hz 떨림: 작은 스피커에서도 들리게
  return mulf(y, bell(D, 1.3));
}, { lo: 1 });
def('yawn', 2, -20, 'dog', () => { // 하암 — 잘 잤다…
  const out = P(1000), k = rr(0.94, 1.06);
  mix(out, mulf(nb(500, 'w', 'bp', sweep(1200, 2000, 500), 1.2), bell(500, 1.2)), 0, 0.5);
  mix(out, mulf(whineTone(350, curve([[0, 480 * k], [170, 950 * k], [350, 600 * k]])), bell(350, 0.5)), 430, 1);
  return mix(out, mulf(nb(190, 'p', 'bp', 1000, 0.9), bell(190)), 790, 0.35);
}, { voiced: 1, gap: 3 });
def('pant_out', 3, -24, 'dog', () => mulf(norm(bq(bq(noise(N(150), 'w'), 'bp', 1500 * rr(0.92, 1.08), 0.9), 'pk', 2800, 2, 6)), (m) => ad(25, 38)(m) * Math.min(1, (150 - m) / 20))); // 헥 (내쉬기)
def('pant_in', 3, -29, 'dog', () => mulf(nb(110, 'w', 'bp', 2200 * rr(0.92, 1.08), 1), bell(110, 1.2))); // (들이쉬기)
def('content', 3, -24, 'dog', () => { // 음… 좋아 — 입 다물고 내는 소리
  const D = rr(350, 500), k = rr(0.93, 1.07);
  const y = norm(bq(bq(voiced(D, { f0: curve([[0, 170 * k], [D, 150 * k]]), jit: 0.015, shim: 0.06, oq: 0.7, tilt: 700 }), 'pk', 300, 2, 8), 'lp', 1200, 0.7));
  sum(y, nb(D, 'p', 'bp', 800, 0.8), db(-22));
  return mulf(y, curve([[0, 0], [70, 1], [D * 0.5, 0.85], [D, 0]]));
}, { voiced: 1, gap: 5, lo: 1 });
def('sneeze', 2, -17, 'dog', () => { // 에취
  const out = P(310);
  mix(out, mulf(nb(60, 'w', 'bp', 3000, 1.2), bell(60)), 0, 0.25);
  mix(out, mulf(norm(bq(bq(bq(bq(noise(N(95), 'w'), 'hp', 900, 0.7), 'pk', 1600, 2, 8), 'pk', 3500, 2, 5), 'lp', 6000, 0.7)), (m) => ad(2, 30)(m)), 62);
  mix(out, mulf(nb(80, 'p', 'bp', 700, 1.2), ad(3, 22)), 62, 0.6); // 몸통 소리
  const fl = rr(36, 44);
  return mix(out, mulf(nb(150, 'p', 'bp', 1800, 0.8), (m) => (0.5 + 0.5 * Math.sin((TAU * fl * m) / 1000)) * Math.exp(-m / 55)), 150, 0.35);
}, { gap: 2 });
def('snort', 2, -22, 'dog', () => mulf(nb(75, 'w', 'bp', 1100 * rr(0.9, 1.1), 1.5), ad(6, 20)), { gap: 8 }); // 흥 (코 풀기)

// --- 담이 목소리 (젊고 힘센 비글 아가씨: 핑키의 나긋한 "멍"과 달리 굵고 또렷하게 터지는 "컹!", 둘셋씩 끊어 짖는다)
// 컹 = ㅋ(목 안쪽이 터지는 짧은 바람) → ㅓ(입을 크게 벌린 굵은 소리: 첫 포먼트가 높고 둘째가 낮다) → ㅇ(입을 닫으며 코로 울리는 소리, 높은 소리가 먼저 사그라든다)
function keong(D, top, k, o = {}) {
  const on = o.on ?? rr(10, 14), vd = D - on, end = Math.min(55, vd * 0.33);
  const y0 = voiced(vd, { f0: curve([[0, top * 0.74], [16, top], [vd * 0.45, top * 0.97], [vd - end, top * 0.84], [vd, top * 0.66]]), jit: 0.016, shim: 0.06, oq: 0.5, tilt: 6800, sub: (m) => (m < 14 ? 0.35 : 0), asp: o.asp ?? -21, hoarse: -27, dry: 0.12,
    F: [curve([[0, 720 * k], [22, 1000 * k], [vd - end, 930 * k], [vd - 8, 430 * k]]), curve([[0, 1450 * k], [22, 1700 * k], [vd - end, 1620 * k], [vd - 8, 1250 * k]]), 2750 * k, 3950 * k, 5300 * k], B: [130, 170, 240, 330, 480], G: [0, -1, -3, -7, -12] });
  const y = bq(y0, 'lp', curve([[0, 9000], [vd - end, 8000], [vd, 1300]]), 0.7);
  mulf(y, curve([[0, 0], [5, 1], [vd * 0.5, 0.92], [vd - end, 0.74], [vd, 0]]));
  const out = P(D + 25);
  mix(out, mulf(nb(on + 10, 'w', 'bp', 2300 * k, 1.1), curve([[0, 0], [1.5, 1], [on, 0.45], [on + 10, 0]])), 0, db(-5)); // ㅋ
  mix(out, y, on);
  const hum = mulf(norm(bq(voiced(70, { f0: () => top * 0.64, jit: 0.01, oq: 0.7, tilt: 900 }), 'lp', 650, 0.7)), curve([[0, 0], [25, 1], [70, 0]]));
  return mix(out, hum, on + vd - end * 0.9, db(-11)); // ㅇ: 코로 울리는 끝소리
}
// 0~2: 한 묶음의 첫 컹(조금 높고 세게) · 3~5: 뒤따르는 컹(조금 낮고 짧게)
def('dami_kk', 6, -12.5, 'dog', (v) => (v < 3 ? keong(rr(150, 172), rr(505, 545), rr(0.97, 1.04)) : keong(rr(140, 158), rr(465, 500), rr(0.97, 1.03), { asp: -19 })), { voiced: 1, vocal: 1, gap: 0.16, noTag: 1 });
def('dami_yip', 4, -15, 'dog', () => { // 앙! 깡! — 신나서 짧고 높게
  const D = rr(98, 124), top = rr(780, 850), fs = rr(0.97, 1.04);
  const y = voiced(D, { f0: curve([[0, 600], [16, top], [D * 0.6, top * 0.95], [D, 620]]), jit: 0.015, shim: 0.06, oq: 0.55, tilt: 6000, asp: -16, hoarse: -26, dry: 0.15,
    F: [curve([[0, 950 * fs], [20, 1200 * fs], [D, 900 * fs]]), curve([[0, 1950 * fs], [20, 2150 * fs], [D, 1900 * fs]]), 3200 * fs, 4400 * fs], G: [0, -2, -6, -11] });
  mulf(y, curve([[0, 0], [5, 1], [D - 40, 0.75], [D, 0]]));
  return mix(y, mulf(nb(8, 'w', 'bp', 2600, 1.5), ad(0.6, 1.4)), 0, db(-10));
}, { voiced: 1, vocal: 1, gap: 0.12, noTag: 1 });
def('dami_arr', 3, -16, 'dog', () => { // 으르… 아르! — 친구한테 괜히 센 척 (짧게 그르렁대다 끝이 올라간다)
  const D = rr(420, 540), f = rr(168, 186), am = rr(26, 31), ph = rr(0, TAU);
  let y = voiced(D, { f0: curve([[0, f * 0.9], [80, f], [D - 120, f * 1.04], [D, f * 1.22]]), jit: 0.04, shim: 0.13, oq: 0.52, tilt: 2600, sub: 0.35, asp: -14, hoarse: -18,
    F: [curve([[0, 520], [120, 760], [D, 820]]), curve([[0, 1150], [120, 1300], [D, 1450]]), 2600], B: [200, 300, 420], G: [0, -4, -10], dry: 0.1 });
  y = norm(bq(y, 'lp', 3000, 0.7));
  return mulf(y, (m) => (0.55 + 0.45 * Math.sin((TAU * am * m) / 1000 + ph)) * Math.min(1, m / 50, (D - m) / 70) * (0.75 + 0.25 * Math.min(1, m / (D * 0.7))));
}, { voiced: 1, vocal: 1, gap: 1.2, lo: 1, noTag: 1 });
def('dami_pant_out', 4, -22, 'dog', () => { // 하! — 신나서 빠르게 헥헥 (핑키보다 짧고 밝고, 목소리가 살짝 섞인다)
  const D = rr(88, 104), k = rr(0.93, 1.08), out = P(D);
  mix(out, mulf(norm(bq(bq(noise(N(D), 'w'), 'bp', 1750 * k, 0.9), 'pk', 3100, 2, 6)), (m) => ad(12, 28)(m) * Math.min(1, (D - m) / 16)));
  return mix(out, mulf(norm(bq(voiced(D * 0.7, { f0: () => 430 * k, jit: 0.02, oq: 0.6, tilt: 2200 }), 'lp', 1800, 0.7)), bell(D * 0.7)), 4, db(-15));
});
def('dami_pant_in', 3, -28, 'dog', () => mulf(nb(72, 'w', 'bp', 2500 * rr(0.92, 1.08), 1), bell(72, 1.2))); // (빠르게 들이쉬기)

// --- 입 · 코
// 촵! — ㅊ(혀끝 터지는 소리) → 와삭(알갱이) → 촉촉한 "ㅘㅂ"(입이 닫히며 포먼트가 내려오다 뚝) → 침방울 톡
function chomp(kind, v, big) {
  const D = rr(118, 150), out = P(D + 22), soft = kind === 'soft';
  mix(out, mulf(norm(bq(bq(noise(N(30), 'w'), 'hp', 3200, 0.8), 'pk', 5500, 2, 8)), ad(1, 8)), 0, db(-2));
  const ng = big ? ri(10, 12) : kind === 'kibble' ? ri(6, 9) : soft ? ri(3, 4) : ri(4, 7), span = big ? 86 : 62, fmax = kind === 'kibble' ? 8000 : 6500;
  for (let i = 0; i < ng; i++) mix(out, click(rr(1.5, 5), rr(2200, fmax), rr(3, 6)), i ? rr(9, 5 + span) : rr(4, 7), (i ? db(-rr(0, 12)) : 1) * (soft ? db(-5) : 1) * 0.9);
  mix(out, click(15, big ? 1200 : 900, 2.5), rr(6, 14), soft ? 0.4 : 0.7);
  const bd = D - 20, pn = noise(N(bd), 'p');
  const body = norm(sum(bq(pn, 'bp', sweep(1050, 550, bd), 4), bq(pn, 'bp', sweep(2100, 1300, bd), 4), 0.7));
  mix(out, mulf(body, (m) => Math.min(1, m / 10) * Math.exp(-m / 62) * (m > bd - 6 ? (bd - m) / 6 : 1)), 20, soft ? 1.1 : 1);
  mix(out, mulf(sine(26, sweep(190, 120, 26)), ad(2.5, 7)), 14, db(-15)); // 턱이 닫히는 "툭" (이가 맞닿는 순간에, 작게)
  if (v % 4 !== 3 || big) for (let i = ri(1, 2); i > 0; i--) { const f = rr(1250, 1550); mix(out, chirp(rr(9, 14), f, f * rr(1.7, 1.95)), rr(30, D - 16), db(-12)); }
  return out;
}
def('chomp_treat', 8, -14.5, 'dog', (v) => chomp('treat', v), { gap: 0.2 });
def('chomp_kibble', 8, -14.5, 'dog', (v) => chomp('kibble', v), { gap: 0.2 });
def('chomp_soft', 4, -18, 'dog', (v) => chomp('soft', v), { gap: 0.2 });
def('crunch_big', 3, -12, 'dog', (v) => chomp('treat', v, true), { gap: 0.3 }); // 주운 간식 첫입 "와작"
def('gulp', 2, -22, 'dog', () => { // 꿀꺽
  const out = P(110);
  mix(out, click(12, 500, 2.5)); mix(out, mulf(sine(60, sweep(220, 140, 60)), bell(60)), 10, 0.7);
  return mix(out, click(12, 800, 2.5), 70, 0.8);
}, { gap: 0.6 });
function lick(kind, v) { // 할짝 — 혀가 쓱 나갔다가(올라가는 소리) 쩝
  const out = P(kind === 'bowl' ? 190 : 150), smack = v >= 4, yo = kind === 'yogurt';
  mix(out, mulf(nb(90, 'p', 'bp', yo ? sweep(500, 1600, 90) : sweep(700, 2400, 90), 2.5), curve([[0, 0], [30, 1], [80, 0.75], [90, 0]])), 0, smack ? 0.45 : 1);
  mix(out, click(8, 1800 * rr(0.9, 1.1), 3), 105, smack ? 1 : 0.6);
  mix(out, chirp(10, 1200, 2200), 107, smack ? 0.9 : 0.55);
  if (yo) mix(out, chirp(12, 900, 1700), 118, 0.6);
  if (kind === 'bowl') { mix(out, mulf(nb(150, 'w', 'bp', 3800 * rr(0.96, 1.04), 12), bell(150)), 10, db(-20)); mix(out, ring(70, 0.5), 60, db(-24)); }
  return out;
}
def('lick', 6, -18, 'dog', (v) => lick('mouth', v), { gap: 0.25 });
def('lick_bowl', 3, -18, 'dog', (v) => lick('bowl', v), { gap: 0.25 });
def('lick_yogurt', 3, -18, 'dog', (v) => lick('yogurt', v), { gap: 0.25 });
def('sniff', 6, -20, 'dog', (v) => { // 킁 — 짧게 들이쉬고 살짝 내쉼 (짝수: 밝게 들이쉬는 쪽, 홀수: 조금 어둡게) — 쉿 소리가 아니라 콧속을 지나는 바람 소리로
  const D = rr(85, 110), out = P(D + 58), n0 = noise(N(D), 'p'), k = rr(0.93, 1.07), dk = v & 1;
  const y = sum(sum(sum(norm(bq(n0, 'bp', sweep((dk ? 950 : 1250) * k, (dk ? 1100 : 1450) * k, D), 1)), norm(bq(n0, 'bp', sweep((dk ? 2500 : 2900) * k, (dk ? 2750 : 3250) * k, D), 1.6)), db(dk ? -6 : -3)), norm(bq(n0, 'bp', 5000 * k, 2)), db(-13)), norm(bq(n0, 'bp', 480 * k, 1.5)), db(-11));
  mix(out, mulf(y, curve([[0, 0], [20, 1], [D - 15, 0.9], [D, 0]])));
  return mix(out, mulf(nb(40, 'p', 'bp', 1000, 1), bell(40)), D + 12, db(dk ? -7 : -10));
}, { gap: 0.1 });
def('smack', 3, -27, 'dog', () => { const out = P(40); mix(out, click(6, 1700 * rr(0.9, 1.1), 3), 0, 0.8); return mix(out, chirp(rr(9, 12), 1150, 2100), 2, 0.7); }, { gap: 0.3 }); // 씹다가 입이 다시 벌어질 때 촉촉하게 "쩝"
def('treat_take', 2, -18, 'dog', () => { const out = P(60); mix(out, mulf(nb(40, 'p', 'bp', 900, 1.2), ad(6, 12))); return mix(out, click(15, 2400, 3), 14, 0.7); }, { gap: 0.5 }); // 앙 (살짝 받아 물기)

// --- 몸 · 주변
const thud = (durMs, f0, f1, tau) => mulf(sine(durMs, sweep(f0, f1, durMs)), ad(2, tau));
const pap = (durMs, fc, kind = 'p') => mulf(nb(durMs, kind, 'bp', fc * rr(0.9, 1.1), 1.1), ad(2, durMs / 4)); // 낮은 "툭"에 얹는 가운데 음역 (작은 스피커에서도 들리게)
def('step_wood', 6, -27, 'foley', () => { // 마루: 발톱 톡 + 발바닥 툭
  const out = P(46), nc = ri(1, 3), k = rr(0.9, 1.12); let at = 0;
  for (let i = 0; i < nc; i++) { const g = i ? db(-rr(4, 10)) : 1; mix(out, click(rr(1.5, 2.5), 3400 * k, 5), at, g); mix(out, click(rr(1.5, 2.5), 6000 * k, 6), at, g * 0.6); at += rr(4, 9); }
  mix(out, thud(22, 130, 85, 6), 1, db(-15));
  return mix(out, click(6, 700, 2), 1, 0.4);
}, { gap: 0.045 });
def('step_rug', 4, -32, 'foley', () => mix(mix(mix(P(40), thud(22, 130, 85, 7), 0, 0.55), mulf(nb(20, 'b', 'lp', 600, 0.7), bell(20)), 1, 0.4), pap(30, 650), 0, 0.9), { gap: 0.045 });
def('step_cushion', 3, -31, 'foley', () => mulf(nb(60, 'p', 'bp', 1800, 0.7), bell(60, 1.4)), { gap: 0.045 });
// 인식표 짤랑: 서로 안 어울리는 높은 음 셋
function jingle(len = 210) {
  const out = P(len), fs = [2950, 4380, 5870, 7900].sort(() => R() - 0.5).slice(0, 3), dec = [160, 110, 70], ns = ri(1, 2); let at = 0;
  for (let s = 0; s < ns; s++) {
    fs.forEach((f, i) => { const ff = f * rr(0.97, 1.03), d = dec[i]; mix(out, mulf(sine(len - at - 1, ff, rr(0, TAU)), (m) => Math.exp((-6.9 * m) / d) * Math.min(1, m / 0.4)), at, (s ? 0.6 : 1) * [1, 0.8, 0.6][i]); });
    mix(out, click(1, 6000, 1.5), at, 0.5); at += rr(18, 30);
  }
  return out;
}
def('tag_jingle', 4, -31, 'foley', () => jingle(), { gap: 0.25 });
def('tail_floor', 4, -25, 'foley', () => mix(mix(mix(P(55), thud(45, 110, 70, 13), 0, 0.55), click(5, 500, 2), 0, 0.6), pap(36, 750), 0, 0.9), { gap: 0.12 }); // 꼬리 탁
def('tail_cushion', 4, -25, 'foley', () => mix(mix(mix(P(80), mulf(nb(70, 'b', 'lp', 350, 0.7), ad(6, 20)), 0, 0.6), mulf(sine(40, 90), ad(3, 11)), 0, 0.35), pap(50, 800), 2, 0.8), { gap: 0.12 }); // 방석 위: 폭
def('swish', 2, -36, 'foley', () => mulf(nb(60, 'p', 'bp', 1200, 0.8), bell(60)), { gap: 0.1 });
def('knead', 3, -30, 'foley', () => mulf(nb(120, 'p', 'bp', sweep(900, 1600, 120), 0.8), bell(120, 1.3)), { gap: 0.3 }); // 꾹꾹
function flop(softer) {
  const out = P(170);
  mix(out, thud(90, 80, 55, 28), 0, softer ? 0.3 : 0.6);
  mix(out, mulf(nb(120, 'b', 'lp', 300, 0.7), ad(8, 34)), 0, 0.5);
  mix(out, pap(80, softer ? 800 : 600), 2, softer ? 0.6 : 1);
  return mix(out, mulf(nb(150, 'p', 'bp', softer ? 1800 : 1500, 0.7), bell(150, 1.5)), 12, softer ? db(-6) : db(-12));
}
def('flop', 3, -23, 'foley', () => flop(false), { gap: 0.6 }); // 털썩
def('flop_soft', 2, -28, 'foley', () => flop(true), { gap: 0.6 }); // 방석에 폭
def('shake', 2, -20, 'foley', () => { // 부르르 — 귀와 살이 퍼덕, 인식표가 짤랑
  const out = P(1150); let at = 0, i = 0;
  while (at < 1040) {
    const n0 = noise(N(60), 'p'), k = Math.sin((Math.PI * (at + 40)) / 1120);
    mix(out, mulf(sum(norm(bq(n0, 'bp', 500, 1)), norm(bq(n0, 'bp', 1500, 1)), 0.6), bell(60, 0.8)), at, (0.45 + 0.55 * k) * (i & 1 ? 0.8 : 1));
    mix(out, jingle(100), at + 10, 0.22 * k);
    at += 1000 / (4.5 + (1.5 * at) / 1040) / 2; i++;
  }
  return out;
}, { gap: 2 });
const ring = (durMs, bright = 1) => { const a = sine(durMs + 30, 2100 * rr(0.96, 1.04)), b = sine(durMs + 30, 3350 * rr(0.96, 1.04)); return mulf(sum(a, b, 0.7 * bright), (m) => Math.exp((-5 * m) / durMs) * Math.min(1, m / 0.5) * 0.6); }; // 밥그릇 울림
def('pour_bed', 2, -16, 'foley', () => { // 와르르 — 사료 쏟아지는 바탕
  const D = 1250, y = nb(D, 'p', 'bp', 3000, 0.8), g = mulf(nb(D, 'w', 'lp', 28, 0.7), () => 1);
  for (let i = 0; i < y.length; i++) y[i] *= 0.3 * (0.75 + 0.25 * g[i]) * Math.min(1, i / N(80), (y.length - i) / N(120));
  for (let i = 0; i < 46; i++) mix(y, click(2, rr(2500, 4500), 4), rr(20, D - 150), db(-rr(3, 14)));
  return y;
}, { gap: 0.5 });
def('scoop', 2, -20, 'foley', () => mulf(nb(200, 'w', 'bp', 4000, 0.8), bell(200, 1.3)), { gap: 0.5 }); // 스쿱 기울이는 "쉬"
def('kibble_hit', 8, -24, 'foley', (v) => { // 사료 알이 그릇에 톡 (0~3 빈 그릇: 울림 길게 · 4~7 찬 그릇: 둔하게)
  const dull = v >= 4, d = rr(40, 90) * (dull ? 0.4 : 1), out = P(d + 40);
  mix(out, click(2, rr(2500, 4500), 4), 0, dull ? 0.8 : 1);
  return mix(out, ring(d, dull ? 0.6 : 1), 0.5, db(dull ? -14 : -10) / 0.6);
}, { gap: 0.045 });
def('kibble_floor', 3, -30, 'foley', () => mix(mix(P(90), click(2, 3400, 5)), click(1.5, 3900, 5), 60 + rr(-8, 8), 0.5), { gap: 0.06 }); // 그릇 밖 마루에 떨어져 한 번 튐
def('bowl_tick', 3, -24, 'foley', () => { const d = rr(45, 80), out = P(d + 40); mix(out, click(2.5, rr(2200, 3600), 4)); return mix(out, ring(d), 0.5, db(-10) / 0.6); }, { gap: 0.15 });
def('ball_bounce', 4, -14, 'foley', () => { // 통
  const out = P(110), k = rr(0.94, 1.06);
  mix(out, mulf(sine(60, sweep(190 * k, 120 * k, 40)), ad(1.5, 12)));
  mix(out, mulf(nb(18, 'w', 'bp', 1100 * k, 2), ad(1, 5)), 0, 0.7); // 펠트 "폭"
  mix(out, mulf(sine(100, 320), ad(2, 20)), 0, db(-8)); // 마루 울림
  return mix(out, mulf(sine(60, 480 * k), ad(1, 8)), 0, db(-12)); // 속 빈 공 울림
}, { gap: 0.05 });
def('pat', 4, -32, 'foley', () => mulf(nb(180, 'p', 'bp', 2200 * rr(0.9, 1.1), 0.6), bell(180, 1.5)), { gap: 0.5 }); // 털 쓰다듬는 소리

def('flap', 4, -27, 'foley', () => { const n0 = noise(N(60), 'p'); return mulf(sum(norm(bq(n0, 'bp', 500 * rr(0.9, 1.1), 1)), norm(bq(n0, 'bp', 1500 * rr(0.9, 1.1), 1)), 0.6), bell(60, 0.8)); }, { gap: 0.07 }); // 장난감을 물고 고개를 털 때: 귀와 줄이 퍼덕
def('rope_drop', 3, -24, 'foley', () => mix(mix(mix(P(100), thud(45, 120, 75, 11), 0, 0.5), pap(50, 700), 1, 0.9), mulf(nb(70, 'p', 'bp', 1700, 0.8), bell(70, 1.3)), 6, 0.3), { gap: 0.15 }); // 로프가 바닥에 툭

// --- 담이(놀이터)만 쓰는 소리: 덴탈껌 오독오독 · 패트병 바삭바삭 · 모래 파는 소리
def('chomp_crunch', 6, -14, 'dog', (v) => { // 단단한 덴탈껌(칫솔껌 · 악어껌)을 어금니로 "오독" — 촵보다 마르고 알갱이가 많다
  const out = chomp('kibble', v, false);
  for (let i = ri(5, 8); i > 0; i--) mix(out, click(rr(1, 3), rr(3000, 7500), rr(4, 8)), rr(2, 48), db(-rr(2, 10))); // 잘게 부서지는 알갱이
  return mix(out, mulf(sine(40, sweep(260, 150, 40)), ad(1.5, 9)), rr(3, 6), db(-9)); // 이가 박히는 단단한 툭
}, { gap: 0.15 });
def('crinkle', 6, -19, 'foley', (v) => { // 바삭 — 얇은 페트병이 우그러지며 따닥따닥 (짝수 번호: 병이 꺾이는 "뽁"이 섞인다)
  const D = rr(220, 360), out = P(D + 30);
  for (let i = ri(14, 24); i > 0; i--) mix(out, click(rr(0.8, 2.5), rr(2500, 9000), rr(2, 6)), Math.pow(R(), 1.6) * D, db(-rr(0, 14)));
  mix(out, mulf(nb(D, 'w', 'hp', 3500, 0.7), (m) => Math.exp(-m / (D * 0.35)) * Math.min(1, m / 3)), 0, db(-14)); // 사르륵
  if (v % 2 === 0) { const f = rr(700, 1100), at = rr(0, 20); mix(out, mulf(sine(70, sweep(f, f * 0.8, 70)), ad(1, 14)), at, db(-8)); mix(out, click(3, rr(1500, 2500), 3), at, 0.8); }
  return out;
}, { gap: 0.1 });
def('dig_scratch', 6, -21, 'foley', () => { // 사각 — 앞발이 모래를 긁어 뒤로 차 낸다 (거친 알갱이 소리 + 발이 모래를 치는 툭)
  const D = rr(70, 110), out = P(D + 40), y = nb(D, 'w', 'bp', rr(2200, 3600), 0.9), g = noise(y.length, 'w');
  for (let i = 0; i < y.length; i++) y[i] *= 0.4 + 0.6 * Math.abs(g[i]) ** 3;
  mix(out, mulf(norm(y), curve([[0, 0], [8, 1], [D * 0.6, 0.7], [D, 0]])));
  for (let i = ri(5, 9); i > 0; i--) mix(out, click(rr(0.8, 2), rr(2500, 6000), rr(3, 6)), rr(5, D), db(-rr(6, 16)));
  return mix(out, pap(40, 500), 0, db(-6));
}, { gap: 0.06 });

// --- 푸푸(남산 산책길)만 쓰는 소리: 물 첨벙 · 물 할짝 · 물속 발걸음 · 돌길 발걸음 · 졸졸 시냇물 · 하이파이브 짝
const plip = (f0, dur) => mulf(sine(dur, sweep(f0, f0 * rr(1.4, 2.0), dur)), (m) => Math.exp(-m / (dur * 0.3)) * Math.min(1, m / 0.5)); // 물방울 "퐁": 짧게 올라가는 사인
def('splash', 6, -15, 'foley', () => { // 첨벙 — 앞발이 물을 탁 치고 물보라가 흩어진다 (낮은 퍽 + 쏴 + 방울 퐁퐁)
  const D = rr(280, 380), out = P(D + 60);
  mix(out, mulf(nb(60, 'p', 'lp', 700, 0.7), ad(2, 18)), 0, 0.8);
  mix(out, mulf(nb(D, 'w', 'bp', sweep(2600, 1400, D), 0.6), ad(4, D * 0.28)), 3, 0.55);
  for (let i = ri(5, 9); i > 0; i--) mix(out, plip(rr(500, 1400), rr(18, 40)), rr(20, D), db(-rr(4, 12)));
  for (let i = ri(6, 10); i > 0; i--) mix(out, click(rr(1, 3), rr(2000, 6000), rr(2, 5)), rr(40, D), db(-rr(8, 18))); // 떨어지는 물방울
  return out;
}, { gap: 0.12 });
def('water_lap', 6, -19, 'dog', () => { // 할짝 (물) — 혀가 물을 떠 올리는 촵 + 작은 퐁
  const out = P(160);
  mix(out, mulf(nb(70, 'p', 'bp', sweep(900, 2200, 70), 1.6), curve([[0, 0], [15, 1], [60, 0.6], [70, 0]])), 0, 0.8);
  mix(out, plip(rr(700, 1100), rr(25, 40)), rr(40, 60), 0.7);
  return mix(out, click(6, rr(1500, 2200), 3), rr(70, 90), 0.5);
}, { gap: 0.12 });
def('step_splash', 6, -24, 'foley', () => { // 물속 한 걸음: 찰박
  const D = rr(110, 170), out = P(D + 30);
  mix(out, mulf(nb(D, 'p', 'bp', rr(1200, 1900), 0.8), ad(5, D * 0.3)), 0, 0.8);
  for (let i = ri(2, 4); i > 0; i--) mix(out, plip(rr(600, 1300), rr(15, 30)), rr(10, D), db(-rr(4, 10)));
  return mix(out, mulf(nb(40, 'p', 'lp', 500, 0.7), ad(2, 12)), 0, 0.4);
}, { gap: 0.05 });
def('step_path', 4, -30, 'foley', () => { // 돌길: 발바닥 톡 + 발톱 사각 (마루처럼 울리지 않는다)
  const out = P(40); mix(out, pap(26, 900), 0, 0.8); mix(out, click(rr(1.2, 2), 4200 * rr(0.9, 1.1), 4), rr(1, 4), 0.35);
  return mix(out, mulf(nb(25, 'w', 'hp', 4000, 0.7), bell(25)), 2, 0.12);
}, { gap: 0.045 });
def('brook', 6, -27, 'foley', () => { // 졸졸 — 얕은 시냇물이 돌 사이로 흐르는 소리 (1.4초 한 토막: 겹쳐 틀어 끊이지 않게)
  const D = 1400, out = P(D), env = bell(D, 0.5);
  mix(out, mulf(nb(D, 'p', 'bp', 900, 0.5), bell(D, 0.6)), 0, 0.22);
  for (let i = ri(26, 36); i > 0; i--) { const at = rr(0, D - 60); mix(out, plip(rr(350, 1300), rr(20, 55)), at, db(-rr(3, 14)) * env(at)); }
  return out;
}, { gap: 0.3 });
def('paw_clap', 3, -17, 'foley', () => { // 짝! — 하이파이브: 손바닥과 앞발바닥이 맞닿는 소리
  const out = P(90); mix(out, mulf(nb(40, 'w', 'bp', rr(1600, 2200), 0.9), ad(0.8, 7)), 0, 1);
  return mix(out, thud(30, 220, 150, 6), 0, 0.3);
}, { gap: 0.2 });
def('kiss_call', 3, -17, 'foley', () => { // 츄츄츄~ — 엄마가 입술로 쪽쪽쪽 부르는 소리 (짧고 높게 세 번, 마지막이 살짝 높다)
  const out = P(430);
  for (let i = 0; i < 3; i++) {
    const at = i * rr(105, 125) + rr(0, 8), f = rr(2300, 2800) * (i === 2 ? 1.1 : 1), g = i === 2 ? 1 : 0.8;
    mix(out, mulf(sine(45, sweep(f, f * 1.5, 45)), curve([[0, 0], [4, 1], [22, 0.45], [45, 0]])), at + 2, 0.55 * g); // 쪽 하고 올라가는 휘파람 같은 결
    mix(out, mulf(nb(40, 'w', 'bp', f * 1.2, 1.4), ad(1, 9)), at, 0.6 * g); // 입술이 떨어지는 바람
    mix(out, click(rr(0.8, 1.3), rr(3500, 5200), 3), at, 0.45 * g); // 쪽
  }
  return out;
}, { gap: 0.4 });

// --- 푸푸 목소리 (엄근진 진돗개 아가씨: 핑키 · 담이보다 한참 낮고 묵직한 "월", 짖는 일이 드물다 · 그르르 경고 · 충성의 "웝" · 이상 무의 "훕" · 점잖은 "흠")
// 월 = ㅜ(입술을 오므린 w: 포먼트가 낮은 데서 출발) → ㅓ(가슴을 울리는 굵은 소리, 바닥음 190~215Hz) → ㄹ(혀끝이 닿으며 첫 포먼트는 내려가고 둘째 · 셋째는 올라간다, 소리가 살짝 줄며 끝난다)
function wol(D, top, k, o = {}) {
  const tl = rr(58, 72), w = rr(26, 34);
  const y0 = voiced(D, { f0: curve([[0, top * 0.78], [w, top], [D * 0.45, top * 0.97], [D - tl, top * 0.88], [D, top * 0.72]]), jit: 0.028, shim: 0.1, oq: 0.5, tilt: o.tilt ?? 5000, sub: (m) => (m < 30 ? 0.4 : 0.14), asp: o.asp ?? -17, hoarse: -20, dry: 0.05,
    F: [curve([[0, 320 * k], [w + 10, 590 * k], [D - tl, 550 * k], [D - 12, 360 * k]]), curve([[0, 640 * k], [w + 14, 1050 * k], [D - tl, 1000 * k], [D - 12, 1260 * k]]), curve([[0, 2350 * k], [D - tl, 2350 * k], [D - 12, 2650 * k]]), 3250 * k, 4300 * k], B: [110, 150, 230, 320, 450], G: [0, 1, -2, -5, -10] });
  const y = bq(bq(y0, 'pk', 290, 1.1, 3), 'lp', curve([[0, 2600], [w, 7000], [D - tl, 6000], [D, 1700]]), 0.7); // 가슴 울림 · ㄹ에서 입안이 어두워진다
  mulf(y, curve([[0, 0], [12, 0.85], [w, 1], [D * 0.42, 0.9], [D - tl, 0.74], [D - tl * 0.55, 0.56], [D - tl * 0.25, 0.5], [D, 0]]));
  const out = P(D + 20), z = norm(y), sat = Math.tanh(2.2); for (let i = 0; i < z.length; i++) z[i] = Math.tanh(2.2 * z[i]) / sat; // 힘껏 짖을 때 목이 살짝 갈라진다 (센 데서만 조금 찌그러져 소리가 단단해진다)
  mix(out, mulf(nb(14, 'p', 'bp', 900 * k, 1.1), curve([[0, 0], [2, 1], [14, 0]])), 0, db(-14)); // 가슴에서 터져 나오는 첫 바람
  return mix(out, z);
}
// 0~2: 한 묶음의 첫 월(조금 높고 길게) · 3~5: 뒤따르는 월(조금 낮고 짧게, 숨이 더 섞인다)
def('pupu_wol', 6, -13.5, 'dog', (v) => (v < 3 ? wol(rr(255, 290), rr(203, 218), rr(0.97, 1.03)) : wol(rr(225, 255), rr(184, 198), rr(0.97, 1.02), { asp: -15, tilt: 4400 })), { voiced: 1, vocal: 1, gap: 0.22, noTag: 1 });
def('pupu_grr', 3, -17, 'dog', () => { // 그르르 — 낮게 깔리는 경고 (장난 으르릉과 달리 고르고 길게, 흔들림 없이 버틴다)
  const D = rr(950, 1250), f = rr(86, 100), w = rr(0.4, 0.8), ph = rr(0, TAU), am = rr(21, 26), aph = rr(0, TAU);
  const y = norm(bq(bq(voiced(D, { f0: (m) => f * (1 + 0.025 * Math.sin((TAU * w * m) / 1000 + ph)) * (1 - (0.04 * m) / D), jit: 0.05, shim: 0.16, oq: 0.5, tilt: 1500, sub: 0.45, asp: -15, hoarse: -24, F: [470, 1120, 2250], B: [190, 280, 400], G: [0, -6, -13], dry: 0.12 }), 'pk', 230, 1.2, 4), 'lp', 1900, 0.7));
  const env = curve([[0, 0], [170, 0.82], [D * 0.45, 1], [D - 220, 0.9], [D, 0]]);
  return mulf(y, (m) => env(m) * (0.68 + 0.32 * Math.sin((TAU * am * m) / 1000 + aph + 0.6 * Math.sin((TAU * 3.1 * m) / 1000)))); // 그르르 결: 고르지 않게 구르는 떨림
}, { voiced: 1, vocal: 1, gap: 1.2, lo: 1, noTag: 1 });
def('pupu_chuff', 3, -18, 'dog', () => { // 웝 — 충성! 할 때 입을 거의 다문 채 짧고 낮게 한 번 (월보다 작고 부드럽게, 입술이 닫히며 끝난다)
  const D = rr(125, 160), k = rr(0.96, 1.04), top = rr(172, 188);
  const y = voiced(D, { f0: curve([[0, top * 0.82], [22, top], [D * 0.6, top * 0.95], [D, top * 0.78]]), jit: 0.022, shim: 0.08, oq: 0.66, tilt: 2200, sub: (m) => (m < 20 ? 0.3 : 0.08), asp: -12, hoarse: -24, dry: 0.1,
    F: [curve([[0, 330 * k], [26, 500 * k], [D - 34, 470 * k], [D - 6, 270 * k]]), curve([[0, 650 * k], [26, 900 * k], [D - 34, 860 * k], [D - 6, 600 * k]]), 2250 * k, 3150 * k], B: [120, 170, 260, 350], G: [0, -3, -10, -16] });
  const z = bq(bq(y, 'pk', 280, 1.1, 4), 'lp', curve([[0, 4200], [D - 34, 3600], [D, 900]]), 0.7);
  mulf(z, curve([[0, 0], [10, 1], [D * 0.5, 0.82], [D - 30, 0.55], [D, 0]]));
  const out = mix(P(D + 40), norm(z));
  return mix(out, mulf(nb(30, 'p', 'bp', 800, 1.2), bell(30)), D - 12, db(-20)); // 입술이 닫히는 "ㅂ"
}, { voiced: 1, vocal: 1, fat: 0.5, gap: 0.6, noTag: 1 });
def('pupu_huff', 3, -20, 'dog', () => { // 훕 — 이상 무! 할 때 가슴으로 짧게 내쉬는 흡족한 숨 (ㅎ 바람 → ㅜ 오므린 입 → ㅂ 입술을 닫으며 뚝)
  const D = rr(240, 320), k = rr(0.93, 1.07), cl = D - rr(30, 45), out = P(D + 40), n0 = noise(N(D), 'p');
  const y = norm(bq(sum(norm(bq(n0, 'bp', curve([[0, 1000 * k], [70, 600 * k], [D, 520 * k]]), 1.3)), norm(bq(n0, 'bp', curve([[0, 2000 * k], [70, 1250 * k], [D, 1100 * k]]), 1.8)), db(-10)), 'lp', 2200, 0.7)); // 오므린 입으로 나가는 어두운 바람
  mix(out, mulf(y, curve([[0, 0], [28, 1], [cl * 0.6, 0.72], [cl, 0.5], [cl + 12, 0]])));
  const v = norm(bq(voiced(cl, { f0: curve([[0, 125 * k], [cl, 105 * k]]), jit: 0.03, shim: 0.1, oq: 0.66, tilt: 600, sub: 0.2 }), 'lp', 700, 0.7));
  mix(out, mulf(v, curve([[0, 0], [40, 1], [cl * 0.7, 0.6], [cl, 0]])), 10, db(-3)); // 가슴 울림
  mix(out, thud(40, 130, 85, 12), 4, db(-14)); // 가슴이 툭
  return mix(out, mulf(nb(22, 'p', 'bp', 700, 1.2), bell(22)), cl + 8, db(-16)); // 입술 "ㅂ"
}, { voiced: 1, gap: 1.2 });
def('pupu_hum', 3, -20, 'dog', () => { // 흠 — 코로 짧게 훅 내쉬고 입을 다문 채 낮게 "음" (점잖게 따져 보는 소리)
  const D = rr(330, 430), k = rr(0.94, 1.06), out = P(D + 40);
  mix(out, mulf(nb(60, 'w', 'bp', 1050 * k, 1.3), ad(6, 16)), 0, db(-5)); // ㅎ: 코로 훅
  const h = norm(bq(bq(bq(voiced(D, { f0: curve([[0, 128 * k], [60, 146 * k], [D, 116 * k]]), jit: 0.02, shim: 0.07, oq: 0.7, tilt: 800, sub: (m) => (m > D * 0.7 ? 0.2 : 0) }), 'pk', 260, 1.5, 8), 'pk', 750, 2, -9), 'lp', 1100, 0.7)); // 다문 입: 낮은 울림을 키우고 가운데를 판다(콧소리)
  sum(h, nb(D, 'p', 'bp', 900, 0.9), db(-24));
  return mix(out, mulf(h, curve([[0, 0], [55, 1], [D * 0.5, 0.82], [D, 0]])), 28);
}, { voiced: 1, gap: 0.5, lo: 1 });
// 까치: 까악 까악 — 남산 나무 위에서 거칠게 쉰 높은 소리 두세 번 (ㄲ 부리가 딱 → 아악 거칠게 → 끝이 처지다 뚝)
function kkak(D, f, k) {
  const y = voiced(D, { f0: curve([[0, f * 0.9], [12, f * 1.08], [D * 0.45, f], [D, f * 0.82]]), jit: 0.09, shim: 0.28, oq: 0.42, tilt: 8000, sub: 0.45, asp: -9, hoarse: -8, dry: 0.12,
    F: [curve([[0, 1300 * k], [25, 1700 * k], [D, 1500 * k]]), 2800 * k, 4100 * k, 5400 * k], B: [280, 420, 580, 780], G: [0, -1, -4, -8] });
  const z = mulf(bq(y, 'hp', 900, 0.7), curve([[0, 0], [4, 1], [D * 0.4, 0.92], [D - 25, 0.7], [D - 6, 0.3], [D, 0]]));
  return mix(mix(P(D + 10), click(3, 3200 * k, 2), 0, 0.9), norm(z), 2);
}
def('magpie_call', 3, -17, 'foley', (v) => { // 0 · 1: 두 번 · 2: 세 번 (뒤로 갈수록 조금 낮고 작게)
  const n = v === 2 ? 3 : 2, f = rr(700, 820), k = rr(0.95, 1.06), Ds = [], ats = []; let at = rr(0, 10);
  for (let i = 0; i < n; i++) { Ds.push(rr(135, 180) * (i ? 1 : 1.1)); ats.push(at); at += Ds[i] + rr(110, 160); }
  const out = P(ats[n - 1] + Ds[n - 1] + 20);
  for (let i = 0; i < n; i++) mix(out, kkak(Ds[i], f * (1 - 0.035 * i), k), ats[i], i ? 0.85 - 0.05 * i : 1);
  return out;
}, { gap: 2 });

// 미리 그려 둘 순서(자주 쓰는 것부터, 드물게 쓰는 소리는 맨 뒤). 아직 안 그린 소리를 틀면 그 자리에서 그린다
const RARE = ['bay_aroo', 'growl_play', 'sneeze', 'chomp_soft', 'crunch_big', 'lick_yogurt', 'swish', 'shake', 'kibble_floor', 'flap', 'rope_drop', 'chomp_crunch', 'crinkle', 'dig_scratch', 'dami_kk', 'dami_yip', 'dami_arr', 'dami_pant_out', 'dami_pant_in', 'splash', 'water_lap', 'step_splash', 'step_path', 'brook', 'paw_clap', 'kiss_call', 'pupu_wol', 'pupu_grr', 'pupu_chuff', 'pupu_huff', 'pupu_hum', 'magpie_call'];
const NAMES = ['chomp_treat', 'chomp_kibble', 'sniff', 'bark_woof', 'bark_yip', 'step_wood', 'step_rug', 'lick', ...Object.keys(DEF).filter((n) => !RARE.includes(n)), ...RARE].filter((n, i, a) => a.indexOf(n) === i);
const hash = (s) => { let h = 7; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; return h; };
/** 소리 하나를 그린다 (순수 함수: 같은 이름·번호·샘플레이트면 늘 같은 결과) */
function render(name, variant = 0, sampleRate = 48000) {
  const d = DEF[name]; if (!d) throw new Error('모르는 소리: ' + name);
  const sr0 = SR, r0 = R; SR = sampleRate; R = rng(hash(name) * 131 + variant * 7919 + 1);
  try { return finish(d.f(variant), d.pk); } finally { SR = sr0; R = r0; }
}

// ---------------------------------------------------------------- 재생 엔진
const LOG_MAX = 2048, VOICES_MAX = 12, REF_D = 2.4;
const log = [];
let ctx = null, fake = false, offline = false, master = null, comp = null, mainBus = null, revIn = null;
const bus = {};
let enabled = true, scene = 'select', T = 0, lite = false, masterVol = 1.25, broken = false, lastGesture = -1e9;
try { if (typeof localStorage !== 'undefined' && localStorage.getItem('dm.sound') === '0') enabled = false; } catch (e) { /* 저장소를 못 쓰면 켠 채로 */ }
const bufs = new Map(), voices = [], lastT = {}, lastV = {}, queue = [];
let renderQ = [], renderMs = 0, idleOn = false;
let L = { p: [0, 1.22, 3], r: [1, 0, 0] }, head = [0.1, 0.3, 0.85], cfg = { off: [0.75, 0.25, 0, 0.5], duty: 0.65, rug: [0.1, 0.8, 1.45, 0.95], cush: [0.66, -1.72, 0.33], bowl: [2.15, 1.0] };
let prev = null, st = null, lastVoiced = null, fatigue = 0;
const live = () => enabled && scene === 'room' && (fake || (ctx && (offline || ctx.state === 'running')));

function getBuf(name, v) {
  // 낮은 소리(자는 숨 · 으르릉 …)는 절반 샘플레이트로 그린다 (빨리 그려지고 들리는 차이는 없다)
  const k = name + '#' + v; let b = bufs.get(k);
  if (!b) { const t0 = now(); const sr = DEF[name].lo && ctx.sampleRate >= 44100 ? ctx.sampleRate / 2 : ctx.sampleRate, x = render(name, v, sr); b = ctx.createBuffer(1, x.length, sr); b.getChannelData(0).set(x); bufs.set(k, b); renderMs += now() - t0; }
  return b;
}
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
// 한가할 때 조금씩 미리 그려 둔다 (자주 쓰는 것부터). 아직 안 그린 소리를 틀면 그 자리에서 그린다
function idleRender() {
  if (!ctx || idleOn || !renderQ.length) return; idleOn = true;
  const step = (dl) => {
    idleOn = false; if (!ctx) return;
    const t0 = now();
    while (renderQ.length && now() - t0 < 4 && (!dl || !dl.timeRemaining || dl.timeRemaining() > 1 || dl.didTimeout)) { const [n, v] = renderQ.shift(); getBuf(n, v); }
    if (renderQ.length) { idleOn = true; sched(); }
  };
  const sched = () => (typeof requestIdleCallback === 'function' ? requestIdleCallback(step, { timeout: 400 }) : setTimeout(step, 30));
  sched();
}
function makeGraph(c) {
  ctx = c; bufs.clear(); voices.length = 0;
  master = c.createGain(); master.gain.value = enabled ? masterVol : 0;
  comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.knee.value = 6; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.18;
  master.connect(comp); comp.connect(c.destination);
  mainBus = c.createGain(); mainBus.connect(master); // 자는 동안에는 숨소리 말고는 다 조금 줄인다
  for (const n of ['dog', 'foley']) { bus[n] = c.createGain(); bus[n].connect(mainBus); }
  bus.sleep = c.createGain(); bus.sleep.connect(master);
  // 거실 울림: 0.42초짜리 잔향을 직접 만든다 (가까운 반사 셋 + 어두운 꼬리)
  const sr = c.sampleRate, n = Math.round(0.42 * sr), ir = c.createBuffer(2, n, sr), r0 = R, sr0 = SR; SR = sr;
  for (let ch = 0; ch < 2; ch++) {
    R = rng(991 + ch * 17);
    const x = noise(n, 'w'); for (let i = 0; i < n; i++) x[i] *= Math.pow(10, (-3 * i) / (0.38 * sr)) * Math.min(1, i / (0.004 * sr));
    const y = bq(x, 'lp', 4200, 0.7);
    [[7, -8], [13, -11], [21, -14]].forEach(([ms, d], i) => { y[Math.round(((ms + ch * (i + 1) * 0.7) * sr) / 1000)] += db(d) * 2.2 * (i & 1 ? -1 : 1); });
    ir.getChannelData(ch).set(norm(y, 0.5));
  }
  R = r0; SR = sr0;
  const conv = c.createConvolver(); conv.normalize = true; conv.buffer = ir;
  revIn = c.createGain(); revIn.connect(conv); conv.connect(master);
  renderQ = []; for (const nm of NAMES) for (let v = 0; v < DEF[nm].v; v++) renderQ.push([nm, v]);
  if (isDami()) renderQ.sort((a, b) => (b[0].startsWith('dami_') ? 1 : 0) - (a[0].startsWith('dami_') ? 1 : 0));
  else if (isPupu()) renderQ.sort(pupuFirst);
}
const pupuFirst = (a, b) => (/^pupu_|^magpie/.test(b[0]) ? 1 : 0) - (/^pupu_|^magpie/.test(a[0]) ? 1 : 0); // 푸푸 목소리 · 까치부터 미리 그려 둔다
const gestures = ['pointerdown', 'pointerup', 'touchend', 'mousedown', 'keydown', 'click'];
/** 첫 손길에서 소리를 연다 (브라우저는 손길 없이는 소리를 못 내게 한다). 여러 번 불러도 괜찮다 */
function unlock() {
  lastGesture = now();
  if (fake || !enabled || broken) return;
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext); if (!AC) return;
  if (!ctx) {
    try { makeGraph(new AC({ latencyHint: 'interactive' })); } catch (e) { ctx = null; broken = true; return; }
    try { const s = ctx.createBufferSource(); s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate); s.connect(ctx.destination); s.start(); } catch (e) { /* iOS용 무음 한 샘플 */ }
    ctx.addEventListener?.('statechange', () => { if (ctx.state === 'running') idleRender(); });
  }
  if (ctx.state !== 'running' && !(typeof document !== 'undefined' && document.hidden)) ctx.resume().then(idleRender, () => {});
  else idleRender();
}
function init(o = {}) {
  cfg = { ...cfg, ...o }; lite = !!o.lite;
  if (typeof window === 'undefined') return;
  for (const g of gestures) window.addEventListener(g, unlock, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) { stopAll(40); ctx.suspend(); } else if (enabled) ctx.resume();
  });
}
function setEnabled(on) {
  enabled = !!on;
  try { localStorage.setItem('dm.sound', enabled ? '1' : '0'); } catch (e) { /* 못 써도 그만 */ }
  if (enabled) { unlock(); if (ctx) { master.gain.cancelScheduledValues(ctx.currentTime); master.gain.setTargetAtTime(masterVol, ctx.currentTime, 0.05); } }
  else if (ctx) { master.gain.cancelScheduledValues(ctx.currentTime); master.gain.setTargetAtTime(0, ctx.currentTime, 0.03); stopAll(80, true); queue.length = 0; setTimeout(() => { if (!enabled && ctx) ctx.suspend(); }, 250); }
}
function setScene(s) {
  if (s === scene) return; scene = s; prev = null; queue.length = 0; st = null;
  if (s !== 'room') stopAll(300, true);
  else if (ctx) { mainBus.gain.setTargetAtTime(1, ctx.currentTime, 0.1); if (enabled && ctx.state !== 'running' && !(typeof document !== 'undefined' && document.hidden)) ctx.resume().catch(() => {}); }
}
const surfaceAt = (x, z) => cfg.surf ? cfg.surf(x, z) : (Math.hypot(x - cfg.cush[0], z - cfg.cush[1]) < cfg.cush[2] + 0.12 ? 'cushion' : ((x - cfg.rug[0]) / cfg.rug[2]) ** 2 + ((z - cfg.rug[1]) / cfg.rug[3]) ** 2 < 1 ? 'rug' : 'wood');
// 듣는 자리(카메라)에서 본 방향과 거리 → 좌우 · 크기 · 먹먹함 · 울림
function spatial(pos) {
  const dx = pos[0] - L.p[0], dy = pos[1] - L.p[1], dz = pos[2] - L.p[2], d = clamp(Math.hypot(dx, dy, dz), 0.6, 6);
  const held = prev && prev.pose === 'held';
  if (held) return { pan: 0, g: 3, lp: 16000, send: -26, d };
  return { pan: clamp((0.75 * (dx * L.r[0] + dy * L.r[1] + dz * L.r[2])) / d, -0.6, 0.6), g: toDb(clamp(Math.pow(REF_D / d, 0.8), 0.5, 1.4)), lp: 16000 * Math.pow(6500 / 16000, clamp((d - 1) / 4, 0, 1)), send: -20 + 8 * clamp((d - 1) / 3, 0, 1), d };
}
function fadeOut(v, ms = 40) { if (!v || v.dead) return; v.dead = true; if (!ctx) return; const t = ctx.currentTime; try { v.g.gain.cancelScheduledValues(t); v.g.gain.setTargetAtTime(0, t, ms / 3000); v.src.stop(t + ms / 1000 + 0.02); } catch (e) { /* 이미 끝남 */ } }
/** 소리 한 번. o: { pos:[x,y,z], gain(dB), rate, variant, vlo, vhi, gap(초), delay(초), force, nofat, why } */
function play(name, o = {}) {
  const d = DEF[name]; if (!d || d.broken || !live()) return null;
  if (!o.force && T - (lastT[name] ?? -99) < (o.gap ?? d.gap ?? 0.07)) return null;
  const me = !o.other; // o.other: 다른 강아지(놀이터 밖 친구)의 목소리 — 담이의 목소리 차례 · 지침 셈에 끼지 않고, 담이 소리를 끊지 않는다
  if (d.voiced && me) { if (!o.force && lastVoiced && T - lastVoiced.t < 0.15) return null; if (lastVoiced && lastVoiced.v && !offline) fadeOut(lastVoiced.v, 40); }
  lastT[name] = T;
  let v = o.variant;
  if (v == null) { const lo = o.vlo ?? 0, hi = o.vhi ?? d.v; do v = lo + Math.floor(Math.random() * (hi - lo)); while (hi - lo > 1 && v === lastV[name]); }
  lastV[name] = v;
  const sp = spatial(o.pos || head);
  if (d.vocal && me) { if (!o.force && !o.nofat) o = { ...o, gain: (o.gain || 0) - clamp((fatigue - 2) * 2, 0, 4) }; fatigue += d.fat ?? 1; } // 연달아 짖으면 조금씩 작게 (인사 · 엄마다! 는 줄이지 않는다)
  const gainDb = (o.gain || 0) + (Math.random() * 4 - 2) * (d.voiced ? 0.5 : 1) + sp.g;
  const rate = (o.rate || 1) * (d.voiced ? 0.97 + Math.random() * 0.06 : 0.94 + Math.random() * 0.12);
  const e = { t: +T.toFixed(3), name, variant: v, gainDb: +gainDb.toFixed(1), pan: +sp.pan.toFixed(2), why: o.why || '' };
  log.push(e); if (log.length > LOG_MAX) log.shift();
  if (d.voiced && me) lastVoiced = { t: T, v: null };
  if (!ctx) return e;
  let buf; try { buf = getBuf(name, v); } catch (er) { DEF[name].broken = 1; return null; } // 소리가 방을 멈추게 해서는 안 된다
  const t = ctx.currentTime;
  if (voices.length >= VOICES_MAX && !offline) { const old = voices.find((x) => x.bus === 'foley' && !x.dead) || voices.find((x) => !x.keep && !x.dead); if (old) fadeOut(old, 15); }
  const src = ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = rate;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = sp.lp; lp.Q.value = 0.5;
  const g = ctx.createGain(); g.gain.value = db(gainDb);
  const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null; if (pan) pan.pan.value = sp.pan;
  const send = ctx.createGain(); send.gain.value = db(sp.send);
  src.connect(lp); lp.connect(g); if (pan) { g.connect(pan); pan.connect(bus[d.bus]); } else g.connect(bus[d.bus]);
  g.connect(send); send.connect(revIn);
  const vo = { name, src, g, bus: d.bus, keep: !!d.voiced, dead: false, e };
  voices.push(vo);
  src.onended = () => { const i = voices.indexOf(vo); if (i >= 0) voices.splice(i, 1); try { send.disconnect(); (pan || g).disconnect(); } catch (er) { /* */ } };
  src.start(o.when ?? t + (o.delay || 0));
  if (d.voiced && me) lastVoiced.v = vo;
  if (!me && d.vocal && !offline) later(0.04, () => play('tag_jingle', { pos: o.pos, gain: -2, why: 'other dog collar' })); // 친구 목줄 방울: 그 자리에서 작게
  else if (d.vocal && d.voiced && !offline) { bus.foley.gain.cancelScheduledValues(t); bus.foley.gain.setTargetAtTime(db(-4), t, 0.01); bus.foley.gain.setTargetAtTime(1, t + 0.25, 0.08); if (name !== 'whine' && name !== 'growl_play' && !d.noTag) later(0.04, () => play('tag_jingle', { pos: o.pos, gain: 2 + Math.min(0, o.gain || 0), why: 'bark' })); }
  Object.defineProperty(e, 'vo', { value: vo, enumerable: false });
  return e;
}
const later = (delay, fn, tag) => { queue.push({ at: T + delay, fn, tag }); };
/** 하다 만 소리 묶음(엄마다! · 찾았다)의 남은 소리를 거둔다 — 명령이 끊기면 뒤따르던 소리도 나지 않게 */
function cancelPhrase(tag) { for (let i = queue.length - 1; i >= 0; i--) if (queue[i].tag === tag) queue.splice(i, 1); if (tag === 'found' && st) st.foundBig = -9; }
/** 이어지는 소리(쏟아지는 사료 등)를 멈춘다. 짧은 소리는 끝까지 울리게 둔다 */
function stopAll(fadeMs = 80, everything = false) {
  for (const v of voices) if (everything || v.loop) fadeOut(v, fadeMs);
  if (st) st.pour = null;
}
function hush(fadeMs = 250) { queue.length = 0; stopAll(fadeMs, true); } // 방을 나설 때: 예약된 소리까지 모두 거둔다

// ---------------------------------------------------------------- 목소리 · 이어지는 소리 묶음
const VOICE = { yip: 'bark_yip', woof: 'bark_woof', aroo: 'bay_aroo', whine: 'whine', growl: 'growl_play', yawn: 'yawn', content: 'content', sigh: 'sigh', whimper: 'whimper' };
// 강아지마다 목소리 (configure({ voice })): 담이는 짖는 소리 · 그르렁이 따로 있고, 낑 소리는 조금 높다(어리다)
const DAMI_V = { yip: 'dami_yip', woof: 'dami_kk', aroo: 'dami_kk', growl: 'dami_arr' };
const isDami = () => cfg.voice === 'dami';
const isPupu = () => cfg.voice === 'pupu'; // 푸푸(진돗개): 낮고 묵직한 목소리 (엄근진 — 깽깽대지 않는다)
// 푸푸: 짖는 소리(월) · 그르르 · 웝은 따로 있고(신나서 깽 하는 일이 없다: yip도 낮은 웝), 낑 · 음 · 한숨 · 하품은 핑키 것을 낮게(0.85배)
const PUPU_V = { woof: 'pupu_wol', aroo: 'pupu_wol', growl: 'pupu_grr', yip: 'pupu_chuff' };
const huff = () => (isDami() ? 'dami_pant_out' : isPupu() ? 'pupu_huff' : 'pant_out'); // 흥정 · 조를 때 내쉬는 숨 (푸푸는 가슴으로 훕)
const voice = (name, o = {}) => (isDami() ? play(DAMI_V[name] || VOICE[name] || name, name === 'whine' || name === 'whimper' ? { ...o, rate: (o.rate || 1) * 1.08 } : o) : isPupu() ? pupuVoice(name, o) : play(VOICE[name] || name, o));
function pupuVoice(name, o) { const p = PUPU_V[name]; return p ? play(p, { ...(p === 'pupu_wol' ? { vlo: 0, vhi: 3 } : {}), ...o, rate: Math.min(o.rate || 1, 1.06) }) : play(VOICE[name] || name, { ...o, rate: (o.rate || 1) * 0.85 }); } // 제 목소리는 너무 높이지 않는다
let lastAroo = -99;
// 담이의 컹컹: 한 번에 둘셋씩 끊어서 (0.2초 남짓 간격, 뒤로 갈수록 조금 낮고 작게), 묶음 사이는 쉰다. 자주 짖지만 시끄럽지 않게 — 20초에 아홉 번을 넘으면 한 번씩만
let kkEnd = -99, kkTimes = [];
export const DAMI_KK = { gap: 1.4, burstMax: 3, per20s: 9 };
function barkBurst(n = 2, o = {}) {
  if (!live()) return 0;
  n = clamp(Math.round(n), 1, DAMI_KK.burstMax);
  kkTimes = kkTimes.filter((t) => T - t < 20);
  const tired = kkTimes.length >= DAMI_KK.per20s; // 많이 짖었으면 한 번씩만, 사이도 길게
  if (!o.force && T < kkEnd + DAMI_KK.gap * (tired ? 4 : 1)) return 0;
  if (!o.force) n = Math.max(1, Math.min(n, DAMI_KK.per20s - kkTimes.length));
  const tag = o.tag || 'kk', g = o.gain ?? 0; let at = 0;
  for (let i = 0; i < n; i++) {
    const gi = g - i * 1.5 - (i && Math.random() < 0.5 ? 1 : 0), fn = () => play('dami_kk', { vlo: i ? 3 : 0, vhi: i ? 6 : 3, gain: gi, rate: i ? 0.985 : 1, why: o.why || 'kk' });
    kkTimes.push(T + at); // 곧 날 소리도 미리 센다
    if (i === 0) fn(); else later(at, fn, tag);
    at += 0.2 + Math.random() * 0.06;
  }
  kkEnd = T + at;
  return n;
}
// 푸푸의 월월: 0.3초 남짓 간격으로 n번 (뒤로 갈수록 조금 낮고 작게). 짖는 일이 드물다 — 20초에 두 묶음까지만 (o.force: 지킬 때 · 엄마를 맞을 때는 언제든). 못 짖으면 0
let wolTimes = [];
export const PUPU_WOL = { burstMax: 3, per20s: 2 };
function wolBurst(n = 1, o = {}) {
  if (!live()) return 0;
  n = clamp(Math.round(n), 1, PUPU_WOL.burstMax);
  wolTimes = wolTimes.filter((t) => T - t < 20);
  if (!o.force && wolTimes.length >= PUPU_WOL.per20s) return 0;
  wolTimes.push(T);
  const tag = o.tag || 'wol', g = o.gain ?? 0; let at = 0;
  for (let i = 0; i < n; i++) {
    const gi = g - i * 1.5, fn = () => play('pupu_wol', { vlo: i ? 3 : 0, vhi: i ? 6 : 3, gain: gi, rate: 1 - i * 0.015, force: 1, pos: o.pos, why: o.why || 'wol' }); // 묶음 안에서는 끊기지 않게 (묶음 자체를 위에서 아낀다)
    if (i === 0) fn(); else later(at, fn, tag);
    at += 0.3 + Math.random() * 0.04;
  }
  if (!o.noJingle) later(0.05, () => play('tag_jingle', { pos: o.pos, gain: g - 2, why: 'wol' }), tag); // 가슴이 울려 인식표가 한 번 짤랑
  return n;
}
// 푸푸: 엄마를 맞을 때도 점잖게 — 인식표 짤랑 → 낮은 월 한 번 (들어설 때는 작게), 돌아오셨을 때는 가끔 웝으로 맺는다. 낑낑대지 않는다
function pupuPhrase(name, o) {
  if (name === 'greet') {
    if (st) st.greetT = T;
    play('tag_jingle', { force: 1, gain: 1, why: 'greet' });
    later(0.3, () => wolBurst(1, { force: 1, gain: o.gain ?? -6, noJingle: 1, why: 'greet' }));
    if (o.double) later(0.8 + Math.random() * 0.08, () => play('pupu_chuff', { force: 1, gain: (o.gain ?? -6) - 1, why: 'greet' }));
    return;
  }
  const m = o.mode, tag = 'mom'; cancelPhrase(tag);
  if (m === 'busy') return void play('pupu_hum', { gain: -2, why: 'mom' }); // 입에 뭘 물고 있으면 "흠"
  if (m === 'quick') { if (!wolBurst(1, { gain: -8, noJingle: 1, tag, why: 'mom' })) play('pupu_chuff', { force: 1, gain: -8, why: 'mom (holds back)' }); return; } // 알아보기만: 말풍선 '월!'처럼 작게 월 한 번 (20초에 두 묶음 몫 안에서 — 넘치면 작게 웝)
  const lead = m === 'entry' || m === 'again', first = m === 'entry', g = first ? -8 : lead ? -5 : -2; // 말풍선 '엄마다!'로만 불렸으면 전부 미뤄 둔다 (곧 mode를 달고 다시 불리면 거둬진다)
  if (lead) play('tag_jingle', { force: 1, gain: first ? 1 : -1, why: 'mom' }); else later(0.05, () => play('tag_jingle', { force: 1, gain: -1, why: 'mom' }), tag);
  later(0.4, () => wolBurst(1, { force: 1, gain: g, noJingle: 1, tag, why: 'mom' }), tag);
  if (!first && Math.random() < 0.5) later(1.0 + Math.random() * 0.1, () => play('pupu_chuff', { force: 1, gain: g - 4, why: 'mom' }), tag); // 웝 — 다녀오셨습니까
}
function phrase(name, o = {}) {
  if (!live()) return;
  if (isPupu() && (name === 'mom' || name === 'greet')) return void pupuPhrase(name, o);
  if (name === 'mom' && isDami()) { // 담이: 엄마다! — 신나서 앙! → 컹컹 (방에 들어설 때는 작게: 휴대폰 소리를 크게 해 둬도 놀라지 않게)
    const m = o.mode, tag = 'mom'; cancelPhrase(tag);
    if (m === 'busy') { voice('content', { gain: -2, rate: 1.1, why: 'mom' }); return; }
    if (m === 'quick') { play('dami_yip', { force: 1, gain: -8, why: 'mom' }); return; }
    const first = m === 'entry', g = first ? -10 : m === 'again' ? -6 : -3;
    later(0.2, () => play('dami_yip', { force: 1, gain: g - 2, why: 'mom' }), tag);
    later(0.75, () => barkBurst(first ? 2 : Math.random() < 0.4 ? 3 : 2, { force: 1, gain: g, why: 'mom', tag }), tag);
    return;
  }
  if (name === 'greet') {
    // 방에 들어설 때는 놀라지 않게: 인식표가 먼저 짤랑, 그다음 작게 "멍" 한 번 (o.double이면 멍, 멍)
    if (st) st.greetT = T;
    play('tag_jingle', { force: 1, gain: 1, why: 'greet' });
    later(0.28, () => voice('woof', { force: 1, gain: o.gain ?? -6, why: 'greet' }));
    if (o.double) later(0.66 + Math.random() * 0.08, () => voice('woof', { force: 1, rate: 0.944, gain: (o.gain ?? -6) - 2, why: 'greet' }));
  } else if (name === 'mom') { // 엄마다! — 헉 → 낑(올라가며) → 멍 멍 → (가끔) 아루
    // mode: 'entry' 방에 들어설 때는 놀라지 않게 작게(인식표 짤랑 → 낑 → 멍 한두 번, 아루 없음) · 'again' 돌아왔을 때 · 'quick' 다른 걸 하다가 알아보기만(낑 한 번) · 'busy' 입에 뭘 물고 있을 때(음~)
    const m = o.mode, tag = 'mom'; cancelPhrase(tag);
    if (m === 'busy') { voice('content', { gain: -2, rate: 1.1, why: 'mom' }); return; }
    if (m === 'quick') { voice('whine', { force: 1, vlo: 0, vhi: 2, gain: -7, rate: 1.08, why: 'mom' }); return; }
    if (m === 'entry' || m === 'again') {
      const first = m === 'entry', g = first ? -5 : -3, two = first ? Math.random() < 0.5 : Math.random() < 0.6;
      play('tag_jingle', { force: 1, gain: first ? 1 : -1, why: 'mom' });
      if (!first && Math.random() < 0.6) later(0.1, () => play('gasp_alert', { gain: -3, why: 'mom' }), tag);
      later(0.35, () => voice('whine', { force: 1, vlo: 0, vhi: 2, gain: g - 1, why: 'mom' }), tag);
      later(1.05 + Math.random() * 0.1, () => voice(!first && Math.random() < 0.35 ? 'yip' : 'woof', { force: 1, gain: g, why: 'mom' }), tag);
      if (two) later(1.5 + Math.random() * 0.12, () => voice('woof', { force: 1, rate: 0.944, gain: g - 2, why: 'mom' }), tag);
      return;
    }
    play('gasp_alert', { force: 1, why: 'mom' });
    later(0.3, () => voice('whine', { force: 1, variant: 0, gain: 2, why: 'mom' }), tag);
    later(1.05, () => voice('woof', { force: 1, gain: 1, why: 'mom' }), tag);
    later(1.45, () => voice('woof', { force: 1, rate: 0.944, gain: -1, why: 'mom' }), tag);
    if (Math.random() < 0.25 && T - lastAroo > 60) { lastAroo = T; later(2.4, () => voice('aroo', { force: 1, gain: -2, why: 'mom' }), tag); }
  } else if (name === 'found') { // 떨어진 간식 발견 — 킁킁이 빨라지다 헉 → 덥석 → 와작 (그 뒤 촵촵은 씹는 동안 저절로)
    if (st) { st.sniffFast = T + 0.8; st.sniffRest = 0; st.foundT = T; }
    later(0.8, () => play('gasp_alert', { force: 1, why: 'found' }), 'found');
    later(1.1, () => play('treat_take', { force: 1, why: 'found' }), 'found');
    later(1.25, () => { if (st) { st.foundT = T; st.foundBig = T; st.gulpAfter = true; } }, 'found'); // 와작은 물고 고개를 든 뒤 실제로 씹기 시작할 때 (첫 턱 닫힘)
  } else if (name === 'beg') { voice('whine', { force: 1, vlo: 2, vhi: 4, why: 'beg' }); later(1.0, () => voice('whine', { force: 1, vlo: 0, vhi: 2, gain: -3, why: 'beg' })); }
}

// ---------------------------------------------------------------- 말풍선 → 소리
let chewKind = 'auto', lickKind = 'auto';
const has = (s, ...ws) => ws.some((w) => s.includes(w));
function onSay(text) {
  if (!live() || !st) return;
  const s = String(text).replace(/[\s…!.~]/g, ''), q = String(text).includes('?'), roam = prev && prev.cmd === 'roam';
  st.lastSay = s; st.lastSayT = T;
  if (s === '' && String(text).includes('!')) return void play('gasp_alert', { why: text });
  if (has(s, '엄마다', '엄마당')) return void phrase('mom');
  if (isDami() && damiSay(s, String(text))) return;
  if (isPupu() && pupuSay(s, String(text))) return;
  // 핑키의 마음(엉뚱한 짓 · 주워 먹기 · 남긴 밥)에서 뜨는 말풍선
  if (has(s, '내꺼야')) return void voice('growl', { gain: -1, rate: 1.18, why: text }); // 장난스럽게 으르릉
  if (has(s, '놀아줘', '왔어', '왔다왔다', '엄마~')) return void voice('content', { gain: -1, rate: 1.08, why: text }); // 반가워서 음~ (조르는 낑이 아니다)
  if (has(s, '음엄마')) return void voice('content', { gain: -4, rate: 0.9, why: text + ' (sleepy)' });
  if (has(s, '간식주면', '바꿀래', '같이할래')) { if (Math.random() < 0.5) voice('content', { gain: -2, rate: 1.12, why: text }); else play(huff(), { gain: -2, rate: 0.9, why: text + ' (huff)' }); return; } // 흥정할 때: 기대에 찬 음? / 흥
  if (has(s, '안들려')) return void play('snort', { gain: -3, why: text });
  if (has(s, '이번만')) return void voice('content', { gain: -3, rate: 0.92, why: text });
  if (has(s, '자,여기')) return void voice('yip', { gain: -6, why: text });
  if (has(s, '이제줄게')) return void voice('yip', { gain: -4, why: text });
  if (has(s, '밥남았지')) return void play('gasp_alert', { why: text });
  if (has(s, '찾았다', '주웠다', '횡재', '맛있다', '다먹었다', '배불러')) return void voice('content', { gain: -1, why: text });
  if (has(s, '간식이다', '요거트다', '고구마다')) { play('gasp_alert', { why: text }); later(0.22, () => voice('whine', { vlo: 0, vhi: 2, gain: -3, rate: 1.12, why: text })); return; }
  if (has(s, '왈')) return void voice('yip', { why: text });
  if (has(s, '컹')) { voice('yip', { why: text }); if (has(s, '컹컹')) later(0.24, () => voice('yip', { force: 1, rate: 1.05, gain: -2, why: text })); return; } // 담이: 컹! · 컹컹! (잘 짖는다)
  if (has(s, '바삭')) { st.accent = true; play('crinkle', { gain: -3, why: text }); return; } // 담이: 패트병 바삭
  if (has(s, '파바')) return void play('dig_scratch', { pos: feet(), gain: 2, why: text }); // 담이: 파바박! (땅 파기)
  if (has(s, '와그작')) { st.accent = true; return; }
  if (has(s, '멍')) { if (T - (st.greetT ?? -9) > 1.5) voice('woof', { why: text }); return; } // 인사할 때의 '멍!'은 phrase('greet')가 이미 소리를 냈다
  if (has(s, '아우', '아루')) return void voice('aroo', { why: text });
  if (s === '앙') return void play(String(text).includes('!') ? 'chomp_ball' : 'treat_take', { why: text }); // 앙! = 공·로프를 덥석 · 앙 = 간식을 살며시 받아 문다
  if (has(s, '으르')) return void voice('growl', { why: text });
  if (has(s, '으응')) { if (T - (lastT.growl_play ?? -9) > 1.7) voice('growl', { gain: -5, rate: 1.2, why: text }); return; } // 으응! · 끄으응! — 물고 버티며 힘주는 소리 (짧고 작게, 으르릉 바로 뒤에는 쉰다)
  if (s === '응?') return void voice('whimper', { gain: 4, rate: 0.8, why: text }); // 응…? — 자다 불려서 잠결에
  if (has(s, '쭈욱')) { if (T - (lastT.yawn ?? -9) > 6) voice('yawn', { gain: -2, why: text }); else voice('content', { rate: 0.9, why: text }); return; } // 기지개: 방금 하품했으면 낮게 끄응
  if (has(s, '꿀꺽')) return void play('gulp', { gain: 2, why: text });
  if (has(s, '쩝')) { st.accent = true; st.smackT = T; return; }
  if (has(s, '냠', '챱', '촵', '와구', '와작', '아작', '오독', '쫀득', '질겅', '우물')) { st.accent = true; if (has(s, '쫀득')) st.softT = T; return; }
  if (has(s, '할짝')) { if (prev && prev.lick > 0 && T - (lastT.lick ?? -9) > 0.2) lap('say'); return; }
  if (has(s, '킁')) { if (T - (st.kungT ?? -9) > 2.5 && T >= st.sniffRest) st.sniffLeft = Math.max(st.sniffLeft, 4); st.kungT = T; return; } // 쉬는 틈은 그대로 둔다 (킁킁킁 … 킁킁킁)
  if (has(s, '후우')) { if (T - (lastT.sigh ?? -9) > 3) voice('sigh', { why: text }); return; }
  if (has(s, '쿨', '드르렁')) { // 말풍선이 떠 있는 동안 코를 곤다: 다음 들숨이 멀면 지금 바로 (그 사이 숨소리는 한 번 쉰다)
    const wait = (TAU - ((((SLEEP_W * T + Math.PI / 2) % TAU) + TAU) % TAU)) / SLEEP_W;
    if (prev && prev.pose === 'curl' && prev.eyeOpen < 0.12 && wait > 0.9 && T - (lastT.snore ?? -9) > 3) { st.breathHold = T + 1.5; st.lastSnore = st.breathN; play('snore', { gain: -2, why: text }); } else st.snoreNext = true;
    return;
  }
  if (has(s, '잘잤다', '하암')) return void voice('yawn', { why: text });
  if (has(s, '부르르')) return void play('shake', { why: text });
  if (has(s, '에취')) { play('sneeze', { why: text }); later(0.1, () => play('tag_jingle', { gain: 3, force: 1 })); return; }
  if (has(s, '뒹굴')) { play('flop_soft', { pos: feet(), gain: -2, gap: 1.2, why: text }); later(0.5, () => voice('content', { why: text })); return; } // 뒹굴 때는 털썩이 아니라 부스럭
  if (has(s, '좋아', '포근', '달다', '재밌었다')) return void voice('content', { why: text });
  if (has(s, '♥')) { if (prev && (prev.touchActive || prev.cmd === 'pet')) { play('pat', { why: 'pat' }); if (++st.hearts % 3 === 0) voice('content', { gain: -2, why: '♥' }); } return; }
  if (has(s, '밥그릇비었네')) return void play('snort', { why: text });
  if (has(s, '더해줘', '밥줘', '간식있어', '하나더', '하나만더', '더없어', '또던져', '또하자', '주세요', '줘')) {
    if (roam && Math.random() < 0.5) return;
    if (prev && prev.pose === 'curl') { voice('content', { gain: -3, why: text + ' (sleepy)' }); return; } // 방석에서 잠결에 조를 때는 낑 대신 낮게 음…
    const up = q || has(s, '또던져', '또하자'), beg = has(s, '밥줘', '주세요'); // 진짜 조를 때만 늘 낑, 나머지("하나 더?" 따위)는 가끔만 — 즐거운 일 끝마다 우는 소리가 나지 않게
    if (beg || (T - (st.askT ?? -99) > 28 && Math.random() < 0.4)) { if (voice('whine', { vlo: up ? 0 : 2, vhi: up ? 2 : 4, gain: beg ? 0 : -3, why: text })) st.askT = T; }
    else if (Math.random() < 0.5) voice('content', { gain: -2, why: text }); else play(huff(), { gain: -3, rate: 0.85, why: text + ' (huff)' });
    return;
  }
}

// 푸푸만의 말풍선 → 소리 (엄근진: 말수가 적고, 짖을 때는 낮고 묵직하게. 못 알아들은 말은 핑키와 같은 규칙으로 — 그때 나는 목소리도 푸푸의 낮은 목소리)
const PUPU_HUFF_GAP = 8; // '…, 이상 무.' 훕 사이 (초)
function pupuSay(s, text = s) {
  const n = (s.match(/월/g) || []).length;
  if (n) { if (!wolBurst(n, { force: has(s, '지킨', '누구', '물러', '거기', '엄마'), why: text })) play('pupu_chuff', { gain: -6, why: text + ' (holds back)' }); return true; } // 월! · 월월! · 월월월! — 20초에 두 묶음까지만 (지킬 때 · 엄마 앞에서는 언제든), 넘치면 낮게 웝 한 번으로 참는다
  if (has(s, '그르르', '으르릉')) return voice('growl', { why: text }), true; // 낮게 깔리는 경고
  if (has(s, '충성')) return play('pupu_chuff', { force: 1, gain: -2, why: text }), true; // 충성! — 짧고 낮은 웝
  if (has(s, '이상무')) { const big = text.includes('!'); if (big || T - (st.huffT ?? -99) > PUPU_HUFF_GAP) { st.huffT = T; play('pupu_huff', { force: 1, gain: big ? 0 : -3, why: text }); } return true; } // 이상 무! — 가슴으로 흡족하게 훕 (보고하는 '이상 무!'는 늘, 돌아다니며 하는 '…, 이상 무.'는 8초에 한 번만 · 조금 작게)
  if (s.startsWith('흠')) { const h = Math.min(3, s.match(/^흠+/)[0].length); for (let i = 0; i < h; i++) { const fn = () => play('pupu_hum', { force: 1, gain: -i * 2.5, rate: 1 - i * 0.03, why: text }); if (i) later(i * 0.42, fn, 'hum'); else fn(); } return true; } // 흠. · 흠흠. — 점잖게 따져 본다
  if (has(s, '끄응', '끼잉')) return voice('whimper', { force: 1, gain: 2, why: text }), true; // 끄응…! — 꾹 참다 새어 나오는 낮은 낑 (터키츄 앞에서만 체통이 무너진다)
  if (has(s, '터키츄다')) { play('gasp_alert', { why: text }); later(0.22, () => voice('whine', { vlo: 0, vhi: 2, gain: -3, rate: 1.12, why: text })); return true; }
  if (/^((터키)?츄+)+$/.test(s)) { voice('whine', { force: 1, vlo: 0, vhi: 2, gain: -4, why: text }); later(0.55, () => play('pupu_chuff', { force: 1, gain: -3, why: text }), 'chu'); return true; } // 터키츄!! · 츄츄츄 — 체통이 무너진다: 조르는 낮은 낑 → 웝!
  if (has(s, '물이다')) { play('gasp_alert', { why: text }); later(0.25, () => voice('content', { gain: -3, why: text })); return true; } // 물이다 — 헉 → 낮게 음 (반가워도 점잖게)
  if (has(s, '멍')) { if (T - (st.greetT ?? -9) > 1.5) wolBurst(1, { why: text }); return true; }
  if (has(s, '하이파이브', '또해요', '최고')) return voice('yip', { gain: -5, why: text }), true; // 낮은 웝
  if (has(s, '시원하다', '헤헤', '뿌듯', '깔끔')) return voice('content', { gain: -1, why: text }), true;
  if (s === '끙') return voice('content', { gain: -6, rate: 0.82, why: text }), true;
  if (s.startsWith('휴')) return voice('sigh', { gain: -4, why: text }), true;
  if (has(s, '손', '짝', '첨벙', '슥슥', '척', '똥츄', '빙글', '꼴깍', '퐁')) return true; // 소리는 main.js가 그 순간에 직접 낸다 (첨벙 · 짝 · 슥슥 · 바스락)
  return false;
}
// 담이만의 말풍선 → 소리 (못 알아들은 말은 핑키와 같은 규칙으로: 그때 나는 목소리는 담이 목소리)
function damiSay(s, text) {
  const n = (s.match(/컹/g) || []).length;
  if (n) return barkBurst(n, { why: text }), true; // 컹! · 컹컹! · 컹컹컹!
  if (s.startsWith('흥')) return play('snort', { gain: -2, why: text }), true;
  if (s === '쿡') return play('sniff', { variant: 0, gain: -3, why: text }), true; // 코로 쿡
  if (has(s, '왈')) return barkBurst(1, { why: text }), true;
  if (has(s, '멍')) { if (T - (st.greetT ?? -9) > 1.5) barkBurst(1, { why: text }); return true; }
  if (has(s, '내구역', '저리가', '누구야')) return voice('growl', { gain: has(s, '누구야') ? -3 : 0, why: text }), true; // 센 척: 그르렁 아르!
  if (has(s, '나만봐', '배만져')) return voice('whine', { vlo: 0, vhi: 2, gain: -4, rate: 1.1, why: text }), true; // 샘나서 / 졸라서 끄응?
  if (has(s, '우다다')) { play('dami_yip', { why: text }); later(0.17, () => play('dami_yip', { gain: -3, why: text })); return true; }
  if (s === '엄마' || has(s, '이것봐요', '지렁이댄스', '출근', '왔어', '왔다왔다', '보고드립니다')) return play('dami_yip', { gain: has(s, '출근', '왔어') ? -8 : -4, why: text }), true;
  if (has(s, '봐준다')) return voice('content', { gain: -3, rate: 0.94, why: text }), true;
  return false;
}

// ---------------------------------------------------------------- 매 프레임: 상태를 보고 소리를 낸다
const feet = () => (prev ? [prev.x, 0.02, prev.z] : head);
const nearBowl = (s) => Math.hypot(s.x - cfg.bowl[0], s.z - cfg.bowl[1]) < 0.6;
function lap(why, kind) {
  const s = prev, k = kind || (lickKind !== 'auto' ? lickKind : s && s.pose === 'eat' && nearBowl(s) ? 'bowl' : 'mouth');
  const smack = k === 'mouth' && T - (st.smackT ?? -9) < 1.6;
  play(k === 'bowl' ? 'lick_bowl' : k === 'yogurt' ? 'lick_yogurt' : k === 'water' ? 'water_lap' : 'lick', { ...(k === 'mouth' ? (smack ? { vlo: 4, vhi: 6 } : { vlo: 0, vhi: 4 }) : {}), why });
}
// main.js가 직접 알려 주는 박자 (요거트 핥기 · 고구마 말랑이/로프 씹기 · 물고 흔들기 · 로프가 떨어질 때): 그 움직임은 pinky.chew/lick을 쓰지 않아서 위의 상태 읽기로는 알 수 없다
function chewHit(kind = 'soft') { // 턱이 닫힐 때마다 한 번. 'soft' = 쫀득한 간식(촉촉하게, 가끔 쩝) · 'rope' = 줄을 질겅(더 낮고 작게)
  if (!live() || !st) return;
  if (kind === 'crunch' || kind === 'wood' || kind === 'bottle') return crunchHit(kind);
  const rope = kind === 'rope', acc = st.accent; st.accent = false; st.toyChewI = (st.toyChewI || 0) + 1;
  if (!rope && Math.random() < 0.45) later(0.28 + Math.random() * 0.06, () => play('smack', { gain: -1, why: 'mouth opens (chewy)' }));
  play('chomp_soft', { delay: Math.random() * 0.02, gain: ACC[st.toyChewI % 3] + (acc ? 1.5 : 0) + (rope ? -4 : 0), rate: rope ? 0.82 : 0.92, why: 'jaw close (' + kind + ')' + (acc ? ' +accent' : '') });
}
// 담이: 'crunch' = 덴탈껌 오독 · 'wood' = 나뭇가지 와그작(더 낮게) · 'bottle' = 페트병을 깨물면 바삭
function crunchHit(kind) {
  const acc = st.accent; st.accent = false; st.toyChewI = (st.toyChewI || 0) + 1;
  if (kind === 'bottle') return void play('crinkle', { gain: -2 + (acc ? 2 : 0) + ACC[st.toyChewI % 3], why: 'bite (bottle)' + (acc ? ' +accent' : '') });
  const wood = kind === 'wood';
  play('chomp_crunch', { delay: Math.random() * 0.02, gain: ACC[st.toyChewI % 3] + (acc ? 1.5 : 0) + (wood ? -3 : 0), rate: wood ? 0.8 : 1, why: 'jaw close (' + kind + ')' + (acc ? ' +accent' : '') });
}
function shakeHit(amp = 1) { // 고개가 한쪽 끝에 닿을 때마다: 귀·줄이 퍼덕, 가끔 인식표. '부르르' 소리가 나는 동안에는 쉰다(그 소리에 이미 들어 있다)
  if (!live() || !st || T - (lastT.shake ?? -9) < 1.25) return;
  st.flapN = (st.flapN || 0) + 1;
  play('flap', { gain: toDb(clamp(amp, 0.3, 1.4)) + (st.flapN & 1 ? -2 : 0), why: 'head shake' });
  if (st.flapN % 4 === 0) play('tag_jingle', { gain: -5, gap: 0.3, why: 'head shake' });
}
function ropeDrop(pos, delay = 0, gain = 0) { if (!live()) return; later(Math.max(0, delay), () => play('rope_drop', { pos, gain: gain + (pos && surfaceAt(pos[0], pos[2]) !== 'wood' ? -3 : 0), why: 'rope lands' })); }
function newState() { return { hearts: 0, sighDone: false, breathHold: 0, chewN: 0, chewI: 0, skipAt: 7, sniffLeft: 4, sniffRest: 0, sniffAlt: false, sniffFast: 0, breathN: 0, lastSnore: -9, pantT: 0, pour: null, kibN: 0, kibbleAcc: 0, speed: 0, stepRate: 0 }; }
const ACC = [0, -3, -1.5]; // 촵-촵-촵: 세게 · 여리게 · 중간
function update(dt, t, s) {
  const tp = T; T = t;
  if (queue.length) for (let i = queue.length - 1; i >= 0; i--) if (queue[i].at <= T) { const q = queue[i]; queue.splice(i, 1); if (live()) q.fn(); }
  fatigue = Math.max(0, fatigue - dt * 0.1);
  if (!s || scene !== 'room') { prev = null; if (ctx && !offline && ctx.state === 'running' && now() - lastGesture > 1500 && !voices.length) ctx.suspend(); return; } // 친구들 화면에서는 소리 장치를 쉬게 둔다
  if (s.head) head = s.head;
  if (!st) st = newState();
  const p = prev || s; prev = s;
  if (!live()) return;
  const wrap = (w, ph = 0) => Math.floor((w * t + ph) / TAU) !== Math.floor((w * tp + ph) / TAU); // sin(w·t)의 한 주기가 넘어갔는가
  const ft = [s.x, 0.02, s.z], asleep = s.pose === 'curl' && s.eyeOpen < 0.12, surf = surfaceAt(s.x, s.z);
  st.speed += (Math.hypot(s.x - p.x, s.z - p.z) / Math.max(dt, 1e-3) - st.speed) * 0.3;

  // 잠들면 다른 소리는 조금 작게
  if (ctx && (s.pose === 'curl') !== st.hush) { st.hush = s.pose === 'curl'; mainBus.gain.setTargetAtTime(st.hush ? 0.5 : 1, ctx.currentTime, 1.5); }

  // 씹기: 턱이 닫힐 때마다 촵
  if (s.chew) {
    const kind = chewKind !== 'auto' ? chewKind : s.pose === 'eat' && nearBowl(s) ? 'kibble' : T - (st.softT ?? -9) < 3 ? 'soft' : 'treat';
    if (!p.chew) {
      st.chewN = 0; st.chewI = 0; st.skipAt = 6 + Math.floor(Math.random() * 4);
      st.bigFirst = (kind !== 'kibble' && T - (st.foundBig ?? -9) < 3.5) || (s.pose === 'eat' && kind !== 'kibble' && T - (st.foundT ?? -9) > 2.5); st.foundBig = -9; // 바닥에서 주운 간식: 첫입은 와작
      if (kind !== 'kibble' && T - (st.foundT ?? -9) > 2.5) play('treat_take', { why: 'chew on' });
    }
    if (wrap(CHEW_W, Math.PI / 2)) {
      st.chewN++;
      if (st.chewN === st.skipAt) { st.skipAt += 6 + Math.floor(Math.random() * 4); if (Math.random() < 0.3) play('gulp', { why: 'swallow' }); }
      else if (st.bigFirst) { st.bigFirst = false; st.chewI++; play('crunch_big', { why: 'jaw close (first bite)' }); }
      else {
        const acc = st.accent; st.accent = false;
        if (Math.random() < 0.4) later(0.17 + Math.random() * 0.04, () => play('smack', { gain: -1, why: 'mouth opens' })); // 입이 다시 벌어질 때 쩝
        if (st.chewI % 4 === 3) later(0.2, () => play('sniff', { variant: 1 + 2 * Math.floor(Math.random() * 3), gain: -9, force: 1, why: 'nose breath' })); // 먹다가 코로 숨
        play(kind === 'kibble' ? 'chomp_kibble' : kind === 'soft' ? 'chomp_soft' : 'chomp_treat', { delay: Math.random() * 0.02, gain: ACC[st.chewI++ % 3] + (acc ? 1.5 : 0), ...(acc ? { variant: [0, 1, 2, 4, 5, 6][Math.floor(Math.random() * (kind === 'soft' ? 3 : 6))] } : {}), why: 'jaw close' + (acc ? ' +accent' : '') });
        if (kind === 'kibble' && Math.random() < 0.35) play('bowl_tick', { pos: [cfg.bowl[0], 0.03, cfg.bowl[1]], why: 'kibble on bowl' });
      }
    }
  } else if (p.chew && (st.chewN >= 3 || st.gulpAfter) && (st.gulpAfter || Math.random() < 0.6)) { st.gulpAfter = false; later(0.22, () => play('gulp', { why: 'swallow' })); }

  // 핥기: 혀가 한 번 오갈 때마다 할짝 (시작하자마자 한 번)
  if (s.lick > 0) { if (!(p.lick > 0)) lap('lick on'); else if (wrap(LICK_W)) lap('tongue'); }

  // 냄새 맡기: 킁킁킁 … 킁킁킁 (서너 번씩 묶어서)
  if (s.sniff > 0.05) {
    if (wrap(2 * SNIFF_W) && t >= st.sniffRest) {
      st.sniffAlt = !st.sniffAlt;
      if (s.sniff >= 0.6 || st.sniffAlt) {
        st.sniffK = !st.sniffK;
        play('sniff', { variant: (st.sniffK ? 0 : 1) + 2 * Math.floor(Math.random() * 3), gain: toDb(0.4 + 0.6 * s.sniff) - 2 + (Math.random() * 3 - 1.5) + (s.sniff < 0.6 ? -6 : 0), why: 'sniff bob' });
        if (--st.sniffLeft <= 0) { st.sniffLeft = 3 + Math.floor(Math.random() * 4); st.sniffRest = t + (t < st.sniffFast ? 0.12 : 0.25 + Math.random() * 0.25); }
      }
    }
  } else if (p.sniff >= 0.9 && Math.random() < 0.25) later(0.25, () => play('snort', { why: 'after sniff' }));

  // 헥헥
  if (s.pant && !s.chew && !(s.lick > 0) && !asleep) {
    st.pantT += dt; const duck = -3 - 4 * clamp((st.pantT - 1.5) / 1.5, 0, 1); // 처음부터 살살, 이어지면 더 작게
    if (isDami()) { const g = duck - 5 - 3 * clamp((st.pantT - 4) / 4, 0, 1); if (wrap(DAMI_PANT_W, -Math.PI / 2)) play('dami_pant_out', { gain: g, why: 'pant' }); else if (wrap(DAMI_PANT_W, Math.PI / 2)) play('dami_pant_in', { gain: g, why: 'pant' }); } // 담이: 혀를 길게 빼고 더 빠르게 헥헥 (핑키보다 5 dB 작게 깔고, 오래 이어지면 더 작게 — 짖는 소리를 가리지 않게)
    else if (wrap(PANT_W, -Math.PI / 2)) play('pant_out', { gain: duck, why: 'pant' });
    else if (wrap(PANT_W, Math.PI / 2)) play('pant_in', { gain: duck, why: 'pant' });
  } else st.pantT = 0;

  // 한숨 · 자는 숨 · 코골이 · 꿈
  if (s.sigh < p.sigh && p.sigh > 0.5 && !st.sighDone) { st.sighDone = true; voice('sigh', { why: 'sigh (chest falls)' }); } // 가슴이 부풀었다 꺼지기 시작할 때 후우…
  if (s.sigh < 0.05) st.sighDone = false;
  if (asleep) {
    if (!(s.sigh > 0.15) && T >= st.breathHold) {
      if (wrap(SLEEP_W, Math.PI / 2)) {
        st.breathN++;
        if (st.snoreNext || (st.breathN - st.lastSnore >= 4 && Math.random() < 0.12)) { st.snoreNext = false; st.lastSnore = st.breathN; play('snore', { why: 'inhale (snore)' }); }
        else play('sleep_in', { why: 'inhale' });
      } else if (wrap(SLEEP_W, -Math.PI / 2)) play('sleep_out', { why: 'exhale' });
    }
    if (s.paddle > 0.1 && !(p.paddle > 0.1)) { // 꿈속 발짓: 대부분 조용히 바스락, 가끔만 작게 꿈꾸는 소리 (우는 소리로 들리지 않게)
      if (T - (st.dreamT ?? -99) > 28 && Math.random() < 0.34) { st.dreamT = T; st.dreamN = (st.dreamN || 0) + 1; if (st.dreamN % 2) play(isPupu() ? 'pupu_chuff' : 'bark_woof', { rate: 0.8, gain: -12, nofat: 1, why: 'dream boof' }); else voice('whimper', { rate: 1.1, gain: -5, why: 'dream' }); }
      else if (surf === 'cushion') play('tail_cushion', { pos: ft, gain: -6, why: 'dream rustle' });
    }
  } else { st.snoreNext = false; if (s.paddle > 0.1 && surf === 'cushion' && wrap(KNEAD_W)) play('knead', { pos: ft, why: 'knead' }); }

  // 발소리: 발이 땅에 닿는 순간 (마루는 발톱 소리, 러그·방석은 폭신하게) + 인식표
  if (s.gait > 0.25 && s.pose !== 'held' && s.lift < 0.2) {
    const turning = st.speed < 0.06, fastGait = st.speed > 0.8;
    for (let i = 0; i < 4; i++) {
      const u = (((s.phase / TAU + cfg.off[i]) % 1) + 1) % 1, u0 = (((p.phase / TAU + cfg.off[i]) % 1) + 1) % 1;
      if (u < u0 && u0 - u > 0.5) {
        const front = i < 2; if (fastGait && !front) continue; // 빨리 달릴 때는 앞발만 (너무 다닥거리지 않게)
        play(surf === 'water' ? 'step_splash' : surf === 'path' ? 'step_path' : surf === 'wood' ? 'step_wood' : surf === 'rug' ? 'step_rug' : 'step_cushion', { pos: ft, gain: toDb(clamp(st.speed / 0.9, 0.5, 1.3)) + (front ? 0 : -2) + (turning ? -6 : 0), why: 'paw ' + i });
        if (front && st.speed >= 0.8 && Math.random() < 0.4) play('tag_jingle', { pos: head, why: 'trot' });
      }
    }
  }

  // 시냇물 (남산 산책길): 졸졸 소리 토막을 겹쳐 튼다 — 듣는 자리에서 가장 가까운 물가 쪽에서
  if (cfg.brook && T >= (st.brookT ?? 0)) {
    st.brookT = T + 0.85 + Math.random() * 0.3; let bp = cfg.brook[0], bd = 1e9;
    for (const q of cfg.brook) { const dd = Math.hypot(q[0] - L.p[0], q[2] - L.p[2]); if (dd < bd) { bd = dd; bp = q; } }
    play('brook', { pos: bp, gain: cfg.brookGain ?? 0, force: 1, why: 'brook' });
  }

  // 꼬리가 바닥을 탁탁
  const lying = s.pose === 'down' || s.pose === 'side' || s.pose === 'belly' || s.pose === 'curl';
  const tc = cfg.tail; // 놀이터(담이): 모래 위라 작게, 아주 빨리 흔들 때는 북처럼 두드리지 않고 몇 번에 한 번만 (사락사락)
  if (s.wagAmp > 0.1 && Math.floor(s.wagPhase / TAU) !== Math.floor(p.wagPhase / TAU) && !(tc && T - (st.tailT ?? -9) < tc.gap)) {
    if (tc) st.tailT = T;
    if (lying) play(surf === 'cushion' ? 'tail_cushion' : 'tail_floor', { pos: ft, gain: toDb(clamp(s.wagAmp / 0.5, 0.3, 1.2)) + (surf === 'rug' ? -4 : 0) + (tc ? tc.gain : 0), why: 'tail' });
    else if (s.pose === 'sit' && s.wagAmp > 0.6 && !lite) play('swish', { pos: ft, ...(tc ? { gain: tc.gain } : {}), why: 'tail' });
  }

  // 자세가 바뀔 때: 눕는 소리 · 일어날 때 짤랑
  if (s.pose !== p.pose) {
    const was = p.pose === 'down' || p.pose === 'side' || p.pose === 'belly' || p.pose === 'curl';
    if (lying && was) { if (s.pose !== 'down') later(0.35, () => play('flop_soft', { pos: ft, gain: -4, gap: 1.2, why: 'roll to ' + s.pose })); } // 누운 채 뒤척일 때는 부스럭만
    else if (lying) later(0.35, () => play(surf === 'cushion' ? 'flop_soft' : 'flop', { pos: ft, gain: surf === 'rug' ? -3 : 0, why: 'pose ' + s.pose }));
    else if (s.pose === 'sit' && p.pose === 'stand') later(0.3, () => { play('tag_jingle', { gain: -3, why: 'sit' }); play(surf === 'wood' ? 'step_wood' : 'step_rug', { pos: ft, gain: -2, why: 'sit' }); }); // 앉을 때: 인식표 짤랑 + 엉덩이 톡
    else if (s.pose === 'stand' && was) later(0.45, () => play('tag_jingle', { gain: 2, why: 'get up' }));
  }

  // 사료 붓기: 바탕 소리 + 알알이 그릇에 떨어지는 소리 (그릇이 찰수록 둔해진다)
  if (s.pouring && !p.pouring) { play('scoop', { pos: s.bowl, why: 'pour' }); const e = play('pour_bed', { pos: s.bowl, why: 'pour' }); st.pour = e && e.vo ? e.vo : null; if (st.pour) st.pour.loop = true; }
  if (!s.pouring && p.pouring && st.pour) { fadeOut(st.pour, 80); st.pour = null; }
  const inb = Math.round((s.mound - p.mound) * 40), gone = p.kibbles - s.kibbles;
  if (inb > 0 || gone > 0) {
    st.kibbleAcc += Math.max(gone, inb, 1);
    if (T - (lastT.kibble_hit ?? -9) >= 0.045) {
      const dull = Math.random() < s.mound, n = st.kibbleAcc; st.kibbleAcc = 0;
      if (inb > 0 || s.mound >= 1) play('kibble_hit', { pos: s.bowl, vlo: dull ? 4 : 0, vhi: dull ? 8 : 4, gain: Math.min(4, 2 * (n - 1)) - 4 * s.mound, why: 'kibble x' + n });
      else play('kibble_floor', { pos: s.bowl, why: 'kibble miss' });
    }
  }

  // 공: 바닥에 튈 때(세로 속도가 뒤집힘) · 벽이나 가구에 맞을 때(가로 방향이 꺾임)
  const b = s.ball, pb = p.ball;
  if (b && pb && b.on && pb.on) {
    const bp = [b.x, b.y, b.z], bs = surfaceAt(b.x, b.z);
    if (pb.vy < -0.5 && b.vy > 0) { const sp = Math.abs(pb.vy); play('ball_bounce', { pos: bp, gain: clamp(20 * Math.log10(sp / 3), -16, 4) + (bs !== 'wood' ? -4 : 0), rate: bs !== 'wood' ? 0.9 : 1, why: 'bounce ' + sp.toFixed(1) + 'm/s' }); }
    else { const h0 = Math.hypot(pb.vx, pb.vz), h1 = Math.hypot(b.vx, b.vz); if (h0 > 0.5 && h1 > 0.1 && (pb.vx * b.vx + pb.vz * b.vz) / (h0 * h1) < 0.8) play('ball_bounce', { pos: bp, gain: clamp(20 * Math.log10(h0 / 3), -16, 4) - 6, why: 'ball hits wall' }); }
  }
}

// ---------------------------------------------------------------- 내보내기
function wav(x, sampleRate = 48000) { // Float32Array → 16비트 WAV(ArrayBuffer)
  const n = x.length, ab = new ArrayBuffer(44 + n * 2), d = new DataView(ab), w = (o, s) => { for (let i = 0; i < s.length; i++) d.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); d.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true);
  d.setUint32(24, sampleRate, true); d.setUint32(28, sampleRate * 2, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true); w(36, 'data'); d.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) d.setInt16(44 + i * 2, Math.round(clamp(x[i], -1, 1) * 32767), true);
  return ab;
}
export const sound = {
  init, unlock, setEnabled, setScene, update, onSay, phrase, voice, stopAll, render, wav, log, surfaceAt,
  sfx: play,
  get enabled() { return enabled; },
  get supported() { return !broken && (typeof window === 'undefined' || !!(window.AudioContext || window.webkitAudioContext)); }, // 소리를 낼 수 없는 브라우저면 false (버튼을 숨긴다)
  get ctx() { return ctx; },
  get out() { return comp; },
  get now() { return T; },
  get names() { return Object.keys(DEF); },
  get defs() { return DEF; },
  get stats() { return { renderMs: +renderMs.toFixed(1), buffers: bufs.size, pending: renderQ.length, voices: voices.length, state: ctx ? ctx.state : 'none', scene, enabled }; },
  configure(o) { // 장소를 바꿀 때: 바닥(rug · cush · bowl, 또는 surf(x, z) → 'wood' · 'rug' · 'cushion' · 'grass' · 'path' · 'water') · 목소리(voice: 'pinky' · 'dami' · 'pupu') · 시냇물(brook: 물가의 점들, 없으면 null)
    cfg = { ...cfg, ...o };
    if (o && o.voice === 'dami' && renderQ.length) renderQ.sort((a, b) => (b[0].startsWith('dami_') ? 1 : 0) - (a[0].startsWith('dami_') ? 1 : 0)); // 담이 목소리부터 미리 그려 둔다
    else if (o && o.voice === 'pupu' && renderQ.length) renderQ.sort(pupuFirst); // 푸푸 목소리부터
  },
  get voiceName() { return cfg.voice || 'pinky'; },
  bark(n, o) { return isPupu() ? wolBurst(n, o) : barkBurst(n, o); }, // 담이: 컹컹 한 묶음 (n: 1~3) · 푸푸: 월월 (20초에 두 묶음, o.force면 언제든)
  wol: wolBurst, // 푸푸: 월 n번 (n: 1~3) — 짖었으면 n, 아껴서 못 짖었으면 0
  setListener(p, r) { L = { p, r }; },
  setChewKind(k) { chewKind = k || 'auto'; },
  setLickKind(k) { lickKind = k || 'auto'; },
  ballBounce(speed, pos, surface) { play('ball_bounce', { pos, gain: clamp(20 * Math.log10(Math.max(speed, 0.01) / 3), -16, 4) + (surface && surface !== 'wood' ? -4 : 0), why: 'bounce' }); },
  lap(kind = 'mouth') { if (live() && st) lap('lap (' + kind + ')', kind); }, // 'yogurt' · 'mouth' · 'bowl'
  chewHit, shakeHit, ropeDrop, hush, cancelPhrase,
  // 담이(놀이터)만: 모래를 한 번 긁을 때 · 패트병이 바삭 · 장난감이 모래에 떨어질 때 ('bottle' · 'stick')
  digHit(pos, gain = 0) { play('dig_scratch', { pos, gain, why: 'dig stroke' }); },
  crinkle(pos, gain = 0) { play('crinkle', { pos, gain, why: 'bottle crinkle' }); },
  toyDrop(kind, pos, delay = 0) { if (!live()) return; later(Math.max(0, delay), () => (kind === 'bottle' ? play('crinkle', { pos, gain: -4, why: 'bottle lands' }) : play('rope_drop', { pos, rate: 0.8, gain: 3, why: kind + ' lands' }))); },
  kibbleHit(inBowl, pos, fill = 0) { const dull = Math.random() < fill; play(inBowl ? 'kibble_hit' : 'kibble_floor', { pos, ...(inBowl ? { vlo: dull ? 4 : 0, vhi: dull ? 8 : 4 } : {}), why: 'kibble' }); },
  exportWav(name, v = 0) { return new Blob([wav(render(name, v, 48000), 48000)], { type: 'audio/wav' }); },
  _fake(on = true) { fake = on; }, // 점검용: 소리 장치 없이 기록만
  _useContext(c) { offline = true; makeGraph(c); scene = 'room'; }, // 점검용: OfflineAudioContext에 그대로 그려 보기
  _tick(t) { T = t; },
};
export default sound;
