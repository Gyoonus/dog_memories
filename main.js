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
      col = mix(col, col * vec3(1.04, 1.0, 0.94), 0.45);
      col = (col - 0.5) * 1.02 + 0.5;
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
  pinky: { base: 0xeee3d0, tan: 0xa88a6c, headTan: 0xab9074, ear: 0xa18b74, saddle: 0x302a25, grizzle: 0x6a6058, nose: 0x0d0b0a, collar: 'ribbon', medal: true }, // 삼색: 꿀빛 황갈(어깨·옆구리·허벅지) · 회색 털이 섞인 차콜 안장(검은 비닐이 아니다) · 따뜻한 크림
  pupu: { base: 0xf1e6d2, tan: 0xe7d0ab, saddle: 0xe7d0ab, nose: 0x6f4a46 },
  generic: { base: 0xe9e1d6, tan: 0xc99a6c, saddle: 0x4a3c34, nose: 0x1c1513 },
};
const P = (x, y, z) => V3(x, y, z);
// paws: 발 위치(강아지 바닥 기준). lean: 발목 아래 마디 기울기(0 = 수직, π/2 = 바닥에 눕힘). free: 1이면 다리를 곧게 뻗음
// 비글(핑키) 관절: 어깨 관절(견단) (±0.048, -0.022, 0.226 — 걸을 때 견갑골과 함께 앞뒤로 조금 미끄러진다) → 위팔 0.10(뒤·아래로) → 팔꿈치(뒤를 향함, 가슴 바닥 높이) → 아래팔 0.122(수직) → 손목 → 발허리 0.045
//   고관절 (±0.062, 0.015, -0.175) → 무릎(앞을 향함) → 허벅지 0.118 → 정강이 0.105(뒤·아래로) → 비절(뒤를 향함, 바닥에서 ~0.12) → 뒷발허리 0.088(거의 수직)
//   척추: 갈비 구간은 한 덩어리, 목뿌리(neck)와 허리(lumbar: 양수 = 골반이 밑으로 말림)에서 굽는다. abd: 다리별 벌림각(양수 = 바깥으로) · bendY: 허리가 옆으로 휘는 각
const POSES = {
  stand: { bodyY: 0.3, bodyZ: 0, pitch: 0, roll: 0, yawOff: -0.5, gaze: 1, headPitch: 0.12, headTilt: 0, tail: -1.95, level: 1, free: 0, abd: [0.06, 0.06, 0, 0],
    lean: [0.2, 0.2, 0.14, 0.14], paws: [P(0.066, 0.03, 0.195), P(-0.066, 0.03, 0.195), P(0.072, 0.03, -0.192), P(-0.072, 0.03, -0.192)] }, // 팔꿈치 ~137°·아래팔 수직·앞발은 팔꿈치(기갑) 아래(가슴 폭만큼 살짝 벌려 선다), 무릎 ~126°·비절 ~135°·뒷발허리는 거의 수직·뒷발은 엉덩이 조금 뒤. 꼬리는 등선 아래로 느슨하게 늘어진다(노견)
  // 앉기: 가슴(갈비)은 30°쯤만 서고, 허리가 굽어 골반이 밑으로 말려 엉덩이·비절·뒷발허리가 바닥에 닿는다. 앞다리는 거의 곧게 수직, 무릎은 앞 위로 접혀 가슴 옆에, 뒷발은 앞발 바로 뒤에서 앞을 본다
  sit: { bodyY: 0.19, bodyZ: -0.02, pitch: -0.55, roll: 0, yawOff: -0.6, gaze: 1, headPitch: 0, headTilt: 0, tail: -0.5, level: 1, free: 0, splay: 0.3, neck: 0.4, lumbar: 0.55, tailCurl: 1.25,
    lean: [0.05, 0.05, 1.45, 1.45], paws: [P(0.075, 0.03, 0.17), P(-0.075, 0.03, 0.17), P(0.09, 0.03, 0.02), P(-0.09, 0.03, 0.02)] },
  // 엎드리기(스핑크스): 위팔이 가슴 옆으로 접혀 팔꿈치가 기갑 아래 바닥에 놓이고 아래팔은 앞으로 납작하게. 뒷다리는 Z자로 접혀 무릎은 옆구리 옆 낮게, 비절은 엉덩이 옆 바닥, 뒷발은 옆구리 옆에서 앞을 본다
  down: { bodyY: 0.145, bodyZ: -0.02, pitch: 0.02, roll: 0, yawOff: -0.7, gaze: 1, headPitch: 0, headTilt: 0, tail: -1.75, level: 1, free: 0, splay: 0.2,
    lean: [1.5, 1.5, 1.5, 1.5], paws: [P(0.068, 0.03, 0.33), P(-0.068, 0.03, 0.33), P(0.1, 0.03, -0.085), P(-0.1, 0.03, -0.085)] },
  // 옆으로 눕기: 다리는 느슨하게 반쯤 펴고(팔꿈치 ~115°, 무릎 ~105°) 손목은 살짝 접혀 늘어지며, 위쪽 다리는 아래쪽 다리 위로 처진다
  side: { bodyY: 0.12, bodyZ: 0, pitch: 0, roll: 1.5, yawOff: -1.15, gaze: 0.6, headPitch: 0.15, headTilt: 0.2, tail: -1.5, level: 0, free: 0, neck: 0.15, lumbar: 0.15, bendY: 0.1, tailCurl: 0.35,
    lean: [-0.5, -0.5, 0.3, 0.3], abd: [-0.48, 0.12, -0.5, 0.02], paws: [P(0.235, 0.15, 0.24), P(0.225, 0.055, 0.31), P(0.252, 0.166, -0.195), P(0.252, 0.041, -0.12)] }, // 위쪽 다리는 아래쪽 다리보다 발 하나만큼 뒤에 놓인다
  // 배 보이기: 앞다리는 가슴 위로 접고 손목이 힘없이 꺾이며, 뒷다리는 무릎·비절을 굽힌 채 양옆으로 벌어진다(개구리 다리)
  belly: { bodyY: 0.135, bodyZ: 0, pitch: 0, roll: 2.85, yawOff: -1.15, gaze: 0.75, headPitch: -0.2, headTilt: -0.55, tail: -1.4, level: 0, free: 0, bendY: 0.2,
    lean: [1.88, 1.88, 0.53, 0.53], abd: [0.3, 0.3, 0.55, 0.55], paws: [P(-0.005, 0.285, 0.276), P(0.09, 0.267, 0.258), P(0, 0.349, -0.175), P(0.12, 0.318, -0.195)] }, // 팔꿈치 ~75°로 접혀 앞발이 가슴뼈 위에 늘어지고, 무릎·비절 ~90°로 접힌 뒷다리가 양옆으로 벌어진다. 등은 옆으로 살짝 C자
  // 먹기: 등은 거의 수평, 앞다리는 거의 곧게 선 채 목뿌리에서 목이 내려가고 머리가 조금 더 숙여진다 (앞다리를 접어 엎드리지 않는다)
  // 목이 짧고 머리가 커서: 몸을 앞발 위로 조금 기울여 기갑을 낮추고(팔꿈치 ~104°, 아래팔은 거의 수직), 목을 길게 빼서(reach) 코가 바닥의 밥그릇에 닿는다
  eat: { bodyY: 0.288, bodyZ: 0.02, pitch: 0.15, roll: 0, yawOff: 0, gaze: 0, headPitch: 0.05, headTilt: 0, tail: -1.9, level: 1, free: 0, neck: 1.2, reach: 0.08, abd: [0.08, 0.08, 0, 0],
    lean: [0.1, 0.1, 0.16, 0.16], paws: [P(0.08, 0.03, 0.165), P(-0.08, 0.03, 0.165), P(0.072, 0.03, -0.165), P(-0.072, 0.03, -0.165)] },
  // 안기기: 등이 C자로 굽고, 앞다리는 팔꿈치를 굽혀 손목이 늘어지며, 뒷다리는 무릎·비절을 반쯤 굽힌 채 매달린다
  held: { bodyY: 0.25, bodyZ: 0, pitch: -1.15, roll: 0, yawOff: 0, gaze: 1, headPitch: 0, headTilt: 0, tail: -1.3, level: 0, free: 0, neck: 0.5, lumbar: 0.25,
    lean: [-0.3, -0.3, 0.45, 0.5], paws: [P(0.07, 0.25, 0.19), P(-0.08, 0.235, 0.2), P(0.075, -0.155, 0.025), P(-0.075, -0.143, 0.042)] }, // 아래팔은 수평에서 ~30° 아래로, 손목은 늘어지고, 뒷다리는 무릎 ~100°·비절 ~125°로 매달린다 (좌우가 조금 다르다)
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
// ================================================================
// 핑키의 도넛 방석 (애착 공간) · 몸을 말고 자는 자세
// ================================================================
// 방석 좌표: 가운데가 원점, y = 바닥. yaw: 핑키가 누웠을 때 몸이 향하는 방향 · chin: 턱을 올려놓는 테두리 자리(방 쪽을 향한 앞) · lift: 가운데 베개 높이
const CUSH = { x: 0.66, z: -1.72, R: 0.33, yaw: -1.1, chin: -0.83, lift: 0.028, px: 0, pz: -0.035 }; // (px, pz): 누울 때 몸 중심이 놓이는 자리(방석 가운데 기준)
const cushAng = (x, z) => { const a = Math.atan2(x, z) - CUSH.chin; return Math.atan2(Math.sin(a), Math.cos(a)); };
const cushChin = (x, z) => Math.exp(-((cushAng(x, z) / 0.4) ** 2)); // 턱 자리: 테두리가 눌려 낮아진 곳 (1 = 한가운데)
const cushDent = (x, z) => Math.exp(-(((x - CUSH.px) / 0.19) ** 2 + ((z - CUSH.pz) / 0.19) ** 2)); // 늘 눕는 자리: 가운데 베개가 꺼진 곳
// 도넛 방석: 통통하고 울퉁불퉁한 테두리(턱 자리는 눌려 있다) + 낮고 푹 꺼진 가운데 베개 + 납작한 바닥
const cushSDF = (x, y, z) => {
  const r = Math.hypot(x, z), a = Math.atan2(x, z), chin = cushChin(x, z);
  const lump = 0.007 * Math.sin(a * 3 + 0.6) + 0.005 * Math.sin(a * 7 + 2.1) + 0.0035 * Math.sin(a * 12 + y * 34 + 0.4);
  const R = CUSH.R + 0.006 * Math.sin(a * 2 + 1), rx = 0.11 + lump + 0.014 * chin, ry = (0.114 + lump * 0.8) * (1 - 0.3 * chin);
  const px = (r - R) / rx, py = (y - ry * 0.9) / ry, k0 = Math.hypot(px, py), k1 = Math.hypot(px / rx, py / ry);
  const rim = k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(rx, ry);
  let pil = sdE(x, y, z, 0, 0.018, 0, 0.3, 0.05, 0.3) - 0.003 * Math.sin(x * 23 + 1.3) * Math.sin(z * 19 + 0.4);
  pil = smax(pil, -sdE(x, y, z, CUSH.px, 0.112, CUSH.pz, 0.22, 0.07, 0.22), 0.05); // 핑키가 늘 눕는 자리
  return Math.max(smin(rim, pil, 0.03), -y);
};
// 몸을 말고 자기: 가슴으로 엎드린 채 허리가 옆으로 C자로 휘고(bendY), 등이 둥글게 말리며(lumbar), 목을 숙여(neck) 턱을 테두리에 올린다.
// 발 위치는 fitCurl이 '엎드려' 자세의 접힌 다리를 휜 골반에 그대로 실어 옮겨서 정한다(다리 길이가 달라져도 따라간다). 다리·머리·꼬리가 옆으로 도는 것은 napPost가 맡는다
POSES.curl = { bodyY: 0.132, bodyZ: 0, pitch: 0.1, roll: 0, yawOff: 0, gaze: 0, headPitch: -0.72, headTilt: 0.16, tail: -1.15, level: 1, free: 0, splay: 0.2, neck: 0.85, lumbar: 0.2, bendY: -1.25,
  lean: [...POSES.down.lean], paws: POSES.down.paws.map((v) => v.clone()) };
POSES_J.curl = { ...POSES_J.down, gaze: 0, headPitch: 0.3 }; // 진돗개는 그냥 엎드려 고개만 숙인다
// hip: 다리별 옆으로 도는 각(뒷다리는 골반이 휜 각을 따른다) · head: 머리가 옆으로 도는 각 · front: 앞발을 엎드려보다 몸 쪽으로 당기는 양(몸 기준)
// tail: [뒤로 눕히는 각, 뿌리에서 몸 안쪽으로 접히는 각, 그 뒤로 끝까지 완만하게 더 휘는 각, 베개 위로 내려앉는 높이] — 꼬리는 통째로 도는 막대가 아니라 뿌리부터 끝까지 휜다(bendTail)
const CURL = { hip: [0.5, 0.35, 0, 0], head: 1.12, tail: [-1.6, 2.2, 0.5, 0.03], front: [[0, 0.012, -0.075], [0, 0.004, -0.05]] };
function fitCurl(d) {
  if (d.J || !d.lumbarRig) return;
  const dn = POSES.down, cu = POSES.curl, e = new THREE.Euler(), one = V3(1, 1, 1);
  const Md = new THREE.Matrix4().compose(V3(0, dn.bodyY, dn.bodyZ), new THREE.Quaternion().setFromEuler(e.set(dn.pitch, 0, dn.roll)), one).invert();
  const Mc = new THREE.Matrix4().compose(V3(0, cu.bodyY, cu.bodyZ), new THREE.Quaternion().setFromEuler(e.set(cu.pitch, 0, cu.roll)), one);
  const P = d.lumbarRig.P, a = -cu.lumbar, b = cu.bendY, ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  const sp = (p) => 0.012 * clamp((p.splay || 0) / 0.3, 0, 1.2);
  d.legs.forEach((L, i) => {
    const o = dn.paws[i].clone().applyMatrix4(Md); // 엎드려 자세의 발 (몸 기준)
    if (L.front) { const f = CURL.front[i] || CURL.front[0]; o.x += f[0]; o.y += f[1]; o.z += f[2]; }
    else if (L.fol) {
      const h = L.fol.rest, y = h.y - P.y, z = h.z - P.z, z1 = y * sa + z * ca;
      const rx = o.x - (h.x + L.sx * sp(dn)), ry = o.y - h.y, rz = o.z - h.z; // 고관절에서 발까지 (엎드려)
      o.set(h.x * cb + z1 * sb + L.sx * sp(cu) + rx, P.y + y * ca - z * sa + ry * ca - rz * sa, P.z - h.x * sb + z1 * cb + ry * sa + rz * ca); // 휜 골반의 고관절 + 같은 다리 모양
    }
    o.applyMatrix4(Mc); o.y = Math.max(o.y, 0.026);
    cu.paws[i].copy(o);
    L.hip.rotation.order = 'YXZ'; if (!L.front) CURL.hip[i] = b; // 옆으로 도는 각을 먼저(골반·어깨와 함께), 그다음 접는 각
  });
  // 꼬리: 잘 때 둥글게 감을 수 있게 처음 모양을 기억해 둔다
  if (d.tailMesh && !d.tailRest) { const g = d.tailMesh.geometry; d.tailRest = [g.attributes.position.array.slice(), g.attributes.normal.array.slice()]; }
  // 감은 눈: 자는 동안에만 보이는 눈꺼풀(눈두덩 털빛)과 아래로 둥근 속눈썹 선 — 깨어 있는 얼굴은 그대로다
  if (!d.napLids && d.eyes.length) {
    const lidM = M(0xa3876b, { roughness: 0.9 }), lashM = M(0x35271f, { roughness: 0.9 }), pts = [];
    for (let i = 0; i <= 10; i++) { const u = i / 5 - 1, x = u * 0.0105, y = -0.0015 - 0.004 * (1 - u * u); pts.push(V3(x, y, 0.0127 * Math.sqrt(1 - (x * x + y * y) / (0.0172 * 0.0172)) + 0.0002)); }
    const lashG = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 20, 0.0011, 5, false);
    d.napLids = d.eyes.map((eg) => {
      const g = new THREE.Group(); g.position.copy(eg.position); g.rotation.copy(eg.rotation); g.visible = false; eg.parent.add(g);
      const lid = new THREE.Mesh(SPH, lidM); lid.scale.set(0.0172, 0.0172, 0.0127); lid.receiveShadow = true; g.add(lid);
      g.add(new THREE.Mesh(lashG, lashM));
      return g;
    });
  }
}
// 꼬리를 감는다 (s: 0 = 곧은 원래 꼬리 … 1 = 다 감은 꼬리): 뿌리에서 몸 안쪽으로 접혀 엉덩이를 타고 내려와, 베개 위에서 뒷발 앞을 지나 코 쪽으로 완만하게 휜다.
// 모양이 바뀔 때만 다시 계산한다
function bendTail(d, s) { d.tailSWant = s; shapeTail(d); }
// 꼬리 모양은 이 함수 하나가 정한다: 앉을 때 옆으로 휘는 굽힘(tailKWant, curlTail) + 잘 때 몸 쪽으로 감는 굽힘(tailSWant, bendTail)을 한 번에 합쳐서 굽힌다
function shapeTail(d) {
  const m = d.tailMesh; if (!m) return;
  const k = d.tailKWant || 0, s = d.tailSWant || 0;
  if (d.tailK !== undefined && Math.abs(k - d.tailK) < 0.004 && Math.abs(s - d.tailS) < 0.002) return;
  d.tailK = k; d.tailS = s;
  const g = m.geometry, pa = g.attributes.position.array, na = g.attributes.normal.array;
  if (!d.tailRest) d.tailRest = [pa.slice(), na.slice()];
  const [R0, N0] = d.tailRest;
  const sg = -Math.sign(POSES.curl.bendY || -1), len = 0.28, N = 56, h = len / N, [, fold, arc, drop] = CURL.tail;
  const tab = d.tailTab || (d.tailTab = new Float32Array((N + 1) * 4)); // 가운데 선: [옆, 길이 방향, 굽힘각(+면 +x 쪽), 원래 칼 모양으로 들린 높이]
  let cx = 0, cy = 0;
  for (let i = 0; i <= N; i++) {
    const t = i * h, ph = sg * s * (fold * (1 - Math.exp(-t / 0.022)) + (arc * t) / len) + (k * Math.min(t, 0.25)) / 0.25;
    let zc = 0; for (let q = 0; q < TAIL_P.length - 1; q++) { const a = TAIL_P[q], b = TAIL_P[q + 1]; if (t >= a[1]) zc = lerp(a[2], b[2], clamp((t - a[1]) / (b[1] - a[1]), 0, 1.4)); }
    tab[i * 4] = cx; tab[i * 4 + 1] = cy; tab[i * 4 + 2] = ph; tab[i * 4 + 3] = zc;
    cx += Math.sin(ph) * h; cy += Math.cos(ph) * h;
  }
  for (let j = 0; j < pa.length; j += 3) {
    const x = R0[j], y = R0[j + 1], z = R0[j + 2], t = clamp(y, 0, len), u = t / h, i0 = Math.min(N - 1, Math.floor(u)), f = u - i0, a = i0 * 4;
    const ph = lerp(tab[a + 2], tab[a + 6], f), c = Math.cos(ph), sn = Math.sin(ph), r = y - t;
    pa[j] = lerp(tab[a], tab[a + 4], f) + x * c + r * sn; pa[j + 1] = lerp(tab[a + 1], tab[a + 5], f) - x * sn + r * c;
    pa[j + 2] = z - s * (0.85 * lerp(tab[a + 3], tab[a + 7], f) + drop * (1 - Math.exp(-t / 0.05)));
    const nx = N0[j], ny = N0[j + 1]; na[j] = nx * c + ny * sn; na[j + 1] = -nx * sn + ny * c; na[j + 2] = N0[j + 2];
  }
  g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true; g.computeBoundingSphere();
}
const _q0 = new THREE.Quaternion(), _q1 = new THREE.Quaternion(), _xAx = V3(1, 0, 0), _yAx = V3(0, 1, 0), _zAx2 = V3(0, 0, 1);
// updateDog 뒤에 부른다: 자는 자세에서만 다리·머리·꼬리를 몸이 말린 쪽으로 돌리고, 느리고 깊은 숨을 쉰다 (curlK: 0 → 1로 부드럽게)
function napPost(d, dt, t) {
  const on = d.tgt.name === 'curl' ? 1 : 0, k0 = d.curlK || 0;
  if (d.wasCurl && !on) d.wakeT = 1.15; // 자다가 일어나는 동안: 눈을 천천히 뜨고, 다 일어설 때까지는 걸음을 떼지 않는다
  d.wasCurl = on;
  if (d.wakeT > 0) { d.wakeT -= dt; const o = 0.12 + 0.88 * ss(1.0, 0.25, d.wakeT); for (const e of d.eyes) e.scale.y = Math.min(e.scale.y, o * e.scale.x); }
  if (!on && k0 < 0.002) {
    if (d.curlK) { d.curlK = 0; for (const L of d.legs) L.hip.rotation.y = 0; }
    bendTail(d, 0); if (d.napLids) for (const g of d.napLids) g.visible = false;
    return;
  }
  const K = d.curlK = k0 + (on - k0) * (1 - Math.exp(-(on ? 2.2 : 3.0) * dt)), s = K * K * (3 - 2 * K), c = d.cur;
  d.legs.forEach((L, i) => { L.hip.rotation.y = CURL.hip[i] * s; });
  const sigh = d.sigh || 0, br = Math.sin(t * 1.5) * (1 + sigh * 0.3) + sigh * 1.4; // 자는 숨: 느리고 깊게 (한숨 쉴 때는 한 번 크게 부푼다)
  d.torso.scale.x *= 1 + 0.06 * br * s; d.torso.scale.y *= 1 + 0.035 * br * s;
  d.body.position.y += 0.004 * br * s;
  d.hp.rotation.y += CURL.head * s * (1 - c.gaze * 0.6);
  d.hp.rotation.x += 0.012 * br * s * (1 - c.gaze);
  const r = d.tail.rotation, wag = r.z * (1 - 0.5 * s); // 꼬리: 골반을 따라 돌고, 뒤로 누워 몸 안쪽으로 감긴다 (살랑·탁탁은 그대로)
  _q0.setFromAxisAngle(_yAx, c.bendY * s); _q1.setFromAxisAngle(_xAx, lerp(r.x, CURL.tail[0], s)); _q0.multiply(_q1);
  _q1.setFromAxisAngle(_zAx2, wag); d.tail.quaternion.copy(_q0.multiply(_q1));
  bendTail(d, s);
  if (d.napLids) { const v = s * ss(0.3, 0.1, d.eyeY); for (const g of d.napLids) { g.visible = v > 0.02; g.scale.set(1, Math.max(v, 0.05), 1); } }
}
const POSE_KEYS = ['bodyY', 'bodyZ', 'pitch', 'roll', 'yawOff', 'gaze', 'headPitch', 'headTilt', 'tail', 'level', 'free', 'splay', 'neck', 'lumbar', 'bendY', 'tailCurl', 'reach']; // splay: 뒷다리를 옆으로 벌리는 각(앉기) · neck: 목을 앞으로 굽히는 각(앉기 — 몸이 뒤로 기울어도 머리는 가슴 앞 위에)

