import * as THREE from 'three';
import { EffectComposer } from './vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from './vendor/jsm/postprocessing/ShaderPass.js';

const $ = (s) => document.querySelector(s);
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ================================================================
// 렌더러
// ================================================================
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas: $('#c'), antialias: false, powerPreference: 'high-performance' });
} catch (e) {
  $('#boot').textContent = '이 기기에서는 3D 화면을 열 수 없어요.';
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const SPH = new THREE.SphereGeometry(1, 24, 18);
const LITE = window.matchMedia('(max-width: 760px)').matches || (navigator.hardwareConcurrency || 8) <= 4;
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 2 }));
const renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
composer.addPass(renderPass);
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.22, 0.55, 0.92);
const gradePass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uVig: { value: 0.32 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uVig; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      col = mix(col, col * vec3(1.04, 1.0, 0.94), 0.6);
      col = (col - 0.5) * 1.04 + 0.5;
      float d = distance(vUv, vec2(0.5));
      col *= mix(1.0, 1.0 - uVig, smoothstep(0.35, 0.85, d));
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
});
function M(color, o = {}) { return new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, ...o }); }
function add(parent, geo, mat, p, r, s, cast = true) {
  const m = new THREE.Mesh(geo, mat);
  if (p) m.position.set(p[0], p[1], p[2]);
  if (r) m.rotation.set(r[0], r[1], r[2]);
  if (s != null) { if (typeof s === 'number') m.scale.setScalar(s); else m.scale.set(s[0], s[1], s[2]); }
  m.castShadow = cast; m.receiveShadow = true;
  parent.add(m); return m;
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, seg = 24) => new THREE.CylinderGeometry(rt, rb, h, seg);
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
const glowTex = canvasTex(64, 64, (x, w) => {
  const g = x.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, w, w);
});
function glow(parent, color, size, p, opacity = 0.8) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.scale.setScalar(size); s.position.set(p[0], p[1], p[2]); parent.add(s); return s;
}

// ================================================================
// 강아지 (나이 든 비글 비율 · 다리 관절 3개 · 털 무늬는 정점 색)
// ================================================================
const COLORS = {
  // 핑키: 노견이라 채도가 낮고 바랜 색. 얼굴·귀는 연한 베이지, 안장은 회색 털이 섞인 차콜, 가슴·배·다리는 크림빛 흰색
  pinky: { base: 0xf3ede3, tan: 0xc9a97e, headTan: 0xd4b891, ear: 0xc2a57e, saddle: 0x2c2d31, grizzle: 0x8f8d89, nose: 0x1c1816, collar: 'ribbon', medal: true },
  pupu: { base: 0xf1e6d2, tan: 0xe7d0ab, saddle: 0xe7d0ab, nose: 0x6f4a46 },
  generic: { base: 0xe9e1d6, tan: 0xc99a6c, saddle: 0x4a3c34, nose: 0x1c1513 },
};
const P = (x, y, z) => V3(x, y, z);
// paws: 발 위치(강아지 바닥 기준). lean: 발목 아래 마디 기울기(0 = 수직, π/2 = 바닥에 눕힘). free: 1이면 다리를 곧게 뻗음
// 비글(핑키): 어깨 관절 (±0.05, 0, 0.2) · 고관절 (±0.055, -0.02, -0.2) 기준. 꼬리는 낮게 수평에 가깝게 든다
const POSES = {
  stand: { bodyY: 0.28, bodyZ: 0, pitch: 0, roll: 0, yawOff: -0.5, gaze: 1, headPitch: 0, headTilt: 0, tail: -1.6, level: 1, free: 0,
    lean: [0.15, 0.15, 0.3, 0.3], paws: [P(0.058, 0.03, 0.175), P(-0.058, 0.03, 0.175), P(0.068, 0.03, -0.225), P(-0.068, 0.03, -0.225)] },
  sit: { bodyY: 0.185, bodyZ: -0.04, pitch: -0.5, roll: 0, yawOff: -0.6, gaze: 1, headPitch: 0, headTilt: 0, tail: -1.25, level: 1, free: 0,
    lean: [0.12, 0.12, 1.5, 1.5], paws: [P(0.058, 0.03, 0.14), P(-0.058, 0.03, 0.14), P(0.11, 0.03, 0.1), P(-0.11, 0.03, 0.1)] },
  down: { bodyY: 0.125, bodyZ: -0.02, pitch: 0.02, roll: 0, yawOff: -0.7, gaze: 1, headPitch: 0, headTilt: 0, tail: -1.55, level: 1, free: 0,
    lean: [1.5, 1.5, 1.2, 1.2], paws: [P(0.06, 0.03, 0.37), P(-0.06, 0.03, 0.37), P(0.08, 0.03, -0.02), P(-0.08, 0.03, -0.02)] },
  side: { bodyY: 0.125, bodyZ: 0, pitch: 0, roll: 1.45, yawOff: -1.15, gaze: 0.6, headPitch: 0.15, headTilt: 0.2, tail: -1.5, level: 0, free: 0.85,
    lean: [0.3, 0.3, 0.3, 0.3], paws: [P(0.4, 0.12, 0.24), P(0.37, 0.16, 0.17), P(0.4, 0.12, -0.2), P(0.37, 0.16, -0.27)] },
  belly: { bodyY: 0.135, bodyZ: 0, pitch: 0, roll: 2.45, yawOff: -1.15, gaze: 0.75, headPitch: -0.2, headTilt: -0.55, tail: -1.4, level: 0, free: 0.7,
    lean: [0.6, 0.6, 0.4, 0.4], paws: [P(0.22, 0.38, 0.26), P(0.13, 0.4, 0.17), P(0.24, 0.35, -0.17), P(0.15, 0.38, -0.24)] },
  eat: { bodyY: 0.235, bodyZ: 0.05, pitch: 0.3, roll: 0, yawOff: 0, gaze: 0, headPitch: 0.8, headTilt: 0, tail: -1.3, level: 1, free: 0,
    lean: [0.35, 0.35, 0.3, 0.3], paws: [P(0.058, 0.03, 0.25), P(-0.058, 0.03, 0.25), P(0.068, 0.03, -0.2), P(-0.068, 0.03, -0.2)] },
  held: { bodyY: 0.2, bodyZ: 0, pitch: -1.15, roll: 0, yawOff: 0, gaze: 1, headPitch: 0, headTilt: 0, tail: -1.9, level: 0, free: 1,
    lean: [0.1, 0.1, 0.15, 0.15], paws: [P(0.08, 0.13, 0.2), P(-0.08, 0.13, 0.2), P(0.075, -0.17, 0.0), P(-0.075, -0.17, 0.0)] },
};
// 진돗개(푸푸): 예전 몸통·다리 기준 그대로
const POSES_J = {
  stand: { bodyY: 0.305, bodyZ: 0, pitch: 0, roll: 0, yawOff: -0.5, gaze: 1, headPitch: 0, headTilt: 0, tail: -0.35, level: 1, free: 0,
    lean: [0.2, 0.2, 0.3, 0.3], paws: [P(0.07, 0.03, 0.145), P(-0.07, 0.03, 0.145), P(0.075, 0.03, -0.12), P(-0.075, 0.03, -0.12)] },
  sit: { bodyY: 0.175, bodyZ: -0.03, pitch: -0.85, roll: 0, yawOff: -0.6, gaze: 1, headPitch: 0, headTilt: 0, tail: -0.72, level: 1, free: 0,
    lean: [0.15, 0.15, 1.5, 1.5], paws: [P(0.065, 0.03, 0.11), P(-0.065, 0.03, 0.11), P(0.095, 0.03, 0.06), P(-0.095, 0.03, 0.06)] },
  down: { bodyY: 0.13, bodyZ: -0.02, pitch: 0.02, roll: 0, yawOff: -0.7, gaze: 1, headPitch: 0, headTilt: 0, tail: -1.4, level: 1, free: 0,
    lean: [1.5, 1.5, 1.5, 1.5], paws: [P(0.075, 0.03, 0.3), P(-0.075, 0.03, 0.3), P(0.11, 0.03, 0.0), P(-0.11, 0.03, 0.0)] },
  side: { bodyY: 0.125, bodyZ: 0, pitch: 0, roll: 1.45, yawOff: -1.15, gaze: 0.6, headPitch: 0.15, headTilt: 0.2, tail: -1.5, level: 0, free: 0.85,
    lean: [0.3, 0.3, 0.3, 0.3], paws: [P(0.36, 0.12, 0.17), P(0.33, 0.16, 0.1), P(0.36, 0.12, -0.13), P(0.33, 0.16, -0.19)] },
  belly: { bodyY: 0.135, bodyZ: 0, pitch: 0, roll: 2.45, yawOff: -1.15, gaze: 0.75, headPitch: -0.2, headTilt: -0.55, tail: -1.4, level: 0, free: 0.7,
    lean: [0.6, 0.6, 0.4, 0.4], paws: [P(0.2, 0.34, 0.19), P(0.12, 0.36, 0.1), P(0.22, 0.31, -0.1), P(0.14, 0.34, -0.17)] },
  eat: { bodyY: 0.22, bodyZ: 0.05, pitch: 0.4, roll: 0, yawOff: 0, gaze: 0, headPitch: 1.35, headTilt: 0, tail: -0.3, level: 1, free: 0,
    lean: [0.35, 0.35, 0.3, 0.3], paws: [P(0.07, 0.03, 0.18), P(-0.07, 0.03, 0.18), P(0.075, 0.03, -0.12), P(-0.075, 0.03, -0.12)] },
  held: { bodyY: 0.2, bodyZ: 0, pitch: -1.15, roll: 0, yawOff: 0, gaze: 1, headPitch: 0, headTilt: 0, tail: -1.9, level: 0, free: 1,
    lean: [0.1, 0.1, 0.15, 0.15], paws: [P(0.09, 0.15, 0.17), P(-0.09, 0.15, 0.17), P(0.08, -0.15, 0.02), P(-0.08, -0.15, 0.02)] },
};
const POSE_KEYS = ['bodyY', 'bodyZ', 'pitch', 'roll', 'yawOff', 'gaze', 'headPitch', 'headTilt', 'tail', 'level', 'free'];

function poseFor(name, d) {
  const p = (d.J ? POSES_J : POSES)[name];
  const o = { ...p, name, lean: [...p.lean], paws: p.paws.map((v) => v.clone()) };
  if (d.J && (name === 'stand' || name === 'eat')) o.bodyY += 0.035;
  return o;
}
function setPose(d, name, rate = 5) {
  const p = poseFor(name, d);
  for (const k of POSE_KEYS) d.tgt[k] = p[k];
  d.tgt.name = name;
  p.paws.forEach((v, i) => d.tgt.paws[i].copy(v));
  d.tgt.lean = [...p.lean];
  d.poseRate = rate;
}

const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const wob = (p, f) => Math.sin(p.x * f * 1.3 + p.z * f) * Math.sin(p.y * f * 0.9 - p.z * f * 0.7);
const hash3 = (p) => { const s = Math.sin(p.x * 127.1 + p.y * 311.7 + p.z * 74.7) * 43758.5453; return s - Math.floor(s); };

// ---------- 거리장(SDF) → 매끈한 한 덩어리 메시 (surface nets)
const sdE = (x, y, z, cx, cy, cz, rx, ry, rz) => {
  const px = (x - cx) / rx, py = (y - cy) / ry, pz = (z - cz) / rz;
  const k0 = Math.sqrt(px * px + py * py + pz * pz), k1 = Math.sqrt((px / rx) ** 2 + (py / ry) ** 2 + (pz / rz) ** 2);
  return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(rx, ry, rz);
};
const sdCap = (x, y, z, ax, ay, az, bx, by, bz, r) => {
  const pax = x - ax, pay = y - ay, paz = z - az, bax = bx - ax, bay = by - ay, baz = bz - az;
  const h = clamp((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz), 0, 1);
  const dx = pax - bax * h, dy = pay - bay * h, dz = paz - baz * h;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
};
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const smax = (a, b, k) => -smin(-a, -b, k);
function surfaceNet(sdf, b0, b1, h) {
  const nx = Math.ceil((b1[0] - b0[0]) / h) + 1, ny = Math.ceil((b1[1] - b0[1]) / h) + 1, nz = Math.ceil((b1[2] - b0[2]) / h) + 1;
  const F = new Float32Array(nx * ny * nz), id = (i, j, k) => i + nx * (j + ny * k);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) F[id(i, j, k)] = sdf(b0[0] + i * h, b0[1] + j * h, b0[2] + k * h);
  const cx = nx - 1, cy = ny - 1, cz = nz - 1, V = new Int32Array(cx * cy * cz).fill(-1), cid = (i, j, k) => i + cx * (j + cy * k);
  const C = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const pos = [], nor = [], v = new Float32Array(8), e = h * 0.5;
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
    let neg = 0;
    for (let c = 0; c < 8; c++) { v[c] = F[id(i + C[c][0], j + C[c][1], k + C[c][2])]; if (v[c] < 0) neg++; }
    if (neg === 0 || neg === 8) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of E) {
      if ((v[a] < 0) === (v[b] < 0)) continue;
      const t = v[a] / (v[a] - v[b]);
      sx += C[a][0] + (C[b][0] - C[a][0]) * t; sy += C[a][1] + (C[b][1] - C[a][1]) * t; sz += C[a][2] + (C[b][2] - C[a][2]) * t; n++;
    }
    const px = b0[0] + (i + sx / n) * h, py = b0[1] + (j + sy / n) * h, pz = b0[2] + (k + sz / n) * h;
    V[cid(i, j, k)] = pos.length / 3; pos.push(px, py, pz);
    const gx = sdf(px + e, py, pz) - sdf(px - e, py, pz), gy = sdf(px, py + e, pz) - sdf(px, py - e, pz), gz = sdf(px, py, pz + e) - sdf(px, py, pz - e);
    const gl = Math.hypot(gx, gy, gz) || 1; nor.push(gx / gl, gy / gl, gz / gl);
  }
  const idx = [];
  const quad = (a, b, c, d) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    const ux = pos[b * 3] - ax, uy = pos[b * 3 + 1] - ay, uz = pos[b * 3 + 2] - az, wx = pos[c * 3] - ax, wy = pos[c * 3 + 1] - ay, wz = pos[c * 3 + 2] - az;
    const fx = uy * wz - uz * wy, fy = uz * wx - ux * wz, fz = ux * wy - uy * wx;
    if (fx * nor[a * 3] + fy * nor[a * 3 + 1] + fz * nor[a * 3 + 2] >= 0) idx.push(a, b, c, a, c, d); else idx.push(a, c, b, a, d, c);
  };
  for (let k = 1; k < cz; k++) for (let j = 1; j < cy; j++) for (let i = 1; i < cx; i++) {
    const s0 = F[id(i, j, k)] < 0;
    if (s0 !== F[id(i + 1, j, k)] < 0) quad(V[cid(i, j - 1, k - 1)], V[cid(i, j, k - 1)], V[cid(i, j, k)], V[cid(i, j - 1, k)]);
    if (s0 !== F[id(i, j + 1, k)] < 0) quad(V[cid(i - 1, j, k - 1)], V[cid(i, j, k - 1)], V[cid(i, j, k)], V[cid(i - 1, j, k)]);
    if (s0 !== F[id(i, j, k + 1)] < 0) quad(V[cid(i - 1, j - 1, k)], V[cid(i, j - 1, k)], V[cid(i, j, k)], V[cid(i - 1, j, k)]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}
const sdRB = (x, y, z, cx, cy, cz, hx, hy, hz, r) => { // 모서리 둥근 상자
  const qx = Math.abs(x - cx) - hx + r, qy = Math.abs(y - cy) - hy + r, qz = Math.abs(z - cz) - hz + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
};
const ZS = 0.85;
// 비글 몸통: 길고 깊은 가슴의 네모진 틀. 등선은 거의 수평, 가슴·어깨가 가장 넓고, 갈비 뒤에서 배가 살짝 올라붙으며(tuck-up), 머리 앞에 목이 보인다
const beagleBodySDF = (x, y, z) => {
  let d = sdRB(x, y, z, 0, 0.0, 0.0, 0.082, 0.108, 0.2, 0.065); // 몸통 틀: 폭 0.164 · 높이 0.216 · 길이 0.4
  d = smin(d, sdE(x, y, z, 0, -0.008, 0.16, 0.1, 0.118, 0.1), 0.05); // 갈비·가슴: 가장 깊고 넓다
  d = smin(d, sdE(x, y, z, 0, -0.01, 0.245, 0.055, 0.065, 0.04), 0.04); // 앞가슴(prosternum)
  for (const sx of [1, -1]) d = smin(d, sdE(x, y, z, sx * 0.055, 0.03, 0.16, 0.042, 0.09, 0.07), 0.04); // 어깨·위팔 덩어리
  d = smin(d, sdE(x, y, z, 0, 0.0, -0.19, 0.08, 0.09, 0.07), 0.04); // 골반·엉덩이
  for (const sx of [1, -1]) d = smin(d, sdE(x, y, z, sx * 0.056, -0.04, -0.19, 0.03, 0.065, 0.055), 0.035); // 허벅지 뿌리(작은 볼록)
  d = smin(d, sdCap(x, y, z, 0, 0.06, 0.16, 0, 0.105, 0.225, 0.062), 0.05); // 목: 짧고 굵게 어깨에서 머리 밑으로
  d = smin(d, sdE(x, y, z, 0, 0.07, -0.235, 0.03, 0.03, 0.04), 0.035); // 꼬리 뿌리
  return smax(d, -sdE(x, y, z, 0, -0.19, -0.13, 0.3, 0.12, 0.15), 0.05); // 배가 뒤로 가며 올라붙음
};
const bodySDF = (J) => (J ? (x, y, z) => {
  z /= ZS;
  let d = sdCap(x / 0.92, y, z, 0, 0, -0.13, 0, 0, 0.13, 0.13);
  d = smin(d, sdE(x, y, z, 0, -0.012, 0.135, 0.12, 0.128, 0.118), 0.05);
  for (const sx of [1, -1]) d = smin(d, sdE(x, y, z, sx * 0.058, -0.012, -0.135, 0.07, 0.1, 0.105), 0.04);
  d = smin(d, sdCap(x, y, z, 0, 0.03, 0.15, 0, 0.11, 0.235, 0.08), 0.05);
  return smax(d, -sdE(x, y, z, 0, -0.19, -0.02, 0.2, 0.07, 0.11), 0.04);
} : beagleBodySDF);
// 비글 머리: 넓고 둥근 두개골 · 완만한 이마 단(stop) · 눈 아래에서 코까지 완만히 내려가는 네모진 주둥이 · 처진 윗입술(flews) · 통통한 볼 · 얕은 눈구멍
// 눈은 머리 위쪽 40% 선에, 코는 눈보다 한 눈 반 아래에 두어 '하관'이 읽히게 한다
// 머리 좌표: 원점은 목 위 회전축. 두개골 폭 0.12 · 눈 (±0.028, 0.07, 0.085) · 코 끝 z≈0.175 · 뒤통수 z≈-0.1
const headBase = (x, y, z) => {
  const ax = Math.abs(x);
  let d = sdE(x, y, z, 0, 0.044, 0.0, 0.066, 0.062, 0.072); // 두개골: 넓고 둥근 돔
  d = smin(d, sdE(x, y, z, 0, 0.072, 0.03, 0.056, 0.048, 0.05), 0.03); // 이마: 눈 위로 둥글게 솟아 주둥이와 단(stop)을 만든다
  d = smin(d, sdE(x, y, z, 0, 0.04, -0.04, 0.054, 0.052, 0.045), 0.035); // 뒤통수
  for (const sx of [1, -1]) d = smin(d, sdE(x, y, z, sx * 0.036, 0.006, 0.04, 0.028, 0.034, 0.05), 0.03); // 볼
  d = smin(d, sdE(x, y, z, 0, -0.016, 0.0, 0.047, 0.03, 0.06), 0.035); // 턱 밑·목덜미: 귀가 기댈 살
  for (const sx of [1, -1]) d = smin(d, sdE(x, y, z, sx * 0.029, 0.058, 0.07, 0.019, 0.019, 0.02), 0.02); // 눈 둘레: 눈이 살 위에 앉고 옆에서도 보이게
  // 주둥이: 모서리를 둥글린 네모 상자(길고 깊고 뭉툭). 단에서 코까지 거의 곧고 앞으로 가며 살짝 좁아진다. 아랫면 앞쪽은 코 밑으로 물러난다
  const t = clamp((z - 0.06) / 0.125, 0, 1);
  const cy = lerp(0.022, 0.022, t), hw = lerp(0.032, 0.027, t), hh = lerp(0.036, 0.033, t), rr = 0.017;
  const qx = ax - (hw - rr), qy = Math.abs(y - cy) - (hh - rr);
  let m = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rr;
  m = smax(m, z - 0.185 + Math.max(0, 0.034 - y) * 0.35, 0.02);
  d = smin(d, Math.max(m, 0.03 - z), 0.03);
  for (const sx of [1, -1]) d = smin(d, sdE(x, y, z, sx * 0.014, -0.009, 0.125, 0.02, 0.021, 0.052), 0.025); // 윗입술(flews): 코 밑에서 양옆으로 처져 아래턱을 덮는다
  for (const sx of [1, -1]) d = smin(d, sdE(x, y, z, sx * 0.022, -0.016, 0.09, 0.011, 0.016, 0.02), 0.02); // 입꼬리 쪽이 가장 깊게 처진다
  d = smin(d, sdE(x, y, z, 0, -0.013, 0.132, 0.013, 0.013, 0.034), 0.02); // 가운데 메움(갈라진 틈 없음)
  return smax(d, -sdCap(x, y, z, 0, 0.024, 0.188, 0, -0.014, 0.182, 0.0015), 0.002); // 인중
};
// 입선: 인중 밑에서 입꼬리까지 윗입술 아래 가장자리를 따라가는 점들. 짧고(약 70°) 끝으로 가며 윗입술 속으로 사라진다. 각 점을 머리 속에서 바깥으로 쏘아 표면에 붙인다
const LIP = (() => {
  const pts = [];
  for (let i = 0; i <= 6; i++) {
    const u = i / 6, y = lerp(-0.01, -0.025, Math.pow(u, 1.3)), ang = u * 1.2, dx = Math.sin(ang), dz = Math.cos(ang);
    let r = 0.004; while (r < 0.08 && headBase(dx * r, y, 0.125 + dz * r) < 0.0003) r += 0.0004;
    pts.push([dx * r, y, 0.125 + dz * r, u]);
  }
  return pts;
})();
let lipU = 0; // lipDist가 마지막으로 잰 가장 가까운 입선 위치(0 = 인중, 1 = 입꼬리)
const lipDist = (x, y, z) => { // 입선(좌우 대칭)까지의 거리
  const ax = Math.abs(x); let d = 1e9; lipU = 0;
  for (let i = 0; i < LIP.length - 1; i++) {
    const s = sdCap(ax, y, z, LIP[i][0], LIP[i][1], LIP[i][2], LIP[i + 1][0], LIP[i + 1][1], LIP[i + 1][2], 0);
    if (s < d) { d = s; lipU = LIP[i][3]; }
  }
  return d;
};
const headSDF = (J) => (J ? (x, y, z) => {
  let d = sdE(x, y, z, 0, 0.055, 0.02, 0.105, 0.095, 0.1);
  for (const sx of [1, -1]) d = smin(d, sdE(x, y, z, sx * 0.045, 0.02, 0.06, 0.055, 0.05, 0.055), 0.03);
  d = smin(d, sdCap(x / 1.05, y / 0.9, z, 0, 0.011, 0.1, 0, 0.011, 0.13, 0.043), 0.03);
  for (const sx of [1, -1]) d = smin(d, sdE(x, y, z, sx * 0.038, 0.094, 0.083, 0.028, 0.014, 0.022), 0.02);
  for (const sx of [1, -1]) d = smax(d, -sdE(x, y, z, sx * 0.04, 0.066, 0.096, 0.019, 0.016, 0.011), 0.006);
  return d;
} : (x, y, z) => { const h = headBase(x, y, z), l = lipDist(x, y, z); return smax(h, (0.0007 - l) * (1 - ss(0.6, 1, lipU)), 0.002); }); // 입선은 가는 골로 파되 입꼬리로 가며 사라진다
// 코: 둥글둥글한 검은 덩어리(가죽 패드). 콧구멍은 바깥 아래로 기울어진 쉼표꼴, 옆으로 째진 콧방울 골, 가운데 인중 골
const noseSDF = (x, y, z) => {
  let d = sdRB(x, y, z, 0, 0, 0, 0.0185, 0.013, 0.0115, 0.009);
  d = smin(d, sdE(x, y, z, 0, 0.002, 0.0, 0.0175, 0.012, 0.0125), 0.006);
  for (const sx of [1, -1]) {
    const cs = Math.cos(0.5), sn = Math.sin(0.5) * sx, lx = x - sx * 0.0078, ly = y + 0.0025;
    d = smax(d, -sdE(cs * lx - sn * ly, sn * lx + cs * ly, z - 0.0115, 0, 0, 0, 0.0033, 0.0025, 0.005), 0.0025);
    d = smax(d, -sdCap(x, y, z, sx * 0.0105, -0.004, 0.011, sx * 0.0155, -0.0085, 0.0055, 0.0012), 0.002);
  }
  return smax(d, -sdCap(x, y, z, 0, -0.0035, 0.0115, 0, -0.014, 0.0105, 0.0016), 0.002);
};
// 비글 귀: 눈높이에서 시작해 볼에 바짝 붙어 곧게 내려오는 길고 넓고 납작한 귓볼. 머리를 감싸는 원통면 위의 둥근 판으로 만든다
const EAR_L = 0.19;
const earFrame = (sx, x0, y, z) => {
  const t = clamp(-y / EAR_L, 0, 1);
  // 반지름: 맨 위는 두개골에 묻혀 붙고, 접히듯 살짝 나와 두개골 가장 넓은 곳(0.06)을 스치듯 지나, 내려가며 좁아지는 볼·턱 밑에 안긴다
  const R = 0.06 + 0.011 * ss(0, 0.22, t) - 0.012 * ss(0.4, 0.7, t) - 0.006 * ss(0.7, 1, t);
  const dx = x0 * sx + 0.062, dz = z - 0.015;
  const cAng = lerp(0.2, 0.5, ss(0.05, 0.6, t)); // 눈 바로 뒤에서 시작해 볼을 감싸며 내려와 정면에서도 얼굴을 감싸 보인다
  const hw = lerp(0.03, 0.04, ss(0.1, 0.8, t)), w = (Math.atan2(dz, dx) - cAng) * R;
  return { t, hw, w, n: Math.hypot(dx, dz) - R + 0.006 * (w / hw) * (w / hw) }; // 가장자리는 머리 쪽으로 살짝 오므라든다(숟가락처럼)
};
const earSDF = (sx) => (x0, y, z) => {
  const { t, hw, w, n } = earFrame(sx, x0, y, z);
  const rr = 0.03, qx = Math.abs(w) - (hw - rr), qy = Math.abs(y + EAR_L / 2) - (EAR_L / 2 - rr);
  const d2 = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rr;
  const dn = Math.abs(n) - lerp(0.006, 0.0032, ss(0, 0.4, t)); // 위쪽(접힌 부분)은 두툼하고 아래로 갈수록 얇다
  return Math.hypot(Math.max(d2, 0), Math.max(dn, 0)) + Math.min(Math.max(d2, dn), 0) - 0.002;
};
// 꼬리: 뿌리가 굵고 끝으로 가늘어지며 끝으로 가며 살짝 위로 휘는 한 덩어리 (낮게 수평에 가깝게 든다)
const TAIL_P = [[0, 0, 0, 0.024], [0, 0.05, 0.003, 0.021], [0, 0.1, 0.012, 0.018], [0, 0.145, 0.028, 0.014], [0, 0.185, 0.05, 0.01]];
const tailSDF = (x, y, z) => {
  let d = 1e9;
  for (let i = 0; i < TAIL_P.length - 1; i++) {
    const a = TAIL_P[i], b = TAIL_P[i + 1], bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2];
    const h = clamp(((x - a[0]) * bx + (y - a[1]) * by + (z - a[2]) * bz) / (bx * bx + by * by + bz * bz), 0, 1);
    d = smin(d, Math.hypot(x - a[0] - bx * h, y - a[1] - by * h, z - a[2] - bz * h) - lerp(a[3], b[3], h), 0.015);
  }
  return d;
};
// 발: 둥근 발바닥 덩어리 + 발가락 네 개
const footSDF = (x, y, z) => {
  let d = sdE(x, y, z, 0, -0.004, 0.005, 0.034, 0.023, 0.037);
  for (let i = 0; i < 4; i++) { const tx = (i - 1.5) * 0.018; d = smin(d, sdE(x, y, z, tx, -0.013, 0.033 + (Math.abs(i - 1.5) < 1 ? 0.004 : 0), 0.0115, 0.015, 0.0175), 0.008); }
  return d;
};
const sdfCache = {};
function sdfGeo(key, sdf, b0, b1, h) { if (!sdfCache[key]) sdfCache[key] = surfaceNet(sdf, b0, b1, h); return sdfCache[key].clone(); }
// 짧은 털: 같은 메시를 법선 방향으로 몇 겹 부풀리고 겹마다 털 가닥 사이를 구멍 낸다.
// 정면에서는 거의 비치지 않고 실루엣 가장자리에서만 보송하게 보이도록, 시선과 법선의 각도로 구멍 밀도를 조절한다
function furShells(mesh, count = 2, len = 0.002, den = 1600) {
  for (let i = 1; i <= count; i++) {
    const f = i / count, mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uShell = { value: f }; sh.uniforms.uLen = { value: len }; sh.uniforms.uDen = { value: den };
      sh.vertexShader = 'uniform float uShell; uniform float uLen; varying vec3 vOP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed += normal * uShell * uLen; vOP = position;');
      sh.fragmentShader = 'uniform float uShell; uniform float uDen; varying vec3 vOP;\nfloat furHash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }\n'
        + sh.fragmentShader
          .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n  { float rim = 1.0 - abs(dot(normalize(vViewPosition), normal)); float thr = pow(uShell, 0.6) * mix(1.6, 0.85, smoothstep(0.4, 0.95, rim)); if (furHash(floor(vOP * uDen)) < thr) discard; }')
          .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb *= mix(0.9, 1.03, uShell);');
    };
    mat.customProgramCacheKey = () => 'fur-shell';
    const s = new THREE.Mesh(mesh.geometry, mat); s.castShadow = false; s.receiveShadow = true; mesh.add(s);
  }
}

function buildDog({ kind, colors: C, silhouette = false, scale = 1, seed = 0 }) {
  const J = kind === 'jindo';
  const d = { kind, J, scale, seed, meshes: [], ears: [], eyes: [], legs: [] };
  const silMat = silhouette ? new THREE.MeshStandardMaterial({ color: 0x2b201b, roughness: 0.9, emissive: 0x170f0b }) : null;
  // 짧고 촘촘한 털: 거친 무광 바탕에 실루엣 가장자리만 보송하게 밝아지는 솜털(프레넬)
  const fur = silMat || new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.9, sheen: 0.35, sheenRoughness: 0.85, sheenColor: new THREE.Color(0xfff4e8) });
  if (!silMat) {
    fur.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n  { float fz = pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 3.0); diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.2 + 0.05, fz * 0.5); }');
    };
    fur.customProgramCacheKey = () => 'fur-fuzz';
  }
  const cW = new THREE.Color(C.base), cT = new THREE.Color(C.tan), cB = new THREE.Color(C.saddle);
  const cH = new THREE.Color(C.headTan ?? C.tan), cE = new THREE.Color(C.ear ?? C.tan), cG = new THREE.Color(C.grizzle ?? 0x8a8078);
  const cTailDark = cB.clone().lerp(cG, 0.3), cRim = new THREE.Color(0x4a3a2e), cGrey = new THREE.Color(0xc9c3bb), cMouth = new THREE.Color(0x4a2228), cLip = new THREE.Color(0x6a5248), cEarGrey = new THREE.Color(0x8d847a);
  const tone = (c, p, amt = 0.05) => c.multiplyScalar(1 + (hash3(p) - 0.5) * amt * 0.5 + wob(p, 45) * amt * 0.5);
  const _pv = new THREE.Vector3(), _pc = new THREE.Color(), _pz = new THREE.Vector3(), _pg = new THREE.Vector3(), _sad = new THREE.Color(), _pb = new THREE.Vector3();
  const sph = (w = 32, h = 24) => new THREE.SphereGeometry(1, w, h);
  const furry = [];
  const put = (par, geo, p, r, s, paint, mat) => {
    const m = new THREE.Mesh(geo, mat ? silMat || mat : fur);
    if (p) m.position.set(p[0], p[1], p[2]);
    if (r) m.rotation.set(r[0], r[1], r[2]);
    if (s != null) { const v = typeof s === 'number' ? [s, s, s] : s; if (mat) m.scale.set(v[0], v[1], v[2]); else geo.scale(v[0], v[1], v[2]); }
    m.castShadow = true; m.receiveShadow = true; par.add(m); d.meshes.push(m);
    if (!mat) furry.push(m);
    if (!silhouette && !mat && paint) {
      m.updateMatrix();
      const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        _pv.fromBufferAttribute(pos, i).applyMatrix4(m.matrix); paint(_pv, _pc);
        col[i * 3] = _pc.r; col[i * 3 + 1] = _pc.g; col[i * 3 + 2] = _pc.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    return m;
  };

  // 무늬
  const whitePaint = (p, c) => tone(c.copy(cW), p, 0.08);
  // 몸: 기갑(어깨)부터 꼬리 뿌리까지 회색 털이 섞인 차콜 안장이 옆구리 황갈로 번지듯 바래고 · 어깨·허벅지 황갈 · 가슴·배·목 앞은 크림빛 흰색
  const bodyPaint = J ? (p, c) => tone(c.copy(cW).lerp(cT, ss(0.0, 0.12, p.y) * 0.45), p, 0.05) : (p, c) => {
    const n = wob(p, 14) * 0.02 + wob(p, 38) * 0.007, ax = Math.abs(p.x);
    const lineY = -0.02 + 0.035 * ss(0.05, 0.24, p.z) + 0.03 * ss(-0.1, -0.24, p.z); // 안장 아래 경계: 가운데서 가장 낮고 어깨·엉덩이로 가며 올라감
    const black = ss(lineY - 0.02, lineY + 0.05, p.y + n) * ss(0.36, 0.27, p.z + (p.y - 0.1) * 0.5) * ss(-0.3, -0.24, p.z); // 목 위까지 이어지고 머리 바로 뒤에서 바랜다
    const belly = ss(-0.03, -0.08, p.y + n);
    const chest = ss(0.12, 0.2, p.z + n) * ss(0.1, 0.02, p.y - (p.z - 0.2) * 0.5 + n) * ss(0.085, 0.035, ax + n); // 흰 가슴 턱받이: 가운데 띠, 양옆 어깨·위팔은 황갈
    const grizzle = 0.04 + 0.08 * wob(p, 18) + 0.06 * wob(p, 45) + 0.1 * hash3(_pg.set(p.x * 80, p.y * 80, p.z * 80)) + 0.22 * ss(0.12, 0.3, p.z) + 0.4 * ss(lineY + 0.07, lineY, p.y); // 차콜에 회색 털이 섞임. 기갑·목과 안장 아래 가장자리는 더 회색
    _sad.copy(cB).lerp(cG, clamp(grizzle, 0, 1));
    const neck = ss(0.18, 0.3, p.z) * ss(-0.02, 0.06, p.y); // 목 옆: 머리 베이지로 이어진다
    tone(c.copy(cT).lerp(cH, neck * 0.7).lerp(_sad, black).lerp(cW, Math.max(belly, chest) * (1 - black * 0.9)), p, 0.04);
  };
  // 머리: 얼굴 전체가 연한 베이지(볼·입선까지) + 흰 주둥이·턱·목·가는 이마 줄, 관자놀이·주둥이 위는 회색이 섞인 노견, 부드러운 어두운 눈테
  const headPaint = J ? (p, c) => tone(c.copy(cW).lerp(cT, ss(0.1, 0.16, p.y) * 0.4), p, 0.05) : (p, c) => {
    const n = wob(p, 25) * 0.008 + wob(p, 60) * 0.003, ax = Math.abs(p.x);
    const muzzle = ss(0.088, 0.118, p.z + n + (p.y - 0.04) * 0.4); // 흰 주둥이: 콧등은 단(stop) 앞부터 희고, 볼 쪽 경계는 눈 밑에서 입꼬리로 비스듬히 내려간다(볼은 베이지)
    const lowY = lerp(-0.035, -0.02, ss(-0.08, 0.06, p.z));
    const under = ss(0.012, -0.012, p.y - lowY + n); // 턱 밑·목은 흰색
    const bw = 0.005 + Math.max(0, 0.1 - p.y) * 0.1;
    const blaze = ss(bw + 0.01, bw, ax + n) * ss(0.055, 0.085, p.z) * ss(0.115, 0.085, p.y) * 0.3; // 가는 이마 줄, 단 위에서 끝난다
    const white = Math.max(muzzle, under, blaze);
    const tan = 0.8 + 0.2 * ss(0.01, 0.09, p.y);
    tone(c.copy(cW).lerp(cH, tan * (1 - white)), p, 0.035);
    c.lerp(cGrey, 0.35 * ss(0.12, 0.17, p.z) * ss(0.072, 0.034, p.y) * (0.5 + 0.5 * hash3(_pg.set(p.x * 70, p.y * 70, p.z * 70)))); // 노견: 코 둘레 주둥이 위가 희끗
    c.lerp(cGrey, 0.15 * ss(0.03, 0.01, Math.abs(ax - 0.048)) * ss(0.055, 0.085, p.y) * ss(0.075, 0.03, p.z)); // 관자놀이 회색
    const ed = Math.hypot(ax - 0.028, (p.y - 0.063) * 1.0, (p.z - 0.095) * 1.6);
    const ring = ss(0.0215, 0.0165, ed), halo = ss(0.033, 0.018, ed); // 가는 아이라인 + 눈가 살짝 어두운 그늘
    const tear = ss(0.006, 0.0015, Math.abs(ax - 0.019 + (0.052 - p.y) * 0.15)) * ss(0.054, 0.047, p.y) * ss(0.022, 0.037, p.y) * ss(0.082, 0.097, p.z);
    c.lerp(cRim, Math.min(0.5, ring * 0.22 + halo * 0.05 + tear * 0.06));
    c.lerp(cLip, ss(0.0016, 0.0006, lipDist(p.x, p.y, p.z)) * 0.12 * (1 - ss(0.6, 1, lipU))); // 입선: 아주 연하게, 입꼬리로 가며 사라짐
  };
  // 귀: 머리보다 살짝 진한 베이지. 접힌 위쪽은 회색 털이 섞이고, 뿌리는 머리색으로 이어지고, 가장자리는 두께 그늘로 살짝 어둡다
  const earPaint = (sx) => (J ? whitePaint : (p, c) => {
    const { t, hw, w, n } = earFrame(sx, p.x, p.y, p.z);
    const edge = ss(0.7, 1.0, Math.abs(w) / hw), inner = ss(0.001, -0.002, n);
    const griz = (0.4 + 0.6 * hash3(_pg.set(p.x * 2.9, p.y * 2.3, p.z * 2.1))) * ss(0.55, 0.05, t);
    tone(c.copy(cE).multiplyScalar(0.95 + 0.05 * ss(0.1, 0.7, t)).lerp(cEarGrey, griz * 0.18 + edge * 0.06).lerp(cH, ss(0.15, 0, t) * 0.8).lerp(cW, Math.max(ss(0.85, 1, t) * 0.1, inner * 0.3)), p, 0.04);
  });
  const tailPaint = J ? whitePaint : (p, c) => tone(c.copy(cT).lerp(cTailDark, ss(0.08, 0.02, p.y) * 0.7).lerp(cW, ss(0.12, 0.15, p.y)), p, 0.05);
  const segPaint = (L, tanTop, tanBottom, fade = 0.65) => (J ? whitePaint : (p, c) => {
    const t = clamp(-p.y / L, 0, 1);
    tone(c.copy(cW).lerp(cT, lerp(tanTop, tanBottom, ss(0.0, fade, t))), p, 0.04);
  });
  // 목줄: 목 둘레를 돌며 몸 표면에서 살짝 띄운 점을 떠서 띠를 만든다 (어느 자세에서도 몸에 파묻히지 않게)
  const collarRing = (sdf, cc, axis, half, segs = 72) => {
    const u = V3(1, 0, 0), v = V3().crossVectors(axis, u).normalize(), dir = V3(), pos = [], nor = [], uv = [], idx = [], pts = [];
    const march = (dx, dy, dz) => { let r = 0.05; while (r < 0.3 && sdf(cc.x + dx * r, cc.y + dy * r, cc.z + dz * r) < 0.0035) r += 0.0008; return r; };
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      dir.copy(u).multiplyScalar(Math.cos(a)).addScaledVector(v, Math.sin(a));
      const r = march(dir.x, dir.y, dir.z), px = cc.x + dir.x * r, py = cc.y + dir.y * r, pz = cc.z + dir.z * r;
      if (i < segs) pts.push(V3(px, py, pz));
      for (const s of [-1, 1]) { pos.push(px + axis.x * s * half, py + axis.y * s * half, pz + axis.z * s * half); nor.push(dir.x, dir.y, dir.z); uv.push(i / segs, s * 0.5 + 0.5); }
      if (i < segs) { const b = i * 2; idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    const rf = march(-v.x, -v.y, -v.z);
    return { geo: g, pts, front: V3(cc.x - v.x * rf, cc.y - v.y * rf, cc.z - v.z * rf) };
  };

  d.root = new THREE.Group();
  const sc = new THREE.Group(); sc.scale.setScalar(scale); d.root.add(sc);
  const body = new THREE.Group(); sc.add(body); d.body = body;

  // 몸통 (몸통 · 가슴 · 엉덩이 · 목을 매끈하게 이은 한 덩어리)
  d.torso = put(body, sdfGeo(J ? 'jb' : 'bb', bodySDF(J), J ? [-0.17, -0.17, -0.3] : [-0.16, -0.17, -0.31], J ? [0.17, 0.2, 0.33] : [0.16, 0.22, 0.36], 0.006), null, null, null, bodyPaint);
  if (J) d.torso.userData.fur = [2, 0.002, 1600];
  if (!silhouette && C.collar) {
    const sdfB = bodySDF(J), ring = J ? collarRing(sdfB, V3(0, 0.068, 0.148), V3(0, 0.72, 0.69).normalize(), 0.011) : collarRing(sdfB, V3(0, 0.085, 0.195), V3(0, 0.5, 0.866).normalize(), 0.012);
    if (C.collar === 'ribbon') {
      // 빨강·흰·남색 줄무늬 리본: 몸 표면을 따라가는 얇은 띠
      const ribbonTex = canvasTex(8, 64, (x, w, h) => {
        let y0 = 0;
        for (const [col, fr] of [['#a8302f', 0.3], ['#f1ebe0', 0.14], ['#2b3a60', 0.12], ['#f1ebe0', 0.14], ['#a8302f', 0.3]]) { x.fillStyle = col; x.fillRect(0, Math.floor(y0 * h), w, Math.ceil(fr * h) + 1); y0 += fr; }
      });
      put(body, ring.geo, null, null, null, null, new THREE.MeshStandardMaterial({ map: ribbonTex, roughness: 0.65, side: THREE.DoubleSide }));
    } else put(body, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ring.pts, true), 72, 0.011, 10, true), null, null, null, null, M(C.collar, { roughness: 0.5 }));
    if (C.medal) {
      // 메달: 리본 앞 가장 낮은 점에 고리로 매달린 둥근 청동 판. 자세에 따라 가슴에 눕는 기울기는 updateDog에서 잡는다
      const md = new THREE.Group(); md.position.copy(ring.front); body.add(md); d.medal = md; d.medalSDF = sdfB;
      const bronze = new THREE.MeshPhysicalMaterial({ color: 0x8a6e4e, metalness: 0.75, roughness: 0.3, clearcoat: 0.3 });
      const bronzeHi = new THREE.MeshPhysicalMaterial({ color: 0xa08a66, metalness: 0.8, roughness: 0.25, clearcoat: 0.3 });
      put(md, new THREE.TorusGeometry(0.005, 0.0016, 6, 14), [0, -0.003, 0.002], [0, Math.PI / 2, 0], null, null, bronze);
      put(md, new THREE.CylinderGeometry(0.021, 0.021, 0.004, 32), [0, -0.027, 0.004], [Math.PI / 2, 0, 0], null, null, bronze);
      put(md, new THREE.TorusGeometry(0.0178, 0.0016, 6, 32), [0, -0.027, 0.0065], null, null, null, bronzeHi);
    }
  }

  // 머리
  const hp = new THREE.Group(); hp.rotation.order = 'YXZ'; hp.position.set(0, J ? 0.13 : 0.13, J ? 0.205 : 0.25); body.add(hp); d.hp = hp;
  const head = new THREE.Group(); head.scale.setScalar(J ? 1.3 : 1.1); hp.add(head); d.head = head;
  const skull = put(head, sdfGeo(J ? 'jh' : 'bh', headSDF(J), J ? [-0.135, -0.08, -0.13] : [-0.075, -0.06, -0.115], J ? [0.135, 0.175, 0.25] : [0.075, 0.14, 0.2], J ? 0.004 : 0.0028), null, null, null, headPaint);
  if (J) skull.userData.fur = [2, 0.0015, 1600];
  const noseM = new THREE.MeshPhysicalMaterial({ color: C.nose, roughness: J ? 0.3 : 0.5, clearcoat: J ? 0.6 : 0.3, clearcoatRoughness: J ? 0.25 : 0.45 });
  if (J) {
    put(head, sph(), [0, 0.03, 0.148], null, [0.021, 0.0155, 0.015], null, noseM);
    if (!silhouette) for (const sx of [1, -1]) put(head, sph(12, 8), [sx * 0.0072, 0.026, 0.16], [0, 0, sx * 0.4], [0.0048, 0.0032, 0.003], null, M(0x050303, { roughness: 0.6 }));
  } else {
    // 코: 주둥이 끝 위에 얹힌 둥근 검은 코 (콧구멍·콧방울 골·인중은 거리장에서 파냄) · 콧구멍 속 어둠. 입선은 머리 거리장에 골로 파고 색을 입힌다
    put(head, sdfGeo('bn', noseSDF, [-0.023, -0.016, -0.015], [0.023, 0.016, 0.015], 0.001), [0, 0.043, 0.182], null, null, null, noseM);
    if (!silhouette) for (const sx of [1, -1]) put(head, sph(12, 8), [sx * 0.0078, 0.0405, 0.1935], [0, 0, -sx * 0.5], [0.0028, 0.002, 0.002], null, M(0x050303, { roughness: 0.6 }));
  }
  const jaw = new THREE.Group(); jaw.position.set(0, J ? -0.02 : -0.014, 0.06); head.add(jaw); d.jaw = jaw;
  if (J) put(jaw, sph(), [0, -0.014, 0.05], null, [0.027, 0.013, 0.04], whitePaint);
  else put(jaw, sph(), [0, -0.006, 0.068], null, [0.017, 0.0085, 0.032], (p, c) => whitePaint(p, c).lerp(cGrey, 0.12).lerp(cMouth, ss(0.002, 0.006, p.y))); // 아래턱: 윗입술 안쪽에 들어가 턱 끝만 살짝 보인다. 윗면(입 속)은 어둡게
  const tongueRoot = new THREE.Group(); tongueRoot.position.set(0, J ? -0.01 : 0.006, J ? 0.01 : 0.02); jaw.add(tongueRoot);
  d.tongue = put(tongueRoot, sph(16, 10), [0, 0.006, 0.035], null, [0.02, 0.007, 0.03], null, M(0xe9808e, { roughness: 0.45 }));
  d.tongue.visible = false; // 혀는 보이지 않는다 (핑키는 혀를 내밀지 않는다)
  for (const sx of [1, -1]) {
    const eg = new THREE.Group(); eg.scale.setScalar(J ? 1.3 : 1); head.add(eg);
    if (J) { eg.position.set(sx * 0.04, 0.066, 0.097); eg.rotation.set(0, sx * 0.24, 0); }
    else { eg.position.set(sx * 0.028, 0.063, 0.095); eg.rotation.set(0, sx * 0.2, 0); }
    if (!silhouette) {
      // 크고 동그란 아주 짙은 갈색 눈(촉촉) · 동공 · 살색 윗눈꺼풀(가늘게 위 가장자리만) · 작은 반사 둘. 아이라인은 머리 무늬로 칠한다
      put(eg, sph(24, 16), [0, 0, 0], null, [0.0148, 0.0144, 0.0115], null, new THREE.MeshPhysicalMaterial({ color: 0x3a2412, roughness: 0.18, clearcoat: 0.7, clearcoatRoughness: 0.08 }));
      put(eg, sph(16, 10), [0, -0.0004, 0.0088], null, [0.0064, 0.0064, 0.003], null, M(0x080404, { roughness: 0.25 }));
      put(eg, sph(16, 10), [0, 0.0138, -0.0035], null, [0.0132, 0.0016, 0.0098], null, M(cH.clone().multiplyScalar(0.92).getHex(), { roughness: 0.9 })); // 윗눈꺼풀: 위쪽 가장자리만 아주 살짝 덮는다(눈이 동그랗게 열려 보이게)
      const h1 = new THREE.Mesh(SPH, new THREE.MeshBasicMaterial({ color: 0xf6f2ec })); h1.position.set(-sx * 0.0045, 0.0055, 0.0108); h1.scale.setScalar(0.0017); eg.add(h1);
      const h2 = new THREE.Mesh(SPH, new THREE.MeshBasicMaterial({ color: 0xf6f2ec })); h2.position.set(sx * 0.0034, -0.0038, 0.0102); h2.scale.setScalar(0.0007); eg.add(h2);
    }
    d.eyes.push(eg);
  }
  for (const sx of [1, -1]) {
    const ep = new THREE.Group(); head.add(ep);
    if (J) { ep.position.set(sx * 0.056, 0.128, 0); put(ep, new THREE.ConeGeometry(0.042, 0.1, 16), [0, 0.044, 0], null, [1, 1, 0.55], earPaint(sx)).userData.fur = [2, 0.004, 480]; ep.rotation.z = sx * -0.22; }
    else {
      ep.position.set(sx * 0.062, 0.072, 0.0); // 귀는 눈높이에서 시작한다
      put(ep, sdfGeo('be' + sx, earSDF(sx), [-0.045, -0.205, -0.075], [0.045, 0.015, 0.09], 0.0028), null, null, null, earPaint(sx));
    }
    d.ears.push({ g: ep, side: sx, ax: 0, vx: 0, az: 0, vz: 0 });
  }

  // 꼬리
  const tp = new THREE.Group(); tp.position.set(0, J ? 0.07 : 0.075, J ? -0.196 : -0.245); body.add(tp); d.tail = tp;
  if (J) put(tp, new THREE.TorusGeometry(0.055, 0.03, 10, 20, Math.PI * 1.5), [0, 0.06, 0], [0, Math.PI / 2, 0.5], null, tailPaint).userData.fur = [3, 0.006, 400];
  else put(tp, sdfGeo('bt', tailSDF, [-0.04, -0.04, -0.05], [0.04, 0.21, 0.08], 0.003), null, null, null, tailPaint);

  // 다리: 앞다리 = 위팔 · 아래팔 · 발허리 (팔꿈치는 뒤로, 손목은 들 때 뒤로 접힘)
  //       뒷다리 = 허벅지 · 정강이 · 뒷발허리 (무릎은 앞으로, 뒤꿈치는 뒤로)
  const k = J ? 1.15 : 1;
  const LEGS = J ? [[1, 0.132, true], [-1, 0.132, true], [1, -0.119, false], [-1, -0.119, false]] : [[1, 0.2, true], [-1, 0.2, true], [1, -0.2, false], [-1, -0.2, false]];
  for (const [sx, z, front] of LEGS) {
    const L1 = J ? (front ? 0.095 : 0.09) * k : front ? 0.108 : 0.1, L2 = J ? 0.095 * k : front ? 0.105 : 0.102, L3 = J ? (front ? 0.045 : 0.065) * k : front ? 0.042 : 0.066;
    const hip = new THREE.Group(); body.add(hip);
    const knee = new THREE.Group(); knee.position.set(0, -L1, 0); hip.add(knee);
    const ank = new THREE.Group(); ank.position.set(0, -L2, 0); knee.add(ank);
    const foot = new THREE.Group(); foot.position.set(0, -L3, 0); ank.add(foot);
    if (J) {
      hip.position.set(sx * 0.07, -0.05, z);
      put(hip, new THREE.CapsuleGeometry((front ? 0.04 : 0.043) * k, L1 * 0.9, 8, 16), [0, -L1 / 2, 0], null, null, segPaint(L1, front ? 0.65 : 0.9, front ? 0.08 : 0.5));
      put(knee, new THREE.CapsuleGeometry(0.04 * k, L2 * 0.92, 8, 16), [0, -L2 / 2, 0], null, null, segPaint(L2, front ? 0.05 : 0.45, 0));
      put(ank, new THREE.CapsuleGeometry(0.037 * k, L3 * 0.8, 6, 14), [0, -L3 / 2, 0], null, null, whitePaint);
      put(foot, sph(), [0, -0.004, 0.016], null, [0.04, 0.026, 0.05], whitePaint);
    } else {
      // 위에서 아래로 가늘어지는 원통 마디 + 관절마다 공 하나 (두 겹 공이 겹치는 '관절 인형' 단차 없음)
      hip.position.set(sx * (front ? 0.055 : 0.055), front ? -0.03 : -0.02, front ? 0.21 : z);
      const r1 = front ? 0.048 : 0.048, r2 = front ? 0.036 : 0.036, r3 = 0.029, r4 = 0.027;
      const bodySpace = (p, c) => bodyPaint(_pb.copy(p).add(hip.position), c); // 위팔·허벅지는 몸통 무늬를 그대로 이어받는다
      put(hip, cyl(r1, r2, L1, 16), [0, -L1 / 2, 0], null, null, bodySpace);
      if (!front) put(hip, sph(), [sx * 0.002, -L1 * 0.32, 0.012], null, [0.035, 0.066, 0.056], (p, c) => tone(c.copy(cT).lerp(_sad.copy(cB).lerp(cG, 0.6), ss(-0.03, 0.02, p.y) * ss(0.01, -0.02, p.z) * 0.4).lerp(cW, ss(-0.07, -0.11, p.y)), p, 0.04)); // 허벅지: 다리와 함께 움직이는 황갈 덩어리 (앉으면 몸 옆에 둥글게 보인다)
      put(knee, sph(), [0, 0, 0], null, r2 * 0.985, segPaint(1, front ? 0.15 : 0.5, front ? 0.15 : 0.5));
      put(knee, cyl(r2, r3, L2, 14), [0, -L2 / 2, 0], null, null, segPaint(L2, front ? 0.15 : 0.5, 0, 0.5));
      put(ank, sph(), [0, 0, 0], null, r3 * 0.985, whitePaint);
      put(ank, cyl(r3, r4, L3, 12), [0, -L3 / 2, 0], null, null, whitePaint);
      put(foot, sph(), [0, 0, 0], null, r4 * 0.985, whitePaint);
      put(foot, sdfGeo('bf', footSDF, [-0.045, -0.03, -0.04], [0.045, 0.025, 0.055], 0.0025), [0, 0, 0.012], null, null, whitePaint);
    }
    d.legs.push({ sx, front, hip, knee, ank, foot, L1, L2, L3 });
  }

  // 털 셸(진돗개만): 비글은 바탕 재질의 프레넬 솜털로 대신한다
  if (!silhouette) for (const m of furry) { const f = m.userData.fur; if (f && f[0]) furShells(m, f[0], f[1], f[2]); }
  d.cur = poseFor('stand', d); d.tgt = poseFor('stand', d);
  Object.assign(d, {
    x: 0, z: 0, yaw: 0, lift: 0, liftT: 0, external: false, phase: 0, gait: 0, walkTarget: null, walkSpeed: 0.5, steer: null,
    face: 'cam', lookFn: null, wagPhase: seed, wagAmp: 0.3, wagSpeed: 6, wagAmpT: 0.3, wagSpeedT: 6,
    jawOpen: 0, chew: false, lick: 0, tongueOut: 0, pant: false, sniff: 0, paddle: 0,
    eyeOpen: 1, eyeY: 1, blinkT: 1 + seed, blinkDur: 0, tilt: 0, tiltT: 0, hx: 0, hy: 0, hz: 0, poseRate: 5, earPerk: 0,
  });
  return d;
}