function poseFor(name, d) {
  const p = (d.J ? POSES_J : POSES)[name];
  const o = { ...p, name, splay: p.splay ?? 0, neck: p.neck ?? 0, lumbar: p.lumbar ?? 0, bendY: p.bendY ?? 0, tailCurl: p.tailCurl ?? 0, reach: p.reach ?? 0, abd: [...(p.abd || [0, 0, 0, 0])], lean: [...p.lean], paws: p.paws.map((v) => v.clone()) };
  if (d.J && (name === 'stand' || name === 'eat')) o.bodyY += 0.035;
  return o;
}
function setPose(d, name, rate = 5) {
  const p = poseFor(name, d);
  for (const k of POSE_KEYS) d.tgt[k] = p[k];
  d.tgt.name = name;
  p.paws.forEach((v, i) => d.tgt.paws[i].copy(v));
  d.tgt.lean = [...p.lean]; d.tgt.abd = [...p.abd];
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
  let d = sdRB(x, y, z, 0, -0.004, 0.01, 0.085, 0.116, 0.215, 0.065); // 몸통 틀: 폭 0.17 · 높이 0.22(등 0.1 · 배 -0.12) · z -0.205..0.225 (길고 깊은 네모진 틀, 다리는 짧게 보인다)
  d = smax(d, y - (0.112 - 0.014 * ss(0.05, -0.2, z)), 0.03); // 등선: 기갑에서 엉덩이로 가며 살짝 내려간다
  d = smin(d, sdE(x, y, z, 0, -0.018, 0.12, 0.09, 0.108, 0.115), 0.05); // 갈비·가슴: 깊지만 폭은 좁게 (폭 0.18 · 바닥 -0.138 = 팔꿈치 높이, 몸 높이의 57%)
  d = smin(d, sdCap(x, y, z, 0, -0.085, 0.19, 0, -0.065, 0.05, 0.043), 0.05); // 앞다리 사이로 내려오는 가슴(brisket)
  d = smin(d, sdE(x, y, z, 0, -0.005, 0.215, 0.05, 0.056, 0.03), 0.04); // 앞가슴(prosternum): 작고 납작하게 — 앉아도 가슴 공이 되지 않게
  for (const sx of [1, -1]) d = smin(d, sdE(x, y, z, sx * 0.054, -0.02, 0.18, 0.038, 0.08, 0.062), 0.045); // 어깨·위팔 덩어리 (앞다리가 가슴 앞쪽 아래에 붙도록 앞으로, 앞가슴에 혹이 생기지 않게 작게): 작게(폭 0.19) — 근육질 가슴이 되지 않게
  d = smin(d, sdE(x, y, z, 0, 0.004, -0.17, 0.093, 0.1, 0.09), 0.045); // 골반·엉덩이: 가슴과 비슷한 폭
  for (const sx of [1, -1]) d = smin(d, sdE(x, y, z, sx * 0.068, -0.04, -0.18, 0.055, 0.092, 0.08), 0.04); // 허벅지 뿌리
  d = smin(d, sdE(x, y, z, 0, -0.055, -0.175, 0.1, 0.065, 0.08), 0.05); // 엉덩이 아래(앉으면 바닥에 닿는 넓은 자리)
  d = smin(d, sdCap(x, y, z, 0, 0.01, 0.04, 0, 0.12, 0.16, 0.062), 0.05); // 목: 짧고 굵게(두개골 폭에 가깝게), 기갑에서 곡선으로 올라간다 (몸 속에서 시작해 혹이 없다)
  d = smin(d, sdCap(x, y, z, 0, 0.12, 0.16, 0, 0.165, 0.19, 0.054), 0.04); // 목 윗부분: 머리 밑으로 들어간다 — 머리와 가슴 사이에 짧은 목이 보이게
  d = smin(d, sdE(x, y, z, 0, 0.054, -0.235, 0.027, 0.027, 0.03), 0.03); // 꼬리 뿌리: 가늘게
  return smax(d, -sdE(x, y, z, 0, -0.245, -0.09, 0.3, 0.09, 0.1), 0.05); // 배가 뒤로 가며 아주 살짝만 올라붙음 (노견의 두둑한 배, 거의 수평인 아랫선)
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
// 머리 좌표(비글): 원점은 목 위 회전축. 두개골 폭 0.128 · 꼭대기 y≈0.122 · 눈 (±0.038, 0.074, 0.05) 지름 0.024(두개골 폭의 19%) · 단(stop) z≈0.045 · 코 (0, 0.014, 0.14) · 뒤통수 z≈-0.08
// 눈에서 코까지 2.5 눈지름, 정수리에서 눈까지 2 눈지름 — 사진의 노견 비율
const headBase0 = (x, y, z) => { // 입 골을 파기 전의 머리
  const ax = Math.abs(x);
  let d = sdE(x, y, z, 0, 0.054, -0.005, 0.07, 0.066, 0.066); // 두개골: 넓고 둥근 돔 (꼭대기 ≈0.112)
  d = smin(d, sdE(x, y, z, 0, 0.078, 0.004, 0.072, 0.04, 0.06), 0.03); // 이마·정수리: 귀 사이가 넓은 정수리, 눈 위로 완만한 눈두덩 턱 (눈에서 정수리까지 ≈ 눈-코 거리의 0.8)
  d = smin(d, sdE(x, y, z, 0, 0.045, -0.035, 0.052, 0.052, 0.045), 0.035); // 뒤통수
  for (const sx of [1, -1]) d = smin(d, sdE(x, y, z, sx * 0.038, 0.015, 0.03, 0.032, 0.042, 0.055), 0.03); // 볼: 통통하고 넓다(폭 0.14), 주둥이 뿌리를 감싼다
  d = smin(d, sdE(x, y, z, 0, -0.015, -0.005, 0.048, 0.03, 0.058), 0.035); // 턱 밑·목덜미: 귀가 기댈 살
  // 주둥이: 모서리를 둥글린 짧고 뭉툭한 상자(z 0.05..0.135). 뿌리는 넓고(0.07) 코 쪽으로 좁아지며(0.056) 콧등이 살짝 내려간다. 아랫면 앞쪽은 코 밑으로 물러난다
  const t = clamp((z - 0.05) / 0.085, 0, 1);
  const cy = lerp(0.006, -0.003, t), hw = lerp(0.038, 0.032, t), hh = lerp(0.031, 0.025, t), rr = 0.016; // 주둥이 끝을 조금 넓게(코가 단추처럼 얹히지 않고 주둥이에 묻힌다)
  const qx = ax - (hw - rr), qy = Math.abs(y - cy) - (hh - rr);
  let m = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rr;
  m = smax(m, z - 0.138 + 6 * ax * ax + 7 * (y - cy) * (y - cy) + Math.max(0, 0.012 - y) * 0.3, 0.022); // 주둥이 끝은 평평한 벽이 아니라 둥근 돔
  d = smin(d, Math.max(m, 0.02 - z), 0.03);
  for (const sx of [1, -1]) d = smin(d, sdE(x, y, z, sx * 0.02, -0.008, 0.094, 0.023, 0.0155, 0.036), 0.016); // 윗입술(flews): 코 양옆에서 도톰하게 부풀어 입선 위로 살짝 늘어지는 두 덩이
  d = smin(d, sdE(x, y, z, 0, -0.029, 0.087, 0.022, 0.012, 0.035), 0.008); // 아래턱·턱 끝: 윗입술 밑으로 살짝 물러난 작고 둥근 턱 (윗입술과의 사이에 얕은 골이 남는다)
  for (const sx of [1, -1]) d = smax(d, -sdE(x, y, z, sx * 0.038, 0.061, 0.061, 0.0158, 0.0155, 0.008), 0.005); // 눈자리: 눈알이 반지름의 3/4쯤 살 속에 묻혀 앉는다 (튀어나온 구슬이 아니라 살에 박힌 눈)
  return d;
};
// 입선: 인중 밑에서 'ㅅ' 꼴로 갈라져 윗입술 아래 가장자리를 따라 입꼬리까지 가는 점들. 가운데가 가장 높고, 살짝 내려갔다가 입꼬리에서 다시 조금 올라간다(처진 입이 아니라 순한 입)
// 각 점은 머리 속 세로축(0, y, 0.07)에서 바깥으로 쏘아 표면에 붙인다
const LIP_AX = 0.07, LIP_ANG = 0.58, LIP_N = 12;
const lipY = (u) => lerp(-0.0155, -0.0205, u) - 0.0055 * Math.sin(Math.PI * Math.pow(u, 0.85));
const surfR = (sdf, y, ang, r0 = 0.004) => { // 축에서 (sin ang, 0, cos ang) 방향으로 표면까지의 거리
  const dx = Math.sin(ang), dz = Math.cos(ang);
  let r = r0; while (r < 0.09 && sdf(dx * r, y, LIP_AX + dz * r) < 0) r += 0.0005;
  let a = r - 0.0005, b = r; for (let i = 0; i < 12; i++) { const m = (a + b) / 2; if (sdf(dx * m, y, LIP_AX + dz * m) < 0) a = m; else b = m; }
  return (a + b) / 2;
};
const LIP = (() => {
  const pts = [];
  for (let i = 0; i <= LIP_N; i++) { const u = i / LIP_N, y = lipY(u), ang = u * LIP_ANG, r = surfR(headBase0, y, ang); pts.push([Math.sin(ang) * r, y, LIP_AX + Math.cos(ang) * r, u]); }
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
const PHIL_TOP = [0, -0.007, 0.128]; // 인중 윗끝(코 밑)
const headBase = (x, y, z) => {
  let d = headBase0(x, y, z);
  if (z < 0.055 || y > 0.004 || y < -0.045 || d > 0.02) return d;
  const ld = lipDist(x, y, z);
  d = smax(d, -(ld - 0.0006 * (1 - ss(0.75, 1, lipU))), 0.007 - 0.003 * ss(0.6, 1, lipU)); // 입선을 따라 얕고 넓은 골(격자보다 넓어 계단이 생기지 않는다) — 가는 입선 메시가 이 골 바닥에 앉는다. 입꼬리로 가며 얕아진다
  return smax(d, -sdCap(x, y, z, PHIL_TOP[0], PHIL_TOP[1], PHIL_TOP[2], LIP[0][0], LIP[0][1], LIP[0][2], 0.0012), 0.004); // 인중
};
const headSDF = (J) => (J ? (x, y, z) => {
  let d = sdE(x, y, z, 0, 0.055, 0.02, 0.105, 0.095, 0.1);
  for (const sx of [1, -1]) d = smin(d, sdE(x, y, z, sx * 0.045, 0.02, 0.06, 0.055, 0.05, 0.055), 0.03);
  d = smin(d, sdCap(x / 1.05, y / 0.9, z, 0, 0.011, 0.1, 0, 0.011, 0.13, 0.043), 0.03);
  for (const sx of [1, -1]) d = smin(d, sdE(x, y, z, sx * 0.038, 0.094, 0.083, 0.028, 0.014, 0.022), 0.02);
  for (const sx of [1, -1]) d = smax(d, -sdE(x, y, z, sx * 0.04, 0.066, 0.096, 0.019, 0.016, 0.011), 0.006);
  return d;
} : headBase);
// 코: 둥글둥글한 검은 덩어리(가죽 패드), 세로가 가로만큼 큼직하다. 콧구멍은 바깥 아래로 기울어진 쉼표꼴, 옆으로 째진 콧방울 골, 가운데 인중 골
const noseSDF = (x, y, z) => {
  let d = sdRB(x, y, z, 0, 0, 0, 0.0165, 0.0135, 0.012, 0.011); // 둥근 가죽 패드: 폭 0.032(눈 지름의 ~1.5배), 주둥이 끝을 덮는다
  d = smin(d, sdE(x, y, z, 0, 0.0015, 0.0, 0.0165, 0.0135, 0.0135), 0.006);
  for (const sx of [1, -1]) {
    const cs = Math.cos(0.5), sn = Math.sin(0.5) * sx, lx = x - sx * 0.0072, ly = y + 0.0015;
    d = smax(d, -sdE(cs * lx - sn * ly, sn * lx + cs * ly, z - 0.0125, 0, 0, 0, 0.0038, 0.003, 0.0055), 0.002);
    d = smax(d, -sdCap(x, y, z, sx * 0.0095, -0.003, 0.0115, sx * 0.0145, -0.0075, 0.006, 0.0008), 0.0015);
  }
  return smax(d, -sdCap(x, y, z, 0, -0.003, 0.0125, 0, -0.014, 0.011, 0.001), 0.0015);
};
// 비글 귀: 눈높이에서 시작해 볼에 바짝 붙어 곧게 내려오는 길고 넓고 두툼한 귓볼. 머리를 감싸는 원통면 위의 숟가락꼴 판으로 만든다
const EAR_L = 0.155;
// 귀 좌표: xo = 바깥쪽(+), z = 앞쪽, 원점 = 귀 뿌리(두개골 옆, 눈높이 조금 위). 귓볼은 앞 가장자리가 볼에 닿고 뒤 가장자리가 바깥으로 벌어진 판
// (법선이 바깥·앞으로 30~35°)이라 정면에서도 귓볼의 넓은 면이 보인다. 위는 좁게 접히고(폭 0.04) 아래로 가며 숟가락처럼 넓어져(폭 0.094)
// 살짝 바깥·앞으로 흘러내린다. w = 판 위의 앞뒤 좌표, n = 판 법선 방향 거리
const earFrame = (sx, x0, y, z) => {
  const t = clamp(-y / EAR_L, 0, 1), xo = x0 * sx;
  const hw = lerp(0.03, 0.047, ss(0.0, 0.6, t)) * (1 - 0.1 * Math.exp(-(((t - 0.16) / 0.09) ** 2))); // 접히는 곳(위 1/6)은 살짝 잘록하고 아래 귓볼은 둥글고 넉넉하다
  const phi = lerp(0.45, 0.78, ss(0.0, 0.6, t)), cph = Math.cos(phi), sph = Math.sin(phi); // 아래로 갈수록 판이 볼을 감싸며 앞을 향한다(정면에서 넓은 귀 면이 보인다) — 뒤 가장자리가 날개처럼 벌어지지 않을 만큼만
  const cx = lerp(0.008, 0.02, ss(0, 0.5, t)) + hw * sph, cz = lerp(0.008, 0.026, ss(0.15, 1, t)); // 판 중심: 앞 가장자리가 볼 표면에 닿아 매달리고 판은 그 뒤·바깥으로 펼쳐진다
  const dx = xo - cx, dz = z - cz;
  const w = -dx * sph + dz * cph, n0 = dx * cph + dz * sph, q = w / hw, body = ss(0.06, 0.3, t) * ss(1.0, 0.6, t);
  const curl = (q > 0 ? 0.011 : 0.02) * q * q; // 앞 가장자리는 조금, 뒤 가장자리는 더 많이 머리 쪽으로 오므라든다(뒤에서 보아도 귀가 목에 기댄다)
  const chan = 0.0035 * Math.exp(-(((q - 0.2) / 0.32) ** 2)) * body; // 말린 앞 가장자리 뒤로 세로로 흐르는 얕은 골
  const fold = 0.0022 * Math.exp(-(((t - 0.2) / 0.05) ** 2)); // 뿌리에서 귀가 꺾여 내려오는 접힌 턱(바깥으로 불룩) + 바로 밑의 얕은 주름
  return { t, hw, w, q, chan: chan / 0.0035, n: n0 - 0.004 * ss(0.02, 0.3, t) + curl + chan + fold + 0.012 * ss(0.75, 1, t) }; // 끝은 안으로 말린다. 판 전체는 두께만큼 바깥으로 물려 볼을 파고들지 않는다
};
const earSDF = (sx) => (x0, y, z) => {
  if (y > 0.03 || y < -0.18) return Math.max(y - 0.02, -0.17 - y, 0.004);
  const { t, hw, w, q, n } = earFrame(sx, x0, y, z);
  const rr = lerp(0.027, 0.04, ss(0.3, 1, t)), qx = Math.abs(w) - (hw - rr), qy = Math.abs(y + EAR_L / 2) - (EAR_L / 2 - rr); // 위는 좁게 둥글고 아래는 둥근 끝
  const d2 = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rr;
  const th = (lerp(0.0078, 0.0058, ss(0, 0.5, t)) + 0.003 * (1 - Math.min(1, q * q))) * (0.68 + 0.32 * ss(0, -0.016, d2)); // 두툼한 가죽: 가운데가 볼록한 타원 단면, 가장자리로 가며 조금만 얇아져 테두리가 도톰하고 둥글다
  const dn = Math.abs(n) - th;
  let d = Math.hypot(Math.max(d2, 0), Math.max(dn, 0)) + Math.min(Math.max(d2, dn), 0) - 0.0032;
  const rollR = lerp(0.0095, 0.006, t), roll = Math.max(Math.hypot(w - (hw - 0.009), n + 0.004) - rollR, d2 + 0.003, (t - 0.86) * 0.1, (0.04 - t) * 0.1); // 앞 가장자리: 볼 쪽으로 도르르 말린 굵은 테
  return smin(d, roll, 0.01);
};
// 다리 마디: 위아래가 공으로 끝나는 둥근 원뿔(round cone) — 마디끼리 같은 공을 공유하므로 관절에 링 솔기가 없다
const sdRoundCone = (x, y, z, L, r1, r2) => { // a = 원점(반지름 r1), b = (0,-L,0)(반지름 r2)
  const bay = -L, l2 = L * L, rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1 / l2;
  const py = y * bay, pz = py - l2; // dot(pa,ba), 그리고 끝쪽
  const x2 = (x * l2) ** 2 + (y * l2 - bay * py) ** 2 + (z * l2) ** 2, y2 = py * py * l2, z2 = pz * pz * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(pz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(py) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + py * rr) * il2 - r1;
};
const legSegSDF = (L, r1, r2) => (x, y, z) => sdRoundCone(x, y, z, L, r1, r2);
// 꼬리: 뿌리가 굵고 끝까지 붓처럼 두툼하게 이어지며 끝으로 가며 완만히 위로 휘는 한 덩어리 (낮게 수평에 가깝게 든다)
const TAIL_P = [[0, 0, 0, 0.029], [0, 0.06, -0.003, 0.027], [0, 0.12, 0.004, 0.025], [0, 0.175, 0.024, 0.0225], [0, 0.22, 0.052, 0.02], [0, 0.25, 0.086, 0.0175]]; // 뿌리에서 끝까지 고르게 가늘어지고 끝으로 가며 완만한 칼 모양 곡선
const tailAxisZ = (y) => { // 꼬리 중심선의 z (등쪽·배쪽 구분용)
  for (let i = 0; i < TAIL_P.length - 1; i++) if (y <= TAIL_P[i + 1][1]) return lerp(TAIL_P[i][2], TAIL_P[i + 1][2], clamp((y - TAIL_P[i][1]) / (TAIL_P[i + 1][1] - TAIL_P[i][1]), 0, 1));
  return TAIL_P[TAIL_P.length - 1][2];
};
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
  let d = sdE(x, y, z, 0, -0.002, 0.005, 0.037, 0.021, 0.036);
  for (let i = 0; i < 4; i++) { const tx = (i - 1.5) * 0.017; d = smin(d, sdE(x, y, z, tx, -0.012, 0.025 + (Math.abs(i - 1.5) < 1 ? 0.003 : 0), 0.011, 0.012, 0.014), 0.012); } // 발가락은 한 덩어리 둥근 앞코로 뭉친다 (발은 발목보다 1.25배 넓은 둥근 주먹)
  return d;
};
const sdfCache = {};
function sdfGeo(key, sdf, b0, b1, h, smooth = 0) { if (!sdfCache[key]) sdfCache[key] = surfaceNet(sdf, b0, b1, h); const g = sdfCache[key].clone(); g.userData = { smooth }; return g; }
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

// 긴 털(방석의 인조 모피): 같은 메시를 법선 방향으로 여러 겹 부풀리고, 겹마다 털 가닥 자리만 남긴다. 가닥마다 길이가 달라 위 겹으로 갈수록 성기다.
// 털끝은 살짝 처지고 헝클어지며, 뿌리 쪽은 어둡고 끝은 밝다. aFur(정점 속성) = 그 자리의 털 길이 비율
function plushShells(mesh, count = 8, len = 0.022, den = 380) {
  for (let i = 1; i <= count; i++) {
    const f = i / count, mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, color: mesh.material.color, emissive: mesh.material.emissive });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uShell = { value: f }; sh.uniforms.uLen = { value: len }; sh.uniforms.uDen = { value: den };
      sh.vertexShader = 'uniform float uShell; uniform float uLen; attribute float aFur; varying vec3 vOP; varying float vFur;\n' + sh.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\n  { float L = uShell * uLen * aFur; vec3 tw = vec3(sin(position.z * 43.0 + position.y * 31.0), -0.9, cos(position.x * 47.0 - position.y * 27.0)); transformed += normal * L + tw * (uShell * L * 0.3); vOP = position; vFur = aFur; }');
      sh.fragmentShader = 'uniform float uShell; uniform float uDen; varying vec3 vOP; varying float vFur;\nfloat pH(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }\n'
        + 'float pN(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(mix(pH(i), pH(i + vec3(1,0,0)), f.x), mix(pH(i + vec3(0,1,0)), pH(i + vec3(1,1,0)), f.x), f.y), mix(mix(pH(i + vec3(0,0,1)), pH(i + vec3(1,0,1)), f.x), mix(pH(i + vec3(0,1,1)), pH(i + vec3(1,1,1)), f.x), f.y), f.z); }\n'
        + 'float pTint = 1.0;\n'
        + sh.fragmentShader
          .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n  { vec3 q = (vec3(0.36, 0.48, -0.8) * vOP.x + vec3(-0.8, 0.6, 0.0) * vOP.y + vec3(0.48, 0.64, 0.6) * vOP.z) * uDen + 1.7 * vec3(pN(vOP * 150.0), pN(vOP * 150.0 + 11.0), pN(vOP * 150.0 + 23.0)); float h = pH(floor(q)); float clump = pN(vOP * 46.0); float top = (0.42 + 0.58 * h) * (0.62 + 0.38 * clump);\n'
            + '    if (vFur < 0.05 || uShell > top) discard; vec3 fr = fract(q) - 0.5; if (dot(fr, fr) > 0.5 - 0.3 * uShell / top) discard; pTint = 0.94 + 0.12 * pH(floor(q) + 7.0); }')
          .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb *= mix(0.83, 1.04, pow(uShell, 0.75)) * pTint;');
    };
    mat.customProgramCacheKey = () => 'plush-shell';
    const s = new THREE.Mesh(mesh.geometry, mat); s.castShadow = false; s.receiveShadow = true; mesh.add(s);
  }
}