const _v = V3(), _m = new THREE.Matrix4(), _paw = V3(), _hipS = V3(), _dir = V3(), _tmp = V3(), _ank = V3();
function solveLeg(L, A, Pw, level, bodyPitch) {
  const { L1, L2 } = L;
  const base = Math.atan2(-A.z, -A.y);
  const dist = clamp(Math.hypot(A.y, A.z), 0.02, L1 + L2 - 1e-4);
  const a = Math.acos(clamp((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1));
  const tu = base + (L.front ? a : -a);
  const ky = -L1 * Math.cos(tu), kz = -L1 * Math.sin(tu);
  const ay = -dist * Math.cos(base), az = -dist * Math.sin(base);
  const tl = Math.atan2(-(az - kz), -(ay - ky));
  const t3 = Math.atan2(-(Pw.z - az), -(Pw.y - ay));
  L.hip.rotation.x = tu; L.knee.rotation.x = tl - tu; L.ank.rotation.x = t3 - tl; L.foot.rotation.x = -(t3 + bodyPitch) * level;
}

function updateDog(d, dt, t, camPos) {
  const c = d.cur, g = d.tgt, k = 1 - Math.exp(-d.poseRate * dt);
  for (const key of POSE_KEYS) c[key] += (g[key] - c[key]) * k;
  for (let i = 0; i < 4; i++) { c.paws[i].lerp(g.paws[i], k); c.lean[i] += (g.lean[i] - c.lean[i]) * k; }

  // 걷기 · 방향
  let moving = 0;
  if (d.walkTarget) {
    let dx = d.walkTarget.x - d.x, dz = d.walkTarget.z - d.z, dist = Math.hypot(dx, dz);
    if (dist < 0.03) { d.walkTarget = null; d.detour = null; }
    else {
      d.stuckT = (d.stuckT || 0) + dt;
      if (d.stuckT > 0.8) {
        if (d.lastD !== undefined && d.lastD - dist < 0.03 && !d.detour) { const sd = Math.random() < 0.5 ? 1 : -1; d.detour = { x: d.x - (dz / dist) * sd * 0.6, z: d.z + (dx / dist) * sd * 0.6, t: 1.4 }; }
        d.lastD = dist; d.stuckT = 0;
      }
      let gx = d.walkTarget.x, gz = d.walkTarget.z;
      if (d.detour) { d.detour.t -= dt; if (d.detour.t <= 0 || Math.hypot(d.detour.x - d.x, d.detour.z - d.z) < 0.08) { d.detour = null; d.stuckT = 0; d.lastD = dist; } else { gx = d.detour.x; gz = d.detour.z; } }
      const [sx, sz] = d.steer ? d.steer(d.x, d.z, gx, gz) : [dx / dist, dz / dist];
      const want = Math.atan2(sx, sz), diff = angDiff(d.yaw, want);
      d.yaw += diff * (1 - Math.exp(-5 * dt));
      const sp = d.walkSpeed * Math.max(0, 1 - Math.abs(diff) / 1.3) * Math.min(1, dist / 0.18 + 0.25);
      d.x += Math.sin(d.yaw) * sp * dt; d.z += Math.cos(d.yaw) * sp * dt;
      if (d.collide) d.collide(d);
      moving = Math.max(sp / Math.max(d.walkSpeed, 0.01), Math.min(1, Math.abs(diff) * 1.5));
      d.phase += Math.max(sp, 0.16) * dt * Math.PI / (2 * 0.055 * d.scale);
    }
  } else if (!d.external) {
    let want = null;
    if (d.face === 'cam' && camPos) want = Math.atan2(camPos.x - d.x, camPos.z - d.z) + c.yawOff;
    else if (d.face && d.face.x !== undefined) want = Math.atan2(d.face.x - d.x, d.face.z - d.z);
    if (want !== null) {
      const diff = angDiff(d.yaw, want);
      d.yaw += diff * (1 - Math.exp(-3.5 * dt));
      if (Math.abs(diff) > 0.3 && (g.name === 'stand' || g.name === 'eat')) { moving = Math.min(1, Math.abs(diff)); d.phase += dt * 9; }
    }
  }
  d.gait += (moving - d.gait) * (1 - Math.exp(-8 * dt));
  d.lift += (d.liftT - d.lift) * (1 - Math.exp(-4 * dt));
  if (!d.external) { d.root.position.set(d.x, d.lift, d.z); d.root.rotation.y = d.yaw; }

  // 몸
  const br = Math.sin(t * (d.pant ? 7 : 2.3) + d.seed * 3) * (d.pant ? 0.006 : 0.0035);
  const bob = d.gait * Math.abs(Math.cos(d.phase)) * 0.01;
  d.body.position.set(0, c.bodyY + br + bob, c.bodyZ);
  d.body.rotation.set(c.pitch, 0, c.roll);
  d.torso.scale.set(1 + br * 2.5, 1 + br * 2.5, 1);
  if (d.medal) {
    // 메달은 아래로 늘어지되, 판 중심이 가슴 속에 파묻히면(앉기처럼 몸이 뒤로 기울 때) 가슴에 눕도록 앞으로 기울인다
    const md = d.medal; let rx = -c.pitch * 0.95 + Math.sin(d.phase * 2) * 0.12 * d.gait + Math.sin(t * 1.3) * 0.03;
    if (d.medalSDF) for (let i = 0; i < 12; i++) {
      const y = md.position.y - 0.03 * Math.cos(rx) - 0.006 * Math.sin(rx), z = md.position.z - 0.03 * Math.sin(rx) + 0.006 * Math.cos(rx);
      if (d.medalSDF(md.position.x, y, z) > 0.007) break;
      rx -= 0.09;
    }
    md.rotation.set(rx, 0, -c.roll * 0.9 + Math.sin(d.phase) * 0.1 * d.gait);
  }
  d.root.updateMatrixWorld(true);

  // 머리 · 시선
  let yaw = 0, pitch = 0;
  const look = d.lookFn ? d.lookFn() : camPos;
  if (look && c.gaze > 0.01) {
    _v.copy(look); d.body.worldToLocal(_v); _v.sub(d.hp.position);
    const rawYaw = Math.atan2(_v.x, _v.z), behind = ss(1.2, 1.9, Math.abs(rawYaw));
    yaw = clamp(rawYaw, -1.05, 1.05) * (1 - behind);
    pitch = clamp(Math.atan2(_v.y, Math.hypot(_v.x, _v.z)), -1.0, 0.58 + Math.min(c.pitch, 0)); // 올려다보는 각은 월드 기준 33°쯤까지: 몸이 뒤로 기운(앉기) 만큼 뺀다
  }
  d.tilt += (d.tiltT - d.tilt) * (1 - Math.exp(-6 * dt));
  const hx = c.headPitch * (1 - c.gaze) - pitch * c.gaze;
  const hy = yaw * c.gaze, hz = c.headTilt + d.tilt;
  const hk = 1 - Math.exp(-7 * dt);
  d.hx += (hx - d.hx) * hk; d.hy += (hy - d.hy) * hk; d.hz += (hz - d.hz) * hk;
  const sniffBob = d.sniff ? Math.sin(t * 15) * 0.035 * d.sniff : 0;
  const chewBob = d.chew ? Math.sin(t * 15) * 0.03 : 0;
  d.hp.rotation.set(d.hx + sniffBob + chewBob, d.hy, d.hz);

  // 다리 IK (관절 3개)
  d.body.updateMatrix(); _m.copy(d.body.matrix).invert();
  for (let i = 0; i < 4; i++) {
    const L = d.legs[i];
    _paw.copy(c.paws[i]);
    let up = 0;
    if (d.gait > 0.001) {
      const ph = d.phase + (i === 0 || i === 3 ? 0 : Math.PI);
      _paw.z += Math.sin(ph) * 0.055 * d.gait;
      up = Math.max(0, Math.cos(ph)) * d.gait; _paw.y += up * 0.035;
    }
    if (d.paddle > 0.001) { _paw.y += Math.sin(t * 8 + i * 1.7) * 0.035 * d.paddle; _paw.z += Math.cos(t * 8 + i * 1.7) * 0.03 * d.paddle; }
    _hipS.copy(L.hip.position).applyMatrix4(d.body.matrix);
    const lean = c.lean[i] + up * (L.front ? -1.2 : 0.9);
    _dir.set(0, Math.cos(lean), -Math.sin(lean)).lerp(_tmp.copy(_hipS).sub(_paw).normalize(), c.free).normalize();
    _ank.copy(_paw).addScaledVector(_dir, L.L3).applyMatrix4(_m).sub(L.hip.position);
    _paw.applyMatrix4(_m).sub(L.hip.position);
    solveLeg(L, _ank, _paw, c.level, c.pitch);
  }

  // 귀 (중력 따라 덜렁)
  const hwP = c.pitch + d.hp.rotation.x, hwR = c.roll + d.hp.rotation.z;
  for (const e of d.ears) {
    if (d.J) { e.g.rotation.x = -d.earPerk * 0.2; continue; }
    const tx = -hwP * 0.7 + d.gait * Math.sin(d.phase * 2) * 0.12 - d.earPerk * 0.3;
    const tz = e.side * (-0.03 + d.earPerk * 0.25) - hwR * 0.6;
    e.vx += (tx - e.ax) * 120 * dt; e.vx *= Math.exp(-8 * dt); e.ax += e.vx * dt;
    e.vz += (tz - e.az) * 120 * dt; e.vz *= Math.exp(-8 * dt); e.az += e.vz * dt;
    e.ax = clamp(e.ax, -0.25, 0.35); e.az = clamp(e.az, -0.15, 0.15); // 귓볼이 볼에서 들뜨지 않게
    e.g.rotation.set(e.ax, 0, e.az);
  }

  // 꼬리
  const wk = 1 - Math.exp(-4 * dt);
  d.wagAmp += (d.wagAmpT - d.wagAmp) * wk; d.wagSpeed += (d.wagSpeedT - d.wagSpeed) * wk;
  d.wagPhase += dt * d.wagSpeed;
  d.tail.rotation.set(c.tail, 0, Math.sin(d.wagPhase) * d.wagAmp * (d.J ? 0.35 : 1));

  // 눈 깜빡
  d.blinkT -= dt;
  if (d.blinkT <= 0) { d.blinkT = 2 + Math.random() * 4.5; d.blinkDur = 0.13; }
  let eo = d.eyeOpen;
  if (d.blinkDur > 0) { d.blinkDur -= dt; eo = 0.1; }
  d.eyeY += (eo - d.eyeY) * (1 - Math.exp(-35 * dt));
  for (const e of d.eyes) e.scale.y = Math.max(0.08, d.eyeY) * e.scale.x;

  // 입 · 혀
  let jt = d.jawOpen;
  if (d.chew) jt = 0.06 + 0.2 * (0.5 + 0.5 * Math.sin(t * 15));
  if (d.pant) jt = Math.max(jt, 0.16 + 0.04 * Math.sin(t * 14));
  d.jaw.rotation.x += (jt - d.jaw.rotation.x) * (1 - Math.exp(-28 * dt));
  const to = Math.max(d.tongueOut, d.lick, d.pant ? 0.7 : 0);
  d.tongue.position.set(d.lick ? Math.sin(t * 11) * 0.02 * d.lick : 0, 0.006 - 0.012 * to, 0.035 + 0.05 * to);
  d.tongue.scale.set(0.02, 0.007, 0.03 + 0.022 * to);
}

// ================================================================
// 강아지 고르기 화면
// ================================================================
const DOGS = [
  { id: 'pupu', name: '푸푸', place: '남산 산책길', ready: false, kind: 'jindo', colors: COLORS.pupu },
  { id: 'alpang', name: '알팡', place: '쇼핑센터', ready: false, kind: 'beagle', colors: COLORS.generic },
  { id: 'pinky', name: '핑키', place: '푸맘네 집', ready: true, kind: 'beagle', colors: COLORS.pinky },
  { id: 'jaerong', name: '재롱', place: '장소 정하는 중', ready: false, kind: 'beagle', colors: COLORS.generic },
  { id: 'dami', name: '담이', place: '장소 정하는 중', ready: false, kind: 'beagle', colors: COLORS.generic },
];
const RING_R = 1.75, STEP = (Math.PI * 2) / DOGS.length;

const selScene = new THREE.Scene();
selScene.background = new THREE.Color(0x1a120e);
selScene.fog = new THREE.Fog(0x1a120e, 5.5, 12);
const selCam = new THREE.PerspectiveCamera(38, 1, 0.05, 60);
selScene.add(new THREE.HemisphereLight(0xffe2c6, 0x2a1a12, 0.9));
const selSpot = new THREE.SpotLight(0xffd3a1, 60, 14, 0.42, 0.75, 2);
selSpot.position.set(0, 4.4, 3.6); selSpot.target.position.set(0, 0, RING_R);
selSpot.castShadow = true; selSpot.shadow.mapSize.set(1024, 1024); selSpot.shadow.bias = -0.0004;
selScene.add(selSpot, selSpot.target);
const rim = new THREE.DirectionalLight(0xf0a2ad, 1.6); rim.position.set(0, 2.5, -5); selScene.add(rim);
const selFill = new THREE.PointLight(0xffb36b, 2.5, 6, 2); selFill.position.set(-1.6, 0.8, 3.4); selScene.add(selFill);
add(selScene, new THREE.CircleGeometry(8, 64), M(0x2a1e17, { roughness: 0.95 }), [0, 0, 0], [-Math.PI / 2, 0, 0], null, false);

const ring = new THREE.Group(); selScene.add(ring);
const selDogs = DOGS.map((info, i) => {
  const th = i * STEP;
  const ped = new THREE.Group(); ped.position.set(Math.sin(th) * RING_R, 0, Math.cos(th) * RING_R); ped.rotation.y = th; ring.add(ped);
  add(ped, cyl(0.46, 0.5, 0.1, 40), M(0x3a2b22, { roughness: 0.7 }), [0, 0.05, 0]);
  if (info.ready) {
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.009, 8, 64), new THREE.MeshBasicMaterial({ color: 0xf3b466 }));
    halo.rotation.x = Math.PI / 2; halo.position.y = 0.101; ped.add(halo);
  }
  const d = buildDog({ kind: info.kind, colors: info.colors, silhouette: !info.ready, scale: 1.3, seed: i });
  d.external = true; d.root.position.y = 0.1; ped.add(d.root);
  d.meshes.forEach((m) => { m.userData.idx = i; });
  ped.children.forEach((m) => { m.userData.idx = i; });
  if (!info.ready) { d.wagAmpT = 0.15; d.wagSpeedT = 3; d.tgt.gaze = 0; d.cur.gaze = 0; }
  return d;
});

// 떠다니는 먼지 (추억 느낌)
const dust = (() => {
  const N = 110, pos = new Float32Array(N * 3), R = rng(3);
  for (let i = 0; i < N; i++) { pos[i * 3] = (R() - 0.5) * 7; pos[i * 3 + 1] = R() * 3; pos[i * 3 + 2] = (R() - 0.5) * 6 + 1; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffc98a, size: 0.03, map: glowTex, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
  selScene.add(p); return p;
})();

let sel = 2, ringAngle = -sel * STEP, ringTarget = ringAngle;
const chipsEl = $('#chips');
DOGS.forEach((info, i) => {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'chip'; b.setAttribute('role', 'tab');
  b.innerHTML = info.name + (info.ready ? '' : '<small>준비 중</small>');
  b.addEventListener('click', () => select(i));
  chipsEl.appendChild(b);
});
function select(i, dir) {
  if (dir === undefined) {
    let delta = i - sel;
    if (delta > 2) delta -= 5; if (delta < -2) delta += 5;
    ringTarget -= delta * STEP;
  } else ringTarget -= dir * STEP;
  sel = ((i % 5) + 5) % 5;
  const info = DOGS[sel];
  $('#selName').textContent = info.name;
  $('#selPlace').textContent = info.place;
  const go = $('#goBtn');
  go.disabled = !info.ready; go.textContent = info.ready ? '만나러 가기' : '준비 중';
  [...chipsEl.children].forEach((c, j) => c.setAttribute('aria-selected', String(j === sel)));
  selDogs.forEach((d, j) => {
    if (!DOGS[j].ready) return;
    d.tgt.gaze = j === sel ? 1 : 0;
    d.wagAmpT = j === sel ? 0.55 : 0.2; d.wagSpeedT = j === sel ? 12 : 4;
  });
}
select(2);
$('#prevBtn').addEventListener('click', () => select(sel - 1, -1));
$('#nextBtn').addEventListener('click', () => select(sel + 1, 1));
$('#goBtn').addEventListener('click', () => { if (DOGS[sel].ready) goRoom(); });

function updateSelect(dt, t) {
  ringAngle += (ringTarget - ringAngle) * (1 - Math.exp(-5 * dt));
  ring.rotation.y = ringAngle;
  ring.updateMatrixWorld(true);
  selDogs.forEach((d) => updateDog(d, dt, t, selCam.position));
  const a = dust.geometry.attributes.position;
  for (let i = 0; i < a.count; i++) {
    let y = a.getY(i) + dt * (0.04 + (i % 5) * 0.01);
    if (y > 3) y = 0;
    a.setY(i, y); a.setX(i, a.getX(i) + Math.sin(t * 0.3 + i) * 0.0008);
  }
  a.needsUpdate = true;
}

// ================================================================
// 푸맘네 집 (핑키의 추억 장소)
// ================================================================
const roomScene = new THREE.Scene();
roomScene.background = new THREE.Color(0xd9c8b0);
const roomCam = new THREE.PerspectiveCamera(50, 1, 0.03, 40);
const roomUpd = [];
const H = 2.7, X0 = -3.2, X1 = 3.2, Z0 = -2.8, Z1 = 3.8;

function buildRoom(S) {
  const R = rng(11);
  // 바닥 (따뜻한 원목 마루)
  const floorTex = canvasTex(1024, 1024, (x, w) => {
    const r = rng(7), rows = 8, hgt = w / rows;
    const tones = ['#b9783f', '#c48448', '#ad6d37', '#c98c4f', '#b47440', '#bf7f45'];
    for (let j = 0; j < rows; j++) {
      let xx = -((j * 397) % 512);
      while (xx < w) {
        const len = 380 + r() * 300;
        x.fillStyle = tones[Math.floor(r() * tones.length)]; x.fillRect(xx, j * hgt, len, hgt);
        for (let k = 0; k < 14; k++) {
          x.strokeStyle = `rgba(${r() < 0.5 ? '90,45,15' : '235,180,120'},${0.08 + r() * 0.1})`; x.lineWidth = 1 + r() * 1.5;
          const yy = j * hgt + r() * hgt; x.beginPath(); x.moveTo(xx, yy);
          x.bezierCurveTo(xx + len * 0.3, yy + (r() - 0.5) * 10, xx + len * 0.7, yy + (r() - 0.5) * 10, xx + len, yy + (r() - 0.5) * 6); x.stroke();
        }
        x.fillStyle = 'rgba(60,30,12,.55)'; x.fillRect(xx, j * hgt, 2, hgt);
        xx += len;
      }
      x.fillStyle = 'rgba(60,30,12,.5)'; x.fillRect(0, j * hgt, w, 2);
    }
  }, [6.4 / 1.6, 6.6 / 1.6]);
  add(S, new THREE.PlaneGeometry(6.4, 6.6), M(0xffffff, { map: floorTex, roughness: 0.38 }), [0, 0, 0.5], [-Math.PI / 2, 0, 0], null, false);

  // 벽 · 천장
  const wallM = M(0xf2ebe1, { roughness: 0.95 });
  const wall = (w, h, p, ry) => add(S, new THREE.PlaneGeometry(w, h), wallM, p, [0, ry, 0], null, true);
  wall(6.4, H, [0, H / 2, Z0], 0);
  wall(6.4, H, [0, H / 2, Z1], Math.PI);
  wall(6.6, H, [X1, H / 2, 0.5], -Math.PI / 2);
  // 왼쪽 벽: 큰 창 (z -1.7 ~ 0.3, y 0.2 ~ 2.25)
  wall(1.1, H, [X0, H / 2, -2.25], Math.PI / 2);
  wall(3.5, H, [X0, H / 2, 2.05], Math.PI / 2);
  wall(2.0, 0.2, [X0, 0.1, -0.7], Math.PI / 2);
  wall(2.0, 0.45, [X0, 2.475, -0.7], Math.PI / 2);
  add(S, new THREE.PlaneGeometry(6.4, 6.6), M(0xf6f1ea, { roughness: 1 }), [0, H, 0.5], [Math.PI / 2, 0, 0], null, true);
  const baseM = M(0xe2d8ca, { roughness: 0.9 });
  add(S, box(6.4, 0.08, 0.015), baseM, [0, 0.04, Z0 + 0.008], null, null, false);
  add(S, box(0.015, 0.08, 6.6), baseM, [X1 - 0.008, 0.04, 0.5], null, null, false);

  // 창문 + 블라인드
  const frameM = M(0x3b3836, { roughness: 0.6 });
  for (const z of [-1.7, -0.7, 0.3]) add(S, box(0.06, 2.05, 0.05), frameM, [X0 + 0.02, 1.225, z]);
  for (const y of [0.2, 1.45, 2.25]) add(S, box(0.06, 0.04, 2.0), frameM, [X0 + 0.02, y, -0.7]);
  add(S, box(0.22, 0.03, 2.1), M(0xe9e2d7), [X0 + 0.1, 0.2, -0.7], null, null, false);
  add(S, new THREE.PlaneGeometry(2, 2.05), new THREE.MeshStandardMaterial({ color: 0xa9bbd2, transparent: true, opacity: 0.07, roughness: 0.05, depthWrite: false }), [X0 + 0.01, 1.225, -0.7], [0, Math.PI / 2, 0], null, false);
  const slatM = M(0xddd7cd, { roughness: 0.7 });
  for (let i = 0; i < 9; i++) add(S, box(0.05, 0.011, 1.96), slatM, [X0 + 0.08, 2.21 - i * 0.015, -0.7]);
  add(S, box(0.06, 0.024, 1.98), slatM, [X0 + 0.08, 2.08, -0.7]);

  // 창밖: 햇살 드는 가을 마당 (단풍나무 · 화로 · 빨간 의자)
  const gardenTex = canvasTex(1024, 640, (x) => {
    const r = rng(21);
    let g = x.createLinearGradient(0, 0, 0, 470); g.addColorStop(0, '#8fbfe6'); g.addColorStop(0.7, '#d9e6ef'); g.addColorStop(1, '#f7e7cc');
    x.fillStyle = g; x.fillRect(0, 0, 1024, 640);
    g = x.createRadialGradient(80, 60, 10, 80, 60, 420); g.addColorStop(0, 'rgba(255,244,214,.95)'); g.addColorStop(0.35, 'rgba(255,226,170,.35)'); g.addColorStop(1, 'rgba(255,226,170,0)');
    x.fillStyle = g; x.fillRect(0, 0, 1024, 640);
    x.fillStyle = '#b8765c'; x.fillRect(0, 130, 280, 400);
    x.fillStyle = '#e9e3d8'; x.fillRect(660, 80, 364, 450);
    x.fillStyle = '#c98b6c'; x.fillRect(470, 220, 190, 310);
    x.fillStyle = 'rgba(90,110,140,.55)';
    for (const [wx, wy, w, h] of [[40, 180, 46, 56], [130, 180, 46, 56], [210, 180, 46, 56], [40, 280, 46, 56], [130, 280, 46, 56], [700, 130, 64, 44], [800, 130, 64, 44], [900, 130, 64, 44], [700, 230, 64, 44], [800, 230, 64, 44], [900, 230, 64, 44], [500, 260, 36, 44], [580, 260, 36, 44]]) x.fillRect(wx, wy, w, h);
    g = x.createLinearGradient(0, 470, 0, 640); g.addColorStop(0, '#8b9a63'); g.addColorStop(1, '#6f7f4c');
    x.fillStyle = g; x.fillRect(0, 460, 1024, 180);
    x.fillStyle = '#a7a08e';
    for (let i = 0; i < 6; i++) { x.beginPath(); x.ellipse(120 + i * 150, 590 - (i % 2) * 20, 46, 13, 0, 0, 7); x.fill(); }
    // 단풍나무 (햇빛 받은 주황 · 빨강)
    x.strokeStyle = '#3b2518'; x.lineCap = 'round';
    const leaf = ['#c4471f', '#e0702c', '#a9321f', '#f0953b', '#d65a24', '#f2b34a'];
    for (const [tx, ty, sc] of [[560, 250, 1.15], [800, 300, 0.85]]) {
      x.lineWidth = 20 * sc; x.beginPath(); x.moveTo(tx - 15, 520); x.bezierCurveTo(tx - 27, 430, tx + 7, 360, tx - 7, ty + 10); x.stroke();
      x.lineWidth = 9 * sc; x.beginPath(); x.moveTo(tx - 5, 360); x.lineTo(tx - 77, ty + 30); x.moveTo(tx, 320); x.lineTo(tx + 73, ty - 2); x.stroke();
      for (let i = 0; i < 260; i++) {
        const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * 160 * sc;
        x.fillStyle = leaf[i % leaf.length]; x.globalAlpha = 0.85; x.beginPath(); x.arc(tx + Math.cos(a) * rr * 1.4, ty - 5 + Math.sin(a) * rr * 0.75, (9 + r() * 15) * sc, 0, 7); x.fill();
      }
    }
    x.globalAlpha = 1;
    x.strokeStyle = '#a22d2a'; x.lineWidth = 5;
    x.beginPath(); x.moveTo(140, 530); x.lineTo(150, 470); x.lineTo(200, 470); x.lineTo(210, 530); x.moveTo(150, 470); x.lineTo(156, 430); x.lineTo(196, 430); x.stroke();
    x.beginPath(); x.moveTo(230, 535); x.lineTo(250, 455); x.moveTo(320, 535); x.lineTo(300, 455); x.moveTo(236, 455); x.lineTo(316, 455); x.stroke();
    x.fillStyle = '#7d5638'; x.fillRect(232, 448, 88, 8);
    x.fillStyle = '#1d1a18';
    x.beginPath(); x.moveTo(612, 420); x.lineTo(668, 420); x.lineTo(690, 470); x.lineTo(684, 540); x.lineTo(596, 540); x.lineTo(590, 470); x.closePath(); x.fill();
    x.fillRect(624, 392, 32, 30); x.beginPath(); x.ellipse(640, 392, 26, 9, 0, 0, 7); x.fill();
    x.strokeStyle = '#141416'; x.lineWidth = 4;
    x.beginPath(); x.moveTo(0, 455); x.lineTo(1024, 455); x.moveTo(0, 470); x.lineTo(1024, 470); x.stroke();
    x.lineWidth = 3;
    for (let px = 8; px < 1024; px += 26) { x.beginPath(); x.moveTo(px, 455); x.lineTo(px, 520); x.stroke(); }
  });
  add(S, new THREE.PlaneGeometry(9, 5.6), new THREE.MeshBasicMaterial({ map: gardenTex, color: 0xb8b0a6 }), [-6.6, 1.7, -0.7], [0, Math.PI / 2, 0], null, false);
  add(S, new THREE.PlaneGeometry(3.4, 9), M(0x8d9866, { roughness: 1 }), [-4.9, -0.03, -0.7], [-Math.PI / 2, 0, 0], null, false);

  // 햇빛: 큰 창으로 낮게 들어오는 오후 해
  const sun = new THREE.DirectionalLight(0xffd4a3, 4.2);
  sun.position.set(-7.6, 3.7, 0.4); sun.target.position.set(0.2, 0, -0.5);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.03;
  Object.assign(sun.shadow.camera, { left: -4.5, right: 4.5, top: 4.5, bottom: -4.5, near: 1, far: 16 });
  S.add(sun, sun.target);
  // 빛줄기 + 그 안에 떠다니는 먼지
  {
    const dir = V3().subVectors(sun.target.position, sun.position).normalize(), L = 5.2;
    const cs = [[X0, 0.25, -1.68], [X0, 2.2, -1.68], [X0, 2.2, 0.28], [X0, 0.25, 0.28]];
    const pos = [], col = [];
    for (const c of cs) pos.push(c[0], c[1], c[2]);
    for (const c of cs) pos.push(c[0] + dir.x * L, c[1] + dir.y * L, c[2] + dir.z * L);
    for (let i = 0; i < 4; i++) col.push(1, 0.86, 0.62);
    for (let i = 0; i < 4; i++) col.push(0, 0, 0);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex([0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]);
    S.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.035, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })));
    const N = 160, dp = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { const t = R() * 0.8, a = cs[0]; dp[i * 3] = X0 + 0.1 + dir.x * L * t; dp[i * 3 + 1] = 0.3 + R() * 1.9 + dir.y * L * t; dp[i * 3 + 2] = -1.6 + R() * 1.8 + dir.z * L * t; }
    const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
    S.add(new THREE.Points(dg, new THREE.PointsMaterial({ color: 0xffe2b0, size: 0.012, map: glowTex, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending })));
    roomUpd.push((t, dt) => {
      const a = dg.attributes.position;
      for (let i = 0; i < N; i++) { a.setY(i, a.getY(i) + Math.sin(t * 0.4 + i) * 0.0006); a.setX(i, a.getX(i) + Math.cos(t * 0.3 + i * 1.7) * 0.0005); }
      a.needsUpdate = true;
    });
  }

  // 화분 (창가 구석) · 걸이 화분
  {
    const leafShape = new THREE.Shape(); leafShape.moveTo(0, 0); leafShape.bezierCurveTo(0.09, 0.06, 0.08, 0.2, 0, 0.27); leafShape.bezierCurveTo(-0.08, 0.2, -0.09, 0.06, 0, 0);
    const leafGeo = new THREE.ShapeGeometry(leafShape, 8);
    const leafM = M(0x3f6b3a, { roughness: 0.6, side: THREE.DoubleSide }), leafM2 = M(0x58864a, { roughness: 0.6, side: THREE.DoubleSide });
    const P = new THREE.Group(); P.position.set(-2.85, 0, -2.35); S.add(P);
    add(P, cyl(0.2, 0.16, 0.36, 28), M(0xe8e1d6, { roughness: 0.7 }), [0, 0.18, 0]);
    add(P, cyl(0.185, 0.185, 0.02, 28), M(0x4a3426, { roughness: 1 }), [0, 0.35, 0]);
    for (let i = 0; i < 13; i++) {
      const a = (i / 13) * Math.PI * 2 + R(), h = 0.55 + R() * 0.75, tilt = 0.35 + R() * 0.5;
      const st = new THREE.Group(); st.position.set(0, 0.35, 0); st.rotation.set(0, a, 0); P.add(st);
      add(st, cyl(0.006, 0.008, h, 6), M(0x4f6b33), [0, h / 2, 0], null, null);
      const lf = add(st, leafGeo, i % 2 ? leafM : leafM2, [0, h, 0], [-tilt - 0.6, 0, 0], 1.3 + R() * 0.6);
      lf.position.z = 0.02;
    }
    const HP = new THREE.Group(); HP.position.set(-2.8, H - 0.45, 0.85); S.add(HP);
    add(HP, cyl(0.002, 0.002, 0.45, 4), M(0x8a7a66), [0, 0.225, 0]);
    add(HP, cyl(0.13, 0.1, 0.16, 20), M(0xd9cbb5, { roughness: 0.9 }), [0, -0.05, 0]);
    for (let v = 0; v < 9; v++) {
      const a = (v / 9) * Math.PI * 2, len = 0.4 + R() * 0.7;
      for (let k = 0; k < 9; k++) {
        const t = k / 8, px = Math.cos(a) * (0.11 + t * 0.06), pz = Math.sin(a) * (0.11 + t * 0.06), py = -0.02 - t * len;
        add(HP, leafGeo, k % 2 ? leafM : leafM2, [px, py, pz], [R() * 2, a, R() * 2], 0.35 + R() * 0.15, false);
      }
    }
  }

  // 붙박이 흰 선반 (사진 속 거실)
  const shM = M(0xf4f0e9, { roughness: 0.8 });
  const SX0 = -1.5, SX1 = 1.7, SW = SX1 - SX0, SD = 0.36, SZ = Z0 + SD / 2, TOP = 2.15;
  add(S, box(SW, 0.55, SD), shM, [(SX0 + SX1) / 2, 0.275, SZ]);
  for (let i = 1; i < 3; i++) add(S, box(0.004, 0.48, 0.002), M(0xcfc8bd), [SX0 + (SW * i) / 3, 0.29, SZ + SD / 2 + 0.002], null, null, false);
  for (const xx of [SX0, SX1]) add(S, box(0.035, TOP, SD), shM, [xx, TOP / 2, SZ]);
  for (let i = 1; i < 3; i++) add(S, box(0.03, TOP - 0.55, SD), shM, [SX0 + (SW * i) / 3, 0.55 + (TOP - 0.55) / 2, SZ]);
  for (const y of [1.05, 1.58, TOP]) add(S, box(SW, 0.03, SD), shM, [(SX0 + SX1) / 2, y, SZ]);
  const bay = (b) => SX0 + (SW / 6) * (2 * b + 1);
  const bowl = (r, h, color, p) => {
    const pts = []; for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI / 2; pts.push(new THREE.Vector2(Math.sin(a) * r + 0.002, (1 - Math.cos(a)) * h)); }
    return add(S, new THREE.LatheGeometry(pts, 28), M(color, { roughness: 0.5, side: THREE.DoubleSide }), p);
  };
  const vase = (prof, color, p) => add(S, new THREE.LatheGeometry(prof.map(([a, b]) => new THREE.Vector2(a, b)), 28), M(color, { roughness: 0.55 }), p);
  // 아래칸: 책
  { let xx = bay(0) - 0.4; const cols = [0x7b3b32, 0xc9b28b, 0x3d4a5a, 0xd8cfc0, 0x6a5a3a, 0xa8644a, 0x2f3b33, 0xe2d6bf, 0x8d6a4c, 0x5b2d2a];
    for (let i = 0; i < 14; i++) { const w = 0.03 + R() * 0.025, h = 0.22 + R() * 0.1; add(S, box(w, h, 0.2), M(cols[i % cols.length]), [xx + w / 2, 0.565 + h / 2, SZ]); xx += w + 0.003; } }
  bowl(0.11, 0.07, 0x2f4f6e, [bay(1) - 0.25, 0.565, SZ]); bowl(0.09, 0.06, 0xe7dccb, [bay(1) + 0.05, 0.565, SZ + 0.02]);
  vase([[0, 0], [0.07, 0], [0.09, 0.08], [0.06, 0.2], [0.035, 0.26], [0.04, 0.29]], 0x262321, [bay(2) - 0.2, 0.565, SZ]);
  // 가운데칸: 그림 · 튤립 · 스탠드
  const art = canvasTex(256, 320, (x, w, h) => {
    x.fillStyle = '#eadfca'; x.fillRect(0, 0, w, h);
    x.strokeStyle = '#7a4a2b'; x.lineWidth = 3; x.lineCap = 'round';
    x.beginPath(); x.moveTo(128, 270); x.bezierCurveTo(120, 200, 140, 150, 126, 70); x.stroke();
    for (let i = 0; i < 6; i++) { x.beginPath(); x.ellipse(128 + (i % 2 ? 28 : -28), 230 - i * 28, 22, 8, (i % 2 ? -0.6 : 0.6), 0, 7); x.stroke(); }
    x.fillStyle = '#c4703d'; x.beginPath(); x.arc(126, 64, 12, 0, 7); x.fill();
  });
  add(S, box(0.44, 0.54, 0.025), M(0xc6a77f, { roughness: 0.6 }), [bay(1) + 0.15, 1.065 + 0.27, Z0 + 0.06], [-0.08, 0, 0]);
  add(S, new THREE.PlaneGeometry(0.37, 0.46), M(0xffffff, { map: art, roughness: 0.9 }), [bay(1) + 0.15, 1.065 + 0.27, Z0 + 0.075], [-0.08, 0, 0], null, false);
  vase([[0, 0], [0.04, 0], [0.045, 0.06], [0.04, 0.18], [0.045, 0.2]], 0xd5ddd5, [bay(1) - 0.3, 1.065, SZ + 0.04]);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2, sx = Math.cos(a) * 0.05, sz = Math.sin(a) * 0.04, h = 0.32 + R() * 0.1;
    add(S, cyl(0.004, 0.004, h, 6), M(0x5e7a3f), [bay(1) - 0.3 + sx * 0.5, 1.065 + 0.18 + h / 2 - 0.05, SZ + 0.04 + sz * 0.5], [sz * 2, 0, -sx * 2], null, false);
    add(S, SPH, M(i % 3 ? 0xf2c94c : 0xee9a4a, { roughness: 0.5 }), [bay(1) - 0.3 + sx * 1.6, 1.065 + 0.13 + h, SZ + 0.04 + sz * 1.6], null, [0.024, 0.034, 0.024]);
  }
  add(S, cyl(0.05, 0.075, 0.26, 24), M(0xf3efe7, { roughness: 0.4 }), [bay(2) + 0.25, 1.065 + 0.13, SZ]);
  const shade = add(S, new THREE.CylinderGeometry(0.1, 0.15, 0.18, 32, 1, true), new THREE.MeshStandardMaterial({ color: 0xfff1dc, emissive: 0xffb766, emissiveIntensity: 1.3, side: THREE.DoubleSide }), [bay(2) + 0.25, 1.065 + 0.36, SZ], null, null, false);
  const lamp = new THREE.PointLight(0xffb769, 1.4, 7, 2); lamp.position.copy(shade.position); S.add(lamp);
  glow(S, 0xffc27a, 0.9, [shade.position.x, shade.position.y, shade.position.z + 0.05], 0.35);
  bowl(0.1, 0.05, 0x1f1d1c, [bay(2) - 0.25, 1.065, SZ]);
  // 윗칸: 그릇들
  bowl(0.12, 0.06, 0x7d8fa3, [bay(0) - 0.15, 1.595, SZ]); bowl(0.08, 0.05, 0xb88a64, [bay(0) + 0.17, 1.595, SZ]);
  vase([[0, 0], [0.05, 0], [0.07, 0.07], [0.03, 0.2], [0.022, 0.24]], 0x34302d, [bay(1) - 0.15, 1.595, SZ]);
  bowl(0.1, 0.05, 0xd9cdb8, [bay(1) + 0.2, 1.595, SZ]);
  bowl(0.13, 0.05, 0x4c6a8a, [bay(2), 1.595, SZ]);
  bowl(0.09, 0.045, 0xe3d7c4, [bay(0), 2.165, SZ]); vase([[0, 0], [0.06, 0], [0.07, 0.1], [0.045, 0.16]], 0x8f6a4a, [bay(2) + 0.1, 2.165, SZ]);

  // 크리스마스 트리
  const T = new THREE.Group(); T.position.set(2.3, 0, -1.75); S.add(T);
  add(T, cyl(0.26, 0.22, 0.3, 28), M(0xb08a5e, { roughness: 0.9 }), [0, 0.15, 0]);
  add(T, new THREE.TorusGeometry(0.26, 0.025, 8, 28), M(0x9a7550), [0, 0.3, 0], [Math.PI / 2, 0, 0]);
  add(T, cyl(0.05, 0.06, 0.3), M(0x5a3d2a), [0, 0.4, 0]);
  const green = M(0x2d5a3a, { roughness: 0.9, flatShading: true });
  const layers = [[0.8, 0.85, 0.78], [0.64, 0.75, 1.17], [0.48, 0.65, 1.53], [0.32, 0.55, 1.85], [0.18, 0.4, 2.1]];
  layers.forEach(([r, h, y], i) => add(T, new THREE.ConeGeometry(r, h, 11, 1), green, [0, y, 0], [0, i * 0.33, 0]));
  const rAt = (yy) => { for (const [r, h, y] of layers) { if (yy >= y - h / 2 && yy <= y + h / 2 - 0.12) return r * ((y + h / 2 - yy) / h); } return 0.1; };
  const ornCols = [0xb3262e, 0xd8a84a, 0xefe6d6, 0xb3262e, 0xd8a84a];
  for (let i = 0; i < 26; i++) {
    const yy = 0.5 + R() * 1.55, a = R() * Math.PI * 2, rr = rAt(yy) + 0.015, col = ornCols[i % 5];
    add(T, SPH, M(col, col === 0xd8a84a ? { metalness: 0.6, roughness: 0.3 } : { roughness: 0.35 }), [Math.cos(a) * rr, yy, Math.sin(a) * rr], null, 0.035 + R() * 0.02);
  }
  const twinkle = [0, 1, 2].map(() => new THREE.MeshBasicMaterial({ color: 0xffd38a }));
  const twinkleGlow = [];
  for (let i = 0; i < 72; i++) {
    const tt = i / 72, yy = 0.45 + tt * 1.7, a = tt * Math.PI * 2 * 6.5, rr = rAt(yy) + 0.02;
    const p = [Math.cos(a) * rr, yy, Math.sin(a) * rr];
    add(T, SPH, twinkle[i % 3], p, null, 0.017, false);
    twinkleGlow.push({ s: glow(T, 0xffbf6a, 0.13, p, 0.7), k: i % 3 });
  }
  const starShape = new THREE.Shape();
  for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 + Math.PI / 2, r = i % 2 ? 0.045 : 0.1; if (i) starShape.lineTo(Math.cos(a) * r, Math.sin(a) * r); else starShape.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
  add(T, new THREE.ExtrudeGeometry(starShape, { depth: 0.02, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 2 }), new THREE.MeshStandardMaterial({ color: 0xf6d27a, emissive: 0xffbe48, emissiveIntensity: 1.4, roughness: 0.4 }), [0, 2.4, -0.01], [0, 0.6, 0]);
  const starGlow = glow(T, 0xffd27a, 0.7, [0, 2.4, 0], 0.55);
  const treeLight = new THREE.PointLight(0xffb35c, 5, 6, 2); treeLight.position.set(-0.25, 1.2, 0.35); T.add(treeLight);
  // 선물 상자
  const gift = (p, s, col, rib, ry) => {
    const g = new THREE.Group(); g.position.set(p[0], 0, p[1]); g.rotation.y = ry; T.add(g);
    add(g, box(s[0], s[1], s[2]), M(col, { roughness: 0.7 }), [0, s[1] / 2, 0]);
    const rm = M(rib, { roughness: 0.4, metalness: rib === 0xd8a84a ? 0.5 : 0 });
    add(g, box(s[0] + 0.006, s[1] + 0.006, 0.035), rm, [0, s[1] / 2, 0]);
    add(g, box(0.035, s[1] + 0.006, s[2] + 0.006), rm, [0, s[1] / 2, 0]);
    for (const sx of [1, -1]) add(g, new THREE.TorusGeometry(0.035, 0.012, 8, 16), rm, [sx * 0.03, s[1] + 0.02, 0], [0, 0, sx * 0.6], [1, 0.7, 1]);
  };
  gift([-0.55, 0.6], [0.34, 0.26, 0.3], 0x9b2d2a, 0xd8a84a, 0.3);
  gift([0.1, 0.78], [0.26, 0.2, 0.26], 0xece2d0, 0xb3262e, -0.2);
  gift([-0.78, 0.08], [0.3, 0.34, 0.3], 0x5f7d61, 0xefe6d6, 0.5);
  gift([0.46, 0.52], [0.22, 0.16, 0.22], 0xe0a0a8, 0xefe6d6, 0.15);
  roomUpd.push((t) => {
    twinkle.forEach((m, k) => { const v = 0.65 + 0.35 * Math.sin(t * 2.2 + k * 2.1); m.color.setRGB(1 * v + 0.25, 0.83 * v + 0.12, 0.54 * v); });
    twinkleGlow.forEach((o) => { o.s.material.opacity = 0.35 + 0.35 * (0.5 + 0.5 * Math.sin(t * 2.2 + o.k * 2.1)); });
    treeLight.intensity = 2.4 + Math.sin(t * 2.2) * 0.3 + Math.sin(t * 5.3) * 0.15;
    starGlow.material.opacity = 0.45 + 0.1 * Math.sin(t * 1.7);
  });

  // 핑키 방석 (하얀 도넛 쿠션)
  const cushM = M(0xf5f0e8, { roughness: 1 });
  add(S, new THREE.TorusGeometry(0.3, 0.12, 14, 32), cushM, [0.72, 0.11, -1.72], [-Math.PI / 2, 0, 0], [1, 1, 0.82]);
  add(S, cyl(0.3, 0.3, 0.08, 32), cushM, [0.72, 0.05, -1.72]);

  // 러그
  const rugTex = canvasTex(512, 512, (x, w) => {
    const r = rng(5);
    x.fillStyle = '#dccbb2'; x.fillRect(0, 0, w, w);
    for (let i = 0; i < 9000; i++) { x.fillStyle = r() < 0.5 ? 'rgba(255,248,235,.08)' : 'rgba(120,96,70,.07)'; x.fillRect(r() * w, r() * w, 2, 2); }
    x.strokeStyle = '#c98f97'; x.lineWidth = 10; x.beginPath(); x.arc(w / 2, w / 2, w * 0.44, 0, 7); x.stroke();
    x.lineWidth = 3; x.beginPath(); x.arc(w / 2, w / 2, w * 0.405, 0, 7); x.stroke();
  });
  add(S, new THREE.CircleGeometry(1, 64), M(0xffffff, { map: rugTex, roughness: 1 }), [0.1, 0.006, 0.8], [-Math.PI / 2, 0, 0], [1.45, 0.95, 1], false);

  // 원목 타원 테이블 (게이트레그) + 초
  const TB = new THREE.Group(); TB.position.set(-1.55, 0, -0.5); TB.rotation.y = 0.35; S.add(TB);
  const wood = M(0x7a5133, { roughness: 0.5 });
  add(TB, cyl(1, 1, 0.035, 48), wood, [0, 0.74, 0], null, [0.78, 1, 0.5]);
  for (const [lx, lz] of [[0.48, 0.24], [-0.48, 0.24], [0.48, -0.24], [-0.48, -0.24]]) {
    add(TB, cyl(0.022, 0.022, 0.7, 12), wood, [lx, 0.37, lz]);
    for (const yy of [0.22, 0.5]) add(TB, SPH, wood, [lx, yy, lz], null, [0.036, 0.05, 0.036]);
    add(TB, box(0.05, 0.06, 0.05), wood, [lx, 0.69, lz]);
  }
  for (const lz of [0.24, -0.24]) add(TB, box(0.96, 0.025, 0.025), wood, [0, 0.1, lz]);
  for (const lx of [0.48, -0.48]) add(TB, box(0.025, 0.025, 0.48), wood, [lx, 0.1, 0]);
  add(TB, cyl(0.045, 0.045, 0.09, 20), M(0x2b2420, { roughness: 0.3 }), [0.15, 0.802, 0.05]);
  const flame = add(TB, new THREE.ConeGeometry(0.01, 0.035, 10), new THREE.MeshBasicMaterial({ color: 0xffc66e }), [0.15, 0.865, 0.05], null, null, false);
  const flameGlow = glow(TB, 0xffa64d, 0.32, [0.15, 0.87, 0.05], 0.6);
  const candle = new THREE.PointLight(0xff9d4a, 0.9, 3, 2); candle.position.set(0.15, 0.9, 0.05); TB.add(candle);
  add(TB, cyl(0.035, 0.03, 0.08, 20), M(0xeee6d8, { roughness: 0.5 }), [-0.22, 0.797, -0.06]);
  roomUpd.push((t) => {
    const f = 0.85 + Math.sin(t * 13) * 0.08 + Math.sin(t * 7.7) * 0.07;
    candle.intensity = 0.9 * f; flame.scale.y = f; flameGlow.material.opacity = 0.5 * f;
  });

  // 펜던트 조명 (식탁 위 구 조명)
  add(S, cyl(0.004, 0.004, 0.66, 6), M(0x222222), [-1.55, H - 0.33, -0.5], null, null, false);
  add(S, SPH, new THREE.MeshStandardMaterial({ color: 0xfff3e0, emissive: 0xffd29a, emissiveIntensity: 1.6 }), [-1.55, 1.92, -0.5], null, 0.13, false);
  const pend = new THREE.PointLight(0xffc98a, 1.6, 7, 2); pend.position.set(-1.55, 1.85, -0.5); S.add(pend);
  glow(S, 0xffd29a, 0.8, [-1.55, 1.92, -0.5], 0.3);

  // 하얀 라운드 체어 2개
  const chair = (x, z, ry) => {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; S.add(g);
    const fab = M(0xefe7db, { roughness: 1 });
    add(g, cyl(0.33, 0.31, 0.14, 32), fab, [0, 0.42, 0]);
    add(g, cyl(0.31, 0.27, 0.1, 32), fab, [0, 0.3, 0]);
    add(g, new THREE.TorusGeometry(0.29, 0.085, 12, 28, Math.PI * 1.25), fab, [0, 0.62, 0], [-Math.PI / 2, 0, -0.125 * Math.PI]);
    add(g, new THREE.CylinderGeometry(0.3, 0.3, 0.22, 24, 1, true, Math.PI * 0.45, Math.PI * 1.1), new THREE.MeshStandardMaterial({ color: 0xefe7db, roughness: 1, side: THREE.DoubleSide }), [0, 0.54, 0]);
    for (const [lx, lz] of [[0.2, 0.2], [-0.2, 0.2], [0.2, -0.2], [-0.2, -0.2]]) add(g, cyl(0.015, 0.012, 0.25, 8), M(0x6a4a33), [lx, 0.125, lz]);
  };
  chair(-2.35, 0.35, 2.39);
  chair(-0.8, -1.4, -0.72);

  // 양털 스툴
  {
    const g = new THREE.Group(); g.position.set(-2.65, 0, -1.35); S.add(g);
    for (const [lx, lz] of [[0.14, 0.14], [-0.14, 0.14], [0.14, -0.14], [-0.14, -0.14]]) add(g, cyl(0.016, 0.016, 0.38, 8), M(0x6e4d34), [lx, 0.19, lz]);
    const fg = new THREE.IcosahedronGeometry(0.24, 3); const pa = fg.attributes.position; const r = rng(9);
    for (let i = 0; i < pa.count; i++) { const s = 1 + (r() - 0.5) * 0.12; pa.setXYZ(i, pa.getX(i) * s, pa.getY(i) * s, pa.getZ(i) * s); }
    fg.computeVertexNormals();
    add(g, fg, M(0xf4eee4, { roughness: 1, flatShading: true }), [0, 0.45, 0], null, [1, 0.42, 1]);
  }

  // 원목 주방 (오른쪽 앞)
  {
    const oak = M(0xb98b5e, { roughness: 0.6 });
    add(S, box(0.6, 0.86, 2.5), oak, [2.9, 0.43, 0.75]);
    for (let i = 1; i < 5; i++) add(S, box(0.002, 0.8, 0.004), M(0x7a5a3c), [2.599, 0.44, -0.5 + i * 0.5], null, null, false);
    add(S, box(0.64, 0.04, 2.54), M(0xece8e1, { roughness: 0.3 }), [2.88, 0.88, 0.75]);
    add(S, new THREE.PlaneGeometry(0.42, 0.34), M(0xb9bcbf, { metalness: 0.6, roughness: 0.3 }), [2.86, 0.902, 0.25], [-Math.PI / 2, 0, 0], null, false);
    add(S, new THREE.PlaneGeometry(0.46, 0.46), M(0x161616, { roughness: 0.25 }), [2.86, 0.902, 1.45], [-Math.PI / 2, 0, 0], null, false);
    for (const [ox, oz] of [[0.1, 0.1], [-0.1, -0.1]]) add(S, new THREE.RingGeometry(0.06, 0.075, 24), M(0x444444), [2.86 + ox, 0.904, 1.45 + oz], [-Math.PI / 2, 0, 0], null, false);
    add(S, cyl(0.012, 0.012, 0.3, 8), M(0xb0b3b6, { metalness: 0.7, roughness: 0.3 }), [3.08, 1.05, 0.25]);
    add(S, cyl(0.01, 0.01, 0.16, 8), M(0xb0b3b6, { metalness: 0.7, roughness: 0.3 }), [3.0, 1.2, 0.25], [0, 0, Math.PI / 2]);
    const tile = canvasTex(256, 256, (x, w) => {
      x.fillStyle = '#f2efe9'; x.fillRect(0, 0, w, w); x.strokeStyle = '#b9b2a8'; x.lineWidth = 2;
      for (let i = 0; i <= 8; i++) { x.beginPath(); x.moveTo(i * 32, 0); x.lineTo(i * 32, w); x.stroke(); }
      for (let j = 0; j <= 2; j++) { x.beginPath(); x.moveTo(0, j * 128); x.lineTo(w, j * 128); x.stroke(); }
    }, [5, 1.2]);
    add(S, new THREE.PlaneGeometry(2.5, 0.64), M(0xffffff, { map: tile, roughness: 0.4 }), [X1 - 0.005, 1.22, 0.75], [0, -Math.PI / 2, 0], null, false);
    add(S, box(0.36, 0.78, 2.5), oak, [3.02, 1.94, 0.75]);
    for (let i = 1; i < 5; i++) add(S, box(0.002, 0.74, 0.004), M(0x7a5a3c), [2.839, 1.94, -0.5 + i * 0.5], null, null, false);
    // 핑키 밥그릇
    add(S, new THREE.CircleGeometry(0.2, 32), M(0xe7a3ac, { roughness: 1 }), [2.15, 0.004, 1.0], [-Math.PI / 2, 0, 0], [1.3, 1, 1], false);
    const pts = [[0, 0], [0.065, 0], [0.09, 0.015], [0.105, 0.05], [0.1, 0.055], [0.085, 0.02], [0.0, 0.012]].map(([a, b]) => new THREE.Vector2(a, b));
    add(S, new THREE.LatheGeometry(pts, 32), M(0xc8ccd0, { metalness: 0.7, roughness: 0.28, side: THREE.DoubleSide }), [2.15, 0.006, 1.0]);
  }

  // 천장 매입등
  for (const [x, z] of [[0, 1.4], [0.2, -1.2], [-1.6, 1.6], [1.7, 0.3]]) {
    add(S, new THREE.CircleGeometry(0.05, 20), new THREE.MeshBasicMaterial({ color: 0xfff1d6 }), [x, H - 0.002, z], [Math.PI / 2, 0, 0], null, false);
  }

  // 조명
  S.add(new THREE.HemisphereLight(0xe4ecff, 0x8a6648, 0.45));
  const spot = new THREE.SpotLight(0xffe2c0, 9, 9, 0.95, 0.9, 2);
  spot.position.set(0.3, H - 0.05, 1.5); spot.target.position.set(0.1, 0, 0.75);
  spot.castShadow = true; spot.shadow.mapSize.set(1024, 1024); spot.shadow.bias = -0.0004; spot.shadow.normalBias = 0.02;
  spot.shadow.camera.near = 0.3; spot.shadow.camera.far = 7;
  S.add(spot, spot.target);
}
buildRoom(roomScene);
{
  const pm = new THREE.PMREMGenerator(renderer), holder = new THREE.Group(), kids = [...roomScene.children];
  kids.forEach((k) => holder.add(k)); holder.position.set(-0.1, -1.1, -0.4); roomScene.add(holder); holder.updateMatrixWorld(true);
  roomScene.environment = pm.fromScene(roomScene, 0.04).texture;
  kids.forEach((k) => roomScene.add(k)); roomScene.remove(holder); pm.dispose();
}