function buildDog({ kind, colors: C, silhouette = false, scale = 1, seed = 0 }) {
  const J = kind === 'jindo';
  const d = { kind, J, scale, seed, meshes: [], ears: [], eyes: [], legs: [] };
  const silMat = silhouette ? new THREE.MeshStandardMaterial({ color: 0x2b201b, roughness: 0.9, emissive: 0x170f0b }) : null;
  // 짧고 촘촘한 털: 거친 무광 바탕 + 몸 축을 따라 길게 늘어진 털결 노이즈(차콜 속에 낱낱의 회색 털) + 실루엣 가장자리만 보송하게 밝아지는 솜털(프레넬, 어두운 털에서는 약하게)
  const fur = silMat || new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: J ? 0.9 : 0.88, sheen: J ? 0.35 : 0.14, sheenRoughness: J ? 0.85 : 0.8, sheenColor: new THREE.Color(J ? 0xfff4e8 : 0xf0e6d8) });
  if (!silMat) {
    fur.onBeforeCompile = (sh) => {
      sh.vertexShader = 'varying vec3 vOP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vOP = position;');
      sh.fragmentShader = 'varying vec3 vOP;\nfloat furLum = 0.5;\nfloat fh3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }\n'
        + 'float vn3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(mix(fh3(i), fh3(i + vec3(1,0,0)), f.x), mix(fh3(i + vec3(0,1,0)), fh3(i + vec3(1,1,0)), f.x), f.y), mix(mix(fh3(i + vec3(0,0,1)), fh3(i + vec3(1,0,1)), f.x), mix(fh3(i + vec3(0,1,1)), fh3(i + vec3(1,1,1)), f.x), f.y), f.z); }\n'
        + sh.fragmentShader
          .replace('#include <color_fragment>', '#include <color_fragment>\n  { vec3 q = vec3(vOP.x * 260.0, vOP.y * 260.0, vOP.z * 34.0); float s = vn3(q) * 0.6 + vn3(q * 2.1) * 0.3 + vn3(q * 4.3) * 0.1; float lum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));\n'
            + (J ? '    diffuseColor.rgb *= mix(0.94, 1.05, s); }' : '    diffuseColor.rgb *= mix(0.9, 1.08, s); float dk = 1.0 - smoothstep(0.1, 0.32, lum); float g1 = vn3(vec3(vOP.x * 900.0, vOP.y * 900.0, vOP.z * 100.0)); float g2 = vn3(vec3(vOP.x * 760.0, vOP.y * 760.0, vOP.z * 85.0) + vec3(7.3, 1.7, 3.1)); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.115, 0.105, 0.095), smoothstep(0.35, 0.9, g1) * 0.4 * dk); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.12, 0.085, 0.055), smoothstep(0.35, 0.9, g2) * 0.35 * dk); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lum), 0.08 * (1.0 - smoothstep(0.2, 0.3, lum))); furLum = lum; }')) // 차콜 속에 몸 축을 따라 늘어진 밝은 회색 털 가닥(어둡게 하지 않고 밝은 털을 섞는다); 채도 낮추기는 어두운 털에만
          .replace('material.sheenColor = sheenColor;', J ? 'material.sheenColor = sheenColor;' : 'material.sheenColor = sheenColor * mix(0.25, 1.0, smoothstep(0.04, 0.25, furLum));') // 어두운 안장 위의 넓은 광택(비닐 느낌)을 줄인다
          .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n  { float fz = pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 3.0); float lm = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11)); diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.1 + 0.02, fz * 0.3 * smoothstep(0.02, 0.25, lm)); }');
    };
    fur.customProgramCacheKey = () => (J ? 'fur-fuzz-j' : 'fur-fuzz-b');
  }
  const cW = new THREE.Color(C.base), cT = new THREE.Color(C.tan), cB = new THREE.Color(C.saddle);
  const cH = new THREE.Color(C.headTan ?? C.tan), cE = new THREE.Color(C.ear ?? C.tan), cG = new THREE.Color(C.grizzle ?? 0x8a8078);
  const cTick = new THREE.Color(0x7d6a59), cTailDark = cB.clone().lerp(cG, 0.15).lerp(cTick, 0.4), cRim = new THREE.Color(0x4a3b33), cGrey = new THREE.Color(0xb3aca3), cMouth = new THREE.Color(0x4a2228), cLip = new THREE.Color(0x2e221d), cMuz = new THREE.Color(0xece2d2), cLipSh = new THREE.Color(0x8d7765), cEarGrey = new THREE.Color(0xb7aa9a);
  const earS = { 1: earSDF(1), '-1': earSDF(-1) };
  const cEyeShade = cE.clone().multiplyScalar(0.85); // 눈 둘레의 따뜻한 그늘(진한 베이지)
  const cLeg = cW.clone().multiplyScalar(0.97).lerp(cT, 0.08); // 다리·발의 크림: 가슴 크림과 같은 따뜻한 톤
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
      const sm = !J && geo.index && geo.userData.smooth ? geo.userData.smooth : 0; // 색 경계를 이웃 정점 평균으로 번지게 (정점 단위 지그재그 대신 부드러운 그라데이션)
      if (sm) {
        const ix = geo.index.array, acc = new Float32Array(pos.count * 3), cnt = new Float32Array(pos.count);
        for (let it = 0; it < sm; it++) {
          acc.fill(0); cnt.fill(0);
          for (let q = 0; q < ix.length; q += 3) for (let e = 0; e < 3; e++) {
            const a = ix[q + e], b = ix[q + (e + 1) % 3];
            acc[a * 3] += col[b * 3]; acc[a * 3 + 1] += col[b * 3 + 1]; acc[a * 3 + 2] += col[b * 3 + 2]; cnt[a]++;
            acc[b * 3] += col[a * 3]; acc[b * 3 + 1] += col[a * 3 + 1]; acc[b * 3 + 2] += col[a * 3 + 2]; cnt[b]++;
          }
          for (let v = 0; v < pos.count; v++) if (cnt[v]) for (let e = 0; e < 3; e++) col[v * 3 + e] = col[v * 3 + e] * 0.4 + (acc[v * 3 + e] / cnt[v]) * 0.6;
        }
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    return m;
  };

  // 무늬
  const whitePaint = (p, c) => tone(c.copy(cW), p, 0.08);
  // 몸: 기갑(어깨)부터 꼬리 뿌리까지 회색 털이 섞인 차콜 안장이 옆구리 황갈로 번지듯 바래고 · 어깨·허벅지 황갈 · 가슴·배·목 앞은 크림빛 흰색
  // leg=1 이면 배 흰색을 끄고(뒷다리 허벅지는 황갈로 남는다) 안장·황갈 무늬만 이어받는다
  const bodyPaint = J ? (p, c) => tone(c.copy(cW).lerp(cT, ss(0.0, 0.12, p.y) * 0.45), p, 0.05) : (p, c, leg = 0) => {
    const ax = Math.abs(p.x);
    const n = wob(_pg.set(p.x * 3, p.y * 3, p.z * 0.6), 30) * 0.02 + wob(p, 38) * 0.006 + (hash3(_pg.set(p.x * 60, p.y * 60, p.z * 60)) - 0.5) * 0.001; // 몸 축을 따라 길게 늘어진 결 + 낱낱의 털 (가슴·배 경계용, 섬 얼룩이 생기지 않게 털 노이즈는 약하게)
    const ns = wob(_pg.set(p.x * 4, p.y * 4, p.z * 1.5), 30) * 0.012 + wob(p, 70) * 0.005 + (hash3(_pg.set(p.x * 120, p.y * 120, p.z * 120)) - 0.5) * 0.004; // 안장 경계용: 방향 없는 부드러운 얼룩 + 낱낱의 털 (세로 줄무늬 없음)
    const lineY = -0.02 - 0.015 * ss(-0.08, -0.2, p.z) + 0.035 * ss(0.1, 0.22, p.z) + 0.01 * ss(0.05, 0.14, p.z); // 안장 아래 경계: 옆구리 중간 높이(몸 높이의 55~60%), 엉덩이·꼬리 뿌리까지 내려오고 기갑·어깨뼈 위까지 이어진다
    const shoulder = ss(0.11, 0.2, p.z) * ss(0.035, 0.07, ax) * ss(0.09, 0.0, p.y); // 어깨·위팔 덩어리: 회색이 섞인 황갈
    let black = ss(lineY - 0.05, lineY + 0.035, p.y + ns) * ss(0.34, 0.22, p.z - (p.y - 0.12) * 0.6) * (1 - 0.3 * ss(0.24, 0.34, p.z)) * ss(-0.33, -0.26, p.z) * (1 - 0.3 * shoulder); // 넓고 부드러운 얼룩 경계; 기갑을 넘어 목 위까지 회갈색으로 이어진다
    if (leg) black *= 1 - 0.7 * ss(0.03, -0.06, p.y); // 허벅지 위는 회색 섞인 황갈, 검은 모자가 아니다
    const belly = leg ? 0 : ss(-0.045, -0.1, p.y + n + 0.02 * ss(0.0, -0.2, p.z)); // 배 흰색은 몸 아랫면에만 — 옆구리는 팔꿈치 높이까지 황갈
    const chest = ss(0.1, 0.22, p.z + n) * ss(0.13, 0.05, p.y - (p.z - 0.2) * 0.5 + n) * ss(0.1, 0.06, ax + n); // 흰 가슴 턱받이: 목 앞에서 가슴 가운데까지, 양옆 어깨·위팔은 황갈
    const fleck = hash3(_pg.set(p.x * 80, p.y * 80, p.z * 80)) - 0.5; // 정점 하나 크기의 회색 털
    const grizzle = clamp(0.05 + fleck * 0.16 + 0.06 * ss(0.12, 0.22, p.z) + 0.3 * ss(lineY + 0.04, lineY - 0.01, p.y) + 0.2 * ss(0.22, 0.32, p.z) + 0.3 * shoulder, 0, 0.42); // 차콜에 낱낱의 회색·황갈 털이 섞임(회색 털이 보이는 차콜). 기갑·목 위·어깨와 안장 아래 가장자리는 더 회갈색
    _sad.copy(cB).lerp(cG, grizzle);
    const neck = ss(0.1, 0.2, p.z) * ss(0.0, 0.08, p.y); // 목 옆: 머리 베이지로 이어진다
    const tick = ss(lineY - 0.07, lineY - 0.01, p.y + ns) * (0.5 + 0.5 * hash3(_pg.set(p.x * 90, p.y * 90, p.z * 90))); // 안장 밑 황갈에 검은 털이 섞인(ticking) 띠
    c.copy(cT).lerp(cH, neck * 0.6).lerp(cTick, tick * 0.25 + 0.3 * shoulder);
    tone(c.lerp(_sad, black).lerp(cW, Math.max(belly, chest) * (1 - black * 0.9)), p, 0.04);
  };
  // 머리: 얼굴 전체가 연한 베이지(볼·입선까지) + 흰 주둥이·턱·목·가는 이마 줄, 관자놀이·주둥이 위는 회색이 섞인 노견, 부드러운 어두운 눈테, 볼은 살짝 진하다
  const headPaint = J ? (p, c) => tone(c.copy(cW).lerp(cT, ss(0.1, 0.16, p.y) * 0.4), p, 0.05) : (p, c) => {
    const n = wob(p, 25) * 0.012 + wob(p, 60) * 0.004, ax = Math.abs(p.x);
    const muzzle = ss(0.058, 0.098, p.z + n * 0.6 + (p.y - 0.02) * 0.35 - ss(0.022, 0.05, ax) * 0.022); // 흰 주둥이: 콧등은 단(stop) 앞부터 희고, 볼 쪽 경계는 눈 밑에서 입꼬리로 비스듬히 내려간다(볼은 베이지 — 황갈이 눈 밑 콧등 뿌리까지 온다)
    const lowY = lerp(-0.03, -0.018, ss(-0.08, 0.06, p.z));
    const under = ss(0.012, -0.012, p.y - lowY + n); // 턱 밑·목은 흰색
    const up = ss(0.075, 0.105, p.y); // 이마 위쪽
    const bw = 0.005 + Math.max(0, 0.065 - p.y) * 0.3 + 0.008 * up; // 눈 사이에서는 가늘고, 아래로는 주둥이 흰색으로, 위로는 정수리 쪽으로 넓어진다
    const blaze = ss(bw + 0.016, bw, ax + n * 0.5) * ss(0.025 - 0.07 * up, 0.05 - 0.07 * up, p.z) * 0.62 * (1 - 0.6 * ss(0.095, 0.115, p.y)); // 좁은 크림 이마 줄(흰색이 아니라 크림): 눈 사이에서 이마를 지나 정수리까지
    const white = Math.max(muzzle, under, blaze);
    tone(c.copy(cMuz).lerp(cW, under).lerp(cH, 1 - white), p, 0.035);
    c.lerp(cW, 0.12 * ss(0.075, 0.1, p.y) * (1 - ss(0.03, 0.055, ax)) * (1 - white)); // 이마 가운데는 조금 밝다
    c.lerp(cE, 0.5 * ss(0.055, 0.09, p.y) * ss(0.06, 0.02, p.z) * (1 - white)); // 두개골 모자: 연한 황갈이 한 단계 진하다
    c.lerp(cE, 0.45 * ss(0.03, 0.05, ax) * ss(0.08, 0.02, p.y) * ss(0.1, 0.05, p.z) * (1 - white)); // 볼·관자놀이는 진한 베이지
    c.lerp(cGrey, 0.25 * ss(0.07, 0.1, p.z) * ss(0.01, 0.03, p.y) * ss(0.4, 0.7, hash3(_pg.set(p.x * 70, p.y * 70, p.z * 70)))); // 노견: 콧등이 희끗희끗 (낱낱의 흰 털)
    c.lerp(cGrey, 0.15 * ss(0.035, 0.01, Math.abs(ax - 0.052)) * ss(0.05, 0.08, p.y) * ss(0.05, 0.0, p.z) + 0.15 * ss(0.1, 0.115, p.y) * (1 - white)); // 관자놀이 회색 + 정수리 회색 서리
    const ed = Math.hypot(ax - 0.038, (p.y - 0.061) * 1.0, (p.z - 0.058) * 0.8);
    const ring = ss(0.028, 0.018, ed), halo = ss(0.05, 0.024, ed + (p.y - 0.061) * 0.25); // 눈을 감싸는 부드러운 어두운 눈테 + 눈 둘레 사방의 따뜻한 베이지 그늘
    const tear = ss(0.006, 0.0015, Math.abs(ax - 0.028 + (0.05 - p.y) * 0.15)) * ss(0.05, 0.042, p.y) * ss(0.012, 0.028, p.y) * ss(0.05, 0.065, p.z);
    c.lerp(cEyeShade, halo * 0.6 * (1 - white * 0.4)).lerp(cRim, Math.min(0.85, ring * 0.6 + tear * 0.1));
    if (p.z > 0.06 && p.y < 0.002) { // 입: 선 자체는 가는 메시(아래 mouthLine)이고, 여기서는 골 안의 부드러운 그늘만 칠한다
      const ld = lipDist(p.x, p.y, p.z), fadeU = 1 - 0.6 * ss(0.65, 1.0, lipU);
      c.lerp(cLipSh, ss(0.008, 0.002, ld) * 0.4 * fadeU).lerp(cLip, ss(0.0032, 0.001, ld) * 0.55 * fadeU);
      c.lerp(cLip, 0.5 * ss(0.003, 0.001, ax) * ss(LIP[0][1] - 0.001, LIP[0][1] + 0.003, p.y) * ss(0.11, 0.12, p.z)); // 인중
    }
    for (const sx of [1, -1]) { // 귀가 볼에 드리우는 부드러운 접촉 그늘
      if (p.x * sx < 0.02) continue;
      const de = earS[sx](p.x - sx * 0.05, p.y - 0.092, p.z + 0.02);
      c.multiplyScalar(1 - 0.15 * ss(0.012, 0.0, de));
    }
  };
  // 귀: 머리보다 살짝 진한 베이지. 접힌 위쪽 1/3은 회색 털이 섞이고, 뿌리는 머리색으로 이어지고, 가장자리는 연하다
  const earPaint = (sx) => (J ? whitePaint : (p, c) => {
    const { t, w, q, chan, n } = earFrame(sx, p.x, p.y, p.z);
    const inner = ss(0.001, -0.004, n);
    const streak = 0.5 + 0.5 * wob(_pg.set(p.x * 40, p.y * 3, p.z * 40), 40); // 아래로 흐르는 가는 털결
    const strand = ss(0.55, 0.95, 0.5 + 0.5 * wob(_pg.set(p.x * 75, p.y * 2.5, p.z * 75), 40)); // 가는 회색 털 가닥
    const griz = (0.3 + 0.7 * streak) * (0.12 + 0.88 * ss(0.38, 0.05, t)) + 0.12 * strand; // 회색 서리는 접힌 위쪽 1/3에 짙고, 가는 가닥은 귀 전체에
    tone(c.copy(cE).multiplyScalar(1 - 0.08 * ss(0.4, 1, t)).lerp(cEarGrey, griz * 0.36).lerp(cH, streak * 0.3).lerp(cH, ss(0.08, 0, t) * 0.3), p, 0.04);
    c.multiplyScalar(1 - 0.13 * chan * (1 - inner) - 0.2 * inner - 0.1 * Math.exp(-(((t - 0.2) / 0.045) ** 2))); // 골·접힌 주름·볼에 닿는 안쪽 면은 어둡다
    c.lerp(cW, ss(0.45, 1.0, Math.abs(q)) * 0.16 * (1 - inner * 0.6) + 0.1 * ss(0.4, 0.95, q) * (1 - inner)); // 도톰한 테두리와 말린 앞 가장자리는 밝다
  });
  // 꼬리: 황갈 바탕, 뿌리 쪽 등면은 차콜, 끝 1/3은 흰 붓
  const tailPaint = J ? whitePaint : (p, c) => {
    const dark = ss(0.19, 0.05, p.y) * (0.35 + 0.65 * ss(-0.004, 0.012, p.z - tailAxisZ(p.y))) * (0.6 + 0.4 * hash3(_pg.set(p.x * 120, p.y * 120, p.z * 120)));
    tone(c.copy(cT).lerp(cTailDark, dark).lerp(cW, ss(0.185, 0.245, p.y + wob(_pg.set(p.x * 8, p.y, p.z * 8), 30) * 0.02)), p, 0.05); // 흰 붓은 끝 1/4만
  };
  // 다리 마디: 몸 기준 높이(쉬는 자세)로 황갈→흰색. 색 경계가 관절과 겹치지 않게 부드러운 띠로
  const legPaint = (y0, w0, w1, sx) => (J ? whitePaint : (p, c) => { // 황갈이 흰 다리로 털결 따라 번지고, 다리 바깥쪽에는 황갈 털이 조금 더 길게 내려온다
    const y = y0 + p.y + wob(_pg.set(p.x * 3, p.y * 3, p.z), 30) * 0.02 + (hash3(_pg.set(p.x * 90, p.y * 90, p.z * 90)) - 0.5) * 0.01;
    tone(c.copy(cT).lerp(cLeg, ss(w0, w1, y)).lerp(cTick, 0.25 * ss(0.0, 0.02, p.x * sx) * ss(w0, w0 - 0.08, y)), p, 0.04);
  });
  const pawPaint = J ? whitePaint : (p, c) => tone(c.copy(cLeg), p, 0.04);
  const segPaint = (L, tanTop, tanBottom, fade = 0.65) => (J ? whitePaint : (p, c) => {
    const t = clamp(-p.y / L, 0, 1);
    tone(c.copy(cW).lerp(cT, lerp(tanTop, tanBottom, ss(0.0, fade, t))), p, 0.04);
  });
  // 목줄: 목 둘레를 돌며 몸 표면에서 살짝 띄운 점을 떠서 띠를 만든다 (어느 자세에서도 몸에 파묻히지 않게)
  const collarRing = (sdf, cc, axis, half, segs = 72) => {
    const u = V3(1, 0, 0), v = V3().crossVectors(axis, u).normalize(), dir = V3(), pos = [], nor = [], uv = [], idx = [], pts = [];
    const march = (dx, dy, dz, r = 0.05) => { while (r < 0.3 && sdf(cc.x + dx * r, cc.y + dy * r, cc.z + dz * r) < 0.0035) r += 0.0008; return r; };
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
    const rf = march(-v.x, -v.y, -v.z), front = V3(cc.x - v.x * rf, cc.y - v.y * rf, cc.z - v.z * rf);
    // 목이 굽으면 리본을 굽은 몸 표면에 다시 두른다: 고리 중심·축을 (cy, cz, ay, az)로 옮겨 같은 방식으로 표면까지 나아간다 (리본이 늘어나거나 몸에서 뜨지 않는다)
    const refit = (sdf2, cy, cz, ay, az) => {
      const pa = g.attributes.position.array, na = g.attributes.normal.array, vy = az, vz = -ay; // v = axis × (1,0,0)
      const m2 = (dx, dy, dz) => { let r = 0.03; while (r < 0.3 && sdf2(dx * r, cy + dy * r, cz + dz * r) < 0.0035) r += 0.0008; return r; };
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a) * vy, dz = Math.sin(a) * vz, r = m2(dx, dy, dz);
        for (let k = 0; k < 2; k++) { const j = (i * 2 + k) * 3, s = k ? 1 : -1; pa[j] = dx * r; pa[j + 1] = cy + dy * r + ay * s * half; pa[j + 2] = cz + dz * r + az * s * half; na[j] = dx; na[j + 1] = dy; na[j + 2] = dz; }
      }
      g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true; g.computeBoundingSphere();
      const r = m2(0, -vy, -vz); front.set(0, cy - vy * r, cz - vz * r);
    };
    return { geo: g, pts, front, refit };
  };

  d.root = new THREE.Group();
  const sc = new THREE.Group(); sc.scale.setScalar(scale); d.root.add(sc);
  const body = new THREE.Group(); sc.add(body); d.body = body;

  // 몸통 (몸통 · 가슴 · 엉덩이 · 목을 매끈하게 이은 한 덩어리)
  d.torso = put(body, sdfGeo(J ? 'jb' : 'bb', bodySDF(J), J ? [-0.17, -0.17, -0.3] : [-0.15, -0.17, -0.27], J ? [0.17, 0.2, 0.33] : [0.15, 0.25, 0.3], 0.006, 2), null, null, null, bodyPaint);
  if (J) d.torso.userData.fur = [2, 0.002, 1600];
  if (!silhouette && C.collar) {
    const sdfB = bodySDF(J), ring = J ? collarRing(sdfB, V3(0, 0.068, 0.148), V3(0, 0.72, 0.69).normalize(), 0.011) : collarRing(sdfB, V3(0, COLLAR_C[0], COLLAR_C[1]), V3(0, COLLAR_AX[0], COLLAR_AX[1]).normalize(), 0.011); // 목 밑동(턱에서 손 한 뼘 아래), 가는 띠가 가슴 위로 V자로 늘어진다
    if (C.collar === 'ribbon') {
      // 빨강·흰·남색 줄무늬 리본(바랜 색): 몸 표면을 따라가는 얇은 띠
      const ribbonTex = canvasTex(8, 64, (x, w, h) => {
        let y0 = 0;
        for (const [col, fr] of [['#884a43', 0.3], ['#d8cfc1', 0.14], ['#3a4257', 0.12], ['#d8cfc1', 0.14], ['#884a43', 0.3]]) { x.fillStyle = col; x.fillRect(0, Math.floor(y0 * h), w, Math.ceil(fr * h) + 1); y0 += fr; }
      });
      d.collarRing = ring; d.collarMesh = put(body, ring.geo, null, null, null, null, new THREE.MeshStandardMaterial({ map: ribbonTex, roughness: 0.85, side: THREE.DoubleSide }));
    } else put(body, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ring.pts, true), 72, 0.011, 10, true), null, null, null, null, M(C.collar, { roughness: 0.5 }));
    if (C.medal) {
      // 메달: 리본 앞 가장 낮은 점에 고리로 매달린 둥근 어두운 청동 판(녹청). 자세에 따라 가슴에 눕는 기울기는 updateDog에서 잡는다
      const md = new THREE.Group(); md.position.copy(ring.front); body.add(md); d.medal = md; d.medalSDF = sdfB;
      const bronze = new THREE.MeshPhysicalMaterial({ color: 0x3d2f25, metalness: 0.5, roughness: 0.62 });
      const bronzeHi = new THREE.MeshPhysicalMaterial({ color: 0x5a4836, metalness: 0.55, roughness: 0.55 });
      put(md, new THREE.TorusGeometry(0.006, 0.0017, 6, 14), [0, -0.004, 0.002], [0, Math.PI / 2, 0], null, null, bronze);
      put(md, new THREE.TorusGeometry(0.0045, 0.0014, 6, 12), [0, -0.012, 0.003], null, null, null, bronzeHi);
      put(md, new THREE.CylinderGeometry(0.025, 0.025, 0.004, 32), [0, -0.045, 0.004], [Math.PI / 2, 0, 0], null, null, bronze);
      put(md, new THREE.TorusGeometry(0.022, 0.0016, 6, 32), [0, -0.045, 0.0065], null, null, null, bronzeHi);
    }
  }

  // 머리: 목이 45°로 올라간 끝, 등선보다 위에 얹힌다
  const hp = new THREE.Group(); hp.rotation.order = 'YXZ'; hp.position.set(0, J ? 0.13 : 0.146, J ? 0.205 : 0.208); body.add(hp); d.hp = hp; // 비글: 머리를 목 위로 올려 머리와 가슴 사이에 목이 보인다
  if (!J) {
    // 목 관절: 목은 몸통 메시의 일부라, 앉아서 몸이 뒤로 기울면 목도 같이 뒤로 넘어가 머리가 등 위로 간다.
    // 목 부분 정점만 목뿌리(기갑 앞) 축을 중심으로 앞으로 굽혀(가중치로 부드럽게) 머리가 가슴 앞 위에 오게 한다.
    // 축은 목 단면 가운데(목덜미가 아니라)에 두고 목 전체에 걸쳐 완만하게 굽힌다 — 목 앞(멱)이 가슴 위로 접혀 턱 밑에 선반이 생기지 않게
    const NP = V3(0, NECK_P[0], NECK_P[1]), ny = 0.953, nz = 0.302;
    const nw = (x, y, z) => ss(NECK_W[0], NECK_W[1], (y - 0.07) * ny + (z - 0.11) * nz) * ss(NECK_W[2], NECK_W[3], z);
    const R = d.neckRig = makeRig(NP, nw);
    rigMesh(R, d.torso.geometry);
    rigFollow(R, hp.position);
    if (d.collarRing) {
      // 리본·메달: 정점을 따로 굽히지 않고(고리가 찢어지듯 늘어난다) 굽은 몸 표면에 고리를 통째로 다시 두른다. 메달이 가슴에 눕는 판정도 굽은 몸으로 한다
      const sdf0 = d.medalSDF || bodySDF(false), ring = d.collarRing, cc = V3(0, COLLAR_C[0], COLLAR_C[1]), ax = V3(0, COLLAR_AX[0], COLLAR_AX[1]).normalize(), wc = nw(0, cc.y, cc.z);
      const bent = (x, y, z) => {
        const th = R.theta; if (!th && !R.sy && !R.sz) return sdf0(x, y, z);
        let py = y, pz = z;
        for (let i = 0; i < 4; i++) { const w = nw(x, py, pz), a = -th * w, c = Math.cos(a), s = Math.sin(a), ry = y - R.sy * w - NP.y, rz = z - R.sz * w - NP.z; py = NP.y + ry * c - rz * s; pz = NP.z + ry * s + rz * c; }
        // 많이 굽으면(먹기) 목덜미 뒤 접히는 곳에서는 되돌린 점이 수렴하지 않는다: 되돌린 점을 다시 굽혀 제자리로 오지 않으면 몸 밖으로 친다 (리본이 등 위로 치솟지 않게)
        const w = nw(x, py, pz), a = th * w, c = Math.cos(a), s = Math.sin(a), ry = py - NP.y, rz = pz - NP.z, ey = NP.y + ry * c - rz * s + R.sy * w - y, ez = NP.z + ry * s + rz * c + R.sz * w - z;
        const d0 = sdf0(x, py, pz);
        return ey * ey + ez * ez > 0.0001 ? Math.max(d0, 0.01) : d0;
      };
      if (d.medal) d.medalSDF = bent;
      let last = 0, lastS = 0;
      d.collarFit = () => {
        if (Math.abs(R.theta - last) < 0.002 && Math.abs(R.sy - lastS) < 0.0005) return;
        last = R.theta; lastS = R.sy;
        const a = last * wc, c = Math.cos(a), s = Math.sin(a), ry = cc.y - NP.y, rz = cc.z - NP.z;
        const aT = Math.min(a, 0.7 * wc), a2 = aT * COLLAR_FOLLOW + 0.6 * (a - aT), c2 /* 앉기·안기기 범위(목 0.7)까지는 조금만, 그보다 더 숙이면(먹기) 목과 함께 돈다 — 고리 면이 등을 길게 가르며 손잡이처럼 서지 않게 */ = Math.cos(a2), s2 = Math.sin(a2); // 고리 면은 조금만 따라 돈다 (많이 돌면 리본이 가슴 아래까지 늘어진다)
        ring.refit(bent, NP.y + ry * c - rz * s + R.sy * wc, NP.z + ry * s + rz * c + R.sz * wc, ax.y * c2 - ax.z * s2, ax.y * s2 + ax.z * c2);
        if (d.medal) d.medal.position.copy(ring.front);
      };
    }
  }
  const head = new THREE.Group(); head.scale.setScalar(J ? 1.3 : 1.42); hp.add(head); d.head = head; // 비글: 머리를 크게(귀여움) — 귀 포함 머리 폭이 가슴보다 확실히 넓게
  const skull = put(head, sdfGeo(J ? 'jh' : 'bh', headSDF(J), J ? [-0.135, -0.08, -0.13] : [-0.075, -0.055, -0.095], J ? [0.135, 0.175, 0.25] : [0.075, 0.135, 0.165], J ? 0.004 : 0.0025, 1), null, null, null, headPaint);
  if (J) skull.userData.fur = [2, 0.0015, 1600];
  const noseM = new THREE.MeshPhysicalMaterial({ color: C.nose, roughness: J ? 0.3 : 0.55, clearcoat: J ? 0.6 : 0.28, clearcoatRoughness: J ? 0.25 : 0.45 }); // 비글: 촉촉한 검은 가죽 코 (넓은 확산광 대신 작은 반짝임 — 회색 고무가 되지 않게)
  if (J) {
    put(head, sph(), [0, 0.03, 0.148], null, [0.021, 0.0155, 0.015], null, noseM);
    if (!silhouette) for (const sx of [1, -1]) put(head, sph(12, 8), [sx * 0.0072, 0.026, 0.16], [0, 0, sx * 0.4], [0.0048, 0.0032, 0.003], null, M(0x050303, { roughness: 0.6 }));
  } else {
    // 코: 주둥이 끝 앞에 얹힌 큼직한 둥근 검은 코 (콧구멍·콧방울 골·인중은 거리장에서 파냄) · 콧구멍 속 어둠. 입선은 머리 거리장에 골로 파고 색을 입힌다
    put(head, sdfGeo('bn', noseSDF, [-0.022, -0.02, -0.017], [0.022, 0.02, 0.017], 0.0006), [0, 0.004, 0.1325], [-0.3, 0, 0], 1.16, null, noseM); // 주둥이 끝 앞으로 살짝 나온 큼직한 코, 윗면이 뒤로 기운다
    if (!silhouette) for (const sx of [1, -1]) put(head, sph(12, 8), [sx * 0.0086, 0.0056, 0.1458], [-0.3, 0, -sx * 0.5], [0.0038, 0.0028, 0.0026], null, M(0x050303, { roughness: 0.8 }));
  }
  if (!J && !silhouette) {
    // 입선: 머리 표면(입 골 바닥)에 붙인 가는 어두운 갈색 관 — 정점 색으로는 낼 수 없는 또렷한 선. 인중에서 'ㅅ'으로 갈라져 입꼬리로 가며 가늘어진다
    const lipM = new THREE.MeshStandardMaterial({ color: 0x2a201b, roughness: 0.9 });
    const tube = (pts, r0, taper) => {
      const curve = new THREE.CatmullRomCurve3(pts), seg = pts.length * 6, g = new THREE.TubeGeometry(curve, seg, r0, 7, false), pos = g.attributes.position, c0 = V3(), v = V3();
      for (let i = 0; i <= seg; i++) { curve.getPointAt(i / seg, c0); const k = taper(i / seg); for (let j = 0; j <= 7; j++) { const q = i * 8 + j; v.fromBufferAttribute(pos, q).sub(c0).multiplyScalar(k).add(c0); pos.setXYZ(q, v.x, v.y, v.z); } }
      const m = put(head, g, null, null, null, null, lipM); m.castShadow = false; return m;
    };
    const R = 0.0017, half = [];
    for (let i = 0; i <= LIP_N; i++) { const u = i / LIP_N, y = lipY(u), ang = u * LIP_ANG, r = surfR(headBase, y, ang, 0.03) - R * 0.35; half.push(V3(Math.sin(ang) * r, y, LIP_AX + Math.cos(ang) * r)); }
    for (const sx of [1, -1]) tube(half.map((p) => V3(p.x * sx, p.y, p.z)), R, (s) => lerp(1, 0.3, ss(0.55, 1, s))); // 좌우를 따로 만들어 가운데가 'ㅅ'으로 뾰족하게 만난다
    const ph = [];
    for (let i = 0; i <= 4; i++) { const y = lerp(PHIL_TOP[1] + 0.001, LIP[0][1], i / 4); ph.push(V3(0, y, LIP_AX + surfR(headBase, y, 0, 0.03) - R * 0.3)); }
    tube(ph, R * 0.8, () => 1);
  }
  const jaw = new THREE.Group(); jaw.position.set(0, J ? -0.02 : -0.014, 0.06); head.add(jaw); d.jaw = jaw;
  if (J) put(jaw, sph(), [0, -0.014, 0.05], null, [0.027, 0.013, 0.04], whitePaint);
  else put(jaw, sph(), [0, -0.013, 0.028], null, [0.013, 0.008, 0.024], whitePaint); // 아래턱: 윗입술 안쪽에 들어가 턱 끝만 살짝 보인다 (입을 다물고 있어 입 속은 칠하지 않는다)
  const tongueRoot = new THREE.Group(); tongueRoot.position.set(0, J ? -0.01 : 0.006, J ? 0.01 : 0.02); jaw.add(tongueRoot);
  d.tongue = put(tongueRoot, sph(16, 10), [0, 0.006, 0.035], null, [0.02, 0.007, 0.03], null, M(0xe9808e, { roughness: 0.45 }));
  d.tongue.visible = false; // 혀는 보이지 않는다 (핑키는 혀를 내밀지 않는다)
  for (const sx of [1, -1]) {
    const eg = new THREE.Group(); eg.scale.setScalar(J ? 1.3 : 1); head.add(eg);
    if (J) { eg.position.set(sx * 0.04, 0.066, 0.097); eg.rotation.set(0, sx * 0.24, 0); }
    else { eg.position.set(sx * 0.038, 0.061, 0.049); eg.rotation.set(-0.12, sx * 0.03, 0); } // 크고 앞을 보는 동그란 눈, 지름 0.033(두개골 폭의 23%), 눈 사이 간격은 두개골 폭의 ~0.6, 살 속에 묻혀 앞면만 살짝 나온다
    if (!silhouette) {
      // 아주 진한 갈색의 촉촉한 눈(앞면이 살짝 납작) · 동공(가장자리에 가는 갈색 홍채 테) · 작은 반사 하나. 위아래 눈꺼풀이 눈알을 살짝 덮는다 — 눈테는 머리 무늬로 칠한다
      put(eg, sph(24, 16), [0, 0, 0], null, J ? [0.0148, 0.0144, 0.0115] : [0.015, 0.015, 0.012], null, new THREE.MeshPhysicalMaterial({ color: J ? 0x2e1a10 : 0x23150f, roughness: J ? 0.2 : 0.5, clearcoat: J ? 0.6 : 0.14, clearcoatRoughness: J ? 0.1 : 0.5 }));
      put(eg, sph(16, 10), [0, -0.0004, J ? 0.0088 : 0.0103], null, J ? [0.0068, 0.0068, 0.003] : [0.0074, 0.0074, 0.002], null, M(0x050303, { roughness: 0.3 }));
      if (J) put(eg, sph(16, 10), [0, 0.0138, -0.0035], null, [0.0132, 0.0016, 0.0098], null, M(cH.clone().multiplyScalar(0.92).getHex(), { roughness: 0.9 }));
      else {
        put(eg, new THREE.TorusGeometry(0.0146, 0.0026, 8, 28), [0, 0, 0.0033], null, [1, 1, 1.6], null, new THREE.MeshStandardMaterial({ color: 0x3a2c25, roughness: 0.95 })); // 가늘고 부드러운 어두운 눈테(눈꺼풀 가장자리): 눈알은 덮지 않는다 — 동그랗게 활짝 뜬 눈
      }
      const h1 = new THREE.Mesh(SPH, new THREE.MeshBasicMaterial({ color: J ? 0xe6e0d8 : 0x9a948c })); h1.position.set(J ? -sx * 0.0045 : -0.004, 0.0055, J ? 0.0108 : 0.0108); h1.scale.setScalar(J ? 0.0017 : 0.0013); eg.add(h1);
      if (J) { const h2 = new THREE.Mesh(SPH, new THREE.MeshBasicMaterial({ color: 0xf6f2ec })); h2.position.set(sx * 0.0034, -0.0038, 0.0102); h2.scale.setScalar(0.0007); eg.add(h2); }
    }
    d.eyes.push(eg);
  }
  for (const sx of [1, -1]) {
    const ep = new THREE.Group(); head.add(ep);
    if (J) { ep.position.set(sx * 0.056, 0.128, 0); put(ep, new THREE.ConeGeometry(0.042, 0.1, 16), [0, 0.044, 0], null, [1, 1, 0.55], earPaint(sx)).userData.fur = [2, 0.004, 480]; ep.rotation.z = sx * -0.22; }
    else {
      ep.position.set(sx * 0.055, 0.1, -0.006); // 귀 뿌리를 정수리 모서리(눈썹 높이 위)로 올리고 조금 앞으로 — 귀가 얼굴 양옆을 감싸며 내려온다. 귀는 눈과 정수리 사이 높이에서 두개골 '위에' 접혀 시작해(옆에 붙은 혹이 아니다) 볼 위로 늘어진다 — 귀 위로 둥근 정수리가 보인다
      put(ep, sdfGeo('be' + sx, earSDF(sx), sx > 0 ? [-0.03, -0.18, -0.085] : [-0.125, -0.18, -0.085], sx > 0 ? [0.125, 0.03, 0.1] : [0.03, 0.03, 0.1], 0.0026, 1), null, null, null, earPaint(sx));
    }
    d.ears.push({ g: ep, side: sx, ax: 0, vx: 0, az: 0, vz: 0 });
  }

  // 꼬리
  const tp = new THREE.Group(); tp.position.set(0, J ? 0.07 : 0.053, J ? -0.196 : -0.25); body.add(tp); d.tail = tp;
  if (J) put(tp, new THREE.TorusGeometry(0.055, 0.03, 10, 20, Math.PI * 1.5), [0, 0.06, 0], [0, Math.PI / 2, 0.5], null, tailPaint).userData.fur = [3, 0.006, 400];
  else d.tailMesh = put(tp, sdfGeo('bt', tailSDF, [-0.048, -0.048, -0.05], [0.048, 0.3, 0.11], 0.003), null, null, null, tailPaint);

  // 다리: 앞다리 = 위팔 · 아래팔 · 발허리 (팔꿈치는 뒤로, 손목은 들 때 뒤로 접힘)
  //       뒷다리 = 허벅지 · 정강이 · 뒷발허리 (무릎은 앞으로, 뒤꿈치는 뒤로)
  const k = J ? 1.15 : 1;
  const LEGS = J ? [[1, 0.132, true], [-1, 0.132, true], [1, -0.119, false], [-1, -0.119, false]] : [[1, 0.226, true], [-1, 0.226, true], [1, -0.175, false], [-1, -0.175, false]];
  for (const [sx, z, front] of LEGS) {
    const L1 = J ? (front ? 0.095 : 0.09) * k : front ? 0.1 : 0.118, L2 = J ? 0.095 * k : front ? 0.122 : 0.105, L3 = J ? (front ? 0.045 : 0.065) * k : front ? 0.045 : 0.088; // 뒷다리: 허벅지 ≈ 정강이, 뒷발허리(비절~발)는 기갑 높이의 ~0.24 — 비절이 바닥에서 확실히 떠 보인다
    const hip = new THREE.Group(); body.add(hip);
    let thighM = null;
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
      // 굵고 거의 가늘어지지 않는 원통 마디 + 관절마다 공 하나 (공 반지름 = 원통 끝 반지름이라 링 솔기가 없다)
      hip.position.set(sx * (front ? 0.048 : 0.062), front ? -0.022 : 0.015, z); // 앞: 어깨 관절(견단)은 가슴 앞쪽 위(몸 높이의 2/3) — 위팔이 뒤·아래로 내려가 팔꿈치가 가슴 바닥 높이에서 갈비에 붙고, 아래팔은 수직으로 선다. // 고관절은 골반 가운데 높이(좌골보다 위)에 두어 앉을 때 엉덩이는 바닥에, 고관절은 바닥 위에 있고 무릎이 앞 위로 나온다
      const r1 = front ? 0.027 : 0.052, r2 = front ? 0.039 : 0.036, r3 = front ? 0.029 : 0.0235, r4 = front ? 0.03 : 0.0255; // 짧고 튼튼하지만 팔꿈치·무릎 아래로 가늘어지는 다리 (발목은 윗다리의 55%)
      const paintAt = front ? V3(sx * 0.046, -0.048, 0.228) : hip.position.clone(); // 무늬는 예전 어깨 자리 기준 그대로 (관절을 옮겨도 털색은 그대로)
      const bodySpace = (p, c) => bodyPaint(_pb.copy(p).add(paintAt), c, 1); // 위팔·허벅지는 몸통 무늬를 그대로 이어받는다 (배 흰색은 끄고 황갈로 — 위팔은 팔꿈치까지 황갈)
      const seg = (key, L, ra, rb) => sdfGeo(key, legSegSDF(L, ra, rb), [-ra - 0.003, -L - rb - 0.003, -ra - 0.003], [ra + 0.003, ra + 0.003, ra + 0.003], 0.003);
      const fk = front ? 'f' : 'h';
      if (front) put(hip, seg('bl1f', L1, r1, r2), null, null, null, bodySpace);
      else thighM = put(hip, sdfGeo('bl1h', (x, y, z) => smin(sdRoundCone(x, y, z, L1, r1, r2), sdE(x, y, z, 0, -L1 * 0.25, 0.012, 0.06, 0.07, 0.054), 0.03), [-0.075, -L1 - r2 - 0.003, -0.078], [0.075, r1 + 0.003, 0.095], 0.003), null, null, null, (p, c) => { bodySpace(p, c); c.lerp(cT, 0.3 * ss(-0.02, -0.09, p.y)); }); // 허벅지 아래쪽은 안장빛을 덜어 황갈로: 앉거나 엎드려 허벅지가 옆구리에 겹쳐도 어두운 원반으로 떠 보이지 않는다
      // 허벅지: 다리와 한 덩어리로 움직이는 둥근 '바지' (서면 둥근 허벅지, 앉으면 접힌 무릎·정강이를 덮는 둥근 엉덩이 살)
      const lower = front ? legPaint(-0.166, -0.13, -0.21, sx) : legPaint(hip.position.y - L1, -0.19, -0.26, sx); // 앞다리는 팔꿈치까지 황갈, 아래팔 중간부터 흰색; 뒷다리는 정강이까지 황갈, 비절(hock)부터 흰 양말 (앉아도 정강이가 흰 통나무로 보이지 않는다)
      if (front) put(knee, sdfGeo('bl2f', (x, y, z) => smin(sdRoundCone(x, y, z, L2, r2, r3), Math.hypot(x, y - 0.006, z + 0.03) - 0.02, 0.014), [-r2 - 0.003, -L2 - r3 - 0.003, -0.058], [r2 + 0.003, r2 + 0.003, r2 + 0.003], 0.003), null, null, null, lower); // 팔꿈치 머리(olecranon): 아래팔 위 끝 뒤로 살짝 나온 뼈 — 다리가 책상 다리처럼 밋밋한 통이 되지 않게
      else put(knee, sdfGeo('bl2h', (x, y, z) => smin(sdRoundCone(x, y, z, L2, r2, r3), sdE(x, y, z, 0, -L2 * 0.1, 0.004, 0.038, 0.044, 0.04), 0.03), [-0.05, -L2 - r3 - 0.003, -0.05], [0.05, r2 + 0.003, 0.055], 0.003), null, null, null, lower); // 정강이 위쪽의 둥근 무릎(stifle) 살: 앉으면 허벅지와 이어져 정강이가 통나무로 보이지 않는다
      if (front) put(ank, sdfGeo('bl3f', (x, y, z) => smin(sdRoundCone(x, y, z, L3, r3, r4), Math.hypot(x, y + 0.004, z + 0.019) - 0.0135, 0.012), [-r4 - 0.003, -L3 - r4 - 0.003, -0.04], [r4 + 0.003, r4 + 0.003, r4 + 0.003], 0.003), null, null, null, pawPaint); // 손목 뒤 볼록(덧손목뼈): 아래팔과 발허리 사이가 살짝 꺾여 보인다
      else put(ank, sdfGeo('bl3h', (x, y, z) => smin(sdRoundCone(x, y, z, L3, r3, r4), Math.hypot(x, y - 0.004, z + 0.027) - 0.024, 0.014), [-r4 - 0.003, -L3 - r4 - 0.003, -0.058], [r4 + 0.003, 0.03, r4 + 0.003], 0.003), null, null, null, pawPaint); // 비절 끝(뒤꿈치뼈)이 뒤로 살짝 나온다
      put(foot, sph(), [0, 0, 0], null, r4 * 0.9, pawPaint);
      put(foot, sdfGeo('bf', footSDF, [-0.045, -0.03, -0.04], [0.045, 0.025, 0.055], 0.0025), [0, 0, 0.01], null, front ? 1.08 : 1.0, pawPaint); // 앞발이 뒷발보다 조금 크다
    }
    d.legs.push({ sx, front, hip, knee, ank, foot, L1, L2, L3, z0: z, thigh: J || front ? null : thighM });
  }

  if (!J) {
    // 허리 관절(흉요추·요천추): 갈비 뒤부터 엉덩이까지의 몸통 정점을 허리 축 둘레로 굽힌다 — 앉으면 가슴은 덜 눕고 골반이 밑으로 말려 엉덩이가 바닥에 앉는다.
    // 고관절·꼬리 뿌리도 골반과 함께 움직인다 (갈비뼈 구간 z > -0.02 는 한 덩어리로 굳어 있다)
    const R = d.lumbarRig = makeRig(V3(0, 0.02, -0.06), (x, y, z) => ss(0.0, -0.17, z));
    rigMesh(R, d.torso.geometry);
    for (const L of d.legs) if (!L.front) L.fol = rigFollow(R, L.hip.position);
    rigFollow(R, tp.position);
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

const COLLAR_C = [0.095, 0.155], COLLAR_AX = [0.72, 0.69], COLLAR_FOLLOW = 0.3; // 비글 목줄 고리 중심(y, z) · 고리 면의 법선(y, z) · 목이 굽을 때 고리 면이 따라 도는 비율
const NECK_P = [0.07, 0.15], NECK_W = [-0.03, 0.07, 0.04, 0.13]; // 목 관절 축(y, z) · 가중치 구간(목 축 방향, z)
const WALK_OFF = [0.75, 0.25, 0, 0.5], WALK_DUTY = 0.65, WALK_S = 0.08; // 다리별 박자(앞+, 앞-, 뒤+, 뒤-) · 딛는 비율 · 보폭 절반
const _zAx = V3(0, 0, 1);
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

// 척추 관절(목·허리) 굽힘: 가중치가 있는 정점과 따라가는 것들(머리·리본·메달 / 고관절·꼬리)을 관절 축(x축) 둘레로 th만큼 돌린다. 각이 바뀔 때만 다시 계산
function makeRig(P, wfn) { return { P, wfn, meshes: [], follow: [], theta: 0, phi: 0, sy: 0, sz: 0 }; }
function rigMesh(R, geo) {
  const pos = geo.attributes.position, n = geo.attributes.normal, idx = [], w = [];
  for (let i = 0; i < pos.count; i++) { const wi = R.wfn(pos.getX(i), pos.getY(i), pos.getZ(i)); if (wi > 0.001) { idx.push(i); w.push(wi); } }
  R.meshes.push({ geo, rest: pos.array.slice(), nrest: n ? n.array.slice() : null, idx: Int32Array.from(idx), w: Float32Array.from(w) });
}
function rigFollow(R, v) { const f = { v, rest: v.clone(), w: R.wfn(v.x, v.y, v.z), dx: 0 }; R.follow.push(f); return f; }
function bendRig(R, th, ph = 0, sy = 0, sz = 0) { // sy·sz: 가중치만큼 밀어 늘인다(목을 길게 뺀다 — 바닥의 밥그릇에 코가 닿게) · // th: 앞뒤 굽힘(x축 둘레) · ph: 좌우 굽힘(y축 둘레 — 걸을 때 골반이 좌우로 돌고, 누우면 등이 C자로 휜다)
  if (Math.abs(th - R.theta) < 0.002 && Math.abs(ph - R.phi) < 0.002 && Math.abs(sy - R.sy) + Math.abs(sz - R.sz) < 0.0005) return;
  R.theta = th; R.phi = ph; R.sy = sy; R.sz = sz;
  const Py = R.P.y, Pz = R.P.z;
  for (const m of R.meshes) {
    const pos = m.geo.attributes.position, pa = pos.array, nAttr = m.geo.attributes.normal, na = nAttr ? nAttr.array : null;
    for (let k = 0; k < m.idx.length; k++) {
      const j = m.idx[k] * 3, a = th * m.w[k], c = Math.cos(a), s = Math.sin(a), b = ph * m.w[k], cb = Math.cos(b), sb = Math.sin(b);
      const x = m.rest[j], y = m.rest[j + 1] - Py, z = m.rest[j + 2] - Pz, z1 = y * s + z * c;
      pa[j] = x * cb + z1 * sb; pa[j + 1] = Py + y * c - z * s + sy * m.w[k]; pa[j + 2] = Pz - x * sb + z1 * cb + sz * m.w[k];
      if (na && m.nrest) { const nx = m.nrest[j], ny = m.nrest[j + 1], nz = m.nrest[j + 2], n1 = ny * s + nz * c; na[j] = nx * cb + n1 * sb; na[j + 1] = ny * c - nz * s; na[j + 2] = -nx * sb + n1 * cb; }
    }
    pos.needsUpdate = true; if (nAttr) nAttr.needsUpdate = true;
    m.geo.computeBoundingSphere();
  }
  for (const f of R.follow) {
    const a = th * f.w, c = Math.cos(a), s = Math.sin(a), b = ph * f.w, cb = Math.cos(b), sb = Math.sin(b), x = f.rest.x, y = f.rest.y - Py, z = f.rest.z - Pz, z1 = y * s + z * c;
    f.dx = x * cb + z1 * sb - x; f.v.x = x + f.dx; f.v.y = Py + y * c - z * s + sy * f.w; f.v.z = Pz - x * sb + z1 * cb + sz * f.w;
  }
}

// 꼬리를 옆으로 둥글게 만다(앉으면 바닥에 놓인 꼬리가 막대처럼 곧지 않게): 꼬리 메시 정점을 꼬리 축(y)을 따라 일정한 곡률로 굽힌다. k = 끝까지의 총 굽힘각
function curlTail(d, k) { d.tailKWant = k; shapeTail(d); }

function updateDog(d, dt, t, camPos) {
  const c = d.cur, g = d.tgt, k = 1 - Math.exp(-d.poseRate * dt);
  for (const key of POSE_KEYS) c[key] += (g[key] - c[key]) * k;
  for (let i = 0; i < 4; i++) { c.paws[i].lerp(g.paws[i], k); c.lean[i] += (g.lean[i] - c.lean[i]) * k; c.abd[i] += (g.abd[i] - c.abd[i]) * k; }

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
      d.phase += Math.max(sp, 0.16) * dt * Math.PI / (d.J ? 2 * 0.055 * d.scale : (WALK_S * d.scale) / WALK_DUTY); // 딛고 있는 발이 바닥에서 미끄러지지 않는 박자
    }
  } else if (!d.external) {
    let want = null;
    if (d.face === 'cam' && camPos) want = Math.atan2(camPos.x - d.x, camPos.z - d.z) + c.yawOff;
    else if (d.face && d.face.x !== undefined) want = Math.atan2(d.face.x - d.x, d.face.z - d.z);
    if (want !== null) {
      const diff = angDiff(d.yaw, want);
      d.yaw += diff * (1 - Math.exp(-3.5 * dt));
      if (Math.abs(diff) > 0.45 && (g.name === 'stand' || g.name === 'eat')) { moving = Math.min(1, Math.abs(diff)); d.phase += dt * 9; }
    }
  }
  d.gait += (moving - d.gait) * (1 - Math.exp(-8 * dt));
  d.lift += (d.liftT - d.lift) * (1 - Math.exp(-4 * dt));
  if (!d.external) { d.root.position.set(d.x, d.lift, d.z); d.root.rotation.y = d.yaw; }

  // 몸
  const br = Math.sin(t * (d.pant ? 7 : 2.3) + d.seed * 3) * (d.pant ? 0.006 : 0.0035);
  const bob = d.J ? d.gait * Math.abs(Math.cos(d.phase)) * 0.01 : d.gait * (Math.abs(Math.cos(d.phase)) * 0.006 - 0.016); // 비글: 걸을 때는 몸을 살짝 낮춰 다리가 끝까지 닿는다
  d.body.position.set(0, c.bodyY + br + bob, c.bodyZ);
  d.body.rotation.set(c.pitch + (d.J ? 0 : Math.sin(d.phase * 2) * 0.012 * d.gait), 0, c.roll + (d.J ? 0 : Math.sin(d.phase) * 0.035 * d.gait)); // 걸을 때 몸이 좌우로 살짝 흔들리고, 어깨와 엉덩이가 번갈아 오르내린다
  d.torso.scale.set(1 + br * 2.5, 1 + br * 2.5, 1);
  if (d.neckRig) { const rc = c.reach || 0, na = (c.neck || 0) + 0.65; bendRig(d.neckRig, c.neck || 0, 0, Math.cos(na) * rc, Math.sin(na) * rc); if (d.collarFit) d.collarFit(); } // reach: 굽은 목 방향(쉬는 목은 수직에서 ~37° 앞으로 누워 있다)으로 목을 뺀다
  const pelvisYaw = d.J ? 0 : -Math.cos(d.phase) * 0.07 * d.gait; // 평보: 앞으로 나간 뒷발 쪽 골반이 앞으로 돈다(허리가 좌우로 굽는다)
  if (d.lumbarRig) bendRig(d.lumbarRig, -(c.lumbar || 0), (c.bendY || 0) + pelvisYaw); // 양수 = 골반이 밑으로 말린다(엉덩이가 아래·앞으로) · bendY: 등이 옆으로 C자로 휜다
  if (d.medal) {
    // 메달은 아래로 늘어지되, 판 중심이 가슴 속에 파묻히면(앉기처럼 몸이 뒤로 기울 때) 가슴에 눕도록 앞으로 기울인다
    const md = d.medal; let rx = -c.pitch * 0.95 + Math.sin(d.phase * 2) * 0.12 * d.gait + Math.sin(t * 1.3) * 0.03;
    const dr = d.J ? 0.03 : 0.07, dz = d.J ? 0.006 : 0.004, nIt = d.J ? 12 : 30, step = d.J ? 0.09 : 0.06; // 판 아래 가장자리·판 중심이 몸에 파묻히면 가슴에 눕도록 앞으로 눕힌다 (앉기처럼 몸이 많이 기울어도 메달이 가슴 속으로 사라지지 않게)
    if (d.medalSDF) for (let i = 0; i < nIt; i++) {
      const y = md.position.y - dr * Math.cos(rx) - dz * Math.sin(rx), z = md.position.z - dr * Math.sin(rx) + dz * Math.cos(rx);
      const dm = d.J ? 0 : 0.045, ym = md.position.y - dm * Math.cos(rx) - dz * Math.sin(rx), zm = md.position.z - dm * Math.sin(rx) + dz * Math.cos(rx);
      if (d.medalSDF(md.position.x, y, z) > 0.007 && (d.J || d.medalSDF(md.position.x, ym, zm) > 0.006)) break;
      rx -= step;
    }
    if (!d.J) rx = Math.max(rx, -c.pitch - 0.7); // 가슴에 기대 눕더라도 수평으로 튀어나오지는 않는다
    md.rotation.set(rx, 0, -c.roll * 0.9 + Math.sin(d.phase) * 0.1 * d.gait);
  }
  d.root.updateMatrixWorld(true);

  // 머리 · 시선
  const h0 = d.neckRig ? (c.neck || 0) * d.neckRig.follow[0].w : 0; // 머리는 목 끝에 달려 있어 목이 굽은 만큼 같이 숙여진다 (시선이 없을 때의 기본 머리 각)
  let yaw = 0, pitch = -h0;
  const look = d.lookFn ? d.lookFn() : camPos;
  if (look && c.gaze > 0.01) {
    _v.copy(look); d.body.worldToLocal(_v); _v.sub(d.hp.position);
    const rawYaw = Math.atan2(_v.x, _v.z), behind = ss(1.2, 1.9, Math.abs(rawYaw));
    yaw = clamp(rawYaw, -1.05, 1.05) * (1 - behind);
    pitch = clamp(Math.atan2(_v.y, Math.hypot(_v.x, _v.z)), -1.0, 0.58 + Math.min(c.pitch, 0)) * (1 - behind) - h0 * behind; // 올려다보는 각은 월드 기준 33°쯤까지: 몸이 뒤로 기운(앉기) 만큼 뺀다. 뒤에 있는 것은 쳐다보지 않는다
  }
  d.tilt += (d.tiltT - d.tilt) * (1 - Math.exp(-6 * dt));
  const hx = (c.headPitch + h0) * (1 - c.gaze) - pitch * c.gaze * (pitch > 0 ? 0.6 : 1) + (d.J ? 0 : Math.sin(d.phase * 2) * 0.03 * d.gait); // 올려다볼 때는 머리를 덜 들고 눈으로 본다
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
    let up = 0, stZ = 0;
    if (d.gait > 0.001) {
      if (d.J) {
        const ph = d.phase + (i === 0 || i === 3 ? 0 : Math.PI);
        _paw.z += Math.sin(ph) * 0.055 * d.gait;
        up = Math.max(0, Math.cos(ph)) * d.gait; _paw.y += up * 0.035;
      } else {
        // 평보(lateral-sequence walk): 왼뒤 → 왼앞 → 오른뒤 → 오른앞, 네 박자. 발은 주기의 65% 동안 땅을 딛고 일정한 속도로 뒤로 밀고(미끄러지지 않게), 35% 동안 들려 앞으로 나간다
        const u = (((d.phase / (Math.PI * 2) + WALK_OFF[i]) % 1) + 1) % 1;
        let sz;
        if (u < WALK_DUTY) sz = 1 - (2 * u) / WALK_DUTY;
        else { const sw = (u - WALK_DUTY) / (1 - WALK_DUTY); sz = -Math.cos(Math.PI * sw); up = Math.sin(Math.PI * sw) * d.gait; }
        stZ = sz; _paw.z += (sz * WALK_S + (L.front ? 0.012 : 0)) * d.gait; _paw.y += up * 0.035; // 앞발은 걸을 때 조금 앞에서 딛는다(뒤로 끝까지 밀어도 다리가 모자라지 않게)
      }
    }
    if (d.paddle > 0.001) { _paw.y += Math.sin(t * 8 + i * 1.7) * 0.035 * d.paddle; _paw.z += Math.cos(t * 8 + i * 1.7) * 0.03 * d.paddle; }
    if (!d.J && L.front) L.hip.position.z = L.z0 + (_paw.z - c.paws[i].z) * 0.15; // 견갑골은 갈비 위에서 미끄러진다: 앞발이 나가면 어깨 관절도 조금 앞으로, 밀면 뒤로
    _hipS.copy(L.hip.position).applyMatrix4(d.body.matrix);
    const lean = c.lean[i] + up * (L.front ? -1.2 : 0.9) + (d.J || L.front ? 0 : (stZ - 0.3) * 0.16 * d.gait); // 뒷발허리: 디딜 때는 비절이 발 뒤에, 밀어낼수록 서서 뒤꿈치가 들린다(비절이 펴진다)
    _dir.set(0, Math.cos(lean), -Math.sin(lean)); if (!d.J && c.roll) _dir.applyAxisAngle(_zAx, c.roll); // 누운 자세: 발목 기울기는 강아지 몸 기준(옆으로 굴러도 손목·비절이 제 방향으로 접힌다)
    _dir.lerp(_tmp.copy(_hipS).sub(_paw).normalize(), c.free).normalize();
    _ank.copy(_paw).addScaledVector(_dir, L.L3).applyMatrix4(_m).sub(L.hip.position);
    _paw.applyMatrix4(_m).sub(L.hip.position);
    solveLeg(L, _ank, _paw, c.level, c.pitch);
    L.hip.rotation.z = d.J ? 0 : L.sx * ((L.front ? 0 : c.splay || 0) + c.abd[i]); // 벌림(abduction): 앉을 때 뒷다리, 누운 자세의 다리
    if (L.thigh) { const sp = clamp((c.splay || 0) / 0.3, 0, 1.2); L.hip.position.x = L.sx * (0.062 + 0.012 * sp) + L.fol.dx; const q = clamp((c.lumbar || 0) / 0.55, 0, 1); L.thigh.scale.set(1 + 0.3 * sp * (0.35 + 0.65 * q), 1 + 0.08 * sp, 1 + sp * (0.18 * q - 0.14 * (1 - q))); } // q: 앉기(골반이 말림)일 때만 엉덩이 살이 크게 퍼진다 — 엎드리면 허벅지가 등선 위로 솟지 않게 오히려 납작해진다 // 앉으면 허벅지·엉덩이 살이 옆으로 퍼져 가슴보다 넓은 둥근 엉덩이가 된다 (서면 원래 폭) // 앉을 때 뒷다리(허벅지째)를 바깥으로 벌려 엉덩이가 바닥에서 넓어진다
  }

  // 귀 (중력 따라 덜렁)
  const hwP = c.pitch + d.hp.rotation.x, hwR = c.roll + d.hp.rotation.z;
  for (const e of d.ears) {
    if (d.J) { e.g.rotation.x = -d.earPerk * 0.2; continue; }
    const tx = -hwP * 0.7 + d.gait * Math.sin(d.phase * 2) * 0.12 - d.earPerk * 0.3;
    const tz = e.side * (-0.06 + d.earPerk * 0.3) - hwR * 0.6; // 쉴 때는 귓볼이 볼에 기대어 살짝 안으로 오므라든다
    e.vx += (tx - e.ax) * 120 * dt; e.vx *= Math.exp(-8 * dt); e.ax += e.vx * dt;
    e.vz += (tz - e.az) * 120 * dt; e.vz *= Math.exp(-8 * dt); e.az += e.vz * dt;
    const upE = Math.max(0, e.side * Math.sin(hwR)); // 옆으로 누우면 위쪽 귀가 볼 위로 처지고, 머리를 숙이면(먹기) 귀가 앞으로 늘어진다 (흔들림 한계만 넓힌다)
    e.ax = clamp(e.ax, -0.25 - 0.3 * clamp(hwP - 0.5, 0, 1), 0.35); e.az = clamp(e.az, -0.1 - (e.side > 0 ? 0.3 * upE : 0), 0.1 + (e.side < 0 ? 0.3 * upE : 0)); // 귓볼이 볼에서 들뜨지 않게
    e.g.rotation.set(e.ax, 0, e.az);
  }

  // 꼬리
  const wk = 1 - Math.exp(-4 * dt);
  d.wagAmp += (d.wagAmpT - d.wagAmp) * wk; d.wagSpeed += (d.wagSpeedT - d.wagSpeed) * wk;
  d.wagPhase += dt * d.wagSpeed;
  d.tail.rotation.set(c.tail - (d.J ? 0 : c.lumbar || 0), 0, Math.sin(d.wagPhase) * d.wagAmp * (d.J ? 0.35 : 1) + (d.J ? 0 : Math.cos(d.phase) * 0.12 * d.gait - (c.tailCurl || 0) * 0.3)); // 걸을 때 꼬리는 골반과 반대로 흔들린다

  if (d.tailMesh) curlTail(d, c.tailCurl || 0);

  // 눈 깜빡
  d.blinkT -= dt;
  if (d.blinkT <= 0) { d.blinkT = 3 + Math.random() * 5; d.blinkDur = 0.12; }
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

  // 핑키 방석 (도넛방석 · 핑키의 애착 공간): 보송보송한 긴 털 인조 모피. 모양은 cushSDF, 털은 여러 겹의 셸
  {
    const ch = LITE ? 0.018 : 0.014, cg = sdfGeo('cush', cushSDF, [-0.52, -ch, -0.52], [0.52, 0.27, 0.52], ch); // 폰에서는 성기게(털 겹 수도 적게)
    const pos = cg.attributes.position, nor = cg.attributes.normal, col = new Float32Array(pos.count * 3), furA = new Float32Array(pos.count);
    const cCream = new THREE.Color(0xf4ebdb), cDeep = new THREE.Color(0xc8b193), cPress = new THREE.Color(0xe2d3bb), cBase = new THREE.Color(0xb7a48a), cc = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), r = Math.hypot(x, z), up = nor.getY(i);
      const inWell = ss(CUSH.R, CUSH.R - 0.07, r), dent = cushDent(x, z) * inWell, chin = cushChin(x, z) * ss(0.06, 0.12, y) * ss(0.2, 0.3, r);
      let ao = lerp(1, 0.62 + 0.38 * ss(0.035, 0.13, y), inWell); // 테두리와 베개 사이 골·우물 안쪽은 어둡게
      ao *= 0.72 + 0.28 * ss(0.0, 0.07, y) + 0.0 * up; // 바닥 가까이
      const tou = 0.5 + 0.5 * Math.sin(x * 31 + z * 17 + y * 23) * Math.sin(z * 29 - x * 13 + 1.7); // 털이 뭉친 얼룩
      cc.copy(cDeep).lerp(cCream, clamp(ao * (0.86 + 0.14 * tou), 0, 1)).lerp(cPress, 0.45 * Math.max(dent, chin));
      const hem = ss(0.022, 0.008, y); cc.lerp(cBase, hem); // 바닥 천(미끄럼 방지)과 꿰맨 단
      col[i * 3] = cc.r; col[i * 3 + 1] = cc.g; col[i * 3 + 2] = cc.b;
      furA[i] = (0.25 + 0.75 * ss(0.03, 0.075, y)) * ss(0.006, 0.03, y) * (1 - 0.55 * dent) * (1 - 0.5 * chin) * (0.8 + 0.2 * tou); // 털 길이: 바닥 단은 짧고, 늘 눕는 자리와 턱 자리는 눌려 있다
    }
    cg.setAttribute('color', new THREE.BufferAttribute(col, 3)); cg.setAttribute('aFur', new THREE.BufferAttribute(furA, 1));
    const cush = add(S, cg, new THREE.MeshStandardMaterial({ vertexColors: true, color: 0xe2d8c8, roughness: 1, emissive: 0x2a1d12 }), [CUSH.x, 0, CUSH.z]); // 그늘진 쪽도 따뜻한 크림빛이 남게 살짝 스스로 밝다
    plushShells(cush, LITE ? 6 : 9, 0.024, 380);
    // 꿰맨 단: 바닥 천과 털 사이를 도는 가는 파이핑
    const pipe = [];
    for (let i = 0; i < 72; i++) { const a = (i / 72) * Math.PI * 2, dx = Math.sin(a), dz = Math.cos(a); let r = 0.3; while (r < 0.56 && cushSDF(dx * r, 0.016, dz * r) < 0) r += 0.002; pipe.push(V3(dx * (r + 0.001), 0.016, dz * (r + 0.001))); }
    add(cush, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pipe, true), 144, 0.0045, 6, true), M(0xc9b89e, { roughness: 0.95 }), null, null, null, false);
    // 바닥에 닿는 그늘
    const sh = new THREE.Mesh(new THREE.CircleGeometry(0.64, 40), new THREE.MeshBasicMaterial({
      map: canvasTex(128, 128, (x, w) => { const g = x.createRadialGradient(w / 2, w / 2, w * 0.3, w / 2, w / 2, w / 2); g.addColorStop(0, 'rgba(38,22,10,.7)'); g.addColorStop(0.4, 'rgba(38,22,10,.62)'); g.addColorStop(0.62, 'rgba(38,22,10,.3)'); g.addColorStop(1, 'rgba(38,22,10,0)'); x.fillStyle = g; x.fillRect(0, 0, w, w); }),
      transparent: true, depthWrite: false }));
    sh.rotation.x = -Math.PI / 2; sh.position.set(CUSH.x, 0.007, CUSH.z); sh.renderOrder = 1; S.add(sh);
  }

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
  cushion: { x: CUSH.x + CUSH.px, z: CUSH.z + CUSH.pz, ex: CUSH.x - 0.2, ez: CUSH.z + 0.72 }, // 방석 한가운데 · (ex, ez) 올라가기 전에 서는 방석 앞
  gifts: { x: 1.45, z: -0.75, fx: 1.75, fz: -1.15 },
  window: { x: -2.5, z: -0.6, fx: -3.6, fz: -0.6 },
  table: { x: -0.72, z: 0.15, fx: -1.3, fz: -0.3 },
};
const OBST = [
  { x: -1.02, z: -0.44, r: 0.07 }, { x: -1.92, z: -0.11, r: 0.07 }, { x: -1.18, z: -0.89, r: 0.07 }, { x: -2.08, z: -0.56, r: 0.07 },
  { x: -2.35, z: 0.35, r: 0.36 }, { x: -0.8, z: -1.4, r: 0.36 }, { x: -2.65, z: -1.35, r: 0.28 }, { x: 2.3, z: -1.75, r: 0.95 },
  { x: -2.85, z: -2.35, r: 0.3 },
];
const CUSH_OB = { x: CUSH.x, z: CUSH.z, r: 0.36, br: 0.4, h: 0.3 }; OBST.push(CUSH_OB); // 방석: 평소에는 돌아서 다니고, 방석에 갈 때(cushGo)나 그 위에 있을 때만 비켜 준다
let cushGo = false, onCush = false, wakeSpeed = 0;
const cushLift = (dist) => (dist < CUSH.R ? CUSH.lift + 0.065 * Math.exp(-(((dist - CUSH.R) / 0.1) ** 2)) : (CUSH.lift + 0.065) * ss(0.6, CUSH.R, dist)); // 방석 위에서 몸이 올라가는 높이: 테두리를 넘을 때 가장 높고 가운데 베개에서는 낮다
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
fitCurl(pinky);
roomUpd.push(() => {
  const dist = Math.hypot(pinky.x - CUSH.x, pinky.z - CUSH.z), inside = dist < 0.6;
  CUSH_OB.r = cushGo || dist < 0.5 ? -9 : 0.36;
  if (inside) pinky.liftT = cushLift(dist); else if (onCush) pinky.liftT = 0;
  onCush = inside;
  if (pinky.wakeT > 0) { if (pinky.walkSpeed > 0) { wakeSpeed = pinky.walkSpeed; pinky.walkSpeed = 0; } pinky.stuckT = 0; } // 일어서는 동안은 제자리에서 몸만 돌린다
  else if (wakeSpeed) { if (pinky.walkSpeed === 0) pinky.walkSpeed = wakeSpeed; wakeSpeed = 0; }
});
const contact = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({
  map: canvasTex(128, 128, (x, w) => { const g = x.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); g.addColorStop(0, 'rgba(40,24,12,.55)'); g.addColorStop(0.6, 'rgba(40,24,12,.22)'); g.addColorStop(1, 'rgba(40,24,12,0)'); x.fillStyle = g; x.fillRect(0, 0, w, w); }),
  transparent: true, depthWrite: false,
}));
contact.rotation.x = -Math.PI / 2; contact.renderOrder = 1; roomScene.add(contact);
roomUpd.push(() => {
  contact.position.set(pinky.x, 0.009, pinky.z);
  contact.rotation.z = -pinky.yaw;
  const lying = ['side', 'belly', 'down', 'curl'].includes(pinky.tgt.name), f = Math.max(0, 1 - pinky.lift * 3);
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
    for (const o of OBST) if (p.y < (o.h ?? 0.8)) {
      const dx = p.x - o.x, dz = p.z - o.z, l = Math.hypot(dx, dz);
      const or = o.br ?? o.r; // br: 공에게만 쓰는 반지름(방석은 핑키가 올라가 있어도 공은 튕겨 낸다)
      if (l < or && l > 1e-4) { const nx = dx / l, nz = dz / l, vn = ball.v.x * nx + ball.v.z * nz; if (vn < 0) { ball.v.x -= 1.6 * vn * nx; ball.v.z -= 1.6 * vn * nz; } p.x = o.x + nx * or; p.z = o.z + nz * or; }
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
// 로프 장난감 (세 가닥으로 꼰 면 로프 두 줄 · 손잡이 고리끼리 걸려 있다)
// 점 14개짜리 줄 두 개를 매 프레임 흔들어 보고(verlet) 그 위에 꼰 줄 모양을 다시 입힌다.
// 점 이름: 'A0'~'A13', 'B0'~'B13' 또는 'A.tip'(고리 끝) · 'A.knot'(고리 매듭) · 'A.s1'~'A.s6'(외줄) · 'A.bite'(통매듭 바로 위) · 'A.barrel'(통매듭 윗끝) · 'A.end'(통매듭 아랫끝)
// ================================================================
const ROPE_REST = { x: 0.16, z: -1.32, yaw: -0.95 }; // 두 고리가 걸린 곳 · 줄이 뻗는 방향(0 = +z, 시계 반대 방향이 +)
const rope = (() => {
  const K = 1.15; // 사진 비율은 그대로 두고 전체 크기만 조금 키웠다 (멀리서도 보이게)
  const R = 0.0055 * K, SEG = 0.0207 * K, LOOP = 0.095 * K, BAR = 0.062 * K, BARR = 0.011 * K, TS = 0.024 * K, TAILR = 0.0074 * K, EXT = 0.012 * K, LAY = 0.022 * K;
  const NP = 14, N = NP * 2, H = 1 / 120, ITER = LITE ? 4 : 6, RING = (LITE ? 0.008 : 0.0035) * K, RAD = LITE ? 9 : 12, TAU = Math.PI * 2;
  const LOOK = [
    { ply: ['#EE3C78', '#FFE03A', '#B4EE3C'], tuft: [['#FFBE2A', 0.6], ['#FFE052', 0.4]], tass: [['#FFC62E', 0.5], ['#EE3C78', 0.3], ['#B4EE3C', 0.2]] },
    { ply: ['#1E9ACB', '#EE3C78', '#B4EE40'], tuft: [['#D83E78', 0.6], ['#EE6B98', 0.4]], tass: [['#2AA7D6', 0.45], ['#EE3C78', 0.3], ['#B4EE40', 0.25]] },
  ];
  // 꼰 줄 무늬: 가닥 색 세 줄, 가닥 사이 골은 어둡게, 가는 실 결
  const plyTex = (cols) => canvasTex(192, 64, (x, w, h) => {
    for (let i = 0; i < w; i++) {
      const q = ((i + 0.5) / w + 1 / 6) * 3, f = Math.abs((q % 1) - 0.5) * 2;
      x.fillStyle = cols[Math.floor(q) % 3]; x.fillRect(i, 0, 1, h);
      x.fillStyle = `rgba(40,10,20,${0.36 * Math.pow(f, 2.6)})`; x.fillRect(i, 0, 1, h);
      x.fillStyle = `rgba(255,255,255,${0.1 * Math.pow(1 - f, 2)})`; x.fillRect(i, 0, 1, h);
    }
    const rnd = rng(11); x.lineWidth = 1;
    for (let i = 0; i < 110; i++) {
      const px = rnd() * w, py = rnd() * h, l = 5 + rnd() * 9;
      x.strokeStyle = rnd() < 0.5 ? 'rgba(255,255,255,.13)' : 'rgba(30,10,10,.1)';
      for (const oy of [0, -h, h]) { x.beginPath(); x.moveTo(px, py + oy); x.lineTo(px - l * 0.9, py + oy + l); x.stroke(); }
    }
  }, [1, 1]);

  // ── 줄 모양 입히기: 중심선(C)을 따라 세 가닥 단면을 돌려 가며 두른다 ──
  function makeTube(defs, dyn) { // defs: [{ n 고리 수, r 굵기, lay 한 바퀴 꼬이는 길이, tre 가닥 골 깊이, len 길이, s0, taper(u) }]
    let rings = 0; for (const d of defs) { d.off = rings; rings += d.n; d.C = new Float32Array(d.n * 3); d.n0 = V3(0, 1, 0); }
    const nr = RAD + 1, pos = new Float32Array(rings * nr * 3), nor = new Float32Array(rings * nr * 3), uv = new Float32Array(rings * nr * 2), idx = [];
    for (const d of defs) for (let k = 0; k < d.n; k++) {
      const s = (d.len * k) / (d.n - 1) + (d.s0 || 0);
      for (let j = 0; j < nr; j++) { const o = ((d.off + k) * nr + j) * 2; uv[o] = j / RAD - s / d.lay; uv[o + 1] = s / (0.022 * K); }
      if (k < d.n - 1) for (let j = 0; j < RAD; j++) { const a = (d.off + k) * nr + j, b = a + nr; idx.push(a, a + 1, b, a + 1, b + 1, b); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setIndex(idx);
    if (dyn) { geo.attributes.position.setUsage(THREE.DynamicDrawUsage); geo.attributes.normal.setUsage(THREE.DynamicDrawUsage); }
    const skin = () => {
      for (const d of defs) {
        const C = d.C, n = d.n; let nx = d.n0.x, ny = d.n0.y, nz = d.n0.z;
        for (let k = 0; k < n; k++) {
          const a = Math.max(k - 1, 0) * 3, b = Math.min(k + 1, n - 1) * 3;
          let tx = C[b] - C[a], ty = C[b + 1] - C[a + 1], tz = C[b + 2] - C[a + 2]; const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
          const dn = nx * tx + ny * ty + nz * tz; nx -= dn * tx; ny -= dn * ty; nz -= dn * tz; let nl = Math.hypot(nx, ny, nz);
          if (nl < 1e-4) { if (Math.abs(ty) < 0.9) { nx = -tx * ty; ny = 1 - ty * ty; nz = -tz * ty; } else { nx = 1 - tx * tx; ny = -ty * tx; nz = -tz * tx; } nl = Math.hypot(nx, ny, nz); }
          nx /= nl; ny /= nl; nz /= nl; if (k === 0) d.n0.set(nx, ny, nz);
          const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
          const u = k / (n - 1), s = d.len * u + (d.s0 || 0), ph = (TAU * s) / d.lay, r0 = d.r * (d.taper ? d.taper(u) : 1), cx = C[k * 3], cy = C[k * 3 + 1], cz = C[k * 3 + 2];
          for (let j = 0; j < nr; j++) {
            const th = (TAU * j) / RAD, c = Math.cos(th), sn = Math.sin(th), q = 1.5 * (th - ph), cq = Math.cos(q);
            const rr = r0 * (1 - d.tre + d.tre * Math.abs(cq)), dr = d.tre ? -r0 * d.tre * 1.5 * Math.sin(q) * Math.sign(cq) : 0;
            const rx = c * nx + sn * bx, ry = c * ny + sn * by, rz = c * nz + sn * bz, ux = -sn * nx + c * bx, uy = -sn * ny + c * by, uz = -sn * nz + c * bz;
            const o = ((d.off + k) * nr + j) * 3; pos[o] = cx + rx * rr; pos[o + 1] = cy + ry * rr; pos[o + 2] = cz + rz * rr;
            const mx = rx * rr - ux * dr, my = ry * rr - uy * dr, mz = rz * rr - uz * dr, ml = Math.hypot(mx, my, mz) || 1; nor[o] = mx / ml; nor[o + 1] = my / ml; nor[o + 2] = mz / ml;
          }
        }
      }
      geo.attributes.position.needsUpdate = true; geo.attributes.normal.needsUpdate = true;
    };
    return { geo, defs, skin };
  }
  const TRE = LITE ? 0 : 0.2;
  // 점 몇 개(flat [x,y,z,...])를 부드럽게 잇는 곡선으로 중심선을 채운다 (Catmull-Rom)
  function crFill(d, q, m) {
    const C = d.C, n = d.n;
    for (let k = 0; k < n; k++) {
      const g = (k / (n - 1)) * (m - 1), i = Math.min(Math.floor(g), m - 2), t = g - i, t2 = t * t, t3 = t2 * t;
      const i0 = Math.max(i - 1, 0) * 3, i1 = i * 3, i2 = (i + 1) * 3, i3 = Math.min(i + 2, m - 1) * 3;
      for (let c = 0; c < 3; c++) C[k * 3 + c] = 0.5 * (2 * q[i1 + c] + (q[i2 + c] - q[i0 + c]) * t + (2 * q[i0 + c] - 5 * q[i1 + c] + 4 * q[i2 + c] - q[i3 + c]) * t2 + (3 * q[i1 + c] - q[i0 + c] - 3 * q[i2 + c] + q[i3 + c]) * t3);
    }
  }
  // 손잡이 고리: 매듭에서 나가 끝을 돌아 다시 매듭으로 (x: 매듭에서 끝 쪽, y: 옆)
  const loopXY = (ph, L, Wd, out) => { const x = (L * (1 - Math.cos(ph))) / 2, s = Math.sin(ph); out[0] = x; out[1] = (Wd / 2) * Math.sign(s) * Math.pow(Math.abs(s), 0.62) * (0.5 + 0.5 * ss(0, 0.55, x / L)); };
  const NLOOP = Math.round((2.25 * (LOOP + EXT)) / RING), LOOP_LEN = 2.2 * (LOOP + EXT);
  const loopPh = (() => { // 고리를 따라 같은 간격이 되는 각도 표
    const M = 600, cum = [0], o = [0, 0]; let px = 0, py = 0;
    for (let i = 1; i <= M; i++) { loopXY((TAU * i) / M, LOOP + EXT, 0.026 * K, o); cum.push(cum[i - 1] + Math.hypot(o[0] - px, o[1] - py)); px = o[0]; py = o[1]; }
    const out = []; let j = 0;
    for (let k = 0; k < NLOOP; k++) { const want = (cum[M] * k) / (NLOOP - 1); while (j < M - 1 && cum[j + 1] < want) j++; out.push((TAU * (j + (want - cum[j]) / Math.max(cum[j + 1] - cum[j], 1e-9))) / M); }
    return out;
  })();
  const NSTR = Math.round((7 * SEG + 0.012) / RING) + 1, NTAIL = Math.max(5, Math.round((2 * TS) / RING) + 1);

  // ── 굳은 부분: 통매듭 · 고리 매듭 · 술 ──
  function barrelGeo() { // 줄을 여섯 바퀴 비스듬히 감은 통매듭 (y: 0 → BAR)
    const T = 5.6, len = T * TAU * BARR * 1.03, n = Math.round(len / RING / (LITE ? 1 : 1.25)), nc = 5;
    const t = makeTube([{ n, r: R * 1.04, lay: LAY, tre: TRE, len }, { n: nc, r: BARR * 0.98, lay: LAY, tre: 0, len: BAR * 0.8 }], false);
    for (let k = 0; k < n; k++) {
      const g = k / (n - 1), th = TAU * T * g, rad = BARR * (0.25 + 0.75 * ss(0, 0.05, g) * ss(1, 0.95, g));
      t.defs[0].C.set([Math.sin(th) * rad, BAR * (0.1 + 0.8 * g) + rad * 0.42 * Math.cos(th + 0.6), Math.cos(th) * rad], k * 3);
    }
    for (let k = 0; k < nc; k++) t.defs[1].C.set([0, BAR * (0.1 + (0.8 * k) / (nc - 1)), 0], k * 3);
    t.skin(); return t.geo;
  }
  function knotGeo() { // 고리를 묶은 외벌 매듭: 세잎 매듭 모양으로 한 번 감긴 줄 (y: 고리 면의 법선)
    const Rk = 0.0068 * K, rk = 0.0042 * K, n = LITE ? 22 : 44, t = makeTube([{ n, r: R * 1.12, lay: LAY, tre: TRE, len: 0.118 * K }], false);
    for (let k = 0; k < n; k++) { const ph = (TAU * k) / (n - 1), rr = Rk + rk * Math.cos(3 * ph); t.defs[0].C.set([rr * Math.cos(2 * ph), rk * 1.5 * Math.sin(3 * ph), rr * Math.sin(2 * ph)], k * 3); }
    t.skin(); return t.geo;
  }
  function fibreGeo(n, len, baseR, spread, mix, seed) { // 풀린 실 뭉치 (y 방향으로 퍼진다) · 가운데에 도톰한 속
    const rnd = rng(seed), pos = [], nor = [], col = [], idx = [], c = new THREE.Color(), SG = LITE ? 2 : 4;
    const pick = () => { let r = rnd(), i = 0; while (i < mix.length - 1 && r > mix[i][1]) { r -= mix[i][1]; i++; } return mix[i][0]; };
    const flare = baseR + len * Math.tan(spread * 0.55) * 0.75, cr = [[baseR * 1.05, 0], [lerp(baseR, flare, 0.5), len * 0.3], [flare * 0.85, len * 0.62], [flare * 0.5, len * 0.8], [0, len * 0.86]];
    c.set(mix[0][0]).multiplyScalar(0.95);
    cr.forEach(([rr, y], k) => { for (let j = 0; j < 7; j++) { const a = (TAU * j) / 7, w = 1 + 0.18 * Math.sin(j * 2.3 + k); pos.push(Math.cos(a) * rr * w, y, Math.sin(a) * rr * w); nor.push(Math.cos(a) * 0.9, 0.44, Math.sin(a) * 0.9); col.push(c.r, c.g, c.b); if (k < cr.length - 1) { const p = k * 7 + j, q = k * 7 + ((j + 1) % 7); idx.push(p, p + 7, q, q, p + 7, q + 7); } } });
    for (let f = 0; f < n; f++) {
      const az = rnd() * TAU, rad = Math.sqrt(rnd()), al = spread * (0.2 + 0.8 * rad), L = len * (0.7 + 0.45 * rnd()), th = 0.0012 * K * (0.8 + 0.7 * rnd()), curl = (rnd() - 0.3) * 0.7;
      c.set(pick()).multiplyScalar(0.95 + 0.3 * rnd());
      let x = Math.cos(az) * baseR * rad, y = 0, z = Math.sin(az) * baseR * rad; const v0 = pos.length / 3;
      for (let s = 0; s <= SG; s++) {
        const w = th * (1 - (0.45 * s) / SG);
        for (let j = 0; j < 3; j++) { const q = az + j * 2.094, ox = Math.cos(q), oz = Math.sin(q), mx = Math.cos(az) * 0.55 + ox * 0.45, mz = Math.sin(az) * 0.55 + oz * 0.45, ml = Math.hypot(mx, 0.35, mz); pos.push(x + ox * w, y, z + oz * w); nor.push(mx / ml, 0.35 / ml, mz / ml); col.push(c.r, c.g, c.b); }
        if (s < SG) {
          const a = al * (0.35 + (0.65 * (s + 1)) / SG) + (curl * (s + 1)) / SG + (rnd() - 0.5) * 0.5, dl = L / SG; x += Math.sin(a) * Math.cos(az) * dl; y += Math.cos(a) * dl; z += Math.sin(a) * Math.sin(az) * dl;
          for (let j = 0; j < 3; j++) { const p = v0 + s * 3 + j, q = v0 + s * 3 + ((j + 1) % 3); idx.push(p, p + 3, q, q, p + 3, q + 3); }
        }
      }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); return g;
  }

  // ── 점 · 묶음 ──
  const P = new Float32Array(N * 3), Q = new Float32Array(N * 3), fr = new Float32Array(N), crad = new Float32Array(N), wgt = new Float32Array(N), cons = [], pairs = [];
  const eq = (i, j, d) => cons.push([i, j, d, 1, 0]), mn = (i, j, d, k) => cons.push([i, j, d, k, 1]);
  for (let r = 0; r < 2; r++) {
    const o = r * NP;
    eq(o, o + 1, LOOP); for (let i = 1; i < 8; i++) eq(o + i, o + i + 1, SEG); eq(o + 8, o + 9, BAR);
    eq(o + 9, o + 10, TS); eq(o + 10, o + 11, TS); eq(o + 9, o + 12, TS); eq(o + 12, o + 13, TS);
    mn(o, o + 2, (LOOP + SEG) * 0.6, 0.06); for (let i = 1; i < 7; i++) mn(o + i, o + i + 2, SEG * 1.5, 0.3);
    mn(o + 7, o + 9, (SEG + BAR) * 0.93, 0.5); mn(o + 8, o + 10, (BAR + TS) * 0.93, 0.4); mn(o + 8, o + 12, (BAR + TS) * 0.93, 0.4);
    mn(o + 9, o + 11, TS * 1.6, 0.3); mn(o + 9, o + 13, TS * 1.6, 0.3); mn(o + 10, o + 12, 0.013 * K, 0.5); mn(o + 11, o + 13, 0.024 * K, 0.3);
    for (let i = 0; i < NP; i++) { crad[o + i] = i === 1 ? 0.012 * K : i === 8 || i === 9 ? BARR + R * 0.7 : i > 9 ? TAILR : R; fr[o + i] = 0.006 + (i === 1 ? 0.0095 * K : i === 8 || i === 9 ? BARR + R : i > 9 ? TAILR : R); wgt[o + i] = i === 8 || i === 9 ? 0.4 : i === 1 ? 0.6 : 1; }
  }
  fr[NP] += R * 1.6; // B의 고리 끝은 A의 고리 위에 얹힌다
  cons.push([0, NP, 0.004 * K, 1, 2]); // 고리끼리 걸린 곳
  { const near = new Set(cons.map((c) => c[0] * 100 + c[1])); for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) if (i % NP && j % NP && !near.has(i * 100 + j)) pairs.push([i, j, crad[i] + crad[j]]); }
  const NAMES = { tip: 0, knot: 1, s1: 2, s2: 3, s3: 4, s4: 5, s5: 6, s6: 7, mid: 5, bite: 7, barrel: 8, end: 9 };
  const idx = (key) => {
    if (typeof key === 'number') return key;
    const o = key[0] === 'B' ? NP : 0, rest = key.slice(key[1] === '.' ? 2 : 1), i = rest in NAMES ? NAMES[rest] : +rest;
    if (!(i >= 0 && i < NP)) throw new Error('rope: 모르는 점 ' + key); return o + i;
  };
  const pins = new Map(); // 점 번호 → { fn, cur, prev, from, t }
  const S = { asleep: true, still: 0, acc: 0, tension: 0 };

  // ── 그리는 것 ──
  const g = new THREE.Group(); g.name = 'rope'; roomScene.add(g);
  const fibMat = M(0xffffff, { vertexColors: true, roughness: 1, side: THREE.DoubleSide }), Y = V3(0, 1, 0), bGeo = barrelGeo(), kGeo = knotGeo();
  const vis = LOOK.map((look, r) => {
    const tex = plyTex(look.ply), mat = M(0xffffff, { map: tex, roughness: 1, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.2 }); // 어둑한 방에서도 장난감 색이 살게 살짝 밝힌다
    const tube = makeTube([
      { n: NLOOP, r: R, lay: LAY, tre: TRE, len: LOOP_LEN },
      { n: NSTR, r: R, lay: LAY, tre: TRE, len: 7 * SEG + 0.012, s0: 0.004 },
      { n: NTAIL, r: TAILR, lay: LAY * 2.6, tre: TRE * 0.8, len: 2 * TS, taper: (u) => 0.92 + 0.2 * u },
      { n: NTAIL, r: TAILR, lay: LAY * 2.6, tre: TRE * 0.8, len: 2 * TS, s0: 0.02, taper: (u) => 0.92 + 0.2 * u },
    ], true);
    const mk = (geo, m, cast = !LITE) => { const x = new THREE.Mesh(geo, m); x.castShadow = cast; x.receiveShadow = true; x.frustumCulled = false; g.add(x); return x; };
    const mesh = mk(tube.geo, mat), barrel = mk(bGeo, mat), knot = mk(kGeo, mat);
    const tuft = new THREE.Mesh(fibreGeo(LITE ? 16 : 64, 0.02 * K, 0.005 * K, 0.8, look.tuft, 31 + r), fibMat); tuft.frustumCulled = false; knot.add(tuft);
    tuft.position.set((r ? 1 : -1) * 0.007 * K, 0.002, -0.004 * K); tuft.quaternion.setFromUnitVectors(Y, V3(r ? 1 : -1, 0.12, -0.45).normalize());
    const tass = [0, 1].map((i) => mk(fibreGeo(LITE ? 18 : 72, 0.03 * K, TAILR * 1.05, 0.55, look.tass, 51 + r * 2 + i), fibMat, false));
    return { tube, mesh, barrel, knot, tass, ln: V3(0, 1, 0), td: [V3(0, 0, 1), V3(0, 0, 1)], bq: new THREE.Quaternion() };
  });
  const _a = V3(), _b = V3(), _c = V3(), _d = V3(), _e = V3(), _q = new THREE.Quaternion(), _mm = new THREE.Matrix4(), flat = new Float32Array(30), o2 = [0, 0];
  const gp = (i, v) => v.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
  const putF = (k, v) => { flat[k * 3] = v.x; flat[k * 3 + 1] = v.y; flat[k * 3 + 2] = v.z; };
  function skin(dt = 0.016, snap = false) {
    const ten = clamp((gp(1, _a).distanceTo(gp(NP + 1, _b)) - 1.72 * LOOP) / (0.26 * LOOP), 0, 1), kk = snap ? 1 : 1 - Math.exp(-10 * dt);
    S.tension += (ten - S.tension) * kk;
    const Wd = lerp(0.03, 0.015, S.tension) * K;
    for (let r = 0; r < 2; r++) {
      const o = r * NP, v = vis[r], D = v.tube.defs;
      // 고리
      gp(o + 1, _a); gp(o, _b); _c.subVectors(_b, _a); const L = _c.length() || 1e-6; _c.multiplyScalar(1 / L); // _c: 고리 축
      _d.copy(Y).addScaledVector(_c, -_c.y); // 눕힌 면의 법선
      if (_d.lengthSq() < 0.03) _d.copy(v.ln).addScaledVector(_c, -v.ln.dot(_c)); if (_d.lengthSq() < 1e-6) _d.set(1, 0, 0); _d.normalize();
      if (r) { _e.crossVectors(_c, _d); const a = (S.tension * Math.PI) / 2; _d.multiplyScalar(Math.cos(a)).addScaledVector(_e, Math.sin(a)); } // 당기면 B의 고리는 A의 고리와 엇갈려 선다
      v.ln.lerp(_d, kk).addScaledVector(_c, -v.ln.dot(_c)); if (v.ln.lengthSq() < 1e-6) v.ln.copy(_d); v.ln.normalize();
      _e.crossVectors(v.ln, _c); // 고리의 옆 방향
      const C = D[0].C, Lt = L + EXT;
      for (let k = 0; k < NLOOP; k++) { loopXY(loopPh[k], Lt, Wd, o2); C[k * 3] = _a.x + _c.x * o2[0] + _e.x * o2[1]; C[k * 3 + 1] = _a.y + _c.y * o2[0] + _e.y * o2[1]; C[k * 3 + 2] = _a.z + _c.z * o2[0] + _e.z * o2[1]; }
      D[0].n0.copy(v.ln);
      _mm.makeBasis(_b.crossVectors(v.ln, _c), v.ln, _c); v.knot.quaternion.setFromRotationMatrix(_mm); v.knot.position.copy(_a);
      // 외줄 (끝은 통매듭 속으로)
      for (let i = 1; i <= 8; i++) putF(i - 1, gp(o + i, _a));
      gp(o + 8, _a); gp(o + 9, _b); _c.subVectors(_b, _a).normalize(); putF(8, _d.copy(_a).addScaledVector(_c, 0.012)); crFill(D[1], flat, 9);
      // 통매듭
      _d.copy(Y).applyQuaternion(v.bq); _q.setFromUnitVectors(_d, _c); v.bq.premultiply(_q).normalize(); v.barrel.quaternion.copy(v.bq); v.barrel.position.copy(_a);
      // 꼬리 둘 + 술
      gp(o + 10, _d); gp(o + 12, _e); _e.sub(_d).addScaledVector(_c, -_e.dot(_c)); if (_e.lengthSq() < 1e-8) _e.set(1, 0, 0); _e.normalize(); // 꼬리끼리 벌어지는 방향
      for (let i = 0; i < 2; i++) {
        const ia = o + 10 + i * 2, td = v.td[i];
        putF(0, _a.copy(_b).addScaledVector(_c, -0.008 * K).addScaledVector(_e, (i ? 1 : -1) * 0.0045 * K)); putF(1, gp(ia, _a)); putF(2, gp(ia + 1, _d)); crFill(D[2 + i], flat, 3);
        _a.subVectors(_d, _a); if (_a.lengthSq() < 1e-10) _a.copy(_c); _a.normalize(); td.lerp(_a, snap ? 1 : 1 - Math.exp(-dt / 0.1)).normalize();
        v.tass[i].position.copy(_d).addScaledVector(td, -0.005 * K); v.tass[i].quaternion.setFromUnitVectors(Y, td);
      }
      v.tube.skin();
    }
  }

  // ── 움직임 ──
  function sub(h, f) {
    for (let i = 0; i < N; i++) if (!pins.has(i)) { const a = i * 3; for (let c = 0; c < 3; c++) { const v = (P[a + c] - Q[a + c]) * 0.985; Q[a + c] = P[a + c]; P[a + c] += v; } P[a + 1] -= 9.8 * h * h; }
    for (let it = 0; it < ITER; it++) {
      for (const [i, p] of pins) { const a = i * 3; P[a] = lerp(p.prev.x, p.cur.x, f); P[a + 1] = lerp(p.prev.y, p.cur.y, f); P[a + 2] = lerp(p.prev.z, p.cur.z, f); }
      for (let n = 0; n < cons.length + pairs.length; n++) {
        const c = n < cons.length ? cons[n] : pairs[n - cons.length], i = c[0], j = c[1], a = i * 3, b = j * 3, mode = n < cons.length ? c[4] : 1, st = n < cons.length ? c[3] : 0.5;
        const dx = P[b] - P[a], dy = P[b + 1] - P[a + 1], dz = P[b + 2] - P[a + 2], d2 = dx * dx + dy * dy + dz * dz;
        if (mode === 1 ? d2 >= c[2] * c[2] : mode === 2 && d2 <= c[2] * c[2]) continue;
        const wi = pins.has(i) ? 0 : wgt[i], wj = pins.has(j) ? 0 : wgt[j], ws = wi + wj; if (!ws) continue;
        const d = Math.sqrt(d2) || 1e-6, k = ((d - c[2]) / d) * st / ws;
        P[a] += dx * k * wi; P[a + 1] += dy * k * wi; P[a + 2] += dz * k * wi; P[b] -= dx * k * wj; P[b + 1] -= dy * k * wj; P[b + 2] -= dz * k * wj;
      }
      for (let i = 0; i < N; i++) { const a = i * 3; if (P[a + 1] < fr[i]) P[a + 1] = fr[i]; P[a] = clamp(P[a], -3.0, 2.45); P[a + 2] = clamp(P[a + 2], -2.3, 2.7); }
    }
    let vmax = 0;
    for (let i = 0; i < N; i++) {
      const a = i * 3;
      if (pins.has(i)) { Q[a] = P[a]; Q[a + 1] = P[a + 1]; Q[a + 2] = P[a + 2]; continue; }
      if (P[a + 1] <= fr[i] + 1e-5) { Q[a] = P[a] - (P[a] - Q[a]) * 0.55; Q[a + 2] = P[a + 2] - (P[a + 2] - Q[a + 2]) * 0.55; if (Q[a + 1] > P[a + 1]) Q[a + 1] = P[a + 1]; } // 면 줄은 마루에서 미끄러지지 않고 끌린다
      vmax = Math.max(vmax, Math.hypot(P[a] - Q[a], P[a + 1] - Q[a + 1], P[a + 2] - Q[a + 2]) / h);
    }
    return vmax;
  }
  function step(dt) {
    if (dt > 0.1 || (S.asleep && !pins.size)) return;
    S.asleep = false;
    for (const p of pins.values()) { p.prev.copy(p.cur); p.t = Math.min(1, p.t + dt / 0.12); p.cur.copy(p.from).lerp(p.fn(), ease(p.t)); }
    S.acc += dt; const n = Math.min(4, Math.floor(S.acc / H)); S.acc -= n * H; if (S.acc > H) S.acc = 0;
    let vmax = 0; for (let i = 0; i < n; i++) vmax = Math.max(vmax, sub(H, (i + 1) / n));
    skin(dt);
    if (!pins.size && n && vmax < 0.03) { S.still += dt; if (S.still > 1) S.asleep = true; } else if (n) S.still = 0;
  }
  function wake() { S.asleep = false; S.still = 0; }
  function place(x = ROPE_REST.x, z = ROPE_REST.z, yaw = ROPE_REST.yaw) { // 바닥에 사진처럼 느슨한 V자로 내려놓는다 ((x, z): 두 고리가 걸린 곳)
    pins.clear();
    for (let r = 0; r < 2; r++) {
      const o = r * NP, bend = r ? -1.3 : -0.7; let hd = yaw + (r ? 0.17 : -0.17), px = x + (r ? 0.003 : 0), pz = z, i = 0;
      const put = (k, qx, qz) => { P[k * 3] = qx; P[k * 3 + 1] = fr[k]; P[k * 3 + 2] = qz; };
      const go = (d) => { px += Math.sin(hd) * d; pz += Math.cos(hd) * d; hd += bend * d; };
      put(o, px, pz); go(LOOP); put(o + 1, px, pz); for (i = 2; i <= 8; i++) { go(SEG); put(o + i, px, pz); } go(BAR); put(o + 9, px, pz);
      for (const [k, s] of [[10, -1], [12, 1]]) { const h2 = hd + s * 0.3; put(o + k, px + Math.sin(h2) * TS, pz + Math.cos(h2) * TS); put(o + k + 1, px + Math.sin(h2) * TS + Math.sin(h2 + s * 0.25) * TS, pz + Math.cos(h2) * TS + Math.cos(h2 + s * 0.25) * TS); }
    }
    Q.set(P); for (const v of vis) { v.ln.set(0, 1, 0); v.bq.identity(); } S.tension = 0;
    for (let i = 0; i < 90; i++) sub(H, 1);
    Q.set(P); skin(0.016, true); S.asleep = true; S.still = 0; S.acc = 0;
  }
  // 두 점 사이를 줄을 따라 잰 길이 (당기기 놀이에서 손과 입 사이 거리)
  function span(k1, k2) {
    const a = idx(k1), b = idx(k2), dist = new Array(N).fill(Infinity); dist[a] = 0;
    for (let it = 0; it < N; it++) for (const c of cons) if (c[4] !== 1) { if (dist[c[0]] + c[2] < dist[c[1]]) dist[c[1]] = dist[c[0]] + c[2]; if (dist[c[1]] + c[2] < dist[c[0]]) dist[c[0]] = dist[c[1]] + c[2]; }
    return dist[b];
  }
  const api = {
    g, K, R, NP, N, state: S, idx,
    pin(key, fn, soft = true) { const i = idx(key), now = gp(i, V3()); pins.set(i, { fn, from: now, cur: now.clone(), prev: now.clone(), t: soft ? 0 : 1 }); wake(); }, // fn(): 월드 좌표 V3 · soft: 0.12초에 걸쳐 끌려간다(뚝 튀지 않게)
    pinTo(key, obj, local, soft = true) { const l = local.clone(); api.pin(key, () => { obj.updateWorldMatrix(true, false); return _pin.copy(l).applyMatrix4(obj.matrixWorld); }, soft); }, // obj의 로컬 좌표 local에 묶는다 (손 · 턱)
    unpin(key) { if (!pins.size) return; if (key == null) pins.clear(); else pins.delete(idx(key)); wake(); }, // 놓는다 (key 없이 부르면 전부) · 줄은 그 자리에 떨어져 남는다
    pinned: (key) => (key == null ? pins.size > 0 : pins.has(idx(key))),
    pos: (key, out = V3()) => gp(idx(key), out),
    center: (out = V3()) => { out.set(0, 0, 0); for (let i = 0; i < N; i++) { out.x += P[i * 3] / N; out.y += P[i * 3 + 1] / N; out.z += P[i * 3 + 2] / N; } return out; },
    span, taut: (k1, k2) => gp(idx(k1), _a).distanceTo(gp(idx(k2), _b)) / span(k1, k2), // 1에 가까우면 팽팽
    kick(v, key) { const a = key == null ? 0 : idx(key), b = key == null ? N : a + 1; for (let i = a; i < b; i++) { Q[i * 3] -= v.x * H; Q[i * 3 + 1] -= v.y * H; Q[i * 3 + 2] -= v.z * H; } wake(); }, // 속도를 더한다 (m/s)
    move(dx, dy, dz) { for (let i = 0; i < N; i++) { P[i * 3] += dx; P[i * 3 + 1] += dy; P[i * 3 + 2] += dz; Q[i * 3] += dx; Q[i * 3 + 1] += dy; Q[i * 3 + 2] += dz; } wake(); },
    place, reset: () => place(), wake, step, skin,
  };
  const _pin = V3();
  place();
  return api;
})();
function stepRope(dt) { rope.step(dt); }

// ================================================================
// 간식: 요거트 · 고구마 말랑이
// ================================================================
// 강아지 요거트 컵 (원점: 컵 바닥 가운데 · +y: 입구 · +z: 뚜껑 손잡이 쪽, 뚜껑은 -z 쪽 테두리에 붙은 채 젖혀진다)
function buildYogurt() {
  const g = new THREE.Group(), Hc = 0.042, wallR = (y) => lerp(0.0212, 0.0288, clamp((y - 0.003) / 0.037, 0, 1)), v2 = (a, b) => new THREE.Vector2(a, b);
  const cup = add(g, new THREE.LatheGeometry([[0, 0], [0.0205, 0], [0.022, 0.0015], [0.0298, 0.0405], [0.0312, 0.0408], [0.0317, 0.0416], [0.031, 0.0424], [0.0294, 0.042], [0.0288, 0.04], [0.0212, 0.003], [0, 0.003]].map(([a, b]) => v2(a, b)), 32), M(0xf7f3ea, { roughness: 0.45, side: THREE.DoubleSide, emissive: 0x2e2a24 }));
  const labelTex = canvasTex(512, 96, (x, w, h) => {
    x.fillStyle = '#BFDDEB'; x.fillRect(0, 0, w, h); x.fillStyle = 'rgba(255,255,255,.75)'; x.fillRect(0, 7, w, 3); x.fillRect(0, h - 10, w, 3);
    x.fillStyle = '#ffffff';
    for (const cx of [w * 0.25, w * 0.75]) { // 작은 흰 발바닥 무늬 (글자 · 상표 없음)
      x.beginPath(); x.ellipse(cx, h * 0.6, 15, 12, 0, 0, 7); x.fill();
      for (const [dx, dy] of [[-17, -15], [-6, -24], [6, -24], [17, -15]]) { x.beginPath(); x.ellipse(cx + dx, h * 0.6 + dy, 5.5, 7, dx * 0.02, 0, 7); x.fill(); }
    }
  });
  add(g, new THREE.LatheGeometry([[0.0238, 0.0085], [0.0289, 0.0335]].map(([a, b]) => v2(a + 0.0004, b)), 32), M(0xffffff, { map: labelTex, roughness: 0.6, side: THREE.DoubleSide, emissive: 0xffffff, emissiveMap: labelTex, emissiveIntensity: 0.18 }), null, null, null, false);
  // 안쪽 벽에 묻은 요거트 (줄어들수록 드러난다)
  const smearTex = canvasTex(128, 64, (x, w, h) => {
    const rnd = rng(5); x.clearRect(0, 0, w, h);
    for (let i = 0; i < w; i += 2) { const top = h * (0.05 + 0.5 * rnd() * rnd()); const gr = x.createLinearGradient(0, top, 0, h); gr.addColorStop(0, 'rgba(255,253,246,0)'); gr.addColorStop(0.35, 'rgba(255,253,246,.75)'); gr.addColorStop(1, 'rgba(255,253,246,.95)'); x.fillStyle = gr; x.fillRect(i, top, 2, h - top); }
  });
  const smear = add(g, new THREE.LatheGeometry([[wallR(0.004) - 0.0004, 0.004], [wallR(0.037) - 0.0004, 0.037]].map(([a, b]) => v2(a, b)), 32), M(0xffffff, { map: smearTex, transparent: true, roughness: 0.3, side: THREE.DoubleSide, depthWrite: false }), null, null, null, false);
  // 요거트 (살짝 봉긋하고 핥은 자국이 패인 면)
  const yg = (() => {
    const NRG = 7, pos = [], idx = [];
    pos.push(0, 0.9, 0);
    for (let r = 1; r <= NRG; r++) for (let j = 0; j < 40; j++) { const q = r / NRG, a = (j / 40) * Math.PI * 2, x = Math.sin(a) * q, z = Math.cos(a) * q; pos.push(x, (1 - q * q) * 0.9 + 0.5 * Math.sin(a * 2 + q * 5) * q * (1 - q) - 1.1 * Math.exp(-((x - 0.2) ** 2 + (z - 0.3) ** 2) / 0.07) * (1 - q * q), z); }
    for (let j = 0; j < 40; j++) idx.push(0, 1 + j, 1 + ((j + 1) % 40));
    for (let r = 0; r < NRG - 1; r++) for (let j = 0; j < 40; j++) { const a = 1 + r * 40 + j, b = 1 + r * 40 + ((j + 1) % 40); idx.push(a, a + 40, b, b, a + 40, b + 40); }
    const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); gg.setIndex(idx); gg.computeVertexNormals(); return gg;
  })();
  const surf = add(g, yg, new THREE.MeshPhysicalMaterial({ color: 0xfffdf6, roughness: 0.25, clearcoat: 0.4, clearcoatRoughness: 0.3, side: THREE.DoubleSide }), null, null, null, false);
  // 은박 뚜껑
  const RL = 0.0318, NRr = 8, NSg = 32, lp = new Float32Array((1 + NRr * NSg) * 3), rest = [[0, 0]], li = [];
  for (let r = 1; r <= NRr; r++) for (let j = 0; j < NSg; j++) { let a = (j / NSg) * Math.PI * 2; if (a > Math.PI) a -= Math.PI * 2; const rr = (r / NRr) * RL * (1 + 0.32 * Math.exp(-((a / 0.26) ** 2))); rest.push([Math.sin(a) * rr, Math.cos(a) * rr]); }
  for (let j = 0; j < NSg; j++) li.push(0, 1 + j, 1 + ((j + 1) % NSg));
  for (let r = 0; r < NRr - 1; r++) for (let j = 0; j < NSg; j++) { const a = 1 + r * NSg + j, b = 1 + r * NSg + ((j + 1) % NSg); li.push(a, a + NSg, b, b, a + NSg, b + NSg); }
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(lp, 3)); lg.setIndex(li);
  const lidTop = add(g, lg, M(0xe4e6ea, { metalness: 0.55, roughness: 0.38, emissive: 0x22242a }), [0, Hc + 0.0008, 0], null, null, false);
  const lidUnder = add(g, lg, M(0xf4f4f0, { roughness: 0.6, side: THREE.BackSide }), [0, Hc + 0.0008, 0], null, null, false);
  lidTop.frustumCulled = lidUnder.frustumCulled = false;
  const Y = {
    g, cup, lid: 0, level: 1, H: Hc, mouth: V3(0, Hc, 0), // mouth: 입구 한가운데(컵 로컬)
    setLid(k) { // 0 = 닫힘 · 1 = 다 젖힘 (손잡이 쪽에서 말려 올라가 뒤로 넘어간다)
      Y.lid = k = clamp(k, 0, 1);
      const zc = lerp(RL * 1.36, -RL * 0.82, ease(k)), rc = 0.011, am = 2.1;
      for (let i = 0; i < rest.length; i++) {
        const [x, z] = rest[i]; let y = 0.0005 * Math.sin(x * 95 + 1) * Math.sin(z * 80) * Math.min(1, k * 4), zz = z; // 젖히면 은박이 살짝 구겨진다
        if (z > zc) { const d = z - zc, a = Math.min(d / rc, am), rem = d - a * rc; zz = zc + rc * Math.sin(a) + rem * Math.cos(a); y += rc * (1 - Math.cos(a)) + rem * Math.sin(a); }
        lp[i * 3] = x; lp[i * 3 + 1] = y; lp[i * 3 + 2] = zz;
      }
      lg.attributes.position.needsUpdate = true; lg.computeVertexNormals();
    },
    setLevel(k) { // 1 = 가득 · 0.05 = 바닥만 남음
      Y.level = k = clamp(k, 0.05, 1);
      const y = lerp(0.008, 0.036, (k - 0.05) / 0.95), r = wallR(y) - 0.0002;
      surf.position.y = y; surf.scale.set(r, 0.0022 * lerp(-0.7, 1, k), r); smear.visible = k < 0.97;
    },
    reset() { Y.setLid(0); Y.setLevel(1); },
  };
  Y.reset();
  return Y;
}
const yogurt = buildYogurt(); yogurt.g.visible = false; roomScene.add(yogurt.g);
// 코에 묻은 요거트 (머리에 붙어 있다 · setDab(0~1)로 나타났다 사라진다)
const yogurtDab = (() => {
  const g = new THREE.Group(), m = new THREE.MeshPhysicalMaterial({ color: 0xfffdf6, roughness: 0.25, clearcoat: 0.4 });
  add(g, SPH, m, [0.004, 0.0168, 0.1412], [0.66, 0, 0.15], [0.0105, 0.0052, 0.0085], false);
  add(g, SPH, m, [-0.0095, 0.0178, 0.1365], [0.4, 0, -0.5], [0.0048, 0.0032, 0.0055], false);
  add(g, SPH, m, [0.006, -0.0125, 0.1285], [0.3, 0, 0], [0.0065, 0.004, 0.0045], false);
  g.visible = false; pinky.head.add(g); g.position.set(0, -0.005, -0.042); g.scale.setScalar(1.3); // 멀리서도 보이게 조금 크게 (코끝 기준으로 키운다)
  return { g, k: 0, set(k) { this.k = k = clamp(k, 0, 1); g.visible = k > 0.01; for (const c of g.children) { if (!c.userData.s) c.userData.s = c.scale.clone(); c.scale.copy(c.userData.s).multiplyScalar(Math.max(k, 0.001)); } } };
})();
// 고구마 말랑이: 쫀득하게 말린 고구마 한 줄 (메시 좌표 = g의 로컬. 월드 좌표로 쓰려면 g를 roomScene에 그대로 둔다)
function buildGoguma(seed = 3) {
  const L0 = 0.085, NL = LITE ? 12 : 22, NR = LITE ? 12 : 24, rnd = rng(seed), ph = [0, 0, 0, 0, 0, 0].map(() => rnd() * 6.28), wv = 0.9 + rnd() * 0.25;
  const nv = (NL + 1) * NR, pos = new Float32Array(nv * 3), col = new Float32Array(nv * 3), loc = new Float32Array(nv * 2), idx = [];
  const cCore = new THREE.Color('#E8982C'), cHi = new THREE.Color('#FBC457'), cEdge = new THREE.Color('#A85F1A'), cTip = new THREE.Color('#8A4A14'), c = new THREE.Color();
  for (let i = 0; i <= NL; i++) {
    const u = i / NL, e = Math.pow(Math.sin(Math.PI * clamp(u, 0.012, 0.988)), 0.38), hw = 0.0102 * wv * e * (1 + 0.08 * Math.sin(u * 21 + ph[0]) + 0.035 * Math.sin(u * 47 + ph[1])), ht = 0.0035 * Math.pow(e, 0.6) * (1 + 0.15 * Math.sin(u * 13 + ph[2]));
    for (let j = 0; j < NR; j++) {
      const a = (j / NR) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), cx = Math.sign(ca) * Math.pow(Math.abs(ca), 0.7);
      const wr = Math.sin(cx * 5.6 + 1.3 * Math.sin(u * 8 + ph[3]) + ph[4]) + 0.4 * Math.sin(cx * 12.5 + u * 26 + ph[5]), body = 1 - Math.pow(Math.abs(cx), 4); // 길이 방향 주름
      const o = i * NR + j; loc[o * 2] = hw * cx + 0.0008 * Math.sin(u * 60 + ph[1]) * e; loc[o * 2 + 1] = ht * sa * (1 + 0.25 * wr * body) + 0.0011 * wr * body * e;
      const edge = Math.pow(Math.abs(cx), 3.5), end = clamp(1 - e * 1.12, 0, 1) * 2.4, tip = ss(0.86, 1, Math.abs(u - 0.5) * 2);
      c.copy(cCore).lerp(cHi, clamp(0.5 + 0.55 * wr * Math.sign(sa || 1), 0, 1) * body).lerp(cEdge, clamp(Math.max(edge * 0.85, end) + 0.12 * Math.sin(u * 33 + cx * 4 + ph[0]), 0, 1)).lerp(cTip, tip * 0.85);
      col[o * 3] = c.r; col[o * 3 + 1] = c.g; col[o * 3 + 2] = c.b;
      if (i < NL) { const b = i * NR + ((j + 1) % NR); idx.push(o, b, o + NR, b, b + NR, o + NR); }
    }
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.setIndex(idx);
  const mat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.5, sheen: 0.4, sheenColor: new THREE.Color(0xffd9a0), sheenRoughness: 0.5, emissive: 0x9a4a04, emissiveIntensity: 0.3, clearcoat: 0.25, clearcoatRoughness: 0.5 }); // 속이 비치는 듯한 호박빛
  const g = new THREE.Mesh(geo, mat); g.castShadow = true; g.receiveShadow = true; g.frustumCulled = false;
  const _t = V3(), _w = V3(), _n = V3(), _c = V3(), _s = V3(), DOWN = V3(0, -1, 0);
  const G = {
    g, L0, k: 1, get len() { return L0 * G.k; }, a: V3(), b: V3(0, 0, L0), twist: 0.5 + rnd() * 0.5,
    // a에서 b까지 걸친다. sag: 가운데가 처지는 깊이(안 주면 남는 길이만큼 저절로 처진다) · side: 넓은 면이 향할 옆 방향 · dir: 처지는 방향
    setShape(a, b, sag = null, side = null, dir = DOWN) {
      G.a.copy(a); G.b.copy(b);
      const ch = a.distanceTo(b), l = G.len; if (sag == null) sag = ch < l ? Math.min(ch * Math.sqrt(0.375 * (l / Math.max(ch, 1e-4) - 1)), l * 0.5) : 0;
      _c.copy(a).add(b).multiplyScalar(0.5).addScaledVector(dir, 2 * sag);
      const arc = ch * (1 + (8 / 3) * (sag / Math.max(ch, 1e-4)) ** 2), thin = clamp(Math.sqrt(l / Math.max(arc, 1e-4)), 0.8, 1.12); // 늘어나면 가늘어진다
      _t.subVectors(b, a).normalize(); if (side) _s.copy(side); else { _s.crossVectors(V3(0, 1, 0), _t); if (_s.lengthSq() < 0.05) _s.set(1, 0, 0); }
      for (let i = 0; i <= NL; i++) {
        const u = i / NL, v = 1 - u, px = v * v * a.x + 2 * v * u * _c.x + u * u * b.x, py = v * v * a.y + 2 * v * u * _c.y + u * u * b.y, pz = v * v * a.z + 2 * v * u * _c.z + u * u * b.z;
        _t.set(2 * v * (_c.x - a.x) + 2 * u * (b.x - _c.x), 2 * v * (_c.y - a.y) + 2 * u * (b.y - _c.y), 2 * v * (_c.z - a.z) + 2 * u * (b.z - _c.z)).normalize();
        _w.copy(_s).addScaledVector(_t, -_s.dot(_t)).normalize(); _n.crossVectors(_t, _w);
        const tw = G.twist * (u - 0.5) + 0.12 * Math.sin(u * 7 + ph[2]), ct = Math.cos(tw), st = Math.sin(tw);
        for (let j = 0; j < NR; j++) {
          const o = i * NR + j, lx = loc[o * 2] * thin, ly = loc[o * 2 + 1] * thin, x = lx * ct - ly * st, y = lx * st + ly * ct;
          pos[o * 3] = px + _w.x * x + _n.x * y; pos[o * 3 + 1] = py + _w.y * x + _n.y * y; pos[o * 3 + 2] = pz + _w.z * x + _n.z * y;
        }
      }
      geo.attributes.position.needsUpdate = true; geo.computeVertexNormals();
    },
    setLen(k) { G.k = clamp(k, 0.05, 1); }, // 먹은 만큼 짧아진다 (다음 setShape · straight · hang부터 반영)
    straight() { G.setShape(V3(0, 0, 0), V3(0, 0, G.len), 0, V3(1, 0, 0)); }, // g의 원점에서 +z로 곧게 (손 · 턱에 붙일 때)
    hang(a, sx = 0, sz = 0) { const l = G.len; G.setShape(a, V3(a.x + sx * l, a.y - l * Math.sqrt(Math.max(0.05, 1 - sx * sx - sz * sz)), a.z + sz * l), -0.05 * l * Math.hypot(sx, sz), V3(1, 0, 0), V3(sx, 0, sz).normalize()); }, // 한쪽 끝(a)을 집어 늘어뜨린다 · (sx, sz): 흔들린 정도
    lay(x, z, yaw = 0, y = 0.006) { const l = G.len / 2, sx = Math.sin(yaw) * l, sz = Math.cos(yaw) * l; G.setShape(V3(x - sx, y + 0.0045, z - sz), V3(x + sx, y + 0.0045, z + sz), 0); }, // 바닥(높이 y)에 납작하게 놓는다 (g가 월드에 있을 때)
    reset() { G.k = 1; G.straight(); },
  };
  G.reset();
  return G;
}
const goguma = buildGoguma(); goguma.g.visible = false; roomScene.add(goguma.g);
// 새 소품을 손 · 입에서 떼어 제자리로 (releaseHands에서 부른다)
function releaseProps() {
  for (const o of [yogurt.g, goguma.g]) { o.visible = false; roomScene.add(o); o.position.set(0, 0, 0); o.rotation.set(0, 0, 0); o.scale.setScalar(1); }
  rope.unpin();
}
function resetProps() { releaseProps(); yogurt.reset(); yogurtDab.set(0); goguma.reset(); rope.reset(); toyOff(); closePicker(); sitCount = 0; }