// ================================================================
// 핑키 · 집 안에서 다니는 길
// ================================================================
const HOME = { x: 0.1, z: 0.85 };
const BOWL = V3(2.15, 0.006, 1.0), EAT = { x: 1.83, z: 0.875 };
const SPOTS = {
  cushion: { x: 0.72, z: -1.6 },
  gifts: { x: 1.45, z: -0.75, fx: 1.75, fz: -1.15 },
  window: { x: -2.5, z: -0.6, fx: -3.6, fz: -0.6 },
  table: { x: -0.72, z: 0.15, fx: -1.3, fz: -0.3 },
};
const OBST = [
  { x: -1.02, z: -0.44, r: 0.07 }, { x: -1.92, z: -0.11, r: 0.07 }, { x: -1.18, z: -0.89, r: 0.07 }, { x: -2.08, z: -0.56, r: 0.07 },
  { x: -2.35, z: 0.35, r: 0.36 }, { x: -0.8, z: -1.4, r: 0.36 }, { x: -2.65, z: -1.35, r: 0.28 }, { x: 2.3, z: -1.75, r: 0.95 },
  { x: -2.85, z: -2.35, r: 0.3 },
];
function steer(x, z, tx, tz) {
  let dx = tx - x, dz = tz - z; const dist = Math.hypot(dx, dz) || 1; dx /= dist; dz /= dist;
  let ax = 0, az = 0;
  for (const o of OBST) {
    const ox = o.x - x, oz = o.z - z, proj = ox * dx + oz * dz;
    if (proj <= 0 || proj > dist + o.r) continue;
    const px = ox - dx * proj, pz = oz - dz * proj, pd = Math.hypot(px, pz), R = o.r + 0.2;
    if (pd >= R) continue;
    const near = clamp(1 - (Math.hypot(ox, oz) - R) / 0.7, 0, 1);
    let sx = -px, sz = -pz; if (pd < 1e-3) { sx = -dz; sz = dx; }
    const sl = Math.hypot(sx, sz), w = ((R - pd) / R) * near * 2.2;
    ax += (sx / sl) * w; az += (sz / sl) * w;
  }
  const rx = dx + ax, rz = dz + az, rl = Math.hypot(rx, rz) || 1;
  return [rx / rl, rz / rl];
}
function collide(d) {
  for (const o of OBST) {
    const dx = d.x - o.x, dz = d.z - o.z, l = Math.hypot(dx, dz), R = o.r + 0.12;
    if (l < R && l > 1e-4) { d.x = o.x + (dx / l) * R; d.z = o.z + (dz / l) * R; }
  }
  d.x = clamp(d.x, -2.85, d.z > -0.6 && d.z < 2.1 ? 2.35 : 2.85);
  d.z = clamp(d.z, -2.25, 2.6);
}
const pinky = buildDog({ kind: 'beagle', colors: COLORS.pinky, scale: 1, seed: 7 });
pinky.steer = steer; pinky.collide = collide;
roomScene.add(pinky.root);
const contact = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({
  map: canvasTex(128, 128, (x, w) => { const g = x.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); g.addColorStop(0, 'rgba(40,24,12,.55)'); g.addColorStop(0.6, 'rgba(40,24,12,.22)'); g.addColorStop(1, 'rgba(40,24,12,0)'); x.fillStyle = g; x.fillRect(0, 0, w, w); }),
  transparent: true, depthWrite: false,
}));
contact.rotation.x = -Math.PI / 2; contact.renderOrder = 1; roomScene.add(contact);
roomUpd.push(() => {
  contact.position.set(pinky.x, 0.009, pinky.z);
  contact.rotation.z = -pinky.yaw;
  const lying = ['side', 'belly', 'down'].includes(pinky.tgt.name), f = Math.max(0, 1 - pinky.lift * 3);
  contact.scale.set(lying ? 0.3 : 0.2, lying ? 0.36 : 0.32, 1);
  contact.material.opacity = f;
});