// ================================================================
// 말풍선 (킁킁 · 냠냠 · ♥)
// ================================================================
const bubbles = [], bubbleLayer = $('#bubbles'), _p = V3();
function say(text, anchor, cls = '', life = 1.7, dx = null) {
  const el = document.createElement('div'); el.className = 'bubble ' + cls; el.textContent = text;
  bubbleLayer.appendChild(el);
  bubbles.push({ el, anchor, age: 0, life, dx: dx ?? (Math.random() - 0.5) * 40 });
}
const headTop = () => pinky.head.localToWorld(V3(0, 0.125, 0.015));
const noseTip = () => pinky.head.localToWorld(V3(0, 0.004, 0.14));
const mouthPt = () => pinky.head.localToWorld(V3(0, -0.025, 0.115));
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
function releaseHands() { handR.want = null; handL.want = null; treat.visible = false; roomScene.add(treat); scoop.visible = false; pouring = false; releaseProps(); }
function startCommand(name, fn, keepCam = false) {
  cancelActive();
  const tok = { cancelled: false, cleanups: [], name };
  active = tok; setActiveBtn(name); idleT = 5;
  resetTransient(pinky); releaseHands();
  if (pinky.tgt.name === 'held' || pinky.tgt.name === 'eat') setPose(pinky, 'stand', 5);
  if (pinky.tgt.name === 'curl') { if (['touch', 'cushion', 'roam'].includes(name)) Object.assign(pinky, { eyeOpen: Math.min(pinky.eyeY, 0.3), face: null, wagAmpT: 0.05 }); else { setPose(pinky, 'stand', 3.0); pinky.napEnd = 0; } } // 방석에서 자다가 불리면 부드럽게 일어난다 (쓰다듬거나 계속 재울 때는 눈을 번쩍 뜨지 않는다)
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

// 방석(애착 공간)에서 자기: 방석 앞으로 가서 → 올라가 → 한두 바퀴 빙글 돌고 꾹꾹 자리를 다진 뒤 → 몸을 말고 턱을 테두리에 올리고 잔다.
// sec: 자는 시간. 이미 방석에서 몸을 말고 있으면(쓰다듬다 만 뒤) 그대로 다시 잠든다
async function cushionNap(tok, sec = 16, cam = false) {
  const C = SPOTS.cushion, dist = () => Math.hypot(pinky.x - C.x, pinky.z - C.z);
  const view = () => { if (cam) { const [p, a] = kneelFor({ x: CUSH.x - 0.04, z: CUSH.z }, roomCam.aspect < 0.8 ? 1.9 : 1.5, roomCam.aspect < 0.8 ? 1.0 : 0.86, 0.14); camTo(p, a, 1.4); } };
  const lids = (to, dur) => { const from = pinky.eyeOpen; return tween(tok, dur, (k) => { pinky.eyeOpen = lerp(from, to, k * k * (3 - 2 * k)); }); }; // 눈꺼풀은 천천히 내려오고 천천히 올라간다
  const curlHead = () => { pinky.face = null; pinky.tgt.gaze = POSES.curl.gaze; pinky.tgt.headPitch = POSES.curl.headPitch; };
  tok.cleanups.push(() => { cushGo = false; pinky.sigh = 0; });
  if (pinky.tgt.name !== 'curl' || dist() > 0.1) {
    setPose(pinky, 'stand', 4); pinky.walkSpeed = 0.4; pinky.wagAmpT = 0.4; pinky.wagSpeedT = 8;
    cushGo = true;
    if (dist() > 0.8) await walkTo(tok, C.ex, C.ez);
    view();
    pinky.walkSpeed = 0.26; pinky.tgt.gaze = 0.15; pinky.tgt.headPitch = 0.4;
    await walkTo(tok, C.x, C.z);
    // 빙글빙글: 몸을 마는 쪽(왼쪽)으로, 코를 앞세워 작은 원을 그리며 돌다가 눕는 방향에서 멈춘다
    let a0 = pinky.yaw, turn = CUSH.yaw - a0; turn -= Math.floor(turn / (Math.PI * 2)) * Math.PI * 2;
    turn += Math.PI * 2 * (turn < 1.6 || Math.random() < 0.45 ? 1 : 0); if (turn < 4.5) turn += Math.PI * 2;
    const half = turn > 9 ? 0.5 : 0.6;
    const spin = (from, to) => tween(tok, (Math.abs(to - from) * turn) / 2.1, (k) => {
      const a = a0 + turn * lerp(from, to, k), r = 0.035 * Math.sin(Math.PI * k);
      pinky.x = C.x - r * Math.cos(a); pinky.z = C.z + r * Math.sin(a);
      pinky.face = { x: pinky.x + Math.sin(a), z: pinky.z + Math.cos(a) };
    });
    pinky.sniff = 0.35; await spin(0, half);
    pinky.sniff = 0; await wait(tok, 0.5);
    pinky.paddle = 0.32; say('꾹꾹', headTop, 'small', 1.3); await wait(tok, 1.1); pinky.paddle = 0; // 자리를 다진다
    pinky.sniff = 0.3; await spin(half, 1); pinky.sniff = 0;
    await wait(tok, 0.7); pinky.face = null; pinky.yaw = a0 + turn; pinky.x = C.x; pinky.z = C.z;
    pinky.wagAmpT = 0.12; pinky.wagSpeedT = 4;
    setPose(pinky, 'down', 2.6); pinky.tgt.gaze = 0.2; await wait(tok, 0.95); // 나이 든 강아지답게 차례로: 먼저 앞다리를 접어 엎드리고
    setPose(pinky, 'curl', 1.7); await lids(0.45, 2.4); // 그다음 엉덩이를 옆으로 누이며 몸을 만다
    pinky.sigh = 0; await tween(tok, 2.2, (k) => { pinky.sigh = Math.sin(Math.PI * k) ** 2; }); // 눕고 나서 한숨
    say('후우…', headTop, 'soft', 1.8);
  } else { setPose(pinky, 'curl', 1.9); curlHead(); view(); await wait(tok, 0.8); } // 쓰다듬다 만 뒤: 고개를 다시 테두리에 내려놓고 그대로 잠든다
  curlHead(); pinky.wagAmpT = 0.03; await lids(0.04, 2.6);
  if (cam) pinky.napEnd = clock + sec; // 버튼으로 재운 낮잠은 쓰다듬어도 남은 시간만큼 이어서 잔다
  const zz = ['쿨…', 'z Z', '쿨…', '새근…'];
  for (let t0 = clock, n = 0; clock - t0 < sec; n++) {
    pinky.blinkT = 9;
    await wait(tok, 2.4 + Math.random() * 1.4);
    const r = Math.random();
    if (n > 1 && r < 0.14) { // 꿈꾸며 움찔: 발과 귀가 떨리고 꼬리가 탁탁
      pinky.paddle = 0.16; pinky.earPerk = 0.35; pinky.wagAmpT = 0.16; pinky.wagSpeedT = 9;
      await wait(tok, 0.55); pinky.paddle = 0; pinky.earPerk = 0; await wait(tok, 0.7); pinky.wagAmpT = 0.03; pinky.wagSpeedT = 4;
    } else if (n > 1 && r < 0.27) { // 자다가 한숨
      await tween(tok, 2.6, (k) => { pinky.sigh = Math.sin(Math.PI * k) ** 2; }); pinky.sigh = 0;
      say('후우…', headTop, 'soft', 1.8);
    } else say(zz[n % zz.length], headTop, n % 2 ? 'small' : '', 2.1, 18 + Math.random() * 26);
  }
  // 천천히 깨어난다: 눈을 반쯤 뜨고 → 고개를 들어 쳐다보고 → 엎드렸다가 → 일어나 방석에서 내려온다
  pinky.napEnd = 0; pinky.blinkT = 4;
  await lids(0.35, 1.6);
  pinky.tgt.gaze = 0.75; pinky.wagAmpT = 0.22; pinky.wagSpeedT = 6; await lids(0.8, 1.5);
  pinky.eyeOpen = 1; say('잘 잤다…', headTop, 'soft', 1.8); await wait(tok, 1.6);
  if (cam) camHome();
  setPose(pinky, 'down', 2.2); pinky.face = null; await wait(tok, 1.0);
  setPose(pinky, 'stand', 2.6); pinky.face = 'cam'; pinky.wagAmpT = 0.35; pinky.wagSpeedT = 8; await wait(tok, 1.3);
  cushGo = true; pinky.walkSpeed = 0.3; await walkTo(tok, C.ex, C.ez); cushGo = false; pinky.walkSpeed = 0.5;
}

const CMDS = {
  async cushion(tok) { const left = pinky.tgt.name === 'curl' ? (pinky.napEnd || 0) - clock : 0; await cushionNap(tok, left > 3 ? left : 75, true); },
  async sit(tok) { await sitCommand(tok); }, // 정면(대개) 또는 옆으로 앉는다

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
    sitFront(5);
    await wait(tok, 0.8);
    happy(true); say('좋아…', headTop, 'soft', 1.8);
    let s = 0, lift = 0, onBack = false;
    const upOf = () => frameUp(onBack ? pinky.body : pinky.head);
    const pt = () => (onBack ? pinky.body.localToWorld(V3(0, 0.115, lerp(0.05, -0.08, s))) : pinky.head.localToWorld(V3(0, 0.125, lerp(0.04, -0.06, s))));
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
  async play(tok, kind = 'ball') {
    if (kind === 'rope') return ropePlay(tok);
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
    setPose(pinky, 'eat', 7); pinky.tgt.headPitch += 0.3; pinky.jawOpen = 0.35;
    await wait(tok, 0.45);
    pinky.jaw.attach(ball.g); ball.g.position.set(0, -0.012, 0.1); ball.state = 'mouth'; pinky.jawOpen = 0.12;
    say('앙!', headTop, '', 1.1);
    setPose(pinky, 'stand', 6); pinky.lookFn = null; pinky.tgt.gaze = 1;
    await wait(tok, 0.35);
    pinky.walkSpeed = 0.95; await walkTo(tok, HOME.x, HOME.z); pinky.walkSpeed = 0.5;
    sitFront(7);
    await wait(tok, 0.7);
    const c = roomCam.position, dir = V3(c.x - pinky.x, 0, c.z - pinky.z).normalize();
    pinky.jawOpen = 0.3; ballToWorld(dir.multiplyScalar(0.5).add(V3(0, 0.4, 0)));
    await wait(tok, 0.2); pinky.jawOpen = 0;
    pinky.wagAmpT = 0.85; pinky.wagSpeedT = 18; pinky.tiltT = 0.25; say('또 던져!', headTop, 'soft', 2);
    await wait(tok, 2.2); pinky.tiltT = 0;
  },
  async treat(tok, kind = 'gum') {
    if (TREATS[kind]) return TREATS[kind](tok);
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
    sitFront(9);
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
    const curled = pinky.tgt.name === 'curl'; // 방석에서 자는 중이면 깨우지 않고 눈만 살짝, 꼬리만 탁탁
    if (curled) Object.assign(pinky, { face: null, pant: false, eyeOpen: 0.2, tiltT: 0, earPerk: 0, wagAmpT: 0.2, wagSpeedT: 7 });
    say('좋아…', headTop, 'soft', 1.6);
    handR.want = { pos: () => touch.pt.clone().addScaledVector(touch.n, 0.02), up: () => touch.n, curl: 0.12, rate: 16, shoulder: [0.34, -0.15, 0.05] };
    await until(tok, () => !touch.active);
    handR.want = null; pinky.paddle = 0;
    await wait(tok, 0.6); happy(false); if (curled) { pinky.eyeOpen = 0.3; pinky.wagAmpT = 0.1; } else pinky.tiltT = 0.3; say('더 해줘…', headTop, 'soft', 1.8);
    await wait(tok, 1.6); pinky.tiltT = 0;
    if (curled && pinky.tgt.name === 'curl' && pinky.napEnd > clock + 3) { startCommand('cushion', CMDS.cushion, true); return; } // 방석 버튼으로 자던 중이면 남은 낮잠을 그대로 이어서 잔다
    camHome();
  },
};

// 혼자 있을 때: 집 안을 돌아다니기
async function roam(tok) {
  const acts = [
    async () => { await cushionNap(tok, 13 + Math.random() * 9); }, // 방석(애착 공간)에서 낮잠
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
    if (pinky.tgt.name === 'curl' || (last !== 0 && Math.random() < 0.26)) i = 0; // 방석은 핑키의 애착 공간: 다른 데보다 훨씬 자주 간다 (쓰다듬다 만 뒤에는 그대로 다시 잔다)
    last = i;
    pinky.face = 'cam'; pinky.lookFn = null; pinky.sniff = 0; pinky.tgt.gaze = 1; pinky.tgt.headPitch = 0;
    await acts[i]();
    await wait(tok, 1 + Math.random() * 2);
  }
}

// ================================================================
// 앉기: 정면 · 옆  /  로프 당기기 놀이  /  요거트 · 고구마 말랑이 먹기  /  고르기 메뉴
// ================================================================
// 정면 앉기: 보는 사람과 마주 앉으면 앞다리를 가슴 밑에 가지런히 모으고, 뒷발이 앞발 양옆으로 보이게 벌린다.
// 옆·비스듬히 보일 때는 원래 앉기 그대로 (보이는 각도에 따라 부드럽게 섞인다)
const SIT_F = { splay: 0.36, tailCurl: 2.0, paws: [P(0.056, 0.03, 0.172), P(-0.056, 0.03, 0.172), P(0.116, 0.03, 0.06), P(-0.116, 0.03, 0.06)] };
function sitShape(d) {
  if (d.J || d.tgt.name !== 'sit') return;
  if (active && active.name === 'roam' && d.face === 'cam') d.tgt.yawOff = 0; // 혼자 놀다 와서 쳐다볼 때도 마주 보고 앉는다
  const c = roomCam.position, a = Math.abs(angDiff(d.yaw, Math.atan2(c.x - d.x, c.z - d.z))), f = ss(0.6, 0.28, a), b = POSES.sit;
  for (let i = 0; i < 4; i++) d.tgt.paws[i].lerpVectors(b.paws[i], SIT_F.paws[i], f);
  d.tgt.splay = lerp(b.splay, SIT_F.splay, f); d.tgt.tailCurl = lerp(b.tailCurl, SIT_F.tailCurl, f); // 꼬리는 엉덩이를 감아 옆으로 끝이 보인다
}
roomUpd.push(() => sitShape(pinky));
const camYaw = () => Math.atan2(roomCam.position.x - pinky.x, roomCam.position.z - pinky.z);
function sitFront(rate = 6) { setPose(pinky, 'sit', rate); pinky.face = 'cam'; pinky.tgt.yawOff = 0; pinky.sitView = 'front'; }
// view: 'front'(마주 보고) · 'side'(몸은 옆으로, 고개만 돌려 본다). 많이 돌아야 하면 먼저 서서 발을 옮겨 돈 다음 앉는다
async function sitAs(tok, view = 'front', rate = 6) {
  let off = 0;
  if (view === 'side') off = Math.abs(angDiff(pinky.yaw, camYaw() + 1.1)) < Math.abs(angDiff(pinky.yaw, camYaw() - 1.1)) ? 1.1 : -1.1;
  pinky.face = 'cam';
  if (Math.abs(angDiff(pinky.yaw, camYaw() + off)) > 0.5) {
    setPose(pinky, 'stand', 6); pinky.tgt.yawOff = pinky.cur.yawOff = off;
    const t0 = clock; await until(tok, () => Math.abs(angDiff(pinky.yaw, camYaw() + off)) < 0.2 || clock - t0 > 1.4);
  }
  setPose(pinky, 'sit', rate); pinky.tgt.yawOff = pinky.cur.yawOff = off;
  pinky.sitView = view;
}
let sitCount = 0, lastSit = '';
async function sitCommand(tok) {
  const was = pinky.tgt.name === 'sit' ? (Math.abs(pinky.tgt.yawOff) > 0.8 ? 'side' : 'front') : null;
  const view = was ? (was === 'front' ? 'side' : 'front') : sitCount === 0 || lastSit === 'side' || Math.random() < 0.75 ? 'front' : 'side'; // 앉아 있을 때 또 누르면 다른 쪽으로 고쳐 앉는다
  sitCount++; lastSit = view;
  pinky.wagAmpT = 0.4; pinky.wagSpeedT = 8; pinky.earPerk = 0.4;
  await sitAs(tok, view, 6);
  await wait(tok, 1.2); pinky.earPerk = 0; pinky.tiltT = view === 'front' ? 0.2 : 0.1;
  await wait(tok, 1.3); pinky.tiltT = view === 'front' ? 0.06 : 0.08;
  await wait(tok, 1.4);
}

// 핥기 · 쫀득하게 씹기 · 물고 흔들기 (updateDog 뒤에 덧입힌다 — 혀는 보이지 않고 턱과 고개 움직임으로만 보여 준다)
const toy = { lap: 0, chew: 0, chewRate: 9, shake: 0, sk: 0, shakeHz: 5, shakeAmp: 1, rest: 0, jaw: false, tick: null, tok: null };
function toyOff() { Object.assign(toy, { lap: 0, chew: 0, chewRate: 9, shake: 0, shakeHz: 5, shakeAmp: 1, rest: 0, tick: null, tok: null }); }
function toyPost(d, dt, t) {
  if (toy.tok && active !== toy.tok) toyOff();
  toy.sk += (toy.shake - toy.sk) * (1 - Math.exp(-14 * dt));
  if (toy.lap > 0) { d.hp.rotation.x += Math.sin(t * 20) * 0.035 * toy.lap; d.jawOpen = 0.05 + 0.15 * (0.5 + 0.5 * Math.sin(t * 20 + 0.8)); toy.jaw = true; }
  else if (toy.chew > 0) { d.hp.rotation.x += Math.sin(t * toy.chewRate) * 0.028; d.jawOpen = 0.05 + 0.2 * (0.5 + 0.5 * Math.sin(t * toy.chewRate)); toy.jaw = true; }
  else if (toy.jaw) { d.jawOpen = toy.rest; toy.jaw = false; }
  if (toy.sk > 0.01) {
    const w = t * Math.PI * 2 * toy.shakeHz, a = toy.sk * toy.shakeAmp;
    d.hp.rotation.y += Math.sin(w) * 0.28 * a; d.hp.rotation.z += Math.cos(w) * 0.15 * a;
    for (const e of d.ears) { e.vz += Math.cos(w) * 45 * a * dt; e.vx += Math.sin(w * 2) * 30 * a * dt; } // 귀도 펄럭
  }
  if (toy.tick) { handR.rig.g.updateMatrixWorld(true); d.hp.updateWorldMatrix(true, true); toy.tick(dt, t); }
}
const phoneK = () => (roomCam.aspect < 0.8 ? 1.25 : 1); // 세로 화면에서는 조금 더 물러나 앉는다
const toCamDir = () => { const c = roomCam.position; return V3(c.x - pinky.x, 0, c.z - pinky.z).normalize(); };
const sideSay = (text, i, cls = '', life = 1.2) => say(text, headTop, cls, life, (i % 2 ? 1 : -1) * (70 + Math.random() * 25));

// ---------- 로프 당기기
// 놀이 인사(앞가슴을 낮추고 엉덩이는 든다) · 버티기(엉덩이를 낮추고 뒤로 당긴다)
POSES.bow = { bodyY: 0.235, bodyZ: 0, pitch: 0.42, roll: 0, yawOff: 0, gaze: 1, headPitch: 0, headTilt: 0, tail: -0.7, level: 1, free: 0, neck: -0.3, tailCurl: 0.3, abd: [0.06, 0.06, 0, 0],
  lean: [1.3, 1.3, 0.14, 0.14], paws: [P(0.08, 0.03, 0.31), P(-0.08, 0.03, 0.31), P(0.072, 0.03, -0.192), P(-0.072, 0.03, -0.192)] };
POSES.tug = { bodyY: 0.25, bodyZ: -0.05, pitch: -0.14, roll: 0, yawOff: 0, gaze: 1, headPitch: 0, headTilt: 0, tail: -1.0, level: 1, free: 0, neck: -0.1, lumbar: 0.2, abd: [0.06, 0.06, 0, 0],
  lean: [-0.15, -0.15, 0.3, 0.3], paws: [P(0.075, 0.03, 0.25), P(-0.075, 0.03, 0.25), P(0.09, 0.03, -0.15), P(-0.09, 0.03, -0.15)] };
const ROPE_BITE = [V3(0.012, -0.012, 0.088), V3(-0.012, -0.012, 0.088)]; // 통매듭 바로 위를 가로로 문다 (턱 기준) — 통매듭과 술은 볼 옆으로 늘어진다
let ropeRuns = 0;
async function ropePlay(tok) {
  const ph = phoneK(), run = ropeRuns++;
  toy.tok = tok; tok.cleanups.push(() => { toyOff(); pinky.walkTarget = null; });
  const mouth = () => pinky.jaw.localToWorld(V3(0, -0.012, 0.088));
  const pullA = ph > 1 ? 0.36 : 0.7, pullDir = () => { const d = toCamDir(), c = Math.cos(pullA), sn = Math.sin(pullA); return V3(d.x * c + d.z * sn, 0, d.z * c - d.x * sn); }; // 내 손은 화면 오른쪽 앞에서 당긴다 (줄이 화면에 길게 보이게)
  const kickA = (v) => { for (let i = 0; i < rope.NP; i++) rope.kick(v, 'A' + i); };
  const slide = (dur, dir, dist, fn) => { const p0 = { x: pinky.x, z: pinky.z }; return tween(tok, dur, (q) => { const e = ease(q); pinky.x = p0.x + dir.x * dist * e; pinky.z = p0.z + dir.z * dist * e; if (fn) fn(e); }); };
  setPose(pinky, 'stand', 6); pinky.face = 'cam';
  pinky.lookFn = () => rope.pos('B.bite');
  pinky.earPerk = 1; pinky.wagAmpT = 0.85; pinky.wagSpeedT = 18;
  await wait(tok, 0.5); say('!', headTop, '', 1);
  await wait(tok, 0.45); say('로프!', headTop, 'soft', 1.3);
  // 로프가 놓인 데로 가서 문다 (어디에 두었든 찾아간다)
  const reach = 0.25, t0 = clock; pinky.walkSpeed = 1.0;
  const rel = () => { const b = rope.pos('B.bite'); return [b, b.x - pinky.x, b.z - pinky.z, Math.hypot(b.x - pinky.x, b.z - pinky.z) || 1e-3]; };
  let [b, dx, dz, dist] = rel();
  if (dist < 0.17) { pinky.face = { x: b.x, z: b.z }; pinky.paddle = 0.25; await slide(0.6, V3(-Math.sin(pinky.yaw), 0, -Math.cos(pinky.yaw)), reach - dist * 0.5); pinky.paddle = 0; } // 발밑에 있으면 한 발 물러나서
  else await until(tok, () => {
    [b, dx, dz, dist] = rel();
    pinky.walkTarget = dist > reach + 0.03 ? { x: b.x - (dx / dist) * reach, z: b.z - (dz / dist) * reach } : null;
    if (clock - t0 > 10) { rope.place(pinky.x + Math.sin(pinky.yaw) * 0.3, pinky.z + Math.cos(pinky.yaw) * 0.3, pinky.yaw + 1.2); return true; } // 가구 밑처럼 닿지 않는 곳이면 앞으로 끌어다 놓는다
    return dist < reach + 0.07 || (clock - t0 > 6 && dist < 0.5);
  });
  pinky.walkTarget = null; [b] = rel(); pinky.face = { x: b.x, z: b.z };
  await wait(tok, 0.3);
  setPose(pinky, 'eat', 7); pinky.tgt.headPitch += 0.3; pinky.jawOpen = 0.35;
  await wait(tok, 0.45);
  rope.pinTo('B.bite', pinky.jaw, ROPE_BITE[0]); rope.pinTo('B.barrel', pinky.jaw, ROPE_BITE[1]);
  pinky.jawOpen = toy.rest = 0.1; say('앙!', headTop, '', 1.1);
  setPose(pinky, 'stand', 6); pinky.lookFn = null; pinky.tgt.gaze = 0.5; pinky.tgt.headPitch = -0.15;
  await wait(tok, 0.4);
  pinky.walkSpeed = 0.9; await walkTo(tok, HOME.x, HOME.z); pinky.walkSpeed = 0.5;
  pinky.face = 'cam'; setPose(pinky, 'stand', 6); pinky.tgt.yawOff = 0;
  { const [p, a] = kneelAt(1.2 * ph, 0.66, 0.2); camTo(p, a.addScaledVector(pullDir(), ph > 1 ? 0.08 : 0.14)); } // 핑키와 내 손이 함께 보이게
  await wait(tok, 0.6);
  // 고개를 휙 쳐서 남은 줄을 내 쪽으로 던져 준다
  toy.shake = 1; kickA(pullDir().multiplyScalar(1.6).add(V3(0, 1.3, 0))); say('으응!', headTop, 'small', 1);
  await wait(tok, 0.3); toy.shake = 0;
  await wait(tok, 0.65);
  // 손이 고리 매듭을 쥔다
  const L = rope.span('A.knot', 'B.bite');
  let k = 0.9, sway = 0, lift = 0.03, yank = 0, held = false;
  const hold = () => { const d = pullDir(); return mouth().addScaledVector(d, L * k + yank).add(V3(-d.z * sway, lift, d.x * sway)); };
  handR.want = { pos: () => rope.pos('A.knot').add(V3(0, 0.03, 0)), up: () => V3(0, 1, 0), curl: 0.2, rate: 7 };
  pinky.lookFn = () => handR.pos; pinky.tgt.gaze = 1; pinky.tgt.headPitch = 0;
  await wait(tok, 0.75); handR.want.curl = 0.9;
  await wait(tok, 0.3);
  handR.want = { pos: hold, up: () => V3(0, 1, 0), curl: 0.9, rate: 6 };
  rope.pinTo('A.knot', handR.rig.inner, V3(0, -0.024, 0.01)); held = true;
  toy.tick = () => { // 줄 길이보다 멀어지면 손이 끌려간다
    if (!held) return;
    const m = mouth(), hp = handR.pos, d = hp.distanceTo(m), max = L * 1.005;
    if (d > max) { hp.sub(m).multiplyScalar(max / d).add(m); handR.rig.g.position.copy(hp); handR.rig.g.updateMatrixWorld(true); }
    faceHand.x = hp.x; faceHand.z = hp.z;
  };
  const faceHand = { x: handR.pos.x, z: handR.pos.z }; pinky.face = faceHand; // 손 쪽을 보고 버틴다
  // 놀이 인사
  setPose(pinky, 'bow', 6); pinky.wagAmpT = 0.9; pinky.wagSpeedT = 20; pinky.earPerk = 0.8;
  say('으르릉~', headTop, '', 1.3);
  await wait(tok, 1.1);
  // 당기기: 엉덩이를 낮추고 뒷걸음질 → 고개를 좌우로 털고 → (가끔) 내가 확 당기면 끌려왔다가 다시 버틴다
  setPose(pinky, 'tug', 7); pinky.wagAmpT = 0.7; pinky.wagSpeedT = 14; pinky.eyeOpen = 0.8; pinky.earPerk = 0.3;
  const growl = ['으르릉', '으르르…', '끄응!', '으르릉!'];
  for (let i = 0; i < 4; i++) {
    const d = V3(handR.pos.x - pinky.x, 0, handR.pos.z - pinky.z).normalize(), k0 = k;
    pinky.paddle = 0.25; sideSay(growl[i], i, i % 2 ? 'small' : '', 1.2);
    await slide(0.7, d, -0.07, (e) => { k = lerp(k0, 1.0, e); sway = lerp(sway, 0, e); });
    pinky.paddle = 0; toy.shake = 1; const s1 = (i % 2 ? 1 : -1) * 0.11, s0 = sway;
    await tween(tok, 0.6, (q) => { sway = lerp(s0, s1, ease(q)); pinky.tgt.bodyY = 0.25 - 0.012 * Math.sin(q * Math.PI); });
    toy.shake = 0;
    if (i % 2) { yank = 0.09; handR.want.rate = 10; await slide(0.32, d, 0.05); pinky.paddle = 0.3; await wait(tok, 0.25); pinky.paddle = 0; yank = 0; handR.want.rate = 6; }
    else await wait(tok, 0.22);
  }
  // 이겼다: 더 낮게 버티다가 손이 놓친다
  pinky.tgt.bodyY = 0.225; pinky.tgt.pitch = -0.2; toy.shake = 0.6; say('끄으응!', headTop, '', 1.1);
  await wait(tok, 0.55); toy.shake = 0;
  const dW = V3(handR.pos.x - pinky.x, 0, handR.pos.z - pinky.z).normalize();
  held = false; rope.unpin('A.knot'); kickA(dW.clone().multiplyScalar(-1.3).add(V3(0, 0.5, 0)));
  { const hp = handR.pos.clone(), d = dW; handR.want = { pos: () => hp.clone().addScaledVector(d, 0.1).add(V3(0, 0.1, 0)), up: () => V3(0, 1, 0), curl: 0.15, rate: 12 }; }
  pinky.paddle = 0.3; await slide(0.35, dW, -0.08); pinky.paddle = 0;
  handR.want = null; toy.tick = null; pinky.face = 'cam';
  setPose(pinky, 'stand', 6); pinky.tgt.yawOff = 0; pinky.eyeOpen = 1; pinky.earPerk = 0.6; pinky.wagAmpT = 0.9; pinky.wagSpeedT = 16;
  say('이겼다!', headTop, 'soft', 1.5);
  await wait(tok, 0.7);
  // 물고 우쭐우쭐 한 바퀴
  { const [p, a] = kneelFor(HOME, 1.6 * ph, 0.9, 0.25); camTo(p, a, 2); }
  pinky.lookFn = null; pinky.tgt.gaze = 0.3; pinky.tgt.headPitch = -0.25; pinky.tgt.tail = -0.8;
  pinky.walkSpeed = 0.8; await walkTo(tok, HOME.x - 0.45, HOME.z - 0.25); await walkTo(tok, HOME.x + 0.4, HOME.z - 0.3);
  pinky.face = 'cam'; pinky.tgt.gaze = 1; pinky.tgt.headPitch = 0; await wait(tok, 0.45);
  // 부르르 턴다
  Object.assign(toy, { shake: 1, shakeHz: 7, shakeAmp: 1.4 }); say('부르르!', headTop, '', 1.2);
  await wait(tok, 0.95); Object.assign(toy, { shake: 0, shakeHz: 5, shakeAmp: 1 });
  await wait(tok, 0.4);
  if (run % 2 === 0) { // 물고 와서 발치에 내려놓는다
    pinky.walkSpeed = 0.7; await walkTo(tok, HOME.x, HOME.z); pinky.walkSpeed = 0.5;
    { const [p, a] = kneelFor(HOME, 1.15 * ph, 0.7, 0.2); camTo(p, a, 2); }
    await sitAs(tok, 'front', 6); pinky.tgt.tail = POSES.sit.tail;
    await wait(tok, 0.7);
    pinky.jawOpen = 0.3; toy.rest = 0; rope.unpin('B.bite'); rope.unpin('B.barrel'); rope.kick(toCamDir().multiplyScalar(0.5));
    await wait(tok, 0.3); pinky.jawOpen = 0;
    pinky.lookFn = () => rope.pos('B.bite'); pinky.sniff = 0.6; await wait(tok, 0.8);
    pinky.sniff = 0; pinky.lookFn = null; pinky.tiltT = 0.25; pinky.wagAmpT = 0.85; pinky.wagSpeedT = 18;
    say('또 하자!', headTop, 'soft', 2); heart();
    await wait(tok, 2.2); pinky.tiltT = 0;
  } else { // 엎드려서 질겅질겅
    { const [p, a] = kneelAt(1.1 * ph, 0.62, 0.14); camTo(p, a, 2); }
    setPose(pinky, 'down', 3); pinky.tgt.yawOff = -0.45; pinky.wagAmpT = 0.35; pinky.wagSpeedT = 5;
    await wait(tok, 1.2);
    const paws = () => pinky.root.localToWorld(V3(0, 0.035, 0.3));
    rope.pin('B.mid', paws);
    pinky.lookFn = paws; pinky.tgt.gaze = 0.85; pinky.tgt.neck = 0.4; pinky.eyeOpen = 0.5; pinky.tiltT = 0.4;
    toy.chew = 1; toy.chewRate = 8;
    const w = ['질겅질겅', '냠', '질겅…', '질겅질겅'];
    for (let i = 0; i < 4; i++) { sideSay(w[i], i, i % 2 ? 'small' : ''); if (i === 2) pinky.tiltT = -0.4; await wait(tok, 1.25); }
    toy.chew = 0; toy.rest = 0; pinky.lookFn = null; pinky.tgt.gaze = 1; pinky.tgt.neck = 0; pinky.tiltT = 0.2; pinky.eyeOpen = 1;
    rope.unpin();
    say('재밌었다…', headTop, 'soft', 1.8); heart();
    await wait(tok, 1.9); pinky.tiltT = 0;
  }
  toyOff(); camHome();
}

// ---------- 요거트: 컵을 내밀면 마주 앉아 할짝할짝, 코에 묻히고 입맛을 다신다
async function yogurtTreat(tok) {
  const ph = phoneK();
  toy.tok = tok; tok.cleanups.push(() => { toyOff(); yogurt.reset(); yogurtDab.set(0); });
  { const [p, a] = kneelFor(HOME, 1.0 * ph, 0.64, 0.34); camTo(p, a); }
  yogurt.reset(); yogurtDab.set(0);
  handR.rig.inner.add(yogurt.g); yogurt.g.position.set(0, -0.016, 0.03); yogurt.g.visible = true;
  let tilt = 0; const setTilt = (a) => { tilt = a; yogurt.g.rotation.set(-a, 0, Math.PI); }; setTilt(0); // 손바닥 위에 세운 컵 · 입구를 핑키 쪽으로 기울인다
  const cupMouth = () => yogurt.g.localToWorld(yogurt.mouth.clone());
  let target = () => roomCam.localToWorld(V3(0.1, -0.2, -0.42));
  handR.want = { pos: () => target(), up: () => V3(0, -1, 0), curl: 0.5, rate: 5 };
  pinky.lookFn = cupMouth;
  await wait(tok, 0.5);
  pinky.earPerk = 1; pinky.wagAmpT = 0.85; pinky.wagSpeedT = 18; say('!', headTop, '', 1.1);
  await wait(tok, 0.3);
  if (Math.hypot(pinky.x - HOME.x, pinky.z - HOME.z) > 0.08) {
    setPose(pinky, 'stand', 7); pinky.walkSpeed = 0.95; say('요거트다!', headTop, 'soft', 1.4);
    await walkTo(tok, HOME.x, HOME.z); pinky.walkSpeed = 0.5;
  }
  await sitAs(tok, 'front', 8);
  await wait(tok, 0.5);
  await tween(tok, 0.5, (q) => yogurt.setLid(ease(q))); // 뚜껑을 연다
  say('킁킁', noseTip); pinky.sniff = 0.6; pinky.tiltT = 0.2;
  await wait(tok, 0.8); pinky.sniff = 0; pinky.tiltT = 0;
  // 컵을 주둥이 밑에 대 준다 (자리는 앉은 가슴 앞에 고정 — 핑키가 고개를 숙여 찾아온다)
  const m0 = mouthPt(), dC = toCamDir(); let dip = 0;
  const spot = () => V3(m0.x + dC.x * 0.045, m0.y - 0.075 - dip, m0.z + dC.z * 0.045);
  target = () => spot().sub(cupMouth().sub(handR.pos));
  pinky.lookFn = () => spot().addScaledVector(dC, 0.09);
  await tween(tok, 0.8, (q) => setTilt(0.6 * ease(q)));
  pinky.tgt.neck += 0.25; pinky.tgt.reach = 0.03; pinky.earPerk = 0.3; pinky.eyeOpen = 0.5; pinky.wagAmpT = 0.5; pinky.wagSpeedT = 9;
  await wait(tok, 0.5);
  const words = ['할짝', '할짝할짝', '챱챱', '할짝', '냠…', '할짝할짝'];
  for (let i = 0; i < 6; i++) {
    toy.lap = 1; sideSay(words[i], i);
    if (i === 3) { pinky.tgt.reach = 0.045; dip = 0.008; yogurtDab.set(0.01); tween(tok, 0.15, (q) => yogurtDab.set(q)).catch(() => {}); } // 깊이 넣다가 코에 묻는다
    if (i === 2 || i === 5) heart();
    const l0 = yogurt.level, l1 = lerp(1, 0.05, (i + 1) / 6), a0 = tilt;
    await tween(tok, 0.65, (q) => { yogurt.setLevel(lerp(l0, l1, q)); setTilt(lerp(a0, 0.6 + 0.5 * ((i + 1) / 6), q)); });
    toy.lap = 0; await wait(tok, 0.25); // 꿀꺽
  }
  // 다 먹었다: 컵을 빼면 아쉬워 따라온다
  { const s = spot(); target = () => s.clone().addScaledVector(dC, 0.1).add(V3(0, 0.03, 0)).sub(cupMouth().sub(handR.pos)); }
  pinky.tgt.reach = 0.05; say('더…', headTop, 'small', 1.1); pinky.eyeOpen = 1;
  await wait(tok, 0.9);
  pinky.lookFn = null; pinky.tgt.neck = POSES.sit.neck; pinky.tgt.reach = 0;
  await tween(tok, 0.5, (q) => setTilt(lerp(1.1, 0.5, ease(q))));
  // 코에 묻은 걸 알아채고 입맛을 다신다
  pinky.tiltT = 0.3; say('?', headTop, '', 0.9); await wait(tok, 0.6);
  for (let i = 0; i < 2; i++) { toy.lap = 1; sideSay('할짝', i); await wait(tok, 0.32); toy.lap = 0; yogurtDab.set(i ? 0.6 : 0.8); await wait(tok, 0.22); }
  heart(); handR.want = null;
  await wait(tok, 0.3); releaseProps();
  pinky.tiltT = 0.32; pinky.wagAmpT = 0.6; pinky.wagSpeedT = 11; pinky.earPerk = 0.5;
  say('…또 줘?', headTop, 'soft', 2.4);
  await wait(tok, 2.0); pinky.tiltT = 0; pinky.earPerk = 0;
  toy.lap = 1; say('할짝', headTop, 'small', 1); await tween(tok, 0.45, (q) => yogurtDab.set(0.6 * (1 - q))); toy.lap = 0; yogurtDab.set(0); // 마지막 한 번 핥아 코를 닦는다
  await wait(tok, 0.4); yogurt.reset(); toyOff(); camHome();
}

// ---------- 고구마 말랑이: 살며시 받아 물고, 엎드려 앞발 사이에 끼우고 옆니로 쫀득쫀득
async function gogumaTreat(tok) {
  const ph = phoneK();
  toy.tok = tok; tok.cleanups.push(() => { toyOff(); goguma.reset(); });
  { const [p, a] = kneelFor(HOME, 0.95 * ph, 0.62, 0.2); camTo(p, a); }
  goguma.reset(); roomScene.add(goguma.g); goguma.g.visible = true;
  const pinch = () => handR.rig.inner.localToWorld(V3(0.012, -0.034, 0.072)); // 엄지와 손가락 끝 사이
  const pawPt = () => pinky.root.localToWorld(V3(0, 0.03, 0.315));
  const jawPt = (x, y, z) => pinky.jaw.localToWorld(V3(x, y, z));
  let mode = 'hand', swing = 1, side = 1, pull = 0, t1 = clock;
  toy.tick = (dt, t) => {
    if (mode === 'hand') { swing *= Math.exp(-0.8 * dt); goguma.hang(pinch(), Math.sin((t - t1) * 6) * 0.16 * swing, Math.cos((t - t1) * 4.3) * 0.08 * swing); }
    else if (mode === 'jaw') goguma.setShape(jawPt(-0.012, -0.01, 0.07), jawPt(0.03 + goguma.len * 0.55, -0.03, 0.085 + goguma.len * 0.3), 0.006); // 입 옆으로 비죽 나오게 문다
    else if (mode === 'paws') {
      const top = jawPt(side * 0.014, -0.006, 0.07), bot = pawPt(), l = goguma.len * (1 + 0.15 * pull), d = top.distanceTo(bot);
      if (d > l) bot.sub(top).multiplyScalar(l / d).add(top); // 남은 게 짧으면 발에서 들려 올라온다
      goguma.setShape(bot, top, d < l ? null : 0, null, toCamDir());
    }
  };
  let target = () => roomCam.localToWorld(V3(0.09, -0.07, -0.5));
  handR.want = { pos: () => target(), up: () => V3(0, 1, 0), curl: 0.75, rate: 5 };
  pinky.lookFn = () => goguma.b;
  await wait(tok, 0.5);
  pinky.earPerk = 1; pinky.wagAmpT = 0.85; pinky.wagSpeedT = 18; say('!', headTop, '', 1.1);
  await wait(tok, 0.4); say('고구마다!', headTop, 'soft', 1.4);
  if (Math.hypot(pinky.x - HOME.x, pinky.z - HOME.z) > 0.08) { setPose(pinky, 'stand', 7); pinky.walkSpeed = 0.95; await walkTo(tok, HOME.x, HOME.z); pinky.walkSpeed = 0.5; }
  await sitAs(tok, 'front', 8);
  pinky.wagAmpT = 0.7; pinky.wagSpeedT = 14;
  await wait(tok, 0.9); // 얌전히 기다린다
  // 살며시 받아 문다
  const near = () => { const m = mouthPt(), d = toCamDir(); return m.addScaledVector(d, 0.03).add(V3(0, goguma.len * 0.9, 0)).sub(pinch().sub(handR.pos)); };
  target = near; swing = 0.5; t1 = clock; handR.want.rate = 4;
  await wait(tok, 1.0);
  pinky.jawOpen = 0.22; await wait(tok, 0.35);
  mode = 'jaw'; pinky.jawOpen = toy.rest = 0.08; say('앙', headTop, 'small', 1); handR.want.curl = 0.3;
  await wait(tok, 0.25); handR.want = null; pinky.lookFn = null;
  await wait(tok, 0.6);
  // 엎드려 앞발 사이에 끼운다
  setPose(pinky, 'down', 3); pinky.tgt.yawOff = -0.45; pinky.wagAmpT = 0.35; pinky.wagSpeedT = 5; pinky.earPerk = 0;
  { const [p, a] = kneelAt(1.0 * ph, 0.42, 0.13); camTo(p, a, 1.8); }
  await wait(tok, 1.25);
  let lookUp = 0; const lookPt = () => pawPt().add(V3(0, 0.07 + lookUp, 0));
  pinky.lookFn = lookPt; pinky.tgt.gaze = 0.55; pinky.tgt.neck = 0.25; pinky.tgt.reach = 0.02;
  pinky.tgt.paws[0].x = 0.04; pinky.tgt.paws[1].x = -0.04;
  await wait(tok, 0.7);
  mode = 'paws'; toy.rest = 0; pinky.eyeOpen = 0.5;
  const words = ['쫀득', '쫀득쫀득', '질겅질겅', '쫀득쫀득', '냠냠'];
  for (let i = 0; i < 5; i++) {
    side = i < 2 ? 1 : i < 4 ? -1 : 1; pinky.tiltT = side * 0.45; toy.chew = 1; toy.chewRate = 9; pinky.tgt.gaze = 0.55 + 0.07 * i; // 짧아질수록 고개를 더 숙인다
    sideSay(words[i], i);
    await wait(tok, 1.0);
    await tween(tok, 0.35, (q) => { pull = q; lookUp = 0.07 * q; }); // 쭉 당겨서
    goguma.setLen(Math.max(0.05, goguma.k - 0.19)); pull = 0; lookUp = 0; spawnCrumbs(jawPt(0, -0.01, 0.08), 2); // 끊어 먹는다
    await wait(tok, 0.12);
  }
  // 마지막 한 입
  goguma.g.visible = false; pinky.lookFn = null; pinky.tgt.gaze = 1; pinky.tgt.neck = 0; pinky.tgt.reach = 0; pinky.tiltT = 0;
  pinky.tgt.paws[0].x = POSES.down.paws[0].x; pinky.tgt.paws[1].x = POSES.down.paws[1].x;
  toy.chewRate = 15; await wait(tok, 0.8); toy.chew = 0; say('꿀꺽', headTop, 'small', 1.1);
  await wait(tok, 0.7);
  pinky.lookFn = pawPt; pinky.tgt.gaze = 0.85; pinky.sniff = 1; say('킁킁', noseTip); await wait(tok, 0.9);
  pinky.sniff = 0; pinky.lookFn = null; pinky.tgt.gaze = 1; pinky.eyeOpen = 1;
  toy.lap = 1; say('쩝쩝', headTop, '', 1.2, 80); await wait(tok, 0.7); toy.lap = 0;
  pinky.tiltT = 0.3; pinky.wagAmpT = 0.75; pinky.wagSpeedT = 13; say('달다…', headTop, 'soft', 1.6); heart();
  await wait(tok, 1.5);
  say('하나만 더…?', headTop, 'soft', 2.2); pinky.earPerk = 0.5;
  await wait(tok, 2.0); pinky.tiltT = 0; pinky.earPerk = 0;
  goguma.reset(); toyOff(); camHome();
}
const TREATS = { yogurt: yogurtTreat, goguma: gogumaTreat };

// ---------- 고르기 메뉴 (간식 · 놀아주기 버튼을 누르면 뜬다)
const PICKS = {
  treat: [['gum', '🦴', '껌'], ['yogurt', '🥛', '요거트'], ['goguma', '🍠', '고구마 말랑이']],
  play: [['ball', '🎾', '공'], ['rope', '🪢', '로프']],
};
const pickerEl = $('#picker'), pickBack = $('#pickBack');
let pickerFor = null;
function placePicker() {
  if (!pickerFor) return;
  const r = pickerFor.getBoundingClientRect(), bar = actionsEl.getBoundingClientRect(), s = pickerEl.style;
  if (innerWidth <= 760) { s.left = bar.left + 'px'; s.width = bar.width + 'px'; s.bottom = innerHeight - bar.top + 8 + 'px'; }
  else { s.width = ''; const w = pickerEl.offsetWidth, x = clamp(r.left + r.width / 2 - w / 2, 12, innerWidth - w - 12); s.left = x + 'px'; s.bottom = innerHeight - bar.top + 10 + 'px'; }
  pickerEl.style.setProperty('--caret', r.left + r.width / 2 - pickerEl.getBoundingClientRect().left + 'px');
}
const pickerIdle = () => (!active || active.name === 'roam') && pinky.tgt.name !== 'curl';
function openPicker(btn, focus) {
  closePicker();
  pickerFor = btn; const menu = btn.dataset.menu;
  pickerEl.setAttribute('aria-label', menu === 'treat' ? '간식 고르기' : '장난감 고르기');
  pickerEl.replaceChildren(...PICKS[menu].map(([kind, ic, label]) => {
    const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'menuitem'); b.dataset.pick = kind; b.tabIndex = -1;
    const i = document.createElement('span'); i.className = 'ic'; i.setAttribute('aria-hidden', 'true'); i.textContent = ic;
    b.append(i, label); return b;
  }));
  pickerEl.hidden = false; pickBack.hidden = false; $('#roomUI').classList.add('picking');
  btn.classList.add('open'); btn.setAttribute('aria-expanded', 'true');
  placePicker();
  if (focus) pickerEl.firstChild.focus();
  if (pickerIdle()) { pinky.earPerk = 0.6; pinky.tiltT = 0.15; pinky.wagAmpT = Math.max(pinky.wagAmpT, 0.6); pinky.wagSpeedT = Math.max(pinky.wagSpeedT, 13); } // 뭘 고르나 귀를 쫑긋하고 쳐다본다
}
function closePicker(refocus = false, chosen = false) {
  if (!pickerFor) return;
  const btn = pickerFor; pickerFor = null;
  pickerEl.hidden = true; pickBack.hidden = true; $('#roomUI').classList.remove('picking');
  btn.classList.remove('open'); btn.setAttribute('aria-expanded', 'false');
  if (refocus) btn.focus({ preventScroll: true });
  if (!chosen && pickerIdle()) { pinky.earPerk = 0; pinky.tiltT = 0; pinky.wagAmpT = 0.3; pinky.wagSpeedT = 6; }
}
pickBack.addEventListener('pointerdown', (e) => { e.preventDefault(); closePicker(); });
pickerEl.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-pick]'); if (!b || !pickerFor) return;
  const name = pickerFor.dataset.menu, kind = b.dataset.pick, kb = e.detail === 0, opener = pickerFor;
  closePicker(false, true); if (kb) opener.focus({ preventScroll: true });
  startCommand(name, (tok) => CMDS[name](tok, kind));
});
pickerEl.addEventListener('keydown', (e) => {
  const items = [...pickerEl.querySelectorAll('button')], i = items.indexOf(document.activeElement);
  const go = (j) => { e.preventDefault(); items[(j + items.length) % items.length].focus(); };
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') go(i + 1);
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') go(i - 1);
  else if (e.key === 'Home') go(0);
  else if (e.key === 'End') go(items.length - 1);
  else if (e.key === 'Tab') closePicker();
  else if (e.key === 'Escape') { e.stopPropagation(); closePicker(true); }
});
window.addEventListener('resize', placePicker);

actionsEl.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-cmd]'); if (!b) return;
  if (b.dataset.menu) { if (pickerFor === b) closePicker(); else openPicker(b, e.detail === 0); return; } // 간식 · 놀아주기는 먼저 무엇으로 할지 고른다
  closePicker(false, true);
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
  resetTransient(pinky); Object.assign(pinky, { wasCurl: 0, wakeT: 0, sigh: 0, curlK: 0, napEnd: 0 }); for (const L of pinky.legs) L.hip.rotation.y = 0; cushGo = false;
  setPose(pinky, 'stand', 50);
  const st = poseFor('stand', pinky);
  for (const k of POSE_KEYS) pinky.cur[k] = st[k];
  st.paws.forEach((v, i) => pinky.cur.paws[i].copy(v)); pinky.cur.lean = [...st.lean]; pinky.cur.abd = [...st.abd];
  mound.amount = 0; updateMound();
  resetProps();
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
  updateDog(pinky, dt, t, roomCam.position); napPost(pinky, dt, t);
  updateHand(handR, 1, dt); updateHand(handL, -1, dt);
  toyPost(pinky, dt, t);
  stepCrumbs(dt); stepKibble(dt); stepBall(dt);
  stepRope(dt);
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
  cancelActive(); clearBubbles(); releaseHands(); closePicker(); touch.active = false; drag = null; idleT = Infinity;
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
  if (mode !== 'select') { if (e.key === 'Escape') { if (pickerFor) closePicker(true); else goSelect(); } return; }
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
if (location.hostname === 'localhost') window.__dbg = { pinky, setPose, startCommand, CMDS, look, cam, ball, goRoom, goSelect, roomCam, CUSH, POSES, CURL, fitCurl, NAP: (pk) => { Object.assign(pk, { x: SPOTS.cushion.x, z: SPOTS.cushion.z, yaw: CUSH.yaw, face: null, lift: cushLift(Math.hypot(CUSH.px, CUSH.pz)), eyeOpen: 0.04, wagAmpT: 0.03, curlK: 1 }); setPose(pk, 'curl', 50); }, SPOTS, HOME, handR, handL, treat, rope, ROPE_REST, yogurt, yogurtDab, goguma, buildYogurt, buildGoguma, releaseProps, resetProps, toy, sitAs, SIT_F, tick: (dt) => { clock += dt; stepTimers(); updateRoom(dt, clock); stepBubbles(dt, roomCam); }, isActive: () => active && active.name };