// ================================================================
// 사람 손 (어깨에서 뻗어 나오는 팔 · 니트 소매)
// ================================================================
const knitTex = canvasTex(64, 64, (x, w) => {
  x.fillStyle = '#a3433b'; x.fillRect(0, 0, w, w);
  for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? 'rgba(0,0,0,.13)' : 'rgba(255,255,255,.06)'; x.fillRect(i * 8, 0, 8, w); }
  for (let j = 0; j < 16; j++) { x.fillStyle = 'rgba(0,0,0,.05)'; x.fillRect(0, j * 4, w, 1); }
}, [10, 14]);
const cuffTex = canvasTex(64, 64, (x, w) => {
  x.fillStyle = '#efe6d6'; x.fillRect(0, 0, w, w);
  for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? 'rgba(0,0,0,.1)' : 'rgba(255,255,255,.12)'; x.fillRect(i * 8, 0, 8, w); }
}, [12, 1]);
const skinMat = new THREE.MeshPhysicalMaterial({ color: 0xefc2a3, roughness: 0.55, sheen: 0.3, sheenColor: new THREE.Color(0xffd6c4) });
const nailMat = M(0xf7dcd3, { roughness: 0.3 });
function buildHand(left) {
  const g = new THREE.Group(), inner = new THREE.Group(); g.add(inner); if (left) inner.scale.x = -1;
  add(inner, SPH, skinMat, [0, 0, 0.005], null, [0.044, 0.016, 0.05]);
  add(inner, SPH, skinMat, [0.022, -0.004, -0.012], null, [0.022, 0.015, 0.03]);
  const fingers = [];
  for (const [x, l1, l2, r] of [[0.025, 0.032, 0.026, 0.0092], [0.008, 0.035, 0.028, 0.0095], [-0.009, 0.033, 0.026, 0.009], [-0.025, 0.026, 0.021, 0.0082]]) {
    const p1 = new THREE.Group(); p1.position.set(x, 0.002, 0.048); inner.add(p1);
    add(p1, new THREE.CapsuleGeometry(r, l1, 4, 10), skinMat, [0, 0, l1 / 2], [Math.PI / 2, 0, 0]);
    const p2 = new THREE.Group(); p2.position.set(0, 0, l1); p1.add(p2);
    add(p2, new THREE.CapsuleGeometry(r * 0.92, l2, 4, 10), skinMat, [0, 0, l2 / 2], [Math.PI / 2, 0, 0]);
    add(p2, SPH, nailMat, [0, r * 0.75, l2 * 0.85], null, [r * 0.75, r * 0.25, r * 0.9]);
    fingers.push([p1, p2]);
  }
  const t1 = new THREE.Group(); t1.position.set(0.038, -0.004, -0.005); t1.rotation.set(0, 0.75, 0); inner.add(t1);
  add(t1, new THREE.CapsuleGeometry(0.011, 0.028, 4, 10), skinMat, [0, 0, 0.014], [Math.PI / 2, 0, 0]);
  const t2 = new THREE.Group(); t2.position.set(0, 0, 0.028); t1.add(t2);
  add(t2, new THREE.CapsuleGeometry(0.0105, 0.02, 4, 10), skinMat, [0, 0, 0.01], [Math.PI / 2, 0, 0]);
  add(t2, SPH, nailMat, [0, 0.008, 0.018], null, [0.008, 0.003, 0.009]);
  add(inner, new THREE.CapsuleGeometry(0.028, 0.08, 6, 14), skinMat, [0, -0.002, -0.06], [Math.PI / 2, 0, 0], [1.25, 1, 0.75]);
  add(inner, new THREE.CylinderGeometry(0.046, 0.044, 0.07, 24), M(0xffffff, { map: cuffTex, roughness: 1 }), [0, 0, -0.125], [Math.PI / 2, 0, 0]);
  add(inner, new THREE.CylinderGeometry(0.045, 0.058, 1.1, 24), M(0xffffff, { map: knitTex, roughness: 1 }), [0, 0, -0.71], [Math.PI / 2, 0, 0]);
  return {
    g, inner,
    setCurl(c) { for (const [p1, p2] of fingers) { p1.rotation.x = 0.15 + c * 0.9; p2.rotation.x = 0.1 + c * 1.0; } t1.rotation.x = c * 0.35; t2.rotation.x = c * 0.4; },
  };
}
function makeHand(left) { const rig = buildHand(left); rig.g.visible = false; roomScene.add(rig.g); return { rig, want: null, pos: V3(), vis: false, curl: 0.2 }; }
const handR = makeHand(false), handL = makeHand(true);
const _hx = V3(), _hy = V3(), _hz = V3(), _hb = new THREE.Matrix4(), UP = V3(0, 1, 0);
function shoulder(side) { return roomCam.localToWorld(V3(side * 0.2, -0.45, 0.12)); }
function updateHand(h, side, dt) {
  const sh = h.want && h.want.shoulder ? roomCam.localToWorld(V3(...h.want.shoulder)) : shoulder(side);
  let up = UP;
  if (h.want) {
    if (!h.vis) { h.vis = true; h.pos.copy(sh); h.rig.g.visible = true; }
    h.pos.lerp(h.want.pos(), 1 - Math.exp(-(h.want.rate || 7) * dt));
    h.curl += ((h.want.curl ?? 0.2) - h.curl) * (1 - Math.exp(-8 * dt));
    if (h.want.up) up = h.want.up();
  } else if (h.vis) {
    h.pos.lerp(sh, 1 - Math.exp(-5 * dt));
    if (h.pos.distanceTo(sh) < 0.06) { h.vis = false; h.rig.g.visible = false; }
  }
  if (!h.vis) return;
  _hz.copy(h.pos).sub(sh); if (_hz.lengthSq() < 1e-6) _hz.set(0, 0, -1); _hz.normalize();
  _hy.copy(up).addScaledVector(_hz, -up.dot(_hz)); if (_hy.lengthSq() < 1e-6) _hy.set(0, 1, 0); _hy.normalize();
  _hx.crossVectors(_hy, _hz);
  _hb.makeBasis(_hx, _hy, _hz); h.rig.g.quaternion.setFromRotationMatrix(_hb); h.rig.g.position.copy(h.pos);
  h.rig.setCurl(h.curl);
}
function hideHandsNow() { for (const h of [handR, handL]) { h.want = null; h.vis = false; h.rig.g.visible = false; } }
const frameUp = (o) => V3(0, 1, 0).transformDirection(o.matrixWorld);

// 간식 · 밥 · 부스러기
function buildTreat() {
  const g = new THREE.Group(); const m = M(0xc98a4b, { roughness: 0.8 });
  add(g, new THREE.CapsuleGeometry(0.011, 0.045, 4, 8), m, [0, 0, 0], [0, 0, Math.PI / 2]);
  for (const sx of [1, -1]) for (const sz of [1, -1]) add(g, SPH, m, [sx * 0.032, 0, sz * 0.009], null, 0.013);
  return g;
}
const treat = buildTreat(); treat.visible = false; roomScene.add(treat);
const kibbleMat = M(0x9a6034, { roughness: 0.75 });
const moundGeo = (() => {
  const g = new THREE.SphereGeometry(0.08, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const s = 1 + Math.sin(p.getX(i) * 140) * Math.sin(p.getZ(i) * 140) * 0.08; p.setXYZ(i, p.getX(i) * s, p.getY(i) * s, p.getZ(i) * s); }
  g.computeVertexNormals(); return g;
})();
const mound = { m: add(roomScene, moundGeo, kibbleMat, [BOWL.x, 0.016, BOWL.z], null, 0.001), amount: 0 };
function updateMound() { const s = Math.sqrt(mound.amount); mound.m.visible = s > 0.02; mound.m.scale.set(Math.max(s, 0.001), Math.max(s, 0.001) * 0.55, Math.max(s, 0.001)); }
updateMound();
const scoop = new THREE.Group(); scoop.visible = false;
add(scoop, new THREE.LatheGeometry([[0, 0], [0.04, 0], [0.046, 0.05], [0.043, 0.052]].map(([a, b]) => new THREE.Vector2(a, b)), 24), M(0xc8ccd0, { metalness: 0.7, roughness: 0.3, side: THREE.DoubleSide }));
const scoopKibble = add(scoop, moundGeo, kibbleMat, [0, 0.03, 0], null, [0.5, 0.35, 0.5]);
const kibbles = [], kibbleGeo = new THREE.SphereGeometry(0.008, 6, 4);
let pouring = false, pourAcc = 0;
function stepKibble(dt) {
  if (pouring) {
    pourAcc += dt * 45;
    while (pourAcc > 1) {
      pourAcc--;
      const m = new THREE.Mesh(kibbleGeo, kibbleMat); m.castShadow = false; scoop.getWorldPosition(m.position); m.position.y += 0.02; m.position.x = lerp(m.position.x, BOWL.x, 0.7) + (Math.random() - 0.5) * 0.03; m.position.z = lerp(m.position.z, BOWL.z, 0.7) + (Math.random() - 0.5) * 0.03; roomScene.add(m);
      kibbles.push({ m, v: V3((Math.random() - 0.5) * 0.25, 0.1 + Math.random() * 0.2, (Math.random() - 0.5) * 0.25), t: 0 });
    }
  }
  for (let i = kibbles.length - 1; i >= 0; i--) {
    const k = kibbles[i]; k.t += dt; k.v.y -= 3.5 * dt; k.m.position.addScaledVector(k.v, dt);
    const dx = k.m.position.x - BOWL.x, dz = k.m.position.z - BOWL.z, inBowl = dx * dx + dz * dz < 0.095 * 0.095;
    if ((inBowl && k.m.position.y < 0.05) || k.m.position.y < 0.005 || k.t > 3) {
      if (inBowl) { mound.amount = Math.min(1, mound.amount + 1 / 40); updateMound(); }
      roomScene.remove(k.m); kibbles.splice(i, 1);
    }
  }
}
// 장난감 공 (던지면 튀고 굴러감)
const ball = (() => {
  const g = new THREE.Group();
  const tex = canvasTex(128, 64, (x, w, h) => {
    x.fillStyle = '#d3df48'; x.fillRect(0, 0, w, h);
    x.strokeStyle = '#f4f1e4'; x.lineWidth = 5; x.beginPath();
    for (let i = 0; i <= w; i++) { const yy = h / 2 + Math.sin((i / w) * Math.PI * 4) * h * 0.28; if (i) x.lineTo(i, yy); else x.moveTo(i, yy); }
    x.stroke();
  });
  add(g, new THREE.SphereGeometry(0.034, 24, 16), M(0xffffff, { map: tex, roughness: 0.95 }));
  g.visible = false; roomScene.add(g);
  return { g, v: V3(), state: 'none', r: 0.034 };
})();
function stepBall(dt) {
  const p = ball.g.position;
  if (ball.state === 'fly') {
    ball.v.y -= 9.8 * dt; p.addScaledVector(ball.v, dt);
    if (p.y < ball.r) {
      p.y = ball.r;
      if (Math.abs(ball.v.y) > 0.7) { ball.v.y = -ball.v.y * 0.45; ball.v.x *= 0.75; ball.v.z *= 0.75; say('통', () => ball.g.position.clone().add(V3(0, 0.1, 0)), 'small', 0.8); }
      else { ball.v.y = 0; ball.state = 'roll'; }
    }
  } else if (ball.state === 'roll') {
    const f = Math.exp(-2.2 * dt); ball.v.x *= f; ball.v.z *= f; p.addScaledVector(ball.v, dt);
    if (Math.hypot(ball.v.x, ball.v.z) < 0.04) ball.state = 'rest';
  }
  if (ball.state === 'fly' || ball.state === 'roll') {
    if (p.x < -3.0 || p.x > 2.45) { ball.v.x *= -0.5; p.x = clamp(p.x, -3.0, 2.45); }
    if (p.z < -2.3 || p.z > 2.7) { ball.v.z *= -0.5; p.z = clamp(p.z, -2.3, 2.7); }
    if (p.y < 0.8) for (const o of OBST) {
      const dx = p.x - o.x, dz = p.z - o.z, l = Math.hypot(dx, dz);
      if (l < o.r && l > 1e-4) { const nx = dx / l, nz = dz / l, vn = ball.v.x * nx + ball.v.z * nz; if (vn < 0) { ball.v.x -= 1.6 * vn * nx; ball.v.z -= 1.6 * vn * nz; } p.x = o.x + nx * o.r; p.z = o.z + nz * o.r; }
    }
    ball.g.rotation.x += (ball.v.z * dt) / ball.r; ball.g.rotation.z -= (ball.v.x * dt) / ball.r;
  }
}
function ballToWorld(vel) { roomScene.attach(ball.g); ball.g.scale.setScalar(1); ball.v.copy(vel || V3()); ball.state = 'fly'; }
const THROW_SPOTS = [[-0.45, -0.8], [1.05, -0.35], [0.95, 0.25], [-1.0, 1.25], [-0.2, -1.3], [0.5, -0.9]];
const crumbs = [];
const crumbGeo = box(0.008, 0.008, 0.008), crumbMat = M(0xb87a40);
function spawnCrumbs(p, n = 4) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(crumbGeo, crumbMat); m.position.copy(p); m.castShadow = true; roomScene.add(m);
    crumbs.push({ m, v: V3((Math.random() - 0.5) * 0.5, Math.random() * 0.6, (Math.random() - 0.2) * 0.5), age: 0 });
  }
}
function stepCrumbs(dt) {
  for (let i = crumbs.length - 1; i >= 0; i--) {
    const c = crumbs[i]; c.age += dt;
    c.v.y -= 3.2 * dt; c.m.position.addScaledVector(c.v, dt);
    if (c.m.position.y < 0.004) { c.m.position.y = 0.004; c.v.set(0, 0, 0); }
    if (c.age > 2.2) c.m.scale.setScalar(Math.max(0.01, 1 - (c.age - 2.2) * 2));
    if (c.age > 2.7) { roomScene.remove(c.m); crumbs.splice(i, 1); }
  }
}

// ================================================================
// 말풍선 (킁킁 · 냠냠 · ♥)
// ================================================================
const bubbles = [], bubbleLayer = $('#bubbles'), _p = V3();
function say(text, anchor, cls = '', life = 1.7, dx = null) {
  const el = document.createElement('div'); el.className = 'bubble ' + cls; el.textContent = text;
  bubbleLayer.appendChild(el);
  bubbles.push({ el, anchor, age: 0, life, dx: dx ?? (Math.random() - 0.5) * 40 });
}
const headTop = () => pinky.head.localToWorld(V3(0, 0.16, 0.03));
const noseTip = () => pinky.head.localToWorld(V3(0, 0.043, 0.196));
const mouthPt = () => pinky.head.localToWorld(V3(0, -0.022, 0.165));
const heart = () => say('♥', headTop, 'heart', 1.4, (Math.random() - 0.5) * 90);
function stepBubbles(dt, cam) {
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i]; b.age += dt;
    _p.copy(b.anchor()); _p.y += b.age * 0.1; _p.project(cam);
    const x = (_p.x * 0.5 + 0.5) * innerWidth + b.dx, y = (-_p.y * 0.5 + 0.5) * innerHeight;
    const o = b.age < 0.2 ? b.age / 0.2 : b.age > b.life - 0.45 ? Math.max(0, (b.life - b.age) / 0.45) : 1;
    b.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
    b.el.style.opacity = _p.z > 1 ? 0 : o;
    if (b.age >= b.life) { b.el.remove(); bubbles.splice(i, 1); }
  }
}
function clearBubbles() { bubbles.forEach((b) => b.el.remove()); bubbles.length = 0; }

// ================================================================
// 시점 (사람 눈 · 손만 나옴 · 다가가서 앉기)
// ================================================================
const CAM_POS = V3(0, 1.22, 3.0), CAM_AIM = V3(0.08, 0.4, 0.62);
const cam = { pos: CAM_POS.clone(), aim: CAM_AIM.clone(), tPos: CAM_POS.clone(), tAim: CAM_AIM.clone(), rate: 2.5 };
const look = { y: 0, p: 0, ty: 0, tp: 0 };
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function camTo(pos, aim, rate = 2.5) { cam.tPos.copy(pos); cam.tAim.copy(aim); cam.rate = rate; look.ty = 0; look.tp = 0; }
function camHome() { camTo(CAM_POS, CAM_AIM, 2.2); }
function kneelFor(spot, dist = 0.82, h = 0.72, aimY = 0.27) {
  const dx = CAM_POS.x - spot.x, dz = CAM_POS.z - spot.z, L = Math.hypot(dx, dz) || 1;
  return [V3(spot.x + (dx / L) * dist, h, spot.z + (dz / L) * dist), V3(spot.x, aimY, spot.z)];
}
const kneelAt = (dist, h, aimY) => kneelFor({ x: pinky.x, z: pinky.z }, dist, h, aimY);

// ================================================================
// 시간 · 명령 실행기
// ================================================================
let clock = 0;
const CANCEL = Symbol('cancel');
const waiters = [], tweens = [];
function wait(tok, sec) { return new Promise((res, rej) => waiters.push({ until: clock + sec, res, rej, tok })); }
function until(tok, pred) { return new Promise((res, rej) => waiters.push({ pred, res, rej, tok })); }
function tween(tok, dur, fn) { return new Promise((res, rej) => tweens.push({ t0: clock, dur, fn, res, rej, tok })); }
function stepTimers() {
  for (let i = waiters.length - 1; i >= 0; i--) {
    const w = waiters[i];
    if (w.tok && w.tok.cancelled) { waiters.splice(i, 1); w.rej(CANCEL); }
    else if (w.pred ? w.pred() : clock >= w.until) { waiters.splice(i, 1); w.res(); }
  }
  for (let i = tweens.length - 1; i >= 0; i--) {
    const w = tweens[i];
    if (w.tok && w.tok.cancelled) { tweens.splice(i, 1); w.rej(CANCEL); continue; }
    const k = clamp((clock - w.t0) / w.dur, 0, 1); w.fn(k);
    if (k >= 1) { tweens.splice(i, 1); w.res(); }
  }
}
let active = null, idleT = 5;
const actionsEl = $('#actions');
function setActiveBtn(name) { [...actionsEl.querySelectorAll('button')].forEach((b) => b.classList.toggle('on', b.dataset.cmd === name)); }
function cancelActive() { if (active) { active.cancelled = true; active.cleanups.forEach((f) => f()); active = null; setActiveBtn(null); } }
function resetTransient(d) {
  Object.assign(d, { stuckT: 0, lastD: undefined, detour: null, walkTarget: null, walkSpeed: 0.5, chew: false, lick: 0, tongueOut: 0, pant: false, sniff: 0, paddle: 0, lookFn: null, face: 'cam', eyeOpen: 1, tiltT: 0, jawOpen: 0, earPerk: 0, wagAmpT: 0.3, wagSpeedT: 6, liftT: 0 });
}
function releaseHands() { handR.want = null; handL.want = null; treat.visible = false; roomScene.add(treat); scoop.visible = false; pouring = false; }
function startCommand(name, fn, keepCam = false) {
  cancelActive();
  const tok = { cancelled: false, cleanups: [], name };
  active = tok; setActiveBtn(name); idleT = 5;
  resetTransient(pinky); releaseHands();
  if (pinky.tgt.name === 'held' || pinky.tgt.name === 'eat') setPose(pinky, 'stand', 5);
  if (!keepCam) camHome();
  fn(tok).then(() => { if (active === tok) { active = null; setActiveBtn(null); idleT = 4; } })
    .catch((e) => { if (e === CANCEL) return; console.error(e); if (active === tok) { active = null; setActiveBtn(null); idleT = 4; } });
}
async function walkTo(tok, x, z) {
  Object.assign(pinky, { walkTarget: { x, z }, stuckT: 0, lastD: undefined, detour: null });
  tok.cleanups.push(() => { pinky.walkTarget = null; });
  await until(tok, () => pinky.walkTarget === null);
}
async function comeHere(tok, speed = 0.75) {
  if (Math.hypot(pinky.x - HOME.x, pinky.z - HOME.z) > 0.08) {
    setPose(pinky, 'stand', 6); pinky.walkSpeed = speed; pinky.wagAmpT = 0.6; pinky.wagSpeedT = 13;
    await walkTo(tok, HOME.x, HOME.z);
  }
  pinky.face = 'cam'; pinky.walkSpeed = 0.5;
}
function happy(on) {
  if (on) Object.assign(pinky, { eyeOpen: 0.28, earPerk: -0.6, wagAmpT: 0.75, wagSpeedT: 15, pant: true, tiltT: 0.2 });
  else Object.assign(pinky, { eyeOpen: 1, earPerk: 0, wagAmpT: 0.4, wagSpeedT: 8, pant: false, tiltT: 0, paddle: 0 });
}
async function sniffAt(tok, spot, line) {
  setPose(pinky, 'stand', 6); pinky.tgt.gaze = 0; pinky.tgt.headPitch = 0.6; pinky.sniff = 0.5;
  await walkTo(tok, spot.x, spot.z);
  pinky.face = { x: spot.fx, z: spot.fz }; await wait(tok, 0.35);
  setPose(pinky, 'eat', 5); pinky.sniff = 1;
  say('킁킁', noseTip); await wait(tok, 0.9);
  say('킁킁', noseTip); await wait(tok, 0.9);
  setPose(pinky, 'stand', 5); pinky.sniff = 0; pinky.tiltT = 0.25;
  if (line) { say(line, headTop, 'soft', 1.9); await wait(tok, 1.5); }
  pinky.tiltT = 0;
}

const CMDS = {
  async sit(tok) {
    setPose(pinky, 'sit', 6);
    pinky.wagAmpT = 0.4; pinky.wagSpeedT = 8; pinky.earPerk = 0.4;
    await wait(tok, 1.2); pinky.earPerk = 0;
    await wait(tok, 2.5);
  },
  async down(tok) {
    setPose(pinky, 'down', 4);
    pinky.wagAmpT = 0.25; pinky.wagSpeedT = 5;
    await wait(tok, 1.4);
    pinky.tiltT = 0.18; await wait(tok, 1.2); pinky.tiltT = 0;
    await wait(tok, 2.5);
  },
  async roll(tok) {
    setPose(pinky, 'side', 3.2); pinky.eyeOpen = 0.75;
    await wait(tok, 1.2);
    say('뒹굴', headTop);
    for (let i = 0; i < 3; i++) {
      setPose(pinky, 'belly', 3.8); pinky.paddle = 1; await wait(tok, 0.6);
      setPose(pinky, 'side', 3.8); await wait(tok, 0.55);
    }
    setPose(pinky, 'belly', 3); pinky.paddle = 0.3; pinky.tongueOut = 0.55; pinky.eyeOpen = 0.45;
    pinky.wagAmpT = 0.25; pinky.wagSpeedT = 4;
    say('뒹굴뒹굴', headTop);
    await wait(tok, 1.6); pinky.paddle = 0;
    await wait(tok, 3);
  },
  async pet(tok) {
    await comeHere(tok, 0.7);
    const [p, a] = kneelAt(0.72, 0.98, 0.22); camTo(p, a);
    setPose(pinky, 'sit', 5);
    await wait(tok, 0.8);
    happy(true); say('좋아…', headTop, 'soft', 1.8);
    let s = 0, lift = 0, onBack = false;
    const upOf = () => frameUp(onBack ? pinky.body : pinky.head);
    const pt = () => (onBack ? pinky.body.localToWorld(V3(0, 0.118, lerp(0.14, -0.18, s))) : pinky.head.localToWorld(V3(0, 0.125, lerp(0.05, -0.06, s))));
    handR.want = { pos: () => pt().addScaledVector(upOf(), 0.02 + lift), up: upOf, curl: 0.12, rate: 12, shoulder: [0.36, -0.12, 0.05] };
    for (let i = 0; i < 5; i++) {
      onBack = i >= 2;
      await tween(tok, 0.75, (k) => { s = ease(k); lift = 0; });
      heart();
      await tween(tok, 0.32, (k) => { lift = Math.sin(k * Math.PI) * 0.035; s = 1 - k; });
    }
    handR.want = null;
    await wait(tok, 0.5); happy(false); pinky.tiltT = 0.3; say('더 해줘…', headTop, 'soft', 1.8);
    await wait(tok, 1.6); pinky.tiltT = 0; camHome();
  },
  async hug(tok) {
    await comeHere(tok, 0.75);
    const [p, a] = kneelAt(0.95, 0.74, 0.32); camTo(p, a);
    setPose(pinky, 'stand', 5); pinky.tgt.yawOff = 0;
    pinky.wagAmpT = 0.65; pinky.wagSpeedT = 14; pinky.earPerk = 0.6; say('!', headTop, '', 1);
    await wait(tok, 0.7);
    const center = () => pinky.body.localToWorld(V3(0, -0.03, 0.115));
    const armpit = (sx) => pinky.body.localToWorld(V3(sx * 0.115, -0.03, 0.115));
    const outward = (sx) => armpit(sx).sub(center()).normalize();
    handR.want = { pos: () => armpit(1), up: () => outward(1), curl: 0.55, rate: 6 };
    handL.want = { pos: () => armpit(-1), up: () => outward(-1), curl: 0.55, rate: 6 };
    await wait(tok, 0.9);
    setPose(pinky, 'held', 3.5); pinky.liftT = 0.2;
    const p0 = { x: pinky.x, z: pinky.z }, dx = roomCam.position.x - p0.x, dz = roomCam.position.z - p0.z, L = Math.hypot(dx, dz);
    const p1 = { x: p0.x + (dx / L) * 0.33, z: p0.z + (dz / L) * 0.33 };
    camTo(cam.tPos, V3(p1.x, 0.64, p1.z), 2.2);
    await tween(tok, 1.1, (k) => { const e = ease(k); pinky.x = lerp(p0.x, p1.x, e); pinky.z = lerp(p0.z, p1.z, e); });
    happy(true); pinky.pant = false; pinky.tiltT = 0;
    for (let i = 0; i < 3; i++) {
      pinky.lick = 1; pinky.tongueOut = 0.7; say('할짝', headTop, '', 1.1, (i % 2 ? 1 : -1) * 80); heart();
      await wait(tok, 0.55); pinky.lick = 0; pinky.tongueOut = 0; await wait(tok, 0.35);
    }
    say('포근해…', headTop, 'soft', 1.8); await wait(tok, 1.6);
    await tween(tok, 1.0, (k) => { const e = ease(k); pinky.x = lerp(p1.x, p0.x, e); pinky.z = lerp(p1.z, p0.z, e); });
    setPose(pinky, 'stand', 4); pinky.liftT = 0; happy(false);
    camTo(cam.tPos, V3(p0.x, 0.32, p0.z), 2.2);
    await wait(tok, 0.7); releaseHands(); await wait(tok, 0.6); camHome();
  },
  async play(tok) {
    handR.rig.inner.add(ball.g); ball.g.position.set(0, -0.05, 0.03); ball.g.rotation.set(0, 0, 0); ball.g.scale.setScalar(1);
    ball.g.visible = true; ball.state = 'held';
    tok.cleanups.push(() => { if (ball.state === 'held' || ball.state === 'mouth') ballToWorld(); });
    let wind = 0;
    const hold = () => roomCam.localToWorld(V3(0.2, -0.22 + wind * 0.14, -0.5 + wind * 0.2));
    handR.want = { pos: hold, up: () => V3(0, -1, 0), curl: 0.55, rate: 6 };
    setPose(pinky, 'stand', 6); pinky.face = 'cam';
    pinky.lookFn = () => ball.g.getWorldPosition(V3());
    pinky.earPerk = 1; pinky.wagAmpT = 0.85; pinky.wagSpeedT = 18;
    await wait(tok, 0.7); say('!', headTop, '', 1);
    await wait(tok, 0.5);
    await tween(tok, 0.35, (k) => { wind = ease(k); });
    // 던지기: 핑키에서 먼 곳을 고름
    const spots = THROW_SPOTS.filter(([x, z]) => Math.hypot(x - pinky.x, z - pinky.z) > 0.9);
    const [tx, tz] = spots[Math.floor(Math.random() * spots.length)] || THROW_SPOTS[0];
    const from = ball.g.getWorldPosition(V3()), T = 0.85;
    ballToWorld(V3((tx - from.x) / T, (ball.r - from.y + 0.5 * 9.8 * T * T) / T, (tz - from.z) / T));
    handR.want = { pos: () => roomCam.localToWorld(V3(0.12, -0.08, -0.75)), up: () => V3(0, -1, 0), curl: 0.2, rate: 14 };
    say('왈!', headTop, '', 1);
    await wait(tok, 0.25); handR.want = null;
    // 쫓아가기
    pinky.walkSpeed = 1.15; pinky.wagAmpT = 0.7;
    tok.cleanups.push(() => { pinky.walkTarget = null; });
    const reach = 0.26, chaseT0 = clock;
    await until(tok, () => {
      const b = ball.g.position, dx = b.x - pinky.x, dz = b.z - pinky.z, dist = Math.hypot(dx, dz) || 1;
      pinky.walkTarget = dist > reach + 0.03 ? { x: b.x - (dx / dist) * reach, z: b.z - (dz / dist) * reach } : null;
      if (clock - chaseT0 > 12) { ball.state = 'rest'; ball.g.position.set(pinky.x + Math.sin(pinky.yaw) * reach, ball.r, pinky.z + Math.cos(pinky.yaw) * reach); return true; }
      return ball.state === 'rest' && dist < reach + 0.08;
    });
    pinky.walkTarget = null; pinky.face = { x: ball.g.position.x, z: ball.g.position.z };
    await wait(tok, 0.3);
    setPose(pinky, 'eat', 7); pinky.tgt.headPitch = 0.95; pinky.jawOpen = 0.35;
    await wait(tok, 0.45);
    pinky.jaw.attach(ball.g); ball.g.position.set(0, -0.012, 0.1); ball.state = 'mouth'; pinky.jawOpen = 0.12;
    say('앙!', headTop, '', 1.1);
    setPose(pinky, 'stand', 6); pinky.lookFn = null; pinky.tgt.gaze = 1;
    await wait(tok, 0.35);
    pinky.walkSpeed = 0.95; await walkTo(tok, HOME.x, HOME.z); pinky.walkSpeed = 0.5;
    pinky.face = 'cam'; setPose(pinky, 'sit', 7);
    await wait(tok, 0.7);
    const c = roomCam.position, dir = V3(c.x - pinky.x, 0, c.z - pinky.z).normalize();
    pinky.jawOpen = 0.3; ballToWorld(dir.multiplyScalar(0.5).add(V3(0, 0.4, 0)));
    await wait(tok, 0.2); pinky.jawOpen = 0;
    pinky.wagAmpT = 0.85; pinky.wagSpeedT = 18; pinky.tiltT = 0.25; say('또 던져!', headTop, 'soft', 2);
    await wait(tok, 2.2); pinky.tiltT = 0;
  },
  async treat(tok) {
    const [p, a] = kneelFor(HOME, 0.85); camTo(p, a);
    handR.rig.inner.add(treat); treat.position.set(0, -0.03, 0.02); treat.rotation.set(0, 0.5, 0); treat.scale.setScalar(1); treat.visible = true;
    const show = () => roomCam.localToWorld(V3(0.1, -0.2, -0.42));
    const near = () => { const m = mouthPt(), c = roomCam.position; const dir = V3(c.x - m.x, 0, c.z - m.z).normalize(); return m.add(dir.multiplyScalar(0.17)).add(V3(0, -0.02, 0)); };
    let target = show;
    handR.want = { pos: () => target(), up: () => V3(0, -1, 0), curl: 0.3, rate: 5 };
    pinky.lookFn = () => treat.getWorldPosition(V3());
    await wait(tok, 0.5);
    pinky.earPerk = 1; pinky.wagAmpT = 0.85; pinky.wagSpeedT = 18; say('!', headTop, '', 1.1);
    await wait(tok, 0.3);
    if (Math.hypot(pinky.x - HOME.x, pinky.z - HOME.z) > 0.08) {
      setPose(pinky, 'stand', 7); pinky.walkSpeed = 0.95; say('간식이다!', headTop, 'soft', 1.4);
      await walkTo(tok, HOME.x, HOME.z); pinky.walkSpeed = 0.5;
    }
    pinky.face = 'cam'; setPose(pinky, 'sit', 9);
    await wait(tok, 0.6);
    target = near; await wait(tok, 0.9);
    pinky.jawOpen = 0.3; handR.want.rate = 6; target = () => mouthPt().add(V3(0, -0.03, 0));
    await wait(tok, 0.5);
    pinky.jaw.attach(treat); treat.position.set(0, 0, 0.085); pinky.jawOpen = 0;
    handR.want = null;
    pinky.lookFn = null; pinky.chew = true; pinky.wagSpeedT = 12; pinky.earPerk = 0.3;
    const words = ['냠', '챱', '냠냠', '챱챱', '냠', '챱챱'];
    for (let i = 0; i < words.length; i++) {
      say(words[i], headTop, '', 1.2, (i % 2 ? 1 : -1) * (70 + Math.random() * 25));
      spawnCrumbs(mouthPt(), 3);
      treat.scale.multiplyScalar(0.78);
      await wait(tok, 0.32);
    }
    treat.visible = false; roomScene.add(treat); pinky.chew = false;
    pinky.lick = 1; say('쩝쩝', headTop, '', 1.2, 80); await wait(tok, 0.9); pinky.lick = 0;
    pinky.tiltT = 0.32; pinky.wagAmpT = 0.45; pinky.wagSpeedT = 9; pinky.earPerk = 0.5;
    say('…하나 더?', headTop, 'soft', 2.4);
    await wait(tok, 2.2); pinky.tiltT = 0; pinky.earPerk = 0; camHome();
  },
  async feed(tok) {
    camTo(V3(1.2, 1.18, 2.2), V3(2.0, 0.1, 0.9));
    mound.amount = 0; updateMound();
    tok.cleanups.push(() => { pouring = false; });
    handR.rig.inner.add(scoop); scoop.position.set(0, -0.075, 0.05); scoop.visible = true; scoopKibble.visible = true;
    let roll = 0;
    const above = () => BOWL.clone().add(V3(-0.04, 0.3, 0.1));
    handR.want = { pos: above, up: () => V3(0, 1, 0).applyAxisAngle(V3().copy(handR.pos).sub(shoulder(1)).normalize(), roll), curl: 0.75, rate: 4 };
    await wait(tok, 1.3);
    pinky.earPerk = 1; pinky.wagAmpT = 0.8; pinky.wagSpeedT = 17; say('!', headTop, '', 1.1);
    await tween(tok, 0.5, (k) => { roll = -1.9 * ease(k); });
    scoopKibble.visible = false; pouring = true;
    say('와르르', () => BOWL.clone().add(V3(0, 0.3, 0)), '', 1.4);
    setPose(pinky, 'stand', 6); pinky.walkSpeed = 0.9; pinky.lookFn = () => BOWL;
    const going = walkTo(tok, EAT.x, EAT.z); going.catch(() => {});
    await wait(tok, 1.0); pouring = false;
    await tween(tok, 0.4, (k) => { roll = -1.9 * (1 - ease(k)); });
    handR.want = null;
    await going;
    pinky.walkSpeed = 0.5; pinky.lookFn = null; pinky.face = { x: BOWL.x, z: BOWL.z };
    await wait(tok, 0.4);
    setPose(pinky, 'eat', 5); pinky.chew = true;
    const words = ['챱챱', '와구와구', '냠냠', '챱챱', '와구와구', '냠'];
    for (let i = 0; i < words.length; i++) {
      say(words[i], headTop, '', 1.2, (i % 2 ? 1 : -1) * 75);
      mound.amount = Math.max(0, mound.amount - 1 / words.length); updateMound();
      await wait(tok, 0.55);
    }
    pinky.chew = false; mound.amount = 0; updateMound();
    pinky.lick = 1; say('할짝할짝', headTop, '', 1.2, 70); await wait(tok, 0.9); pinky.lick = 0;
    setPose(pinky, 'stand', 5); pinky.face = 'cam'; pinky.tiltT = 0.3;
    say('…더 없어?', headTop, 'soft', 2); await wait(tok, 1.8); pinky.tiltT = 0;
    camHome(); await walkTo(tok, HOME.x, HOME.z); pinky.face = 'cam';
  },
  async sniff(tok) {
    pinky.wagAmpT = 0.45; pinky.wagSpeedT = 10;
    await sniffAt(tok, SPOTS.gifts, '선물 냄새…');
    await sniffAt(tok, { x: EAT.x, z: EAT.z, fx: BOWL.x, fz: BOWL.z }, '밥그릇 비었네…');
    await sniffAt(tok, SPOTS.table, '뭐 떨어진 거 없나');
    pinky.tgt.gaze = 1; pinky.tgt.headPitch = 0;
    await walkTo(tok, HOME.x, HOME.z);
    pinky.face = 'cam'; pinky.wagAmpT = 0.4; pinky.wagSpeedT = 8;
    await wait(tok, 0.8);
  },
  async touch(tok) {
    const [p, a] = kneelAt(0.78, 0.95, 0.22); camTo(p, a, 2.2);
    happy(true); if (['side', 'belly'].includes(pinky.tgt.name)) pinky.paddle = 0.5;
    say('좋아…', headTop, 'soft', 1.6);
    handR.want = { pos: () => touch.pt.clone().addScaledVector(touch.n, 0.02), up: () => touch.n, curl: 0.12, rate: 16, shoulder: [0.34, -0.15, 0.05] };
    await until(tok, () => !touch.active);
    handR.want = null; pinky.paddle = 0;
    await wait(tok, 0.6); happy(false); pinky.tiltT = 0.3; say('더 해줘…', headTop, 'soft', 1.8);
    await wait(tok, 1.6); pinky.tiltT = 0; camHome();
  },
};

// 혼자 있을 때: 집 안을 돌아다니기
async function roam(tok) {
  const acts = [
    async () => { // 방석에서 낮잠
      setPose(pinky, 'stand', 5); pinky.walkSpeed = 0.38;
      await walkTo(tok, SPOTS.cushion.x, SPOTS.cushion.z);
      pinky.face = { x: 0.2, z: 0.4 }; pinky.liftT = 0.08; await wait(tok, 0.5);
      setPose(pinky, 'down', 3); await wait(tok, 1.4);
      pinky.eyeOpen = 0.08; pinky.wagAmpT = 0.05;
      for (let i = 0; i < 3; i++) { say('쿨…', headTop, '', 2); await wait(tok, 2.6 + Math.random()); }
      pinky.eyeOpen = 1; pinky.wagAmpT = 0.3; await wait(tok, 0.8);
      setPose(pinky, 'stand', 4); await wait(tok, 0.6); pinky.liftT = 0;
    },
    async () => { pinky.walkSpeed = 0.4; await sniffAt(tok, SPOTS.gifts, '선물 냄새…'); },
    async () => {
      pinky.walkSpeed = 0.4; await sniffAt(tok, { x: EAT.x, z: EAT.z, fx: BOWL.x, fz: BOWL.z }, '밥그릇 비었네…');
      pinky.face = 'cam'; await wait(tok, 0.6); say('밥 줘…', headTop, 'soft', 1.8); await wait(tok, 1.6);
    },
    async () => { // 창밖 구경
      setPose(pinky, 'stand', 5); pinky.walkSpeed = 0.38;
      await walkTo(tok, SPOTS.window.x, SPOTS.window.z);
      pinky.face = { x: SPOTS.window.fx, z: SPOTS.window.fz }; await wait(tok, 0.6);
      setPose(pinky, 'sit', 5); pinky.lookFn = () => V3(-4.6, 1.0, -0.6);
      await wait(tok, 3 + Math.random() * 2);
      say('단풍 예쁘다…', headTop, 'soft', 1.9); await wait(tok, 2.2);
      pinky.lookFn = null; setPose(pinky, 'stand', 5); await wait(tok, 0.5);
    },
    async () => { pinky.walkSpeed = 0.4; await sniffAt(tok, SPOTS.table, '뭐 떨어진 거 없나'); },
    async () => { // 나한테 와서 쳐다보기
      setPose(pinky, 'stand', 5); pinky.walkSpeed = 0.5;
      await walkTo(tok, HOME.x, HOME.z);
      pinky.face = 'cam'; setPose(pinky, 'sit', 5); pinky.wagAmpT = 0.55; pinky.wagSpeedT = 11;
      await wait(tok, 0.8); pinky.tiltT = 0.28; say('간식 있어?', headTop, 'soft', 1.8);
      await wait(tok, 1.6); pinky.tiltT = 0; await wait(tok, 1.5);
    },
    async () => { // 러그 위 어슬렁
      setPose(pinky, 'stand', 5); pinky.walkSpeed = 0.35;
      await walkTo(tok, -0.6 + Math.random() * 1.4, 0.2 + Math.random() * 1.0);
      pinky.face = 'cam'; await wait(tok, 2 + Math.random() * 2);
    },
  ];
  let last = -1;
  for (;;) {
    let i; do { i = Math.floor(Math.random() * acts.length); } while (i === last);
    last = i;
    pinky.face = 'cam'; pinky.lookFn = null; pinky.sniff = 0; pinky.tgt.gaze = 1; pinky.tgt.headPitch = 0;
    await acts[i]();
    await wait(tok, 1 + Math.random() * 2);
  }
}

actionsEl.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-cmd]'); if (!b) return;
  const name = b.dataset.cmd; startCommand(name, CMDS[name]);
});

// ================================================================
// 만지기 (핑키를 누르고 문지르면 쓰다듬기)
// ================================================================
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), _nm = new THREE.Matrix3();
const touch = { active: false, x: 0, y: 0, pt: V3(), n: V3(0, 1, 0), last: V3(), moved: 0, heartT: 0 };
function pickPinky(x, y) {
  ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1); ray.setFromCamera(ndc, roomCam);
  return ray.intersectObjects(pinky.meshes, false)[0] || null;
}
function setTouchHit(hit) {
  touch.pt.copy(hit.point);
  touch.n.copy(hit.face.normal).applyNormalMatrix(_nm.getNormalMatrix(hit.object.matrixWorld)).normalize();
}
function stepTouch(dt) {
  if (!touch.active) return;
  const hit = pickPinky(touch.x, touch.y);
  if (hit) { touch.miss = 0; setTouchHit(hit); touch.moved += touch.pt.distanceTo(touch.last); touch.last.copy(touch.pt); }
  else if (++touch.miss > 45) { touch.active = false; return; }
  touch.heartT -= dt;
  if (touch.moved > 0.12 || touch.heartT <= 0) { touch.moved = 0; touch.heartT = 1.1; heart(); }
}

// ================================================================
// 방 들어가기 · 매 프레임
// ================================================================
let greetTimer = 0;
function resetRoom() {
  cancelActive(); clearBubbles(); releaseHands(); hideHandsNow(); drag = null; touch.active = false;
  for (const k of kibbles) roomScene.remove(k.m); kibbles.length = 0; for (const c of crumbs) roomScene.remove(c.m); crumbs.length = 0;
  $('#hint').classList.remove('gone');
  Object.assign(pinky, { x: HOME.x, z: HOME.z, yaw: 0, lift: 0 });
  resetTransient(pinky);
  setPose(pinky, 'stand', 50);
  const st = poseFor('stand', pinky);
  for (const k of POSE_KEYS) pinky.cur[k] = st[k];
  st.paws.forEach((v, i) => pinky.cur.paws[i].copy(v)); pinky.cur.lean = [...st.lean];
  mound.amount = 0; updateMound();
  roomScene.attach(ball.g); ball.g.visible = false; ball.state = 'none';
  cam.pos.copy(CAM_POS); cam.aim.copy(CAM_AIM); camHome();
  look.y = look.ty = look.p = look.tp = 0;
  idleT = 6;
  pinky.wagAmpT = 0.7; pinky.wagSpeedT = 15; pinky.earPerk = 0.6;
  clearTimeout(greetTimer); greetTimer = setTimeout(() => { if (!active) { pinky.wagAmpT = 0.3; pinky.wagSpeedT = 6; pinky.earPerk = 0; } }, 2600);
}
function updateRoom(dt, t) {
  const k = 1 - Math.exp(-cam.rate * dt);
  cam.pos.lerp(cam.tPos, k); cam.aim.lerp(cam.tAim, k);
  const lk = 1 - Math.exp(-8 * dt);
  look.y += (look.ty - look.y) * lk; look.p += (look.tp - look.p) * lk;
  const dx = cam.aim.x - cam.pos.x, dy = cam.aim.y - cam.pos.y, dz = cam.aim.z - cam.pos.z;
  roomCam.position.copy(cam.pos);
  if (!reduceMotion) roomCam.position.y += Math.sin(t * 0.7) * 0.004;
  roomCam.rotation.set(Math.atan2(dy, Math.hypot(dx, dz)) + look.p, Math.atan2(-dx, -dz) + look.y, 0, 'YXZ');
  roomCam.updateMatrixWorld(true);
  roomUpd.forEach((f) => f(t, dt));
  stepTouch(dt);
  if (!active && !transitioning) { idleT -= dt; if (idleT <= 0) startCommand('roam', roam, true); }
  updateDog(pinky, dt, t, roomCam.position);
  updateHand(handR, 1, dt); updateHand(handL, -1, dt);
  stepCrumbs(dt); stepKibble(dt); stepBall(dt);
}

// ================================================================
// 화면 전환 · 입력
// ================================================================
let mode = 'select';
const fadeEl = $('#fade');
let transitioning = false;
function fade(mid) {
  if (transitioning) return;
  transitioning = true; fadeEl.classList.add('on');
  setTimeout(() => { mid(); requestAnimationFrame(() => requestAnimationFrame(() => { fadeEl.classList.remove('on'); transitioning = false; })); }, reduceMotion ? 0 : 560);
}
function goRoom() {
  fade(() => { mode = 'room'; $('#selectUI').hidden = true; $('#roomUI').hidden = false; resetRoom(); $('#backBtn').focus({ preventScroll: true }); });
}
function goSelect() {
  if (transitioning) return;
  cancelActive(); clearBubbles(); releaseHands(); touch.active = false; drag = null; idleT = Infinity;
  fade(() => { mode = 'select'; clearBubbles(); hideHandsNow(); drag = null; $('#roomUI').hidden = true; $('#selectUI').hidden = false; });
}
$('#backBtn').addEventListener('click', goSelect);

let toastTimer = 0;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200); }

const canvas = $('#c');
let drag = null;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  if (!e.isPrimary || e.button !== 0 || transitioning) return;
  canvas.setPointerCapture(e.pointerId);
  if (mode === 'room') {
    const hit = pickPinky(e.clientX, e.clientY);
    if (hit) {
      Object.assign(touch, { active: true, x: e.clientX, y: e.clientY, moved: 0, heartT: 0.4, miss: 0 });
      setTouchHit(hit); touch.last.copy(touch.pt);
      $('#hint').classList.add('gone');
      startCommand('touch', CMDS.touch);
      return;
    }
  }
  drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, moved: 0 };
});
canvas.addEventListener('pointermove', (e) => {
  if (!e.isPrimary) return;
  if (touch.active) { touch.x = e.clientX; touch.y = e.clientY; return; }
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
  drag.moved += Math.abs(dx) + Math.abs(dy);
  if (mode === 'room') {
    look.ty = clamp(look.ty + dx * 0.0045, -1.2, 1.2);
    look.tp = clamp(look.tp + dy * 0.0035, -0.5, 0.55);
    if (drag.moved > 30) $('#hint').classList.add('gone');
  }
});
canvas.addEventListener('pointerup', (e) => {
  if (!e.isPrimary) return;
  if (touch.active) { touch.active = false; drag = null; return; }
  if (!drag) return;
  const dx = e.clientX - drag.x0, moved = drag.moved; drag = null;
  if (mode !== 'select') return;
  if (Math.abs(dx) > 40) { if (dx < 0) select(sel + 1, 1); else select(sel - 1, -1); return; }
  if (moved > 12) return;
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, selCam);
  const hit = ray.intersectObjects(ring.children, true).find((h) => h.object.userData.idx !== undefined);
  if (!hit) return;
  const i = hit.object.userData.idx;
  if (i === sel) { if (DOGS[i].ready) goRoom(); else { const pl = DOGS[i].place === '장소 정하는 중' ? '추억 장소' : DOGS[i].place, jong = (pl.charCodeAt(pl.length - 1) - 0xac00) % 28; toast(`${DOGS[i].name}의 ${pl}${jong ? '은' : '는'} 준비 중이에요`); } }
  else select(i);
});
canvas.addEventListener('pointercancel', () => { drag = null; touch.active = false; });
window.addEventListener('keydown', (e) => {
  if (mode !== 'select') { if (e.key === 'Escape') goSelect(); return; }
  if (e.key === 'ArrowLeft') select(sel - 1, -1);
  else if (e.key === 'ArrowRight') select(sel + 1, 1);
  else if (e.key === 'Enter' && document.activeElement === document.body && DOGS[sel].ready) goRoom();
});

function resize() {
  const w = innerWidth, h = innerHeight, a = w / h;
  renderer.setSize(w, h, false);
  const pr = Math.min(window.devicePixelRatio, LITE ? 1.5 : 2); renderer.setPixelRatio(pr); composer.setPixelRatio(pr); composer.setSize(w, h);
  selCam.aspect = a; selCam.fov = a < 0.8 ? 48 : 38; selCam.updateProjectionMatrix();
  selCam.position.set(0, 1.25, a < 0.8 ? 6.0 : 5.2); selCam.lookAt(0, a < 0.8 ? 0.42 : 0.36, RING_R - 0.1);
  roomCam.aspect = a; roomCam.fov = a < 0.8 ? 64 : 50; roomCam.updateProjectionMatrix();
  CAM_POS.set(0, a < 0.8 ? 1.42 : 1.22, a < 0.8 ? 3.65 : 3.0);
}
window.addEventListener('resize', resize); resize();

// ================================================================
// 루프
// ================================================================
function setupPost() {
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  composer.addPass(gradePass);
}
setupPost();
function drawFrame(scene, cam) {
  renderPass.scene = scene; renderPass.camera = cam;
  composer.render();
}
let last = performance.now(), booted = false;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now; clock += dt;
  stepTimers();
  if (mode === 'select') { updateSelect(dt, clock); drawFrame(selScene, selCam); stepBubbles(dt, selCam); }
  else { updateRoom(dt, clock); drawFrame(roomScene, roomCam); stepBubbles(dt, roomCam); }
  if (!booted) { booted = true; $('#boot').classList.add('gone'); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 로컬에서만 쓰는 점검용 핸들
if (location.hostname === 'localhost') window.__dbg = { pinky, setPose, startCommand, CMDS, look, cam, ball, goRoom, goSelect, roomCam };
