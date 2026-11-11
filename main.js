import * as THREE from 'three';
import { EffectComposer } from './vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from './vendor/jsm/postprocessing/ShaderPass.js';
import { sound } from './sound.js?v=20';

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
  // 담이: 젊고 또렷한 삼색. 진한 나무 갈색(붉은 기 도는 황갈) · 회색 털이 거의 없는 검은 안장 · 새하얀 가슴·다리·꼬리 끝 · 회색 하네스
  dami: { base: 0xf6f2ec, tan: 0x9a5c2a, headTan: 0xa96833, ear: 0x94532a, saddle: 0x0b0b0c, grizzle: 0x2a2a2e, nose: 0x0b0a0a, collar: 'harness', harness: 0xb6bac0 },
  // 푸푸: 크림빛 흰 진돗개. 귀 뒤·귀 끝은 따뜻한 황갈, 콧등·볼은 옅은 황갈 기운, 귀 안은 분홍, 꼬리 긴 털은 황갈 크림, 분홍빛 갈색 코, 청록 끈 목줄에 청록 별 이름표
  pupu: { base: 0xf2e9da, snow: 0xfaf6ef, tan: 0xd9a066, headTan: 0xe6c9a0, saddle: 0xe7d0ab, earIn: 0xe6a29c, tailTan: 0xe8cfa4, nose: 0x7a4845, collar: 'cord', cord: 0x1f9a93, tag: 'star', tagColor: 0x2fb0a6 },
  generic: { base: 0xe9e1d6, tan: 0xc99a6c, saddle: 0x4a3c34, nose: 0x1c1513 },
  friend: { base: 0xd8a462, tan: 0xc98c4a, saddle: 0xc98c4a, nose: 0x1a1210, collar: 0xc23b2e }, // 놀이터 울타리 밖을 지나가는 동네 친구 (누렁이 진돗개 · 빨간 목줄)
};
const P = (x, y, z) => V3(x, y, z);
// 담이 모델은 이 함수 하나에서만 만든다. variant 'dami'는 담이 모델(세모 귀 · 얄상한 몸 · 긴 혀 · 하네스, dami-model 가지)을 고른다 — 그 모델이 아직 없으면 buildDog가 variant를 모르는 채로 비글 몸에 담이 색만 입힌다
// 임시 색: 담이 모델이 COLORS에 담이 색을 넣으면 그 색을 쓴다 (진한 나무 갈색 황갈 · 새까만 안장 · 하얀 다리와 가슴 · 회색 목줄)
COLORS.dami ??= { base: 0xf5f1ea, tan: 0x9a5a26, headTan: 0xa8652b, ear: 0x8a4c1f, saddle: 0x15110f, grizzle: 0x221c18, nose: 0x0a0807, collar: 0x7c8186 };
function makeDami(scale = 1, seed = 11) { return buildDog({ kind: 'beagle', variant: 'dami', colors: COLORS.dami, scale, seed }); }
// 푸푸 모델은 이 함수 하나에서만 만든다 (buildDog의 variant 'pupu': 하얀 진돗개 — 쫑긋 선 귀 · 등 위로 말린 꼬리 · 웃는 입 · 청록 별 이름표)
function makePupu(scale = 1, seed = 5) { return buildDog({ kind: 'jindo', variant: 'pupu', colors: COLORS.pupu, scale, seed }); }
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
const CUSH = { x: 0.66, z: -1.72, R: 0.33, yaw: -1.1, chin: -0.5, lift: 0.028, px: 0.05, pz: -0.035 }; // (px, pz): 누울 때 몸 중심이 놓이는 자리(방석 가운데 기준)
const cushAng = (x, z) => { const a = Math.atan2(x, z) - CUSH.chin; return Math.atan2(Math.sin(a), Math.cos(a)); };
const cushChin = (x, z) => Math.exp(-((cushAng(x, z) / 0.5) ** 2)); // 턱 자리: 테두리가 눌려 낮아진 곳 (1 = 한가운데)
const cushDent = (x, z) => Math.exp(-(((x - CUSH.px) / 0.19) ** 2 + ((z - CUSH.pz) / 0.19) ** 2)); // 늘 눕는 자리: 가운데 베개가 꺼진 곳
// 도넛 방석: 통통하고 울퉁불퉁한 테두리(턱 자리는 눌려 있다) + 낮고 푹 꺼진 가운데 베개 + 납작한 바닥
const cushSDF = (x, y, z) => {
  const r = Math.hypot(x, z), a = Math.atan2(x, z), chin = cushChin(x, z);
  const lump = 0.0045 * Math.sin(a * 3 + 0.6) + 0.0022 * Math.sin(a * 5 + 2.1); // 솜이 고르지 않아 생기는 완만한 굴곡만(접힌 주름이나 꽃잎 같은 골은 없다)
  const R = CUSH.R + 0.006 * Math.sin(a * 2 + 1), rx = 0.11 + lump + 0.014 * chin, ry = (0.114 + lump * 0.8) * (1 - 0.3 * chin);
  const px = (r - R) / rx, py = (y - ry * 0.9) / ry, k0 = Math.hypot(px, py), k1 = Math.hypot(px / rx, py / ry);
  const rim = k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(rx, ry);
  let pil = sdE(x, y, z, 0, 0.018, 0, 0.3, 0.05, 0.3) - 0.003 * Math.sin(x * 23 + 1.3) * Math.sin(z * 19 + 0.4);
  pil = smax(pil, -sdE(x, y, z, CUSH.px, 0.112, CUSH.pz, 0.22, 0.07, 0.22), 0.05); // 핑키가 늘 눕는 자리
  return Math.max(smin(rim, pil, 0.03), -y);
};
// 몸을 말고 자기: 가슴으로 엎드린 채 허리가 옆으로 C자로 휘고(bendY), 등이 둥글게 말리며(lumbar), 목을 숙여(neck) 턱을 테두리에 올린다.
// 발 위치는 fitCurl이 '엎드려' 자세의 접힌 다리를 휜 골반에 그대로 실어 옮겨서 정한다(다리 길이가 달라져도 따라간다). 다리·머리·꼬리가 옆으로 도는 것은 napPost가 맡는다
POSES.curl = { bodyY: 0.132, bodyZ: 0, pitch: 0.1, roll: 0, yawOff: 0, gaze: 0, headPitch: -0.72, headTilt: 0.16, tail: -1.15, level: 1, free: 0, splay: 0.2, neck: 0.85, lumbar: 0.2, bendY: -1.6,
  lean: [...POSES.down.lean], paws: POSES.down.paws.map((v) => v.clone()) };
POSES_J.curl = { ...POSES_J.down, gaze: 0, headPitch: 0.3 }; // 진돗개는 그냥 엎드려 고개만 숙인다
// hip: 다리별 옆으로 도는 각(뒷다리는 골반이 휜 각을 따른다) · head: 머리가 옆으로 도는 각 · front: 앞발을 엎드려보다 몸 쪽으로 당기는 양(몸 기준)
// tail: [뒤로 눕히는 각, 뿌리에서 몸 안쪽으로 접히는 각, 그 뒤로 끝까지 완만하게 더 휘는 각, 베개 위로 내려앉는 높이] — 꼬리는 통째로 도는 막대가 아니라 뿌리부터 끝까지 휜다(bendTail)
const CURL = { hip: [0.5, 0.35, 0, 0], head: 1.5, tail: [-1.45, 1.3, 1.1, 0.01], ear: { '1': [-0.15, -0.35], '-1': [-0.4, 0.12] }, front: [[0, 0.012, -0.075], [0, 0.004, -0.05]] };
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
  const sg = -Math.sign(POSES.curl.bendY || -1), len = d.dami ? DAMI_TAIL_LEN : 0.28, N = 56, h = len / N, [, fold, arc, drop] = CURL.tail, TP = d.dami ? DAMI_TAIL_P : TAIL_P;
  const tab = d.tailTab || (d.tailTab = new Float32Array((N + 1) * 4)); // 가운데 선: [옆, 길이 방향, 굽힘각(+면 +x 쪽), 원래 칼 모양으로 들린 높이]
  let cx = 0, cy = 0;
  for (let i = 0; i <= N; i++) {
    const t = i * h, ph = sg * s * (fold * (1 - Math.exp(-t / 0.022)) + (arc * t) / len) + (k * Math.min(t, 0.25)) / 0.25;
    let zc = 0; for (let q = 0; q < TP.length - 1; q++) { const a = TP[q], b = TP[q + 1]; if (t >= a[1]) zc = lerp(a[2], b[2], clamp((t - a[1]) / (b[1] - a[1]), 0, 1.4)); }
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
  const on = d.tgt.name === 'curl' ? 1 : 0, k0 = d.curlK || 0, w0 = d.tailW || 0, wOn = on || d.tailWrap ? 1 : 0;
  if (!wOn && k0 < 0.002 && w0 < 0.002) {
    if (d.curlK) { d.curlK = 0; d.curlS = 0; for (const L of d.legs) L.hip.rotation.y = 0; }
    d.tailW = 0; bendTail(d, 0); if (d.napLids) for (const g of d.napLids) g.visible = false;
    return;
  }
  // 엉덩이는 무겁게 천천히 넘어가고(1.9초), 깰 때도 휙 풀리지 않는다(1.2초): 일정한 빠르기로 가되 처음과 끝은 부드럽게.
  // 꼬리는 따로, 더 느리게: 엎드릴 때부터 몸 곁으로 돌아와 감기고, 일어날 때는 몸보다 늦게 풀린다
  const K = d.curlK = clamp(k0 + clamp(on - k0, -dt / 1.2, dt / 1.9), 0, 1), s = d.curlS = K * K * (3 - 2 * K), c = d.cur;
  const W = d.tailW = clamp(w0 + clamp(wOn - w0, -dt / 1.9, dt / 2.4), 0, 1), sT = W * W * (3 - 2 * W);
  d.legs.forEach((L, i) => { L.hip.rotation.y = CURL.hip[i] * s; });
  const sigh = d.sigh || 0, br = Math.sin(t * 1.5) * (1 + sigh * 0.3) + sigh * 1.4; // 자는 숨: 느리고 깊게 (한숨 쉴 때는 한 번 크게 부푼다)
  d.torso.scale.x *= 1 + 0.06 * br * s; d.torso.scale.y *= 1 + 0.035 * br * s;
  d.body.position.y += 0.004 * br * s;
  d.hp.rotation.y += CURL.head * s * (1 - c.gaze * 0.6);
  d.hp.rotation.x += 0.012 * br * s * (1 - c.gaze);
  for (const e of d.ears) { const o = CURL.ear[e.side]; e.g.rotation.x += o[0] * s; e.g.rotation.z += o[1] * s; } // 귀: 고개를 숙이고 옆으로 뉘었으니 중력을 따라 볼과 방석 테두리 위로 늘어진다
  const r = d.tail.rotation, wag = r.z * (1 - 0.5 * sT); // 꼬리: 골반을 따라 돌고, 뒤로 누워 몸 안쪽으로 감긴다 (살랑·탁탁은 그대로)
  _q0.setFromAxisAngle(_yAx, c.bendY * s); _q1.setFromAxisAngle(_xAx, lerp(r.x, CURL.tail[0], sT)); _q0.multiply(_q1);
  _q1.setFromAxisAngle(_zAx2, wag); d.tail.quaternion.copy(_q0.multiply(_q1));
  bendTail(d, sT);
  if (d.napLids) { const v = s * ss(0.3, 0.1, d.eyeY); for (const g of d.napLids) { g.visible = v > 0.02; g.scale.set(1, Math.max(v, 0.05), 1); } }
}
const POSE_KEYS = ['bodyY', 'bodyZ', 'pitch', 'roll', 'yawOff', 'gaze', 'headPitch', 'headTilt', 'tail', 'level', 'free', 'splay', 'neck', 'lumbar', 'bendY', 'tailCurl', 'reach']; // splay: 뒷다리를 옆으로 벌리는 각(앉기) · neck: 목을 앞으로 굽히는 각(앉기 — 몸이 뒤로 기울어도 머리는 가슴 앞 위에)

function poseFor(name, d) {
  const p = (d.pupu && PUPU_POSES[name]) || (d.J ? POSES_J : POSES)[name];
  const o = { ...p, name, splay: p.splay ?? 0, neck: p.neck ?? 0, lumbar: p.lumbar ?? 0, bendY: p.bendY ?? 0, tailCurl: p.tailCurl ?? 0, reach: p.reach ?? 0, abd: [...(p.abd || [0, 0, 0, 0])], lean: [...p.lean], paws: p.paws.map((v) => v.clone()) };
  if (d.J && (name === 'stand' || name === 'eat')) o.bodyY += 0.035;
  const dm = d.dami && DAMI_POSE[name];
  if (dm) { for (const k in dm) if (k !== 'px' && k !== 'tailCurlF') o[k] = dm[k]; if (dm.px) o.paws.forEach((v) => { v.x *= dm.px; }); }
  const pm = d.pupu && PUPU_POSE[name]; // 푸푸: 다리가 길어 몸 높이(dy)·발 위치(pz)를 고치고 꼬리는 등 위로
  if (pm) { for (const k in pm) if (k !== 'dy' && k !== 'pz') o[k] = pm[k]; if (pm.dy) o.bodyY += pm.dy; if (pm.pz) o.paws.forEach((v, i) => { v.z += pm.pz[i]; }); }
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
// 담이 꼬리: 핑키 것보다 길고 뿌리가 굵으며, 위로 들어 끝으로 가며 등 쪽(앞)으로 완만히 휘는 칼 모양. 끝 1/3은 털이 부풀어 붓처럼 볼록했다가 뾰족하게 모이는 흰 깃털(plume)
const DAMI_TAIL_P = [[0, 0, 0, 0.035], [0, 0.07, -0.006, 0.0305], [0, 0.138, 0.002, 0.026], [0, 0.192, 0.024, 0.025], [0, 0.236, 0.056, 0.0295], [0, 0.262, 0.092, 0.023], [0, 0.272, 0.122, 0.008]];
const DAMI_TAIL_LEN = 0.33; // 꼬리 굽힘(shapeTail)에 쓰는 길이
const damiTailAxis = (y) => { // 꼬리 중심선의 z와 흰 붓 쪽 비율(0..1, 중심선을 따라 잰 위치)
  const P = DAMI_TAIL_P;
  for (let i = 0; i < P.length - 1; i++) if (y <= P[i + 1][1]) return lerp(P[i][2], P[i + 1][2], clamp((y - P[i][1]) / (P[i + 1][1] - P[i][1]), 0, 1));
  return P[P.length - 1][2];
};
const damiTailSDF = (x, y, z) => {
  let d = 1e9;
  const P = DAMI_TAIL_P;
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], b = P[i + 1], by = b[1] - a[1], bz = b[2] - a[2], l2 = by * by + bz * bz;
    const h = clamp(((y - a[1]) * by + (z - a[2]) * bz) / l2, 0, 1), oy = y - a[1] - by * h, oz = z - a[2] - bz * h, L = Math.sqrt(l2);
    const u = (i + h) / (P.length - 1), plume = ss(0.5, 0.68, u) * ss(1.0, 0.86, u); // 흰 붓: 털 다발이 결을 따라 갈라진다
    const th = Math.atan2(x, (oy * bz - oz * by) / L), tuft = plume * (0.0052 * (0.5 + 0.5 * Math.sin(th * 5 + u * 26 + 1.3 * Math.sin(th * 3 - u * 9))) + 0.0022 * (0.5 + 0.5 * Math.sin(th * 9 - u * 41 + 2.1)));
    d = smin(d, Math.hypot(x, oy, oz) - lerp(a[3], b[3], h) - tuft, 0.016);
  }
  return d;
};
// 발: 둥근 발바닥 덩어리 + 발가락 네 개
const footSDF = (x, y, z) => {
  let d = sdE(x, y, z, 0, -0.002, 0.005, 0.037, 0.021, 0.036);
  for (let i = 0; i < 4; i++) { const tx = (i - 1.5) * 0.017; d = smin(d, sdE(x, y, z, tx, -0.012, 0.025 + (Math.abs(i - 1.5) < 1 ? 0.003 : 0), 0.011, 0.012, 0.014), 0.012); } // 발가락은 한 덩어리 둥근 앞코로 뭉친다 (발은 발목보다 1.25배 넓은 둥근 주먹)
  return d;
};
// ---------- 담이(두 번째 비글): 핑키보다 젊고 얄상하다. 몸·귀·입·혀만 따로 만들고 나머지(다리 관절·머리뼈)는 핑키 것을 그대로 쓴다
// 몸통: 핑키 몸을 옆으로 좁히고(0.88) 배를 더 올려붙여 허리가 잘록하다
const damiBodySDF = (x, y, z) => smax(beagleBodySDF(x / 0.88, y, z) * 0.9, -sdE(x, y, z, 0, -0.2, -0.08, 0.3, 0.092, 0.115), 0.045);
// 귀: 핑키보다 짧고(0.125) 조금 높이 붙은 세모꼴 — 위는 접혀 좁고, 위 1/3에서 가장 넓다가 아래로 갈수록 뒤 가장자리가 비스듬히 좁아져 앞쪽에 둥근 뾰족 끝이 생긴다
// 귀(귀엽게): 위 절반은 넉넉히 넓고 아래 절반에서 둥글게 좁아져 끝이 살짝 뾰족한 둥근 세모(잎사귀 꼴) — 판이 볼을 감싸듯 둥글게 휘어 납작한 판이 아니다
const EAR_LD = 0.15;
let DAMI_EAR_IN = 0.2; // 귀를 볼 쪽으로 모으는 각 (라디안)
const damiEarFrame = (sx, x0, y, z) => {
  const t = clamp(-y / EAR_LD, 0, 1), xo = x0 * sx, nar = 1 - 0.58 * ss(0.3, 1.0, t) - 0.24 * ss(0.78, 1.0, t);
  const hw = lerp(0.031, 0.047, ss(0.0, 0.2, t)) * nar, wc = 0.047 * (1 - nar) * 0.5; // wc: 좁아지는 만큼 끝을 앞 가장자리 쪽으로 (앞 가장자리는 곧게 내려온다)
  const phi = lerp(0.45, 0.74, ss(0.0, 0.6, t)), cph = Math.cos(phi), sph = Math.sin(phi);
  const cx = lerp(0.011, 0.022, ss(0, 0.45, t)) + 0.045 * sph, cz = lerp(0.008, 0.024, ss(0.15, 1, t));
  const dx = xo - cx, dz = z - cz;
  const w = -dx * sph + dz * cph - wc, n0 = dx * cph + dz * sph, q = w / hw, body = ss(0.06, 0.3, t) * ss(1.0, 0.6, t);
  const qc = clamp(q, -1.15, 1.15), curl = (qc > 0 ? 0.011 : 0.013) * qc * qc, chan = 0.003 * Math.exp(-(((q - 0.2) / 0.32) ** 2)) * body, fold = 0.0026 * Math.exp(-(((t - 0.17) / 0.05) ** 2));
  return { t, hw, w, q, chan: chan / 0.003, n: n0 - 0.004 * ss(0.02, 0.3, t) + curl + chan + fold + 0.009 * ss(0.72, 1, t) };
};
const damiEarSDF = (sx) => (x0, y, z) => {
  if (y > 0.03 || y < -0.165) return Math.max(y - 0.02, -0.155 - y, 0.004);
  const { t, hw, w, q, n } = damiEarFrame(sx, x0, y, z);
  const rr = Math.min(lerp(0.018, 0.0125, ss(0.3, 1, t)), hw * 0.97), qx = Math.abs(w) - (hw - rr), qy = Math.abs(y + EAR_LD / 2) - (EAR_LD / 2 - rr);
  const d2 = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rr;
  const th = (lerp(0.0066, 0.005, ss(0, 0.5, t)) + 0.0024 * (1 - Math.min(1, q * q))) * (0.7 + 0.3 * ss(0, -0.014, d2)); // 얇고 부드러운 귀 가죽
  const dn = Math.abs(n) - th;
  const d = Math.hypot(Math.max(d2, 0), Math.max(dn, 0)) + Math.min(Math.max(d2, dn), 0) - 0.003;
  const roll = Math.max(Math.hypot(w - (hw - 0.008), n + 0.004) - lerp(0.008, 0.005, t), d2 + 0.003, (t - 0.8) * 0.1, (0.04 - t) * 0.1);
  return smin(d, roll, 0.009);
};
// 담이 얼굴(귀엽게): 핑키 머리뼈를 바탕으로 눈 앞의 주둥이를 앞뒤로 눌러 짧게 하고(DMZ), 볼은 통통하게 · 정수리는 둥글게 — 아기 같은 둥근 얼굴
const DMZ = [0.062, 0.02, 1.2]; // 주둥이 누르기: 시작 z(눈 바로 앞) · 부드럽게 넘어가는 구간 · 배율(주둥이가 1/1.2로 짧아진다)
const damiZ = (z) => { const u = z - DMZ[0], w = DMZ[1]; return z + (DMZ[2] - 1) * (u <= 0 ? 0 : u < w ? (u * u) / (2 * w) : u - w / 2); };
const damiZInv = (zp) => { let z = zp; for (let i = 0; i < 8; i++) z -= (damiZ(z) - zp) / (1 + (DMZ[2] - 1) * clamp((z - DMZ[0]) / DMZ[1], 0, 1)); return z; };
const damiHB0 = (x, y, z) => {
  let d = headBase0(x, y, damiZ(z));
  for (const sx of [1, -1]) d = smin(d, sdE(x, y, z, sx * 0.04, 0.021, 0.036, 0.031, 0.032, 0.04), 0.02); // 통통한 볼: 눈 밑에서 주둥이 뿌리를 감싼다
  return smin(d, sdE(x, y, z, 0, 0.068, -0.006, 0.07, 0.058, 0.062), 0.03); // 둥근 정수리·이마
};
// 입: 같은 머리뼈를 입선에서 잘라 아래턱을 따로 만든다 — 담이는 입을 벌리고 혀를 길게 내민다.
// 입선은 'ω': 코 밑 인중에서 가운데가 솟고, 양쪽 윗입술 밑으로 둥글게 내려갔다가 입꼬리 쪽으로 올라간다(다물어도 웃는 입)
const DJ = [0, -0.014, 0.06]; // 아래턱 경첩(머리 좌표) = jaw 그룹 자리
const damiCutY = (x, z) => -0.0222 + 0.0062 * Math.exp(-((x / 0.0068) ** 2)) + 0.009 * ss(0.088, 0.052, z);
const damiJawR = (x, y, z) => { const cy = damiCutY(x, z); return smax(y - cy, 0.065 + (cy - y) * 0.75 - z, 0.002); }; // 아래턱 자리(음수 = 안): 입선 아래, 뒤쪽 경계는 아래로 갈수록 앞으로 물러나는 쐐기
const damiSeam = (z) => lerp(0.0006, 0.0016, ss(0.072, 0.092, z)); // 잘린 입선의 둥근 테: 앞(ω 입선)은 도톰하고, 입꼬리 쪽은 꼭 맞물려 옆에서 골이 길게 보이지 않는다
const damiHeadSDF = (x, y, z) => {
  const d = smax(damiHB0(x, y, z), -damiJawR(x, y, z), damiSeam(z));
  return smax(d, -sdCap(x, y, damiZ(z), PHIL_TOP[0], PHIL_TOP[1], PHIL_TOP[2], 0, -0.0165, 0.131, 0.0012), 0.004); // 인중
};
const damiJawSDF = (x, y, z) => { const X = x, Y = y + DJ[1], Z = z + DJ[2]; return smax(damiHB0(X, Y, Z) + 0.0004 * ss(0.072, 0.092, Z), damiJawR(X, Y, Z), damiSeam(Z)); };
// 혀(길게 늘어진 부분): 입 안 바닥에서 아랫입술을 넘어 턱 앞으로 늘어진 둥근 혀 — 위에서 보면 뿌리는 조금 좁고 끝은 넓게 둥근 주걱(U자) 꼴,
// 단면은 가운데가 도톰하고 가장자리로 얇아지며 살짝 위로 오므라든다. (y, z) 꺾은선 = 혀 가운데 선
const TONGUE_P = ((P) => { const o = []; for (let i = 0; i < P.length - 1; i++) for (let k = 0; k < 4; k++) { const u = k / 4, a = P[Math.max(i - 1, 0)], b = P[i], c = P[i + 1], e = P[Math.min(i + 2, P.length - 1)]; o.push([0, 1].map((j) => 0.5 * (2 * b[j] + (c[j] - a[j]) * u + (2 * a[j] - 5 * b[j] + 4 * c[j] - e[j]) * u * u + (3 * b[j] - a[j] - 3 * c[j] + e[j]) * u * u * u))); } o.push(P[P.length - 1]); return o; })( // 꺾은선을 부드러운 곡선(캣멀-롬)으로 — 혀에 마디 주름이 생기지 않게
  [[0.002, -0.026], [0.001, 0], [-0.006, 0.0078], [-0.016, 0.0112], [-0.027, 0.0112], [-0.037, 0.0088]]);
const TONGUE_L = (() => { let s = 0; for (let i = 0; i < TONGUE_P.length - 1; i++) s += Math.hypot(TONGUE_P[i + 1][0] - TONGUE_P[i][0], TONGUE_P[i + 1][1] - TONGUE_P[i][1]); return s; })();
let tongueU = 0;
const damiTongueSDF = (x, y, z) => {
  let dm = 1e9, sAt = 0, acc = 0, sd = 1; tongueU = 0;
  for (let i = 0; i < TONGUE_P.length - 1; i++) {
    const [ay, az] = TONGUE_P[i], [by, bz] = TONGUE_P[i + 1], ey = by - ay, ez = bz - az, L = Math.hypot(ey, ez), h = clamp(((y - ay) * ey + (z - az) * ez) / (L * L), 0, 1), dd = Math.hypot(y - ay - ey * h, z - az - ez * h);
    if (dd < dm) { dm = dd; sAt = acc + h * L; sd = Math.sign(ez * (y - ay) - ey * (z - az)) || 1; }
    acc += L;
  }
  tongueU = clamp(sAt / TONGUE_L, 0, 1);
  const W = 0.0172, sE = TONGUE_L - W * 0.95; // 끝: 반지름 W의 둥근 혀끝
  const hw = sAt < sE ? lerp(0.0128, W, ss(0.0, sE, sAt)) : Math.sqrt(Math.max(0, W * W - ((sAt - sE) / 0.95) ** 2));
  const q = clamp(Math.abs(x) / Math.max(hw, 1e-4), 0, 1), th = 0.001 + 0.0022 * Math.sqrt(1 - q * q); // 가운데가 도톰하고 가장자리는 얇다
  const n = dm * sd - 0.0011 * q * q, thF = th - 0.0007 * Math.exp(-((x / 0.0032) ** 2)) * ss(0.15, 0.4, tongueU); // 가장자리가 윗면(앞) 쪽으로 살짝 오므라들고, 윗면 가운데에 세로 골
  const dn = n > 0 ? n - thF : -n - th, dw = Math.abs(x) - hw;
  return Math.hypot(Math.max(dw, 0), Math.max(dn, 0)) + Math.min(Math.max(dw, dn), 0) - 0.0006;
};
// 자세: 담이는 꼬리를 위로 든다(흰 꼬리 끝이 깃발처럼). 몸이 좁아 발도 조금 안쪽에 딛는다
const DAMI_POSE = { stand: { tail: -0.42, px: 0.9 }, sit: { tail: 0.6, tailCurl: 0.25, tailCurlF: 0.85, px: 0.9 }, down: { tail: -1.25, px: 0.92 }, eat: { tail: -0.7, px: 0.9 }, held: { tail: -0.9 }, side: { tail: -1.2 }, belly: { tail: -1.1 } };

// ---------- 푸푸(하얀 진돗개): buildDog({ kind: 'jindo', variant: 'pupu' }). 핑키·담이와 같은 관절 틀(목·허리 굽힘 · 다리 3마디 · 자세)을 쓰고 몸·머리·귀·꼬리만 진돗개로 만든다
// 크림빛 흰 털 · 귀 뒤와 귀 끝은 따뜻한 황갈, 귀 안은 분홍 · 쫑긋 선 세모 귀 · 등 위로 말린 복슬복슬한 꼬리 · 분홍빛 갈색 코 · 크게 벌려 웃는 입과 분홍 혀 · 청록 끈 목줄에 '푸푸' 별 이름표
const PUPU_LEG = 1.1, PUPU_SMILE = 0.34, PUPU_COLLAR_C = [0.125, 0.168], PUPU_COLLAR_AX = [0.7, 0.72]; // PUPU_SMILE: 웃는 입이 벌어지는 각(아래턱) // 다리 마디 길이 배율: 비글보다 다리가 길고 곧다
// 몸통: 비글보다 가슴이 얕고(팔꿈치 높이 = 가슴 바닥) 배가 뒤로 올라붙는다. 목은 굵고 목둘레에 복슬한 갈기(ruff)
const pupuBodySDF = (x, y, z) => {
  let d = sdRB(x, y, z, 0, 0.002, 0.0, 0.082, 0.104, 0.21, 0.06);
  d = smax(d, y - (0.11 - 0.012 * ss(0.05, -0.2, z)), 0.03); // 등선: 거의 수평
  d = smin(d, sdE(x, y, z, 0, -0.01, 0.1, 0.084, 0.1, 0.13), 0.05); // 갈비·가슴 (바닥 -0.11)
  d = smin(d, sdCap(x, y, z, 0, -0.07, 0.19, 0, -0.055, 0.07, 0.04), 0.05); // 앞다리 사이 가슴
  d = smin(d, sdE(x, y, z, 0, 0.0, 0.212, 0.056, 0.064, 0.036), 0.04); // 복슬한 앞가슴
  for (const sx of [1, -1]) d = smin(d, sdE(x, y, z, sx * 0.05, -0.04, 0.188, 0.04, 0.088, 0.062), 0.045); // 어깨·위팔 (팔꿈치까지 감싼다)
  d = smin(d, sdE(x, y, z, 0, 0.008, -0.168, 0.088, 0.096, 0.088), 0.045); // 골반·엉덩이
  for (const sx of [1, -1]) d = smin(d, sdE(x, y, z, sx * 0.062, -0.03, -0.176, 0.05, 0.08, 0.074), 0.06); // 허벅지 뿌리
  d = smin(d, sdE(x, y, z, 0, -0.05, -0.175, 0.095, 0.058, 0.078), 0.05); // 앉으면 바닥에 닿는 엉덩이 아래
  d = smin(d, sdCap(x, y, z, 0, 0.01, 0.05, 0, 0.13, 0.17, 0.066), 0.05); // 굵은 목
  d = smin(d, sdCap(x, y, z, 0, 0.13, 0.17, 0, 0.168, 0.198, 0.056), 0.04); // 목 윗부분
  d = smin(d, sdE(x, y, z, 0, 0.09, 0.165, 0.08, 0.072, 0.062), 0.05); // 목둘레 갈기
  d = smin(d, sdE(x, y, z, 0, 0.066, -0.232, 0.03, 0.03, 0.03), 0.03); // 꼬리 뿌리 (엉덩이 위에 높이 붙는다)
  return smax(d, -sdE(x, y, z, 0, -0.203, -0.08, 0.28, 0.09, 0.12), 0.06); // 배가 뒤로 살짝 올라붙는다(tuck-up)
};
// 머리: 넓고 평평한 이마 · 복슬한 볼 · 끝으로 가며 좁아지는 쐐기 주둥이(귀엽게 조금 짧게). 눈 (±0.0365, 0.063, 0.05) · 코 끝 z≈0.137
const pupuHB0 = (x, y, z) => {
  const ax = Math.abs(x);
  let d = sdE(x, y, z, 0, 0.058, -0.008, 0.068, 0.062, 0.064); // 두개골
  d = smin(d, sdE(x, y, z, 0, 0.082, 0.006, 0.068, 0.034, 0.054), 0.03); // 넓고 평평한 이마
  d = smin(d, sdE(x, y, z, 0, 0.044, -0.036, 0.055, 0.054, 0.046), 0.035); // 뒤통수
  for (const sx of [1, -1]) {
    d = smin(d, sdE(x, y, z, sx * 0.044, 0.024, 0.01, 0.032, 0.038, 0.042), 0.03); // 눈 밑 볼
    d = smin(d, sdE(x, y, z, sx * 0.052, 0.004, -0.008, 0.032, 0.04, 0.042), 0.035); // 복슬한 볼털
  }
  d = smin(d, sdE(x, y, z, 0, -0.016, -0.004, 0.052, 0.032, 0.058), 0.035); // 턱 밑·목덜미
  d = smin(d, sdE(x, y, z, 0, 0.036, 0.058, 0.036, 0.03, 0.05), 0.03); // 이마에서 콧등으로 이어지는 완만한 단(stop)
  const t = clamp((z - 0.04) / 0.1, 0, 1), cy = lerp(0.014, 0.001, t), hw = lerp(0.034, 0.0225, t), hh = lerp(0.031, 0.0205, t) + 0.0025 * Math.sin(Math.PI * t), rr = 0.014; // 주둥이: 뿌리는 넓고 끝으로 좁아지며 콧등이 살짝 내려간다
  const qx = ax - (hw - rr), qy = Math.abs(y - cy) - (hh - rr);
  let m = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rr;
  m = smax(m, z - 0.145 + 7 * ax * ax + 8 * (y - cy) * (y - cy), 0.018); // 둥근 주둥이 끝
  d = smin(d, Math.max(m, 0.02 - z), 0.03);
  d = smin(d, sdE(x, y, z, 0, -0.023, 0.095, 0.02, 0.011, 0.042), 0.01); // 아래턱·턱 끝
  for (const sx of [1, -1]) d = smax(d, -sdE(x, y, z, sx * 0.0365, 0.063, 0.063, 0.0168, 0.0152, 0.008), 0.005); // 눈자리
  return d;
};
// 웃는 입: 입선은 코 밑 인중에서 'ω'로 갈라져 입꼬리(눈 밑 뒤쪽)로 올라간다. 그 아래를 아래턱(jaw)으로 떼어 내 입을 크게 벌린다
const PJ = [0, -0.01, 0.054]; // 아래턱 경첩(머리 좌표) = jaw 그룹 자리
const pupuCutY = (x, z) => -0.0128 + 0.004 * Math.exp(-((x / 0.0065) ** 2)) + 0.0105 * ss(0.1, 0.056, z);
const pupuJawR = (x, y, z) => { const cy = pupuCutY(x, z); return smax(smax(y - cy, 0.054 + (cy - y) * 0.8 - z, 0.002), Math.abs(x) - 0.036, 0.004); };
const pupuSeam = (z) => lerp(0.0008, 0.0016, ss(0.07, 0.1, z));
const pupuHeadSDF = (x, y, z) => smax(pupuHB0(x, y, z), -pupuJawR(x, y, z), pupuSeam(z));
const pupuJawSDF = (x, y, z) => { const X = x, Y = y + PJ[1], Z = z + PJ[2]; return smax(pupuHB0(X, Y, Z) + 0.0004 * ss(0.07, 0.1, Z), pupuJawR(X, Y, Z), pupuSeam(Z)); };
// 쫑긋 선 세모 귀 (귀 좌표: x = 귀 폭, y = 위, z = 앞 = 귀 안쪽). 둥근 끝의 세모 판이 가장자리가 앞으로 휘어 오목한 컵이 되고, 뿌리 뒤쪽은 도톰하다
const sdTri2 = (px, py, ax, ay, bx, by, cx, cy) => {
  const e0x = bx - ax, e0y = by - ay, e1x = cx - bx, e1y = cy - by, e2x = ax - cx, e2y = ay - cy;
  const v0x = px - ax, v0y = py - ay, v1x = px - bx, v1y = py - by, v2x = px - cx, v2y = py - cy;
  const h0 = clamp((v0x * e0x + v0y * e0y) / (e0x * e0x + e0y * e0y), 0, 1), h1 = clamp((v1x * e1x + v1y * e1y) / (e1x * e1x + e1y * e1y), 0, 1), h2 = clamp((v2x * e2x + v2y * e2y) / (e2x * e2x + e2y * e2y), 0, 1);
  const s = Math.sign(e0x * e2y - e0y * e2x);
  const q0 = (v0x - e0x * h0) ** 2 + (v0y - e0y * h0) ** 2, q1 = (v1x - e1x * h1) ** 2 + (v1y - e1y * h1) ** 2, q2 = (v2x - e2x * h2) ** 2 + (v2y - e2y * h2) ** 2;
  const w = Math.min(s * (v0x * e0y - v0y * e0x), s * (v1x * e1y - v1y * e1x), s * (v2x * e2y - v2y * e2x));
  return -Math.sqrt(Math.min(q0, q1, q2)) * Math.sign(w);
};
const PUPU_EAR_H = 0.1;
const pupuEarZ = (x, t) => 18 * Math.min(x * x, 0.0021) - 0.008 * t * t; // 귀 판의 가운데 면(가장자리가 앞으로 휜 컵, 끝은 살짝 뒤로)
const pupuEarSDF = (x, y, z) => {
  if (y < -0.04 || y > 0.115) return Math.max(-0.04 - y, y - 0.115, 0.004);
  const t = clamp(y / PUPU_EAR_H, 0, 1), n = z - pupuEarZ(x, t);
  const d2 = sdTri2(x, y, -0.035, -0.024, 0.035, -0.024, 0, 0.079) - 0.008;
  const thF = lerp(0.0045, 0.0028, t), thB = lerp(0.01, 0.0032, t) + 0.007 * (1 - t) * Math.max(0, 1 - (x / 0.034) ** 2); // 앞(안쪽)은 얇고 뒤는 뿌리 쪽이 도톰하다
  const dn = Math.max(n - thF, -n - thB);
  return Math.hypot(Math.max(d2, 0), Math.max(dn, 0)) + Math.min(Math.max(d2, dn), 0) - 0.0015;
};
// 꼬리: 엉덩이 위에서 곧게 섰다가 앞(등 쪽)으로 둥글게 말려 끝이 등 옆에 닿는 굵은 털 꼬리. 바깥쪽(말린 원의 바깥)에 긴 털이 붓처럼 부푼다
const PUPU_TAIL_P = [[0, 0, 0, 0.024], [0, 0.05, -0.016, 0.03], [0.003, 0.1, -0.014, 0.036], [0.008, 0.142, 0.016, 0.04], [0.016, 0.16, 0.066, 0.039], [0.026, 0.146, 0.11, 0.033], [0.036, 0.112, 0.136, 0.025], [0.044, 0.07, 0.146, 0.012]];
const PUPU_TAIL_C = [0.012, 0.075, 0.062]; // 말린 원의 가운데 (바깥쪽 판별)
const pupuTailSDF = (x, y, z) => {
  let d = 1e9;
  const P = PUPU_TAIL_P, n = P.length - 1;
  for (let i = 0; i < n; i++) {
    const a = P[i], b = P[i + 1], bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2], l2 = bx * bx + by * by + bz * bz;
    const h = clamp(((x - a[0]) * bx + (y - a[1]) * by + (z - a[2]) * bz) / l2, 0, 1), ox = x - a[0] - bx * h, oy = y - a[1] - by * h, oz = z - a[2] - bz * h, L = Math.sqrt(l2);
    const u = (i + h) / n, ol = Math.hypot(ox, oy, oz) || 1;
    const cx = a[0] + bx * h - PUPU_TAIL_C[0], cyy = a[1] + by * h - PUPU_TAIL_C[1], cz = a[2] + bz * h - PUPU_TAIL_C[2], cl = Math.hypot(cx, cyy, cz) || 1;
    const outer = Math.max(0, (ox * cx + oy * cyy + oz * cz) / (ol * cl)); // 말린 원 바깥쪽 = 긴 털
    const th = Math.atan2(ox, (oy * bz - oz * by) / L), plume = ss(0.05, 0.3, u) * ss(1.0, 0.85, u);
    const tuft = plume * (0.0025 * (0.5 + 0.5 * Math.sin(th * 6 + u * 7)) + 0.011 * outer * outer);
    d = smin(d, ol - lerp(a[3], b[3], h) - tuft, 0.028);
  }
  return d;
};
// 자세: 다리가 길어 서 있을 때 몸이 조금 높다(dy). 꼬리는 늘 등 위로 말려 있다. pz: 발 앞뒤 위치를 더한다
const PUPU_POSE = { stand: { dy: 0.026, tail: 0.38 }, eat: { dy: 0.026, tail: 0.3 }, sit: { dy: 0.012, pitch: -0.6, tail: 1.0 }, down: { tail: 0.3, pz: [0.02, 0.02, 0, 0] }, side: { tail: -0.6 }, belly: { tail: -0.6 }, held: { tail: 0 }, curl: { tail: -1.2 } };
// 푸푸만의 자세: 손(앉아서 앞발 하나를 엄마 손바닥 높이로 내민다) · 하이파이브(몸을 세우고 앞발을 높이 들어 발바닥이 앞을 본다)
const PUPU_POSES = {
  paw: { bodyY: 0.205, bodyZ: -0.02, pitch: -0.62, roll: 0, yawOff: -0.6, gaze: 1, headPitch: 0, headTilt: 0.12, tail: 0.15, level: 1, free: 0, splay: 0.3, neck: 0.4, lumbar: 0.55,
    lean: [0.75, 0.05, 1.45, 1.45], paws: [P(0.07, 0.17, 0.3), P(-0.075, 0.03, 0.17), P(0.09, 0.03, 0.02), P(-0.09, 0.03, 0.02)] },
  high5: { bodyY: 0.215, bodyZ: -0.03, pitch: -0.75, roll: 0, yawOff: -0.6, gaze: 1, headPitch: 0, headTilt: -0.1, tail: 0.25, level: 0, free: 0, splay: 0.3, neck: 0.5, lumbar: 0.6,
    lean: [2.7, 0.05, 1.45, 1.45], paws: [P(0.07, 0.37, 0.33), P(-0.07, 0.03, 0.16), P(0.09, 0.03, 0.02), P(-0.09, 0.03, 0.02)] },
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
// 가까이 다가가면 낱낱의 털이 보이고, 멀거나 비스듬해서 털 한 가닥이 한 픽셀보다 작아지면 가닥 대신 반투명한 솜털로 겹쳐 그린다(가장자리가 소금·후추처럼 지글거리지 않고 보송하게 번진다).
// uOA–uOB(몸통), uOH(머리): 핑키가 누워 있는 자리 — 그 둘레의 털은 그늘진다(uOcc)
// uAmb: 방 안에서 사방으로 되비치는 빛(다른 재질은 환경맵으로 받는 빛)을 방석 털도 같은 만큼 받게 한다
const plushU = { uOA: { value: V3() }, uOB: { value: V3() }, uOH: { value: V3() }, uOcc: { value: 0 }, uAmb: { value: new THREE.Color(0, 0, 0) } };
// 두툼한 털은 빛을 머금는다: 법선을 위로 조금 눕혀 밝고 어두운 경계를 완만하게 하고(wrap), 그림자도 털 사이로 빛이 새어 조금 옅다
const plushSoft = (frag, two) => frag
  .replace('#include <shadowmap_pars_fragment>', '#include <shadowmap_pars_fragment>\n#ifdef USE_SHADOWMAP\nfloat plushShadow(sampler2D m, vec2 sz, float bias, float rad, vec4 c){ vec2 o = 7.0 * c.w / sz; float s = getShadow(m, sz, bias, rad, c + vec4(o.x, o.y * 0.4, 0.0, 0.0)) + getShadow(m, sz, bias, rad, c + vec4(-o.x, -o.y * 0.4, 0.0, 0.0));\n' + (two ? '  s *= 0.5;' : '  s = 0.25 * (s + getShadow(m, sz, bias, rad, c + vec4(-o.x * 0.4, o.y, 0.0, 0.0)) + getShadow(m, sz, bias, rad, c + vec4(o.x * 0.4, -o.y, 0.0, 0.0)));') + ' return mix(s, 1.0, 0.42); }\n#endif')
  .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replace(/getShadow\(/g, 'plushShadow('))
  .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n  normal = normalize(normal + (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz * 0.38);')
  .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += uAmb * diffuseColor.rgb;');
const PLUSH_OCC = 'uniform vec3 uOA; uniform vec3 uOB; uniform vec3 uOH; uniform float uOcc; uniform vec3 uAmb;\nfloat plushOcc(vec3 p){ vec3 pa = p - uOA, ba = uOB - uOA; float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-5), 0.0, 1.0); return uOcc * max(smoothstep(0.25, 0.085, length(pa - ba * h)), smoothstep(0.19, 0.07, length(p - uOH))); }\n';
function plushBase(mat) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, plushU);
    sh.vertexShader = 'varying vec3 vOP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vOP = position;');
    sh.fragmentShader = 'varying vec3 vOP;\n' + PLUSH_OCC + plushSoft(sh.fragmentShader).replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb *= 0.8 * (1.0 - 0.55 * plushOcc(vOP));');
  };
  mat.customProgramCacheKey = () => 'plush-base';
  return mat;
}
function plushShells(mesh, count = 8, len = 0.022, den = 380) {
  const shells = [];
  for (let i = 1; i <= count; i++) {
    const f = i / count, mat = new THREE.MeshLambertMaterial({ vertexColors: true, color: mesh.material.color, emissive: mesh.material.emissive, transparent: true, depthWrite: false }); // 솜털은 번들거리지 않는다: 반사광 없는 가벼운 재질
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, plushU);
      sh.uniforms.uShell = { value: f }; sh.uniforms.uLen = { value: len }; sh.uniforms.uDen = { value: den };
      sh.vertexShader = 'uniform float uShell; uniform float uLen; attribute float aFur; varying vec3 vOP; varying float vFur;\n' + sh.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\n  { float L = uShell * uLen * aFur; vec3 tw = vec3(0.35 * sin(position.z * 9.0 + position.x * 5.0), -0.9, 0.35 * cos(position.x * 8.0 - position.z * 6.0)); transformed += normal * L + tw * (uShell * L * 0.16); vOP = position; vFur = aFur; }');
      sh.fragmentShader = 'uniform float uShell; uniform float uDen; varying vec3 vOP; varying float vFur;\n' + PLUSH_OCC + 'float pH(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }\n'
        + 'float pN(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(mix(pH(i), pH(i + vec3(1,0,0)), f.x), mix(pH(i + vec3(0,1,0)), pH(i + vec3(1,1,0)), f.x), f.y), mix(mix(pH(i + vec3(0,0,1)), pH(i + vec3(1,0,1)), f.x), mix(pH(i + vec3(0,1,1)), pH(i + vec3(1,1,1)), f.x), f.y), f.z); }\n'
        + 'float pTint = 1.0;\n'
        + plushSoft(sh.fragmentShader, true)
          .replace('#include <color_fragment>', '#include <color_fragment>\n  { float px = length(fwidth(vOP)) * uDen, far = smoothstep(1.3, 3.0, px), aa = clamp(px * 0.5, 0.03, 0.3);\n'
            + '    float jn = pN(vOP * 150.0), tuft = pN(vOP * 46.0), wisp = pN(vOP * vec3(95.0, 60.0, 95.0) + 5.0);\n'
            + '    vec3 q = (vec3(0.36, 0.48, -0.8) * vOP.x + vec3(-0.8, 0.6, 0.0) * vOP.y + vec3(0.48, 0.64, 0.6) * vOP.z) * uDen + 1.7 * vec3(jn, 1.0 - jn, 2.0 * jn * (1.0 - jn)); float h = pH(floor(q)); float cl = 0.62 + 0.38 * tuft; float top = (0.42 + 0.58 * h) * cl;\n'
            + '    vec3 fr = fract(q) - 0.5; float lim = 0.5 - 0.3 * uShell / top; float aN = uShell > top ? 0.0 : 1.0 - smoothstep(lim - aa, lim + aa, dot(fr, fr));\n' // 가까이: 털 한 가닥 한 가닥
            + '    float edge = 1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))); edge *= edge;\n'
            + '    float aF = clamp(1.0 - (uShell / cl - 0.42) / 0.58, 0.0, 1.0) * clamp((0.5 - 0.42 * uShell / cl) * 1.9, 0.0, 1.0);\n' // 멀리·비스듬히: 그 겹까지 닿는 털의 비율만큼 고르게 비친다
            + '    aF *= mix(1.0, smoothstep(0.2 + 0.35 * uShell, 0.55 + 0.35 * uShell, wisp) * 1.5, edge);\n' // 가장자리는 고른 띠가 아니라 올올이 흩어진 솜털 끝
            + '    float pA = vFur < 0.05 ? 0.0 : mix(aN, min(aF, 1.0), far); if (pA < 0.03) discard; diffuseColor.a *= pA;\n'
            + '    diffuseColor.rgb *= mix(0.7, 1.06, pow(uShell, 0.75)) * (0.87 + 0.24 * tuft) * mix(0.93 + 0.14 * pH(floor(q) + 7.0), 1.0, far) * (1.0 - 0.55 * plushOcc(vOP)); }');
    };
    mat.customProgramCacheKey = () => 'plush-shell';
    const sm = new THREE.Mesh(mesh.geometry, mat); sm.castShadow = false; sm.receiveShadow = true; sm.renderOrder = 2 + i; mesh.add(sm); shells.push(sm); // 안쪽 겹부터 차례로 겹쳐 그린다
  }
  return shells;
}

function buildDog({ kind, colors: C, silhouette = false, scale = 1, seed = 0, variant = null }) {
  const PU = variant === 'pupu'; // PU: 푸푸 (진돗개지만 비글과 같은 관절 틀 — d.J는 false. 놀이터 친구 진돗개는 variant 없이 예전 모델 그대로)
  const J = kind === 'jindo' && !PU, DM = !J && variant === 'dami'; // DM: 담이 (비글 변형 — 핑키는 variant 없이 그대로)
  const d = { kind, J, scale, seed, meshes: [], ears: [], eyes: [], legs: [] };
  if (DM) Object.assign(d, { dami: true, variant, hipX: 0.056 });
  if (PU) Object.assign(d, { pupu: true, variant, hipX: 0.06, smile: 1, smileK: 1 });
  const CC = PU ? PUPU_COLLAR_C : COLLAR_C, CA = PU ? PUPU_COLLAR_AX : COLLAR_AX; // 목줄 고리 중심(y, z)·고리 면 법선 — 푸푸는 굵은 목 위쪽(턱 밑)에
  const silMat = silhouette ? new THREE.MeshStandardMaterial({ color: 0x2b201b, roughness: 0.9, emissive: 0x170f0b }) : null;
  // 짧고 촘촘한 털: 거친 무광 바탕 + 몸 축을 따라 길게 늘어진 털결 노이즈(차콜 속에 낱낱의 회색 털) + 실루엣 가장자리만 보송하게 밝아지는 솜털(프레넬, 어두운 털에서는 약하게)
  const fur = silMat || new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: J || PU ? 0.9 : 0.88, sheen: J ? 0.35 : PU ? 0.3 : 0.14, sheenRoughness: J || PU ? 0.85 : 0.8, sheenColor: new THREE.Color(J || PU ? 0xfff4e8 : 0xf0e6d8) });
  if (!silMat) {
    fur.onBeforeCompile = (sh) => {
      sh.vertexShader = 'varying vec3 vOP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vOP = position;');
      sh.fragmentShader = 'varying vec3 vOP;\nfloat furLum = 0.5;\nfloat fh3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }\n'
        + 'float vn3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(mix(fh3(i), fh3(i + vec3(1,0,0)), f.x), mix(fh3(i + vec3(0,1,0)), fh3(i + vec3(1,1,0)), f.x), f.y), mix(mix(fh3(i + vec3(0,0,1)), fh3(i + vec3(1,0,1)), f.x), mix(fh3(i + vec3(0,1,1)), fh3(i + vec3(1,1,1)), f.x), f.y), f.z); }\n'
        + sh.fragmentShader
          .replace('#include <color_fragment>', '#include <color_fragment>\n  { vec3 q = vec3(vOP.x * 260.0, vOP.y * 260.0, vOP.z * 34.0); float s = vn3(q) * 0.6 + vn3(q * 2.1) * 0.3 + vn3(q * 4.3) * 0.1; float lum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));\n'
            + (J ? '    diffuseColor.rgb *= mix(0.94, 1.05, s); }' : ((t) => (DM ? t.replace('* 0.4 * dk', '* 0.03 * dk').replace('* 0.35 * dk', '* 0.02 * dk') : t))('    diffuseColor.rgb *= mix(0.9, 1.08, s); float dk = 1.0 - smoothstep(0.1, 0.32, lum); float g1 = vn3(vec3(vOP.x * 900.0, vOP.y * 900.0, vOP.z * 100.0)); float g2 = vn3(vec3(vOP.x * 760.0, vOP.y * 760.0, vOP.z * 85.0) + vec3(7.3, 1.7, 3.1)); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.115, 0.105, 0.095), smoothstep(0.35, 0.9, g1) * 0.4 * dk); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.12, 0.085, 0.055), smoothstep(0.35, 0.9, g2) * 0.35 * dk); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lum), 0.08 * (1.0 - smoothstep(0.2, 0.3, lum))); furLum = lum; }'))) // 차콜 속에 몸 축을 따라 늘어진 밝은 회색 털 가닥(어둡게 하지 않고 밝은 털을 섞는다); 채도 낮추기는 어두운 털에만
          .replace('material.sheenColor = sheenColor;', J ? 'material.sheenColor = sheenColor;' : 'material.sheenColor = sheenColor * mix(0.25, 1.0, smoothstep(0.04, 0.25, furLum));') // 어두운 안장 위의 넓은 광택(비닐 느낌)을 줄인다
          .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n  { float fz = pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 3.0); float lm = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11)); diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.1 + 0.02, fz * 0.3 * smoothstep(0.02, 0.25, lm)); }');
    };
    fur.customProgramCacheKey = () => (J ? 'fur-fuzz-j' : DM ? 'fur-fuzz-d' : 'fur-fuzz-b');
  }
  const cW = new THREE.Color(C.base), cT = new THREE.Color(C.tan), cB = new THREE.Color(C.saddle);
  const cH = new THREE.Color(C.headTan ?? C.tan), cE = new THREE.Color(C.ear ?? C.tan), cG = new THREE.Color(C.grizzle ?? 0x8a8078);
  const cTick = new THREE.Color(DM ? 0x6b3a18 : 0x7d6a59), cTailDark = DM ? cB.clone().lerp(cG, 0.1) : cB.clone().lerp(cG, 0.15).lerp(cTick, 0.4), cRim = new THREE.Color(0x4a3b33), cGrey = new THREE.Color(0xb3aca3), cMouth = new THREE.Color(0x4a2228), cLip = new THREE.Color(0x2e221d), cMuz = new THREE.Color(DM ? 0xf4f0ea : 0xece2d2), cLipSh = new THREE.Color(0x8d7765), cEarGrey = new THREE.Color(0xb7aa9a);
  const earS = DM ? { 1: damiEarSDF(1), '-1': damiEarSDF(-1) } : { 1: earSDF(1), '-1': earSDF(-1) };
  const cFreck = new THREE.Color(0xa88f7c), cMouthIn = new THREE.Color(0x5a2228), cGum = new THREE.Color(0x8a3a44), cLipD = new THREE.Color(0x231b18); // 담이: 주둥이 주근깨 · 입천장 · 잇몸·혀 바닥 · 검은 입술
  const cEyeShade = cE.clone().multiplyScalar(0.85); // 눈 둘레의 따뜻한 그늘(진한 베이지)
  const cSnow = new THREE.Color(C.snow ?? 0xfaf7f1), cPink = new THREE.Color(C.earIn ?? 0xe6a29c), cTailT = new THREE.Color(C.tailTan ?? C.tan), cPRim = new THREE.Color(0x3a2a24); // 푸푸: 가슴·발의 새하얀 털 · 귀 안 분홍 · 꼬리 긴 털의 황갈 크림 · 눈테
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
  // 담이: 또렷한 검은 안장(하네스 목 고리 뒤에서 꼬리 뿌리까지) · 안장 바로 밑부터 넓은 흰 옆구리·배·가슴 · 황갈은 목 옆·어깨·엉덩이·허벅지에만 (회색·황갈 털이 섞인 얼룩 없이)
  const damiBodyPaint = (p, c, leg = 0) => {
    const ax = Math.abs(p.x);
    const n = wob(_pg.set(p.x * 3, p.y * 3, p.z * 0.6), 30) * 0.012 + wob(p, 38) * 0.004; // 흰색·황갈 경계: 털결 따라 살짝 물결
    const ns = wob(_pg.set(p.x * 4, p.y * 4, p.z * 1.5), 30) * 0.006 + (hash3(_pg.set(p.x * 120, p.y * 120, p.z * 120)) - 0.5) * 0.0015; // 안장 경계: 또렷하게
    const lineY = 0.012 - 0.05 * ss(-0.1, -0.25, p.z) + 0.075 * ss(0.03, 0.13, p.z); // 안장 아래 경계: 옆구리 위쪽(몸 높이의 절반 위) — 엉덩이·허벅지 위로는 내려오고, 기갑에서는 등 위로 올라간다
    const fe = (p.y - COLLAR_C[0]) * COLLAR_AX[0] + (p.z - COLLAR_C[1]) * COLLAR_AX[1]; // 목 고리 면에서의 거리(앞이 +)
    let black = ss(lineY - 0.003, lineY + 0.003, p.y + ns) * ss(-0.002, -0.012, fe + ns) * ss(-0.31, -0.26, p.z + ns);
    if (leg) black *= ss(-0.005, 0.03, p.y); // 허벅지 위만 안장, 아래는 황갈
    const chest = ss(0.1, 0.2, p.z + n) * ss(0.14, 0.06, p.y - (p.z - 0.2) * 0.5 + n) * ss(0.11, 0.075, ax + n); // 목 앞 흰 턱받이
    const neck = ss(0.07, 0.13, p.z + n) * ss(0.015, 0.06, p.y + n) * (1 - chest); // 목 옆·목덜미는 머리 황갈로 이어진다
    const rump = leg ? ss(-0.02, 0.02, -p.z) : ss(-0.09, -0.15, p.z + n) * ss(-0.1, -0.065, p.y + n); // 엉덩이·허벅지: 안장 밑 황갈
    _sad.copy(cB).lerp(cG, clamp(0.05 + (hash3(_pg.set(p.x * 80, p.y * 80, p.z * 80)) - 0.5) * 0.1, 0, 0.1));
    c.copy(cW).lerp(cT, Math.max(neck, rump)).lerp(cH, neck * 0.6); // 나머지(가슴·어깨·옆구리·배)는 흰색
    tone(c.lerp(_sad, black), p, 0.04);
  };
  // 푸푸: 크림빛 흰 털 — 등·목덜미·엉덩이 위는 아주 살짝 따뜻하고, 가슴·배는 더 희다
  const pupuBodyPaint = (p, c) => {
    const n = wob(_pg.set(p.x * 3, p.y * 3, p.z * 0.6), 30) * 0.015 + wob(p, 40) * 0.006;
    const warm = ss(0.0, 0.1, p.y + n) * 0.4 + ss(-0.12, -0.22, p.z) * ss(-0.02, 0.06, p.y + n) * 0.25;
    const white = Math.max(ss(-0.03, -0.09, p.y + n) * 0.7, ss(0.15, 0.22, p.z + n) * ss(0.09, 0.0, p.y + n) * 0.7);
    tone(c.copy(cW).lerp(cH, warm * (1 - white)).lerp(cSnow, white), p, 0.035);
  };
  const bodyPaint = J ? (p, c) => tone(c.copy(cW).lerp(cT, ss(0.0, 0.12, p.y) * 0.45), p, 0.05) : DM ? damiBodyPaint : PU ? pupuBodyPaint : (p, c, leg = 0) => {
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
  // 푸푸 얼굴: 크림빛 흰 털에 콧등·볼은 옅은 황갈 기운, 턱 밑은 새하얗다. 눈은 진한 눈테(아이라인), 입선은 검은 입술, 벌린 입 안은 분홍
  const pupuHeadPaint = (p, c) => {
    const n = wob(p, 25) * 0.008 + wob(p, 60) * 0.003, ax = Math.abs(p.x);
    tone(c.copy(cW), p, 0.03);
    const bridge = ss(0.045, 0.07, p.z + n) * ss(0.13, 0.11, p.z) * ss(0.028, 0.012, ax + n * 0.5) * ss(-0.004, 0.012, p.y); // 콧등
    const cheek = Math.exp(-(((ax - 0.046) / 0.022) ** 2 + ((p.y - 0.018) / 0.024) ** 2 + ((p.z - 0.04) / 0.035) ** 2)); // 눈 밑 볼
    const brow = Math.exp(-(((ax - 0.03) / 0.03) ** 2 + ((p.y - 0.1) / 0.02) ** 2 + ((p.z - 0.03) / 0.04) ** 2)); // 눈 위 이마
    const eyeA = Math.exp(-(((ax - 0.037) / 0.026) ** 2 + ((p.y - 0.06) / 0.024) ** 2 + ((p.z - 0.055) / 0.03) ** 2)); // 눈 둘레
    c.lerp(cH, Math.min(0.9, bridge * 0.85 + cheek * 0.45 + brow * 0.45 + eyeA * 0.5));
    c.lerp(cSnow, ss(-0.012, -0.03, p.y + n) * ss(0.0, 0.06, p.z) * 0.8); // 턱 밑·주둥이 아래는 새하얗다
    const ed = Math.hypot((ax - 0.0365) * 0.9, p.y - 0.063 - (ax - 0.0365) * 0.12, (p.z - 0.062) * 0.8);
    c.lerp(cPRim, ss(0.021, 0.0165, ed) * 0.55); // 진한 눈테
    const jr = pupuJawR(p.x, p.y, p.z), hb = pupuHB0(p.x, p.y, p.z), cy = pupuCutY(p.x, p.z);
    if (p.z > 0.03 && Math.abs(jr) < 0.006) { c.lerp(cMouthIn, ss(-0.0012, -0.003, hb) * ss(-0.004, -0.001, jr)); c.lerp(cLipD, ss(-0.0015, 0.0, hb) * Math.exp(-(((jr - 0.0004) / 0.0016) ** 2)) * ss(cy - 0.006, cy - 0.002, p.y) * 0.6); } // 입천장 · 입술 가장자리
  };
  const headPaint = J ? (p, c) => tone(c.copy(cW).lerp(cT, ss(0.1, 0.16, p.y) * 0.4), p, 0.05) : PU ? pupuHeadPaint : (p, c) => {
    const n = wob(p, 25) * 0.012 + wob(p, 60) * 0.004, ax = Math.abs(p.x);
    const muzzle = DM ? ss(0.062, 0.086, p.z + n * 0.6 - ss(0.016, 0.04, ax) * 0.03 + 0.022 * ss(0.006, -0.016, p.y)) * ss(0.056, 0.038, p.y + n * 0.4) // 담이: 흰 주둥이는 눈 밑(단)에서 끝나고 이마·볼은 황갈 — 가는 흰 줄만 이마로 올라간다
      : ss(0.058, 0.098, p.z + n * 0.6 + (p.y - 0.02) * 0.35 - ss(0.022, 0.05, ax) * 0.022); // 흰 주둥이: 콧등은 단(stop) 앞부터 희고, 볼 쪽 경계는 눈 밑에서 입꼬리로 비스듬히 내려간다(볼은 베이지 — 황갈이 눈 밑 콧등 뿌리까지 온다)
    const lowY = lerp(-0.03, -0.018, ss(-0.08, 0.06, p.z));
    const under = ss(0.012, -0.012, p.y - lowY + n); // 턱 밑·목은 흰색
    const up = ss(0.075, 0.105, p.y); // 이마 위쪽
    const bw = (DM ? 0.0032 : 0.005) + Math.max(0, 0.065 - p.y) * 0.3 + (DM ? 0.004 : 0.008) * up; // 눈 사이에서는 가늘고, 아래로는 주둥이 흰색으로, 위로는 정수리 쪽으로 넓어진다
    const blaze = ss(bw + (DM ? 0.006 : 0.016), bw, ax + n * 0.5) * ss(0.025 - 0.07 * up, 0.05 - 0.07 * up, p.z) * (DM ? 1 : 0.62) * (1 - (DM ? 0.2 : 0.6) * ss(0.095, 0.115, p.y)); // 좁은 크림 이마 줄(담이는 또렷한 흰 줄)(흰색이 아니라 크림): 눈 사이에서 이마를 지나 정수리까지
    const white = Math.max(muzzle, under, blaze);
    tone(c.copy(cMuz).lerp(cW, under).lerp(cH, 1 - white), p, 0.035);
    c.lerp(cW, 0.12 * ss(0.075, 0.1, p.y) * (1 - ss(0.03, 0.055, ax)) * (1 - white)); // 이마 가운데는 조금 밝다
    c.lerp(cE, 0.5 * ss(0.055, 0.09, p.y) * ss(0.06, 0.02, p.z) * (1 - white)); // 두개골 모자: 연한 황갈이 한 단계 진하다
    c.lerp(cE, 0.45 * ss(0.03, 0.05, ax) * ss(0.08, 0.02, p.y) * ss(0.1, 0.05, p.z) * (1 - white)); // 볼·관자놀이는 진한 베이지
    if (!DM) c.lerp(cGrey, 0.25 * ss(0.07, 0.1, p.z) * ss(0.01, 0.03, p.y) * ss(0.4, 0.7, hash3(_pg.set(p.x * 70, p.y * 70, p.z * 70)))); // 노견: 콧등이 희끗희끗 (낱낱의 흰 털)
    if (!DM) c.lerp(cGrey, 0.15 * ss(0.035, 0.01, Math.abs(ax - 0.052)) * ss(0.05, 0.08, p.y) * ss(0.05, 0.0, p.z) + 0.15 * ss(0.1, 0.115, p.y) * (1 - white)); // 관자놀이 회색 + 정수리 회색 서리
    const ed = Math.hypot(ax - 0.038, (p.y - 0.061) * 1.0, (p.z - 0.058) * 0.8);
    const ring = ss(0.028, 0.018, ed), halo = ss(0.05, 0.024, ed + (p.y - 0.061) * 0.25); // 눈을 감싸는 부드러운 어두운 눈테 + 눈 둘레 사방의 따뜻한 베이지 그늘
    const tear = ss(0.006, 0.0015, Math.abs(ax - 0.028 + (0.05 - p.y) * 0.15)) * ss(0.05, 0.042, p.y) * ss(0.012, 0.028, p.y) * ss(0.05, 0.065, p.z);
    c.lerp(cEyeShade, halo * 0.6 * (1 - white * 0.4)).lerp(cRim, Math.min(0.85, ring * 0.6 + tear * 0.1));
    if (DM) { // 담이: 하얀 주둥이 옆의 주근깨 · 잘린 입(입천장은 어둡고, 입선 가장자리는 검은 입술)
      const fq = _pg.set(Math.floor(ax / 0.0058), Math.floor(p.y / 0.0058), Math.floor(p.z / 0.0058)), fh = hash3(fq), fx = (fq.x + 0.25 + 0.5 * hash3(_pz.set(fq.x + 3, fq.y, fq.z))) * 0.0058, fy = (fq.y + 0.25 + 0.5 * fh) * 0.0058;
      c.lerp(cFreck, muzzle * ss(0.012, 0.022, ax) * ss(0.02, -0.005, p.y) * ss(0.082, 0.1, p.z) * (fh > 0.55 ? 1 : 0) * ss(0.0019, 0.0009, Math.hypot(ax - fx, p.y - fy)) * 0.75);
      const jr = damiJawR(p.x, p.y, p.z), hb = damiHB0(p.x, p.y, p.z), cy = damiCutY(p.x, p.z);
      if (p.z > 0.05 && Math.abs(jr) < 0.006) { c.lerp(cMouthIn, ss(-0.0012, -0.003, hb) * ss(-0.004, -0.001, jr)); c.lerp(cLipD, ss(-0.0015, 0.0, hb) * Math.exp(-(((jr - 0.0004) / 0.0014) ** 2)) * ss(cy - 0.006, cy - 0.002, p.y) * 0.35 * (1 - 0.7 * ss(0.016, 0.03, ax))); } // 입선 가장자리만 검은 입술 (또렷한 선은 아래 입선 관이 맡는다)
    } else if (p.z > 0.06 && p.y < 0.002) { // 입: 선 자체는 가는 메시(아래 mouthLine)이고, 여기서는 골 안의 부드러운 그늘만 칠한다
      const ld = lipDist(p.x, p.y, p.z), fadeU = 1 - 0.6 * ss(0.65, 1.0, lipU);
      c.lerp(cLipSh, ss(0.008, 0.002, ld) * 0.4 * fadeU).lerp(cLip, ss(0.0032, 0.001, ld) * 0.55 * fadeU);
      c.lerp(cLip, 0.5 * ss(0.003, 0.001, ax) * ss(LIP[0][1] - 0.001, LIP[0][1] + 0.003, p.y) * ss(0.11, 0.12, p.z)); // 인중
    }
    for (const sx of [1, -1]) { // 귀가 볼에 드리우는 부드러운 접촉 그늘
      if (p.x * sx < 0.02) continue;
      const de = DM ? earS[sx](p.x - sx * 0.051, p.y - 0.099, p.z + 0.018) : earS[sx](p.x - sx * 0.05, p.y - 0.092, p.z + 0.02);
      c.multiplyScalar(1 - 0.15 * ss(0.012, 0.0, de));
    }
  };
  // 귀: 머리보다 살짝 진한 베이지. 접힌 위쪽 1/3은 회색 털이 섞이고, 뿌리는 머리색으로 이어지고, 가장자리는 연하다
  // 푸푸 귀: 뒷면은 황갈(뿌리는 크림), 앞면 가운데는 분홍 속살, 안쪽 가장자리는 크림 솜털, 테두리와 끝은 황갈
  const pupuEarPaint = (p, c) => {
    const t = clamp(p.y / PUPU_EAR_H, 0, 1), n = p.z - pupuEarZ(p.x, t), hw = Math.max(0.006, 0.043 * (1 - p.y / 0.1)), q = Math.abs(p.x) / hw;
    const front = ss(-0.0005, 0.0025, n), wv = wob(_pg.set(p.x * 30, p.y * 6, p.z * 30), 40) * 0.08;
    const tan = (1 - front) * (0.35 + 0.6 * ss(0.05, 0.45, t + wv)) + front * Math.max(ss(0.78, 1.0, q + wv) * 0.85, ss(0.62, 0.86, t + wv) * 0.9);
    const pink = front * ss(0.72, 0.42, q + wv) * ss(0.04, 0.16, t) * ss(0.8, 0.58, t + wv);
    const fluff = front * ss(0.4, 0.62, q + wv) * ss(0.95, 0.72, q) * ss(0.75, 0.5, t) * 0.75; // 귀 안 가장자리의 크림 솜털
    tone(c.copy(cW).lerp(cT, clamp(tan, 0, 1) * ss(-0.02, 0.012, p.y)).lerp(cPink, pink).lerp(cW, fluff), p, 0.04);
    c.multiplyScalar(1 - 0.12 * pink * ss(0.5, 0.0, q)); // 오목한 귀 안 깊은 곳은 조금 어둡다
  };
  const earPaint = (sx) => (J ? whitePaint : (p, c) => {
    const { t, w, q, chan, n } = (DM ? damiEarFrame : earFrame)(sx, p.x, p.y, p.z);
    const inner = ss(0.001, -0.004, n);
    const streak = 0.5 + 0.5 * wob(_pg.set(p.x * 40, p.y * 3, p.z * 40), 40); // 아래로 흐르는 가는 털결
    const strand = ss(0.55, 0.95, 0.5 + 0.5 * wob(_pg.set(p.x * 75, p.y * 2.5, p.z * 75), 40)); // 가는 회색 털 가닥
    const griz = (0.3 + 0.7 * streak) * (0.12 + 0.88 * ss(0.38, 0.05, t)) + 0.12 * strand; // 회색 서리는 접힌 위쪽 1/3에 짙고, 가는 가닥은 귀 전체에
    tone(c.copy(cE).multiplyScalar(1 - 0.08 * ss(0.4, 1, t)).lerp(cEarGrey, griz * (DM ? 0.05 : 0.36)).lerp(cH, streak * 0.3).lerp(cH, ss(0.08, 0, t) * 0.3), p, 0.04);
    c.multiplyScalar(1 - 0.13 * chan * (1 - inner) - 0.2 * inner - 0.1 * Math.exp(-(((t - 0.2) / 0.045) ** 2))); // 골·접힌 주름·볼에 닿는 안쪽 면은 어둡다
    c.lerp(cW, ss(0.45, 1.0, Math.abs(q)) * 0.16 * (1 - inner * 0.6) + 0.1 * ss(0.4, 0.95, q) * (1 - inner)); // 도톰한 테두리와 말린 앞 가장자리는 밝다
  });
  // 꼬리: 황갈 바탕, 뿌리 쪽 등면은 차콜, 끝 1/3은 흰 붓
  // 푸푸 꼬리: 크림 바탕, 말린 원 바깥쪽의 긴 털은 황갈 크림, 뿌리는 몸빛
  const pupuTailPaint = (p, c) => {
    const r = Math.hypot(p.y - PUPU_TAIL_C[1], p.z - PUPU_TAIL_C[2]) + wob(_pg.set(p.x * 20, p.y * 20, p.z * 20), 30) * 0.006;
    const outer = ss(0.045, 0.085, r) * ss(0.02, 0.07, p.y + p.z * 0.3);
    tone(c.copy(cW).lerp(cTailT, 0.12 + 0.55 * outer), p, 0.05);
  };
  const tailPaint = J ? whitePaint : PU ? pupuTailPaint : DM ? (p, c) => { // 담이: 뿌리 쪽 등면(앞)은 검고 아랫면은 황갈, 끝 1/3은 흰 붓 — 경계는 털 다발처럼 들쭉날쭉
    const u = p.y / 0.3, fl = wob(_pg.set(p.x * 9, p.y * 2, p.z * 9), 40) * 0.035 + (hash3(_pg.set(p.x * 140, p.y * 140, p.z * 140)) - 0.5) * 0.02;
    const th = Math.abs(Math.atan2(p.x, p.z - damiTailAxis(p.y))) + (hash3(_pg.set(p.x * 260, p.y * 60, p.z * 260)) - 0.5) * 0.3 + wob(_pg.set(p.x * 20, p.y * 6, p.z * 20), 40) * 0.4; // 0 = 등 쪽(앞) … π = 배 쪽
    const dark = ss(2.25, 1.55, th) * ss(0.02, 0.0, u - 0.56 - fl), white = ss(0.58, 0.68, u + fl); // 등면·옆면은 검고, 배 쪽은 황갈 띠(뒤에서 보면 검은 테 사이로 황갈이 보인다)
    tone(c.copy(cT).lerp(cW, 0.12 * ss(0.3, 0.55, u)).lerp(cTailDark, clamp(dark, 0, 1)).lerp(cW, white), p, 0.05);
  } : (p, c) => {
    const dark = DM ? ss(0.16, 0.1, p.y) * (0.5 + 0.5 * ss(-0.006, 0.01, p.z - tailAxisZ(p.y))) : ss(0.19, 0.05, p.y) * (0.35 + 0.65 * ss(-0.004, 0.012, p.z - tailAxisZ(p.y))) * (0.6 + 0.4 * hash3(_pg.set(p.x * 120, p.y * 120, p.z * 120))); // 담이: 꼬리 위쪽은 검고 아래는 황갈, 끝은 흰 붓
    tone(c.copy(cT).lerp(cTailDark, dark).lerp(cW, ss(DM ? 0.15 : 0.185, DM ? 0.2 : 0.245, p.y + wob(_pg.set(p.x * 8, p.y, p.z * 8), 30) * 0.02)), p, 0.05); // 흰 붓은 끝 1/4만
  };
  // 다리 마디: 몸 기준 높이(쉬는 자세)로 황갈→흰색. 색 경계가 관절과 겹치지 않게 부드러운 띠로
  const legPaint = (y0, w0, w1, sx) => (J ? whitePaint : (p, c) => { // 황갈이 흰 다리로 털결 따라 번지고, 다리 바깥쪽에는 황갈 털이 조금 더 길게 내려온다
    const y = y0 + p.y + wob(_pg.set(p.x * 3, p.y * 3, p.z), 30) * 0.02 + (hash3(_pg.set(p.x * 90, p.y * 90, p.z * 90)) - 0.5) * 0.01;
    tone(c.copy(cT).lerp(cLeg, ss(w0, w1, y)).lerp(cTick, 0.25 * ss(0.0, 0.02, p.x * sx) * ss(w0, w0 - 0.08, y)), p, 0.04);
  });
  const pawPaint = J ? whitePaint : PU ? (p, c) => tone(c.copy(cW).lerp(cSnow, 0.7), p, 0.04) : (p, c) => tone(c.copy(cLeg), p, 0.04);
  const pupuLegPaint = (p, c) => tone(c.copy(cW).lerp(cSnow, 0.45), p, 0.04); // 푸푸: 곧고 하얀 다리
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
  d.torso = put(body, PU ? sdfGeo('pub', pupuBodySDF, [-0.15, -0.16, -0.28], [0.15, 0.26, 0.3], 0.005, 2) : sdfGeo(J ? 'jb' : DM ? 'bbd' : 'bb', DM ? damiBodySDF : bodySDF(J), J ? [-0.17, -0.17, -0.3] : [-0.15, -0.17, -0.27], J ? [0.17, 0.2, 0.33] : [0.15, 0.25, 0.3], 0.006, 2), null, null, null, bodyPaint);
  if (J) d.torso.userData.fur = [2, 0.002, 1600];
  if (PU) d.torso.userData.fur = [2, 0.003, 1300]; // 푸푸: 복슬한 겉털 — 실루엣 가장자리가 보송하다
  if (!silhouette && C.collar) {
    const sdfB = DM ? damiBodySDF : PU ? pupuBodySDF : bodySDF(J), ring = J ? collarRing(sdfB, V3(0, 0.068, 0.148), V3(0, 0.72, 0.69).normalize(), 0.011) : collarRing(sdfB, V3(0, CC[0], CC[1]), V3(0, CA[0], CA[1]).normalize(), DM ? 0.016 : PU ? 0.0045 : 0.011); // 목 밑동(턱에서 손 한 뼘 아래), 가는 띠가 가슴 위로 V자로 늘어진다
    if (C.collar === 'cord') { // 푸푸: 가는 청록 끈 목줄 (목이 굽으면 굽은 목에 다시 두른다)
      d.collarRing = ring; d.ringSDF = sdfB; d.collarMesh = put(body, ring.geo, null, null, null, null, new THREE.MeshStandardMaterial({ color: C.cord ?? 0x1f9a93, roughness: 0.6, side: THREE.DoubleSide }));
    } else
    if (C.collar === 'ribbon') {
      // 빨강·흰·남색 줄무늬 리본(바랜 색): 몸 표면을 따라가는 얇은 띠
      const ribbonTex = canvasTex(8, 64, (x, w, h) => {
        let y0 = 0;
        for (const [col, fr] of [['#884a43', 0.3], ['#d8cfc1', 0.14], ['#3a4257', 0.12], ['#d8cfc1', 0.14], ['#884a43', 0.3]]) { x.fillStyle = col; x.fillRect(0, Math.floor(y0 * h), w, Math.ceil(fr * h) + 1); y0 += fr; }
      });
      d.collarRing = ring; d.collarMesh = put(body, ring.geo, null, null, null, null, new THREE.MeshStandardMaterial({ map: ribbonTex, roughness: 0.85, side: THREE.DoubleSide }));
    } else if (C.collar === 'harness') {
      // 담이: 회색 하네스 — 목 고리 + 앞다리 바로 뒤 가슴 띠 + 둘을 잇는 등 끈(손잡이)·가슴 끈. 글자·상표는 없다
      const hm = new THREE.MeshStandardMaterial({ color: C.harness, roughness: 0.72, emissive: 0x2c2e33, side: THREE.DoubleSide }), hk = new THREE.MeshStandardMaterial({ color: 0x2c2d30, roughness: 0.55 });
      d.collarRing = ring; d.ringSDF = sdfB; d.collarMesh = put(body, ring.geo, null, null, null, null, hm);
      const girth = collarRing(sdfB, V3(0, 0.0, 0.062), V3(0, 0.25, 1).normalize(), 0.021);
      const gTop = girth.pts.reduce((a, b) => (b.y > a.y ? b : a)), rTop = ring.pts.reduce((a, b) => (b.y - b.z * 0.3 > a.y - a.z * 0.3 ? b : a));
      const strap = (a, b, w, n = 14) => { // 몸 표면을 따라가는 납작한 끈: a→b 사이 점을 표면으로 끌어당긴 뒤 바깥으로 살짝 띄운다
        const pos = [], idx = [], p = V3(), g = V3(), tg = V3().subVectors(b, a).normalize(), sd = V3(), e = 0.0008;
        for (let i = 0; i <= n; i++) {
          p.lerpVectors(a, b, i / n);
          for (let it = 0; it < 6; it++) { const v = sdfB(p.x, p.y, p.z); g.set(sdfB(p.x + e, p.y, p.z) - sdfB(p.x - e, p.y, p.z), sdfB(p.x, p.y + e, p.z) - sdfB(p.x, p.y - e, p.z), sdfB(p.x, p.y, p.z + e) - sdfB(p.x, p.y, p.z - e)).normalize(); p.addScaledVector(g, -(v - 0.0042)); }
          sd.crossVectors(g, tg).normalize().multiplyScalar(w);
          pos.push(p.x + sd.x, p.y + sd.y, p.z + sd.z, p.x - sd.x, p.y - sd.y, p.z - sd.z);
          if (i < n) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
        }
        const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); sg.setIndex(idx); sg.computeVertexNormals(); return sg;
      };
      d.harness = [put(body, girth.geo, null, null, null, null, hm), put(body, strap(rTop, gTop, 0.013), null, null, null, null, hm)];
      const back = new THREE.Group(); back.position.copy(gTop).lerp(rTop, 0.35); body.add(back); // 등 위 고리(손잡이)와 버클
      put(back, new THREE.TorusGeometry(0.014, 0.0035, 6, 18, Math.PI), [0, 0.004, 0], [0, Math.PI / 2, 0], null, null, hm);
      put(back, new THREE.BoxGeometry(0.022, 0.006, 0.012), [0, 0.002, -0.012], [0.25, 0, 0], null, null, hk);
      d.harness.push(back);
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
    if (C.tag === 'star') {
      // 푸푸: 목줄 앞에 고리로 매달린 청록 별 이름표 — 앞면에 '푸푸' (글꼴 없이 획으로 그려 어느 기기에서나 같은 글씨). 가슴에 눕는 기울기는 메달과 같이 updateDog에서 잡는다
      const md = new THREE.Group(); md.position.copy(ring.front); body.add(md); d.medal = md; d.medalSDF = sdfB;
      const teal = C.tagColor ?? 0x2fb0a6, R1 = 0.0175, R0 = 0.0088, S = 2.4 * R1;
      const star = new THREE.Shape();
      for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? R0 : R1; if (i) star.lineTo(Math.cos(a) * r, Math.sin(a) * r); else star.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
      const tex = canvasTex(128, 128, (x, w) => {
        x.fillStyle = '#' + new THREE.Color(teal).getHexString(); x.fillRect(0, 0, w, w);
        x.strokeStyle = '#f2fbf8'; x.lineWidth = 3.4; x.lineCap = 'round'; x.lineJoin = 'round';
        const L = (a, b, c, e) => { x.beginPath(); x.moveTo(a, b); x.lineTo(c, e); x.stroke(); };
        for (const cx of [53, 75]) { // 푸 = ㅍ 위 + ㅜ 아래
          L(cx - 8, 52, cx + 8, 52); L(cx - 3.5, 52, cx - 3.5, 61); L(cx + 3.5, 52, cx + 3.5, 61); L(cx - 9, 61, cx + 9, 61); // ㅍ
          L(cx - 10, 68, cx + 10, 68); L(cx, 68, cx, 78); // ㅜ
        }
      });
      tex.offset.set(0.5, 0.5); tex.repeat.set(1 / S, 1 / S);
      const sg = new THREE.ExtrudeGeometry(star, { depth: 0.0022, bevelEnabled: true, bevelThickness: 0.0009, bevelSize: 0.0016, bevelSegments: 2, curveSegments: 4 });
      const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4, metalness: 0.15 }), side = new THREE.MeshStandardMaterial({ color: teal, roughness: 0.4, metalness: 0.15 });
      const loop = new THREE.MeshStandardMaterial({ color: 0xb9c3c4, roughness: 0.35, metalness: 0.7 });
      put(md, new THREE.TorusGeometry(0.0045, 0.0012, 6, 14), [0, -0.0035, 0.002], [0, Math.PI / 2, 0], null, null, loop);
      const sm = new THREE.Mesh(sg, [face, side]); sm.position.set(0, -0.008 - R1, 0.001); sm.castShadow = true; md.add(sm); d.meshes.push(sm);
    }
  }

  // 머리: 목이 45°로 올라간 끝, 등선보다 위에 얹힌다
  const hp = new THREE.Group(); hp.rotation.order = 'YXZ'; hp.position.set(0, J ? 0.13 : PU ? 0.152 : 0.146, J ? 0.205 : PU ? 0.212 : 0.208); body.add(hp); d.hp = hp; // 비글: 머리를 목 위로 올려 머리와 가슴 사이에 목이 보인다
  if (!J) {
    // 목 관절: 목은 몸통 메시의 일부라, 앉아서 몸이 뒤로 기울면 목도 같이 뒤로 넘어가 머리가 등 위로 간다.
    // 목 부분 정점만 목뿌리(기갑 앞) 축을 중심으로 앞으로 굽혀(가중치로 부드럽게) 머리가 가슴 앞 위에 오게 한다.
    // 축은 목 단면 가운데(목덜미가 아니라)에 두고 목 전체에 걸쳐 완만하게 굽힌다 — 목 앞(멱)이 가슴 위로 접혀 턱 밑에 선반이 생기지 않게
    const NP = V3(0, NECK_P[0], NECK_P[1]), ny = 0.953, nz = 0.302;
    const nw = (x, y, z) => ss(NECK_W[0], NECK_W[1], (y - 0.07) * ny + (z - 0.11) * nz) * ss(NECK_W[2], NECK_W[3], z);
    const R = d.neckRig = makeRig(NP, nw);
    rigMesh(R, d.torso.geometry);
    rigFollow(R, hp.position);
    if (d.harness) { for (let i = 0; i < 2; i++) rigMesh(R, d.harness[i].geometry); rigFollow(R, d.harness[2].position); }
    if (d.collarRing) {
      // 리본·메달: 정점을 따로 굽히지 않고(고리가 찢어지듯 늘어난다) 굽은 몸 표면에 고리를 통째로 다시 두른다. 메달이 가슴에 눕는 판정도 굽은 몸으로 한다
      const sdf0 = d.medalSDF || d.ringSDF || bodySDF(false), ring = d.collarRing, cc = V3(0, CC[0], CC[1]), ax = V3(0, CA[0], CA[1]).normalize(), wc = nw(0, cc.y, cc.z);
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
  const head = new THREE.Group(); head.scale.setScalar(J ? 1.3 : 1.42); if (DM) head.scale.set(1.46, 1.45, 1.42); hp.add(head); d.head = head; // 담이: 얄상한 몸에 머리는 핑키만큼 크고 둥글게(주둥이는 damiHB0에서 짧게) · 비글: 머리를 크게(귀여움) — 귀 포함 머리 폭이 가슴보다 확실히 넓게
  const skull = PU ? put(head, sdfGeo('puh', pupuHeadSDF, [-0.098, -0.062, -0.1], [0.098, 0.128, 0.15], 0.0025, 1), null, null, null, headPaint)
    : put(head, sdfGeo(J ? 'jh' : DM ? 'bhd' : 'bh', DM ? damiHeadSDF : headSDF(J), J ? [-0.135, -0.08, -0.13] : DM ? [-0.085, -0.055, -0.095] : [-0.075, -0.055, -0.095], J ? [0.135, 0.175, 0.25] : DM ? [0.085, 0.135, 0.16] : [0.075, 0.135, 0.165], J ? 0.004 : 0.0025, 1), null, null, null, headPaint);
  if (J) skull.userData.fur = [2, 0.0015, 1600];
  if (PU) skull.userData.fur = [2, 0.002, 1500];
  const noseM = new THREE.MeshPhysicalMaterial({ color: C.nose, roughness: J ? 0.3 : 0.55, clearcoat: J ? 0.6 : 0.28, clearcoatRoughness: J ? 0.25 : 0.45 }); // 비글: 촉촉한 검은 가죽 코 (넓은 확산광 대신 작은 반짝임 — 회색 고무가 되지 않게)
  if (J) {
    put(head, sph(), [0, 0.03, 0.148], null, [0.021, 0.0155, 0.015], null, noseM);
    if (!silhouette) for (const sx of [1, -1]) put(head, sph(12, 8), [sx * 0.0072, 0.026, 0.16], [0, 0, sx * 0.4], [0.0048, 0.0032, 0.003], null, M(0x050303, { roughness: 0.6 }));
  } else {
    // 코: 주둥이 끝 앞에 얹힌 큼직한 둥근 검은 코 (콧구멍·콧방울 골·인중은 거리장에서 파냄) · 콧구멍 속 어둠. 입선은 머리 거리장에 골로 파고 색을 입힌다
    const nz = DM ? damiZInv(0.1325) - 0.1325 : PU ? 0.005 : 0, ns = DM ? 1.1 : PU ? 0.9 : 1.16, ny = PU ? 0.006 : 0.004; // 담이: 짧아진 주둥이 끝에 조금 작은 코 · 푸푸: 쐐기 주둥이 끝의 분홍빛 갈색 코
    put(head, sdfGeo('bn', noseSDF, [-0.022, -0.02, -0.017], [0.022, 0.02, 0.017], 0.0006), [0, ny, 0.1325 + nz], [-0.3, 0, 0], ns, null, noseM); // 주둥이 끝 앞으로 살짝 나온 큼직한 코, 윗면이 뒤로 기운다
    const nk = ns / 1.16; // 콧구멍은 코와 함께
    if (!silhouette) for (const sx of [1, -1]) put(head, sph(12, 8), DM || PU ? [sx * 0.0086 * nk, ny + 0.0016 * nk, 0.1325 + nz + 0.0133 * nk] : [sx * 0.0086, 0.0056, 0.1458], [-0.3, 0, -sx * 0.5], DM || PU ? [0.0038 * nk, 0.0028 * nk, 0.0026 * nk] : [0.0038, 0.0028, 0.0026], null, M(PU ? 0x2a1412 : 0x050303, { roughness: 0.8 }));
  }
  if (!J && !silhouette && !DM && !PU) {
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
  if (DM && !silhouette) {
    // 담이 입선: 아래턱을 잘라 낸 'ω' 입선의 머리 쪽 가장자리를 따라 붙인 가는 검은 관 — 다물면 웃는 ω 입, 벌리면 윗입술의 검은 테. 인중에서 'ㅅ'으로 갈라져 입꼬리로 가며 가늘어진다
    const lipM = new THREE.MeshStandardMaterial({ color: 0x241a16, roughness: 0.85 }), R = 0.0015, half = [], ph = [];
    const tube = (pts, r0, taper) => {
      const curve = new THREE.CatmullRomCurve3(pts), seg = pts.length * 6, g = new THREE.TubeGeometry(curve, seg, r0, 7, false), pos = g.attributes.position, c0 = V3(), v = V3();
      for (let i = 0; i <= seg; i++) { curve.getPointAt(i / seg, c0); const k = taper(i / seg); for (let j = 0; j <= 7; j++) { const q = i * 8 + j; v.fromBufferAttribute(pos, q).sub(c0).multiplyScalar(k).add(c0); pos.setXYZ(q, v.x, v.y, v.z); } }
      const m = put(head, g, null, null, null, null, lipM); m.castShadow = false; return m;
    };
    for (let i = 0; i <= 14; i++) { // 입선 위의 점: 세로축(0, y, 0.07)에서 바깥으로 쏘아 머리 표면에 붙이고, 그 자리의 입선 높이로 고쳐 다시 쏜다
      const ang = (i / 14) * 0.66; let y = damiCutY(0, 0.12), r = 0;
      for (let it = 0; it < 5; it++) { r = surfR(damiHB0, y, ang, 0.01); y = damiCutY(Math.sin(ang) * r, LIP_AX + Math.cos(ang) * r); }
      half.push(V3(Math.sin(ang) * (r - R * 0.5), y + 0.0004, LIP_AX + Math.cos(ang) * (r - R * 0.5)));
    }
    for (const sx of [1, -1]) tube(half.map((p) => V3(p.x * sx, p.y, p.z)), R, (s) => lerp(1, 0.2, ss(0.35, 1, s)));
    for (let i = 0; i <= 4; i++) { const y = lerp(-0.0085, half[0].y, i / 4); ph.push(V3(0, y, LIP_AX + surfR(damiHeadSDF, y, 0, 0.01) - R * 0.3)); }
    tube(ph, R * 0.75, () => 1); // 인중
  }
  const jaw = new THREE.Group(); jaw.position.set(0, J ? -0.02 : -0.014, 0.06); if (PU) jaw.position.set(PJ[0], PJ[1], PJ[2]); head.add(jaw); d.jaw = jaw;
  if (J) put(jaw, sph(), [0, -0.014, 0.05], null, [0.027, 0.013, 0.04], whitePaint);
  else if (PU) { // 푸푸: 머리에서 떼어 낸 아래턱 — 늘 웃는 입이라 벌어진 입 안의 분홍 잇몸·혀가 보인다
    put(jaw, sdfGeo('puj', pupuJawSDF, [-0.056, -0.034, -0.012], [0.056, 0.016, 0.1], 0.0022, 1), null, null, null, (p, c) => {
      const X = p.x, Y = p.y + PJ[1], Z = p.z + PJ[2], hb = pupuHB0(X, Y, Z), jr = pupuJawR(X, Y, Z), cy = pupuCutY(X, Z);
      tone(c.copy(cW).lerp(cSnow, 0.6), p, 0.035);
      c.lerp(cGum, ss(-0.001, -0.0028, hb) * ss(-0.004, -0.001, jr)).lerp(cLipD, ss(-0.0016, 0.0, hb) * Math.exp(-(((jr + 0.0004) / 0.0018) ** 2)) * ss(cy - 0.006, cy - 0.002, Y) * 0.6);
    });
  } else if (DM) { // 담이: 머리에서 떼어 낸 아래턱(입을 벌리면 분홍 잇몸·혀 바닥이 보인다)
    put(jaw, sdfGeo('bjd', damiJawSDF, [-0.05, -0.04, -0.016], [0.05, 0.016, 0.092], 0.0022, 1), null, null, null, (p, c) => {
      const X = p.x, Y = p.y + DJ[1], Z = p.z + DJ[2], hb = damiHB0(X, Y, Z), jr = damiJawR(X, Y, Z), ax = Math.abs(X), cy = damiCutY(X, Z);
      tone(c.copy(cMuz).lerp(cH, ss(0.04, 0.055, ax) * ss(0.058, 0.045, Z)), p, 0.035); // 아래턱·턱끝은 흰색(입꼬리 뒤만 황갈)
      c.lerp(cGum, ss(-0.001, -0.0028, hb) * ss(-0.004, -0.001, jr)).lerp(cLipD, ss(-0.0016, 0.0, hb) * Math.exp(-(((jr + 0.0004) / 0.0017) ** 2)) * ss(cy - 0.006, cy - 0.002, Y) * 0.25);
    });
  } else put(jaw, sph(), [0, -0.013, 0.028], null, [0.013, 0.008, 0.024], whitePaint); // 아래턱: 윗입술 안쪽에 들어가 턱 끝만 살짝 보인다 (입을 다물고 있어 입 속은 칠하지 않는다)
  const tongueRoot = new THREE.Group(); tongueRoot.position.set(0, J ? -0.01 : 0.006, J ? 0.01 : 0.02); jaw.add(tongueRoot);
  d.tongue = put(tongueRoot, sph(16, 10), [0, 0.006, 0.035], null, [0.02, 0.007, 0.03], null, M(0xe9808e, { roughness: 0.45 }));
  d.tongue.visible = false; // 혀는 보이지 않는다 (핑키는 혀를 내밀지 않는다)
  if (DM && !silhouette) { // 담이: 입 안 바닥에 깔린 혀 + 아랫입술 너머로 길게 늘어지는 혀(헥헥할 때)
    const tm = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.4, clearcoat: 0.35, clearcoatRoughness: 0.35 });
    const tPaint = (p, c) => { c.setHex(0xf59aa6).multiplyScalar(1 - 0.18 * Math.exp(-((p.x / 0.0035) ** 2)) - 0.1 * ss(0.002, -0.004, p.y + p.z * 0.1)); }; // 가운데 골은 진하게
    const tb = put(tongueRoot, sph(16, 10), [0, -0.0125, -0.003], [0.27, 0, 0], [0.0155, 0.004, 0.03], null, tm); tb.geometry = tb.geometry.clone(); tb.scale.set(1, 1, 1); tb.geometry.scale(0.0155, 0.004, 0.03);
    const hang = new THREE.Group(); hang.position.set(0, -0.0105, 0.035); tongueRoot.add(hang); // 짧아진 주둥이의 아랫입술 자리
    const tg = put(hang, sdfGeo('btd', damiTongueSDF, [-0.022, -0.064, -0.03], [0.022, 0.008, 0.02], 0.0014), null, null, null, null, tm);
    for (const m of [tb, tg]) { m.castShadow = false; const pos = m.geometry.attributes.position, col = new Float32Array(pos.count * 3); for (let i = 0; i < pos.count; i++) { _pv.fromBufferAttribute(pos, i); tPaint(_pv, _pc); col.set([_pc.r, _pc.g, _pc.b], i * 3); } m.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3)); }
    d.tongue = hang; hang.visible = false;
  }
  if (PU && !silhouette) {
    // 푸푸 혀: 아래턱 바닥에 깔린 넓은 혀 + 아랫니 너머로 살짝 내민 혀끝(웃을 때) — 헥헥하거나 핥을 때 더 길게 나온다 (updateDog)
    const tm = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.4, clearcoat: 0.35, clearcoatRoughness: 0.35 });
    const tPaint = (p, c) => { c.setHex(0xf3929f).multiplyScalar(1 - 0.18 * Math.exp(-((p.x / 0.0035) ** 2)) - 0.1 * ss(0.002, -0.004, p.y + p.z * 0.1)); };
    tongueRoot.position.set(0, 0, 0);
    const tb = put(tongueRoot, sph(16, 10), [0, 0.0012, 0.05], [-0.14, 0, 0], [0.019, 0.0048, 0.038], null, tm); tb.geometry = tb.geometry.clone(); tb.scale.set(1, 1, 1); tb.geometry.scale(0.019, 0.0048, 0.038);
    const hang = new THREE.Group(); hang.position.set(0, -0.0005, 0.087); tongueRoot.add(hang);
    const tg = put(hang, sdfGeo('btd', damiTongueSDF, [-0.022, -0.064, -0.03], [0.022, 0.008, 0.02], 0.0014), null, null, null, null, tm);
    for (const m of [tb, tg]) { m.castShadow = false; const pos = m.geometry.attributes.position, col = new Float32Array(pos.count * 3); for (let i = 0; i < pos.count; i++) { _pv.fromBufferAttribute(pos, i); tPaint(_pv, _pc); col.set([_pc.r, _pc.g, _pc.b], i * 3); } m.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3)); }
    d.tongue = hang;
    // 입술: 입선(머리 쪽 윗입술 가장자리 · 아래턱 쪽 아랫입술 가장자리)을 따라 붙인 가는 검은 관. 입꼬리(눈 밑 뒤쪽)로 올라가며 가늘어진다
    const lipM = new THREE.MeshStandardMaterial({ color: 0x2a1b17, roughness: 0.8 }), R = 0.0015, half = [], ZA = 0.05;
    const rayR = (y, ang) => { const dx = Math.sin(ang), dz = Math.cos(ang); let r = 0.004; while (r < 0.12 && pupuHB0(dx * r, y, ZA + dz * r) < 0) r += 0.0005; let a = r - 0.0005, b = r; for (let i = 0; i < 12; i++) { const m = (a + b) / 2; if (pupuHB0(dx * m, y, ZA + dz * m) < 0) a = m; else b = m; } return (a + b) / 2; };
    for (let i = 0; i <= 18; i++) {
      const ang = (i / 18) * 1.05; let y = pupuCutY(0, 0.12), r = 0;
      for (let it = 0; it < 5; it++) { r = rayR(y, ang); y = pupuCutY(Math.sin(ang) * r, ZA + Math.cos(ang) * r); }
      if (Math.sin(ang) * r < 0.035) half.push(V3(Math.sin(ang) * (r - R * 0.5), y + 0.0004, ZA + Math.cos(ang) * (r - R * 0.5))); // 입꼬리(아래턱이 끝나는 곳)에서 멈춘다
    }
    const tube = (par, pts, r0, taper) => {
      const curve = new THREE.CatmullRomCurve3(pts), seg = pts.length * 6, g = new THREE.TubeGeometry(curve, seg, r0, 7, false), pos = g.attributes.position, c0 = V3(), v = V3();
      for (let i = 0; i <= seg; i++) { curve.getPointAt(i / seg, c0); const k = taper(i / seg); for (let j = 0; j <= 7; j++) { const q = i * 8 + j; v.fromBufferAttribute(pos, q).sub(c0).multiplyScalar(k).add(c0); pos.setXYZ(q, v.x, v.y, v.z); } }
      const m = put(par, g, null, null, null, null, lipM); m.castShadow = false; return m;
    };
    for (const sx of [1, -1]) {
      tube(head, half.map((p) => V3(p.x * sx, p.y, p.z)), R, (s) => lerp(1, 0.35, ss(0.5, 1, s)));
      tube(jaw, half.filter((p) => p.x > 0.012).map((p) => V3(p.x * sx, p.y - 0.0012 - PJ[1], p.z - PJ[2])), R * 0.9, (s) => lerp(1, 0.35, ss(0.5, 1, s))); // 아랫입술: 가운데는 혀가 덮는다
    }
  }
  for (const sx of [1, -1]) {
    const eg = new THREE.Group(); eg.scale.setScalar(J ? 1.3 : DM ? 1.15 : 1); head.add(eg);
    if (J) { eg.position.set(sx * 0.04, 0.066, 0.097); eg.rotation.set(0, sx * 0.24, 0); }
    else { eg.position.set(sx * 0.038, 0.061, 0.049); eg.rotation.set(-0.12, sx * 0.03, 0); } // 크고 앞을 보는 동그란 눈, 지름 0.033(두개골 폭의 23%), 눈 사이 간격은 두개골 폭의 ~0.6, 살 속에 묻혀 앞면만 살짝 나온다
    if (PU) { eg.scale.setScalar(1.1); eg.position.set(sx * 0.0365, 0.063, 0.05); eg.rotation.set(-0.1, sx * 0.1, sx * 0.12); } // 푸푸: 바깥 눈꼬리가 살짝 올라간 아몬드 눈 (크고 촉촉하게)
    if (PU && !silhouette) {
      // 푸푸 눈: 진한 갈색 아몬드 눈 · 진한 눈테 · 크림 윗눈꺼풀과 웃어서 살짝 올라온 아랫눈꺼풀(순하게 웃는 눈) · 또렷한 반짝임 둘
      put(eg, sph(24, 16), [0, 0, 0], null, [0.0158, 0.0146, 0.012], null, new THREE.MeshPhysicalMaterial({ color: 0x3d2416, roughness: 0.35, clearcoat: 0.45, clearcoatRoughness: 0.25 }));
      put(eg, sph(16, 10), [0, -0.0003, 0.0103], null, [0.0083, 0.0081, 0.0022], null, M(0x050303, { roughness: 0.3 }));
      put(eg, new THREE.TorusGeometry(0.0146, 0.0026, 8, 28), [0, 0, 0.0033], null, [1.08, 1.0, 1.6], null, new THREE.MeshStandardMaterial({ color: 0x241814, roughness: 0.95 }));
      if (!d.lidG) {
        const g = new THREE.SphereGeometry(1, 28, 16, 0, Math.PI * 2, 0, 0.98), pos = g.attributes.position, col = new Float32Array(pos.count * 3), cTop = cW.clone().multiplyScalar(0.86).lerp(cH, 0.3), cEdge = new THREE.Color(0x221613);
        for (let i = 0; i < pos.count; i++) { _pc.copy(cTop).lerp(cEdge, ss(0.82, 0.96, Math.acos(clamp(pos.getY(i), -1, 1)) / 0.98)); col.set([_pc.r, _pc.g, _pc.b], i * 3); }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3)); d.lidG = g;
      }
      const lidM = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
      for (const [rx, sy] of [[-0.1, 1], [Math.PI - 0.05, 0.95]]) { const lid = new THREE.Mesh(d.lidG, lidM); lid.scale.set(0.0168, 0.0156 * sy, 0.0127); lid.rotation.set(rx, 0, -sx * 0.05); lid.castShadow = false; eg.add(lid); }
      const hm = new THREE.MeshBasicMaterial({ color: 0xf3eee8 }), h1 = new THREE.Mesh(SPH, hm), h2 = new THREE.Mesh(SPH, hm);
      h1.position.set(-0.0045, 0.0048, 0.0107); h1.scale.setScalar(0.0023); h2.position.set(0.0038, -0.0035, 0.0106); h2.scale.setScalar(0.0009); eg.add(h1, h2);
    } else if (!silhouette) {
      // 아주 진한 갈색의 촉촉한 눈(앞면이 살짝 납작) · 동공(가장자리에 가는 갈색 홍채 테) · 작은 반사 하나. 위아래 눈꺼풀이 눈알을 살짝 덮는다 — 눈테는 머리 무늬로 칠한다
      put(eg, sph(24, 16), [0, 0, 0], null, J ? [0.0148, 0.0144, 0.0115] : [0.015, 0.015, 0.012], null, DM ? new THREE.MeshPhysicalMaterial({ color: 0x3b2314, roughness: 0.4, clearcoat: 0.35, clearcoatRoughness: 0.3 }) : new THREE.MeshPhysicalMaterial({ color: J ? 0x2e1a10 : 0x23150f, roughness: J ? 0.2 : 0.5, clearcoat: J ? 0.6 : 0.14, clearcoatRoughness: J ? 0.1 : 0.5 }));
      put(eg, sph(16, 10), [0, -0.0004, J ? 0.0088 : 0.0103], null, J ? [0.0068, 0.0068, 0.003] : DM ? [0.0079, 0.0079, 0.0022] : [0.0074, 0.0074, 0.002], null, M(0x050303, { roughness: 0.3 }));
      if (J) put(eg, sph(16, 10), [0, 0.0138, -0.0035], null, [0.0132, 0.0016, 0.0098], null, M(cH.clone().multiplyScalar(0.92).getHex(), { roughness: 0.9 }));
      else {
        put(eg, new THREE.TorusGeometry(0.0146, 0.0026, 8, 28), [0, 0, 0.0033], null, [1, 1, 1.6], null, new THREE.MeshStandardMaterial({ color: DM ? 0x1d1512 : 0x3a2c25, roughness: 0.95 })); // 가늘고 부드러운 어두운 눈테(눈꺼풀 가장자리): 눈알은 덮지 않는다 — 동그랗게 활짝 뜬 눈
      }
      const h1 = new THREE.Mesh(SPH, new THREE.MeshBasicMaterial({ color: J ? 0xe6e0d8 : 0x9a948c })); h1.position.set(J ? -sx * 0.0045 : -0.004, 0.0055, J ? 0.0108 : 0.0108); h1.scale.setScalar(J ? 0.0017 : 0.0013); eg.add(h1);
      if (DM && !d.lidG) { // 담이: 윗눈꺼풀 — 눈 위쪽을 둥근 활처럼 살짝 덮고 바깥 눈꼬리 쪽이 조금 더 내려와, 놀란 동그란 눈이 아니라 순한 눈 (가장자리는 진한 속눈썹 선)
        const g = new THREE.SphereGeometry(1, 28, 16, 0, Math.PI * 2, 0, 0.98), pos = g.attributes.position, col = new Float32Array(pos.count * 3), cTop = cE.clone().multiplyScalar(0.62).lerp(cRim, 0.45), cEdge = new THREE.Color(0x1a120f);
        for (let i = 0; i < pos.count; i++) { _pc.copy(cTop).lerp(cEdge, ss(0.62, 0.86, Math.acos(clamp(pos.getY(i), -1, 1)) / 0.98)); col.set([_pc.r, _pc.g, _pc.b], i * 3); }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3)); d.lidG = g;
      }
      if (DM) { const lid = new THREE.Mesh(d.lidG, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 })); lid.scale.set(0.0157, 0.0157, 0.0127); lid.rotation.set(-0.5, 0, -sx * 0.05); lid.castShadow = false; eg.add(lid); }
      if (DM) { h1.material.color.setHex(0xf0ebe4); h1.scale.setScalar(0.0021); h1.position.set(-0.0042, 0.0046, 0.0106); const h2 = new THREE.Mesh(SPH, h1.material); h2.position.set(0.0036, -0.0036, 0.0106); h2.scale.setScalar(0.0008); eg.add(h2); } // 담이: 또렷한 눈 반짝임 둘
      if (J) { const h2 = new THREE.Mesh(SPH, new THREE.MeshBasicMaterial({ color: 0xf6f2ec })); h2.position.set(sx * 0.0034, -0.0038, 0.0102); h2.scale.setScalar(0.0007); eg.add(h2); }
    }
    d.eyes.push(eg);
  }
  for (const sx of [1, -1]) {
    const ep = new THREE.Group(); head.add(ep);
    if (J) { ep.position.set(sx * 0.056, 0.128, 0); put(ep, new THREE.ConeGeometry(0.042, 0.1, 16), [0, 0.044, 0], null, [1, 1, 0.55], earPaint(sx)).userData.fur = [2, 0.004, 480]; ep.rotation.z = sx * -0.22; }
    else {
      if (PU) { // 푸푸: 정수리 모서리에 쫑긋 선 세모 귀 — 살짝 바깥·앞으로 벌어지고 오목한 안쪽이 앞을 본다 (ep는 updateDog가 움직이고, ei가 기본 각도)
        ep.position.set(sx * 0.047, 0.1, -0.012);
        const ei = new THREE.Group(); ei.rotation.order = 'ZXY'; ei.rotation.set(0.1, sx * 0.55, -sx * 0.24); ep.add(ei);
        put(ei, sdfGeo('pue', pupuEarSDF, [-0.055, -0.045, -0.03], [0.055, 0.118, 0.052], 0.0018, 1), null, null, null, pupuEarPaint);
        d.ears.push({ g: ep, side: sx, ax: 0, vx: 0, az: 0, vz: 0 }); continue;
      }
      if (DM) { ep.position.set(sx * 0.054, 0.103, -0.008); put(ep, sdfGeo('bed' + sx, damiEarSDF(sx), sx > 0 ? [-0.03, -0.16, -0.085] : [-0.125, -0.16, -0.085], sx > 0 ? [0.125, 0.03, 0.1] : [0.03, 0.03, 0.1], 0.0024, 1), null, null, null, earPaint(sx)); d.ears.push({ g: ep, side: sx, ax: 0, vx: 0, az: 0, vz: 0 }); continue; } // 담이: 세모 귀 (조금 높이)
      ep.position.set(sx * 0.055, 0.1, -0.006); // 귀 뿌리를 정수리 모서리(눈썹 높이 위)로 올리고 조금 앞으로 — 귀가 얼굴 양옆을 감싸며 내려온다. 귀는 눈과 정수리 사이 높이에서 두개골 '위에' 접혀 시작해(옆에 붙은 혹이 아니다) 볼 위로 늘어진다 — 귀 위로 둥근 정수리가 보인다
      put(ep, sdfGeo('be' + sx, earSDF(sx), sx > 0 ? [-0.03, -0.18, -0.085] : [-0.125, -0.18, -0.085], sx > 0 ? [0.125, 0.03, 0.1] : [0.03, 0.03, 0.1], 0.0026, 1), null, null, null, earPaint(sx));
    }
    d.ears.push({ g: ep, side: sx, ax: 0, vx: 0, az: 0, vz: 0 });
  }

  // 꼬리
  const tp = new THREE.Group(); tp.position.set(0, J ? 0.07 : 0.053, J ? -0.196 : -0.25); if (PU) tp.position.set(0, 0.07, -0.238); body.add(tp); d.tail = tp;
  if (PU) { const m = put(tp, sdfGeo('put', pupuTailSDF, [-0.068, -0.048, -0.075], [0.098, 0.22, 0.2], 0.0028, 1), null, null, null, tailPaint); m.userData.fur = [3, 0.009, 600]; d.tailFluff = m; } // 푸푸: 등 위로 말린 털 꼬리 — 통째로 흔든다 (d.tailMesh가 아니라 굽히지 않는다)
  else if (J) put(tp, new THREE.TorusGeometry(0.055, 0.03, 10, 20, Math.PI * 1.5), [0, 0.06, 0], [0, Math.PI / 2, 0.5], null, tailPaint).userData.fur = [3, 0.006, 400];
  else if (DM) { d.tailMesh = put(tp, sdfGeo('btdt', damiTailSDF, [-0.052, -0.052, -0.055], [0.052, 0.325, 0.135], 0.0028), null, null, null, tailPaint); d.tailMesh.userData.fur = [2, 0.0045, 900]; } // 담이: 흰 붓 꼬리 (솜털 셸로 가장자리가 보송하게)
  else d.tailMesh = put(tp, sdfGeo('bt', tailSDF, [-0.048, -0.048, -0.05], [0.048, 0.3, 0.11], 0.003), null, null, null, tailPaint);

  // 다리: 앞다리 = 위팔 · 아래팔 · 발허리 (팔꿈치는 뒤로, 손목은 들 때 뒤로 접힘)
  //       뒷다리 = 허벅지 · 정강이 · 뒷발허리 (무릎은 앞으로, 뒤꿈치는 뒤로)
  const k = J ? 1.15 : 1;
  const LEGS = J ? [[1, 0.132, true], [-1, 0.132, true], [1, -0.119, false], [-1, -0.119, false]] : [[1, 0.226, true], [-1, 0.226, true], [1, -0.175, false], [-1, -0.175, false]];
  for (const [sx, z, front] of LEGS) {
    const kl = PU ? PUPU_LEG : 1, L1 = (J ? (front ? 0.095 : 0.09) * k : front ? 0.1 : 0.118) * kl, L2 = (J ? 0.095 * k : front ? 0.122 : 0.105) * kl, L3 = (J ? (front ? 0.045 : 0.065) * k : front ? 0.045 : 0.088) * kl; // 푸푸: 다리가 길다 (kl) // 뒷다리: 허벅지 ≈ 정강이, 뒷발허리(비절~발)는 기갑 높이의 ~0.24 — 비절이 바닥에서 확실히 떠 보인다
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
      hip.position.set(sx * (front ? (DM ? 0.044 : PU ? 0.047 : 0.048) : DM || PU ? d.hipX : 0.062), front ? -0.022 : 0.015, z); // 앞: 어깨 관절(견단)은 가슴 앞쪽 위(몸 높이의 2/3) — 위팔이 뒤·아래로 내려가 팔꿈치가 가슴 바닥 높이에서 갈비에 붙고, 아래팔은 수직으로 선다. // 고관절은 골반 가운데 높이(좌골보다 위)에 두어 앉을 때 엉덩이는 바닥에, 고관절은 바닥 위에 있고 무릎이 앞 위로 나온다
      const lk = DM ? 0.87 : 1, r1 = (front ? 0.027 : 0.052) * lk, r2 = (front ? 0.039 : 0.036) * (DM ? 0.93 : PU ? (front ? 0.97 : 1.1) : 1), r3 = (front ? 0.029 : 0.0235) * (DM ? 0.8 : PU ? (front ? 0.95 : 1.06) : 1), r4 = (front ? 0.03 : 0.0255) * (DM ? 0.82 : PU ? 0.98 : 1); // 담이: 다리가 가늘다(얄상) // 짧고 튼튼하지만 팔꿈치·무릎 아래로 가늘어지는 다리 (발목은 윗다리의 55%)
      const paintAt = front ? V3(sx * (DM ? 0.042 : 0.046), -0.048, 0.228) : hip.position.clone(); // 무늬는 예전 어깨 자리 기준 그대로 (관절을 옮겨도 털색은 그대로)
      const bodySpace = (p, c) => bodyPaint(_pb.copy(p).add(paintAt), c, 1); // 위팔·허벅지는 몸통 무늬를 그대로 이어받는다 (배 흰색은 끄고 황갈로 — 위팔은 팔꿈치까지 황갈)
      const seg = (key, L, ra, rb) => sdfGeo(key, legSegSDF(L, ra, rb), [-ra - 0.003, -L - rb - 0.003, -ra - 0.003], [ra + 0.003, ra + 0.003, ra + 0.003], 0.003);
      const fk = front ? 'f' : 'h', vk = DM ? 'd' : PU ? 'p' : ''; // 담이 다리는 따로 캐시
      if (front) put(hip, seg('bl1f' + vk, L1, r1, r2), null, null, null, bodySpace);
      else thighM = put(hip, sdfGeo('bl1h' + vk, (x, y, z) => smin(sdRoundCone(x, y, z, L1, r1, r2), DM ? sdE(x, y, z, 0, -L1 * 0.25, 0.01, 0.05, 0.066, 0.05) : PU ? smin(sdE(x, y, z, 0, -L1 * 0.25, 0.008, 0.046, 0.068, 0.054), sdE(x, y, z, 0, -L1 * 0.48, -0.03, 0.036, 0.054, 0.032), 0.025) : sdE(x, y, z, 0, -L1 * 0.25, 0.012, 0.06, 0.07, 0.054), 0.03), [-0.075, -L1 - r2 - 0.003, -0.078], [0.075, r1 + 0.003, 0.095], 0.003), null, null, null, PU ? bodySpace : (p, c) => { bodySpace(p, c); c.lerp(cT, 0.3 * ss(-0.02, -0.09, p.y)); }); // 허벅지 아래쪽은 안장빛을 덜어 황갈로: 앉거나 엎드려 허벅지가 옆구리에 겹쳐도 어두운 원반으로 떠 보이지 않는다
      // 허벅지: 다리와 한 덩어리로 움직이는 둥근 '바지' (서면 둥근 허벅지, 앉으면 접힌 무릎·정강이를 덮는 둥근 엉덩이 살)
      const lower = PU ? pupuLegPaint : front ? legPaint(-0.166, -0.13, -0.21, sx) : legPaint(hip.position.y - L1, -0.19, -0.26, sx); // 앞다리는 팔꿈치까지 황갈, 아래팔 중간부터 흰색; 뒷다리는 정강이까지 황갈, 비절(hock)부터 흰 양말 (앉아도 정강이가 흰 통나무로 보이지 않는다)
      if (front) put(knee, sdfGeo('bl2f' + vk, (x, y, z) => smin(sdRoundCone(x, y, z, L2, r2, r3), Math.hypot(x, y - 0.006, z + 0.03) - 0.02, 0.014), [-r2 - 0.003, -L2 - r3 - 0.003, -0.058], [r2 + 0.003, r2 + 0.003, r2 + 0.003], 0.003), null, null, null, lower); // 팔꿈치 머리(olecranon): 아래팔 위 끝 뒤로 살짝 나온 뼈 — 다리가 책상 다리처럼 밋밋한 통이 되지 않게
      else put(knee, sdfGeo('bl2h' + vk, (x, y, z) => smin(sdRoundCone(x, y, z, L2, r2, r3), sdE(x, y, z, 0, -L2 * 0.1, 0.004, 0.038, 0.044, 0.04), 0.03), [-0.05, -L2 - r3 - 0.003, -0.05], [0.05, r2 + 0.003, 0.055], 0.003), null, null, null, lower); // 정강이 위쪽의 둥근 무릎(stifle) 살: 앉으면 허벅지와 이어져 정강이가 통나무로 보이지 않는다
      if (front) put(ank, sdfGeo('bl3f' + vk, (x, y, z) => smin(sdRoundCone(x, y, z, L3, r3, r4), Math.hypot(x, y + 0.004, z + 0.019) - 0.0135, 0.012), [-r4 - 0.003, -L3 - r4 - 0.003, -0.04], [r4 + 0.003, r4 + 0.003, r4 + 0.003], 0.003), null, null, null, pawPaint); // 손목 뒤 볼록(덧손목뼈): 아래팔과 발허리 사이가 살짝 꺾여 보인다
      else put(ank, sdfGeo('bl3h' + vk, (x, y, z) => smin(sdRoundCone(x, y, z, L3, r3, r4), Math.hypot(x, y - 0.004, z + 0.027) - 0.024, 0.014), [-r4 - 0.003, -L3 - r4 - 0.003, -0.058], [r4 + 0.003, 0.03, r4 + 0.003], 0.003), null, null, null, pawPaint); // 비절 끝(뒤꿈치뼈)이 뒤로 살짝 나온다
      put(foot, sph(), [0, 0, 0], null, r4 * 0.9, pawPaint);
      put(foot, sdfGeo('bf', footSDF, [-0.045, -0.03, -0.04], [0.045, 0.025, 0.055], 0.0025), [0, 0, 0.01], null, (front ? 1.08 : 1.0) * (DM ? 1.02 : PU ? 0.92 : 1), pawPaint); // 앞발이 뒷발보다 조금 크다
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
    jawOpen: 0, chew: false, lick: 0, tongueOut: 0, pant: false, sniff: 0, paddle: 0, paddleFront: false, shuffle: 0,
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
  if (!d.walkTarget && (d.path || d.walkT)) { d.path = null; d.pathGoal = null; d.ghost = false; d.stuckN = 0; d.walkT = 0; d.lastP = null; }
  if (d.walkTarget) {
    let dx = d.walkTarget.x - d.x, dz = d.walkTarget.z - d.z, dist = Math.hypot(dx, dz);
    // 길(d.route): 장애물 사이를 지나는 꺾이는 점들. 목적지가 장애물 속이면 가장 가까운 빈 자리까지만 간다
    let gx = d.walkTarget.x, gz = d.walkTarget.z;
    if (d.route && !d.ghost) {
      const pg = d.pathGoal;
      if (!d.path || !pg || Math.hypot(pg.x - gx, pg.z - gz) > 0.12) { d.path = d.route(d.x, d.z, gx, gz); d.pathGoal = { x: gx, z: gz }; }
      const P = d.path;
      while (P.length > 1 && (Math.hypot(P[0].x - d.x, P[0].z - d.z) < 0.09 || d.routeSee(d.x, d.z, P[1].x, P[1].z))) P.shift();
      if (P.length > 1 || P[0].snap) { gx = P[0].x; gz = P[0].z; }
      if (P.length === 1) { dx = gx - d.x; dz = gz - d.z; dist = Math.hypot(dx, dz); }
    }
    if (dist < 0.03) { d.walkTarget = null; }
    else {
      // 절대로 제자리걸음에 갇히지 않는다: 한동안 나아가지 못하면 길을 다시 찾고, 그래도 안 되면(또는 너무 오래 걸리면) 장애물을 무시하고 곧장 간다
      d.stuckT = (d.stuckT || 0) + dt; d.walkT = (d.walkT || 0) + dt;
      if (d.stuckT > 0.8) {
        if (d.lastP && Math.hypot(d.x - d.lastP.x, d.z - d.lastP.z) < 0.03 && d.walkSpeed > 0.05 && !(d.curlK > 0.3)) { d.path = null; d.stuckN = (d.stuckN || 0) + 1; if (d.stuckN >= 3) d.ghost = true; }
        d.lastP = { x: d.x, z: d.z }; d.stuckT = 0;
      }
      if (d.walkT > 45) d.ghost = true;
      const tl = Math.hypot(gx - d.x, gz - d.z) || 1, sx = (gx - d.x) / tl, sz = (gz - d.z) / tl;
      const want = Math.atan2(sx, sz), diff = angDiff(d.yaw, want), up = d.curlK > 0.3 ? 0 : 1; // 몸을 말고 있는 동안에는 돌지도 걷지도 않는다(먼저 몸을 편다)
      d.yaw += diff * (1 - Math.exp(-5 * dt)) * up;
      const sp = d.walkSpeed * (d.speedK || 1) * Math.max(0, 1 - Math.abs(diff) / 1.3) * Math.min(1, dist / 0.18 + 0.25) * up;
      d.x += Math.sin(d.yaw) * sp * dt; d.z += Math.cos(d.yaw) * sp * dt;
      if (d.collide && !d.ghost) d.collide(d);
      moving = Math.max(sp / Math.max(d.walkSpeed * (d.speedK || 1), 0.01), Math.min(1, Math.abs(diff) * 1.5)) * up;
      d.phase += Math.max(sp, 0.16) * dt * Math.PI / (d.J ? 2 * 0.055 * d.scale : (WALK_S * d.scale) / WALK_DUTY); // 딛고 있는 발이 바닥에서 미끄러지지 않는 박자
    }
  } else if (!d.external) {
    let want = null;
    if (d.face === 'cam' && camPos) want = Math.atan2(camPos.x - d.x, camPos.z - d.z) + c.yawOff;
    else if (d.face && d.face.x !== undefined) want = Math.atan2(d.face.x - d.x, d.face.z - d.z);
    if (want !== null && !(d.curlK > 0.3)) { // 몸을 말고 있는 동안에는 몸을 돌리지 않는다
      const diff = angDiff(d.yaw, want);
      const stp = diff * (1 - Math.exp(-3.5 * dt)); d.yaw += d.turnCap ? clamp(stp, -d.turnCap * dt, d.turnCap * dt) : stp;
      if (Math.abs(diff) > (d.turnCap ? 0.12 : 0.45) && (g.name === 'stand' || g.name === 'eat')) { moving = Math.min(1, Math.abs(diff)); d.phase += dt * 9; }
    }
  }
  if (d.shuffle > 0.01 && !d.walkTarget) { moving = Math.max(moving, d.shuffle); d.phase += dt * 6.5 * d.shuffle; } // 제자리에서 발을 옮겨 딛는다(방석 위에서 빙글 돌 때)
  d.gait += (moving - d.gait) * (1 - Math.exp(-8 * dt));
  d.lift += (d.liftT - d.lift) * (1 - Math.exp(-4 * dt));
  if (!d.external) { d.root.position.set(d.x, d.lift, d.z); d.root.rotation.y = d.yaw; }

  // 몸
  const br = Math.sin(t * (d.pant ? (d.dami ? 9 : 7) : 2.3) + d.seed * 3) * (d.pant ? 0.006 : 0.0035) * (1 - (d.curlS || 0)); // 잘 때는 napPost의 느린 숨 하나만 쉰다
  const bob = d.J ? d.gait * Math.abs(Math.cos(d.phase)) * 0.01 : d.bounce ? d.gait * (Math.abs(Math.cos(d.phase)) * 0.006 - 0.016 + d.bounce * Math.max(0, Math.sin(d.phase * 2))) : d.gait * (Math.abs(Math.cos(d.phase)) * 0.006 - 0.016); // 담이(bounce): 발을 디딜 때마다 통통 튀듯 가볍게 // 비글: 걸을 때는 몸을 살짝 낮춰 다리가 끝까지 닿는다
  d.body.position.set(0, c.bodyY + br + bob, c.bodyZ);
  const bRoll = c.roll + (d.J ? 0 : Math.sin(d.phase) * 0.035 * d.gait);
  d.body.rotation.set(c.pitch + (d.J ? 0 : Math.sin(d.phase * 2) * 0.012 * d.gait), 0, d.wig ? bRoll + d.wig * 0.25 : bRoll); // wig: 담이가 엉덩이를 실룩실룩 (간식 · 쓰다듬기) // 걸을 때 몸이 좌우로 살짝 흔들리고, 어깨와 엉덩이가 번갈아 오르내린다
  d.torso.scale.set(1 + br * 2.5, 1 + br * 2.5, 1);
  if (d.neckRig) { const rc = c.reach || 0, na = (c.neck || 0) + 0.65; bendRig(d.neckRig, c.neck || 0, 0, Math.cos(na) * rc, Math.sin(na) * rc); if (d.collarFit) d.collarFit(); } // reach: 굽은 목 방향(쉬는 목은 수직에서 ~37° 앞으로 누워 있다)으로 목을 뺀다
  const pelvisYaw = d.J ? 0 : -Math.cos(d.phase) * 0.07 * d.gait; // 평보: 앞으로 나간 뒷발 쪽 골반이 앞으로 돈다(허리가 좌우로 굽는다)
  if (d.lumbarRig) bendRig(d.lumbarRig, -(c.lumbar || 0), (c.bendY || 0) + pelvisYaw + (d.wig || 0)); // wig: 담이가 간식을 보고 엉덩이를 씰룩 (핑키는 늘 0) // 양수 = 골반이 밑으로 말린다(엉덩이가 아래·앞으로) · bendY: 등이 옆으로 C자로 휜다
  if (d.medal) {
    // 메달은 아래로 늘어지되, 판 중심이 가슴 속에 파묻히면(앉기처럼 몸이 뒤로 기울 때) 가슴에 눕도록 앞으로 기울인다
    const md = d.medal; let rx = -c.pitch * 0.95 + Math.sin(d.phase * 2) * 0.12 * d.gait + Math.sin(t * 1.3) * 0.03;
    const dr = d.J ? 0.03 : d.pupu ? 0.045 : 0.07, dz = d.J ? 0.006 : 0.004, nIt = d.J ? 12 : 30, step = d.J ? 0.09 : 0.06; // 판 아래 가장자리·판 중심이 몸에 파묻히면 가슴에 눕도록 앞으로 눕힌다 (앉기처럼 몸이 많이 기울어도 메달이 가슴 속으로 사라지지 않게)
    if (d.medalSDF) for (let i = 0; i < nIt; i++) {
      const y = md.position.y - dr * Math.cos(rx) - dz * Math.sin(rx), z = md.position.z - dr * Math.sin(rx) + dz * Math.cos(rx);
      const dm = d.J ? 0 : d.pupu ? 0.026 : 0.045, ym = md.position.y - dm * Math.cos(rx) - dz * Math.sin(rx), zm = md.position.z - dm * Math.sin(rx) + dz * Math.cos(rx);
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
    if (d.pawUp && d.pawUp.i === i && d.pawUp.k > 0.001) { const pk = d.pawUp.k; _paw.y += (d.pawUp.y ?? 0.165) * pk; _paw.z += (d.pawUp.z ?? 0.085) * pk; _paw.x += L.sx * 0.015 * pk; up = Math.max(up, pk); } // 담이: 앞발 하나를 들어 화면(엄마)을 톡톡
    if (d.paddle > 0.001 && (!d.paddleFront || L.front)) { const po = d.paddleFront ? i * Math.PI : i * 1.7; _paw.y += Math.max(d.paddleFront ? 0 : -1, Math.sin(t * 8 + po)) * 0.035 * d.paddle; _paw.z += Math.cos(t * 8 + po) * 0.03 * d.paddle; } // paddleFront: 앞발만 번갈아 꾹꾹(자리 다지기)
    if (d.dig > 0.001 && L.front) { const ph = t * 15 + (L.sx > 0 ? 0 : Math.PI); _paw.y += Math.max(0, Math.sin(ph)) * 0.05 * d.dig; _paw.z -= Math.cos(ph) * 0.045 * d.dig; } // 담이: 땅 파기 — 앞발을 번갈아 빠르게 (들어 앞으로 뻗었다가 모래를 긁으며 뒤로)
    if (d.kick > 0.001 && !L.front) { const ph = t * 13 + (L.sx > 0 ? 0 : Math.PI); _paw.y += Math.max(0, Math.sin(ph)) * 0.045 * d.kick; _paw.z -= (0.55 + 0.45 * Math.cos(ph)) * 0.09 * d.kick; } // 푸푸: 볼일을 보고 뒷발로 풀을 슥슥 (번갈아 뒤로 차 낸다)
    if (!d.J && L.front) L.hip.position.z = L.z0 + (_paw.z - c.paws[i].z) * 0.15; // 견갑골은 갈비 위에서 미끄러진다: 앞발이 나가면 어깨 관절도 조금 앞으로, 밀면 뒤로
    _hipS.copy(L.hip.position).applyMatrix4(d.body.matrix);
    const lean = c.lean[i] + up * (L.front ? -1.2 : 0.9) + (d.J || L.front ? 0 : (stZ - 0.3) * 0.16 * d.gait); // 뒷발허리: 디딜 때는 비절이 발 뒤에, 밀어낼수록 서서 뒤꿈치가 들린다(비절이 펴진다)
    _dir.set(0, Math.cos(lean), -Math.sin(lean)); if (!d.J && c.roll) _dir.applyAxisAngle(_zAx, c.roll); // 누운 자세: 발목 기울기는 강아지 몸 기준(옆으로 굴러도 손목·비절이 제 방향으로 접힌다)
    _dir.lerp(_tmp.copy(_hipS).sub(_paw).normalize(), c.free).normalize();
    _ank.copy(_paw).addScaledVector(_dir, L.L3).applyMatrix4(_m).sub(L.hip.position);
    _paw.applyMatrix4(_m).sub(L.hip.position);
    solveLeg(L, _ank, _paw, c.level, c.pitch);
    L.hip.rotation.z = d.J ? 0 : L.sx * ((L.front ? 0 : c.splay || 0) + c.abd[i]); // 벌림(abduction): 앉을 때 뒷다리, 누운 자세의 다리
    if (L.thigh) { const sp = clamp((c.splay || 0) / 0.3, 0, 1.2); L.hip.position.x = L.sx * ((d.hipX ?? 0.062) + 0.012 * sp) + L.fol.dx; const q = clamp((c.lumbar || 0) / 0.55, 0, 1); L.thigh.scale.set(1 + 0.3 * sp * (0.35 + 0.65 * q), 1 + 0.08 * sp, 1 + sp * (0.18 * q - 0.14 * (1 - q))); } // q: 앉기(골반이 말림)일 때만 엉덩이 살이 크게 퍼진다 — 엎드리면 허벅지가 등선 위로 솟지 않게 오히려 납작해진다 // 앉으면 허벅지·엉덩이 살이 옆으로 퍼져 가슴보다 넓은 둥근 엉덩이가 된다 (서면 원래 폭) // 앉을 때 뒷다리(허벅지째)를 바깥으로 벌려 엉덩이가 바닥에서 넓어진다
  }

  // 귀 (중력 따라 덜렁)
  const hwP = c.pitch + d.hp.rotation.x, hwR = c.roll + d.hp.rotation.z;
  for (const e of d.ears) {
    if (d.J) { e.g.rotation.x = -d.earPerk * 0.2; continue; }
    if (d.pupu) { // 푸푸: 쫑긋 선 귀 — 늘어지지 않고 걸음에 살짝 떨린다. earPerk(+)면 앞으로 세워 모으고, (-)면 뒤·옆으로 젖힌다
      const lay = ss(0.5, 1.3, Math.abs(c.roll)); // 옆으로 눕거나 배를 보이면 귀를 뒤로 눕힌다 (뿔처럼 서지 않게)
      const tx = d.earPerk * 0.2 + d.gait * Math.sin(d.phase * 2) * 0.04 - 1.3 * lay, tz = -e.side * Math.max(0, -d.earPerk) * 0.35 + e.side * Math.max(0, d.earPerk) * 0.05;
      e.vx += (tx - e.ax) * 160 * dt; e.vx *= Math.exp(-10 * dt); e.ax += e.vx * dt;
      e.vz += (tz - e.az) * 160 * dt; e.vz *= Math.exp(-10 * dt); e.az += e.vz * dt;
      e.g.rotation.set(e.ax, 0, e.az); e.g.scale.y = 1 - 0.5 * lay * (e.side * Math.sin(c.roll) < 0 ? 1 : 0); continue; // 바닥 쪽 귀는 머리 밑에 접힌다
    }
    const tx = -hwP * 0.7 + d.gait * Math.sin(d.phase * 2) * 0.12 - d.earPerk * 0.3;
    const tz = e.side * (-0.06 + d.earPerk * 0.3) - hwR * 0.6; // 쉴 때는 귓볼이 볼에 기대어 살짝 안으로 오므라든다
    e.vx += (tx - e.ax) * 120 * dt; e.vx *= Math.exp(-8 * dt); e.ax += e.vx * dt;
    e.vz += (tz - e.az) * 120 * dt; e.vz *= Math.exp(-8 * dt); e.az += e.vz * dt;
    const upE = Math.max(0, e.side * Math.sin(hwR)); // 옆으로 누우면 위쪽 귀가 볼 위로 처지고, 머리를 숙이면(먹기) 귀가 앞으로 늘어진다 (흔들림 한계만 넓힌다)
    e.ax = clamp(e.ax, -0.25 - 0.3 * clamp(hwP - 0.5, 0, 1), 0.35); e.az = clamp(e.az, -0.1 - (e.side > 0 ? 0.3 * upE : 0), 0.1 + (e.side < 0 ? 0.3 * upE : 0)); // 귓볼이 볼에서 들뜨지 않게
    e.g.rotation.set(e.ax, 0, e.az - (d.dami ? e.side * DAMI_EAR_IN : 0)); // 담이: 귀가 옆으로 뻗지 않고 볼 옆으로 내려오게 안쪽으로 모은다
  }

  // 꼬리
  const wk = 1 - Math.exp(-4 * dt);
  d.wagAmp += (d.wagAmpT - d.wagAmp) * wk; d.wagSpeed += (d.wagSpeedT - d.wagSpeed) * wk;
  d.wagPhase += dt * d.wagSpeed;
  d.tailLowS = (d.tailLowS || 0) + ((d.tailLow || 0) - (d.tailLowS || 0)) * (1 - Math.exp(-2.5 * dt)); // 방석 위에서는 꼬리를 느슨하게 내린다
  d.tail.rotation.set(c.tail - d.tailLowS - (d.J ? 0 : c.lumbar || 0), 0, Math.sin(d.wagPhase) * d.wagAmp * (d.J ? 0.35 : 1) + (d.J ? 0 : Math.cos(d.phase) * 0.12 * d.gait - (c.tailCurl || 0) * 0.3)); // 걸을 때 꼬리는 골반과 반대로 흔들린다

  if (d.tailMesh) curlTail(d, c.tailCurl || 0);

  // 눈 깜빡
  d.blinkT -= dt;
  if (d.blinkT <= 0) { d.blinkT = 3 + Math.random() * 5; d.blinkDur = 0.12; }
  let eo = d.eyeOpen;
  if (d.blinkDur > 0) eo = 0.1;
  if (d.blinkDur > -0.25) d.blinkDur -= dt;
  d.eyeY += (eo - d.eyeY) * (1 - Math.exp(-(d.blinkDur > -0.25 ? 35 : 9) * dt)); // 깜빡임은 빠르게, 졸리거나 깨어날 때 눈꺼풀은 천천히
  for (const e of d.eyes) e.scale.y = Math.max(0.08, d.eyeY) * e.scale.x;

  // 입 · 혀
  let jt = d.jawOpen;
  if (d.chew) jt = 0.06 + 0.2 * (0.5 + 0.5 * Math.sin(t * 15));
  if (d.pant) jt = Math.max(jt, d.dami ? 0.3 + 0.06 * Math.sin(t * 18) : d.pupu ? PUPU_SMILE + 0.07 + 0.05 * Math.sin(t * 14) : 0.16 + 0.04 * Math.sin(t * 14));
  if (d.pupu) { d.smileK += ((d.chew ? 0 : d.smile * ss(0.15, 0.45, d.eyeOpen)) - d.smileK) * (1 - Math.exp(-6 * dt)); jt = Math.max(jt, PUPU_SMILE * d.smileK); } // 푸푸: 늘 입을 벌리고 웃는다 (d.smile = 0 이면 다문다. 씹을 때·졸거나 잘 때(eyeOpen < 0.3)도 다문다) // 담이는 입을 크게 벌리고 더 빠르게 헥헥 (sound.js DAMI_PANT_W = 18)
  d.jaw.rotation.x += (jt - d.jaw.rotation.x) * (1 - Math.exp(-28 * dt));
  const to = Math.max(d.tongueOut, d.lick, d.pant ? 0.7 : 0, d.pupu ? 0.35 * d.smileK : 0);
  if ((d.dami || d.pupu) && d.tongue.isGroup) { // 담이: 길게 늘어진 혀 — 턱이 벌어져도 아래로 늘어지고(중력), 헥헥할 때 살랑 흔들린다
    const tg = d.tongue, s = d.pupu ? ss(0.02, 0.45, to) : ss(0.02, 0.5, to) * (0.7 + 0.3 * to);
    tg.visible = s > 0.01; if (d.pupu) tg.scale.set(1, Math.max(s * (0.02 + 0.7 * to), 0.01), Math.max(s * (0.8 + 0.2 * to), 0.01)); else tg.scale.set(1, Math.max(s, 0.01), Math.max(s, 0.01)); // 푸푸: 웃을 때는 혀끝만 살짝, 헥헥·핥기에 더 길게
    tg.rotation.set(-d.jaw.rotation.x * 0.75 + clamp(-(c.pitch + d.hp.rotation.x) * 0.5, -0.5, 0.5) + (d.pant ? Math.sin(t * 18 + 1) * 0.07 : 0), 0, d.pant ? Math.sin(t * 3.5) * 0.06 : 0);
    tg.position.x = d.lick ? Math.sin(t * 11) * 0.006 * d.lick : 0;
  } else {
  d.tongue.position.set(d.lick ? Math.sin(t * 11) * 0.02 * d.lick : 0, 0.006 - 0.012 * to, 0.035 + 0.05 * to);
  d.tongue.scale.set(0.02, 0.007, 0.03 + 0.022 * to);
  }
}

// ================================================================
// 강아지 고르기 화면
// ================================================================
const DOGS = [
  { id: 'pupu', name: '푸푸', place: '남산 산책길', ready: true, kind: 'jindo', variant: 'pupu', colors: COLORS.pupu, room: 'namsan', make: makePupu },
  { id: 'alpang', name: '알팡', place: '쇼핑센터', ready: false, kind: 'beagle', colors: COLORS.generic },
  { id: 'pinky', name: '핑키', place: '푸맘네 집', ready: true, kind: 'beagle', colors: COLORS.pinky, room: 'home' },
  { id: 'jaerong', name: '재롱', place: '장소 정하는 중', ready: false, kind: 'beagle', colors: COLORS.generic },
  { id: 'dami', name: '담이', place: '놀이터', ready: true, kind: 'beagle', variant: 'dami', colors: COLORS.dami, room: 'park', make: makeDami },
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
  const d = info.make ? info.make(1.3, i) : buildDog({ kind: info.kind, variant: info.variant, colors: info.colors, silhouette: !info.ready, scale: 1.3, seed: i });
  d.external = true; d.root.position.y = 0.1; ped.add(d.root);
  d.meshes.forEach((m) => { m.userData.idx = i; });
  ped.children.forEach((m) => { m.userData.idx = i; });
  if (!info.ready) { d.wagAmpT = 0.15; d.wagSpeedT = 3; d.tgt.gaze = 0; d.cur.gaze = 0; }
  if (info.id === 'dami') Object.assign(d, { pant: true, wagAmpT: 0.6, wagSpeedT: 12 }); // 담이: 받침대 위에서도 혀를 길게 빼고 헥헥, 꼬리를 신나게
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
    const cCream = new THREE.Color(0xe9dcc5), cDeep = new THREE.Color(0xb79d7c), cPress = new THREE.Color(0xd6c4a8), cBase = new THREE.Color(0x8d785f), cc = new THREE.Color(); // 따뜻한 오트밀빛(핑키의 흰 털·황갈색 얼굴보다 한 톤 어둡게 — 방석 위에서 얼굴이 또렷하다)
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), r = Math.hypot(x, z), up = nor.getY(i);
      const inWell = ss(CUSH.R, CUSH.R - 0.07, r), dent = cushDent(x, z) * inWell, chin = cushChin(x, z) * ss(0.06, 0.12, y) * ss(0.2, 0.3, r);
      let ao = lerp(1, 0.62 + 0.38 * ss(0.035, 0.13, y), inWell); // 테두리와 베개 사이 골·우물 안쪽은 어둡게
      ao *= 0.72 + 0.28 * ss(0.0, 0.07, y) + 0.0 * up; // 바닥 가까이
      const tou = 0.5 + 0.5 * Math.sin(x * 31 + z * 17 + y * 23) * Math.sin(z * 29 - x * 13 + 1.7); // 털이 뭉친 얼룩
      cc.copy(cDeep).lerp(cCream, clamp(ao * (0.86 + 0.14 * tou), 0, 1)).lerp(cPress, 0.45 * Math.max(dent, chin));
      const hem = ss(0.03, 0.006, y); cc.lerp(cBase, hem); // 바닥 천(미끄럼 방지)과 꿰맨 단
      col[i * 3] = cc.r; col[i * 3 + 1] = cc.g; col[i * 3 + 2] = cc.b;
      furA[i] = (0.25 + 0.75 * ss(0.03, 0.075, y)) * ss(0.006, 0.03, y) * (1 - 0.55 * dent) * (1 - 0.5 * chin) * (0.8 + 0.2 * tou); // 털 길이: 바닥 단은 짧고, 늘 눕는 자리와 턱 자리는 눌려 있다
    }
    cg.setAttribute('color', new THREE.BufferAttribute(col, 3)); cg.setAttribute('aFur', new THREE.BufferAttribute(furA, 1));
    const cush = add(S, cg, plushBase(new THREE.MeshLambertMaterial({ vertexColors: true, color: 0xe0d2bb, emissive: 0x1d140c })), [CUSH.x, 0, CUSH.z]); // 그늘진 쪽도 따뜻한 빛이 남게 살짝 스스로 밝다
    const shells = plushShells(cush, LITE ? 6 : 10, 0.034, LITE ? 230 : 250);
    // 멀리서(방 전체를 볼 때)는 털 겹을 반만 그린다 — 가닥이 보이지 않는 거리라 차이가 없다. 핑키가 누운 자리 둘레는 그늘지게
    const _a = V3(), _b = V3(), _h = V3(); let occ = 0;
    roomUpd.push((t, dt) => {
      const far = Math.hypot(roomCam.position.x - CUSH.x, roomCam.position.y, roomCam.position.z - CUSH.z) > 3;
      shells.forEach((m, i) => { m.visible = !far || (shells.length - i) % 2 === 1; });
      const on = Math.hypot(pinky.x - CUSH.x, pinky.z - CUSH.z) < 0.3 ? clamp((0.34 - pinky.cur.bodyY) / 0.19, 0.25, 1) : 0; // 서 있을 때는 옅게, 누우면 짙게
      occ += (on - occ) * (1 - Math.exp(-3 * (dt || 0.016))); plushU.uOcc.value = occ;
      if (roomScene.environment) plushU.uAmb.value.copy(plushAmb); else plushU.uAmb.value.setRGB(0, 0, 0);
      if (occ > 0.01) {
        cush.worldToLocal(pinky.body.localToWorld(_a.set(0, -0.02, 0.13))); cush.worldToLocal(pinky.tail.getWorldPosition(_b)); cush.worldToLocal(pinky.head.localToWorld(_h.set(0, 0, 0.05)));
        _b.lerp(_a, 0.2); plushU.uOA.value.copy(_a); plushU.uOB.value.copy(_b); plushU.uOH.value.copy(_h);
      }
    });
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
// 핑키 방에만 있는 것: 방을 바꾸면 이것들을 통째로 숨긴다 (원래 보이던 그대로 되돌릴 수 있게 처음 상태를 같이 적어 둔다). 방에서 매 프레임 하던 일도 핑키 방에서만 한다
const HOME_KIDS = roomScene.children.map((o) => [o, o.visible]);
const HOME_UPD = roomUpd.splice(0);
roomUpd.push((t, dt) => { if (RP.id === 'home') for (const f of HOME_UPD) f(t, dt); });
const plushAmb = new THREE.Color(0, 0, 0);
{ // 방석 자리에서 사방을 한 번 찍어 평균 밝기를 잰다(위쪽과 옆만): 환경맵 대신 방석 털이 받는 둘레빛
  const rt = new THREE.WebGLCubeRenderTarget(16), cc = new THREE.CubeCamera(0.05, 20, rt), px = new Uint8Array(16 * 16 * 4);
  cc.position.set(CUSH.x, 0.45, CUSH.z); roomScene.add(cc); cc.update(renderer, roomScene); roomScene.remove(cc);
  let r = 0, g = 0, b = 0, n = 0;
  for (const f of [0, 1, 2, 2, 2, 4, 5]) { renderer.readRenderTargetPixels(rt, 0, 0, 16, 16, px, f); for (let i = 0; i < px.length; i += 4) { r += px[i]; g += px[i + 1]; b += px[i + 2]; n += 255; } } // 방석은 위를 보고 있으니 위쪽을 더 친다
  if (n && r + g + b > 0) plushAmb.setRGB(r / n, g / n, b / n).multiplyScalar(0.8);
  rt.dispose();
}
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
const CUSH_OB = { x: CUSH.x, z: CUSH.z, r: 0.36 }; OBST.push(CUSH_OB); // 방석: 평소에는 돌아서 다니고, 방석에 갈 때(cushGo)나 그 위에 있을 때만 비켜 준다
let cushGo = false, onCush = false, cushOn = false;
const cushLift = (dist) => (dist < CUSH.R ? CUSH.lift + 0.065 * Math.exp(-(((dist - CUSH.R) / 0.1) ** 2)) : (CUSH.lift + 0.065) * ss(0.56, CUSH.R, dist)); // 방석 위에서 몸이 올라가는 높이: 테두리를 넘을 때 가장 높고 가운데 베개에서는 낮다
// 길 찾기: 방을 8cm 격자로 나눠 A*로 장애물 사이를 지나는 길을 찾고, 곧게 갈 수 있는 구간은 곧게 편다 (가구 사이 좁은 틈에 끼어 제자리걸음을 하지 않게)
const NAV = { x0: -2.85, z0: -2.25, h: 0.08, nx: 72, nz: 62, pad: 0.15 };
// 장소마다 다른 경계: 다닐 수 있는 곳(navIn) · 몸을 붙들어 두는 곳(clamp) · 공이 튕겨 나오는 벽(ball: x0, x1, z0, z1). 핑키 방 값은 원래 그대로
const ROOM_HOME = {
  id: 'home', name: '핑키', place: '푸맘네 집 · 이태원동',
  navIn: (x, z) => x >= -2.851 && z >= -2.251 && z <= 2.601 && x <= (z > -0.6 && z < 2.1 ? 2.351 : 2.851),
  clamp(d) { d.x = clamp(d.x, -2.85, d.z > -0.6 && d.z < 2.1 ? 2.35 : 2.85); d.z = clamp(d.z, -2.25, 2.6); },
  ball: [-3.0, 2.45, -2.3, 2.7],
};
let RP = ROOM_HOME; // 지금 들어와 있는 장소 (useRoom이 바꾼다)
const navIn = (x, z) => RP.navIn(x, z);
function navFree(x, z, pad = NAV.pad) {
  if (!navIn(x, z)) return false;
  for (const o of OBST) if (o.r > 0 && Math.hypot(x - o.x, z - o.z) < o.r + pad) return false;
  return true;
}
function navSee(ax, az, bx, bz, pad = NAV.pad - 0.012) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-9;
  for (const o of OBST) {
    if (o.r <= 0) continue;
    const t = clamp(((o.x - ax) * dx + (o.z - az) * dz) / l2, 0, 1);
    if (Math.hypot(ax + dx * t - o.x, az + dz * t - o.z) < o.r + pad) return false;
  }
  const n = Math.ceil(Math.sqrt(l2) / 0.15);
  for (let i = 1; i <= n; i++) if (!navIn(ax + (dx * i) / n, az + (dz * i) / n)) return false;
  return true;
}
function route(x, z, tx, tz) {
  const { x0, z0, h, nx, nz } = NAV, N = nx * nz, goal = { x: tx, z: tz };
  if (navSee(x, z, tx, tz) && navFree(tx, tz, 0.121)) return [goal];
  const free = new Uint8Array(N);
  for (let i = 0; i < N; i++) free[i] = navFree(x0 + (i % nx) * h, z0 + Math.floor(i / nx) * h) ? 1 : 0;
  const near = (px, pz) => { // 가장 가까운 빈 칸
    let best = -1, bd = 1e9;
    const cx = Math.round((px - x0) / h), cz = Math.round((pz - z0) / h);
    for (let R = 0; R < 16 && best < 0; R++) for (let iz = cz - R; iz <= cz + R; iz++) for (let ix = cx - R; ix <= cx + R; ix++) {
      if (ix < 0 || iz < 0 || ix >= nx || iz >= nz || !free[ix + iz * nx]) continue;
      const dd = Math.hypot(x0 + ix * h - px, z0 + iz * h - pz); if (dd < bd) { bd = dd; best = ix + iz * nx; }
    }
    return best;
  };
  const s = near(x, z), g = near(tx, tz);
  if (s < 0 || g < 0) return [goal];
  const gs = new Float32Array(N).fill(1e9), from = new Int32Array(N).fill(-1), done = new Uint8Array(N), heap = [];
  const gxI = g % nx, gzI = Math.floor(g / nx), hh = (i) => Math.hypot((i % nx) - gxI, Math.floor(i / nx) - gzI);
  const push = (i, f) => { heap.push([f, i]); let k = heap.length - 1; while (k > 0) { const q = (k - 1) >> 1; if (heap[q][0] <= heap[k][0]) break; [heap[q], heap[k]] = [heap[k], heap[q]]; k = q; } };
  const pop = () => { const top = heap[0], lastE = heap.pop(); if (heap.length) { heap[0] = lastE; let k = 0; for (;;) { let m = k; const l = 2 * k + 1, r = l + 1; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
  gs[s] = 0; push(s, hh(s));
  while (heap.length) {
    const [, i] = pop(); if (done[i]) continue; done[i] = 1; if (i === g) break;
    const ix = i % nx, iz = Math.floor(i / nx);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const jx = ix + dx, jz = iz + dz; if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
      const j = jx + jz * nx; if (!free[j] || done[j]) continue;
      if (dx && dz && (!free[ix + dx + iz * nx] || !free[ix + jz * nx])) continue; // 모서리를 비스듬히 스치지 않는다
      const c = gs[i] + (dx && dz ? 1.4142 : 1);
      if (c < gs[j]) { gs[j] = c; from[j] = i; push(j, c + hh(j)); }
    }
  }
  if (!done[g]) return [goal]; // 길이 없으면 곧장 (막히면 updateDog가 풀어 준다)
  const cells = []; for (let i = g; i >= 0; i = from[i]) cells.push({ x: x0 + (i % nx) * h, z: z0 + Math.floor(i / nx) * h });
  cells.reverse();
  const gFree = navFree(tx, tz, 0.121);
  if (gFree) cells.push(goal); else cells[cells.length - 1].snap = true; // 목적지가 장애물 속: 가장 가까운 빈 칸에서 멈춘다
  const out = []; let a = { x, z }, k = 0; // 곧게 펴기
  while (k < cells.length) {
    let far = k; for (let q = cells.length - 1; q > k; q--) if (navSee(a.x, a.z, cells[q].x, cells[q].z)) { far = q; break; }
    out.push(cells[far]); a = cells[far]; k = far + 1;
  }
  return out;
}
function collide(d) {
  for (const o of OBST) {
    const dx = d.x - o.x, dz = d.z - o.z, l = Math.hypot(dx, dz), R = o.r + 0.12;
    if (l < R && l > 1e-4) { d.x = o.x + (dx / l) * R; d.z = o.z + (dz / l) * R; }
  }
  RP.clamp(d);
}
// 지금 방에 있는 강아지. 이름은 늘 pinky지만 담이 방(놀이터)에서는 useRoom이 담이로 바꿔 끼운다 (모듈 변수라 모든 코드가 그때그때의 강아지를 본다)
const PINKY = buildDog({ kind: 'beagle', colors: COLORS.pinky, scale: 1, seed: 7 });
let pinky = PINKY;
pinky.route = route; pinky.routeSee = navSee; pinky.collide = collide;
roomScene.add(pinky.root);
fitCurl(pinky);
roomUpd.push(() => {
  const dist = Math.hypot(pinky.x - CUSH.x, pinky.z - CUSH.z), inside = dist < 0.6;
  const ballOn = active && active.name === 'play' && toy.tok !== active && ball.state !== 'none' && Math.hypot(ball.g.position.x - CUSH.x, ball.g.position.z - CUSH.z) < 0.5; // 공이 방석에 떨어지면 올라가서 물어 온다
  if (dist < 0.3 || (dist < 0.5 && (cushGo || ballOn))) cushOn = true; else if (dist >= 0.5) cushOn = false; // 방석 위에 올라와 있는 동안(내려올 때까지)만 비켜 준다 — 그냥 지나갈 때는 돌아서 간다. 테두리를 넘다가 불려도 올라선 높이 그대로다
  CUSH_OB.r = cushGo || cushOn || ballOn ? -9 : 0.36;
  const up = inside && (cushGo || cushOn || ballOn); // 방석 옆을 지나갈 때는 몸이 뜨지 않는다
  if (up) pinky.liftT = cushLift(dist); else if (onCush) pinky.liftT = 0;
  onCush = up;
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
// 방석 윗면 높이(공이 얹히는 면): 통통한 테두리 + 가운데 베개. 방석 밖은 0
const cushTop = (x, z) => {
  const r = Math.hypot(x - CUSH.x, z - CUSH.z), u = (r - CUSH.R) / 0.125;
  return Math.max(Math.abs(u) < 1 ? 0.09 + 0.125 * Math.sqrt(1 - u * u) : 0, r < CUSH.R ? 0.075 : 0);
};
function stepBall(dt) { // 빠른 공은 잘게 나눠 움직인다(한 번에 방석 테두리를 지나치지 않게)
  const n = ball.state === 'fly' || ball.state === 'roll' ? clamp(Math.ceil((ball.v.length() * dt) / 0.05), 1, 8) : 1;
  for (let i = 0; i < n; i++) stepBall1(dt / n);
}
function stepBall1(dt) {
  const p = ball.g.position, ox = p.x, oz = p.z;
  if (ball.state === 'fly') {
    ball.v.y -= 9.8 * dt; p.addScaledVector(ball.v, dt);
    const top = cushTop(p.x, p.z), gy = ball.r + top;
    if (p.y < gy) {
      if (top > 0 && gy - p.y > 0.06 && cushTop(ox, oz) < top - 0.04) { // 옆에서 방석 테두리에 부딪힘: 푹신하게 튕겨 난다
        const nx = ox - CUSH.x, nz = oz - CUSH.z, l = Math.hypot(nx, nz) || 1, sg = l > CUSH.R ? 1 : -1, vn = (ball.v.x * nx + ball.v.z * nz) / l * sg; // 부딪히기 전 자리에서 본 방향(빠른 공이 테두리를 지나쳐 버려도 맞게)
        p.x = ox; p.z = oz; if (vn < 0) { ball.v.x -= (1.35 * vn * nx * sg) / l; ball.v.z -= (1.35 * vn * nz * sg) / l; } else { ball.v.x *= 0.6; ball.v.z *= 0.6; }
        if (p.y < ball.r) { p.y = ball.r; ball.v.y = Math.abs(ball.v.y) * 0.3; }
      } else {
        p.y = gy;
        if (top > 0) { ball.v.y = Math.abs(ball.v.y) > 1.6 ? -ball.v.y * 0.18 : 0; ball.v.x *= 0.5; ball.v.z *= 0.5; if (!ball.v.y) ball.state = 'roll'; else say('폭', () => ball.g.position.clone().add(V3(0, 0.1, 0)), 'small', 0.8); } // 방석 위: 폭신하게 내려앉는다
        else if (Math.abs(ball.v.y) > 0.7) { ball.v.y = -ball.v.y * 0.45; ball.v.x *= 0.75; ball.v.z *= 0.75; say('통', () => ball.g.position.clone().add(V3(0, 0.1, 0)), 'small', 0.8); }
        else { ball.v.y = 0; ball.state = 'roll'; }
      }
    }
  } else if (ball.state === 'roll') {
    const top0 = cushTop(p.x, p.z);
    if (top0 > 0 || p.y > ball.r + 0.002) { // 방석 위에서는 기울기를 따라 천천히 굴러 가운데에 안기거나 밖으로 굴러 떨어진다
      const e = 0.015, gxh = (cushTop(p.x + e, p.z) - cushTop(p.x - e, p.z)) / (2 * e), gzh = (cushTop(p.x, p.z + e) - cushTop(p.x, p.z - e)) / (2 * e);
      ball.v.x -= clamp(gxh, -1.5, 1.5) * 2.2 * dt; ball.v.z -= clamp(gzh, -1.5, 1.5) * 2.2 * dt;
      { const rx = p.x - CUSH.x, rz = p.z - CUSH.z, rl = Math.hypot(rx, rz); if (rl > 0.24 && rl < 0.43) { const b = (rl > CUSH.R ? 0.3 : -0.3) * dt / rl; ball.v.x += rx * b; ball.v.z += rz * b; } } // 둥근 테두리 꼭대기에는 얹혀 있지 못하고 안이나 밖으로 굴러 내린다
      const f = Math.exp(-4.5 * dt); ball.v.x *= f; ball.v.z *= f; p.addScaledVector(ball.v, dt);
      const gy = ball.r + cushTop(p.x, p.z);
      if (p.y > gy + 0.03) { ball.state = 'fly'; ball.v.y = 0; } else p.y += (gy - p.y) * (1 - Math.exp(-18 * dt));
      const rr = Math.hypot(p.x - CUSH.x, p.z - CUSH.z);
      if (Math.hypot(ball.v.x, ball.v.z) < 0.03 && Math.hypot(gxh, gzh) < 0.5 && Math.abs(p.y - gy) < 0.004 && !(rr > 0.26 && rr < 0.41)) ball.state = 'rest';
    } else {
      const f = Math.exp(-2.2 * dt); ball.v.x *= f; ball.v.z *= f; p.addScaledVector(ball.v, dt);
      if (cushTop(p.x, p.z) > 0.05) { // 바닥을 구르다 방석 옆구리에 닿으면 살짝 튕겨 난다
        const nx = p.x - CUSH.x, nz = p.z - CUSH.z, l = Math.hypot(nx, nz) || 1, vn = (ball.v.x * nx + ball.v.z * nz) / l;
        p.x = ox; p.z = oz; if (vn < 0) { ball.v.x -= (1.4 * vn * nx) / l; ball.v.z -= (1.4 * vn * nz) / l; }
      }
      if (Math.hypot(ball.v.x, ball.v.z) < 0.04) ball.state = 'rest';
    }
  }
  if (ball.state === 'fly' || ball.state === 'roll') {
    const [bx0, bx1, bz0, bz1] = RP.ball;
    if (p.x < bx0 || p.x > bx1) { ball.v.x *= -0.5; p.x = clamp(p.x, bx0, bx1); }
    if (p.z < bz0 || p.z > bz1) { ball.v.z *= -0.5; p.z = clamp(p.z, bz0, bz1); }
    for (const o of OBST) if (o !== CUSH_OB && p.y < (o.h ?? 0.8)) {
      const dx = p.x - o.x, dz = p.z - o.z, l = Math.hypot(dx, dz), or = o.r;
      if (l < or && l > 1e-4) { const nx = dx / l, nz = dz / l, vn = ball.v.x * nx + ball.v.z * nz; if (vn < 0) { ball.v.x -= 1.6 * vn * nx; ball.v.z -= 1.6 * vn * nz; } p.x = o.x + nx * or; p.z = o.z + nz * or; }
    }
    ball.g.rotation.x += (ball.v.z * dt) / ball.r; ball.g.rotation.z -= (ball.v.x * dt) / ball.r;
  }
}
function ballToWorld(vel) { roomScene.attach(ball.g); ball.g.scale.setScalar(1); ball.v.copy(vel || V3()); ball.state = 'fly'; }
const THROW_SPOTS = [[-0.45, -0.8], [1.05, -0.35], [0.95, 0.25], [-1.0, 1.25], [-0.2, -1.3], [0.5, -0.9]];
const crumbs = [];
const crumbGeo = box(0.008, 0.008, 0.008), crumbMat = M(0xb87a40);
function spawnCrumbs(p, n = 4, mat = crumbMat) { // mat: 부스러기 색 (담이의 덴탈껌 · 나뭇가지)
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(crumbGeo, mat); m.position.copy(p); m.castShadow = true; roomScene.add(m);
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
  const R = 0.0068 * K, SEG = 0.0207 * K, LOOP = 0.095 * K, BAR = 0.064 * K, BARR = 0.0135 * K, TS = 0.024 * K, TAILR = 0.0088 * K, EXT = 0.012 * K, LAY = 0.027 * K; // 줄은 사진보다 조금 굵게 (방 저편에서도 매듭과 고리가 읽히게)
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
    const Rk = 0.0082 * K, rk = 0.005 * K, n = LITE ? 22 : 44, t = makeTube([{ n, r: R * 1.12, lay: LAY, tre: TRE, len: 0.118 * K }], false);
    for (let k = 0; k < n; k++) { const ph = (TAU * k) / (n - 1), rr = Rk + rk * Math.cos(3 * ph); t.defs[0].C.set([rr * Math.cos(2 * ph), rk * 1.5 * Math.sin(3 * ph), rr * Math.sin(2 * ph)], k * 3); }
    t.skin(); return t.geo;
  }
  function fibreGeo(n, len, baseR, spread, mix, seed) { // 풀린 실 뭉치 (y 방향으로 퍼진다) · 가운데에 도톰한 속
    const rnd = rng(seed), pos = [], nor = [], col = [], idx = [], c = new THREE.Color(), SG = LITE ? 3 : 4;
    const pick = () => { let r = rnd(), i = 0; while (i < mix.length - 1 && r > mix[i][1]) { r -= mix[i][1]; i++; } return mix[i][0]; };
    const flare = baseR + len * Math.tan(spread * 0.55) * 0.75, cr = [[baseR * 1.05, 0], [lerp(baseR, flare, 0.5), len * 0.3], [flare * 0.85, len * 0.62], [flare * 0.5, len * 0.8], [0, len * 0.86]];
    c.set(mix[0][0]).multiplyScalar(0.95);
    cr.forEach(([rr, y], k) => { for (let j = 0; j < 7; j++) { const a = (TAU * j) / 7, w = 1 + 0.18 * Math.sin(j * 2.3 + k); pos.push(Math.cos(a) * rr * w, y, Math.sin(a) * rr * w); nor.push(Math.cos(a) * 0.9, 0.44, Math.sin(a) * 0.9); col.push(c.r, c.g, c.b); if (k < cr.length - 1) { const p = k * 7 + j, q = k * 7 + ((j + 1) % 7); idx.push(p, p + 7, q, q, p + 7, q + 7); } } });
    for (let f = 0; f < n; f++) {
      const az = rnd() * TAU, rad = Math.sqrt(rnd()), al = spread * (0.2 + 0.8 * rad), L = len * (0.7 + 0.45 * rnd()), th = 0.0023 * K * (0.75 + 0.6 * rnd()), curl = (rnd() - 0.3) * 0.7;
      c.set(pick()).multiplyScalar(0.95 + 0.3 * rnd());
      let x = Math.cos(az) * baseR * rad, y = 0, z = Math.sin(az) * baseR * rad; const v0 = pos.length / 3;
      for (let s = 0; s <= SG; s++) {
        const w = th * (1 - 0.3 * (s / SG) ** 2); // 끝까지 도톰한 솜실
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
    const tuft = new THREE.Mesh(fibreGeo(LITE ? 20 : 40, 0.02 * K, 0.006 * K, 0.8, look.tuft, 31 + r), fibMat); tuft.frustumCulled = false; knot.add(tuft);
    tuft.position.set((r ? 1 : -1) * 0.007 * K, 0.002, -0.004 * K); tuft.quaternion.setFromUnitVectors(Y, V3(r ? 1 : -1, 0.12, -0.45).normalize());
    const tass = [0, 1].map((i) => mk(fibreGeo(LITE ? 26 : 44, 0.03 * K, TAILR * 1.05, 0.5, look.tass, 51 + r * 2 + i), fibMat, false));
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
      if (it === ITER - 1) for (const o of OBST) { // 가구 · 방석 속으로는 들어가지 않는다 (공과 같은 둘레)
        const or = (o.br ?? o.r) + R, hh = o.h ?? 0.8;
        for (let i = 0; i < N; i++) { const a = i * 3; if (pins.has(i) || P[a + 1] > hh) continue; const dx = P[a] - o.x, dz = P[a + 2] - o.z, l = Math.hypot(dx, dz); if (l < or && l > 1e-4) { P[a] = o.x + (dx / l) * or; P[a + 2] = o.z + (dz / l) * or; } }
      }
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
    frames: () => vis.flatMap((v) => v.tube.defs.map((d) => d.n0)), // 줄 단면의 기준 방향(이전 모양에서 이어받는다) — 장소를 바꿀 때 떠 두고 되돌린다
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
  const surf = add(g, yg, new THREE.MeshPhysicalMaterial({ color: 0xfffdf6, roughness: 0.25, clearcoat: 0.4, clearcoatRoughness: 0.3, side: THREE.DoubleSide, emissive: 0x4a4740 }), null, null, null, false);
  // 은박 뚜껑
  const RL = 0.0318, NRr = 8, NSg = 32, lp = new Float32Array((1 + NRr * NSg) * 3), rest = [[0, 0]], li = [];
  for (let r = 1; r <= NRr; r++) for (let j = 0; j < NSg; j++) { let a = (j / NSg) * Math.PI * 2; if (a > Math.PI) a -= Math.PI * 2; const rr = (r / NRr) * RL * (1 + 0.32 * Math.exp(-((a / 0.26) ** 2))); rest.push([Math.sin(a) * rr, Math.cos(a) * rr]); }
  for (let j = 0; j < NSg; j++) li.push(0, 1 + j, 1 + ((j + 1) % NSg));
  for (let r = 0; r < NRr - 1; r++) for (let j = 0; j < NSg; j++) { const a = 1 + r * NSg + j, b = 1 + r * NSg + ((j + 1) % NSg); li.push(a, a + NSg, b, b, a + NSg, b + NSg); }
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(lp, 3)); lg.setIndex(li);
  const lidTop = add(g, lg, M(0xeef0f3, { metalness: 0.08, roughness: 0.3, emissive: 0x4a4c52 }), [0, Hc + 0.0008, 0], null, null, false);
  const lidUnder = add(g, lg, M(0xfbfaf5, { roughness: 0.6, side: THREE.BackSide, emissive: 0x3a3936 }), [0, Hc + 0.0008, 0], null, null, false);
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
  const sp = new THREE.SphereGeometry(1, 12, 8);
  add(g, sp, m, [0.0065, 0.0172, 0.1405], [0.66, 0, 0.3], [0.0078, 0.0046, 0.0066], false); // 코 위 한쪽에 살짝
  add(g, sp, m, [-0.0075, 0.0178, 0.1372], [0.4, 0, -0.5], [0.0036, 0.0027, 0.0042], false);
  add(g, sp, m, [0.008, -0.0125, 0.1295], [0.3, 0, 0], [0.0052, 0.0036, 0.004], false); // 윗입술에 한 방울
  g.visible = false; pinky.head.add(g);
  return { g, k: 0, set(k) { this.k = k = clamp(k, 0, 1); g.visible = k > 0.01; for (const c of g.children) { if (!c.userData.s) c.userData.s = c.scale.clone(); c.scale.copy(c.userData.s).multiplyScalar(Math.max(k, 0.001)); } } };
})();
// 고구마 말랑이: 쫀득하게 말린 고구마 한 줄 (메시 좌표 = g의 로컬. 월드 좌표로 쓰려면 g를 roomScene에 그대로 둔다)
function buildGoguma(seed = 3) {
  const L0 = 0.09, NL = LITE ? 12 : 22, NR = LITE ? 16 : 24, rnd = rng(seed), ph = [0, 0, 0, 0, 0, 0].map(() => rnd() * 6.28), wv = 0.9 + rnd() * 0.25;
  const nv = (NL + 1) * NR, pos = new Float32Array(nv * 3), col = new Float32Array(nv * 3), loc = new Float32Array(nv * 2), idx = [];
  const cCore = new THREE.Color('#EFA332'), cHi = new THREE.Color('#FFD066'), cEdge = new THREE.Color('#A85F1A'), cTip = new THREE.Color('#8A4A14'), c = new THREE.Color();
  for (let i = 0; i <= NL; i++) {
    const u = i / NL, e = Math.pow(Math.sin(Math.PI * clamp(u, 0.012, 0.988)), 0.38), hw = 0.0135 * wv * e * (1 + 0.08 * Math.sin(u * 21 + ph[0]) + 0.035 * Math.sin(u * 47 + ph[1])), ht = 0.0062 * Math.pow(e, 0.6) * (1 + 0.15 * Math.sin(u * 13 + ph[2]));
    for (let j = 0; j < NR; j++) {
      const a = (j / NR) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), cx = Math.sign(ca) * Math.pow(Math.abs(ca), 0.7);
      const wr = Math.sin(cx * 5.6 + 1.3 * Math.sin(u * 8 + ph[3]) + ph[4]) + 0.4 * Math.sin(cx * 12.5 + u * 26 + ph[5]), body = 1 - Math.pow(Math.abs(cx), 4); // 길이 방향 주름
      const o = i * NR + j; loc[o * 2] = hw * cx + 0.0008 * Math.sin(u * 60 + ph[1]) * e; loc[o * 2 + 1] = ht * sa * (1 + 0.2 * wr * body) + 0.0013 * wr * body * e;
      const edge = Math.pow(Math.abs(cx), 3.5), end = clamp(1 - e * 1.12, 0, 1) * 2.4, tip = ss(0.86, 1, Math.abs(u - 0.5) * 2);
      c.copy(cCore).lerp(cHi, clamp(0.5 + 0.55 * wr * Math.sign(sa || 1), 0, 1) * body).lerp(cEdge, clamp(Math.max(edge * 0.85, end) + 0.12 * Math.sin(u * 33 + cx * 4 + ph[0]), 0, 1)).lerp(cTip, tip * 0.85);
      col[o * 3] = c.r; col[o * 3 + 1] = c.g; col[o * 3 + 2] = c.b;
      if (i < NL) { const b = i * NR + ((j + 1) % NR); idx.push(o, b, o + NR, b, b + NR, o + NR); }
    }
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.setIndex(idx);
  const mat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.5, sheen: 0.4, sheenColor: new THREE.Color(0xffd9a0), sheenRoughness: 0.5, emissive: 0xb85c08, emissiveIntensity: 0.34, clearcoat: 0.25, clearcoatRoughness: 0.5 }); // 속이 비치는 듯한 호박빛
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
    lay(x, z, yaw = 0, y = 0.006) { const l = G.len / 2, sx = Math.sin(yaw) * l, sz = Math.cos(yaw) * l; G.setShape(V3(x - sx, y + 0.0075, z - sz), V3(x + sx, y + 0.0075, z + sz), 0); }, // 바닥(높이 y)에 납작하게 놓는다 (g가 월드에 있을 때)
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
  damiRelease(); // 담이의 소품 (놀이터를 지은 뒤에만)
  pupuRelease(); // 푸푸의 소품 (남산을 지은 뒤에만)
}
function resetProps() { releaseProps(); yogurt.reset(); yogurtDab.set(0); goguma.reset(); rope.reset(); toyOff(); closePicker(); sitCount = 0; }

// ================================================================
// 말풍선 (킁킁 · 냠냠 · ♥)
// ================================================================
const bubbles = [], bubbleLayer = $('#bubbles'), _p = V3();
function bubble(text, anchor, cls = '', life = 1.7, dx = null) { // 글자만 (소리 없이)
  if (pinky.talk) text = pinky.talk(text); // 강아지마다 말투 (담이: 명랑한 담과장)
  if (pinky.dami && cls === 'soft') cls = 'soft dm'; // 담이의 말: 해 질 녘 모래밭 위에서도 또렷하게 (조금 더 진한 바탕)
  const el = document.createElement('div'); el.className = 'bubble ' + cls; el.textContent = text; el.style.opacity = 0; // 자리를 잡기 전(다음 프레임)까지는 보이지 않게 — 화면 구석에 한 번 번쩍이지 않도록
  bubbleLayer.appendChild(el);
  bubbles.push({ el, anchor, age: 0, life, dx: dx ?? (Math.random() - 0.5) * 40 });
}
function say(text, anchor, cls = '', life = 1.7, dx = null) {
  bubble(text, anchor, cls, life, dx);
  snd('onSay', text); // 말풍선 글자에 맞는 소리 (왈! → 짖는 소리 …)
}
// 소리는 덤이다: 소리 쪽에서 무슨 일이 나도 방은 멈추지 않는다
function snd(fn, ...a) { try { return sound[fn](...a); } catch (e) { return null; } }
const headTop = () => pinky.head.localToWorld(V3(0, 0.125, 0.015));
const noseTip = () => pinky.head.localToWorld(V3(0, 0.004, 0.14));
const mouthPt = () => pinky.head.localToWorld(V3(0, -0.025, 0.115));
const heart = () => say('♥', headTop, 'heart', 1.4, (Math.random() - 0.5) * 90);
function stepBubbles(dt, cam) {
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i]; b.age += dt;
    _p.copy(b.anchor()); _p.y += b.age * 0.1; _p.project(cam);
    if (!b.h) { b.h = b.el.offsetHeight || 1; b.w = b.el.offsetWidth || 1; }
    const x = clamp((_p.x * 0.5 + 0.5) * innerWidth + b.dx, b.w / 2 + 6, Math.max(b.w / 2 + 6, innerWidth - b.w / 2 - 6)), y = Math.max((-_p.y * 0.5 + 0.5) * innerHeight, b.h + 8); // 가까이서 볼 때도 화면 밖으로 잘리지 않게
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
const setCamPos = (a) => (RP.camPos ? RP.camPos(CAM_POS, a) : CAM_POS.set(0, a < 0.8 ? 1.42 : 1.22, a < 0.8 ? 3.65 : 3.0)); // 보는 자리 (세로 화면은 조금 높고 멀리)
function kneelFor(spot, dist = 0.82, h = 0.72, aimY = 0.27) {
  const ck = pinky.camK || 1; if (ck !== 1) { dist *= ck; h += (ck - 1) * 0.35; aimY += (ck - 1) * 0.3; } // 큰 강아지(푸푸)는 조금 더 물러나 높이 본다
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
  Object.assign(d, { stuckT: 0, lastP: null, path: null, ghost: false, stuckN: 0, walkT: 0, walkTarget: null, walkSpeed: 0.5, chew: false, lick: 0, tongueOut: 0, pant: false, sniff: 0, paddle: 0, paddleFront: false, shuffle: 0, tailWrap: false, tailLow: 0, turnCap: 0, lookFn: null, face: 'cam', eyeOpen: 1, tiltT: 0, jawOpen: 0, earPerk: 0, wagAmpT: 0.3, wagSpeedT: 6, liftT: 0 });
}
function releaseHands() { handR.want = null; handL.want = null; treat.visible = false; roomScene.add(treat); scoop.visible = false; pouring = false; releaseProps(); }
function startCommand(name, fn, keepCam = false) {
  if (RP.off && RP.off[name]) return; // 이 장소에는 없는 것 (놀이터: 밥 주기 · 방석)
  cancelActive();
  const tok = { cancelled: false, cleanups: [], name };
  active = tok; setActiveBtn(name); idleT = 5;
  resetTransient(pinky); releaseHands(); brainStart(name, tok);
  if (pinky.tgt.name === 'held' || pinky.tgt.name === 'eat') setPose(pinky, 'stand', 5);
  let run = fn;
  if (!['touch', 'cushion'].includes(name)) pinky.napEnd = 0;
  if (pinky.tgt.name === 'curl' || pinky.curlK > 0.3) { // 방석에서 자다가: 쓰다듬거나 계속 재울 때는 눈을 번쩍 뜨지 않고, 불리면 차례로 천천히 일어난 다음에 한다
    if (['touch', 'cushion', 'roam'].includes(name)) Object.assign(pinky, { eyeOpen: Math.min(pinky.eyeY, 0.3), face: null, wagAmpT: 0.05 });
    else { Object.assign(pinky, { eyeOpen: pinky.eyeY, face: null, wagAmpT: 0.1, wagSpeedT: 5 }); const goHome = !keepCam && !['sit', 'down', 'roll'].includes(name); run = async (tk) => { await wakeUp(tk, name); if (goHome) camHome(); return fn(tk); }; keepCam = true; } // 일어나는 모습을 지켜본 다음에 시점이 물러난다
  }
  if (!keepCam) camHome();
  run(tok).then(() => { if (active === tok) { active = null; setActiveBtn(null); idleT = 4; brainDone(name); } })
    .catch((e) => { if (e === CANCEL) return; console.error(e); if (active === tok) { active = null; setActiveBtn(null); idleT = 4; } });
}
// 자다가 불렸을 때: 눈을 뜨고 귀를 쫑긋(응…?) → 고개를 들고 → 제자리에서 말았던 몸을 천천히 펴 엎드리고 → 일어서고 → 발을 옮겨 디디며 돌아본다
// (다 일어설 때까지 몸을 돌리거나 걷지 않는다). 나이 든 강아지답게 2.5초 남짓
async function wakeUp(tok, name) {
  const e0 = pinky.eyeY; pinky.blinkT = 4; pinky.sigh = 0;
  pinky.tgt.gaze = 0.7; pinky.tgt.headPitch = -0.3; pinky.earPerk = 0.3;
  say('응…?', headTop, 'small', 1.3);
  await tween(tok, 0.6, (k) => { pinky.eyeOpen = lerp(e0, 0.55, ease(k)); });
  pinky.earPerk = 0; await wait(tok, 0.25);
  setPose(pinky, 'down', 0.4); pinky.tgt.gaze = 0.9;
  await tween(tok, 1.1, (k) => { pinky.eyeOpen = lerp(0.55, 1, ease(k)); pinky.poseRate = lerp(0.4, 3.4, k); }); // 몸을 펴는 것도 천천히 시작한다
  Object.assign(pinky, { eyeOpen: 1, wagAmpT: 0.3, wagSpeedT: 6 });
  if (['down', 'roll'].includes(name)) return; // 누운 채로 하는 것은 그 자리에서 그대로
  setPose(pinky, 'stand', 2.8); await wait(tok, 0.85);
  const err = () => Math.abs(angDiff(pinky.yaw, Math.atan2(roomCam.position.x - pinky.x, roomCam.position.z - pinky.z) + pinky.cur.yawOff)), t1 = clock + 1.3;
  pinky.turnCap = 1.5; pinky.face = 'cam'; tok.cleanups.push(() => { pinky.turnCap = 0; });
  await until(tok, () => clock > t1 || err() < 0.3);
  pinky.turnCap = 0;
}
async function walkTo(tok, x, z) {
  Object.assign(pinky, { walkTarget: { x, z }, stuckT: 0, lastP: null, path: null, ghost: false, stuckN: 0, walkT: 0 });
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
  tok.cleanups.push(() => { cushGo = false; pinky.sigh = 0; pinky.shuffle = 0; });
  const hush = (...a) => { for (const q of bubbles) if (q.anchor === headTop) q.life = Math.min(q.life, q.age + 0.3); say(...a); }; // 잠결 말풍선은 한 번에 하나만
  if (pinky.tgt.name !== 'curl' || dist() > 0.1) {
    setPose(pinky, 'stand', 4); pinky.walkSpeed = 0.4; pinky.wagAmpT = 0.4; pinky.wagSpeedT = 8;
    cushGo = true;
    if (dist() > 0.8) await walkTo(tok, C.ex, C.ez);
    view();
    pinky.walkSpeed = 0.26; pinky.tgt.gaze = 0.15; pinky.tgt.headPitch = 0.4;
    pinky.wagAmpT = 0.22; pinky.wagSpeedT = 5; pinky.tailLow = 0.3; // 제 자리에 오면 꼬리도 느슨해진다
    const near = dist() < 0.08;
    await walkTo(tok, C.x, C.z);
    // 빙글빙글: 몸을 마는 쪽(왼쪽)으로, 코를 바닥에 대고 작은 원을 그리며 돌다가 눕는 방향에서 멈춘다
    let a0 = pinky.yaw, turn = CUSH.yaw - a0; turn -= Math.floor(turn / (Math.PI * 2)) * Math.PI * 2;
    const skip = near && (turn < 0.7 || turn > Math.PI * 2 - 0.7); // 자리를 다 잡은 뒤에 쓰다듬다 만 것이면 다시 돌지 않고 그대로 눕는다
    if (skip) { pinky.face = { x: pinky.x + Math.sin(CUSH.yaw), z: pinky.z + Math.cos(CUSH.yaw) }; await wait(tok, 0.6); pinky.face = null; pinky.yaw = CUSH.yaw; }
    else {
      if (turn < 3.3 || (turn < 4.6 && Math.random() < 0.4)) turn += Math.PI * 2; // 한 바퀴 남짓 ~ 한 바퀴 반
      const half = turn > 7 ? 0.5 : 0.58;
      // 나이 든 강아지답게 느릿느릿: 몸을 조금 낮추고 고개를 숙여, 천천히 돌기 시작해 천천히 멈추고, 도는 쪽으로 허리와 꼬리가 휘며 발을 조금씩 옮겨 딛는다
      const nose = () => Object.assign(pinky.tgt, { gaze: 0.05, headPitch: 0.62, neck: 0.35, bodyY: POSES.stand.bodyY - 0.022 });
      const spin = (from, to) => tween(tok, (Math.abs(to - from) * turn) / 1.15 + 0.6, (k) => {
        const w = Math.sin(Math.PI * k), a = a0 + turn * lerp(from, to, k * k * (3 - 2 * k)), r = 0.06 * (from ? Math.min(1, (1 - k) * 3) : Math.min(1, k * 3)); // 처음 반은 원으로 걸어 나가고, 나중 반은 가운데로 돌아온다
        pinky.x = C.x - r * Math.cos(a); pinky.z = C.z + r * Math.sin(a); pinky.yaw = a;
        pinky.shuffle = 0.25 + 0.4 * w; pinky.tgt.bendY = -0.4 * w; pinky.tgt.headTilt = 0.1 * w; pinky.tgt.tailCurl = -0.5 * w;
      });
      pinky.face = null; nose();
      pinky.sniff = 0.4; say('킁킁', noseTip, 'small', 1.2); await spin(0, half); pinky.shuffle = 0;
      pinky.sniff = 0; await wait(tok, 0.4);
      // 꾹꾹: 고개를 숙이고 앞발로만 번갈아 자리를 다진다
      Object.assign(pinky.tgt, { gaze: 0, headPitch: 0.5, neck: 0.75, pitch: 0.1 }); await wait(tok, 0.45);
      pinky.paddleFront = true; pinky.paddle = 0.55; say('꾹꾹', headTop, 'small', 1.5); await wait(tok, 1.7); pinky.paddle = 0;
      await wait(tok, 0.25); pinky.paddleFront = false; pinky.tgt.pitch = 0; nose(); await wait(tok, 0.35);
      pinky.sniff = 0.3; await spin(half, 1); pinky.sniff = 0; pinky.shuffle = 0;
      await wait(tok, 0.6); pinky.yaw = a0 + turn; pinky.x = C.x; pinky.z = C.z;
    }
    pinky.wagAmpT = 0.12; pinky.wagSpeedT = 4;
    setPose(pinky, 'down', 2.2); pinky.tgt.gaze = 0.2; pinky.tailWrap = true; await wait(tok, 1.3); // 나이 든 강아지답게 차례로: 먼저 앞다리를 접어 엎드리고(꼬리는 몸 곁으로 돌아온다)
    setPose(pinky, 'curl', 0.3); tween(tok, 1.6, (k) => { pinky.poseRate = lerp(0.3, 2.0, k); }).catch(() => {}); await lids(0.45, 2.8); // 그다음 엉덩이를 옆으로 털썩 누이며 몸을 만다
    pinky.sigh = 0; await tween(tok, 2.2, (k) => { pinky.sigh = Math.sin(Math.PI * k) ** 2; }); // 눕고 나서 한숨
    hush('후우…', headTop, 'soft', 1.8);
  } else { setPose(pinky, 'curl', 1.9); curlHead(); view(); await wait(tok, 0.8); } // 쓰다듬다 만 뒤: 고개를 다시 테두리에 내려놓고 그대로 잠든다
  curlHead(); pinky.wagAmpT = 0.03; await lids(0.04, 2.6);
  const zz = ['쿨…', 'z Z', '쿨…', '새근…'];
  for (let t0 = clock, n = 0; cam ? clock < pinky.napEnd : clock - t0 < sec; n++) { // 버튼으로 재운 낮잠은 napEnd(정해진 시각)까지: 쓰다듬어도 늘어나지 않는다
    pinky.blinkT = 9;
    await wait(tok, 2.4 + Math.random() * 1.4);
    const r = Math.random();
    if (n > 1 && r < 0.14) { // 꿈꾸며 움찔: 발과 귀가 떨리고 꼬리가 탁탁
      pinky.paddle = 0.16; pinky.earPerk = 0.35; pinky.wagAmpT = 0.16; pinky.wagSpeedT = 9;
      await wait(tok, 0.55); pinky.paddle = 0; pinky.earPerk = 0; await wait(tok, 0.7); pinky.wagAmpT = 0.03; pinky.wagSpeedT = 4;
    } else if (n > 1 && r < 0.27) { // 자다가 한숨
      await tween(tok, 2.6, (k) => { pinky.sigh = Math.sin(Math.PI * k) ** 2; }); pinky.sigh = 0;
      hush('후우…', headTop, 'soft', 1.8);
    } else hush(zz[n % zz.length], headTop, n % 2 ? 'small' : '', 2.1, 18 + Math.random() * 26);
  }
  // 천천히 깨어난다: 눈을 반쯤 뜨고 → 고개를 들어 쳐다보고 → 엎드렸다가 → 일어나 방석에서 내려온다
  pinky.napEnd = 0; pinky.blinkT = 4;
  await lids(0.35, 1.6);
  pinky.tgt.gaze = 0.75; pinky.wagAmpT = 0.22; pinky.wagSpeedT = 6; await lids(0.8, 1.5);
  pinky.eyeOpen = 1; say('잘 잤다…', headTop, 'soft', 1.8); await wait(tok, 1.6);
  if (cam) camHome();
  setPose(pinky, 'down', 2.2); pinky.face = null; await wait(tok, 1.0);
  setPose(pinky, 'stand', 2.6); pinky.tailWrap = false; pinky.wagAmpT = 0.3; pinky.wagSpeedT = 7; pinky.tailLow = 0; await wait(tok, 1.2); // 일어서면 감았던 꼬리도 풀린다
  // 기지개: 앞을 낮추고 엉덩이를 든 채 쭈욱, 눈을 지그시 감았다가 다시 서서 꼬리를 흔든다
  Object.assign(pinky.tgt, { pitch: 0.3, bodyY: POSES.stand.bodyY - 0.035, bodyZ: -0.03, headPitch: -0.35, gaze: 0.3, neck: 0.15 }); pinky.poseRate = 2.6; pinky.earPerk = -0.4;
  hush('쭈욱…', headTop, 'soft', 1.5); await lids(0.25, 0.6); await wait(tok, 0.9);
  setPose(pinky, 'stand', 3); pinky.turnCap = 1.5; pinky.face = 'cam'; lids(1, 0.6).catch(() => {}); pinky.earPerk = 0; pinky.wagAmpT = 0.5; pinky.wagSpeedT = 10; await wait(tok, 1.2); pinky.turnCap = 0;
  cushGo = true; pinky.walkSpeed = 0.3; await walkTo(tok, C.ex, C.ez); cushGo = false; pinky.walkSpeed = 0.5;
}

const napKeep = () => pinky.napEnd > clock + 3 && Math.hypot(pinky.x - CUSH.x, pinky.z - CUSH.z) < 0.5;
const CMDS = {
  async cushion(tok) { if (!(pinky.napEnd > clock + 3)) pinky.napEnd = clock + 90; await cushionNap(tok, 0, true); }, // 버튼을 누른 때부터 90초(가서 눕는 시간 포함). 쓰다듬은 뒤에는 남은 시간만 잔다
  async sit(tok) { await nearFirst(tok); if (deafOK(tok)) await playDeaf(tok); await sitCommand(tok); }, // 정면(대개) 또는 옆으로 앉는다
  async down(tok) {
    await nearFirst(tok);
    setPose(pinky, 'down', 4);
    pinky.wagAmpT = 0.25; pinky.wagSpeedT = 5;
    await wait(tok, 1.4);
    pinky.tiltT = 0.18; await wait(tok, 1.2); pinky.tiltT = 0;
    await wait(tok, 2.5);
  },
  async roll(tok) {
    await nearFirst(tok);
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
    if (RP.toys && kind !== 'ball') return RP.toys(tok, kind); // 담이(놀이터): 패트병 · 나뭇가지 · 오둥이
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
    // 쫓아가서 문다
    pinky.wagAmpT = 0.7;
    await ballChase(tok, 1.15, 12);
    brain.d.play = Math.max(0, brain.d.play - 0.2);
    const mood = ballMood(); // 간식을 한동안 못 받았으면 순순히 주지 않는다
    if (mood !== 'nice') return ballCheeky(tok, mood);
    brain.throws++; brain.refusals = 0; brain.owe = false; mark('ball:nice');
    await ballGive(tok, '또 던져!');
  },
  async treat(tok, kind = 'gum') {
    if (RP.treat) return RP.treat(tok, kind); // 담이(놀이터): 칫솔껌 · 악어껌
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
      if (i === 3 && (brain.force.crumb ?? (drops.length < 4 && Math.random() < 0.3))) { const m = mouthPt(), r = camRight(), sg = Math.random() < 0.5 ? 1 : -1; dropTreat(m.x + r.x * sg * 0.42, m.z + r.z * sg * 0.42 - 0.1, 'bit', m); mark('crumb'); } // 한 조각이 옆으로 튀어 굴러간다 (나중에 냄새로 찾는다)
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
    await wait(tok, 0.8); spillKibble(); await wait(tok, 0.2); pouring = false;
    await tween(tok, 0.4, (k) => { roll = -1.9 * (1 - ease(k)); });
    handR.want = null;
    await going;
    pinky.walkSpeed = 0.5; pinky.lookFn = null; pinky.face = { x: BOWL.x, z: BOWL.z };
    await wait(tok, 0.4);
    setPose(pinky, 'eat', 5); pinky.chew = true;
    const words = ['챱챱', '와구와구', '냠냠', '챱챱', '와구와구', '냠'];
    const leave = mound.amount > 0.6 && (brain.force.left ?? (!brain.leftLast && Math.random() < BRAIN.leftP)); brain.leftLast = leave; // 가끔은 먹다 말고 남긴다 (나중에 혼자 와서 마저 먹는다)
    for (let i = 0; i < words.length; i++) {
      say(words[i], headTop, '', 1.2, (i % 2 ? 1 : -1) * 75);
      mound.amount = Math.max(0, mound.amount - 1 / words.length); updateMound();
      await wait(tok, 0.55);
      if (leave && i === 2) {
        pinky.chew = false; brain.leftAt = clock; mark('left');
        pinky.lick = 1; say('할짝', headTop, '', 1.1, 70); await wait(tok, 0.7); pinky.lick = 0;
        setPose(pinky, 'stand', 4); pinky.face = 'cam'; pinky.tiltT = 0.2; pinky.wagAmpT = 0.4; pinky.wagSpeedT = 7;
        say('배불러…', headTop, 'soft', 1.6); await wait(tok, 1.5); pinky.tiltT = 0;
        pinky.lookFn = () => BOWL; say('이따 먹어야지', headTop, 'soft', 1.7); await wait(tok, 1.3); pinky.lookFn = null;
        camHome(); pinky.walkSpeed = 0.45; await walkTo(tok, HOME.x, HOME.z); pinky.walkSpeed = 0.5; pinky.face = 'cam';
        return;
      }
    }
    pinky.chew = false; mound.amount = 0; updateMound();
    pinky.lick = 1; say('할짝할짝', headTop, '', 1.2, 70); await wait(tok, 0.9); pinky.lick = 0;
    setPose(pinky, 'stand', 5); pinky.face = 'cam'; pinky.tiltT = 0.3;
    say('…더 없어?', headTop, 'soft', 2); await wait(tok, 1.8); pinky.tiltT = 0;
    camHome(); await walkTo(tok, HOME.x, HOME.z); pinky.face = 'cam';
  },
  async sniff(tok) {
    pinky.wagAmpT = 0.45; pinky.wagSpeedT = 10;
    // 냄새를 맡고 다니다가 어디 떨어진 간식을 찾으면 주워 먹는다 (바닥에 없으면 어딘가 하나 숨어 있기도 하다)
    if (!drops.length && (brain.force.hide ?? (brain.sniffs === 0 || Math.random() < 0.6))) hideTreat();
    brain.sniffs++; let found = 0;
    const hunt = async (reach) => { const dr = found < 2 ? nearestDrop(reach) : null; if (dr && (await findTreat(tok, dr))) found++; };
    await sniffAt(tok, SPOTS.gifts, nearestDrop(1.5) ? null : rot('gifts', RP.lines.gifts));
    if (nearestDrop(1.5)) await hunt(1.5); else if ((brain.force.sneeze ?? Math.random() < 0.2) && cdOK('sneeze', 45)) { brain.cd.sneeze = clock; await sneeze(tok); }
    if (RP.noBowl) await sniffAt(tok, RP.sniffMid, nearestDrop(1.2) ? null : rot('mid', RP.lines.mid)); // 밥그릇이 없는 곳(놀이터)
    else if (hasLeft()) await eatLeft(tok, false); // 밥이 남아 있으면 마저 먹는다
    else await sniffAt(tok, { x: EAT.x, z: EAT.z, fx: BOWL.x, fz: BOWL.z }, nearestDrop(1.2) ? null : '밥그릇 비었네…');
    await hunt(1.2);
    await sniffAt(tok, SPOTS.table, drops.length ? null : found ? '더 없나…' : RP.lines.tableSniff);
    await hunt(99);
    pinky.sniff = 0; pinky.tgt.gaze = 1; pinky.tgt.headPitch = 0;
    await walkTo(tok, HOME.x, HOME.z);
    pinky.face = 'cam'; pinky.wagAmpT = 0.4; pinky.wagSpeedT = 8;
    await wait(tok, 0.8);
  },
  async touch(tok) {
    const keep = napKeep(); // 방석 버튼으로 재우는 중(가서 눕는 동안 포함)에 쓰다듬으면: 방석을 보던 시점 그대로, 끝나면 이어서 잔다
    if (!keep) { const [p, a] = kneelAt(0.78, 0.95, 0.22); camTo(p, a, 2.2); }
    happy(true); if (['side', 'belly'].includes(pinky.tgt.name)) pinky.paddle = 0.5;
    const curled = pinky.tgt.name === 'curl'; // 방석에서 자는 중이면 깨우지 않고 눈만 살짝, 꼬리만 탁탁
    if (curled) { Object.assign(pinky, { face: null, pant: false, eyeOpen: 0.2, tiltT: 0.07, earPerk: 0.3, wagAmpT: 0.28, wagSpeedT: 7 }); pinky.tgt.headPitch = POSES.curl.headPitch + 0.05; wait(tok, 0.5).then(() => { pinky.earPerk = 0; }, () => {}); } // 손길에 귀를 한 번 쫑긋, 머리를 손 쪽으로 살짝 기댄다
    else if (pinky.tgt.name === 'stand' && Math.hypot(pinky.x - CUSH.x, pinky.z - CUSH.z) < 0.6) setPose(pinky, 'stand', 4); // 방석에서 빙글 돌거나 꾹꾹 하던 중이면 몸을 바로 하고 선다
    say('좋아…', headTop, 'soft', 1.6);
    handR.want = { pos: () => touch.pt.clone().addScaledVector(touch.n, 0.02), up: () => touch.n, curl: 0.12, rate: 16, shoulder: [0.34, -0.15, 0.05] };
    await until(tok, () => !touch.active);
    handR.want = null; pinky.paddle = 0;
    await wait(tok, 0.6); happy(false); if (curled) { pinky.eyeOpen = 0.3; pinky.wagAmpT = 0.1; } else pinky.tiltT = 0.3; say('더 해줘…', headTop, 'soft', 1.8);
    if (curled) { pinky.tgt.headPitch = POSES.curl.headPitch; await tween(tok, 2.0, (k) => { pinky.sigh = Math.sin(Math.PI * k) ** 2; pinky.eyeOpen = lerp(0.3, 0.1, k); }); pinky.sigh = 0; } // 손이 떠나면 크게 한숨 쉬고 다시 눈을 감는다
    else await wait(tok, 1.6);
    pinky.tiltT = 0;
    if (keep && napKeep()) { startCommand('cushion', CMDS.cushion, true); return; }
    camHome();
  },
  async worm(tok) { await wormDance(tok); }, // 담이(놀이터)에만 있는 버튼
  async zoom(tok) { await zoomies(tok); },
  async dig(tok) { await damiDig(tok); }, // 담이(놀이터)에만 있는 버튼: 땅 파기
  async paw(tok) { await pupuPaw(tok); }, // 푸푸(남산)에만 있는 버튼: 손 · 하이파이브 · 물장구 · 똥츄
  async high5(tok) { await pupuHigh5(tok); },
  async splash(tok) { await pupuSplash(tok); },
  async poop(tok) { await pupuPoop(tok); },
};
// ---------- 담이: 지렁이 댄스 — 벌러덩 드러누워 등을 바닥에 비비며 몸을 좌우로 꿈틀꿈틀, 다 하고 나면 부르르 털고 일어난다
async function wormDance(tok, solo = false) {
  if (!solo) await comeHere(tok, 0.85);
  pinky.face = 'cam'; happy(true); pinky.eyeOpen = 0.7; pinky.cheerOn = false;
  say('지렁이 댄스!', headTop, '', 1.4);
  setPose(pinky, 'side', 3.6); await wait(tok, 0.8);
  setPose(pinky, 'belly', 4); pinky.paddle = 0.4; await wait(tok, 0.8);
  const B = poseFor('belly', pinky), t0 = clock;
  pinky.tongueOut = 0.6; say('꿈틀꿈틀~', headTop, 'soft', 1.8);
  await tween(tok, solo ? 3.6 : 4.8, (k) => {
    const ph = (clock - t0) * 7.2, s = Math.sin(ph), e = ss(0, 0.1, k) * ss(1, 0.88, k);
    pinky.poseRate = 10;
    Object.assign(pinky.tgt, { roll: B.roll + 0.28 * s * e, bendY: B.bendY + 0.4 * s * e, headTilt: B.headTilt - 0.3 * s * e, headPitch: B.headPitch + 0.08 * Math.sin(ph * 0.5 + 0.6) * e });
    pinky.paddle = 0.4 + 0.5 * e; pinky.wagAmpT = 0.6; pinky.wagSpeedT = 12;
  });
  pinky.paddle = 0.2; setPose(pinky, 'belly', 4); await wait(tok, 0.5);
  setPose(pinky, 'side', 3.2); pinky.paddle = 0; pinky.tongueOut = 0; await wait(tok, 0.7);
  setPose(pinky, 'stand', 3.4); await wait(tok, 0.9);
  await shakeOff(tok); // 등에 묻은 모래를 부르르
  pinky.face = 'cam'; happy(true); pinky.cheerOn = false; pinky.eyeOpen = 0.8;
  say(rot('worm', ['등 시원하다!', '오늘 댄스 완료!', '한 번 더 할까요?']), headTop, 'soft', 1.8); await wait(tok, 1.8);
  happy(false);
}
// ---------- 담이: 우다다 — 신이 나서 엉덩이를 들고 앞을 낮췄다가(놀자!) 모래밭 가운데를 크게 몇 바퀴 내달린다
async function zoomies(tok, solo = false) {
  const Z = RP.zoom || [[HOME.x + 0.6, HOME.z - 0.6], [HOME.x - 0.6, HOME.z - 0.6]];
  happy(true); pinky.cheerOn = false; pinky.eyeOpen = 0.9; pinky.face = 'cam';
  setPose(pinky, 'stand', 6); Object.assign(pinky.tgt, { pitch: 0.3, bodyY: POSES.stand.bodyY - 0.04, bodyZ: -0.03, headPitch: -0.2 }); pinky.wagAmpT = 0.9; pinky.wagSpeedT = 18; pinky.earPerk = 0.6;
  say('우다다다!', headTop, '', 1.3); await wait(tok, 0.8);
  setPose(pinky, 'stand', 8); pinky.walkSpeed = 1.15; pinky.earPerk = -0.4; pinky.tgt.headPitch = -0.05;
  tok.cleanups.push(() => { pinky.walkTarget = null; });
  const near = Z.reduce((b, p, i) => (Math.hypot(p[0] - pinky.x, p[1] - pinky.z) < Math.hypot(Z[b][0] - pinky.x, Z[b][1] - pinky.z) ? i : b), 0);
  const dir = Math.random() < 0.5 ? 1 : -1, n = Z.length + 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) { // 점마다 멈추지 않고 가까워지면 다음 점으로 (크게 돌며 내달린다)
    const [x, z] = Z[(near + dir * i + Z.length * 9) % Z.length];
    Object.assign(pinky, { walkTarget: { x, z }, stuckT: 0, lastP: null, path: null, ghost: false, stuckN: 0, walkT: 0 });
    await until(tok, () => !pinky.walkTarget || Math.hypot(pinky.x - x, pinky.z - z) < 0.4);
  }
  pinky.walkSpeed = 0.7; pinky.earPerk = 0;
  if (!solo) await walkTo(tok, HOME.x, HOME.z); else pinky.walkTarget = null;
  pinky.walkSpeed = 0.5; sitFront(6); pinky.wagAmpT = 0.7; pinky.wagSpeedT = 14;
  await wait(tok, 0.6); say(rot('zoom', ['헥헥, 신난다!', '오늘도 열일!', '한 바퀴 더?']), headTop, 'soft', 1.8); await wait(tok, 2.0);
  happy(false); pinky.pant = true; await wait(tok, 1.2); pinky.pant = false; // 숨이 가라앉을 때까지 조금 더 헥헥
}
// 담이: 혼자 놀 때 기분이 좋아 자주 혀를 빼고 헥헥 (입이 바쁠 때 · 냄새 맡을 때는 다문다). 명령 중에는 손대지 않는다
roomUpd.push((t, dt) => {
  const d = pinky; if (!d.cheer) return;
  if (!idleNow()) { d.cheerOn = false; return; }
  d.cheerT += dt; if (d.cheerT > (d.cheerP || 12)) { d.cheerT = 0; d.cheerP = 10.5 + Math.random() * 4; d.cheerL = 3.5 + Math.random() * 2; } // 한 번에 4초 남짓 헥헥, 사이는 6~9초 쉰다 (늘 헥헥대지 않게)
  const want = d.cheerT < (d.cheerL || 4.5) && !d.chew && !(d.lick > 0) && !(d.sniff > 0) && !(d.jawOpen > 0) && ball.state !== 'mouth' && !rope.pinned() && ['stand', 'sit', 'down'].includes(d.tgt.name);
  if (want && !d.pant) { d.pant = true; d.cheerOn = true; } else if (!want && d.cheerOn) { d.pant = false; d.cheerOn = false; }
});

// ================================================================
// 담이 성격 (놀이터 · 담이에게만) — 외동딸: 엄마 관심 독차지 · 친구한테 괜히 센 척 · 간식만 보면 꼬리 프로펠러
// ================================================================
const DM = { wigA: 0, frenzy: false, friend: null, friendAt: 0, attnN: 0, lastIn: null, away: 0 };
const awakeUp = () => ['stand', 'sit', 'down'].includes(pinky.tgt.name) && !(pinky.curlK > 0.05);
// 간식만 보면 꼬리를 아주 빠르고 크게 흔들고 엉덩이까지 실룩실룩 — 간식 명령(무슨 간식이든)이면 저절로 켜진다. 다른 데서 직접 켜고 끌 수도 있다
// damiTreatWag(on): 아래 '담이의 간식' 쪽에 하나로 (treatWag 표시도 거기서 켠다)
roomUpd.push((t, dt) => {
  const d = pinky; if (!d.dami) return;
  const lying = ['down', 'side', 'belly'].includes(d.tgt.name), upr = d.tgt.name === 'stand' || d.tgt.name === 'sit';
  const fr = !!d.treatWag || (!!active && active.name === 'treat');
  const pet = !!active && (active.name === 'pet' || active.name === 'touch') && (!!handR.want || touch.active); // 쓰다듬는 손길: 꼬리 붕붕 · 엉덩이 실룩 · 손 쪽으로 고개를 기댄다
  let A = 0;
  if (fr) { d.wagAmpT = lying ? 0.65 : 1.2; d.wagSpeedT = lying ? 11 : 31; A = upr ? 0.2 : 0; if (d.tgt.name === 'sit') d.tgt.tail = -0.15; } // 앉아서도 꼬리를 세워 붕붕 (마주 봐도 보이게) · 엎드려 먹을 때는 느리게 (바닥을 덜 탁탁)
  else if (pet) { d.wagAmpT = Math.max(d.wagAmpT, 0.95); d.wagSpeedT = Math.max(d.wagSpeedT, 22); A = upr ? 0.1 : 0; d.tiltT = Math.max(d.tiltT, 0.3); }
  if (DM.frenzy && !fr) { d.wagAmpT = 0.45; d.wagSpeedT = 9; d.tgt.tail = poseFor(d.tgt.name, d).tail; } DM.frenzy = fr;
  DM.wigA += (A - DM.wigA) * (1 - Math.exp(-6 * dt));
  d.wig = DM.wigA > 0.002 ? DM.wigA * Math.sin(d.wagPhase + Math.PI) : 0; // 엉덩이는 꼬리와 반대로
  if (brain.lastInput !== DM.lastIn) { DM.lastIn = brain.lastInput; DM.attnN = 0; } // 엄마가 뭘 해 주면 다시 처음부터 조른다
  // 엄마가 딴 데(화면을 끌어 옆이나 하늘)를 한참 보면 샘이 나서: 엄마 나만 봐!
  const away = Math.abs(look.ty) > 0.5 || look.tp > 0.3;
  DM.away = away && idleNow() && awakeUp() ? DM.away + dt : 0;
  if (DM.away > 2 && cdOK('jealous', 40)) { DM.away = 0; brain.cd.jealous = clock; startSpecial('jealous', (tok) => damiAttn(tok, 'jealous')); }
});
// 입을 벌려 컹! 할 때마다 고개를 살짝 쳐든다 (소리는 말풍선 '컹'이 낸다)
function barkMove(tok, n = 1) {
  (async () => { for (let i = 0; i < n; i++) { const hp = pinky.tgt.headPitch; pinky.jawOpen = 0.42; pinky.tgt.headPitch = hp - 0.12; await wait(tok, 0.11); pinky.jawOpen = 0; pinky.tgt.headPitch = hp; await wait(tok, 0.12); } })().catch(() => {});
}
// 앞발 하나를 들어 엄마(화면)를 톡톡
async function pawAt(tok, n = 2) {
  const i = Math.random() < 0.5 ? 0 : 1; pinky.pawUp = { i, k: 0 }; tok.cleanups.push(() => { pinky.pawUp = null; });
  const t0 = pinky.tiltT; pinky.tiltT = (i ? -1 : 1) * 0.22; // 고개를 갸웃
  for (let j = 0; j < n; j++) { await tween(tok, 0.28, (k) => { pinky.pawUp.k = ease(k); }); await wait(tok, 0.18); await tween(tok, 0.24, (k) => { pinky.pawUp.k = 1 - ease(k); }); await wait(tok, 0.1); }
  pinky.pawUp = null; pinky.tiltT = t0;
}
const aboveHead = () => pinky.head.getWorldPosition(V3()).add(V3(0, 0.2, 0)); // 자세와 상관없이 머리 바로 위 (누웠을 때 · 코앞까지 왔을 때 얼굴을 가리지 않게)
const ATTN_LINES = ['보고 드립니다! 간식이 부족합니다!', '엄마 나만 봐!', '담과장 대기 중입니다!', '쓰담쓰담 결재 부탁드립니다!'];
// 외동딸: 엄마가 한동안 가만히 있으면 와서 조른다 — 앞발로 톡톡 · 코로 쿡쿡 · 벌러덩 배 보여 주기 · 컹! (샘이 나면 '엄마 나만 봐!')
async function damiAttn(tok, kind) {
  DM.attnN++; mark('attn:' + kind); brain.d.attach = Math.max(0, brain.d.attach - 0.3);
  const n = nearSpot();
  setPose(pinky, 'stand', 6); pinky.sniff = 0; pinky.lookFn = null; pinky.tgt.gaze = 1; pinky.tgt.headPitch = 0; pinky.walkSpeed = 0.95; pinky.wagAmpT = 0.75; pinky.wagSpeedT = 15; pinky.earPerk = 0.5;
  if (kind === 'jealous') { pinky.face = 'cam'; say('컹!', headTop, '', 1.0); barkMove(tok); await wait(tok, 0.5); if (!drag && !touch.active) camTo(CAM_POS, CAM_AIM, 2.6); } // 컹! 소리에 엄마가 돌아본다
  const to = kind === 'nudge' ? { x: lerp(n.x, CAM_POS.x, 0.2), z: Math.min(lerp(n.z, CAM_POS.z, 0.2), 2.25) } : n;
  if (Math.hypot(pinky.x - to.x, pinky.z - to.z) > 0.12) await walkTo(tok, to.x, to.z);
  pinky.face = 'cam'; pinky.tgt.yawOff = 0;
  if (kind === 'flop') { // 이것 봐요! 벌러덩 — 배 만져 주세요
    say('엄마, 이것 봐요!', headTop, 'soft', 1.6); await wait(tok, 1.0);
    setPose(pinky, 'side', 3.6); await wait(tok, 0.7);
    setPose(pinky, 'belly', 4); pinky.paddle = 0.55; pinky.tongueOut = 0.5; pinky.eyeOpen = 0.6; pinky.wagAmpT = 0.7; pinky.wagSpeedT = 14; await wait(tok, 0.6);
    say('배 만져 주세요!', aboveHead, 'soft', 2.4); // 벌러덩 누워 있으니 머리 위(하늘 쪽)에 띄운다 — 배 위를 가리지 않게
    const B = poseFor('belly', pinky), t0 = clock;
    await tween(tok, 3.2, (k) => { const e = ss(0, 0.15, k) * ss(1, 0.8, k), w = Math.sin((clock - t0) * 5.5); pinky.poseRate = 8; pinky.tgt.roll = B.roll + 0.14 * w * e; pinky.tgt.bendY = B.bendY + 0.22 * w * e; pinky.paddle = 0.35 + 0.3 * e; }); // 꼼지락꼼지락
    pinky.paddle = 0; pinky.tongueOut = 0; pinky.eyeOpen = 1;
    if (pinky.tgt.name === 'belly') { setPose(pinky, 'side', 3.2); await wait(tok, 0.6); setPose(pinky, 'stand', 3.4); await wait(tok, 0.8); await shakeOff(tok); }
    return;
  }
  if (kind === 'nudge') { // 코로 쿡쿡: 엄마 발치까지 바짝 와서 올려다보며 코끝을 들이민다
    Object.assign(pinky.tgt, { headPitch: -0.35 }); pinky.earPerk = 0.3; await wait(tok, 0.5);
    for (let i = 0; i < 2; i++) { say('쿡', aboveHead, 'small', 0.8, (i ? 1 : -1) * 70); await tween(tok, 0.22, (k) => { pinky.tgt.bodyZ = 0.035 * Math.sin(Math.PI * k); pinky.tgt.headPitch = -0.35 - 0.15 * Math.sin(Math.PI * k); }); await wait(tok, 0.25); }
    pinky.tgt.bodyZ = 0; await wait(tok, 0.3);
  }
  sitFront(7); await wait(tok, 0.6);
  if (kind !== 'jealous') { say('엄마!', headTop, '', 1.0); await wait(tok, 0.7); }
  await pawAt(tok, kind === 'jealous' ? 1 : 2);
  pinky.earPerk = 0.8; say(DM.attnN > 2 ? '컹컹!' : '컹!', headTop, '', 1.0); barkMove(tok, DM.attnN > 2 ? 2 : 1); await wait(tok, 1.0);
  const line = kind === 'jealous' ? '엄마 나만 봐!' : rot('attn', ATTN_LINES);
  pinky.earPerk = 0.2; pinky.tiltT = 0.28; pinky.wagAmpT = 0.8; pinky.wagSpeedT = 16; say(line, headTop, 'soft', 2.3); if (line.includes('간식')) nudgeTreat();
  await wait(tok, 2.2); pinky.tiltT = 0;
  await idleLook(tok, 1.0, false);
}
// 친구한테 괜히 센 척: 울타리 밖으로 다른 강아지가 지나가면 꼿꼿이 서서 꼬리를 세우고 컹컹! → 친구가 멈춰 돌아보면 엄마 곁으로 쪼르르 → 친구가 가고 나면 다시 의기양양
const FZ = -6.3, FSTOP = -0.7, BARK_AT = [0.8, -4.6]; // 친구가 걷는 길(울타리 바깥) · 멈춰 서서 돌아보는 곳(담이 왼쪽 비스듬히, 울타리 살 사이) · 담이가 버티고 서서 짖는 곳(미끄럼틀 끝과 그네 기둥 사이 · 울타리 앞)
const FCAM = [V3(1.05, 1.5, -1.55), V3(0.18, 0.37, -5.66)]; // 짖는 동안 엄마 눈길: 미끄럼틀 끝과 그네 사이로 다가가 조금 높이서 — 담이(앞 오른쪽)와 울타리 밖 친구(뒤 왼쪽)가 가리지 않고 한 화면에 (세로 화면에서도)
const fHead = () => DM.friend.d.head.localToWorld(V3(0, 0.1, 0.04));
function friendOff() { const f = DM.friend; if (!f) return; f.on = false; f.stop = 0; f.d.root.visible = false; f.d.walkTarget = null; }
function friendStart(dir = Math.random() < 0.5 ? 1 : -1) {
  const f = DM.friend; if (!f) return false;
  Object.assign(f, { on: true, dir, seen: false, stop: 0, endX: 7.8 * dir, t0: clock, barks: 0, stopped: false, paused: false, scene: false });
  const F = f.d; setPose(F, 'stand', 50);
  Object.assign(F, { x: -7.8 * dir, z: FZ, yaw: (dir * Math.PI) / 2, walkTarget: { x: f.endX, z: FZ }, walkSpeed: 0.6, face: null, lookFn: null });
  F.tgt.gaze = 0.15; F.root.visible = true; mark('friend:walk'); return true;
}
roomUpd.push((t, dt) => {
  const f = DM.friend; if (RP !== ROOM_PARK || !f || mode !== 'room') return;
  if (!f.on) { // 몇 분에 한 번 · 담이가 혼자 놀고 있을 때만 (명령 중이면 조금 있다가)
    if (clock > DM.friendAt && !transitioning) { if (idleNow() && awakeUp()) { DM.friendAt = clock + 150 + Math.random() * 110; friendStart(); } else DM.friendAt = clock + 15; }
    return;
  }
  const F = f.d;
  const atStop = f.dir * (F.x - FSTOP) > -0.1;
  if (f.scene && !f.paused && !f.stopped && atStop) { f.paused = true; f.stop = clock + 9; } // 담이가 다가오는 사이 울타리 너머에서 킁킁 (담이 앞에 멈춰 있다)
  if (!f.stopped && f.barks >= 2 && (f.paused || atStop)) { f.stopped = true; f.stop = clock + 7; } // 담이가 두어 번 짖으면 고개를 들어 돌아본다
  const sniffing = f.paused && !f.stopped && f.stop > clock;
  F.sniff = sniffing ? 1 : 0; if (!sniffing && f.paused) F.tgt.headPitch = 0;
  if (sniffing) { F.walkTarget = null; F.face = null; F.lookFn = null; F.tgt.gaze = 0.15; F.tgt.headPitch = 0.5; }
  else if (f.stop > clock) { F.walkTarget = null; F.face = { x: pinky.x, z: pinky.z }; F.lookFn = () => pinky.head.getWorldPosition(V3()); F.tgt.gaze = 1; } // 멈춰 서서 담이를 돌아본다
  else if (!F.walkTarget) { F.walkTarget = { x: f.endX, z: FZ }; F.face = null; F.lookFn = null; F.tgt.gaze = 0.15; }
  updateDog(F, dt, t, roomCam.position);
  if (!f.seen && Math.abs(F.x) < 4.6) { f.seen = true; if (idleNow() && awakeUp()) startSpecial('friend', friendScene); else mark('friend:missed'); }
  if (Math.abs(F.x - f.endX) < 0.2 || clock - f.t0 > 90) friendOff();
});
async function friendScene(tok) {
  const f = DM.friend, F = f.d; mark('friend:seen'); f.scene = true;
  const tall = () => { const s = poseFor('stand', pinky); setPose(pinky, 'stand', 5); Object.assign(pinky.tgt, { bodyY: s.bodyY + 0.018, pitch: -0.07, headPitch: -0.28, tail: -0.1 }); pinky.tgt.paws.forEach((v) => { v.x *= 1.14; }); pinky.tailLow = 0; pinky.earPerk = 1; pinky.wagAmpT = 0.12; pinky.wagSpeedT = 17; }; // 꼿꼿이: 가슴을 펴고 꼬리를 높이, 다리를 버티고
  tok.cleanups.push(() => { f.stop = 0; f.scene = false; f.paused = false; pinky.tailLow = 0; });
  const track = { get x() { return F.x; }, get z() { return F.z; } };
  setPose(pinky, 'stand', 6); pinky.sniff = 0; pinky.face = track; pinky.lookFn = fHead; pinky.earPerk = 1; pinky.wagAmpT = 0.1; pinky.wagSpeedT = 14;
  say('!', headTop, '', 1.0); bubble('총총', fHead, 'fr', 1.6, 0); await wait(tok, 0.9); // 누가 왔는지 엄마도 알아보게: 친구 머리 위에도 작은 말풍선
  pinky.walkSpeed = 1.0; pinky.lookFn = null; pinky.tgt.gaze = 1;
  // 엄마 눈길도 울타리 쪽으로: 담이를 따라 다가가 어깨 너머로 본다 (지금 화면을 끌고 있을 때만 그대로 · 끌기 시작하면 바로 놓아준다)
  if (!drag && !touch.active) { camTurn = true; camTo(FCAM[0], FCAM[1], 1.1); tok.cleanups.push(() => { if (camTurn) { camTurn = false; camHome(); } }); }
  await walkTo(tok, BARK_AT[0], BARK_AT[1]); // 울타리 앞: 친구 쪽을 보고 선다
  pinky.face = track; pinky.lookFn = fHead; tall();
  await wait(tok, 0.4);
  const t0 = clock, LINES = [['컹컹!', 0], ['누구야!', 1], ['컹컹컹!', 0], ['여긴 내 구역이야!', 1], ['컹!', 0], ['저리 가!', 1]];
  for (let i = 0; i < LINES.length && f.on; i++) { // 친구가 돌아볼 때까지 짖고, 돌아봐도 두어 마디 더 센 척 (적어도 네 마디)
    const [line, soft] = LINES[i], tl = clock + (soft ? 1.5 : 1.15); f.barks++;
    say(line, headTop, soft ? 'soft' : '', soft ? 1.8 : 1.2); if (!soft) barkMove(tok, line.length - 1);
    await until(tok, () => clock > tl || (f.stopped && i >= 3 && clock > tl - 0.6));
    if (f.stopped && i >= 3) break;
  }
  await until(tok, () => f.stopped || !f.on || clock - t0 > 12);
  // 친구가 멈춰 서서 돌아본다 — 멍!
  if (!f.stopped) { f.stopped = true; f.stop = clock + 7; }
  await wait(tok, 0.5);
  if (f.on) { f.stop = Math.max(f.stop, clock + 9); bubble('멍!', fHead, 'fr', 1.9, 0); snd('sfx', 'bark_woof', { pos: [F.x, 0.4, F.z], rate: 0.8, gain: 1, force: 1, other: 1, why: 'friend woofs back' }); } // other: 다른 강아지 — 담이의 목소리 차례 · 지침과 섞이지 않는다
  await wait(tok, 0.6);
  setPose(pinky, 'stand', 6); pinky.earPerk = -0.8; pinky.tailLow = 0.7; pinky.wagAmpT = 0.06; pinky.wagSpeedT = 5; bubble('…!', headTop, 'small', 1.0); await wait(tok, 0.5); // 앗…
  const n = nearSpot(); pinky.lookFn = null; pinky.face = null; pinky.tgt.headPitch = 0.15; pinky.walkSpeed = 1.15; mark('friend:retreat');
  if (camTurn) (async () => { await wait(tok, 0.8); if (camTurn) { camTurn = false; camTo(CAM_POS, CAM_AIM, 1.8); } })().catch(() => {}); // 쪼르르 달아나는 첫걸음까지 보여 주고, 엄마 곁으로 오는 담이를 따라 시점도 제자리로
  await walkTo(tok, n.x, n.z); // 엄마 곁으로 쪼르르
  sitFront(7); pinky.earPerk = -0.5; pinky.tailLow = 0.4; pinky.wagAmpT = 0.2; pinky.wagSpeedT = 6; await wait(tok, 0.7);
  pinky.lookFn = fHead; await wait(tok, 0.7); pinky.lookFn = null; pinky.tiltT = 0.2;
  say('…엄마 있으니까 봐준다', headTop, 'soft', 3.0); await wait(tok, 2.4); pinky.tiltT = 0;
  pinky.lookFn = fHead; const t1 = clock;
  await until(tok, () => !f.on || (f.stop < clock && Math.abs(F.x) > 3.9) || clock - t1 > 20);
  // 친구가 가고 나면 다시 의기양양
  pinky.lookFn = null; pinky.face = 'cam'; tall(); pinky.wagAmpT = 0.85; pinky.wagSpeedT = 15; pinky.earPerk = 0.5; mark('friend:proud');
  say('흥! 내 구역 지켰다!', headTop, 'soft', 2.0); await wait(tok, 1.5);
  say('컹!', headTop, '', 1.1); barkMove(tok); await wait(tok, 1.1);
  setPose(pinky, 'stand', 5); happy(true); pinky.eyeOpen = 0.85; await wait(tok, 1.4); happy(false);
}
// 저기 뭐가 있다! — 비둘기 · 흔들리는 그네 · 오리 놀이기구에 대고 컹컹 (자주 짖지만 한 번에 둘셋씩, 사이는 쉰다)
const WOOF_LINES = ['저기 비둘기다!', '수상한 거 포착!', '거기 누구야!', '담과장이 지킨다!'];
async function damiWoof(tok) {
  const p = RP.looks ? RP.looks[Math.floor(Math.random() * RP.looks.length)] : V3(0, 0.5, -3);
  setPose(pinky, 'stand', 6); pinky.face = { x: p.x, z: p.z }; pinky.lookFn = () => p; pinky.earPerk = 1; pinky.wagAmpT = 0.25; pinky.wagSpeedT = 15; await wait(tok, 0.8);
  Object.assign(pinky.tgt, { headPitch: -0.2, tail: -0.25 });
  const n = Math.random() < 0.55 ? 2 : 3; say('컹'.repeat(n) + '!', headTop, '', 1.2); barkMove(tok, n); await wait(tok, 1.4);
  if (Math.random() < 0.6) { say(rot('woof', WOOF_LINES), headTop, 'soft', 1.8); await wait(tok, 1.6); }
  if (Math.random() < 0.35) { say('컹!', headTop, '', 1.0); barkMove(tok); await wait(tok, 1.0); }
  pinky.lookFn = null; pinky.earPerk = 0; setPose(pinky, 'stand', 5); pinky.wagAmpT = 0.6; pinky.wagSpeedT = 12; await wait(tok, 0.4);
}
function damiEnter() { // 놀이터에 들어설 때: 친구는 들어온 지 1분쯤 뒤에 처음 지나간다
  friendOff(); Object.assign(DM, { wigA: 0, frenzy: false, attnN: 0, lastIn: null, away: 0, friendAt: clock + 55 + Math.random() * 30 });
  pinky.treatWag = false; pinky.wig = 0; pinky.pawUp = null;
}

// 혼자 있을 때: 집 안을 돌아다니기 — 무엇을 할지는 그때그때의 마음(배고픔 · 졸림 · 엄마 생각)과 방 안 사정(남긴 밥 · 떨어진 간식)에 따라 고른다
function pickAct() {
  const d = brain.d, h = brain.hist, hg = Math.min(d.hunger, 0.7), drop = !!nearestDrop(99, 6), left = hasLeft() && clock - brain.leftAt > BRAIN.leftWait;
  const cd = (k, sec) => (cdOK('act:' + k, sec) ? 1 : 0); // 같은 곳만 자꾸 기웃거리지 않게
  const W = {
    nap: (0.8 + 2.6 * d.rest) * (drop || left ? 0.3 : 1), // 먹을 게 남아 있으면 잠은 나중에
    gifts: (0.6 + 0.5 * hg) * cd('gifts', 90), table: (0.6 + 0.6 * hg) * cd('table', 90), window: 0.85 * cd('window', 60), wander: 0.6,
    attend: (0.4 + 1.5 * d.attach + (brain.owe ? 0.6 : 0)) * cd('attend', 40),
    rest: (0.25 + 1.3 * d.attach * (0.4 + d.rest)) * cd('rest', 120),
    bowl: mound.amount > 0.05 ? 0 : (0.25 + 1.3 * hg * (clock - brain.fedAt > 120 ? 1 : 0.15)) * cd('bowl', 240) * (brain.begs >= 2 ? 0.35 : 1), // 졸라도 안 나오면 단념한다
    left: left ? 5 + 4 * d.hunger : 0,
    forage: drop ? 2.6 + 2.5 * d.hunger : 0.45 * cd('forage', 60),
    pay: brain.payDue && ballOnFloor() ? 60 : 0,
  };
  if (RP.acts) Object.assign(W, RP.acts(cd, d)); // 그 장소에서만 하는 것 (놀이터: 지렁이 댄스 · 우다다)
  if (RP.actW) for (const k in RP.actW) W[k] *= RP.actW[k]; // 장소에 없는 것(놀이터: 방석 · 밥그릇)은 하지 않는다
  if (h.length) W[h[h.length - 1]] *= h[h.length - 1] === 'nap' ? 0 : 0.08;
  if (h.length > 1) W[h[h.length - 2]] *= 0.5;
  if (brain.force.act) { const a = brain.force.act; brain.force.act = null; return a; }
  let sum = 0; for (const k in W) sum += W[k];
  let r = Math.random() * sum; for (const k in W) { r -= W[k]; if (r <= 0) return k; }
  return 'wander';
}
const GIFT_LINES = ['선물 냄새…', '이건 누구 거지?', '리본 냄새…'], TABLE_LINES = ['뭐 떨어진 거 없나', '과자 냄새 났는데…', '여긴 없네…'];
async function roam(tok) {
  const d = brain.d;
  const acts = {
    nap: async () => { await cushionNap(tok, 11 + Math.random() * 7); }, // 방석(애착 공간)에서 낮잠
    gifts: async () => { pinky.walkSpeed = 0.4; await sniffAt(tok, SPOTS.gifts, nearestDrop(1.7) ? null : rot('gifts', RP.lines.gifts)); await afterSniff(tok); },
    bowl: async () => {
      pinky.walkSpeed = 0.4; await sniffAt(tok, { x: EAT.x, z: EAT.z, fx: BOWL.x, fz: BOWL.z }, nearestDrop(1.2) ? null : '밥그릇 비었네…');
      if (await afterSniff(tok, 1.2)) return;
      brain.begs++; d.hunger = Math.max(0.3, d.hunger - 0.25); // 기다려도 안 나오면 조금 단념한다
      if (cdOK('beg', 300)) { brain.cd.beg = clock; pinky.face = 'cam'; await wait(tok, 0.6); say('밥 줘…', headTop, 'soft', 1.8); await wait(tok, 1.6); }
      else { bubble('…이따 주겠지', headTop, 'soft', 1.6); await wait(tok, 1.3); }
    },
    left: async () => { await eatLeft(tok); }, // 남긴 밥을 마저 먹으러
    forage: async () => { const dr = nearestDrop(99, 6); if (dr) await findTreat(tok, dr); else await sniffTrail(tok); }, // 냄새를 따라다니다 떨어진 간식을 주워 먹는다
    pay: async () => { await payBall(tok); },
    window: async () => { // 창밖 구경
      setPose(pinky, 'stand', 5); pinky.walkSpeed = 0.38;
      await walkTo(tok, SPOTS.window.x, SPOTS.window.z);
      pinky.face = { x: SPOTS.window.fx, z: SPOTS.window.fz }; await wait(tok, 0.6);
      setPose(pinky, 'sit', 5); pinky.lookFn = () => WIN_PT;
      await wait(tok, 3 + Math.random() * 2);
      say(rot('window', RP.lines.window), headTop, 'soft', 1.9); await wait(tok, 2.2);
      pinky.lookFn = null; setPose(pinky, 'stand', 5); await wait(tok, 0.5);
    },
    table: async () => { pinky.walkSpeed = 0.4; await sniffAt(tok, SPOTS.table, nearestDrop(1.7) ? null : rot('table', RP.lines.table)); await afterSniff(tok); },
    attend: async () => { // 나한테 와서 쳐다보기 (엄마 생각이 많이 나면 더 가까이) — 말하고 나서는 바라는 것 쪽을 슬쩍 본다
      const close = d.attach > 0.7, to = close ? nearSpot() : HOME, owe = brain.owe && ballOnFloor(), fun = d.play > 0.75 && d.hunger < 0.6;
      setPose(pinky, 'stand', 5); pinky.walkSpeed = 0.5;
      await walkTo(tok, to.x, to.z);
      sitFront(5); pinky.wagAmpT = 0.55; pinky.wagSpeedT = 11;
      await wait(tok, 0.8); pinky.tiltT = 0.28; say(owe ? '간식 주면 공 줄게' : close ? '엄마~ ♥' : fun ? '놀자?' : rot('ask', ['간식 있어?', '심심해…', '뭐 해?']), headTop, 'soft', 1.8);
      if (owe) nudgeTreat();
      if (close) d.attach = Math.max(0, d.attach - 0.55);
      if (fun) d.play = Math.max(0, d.play - 0.2);
      await wait(tok, 1.4); pinky.tiltT = 0;
      if ((owe || fun) && ballOnFloor()) { pinky.lookFn = () => ball.g.position; await wait(tok, 1.2); pinky.lookFn = null; await wait(tok, 0.5); }
      else await idleLook(tok, 1.3 + Math.random() * 0.8, false);
    },
    rest: async () => { // 엄마 발치에 와서 엎드려 쉰다 (쳐다보지 않고 곁에만 있는다)
      const n = nearSpot(), s = Math.random() < 0.5 ? 1 : -1;
      setPose(pinky, 'stand', 5); pinky.walkSpeed = 0.42; pinky.wagAmpT = 0.35; pinky.wagSpeedT = 7;
      await walkTo(tok, n.x + s * 0.3, n.z - 0.12);
      pinky.face = 'cam'; pinky.tgt.yawOff = s * 0.7; await wait(tok, 0.7);
      setPose(pinky, 'down', 3); pinky.tgt.yawOff = s * 0.7; pinky.wagAmpT = 0.2; pinky.wagSpeedT = 5; await wait(tok, 1.3);
      await tween(tok, 2.0, (k) => { pinky.sigh = Math.sin(Math.PI * k) ** 2; }); pinky.sigh = 0; say('후우…', headTop, 'soft', 1.6);
      pinky.eyeOpen = 0.55; d.attach = Math.max(0, d.attach - 0.4);
      for (let i = 0, n2 = 2 + Math.floor(Math.random() * 2); i < n2; i++) { await idleLook(tok, 1.6 + Math.random() * 1.6, false); await wait(tok, 0.8 + Math.random()); }
      pinky.eyeOpen = 1; d.rest = Math.max(0, d.rest - 0.1);
      setPose(pinky, 'stand', 3); pinky.tgt.yawOff = 0; await wait(tok, 0.9);
    },
    wander: async () => { // 러그 위 어슬렁 (늘 나만 쳐다보지는 않는다)
      setPose(pinky, 'stand', 5); pinky.walkSpeed = 0.35;
      const [wx, wz, ww, wd] = RP.wander; await walkTo(tok, wx + Math.random() * ww, wz + Math.random() * wd);
      d.play = Math.max(0, d.play - 0.12);
      if (Math.random() < 0.6) await idleLook(tok, 1.4 + Math.random() * 1.4);
      else { pinky.face = 'cam'; await wait(tok, 1.2 + Math.random() * 1.2); }
    },
  };
  if (RP.roamActs) Object.assign(acts, RP.roamActs(tok));
  for (;;) {
    const name = pinky.tgt.name === 'curl' ? 'nap' : pickAct(); // 쓰다듬다 만 뒤에는 방석에서 그대로 다시 잔다
    brain.hist.push(name); if (brain.hist.length > 3) brain.hist.shift(); brain.cd['act:' + name] = clock; mark('act:' + name);
    pinky.lookFn = null; pinky.sniff = 0; pinky.tgt.gaze = 1; pinky.tgt.headPitch = 0; pinky.earPerk = 0;
    await acts[name]();
    await idleGap(tok); // 사이사이: 두리번 · 하품 · 부르르 · 기지개
    await wait(tok, 0.4 + Math.random() * 1.2);
  }
}

// ================================================================
// 앉기: 정면 · 옆  /  로프 당기기 놀이  /  요거트 · 고구마 말랑이 먹기  /  고르기 메뉴
// ================================================================
// 정면 앉기: 보는 사람과 마주 앉으면 앞다리를 가슴 밑에 가지런히 모으고, 뒷발이 앞발 양옆으로 보이게 벌린다.
// 옆·비스듬히 보일 때는 원래 앉기 그대로 (보이는 각도에 따라 부드럽게 섞인다)
const SIT_F = { splay: 0.36, tailCurl: 2.0, sideCurl: 2.0, paws: [P(0.056, 0.03, 0.172), P(-0.056, 0.03, 0.172), P(0.124, 0.03, 0.066), P(-0.124, 0.03, 0.066)] };
const sitLatch = { on: false, f: 0, hold: 0 }; // 한번 앉은 모양은 그대로 둔다: 보는 각도가 한동안 확실히 달라졌을 때만 발을 고쳐 디딘다 (카메라가 움직여도 발이 미끄러지지 않게)
function sitShape(d, dt = 0.016) {
  if (d.J || d.tgt.name !== 'sit') { sitLatch.f = 0; sitLatch.on = false; sitLatch.hold = 0; return; }
  if (active && active.name === 'roam' && d.face === 'cam') d.tgt.yawOff = 0; // 혼자 놀다 와서 쳐다볼 때도 마주 보고 앉는다
  const c = roomCam.position, a = Math.abs(angDiff(d.yaw, Math.atan2(c.x - d.x, c.z - d.z))), want = sitLatch.on ? a < 0.62 : a < 0.3, b = POSES.sit;
  if (want !== sitLatch.on) { sitLatch.hold += dt; if (sitLatch.hold > (sitLatch.on ? 0.8 : 0.12)) { sitLatch.on = want; sitLatch.hold = 0; } } else sitLatch.hold = 0;
  const f = (sitLatch.f += ((sitLatch.on ? 1 : 0) - sitLatch.f) * (1 - Math.exp(-7 * dt)));
  for (let i = 0; i < 4; i++) d.tgt.paws[i].lerpVectors(b.paws[i], SIT_F.paws[i], f);
  d.tgt.splay = lerp(b.splay, SIT_F.splay, f);
  const dmS = d.dami && DAMI_POSE.sit; // 담이: 꼬리를 바닥에 감지 않고 엉덩이 뒤로 세워 든다 (마주 보면 흰 붓 끝이 옆으로 보이게 조금 더 휜다)
  d.tgt.tailCurl = dmS ? lerp(dmS.tailCurl, dmS.tailCurlF, f) : lerp(d.sitView === 'side' && Math.abs(d.tgt.yawOff) > 0.8 ? SIT_F.sideCurl : b.tailCurl, SIT_F.tailCurl, f); // 꼬리는 엉덩이를 감아 옆으로 끝이 보인다
}
roomUpd.push((t, dt) => sitShape(pinky, dt));
const camYaw = () => Math.atan2(roomCam.position.x - pinky.x, roomCam.position.z - pinky.z);
function sitFront(rate = 6) { setPose(pinky, 'sit', rate); pinky.face = 'cam'; pinky.tgt.yawOff = 0; pinky.sitView = 'front'; }
// view: 'front'(마주 보고) · 'side'(몸은 옆으로, 고개만 돌려 본다). 많이 돌아야 하면 먼저 서서 발을 옮겨 돈 다음 앉는다
let sideSign = 1;
async function sitAs(tok, view = 'front', rate = 6) {
  let off = 0;
  if (view === 'side') {
    const dp = Math.abs(angDiff(pinky.yaw, camYaw() + 1.1)), dm = Math.abs(angDiff(pinky.yaw, camYaw() - 1.1));
    sideSign = Math.abs(dp - dm) < 0.8 ? -sideSign : dp < dm ? 1 : -1; off = 1.1 * sideSign; // 이미 한쪽으로 돌아서 있지 않으면 지난번과 반대쪽 옆모습을 보여 준다
  }
  pinky.face = 'cam';
  if (Math.abs(angDiff(pinky.yaw, camYaw() + off)) > 0.5) {
    setPose(pinky, 'stand', 6); pinky.tgt.yawOff = pinky.cur.yawOff = off;
    const t0 = clock; await until(tok, () => Math.abs(angDiff(pinky.yaw, camYaw() + off)) < 0.2 || clock - t0 > 3);
  }
  setPose(pinky, 'sit', rate); pinky.tgt.yawOff = pinky.cur.yawOff = off;
  pinky.sitView = view;
}
let sitCount = 0, lastSit = '';
async function sitCommand(tok) {
  const was = pinky.tgt.name === 'sit' ? (Math.abs(pinky.tgt.yawOff) > 0.8 ? 'side' : 'front') : null;
  // 웬만하면 마주 보고 앉는다. 옆으로 앉기는 가끔만(연달아 두 번은 없다) — 옆으로 앉아 있을 때 또 부르면 마주 보고 고쳐 앉는다
  const view = sitCount === 0 || was === 'side' || lastSit === 'side' ? 'front' : Math.random() < (was === 'front' ? 0.3 : 0.25) ? 'side' : 'front';
  sitCount++; lastSit = view;
  pinky.wagAmpT = 0.4; pinky.wagSpeedT = 8; pinky.earPerk = 0.4;
  if (was === 'front' && view === 'front') { // 이미 마주 앉아 있으면: 엉덩이를 들썩 고쳐 앉고 꼬리를 친다
    pinky.wagAmpT = 0.75; pinky.wagSpeedT = 14; pinky.earPerk = 0.8;
    pinky.tgt.bodyY = POSES.sit.bodyY + 0.05; pinky.tgt.pitch = POSES.sit.pitch + 0.2; pinky.paddle = 0.2;
    await wait(tok, 0.4); pinky.paddle = 0;
  }
  await sitAs(tok, view, 6);
  await wait(tok, 0.7);
  await wait(tok, 0.5); pinky.earPerk = 0; pinky.tiltT = view === 'front' ? 0.2 : 0.1; pinky.wagAmpT = 0.5; pinky.wagSpeedT = 5;
  await wait(tok, 1.3); pinky.tiltT = view === 'front' ? 0.06 : 0.08; pinky.wagAmpT = 0.4; pinky.wagSpeedT = 8;
  await wait(tok, 1.4);
}

// 핥기 · 쫀득하게 씹기 · 물고 흔들기 (updateDog 뒤에 덧입힌다 — 혀는 보이지 않고 턱과 고개 움직임으로만 보여 준다)
const toy = { lap: 0, lapKind: 'mouth', lapOn: false, chew: 0, chewKind: 'soft', chewRate: 9, shake: 0, sk: 0, shakeHz: 3.5, shakeAmp: 1, rest: 0, jaw: false, tick: null, tok: null, fill: 0, fk: 0 }; // lapKind · chewKind: 소리의 종류(요거트/입맛 · 쫀득한 간식/로프)
function toyOff() { Object.assign(toy, { lap: 0, lapKind: 'mouth', chew: 0, chewKind: 'soft', chewRate: 9, shake: 0, shakeHz: 3.5, shakeAmp: 1, rest: 0, tick: null, tok: null, fill: 0 }); }
// 가까이서 먹는 모습을 볼 때 얼굴이 그늘지지 않게, 보는 쪽 아래에서 은은하게 비추는 불빛 (그림자 없음 · 평소에는 꺼져 있다)
const faceFill = new THREE.SpotLight(0xffe6cc, 0, 3.2, 0.42, 1, 1.2); roomScene.add(faceFill, faceFill.target);
function toyPost(d, dt, t) {
  if (toy.tok && active !== toy.tok) toyOff();
  toy.sk += (toy.shake - toy.sk) * (1 - Math.exp(-9 * dt));
  toy.fk += (toy.fill - toy.fk) * (1 - Math.exp(-2.5 * dt)); faceFill.intensity = 0.85 * toy.fk;
  if (toy.fk > 0.01) { const c = roomCam.position; faceFill.position.set(c.x, Math.max(0.22, c.y - 0.22), c.z); d.head.getWorldPosition(faceFill.target.position); }
  const beat = (w, ph) => Math.floor((w * t + ph) / (Math.PI * 2)) !== Math.floor((w * (t - dt) + ph) / (Math.PI * 2)); // sin(w·t + ph)의 한 주기가 이번 프레임에 넘어갔는가 (소리 박자)
  if (toy.lap > 0) {
    d.hp.rotation.x += Math.sin(t * 20) * 0.035 * toy.lap; d.jawOpen = 0.05 + 0.15 * (0.5 + 0.5 * Math.sin(t * 20 + 0.8)); toy.jaw = true;
    const TAU = Math.PI * 2, ph = 0.8 - Math.PI / 2, left = (TAU - ((((20 * t + ph) % TAU) + TAU) % TAU)) / 20; // 다음에 턱이 벌어질 때까지 남은 시간
    if (toy.lapOn ? beat(20, ph) : left > 0.19) snd('lap', toy.lapKind); // 할짝: 시작할 때 한 번(바로 다음 박자가 오면 그때부터), 그 뒤로는 턱이 벌어질 때마다
    toy.lapOn = true;
  } else {
    toy.lapOn = false;
    if (toy.chew > 0) { d.hp.rotation.x += Math.sin(t * toy.chewRate) * 0.028; d.jawOpen = 0.05 + 0.2 * (0.5 + 0.5 * Math.sin(t * toy.chewRate)); toy.jaw = true; if (beat(toy.chewRate, Math.PI / 2)) snd('chewHit', toy.chewKind); } // 턱이 닫힐 때마다 쫀득
    else if (toy.jaw) { d.jawOpen = toy.rest; toy.jaw = false; }
  }
  if (toy.sk > 0.01) { // 어깨부터 틀고 고개가 반 박자 늦게 따라간다 · 귀는 더 늦게 펄럭
    const w = t * Math.PI * 2 * toy.shakeHz, a = toy.sk * toy.shakeAmp;
    if (a > 0.3 && beat(Math.PI * 4 * toy.shakeHz, Math.PI)) snd('shakeHit', a); // 고개가 양 끝에 닿을 때마다 귀와 줄이 퍼덕
    d.root.rotation.y += Math.sin(w + 1.3) * 0.045 * a;
    d.hp.rotation.y += Math.sin(w) * 0.4 * a; d.hp.rotation.z += Math.cos(w) * 0.17 * a;
    for (const e of d.ears) { e.vz += Math.cos(w) * 45 * a * dt; e.vx += Math.sin(w * 2) * 30 * a * dt; }
  }
  if (toy.tick) { handR.rig.g.updateMatrixWorld(true); d.hp.updateWorldMatrix(true, true); toy.tick(dt, t); }
}
const phoneK = () => (roomCam.aspect < 0.8 ? 1.25 : 1); // 세로 화면에서는 조금 더 물러나 앉는다
const toCamDir = () => { const c = roomCam.position; return V3(c.x - pinky.x, 0, c.z - pinky.z).normalize(); };
const camRight = () => { const d = toCamDir(); return V3(d.z, 0, -d.x); }; // 화면 오른쪽
const sideSay = (text, i, cls = '', life = 1.2) => say(text, headTop, cls, life, (i % 2 ? 1 : -1) * (70 + Math.random() * 25));

// ---------- 로프 당기기
// 놀이 인사(앞가슴을 낮추고 엉덩이는 든다) · 버티기(엉덩이를 낮추고 목을 빼 줄과 한 줄이 되게 뒤로 당긴다)
POSES.bow = { bodyY: 0.235, bodyZ: 0, pitch: 0.42, roll: 0, yawOff: 0, gaze: 1, headPitch: 0, headTilt: 0, tail: -0.7, level: 1, free: 0, neck: -0.3, tailCurl: 0.3, abd: [0.06, 0.06, 0, 0],
  lean: [1.3, 1.3, 0.14, 0.14], paws: [P(0.08, 0.03, 0.31), P(-0.08, 0.03, 0.31), P(0.072, 0.03, -0.192), P(-0.072, 0.03, -0.192)] };
POSES.tug = { bodyY: 0.235, bodyZ: -0.05, pitch: -0.2, roll: 0, yawOff: 0, gaze: 0.45, headPitch: 0.15, headTilt: 0, tail: -1.0, level: 1, free: 0, neck: 0.35, lumbar: 0.2, reach: 0.03, abd: [0.06, 0.06, 0, 0],
  lean: [-0.15, -0.15, 0.3, 0.3], paws: [P(0.075, 0.03, 0.25), P(-0.075, 0.03, 0.25), P(0.09, 0.03, -0.15), P(-0.09, 0.03, -0.15)] };
const ROPE_BITE = [V3(-0.009, -0.007, 0.05), V3(0.009, -0.007, 0.05)]; // 통매듭 바로 위를 입꼬리 사이에 가로로 문다 (턱 기준) — 통매듭과 술은 볼 옆으로 늘어진다
const ropeMouth = () => pinky.jaw.localToWorld(V3(0, -0.007, 0.05)); // 턱 좌표는 머리 크기만큼 커진다: 코끝이 z 0.077, 입술 앞이 0.056쯤
let ropeRuns = 0;
const ropeThump = (key, gain = 0) => { const q = rope.pos(key); snd('ropeDrop', [q.x, q.y, q.z], Math.sqrt((2 * Math.max(q.y, 0.02)) / 9.8), gain); }; // 놓은 줄이 바닥에 닿을 때 툭 (떨어지는 시간만큼 늦게)
// 로프가 놓인 데로 가서 문다 (어디에 두었든 찾아간다)
async function ropeFetch(tok) {
  const slide = (dur, dir, dist) => { const p0 = { x: pinky.x, z: pinky.z }; return tween(tok, dur, (q) => { const e = ease(q); pinky.x = p0.x + dir.x * dist * e; pinky.z = p0.z + dir.z * dist * e; }); };
  const reach = 0.25, t0 = clock; pinky.walkSpeed = 1.0;
  const rel = () => { const b = rope.pos('B.bite'); return [b, b.x - pinky.x, b.z - pinky.z, Math.hypot(b.x - pinky.x, b.z - pinky.z) || 1e-3]; };
  let [b, dx, dz, dist] = rel(); const still = { x: pinky.x, z: pinky.z, t: clock };
  if (dist < 0.17) { pinky.face = { x: b.x, z: b.z }; pinky.paddle = 0.25; await slide(0.6, V3(-Math.sin(pinky.yaw), 0, -Math.cos(pinky.yaw)), reach - dist * 0.5); pinky.paddle = 0; } // 발밑에 있으면 한 발 물러나서
  else await until(tok, () => {
    [b, dx, dz, dist] = rel();
    pinky.walkTarget = dist > reach + 0.03 ? { x: b.x - (dx / dist) * reach, z: b.z - (dz / dist) * reach } : null;
    if (Math.hypot(pinky.x - still.x, pinky.z - still.z) > 0.03) Object.assign(still, { x: pinky.x, z: pinky.z, t: clock });
    if (clock - t0 > 10 || (clock - t0 > 2 && clock - still.t > 1.6)) { rope.place(pinky.x + Math.sin(pinky.yaw) * 0.3, pinky.z + Math.cos(pinky.yaw) * 0.3, pinky.yaw + 1.2); return true; } // 가구 밑처럼 닿지 않는 곳이면 앞으로 끌어다 놓는다
    return dist < reach + 0.07 || (clock - t0 > 6 && dist < 0.5);
  });
  pinky.walkTarget = null; [b] = rel(); pinky.face = { x: b.x, z: b.z };
  await wait(tok, 0.3);
  setPose(pinky, 'eat', 7); pinky.tgt.headPitch += 0.3; pinky.jawOpen = 0.35;
  await wait(tok, 0.45);
  rope.pinTo('B.bite', pinky.jaw, ROPE_BITE[0]); rope.pinTo('B.barrel', pinky.jaw, ROPE_BITE[1]);
  pinky.jawOpen = toy.rest = 0.14; say('앙!', headTop, '', 1.1);
  setPose(pinky, 'stand', 6); pinky.lookFn = null; pinky.tgt.gaze = 0.5; pinky.tgt.headPitch = -0.15;
  await wait(tok, 0.4);
}
// 놀이가 끊기면: 버티던 자세를 풀고, 물고 있던 줄은 발밑이 아니라 앞쪽에 떨어뜨린다
function ropeCleanup() {
  toyOff(); pinky.walkTarget = null;
  if (pinky.tgt.name === 'tug' || pinky.tgt.name === 'bow') setPose(pinky, 'stand', 5);
  if (rope.pinned('B.bite')) { ropeThump('B.bite'); rope.unpin(); rope.kick(toCamDir().multiplyScalar(1.1).add(V3(0, 0.7, 0))); }
}
async function ropePlay(tok) {
  const ph = phoneK(), run = ropeRuns++;
  toy.tok = tok; tok.cleanups.push(ropeCleanup);
  const mouth = ropeMouth;
  const pullA = ph > 1 ? 0.36 : 0.7, pullDir = () => { const d = toCamDir(), c = Math.cos(pullA), sn = Math.sin(pullA); return V3(d.x * c + d.z * sn, 0, d.z * c - d.x * sn); }; // 내 손은 화면 오른쪽 앞에서 당긴다 (줄이 화면에 길게 보이게)
  const kickA = (v) => { for (let i = 0; i < rope.NP; i++) rope.kick(v, 'A' + i); };
  const slide = (dur, dir, dist, fn) => { const p0 = { x: pinky.x, z: pinky.z }; return tween(tok, dur, (q) => { const e = ease(q); pinky.x = p0.x + dir.x * dist * e; pinky.z = p0.z + dir.z * dist * e; if (fn) fn(e, q); }); };
  setPose(pinky, 'stand', 6); pinky.face = 'cam';
  pinky.lookFn = () => rope.pos('B.bite');
  pinky.earPerk = 1; pinky.wagAmpT = 0.85; pinky.wagSpeedT = 18;
  await wait(tok, 0.5); say('!', headTop, '', 1);
  await wait(tok, 0.45); say('로프!', headTop, 'soft', 1.3);
  await ropeFetch(tok);
  pinky.walkSpeed = 0.9; await walkTo(tok, HOME.x, HOME.z); pinky.walkSpeed = 0.5;
  pinky.face = 'cam'; setPose(pinky, 'stand', 6); pinky.tgt.yawOff = 0;
  { const [p, a] = kneelAt(1.2 * ph, 0.54, 0.2); camTo(p, a.addScaledVector(pullDir(), ph > 1 ? 0.08 : 0.14)); } // 핑키와 내 손이 함께 보이게
  await wait(tok, 0.6);
  // 한 발 다가와 고개를 들어 줄을 내민다 (남은 줄이 내 쪽으로 흔들린다)
  pinky.tgt.headPitch = -0.2; pinky.wagAmpT = 0.7; pinky.wagSpeedT = 9; say('으응!', headTop, 'small', 1);
  pinky.paddle = 0.22; kickA(pullDir().multiplyScalar(0.9).add(V3(0, 0.6, 0)));
  await slide(0.5, pullDir(), 0.06); pinky.paddle = 0;
  await wait(tok, 0.45);
  // 손이 늘어진 고리 매듭을 쥔다
  const L = rope.span('A.knot', 'B.bite');
  let k = 0.9, sway = 0, lift = 0.0, yank = 0, held = false;
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
  // 당기기: 엉덩이를 낮추고 뒷걸음질 → 고개를 좌우로 털고 → 고쳐 물거나(줄이 잠깐 느슨해졌다 탁 팽팽해진다) 내가 확 당기면 끌려왔다가 다시 버틴다
  const T = POSES.tug;
  setPose(pinky, 'tug', 7); pinky.wagAmpT = 0.7; pinky.wagSpeedT = 14; pinky.eyeOpen = 0.85; pinky.earPerk = -0.3;
  const growl = ['으르릉', '으르르…', '끄응!', '으르릉!'];
  for (let i = 0; i < 4; i++) {
    const d = V3(handR.pos.x - pinky.x, 0, handR.pos.z - pinky.z).normalize(), k0 = k;
    pinky.paddle = 0.25; sideSay(growl[i], i, i % 2 ? 'small' : '', 1.2);
    await slide(0.7, d, -0.07, (e, q) => { k = lerp(k0, 1.0, e); sway = lerp(sway, 0, e); pinky.tgt.pitch = T.pitch - 0.06 * Math.sin(q * Math.PI); pinky.tgt.bodyY = T.bodyY - 0.012 * Math.sin(q * Math.PI); });
    pinky.paddle = 0; toy.shake = 1; const s1 = (i % 2 ? 1 : -1) * 0.11, s0 = sway;
    await tween(tok, 0.75, (q) => { sway = lerp(s0, s1, ease(q)); pinky.tgt.bodyY = T.bodyY - 0.012 * Math.sin(q * Math.PI); });
    toy.shake = 0;
    if (i % 2) { yank = 0.09; handR.want.rate = 10; await slide(0.32, d, 0.05, (e, q) => { pinky.tgt.pitch = T.pitch + 0.12 * Math.sin(q * Math.PI); }); pinky.paddle = 0.3; await wait(tok, 0.25); pinky.paddle = 0; yank = 0; handR.want.rate = 6; }
    else { // 고쳐 문다
      handR.want.rate = 12;
      await tween(tok, 0.28, (q) => { k = lerp(1.0, 0.9, ease(q)); pinky.jawOpen = toy.rest = 0.14 + 0.12 * Math.sin(q * Math.PI * 2) ** 2; pinky.tgt.neck = T.neck - 0.2 * ease(q); });
      pinky.jawOpen = toy.rest = 0.14; pinky.paddle = 0.3;
      await slide(0.2, d, -0.035, (e, q) => { k = lerp(0.9, 1.0, e); pinky.tgt.neck = T.neck - 0.2 * (1 - e); pinky.tgt.pitch = T.pitch - 0.1 * Math.sin(q * Math.PI); });
      pinky.paddle = 0; handR.want.rate = 6;
    }
  }
  // 이겼다: 더 낮게 버티다가 손이 놓친다
  pinky.tgt.bodyY = 0.215; pinky.tgt.pitch = -0.27; toy.shake = 0.7; say('끄으응!', headTop, '', 1.1);
  await wait(tok, 0.6); toy.shake = 0;
  const dW = V3(handR.pos.x - pinky.x, 0, handR.pos.z - pinky.z).normalize();
  held = false; ropeThump('A.knot', -3); rope.unpin('A.knot'); kickA(dW.clone().multiplyScalar(-1.3).add(V3(0, 0.5, 0)));
  { const hp = handR.pos.clone(), d = dW; handR.want = { pos: () => hp.clone().addScaledVector(d, 0.1).add(V3(0, 0.1, 0)), up: () => V3(0, 1, 0), curl: 0.15, rate: 12 }; }
  pinky.paddle = 0.3; await slide(0.35, dW, -0.08); pinky.paddle = 0;
  handR.want = null; toy.tick = null; pinky.face = 'cam';
  setPose(pinky, 'stand', 6); pinky.tgt.yawOff = 0; pinky.eyeOpen = 1; pinky.earPerk = 0.6; pinky.wagAmpT = 0.9; pinky.wagSpeedT = 16;
  say('이겼다!', headTop, 'soft', 1.5);
  await wait(tok, 0.7);
  // 물고 우쭐우쭐 한 바퀴
  { const [p, a] = kneelFor(HOME, 1.6 * ph, 0.8, 0.25); camTo(p, a, 2); }
  pinky.lookFn = null; pinky.tgt.gaze = 0.3; pinky.tgt.headPitch = -0.25; pinky.tgt.tail = -0.8;
  pinky.walkSpeed = 0.8; await walkTo(tok, HOME.x - 0.45, HOME.z - 0.25); await walkTo(tok, HOME.x + 0.4, HOME.z - 0.3);
  pinky.face = 'cam'; pinky.tgt.gaze = 1; pinky.tgt.headPitch = 0; await wait(tok, 0.45);
  // 부르르 턴다
  Object.assign(toy, { shake: 1, shakeHz: 4, shakeAmp: 1.35 }); say('부르르!', headTop, '', 1.2);
  await wait(tok, 1.15); Object.assign(toy, { shake: 0, shakeAmp: 1 });
  await wait(tok, 0.5); toy.shakeHz = 3.5;
  if (run % 2 === 0) { // 물고 와서 발치에 내려놓는다
    pinky.walkSpeed = 0.7; await walkTo(tok, HOME.x, HOME.z); pinky.walkSpeed = 0.5;
    { const [p, a] = kneelFor(HOME, 1.15 * ph, 0.6, 0.22); camTo(p, a, 2); }
    await sitAs(tok, 'front', 6); pinky.tgt.tail = POSES.sit.tail;
    await wait(tok, 0.7);
    pinky.jawOpen = 0.3; toy.rest = 0; ropeThump('B.bite'); rope.unpin('B.bite'); rope.unpin('B.barrel'); rope.kick(toCamDir().multiplyScalar(0.9).add(V3(0, 0.4, 0)));
    await wait(tok, 0.3); pinky.jawOpen = 0;
    pinky.lookFn = () => rope.pos('B.bite'); pinky.sniff = 0.6; await wait(tok, 0.8);
    pinky.sniff = 0; pinky.lookFn = null; pinky.tiltT = 0.25; pinky.wagAmpT = 0.85; pinky.wagSpeedT = 18;
    say('또 하자!', headTop, 'soft', 2); heart();
    await wait(tok, 2.2); pinky.tiltT = 0;
  } else { // 엎드려서 한 발로 누르고 질겅질겅
    { const [p, a] = kneelAt(1.1 * ph, 0.36, 0.14); camTo(p, a, 2); }
    setPose(pinky, 'down', 3); pinky.tgt.yawOff = -0.45; pinky.wagAmpT = 0.35; pinky.wagSpeedT = 5; toy.fill = 1;
    await wait(tok, 1.2);
    const paws = () => pinky.root.localToWorld(V3(0.034, 0.016, 0.352)); // 누른 앞발 바로 앞
    rope.unpin('B.barrel'); // 문 데서 발까지 줄이 모자라 늘어나지 않게: 입에는 한 점만, 발에는 그만큼 떨어진 마디를 누른다
    { const need = mouth().distanceTo(paws()) * 1.12; let key = 'B.s1'; for (const q of ['B.s5', 'B.s4', 'B.s3', 'B.s2']) if (rope.span(q, 'B.bite') >= need) { key = q; break; } rope.pin(key, paws); }
    pinky.tgt.paws[0].set(0.034, 0.046, 0.318); pinky.tgt.paws[1].x = -0.06;
    let up = 0; pinky.lookFn = () => paws().add(V3(0, 0.1 + up, 0)).addScaledVector(toCamDir(), 0.1 + up); pinky.tgt.gaze = 0.7; pinky.tgt.neck = 0.25; pinky.eyeOpen = 0.8; pinky.tiltT = 0.4;
    toy.chew = 1; toy.chewRate = 8; toy.chewKind = 'rope';
    const w = ['질겅질겅', '냠', '질겅…', '질겅질겅'];
    for (let i = 0; i < 4; i++) {
      sideSay(w[i], i, i % 2 ? 'small' : ''); if (i === 2) pinky.tiltT = -0.4;
      await wait(tok, 0.85);
      pinky.tgt.paws[0].y = 0.04; await tween(tok, 0.4, (q) => { up = 0.05 * Math.sin(q * Math.PI); }); pinky.tgt.paws[0].y = 0.046; // 발로 누르고 고개를 들어 당긴다
    }
    toy.chew = 0; toy.rest = 0; pinky.lookFn = null; pinky.tgt.gaze = 1; pinky.tgt.neck = 0; pinky.tiltT = 0.2; pinky.eyeOpen = 1;
    rope.unpin(); pinky.tgt.paws[0].copy(POSES.down.paws[0]); pinky.tgt.paws[1].copy(POSES.down.paws[1]);
    say('재밌었다…', headTop, 'soft', 1.8); heart();
    await wait(tok, 1.9); pinky.tiltT = 0;
  }
  toyOff(); camHome();
}
// 혼자 놀다가 가끔: 로프를 물고 와 발치에 내려놓고 놀자고 쳐다본다 (roam 사이에 끼어든다 — 자거나 방석에 가는 중에는 하지 않는다)
async function bringToy(tok) {
  toy.tok = tok; tok.cleanups.push(ropeCleanup);
  setPose(pinky, 'stand', 6); pinky.lookFn = () => rope.pos('B.bite'); pinky.earPerk = 0.7; pinky.wagAmpT = 0.6; pinky.wagSpeedT = 12;
  await wait(tok, 0.6);
  await ropeFetch(tok);
  if (brain.force.rope ?? Math.random() < BRAIN.ropeMineP) { // 가끔은 가져오다 말고 저 혼자 차지한다: 엎드려 질겅질겅 "내 꺼야"
    mark('rope:mine');
    pinky.walkSpeed = 0.6; await walkTo(tok, HOME.x + (pinky.x > HOME.x ? 0.55 : -0.55), HOME.z - 0.7); pinky.walkSpeed = 0.5; pinky.face = 'cam';
    await wait(tok, 0.4); setPose(pinky, 'down', 4); pinky.tgt.yawOff = -0.3; pinky.wagAmpT = 0.5; pinky.wagSpeedT = 8; pinky.earPerk = 0;
    await wait(tok, 1.0);
    toy.chewKind = 'rope'; toy.chewRate = 7.5; toy.chew = 1; say('내 꺼야 ♪', headTop, 'soft', 1.6);
    await wait(tok, 1.8); sideSay('질겅질겅', 0, '', 1.3); await wait(tok, 2.0);
    toy.chew = 0; pinky.tiltT = 0.25; pinky.earPerk = 0.6; say('…같이 할래?', headTop, 'soft', 2.2);
    await wait(tok, 2.2); pinky.tiltT = 0; pinky.earPerk = 0;
    pinky.jawOpen = 0.3; toy.rest = 0; ropeThump('B.bite'); rope.unpin(); rope.kick(toCamDir().multiplyScalar(0.5).add(V3(0, 0.2, 0)));
    await wait(tok, 0.3); pinky.jawOpen = 0; await wait(tok, 2.0); toyOff();
    return;
  }
  pinky.walkSpeed = 0.75; await walkTo(tok, HOME.x, HOME.z); pinky.walkSpeed = 0.5;
  await sitAs(tok, 'front', 6);
  await wait(tok, 0.8);
  pinky.jawOpen = 0.3; toy.rest = 0; ropeThump('B.bite'); rope.unpin(); rope.kick(toCamDir().multiplyScalar(0.9).add(V3(0, 0.4, 0)));
  await wait(tok, 0.3); pinky.jawOpen = 0;
  pinky.tiltT = 0.28; pinky.earPerk = 0.8; pinky.wagAmpT = 0.8; pinky.wagSpeedT = 16; say('놀자?', headTop, 'soft', 2.4);
  await wait(tok, 2.6); pinky.tiltT = 0;
  pinky.lookFn = () => rope.pos('B.bite'); await wait(tok, 0.9); pinky.lookFn = null; // 줄 한 번, 나 한 번
  pinky.tiltT = -0.2; await wait(tok, 2.2); pinky.tiltT = 0; pinky.earPerk = 0; pinky.wagAmpT = 0.4; pinky.wagSpeedT = 8;
  await wait(tok, 2.5); toyOff();
}
let toyIdle = 50 + Math.random() * 30;
roomUpd.push((t, dt) => {
  if (!active || active.name !== 'roam' || active.toy || active.special || pinky.J) return;
  toyIdle -= dt; if (toyIdle > 0) return;
  if (pinky.tgt.name !== 'stand' || pinky.walkTarget || cushGo || pickerFor || touch.active || !rope.state.asleep || Math.hypot(pinky.x - CUSH.x, pinky.z - CUSH.z) < 0.6) { toyIdle = 3; return; } // 방석에서 기지개 켜고 내려온 뒤에
  toyIdle = 110 + Math.random() * 80;
  startCommand('roam', (tok) => { tok.toy = true; return RP.toyIdle ? RP.toyIdle(tok) : bringToy(tok); }, true); // 담이: 모래 위의 나뭇가지 · 패트병 · 오둥이
});

// ---------- 요거트: 컵을 내밀면 마주 앉아 할짝할짝, 코에 묻히고 입맛을 다신다
async function yogurtTreat(tok) {
  const ph = phoneK(), CS = 1.22; // 컵은 화면에서 읽히게 조금 크게
  toy.tok = tok; tok.cleanups.push(() => { toyOff(); yogurt.reset(); yogurtDab.set(0); });
  { const [p, a] = kneelFor(HOME, 0.98 * ph, 0.5, 0.35); camTo(p, a); } // 눈높이 가까이 낮춰 앉는다 (고개를 숙여도 얼굴이 보이게)
  yogurt.reset(); yogurtDab.set(0); toy.fill = 1;
  handR.rig.inner.add(yogurt.g); yogurt.g.position.set(0, -0.016, 0.03); yogurt.g.scale.setScalar(CS); yogurt.g.visible = true;
  let tilt = 0; const setTilt = (a) => { tilt = a; yogurt.g.rotation.set(-a, 0, Math.PI); }; setTilt(0); // 손바닥 위에 세운 컵 · 입구를 핑키 쪽으로 기울인다(음수면 내 쪽)
  const cupMouth = () => yogurt.g.localToWorld(yogurt.mouth.clone());
  let target = () => roomCam.localToWorld(ph > 1 ? V3(0.035, -0.085, -0.5) : V3(0.09, -0.115, -0.46)); // 단추 줄에 가리지 않는 높이에서 보여 준다
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
  snd('sfx', 'scoop', { gain: -10, rate: 1.6, force: 1, why: 'yogurt lid' }); // 뚜껑 벗기는 소리 (작게 스윽)
  await tween(tok, 0.55, (q) => { yogurt.setLid(ease(q)); setTilt(-0.5 * ease(q)); }); // 뚜껑을 열어 하얀 요거트를 보여 준다
  say('킁킁', noseTip); pinky.sniff = 0.6; pinky.tiltT = 0.2;
  await wait(tok, 1.0); pinky.sniff = 0; pinky.tiltT = 0;
  // 컵을 주둥이 앞에 대 준다 (자리는 앉은 가슴 앞에 고정 — 핑키가 목을 빼 찾아온다)
  const m0 = mouthPt(), dC = toCamDir(); let dip = 0, push = 0;
  const spot = () => V3(m0.x + dC.x * (0.062 + push), m0.y - 0.052 - dip, m0.z + dC.z * (0.062 + push));
  target = () => spot().sub(cupMouth().sub(handR.pos));
  pinky.lookFn = () => spot().addScaledVector(dC, 0.1).add(V3(0, 0.02, 0));
  await tween(tok, 0.8, (q) => setTilt(lerp(-0.5, 0.75, ease(q))));
  pinky.tgt.neck += 0.2; pinky.tgt.reach = 0.03; pinky.earPerk = 0.3; pinky.eyeOpen = 0.8; pinky.wagAmpT = 0.5; pinky.wagSpeedT = 9;
  await wait(tok, 0.5);
  const words = ['할짝', '할짝할짝', '챱챱', '할짝', '냠…', '할짝할짝'];
  toy.lapKind = 'yogurt';
  for (let i = 0; i < 6; i++) {
    toy.lap = 1; sideSay(words[i], i);
    pinky.tgt.reach = 0.03 + 0.02 * (i / 5); // 줄어들수록 더 깊이 넣는다
    if (i === 3) { yogurtDab.set(0.01); tween(tok, 0.15, (q) => yogurtDab.set(q)).catch(() => {}); } // 깊이 넣다가 코에 묻는다
    if (i === 2 || i === 5) heart();
    const l0 = yogurt.level, l1 = lerp(1, 0.05, (i + 1) / 6), a0 = tilt, d0 = dip, d1 = 0.016 * ((i + 1) / 6);
    await tween(tok, i < 4 ? 0.65 : 0.8, (q) => { yogurt.setLevel(lerp(l0, l1, q)); setTilt(lerp(a0, 0.75 + 0.4 * ((i + 1) / 6), q)); dip = lerp(d0, d1, q); push = 0.005 * Math.sin(q * Math.PI * (i < 4 ? 4 : 3)) ** 2 * (1 + i * 0.25); }); // 핥을 때마다 컵이 밀린다
    toy.lap = 0; push = 0; if (i % 2) snd('sfx', 'gulp', { gain: -2, why: 'yogurt swallow' }); // 꿀꺽
    if (i === 1 || i === 3) { const lf = pinky.lookFn; pinky.lookFn = null; pinky.eyeOpen = 1; pinky.tiltT = i === 1 ? 0.15 : -0.12; await wait(tok, 0.55); pinky.lookFn = lf; pinky.eyeOpen = 0.8; pinky.tiltT = 0; await wait(tok, 0.2); } // 한 번씩 나를 올려다본다
    else await wait(tok, 0.25); // 꿀꺽
  }
  toy.lapKind = 'mouth'; // 이 뒤로는 컵이 아니라 제 코와 입을 핥는다
  // 다 먹었다: 컵을 빼면 아쉬워 따라온다
  { const s = spot(); target = () => s.clone().addScaledVector(dC, 0.1).add(V3(0, 0.03, 0)).sub(cupMouth().sub(handR.pos)); }
  pinky.tgt.reach = 0.05; say('더…', headTop, 'small', 1.1); pinky.eyeOpen = 1;
  await wait(tok, 0.9);
  pinky.lookFn = null; pinky.tgt.neck = POSES.sit.neck; pinky.tgt.reach = 0;
  await tween(tok, 0.5, (q) => setTilt(lerp(1.15, -0.45, ease(q)))); // 빈 컵을 보여 준다
  // 코에 묻은 걸 알아채고 입맛을 다신다 (코를 치켜들며 핥을 때마다 조금씩 닦인다)
  pinky.tiltT = 0.3; say('?', headTop, '', 0.9); await wait(tok, 0.6);
  for (let i = 0; i < 2; i++) { toy.lap = 1; sideSay('할짝', i); pinky.tgt.headPitch = -0.14; const k0 = yogurtDab.k; await tween(tok, 0.34, (q) => yogurtDab.set(lerp(k0, i ? 0.42 : 0.7, q))); toy.lap = 0; pinky.tgt.headPitch = 0; await wait(tok, 0.22); }
  heart(); handR.want = null;
  await wait(tok, 0.3); releaseProps();
  pinky.tiltT = 0.32; pinky.wagAmpT = 0.6; pinky.wagSpeedT = 11; pinky.earPerk = 0.5;
  say('…또 줘?', headTop, 'soft', 2.4);
  await wait(tok, 2.0); pinky.tiltT = 0; pinky.earPerk = 0;
  toy.lap = 1; pinky.tgt.headPitch = -0.14; say('할짝', headTop, 'small', 1); await tween(tok, 0.45, (q) => yogurtDab.set(0.42 * (1 - q))); toy.lap = 0; pinky.tgt.headPitch = 0; yogurtDab.set(0); // 마지막 한 번 핥아 코를 닦는다
  await wait(tok, 0.4); yogurt.reset(); toyOff(); camHome();
}

// ---------- 고구마 말랑이: 살며시 받아 물고, 엎드려 한 발로 누르고 옆니로 쫀득쫀득
async function gogumaTreat(tok) {
  const ph = phoneK();
  toy.tok = tok; tok.cleanups.push(() => { toyOff(); goguma.reset(); });
  { const [p, a] = kneelFor(HOME, 0.95 * ph, 0.5, 0.3); camTo(p, a); }
  goguma.reset(); roomScene.add(goguma.g); goguma.g.visible = true; toy.fill = 1;
  const UP = V3(0, 1, 0);
  const pinch = () => handR.rig.inner.localToWorld(V3(0.012, -0.034, 0.072)); // 엄지와 손가락 끝 사이
  const pawPt = () => pinky.root.localToWorld(V3(0.034, 0.014, 0.352)); // 누른 앞발 바로 앞
  const jawPt = (x, y, z) => pinky.jaw.localToWorld(V3(x, y, z));
  let mode = 'hand', swing = 1, side = 1, pull = 0, bias = 0, jq = 1, t1 = clock; const a0 = V3(), b0 = V3();
  toy.tick = (dt, t) => {
    if (mode === 'hand') { // 집어 든 끝에서 늘어져 흔들린다 · 내밀 때는 아래 끝이 핑키 입 쪽으로 간다
      swing *= Math.exp(-0.8 * dt); const p = pinch(), l = goguma.len, m = jawPt(0, -0.004, 0.056).sub(p);
      goguma.hang(p, Math.sin((t - t1) * 6) * 0.16 * swing + bias * clamp(m.x / l, -0.85, 0.85), Math.cos((t - t1) * 4.3) * 0.08 * swing + bias * clamp(m.z / l, -0.85, 0.85));
    } else if (mode === 'jaw') { // 앞니로 가로로 문다: 양 끝이 입 밖으로 늘어진다
      const h = (goguma.len * 0.47) / 1.42, A = jawPt(-h, -0.02, 0.069), B = jawPt(h, -0.02, 0.069);
      goguma.setShape(A.lerp(a0, 1 - jq), B.lerp(b0, 1 - jq), 0.0075 * jq, UP, UP);
    } else if (mode === 'paws') {
      const top = jawPt(side * 0.01, -0.006, 0.05), bot = pawPt(), l = goguma.len * (1 + 0.15 * pull), d = top.distanceTo(bot);
      if (d > l) bot.sub(top).multiplyScalar(l / d).add(top); // 남은 게 짧으면 발에서 들려 올라온다
      goguma.setShape(bot, top, d < l ? null : 0, camRight(), toCamDir()); // 넓은 면이 보는 쪽을 향하게
    }
  };
  let target = () => roomCam.localToWorld(ph > 1 ? V3(0.06, -0.01, -0.5) : V3(0.15, -0.015, -0.46)); // 달랑달랑 들어 보여 준다
  handR.want = { pos: () => target(), up: () => V3(0, 1, 0), curl: 0.75, rate: 5 };
  pinky.lookFn = () => goguma.b;
  await wait(tok, 0.5);
  pinky.earPerk = 1; pinky.wagAmpT = 0.85; pinky.wagSpeedT = 18; say('!', headTop, '', 1.1);
  await wait(tok, 0.4); say('고구마다!', headTop, 'soft', 1.4);
  if (Math.hypot(pinky.x - HOME.x, pinky.z - HOME.z) > 0.08) { setPose(pinky, 'stand', 7); pinky.walkSpeed = 0.95; await walkTo(tok, HOME.x, HOME.z); pinky.walkSpeed = 0.5; }
  await sitAs(tok, 'front', 8);
  pinky.wagAmpT = 0.7; pinky.wagSpeedT = 14; swing = 0.7; t1 = clock;
  await wait(tok, 1.3); // 얌전히 기다린다
  // 옆에서 내밀면 목을 빼 살며시 받아 문다 (손이 얼굴을 가리지 않는다)
  const near = () => mouthPt().addScaledVector(toCamDir(), 0.025).addScaledVector(camRight(), 0.066).add(V3(0, 0.058, 0)).sub(pinch().sub(handR.pos));
  target = near; swing = 0.4; t1 = clock; handR.want.rate = 4;
  tween(tok, 0.9, (q) => { bias = ease(q); }).catch(() => {});
  await wait(tok, 0.75);
  pinky.tgt.reach = 0.035; pinky.tgt.neck += 0.12; pinky.tiltT = -0.15;
  await wait(tok, 0.45);
  pinky.jawOpen = 0.24; await wait(tok, 0.3);
  a0.copy(goguma.b); b0.copy(goguma.a); jq = 0; mode = 'jaw'; pinky.jawOpen = toy.rest = 0.09; say('앙', headTop, 'small', 1); handR.want.curl = 0.3;
  await tween(tok, 0.22, (q) => { jq = ease(q); });
  handR.want = null; pinky.lookFn = null; pinky.tgt.reach = 0; pinky.tgt.neck = POSES.sit.neck; pinky.tiltT = 0.12;
  await wait(tok, 0.9); pinky.tiltT = 0;
  // 엎드려 한 발로 누른다
  setPose(pinky, 'down', 3); pinky.tgt.yawOff = -0.45; pinky.wagAmpT = 0.35; pinky.wagSpeedT = 5; pinky.earPerk = 0;
  { const [p, a] = kneelAt(0.92 * ph, 0.3, 0.14); camTo(p, a, 1.8); }
  await wait(tok, 1.25);
  let lookUp = 0; const lookPt = () => pawPt().add(V3(0, 0.1 + lookUp, 0)).addScaledVector(toCamDir(), 0.08 + lookUp * 1.5);
  pinky.lookFn = lookPt; pinky.tgt.gaze = 0.6; pinky.tgt.neck = 0.2; pinky.tgt.reach = 0.02;
  pinky.tgt.paws[0].set(0.034, 0.046, 0.318); pinky.tgt.paws[1].x = -0.06;
  await wait(tok, 0.7);
  mode = 'paws'; toy.rest = 0; pinky.eyeOpen = 0.8;
  const words = ['쫀득', '쫀득쫀득', '질겅질겅', '쫀득쫀득', '냠냠'];
  for (let i = 0; i < 5; i++) {
    side = i < 2 ? 1 : i < 4 ? -1 : 1; pinky.tiltT = side * 0.45; toy.chew = 1; toy.chewRate = 9; pinky.tgt.gaze = 0.6 + 0.06 * i; // 짧아질수록 고개를 더 숙인다
    sideSay(words[i], i);
    await wait(tok, 0.95);
    pinky.tgt.paws[0].y = 0.04; // 발로 꾹 누르고
    await tween(tok, 0.4, (q) => { pull = q; lookUp = 0.075 * q; }); // 쭉 당겨서
    goguma.setLen(Math.max(0.05, goguma.k - 0.19)); pull = 0; spawnCrumbs(jawPt(0, -0.008, 0.055), 2); snd('sfx', 'smack', { gain: 2, force: 1, why: 'goguma snaps' }); pinky.tgt.paws[0].y = 0.046; // 끊어 먹는다 (쫀득하게 늘어났다가 톡)
    if (i === 1 || i === 3) { toy.chewRate = 12; pinky.tiltT = side * 0.2; lookUp = 0.16; pinky.eyeOpen = 1; await wait(tok, 0.6); pinky.eyeOpen = 0.8; } // 끊은 조각을 씹으며 나를 올려다본다
    lookUp = 0; await wait(tok, 0.12);
  }
  // 마지막 한 입
  goguma.g.visible = false; pinky.lookFn = null; pinky.tgt.gaze = 1; pinky.tgt.neck = 0; pinky.tgt.reach = 0; pinky.tiltT = 0;
  if (brain.force.crumb ?? Math.random() < 0.4) { const m = mouthPt(), r = camRight(), sg = Math.random() < 0.5 ? 1 : -1; dropTreat(m.x + r.x * sg * 0.45, m.z + r.z * sg * 0.45, 'goguma', m); mark('crumb'); } // 끊어 먹다 튄 조각 하나
  pinky.tgt.paws[0].copy(POSES.down.paws[0]); pinky.tgt.paws[1].copy(POSES.down.paws[1]);
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
const pickerIdle = () => (!active || (active.name === 'roam' && !active.toy)) && pinky.tgt.name !== 'curl'; // 로프를 물고 오는 중에는 표정을 건드리지 않는다
let pickerPerk = false; // 고르는 걸 쳐다보느라 귀를 세웠는지 (닫을 때 꼭 되돌린다 — 그사이 방석에 누웠어도)
function openPicker(btn, focus) {
  closePicker();
  pickerFor = btn; const menu = btn.dataset.menu;
  pickerEl.setAttribute('aria-label', menu === 'treat' ? '간식 고르기' : '장난감 고르기');
  pickerEl.replaceChildren(...(RP.picks || PICKS)[menu].map(([kind, ic, label]) => {
    const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'menuitem'); b.dataset.pick = kind; b.tabIndex = -1;
    const i = document.createElement('span'); i.className = 'ic'; i.setAttribute('aria-hidden', 'true'); i.textContent = ic;
    b.append(i, label); return b;
  }));
  pickerEl.hidden = false; pickBack.hidden = false; $('#roomUI').classList.add('picking');
  btn.classList.add('open'); btn.setAttribute('aria-expanded', 'true');
  placePicker();
  if (focus) pickerEl.firstChild.focus();
  if (pickerIdle()) { pickerPerk = true; pinky.earPerk = 0.6; pinky.tiltT = 0.15; pinky.wagAmpT = Math.max(pinky.wagAmpT, 0.6); pinky.wagSpeedT = Math.max(pinky.wagSpeedT, 13); snd('sfx', 'tag_jingle', { gain: -4, gap: 1.5, why: 'picker (ear perk)' }); } // 뭘 고르나 귀를 쫑긋하고 쳐다본다
}
function closePicker(refocus = false, chosen = false) {
  if (!pickerFor) return;
  const btn = pickerFor; pickerFor = null;
  pickerEl.hidden = true; pickBack.hidden = true; $('#roomUI').classList.remove('picking');
  btn.classList.remove('open'); btn.setAttribute('aria-expanded', 'false');
  if (refocus) btn.focus({ preventScroll: true });
  if (pickerPerk && !chosen && (!active || active.name === 'roam')) { pinky.earPerk = 0; pinky.tiltT = 0; if (pickerIdle()) { pinky.wagAmpT = 0.3; pinky.wagSpeedT = 6; } }
  pickerPerk = false;
}
pickBack.addEventListener('pointerdown', (e) => { e.preventDefault(); closePicker(); });
pickerEl.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-pick]'); if (!b || !pickerFor || transitioning || mode !== 'room') return;
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
  const b = e.target.closest('button[data-cmd]'); if (!b || transitioning || mode !== 'room') return; // 방을 나가는 중에는 새로 시작하지 않는다
  const one = b.dataset.menu && (RP.picks || PICKS)[b.dataset.menu]; if (one && one.length === 1) { closePicker(false, true); const name = b.dataset.cmd, kind = one[0][0]; startCommand(name, (tok) => CMDS[name](tok, kind)); return; } // 고를 것이 하나뿐이면 바로 (푸푸: 터키츄)
  if (b.dataset.menu) { if (pickerFor === b) closePicker(); else openPicker(b, e.detail === 0); return; } // 간식 · 놀아주기는 먼저 무엇으로 할지 고른다
  closePicker(false, true);
  const name = b.dataset.cmd; startCommand(name, CMDS[name]);
});

// ================================================================
// 핑키의 마음 — 기억(간식 · 남긴 밥 · 떨어진 간식 · 엄마) · 하고 싶은 것 · 엉뚱한 짓
// 혼자 있을 때(roam)와 몇몇 명령의 사이사이에만 끼어든다. 누른 명령을 오래 막지 않고, 방을 나가면 모두 처음으로 돌아간다
// ================================================================
const BRAIN = {
  freeThrows: 2, // 간식 없이도 공을 얌전히 물어다 주는 횟수 (그다음부터는 심술)
  momGap: 70, quiet: 75, away: 20, // 엄마다! 사이 간격(초) · 이만큼 조용하다가 다시 만지면 · 화면을 이만큼 떠났다 오면(실제 초)
  leftP: 0.4, leftWait: 22, // 밥을 남길 확률 · 남긴 밥을 다시 먹으러 오기까지
  hide: [150, 240], hideFirst: [30, 55], // 어딘가 숨어 있는 간식이 생기는 간격
  deafP: 0.3, deafCd: 120, ropeMineP: 0.3, sneezeP: 0.15,
};
const brain = { d: {}, stat: {}, log: [], force: {}, cd: {}, hist: [] };
function brainReset() {
  Object.assign(brain, {
    d: { hunger: 0.4, play: 0.4, rest: 0.25, attach: 0.3 }, // 0..1: 배고픔 · 놀고 싶음 · 졸림 · 엄마 곁에 가고 싶음
    lastTreat: -999, treats: 0, fedAt: -999, throws: 0, refusals: 0, owe: false, payDue: false, lastCheek: '', cheeks: [], begs: 0, rot: {}, heard: null, tiltEnd: 0, dragAt: -99,
    leftAt: -999, leftLast: false, lastMom: -999, lastInput: clock, hiddenAt: 0, poke: null, entryAt: 0, hideAt: clock + BRAIN.hideFirst[0] + Math.random() * (BRAIN.hideFirst[1] - BRAIN.hideFirst[0]),
    sniffs: 0, thumpEnd: 0, cd: {}, hist: [],
  });
  for (const d of drops) d.m.parent && d.m.parent.remove(d.m); drops.length = 0; camTurn = false;
}
const mark = (k) => { brain.stat[k] = (brain.stat[k] || 0) + 1; brain.log.push([+clock.toFixed(1), k]); if (brain.log.length > 600) brain.log.shift(); };
const cdOK = (k, sec) => clock - (brain.cd[k] ?? -999) > sec;
const idleNow = () => !active || (active.name === 'roam' && !active.special);
// 혼자 하는 짓 가운데 roam 사이에 끼어드는 것 (엄마다! · 공 갖다주기): 이름은 roam이라 버튼에 불이 켜지지 않고, 무엇을 누르든 바로 그만둔다
const rot = (k, arr) => arr[(brain.rot[k] = (brain.rot[k] ?? -1) + 1) % arr.length]; // 같은 말만 되풀이하지 않게 차례로
const nearFirst = async (tok) => { if (tok.far) { tok.far = false; await comeHere(tok, 0.95); } }; // 방에 들어서자마자 불렸으면 먼저 발치로 온다
let camTurn = false; // 남긴 밥을 먹는 동안 시점을 밥그릇 쪽으로 돌려 둔 상태
function nudgeTreat() { // "간식 주면…" 할 때 간식 버튼이 살짝 들썩인다
  const b = actionsEl.querySelector('[data-cmd="treat"]'); if (!b) return;
  b.classList.remove('nudge'); void b.offsetWidth; b.classList.add('nudge'); setTimeout(() => b.classList.remove('nudge'), 2600);
}

// ---------- 눈길과 잔버릇: 늘 엄마만 쳐다보지 않는다 (공 · 장난감 · 밥그릇 · 창밖 · 소리 난 곳을 두리번, 하품 · 부르르 · 기지개)
const WIN_PT = V3(-4.6, 1.0, -0.6);
function lookSpot() {
  const o = RP.looks ? RP.looks.map((q) => () => q) : [() => BOWL, () => WIN_PT, () => V3(SPOTS.gifts.fx, 0.25, SPOTS.gifts.fz), () => V3(CUSH.x, 0.1, CUSH.z)];
  if (ballOnFloor()) o.push(() => ball.g.position, () => ball.g.position);
  if (rope.state.asleep) o.push(() => rope.pos('B.bite'));
  const dr = nearestDrop(99); if (dr) o.push(() => dr.m.position, () => dr.m.position);
  for (let i = 0; i < 3; i++) { const a = pinky.yaw + (Math.random() - 0.5) * 2.4, pt = V3(pinky.x + Math.sin(a) * 1.6, 0.05 + Math.random() * 0.5, pinky.z + Math.cos(a) * 1.6); o.push(() => pt); }
  return o[Math.floor(Math.random() * o.length)];
}
async function idleLook(tok, sec = 1.8, turn = true) {
  const fn = lookSpot(), p = fn(), off = Math.abs(angDiff(pinky.yaw, Math.atan2(p.x - pinky.x, p.z - pinky.z)));
  if (pinky.tgt.name === 'stand') pinky.face = turn && off > 1.2 ? { x: p.x, z: p.z } : pinky.face === 'cam' ? null : pinky.face; // 많이 돌아봐야 하면 몸도 돌린다
  pinky.lookFn = fn; pinky.earPerk = 0.3; await wait(tok, sec); pinky.lookFn = null; pinky.earPerk = 0;
}
async function yawn(tok) {
  mark('yawn'); brain.cd.yawn = clock; pinky.lookFn = null; const hp = pinky.tgt.headPitch;
  pinky.tgt.headPitch = hp - 0.3; pinky.earPerk = -0.5; say('하암…', headTop, 'soft', 1.6);
  await tween(tok, 0.7, (k) => { pinky.jawOpen = 0.5 * ease(k); pinky.eyeOpen = lerp(1, 0.12, ease(k)); });
  await wait(tok, 0.55);
  await tween(tok, 0.5, (k) => { pinky.jawOpen = 0.5 * (1 - ease(k)); pinky.eyeOpen = lerp(0.12, 1, ease(k)); });
  pinky.jawOpen = 0; pinky.eyeOpen = 1; pinky.tgt.headPitch = hp; pinky.earPerk = 0; await wait(tok, 0.5);
}
async function shakeOff(tok) { // 부르르: 몸을 털면 귀가 펄럭이고 인식표가 짤랑거린다
  mark('shake'); brain.cd.shake = clock; setPose(pinky, 'stand', 6); pinky.lookFn = null; await wait(tok, 0.35);
  const r0 = pinky.tgt.roll, t0 = pinky.tgt.headTilt; tok.cleanups.push(() => { if (pinky.tgt.name === 'stand') { pinky.tgt.roll = r0; pinky.tgt.headTilt = t0; } });
  say('부르르', headTop, '', 1.1);
  await tween(tok, 1.0, (k) => { const w = Math.sin(Math.PI * k), a = k * Math.PI * 11; pinky.tgt.roll = pinky.cur.roll = r0 + 0.1 * w * Math.sin(a); pinky.tgt.headTilt = pinky.cur.headTilt = t0 - 0.3 * w * Math.sin(a - 0.9); pinky.eyeOpen = 1 - 0.8 * w; pinky.earPerk = 0.8 * w * Math.sin(a); });
  pinky.tgt.roll = r0; pinky.tgt.headTilt = t0; pinky.eyeOpen = 1; pinky.earPerk = 0; pinky.wagAmpT = 0.5; pinky.wagSpeedT = 10; await wait(tok, 0.6);
}
async function stretch(tok) { // 기지개: 앞을 낮추고 엉덩이를 든 채 쭈욱
  mark('stretch'); brain.cd.stretch = clock; setPose(pinky, 'stand', 5); pinky.lookFn = null; await wait(tok, 0.35);
  Object.assign(pinky.tgt, { pitch: 0.3, bodyY: POSES.stand.bodyY - 0.035, bodyZ: -0.03, headPitch: -0.35, gaze: 0.3, neck: 0.15 }); pinky.poseRate = 2.6; pinky.earPerk = -0.4; pinky.eyeOpen = 0.3;
  say('쭈욱…', headTop, 'soft', 1.5); await wait(tok, 1.5);
  setPose(pinky, 'stand', 3); pinky.eyeOpen = 1; pinky.earPerk = 0; pinky.wagAmpT = 0.5; pinky.wagSpeedT = 10; await wait(tok, 0.9);
}
async function idleGap(tok) {
  if (pinky.tgt.name === 'curl' || pinky.curlK > 0.05) return;
  if (pinky.dami && pinky.tgt.name === 'stand' && cdOK('kk', 16) && Math.random() < 0.2) { brain.cd.kk = clock; mark('kk'); const fn = lookSpot(); pinky.lookFn = fn; pinky.earPerk = 1; await wait(tok, 0.6); say('컹!', headTop, '', 1.0); barkMove(tok); await wait(tok, 0.9); pinky.lookFn = null; pinky.earPerk = 0; return; } // 담이: 사이사이 뭘 보고 컹!
  const r = Math.random(), up = pinky.tgt.name === 'stand';
  if (r < 0.14 && cdOK('yawn', 140)) await yawn(tok);
  else if (up && r < 0.26 && cdOK('shake', 200)) await shakeOff(tok);
  else if (up && r < 0.34 && cdOK('stretch', 260) && brain.d.rest > 0.3) await stretch(tok);
  else if (r < 0.88) await idleLook(tok, 1.2 + Math.random() * 1.6);
  else { pinky.face = 'cam'; pinky.wagAmpT = 0.5; pinky.wagSpeedT = 10; await wait(tok, 1 + Math.random()); } // 가끔은 엄마를 본다
}

function startSpecial(tag, fn) { startCommand('roam', (tok) => { tok.special = tag; return fn(tok); }, true); }

// ---------- 바닥에 떨어진 간식 (밥 줄 때 튄 사료 · 먹다 흘린 조각 · 어딘가 숨어 있던 것)
const drops = [];
const DROP_MAT = { bit: M(0xb5692a, { roughness: 0.55 }), kibble: M(0x8a4f24, { roughness: 0.6 }), goguma: M(0xe8962a, { roughness: 0.5 }) }; // 크림색 러그 위에서도 눈에 띄는 과자색
const DROP_GEO = { bar: new THREE.CapsuleGeometry(0.0095, 0.034, 4, 8), knob: new THREE.SphereGeometry(0.0115, 10, 8), kibble: new THREE.SphereGeometry(0.02, 12, 8), goguma: box(0.046, 0.014, 0.022) };
const DROP = { // 뼈다귀 모양 과자 · 사료 한 알 · 고구마 조각 (멀리서도 보이게 실제보다 조금 크다)
  bit: { h: 0.0085, make() { const g = new THREE.Group(), bar = new THREE.Mesh(DROP_GEO.bar, DROP_MAT.bit); bar.rotation.z = Math.PI / 2; bar.castShadow = true; g.add(bar); for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const k = new THREE.Mesh(DROP_GEO.knob, DROP_MAT.bit); k.position.set(sx * 0.026, 0, sz * 0.009); k.castShadow = true; g.add(k); } g.scale.set(1, 0.72, 1); return g; } },
  kibble: { h: 0.014, make() { const m = new THREE.Mesh(DROP_GEO.kibble, DROP_MAT.kibble); m.castShadow = true; m.scale.set(1, 0.7, 1); return m; } },
  goguma: { h: 0.007, make() { const m = new THREE.Mesh(DROP_GEO.goguma, DROP_MAT.goguma); m.castShadow = true; return m; } },
};
function dropTreat(x, z, kind = 'bit', from = null, vel = null) {
  const k = DROP[kind], m = k.make(); m.rotation.set(0, Math.random() * 3, 0);
  const q = { x, z }; collide(q); // 핑키가 설 수 있는 곳에만
  const d = { m, kind, x: q.x, z: q.z, h: k.h, t: clock, v: null };
  if (from) { m.position.copy(from); d.v = vel || V3((q.x - from.x) / 0.5, 1.2, (q.z - from.z) / 0.5); } else m.position.set(q.x, k.h, q.z);
  roomScene.add(m); drops.push(d); return d;
}
function stepDrops(dt) {
  for (const d of drops) if (d.v) {
    d.v.y -= 7 * dt; d.m.position.addScaledVector(d.v, dt); d.m.rotation.x += dt * 9;
    if (d.m.position.y < d.h) {
      d.m.position.y = d.h;
      if (Math.abs(d.v.y) > 0.6) { d.v.y *= -0.4; d.v.x *= 0.55; d.v.z *= 0.55; snd('kibbleHit', false, [d.m.position.x, 0.01, d.m.position.z]); if (!d.said) { d.said = true; const p = d.m.position; say('톡', () => V3(p.x, 0.06, p.z), 'small', 0.8); brain.heard = { p, until: clock + 1.5 }; } }
      else { const q = { x: d.m.position.x, z: d.m.position.z }; collide(q); d.v = null; d.x = q.x; d.z = q.z; d.t = clock; d.m.position.set(q.x, d.h, q.z); d.m.rotation.x = 0; }
    }
  }
}
function nearestDrop(maxD = 99, minAge = 0) {
  let best = null, bd = maxD;
  for (const d of drops) { if (d.v || d.taken || clock - d.t < minAge) continue; const l = Math.hypot(d.x - pinky.x, d.z - pinky.z); if (l < bd) { bd = l; best = d; } }
  return best;
}
const HIDE = [[-0.55, 0.45], [0.75, 0.4], [-0.8, 1.0], [0.9, 1.05], [0.45, 0.2], [-0.25, 1.2], [1.15, 0.75], [-1.05, 0.7]]; // 러그 위, 늘 화면에 보이는 자리
function hideTreat(toss = true) { // 엄마가 흘린 간식 한 조각이 러그 위에 톡 떨어진다 (핑키에게서 조금 떨어진 곳)
  const c = HIDE.filter(([x, z]) => Math.hypot(x - pinky.x, z - pinky.z) > 0.7);
  let [x, z] = (c.length ? c : HIDE)[Math.floor(Math.random() * (c.length || HIDE.length))]; x += (Math.random() - 0.5) * 0.1; z += (Math.random() - 0.5) * 0.1;
  brain.hideAt = clock + BRAIN.hide[0] + Math.random() * (BRAIN.hide[1] - BRAIN.hide[0]);
  mark('hide'); const kind = Math.random() < 0.65 ? 'bit' : 'kibble';
  if (!toss) return dropTreat(x, z, kind);
  const from = roomCam.localToWorld(V3((Math.random() - 0.5) * 0.5, -0.4, -0.75)), T = 0.6; // 화면 아래(엄마 손 쪽)에서 날아든다. 한 번 튀고 조금 더 굴러가므로 살짝 못 미치게 던진다
  return dropTreat(x, z, kind, from, V3(((x - from.x) / T) * 0.7, (0.02 - from.y + 0.5 * 7 * T * T) / T, ((z - from.z) / T) * 0.7));
}
// 킁킁 냄새를 따라가다 찾아서 주워 먹는다: 코를 바닥에 대고 다가가 → 킁킁킁(빨라진다) → ! → 덥석 → 와작와작
const NOSE_REACH = 0.29;
const FOUND_LINES = ['찾았다!', '헤헤, 주웠다', '맛있다!', '횡재했다!'];
async function findTreat(tok, dr) {
  if (!dr || dr.taken || dr.v) return false;
  dr.taken = true; tok.cleanups.push(() => { snd('cancelPhrase', 'found'); if (drops.includes(dr)) { if (dr.m.parent === roomScene) dr.taken = false; else { dr.m.parent && dr.m.parent.remove(dr.m); drops.splice(drops.indexOf(dr), 1); } } });
  setPose(pinky, 'stand', 6); pinky.lookFn = null; pinky.tgt.gaze = 0; pinky.tgt.headPitch = 0.6; pinky.sniff = 0.7; pinky.walkSpeed = 0.42; pinky.wagAmpT = 0.5; pinky.wagSpeedT = 11; pinky.earPerk = 0.3;
  let dx = dr.x - pinky.x, dz = dr.z - pinky.z, L = Math.hypot(dx, dz) || 1e-3;
  say('킁킁', noseTip);
  if (L > 1.1) { // 냄새를 더듬어 간다: 곧장 가지 않고 한 번 꺾어서
    const s = Math.random() < 0.5 ? 1 : -1, w = { x: pinky.x + dx * 0.55 - (dz / L) * 0.28 * s, z: pinky.z + dz * 0.55 + (dx / L) * 0.28 * s }; collide(w);
    await walkTo(tok, w.x, w.z); pinky.face = { x: dr.x, z: dr.z }; say('킁킁', noseTip); await wait(tok, 0.5);
    dx = dr.x - pinky.x; dz = dr.z - pinky.z; L = Math.hypot(dx, dz) || 1e-3;
  }
  if (L < NOSE_REACH - 0.06) { // 발밑에 있으면 한 발 물러나서
    const p0 = { x: pinky.x, z: pinky.z }, bx = -Math.sin(pinky.yaw), bz = -Math.cos(pinky.yaw), back = NOSE_REACH - L * 0.5; pinky.face = { x: dr.x, z: dr.z }; pinky.paddle = 0.25;
    await tween(tok, 0.6, (q) => { pinky.x = p0.x + bx * back * ease(q); pinky.z = p0.z + bz * back * ease(q); }); pinky.paddle = 0;
  } else if (L > NOSE_REACH + 0.04) { pinky.walkSpeed = 0.5; await walkTo(tok, dr.x - (dx / L) * NOSE_REACH, dr.z - (dz / L) * NOSE_REACH); }
  pinky.face = { x: dr.x, z: dr.z }; await wait(tok, 0.35);
  setPose(pinky, 'eat', 5); pinky.tgt.headPitch += 0.3; pinky.tgt.pitch += 0.12; pinky.tgt.bodyY -= 0.02; pinky.sniff = 1; pinky.wagAmpT = 0.75; pinky.wagSpeedT = 16; // 코끝이 바닥의 조각에 닿게 앞을 더 낮춘다
  snd('phrase', 'found'); say('킁킁킁', noseTip, '', 1.0); // 소리: 킁킁이 빨라지다 헉 → 덥석 → 와작
  await wait(tok, 0.8);
  pinky.sniff = 0; pinky.earPerk = 1; bubble('!', headTop, '', 0.9);
  await wait(tok, 0.2); pinky.jawOpen = 0.35;
  await wait(tok, 0.12);
  pinky.jaw.attach(dr.m); dr.m.position.set(0, -0.004, 0.088); dr.m.rotation.set(0, 0, 0); pinky.jawOpen = 0.08; // 덥석 (가로로 문다)
  await wait(tok, 0.15);
  pinky.lookFn = null; setPose(pinky, 'stand', 6); pinky.face = 'cam'; pinky.tgt.gaze = 1; pinky.tgt.headPitch = -0.2; pinky.earPerk = 0.9; pinky.wagAmpT = 0.9; pinky.wagSpeedT = 18; mark('found:' + dr.kind);
  await wait(tok, 0.7); // 물고서 고개를 번쩍 든다 — 이것 봐!
  pinky.chew = true; pinky.jawOpen = 0; pinky.tgt.headPitch = 0;
  const words = ['와작', '냠냠', '챱챱'];
  for (let i = 0; i < words.length; i++) { sideSay(words[i], i); dr.m.scale.multiplyScalar(0.7); if (i === 0) spawnCrumbs(mouthPt(), 2); await wait(tok, 0.5); }
  dr.m.parent && dr.m.parent.remove(dr.m); drops.splice(drops.indexOf(dr), 1); pinky.chew = false;
  brain.d.hunger = Math.max(0, brain.d.hunger - 0.12);
  pinky.lick = 1; say('쩝쩝', headTop, '', 1.1, 80); await wait(tok, 0.8); pinky.lick = 0;
  pinky.tiltT = 0.25; pinky.earPerk = 0.4; say(FOUND_LINES[(brain.stat.foundLine = (brain.stat.foundLine || 0) + 1) % FOUND_LINES.length], headTop, 'soft', 1.8);
  await wait(tok, 1.6); pinky.tiltT = 0; pinky.earPerk = 0; pinky.wagAmpT = 0.4; pinky.wagSpeedT = 8;
  return true;
}
// 냄새만 따라다니다 허탕
async function sniffTrail(tok) {
  setPose(pinky, 'stand', 5); pinky.walkSpeed = 0.34; pinky.tgt.gaze = 0; pinky.tgt.headPitch = 0.6; pinky.sniff = 0.6;
  for (let i = 0; i < 2; i++) {
    const q = { x: -0.7 + Math.random() * 1.6, z: -0.5 + Math.random() * 1.5 }; collide(q);
    await walkTo(tok, q.x, q.z); say('킁킁', noseTip); await wait(tok, 0.9);
    const dr = nearestDrop(1.3); if (dr) { await findTreat(tok, dr); return; }
  }
  pinky.sniff = 0; pinky.tgt.gaze = 1; pinky.tgt.headPitch = 0; pinky.face = 'cam'; mark('trail');
  await wait(tok, 0.8);
}
// 에취! — 냄새 맡다가 코가 간질간질
async function sneeze(tok) {
  mark('sneeze'); pinky.sniff = 0; const hp0 = pinky.tgt.headPitch;
  pinky.tgt.headPitch = hp0 - 0.3; pinky.eyeOpen = 0.45; pinky.jawOpen = 0.12; bubble('에…', headTop, 'small', 0.7); await wait(tok, 0.55);
  pinky.tgt.headPitch = hp0 + 0.55; pinky.eyeOpen = 0.05; pinky.jawOpen = 0; pinky.earPerk = -0.6; say('에취!', headTop, '', 1.1); await wait(tok, 0.28);
  pinky.tgt.headPitch = hp0; pinky.earPerk = 0; await wait(tok, 0.3); pinky.eyeOpen = 1; pinky.blinkT = 0.1; pinky.tiltT = 0.2;
  await wait(tok, 0.9); pinky.tiltT = 0;
}
// 냄새 맡은 자리 근처에 떨어진 게 있으면 찾아 먹고, 아니면 가끔 재채기
async function afterSniff(tok, reach = 1.7) {
  const dr = nearestDrop(reach);
  if (dr) return findTreat(tok, dr);
  if ((brain.force.sneeze ?? Math.random() < BRAIN.sneezeP) && cdOK('sneeze', 60)) { brain.cd.sneeze = clock; await sneeze(tok); }
  return false;
}

// ---------- 남긴 밥: 나중에 혼자 와서 마저 먹는다
const hasLeft = () => mound.amount > 0.05 && !pouring && !kibbles.length;
async function eatLeft(tok, line = true) {
  mark('leftovers');
  setPose(pinky, 'stand', 5); pinky.earPerk = 0.6; pinky.wagAmpT = 0.6; pinky.wagSpeedT = 12; pinky.lookFn = () => BOWL;
  if (line) { say('아, 밥 남았지!', headTop, 'soft', 1.6); await wait(tok, 0.7); }
  // 밥그릇은 평소 시점에서 화면 밖이다: 먹는 모습이 보이게 고개를 그쪽으로 살짝 돌려 본다 (끝나거나 끊기면 제자리로)
  // 둘러보는 중이거나 방금까지 시점을 움직였으면 돌리지 않는다. 돌려 둔 동안 끌기 시작하면 바로 놓아준다
  if (!drag && !touch.active && Math.abs(look.ty) < 0.05 && Math.abs(look.tp) < 0.05 && clock - brain.dragAt > 10) { camTurn = true; camTo(V3(0.8, CAM_POS.y, CAM_POS.z - 0.3), V3(1.75, 0.22, 0.95), 1.3); tok.cleanups.push(() => { if (camTurn) { camTurn = false; camHome(); } }); }
  pinky.walkSpeed = 0.6; await walkTo(tok, EAT.x, EAT.z);
  pinky.walkSpeed = 0.5; pinky.lookFn = null; pinky.face = { x: BOWL.x, z: BOWL.z }; pinky.earPerk = 0; await wait(tok, 0.4);
  setPose(pinky, 'eat', 5); pinky.chew = true;
  const words = ['챱챱', '와구와구', '냠냠', '챱챱'], n = clamp(Math.round(mound.amount * 6), 2, 4), step = mound.amount / n;
  for (let i = 0; i < n; i++) { sideSay(words[i], i); mound.amount = Math.max(0, mound.amount - step); updateMound(); await wait(tok, 0.6); }
  pinky.chew = false; mound.amount = 0; updateMound(); brain.d.hunger = Math.min(brain.d.hunger, 0.1); brain.fedAt = clock;
  pinky.lick = 1; say('할짝할짝', headTop, '', 1.2, 70); await wait(tok, 0.9); pinky.lick = 0;
  setPose(pinky, 'stand', 5); pinky.face = 'cam'; pinky.tiltT = 0.2; pinky.wagAmpT = 0.6; pinky.wagSpeedT = 11;
  say('다 먹었다!', headTop, 'soft', 1.8); await wait(tok, 1.6); pinky.tiltT = 0;
  if (camTurn) { camTurn = false; camHome(); }
}
function spillKibble() { // 밥을 부을 때 사료 한두 알이 그릇 밖으로 튄다
  const r = Math.random(), n = brain.force.spill ?? (drops.length >= 4 ? 0 : r < 0.5 ? 1 : r < 0.75 ? 2 : 0);
  for (let i = 0; i < n; i++) {
    const s = i ? -1 : Math.random() < 0.5 ? 1 : -1, x = BOWL.x - 0.3 - Math.random() * 0.12, z = BOWL.z + s * (0.42 + Math.random() * 0.14);
    dropTreat(x, z, 'kibble', V3(BOWL.x - 0.03, 0.09, BOWL.z + s * 0.04)); mark('spill');
  }
}

// ---------- 엄마다! — 보는 사람(엄마)에게 달려와 발을 동동 구르고 마주 앉는다
const nearSpot = () => { const dx = CAM_POS.x - HOME.x, dz = CAM_POS.z - HOME.z, L = Math.hypot(dx, dz); return { x: HOME.x + (dx / L) * 0.42, z: HOME.z + (dz / L) * 0.42 }; };
const MOM_LINES = { entry: '왔어? ♥', tab: '왔다 왔다! ♥', quiet: '놀아줘 ♥' };
const mouthBusy = () => pinky.chew || pinky.lick > 0 || toy.chew > 0 || toy.lap > 0 || toy.shake > 0 || ball.state === 'mouth' || pinky.jawOpen > 0.05 || (active && ['treat', 'feed', 'play'].includes(active.name));
function momQuick() { // 다른 걸 하는 중이면 알아보기만 한다: 말풍선 + 작은 소리 (입에 뭘 물고 있으면 짖지 않는다)
  brain.lastMom = clock; bubble('엄마다!', headTop, '', 1.5); snd('phrase', 'mom', { mode: mouthBusy() ? 'busy' : 'quick' });
  pinky.wagAmpT = Math.max(pinky.wagAmpT, 0.8); pinky.wagSpeedT = Math.max(pinky.wagSpeedT, 16); mark('mom:quick');
}
async function momGreet(tok, why = 'entry') {
  brain.lastMom = clock; brain.d.attach = Math.max(0, brain.d.attach - 0.5); mark('mom:' + why);
  let slow = false;
  if (pinky.tgt.name === 'curl' || pinky.curlK > 0.3) { slow = true; mark('mom:woke'); await wakeUp(tok, 'mom'); brain.d.rest = Math.min(brain.d.rest, 0.5); } // 자다가도 엄마가 오면 일어난다 (응…? → 천천히 일어나서)
  setPose(pinky, 'stand', 7); pinky.sniff = 0; pinky.lookFn = null; pinky.tgt.gaze = 1; pinky.tgt.headPitch = -0.12; pinky.face = 'cam';
  pinky.earPerk = 1; pinky.wagAmpT = 0.9; pinky.wagSpeedT = 18; pinky.turnCap = 2.2; tok.cleanups.push(() => { pinky.turnCap = 0; snd('cancelPhrase', 'mom'); });
  bubble('엄마다!', headTop, '', 1.7); snd('phrase', 'mom', { mode: why === 'entry' ? 'entry' : 'again' }); // 소리: 인식표 짤랑 → 낑 → 멍 (들어설 때는 작게)
  await wait(tok, 0.6);
  const n = nearSpot(); pinky.turnCap = 0;
  if (Math.hypot(pinky.x - n.x, pinky.z - n.z) > 0.15) { pinky.walkSpeed = slow ? 0.8 : 1.05; await walkTo(tok, n.x, n.z); pinky.walkSpeed = 0.5; }
  pinky.face = 'cam'; pinky.tgt.yawOff = 0; pinky.tgt.headPitch = -0.2;
  pinky.paddleFront = true; pinky.paddle = 0.5; pinky.earPerk = -0.5; pinky.eyeOpen = 0.55; heart(); // 발을 동동
  await wait(tok, 1.0); pinky.paddle = 0;
  await wait(tok, 0.2); pinky.paddleFront = false; pinky.eyeOpen = 1;
  sitFront(6); pinky.earPerk = 0.3; pinky.wagAmpT = 0.8; pinky.wagSpeedT = 15;
  await wait(tok, 0.7); pinky.tiltT = 0.25; say(MOM_LINES[why] || MOM_LINES.entry, headTop, 'soft', 2); heart();
  await wait(tok, 2.0); pinky.tiltT = 0; pinky.earPerk = 0; pinky.wagAmpT = 0.45; pinky.wagSpeedT = 9;
  await idleLook(tok, 1.0, false); // 한참 쳐다보고만 있지 않는다
}
function brainPoke(why, canvasHit = true, delay = 0.15) { brain.poke = { why, canvas: canvasHit, at: clock + delay }; }
function momCheck() {
  const p = brain.poke; brain.poke = null;
  if (clock - brain.lastMom < BRAIN.momGap || transitioning) return;
  const curled = pinky.tgt.name === 'curl' || pinky.curlK > 0.05;
  if (curled && (!idleNow() || napKeep() || !p.canvas)) { // 방석 버튼으로 재웠거나 쓰다듬는 중이면 깨지 않고 꼬리만 탁탁
    if (p.canvas && cdOK('thump', 30)) { brain.cd.thump = clock; pinky.wagAmpT = 0.3; pinky.wagSpeedT = 7; brain.thumpEnd = clock + 1.6; say('음… 엄마…', headTop, 'small', 1.6); mark('mom:sleepy'); }
    return;
  }
  if (!idleNow() || pickerFor || touch.active || !p.canvas) return void momQuick();
  startSpecial('mom', (tok) => momGreet(tok, p.why)); // 혼자 놀던 중 · 방석으로 가던 길 · 혼자 낮잠 자던 중이면 엄마한테 온다
}

// ---------- 공: 간식을 한동안 못 받으면 심술 (안 준다 · 엎드려 씹는다 · 반만 가져온다) — 간식을 주면 풀린다
const ballOnFloor = () => ball.g.visible && ball.state === 'rest' && ball.g.parent === roomScene;
function ballMood() {
  if (brain.force.ball) return brain.force.ball;
  const debt = brain.throws - BRAIN.freeThrows;
  if (debt < 0) return 'nice';
  if (brain.refusals >= 2) return 'givein';
  if (debt === 0 && brain.refusals === 0 && Math.random() < 0.3) return 'nice';
  if (brain.cheeks.length >= 3) brain.cheeks = [brain.lastCheek]; // 세 가지를 다 보여 준 다음에야 되풀이한다
  const o = ['keep', 'chew', 'drop'].filter((m) => !brain.cheeks.includes(m)); return o[Math.floor(Math.random() * o.length)];
}
async function ballChase(tok, speed = 1.15, maxT = 12) {
  pinky.walkSpeed = speed; tok.cleanups.push(() => { pinky.walkTarget = null; });
  const reach = 0.26, t0 = clock;
  await until(tok, () => {
    const b = ball.g.position, dx = b.x - pinky.x, dz = b.z - pinky.z, dist = Math.hypot(dx, dz) || 1;
    pinky.walkTarget = dist > reach + 0.03 ? { x: b.x - (dx / dist) * reach, z: b.z - (dz / dist) * reach } : null;
    if (clock - t0 > maxT) { ball.state = 'rest'; ball.g.position.set(pinky.x + Math.sin(pinky.yaw) * reach, ball.r, pinky.z + Math.cos(pinky.yaw) * reach); return true; }
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
}
async function ballGive(tok, line = '또 던져!') { // 발치에 와서 마주 앉아 내려놓는다
  pinky.walkSpeed = 0.95; await walkTo(tok, HOME.x, HOME.z); pinky.walkSpeed = 0.5;
  sitFront(7);
  await wait(tok, 0.7);
  pinky.jawOpen = 0.3; ballToWorld(toCamDir().multiplyScalar(0.5).add(V3(0, 0.4, 0)));
  await wait(tok, 0.2); pinky.jawOpen = 0;
  pinky.wagAmpT = 0.85; pinky.wagSpeedT = 18; pinky.tiltT = 0.25; say(line, headTop, 'soft', 2);
  await wait(tok, 2.2); pinky.tiltT = 0;
}
const ballDrop = async (tok, v) => { pinky.jawOpen = 0.3; await wait(tok, 0.12); ballToWorld(v); await wait(tok, 0.25); pinky.jawOpen = 0; };
async function ballCheeky(tok, mood) {
  mark('ball:' + mood);
  if (mood === 'givein') { // 두 번 버텼으면 이번에는 져 준다
    brain.refusals = 0; brain.throws = 0; brain.owe = false; // 져 주고 나면 다시 두 번은 순순히
    pinky.walkSpeed = 0.6; pinky.wagAmpT = 0.35; pinky.wagSpeedT = 7; await walkTo(tok, HOME.x, HOME.z); pinky.walkSpeed = 0.5;
    sitFront(6); await wait(tok, 0.8); say('후우…', headTop, 'soft', 1.4); await wait(tok, 1.0);
    await ballDrop(tok, toCamDir().multiplyScalar(0.5).add(V3(0, 0.4, 0)));
    pinky.tiltT = 0.2; pinky.wagAmpT = 0.6; pinky.wagSpeedT = 12; say('…이번만이야', headTop, 'soft', 2); await wait(tok, 2.0); pinky.tiltT = 0;
    return;
  }
  brain.refusals++; brain.owe = true; brain.payDue = false; brain.lastCheek = mood; brain.cheeks.push(mood);
  // 반쯤만 온다: 발치에서 한 걸음 남짓 떨어진 곳 (늘 화면 안, 엄마보다 먼 쪽)
  let dx = (pinky.x - HOME.x) * 0.8, dz = Math.min(pinky.z - HOME.z, -0.45), L = Math.hypot(dx, dz);
  const p1 = { x: HOME.x + (dx / L) * 0.78, z: HOME.z + (dz / L) * 0.78 }; collide(p1);
  tok.cleanups.push(() => { if (pinky.tgt.name === 'bow') setPose(pinky, 'stand', 5); });
  pinky.walkSpeed = 0.8; pinky.wagAmpT = 0.8; pinky.wagSpeedT = 16; await walkTo(tok, p1.x, p1.z); pinky.walkSpeed = 0.5; pinky.face = 'cam';
  const ask = (line) => { pinky.tiltT = 0.28; pinky.earPerk = 0.6; pinky.wagAmpT = 0.6; pinky.wagSpeedT = 11; say(line, headTop, 'soft', 2.4); nudgeTreat(); };
  if (mood === 'keep') { // 약 올리기: 엉덩이를 들고 "내 꺼야!", 손을 뻗으면 옆으로 쏙
    pinky.tgt.yawOff = 0; await wait(tok, 0.5);
    setPose(pinky, 'bow', 5); pinky.tgt.headPitch = -0.25; pinky.wagAmpT = 0.95; pinky.wagSpeedT = 19; say('내 꺼야!', headTop, '', 1.4);
    await wait(tok, 1.0);
    handR.want = { pos: () => { const b = ball.g.getWorldPosition(V3()).addScaledVector(toCamDir(), 0.22).add(V3(0, 0.06, 0)), c = roomCam.position, d = b.sub(c), L = d.length(); return c.clone().addScaledVector(d, Math.min(1, 0.72 / L)); }, up: () => V3(0, -1, 0), curl: 0.25, rate: 3.2 }; // 멀리 있으면 팔이 닿는 데까지만 (소매가 방 한가운데 떠 보이지 않게)
    await wait(tok, 0.9);
    const s = pinky.x > 0.1 ? -1 : 1, p2 = { x: p1.x + camRight().x * s * 0.62, z: p1.z + camRight().z * s * 0.62 }; collide(p2);
    setPose(pinky, 'stand', 8); pinky.walkSpeed = 1.05; pinky.earPerk = -0.4; await walkTo(tok, p2.x, p2.z); pinky.walkSpeed = 0.5; handR.want = null; // 쏙 피한다
    pinky.face = 'cam'; pinky.tgt.yawOff = 0; pinky.earPerk = 0.5; say('흥!', headTop, '', 1.1); snd('sfx', 'snort', { force: 1, why: '흥!' });
    await wait(tok, 0.5); setPose(pinky, 'bow', 5); pinky.tgt.headPitch = -0.25; await wait(tok, 1.0);
    setPose(pinky, 'stand', 5); pinky.tgt.yawOff = 0; await wait(tok, 0.45);
    await ballDrop(tok, toCamDir().multiplyScalar(0.35).add(V3(0, 0.25, 0)));
    sitFront(6); await wait(tok, 0.5); ask('간식 주면 줄게!'); await wait(tok, 2.4);
  } else if (mood === 'chew') { // 엎드려서 혼자 잘근잘근
    await wait(tok, 0.3); setPose(pinky, 'down', 4); pinky.tgt.yawOff = -0.3; pinky.wagAmpT = 0.5; pinky.wagSpeedT = 8;
    await wait(tok, 1.0);
    toy.tok = tok; toy.chewKind = 'rope'; toy.chewRate = 7.5; toy.chew = 1; say('내 꺼야 ♪', headTop, 'soft', 1.6);
    await wait(tok, 1.7); sideSay('잘근잘근', 0, '', 1.3); await wait(tok, 1.7);
    toy.chew = 0; toy.rest = 0.12; pinky.eyeOpen = 1; await wait(tok, 0.4);
    ask('간식이랑 바꿀래?'); await wait(tok, 2.2);
    await ballDrop(tok, V3(Math.sin(pinky.yaw) * 0.25, 0.12, Math.cos(pinky.yaw) * 0.25)); toyOff();
    await wait(tok, 0.5);
  } else { // 반만 가져와서 툭 내려놓고 쳐다본다
    pinky.tgt.yawOff = 0; await wait(tok, 0.5);
    await ballDrop(tok, toCamDir().multiplyScalar(0.3).add(V3(0, 0.3, 0)));
    pinky.lookFn = () => ball.g.position; await wait(tok, 0.8);
    pinky.lookFn = null; sitFront(6); await wait(tok, 0.6);
    ask('간식 주면… 마저 갈게'); await wait(tok, 1.5);
    pinky.lookFn = () => ball.g.position; await wait(tok, 0.7); pinky.lookFn = null; await wait(tok, 0.9);
  }
  pinky.tiltT = 0; pinky.earPerk = 0;
}
// 간식을 받고 나면: "이제 줄게!" 하고 두고 온 공을 물어다 발치에 놓는다
async function payBall(tok) {
  brain.payDue = false; brain.owe = false; brain.refusals = 0;
  if (!ballOnFloor()) return;
  mark('ball:pay');
  tok.cleanups.push(() => { if (ball.state === 'mouth') ballToWorld(); });
  setPose(pinky, 'stand', 6); pinky.lookFn = () => ball.g.position; pinky.earPerk = 1; pinky.wagAmpT = 0.85; pinky.wagSpeedT = 17;
  say('이제 줄게!', headTop, '', 1.6); await wait(tok, 0.8);
  await ballChase(tok, 0.95, 9);
  await ballGive(tok, '자, 여기!'); heart();
  pinky.earPerk = 0; pinky.wagAmpT = 0.45; pinky.wagSpeedT = 9;
}
function brainFed(name) { // 간식이나 밥을 받아먹었다 (명령이 5초 넘게 이어졌을 때)
  brain.throws = 0; brain.refusals = 0; brain.fedAt = clock; brain.begs = 0;
  if (name === 'treat') { brain.lastTreat = clock; brain.treats++; brain.d.hunger = Math.max(0, brain.d.hunger - 0.15); } else brain.d.hunger = Math.min(brain.d.hunger, 0.1);
  brain.d.attach = Math.max(0, brain.d.attach - 0.2);
  if (brain.owe) brain.payDue = true;
}
function brainStart(name, tok) { // 명령이 시작될 때
  tok.t0 = clock;
  if (name === 'roam' || name === 'hold') return;
  brain.lastInput = clock;
  if (brain.entryAt) { brain.entryAt = 0; tok.far = Math.hypot(pinky.x - HOME.x, pinky.z - HOME.z) > 0.5; momQuick(); } // 달려오기도 전에 불렸다: 알아보기만 하고 시킨 것부터
  if (RP === ROOM_NAMSAN && name !== 'touch' && nsInWater(pinky.x, pinky.z)) tok.far = true; // 푸푸가 냇물 속에 있으면 앉기 · 엎드리기 · 뒹굴기 전에 물 밖으로 나온다
  if (name === 'treat' || name === 'feed') wait(tok, 5).then(() => brainFed(name), () => {});
  if (name === 'play') { brain.payDue = false; }
}
function brainDone(name) { // 명령이 끝까지 갔을 때. true를 돌려주면 이어서 할 일을 시작했다는 뜻
  const d = brain.d;
  if (name === 'play') { d.play = Math.max(0, d.play - 0.4); d.rest = Math.min(1, d.rest + 0.12); d.attach = Math.max(0, d.attach - 0.2); }
  if (name === 'pet' || name === 'touch' || name === 'hug') d.attach = Math.max(0, d.attach - 0.5);
  if ((name === 'treat' || name === 'feed') && brain.payDue && ballOnFloor()) { startSpecial('pay', payBall); return true; }
  return false;
}
// 앉아! 를 한 번 못 들은 척 (가끔만) — 딴청을 부리다가 한숨 쉬고 앉는다
const deafOK = (tok) => clock - tok.t0 < 0.5 && pinky.tgt.name !== 'sit' && (brain.force.deaf ?? (sitCount > 0 && cdOK('deaf', BRAIN.deafCd) && Math.random() < BRAIN.deafP));
async function playDeaf(tok) {
  brain.cd.deaf = clock; mark('deaf'); lastSit = 'side'; // 딴청 뒤에는 마주 보고 앉는다
  const s = sideSign, side = () => V3(pinky.x, 0.25, pinky.z).addScaledVector(camRight(), s * 1.6).addScaledVector(toCamDir(), 0.4);
  pinky.lookFn = side; pinky.earPerk = -0.5; pinky.wagAmpT = 0.12; pinky.wagSpeedT = 4;
  await wait(tok, 0.9); bubble('…', headTop, 'small', 1.0);
  await wait(tok, 0.8); say('안 들려~', headTop, 'soft', 1.3);
  await wait(tok, 1.0); pinky.lookFn = null; pinky.tiltT = 0.15; // 슬쩍 눈치를 본다
  await wait(tok, 0.55); pinky.tiltT = 0; say('후우… 알았어', headTop, 'soft', 1.5);
  await wait(tok, 0.6); pinky.earPerk = 0;
}

function stepBrain(dt) {
  if (mode !== 'room') return;
  const d = brain.d, asleep = pinky.tgt.name === 'curl' && pinky.eyeOpen < 0.3;
  d.hunger = clamp(d.hunger + dt / 300, 0, 0.9); d.attach = clamp(d.attach + dt / (asleep ? 500 : 240), 0, 1);
  d.play = clamp(d.play + (asleep ? -dt / 400 : dt / 260), 0, 0.9); d.rest = clamp(d.rest + (asleep ? -dt / 38 : dt / 210), 0, 1);
  stepDrops(dt);
  const awake = ['stand', 'sit', 'down'].includes(pinky.tgt.name) && pinky.curlK < 0.05, free = idleNow() && active && awake && pinky.sniff === 0;
  if (brain.heard) { // 톡! 소리가 난 쪽으로 귀를 쫑긋, 고개를 돌린다
    const hd = brain.heard;
    if (!hd.on) { hd.on = true; if (free) { hd.fn = () => hd.p; pinky.lookFn = hd.fn; pinky.earPerk = 0.9; mark('heard'); } }
    if (clock > hd.until) { if (hd.fn && pinky.lookFn === hd.fn) { pinky.lookFn = null; pinky.earPerk = 0; } brain.heard = null; }
  }
  if (drag && drag.moved > 90 && cdOK('watch', 40) && free && !pinky.walkTarget) { brain.cd.watch = clock; pinky.lookFn = null; pinky.tiltT = 0.3; pinky.earPerk = 0.8; bubble('?', headTop, 'small', 1.0); brain.tiltEnd = clock + 1.3; mark('watch'); } // 엄마가 두리번거리면: 뭐 봐? 하고 갸웃
  if (brain.tiltEnd && clock > brain.tiltEnd) { brain.tiltEnd = 0; if (idleNow()) { pinky.tiltT = 0; pinky.earPerk = 0; } }
  if (brain.entryAt && clock >= brain.entryAt && !transitioning) { brain.entryAt = 0; if (!active) startSpecial('mom', (tok) => momGreet(tok, 'entry')); }
  if (brain.poke && clock >= brain.poke.at) momCheck();
  if (brain.thumpEnd && clock > brain.thumpEnd) { brain.thumpEnd = 0; if (pinky.tgt.name === 'curl') { pinky.wagAmpT = 0.03; pinky.wagSpeedT = 4; } }
  if (clock > brain.hideAt) { if (!drops.length && idleNow()) hideTreat(); else brain.hideAt = clock + 20; }
}
function brainEnter() { // 방에 들어설 때: 저쪽에서 냄새를 맡고 있다가 알아보고 달려온다
  brainReset();
  const E = RP.entry || [[0.85, -0.5, 1.75, -1.15], [-0.35, -0.45, -1.3, -0.9], [0.3, -0.65, 0.2, -1.6]], [x, z, fx, fz] = E[Math.floor(Math.random() * E.length)];
  Object.assign(pinky, { x, z, yaw: Math.atan2(fx - x, fz - z), face: { x: fx, z: fz }, sniff: 0.5, wagAmpT: 0.35, wagSpeedT: 7 });
  pinky.tgt.gaze = pinky.cur.gaze = 0; pinky.tgt.headPitch = pinky.cur.headPitch = 0.6;
  brain.entryAt = clock + 1.2;
  if (pinky.dami) damiEnter();
  if (pinky === PUPU) pupuEnter();
}
// 한참 조용하다가 다시 만질 때 · 다른 창에 갔다가 돌아올 때
document.addEventListener('pointerdown', (e) => { if (mode !== 'room') return; const q = clock - brain.lastInput; brain.lastInput = clock; if (q > BRAIN.quiet) brainPoke('quiet', e.target === canvas); }, true);
document.addEventListener('keydown', () => { if (mode === 'room') brain.lastInput = clock; }, true);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { brain.hiddenAt = Date.now(); return; }
  if (mode === 'room' && brain.hiddenAt && Date.now() - brain.hiddenAt > BRAIN.away * 1000) { brain.lastInput = clock; brainPoke('tab', true, 0.8); }
  brain.hiddenAt = 0;
});
brainReset();

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
// 담이의 동네 놀이터 — 해 질 녘 모래밭과 마른 잔디 · 미끄럼틀 · 그네 · 정글짐 · 스프링 놀이기구 · 벤치 · 나무 · 낮은 울타리 · 멀리 아파트
// 처음 들어갈 때 한 번만 짓는다 (핑키만 보러 오는 사람에게는 짓지 않는다). 보는 사람은 +z 쪽 모래밭 끝에 서서 -z를 본다
// ================================================================
const PARK = {
  sand: [-4.0, 4.0, -5.0, 4.6, 1.1], // 모래밭(둥근 네모): x0, x1, z0, z1, 모서리 반지름 — 보는 사람 발밑까지 모래 (세로 화면 아래에 시멘트 테두리 띠가 걸리지 않게)
  slide: [-2.15, -3.75], swing: [2.3, -4.0], climb: [-3.2, -1.25], bench: [2.95, -0.15], // 벤치는 화면 오른쪽 끝에 걸치게 (냄새 맡으러 가도 보이게)
  riders: [[2.2, -2.4, -0.6, 0xeab640, 'duck'], [3.15, -1.8, -1.0, 0x74aacb, 'pony']], // 스프링 놀이기구: x, z, 방향, 색, 모양
  trees: [[-4.9, -5.8, 'gy', 1.0], [4.6, -7.2, 'zk', 1.15], [-5.8, -1.7, 'pn', 0.95], [7.4, -5.0, 'gy', 0.9], [0.9, -7.6, 'zk', 1.3], [-2.4, -8.2, 'pn', 1.1], [6.6, 5.2, 'zk', 1.0], [-5.7, 2.4, 'gy', 1.0], [-7.5, -9.5, 'zk', 1.4], [3.2, -11, 'gy', 1.25]], // 해 쪽(오른쪽)에는 나무를 멀리: 모래밭 가운데가 그늘지지 않게
  sun: V3(6, 2.4, -2.6).normalize(), // 해 쪽 (낮게 · 오른쪽 뒤): 그림자가 보는 사람 왼쪽 앞으로 길게 눕는다
};
const slideY = (u) => 0.3 + 0.9 * (1 - ss(0, 0.85, u)); // 미끄럼 바닥 높이 (u: 0 = 탑 위 … 1 = 끝)
const inSand = (x, z) => { const [x0, x1, z0, z1, r] = PARK.sand, dx = Math.max(x0 + r - x, 0, x - (x1 - r)), dz = Math.max(z0 + r - z, 0, z - (z1 - r)); return Math.hypot(dx, dz) < r; };
let parkG = null, DAMI = null;
// 같은 재질끼리 한 메시로 합친다 (놀이터 소품이 많아도 그리기 호출은 적게). flat: 면마다 꺾인 그늘(나뭇잎 · 지붕)
function batcher() {
  const by = new Map(), o = new THREE.Object3D();
  const push = (mat, geo, m, flat) => { const g = geo.index ? geo.toNonIndexed() : geo.clone(); g.applyMatrix4(m); if (flat) g.computeVertexNormals(); if (!by.has(mat)) by.set(mat, []); by.get(mat).push(g); };
  return {
    put(mat, geo, p, r, s, flat = false) {
      o.position.set(p[0], p[1], p[2]); o.rotation.set(r ? r[0] : 0, r ? r[1] : 0, r ? r[2] : 0);
      if (s == null) o.scale.set(1, 1, 1); else if (typeof s === 'number') o.scale.setScalar(s); else o.scale.set(s[0], s[1], s[2]);
      o.updateMatrix(); push(mat, geo, o.matrix, flat);
    },
    putM: push,
    flush(parent, cast = true) {
      for (const [mat, gs] of by) {
        const out = new THREE.BufferGeometry();
        for (const [a, n] of [['position', 3], ['normal', 3], ['uv', 2]]) {
          const arr = new Float32Array(gs.reduce((s, g) => s + g.attributes.position.count * n, 0)); let k = 0;
          for (const g of gs) { if (g.attributes[a]) arr.set(g.attributes[a].array, k); k += g.attributes.position.count * n; }
          out.setAttribute(a, new THREE.BufferAttribute(arr, n));
        }
        out.computeBoundingSphere(); gs.forEach((g) => g.dispose());
        const m = new THREE.Mesh(out, mat); m.castShadow = cast; m.receiveShadow = true; parent.add(m);
      }
      by.clear();
    },
  };
}
const _ucyl = {}, _bq = new THREE.Quaternion(), _bm = new THREE.Matrix4(), _bd = V3(), _bc = V3(), _bs = V3();
function bar(B, mat, a, b, r, seg = 8) { // 두 점을 잇는 둥근 막대
  _bd.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]); const L = _bd.length();
  _bq.setFromUnitVectors(_yAx, _bd.normalize());
  B.putM(mat, _ucyl[seg] || (_ucyl[seg] = new THREE.CylinderGeometry(1, 1, 1, seg, 1)), _bm.compose(_bc.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), _bq, _bs.set(r, L, r)));
}
const rrect = (s, x0, x1, y0, y1, r) => { s.moveTo(x0 + r, y0); s.lineTo(x1 - r, y0); s.absarc(x1 - r, y0 + r, r, -Math.PI / 2, 0); s.lineTo(x1, y1 - r); s.absarc(x1 - r, y1 - r, r, 0, Math.PI / 2); s.lineTo(x0 + r, y1); s.absarc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI); s.lineTo(x0, y0 + r); s.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5); return s; };
const parkSeats = [];
function buildPark() {
  const G = parkG = new THREE.Group(); G.visible = false; roomScene.add(G);
  const R = rng(5), B = batcher(), [sx0, sx1, sz0, sz1, sr] = PARK.sand;
  // ---------- 하늘: 지평선은 살구빛, 위로 갈수록 옅은 하늘색 · 해 쪽 지평선은 더 노랗고 밝다
  const cA = new THREE.Color(0xffd9a6), cB = new THREE.Color(0xd2d6d6), cC = new THREE.Color(0x92b2d2), cS = new THREE.Color(0xfff0c8), cLow = new THREE.Color(0xf3cf9f);
  {
    const sky = new THREE.SphereGeometry(34, 32, 16), p = sky.attributes.position, col = [], c = new THREE.Color(), v = V3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).normalize(); const h = Math.max(0, v.y);
      c.copy(cA).lerp(cB, ss(0.02, 0.3, h)).lerp(cC, ss(0.3, 0.85, h)); if (v.y < 0) c.copy(cLow);
      c.lerp(cS, 0.7 * Math.max(0, v.dot(PARK.sun)) ** 5 * (1 - ss(0.05, 0.45, h)));
      col.push(c.r, c.g, c.b);
    }
    sky.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const m = new THREE.Mesh(sky, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })); m.renderOrder = -1; G.add(m);
    const sg = glow(G, 0xffdcaa, 10, PARK.sun.clone().multiplyScalar(30).toArray(), 0.6); sg.material.fog = false;
  }
  // ---------- 바닥: 마른 잔디(넓게) + 모래밭(발자국) + 낮은 시멘트 테두리
  const grassTex = canvasTex(512, 512, (x, w) => {
    const r = rng(9);
    x.fillStyle = '#a49b60'; x.fillRect(0, 0, w, w);
    for (let i = 0; i < 70; i++) { const cx = r() * w, cy = r() * w, rad = 20 + r() * 70, g = x.createRadialGradient(cx, cy, 0, cx, cy, rad), c = ['118,126,64', '182,164,102', '140,120,84', '104,118,58'][Math.floor(r() * 4)]; g.addColorStop(0, `rgba(${c},0.5)`); g.addColorStop(1, `rgba(${c},0)`); x.fillStyle = g; x.fillRect(cx - rad, cy - rad, rad * 2, rad * 2); }
    for (let i = 0; i < 7000; i++) { const px = r() * w, py = r() * w, l = 3 + r() * 7, a = -Math.PI / 2 + (r() - 0.5) * 1.3, c = r(); x.strokeStyle = c < 0.4 ? `rgba(200,186,124,${0.35 + r() * 0.4})` : c < 0.75 ? `rgba(122,118,64,${0.3 + r() * 0.4})` : `rgba(90,104,50,${0.3 + r() * 0.4})`; x.lineWidth = 1; x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke(); }
  }, [28, 28]);
  add(G, new THREE.PlaneGeometry(70, 70), M(0xffffff, { map: grassTex, roughness: 1 }), [0, 0, -8], [-Math.PI / 2, 0, 0], null, false);
  const sandTex = canvasTex(1024, 1024, (x, w) => { // 4 m 한 장 · 이음매 없이 (가장자리에 걸친 얼룩은 반대편에도 그린다)
    const r = rng(13);
    x.fillStyle = '#ddc6a0'; x.fillRect(0, 0, w, w);
    for (let i = 0; i < 110; i++) { const cx = r() * w, cy = r() * w, rad = 30 + r() * 120, c = r() < 0.55 ? '247,229,192' : '176,144,104', a = 0.25 + r() * 0.2; for (const ox of [-w, 0, w]) for (const oy of [-w, 0, w]) { const X = cx + ox, Y = cy + oy; if (X + rad < 0 || X - rad > w || Y + rad < 0 || Y - rad > w) continue; const g = x.createRadialGradient(X, Y, 0, X, Y, rad); g.addColorStop(0, `rgba(${c},${a})`); g.addColorStop(1, `rgba(${c},0)`); x.fillStyle = g; x.fillRect(X - rad, Y - rad, rad * 2, rad * 2); } }
    for (let i = 0; i < 46000; i++) { x.fillStyle = r() < 0.5 ? `rgba(118,98,76,${0.12 + r() * 0.25})` : `rgba(255,250,236,${0.15 + r() * 0.3})`; x.fillRect(r() * w, r() * w, r() < 0.15 ? 2 : 1, 1); }
    // 발자국 (강아지 · 사람): 움푹한 곳은 어둡고, 해 쪽 가장자리는 밝다
    const dent = (cx, cy, rx, ry, a, k = 1) => { x.save(); x.translate(cx, cy); x.rotate(a); x.fillStyle = `rgba(112,92,70,${0.3 * k})`; x.beginPath(); x.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); x.fill(); x.fillStyle = `rgba(255,247,228,${0.32 * k})`; x.beginPath(); x.ellipse(rx * 0.35, 0, rx * 0.55, ry * 0.8, 0, 0, Math.PI * 2); x.fill(); x.restore(); };
    for (let t = 0; t < 16; t++) { // 강아지 발자국이 줄지어 지나간 자리
      let px = 60 + r() * 900, py = 60 + r() * 900, a = r() * Math.PI * 2;
      for (let k = 0; k < 10 && px > 24 && px < w - 24 && py > 24 && py < w - 24; k++) {
        const side = k % 2 ? 1 : -1, ox = px + Math.cos(a) * side * 6, oy = py + Math.sin(a) * side * 6, c = Math.cos(a), s = Math.sin(a);
        dent(ox, oy, 4.6, 4, a); for (const [tx, ty] of [[-4.5, -6.5], [-1.6, -8.6], [1.6, -8.6], [4.5, -6.5]]) dent(ox + tx * c - ty * s, oy + tx * s + ty * c, 1.9, 2.3, a);
        px -= s * 20; py += c * 20; a += (r() - 0.5) * 0.4;
      }
    }
    for (let t = 0; t < 4; t++) { const px = 120 + r() * 700, py = 120 + r() * 700, a = r() * Math.PI * 2; for (let k = 0; k < 4; k++) dent(px + Math.cos(a) * (k % 2 ? 14 : -14) - Math.sin(a) * k * 60, py + Math.sin(a) * (k % 2 ? 14 : -14) + Math.cos(a) * k * 60, 9, 23, a, 0.35); }
  }, [0.25, 0.25]);
  add(G, new THREE.ShapeGeometry(rrect(new THREE.Shape(), sx0, sx1, -sz1, -sz0, sr), 12), M(0xffffff, { map: sandTex, roughness: 1 }), [0, 0.004, 0], [-Math.PI / 2, 0, 0], null, false);
  {
    const s = rrect(new THREE.Shape(), sx0 - 0.15, sx1 + 0.15, -sz1 - 0.15, -sz0 + 0.15, sr + 0.15); s.holes.push(rrect(new THREE.Path(), sx0, sx1, -sz1, -sz0, sr));
    add(G, new THREE.ExtrudeGeometry(s, { depth: 0.035, bevelEnabled: false, curveSegments: 10 }), M(0xa79e8f, { roughness: 0.95 }), [0, 0, 0], [-Math.PI / 2, 0, 0], null, false);
  }
  // ---------- 놀이기구 (빛바랜 페인트 색)
  const teal = M(0x3f8a84, { roughness: 0.5, metalness: 0.15 }), red = M(0xc4583f, { roughness: 0.55 }), yel = M(0xe7b444, { roughness: 0.45, metalness: 0.1 }), blue = M(0x3f6ea6, { roughness: 0.5, metalness: 0.15 });
  const roof = M(0xcc5c40, { roughness: 0.6 }), chainM = M(0xa29d96, { roughness: 0.35, metalness: 0.7 }), rubber = M(0x5e2a24, { roughness: 0.85 }), iron = M(0x3a3632, { roughness: 0.45, metalness: 0.5 }), grey = M(0x9b968e, { roughness: 0.8 });
  const OB = []; // 장애물 (x, z, r, 공이 넘는 높이 h)
  { // 미끄럼틀: 기둥 넷 · 발판 · 지붕 · 왼쪽 사다리 · 오른쪽(+x)으로 내려오는 노란 미끄럼
    const [cx, cz] = PARK.slide, dy = 1.15, e = 0.48;
    for (const a of [-1, 1]) for (const b of [-1, 1]) bar(B, teal, [cx + a * e, 0, cz + b * e], [cx + a * e, 2.42, cz + b * e], 0.045, 10);
    B.put(red, box(1.04, 0.07, 1.04), [cx, dy, cz]);
    for (const y of [1.48, 1.82]) {
      bar(B, teal, [cx - e, y, cz - e], [cx + e, y, cz - e], 0.022);
      for (const sx of [-1, 1]) { bar(B, teal, [cx + sx * e, y, cz - e], [cx + sx * e, y, cz - 0.27], 0.022); bar(B, teal, [cx + sx * e, y, cz + 0.27], [cx + sx * e, y, cz + e], 0.022); }
    }
    B.put(yel, box(0.92, 0.5, 0.035), [cx, dy + 0.33, cz + e]);
    B.put(roof, new THREE.ConeGeometry(0.88, 0.52, 4, 1), [cx, 2.68, cz], [0, Math.PI / 4, 0], null, true);
    for (const sz of [-0.21, 0.21]) bar(B, teal, [cx - 1.02, 0, cz + sz], [cx - e, dy + 0.35, cz + sz], 0.025);
    for (let k = 1; k <= 4; k++) { const t = k / 5, x = lerp(cx - 1.02, cx - e, t), y = lerp(0, dy + 0.35, t); bar(B, yel, [x, y, cz - 0.21], [x, y, cz + 0.21], 0.018, 6); }
    const x0 = cx + e, x1 = cx + 2.75, N = 26, prof = [[-0.26, 0.17], [-0.26, 0.02], [-0.21, -0.025], [-0.12, -0.045], [0, -0.05], [0.12, -0.045], [0.21, -0.025], [0.26, 0.02], [0.26, 0.17]];
    const pos = [], idx = [], np = prof.length;
    for (let i = 0; i <= N; i++) { const u = i / N, x = lerp(x0, x1, u), y = slideY(u); for (const [pz, py] of prof) pos.push(x, y + py, cz + pz); }
    for (let i = 0; i < N; i++) for (let j = 0; j < np - 1; j++) { const a = i * np + j, b = a + np; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); cg.setIndex(idx); cg.computeVertexNormals();
    add(G, cg, M(0xf0b43c, { roughness: 0.32, side: THREE.DoubleSide }), [0, 0, 0]);
    for (const u of [0.42, 0.9]) bar(B, teal, [lerp(x0, x1, u), 0, cz], [lerp(x0, x1, u), slideY(u) - 0.05, cz], 0.035);
    OB.push({ x: cx, z: cz, r: 0.72, h: 2.5 }, { x: cx - 0.85, z: cz, r: 0.3, h: 1.2 });
    for (const u of [0.18, 0.4, 0.62, 0.84, 1]) OB.push({ x: lerp(x0, x1, u), z: cz, r: 0.3, h: slideY(u) + 0.15 });
  }
  { // 그네: 파란 A자 기둥 · 노란 가로대 · 고무 의자 둘 (바람에 살랑)
    const [sx, sz] = PARK.swing, top = 2.15, hw = 1.15;
    for (const a of [-1, 1]) for (const b of [-1, 1]) { bar(B, blue, [sx + a * hw, top, sz], [sx + a * hw, 0, sz + b * 0.62], 0.045, 10); OB.push({ x: sx + a * hw, z: sz + b * 0.58, r: 0.12, h: 2.2 }); }
    bar(B, yel, [sx - hw - 0.1, top, sz], [sx + hw + 0.1, top, sz], 0.055, 12);
    for (const k of [-1, 1]) {
      const g = new THREE.Group(); g.position.set(sx + k * 0.5, top - 0.03, sz); g.userData.ph = k * 1.7; G.add(g); parkSeats.push(g);
      const SB = batcher(); for (const c of [-1, 1]) bar(SB, chainM, [c * 0.21, 0, 0], [c * 0.21, -1.66, 0], 0.008, 5);
      SB.put(rubber, box(0.46, 0.035, 0.2), [0, -1.68, 0]); SB.flush(g);
      OB.push({ x: sx + k * 0.5, z: sz, r: 0.32, h: 0.5 });
    }
  }
  { // 정글짐: 빨강 세로대 · 노랑 · 파랑 가로대
    const [kx, kz] = PARK.climb, c = 0.42, n = 3, o = (n * c) / 2, vm = M(0xc9503c, { roughness: 0.5, metalness: 0.15 });
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) bar(B, vm, [kx - o + i * c, 0, kz - o + j * c], [kx - o + i * c, n * c, kz - o + j * c], 0.022, 6);
    for (let l = 1; l <= n; l++) for (let j = 0; j <= n; j++) { bar(B, yel, [kx - o, l * c, kz - o + j * c], [kx + o, l * c, kz - o + j * c], 0.02, 6); bar(B, blue, [kx - o + j * c, l * c, kz - o], [kx - o + j * c, l * c, kz + o], 0.02, 6); }
    OB.push({ x: kx, z: kz, r: 0.9, h: 1.3 });
  }
  for (const [rx, rz, ra, col, kind] of PARK.riders) { // 스프링 놀이기구 (오리 · 조랑말)
    const g = new THREE.Group(); g.position.set(rx, 0, rz); g.rotation.y = ra; G.add(g);
    const RB = batcher(), bm = M(col, { roughness: 0.38 }), dark = M(0x2b2826, { roughness: 0.4 }), seat = M(0xb8483a, { roughness: 0.6 });
    RB.put(grey, cyl(0.2, 0.23, 0.04, 20), [0, 0.02, 0]);
    const pts = []; for (let i = 0; i <= 72; i++) { const a = (i / 72) * Math.PI * 9; pts.push(V3(Math.cos(a) * 0.075, 0.04 + 0.34 * (i / 72), Math.sin(a) * 0.075)); }
    RB.put(dark, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 144, 0.014, 6), [0, 0, 0]);
    RB.put(bm, new THREE.CapsuleGeometry(0.14, 0.22, 6, 14), [0, 0.53, -0.02], [Math.PI / 2, 0, 0]);
    RB.put(seat, box(0.2, 0.03, 0.2), [0, 0.68, -0.06]);
    bar(RB, iron, [-0.13, 0.82, 0.13], [0.13, 0.82, 0.13], 0.014, 6); bar(RB, iron, [-0.15, 0.4, 0.06], [0.15, 0.4, 0.06], 0.014, 6);
    if (kind === 'duck') {
      RB.put(bm, SPH, [0, 0.8, 0.2], null, 0.12); RB.put(M(0xe8803a, { roughness: 0.45 }), new THREE.ConeGeometry(0.045, 0.12, 12), [0, 0.78, 0.35], [Math.PI / 2, 0, 0]);
      RB.put(bm, new THREE.ConeGeometry(0.07, 0.16, 12), [0, 0.68, -0.27], [-1.0, 0, 0]);
      for (const s of [-1, 1]) RB.put(dark, SPH, [s * 0.07, 0.84, 0.29], null, 0.016);
    } else {
      RB.put(bm, SPH, [0, 0.84, 0.22], [0.5, 0, 0], [0.09, 0.1, 0.16]); RB.put(bm, SPH, [0, 0.79, 0.34], null, [0.07, 0.065, 0.075]);
      for (const s of [-1, 1]) { RB.put(bm, new THREE.ConeGeometry(0.03, 0.08, 10), [s * 0.05, 0.95, 0.16], [-0.3, 0, s * 0.3]); RB.put(dark, SPH, [s * 0.075, 0.87, 0.27], null, 0.014); }
      RB.put(M(0x5a3b2a, { roughness: 0.8 }), new THREE.ConeGeometry(0.05, 0.22, 10), [0, 0.5, -0.3], [-2.4, 0, 0]);
    }
    RB.flush(g);
    OB.push({ x: rx, z: rz, r: 0.33, h: 0.95 });
  }
  { // 벤치: 놀이터 쪽(-x)을 보고 앉는 나무 벤치 · 검은 주물 다리
    const [bx, bz] = PARK.bench, wood = M(0xb27c4c, { roughness: 0.72 });
    for (let i = 0; i < 4; i++) B.put(wood, box(0.085, 0.03, 1.5), [bx - 0.16 + i * 0.1, 0.44, bz]);
    for (let i = 0; i < 3; i++) B.put(wood, box(0.03, 0.085, 1.5), [bx + 0.21 + i * 0.022, 0.58 + i * 0.11, bz], [0, 0, -0.2]);
    for (const e of [-0.62, 0.62]) { B.put(iron, box(0.42, 0.04, 0.05), [bx + 0.02, 0.41, bz + e]); bar(B, iron, [bx - 0.17, 0, bz + e], [bx - 0.15, 0.42, bz + e], 0.025, 6); bar(B, iron, [bx + 0.2, 0, bz + e], [bx + 0.27, 0.9, bz + e], 0.025, 6); }
    OB.push({ x: bx + 0.02, z: bz - 0.42, r: 0.4, h: 0.5 }, { x: bx + 0.02, z: bz + 0.42, r: 0.4, h: 0.5 });
  }
  { // 가로등 (아직 꺼져 있다)
    bar(B, iron, [-4.6, 0, 1.3], [-4.6, 3.3, 1.3], 0.05, 10); B.put(iron, box(0.36, 0.1, 0.2), [-4.45, 3.32, 1.3]); B.put(M(0xf3ead6, { roughness: 0.4 }), box(0.3, 0.02, 0.15), [-4.45, 3.265, 1.3]);
  }
  // ---------- 나무 (은행나무 노랑 · 느티나무 주황 · 소나무) · 낮은 울타리와 산울타리 · 떨어진 잎
  const trunk = M(0x5c4433, { roughness: 0.9 }), leaf = { gy: M(0xd9ad3a, { roughness: 0.85 }), zk: M(0xbe7a3c, { roughness: 0.85 }), pn: M(0x4e6a3d, { roughness: 0.9 }) }, ico = new THREE.IcosahedronGeometry(1, 1);
  const trees = LITE ? PARK.trees.filter((q, i) => i % 4 !== 3) : PARK.trees;
  for (const [tx, tz, kind, s] of trees) {
    const h = (kind === 'pn' ? 1.4 : 2.2) * s;
    bar(B, trunk, [tx, 0, tz], [tx + (R() - 0.5) * 0.2, h + 0.4 * s, tz], 0.13 * s, 8);
    if (kind === 'pn') for (let k = 0; k < 3; k++) B.put(leaf.pn, new THREE.ConeGeometry(1.05 * s * (1 - k * 0.24), 1.3 * s, 9), [tx, h + 0.2 * s + k * 0.75 * s, tz], [0, R() * 3, 0], null, true);
    else for (let k = 0; k < 7; k++) { const a = R() * Math.PI * 2, rr = 0.6 * s * R(), up = kind === 'gy' ? 1.3 : 0.8; B.put(leaf[kind], ico, [tx + Math.cos(a) * rr, h + 0.5 * s + R() * up * s, tz + Math.sin(a) * rr], [R() * 3, R() * 3, R() * 3], [(0.75 + R() * 0.4) * s, (0.65 + R() * 0.35) * s * (kind === 'gy' ? 1.25 : 0.9), (0.75 + R() * 0.4) * s], true); }
  }
  const hedge = M(0x5a703c, { roughness: 0.95 }), step = LITE ? 0.8 : 0.55;
  const hedgeLine = (ax, az, bx, bz) => { const n = Math.ceil(Math.hypot(bx - ax, bz - az) / step); for (let i = 0; i <= n; i++) { const t = i / n; B.put(hedge, ico, [lerp(ax, bx, t) + (R() - 0.5) * 0.1, 0.3 + R() * 0.08, lerp(az, bz, t) + (R() - 0.5) * 0.1], [R() * 3, R() * 3, R() * 3], [0.42 + R() * 0.12, 0.36 + R() * 0.1, 0.42 + R() * 0.12], true); } };
  hedgeLine(-6.8, -6.95, 6.8, -6.95); hedgeLine(-6.8, -6.5, -6.8, 3.6); // 뒤쪽 산울타리는 울타리에서 조금 떨어뜨린다 (그 사이 길로 동네 친구가 지나간다) hedgeLine(6.8, -6.5, 6.8, 3.6);
  const fence = M(0x4f6b5c, { roughness: 0.55, metalness: 0.2 });
  for (let x = -6.2; x <= 6.21; x += 1.0) bar(B, fence, [x, 0, -5.95], [x, 0.62, -5.95], 0.022, 6);
  for (const y of [0.25, 0.55]) bar(B, fence, [-6.2, y, -5.95], [6.2, y, -5.95], 0.016, 6);
  // ---------- 둘레 동네: 2~3층 빌라들 (벽돌 · 베이지 · 회색, 옥상 물탱크) + 양옆 멀리 아파트 (해를 받아 따뜻하게 · 안개에 흐리게)
  const villaTex = canvasTex(256, 256, (x, w, h) => {
    const r = rng(17), rows = 3, cols = 4, cw = w / cols, rh = h / rows;
    x.fillStyle = '#f4efe6'; x.fillRect(0, 0, w, h);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { x.fillStyle = r() < 0.15 ? '#f3d8a4' : '#7f8c97'; x.fillRect(i * cw + cw * 0.18, j * rh + rh * 0.3, cw * 0.64, rh * 0.42); x.fillStyle = 'rgba(80,70,60,0.35)'; x.fillRect(i * cw + cw * 0.14, j * rh + rh * 0.72, cw * 0.72, 3); }
    x.fillStyle = 'rgba(90,80,70,0.35)'; x.fillRect(0, 0, w, 6);
  });
  for (const [col, list] of [[0xc98f72, [[-15, -28, 9, 6, 8, 0.25], [16, -27, 8, 6.5, 8, -0.3]]], [0xe3d3b8, [[-24, -21, 9, 5.5, 8, 0.6], [24, -20, 9, 5, 8, -0.6]]], [0xc9c6c0, [[-11, -33, 6, 4.5, 6, 0.1], [12, -32, 7, 5, 6, -0.1]]]]) { // 가운데 뒤는 비워 하늘과 나무가 보이게
    const vm = M(col, { map: villaTex, roughness: 0.95 });
    for (const [ax, az, aw, ah, ad, ry] of list) { B.put(vm, box(aw, ah, ad), [ax, ah / 2, az], [0, ry, 0]); B.put(grey, cyl(0.8, 0.8, 1.0, 12), [ax + aw * 0.25, ah + 0.5, az], null, null); }
  }
  const aptTex = canvasTex(256, 512, (x, w, h) => {
    const r = rng(3), cols = 10, rows = 18, cw = w / cols, rh = h / rows;
    x.fillStyle = '#eadfce'; x.fillRect(0, 0, w, h);
    for (let j = 1; j < rows; j++) { x.fillStyle = 'rgba(140,122,104,0.35)'; x.fillRect(0, j * rh + rh * 0.8, w, 3); for (let i = 0; i < cols; i++) { const lit = r() < 0.1; x.fillStyle = lit ? '#f6d59c' : r() < 0.5 ? '#8f9ca7' : '#7e8c99'; x.fillRect(i * cw + cw * 0.14, j * rh + rh * 0.25, cw * 0.72, rh * 0.5); } }
    x.fillStyle = 'rgba(120,100,84,0.3)'; x.fillRect(0, 0, w, rh * 0.6);
  });
  const apt = M(0xffffff, { map: aptTex, roughness: 0.95 });
  for (const [ax, az, aw, ah, ad, ry] of [[29, -19, 10, 17, 8, -0.95], [-29, -17, 10, 15, 8, 0.95], [-30, -2, 9, 14, 8, 1.4]]) B.put(apt, box(aw, ah, ad), [ax, ah / 2, az], [0, ry, 0]);
  B.flush(G);
  if (!LITE) { // 떨어진 잎 (나무 밑에 많이, 모래밭에도 조금)
    const N = 220, im = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.055, 0.04), new THREE.MeshStandardMaterial({ roughness: 0.9, side: THREE.DoubleSide }), N), o = new THREE.Object3D(), c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const T = PARK.trees[Math.floor(R() * PARK.trees.length)], a = R() * 6.283, d = Math.sqrt(R()) * 2.6; let x = T[0] + Math.cos(a) * d, z = T[1] + Math.sin(a) * d;
      if (R() < 0.07) { x = (R() - 0.5) * 7.5; z = -4.6 + R() * 6.4; }
      o.position.set(x, 0.007 + R() * 0.004, z); o.rotation.set(-Math.PI / 2 + (R() - 0.5) * 0.3, 0, R() * 6.283); o.updateMatrix(); im.setMatrixAt(i, o.matrix);
      im.setColorAt(i, c.set(T[2] === 'zk' ? 0xb57440 : 0xcfac4a).multiplyScalar(0.7 + R() * 0.3));
    }
    im.receiveShadow = true; G.add(im);
  }
  // ---------- 빛: 낮은 해(긴 그림자) + 하늘빛
  G.add(new THREE.HemisphereLight(0xeae2d2, 0xa08258, 1.08)); // 하늘빛도 노을빛: 그늘이 잿빛으로 식지 않게
  const sun = new THREE.DirectionalLight(0xffc68a, 3.3);
  sun.target.position.set(0, 0, -1.4); sun.position.copy(PARK.sun).multiplyScalar(20).add(sun.target.position);
  sun.castShadow = true; Object.assign(sun.shadow.camera, { left: -6.8, right: 6.8, top: 4.6, bottom: -4.6, near: 4, far: 40 }); sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.mapSize.set(LITE ? 1024 : 2048, LITE ? 1024 : 2048); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.025;
  G.add(sun, sun.target);
  roomUpd.push((t) => { if (RP === ROOM_PARK) for (const g of parkSeats) g.rotation.x = 0.045 * Math.sin(t * 1.7 + g.userData.ph) + 0.02 * Math.sin(t * 0.63 + g.userData.ph * 2); });
  // ---------- 담이 (이 방의 강아지)
  DAMI = makeDami(); Object.assign(DAMI, { route, routeSee: navSee, collide, speedK: 1.3, bounce: 0.009, talk: damiTalk, cheer: true, cheerT: 0 }); DAMI.root.visible = false; roomScene.add(DAMI.root); fitCurl(DAMI); // speedK: 핑키보다 발걸음이 가볍고 빠르다 · cheer: 혼자 놀 때 자주 혀를 빼고 헥헥
  buildDamiProps(G, OB); // 담이의 간식 · 장난감 · 땅 파기
  { const F = buildDog({ kind: 'jindo', colors: COLORS.friend, scale: 0.95, seed: 23 }); F.root.visible = false; G.add(F.root); DM.friend = { d: F, on: false, stop: 0 }; } // 동네 친구 (울타리 밖 길로 지나간다)
  // ---------- 다니는 길 · 냄새 맡는 곳
  const [cx, cz] = PARK.slide, [bx, bz] = PARK.bench, [wx, wz] = PARK.swing, slideEnd = cx + 2.75;
  Object.assign(ROOM_PARK, {
    built: true, OBST: OB,
    SPOTS: { cushion: SPOTS.cushion, gifts: { x: slideEnd + 0.5, z: cz + 0.2, fx: slideEnd, fz: cz }, table: { x: bx - 0.66, z: bz + 0.05, fx: bx, fz: bz }, window: { x: 0.45, z: -4.55, fx: 0.5, fz: -6.5 } },
    looks: [V3(slideEnd, 0.3, cz), V3(0.6, 0.9, -9), V3(wx - 0.5, 0.45, wz), V3(bx, 0.45, bz), V3(PARK.riders[0][0], 0.6, PARK.riders[0][1]), V3(-4.9, 2.5, -5.8)],
  });
}
const ROOM_PARK = {
  id: 'park', built: false, name: '담이', place: '동네 놀이터', hint: '담이를 만지면 좋아해요 · 화면을 끌어서 둘러보기', navLabel: '담이랑 하기',
  navIn: (x, z) => x >= -4.801 && x <= 4.801 && z >= -4.851 && z <= 2.401,
  clamp(d) { d.x = clamp(d.x, -4.8, 4.8); d.z = clamp(d.z, -4.85, 2.4); },
  ball: [-5.3, 5.3, -5.4, 2.9],
  NAV: { x0: -4.8, z0: -4.85, h: 0.1, nx: 97, nz: 73, pad: 0.15 },
  HOME: { x: 0.1, z: 0.85 }, AIM: V3(0.08, 0.46, 0.62), camPos: (v, a) => v.set(0, a < 0.8 ? 1.48 : 1.22, a < 0.8 ? 3.2 : 3.0), // 세로 화면: 조금 더 가까이 · 내려다보게 (담이가 작아 보이지 않고 하늘이 화면 반을 차지하지 않게)
  BOWL: V3(99, 0.006, 99), EAT: { x: 99, z: 99 }, CUSH: { x: 99, z: 99 }, // 밥그릇 · 방석은 없다 (멀리 치워 둔다: 방석 위로 떠오르거나 공이 튕기는 일이 없게)
  THROW: [[-0.7, -1.3], [1.2, -0.9], [1.1, 0.3], [-1.2, 0.9], [-0.2, -2.0], [0.6, -1.7], [-1.5, -0.4], [1.4, -2.7]],
  HIDE: [[-0.55, 0.45], [0.75, 0.4], [-0.8, 1.0], [0.9, 1.05], [0.45, 0.2], [-0.25, 1.2], [1.15, 0.75], [-1.05, 0.7]],
  WIN: V3(0.6, 0.9, -9), ROPE: { x: -0.95, z: -0.55, yaw: -0.5 },
  entry: [[1.0, -0.9, 1.9, -1.7], [-1.0, -0.7, -1.8, -1.2], [0.3, -1.6, 0.4, -2.6]],
  wander: [-1.5, -1.0, 3.0, 2.2],
  off: { feed: true, cushion: true, paw: true, high5: true, splash: true, poop: true }, actW: { nap: 0, bowl: 0, left: 0, rest: 0.35, window: 0.7 }, noBowl: true, // 놀이터에서는 잠잘 틈 없이 논다 (손 · 하이파이브 · 물장구 · 똥츄는 푸푸만)
  lines: { gifts: ['미끄럼틀 냄새!', '누가 여기 왔었네?', '킁킁, 친구 냄새~'], table: ['벤치 밑에 뭐 있다!', '과자 냄새 났는데!', '여긴 없네~'], window: ['저기 비둘기다!', '바람 좋다~', '친구 오나?'], tableSniff: '뭐 떨어진 거 없나~', mid: ['오리야 안녕!', '여기도 친구 냄새!', '킁킁, 과자 냄새~'] },
  sniffMid: { x: PARK.riders[0][0] - 0.55, z: PARK.riders[0][1] + 0.3, fx: PARK.riders[0][0], fz: PARK.riders[0][1] }, // 냄새 맡기 가운데 들르는 곳: 오리 스프링 놀이기구 옆 (미끄럼틀 끝 → 오리 → 벤치, 멀리 돌지 않게)
  zoom: [[1.4, -0.9], [0.78, 0.18], [-0.48, 0.18], [-1.1, -0.9], [-0.48, -1.98], [0.78, -1.98]], // 우다다: 모래밭 가운데 빈 곳을 크게 도는 길
  acts: (cd, d) => ({ worm: 0.85 * cd('worm', 60), zoom: (0.6 + 1.0 * d.play) * cd('zoom', 75), woof: 0.7 * cd('woof', 30), dig: (2.4 + 0.8 * d.play) * cd('dig', 35), // 혼자 놀 때도 지렁이 댄스 · 우다다 · 컹컹
    attn: (clock - brain.lastInput > 20 ? 2.2 + 1.5 * d.attach : 0.25 + 0.5 * d.attach) * cd('attn', 35 + 20 * Math.min(DM.attnN, 4)) }), // 엄마가 가만히 있으면 와서 조른다 (자꾸 안 봐 주면 조금씩 뜸해진다)
  roamActs: (tok) => ({ worm: () => wormDance(tok, true), zoom: () => zoomies(tok, true), woof: () => damiWoof(tok), attn: () => damiAttn(tok, rot('attnKind', ['paw', 'flop', 'nudge', 'paw'])), dig: () => damiDig(tok, true) }),
  picks: { treat: [['brush', '🪥', '칫솔껌'], ['gator', '🐊', '악어껌']], play: [['ball', '🎾', '공'], ['bottle', '🧴', '패트병'], ['stick', '🪵', '나뭇가지'], ['duck', '🦆', '오둥이']] }, // 담이의 간식 · 장난감
  treat: (tok, kind) => damiTreat(tok, kind), toys: (tok, kind) => damiToy(tok, kind), toyIdle: (tok) => damiToyIdle(tok), post: (d, dt, t) => damiPost(d, dt, t),
  bg: new THREE.Color(0xf3cf9f), fog: new THREE.Fog(0xf0cfa2, 15, 46), env: null,
  sound: { surf: (x, z) => (inSand(x, z) ? 'rug' : 'grass'), cush: [99, 99, 0.3], bowl: [99, 99], tail: { gap: 0.42, gain: -6 }, voice: 'dami', brook: null }, // 모래: 사각사각 부드럽게 · 풀: 바스락 · 꼬리는 모래 위라 작게, 신나서 아주 빨리 흔들 때도 북치듯 하지 않게
};
// 핑키 방 프로필: 지금 값(핑키 방 그대로)을 떠 둔다 — 놀이터에 갔다 와도 똑같이 되돌린다
Object.assign(ROOM_HOME, {
  HOME: { ...HOME }, BOWL: BOWL.clone(), EAT: { ...EAT }, SPOTS: { ...SPOTS }, CUSH: { x: CUSH.x, z: CUSH.z }, OBST: [...OBST], NAV: { ...NAV },
  THROW: THROW_SPOTS.map((q) => [...q]), HIDE: HIDE.map((q) => [...q]), WIN: WIN_PT.clone(), ROPE: { ...ROPE_REST }, AIM: CAM_AIM.clone(),
  bg: roomScene.background, fog: roomScene.fog, env: roomScene.environment,
  sound: { surf: null, tail: null, rug: [0.1, 0.8, 1.45, 0.95], cush: [CUSH.x, CUSH.z, CUSH.R], bowl: [BOWL.x, BOWL.z], voice: 'pinky', brook: null },
  name: $('#roomUI .title .name').textContent, place: $('#roomUI .title .place').textContent, hint: $('#hint').textContent, navLabel: actionsEl.getAttribute('aria-label'),
  off: { worm: true, zoom: true, dig: true, paw: true, high5: true, splash: true, poop: true }, wander: [-0.6, 0.2, 1.4, 1.0],
  lines: { gifts: GIFT_LINES, table: TABLE_LINES, window: ['단풍 예쁘다…', '새 왔다…', '바람 냄새…'], tableSniff: '뭐 떨어진 거 없나' },
});
function setDog(d) { // 방에 있는 강아지를 바꿔 끼운다 (코에 묻는 요거트도 그 얼굴로) · 강아지마다 따로 기억하는 것(옆으로 앉은 쪽 · 로프 놀이 횟수 · 혼자 로프 갖고 놀 때까지)도 바꿔 든다
  if (pinky === d) return;
  pinky.mem = { sideSign, ropeRuns, toyIdle, lastSit };
  ({ sideSign, ropeRuns, toyIdle, lastSit } = d.mem || { sideSign: 1, ropeRuns: 0, toyIdle: 60, lastSit: '' });
  pinky.root.visible = false; d.root.visible = true; pinky = d; d.head.add(yogurtDab.g);
}
// 담이 말투: 명랑 쾌활한 '담과장' — 핑키의 나긋한 말을 담이답게 바꾼다 (소리는 원래 말에 맞춰 그대로 난다)
const DAMI_TALK = {
  '왔어? ♥': '담과장 출근했습니다! ♥', '왔다 왔다! ♥': '엄마 왔다~! ♥', '놀아줘 ♥': '놀아 주세요! ♥',
  '좋아…': '좋아요!', '더 해줘…': '한 번 더요!', '포근해…': '포근해요~', '…하나 더?': '하나 더 결재해 주세요!', '…더 없어?': '더 없어요?',
  '간식이다!': '간식 타임!', '간식 있어?': '간식 결재 올립니다!', '심심해…': '심심해요~', '뭐 해?': '뭐 하세요?', '놀자?': '놀아요!', '엄마~ ♥': '엄마 최고! ♥',
  '응…?': '네?!', '잘 잤다…': '푹 잤다!', '후우…': '휴~ 좋다!', '쭈욱…': '쭈욱~!', '하암…': '하암~', '재밌었다…': '재밌었다!',
  '…같이 할래?': '같이 해요!', '…또 줘?': '또 주세요!', '…이번만이야': '이번만이에요~', '후우… 알았어': '네, 알겠습니다!', '안 들려~': '안 들려요~',
  '또 던져!': '또 던져 주세요!', '또 하자!': '또 해요!', '…이따 주겠지': '이따 주시겠지~', '달다…': '달다!', '다 먹었다!': '다 먹었습니다!',
  '뒹굴': '뒹굴!', '뒹굴뒹굴': '데굴데굴~', '찾았다!': '찾았습니다!', '헤헤, 주웠다': '헤헤, 득템!', '하나만 더…?': '하나만 더요?',
};
function damiTalk(s) { return DAMI_TALK[s] ?? (/[가-힣]…$/.test(s) ? s.slice(0, -1) + '~' : s); }
function useRoom(id) {
  const R = id === 'park' ? ROOM_PARK : id === 'namsan' ? ROOM_NAMSAN : ROOM_HOME;
  if (R === RP) return;
  if (!R.built && R === ROOM_PARK) buildPark();
  if (!R.built && R === ROOM_NAMSAN) buildNamsan();
  RP.ropeN0 = rope.frames().map((v) => v.clone()); if (R.ropeN0) rope.frames().forEach((v, i) => v.copy(R.ropeN0[i])); // 핑키 방의 로프는 놀이터에 다녀와도 그대로 (줄 단면 방향까지)
  RP = R;
  Object.assign(HOME, R.HOME); BOWL.copy(R.BOWL); Object.assign(EAT, R.EAT); Object.assign(SPOTS, R.SPOTS); Object.assign(CUSH, R.CUSH);
  OBST.length = 0; OBST.push(...R.OBST); Object.assign(NAV, R.NAV);
  THROW_SPOTS.length = 0; THROW_SPOTS.push(...R.THROW); HIDE.length = 0; HIDE.push(...R.HIDE);
  WIN_PT.copy(R.WIN); Object.assign(ROPE_REST, R.ROPE); CAM_AIM.copy(R.AIM); setCamPos(roomCam.aspect);
  for (const [o, v] of HOME_KIDS) o.visible = R === ROOM_HOME && v;
  if (parkG) parkG.visible = R === ROOM_PARK;
  if (nsG) nsG.visible = R === ROOM_NAMSAN;
  roomScene.background = R.bg; roomScene.fog = R.fog; roomScene.environment = R.env;
  setDog(R === ROOM_PARK ? DAMI : R === ROOM_NAMSAN ? PUPU : PINKY);
  snd('configure', R.sound);
  $('#roomUI .title .name').textContent = R.name; $('#roomUI .title .place').textContent = R.place; $('#hint').textContent = R.hint; actionsEl.setAttribute('aria-label', R.navLabel);
  for (const b of actionsEl.querySelectorAll('button[data-cmd]')) {
    b.hidden = !!R.off[b.dataset.cmd];
    const t = b.lastChild; if (b.dataset.label === undefined) b.dataset.label = t.textContent; t.textContent = (R.labels && R.labels[b.dataset.cmd]) || b.dataset.label; // 장소마다 단추 이름 (남산: 간식 → 터키츄)
    if (b.dataset.menu) { if (((R.picks || PICKS)[b.dataset.menu] || []).length === 1) b.removeAttribute('aria-haspopup'); else b.setAttribute('aria-haspopup', 'menu'); } // 고를 것이 하나뿐이면 메뉴 없이 바로
  }
  actionsEl.classList.toggle('many', actionsEl.querySelectorAll('button[data-cmd]:not([hidden])').length > 10); // 놀이터: 단추가 11개 (땅 파기)
  rope.g.visible = R === ROOM_HOME; // 로프는 핑키 방에만 (담이의 장난감은 패트병 · 나뭇가지 · 오둥이)
  if ((R === ROOM_PARK || R === ROOM_NAMSAN) && !R.compiled) { R.compiled = true; try { renderer.compile(roomScene, roomCam); } catch (e) { /* 처음 그릴 때 맞춰진다 */ } } // 화면이 어두운 동안 미리 셰이더를 만들어 둔다
}

// ================================================================
// 담이의 간식 · 장난감 · 땅 파기 (놀이터에서만): 칫솔껌 · 악어껌 / 패트병 · 나뭇가지 · 오둥이 쿠션 / 모래 파기
// 소품은 놀이터를 처음 지을 때 같이 만든다 (핑키 방에는 아무것도 더하지 않는다). 좌표는 모두 parkG(= 월드) 기준
// ================================================================
let DP = null;
const DUCK_OB = { x: -1.3, z: 0.55, r: 0.27, h: 0.2 }, DUCK_S = 0.87; // 오둥이 쿠션: 평소에는 돌아서 다니고, 갖고 놀거나 위에 올라가 있을 때만 비켜 준다
const DUCK_SPOTS = [[-1.3, 0.55, Math.PI + 0.45], [-0.68, 0.62, Math.PI + 0.25]]; // 오둥이가 놓이는 자리 (x, z, 방향: 머리가 저쪽 — 보는 사람에게 얼굴이 바로 보이게) · 갖고 놀고 나면 다른 자리로 끌려가 있다
const _ox = V3(), _oy = V3(), _oz = V3(), _om = new THREE.Matrix4(), _oq = new THREE.Quaternion();
function orientProp(o, at, dir, up) { // o의 원점을 at에, +z를 dir 쪽으로, +y를 up 쪽으로
  _oz.copy(dir).normalize(); _ox.crossVectors(up, _oz); if (_ox.lengthSq() < 1e-8) _ox.set(_oz.z, 0, -_oz.x); if (_ox.lengthSq() < 1e-8) _ox.set(1, 0, 0);
  _ox.normalize(); _oy.crossVectors(_oz, _ox); _om.makeBasis(_ox, _oy, _oz); o.quaternion.setFromRotationMatrix(_om); o.position.copy(at);
}
const jawW = (x, y, z) => pinky.jaw.localToWorld(V3(x, y, z));
const jawDir = (x, y, z) => V3(x, y, z).transformDirection(pinky.jaw.matrixWorld);
const rootW = (x, y, z) => pinky.root.localToWorld(V3(x, y, z));
const rootDir = (x, y, z) => V3(x, y, z).transformDirection(pinky.root.matrixWorld);
// z0 → z1로 누운 납작한 캡슐 (단면 반지름: 옆 rx · 위아래 ry)
function capZ(par, mat, z0, z1, rx, ry, x = 0, y = 0) { return add(par, new THREE.CapsuleGeometry(rx, Math.max(1e-4, z1 - z0 - 2 * rx), 4, 10), mat, [x, y, (z0 + z1) / 2], [Math.PI / 2, 0, 0], [1, 1, ry / rx]); }
function capX(par, mat, x0, x1, r, y, z) { return add(par, new THREE.CapsuleGeometry(r, Math.max(1e-4, Math.abs(x1 - x0) - 2 * r), 4, 8), mat, [(x0 + x1) / 2, y, z], [0, 0, Math.PI / 2]); }
// 씹을수록 짧아지는 간식: 원점 = 씹는 쪽 끝, +z로 길이 L. 조각마다 끝나는 z를 적어 두고, 씹은 만큼(cut) 앞에서부터 사라진다
function chewProp(L, crumb, build, S = 1.45) { // S: 화면에서 읽히게 실제보다 조금 크게
  const g = new THREE.Group(), inner = new THREE.Group(), parts = []; g.add(inner); g.visible = false; g.scale.setScalar(S);
  build(inner, (m, z1) => { parts.push([m, z1]); return m; });
  const T = { g, L, k: 1, crumb, state: 'none',
    get len() { return L * S * T.k; },
    setLen(k) { T.k = clamp(k, 0, 1); const cut = L * (1 - T.k); inner.position.z = -cut; for (const [m, z1] of parts) m.visible = z1 > cut + 0.004; },
    reset() { T.setLen(1); }, hide() { g.visible = false; T.state = 'none'; T.reset(); },
  };
  return T;
}
function buildDamiProps(G, OB) {
  DP = {};
  // ---------- 칫솔껌: 주황색 반투명 덴탈껌 — 오돌토돌한 솔머리(4줄 × 5줄) · 가는 목 · 가운데가 갈라진 손잡이
  const brushM = new THREE.MeshStandardMaterial({ color: 0xf0892c, roughness: 0.4, emissive: 0x8a4400, emissiveIntensity: 0.24 });
  const nubM = new THREE.MeshStandardMaterial({ color: 0xffa040, roughness: 0.36, emissive: 0xa05400, emissiveIntensity: 0.26 }); // 솔 돌기는 조금 더 밝게 (한 알 한 알 떨어져 보이게)
  const nub = new THREE.CapsuleGeometry(0.0033, 0.0085, 3, 8);
  DP.brush = chewProp(0.132, M(0xe39a52), (g, part) => {
    part(capZ(g, brushM, 0, 0.047, 0.0138, 0.0062), 0.047);
    for (let r = 0; r < 5; r++) for (let c = 0; c < 4; c++) { const z = 0.0072 + r * 0.0081; part(add(g, nub, nubM, [(c - 1.5) * 0.0071, 0.0118, z]), z + 0.003); }
    part(capZ(g, brushM, 0.04, 0.073, 0.0066, 0.0047), 0.073);
    part(capZ(g, brushM, 0.065, 0.096, 0.0098, 0.0056), 0.096);
    for (const sx of [-1, 1]) part(capZ(g, brushM, 0.088, 0.13, 0.0043, 0.0052, sx * 0.0062), 0.13);
    part(capZ(g, brushM, 0.12, 0.132, 0.006, 0.0054, 0, 0), 0.132);
  });
  // ---------- 악어껌: 올리브색 — 납작한 주둥이 · 눈두덩 · 등에 오돌토돌한 돌기 줄 · 뼈다귀 모양 네 발 · 가늘어지는 꼬리
  const gatorM = M(0x6d6a38, { roughness: 0.62 });
  DP.gator = chewProp(0.126, M(0x7b7746), (g, part) => {
    part(add(g, SPH, gatorM, [0, 0.0058, 0.02], null, [0.0098, 0.0064, 0.021]), 0.04);
    for (const sx of [-1, 1]) part(add(g, SPH, gatorM, [sx * 0.0058, 0.0108, 0.032], null, 0.0041), 0.036);
    part(add(g, SPH, gatorM, [0, 0.0078, 0.063], null, [0.0168, 0.0098, 0.035]), 0.097);
    for (let r = 0; r < 7; r++) for (let c = -1; c <= 1; c++) {
      const z = 0.04 + r * 0.0078, q = 1 - ((z - 0.063) / 0.035) ** 2, x = c * 0.0078 * Math.sqrt(Math.max(q, 0.2));
      const y = 0.0078 + 0.0098 * Math.sqrt(Math.max(0.05, q - (x / 0.0168) ** 2));
      part(add(g, SPH, gatorM, [x, y, z], null, c ? 0.0033 : 0.0038), z + 0.003);
    }
    for (const [z, sx] of [[0.046, 1], [0.046, -1], [0.082, 1], [0.082, -1]]) { // 뼈다귀 모양 발: 짧은 다리 끝에 동그란 마디 둘
      part(capX(g, gatorM, sx * 0.011, sx * 0.027, 0.0036, 0.004, z), z + 0.006);
      for (const dz of [-0.0036, 0.0036]) part(add(g, SPH, gatorM, [sx * 0.0275, 0.0042, z + dz], null, 0.0042), z + 0.006);
    }
    const tail = (z0, z1, r0, r1, x0, x1) => { const m = add(g, cyl(r1, r0, z1 - z0, 10), gatorM, [(x0 + x1) / 2, 0.0062, (z0 + z1) / 2], [Math.PI / 2, 0, Math.atan2(x1 - x0, z1 - z0)], [1, 1, 0.62]); return m; };
    part(tail(0.09, 0.11, 0.0088, 0.0062, 0, 0.0015), 0.11); part(tail(0.108, 0.126, 0.0062, 0.0022, 0.0015, 0.0055), 0.126);
    for (const z of [0.096, 0.106, 0.115]) part(add(g, SPH, gatorM, [(z - 0.09) * 0.12, 0.0098 - (z - 0.096) * 0.12, z], null, 0.0029), z + 0.002);
  });
  for (const k of ['brush', 'gator']) { DP[k].g.traverse((o) => { if (o.isMesh) o.castShadow = false; }); G.add(DP[k].g); } // 작은 간식은 그림자 없이 (얼굴에 점점이 찍히지 않게)

  // ---------- 패트병: 투명한 몸통(골 두 줄) · 파란 띠 상표 · 파란 뚜껑. 원점 = 가운데, +z = 뚜껑 쪽. 깨물수록 우그러진다
  {
    const prof = [[0, 0.003], [0.02, 0], [0.029, 0.004], [0.033, 0.014], [0.033, 0.05], [0.0302, 0.056], [0.033, 0.062], [0.033, 0.118], [0.0302, 0.123], [0.033, 0.128], [0.033, 0.14], [0.029, 0.157], [0.02, 0.172], [0.0138, 0.181], [0.0138, 0.19]].map(([r, y]) => new THREE.Vector2(r, y));
    const bodyGeo = new THREE.LatheGeometry(prof, 28), labelGeo = new THREE.CylinderGeometry(0.0338, 0.0338, 0.042, 28, 6, true); labelGeo.translate(0, 0.09, 0);
    const labelTex = canvasTex(256, 64, (x, w, h) => {
      x.fillStyle = '#f3f7fa'; x.fillRect(0, 0, w, h); x.fillStyle = '#2b6fc8'; x.fillRect(0, 0, w, h * 0.34); x.fillRect(0, h * 0.86, w, h * 0.14);
      x.fillStyle = '#5aa0e6'; x.beginPath(); x.moveTo(0, h * 0.34); for (let i = 0; i <= w; i += 8) x.lineTo(i, h * 0.34 + Math.sin(i / 18) * 5 + 5); x.lineTo(w, h * 0.34); x.fill();
      x.fillStyle = 'rgba(40,60,90,.55)'; for (let i = 0; i < 6; i++) x.fillRect(20 + i * 40, h * 0.6, 22, 4);
    });
    const plastic = new THREE.MeshPhysicalMaterial({ color: 0xd6eaf4, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.08, emissive: 0x2a3a44, emissiveIntensity: 0.35 });
    const g = new THREE.Group(), inner = new THREE.Group(); g.add(inner); inner.rotation.x = Math.PI / 2; inner.position.z = -0.1025; g.visible = false; G.add(g); g.scale.setScalar(1.2); // 화면에서 읽히게 조금 크게
    const body = add(inner, bodyGeo, plastic, null, null, null, false), label = add(inner, labelGeo, M(0xffffff, { map: labelTex, roughness: 0.5, side: THREE.DoubleSide }));
    add(inner, cyl(0.0148, 0.0148, 0.017, 20), M(0x2a68cf, { roughness: 0.45 }), [0, 0.1965, 0]);
    add(inner, new THREE.TorusGeometry(0.016, 0.0019, 6, 20), M(0x9fc4dc, { roughness: 0.3, transparent: true, opacity: 0.8 }), [0, 0.1835, 0], [Math.PI / 2, 0, 0]);
    body.renderOrder = 2;
    const geos = [bodyGeo, labelGeo].map((q) => ({ q, base: q.attributes.position.array.slice() }));
    const B = DP.bottle = { g, kind: 'bottle', L: 0.246, rest: 0.0396, sym: true, state: 'none', crush: 0, dents: [], a0: 0, v: V3(), spinAx: V3(1, 0, 0), spin: 0,
      shape() { // 우그러진 모양: 가운데가 납작해지고(a0 방향으로 눌림) 깨문 자리마다 움푹
        for (const { q, base } of geos) {
          const p = q.attributes.position.array;
          for (let i = 0; i < p.length; i += 3) {
            const x = base[i], y = base[i + 1], z = base[i + 2], a = Math.atan2(z, x), w = ss(0.012, 0.045, y) * ss(0.162, 0.136, y);
            let f = 1 - B.crush * w * (0.3 + 0.24 * Math.cos(2 * (a - B.a0)));
            for (const d of B.dents) f -= d.k * w * Math.exp(-(((y - d.y) / 0.02) ** 2) - (angDiff(a, d.a) / 0.6) ** 2);
            p[i] = x * f; p[i + 2] = z * f; p[i + 1] = y;
          }
          q.attributes.position.needsUpdate = true; q.computeVertexNormals();
        }
      },
      reset() { B.crush = 0; B.dents.length = 0; B.shape(); },
      bite(k = 0.12) { B.dents.push({ y: 0.06 + Math.random() * 0.06, a: Math.random() * 6.28, k: 0.12 + Math.random() * 0.1 }); if (B.dents.length > 9) B.dents.shift(); B.crush = Math.min(0.62, B.crush + k); B.shape(); },
    };
    B.reset();
  }
  // ---------- 나뭇가지: 굽은 가지 끝이 Y자로 갈라지고 잔가지 하나 · 마른 잎 두 장. 원점 = 가운데, 길이 방향 +z (담이 머리보다 훨씬 길다)
  {
    const barkTex = canvasTex(64, 256, (x, w, h) => {
      x.fillStyle = '#76563a'; x.fillRect(0, 0, w, h); const r = rng(21);
      for (let i = 0; i < 170; i++) { x.strokeStyle = r() < 0.55 ? `rgba(44,28,16,${0.3 + r() * 0.4})` : `rgba(170,140,104,${0.2 + r() * 0.3})`; x.lineWidth = 1 + r() * 1.6; const px = r() * w, py = r() * h, l = 10 + r() * 40; x.beginPath(); x.moveTo(px, py); x.lineTo(px + (r() - 0.5) * 3, py + l); x.stroke(); }
    }, [1, 2]);
    const bark = M(0xffffff, { map: barkTex, roughness: 0.92 }), wood = M(0xcfae80, { roughness: 0.8 }), leafM = M(0xa8873a, { roughness: 0.8, side: THREE.DoubleSide });
    const g = new THREE.Group(); g.visible = false; G.add(g);
    const tube = (pts, r0, r1, n) => {
      const c = new THREE.CatmullRomCurve3(pts.map((q) => V3(q[0], q[1], q[2]))), geo = new THREE.TubeGeometry(c, n, 1, 7, false), p = geo.attributes.position, R = 8;
      for (let i = 0; i <= n; i++) { const u = i / n, o = c.getPointAt(u), r = lerp(r0, r1, u); for (let j = 0; j < R; j++) { const k = i * R + j; p.setXYZ(k, o.x + (p.getX(k) - o.x) * r, o.y + (p.getY(k) - o.y) * r, o.z + (p.getZ(k) - o.z) * r); } }
      geo.computeVertexNormals(); add(g, geo, bark);
      for (const [u, r] of [[0, r0], [1, r1]]) add(g, SPH, wood, c.getPointAt(u).toArray(), null, [r, r, r]); // 부러진 끝은 밝은 속살
    };
    tube([[0.004, 0.0, -0.28], [0.013, 0.003, -0.15], [-0.004, 0.0, -0.02], [0.008, -0.002, 0.12], [0.02, 0.002, 0.28]], 0.0155, 0.0095, 26);
    tube([[0.0, 0.0, 0.05], [0.045, 0.002, 0.13], [0.092, 0.004, 0.2]], 0.0095, 0.0052, 10);
    tube([[0.011, 0.0, -0.19], [-0.03, 0.003, -0.235], [-0.052, 0.004, -0.255]], 0.0048, 0.0026, 6);
    for (const [x, z, a] of [[0.1, 0.212, 0.5], [0.083, 0.216, -0.7]]) add(g, SPH, leafM, [x, 0.006, z], [0, a, 0], [0.012, 0.0025, 0.024]);
    DP.stick = { g, kind: 'stick', L: 0.56, rest: 0.0155, sym: true, state: 'none', v: V3(), spinAx: V3(0, 1, 0), spin: 0 };
  }
  // ---------- 오둥이 쿠션: 커다란 하얀 오리 인형 (서양배 모양 몸 · 주황 부리와 발 · 작은 날개 · 테두리가 까만 동그란 눈). 등을 대고 누워 얼굴이 하늘을 본다
  {
    const w = (t) => 0.17 - 0.026 * t, h = (t) => 0.09 + 0.01 * t + 0.055 * ss(-0.2, 0.75, t), top = (x, t) => h(t) * Math.pow(Math.max(0, 1 - t * t - (x / w(t)) ** 2), 0.32); // t: -1 = 발 쪽 … 1 = 머리 쪽 · 배가 넓고 판판한 쿠션, 머리 쪽은 도톰하게 솟아 얼굴이 앞(보는 사람 쪽)을 향한다
    const geo = new THREE.SphereGeometry(1, 44, 30), p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) { const sx = p.getX(i), t = -p.getY(i), sz = p.getZ(i); /* t를 뒤집어야 면의 앞뒤가 바로 선다 (축을 바꿔 끼우면 거울상이 된다) */ const y = Math.sign(sz) * Math.pow(Math.abs(sz), 0.64) * h(t); p.setXYZ(i, sx * w(t), y < 0 ? Math.max(-0.052, y * 0.7) : y, t * 0.3); }
    geo.computeVertexNormals();
    const plush = new THREE.MeshPhysicalMaterial({ color: 0xf3f0ea, roughness: 0.95, sheen: 1, sheenColor: new THREE.Color(0xffffff), sheenRoughness: 0.55 }), orange = M(0xf09a1e, { roughness: 0.75 });
    const g = new THREE.Group(), body = new THREE.Group(); g.add(body); body.position.y = 0.056; G.add(g); g.scale.setScalar(DUCK_S); // 담이보다 조금 작게
    add(body, geo, plush);
    const nrm = (x, t) => { const e = 0.004, dx = (top(x + e, t) - top(x - e, t)) / (2 * e), dz = (top(x, t + e / 0.3) - top(x, t - e / 0.3)) / (2 * e); return V3(-dx, 1, -dz).normalize(); };
    const onTop = (par, geoD, mat, x, t, lift, s, spin = 0) => { const m = add(par, geoD, mat, [x, top(x, t) + lift, t * 0.3], null, s, false); m.quaternion.setFromUnitVectors(V3(0, 0, 1), nrm(x, t)); m.rotateZ(spin); return m; };
    const disc = new THREE.CircleGeometry(1, 28), blk = M(0x161412, { roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), wht = M(0xffffff, { roughness: 0.45, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), pup = M(0x0c0b0a, { roughness: 0.3, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    for (const sx of [-1, 1]) { // 눈: 까만 테 · 흰자 · 안쪽으로 몰린 눈동자
      onTop(body, disc, blk, sx * 0.053, 0.47, 0.0015, 0.041); onTop(body, disc, wht, sx * 0.053, 0.47, 0.0026, 0.0348);
      onTop(body, disc, pup, sx * 0.053 - sx * 0.009, 0.485, 0.0037, 0.0135);
    }
    onTop(body, SPH, orange, 0.004, 0.25, 0.005, [0.086, 0.03, 0.03], 0.12); // 부리: 넓적하고 둥근 막대 (살짝 기울었다) · 사진처럼 크게
    for (const sx of [-1, 1]) { add(body, SPH, plush, [sx * 0.185, -0.03, 0.02], [0, sx * 0.35, sx * -0.25], [0.06, 0.02, 0.07]); add(body, SPH, orange, [sx * 0.07, -0.036, -0.3], [0, sx * 0.25, 0], [0.042, 0.018, 0.055]); } // 날개 · 발
    const K = DP.duck = { g, body, x: DUCK_SPOTS[0][0], z: DUCK_SPOTS[0][1], yaw: DUCK_SPOTS[0][2], state: 'ground', busy: false, on: false, sq: 0, sqT: 0, lift: 0, tilt: 0, top,
      place(x, z, yaw) { K.x = x; K.z = z; K.yaw = yaw; g.position.set(x, 0, z); g.rotation.set(0, yaw, 0); DUCK_OB.x = x; DUCK_OB.z = z; },
      local: (x, y, z) => { g.updateMatrixWorld(); return g.localToWorld(V3(x, y, z)); },
      put() { K.state = 'ground'; K.lift = 0; K.tilt = 0; const q = { x: g.position.x, z: g.position.z }; RP.clamp(q); K.place(q.x, q.z, K.yaw); },
    };
    K.place(K.x, K.z, K.yaw);
    OB.push(DUCK_OB);
  }
  // ---------- 땅 파기: 뒤로 튀는 모래 알갱이 · 구덩이(가운데가 어둡고 둘레에 모래 턱) · 뒤에 쌓이는 모래 더미 (한참 지나면 흐려진다)
  {
    const N = 160, grains = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), M(0x8c6a42, { roughness: 1 }), N); grains.count = 0; grains.frustumCulled = false; grains.castShadow = false; G.add(grains);
    DP.sand = { grains, list: [], N };
    const holeTex = canvasTex(128, 128, (x, w) => { const q = x.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); q.addColorStop(0, 'rgba(40,27,15,.98)'); q.addColorStop(0.36, 'rgba(58,41,24,.95)'); q.addColorStop(0.62, 'rgba(92,68,42,.8)'); q.addColorStop(0.84, 'rgba(132,104,72,.38)'); q.addColorStop(1, 'rgba(160,130,95,0)'); x.fillStyle = q; x.fillRect(0, 0, w, w); }); // 가운데가 깊어 보이게 진하게 · 벽은 그늘진 젖은 모래
    const ring = new THREE.TorusGeometry(1, 0.34, 6, 28), dome = new THREE.SphereGeometry(1, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    { const p = ring.attributes.position, r = rng(5); const bump = Array.from({ length: 29 }, () => 0.75 + 0.5 * r()); bump[28] = bump[0]; // 둘레 턱을 울퉁불퉁하게 (파낸 모래가 고르게 쌓이지 않는다)
      for (let i = 0; i < p.count; i++) { const a = (Math.atan2(p.getY(i), p.getX(i)) + Math.PI * 2) % (Math.PI * 2), u = (a / (Math.PI * 2)) * 28, j = Math.floor(u), b = lerp(bump[j], bump[j + 1], u - j); if (p.getZ(i) > 0) p.setZ(i, p.getZ(i) * b); }
      ring.computeVertexNormals(); }
    DP.pits = [];
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group(); g.visible = false; G.add(g);
      const hole = add(g, new THREE.CircleGeometry(1, 28), new THREE.MeshStandardMaterial({ map: holeTex, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), [0, 0.0058, 0], [-Math.PI / 2, 0, 0], 0.001, false);
      const rim = add(g, ring, M(0xbd9e73, { roughness: 1, transparent: true }), [0, 0.002, 0], [-Math.PI / 2, 0, 0], 0.001, false);
      const pile = add(G, dome, M(0xbf9f72, { roughness: 1, transparent: true }), [0, 0.003, 0], null, 0.001, false); pile.visible = false;
      DP.pits.push({ g, hole, rim, pile, k: 0, pk: 0, age: 99, x: 0, z: 0 });
    }
  }
  POSES.dig = { bodyY: 0.255, bodyZ: 0.0, pitch: 0.3, roll: 0, yawOff: 0, gaze: 0, headPitch: 0.6, headTilt: 0, tail: -0.45, level: 1, free: 0, neck: 0.55, reach: 0.02, abd: [0.1, 0.1, 0, 0],
    lean: [0.85, 0.85, 0.16, 0.16], paws: [P(0.068, 0.03, 0.27), P(-0.068, 0.03, 0.27), P(0.072, 0.03, -0.2), P(-0.072, 0.03, -0.2)] }; // 땅 파기: 앞을 낮추고 엉덩이는 든 채 고개를 숙여 구덩이를 본다 · 꼬리는 깃발처럼 세운다
  // 매 프레임(담이를 움직이기 전): 간식을 보면 꼬리가 난리 — 빠르고 크게, 엉덩이까지 씰룩씰룩
  roomUpd.push((t, dt) => {
    if (RP !== ROOM_PARK) return;
    const d = pinky; if (d.twag) { d.wagAmpT = 1.2; d.wagSpeedT = 33; }
    d.wigS = (d.wigS || 0) + ((d.twag ? 1 : 0) - (d.wigS || 0)) * (1 - Math.exp(-6 * dt));
    if (d.wigS > 0.01) d.wig = Math.sin(d.wagPhase + 0.7) * 0.17 * d.wigS; // 아닐 때는 성격 쪽(쓰다듬기 실룩)이 정한 값을 그대로 둔다
  });
}
// 간식을 본 순간부터: 꼬리를 아주 빠르고 크게 흔들고 엉덩이가 같이 씰룩거린다 (끄면 보통 신난 꼬리로)
function damiTreatWag(on) {
  const d = pinky; if (!d.dami) return;
  d.treatWag = !!on;
  if (on) { d.twag = true; d.wagSpeed = Math.max(d.wagSpeed, 26); d.wagAmp = Math.max(d.wagAmp, 0.95); d.wagAmpT = 1.2; d.wagSpeedT = 33; }
  else if (d.twag) { d.twag = false; d.wagAmpT = 0.6; d.wagSpeedT = 12; }
}
// ---------- 놀이터에서 매 프레임 (담이를 움직인 뒤 · 입에 문 것을 맞추기 전)
const _sv2 = V3(), _sq2 = new THREE.Quaternion(), _sm = new THREE.Matrix4();
function damiPost(d, dt, t) {
  if (!DP) return;
  if (d.wigS > 0.01) d.root.rotation.y += Math.sin(d.wagPhase + 1.4) * 0.04 * d.wigS; // 엉덩이 씰룩 (몸통이 꼬리 반대로 살짝 돈다)
  if (d.dig > 0.05) { // 앞발이 모래에 닿을 때마다: 사각 · 모래가 뒤로 휙 · 구덩이가 깊어진다
    const beat = (w, ph) => Math.floor((w * t + ph) / (Math.PI * 2)) !== Math.floor((w * (t - dt) + ph) / (Math.PI * 2));
    for (const [sx, ph] of [[1, Math.PI], [-1, 0]]) if (beat(15, ph)) {
      d.root.updateMatrixWorld(true); const at = rootW(sx * 0.05, 0.03, 0.24);
      snd('digHit', [at.x, 0.02, at.z], -2 + 2 * d.dig);
      for (let i = 0; i < 6; i++) { const lx = (Math.random() - 0.5) * 0.7 + sx * 0.35, lz = -(1.5 + Math.random() * 1.1), cy = Math.cos(d.yaw), sy = Math.sin(d.yaw); sandSpray(at.clone().add(V3(0, 0.02, 0)), V3(lx * cy + lz * sy, 1.2 + Math.random() * 1.0, -lx * sy + lz * cy)); }
      const pit = DP.digPit; if (pit) { pit.k = Math.min(1, pit.k + 0.05 * d.dig); pit.pk = Math.min(1, pit.pk + 0.04 * d.dig); pit.age = 0; }
    }
  }
  const S = DP.sand; let n = 0;
  for (let i = S.list.length - 1; i >= 0; i--) {
    const q = S.list[i]; q.age += dt;
    if (q.p.y > 0.006) { q.v.y -= 9.8 * dt; q.p.addScaledVector(q.v, dt); if (q.p.y <= 0.006) { q.p.y = 0.006; q.age = Math.max(q.age, 0.9); } }
    if (q.age > 1.15) { S.list.splice(i, 1); continue; }
  }
  for (const q of S.list) { if (n >= S.N) break; _sm.compose(q.p, _sq2.set(0, 0, 0, 1), _sv2.setScalar(q.s * (q.age > 0.85 ? Math.max(0.05, (1.15 - q.age) / 0.3) : 1))); S.grains.setMatrixAt(n++, _sm); } // 떨어진 알갱이는 금방 모래에 섞인다
  S.grains.count = n; if (n) S.grains.instanceMatrix.needsUpdate = true;
  for (const pit of DP.pits) { // 구덩이: 파는 동안 커지고, 40초쯤 지나면 바람에 메워지듯 흐려진다
    if (pit.age > 52) { pit.g.visible = false; pit.pile.visible = false; continue; }
    pit.age += dt; const f = 1 - ss(40, 52, pit.age), r = 0.03 + 0.06 * pit.k;
    pit.g.visible = pit.k > 0.01; pit.hole.scale.setScalar(r * 1.5); pit.rim.scale.set(r * 1.6, r * 1.6, 0.016 + 0.034 * pit.k); pit.hole.material.opacity = f; pit.rim.material.opacity = f;
    pit.pile.visible = pit.pk > 0.01; pit.pile.scale.set(0.052 + 0.117 * pit.pk, (0.01 + 0.046 * pit.pk) * f + 0.001, 0.045 + 0.091 * pit.pk); pit.pile.material.opacity = f; // 뒤에 쌓인 모래 더미 (눈에 띄게)
  }
  for (const k of ['bottle', 'stick']) if (DP[k].state === 'fly') stepFly(DP[k], dt);
  const K = DP.duck, dist = Math.hypot(d.x - K.x, d.z - K.z);
  if (K.busy || K.state === 'drag' || dist < 0.33) K.on = true; else if (dist >= 0.56) K.on = false; // 위에 올라가 있거나 갖고 노는 동안만 비켜 준다 (방석과 같다)
  DUCK_OB.x = K.x; DUCK_OB.z = K.z; DUCK_OB.r = K.on ? -9 : 0.27;
  K.sq += (K.sqT - K.sq) * (1 - Math.exp(-7 * dt)); K.body.scale.set(1 + 0.05 * K.sq, 1 - 0.2 * K.sq, 1 + 0.03 * K.sq); // 담이가 엎어지면 푹 꺼진다
}
function sandSpray(p, v) { const S = DP.sand; if (S.list.length >= S.N) S.list.shift(); S.list.push({ p, v, age: 0, s: 0.006 + Math.random() * 0.006 }); }
// 던진 패트병 · 나뭇가지: 날아가 모래에 떨어져 한두 번 튀고 눕는다
function stepFly(Q, dt) {
  const g = Q.g, p = g.position; Q.v.y -= 9.8 * dt; p.addScaledVector(Q.v, dt);
  _sq2.setFromAxisAngle(Q.spinAx, Q.spin * dt); g.quaternion.premultiply(_sq2);
  const q = { x: p.x, z: p.z }; RP.clamp(q); if ((p.x - q.x) * Q.v.x > 0) Q.v.x *= -0.4; if ((p.z - q.z) * Q.v.z > 0) Q.v.z *= -0.4; // 놀이터 끝에 닿으면 튕겨 나온다 (손에서 떠날 때는 아직 바깥이다)
  if (p.y < Q.rest + 0.004) {
    p.y = Q.rest;
    if (Math.abs(Q.v.y) > 1.1) { Q.v.y *= -0.3; Q.v.x *= 0.5; Q.v.z *= 0.5; Q.spin *= 0.35; snd('toyDrop', Q.kind, [p.x, 0.02, p.z]); say(Q.kind === 'bottle' ? '통' : '툭', () => Q.g.position.clone().add(V3(0, 0.1, 0)), 'small', 0.8); }
    else layFlat(Q, p.x, p.z);
  }
}
function layFlat(Q, x, z) { // 모래 위에 눕힌다 (길이 방향만 남긴다)
  _sv2.set(0, 0, 1).applyQuaternion(Q.g.quaternion); _sv2.y = 0; if (_sv2.lengthSq() < 1e-6) _sv2.set(0, 0, 1);
  const q = { x, z }; RP.clamp(q); orientProp(Q.g, V3(q.x, Q.rest, q.z), _sv2, _yAx); Q.state = 'ground'; Q.v.set(0, 0, 0);
}
// 다른 명령이 끼어들 때: 물고 있던 장난감은 그 자리에 떨어뜨리고, 먹던 간식은 치운다
function damiRelease() {
  if (!DP) return;
  DP.brush.hide(); DP.gator.hide();
  for (const k of ['bottle', 'stick']) { const Q = DP[k]; if (Q.state === 'held') { const p = Q.g.position; layFlat(Q, p.x, p.z); } }
  if (DP.duck.state === 'drag') DP.duck.put();
  DP.duck.sqT = 0; DP.digPit = null; pinky.dig = 0;
}
// 소품을 자리(모드)마다 다르게 둔다: poses[mode](C, D, U) → 원점 · +z 방향 · 위 방향. to(mode)는 지금 자리에서 부드럽게 옮겨 간다
function propDriver(Q, poses) {
  const C0 = V3(), D0 = V3(), U0 = V3(), C = V3(), D = V3(), U = V3();
  const drv = { mode: null, k: 1, flip: false,
    tick() {
      if (!drv.mode) return;
      poses[drv.mode](C, D, U); if (drv.flip) D.negate();
      if (drv.k < 1) { C.lerpVectors(C0, C, drv.k); D.lerpVectors(D0, D, drv.k).normalize(); U.lerpVectors(U0, U, drv.k).normalize(); }
      orientProp(Q.g, C, D, U);
    },
    async to(tok, mode, dur = 0.25) {
      C0.copy(Q.g.position); D0.set(0, 0, 1).applyQuaternion(Q.g.quaternion); U0.set(0, 1, 0).applyQuaternion(Q.g.quaternion);
      poses[mode](C, D, U); drv.flip = !!Q.sym && D.dot(D0) < 0; drv.mode = mode;
      if (dur > 0) { drv.k = 0; await tween(tok, dur, (q) => { drv.k = ease(q); }); }
      drv.k = 1;
    },
    stop() { drv.mode = null; },
  };
  return drv;
}
const camUp = () => V3(0, 1, 0);
const gripPt = () => handR.rig.inner.localToWorld(V3(0, -0.055, 0.035));
// 입에 문 것을 놓는다: 그 자리에서 떨어져 모래에 눕는다
function dropFromMouth(Q, drv, vel = null) { drv.stop(); Q.state = 'fly'; Q.v.copy(vel || V3(0, 0, 0)); Q.spin = 1.5; Q.spinAx.set(0, 1, 0); }
// 엄마가 손에 들고 보여 준 다음 던진다 (패트병 · 나뭇가지). 던질 곳: 담이에게서 조금 떨어진, 화면에 보이는 빈 자리
const BOTTLE_TOSS = [[0.95, 0.4], [-0.6, 0.15], [0.9, -0.2], [-0.45, -0.35], [0.55, -0.45]]; // 패트병은 가까이 옆으로 (엄마 앞에서 덮치고 깨문다)
async function momToss(tok, Q, drv, squeeze, near = false) {
  Q.g.visible = true; Q.state = 'held';
  let wind = 0;
  const hold = () => roomCam.localToWorld(V3(0.16, -0.19 + wind * 0.14, -0.52 + wind * 0.2));
  handR.want = { pos: hold, up: () => V3(0, -1, 0), curl: 0.6, rate: 6 };
  await drv.to(tok, 'hand', 0);
  setPose(pinky, 'stand', 6); pinky.face = 'cam'; pinky.lookFn = () => Q.g.position; pinky.earPerk = 1; pinky.wagAmpT = 0.9; pinky.wagSpeedT = 18;
  await wait(tok, 0.7);
  if (squeeze) for (let i = 0; i < 2; i++) { // 손으로 쥐어 바삭바삭 소리를 내 보인다
    snd('crinkle', Q.g.position.toArray(), 2); bubble('바삭!', () => Q.g.position.clone().add(V3(0, 0.09, 0)), 'small', 0.7, i ? 50 : -50);
    await tween(tok, 0.32, (q) => { Q.crush = 0.3 * Math.sin(Math.PI * q); Q.shape(); });
    await wait(tok, 0.12);
  }
  say('컹컹!', headTop, '', 1.1); pinky.wagAmpT = 1.05; pinky.wagSpeedT = 24; pinky.paddle = 0.3; pinky.paddleFront = true;
  await wait(tok, 0.6); pinky.paddle = 0; pinky.paddleFront = false;
  await tween(tok, 0.35, (q) => { wind = ease(q); });
  const spots = (near ? BOTTLE_TOSS : RP.THROW).filter(([x, z]) => Math.hypot(x - pinky.x, z - pinky.z) > (near ? 0.6 : 0.9) && Math.hypot(x - DP.duck.x, z - DP.duck.z) > 0.6);
  const [tx, tz] = spots.length ? spots[Math.floor(Math.random() * spots.length)] : RP.THROW[0];
  const from = Q.g.position.clone(), T = 0.8;
  drv.stop(); Q.state = 'fly'; Q.v.set((tx - from.x) / T, (Q.rest - from.y + 0.5 * 9.8 * T * T) / T, (tz - from.z) / T); Q.spinAx.set(0.3, 1, 0.2).normalize(); Q.spin = 7;
  handR.want = { pos: () => roomCam.localToWorld(V3(0.12, -0.08, -0.75)), up: () => V3(0, -1, 0), curl: 0.2, rate: 14 };
  await wait(tok, 0.3); handR.want = null;
  await until(tok, () => Q.state !== 'fly');
}
// 가서 문다: 길이 방향의 가운데를 옆에서 가로로 (나뭇가지 · 패트병)
async function fetchProp(tok, Q, drv, line) {
  if (Q.state === 'fly') await until(tok, () => Q.state !== 'fly');
  const C = Q.g.position.clone(), ax = V3(0, 0, 1).applyQuaternion(Q.g.quaternion); ax.y = 0; ax.normalize();
  const n = V3(-ax.z, 0, ax.x); if (n.dot(V3(pinky.x - C.x, 0, pinky.z - C.z)) < 0) n.negate();
  const st = { x: C.x + n.x * 0.3, z: C.z + n.z * 0.3 }; collide(st);
  setPose(pinky, 'stand', 7); pinky.walkSpeed = 1.0; pinky.lookFn = () => Q.g.position; pinky.wagAmpT = 0.9; pinky.wagSpeedT = 18; pinky.earPerk = 0.5;
  if (line) say(line, headTop, 'soft', 1.3);
  if (Math.hypot(pinky.x - st.x, pinky.z - st.z) > 0.06) await walkTo(tok, st.x, st.z);
  pinky.walkSpeed = 0.5; pinky.face = { x: C.x, z: C.z }; await wait(tok, 0.3);
  setPose(pinky, 'eat', 6); pinky.tgt.headPitch += 0.25; pinky.lookFn = null; await wait(tok, 0.45);
  pinky.jawOpen = 0.32; await wait(tok, 0.15);
  Q.state = 'held'; await drv.to(tok, 'carry', 0.28); pinky.jawOpen = toy.rest = 0.14; say('앙!', headTop, 'small', 0.9);
  await wait(tok, 0.2);
}
// 물고 한 바퀴 신나게 (엄마 앞을 지나 돌아온다)
async function proudLap(tok, speed = 0.78) {
  setPose(pinky, 'stand', 6); pinky.walkSpeed = speed; pinky.tgt.headPitch = -0.18; pinky.earPerk = 0.5; pinky.wagAmpT = 1.0; pinky.wagSpeedT = 20;
  const H = HOME, L = [[H.x + 0.62, H.z - 0.5], [H.x + 0.05, H.z - 1.05], [H.x - 0.6, H.z - 0.55]], s = Math.random() < 0.5 ? 1 : -1;
  for (let i = 0; i < L.length; i++) { const [x, z] = L[s > 0 ? i : L.length - 1 - i]; const q = { x, z }; collide(q); Object.assign(pinky, { walkTarget: { x: q.x, z: q.z }, stuckT: 0, lastP: null, path: null, ghost: false, stuckN: 0, walkT: 0 }); await until(tok, () => !pinky.walkTarget || Math.hypot(pinky.x - q.x, pinky.z - q.z) < 0.3); }
  pinky.walkSpeed = 0.5;
}

// ---------- 간식: 칫솔껌 · 악어껌 — 보는 순간 꼬리가 난리, 받아 물고 엎드려 앞발 사이에 끼우고 오독오독, 점점 짧아지다 꿀꺽
const DTREAT = { brush: ['칫솔껌 결재 완료!', '이빨 반짝반짝~!', '양치 끝! 하나 더요?'], gator: ['악어 퇴치 완료!', '악어껌 최고예요!', '악어 한 마리 더요!'] };
async function damiTreat(tok, kind) {
  if (!DTREAT[kind]) kind = rot('dtreat', ['brush', 'gator']);
  const T = DP[kind], ph = phoneK(), UP = V3(0, 1, 0);
  toy.tok = tok; tok.cleanups.push(() => { toyOff(); damiTreatWag(false); T.hide(); });
  { const [p, a] = kneelFor(HOME, 1.05 * ph, 0.54, 0.3); camTo(p, a); } // 조금 물러나 살짝 높게: 건네는 손에 입이 덜 가린다
  T.reset(); T.g.visible = true; T.state = 'held'; toy.fill = 1;
  const pinch = () => handR.rig.inner.localToWorld(V3(0.012, -0.034, 0.072));
  let side = 1;
  const drv = propDriver(T, {
    hand(C, D, U) { const B = pinch(), v = mouthPt().sub(B); v.y -= 0.04; v.normalize(); C.copy(B).addScaledVector(v, T.len); D.copy(v).negate(); U.copy(UP); }, // 손잡이 끝을 쥐고 솔머리를 담이 쪽으로
    jaw(C, D, U) { C.copy(jawW(0.008, -0.01, 0.05)); D.copy(jawDir(0.8, -0.15, 0.55)).normalize(); U.copy(jawDir(0, 1, 0)); }, // 입가에 비스듬히 물고 있다 (앞에서도 보이게)
    paws(C, D, U) { // 어금니 쪽으로 물고, 반대쪽 끝은 두 앞발 사이 바닥에
      C.copy(jawW(side * 0.012, -0.012, 0.05)); const B = rootW(0, 0.012, 0.37), l = T.len, d = B.distanceTo(C), dy = Math.max(C.y - 0.008, 0);
      D.copy(B).sub(C).normalize();
      if (d < l) { if (dy >= l) D.set(0, -1, 0); else { const hx = B.x - C.x, hz = B.z - C.z, hl = Math.hypot(hx, hz) || 1, hh = Math.sqrt(l * l - dy * dy); D.set((hx / hl) * hh, -dy, (hz / hl) * hh).normalize(); } }
      U.copy(UP);
    },
  });
  toy.tick = () => drv.tick();
  let target = () => roomCam.localToWorld(ph > 1 ? V3(0.05, -0.03, -0.5) : V3(0.13, -0.045, -0.46));
  handR.want = { pos: () => target(), up: () => V3(0, 1, 0), curl: 0.75, rate: 5 };
  await drv.to(tok, 'hand', 0);
  pinky.lookFn = () => T.g.position;
  await wait(tok, 0.35);
  damiTreatWag(true); pinky.earPerk = 1; say('컹컹!', headTop, '', 1.0); // 보자마자 꼬리가 난리
  await wait(tok, 0.55); say('간식이다!', headTop, 'soft', 1.3);
  if (Math.hypot(pinky.x - HOME.x, pinky.z - HOME.z) > 0.08) { setPose(pinky, 'stand', 7); pinky.walkSpeed = 1.0; await walkTo(tok, HOME.x, HOME.z); pinky.walkSpeed = 0.5; }
  await sitAs(tok, 'front', 8);
  pinky.paddle = 0.4; pinky.paddleFront = true; // 앞발을 동동 (빨리 주세요!)
  await wait(tok, 1.1); pinky.paddle = 0; pinky.paddleFront = false;
  // 내밀면 목을 빼 덥석
  const v0 = toCamDir().negate().multiplyScalar(0.6).addScaledVector(camRight(), -0.8); v0.y = 0.1; v0.normalize(); // 옆(오른쪽 아래)에서 내민다: 손이 입을 가리지 않고 덥석 무는 게 보이게
  target = () => { const m = mouthPt().addScaledVector(toCamDir(), 0.014); return m.addScaledVector(v0, -T.len).sub(pinch().sub(handR.pos)); };
  handR.want.rate = 4; await wait(tok, 0.85);
  pinky.tgt.reach = 0.035; pinky.tgt.neck += 0.12; await wait(tok, 0.3);
  pinky.jawOpen = 0.3; await wait(tok, 0.22);
  say('앙', headTop, 'small', 1); handR.want.curl = 0.3;
  await drv.to(tok, 'jaw', 0.2); pinky.jawOpen = toy.rest = 0.12;
  handR.want = null; pinky.lookFn = null; pinky.tgt.reach = 0; pinky.tgt.neck = POSES.sit.neck;
  await wait(tok, 0.8);
  // 엎드려 앞발 사이에 끼우고
  setPose(pinky, 'down', 3); pinky.tgt.yawOff = -0.45; damiTreatWag(false); pinky.wagAmpT = 0.75; pinky.wagSpeedT = 16; pinky.earPerk = 0;
  { const [p, a] = kneelAt(0.92 * ph, 0.3, 0.14); camTo(p, a, 1.8); }
  await wait(tok, 1.25);
  const pawPt = () => rootW(0, 0.012, 0.37);
  let lookUp = 0; pinky.lookFn = () => pawPt().add(V3(0, 0.1 + lookUp, 0)).addScaledVector(toCamDir(), 0.08 + lookUp * 1.5);
  pinky.tgt.gaze = 0.6; pinky.tgt.neck = 0.2; pinky.tgt.reach = 0.02;
  pinky.tgt.paws[0].set(0.043, 0.04, 0.335); pinky.tgt.paws[1].set(-0.043, 0.04, 0.335);
  await wait(tok, 0.45);
  await drv.to(tok, 'paws', 0.35); toy.rest = 0; pinky.eyeOpen = 0.85;
  const words = kind === 'brush' ? ['오독', '오독오독', '아작아작', '오독오독', '아작'] : ['아작', '와작와작', '오독오독', '아작아작', '와작'];
  toy.chewKind = 'crunch';
  for (let i = 0; i < 5; i++) {
    side = i < 2 ? 1 : i < 4 ? -1 : 1; pinky.tiltT = side * 0.42; toy.chew = 1; toy.chewRate = 10; pinky.tgt.gaze = 0.6 + 0.05 * i; // 어금니로 옆으로 물고 씹는다 (짧아질수록 고개를 더 숙인다)
    sideSay(words[i], i);
    await wait(tok, 1.0);
    T.setLen(T.k - 0.19); spawnCrumbs(jawW(0, -0.012, 0.05), 3, T.crumb);
    if (i === 1 || i === 3) { toy.chewRate = 13; lookUp = 0.16; pinky.eyeOpen = 1; pinky.wagAmpT = 1.0; pinky.wagSpeedT = 22; await wait(tok, 0.55); pinky.eyeOpen = 0.85; pinky.wagAmpT = 0.75; pinky.wagSpeedT = 16; }
    lookUp = 0; await wait(tok, 0.12);
  }
  // 마지막 한 입
  T.g.visible = false; T.state = 'none'; drv.stop(); pinky.lookFn = null; pinky.tgt.gaze = 1; pinky.tgt.neck = 0; pinky.tgt.reach = 0; pinky.tiltT = 0;
  { const dp = poseFor('down', pinky); pinky.tgt.paws[0].copy(dp.paws[0]); pinky.tgt.paws[1].copy(dp.paws[1]); }
  toy.chewRate = 15; await wait(tok, 0.7); toy.chew = 0; say('꿀꺽', headTop, 'small', 1.0);
  await wait(tok, 0.5);
  pinky.lick = 1; say('쩝쩝', headTop, '', 1.2, 80); await wait(tok, 0.95); pinky.lick = 0; // 긴 혀로 입가를 쓱
  await sitAs(tok, 'front', 5);
  damiTreatWag(true); pinky.tiltT = 0.25; pinky.earPerk = 0.5;
  say(rot('dt:' + kind, DTREAT[kind]), headTop, 'soft', 2.0); heart();
  await wait(tok, 1.9); damiTreatWag(false); pinky.tiltT = 0; pinky.earPerk = 0;
  T.hide(); toyOff(); camHome();
}

// ---------- 패트병: 덮쳐서 앞발로 누르고 바삭바삭 깨물고, 물고 한 바퀴 돌다 엄마 앞에 내려놓는다
async function bottlePlay(tok, solo = false) {
  const B = DP.bottle;
  toy.tok = tok;
  const drv = propDriver(B, {
    hand(C, D, U) { C.copy(gripPt()); D.copy(V3(1, 0.35, 0).transformDirection(roomCam.matrixWorld)); U.copy(camUp()); },
    pin(C, D, U) { C.copy(rootW(0, B.rest * (1 - 0.35 * B.crush), 0.37)); D.copy(rootDir(1, 0, 0)); U.set(0, 1, 0); }, // 앞발 밑에 가로로
    carry(C, D, U) { C.copy(jawW(0, -0.004, 0.048)); D.copy(jawDir(1, 0, 0)); U.copy(jawDir(0, 1, 0)); }, // 가운데를 가로로 문다
  });
  toy.tick = () => drv.tick(); tok.cleanups.push(() => { drv.stop(); });
  if (B.state !== 'ground' && B.state !== 'fly') { if (solo) return; B.reset(); await momToss(tok, B, drv, true, true); }
  else if (!solo) say('내 패트병!', headTop, 'soft', 1.3);
  if (B.state === 'fly') await until(tok, () => B.state !== 'fly');
  mark('toy:bottle');
  // 덮치기: 가까이 가서 놀자 자세 → 폴짝
  const C = B.g.position.clone(); let f = V3(C.x - pinky.x, 0, C.z - pinky.z); const fl = f.length() || 1; f.multiplyScalar(1 / fl);
  setPose(pinky, 'stand', 7); pinky.walkSpeed = 1.05; pinky.lookFn = () => B.g.position; pinky.wagAmpT = 0.95; pinky.wagSpeedT = 19; pinky.earPerk = 0.6;
  if (fl > 0.75) { const q = { x: C.x - f.x * 0.62, z: C.z - f.z * 0.62 }; collide(q); await walkTo(tok, q.x, q.z); }
  pinky.walkSpeed = 0.5; pinky.face = { x: C.x, z: C.z }; await wait(tok, 0.25);
  setPose(pinky, 'bow', 8); pinky.wagAmpT = 1.0; pinky.wagSpeedT = 22; if (!solo) say('컹!', headTop, '', 0.9); await wait(tok, 0.65);
  f = V3(C.x - pinky.x, 0, C.z - pinky.z).normalize();
  const p0 = { x: pinky.x, z: pinky.z }, p1 = { x: C.x - f.x * 0.37, z: C.z - f.z * 0.37 }; collide(p1);
  setPose(pinky, 'stand', 10); pinky.liftT = 0.06; pinky.lookFn = null; pinky.face = { x: C.x, z: C.z }; tok.hop = true; // 폴짝 (점검용 표시: 이때는 떠 있는 게 맞다)
  await tween(tok, 0.32, (q) => { const e = ease(q); pinky.x = lerp(p0.x, p1.x, e); pinky.z = lerp(p0.z, p1.z, e); });
  pinky.liftT = 0; setPose(pinky, 'down', 7); pinky.tgt.paws[0].set(0.052, 0.062, 0.35); pinky.tgt.paws[1].set(-0.052, 0.062, 0.35);
  B.state = 'held'; B.a0 = Math.PI / 2; await drv.to(tok, 'pin', 0.3);
  snd('crinkle', B.g.position.toArray(), 0);
  if (!solo) { const fw = rootDir(0, 0, 1), tc = V3(CAM_POS.x - pinky.x, 0, CAM_POS.z - pinky.z).normalize(), dd = fw.clone().add(tc).normalize(), ph = phoneK() ** 2; camTo(V3(pinky.x + dd.x * 1.25 * ph, 0.55 * Math.sqrt(ph), pinky.z + dd.z * 1.25 * ph), V3(pinky.x + fw.x * 0.12, 0.1, pinky.z + fw.z * 0.12), 1.8); } // 덮친 담이를 앞쪽 비스듬히에서 본다 (세로 화면은 몸이 잘리지 않게 더 멀리)
  // 바삭바삭 깨문다 (고개를 숙여 병 가운데를 물고 짧게 흔든다)
  const biteAt = () => B.g.position.clone().add(V3(0, 0.01, 0)); pinky.lookFn = biteAt; pinky.tgt.gaze = 0.9; pinky.tgt.neck = 0.45; pinky.tgt.reach = 0.045; pinky.eyeOpen = 0.85;
  toy.chewKind = 'bottle'; toy.chewRate = 8;
  const words = ['바삭바삭', '와그작', '바삭!', '바삭바삭'];
  for (let i = 0; i < (solo ? 3 : 4); i++) {
    toy.chew = 1; sideSay(words[i], i); toy.shake = 0.4; toy.shakeHz = 4.2; toy.shakeAmp = 0.6; pinky.tiltT = (i % 2 ? -1 : 1) * 0.25;
    await wait(tok, 0.85); B.bite(); toy.shake = 0; toy.chew = 0;
    if (i === 1) { pinky.lookFn = null; pinky.tgt.gaze = 1; pinky.tgt.neck = 0.2; pinky.tiltT = 0.2; pinky.wagAmpT = 1; pinky.wagSpeedT = 20; await wait(tok, 0.5); pinky.lookFn = biteAt; pinky.tgt.gaze = 0.9; pinky.tgt.neck = 0.45; } // 신나서 한 번 쳐다보고
    await wait(tok, 0.15);
  }
  pinky.tiltT = 0; pinky.lookFn = null; pinky.tgt.gaze = 1; pinky.tgt.neck = 0; pinky.tgt.reach = 0; tok.hop = false;
  // 물고 일어나 한 바퀴
  setPose(pinky, 'stand', 5); await wait(tok, 0.55);
  pinky.jawOpen = 0.3; await wait(tok, 0.12); await drv.to(tok, 'carry', 0.28); pinky.jawOpen = toy.rest = 0.15;
  bubble('내 패트병~', headTop, 'soft', 1.3);
  if (!solo) camHome();
  await proudLap(tok, 0.72);
  if (!solo) { await walkTo(tok, HOME.x, HOME.z); await sitAs(tok, 'front', 6); await wait(tok, 0.5); }
  else { pinky.face = 'cam'; await wait(tok, 0.6); }
  pinky.jawOpen = 0.32; toy.rest = 0; dropFromMouth(B, drv, toCamDir().multiplyScalar(0.45).add(V3(0, 0.3, 0))); await wait(tok, 0.25); pinky.jawOpen = 0;
  await until(tok, () => B.state !== 'fly');
  pinky.tiltT = 0.25; pinky.earPerk = 0.6; pinky.wagAmpT = 0.95; pinky.wagSpeedT = 19;
  say(solo ? '바삭바삭 최고!' : rot('bottle', ['또 던져 주세요!', '패트병 접수 완료!', '바삭바삭 최고!']), headTop, 'soft', 1.9);
  await wait(tok, 2.0); pinky.tiltT = 0; pinky.earPerk = 0; toyOff();
}

// ---------- 나뭇가지: 입에 가로로 물고(머리보다 훨씬 넓다) 의기양양하게 한 바퀴, 엎드려 앞발 사이에 끼우고 와그작
async function stickPlay(tok, solo = false) {
  const S = DP.stick; let side = 1;
  toy.tok = tok;
  const drv = propDriver(S, {
    hand(C, D, U) { const gp = gripPt(), d = V3(0.6, 0.75, -0.2).transformDirection(roomCam.matrixWorld); C.copy(gp).addScaledVector(d, S.L * 0.3); D.copy(d); U.copy(V3(0, 0, 1).transformDirection(roomCam.matrixWorld)); }, // 한쪽 끝 가까이를 쥐고 비스듬히 세워 보인다
    carry(C, D, U) { C.copy(jawW(0, -0.004, 0.044)); D.copy(jawDir(1, 0, 0)); U.copy(jawDir(0, 1, 0)); },
    paws(C, D, U) { // 한쪽 끝을 어금니로 물고, 나머지는 앞발 사이로 비스듬히 바닥에
      const E = jawW(side * 0.01, -0.01, 0.05), B = rootW(0.5 * side, 0.0155, 0.36), dy = Math.max(E.y - 0.0125, 0), hx = B.x - E.x, hz = B.z - E.z, hl = Math.hypot(hx, hz) || 1, half = S.L;
      const hh = Math.sqrt(Math.max(1e-6, half * half - Math.min(dy, half * 0.95) ** 2)); D.set((hx / hl) * hh, -Math.min(dy, half * 0.95), (hz / hl) * hh).normalize();
      C.copy(E).addScaledVector(D, S.L * 0.5); U.set(0, 1, 0);
    },
  });
  toy.tick = () => drv.tick(); tok.cleanups.push(() => { drv.stop(); });
  if (S.state !== 'ground' && S.state !== 'fly') { if (solo) return; await momToss(tok, S, drv, false); }
  mark('toy:stick');
  await fetchProp(tok, S, drv, S.state === 'ground' && !solo && clock - tok.t0 < 1 ? '내 나뭇가지!' : null);
  // 의기양양: 고개를 들고 꼬리를 세워 한 바퀴 (가지가 머리보다 훨씬 넓다)
  setPose(pinky, 'stand', 5); pinky.tgt.headPitch = -0.2; pinky.earPerk = 0.6; pinky.wagAmpT = 1.0; pinky.wagSpeedT = 20; pinky.face = 'cam';
  await wait(tok, 0.5); bubble(solo ? '득템!' : '나뭇가지 득템!', headTop, 'soft', 1.4); await wait(tok, 0.6);
  await proudLap(tok, 0.75);
  if (!solo) bubble('비켜요~ 담과장 지나갑니다!', headTop, 'soft', 1.6);
  // 엄마 앞에 와서 엎드려 질겅질겅
  const H = { x: HOME.x + (solo ? 0.3 : 0.05), z: HOME.z - (solo ? 0.6 : 0.12) }; collide(H);
  setPose(pinky, 'stand', 6); pinky.walkSpeed = 0.6; await walkTo(tok, H.x, H.z); pinky.walkSpeed = 0.5;
  pinky.face = 'cam'; pinky.tgt.yawOff = -0.5; await wait(tok, 0.5);
  setPose(pinky, 'down', 4); pinky.tgt.yawOff = -0.5; pinky.wagAmpT = 0.6; pinky.wagSpeedT = 12; pinky.earPerk = 0;
  if (!solo) { const [p, a] = kneelAt(1.25 * phoneK(), 0.5, 0.14); camTo(p, a, 1.8); }
  await wait(tok, 1.2);
  side = 1; await drv.to(tok, 'paws', 0.45); toy.rest = 0;
  pinky.tgt.paws[0].set(0.05, 0.04, 0.34); pinky.lookFn = () => rootW(0.06, 0.1, 0.42); pinky.tgt.gaze = 0.65; pinky.tgt.neck = 0.18; pinky.tgt.reach = 0.02; pinky.eyeOpen = 0.85;
  toy.chewKind = 'wood'; toy.chewRate = 8;
  const words = ['와그작', '아작아작', '질겅질겅', '와그작'];
  for (let i = 0; i < (solo ? 3 : 4); i++) {
    toy.chew = 1; sideSay(words[i], i); pinky.tiltT = 0.4;
    await wait(tok, 1.05); spawnCrumbs(jawW(0, -0.01, 0.05), 2, DP.stickCrumb || (DP.stickCrumb = M(0x8a6a48)));
    if (i === 1) { toy.chew = 0; pinky.lookFn = null; pinky.tgt.gaze = 1; pinky.tiltT = 0.15; pinky.wagAmpT = 0.95; pinky.wagSpeedT = 19; await wait(tok, 0.6); pinky.lookFn = () => rootW(0.06, 0.1, 0.42); pinky.tgt.gaze = 0.65; pinky.wagAmpT = 0.6; pinky.wagSpeedT = 12; }
  }
  toy.chew = 0; pinky.tiltT = 0; pinky.lookFn = null; pinky.tgt.gaze = 1; pinky.tgt.neck = 0; pinky.tgt.reach = 0;
  { const dp = poseFor('down', pinky); pinky.tgt.paws[0].copy(dp.paws[0]); }
  drv.stop(); layFlat(S, S.g.position.x, S.g.position.z); // 앞발 앞에 내려놓는다
  await wait(tok, 0.4);
  pinky.earPerk = 0.5; pinky.tiltT = 0.22; pinky.wagAmpT = 0.85; pinky.wagSpeedT = 17;
  say(solo ? '내 나뭇가지!' : rot('stick', ['이건 담과장 거예요!', '최고의 나뭇가지!', '아무한테도 안 줘요!']), headTop, 'soft', 1.9);
  await wait(tok, 2.0); pinky.tiltT = 0; pinky.earPerk = 0; toyOff(); if (!solo) camHome();
}

// ---------- 오둥이 쿠션: 날개를 물고 뒷걸음질로 질질 끌고 와서 흔들어 혼내 주고(괜히 센 척), 털썩 엎어져 턱을 괴고 쉰다
async function duckPlay(tok, solo = false) {
  const K = DP.duck, ph = phoneK();
  toy.tok = tok; K.busy = true;
  tok.cleanups.push(() => { K.busy = false; K.sqT = 0; if (K.state === 'drag') K.put(); pinky.liftT = 0; pinky.shuffle = 0; });
  mark('toy:duck');
  const nI = Math.hypot(DUCK_SPOTS[0][0] - K.x, DUCK_SPOTS[0][1] - K.z) > Math.hypot(DUCK_SPOTS[1][0] - K.x, DUCK_SPOTS[1][1] - K.z) ? 0 : 1;
  const [nx, nz, nyaw] = DUCK_SPOTS[nI], mv = { x: nx - K.x, z: nz - K.z }, dist = Math.hypot(mv.x, mv.z);
  const xw = V3(Math.cos(K.yaw), 0, -Math.sin(K.yaw)), sideOf = Math.sign(xw.x * mv.x + xw.z * mv.z) || 1; // 끌고 갈 쪽 날개를 문다 (뒷걸음질로 똑바로 당기게)
  if (!solo) { const [p, a] = kneelFor({ x: (K.x + nx) / 2, z: (K.z + nz) / 2 }, 1.75 * ph, 0.95, 0.12); camTo(p, a, 1.6); }
  setPose(pinky, 'stand', 6); pinky.lookFn = () => K.g.position; pinky.wagAmpT = 0.95; pinky.wagSpeedT = 19; pinky.earPerk = 0.6;
  say(solo ? '오둥아~' : '오둥아~!', headTop, 'soft', 1.3);
  const grabL = V3(sideOf * 0.235, 0.026, 0.02), w0 = K.local(grabL.x, grabL.y, grabL.z), out = xw.clone().multiplyScalar(sideOf);
  const st = { x: w0.x + out.x * 0.3, z: w0.z + out.z * 0.3 };
  pinky.walkSpeed = 0.9; await walkTo(tok, st.x, st.z); pinky.walkSpeed = 0.5;
  pinky.face = { x: w0.x, z: w0.z }; await wait(tok, 0.4);
  setPose(pinky, 'eat', 6); pinky.tgt.headPitch -= 0.1; pinky.lookFn = null; await wait(tok, 0.4);
  pinky.jawOpen = 0.32; await wait(tok, 0.15); pinky.jawOpen = toy.rest = 0.12; say('앙!', headTop, 'small', 0.9);
  // 끌기: 뒷걸음질 치며 당긴다 (오둥이는 문 날개를 따라 질질, 한쪽이 들린다)
  K.state = 'drag'; K.lift = 0; const off = V3(), yawA = K.yaw; let yawNow = K.yaw, wob = 0;
  toy.tick = () => {
    if (K.state !== 'drag') return;
    const m = jawW(0, -0.01, 0.05), yaw = yawNow + wob, th = clamp(Math.atan2(m.y - 0.03, 0.42), 0, 0.5) * K.lift;
    off.set(grabL.x * Math.cos(th), 0, grabL.z).multiplyScalar(DUCK_S).applyAxisAngle(_yAx, yaw);
    K.x = m.x - off.x; K.z = m.z - off.z; K.yaw = yaw; K.g.position.set(K.x, 0.2 * Math.sin(th), K.z); K.g.rotation.set(0, yaw, sideOf * th);
  };
  setPose(pinky, 'tug', 5); pinky.tgt.gaze = 0.4; await tween(tok, 0.4, (q) => { K.lift = 0.6 * q; });
  if (dist > 0.05) {
    const yaw0 = pinky.yaw, from = { x: pinky.x, z: pinky.z };
    pinky.face = null; pinky.shuffle = 0.9; bubble('영차영차!', headTop, 'soft', 1.4);
    await tween(tok, Math.max(1.2, dist / 0.3), (q) => { const e = ease(q); pinky.x = from.x + mv.x * e; pinky.z = from.z + mv.z * e; pinky.yaw = yaw0; yawNow = yawA + angDiff(yawA, nyaw) * e; K.lift = 0.45 + 0.35 * Math.sin(q * Math.PI * 7) ** 2; });
    pinky.shuffle = 0;
  }
  // 흔들어 혼내 주기 (괜히 센 척)
  setPose(pinky, 'stand', 6); pinky.tgt.headPitch = -0.1; pinky.face = { x: K.x, z: K.z }; await tween(tok, 0.3, (q) => { K.lift = lerp(0.6, 1, q); });
  say('으르르~!', headTop, '', 1.1); toy.shake = 1; toy.shakeHz = 3.2; toy.shakeAmp = 0.85;
  await tween(tok, 1.5, () => { wob = pinky.hp.rotation.y * 0.5; });
  toy.shake = 0; wob = 0; await wait(tok, 0.3);
  if (!solo) say('내가 이겼다!', headTop, 'soft', 1.3);
  pinky.jawOpen = 0.3; toy.rest = 0; toy.tick = null; K.put(); await wait(tok, 0.3); pinky.jawOpen = 0;
  // 털썩: 오둥이 배 위로 폴짝 올라가 엎드려 턱을 괸다 (엄마 쪽을 보며)
  const ax = V3(Math.sin(K.yaw), 0, Math.cos(K.yaw)), top = { x: K.x + ax.x * 0.05, z: K.z + ax.z * 0.05 };
  const n = V3(pinky.x - top.x, 0, pinky.z - top.z); n.multiplyScalar(1 / (n.length() || 1));
  const edge = { x: top.x + n.x * 0.45, z: top.z + n.z * 0.45 };
  setPose(pinky, 'stand', 6); pinky.walkSpeed = 0.5; if (Math.hypot(pinky.x - edge.x, pinky.z - edge.z) > 0.05) await walkTo(tok, edge.x, edge.z);
  pinky.face = { x: top.x, z: top.z }; await wait(tok, 0.45);
  const p0 = { x: pinky.x, z: pinky.z }; pinky.liftT = 0.085;
  await tween(tok, 0.45, (q) => { const e = ease(q); pinky.x = lerp(p0.x, top.x, e); pinky.z = lerp(p0.z, top.z, e); });
  setPose(pinky, 'down', 5); pinky.face = 'cam'; pinky.tgt.yawOff = -0.35; pinky.wagAmpT = 0.7; pinky.wagSpeedT = 14; K.sqT = 1;
  snd('sfx', 'flop_soft', { pos: [K.x, 0.08, K.z], gain: -1, why: 'flop on duck' }); bubble('털썩', headTop, 'small', 0.9);
  await wait(tok, 0.7);
  pinky.tgt.headPitch = 0.62; pinky.tgt.gaze = 0.15; pinky.tgt.neck = 0.25; pinky.eyeOpen = 0.5; pinky.wagAmpT = 0.4; pinky.wagSpeedT = 6; // 턱을 오둥이 배에 괴고 눈을 반쯤 감는다
  await tween(tok, 2.0, (k) => { pinky.sigh = Math.sin(Math.PI * k) ** 2; }); pinky.sigh = 0;
  say(rot('duck', ['푹신해요~', '오둥이 최고~', '여기가 명당이에요~']), headTop, 'soft', 1.8); if (!solo) heart();
  await wait(tok, solo ? 4.0 : 2.4);
  // 일어나 내려온다
  pinky.eyeOpen = 1; K.sqT = 0; setPose(pinky, 'stand', 4); await wait(tok, 0.7);
  const cr = camRight(), sg = (HOME.x - top.x) * cr.x + (HOME.z - top.z) * cr.z > 0 ? 1 : -1, off2 = { x: top.x + cr.x * sg * 0.64, z: top.z + cr.z * sg * 0.64 }; RP.clamp(off2); // 옆으로 내려온다 (엄마 쪽으로)
  pinky.liftT = 0; await walkTo(tok, off2.x, off2.z);
  K.busy = false; pinky.face = 'cam'; pinky.wagAmpT = 0.7; pinky.wagSpeedT = 14; await wait(tok, 0.5);
  toyOff(); if (!solo) camHome();
}

// ---------- 땅 파기: 킁킁 → 파바박(앞발을 번갈아 빠르게, 모래가 뒤로 휙휙) → 구덩이에 코 박고 킁킁 → 가끔 뭘 찾는다 → 에취 → 뿌듯
async function damiDig(tok, solo = false) {
  mark('dig');
  let S = null;
  if (solo) { // 지금 있는 곳 근처 모래밭의 빈 자리
    for (let i = 0; i < 8 && !S; i++) { const q = { x: pinky.x + (Math.random() - 0.5) * 1.4, z: pinky.z + (Math.random() - 0.5) * 1.4 }; if (inSand(q.x, q.z) && navFree(q.x, q.z, 0.4) && q.z < 1.6) S = q; }
    if (!S) S = { x: pinky.x, z: pinky.z };
  } else S = { x: HOME.x - 0.1, z: HOME.z - 0.42 };
  const s = rot('digside', [1, -1]), c = roomCam.position, cy = Math.atan2(c.x - S.x, c.z - S.z), yaw = cy + s * 1.2; // 옆모습: 뒤로 튀는 모래가 보이게
  setPose(pinky, 'stand', 6); pinky.walkSpeed = 0.8; pinky.tgt.gaze = 0; pinky.tgt.headPitch = 0.5; pinky.sniff = 0.5;
  if (Math.hypot(pinky.x - S.x, pinky.z - S.z) > 0.06) await walkTo(tok, S.x, S.z);
  pinky.walkSpeed = 0.5; pinky.face = { x: pinky.x + Math.sin(yaw), z: pinky.z + Math.cos(yaw) };
  { const t0 = clock; await until(tok, () => Math.abs(angDiff(pinky.yaw, yaw)) < 0.15 || clock - t0 > 1.2); }
  if (!solo) { const [p, a] = kneelFor({ x: pinky.x, z: pinky.z }, 1.65 * phoneK(), 0.8, 0.16); camTo(p, a, 1.8); }
  setPose(pinky, 'eat', 6); pinky.sniff = 1; say('킁킁', noseTip); await wait(tok, 0.9);
  pinky.sniff = 0; setPose(pinky, 'stand', 7); pinky.earPerk = 0.7; pinky.tgt.gaze = 0; pinky.tgt.headPitch = 0.45; say('여기다!', headTop, 'soft', 1.0); await wait(tok, 0.5);
  // 구덩이 (가장 오래된 것을 다시 쓴다)
  const pit = DP.pits.reduce((a, b) => (b.age > a.age ? b : a)), hp = rootW(0, 0, 0.29), bp = rootW(0, 0, -0.5);
  Object.assign(pit, { k: 0, pk: 0, age: 0, x: hp.x, z: hp.z }); pit.g.position.set(hp.x, 0, hp.z); pit.pile.position.set(bp.x, 0.003, bp.z); pit.pile.rotation.y = pinky.yaw; DP.digPit = pit;
  tok.cleanups.push(() => { pinky.dig = 0; DP.digPit = null; });
  const bout = async (sec, line) => {
    setPose(pinky, 'dig', 8); pinky.wagAmpT = 1.0; pinky.wagSpeedT = 20; pinky.earPerk = -0.2; pinky.eyeOpen = 0.8;
    await wait(tok, 0.25); pinky.dig = 1; say(line, headTop, '', 1.1);
    await wait(tok, sec); pinky.dig = 0;
    setPose(pinky, 'eat', 6); pinky.tgt.headPitch += 0.35; pinky.tgt.reach = 0.1; pinky.sniff = 1; pinky.eyeOpen = 1; say('킁킁', noseTip); // 구덩이에 코를 박고
    await wait(tok, 0.95); pinky.sniff = 0;
  };
  await bout(2.3, '파바박!');
  await bout(solo ? 1.4 : 1.8, '파바바박!');
  DP.digPit = null;
  // 무엇이 나왔나
  const r = brain.force.dig ?? Math.random(), stick = DP.stick;
  if (r < 0.35) { // 간식 조각이 묻혀 있었다
    mark('dig:treat'); setPose(pinky, 'stand', 6); pinky.earPerk = 1; bubble('!', headTop, '', 0.9); await wait(tok, 0.3);
    const dr = dropTreat(pit.x, pit.z, 'bit'); await findTreat(tok, dr);
  } else if (r < 0.6 && stick.state === 'none') { // 나뭇가지가 나왔다
    mark('dig:stick'); stick.g.visible = true; orientProp(stick.g, V3(pit.x, 0.002, pit.z), rootDir(1, 0, 0.35), _yAx); stick.state = 'ground';
    const drv = propDriver(stick, { carry(C, D, U) { C.copy(jawW(0, -0.004, 0.044)); D.copy(jawDir(1, 0, 0)); U.copy(jawDir(0, 1, 0)); } });
    toy.tok = tok; toy.tick = () => drv.tick(); tok.cleanups.push(() => { drv.stop(); });
    bubble('!', headTop, '', 0.9); pinky.earPerk = 1; await wait(tok, 0.4);
    pinky.jawOpen = 0.3; await wait(tok, 0.15); stick.state = 'held'; await drv.to(tok, 'carry', 0.45); pinky.jawOpen = toy.rest = 0.14;
    setPose(pinky, 'stand', 4); pinky.tgt.headPitch = -0.25; pinky.face = 'cam'; pinky.wagAmpT = 1.0; pinky.wagSpeedT = 21; pinky.earPerk = 0.6;
    await wait(tok, 0.6); bubble('나뭇가지 발굴!', headTop, 'soft', 1.6); await wait(tok, 1.6);
    pinky.jawOpen = 0.3; toy.rest = 0; dropFromMouth(stick, drv, rootDir(0.6, 0.4, 0.2)); await wait(tok, 0.3); pinky.jawOpen = 0; toyOff();
    await until(tok, () => stick.state !== 'fly');
  } else { setPose(pinky, 'stand', 6); pinky.tiltT = 0.2; say('여긴 없네~', headTop, 'soft', 1.4); await wait(tok, 1.3); pinky.tiltT = 0; }
  // 모래가 코에 들어가 에취 · 또는 부르르
  if ((brain.force.sneeze ?? Math.random() < 0.55) && cdOK('sneeze', 20)) { brain.cd.sneeze = clock; setPose(pinky, 'stand', 6); await sneeze(tok); }
  else if (Math.random() < 0.5) await shakeOff(tok);
  setPose(pinky, 'stand', 6); pinky.face = 'cam'; pinky.tgt.gaze = 1; pinky.tgt.headPitch = 0; pinky.earPerk = 0.5; pinky.wagAmpT = 0.9; pinky.wagSpeedT = 18; pinky.tiltT = 0.2;
  await wait(tok, 0.4); say(rot('dig', ['땅 파기 완료!', '컹! 굴착 성공!', '여기 내 구역이에요!']), headTop, 'soft', 1.8);
  await wait(tok, 1.8); pinky.tiltT = 0; pinky.earPerk = 0;
  if (!solo) camHome();
}
// 장난감 고르기 (놀이터): 공은 원래대로 · 로프는 놀이터에 없다(나뭇가지로)
function damiToy(tok, kind) { return kind === 'bottle' ? bottlePlay(tok) : kind === 'duck' ? duckPlay(tok) : stickPlay(tok); }
// 혼자 놀 때 가끔: 모래 위에 있는 장난감으로 (없으면 오둥이에게)
function damiToyIdle(tok) {
  const c = ['duck']; if (DP.stick.state === 'ground') c.push('stick', 'stick'); if (DP.bottle.state === 'ground') c.push('bottle');
  const k = brain.force.toy || c[Math.floor(Math.random() * c.length)];
  return k === 'stick' ? stickPlay(tok, true) : k === 'bottle' ? bottlePlay(tok, true) : duckPlay(tok, true);
}

// ================================================================
// 푸푸의 남산 산책길 — 옅은 포장길 · 돌 경계석 · 길 옆으로 흐르는 얕은 시냇물(바위 · 자갈 · 붓꽃 · 갈대) · 초록 언덕과 나무(소나무) · 부드러운 낮빛
// 처음 들어갈 때 한 번만 짓는다. 보는 사람은 +z 쪽 길가에 서서 -z(길이 멀어지는 쪽)를 본다: 길은 왼쪽, 시냇물은 오른쪽에서 나란히 흘러온다
// 땅 높이는 nsGround 하나가 정한다 (시냇물 바닥은 움푹 · 길 양옆 너머는 언덕) — 푸푸는 그 높이를 따라 걷는다(물에 들어가면 다리가 물에 잠긴다)
// ================================================================
const NS_PX = (z) => -0.55 - 0.016 * Math.max(0, -z - 3) ** 2; // 길 가운데 (멀리서 왼쪽으로 굽어 사라진다)
const NS_PW = 1.0; // 길 반폭
const NS_SX = (z) => 1.52 + 0.2 * Math.sin(0.62 * z + 0.4) - 0.007 * Math.max(0, -z - 3) ** 2; // 시냇물 가운데 (구불구불)
const NS_SW = (z) => 0.5 + 0.07 * Math.sin(1.1 * z + 2.0); // 시냇물 반폭
const NS_RISE = (z) => 1.4 * ss(-5, -26, z); // 멀리 갈수록 오르막 (물은 보는 사람 쪽으로 흘러온다)
const NS_WATER = -0.02; // 물 높이 (가까운 곳 · 길 높이 0 기준) — 냇바닥 가운데는 -0.085
function nsGround(x, z) {
  const sx = NS_SX(z), sw = NS_SW(z), u = Math.abs(x - sx) / sw;
  let y = -0.085 * (1 - ss(0.5, 1.12, u)); // 냇바닥: 가운데는 평평하고 물가로 완만하게 올라온다
  const right = x - (sx + sw), left = NS_PX(z) - NS_PW - x;
  if (right > 0.25) y += 0.3 * ss(0.25, 1.6, right) + 2.6 * ss(1.4, 9, right); // 냇물 건너편 둑 → 언덕
  if (left > 0.35) y += 0.22 * ss(0.35, 1.2, left) + 2.8 * ss(1.0, 10, left); // 길 왼쪽 너머 언덕
  return y + NS_RISE(z);
}
const nsWaterY = (z) => NS_WATER + NS_RISE(z);
const nsInWater = (x, z) => Math.abs(x - NS_SX(z)) < NS_SW(z) * 0.9;
const nsSurf = (x, z) => (nsInWater(x, z) ? 'water' : Math.abs(x - NS_PX(z)) < NS_PW + 0.05 ? 'path' : 'grass'); // 발소리: 물속 찰박 · 돌길 톡톡 · 풀 바스락
const NS_SPOT = { bank: { x: 0.84, z: 0.02 }, wade: { x: 1.47, z: -0.2 }, grass: { x: 0.77, z: -0.9 } }; // 물에 들어가기 전에 서는 물가 · 물장구 치는 곳(냇물 가운데) · 똥츄 하는 길가 풀밭
let nsG = null, PUPU = null, NS = null;
const _nv = V3(), _nc = new THREE.Color();
function buildNamsan() {
  const G = nsG = new THREE.Group(); G.visible = false; roomScene.add(G);
  const R = rng(31), B = batcher();
  NS = { rings: [], ringI: 0, drops: [], dropN: 90, wadeT: 0, lapT: 0, kickT: 0 };
  // ---------- 하늘: 지평선은 옅은 연둣빛 안개, 위로 갈수록 맑은 하늘색
  {
    const sky = new THREE.SphereGeometry(35, 32, 16), p = sky.attributes.position, col = [], c = new THREE.Color(), v = V3();
    const cH = new THREE.Color(0xe3ece3), cM = new THREE.Color(0xc5dbea), cT = new THREE.Color(0x8fb7df);
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).normalize(); const h = Math.max(0, v.y); c.copy(cH).lerp(cM, ss(0.02, 0.25, h)).lerp(cT, ss(0.25, 0.85, h)); col.push(c.r, c.g, c.b); }
    sky.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const m = new THREE.Mesh(sky, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })); m.renderOrder = -1; G.add(m);
  }
  // ---------- 땅: 시냇물 근처만 촘촘한 격자 (풀빛 · 물가의 젖은 흙 · 냇바닥 · 언덕의 숲 바닥은 정점 색)
  {
    const xs = [], zs = [], LT = LITE ? 1.5 : 1;
    const seg = (a, b, st) => { const n = Math.max(1, Math.round((b - a) / st)); for (let i = 0; i < n; i++) xs.push(a + ((b - a) * i) / n); };
    seg(-16, -4, 1.0); seg(-4, -1.8, 0.4); seg(-1.8, 0.4, 0.25); seg(0.4, 2.7, 0.07 * LT); seg(2.7, 5, 0.3); seg(5, 16, 1.0); xs.push(16);
    const zseg = (a, b, st) => { const n = Math.max(1, Math.round((a - b) / st)); for (let i = 0; i < n; i++) zs.push(a - ((a - b) * i) / n); };
    zseg(6, -5, 0.1 * LT); zseg(-5, -12, 0.25); zseg(-12, -34, 0.7); zs.push(-34);
    const nx = xs.length, nz = zs.length, pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2), idx = [];
    const c = new THREE.Color(), gA = new THREE.Color(0x5f8236), gB = new THREE.Color(0x86994a), gC = new THREE.Color(0x48682b), mud = new THREE.Color(0x6b6044), bed = new THREE.Color(0x5e533c), forest = new THREE.Color(0x3e5628), pathC = new THREE.Color(0xa29a8e);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = xs[i], z = zs[j], y = nsGround(x, z), k = j * nx + i;
      pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z; uv[k * 2] = x * 0.5; uv[k * 2 + 1] = z * 0.5;
      const n1 = Math.sin(x * 1.3 + z * 0.7) * Math.sin(z * 1.1 - x * 0.4), u = Math.abs(x - NS_SX(z)) / NS_SW(z);
      c.copy(gA).lerp(gB, 0.5 + 0.5 * n1).lerp(gC, 0.35 * (0.5 + 0.5 * Math.sin(x * 0.37 - z * 0.53)));
      c.lerp(forest, ss(0.2, 1.1, y - NS_RISE(z)));
      c.lerp(mud, ss(1.4, 0.98, u) * 0.85).lerp(bed, ss(0.98, 0.62, u));
      if (Math.abs(x - NS_PX(z)) < NS_PW + 0.12) c.copy(pathC);
      c.multiplyScalar(0.9 + 0.2 * hash3(_nv.set(x * 2.3, 0, z * 2.3)));
      col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
    }
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = j * nx + i, b = a + 1, cc = a + nx, d = cc + 1; idx.push(a, b, cc, b, d, cc); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    const detail = canvasTex(256, 256, (x, w) => { // 풀결 (정점 색 위에 얹는 밝은 무늬)
      const r = rng(19); x.fillStyle = '#e6e8da'; x.fillRect(0, 0, w, w);
      for (let i = 0; i < 2600; i++) { const px = r() * w, py = r() * w, l = 2 + r() * 6, a = -Math.PI / 2 + (r() - 0.5) * 1.4, q = r(); x.strokeStyle = q < 0.45 ? `rgba(255,255,236,${0.3 + r() * 0.4})` : `rgba(70,84,40,${0.2 + r() * 0.35})`; x.lineWidth = 1; x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke(); }
    }, [1, 1]);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, map: detail, roughness: 0.96 })); m.receiveShadow = true; G.add(m);
  }
  // 길 · 물: 가운데 선을 따라가는 띠 (3줄: 왼쪽 끝 · 가운데 · 오른쪽 끝)
  const ribbon = (zA, zB, step, cx, hw, yf, crown, vLen, uMeters) => {
    const P = [], U = [], I = []; let L = 0, px = null, pz = null, n = 0;
    for (let z = zA; z >= zB - 1e-6; z -= step) {
      const x = cx(z), d = (cx(z + 0.01) - cx(z - 0.01)) / 0.02, l = Math.hypot(1, d), ax = 1 / l, az = -d / l, w = hw(z), y = yf(z);
      if (px !== null) L += Math.hypot(x - px, z - pz); px = x; pz = z;
      P.push(x - ax * w, y, z - az * w, x, y + crown, z, x + ax * w, y, z + az * w);
      const uw = uMeters ? 2 * w : 1; U.push(0, L / vLen, uw / 2, L / vLen, uw, L / vLen);
      if (n) { const a = (n - 1) * 3, b = n * 3; I.push(a, a + 1, b, a + 1, b + 1, b, a + 1, a + 2, b + 1, a + 2, b + 2, b + 1); }
      n++;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setIndex(I); g.computeVertexNormals(); return g;
  };
  // ---------- 산책길: 옅은 베이지빛 포장 (가장자리는 조금 어둡게 · 잔 얼룩)
  {
    const tex = canvasTex(256, 512, (x, w, h) => {
      const r = rng(41); x.fillStyle = '#d6cec3'; x.fillRect(0, 0, w, h);
      for (let i = 0; i < 70; i++) { const cx = r() * w, cy = r() * h, rad = 20 + r() * 70, g = x.createRadialGradient(cx, cy, 0, cx, cy, rad), cc = r() < 0.5 ? '160,150,138' : '238,232,222'; g.addColorStop(0, `rgba(${cc},0.22)`); g.addColorStop(1, `rgba(${cc},0)`); x.fillStyle = g; for (const oy of [-h, 0, h]) x.fillRect(cx - rad, cy - rad + oy, rad * 2, rad * 2); }
      for (let i = 0; i < 12000; i++) { x.fillStyle = r() < 0.5 ? `rgba(105,96,88,${0.1 + r() * 0.25})` : `rgba(250,246,238,${0.12 + r() * 0.3})`; x.fillRect(r() * w, r() * h, 1, 1); }
      for (const side of [0, 1]) { const g = x.createLinearGradient(side ? w : 0, 0, side ? w - 22 : 22, 0); g.addColorStop(0, 'rgba(110,100,88,0.38)'); g.addColorStop(1, 'rgba(110,100,88,0)'); x.fillStyle = g; x.fillRect(side ? w - 22 : 0, 0, 22, h); }
      x.strokeStyle = 'rgba(95,86,78,0.35)'; x.lineWidth = 1; for (let i = 0; i < 5; i++) { let px = 30 + r() * (w - 60), py = r() * h; x.beginPath(); x.moveTo(px, py); for (let k = 0; k < 6; k++) { px += (r() - 0.5) * 24; py += 6 + r() * 10; x.lineTo(px, py); } x.stroke(); } // 잔금
    });
    tex.wrapS = THREE.ClampToEdgeWrapping; tex.wrapT = THREE.RepeatWrapping;
    const m = new THREE.Mesh(ribbon(4.6, -27, 0.25, NS_PX, () => NS_PW, (z) => NS_RISE(z) + 0.004, 0.004, 4, false), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    m.receiveShadow = true; G.add(m);
  }
  // ---------- 돌 경계석 (길 양옆) · 길 왼쪽 나무 울타리 · 벤치
  {
    const curbA = M(0xbab4a9, { roughness: 0.85 }), curbB = M(0xa29d93, { roughness: 0.9 });
    for (const side of [-1, 1]) for (let z = 4.6; z > -16; z -= 0.5) {
      const zc = z - 0.25, d = (NS_PX(zc + 0.01) - NS_PX(zc - 0.01)) / 0.02, l = Math.hypot(1, d), ax = 1 / l, az = -d / l, o = (NS_PW + 0.07) * side;
      B.put(R() < 0.5 ? curbA : curbB, box(0.14, 0.08, 0.47), [NS_PX(zc) + ax * o, NS_RISE(zc) - 0.016, zc + az * o], [0, Math.atan2(d, 1), 0]);
    }
    const wood = M(0x6b5238, { roughness: 0.85 }), posts = [];
    for (let z = 4.2; z > -15; z -= 1.6) { const x = NS_PX(z) - NS_PW - 0.9, y = nsGround(x, z); posts.push([x, y, z]); bar(B, wood, [x, y - 0.05, z], [x, y + 0.62, z], 0.035, 6); }
    for (let i = 0; i < posts.length - 1; i++) for (const h of [0.28, 0.54]) { const [ax, ay, az] = posts[i], [bx, by, bz] = posts[i + 1]; bar(B, wood, [ax, ay + h, az], [bx, by + h, bz], 0.02, 6); }
    const bx = -2.0, bz = -1.35, bw = M(0xa77649, { roughness: 0.72 }), iron = M(0x35312d, { roughness: 0.5, metalness: 0.4 }); // 길을 보고 앉는 나무 벤치
    for (let i = 0; i < 4; i++) B.put(bw, box(0.085, 0.03, 1.3), [bx + 0.16 - i * 0.1, 0.44, bz]);
    for (let i = 0; i < 3; i++) B.put(bw, box(0.03, 0.085, 1.3), [bx - 0.21 - i * 0.022, 0.58 + i * 0.11, bz], [0, 0, 0.2]);
    for (const e of [-0.55, 0.55]) { B.put(iron, box(0.42, 0.04, 0.05), [bx - 0.02, 0.41, bz + e]); bar(B, iron, [bx + 0.17, 0, bz + e], [bx + 0.15, 0.42, bz + e], 0.025, 6); bar(B, iron, [bx - 0.2, 0, bz + e], [bx - 0.27, 0.9, bz + e], 0.025, 6); }
  }
  // ---------- 바위 (물가 양쪽 · 냇물 속) — 조금씩 울퉁불퉁하게, 반쯤 묻혀 있다
  const OB = [];
  {
    const ico = new THREE.IcosahedronGeometry(1, 1), stone = [M(0x8f8c84, { roughness: 0.92 }), M(0x77756e, { roughness: 0.95 }), M(0x9d988d, { roughness: 0.9 }), M(0x6c745c, { roughness: 0.96 })];
    const rock = (x, z, r, h = 0.62, ob = false) => {
      const g = ico.clone(), p = g.attributes.position, sd = R() * 10;
      for (let i = 0; i < p.count; i++) { _nv.fromBufferAttribute(p, i); const k = 1 + (hash3(_v1n.copy(_nv).multiplyScalar(2.7).addScalar(sd)) - 0.5) * 0.38; p.setXYZ(i, _nv.x * k, _nv.y * k, _nv.z * k); }
      B.put(stone[Math.floor(R() * (R() < 0.3 ? 4 : 3))], g, [x, nsGround(x, z) + r * h * 0.2, z], [R() * 0.4, R() * 6.28, R() * 0.4], [r, r * h, r * (0.8 + R() * 0.3)], true);
      if (ob) OB.push({ x, z, r: r * 0.92 });
    };
    rock(1.0, -1.85, 0.21, 0.62, true); rock(1.12, 1.47, 0.17, 0.6, true); rock(2.05, -0.75, 0.22, 0.6, true); rock(1.97, 0.88, 0.17, 0.55, true); rock(1.62, -1.62, 0.14, 0.5, true); // 푸푸가 다니는 곳 가까이 (돌아서 간다)
    for (const z of [2.6, -2.9, -3.8, -5.2, -6.6, -8.3, -10.2, -12]) rock(NS_SX(z) - NS_SW(z) * (0.95 + R() * 0.15), z, 0.12 + R() * 0.2);
    for (const z of [3.0, 2.0, -1.9, -3.2, -4.4, -6.0, -7.4, -9.2, -11, -13]) rock(NS_SX(z) + NS_SW(z) * (0.95 + R() * 0.2), z, 0.14 + R() * 0.22);
    for (const z of [-4.8, -7.9, -10.8]) rock(NS_SX(z) + (R() - 0.5) * 0.4, z, 0.1 + R() * 0.08, 0.5);
    for (let i = 0; i < 9; i++) { const z = 3 - R() * 14, x = NS_SX(z) + NS_SW(z) + 0.6 + R() * 1.8; rock(x, z, 0.15 + R() * 0.3); } // 둑 너머 비탈의 바위
  }
  // ---------- 냇바닥 자갈 (물 밑에 비쳐 보인다)
  {
    const N = LITE ? 70 : 150, im = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), M(0xffffff, { roughness: 0.8 }), N), o = new THREE.Object3D(), c = new THREE.Color();
    const pal = [0x8a857b, 0x9c8f7a, 0x6f6a62, 0xb0a894, 0x7d7462];
    for (let i = 0; i < N; i++) {
      const z = 3.6 - R() * 10.5, u = (R() * 2 - 1) * 1.02, x = NS_SX(z) + u * NS_SW(z), s = 0.018 + R() * 0.03;
      o.position.set(x, nsGround(x, z) + s * 0.2, z); o.rotation.set(0, R() * 6.28, 0); o.scale.set(s * (0.8 + R() * 0.5), s * 0.45, s); o.updateMatrix(); im.setMatrixAt(i, o.matrix);
      im.setColorAt(i, c.setHex(pal[Math.floor(R() * pal.length)]).multiplyScalar(0.85 + R() * 0.3));
    }
    im.receiveShadow = true; G.add(im);
  }
  // ---------- 풀포기 · 갈대 (물가와 둑, 길 왼쪽) — 한 번에 그린다
  {
    const tuft = (blades, seed, wid, lm = 0.35) => {
      const P = [], C = [], Nm = [], r = rng(seed);
      for (let b = 0; b < blades; b++) {
        const a = r() * Math.PI * 2, lean = 0.12 * lm / 0.35 + r() * lm, h = 0.55 + r() * 0.45, w = wid * (0.7 + r() * 0.6), bx = Math.cos(a) * 0.05, bz = Math.sin(a) * 0.05;
        const tx = bx + Math.cos(a) * lean * h, tz = bz + Math.sin(a) * lean * h, qx = -Math.sin(a) * w, qz = Math.cos(a) * w;
        P.push(bx - qx, 0, bz - qz, bx + qx, 0, bz + qz, tx, h, tz); C.push(0.42, 0.5, 0.3, 0.42, 0.5, 0.3, 1.1, 1.1, 1.0); Nm.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(Nm, 3)); return g;
    };
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.9 });
    mat.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;'); }; // 잎 뒷면도 앞면처럼 위를 보는 법선으로 (뒤에서 보면 까맣게 되지 않게)
    mat.customProgramCacheKey = () => 'ns-grass';
    const put = (geo, list) => {
      const im = new THREE.InstancedMesh(geo, mat, list.length), o = new THREE.Object3D(), c = new THREE.Color(), pal = [0x75a03e, 0x8aaa4c, 0x5f8e35, 0x9fb85c, 0x6b9340];
      list.forEach(([x, z, s, h], i) => { o.position.set(x, nsGround(x, z) - 0.008, z); o.rotation.set(0, R() * 6.28, 0); o.scale.set(s, h, s); o.updateMatrix(); im.setMatrixAt(i, o.matrix); im.setColorAt(i, c.setHex(pal[Math.floor(R() * pal.length)]).multiplyScalar(0.85 + R() * 0.25)); });
      im.receiveShadow = true; G.add(im); return im;
    };
    const clear = (x, z) => Math.hypot(x - NS_SPOT.grass.x, z - NS_SPOT.grass.z + 0.05) > 0.45 && Math.hypot(x - NS_SPOT.bank.x, z - NS_SPOT.bank.z) > 0.25 && !(x < NS_SX(z) && x > NS_SPOT.bank.x - 0.2 && z < 0.7 && z > -0.8); // 똥츄 자리 · 물에 들어가는 길목은 비워 둔다
    const grass = [], reed = [], NT = LITE ? 200 : 440;
    for (let i = 0; i < NT; i++) {
      const q = R(), z = 3.8 - R() * (q < 0.6 ? 12 : 18), sx = NS_SX(z), sw = NS_SW(z), pl = NS_PX(z) - NS_PW, pr = NS_PX(z) + NS_PW;
      let x;
      if (q < 0.3) x = lerp(pr + 0.12, sx - sw * 0.88, R()); // 길과 냇물 사이 둑
      else if (q < 0.55) x = sx + sw * (0.92 + R() * 2.6); // 냇물 건너편
      else if (q < 0.8) x = pl - 0.12 - R() * 2.4; // 길 왼쪽
      else { x = sx + (R() < 0.5 ? -1 : 1) * sw * (0.86 + R() * 0.16); if (clear(x, z)) reed.push([x, z, 0.22 + R() * 0.12, 0.35 + R() * 0.3]); continue; } // 물가의 갈대
      if (x < pr + 0.05 && x > pl - 0.05) continue;
      if (clear(x, z)) grass.push([x, z, 0.16 + R() * 0.16, 0.1 + R() * 0.16]);
    }
    put(tuft(7, 7, 0.03), grass); put(tuft(9, 11, 0.022), reed);
    // 붓꽃: 칼 모양 잎 다발 + 보라 꽃 (몇 개는 노랑 · 하양)
    const leaves = [], flowers = [], NI = LITE ? 16 : 30;
    for (let i = 0; i < NI; i++) {
      const z = 3.4 - R() * 10, side = R() < 0.55 ? -1 : 1, x = NS_SX(z) + side * NS_SW(z) * (0.9 + R() * 0.25);
      if (!clear(x, z)) continue;
      leaves.push([x, z, 0.14 + R() * 0.06, 0.42 + R() * 0.2]);
      for (let k = 0, n = 1 + Math.floor(R() * 3); k < n; k++) flowers.push([x + (R() - 0.5) * 0.12, z + (R() - 0.5) * 0.12, 0.36 + R() * 0.2, R() < 0.78 ? 0 : R() < 0.6 ? 1 : 2]);
    }
    put(tuft(8, 23, 0.016, 0.12), leaves);
    const petal = [M(0x6a4fb0, { roughness: 0.6 }), M(0xe8c440, { roughness: 0.6 }), M(0xf2f0f6, { roughness: 0.6 })], dark = [M(0x4a3486, { roughness: 0.6 }), M(0xc79c22, { roughness: 0.6 }), M(0xc9c4d6, { roughness: 0.6 })], stem = M(0x4c7a2e, { roughness: 0.8 }), yel = M(0xf6d34a, { roughness: 0.5 });
    for (const [x, z, h, kind] of flowers) {
      const y = nsGround(x, z) + h; bar(B, stem, [x, y - h, z], [x, y, z], 0.004, 5);
      for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2 + x * 7; B.put(petal[kind], SPH, [x + Math.cos(a) * 0.022, y - 0.006, z + Math.sin(a) * 0.022], [0, -a, 0.9], [0.022, 0.006, 0.012]); B.put(dark[kind], SPH, [x + Math.cos(a + 1.05) * 0.008, y + 0.016, z + Math.sin(a + 1.05) * 0.008], [0, -a - 1.05, -0.35], [0.008, 0.019, 0.007]); }
      B.put(yel, SPH, [x, y + 0.004, z], null, 0.006);
    }
  }
  // ---------- 나무: 활엽수(여러 초록) · 소나무(붉은 줄기 · 층층이 납작한 잎) · 멀리 숲
  {
    const trunk = M(0x5a4636, { roughness: 0.9 }), redTrunk = M(0x8a5638, { roughness: 0.85 }), leaf = [M(0x7fae47, { roughness: 0.85 }), M(0x66964a, { roughness: 0.88 }), M(0x9cbd5a, { roughness: 0.85 }), M(0x55803a, { roughness: 0.9 })], pine = M(0x46663b, { roughness: 0.9 }), ico = new THREE.IcosahedronGeometry(1, 1);
    const T = [[-3.2, 0.6, 1.0, 'd'], [-3.6, -2.5, 1.15, 'p'], [-4.5, 1.9, 1.1, 'd'], [-3.4, -5.6, 1.2, 'd'], [-5.6, -3.8, 1.3, 'p'], [-4.2, -8.8, 1.2, 'd'], [-6.5, 0.0, 1.3, 'd'], [-7.0, -6.5, 1.4, 'p'], [-6.2, -11.5, 1.4, 'd'], [-9, -3, 1.5, 'd'], [-9.5, -9, 1.5, 'p'], [-8.5, 3.5, 1.4, 'd'],
      [3.5, 1.3, 1.0, 'd'], [3.7, -1.8, 1.1, 'd'], [4.6, -4.5, 1.25, 'p'], [3.4, -6.8, 1.1, 'd'], [5.6, 0.2, 1.3, 'd'], [6.0, -8.5, 1.4, 'd'], [7.4, -3.5, 1.5, 'p'], [8.5, 2.5, 1.4, 'd'], [4.8, -11.5, 1.3, 'd'],
      [-1.5, -17, 1.4, 'd'], [2.2, -15.5, 1.3, 'p'], [-6, -16, 1.4, 'd'], [0.8, -21, 1.6, 'd'], [-7.5, -19.5, 1.5, 'd'], [5, -19, 1.5, 'd'], [-3, -24, 1.7, 'p'], [3, -26, 1.8, 'd'], [-11.5, -25, 1.7, 'd'], [8, -24, 1.7, 'p'], [-12, -14, 1.6, 'd'], [11, -12, 1.6, 'd']];
    const trees = LITE ? T.filter((q, i) => i % 3 !== 2) : T;
    for (const [tx, tz, s, kind] of trees) {
      const y0 = nsGround(tx, tz) - 0.1;
      if (kind === 'p') { // 남산 위의 저 소나무: 굽은 붉은 줄기 끝에 납작한 잎 덩어리가 층층이
        const h = 3.0 * s, lean = (R() - 0.5) * 0.8 * s;
        bar(B, redTrunk, [tx, y0, tz], [tx + lean * 0.5, y0 + h * 0.55, tz], 0.12 * s, 7); bar(B, redTrunk, [tx + lean * 0.5, y0 + h * 0.55, tz], [tx + lean, y0 + h, tz + 0.1], 0.09 * s, 7);
        for (let k = 0; k < 5; k++) { const a = R() * 6.28, rr = 0.3 + R() * 0.7; B.put(pine, ico, [tx + lean + Math.cos(a) * rr * s, y0 + h * (0.72 + k * 0.08) + R() * 0.2, tz + Math.sin(a) * rr * s], [R() * 0.4, R() * 3, R() * 0.4], [(0.75 + R() * 0.35) * s, (0.32 + R() * 0.12) * s, (0.7 + R() * 0.35) * s], true); }
      } else {
        const h = 1.25 * s, L = leaf[Math.floor(R() * 4)], L2 = leaf[Math.floor(R() * 4)]; // 잎이 낮게까지 우거진 활엽수 (줄기만 길게 보이지 않게)
        bar(B, trunk, [tx, y0, tz], [tx + (R() - 0.5) * 0.25, y0 + h + 0.9 * s, tz], 0.12 * s, 8);
        for (let k = 0; k < 9; k++) { const a = R() * Math.PI * 2, rr = 0.85 * s * R(); B.put(k % 2 ? L : L2, ico, [tx + Math.cos(a) * rr, y0 + h + R() * 1.7 * s, tz + Math.sin(a) * rr], [R() * 3, R() * 3, R() * 3], [(0.85 + R() * 0.45) * s, (0.75 + R() * 0.4) * s, (0.85 + R() * 0.45) * s], true); }
      }
    }
    // 멀리 숲: 뒤쪽 산과 양옆 비탈을 큰 잎 덩어리로 채운다 (안개에 흐리게)
    const far = [leaf[1], leaf[3], pine];
    const blob = (x, z, s) => B.put(far[Math.floor(R() * 3)], ico, [x, nsGround(x, z) + s * (0.55 + R() * 0.3), z], [R() * 3, R() * 3, R() * 3], [s * (1 + R() * 0.3), s * (0.85 + R() * 0.3), s * (1 + R() * 0.3)], true);
    for (let x = -14; x <= 14; x += LITE ? 3.4 : 2.3) blob(x + R(), -29 - R() * 3, 2.3 + R() * 1.0);
    for (let z = 2; z > -28; z -= LITE ? 3.6 : 2.6) for (const side of [-1, 1]) blob(side * (12.2 + R() * 1.6), z + R(), 2.2 + R() * 0.9);
    const shrub = M(0x4f7334, { roughness: 0.92 }); // 길 왼쪽 울타리 밑 · 냇물 건너 비탈의 덤불
    for (let i = 0; i < (LITE ? 12 : 22); i++) { const z = 3.5 - R() * 13, x = i % 2 ? NS_PX(z) - NS_PW - 1.2 - R() * 1.2 : NS_SX(z) + NS_SW(z) + 1.0 + R() * 1.5; for (let k = 0; k < 3; k++) B.put(shrub, ico, [x + (R() - 0.5) * 0.5, nsGround(x, z) + 0.18 + R() * 0.12, z + (R() - 0.5) * 0.5], [R() * 3, R() * 3, R() * 3], [0.32 + R() * 0.18, 0.26 + R() * 0.12, 0.32 + R() * 0.18], true); }
  }
  B.flush(G);
  // ---------- 시냇물: 얕고 맑은 물(바닥이 비친다) · 잔물결이 흘러온다 · 비스듬히 보면 하늘빛
  {
    const nm = canvasTex(256, 256, (x, w) => { // 잔물결 법선 (이음매 없이 반복되는 물결 높이 → 법선)
      const img = x.createImageData(w, w), H = new Float32Array(w * w), r = rng(53), waves = [];
      for (let k = 0; k < 9; k++) waves.push([Math.floor(r() * 5) - 2, 1 + Math.floor(r() * 6), r() * 6.28, 0.4 + r() * 0.6]);
      for (let k = 0; k < 6; k++) waves.push([Math.floor(r() * 13) - 6, 4 + Math.floor(r() * 9), r() * 6.28, 0.15 + r() * 0.2]);
      for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) { let h = 0; for (const [a, b, p, A] of waves) h += A * Math.sin(((a * i + b * j) / w) * Math.PI * 2 + p); H[j * w + i] = h; }
      for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) {
        const dx = H[j * w + ((i + 1) % w)] - H[j * w + ((i + w - 1) % w)], dy = H[((j + 1) % w) * w + i] - H[((j + w - 1) % w) * w + i], l = Math.hypot(dx, dy, 1.6), q = (j * w + i) * 4;
        img.data[q] = (0.5 - (0.5 * dx) / l) * 255; img.data[q + 1] = (0.5 - (0.5 * dy) / l) * 255; img.data[q + 2] = (0.5 + (0.5 * 1.6) / l) * 255; img.data[q + 3] = 255;
      }
      x.putImageData(img, 0, 0);
    }, [1.4, 1.4]);
    nm.colorSpace = THREE.NoColorSpace;
    const mat = new THREE.MeshStandardMaterial({ color: 0x56623f, roughness: 0.08, metalness: 0.05, transparent: true, opacity: 0.58, normalMap: nm, normalScale: new THREE.Vector2(0.6, 0.6), depthWrite: false });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uSky = { value: new THREE.Color(0xbdd5e6) };
      sh.fragmentShader = 'uniform vec3 uSky;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  { float fr = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 3.0); totalEmissiveRadiance += uSky * (0.05 + 0.55 * fr); diffuseColor.a = mix(diffuseColor.a, 0.93, fr); }');
    };
    mat.customProgramCacheKey = () => 'ns-water';
    const m = new THREE.Mesh(ribbon(4.6, -27, 0.2, NS_SX, (z) => NS_SW(z) * 1.18, nsWaterY, 0, 1, true), mat); m.renderOrder = 1; m.receiveShadow = true; G.add(m);
    NS.water = m; NS.nm = nm;
    // 반짝임: 물 위에서 반짝였다 사라지는 빛 점
    const N = LITE ? 30 : 60, P = new Float32Array(N * 3), ph = new Float32Array(N);
    for (let i = 0; i < N; i++) { const z = 3.2 - R() * 9, x = NS_SX(z) + (R() * 2 - 1) * 0.8 * NS_SW(z); P.set([x, nsWaterY(z) + 0.004, z], i * 3); ph[i] = R() * 100; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('ph', new THREE.BufferAttribute(ph, 1));
    NS.spk = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uK: { value: 600 }, uMap: { value: glowTex } },
      vertexShader: 'attribute float ph; uniform float uT; uniform float uK; varying float vA; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); float s = pow(max(0.0, sin(uT * (1.6 + fract(ph * 7.31) * 2.6) + ph)), 14.0); vA = s; gl_PointSize = max(1.0, 0.05 * s * uK / -mv.z); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform sampler2D uMap; varying float vA; void main(){ float a = texture2D(uMap, gl_PointCoord).a * vA; gl_FragColor = vec4(vec3(1.0, 0.98, 0.92) * a, a); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    NS.spk.renderOrder = 2; NS.spk.frustumCulled = false; G.add(NS.spk);
    // 물결 고리 (발 · 코 · 물방울이 닿은 자리에서 퍼진다)
    const rg = new THREE.RingGeometry(0.8, 1, 40); rg.rotateX(-Math.PI / 2);
    for (let i = 0; i < 14; i++) { const r = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0xf3f9ff, transparent: true, opacity: 0, depthWrite: false })); r.visible = false; r.renderOrder = 2; r.userData = { age: 9, life: 1, size: 0.1 }; G.add(r); NS.rings.push(r); }
    // 물보라 김: 앞발이 물을 칠 때 하얗게 피었다 사라진다
    NS.puffs = []; for (let i = 0; i < 5; i++) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xf6fbff, transparent: true, opacity: 0, depthWrite: false })); sp.visible = false; sp.renderOrder = 3; sp.userData = { age: 9, y0: 0 }; G.add(sp); NS.puffs.push(sp); }
    // 물방울 · 풀 부스러기 (한 번에 그린다)
    NS.dropM = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 5), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2, transparent: true, opacity: 0.88 }), NS.dropN);
    for (let i = 0; i < NS.dropN; i++) NS.dropM.setColorAt(i, _nc.setHex(0xffffff));
    NS.dropM.count = 0; NS.dropM.frustumCulled = false; NS.dropM.renderOrder = 3; G.add(NS.dropM);
  }
  // ---------- 빛: 맑은 날 낮 (높은 해 · 하늘빛과 풀빛 반사)
  G.add(new THREE.HemisphereLight(0xe8f1ff, 0x5d6b3e, 1.15));
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.5);
  sun.target.position.set(0.4, 0, -1.2); sun.position.copy(V3(0.55, 1.0, 0.38).normalize()).multiplyScalar(20).add(sun.target.position);
  sun.castShadow = true; Object.assign(sun.shadow.camera, { left: -6.5, right: 6.5, top: 6.5, bottom: -6.5, near: 4, far: 40 }); sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.mapSize.set(LITE ? 1024 : 2048, LITE ? 1024 : 2048); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.025;
  G.add(sun, sun.target);
  // ---------- 푸푸의 소품: 터키츄(길게 꼰 칠면조 힘줄 껌) · 볼일 본 것(작은 갈색 한 덩이) · 엄마 손의 배변 봉투
  NS.turkey = chewProp(0.15, M(0xc78c4c), (g, part) => {
    const a = new THREE.MeshStandardMaterial({ color: 0xdba660, roughness: 0.42, emissive: 0x5a3410, emissiveIntensity: 0.22 }), b = new THREE.MeshStandardMaterial({ color: 0xc48848, roughness: 0.5, emissive: 0x4a2a0c, emissiveIntensity: 0.18 }), L = 0.15, NSEG = 6;
    for (let k = 0; k < 2; k++) for (let sg = 0; sg < NSEG; sg++) { // 두 가닥을 꼬아 만든 막대: 가닥마다 여섯 토막 (씹은 만큼 앞에서부터 사라진다)
      const z0 = (sg / NSEG) * L, z1 = ((sg + 1) / NSEG) * L, pts = [];
      for (let q = 0; q <= 8; q++) { const z = lerp(z0, z1, q / 8), an = (z / L) * Math.PI * 2 * 3.2 + k * Math.PI; pts.push(V3(Math.cos(an) * 0.0056, Math.sin(an) * 0.0056, z)); }
      part(add(g, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.0062, 7, false), k ? b : a), z1);
    }
    part(add(g, SPH, b, [0, 0, L - 0.003], null, [0.012, 0.012, 0.009]), L); // 끝 매듭
  }, 1.35);
  NS.turkey.g.traverse((o) => { if (o.isMesh) o.castShadow = false; }); G.add(NS.turkey.g);
  NS.poop = (() => { const g = new THREE.Group(), m = M(0x6b4224, { roughness: 0.42 }); add(g, SPH, m, [0, 0.013, 0], null, [0.03, 0.017, 0.027]); add(g, SPH, m, [0.003, 0.028, 0.001], null, [0.021, 0.013, 0.019]); add(g, SPH, m, [0.005, 0.04, 0.002], null, [0.012, 0.01, 0.012]); add(g, SPH, m, [0.007, 0.049, 0.002], [0, 0, -0.5], [0.005, 0.007, 0.005]); g.traverse((o) => { if (o.isMesh) o.castShadow = false; }); g.visible = false; G.add(g); return g; })(); // 이모지처럼 동글동글 세 층 (아주 작게)
  NS.bag = (() => { const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color: 0x4fc1ad, roughness: 0.38 }); add(g, SPH, m, [0, -0.034, 0], null, [0.05, 0.058, 0.047]); for (const sx of [-1, 1]) add(g, SPH, m, [sx * 0.014, 0.026, 0], [0, 0, sx * 0.5], [0.011, 0.024, 0.009]); NS.bagKnot = add(g, SPH, m, [0, 0.03, 0], null, [0.016, 0.012, 0.014]); g.visible = false; return g; })(); // 푸푸 이름표 같은 민트색
  // ---------- 푸푸 (이 방의 강아지)
  PUPU = makePupu(); Object.assign(PUPU, { route, routeSee: navSee, collide, speedK: 1.15, talk: pupuTalk, camK: 1.3 }); PUPU.root.visible = false; roomScene.add(PUPU.root); fitCurl(PUPU);
  // 매 프레임(푸푸를 움직이기 전): 땅 높이를 따라 걷는다 (물에 들어가면 냇바닥까지 내려간다)
  roomUpd.push((t, dt) => { if (RP !== ROOM_NAMSAN) return; const d = pinky; if (d.tgt.name === 'held') return; const gy = d.liftT = nsGround(d.x, d.z); if (Math.abs(d.x - NS_SX(d.z)) < NS_SW(d.z) * 1.3) d.lift += (gy - d.lift) * (1 - Math.exp(-14 * dt)); }); // 물가에서는 바닥을 바짝 따라 (물에 들어갈 때 다리가 냇바닥에 묻히지 않게)
  Object.assign(ROOM_NAMSAN, {
    built: true, OBST: OB,
    SPOTS: { cushion: SPOTS.cushion, gifts: { x: 0.68, z: -1.5, fx: 1.0, fz: -1.85 }, table: { x: -1.3, z: -1.35, fx: -2.0, fz: -1.35 }, window: { x: 0.74, z: 0.62, fx: 1.65, fz: 0.35 } },
    looks: [V3(1.6, 0.05, -0.4), V3(1.4, 0.1, -2.6), V3(-2.0, 0.45, -1.35), V3(-3.6, 2.4, -3), V3(4, 2.2, -2), V3(-0.4, 0.3, -6.5)],
  });
  ROOM_NAMSAN.sound.brook = [2.6, 1, -0.6, -2.2, -3.8, -5.5].map((z) => [NS_SX(z), nsWaterY(z), z]);
}
const _v1n = V3();
const ROOM_NAMSAN = {
  id: 'namsan', built: false, name: '푸푸', place: '남산 산책길', hint: '푸푸를 만지면 좋아해요 · 화면을 끌어서 둘러보기', navLabel: '푸푸랑 하기',
  navIn: (x, z) => z >= -3.301 && z <= 2.351 && x >= -1.451 && x <= NS_SX(z) + NS_SW(z) - 0.159, // 길 · 길과 냇물 사이 둑 · 냇물 속 (건너편 둑과 언덕은 아니다)
  clamp(d) { d.z = clamp(d.z, -3.3, 2.35); d.x = clamp(d.x, -1.45, NS_SX(d.z) + NS_SW(d.z) - 0.16); },
  ball: [-1.6, 2.3, -3.5, 2.6],
  NAV: { x0: -1.45, z0: -3.3, h: 0.08, nx: 48, nz: 72, pad: 0.15 },
  HOME: { x: 0.1, z: 0.85 }, AIM: V3(0.42, 0.36, 0.45), camPos: (v, a) => (a < 0.8 ? v.set(0.82, 1.32, 3.1) : v.set(0.3, 1.36, 3.45)), // 푸푸와 오른쪽 시냇물이 한 화면에 (세로 화면은 조금 오른쪽 · 높이)
  BOWL: V3(99, 0.006, 99), EAT: { x: 99, z: 99 }, CUSH: { x: 99, z: 99 }, // 밥그릇 · 방석은 없다
  THROW: [[-0.6, -0.9], [0.2, -0.5], [-1.0, 0.4], [0.3, -1.6], [-0.4, -2.0]],
  HIDE: [[-0.6, 0.4], [0.2, 0.3], [-0.95, 1.0], [0.3, 1.05], [-0.3, -0.2], [-0.2, 1.25], [-1.1, 0.6], [0.35, 0.6]], // 길 위, 늘 화면에 보이는 자리
  WIN: V3(1.7, 0.05, 0.0), ROPE: { x: -1.0, z: -2.6, yaw: 0 },
  entry: [[0.8, -0.75, 1.35, -1.35], [-0.9, -0.6, -1.7, -1.1], [0.15, -1.6, 0.4, -2.6]],
  wander: [-1.2, -0.7, 1.5, 1.7],
  off: { play: true, feed: true, cushion: true, worm: true, zoom: true, dig: true }, actW: { nap: 0, bowl: 0, left: 0 }, noBowl: true,
  lines: { gifts: ['물 냄새!', '바위 냄새~', '킁킁, 개구리 있나?'], table: ['벤치 밑에 뭐 있다!', '산책 친구 냄새~', '여긴 없네~'], window: ['물소리 좋다~', '바람 시원하다~', '물고기 있나?'], tableSniff: '뭐 떨어진 거 없나~', mid: ['꽃 냄새~', '풀 냄새 좋다', '킁킁, 다람쥐?'] },
  sniffMid: { x: 0.8, z: 1.05, fx: 1.12, fz: 1.25 }, // 냄새 맡기 가운데 들르는 곳: 물가의 붓꽃
  acts: (cd, d) => ({ water: (1.0 + 0.9 * d.play) * cd('water', 70) }), // 혼자 놀 때도 가끔 냇물에 들어가 물을 마시고 첨벙
  roamActs: (tok) => ({ water: () => pupuSplash(tok, true) }),
  picks: { treat: [['turkey', '🦴', '터키츄']], play: [['ball', '🎾', '공']] }, labels: { treat: '터키츄' }, // 간식은 터키츄 하나 (단추를 누르면 바로)
  treat: (tok) => pupuTreat(tok), post: (d, dt, t) => pupuPost(d, dt, t),
  bg: new THREE.Color(0xdde8e0), fog: new THREE.Fog(0xd6e3d6, 16, 54), env: null,
  sound: { surf: nsSurf, cush: [99, 99, 0.3], bowl: [99, 99], tail: { gap: 0.3, gain: -4 }, voice: 'pupu', brook: null, brookGain: -2 },
};
// 푸푸 말투: 밝고 씩씩한 진돗개 — 핑키의 나긋한 말을 푸푸답게 (소리는 원래 말에 맞춰 그대로)
const PUPU_TALK = {
  '왔어? ♥': '엄마 왔다! ♥', '왔다 왔다! ♥': '엄마다 엄마! ♥', '놀아줘 ♥': '산책 가요! ♥', '좋아…': '좋아요~', '더 해줘…': '더 해 주세요~', '포근해…': '포근해~', '…하나 더?': '하나 더 주세요!', '…더 없어?': '더 없어요?',
  '심심해…': '물놀이 할래요?', '뭐 해?': '엄마 뭐 해요?', '놀자?': '놀아요!', '후우…': '후~ 좋다', '…이따 주겠지': '이따 주시겠지~', '안 들려~': '안 들려요~', '후우… 알았어': '네~ 앉을게요', '재밌었다…': '재밌었다!',
};
function pupuTalk(s) { return PUPU_TALK[s] ?? (/[가-힣]…$/.test(s) ? s.slice(0, -1) + '~' : s); }
// ---------- 물방울 · 물결
function nsDrop(p, v, col = 0xeaf6ff, s = 0.008) { const L = NS.drops; if (L.length >= NS.dropN) L.shift(); L.push({ p, v, age: 0, s, c: col }); }
function nsRing(x, z, size = 0.12, life = 1.1) { const r = NS.rings[NS.ringI++ % NS.rings.length]; Object.assign(r.userData, { age: 0, life, size }); r.position.set(x, nsWaterY(z) + 0.003, z); r.visible = true; r.scale.setScalar(0.001); }
function nsSplash(p, n = 16, power = 1) { // 물보라: 물방울이 사방으로 튀고 동그란 물결이 퍼진다
  const y = nsWaterY(p.z) + 0.01;
  for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, s = (0.25 + Math.random() * 0.75) * power; nsDrop(V3(p.x + Math.cos(a) * 0.02, y, p.z + Math.sin(a) * 0.02), V3(Math.cos(a) * s, (1.0 + Math.random() * 1.5) * power, Math.sin(a) * s), 0xeaf6ff, 0.007 + Math.random() * 0.011); }
  nsRing(p.x, p.z, 0.17 * power, 1.25); nsRing(p.x, p.z, 0.09 * power, 0.8);
  const f = NS.puffs[(NS.puffI = ((NS.puffI || 0) + 1) % NS.puffs.length)]; f.visible = true; f.position.set(p.x, y + 0.03, p.z); Object.assign(f.userData, { age: 0, y0: y + 0.03, k: power });
}
// 다른 명령이 끼어들 때: 터키츄 · 봉투는 치우고, 치우지 못한 볼일도 엄마가 얼른 치운다
function pupuRelease() {
  if (!NS) return;
  NS.turkey.hide(); NS.bag.visible = false; if (NS.bag.parent) NS.bag.parent.remove(NS.bag); NS.poop.visible = false;
  if (PUPU) { PUPU.pawUp = null; PUPU.kick = 0; PUPU.smile = 1; PUPU.tongueOut = 0; } NS.lapOn = false;
}
function pupuEnter() { pinky.pawUp = null; pinky.kick = 0; pinky.smile = 1; pinky.tongueOut = 0; NS.lapOn = false; NS.drops.length = 0; for (const r of NS.rings) r.visible = false; for (const f of NS.puffs) f.visible = false; }
// ---------- 남산에서 매 프레임 (푸푸를 움직인 뒤 · 입에 문 것을 맞추기 전)
const _pq = new THREE.Quaternion(), _ps = V3(), _pm = new THREE.Matrix4();
function pupuPost(d, dt, t) {
  if (!NS) return;
  contact.position.y = nsGround(d.x, d.z) + 0.009; // 그림자 원판도 땅(냇바닥)을 따라
  const lap = toy.lap > 0 && toy.lapKind === 'water';
  if (lap) { d.smile = 0; d.tongueOut = 0.5 + 0.5 * Math.sin(t * 20 + 0.8); NS.lapOn = true; } // 물을 마실 때: 웃던 입을 다물고 혀를 날름날름 (턱은 toy.lap이 움직인다)
  else if (NS.lapOn) { NS.lapOn = false; d.tongueOut = 0; d.smile = 1; }
  if (nsInWater(d.x, d.z) && d.tgt.name !== 'held') { // 물속에 서 있거나 걸으면 다리 둘레로 물결
    NS.wadeT -= dt;
    if (NS.wadeT <= 0) { NS.wadeT = d.gait > 0.2 ? 0.26 : 1.2; const f = d.legs[Math.floor(Math.random() * 4)].foot.getWorldPosition(_nv); nsRing(f.x, f.z, d.gait > 0.2 ? 0.1 : 0.07, 1.0); }
  }
  if (lap) { NS.lapT -= dt; if (NS.lapT <= 0) { NS.lapT = Math.PI / 10; const n = noseTip(); nsRing(n.x, n.z, 0.05, 0.7); if (Math.random() < 0.5) nsDrop(V3(n.x, nsWaterY(n.z) + 0.01, n.z), V3((Math.random() - 0.5) * 0.3, 0.5 + Math.random() * 0.4, (Math.random() - 0.5) * 0.3), 0xeaf6ff, 0.004); } }
  if (d.kick > 0.05) { // 뒷발로 풀을 슥슥: 발이 뒤로 찰 때마다 풀 부스러기 · 흙이 뒤로 휙
    const beat = (w, ph) => Math.floor((w * t + ph) / (Math.PI * 2)) !== Math.floor((w * (t - dt) + ph) / (Math.PI * 2));
    for (const [i, ph] of [[2, 0], [3, Math.PI]]) if (beat(13, ph)) {
      const f = d.legs[i].foot.getWorldPosition(V3()); snd('digHit', [f.x, 0.02, f.z], -6);
      const bx = -Math.sin(d.yaw), bz = -Math.cos(d.yaw);
      for (let k = 0; k < 4; k++) { const s = 0.9 + Math.random() * 0.9, sd = (Math.random() - 0.5) * 0.8; nsDrop(V3(f.x, f.y + 0.01, f.z), V3(bx * s + bz * sd, 0.7 + Math.random() * 0.9, bz * s - bx * sd), Math.random() < 0.6 ? 0x6f9a3a : 0x7a6346, 0.005 + Math.random() * 0.004); }
    }
  }
  // 물방울 · 부스러기
  const L = NS.drops; let n = 0;
  for (let i = L.length - 1; i >= 0; i--) {
    const q = L[i]; q.age += dt; q.v.y -= 9.8 * dt; q.p.addScaledVector(q.v, dt);
    const wet = nsInWater(q.p.x, q.p.z), gy = wet ? nsWaterY(q.p.z) : nsGround(q.p.x, q.p.z);
    if ((q.p.y < gy && q.v.y < 0) || q.age > 1.8) { if (wet && q.c === 0xeaf6ff && q.s > 0.008 && Math.random() < 0.35) nsRing(q.p.x, q.p.z, 0.04, 0.6); L.splice(i, 1); }
  }
  for (const q of L) { _pm.compose(q.p, _pq.set(0, 0, 0, 1), _ps.setScalar(q.s)); NS.dropM.setMatrixAt(n, _pm); NS.dropM.setColorAt(n, _nc.setHex(q.c)); n++; }
  NS.dropM.count = n; if (n) { NS.dropM.instanceMatrix.needsUpdate = true; NS.dropM.instanceColor.needsUpdate = true; }
  for (const f of NS.puffs) { if (!f.visible) continue; const u = f.userData; u.age += dt; const k = u.age / 0.45; if (k >= 1) { f.visible = false; continue; } f.scale.set((0.07 + 0.2 * Math.sqrt(k)) * u.k, (0.1 + 0.26 * Math.sqrt(k)) * u.k, 1); f.position.y = u.y0 + 0.07 * k * u.k; f.material.opacity = 0.8 * (1 - k) ** 1.4; }
  for (const r of NS.rings) { // 물결 고리: 퍼지며 옅어진다
    if (!r.visible) continue; const u = r.userData; u.age += dt; const k = u.age / u.life;
    if (k >= 1) { r.visible = false; continue; }
    r.scale.setScalar(u.size * (0.2 + 1.6 * Math.pow(k, 0.6))); r.material.opacity = 0.5 * Math.pow(1 - k, 1.5);
  }
  NS.nm.offset.set(0.03 * Math.sin(t * 0.21), t * 0.16); // 물결이 흘러온다
  NS.spk.material.uniforms.uT.value = t; NS.spk.material.uniforms.uK.value = (innerHeight * renderer.getPixelRatio()) / (2 * Math.tan((roomCam.fov * Math.PI) / 360));
  if (NS.bag.visible && NS.bag.parent === handR.rig.inner && !handR.vis) { NS.bag.visible = false; handR.rig.inner.remove(NS.bag); } // 손이 물러나면 봉투도
}
// ---------- 손: 엄마가 손바닥을 펴서 내밀면 앞발을 척 올려놓는다 (누를 때마다 오른발 · 왼발 번갈아)
let pawSide = 1;
async function pupuPaw(tok) {
  await comeHere(tok, 0.8);
  const ph = phoneK(); { const [p, a] = kneelAt(0.92 * ph, 0.6, 0.2); camTo(p, a); }
  sitFront(6); pinky.wagAmpT = 0.45; pinky.wagSpeedT = 9;
  await wait(tok, 0.9);
  const i = (pawSide = 1 - pawSide), sx = pinky.legs[i].sx, base = poseFor('sit', pinky).paws[i], UPK = { y: 0.15, z: 0.15 };
  tok.cleanups.push(() => { pinky.pawUp = null; });
  let bob = 0;
  const palm = () => rootW(base.x + sx * 0.02, base.y + UPK.y - 0.046 + bob, base.z + UPK.z + 0.012);
  handR.want = { pos: palm, up: () => V3(0, -1, 0), curl: 0.05, rate: 5 };
  await wait(tok, 0.6);
  bubble('손!', () => handR.pos.clone().add(V3(0, 0.1, 0)), 'soft', 1.5, 0); // 엄마의 말 (손 위에)
  pinky.lookFn = () => handR.pos; pinky.earPerk = 0.8; pinky.tiltT = sx * 0.16;
  await wait(tok, 0.8);
  pinky.pawUp = { i, k: 0, ...UPK };
  await tween(tok, 0.4, (k) => { pinky.pawUp.k = ease(k); });
  say('척!', headTop, 'small', 1.0); snd('sfx', 'pat', { gain: 6, force: 1, why: 'paw on palm' });
  pinky.lookFn = null; pinky.tgt.gaze = 1; pinky.wagAmpT = 0.75; pinky.wagSpeedT = 15; pinky.earPerk = 0.2; pinky.tiltT = -sx * 0.18;
  await tween(tok, 1.0, (k) => { bob = 0.016 * Math.sin(k * Math.PI * 4); }); bob = 0; // 악수하듯 손이 앞발을 받친 채 위아래로 두 번
  heart(); say('헤헤', headTop, 'soft', 1.5);
  await wait(tok, 1.0);
  await tween(tok, 0.3, (k) => { pinky.pawUp.k = 1 - ease(k); });
  pinky.pawUp = null; handR.want = null; pinky.tiltT = 0; happy(true); pinky.pant = true;
  await wait(tok, 1.4); happy(false); camHome();
}
// ---------- 하이파이브: 엄마가 손을 높이 들면 몸을 세우고 앞발을 머리 높이까지 번쩍 들어 짝! (두 번: 오른발 · 왼발)
const mirrorFront = (T) => { const a = T.paws[0].clone(), b = T.paws[1].clone(); T.paws[0].set(-b.x, b.y, b.z); T.paws[1].set(-a.x, a.y, a.z); [T.lean[0], T.lean[1]] = [T.lean[1], T.lean[0]]; [T.abd[0], T.abd[1]] = [T.abd[1], T.abd[0]]; T.headTilt = -T.headTilt; }; // 앞발 자세를 좌우로 뒤집는다
async function pupuHigh5(tok) {
  await comeHere(tok, 0.85);
  const ph = phoneK(); { const [p, a] = kneelAt(1.05 * ph, 0.68, 0.36); camTo(p, a); }
  sitFront(7); pinky.wagAmpT = 0.6; pinky.wagSpeedT = 12;
  await wait(tok, 0.8);
  const hi = poseFor('high5', pinky), up = hi.paws[0]; // PUPU_POSES.high5: 오른 앞발을 머리 높이로
  tok.cleanups.push(() => { handR.want = null; });
  for (let n = 0; n < 2; n++) {
    const i = n, m = i === 0 ? 1 : -1;
    const tgtPt = () => rootW(m * up.x, up.y + 0.03, up.z + 0.02), live = () => pinky.legs[i].foot.getWorldPosition(V3()).add(V3(0, 0.025, 0));
    let reach = 0;
    handR.want = { pos: () => (reach > 0 ? live() : tgtPt()).addScaledVector(toCamDir(), 0.2 - 0.16 * reach), up: () => toCamDir(), curl: 0.04, rate: 6 }; // 손바닥이 푸푸 쪽을 본다 (푸푸 머리 높이)
    await wait(tok, 0.5);
    if (n === 0) say('하이파이브!', headTop, 'soft', 1.4);
    pinky.lookFn = () => handR.pos; pinky.earPerk = 1; pinky.wagAmpT = 0.8; pinky.wagSpeedT = 16;
    await wait(tok, 0.6);
    setPose(pinky, 'high5', 6); if (i === 1) mirrorFront(pinky.tgt); // 가슴을 펴고 앞발을 번쩍
    await wait(tok, 0.55);
    await tween(tok, 0.12, (k) => { reach = k; });
    bubble('짝!', () => handR.pos.clone().add(V3(0, 0.09, 0)), '', 1.0, 0); snd('sfx', 'paw_clap', { pos: handR.pos.toArray(), force: 1, why: 'high five' }); heart();
    pinky.earPerk = 0.4; pinky.wagAmpT = 1.0; pinky.wagSpeedT = 20;
    await tween(tok, 0.25, (k) => { reach = 1 - 0.7 * k; });
    await wait(tok, 0.3);
    sitFront(6); handR.want = null; pinky.lookFn = null;
    await wait(tok, 0.6);
    if (n === 0) { say('한 번 더!', headTop, 'soft', 1.3); await wait(tok, 0.9); }
  }
  happy(true); pinky.tiltT = 0.25; say(rot('h5', ['하이파이브 최고!', '또 해요!', '헤헤, 짝짝!']), headTop, 'soft', 1.8); await wait(tok, 1.9); happy(false); pinky.tiltT = 0; camHome();
}
// ---------- 물장구: 냇물에 들어가 앞발로 물을 탁탁 쳐 첨벙 · 코를 물에 퐁 · 할짝할짝 물을 마시고 · 물가로 나와 부르르
async function pupuSplash(tok, solo = false) {
  const B = NS_SPOT.bank, W = NS_SPOT.wade, ph = phoneK(), waterAt = (x, z) => V3(x, nsWaterY(z), z);
  toy.tok = tok; tok.cleanups.push(() => { pinky.pawUp = null; toyOff(); });
  setPose(pinky, 'stand', 6); pinky.sniff = 0; pinky.lookFn = () => waterAt(W.x, W.z); pinky.earPerk = 1; pinky.wagAmpT = 0.8; pinky.wagSpeedT = 16;
  if (!solo) say('물이다!', headTop, 'soft', 1.4);
  await wait(tok, solo ? 0.3 : 0.6);
  pinky.walkSpeed = solo ? 0.7 : 1.0;
  if (Math.hypot(pinky.x - B.x, pinky.z - B.z) > 0.1) await walkTo(tok, B.x, B.z);
  const tall = roomCam.aspect < 0.8, bankCam = () => camTo(tall ? V3(0.38, 1.25, 1.95) : V3(0.42, 0.95, 1.12), V3(1.42, 0.1, -0.28), 1.6);
  if (!solo) bankCam(); // 물가에 쪼그려 앉아 내려다본다
  pinky.lookFn = null; pinky.walkSpeed = 0.42; pinky.tgt.headPitch = 0.35; pinky.tgt.gaze = 0.4;
  await walkTo(tok, W.x, W.z);
  pinky.face = 'cam'; pinky.tgt.yawOff = 0.75; await wait(tok, 0.6); // 비스듬히 엄마 쪽을 보고 서서 발 앞의 물을 본다
  const ahead = () => rootW(0, 0, 0.3).setY(nsWaterY(pinky.z));
  pinky.lookFn = ahead; pinky.tgt.gaze = 1; pinky.wagAmpT = 0.9; pinky.wagSpeedT = 17;
  const strikes = solo ? 2 : 5;
  for (let n = 0; n < strikes; n++) { // 앞발을 들었다가 탁! (대개 오른발, 가끔 왼발)
    const i = n % 3 === 2 ? 1 : 0;
    pinky.pawUp = { i, k: 0, y: 0.17, z: 0.1 };
    await tween(tok, 0.24, (k) => { pinky.pawUp.k = ease(k); });
    await wait(tok, 0.06);
    await tween(tok, 0.09, (k) => { pinky.pawUp.k = 1 - k * k; });
    pinky.pawUp = null;
    const f = pinky.legs[i].foot.getWorldPosition(V3());
    nsSplash(f, 26, n === strikes - 1 ? 1.25 : 1); snd('sfx', 'splash', { pos: [f.x, nsWaterY(f.z), f.z], force: 1, gain: n ? -2 : 0, why: 'paw strikes water' });
    bubble(n === strikes - 1 ? '첨벙첨벙!' : '첨벙!', headTop, '', 0.9, (n % 2 ? 1 : -1) * 75);
    pinky.earPerk = 0.7 + 0.3 * Math.random();
    await wait(tok, 0.22 + Math.random() * 0.14);
  }
  // 코를 물에 퐁 — 고개를 털고
  if (!solo) { const N = noseTip(), h = V3(cam.pos.x - N.x, 0, cam.pos.z - N.z).normalize(); N.y = nsWaterY(N.z) + 0.05; camTo(N.clone().addScaledVector(h, tall ? 1.35 : 0.95).add(V3(0, tall ? 0.26 : 0.15, 0)), N, 2.2); } // 엄마가 물가에 낮게 쪼그려 얼굴 가까이 (마시는 혀가 보이게)
  setPose(pinky, 'eat', 4); pinky.tgt.gaze = 0; pinky.tgt.yawOff = 0.6; pinky.face = 'cam'; pinky.lookFn = null; pinky.wagAmpT = 0.6; pinky.wagSpeedT = 12; // 비스듬히 고개를 숙여 (물 마시는 입이 보이게)
  await wait(tok, 0.8);
  { const nz = noseTip(); nsRing(nz.x, nz.z, 0.08, 0.9); bubble('퐁', noseTip, 'small', 0.9, 40); }
  await wait(tok, 0.4);
  pinky.tgt.headPitch -= 0.5; await wait(tok, 0.3);
  toy.shake = 0.7; toy.shakeHz = 5; await wait(tok, 0.45); toy.shake = 0;
  for (let k = 0; k < 8; k++) { const nz = noseTip(), a = Math.random() * 6.28; nsDrop(nz, V3(Math.cos(a) * 0.8, 0.5 + Math.random() * 0.6, Math.sin(a) * 0.8), 0xeaf6ff, 0.005); }
  pinky.tgt.headPitch += 0.5; await wait(tok, 0.5);
  // 할짝할짝 물을 마신다
  toy.lap = 1; toy.lapKind = 'water'; say('할짝할짝', headTop, '', 1.3, 70);
  await wait(tok, solo ? 2.0 : 2.4); bubble('꼴깍', headTop, 'small', 0.9, -60); await wait(tok, 0.9);
  toy.lap = 0; pinky.lick = 1; await wait(tok, 0.55); pinky.lick = 0;
  setPose(pinky, 'stand', 5); pinky.tgt.yawOff = 0;
  if (!solo) { bankCam(); pinky.face = 'cam'; pinky.tiltT = 0.2; say('시원하다!', headTop, 'soft', 1.6); await wait(tok, 1.3); pinky.tiltT = 0; }
  // 물가로 나와 부르르
  pinky.walkSpeed = 0.6; await walkTo(tok, B.x, B.z); pinky.walkSpeed = 0.5;
  await pupuShake(tok);
  if (solo) return;
  camHome(); await comeHere(tok, 0.85); sitFront(6);
  happy(true); say(rot('splash', ['물놀이 최고!', '또 하고 싶다!', '시원해요!']), headTop, 'soft', 1.8); heart();
  await wait(tok, 1.9); happy(false);
}
async function pupuShake(tok) { // 부르르: 털에서 물방울이 사방으로
  (async () => { await wait(tok, 0.35); for (let i = 0; i < 9; i++) { await wait(tok, 0.1); const c = pinky.body.getWorldPosition(V3()); for (let j = 0; j < 7; j++) { const a = Math.random() * Math.PI * 2, s = 1.0 + Math.random() * 1.2; nsDrop(c.clone().add(V3(Math.cos(a) * 0.13, Math.random() * 0.08, Math.sin(a) * 0.13)), V3(Math.cos(a) * s, 0.5 + Math.random() * 1.2, Math.sin(a) * s), 0xeaf6ff, 0.004 + Math.random() * 0.005); } } })().catch(() => {});
  await shakeOff(tok);
}
// ---------- 똥츄: 길가 풀밭을 킁킁 돌다가 → 고개를 돌리고 쪼그려 볼일 → 뒷발로 풀을 슥슥 (뿌듯) → 엄마 손이 봉투로 쏙 집어 들어 올린다 · 똥츄 완료!
function pupuSquat(d) { // 쪼그려 앉기: 엉덩이를 풀 위로 낮추고 등을 둥글게 말며, 뒷발은 배 밑으로 당겨 벌린다. 앞다리는 곧게, 꼬리는 등 위로
  setPose(d, 'stand', 3); const T = d.tgt;
  Object.assign(T, { bodyY: 0.2, pitch: -0.5, lumbar: 0.75, splay: 0.25, headPitch: 0.12, gaze: 0.8 });
  for (const i of [2, 3]) { T.paws[i].z += 0.14; T.lean[i] = 1.3; }
  for (const i of [0, 1]) T.paws[i].z += 0.02;
}
async function pupuPoop(tok) {
  const S = NS_SPOT.grass, phone = roomCam.aspect < 0.8;
  tok.cleanups.push(() => { pinky.kick = 0; });
  camTo(phone ? V3(S.x - 1.75, 0.98, S.z - 0.32) : V3(S.x - 1.2, 0.66, S.z - 0.24), V3(S.x - 0.02, 0.2, S.z - 0.04), 2.0); // 엄마는 길 위에서 옆으로 본다 (풀밭의 푸푸가 옆모습으로)
  setPose(pinky, 'stand', 6); pinky.tgt.gaze = 0; pinky.tgt.headPitch = 0.6; pinky.sniff = 0.6; pinky.walkSpeed = 0.5; pinky.wagAmpT = 0.35; pinky.wagSpeedT = 8;
  await walkTo(tok, S.x - 0.04, S.z + 0.42);
  say('킁킁', noseTip); pinky.walkSpeed = 0.3;
  await walkTo(tok, S.x + 0.07, S.z + 0.1); say('킁킁', noseTip); await walkTo(tok, S.x, S.z);
  pinky.sniff = 0; pinky.face = { x: S.x, z: S.z - 1.2 }; await wait(tok, 0.7); // 길을 따라 선 옆모습
  pupuSquat(pinky); pinky.face = null;
  pinky.lookFn = () => V3(pinky.x + 1.3, 0.3, pinky.z - 0.5); pinky.earPerk = -0.4; pinky.eyeOpen = 0.55; pinky.wagAmpT = 0.04; // 부끄러워 엄마 반대쪽(냇물)을 본다
  await wait(tok, 1.0); say('끙…', headTop, 'small', 1.4, 50);
  { const y0 = pinky.tgt.bodyY; await tween(tok, 1.3, (k) => { pinky.tgt.bodyY = y0 + 0.004 * Math.sin(k * Math.PI * 12); }); pinky.tgt.bodyY = y0; } // 끙… 힘을 주느라 살짝 떨린다
  { const p = rootW(0, 0, -0.2); NS.poop.position.set(p.x, nsGround(p.x, p.z) - 0.002, p.z); NS.poop.rotation.y = Math.random() * 6; NS.poop.visible = true; NS.poop.scale.setScalar(0.01); }
  await tween(tok, 0.4, (k) => { NS.poop.scale.setScalar(Math.max(0.01, ease(k))); });
  await wait(tok, 0.4);
  setPose(pinky, 'stand', 4); pinky.eyeOpen = 1; pinky.earPerk = 0.4; pinky.lookFn = null; pinky.tgt.gaze = 0.6; say('휴~', headTop, 'soft', 1.2);
  await wait(tok, 0.7);
  // 한 걸음 나가서 뒷발로 풀을 슥슥 — 꼬리를 높이, 가슴을 펴고 뿌듯하게
  { const q = { x: pinky.x + Math.sin(pinky.yaw) * 0.3, z: pinky.z + Math.cos(pinky.yaw) * 0.3 }; collide(q); pinky.walkSpeed = 0.35; await walkTo(tok, q.x, q.z); pinky.walkSpeed = 0.5; }
  const st = poseFor('stand', pinky);
  Object.assign(pinky.tgt, { headPitch: -0.28, gaze: 0.3, tail: st.tail + 0.2, pitch: st.pitch + 0.07 }); pinky.wagAmpT = 0.6; pinky.wagSpeedT = 14; pinky.earPerk = 0.6;
  pinky.kick = 1; say('슥슥!', headTop, '', 1.0, -70); await wait(tok, 0.8); say('슥슥!', headTop, '', 1.0, 70); await wait(tok, 0.8);
  pinky.kick = 0; say('깔끔하게!', headTop, 'soft', 1.4); await wait(tok, 0.6);
  // 엄마 손이 봉투로 쏙 집어서 들어 올린다
  const P = NS.poop.position.clone(); let dip = 0.24, lift = 0;
  camTo(phone ? V3(P.x - 1.35, 1.0, P.z + 0.5) : V3(P.x - 1.0, 0.72, P.z + 0.34), V3(P.x + 0.02, 0.14, P.z - 0.24), 2.4); await wait(tok, 0.5); // 엄마가 허리를 숙여 다가간다 (볼일이 가운데 · 그 너머로 푸푸가 지켜본다)
  handR.rig.inner.add(NS.bag); NS.bag.position.set(0, -0.062, 0.045); NS.bag.rotation.set(0, 0, 0); NS.bag.scale.setScalar(1); NS.bag.visible = true; NS.bagKnot.visible = false;
  const lifted = () => P.clone().lerp(cam.pos, 0.3).setY(0.36); // 들어 올린 봉투: 엄마 쪽으로 조금 당겨 화면 가운데 높이
  handR.want = { pos: () => P.clone().add(V3(0, 0.07 + dip, 0)).lerp(lifted(), lift), up: () => V3(0, 1, 0), curl: 0.55, rate: 4.5 };
  pinky.face = 'cam'; pinky.lookFn = () => handR.pos; pinky.tgt.gaze = 1; pinky.tgt.headPitch = 0.1;
  await wait(tok, 1.2);
  await tween(tok, 0.45, (k) => { dip = 0.24 * (1 - ease(k)); });
  NS.poop.visible = false; NS.bagKnot.visible = true; NS.bag.scale.set(1.1, 1.06, 1.1); snd('sfx', 'crinkle', { pos: P.toArray(), gain: -7, rate: 1.25, force: 1, why: 'poop bag' }); bubble('바스락', () => handR.pos.clone().add(V3(0, 0.08, 0)), 'small', 0.9, 40);
  await wait(tok, 0.35);
  await tween(tok, 0.6, (k) => { lift = ease(k); }); // 봉투를 묶어 번쩍
  handR.want.rate = 6; await wait(tok, 0.2);
  bubble('똥츄 완료!', headTop, 'soft', 2.0, -70); // 엄마의 말 (푸푸 머리 옆)
  pinky.wagAmpT = 0.85; pinky.wagSpeedT = 16; pinky.tgt.headPitch = -0.1; await wait(tok, 1.1);
  handR.want = null; pinky.lookFn = null;
  say('헤헤', headTop, 'soft', 1.3); await wait(tok, 0.6);
  camHome(); await comeHere(tok, 0.8); sitFront(6); happy(true); heart(); await wait(tok, 1.4); happy(false);
}
// ---------- 터키츄: 보자마자 신나서 제자리 빙글 → 앉아서 기다렸다가 살며시 받아 물고 → 엎드려 두 앞발로 붙잡고 오독오독 → 꿀꺽 · 터키츄 최고!
const PTREAT = ['터키츄 최고!', '세상에서 제일 맛있어!', '터키츄 하나 더요?'];
async function pupuTreat(tok) {
  const T = NS.turkey, ph = phoneK(), UP = V3(0, 1, 0);
  toy.tok = tok; tok.cleanups.push(() => { toyOff(); T.hide(); pinky.smile = 1; });
  { const [p, a] = kneelFor(HOME, 1.05 * ph, 0.56, 0.3); camTo(p, a); }
  T.reset(); T.g.visible = true; T.state = 'held'; toy.fill = 1;
  const pinch = () => handR.rig.inner.localToWorld(V3(0.012, -0.034, 0.072));
  const dp = poseFor('down', pinky), pawZ = dp.paws[0].z + 0.04;
  let side = 1;
  const drv = propDriver(T, {
    hand(C, D, U) { const Bp = pinch(), v = mouthPt().sub(Bp); v.y -= 0.04; v.normalize(); C.copy(Bp).addScaledVector(v, T.len); D.copy(v).negate(); U.copy(UP); }, // 한쪽 끝을 쥐고 씹을 쪽을 푸푸에게
    jaw(C, D, U) { C.copy(jawW(0.008, -0.01, 0.05)); D.copy(jawDir(0.8, -0.15, 0.55)).normalize(); U.copy(jawDir(0, 1, 0)); },
    paws(C, D, U) { // 어금니 쪽으로 물고, 반대쪽 끝은 두 앞발 사이 바닥에
      C.copy(jawW(side * 0.012, -0.012, 0.05)); const Bp = rootW(0, 0.014, pawZ), l = T.len, d = Bp.distanceTo(C), dy = Math.max(C.y - Bp.y + 0.004, 0);
      D.copy(Bp).sub(C).normalize();
      if (d < l) { if (dy >= l) D.set(0, -1, 0); else { const hx = Bp.x - C.x, hz = Bp.z - C.z, hl = Math.hypot(hx, hz) || 1, hh = Math.sqrt(l * l - dy * dy); D.set((hx / hl) * hh, -dy, (hz / hl) * hh).normalize(); } }
      U.copy(UP);
    },
  });
  toy.tick = () => drv.tick();
  let target = () => roomCam.localToWorld(ph > 1 ? V3(0.05, -0.03, -0.5) : V3(0.13, -0.045, -0.46));
  handR.want = { pos: () => target(), up: () => V3(0, 1, 0), curl: 0.75, rate: 5 };
  await drv.to(tok, 'hand', 0);
  pinky.lookFn = () => T.g.position;
  await wait(tok, 0.35);
  pinky.earPerk = 1; pinky.wagAmpT = 1.0; pinky.wagSpeedT = 20; say('터키츄다!', headTop, 'soft', 1.4);
  await wait(tok, 0.6);
  if (Math.hypot(pinky.x - HOME.x, pinky.z - HOME.z) > 0.08) { setPose(pinky, 'stand', 7); pinky.walkSpeed = 1.0; await walkTo(tok, HOME.x, HOME.z); pinky.walkSpeed = 0.5; }
  // 좋아서 제자리에서 빙글
  setPose(pinky, 'stand', 6); pinky.face = null; pinky.lookFn = null; pinky.tgt.gaze = 0.3; await wait(tok, 0.2);
  { const y0 = pinky.yaw, dir = Math.random() < 0.5 ? 1 : -1; say('빙글!', headTop, 'small', 1.0, 0); await tween(tok, 1.05, (k) => { pinky.yaw = y0 + dir * Math.PI * 2 * ease(k); pinky.shuffle = 0.25 + 0.5 * Math.sin(Math.PI * k); }); pinky.shuffle = 0; }
  pinky.face = 'cam'; pinky.lookFn = () => T.g.position; pinky.tgt.gaze = 1;
  await sitAs(tok, 'front', 8);
  pinky.paddle = 0.35; pinky.paddleFront = true; await wait(tok, 1.0); pinky.paddle = 0; pinky.paddleFront = false; // 앞발을 동동
  // 내밀면 살며시 받아 문다
  const v0 = toCamDir().negate().multiplyScalar(0.6).addScaledVector(camRight(), -0.8); v0.y = 0.1; v0.normalize();
  target = () => { const m = mouthPt().addScaledVector(toCamDir(), 0.014); return m.addScaledVector(v0, -T.len).sub(pinch().sub(handR.pos)); };
  handR.want.rate = 4; await wait(tok, 0.85);
  pinky.tgt.reach = 0.03; pinky.tgt.neck += 0.1; await wait(tok, 0.3);
  pinky.jawOpen = 0.25; await wait(tok, 0.25);
  say('앙', headTop, 'small', 1); handR.want.curl = 0.3;
  await drv.to(tok, 'jaw', 0.3); pinky.jawOpen = toy.rest = 0.1; pinky.smile = 0; // 물고 있는 동안은 웃던 입을 다물고 오물오물
  handR.want = null; pinky.lookFn = null; pinky.tgt.reach = 0; pinky.tgt.neck = poseFor('sit', pinky).neck;
  await wait(tok, 0.8);
  // 엎드려 두 앞발로 붙잡고
  setPose(pinky, 'down', 3); pinky.tgt.yawOff = -0.45; pinky.wagAmpT = 0.7; pinky.wagSpeedT = 14; pinky.earPerk = 0;
  { const [p, a] = kneelAt(0.95 * ph, 0.32, 0.14); camTo(p, a, 1.8); }
  await wait(tok, 1.25);
  const pawPt = () => rootW(0, 0.014, pawZ);
  let lookUp = 0; pinky.lookFn = () => pawPt().add(V3(0, 0.1 + lookUp, 0)).addScaledVector(toCamDir(), 0.08 + lookUp * 1.5);
  pinky.tgt.gaze = 0.6; pinky.tgt.neck = 0.2; pinky.tgt.reach = 0.02;
  pinky.tgt.paws[0].set(dp.paws[0].x * 0.62, 0.04, pawZ - 0.01); pinky.tgt.paws[1].set(dp.paws[1].x * 0.62, 0.04, pawZ - 0.01);
  await wait(tok, 0.45);
  await drv.to(tok, 'paws', 0.35); toy.rest = 0; pinky.eyeOpen = 0.85;
  const words = ['오독', '오독오독', '냠냠', '아작아작', '오독'];
  toy.chewKind = 'crunch';
  for (let i = 0; i < 5; i++) {
    side = i < 2 ? 1 : i < 4 ? -1 : 1; pinky.tiltT = side * 0.38; toy.chew = 1; toy.chewRate = 10; pinky.tgt.gaze = 0.6 + 0.05 * i;
    sideSay(words[i], i);
    await wait(tok, 1.0);
    T.setLen(T.k - 0.19); spawnCrumbs(jawW(0, -0.012, 0.05), 2, T.crumb);
    if (i === 1 || i === 3) { toy.chewRate = 13; lookUp = 0.16; pinky.eyeOpen = 0.3; pinky.wagAmpT = 0.95; pinky.wagSpeedT = 20; if (i === 3) heart(); await wait(tok, 0.55); pinky.eyeOpen = 0.85; pinky.wagAmpT = 0.7; pinky.wagSpeedT = 14; } // 너무 맛있어서 눈을 지그시
    lookUp = 0; await wait(tok, 0.12);
  }
  // 마지막 한 입
  T.g.visible = false; T.state = 'none'; drv.stop(); pinky.lookFn = null; pinky.tgt.gaze = 1; pinky.tgt.neck = 0; pinky.tgt.reach = 0; pinky.tiltT = 0;
  pinky.tgt.paws[0].copy(dp.paws[0]); pinky.tgt.paws[1].copy(dp.paws[1]);
  toy.chewRate = 15; await wait(tok, 0.7); toy.chew = 0; say('꿀꺽', headTop, 'small', 1.0);
  await wait(tok, 0.5);
  pinky.lick = 1; say('쩝쩝', headTop, '', 1.2, 80); await wait(tok, 0.95); pinky.lick = 0; pinky.smile = 1;
  await sitAs(tok, 'front', 5);
  happy(true); pinky.tiltT = 0.25;
  say(rot('pt', PTREAT), headTop, 'soft', 2.0); heart();
  await wait(tok, 1.9); happy(false); pinky.tiltT = 0;
  T.hide(); toyOff(); camHome();
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
  resetTransient(pinky); Object.assign(pinky, { sigh: 0, curlK: 0, curlS: 0, napEnd: 0, tailWrap: false, tailW: 0 }); toy.fk = 0; faceFill.intensity = 0; // 간식 먹다 나갔다 와도 얼굴 불빛이 남지 않게 for (const L of pinky.legs) L.hip.rotation.y = 0; cushGo = false;
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
  brainEnter(); // 저쪽에서 냄새 맡다가 "엄마다!" 하고 달려온다
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
  stepTouch(dt); stepBrain(dt);
  if (!active && !transitioning) { idleT -= dt; if (idleT <= 0) { if (!(pinky.tgt.name === 'curl' && napKeep()) && !(pinky.dami && DM.away > 0 && cdOK('jealous', 40))) camHome(); startCommand('roam', roam, true); } } // 혼자 돌아다니기 시작하면 시점도 제자리로(빈 방석만 보고 있지 않게)
  updateDog(pinky, dt, t, roomCam.position); napPost(pinky, dt, t);
  updateHand(handR, 1, dt); updateHand(handL, -1, dt);
  if (RP.post) RP.post(pinky, dt, t); // 놀이터: 엉덩이 씰룩 · 땅 파기 · 모래 · 던진 장난감 · 오둥이
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
function goRoom(id) { // id: 강아지 (없으면 지금 고른 강아지) — 그 강아지의 장소로 들어간다
  const info = DOGS.find((q) => q.id === id) || DOGS[sel];
  fade(() => { useRoom(info.room || 'home'); mode = 'room'; $('#selectUI').hidden = true; $('#roomUI').hidden = false; resetRoom(); $('#backBtn').focus({ preventScroll: true }); });
}
function goSelect() {
  if (transitioning) return;
  cancelActive(); resetTransient(pinky); snd('hush', 250); clearBubbles(); releaseHands(); closePicker(); touch.active = false; drag = null; idleT = Infinity; // 나가는 동안에는 씹는 소리도 로프 떨어지는 소리도 나지 않게
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
      const keep = napKeep(); if (!keep) pinky.napEnd = 0;
      startCommand('touch', CMDS.touch, keep); if (keep) setActiveBtn('cushion');
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
    brain.dragAt = clock; if (camTurn) { camTurn = false; cam.tPos.copy(CAM_POS); cam.tAim.copy(CAM_AIM); } // 밥그릇 쪽으로 돌려 둔 시점은 끌기 시작하면 바로 놓아준다
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
  setCamPos(a);
}
window.addEventListener('resize', resize); resize();

// ================================================================
// 소리 — 핑키의 상태를 읽기만 해서 sound.js에 넘겨 준다 (언제 무슨 소리를 낼지는 sound.js가 정한다)
// ================================================================
sound.init({ off: WALK_OFF, duty: WALK_DUTY, rug: [0.1, 0.8, 1.45, 0.95], cush: [CUSH.x, CUSH.z, CUSH.R], bowl: [BOWL.x, BOWL.z], lite: LITE });
const _sv = V3();
let sndGreetAt = -1, sndMode = 'select';
function updateSound(dt, t) {
  sound.setScene(mode);
  if (mode !== sndMode) { sndMode = mode; sndGreetAt = mode === 'room' ? t + 1.3 : -1; }
  if (mode !== 'room') { sound.update(dt, t, null); return; }
  if (sndGreetAt > 0 && t >= sndGreetAt && !transitioning) { sndGreetAt = -1; } // 방에 들어오면 인식표가 먼저 짤랑 — 곧이어 "엄마다!" 하고 달려온다 (핑키의 마음 참고)
  _sv.setFromMatrixColumn(roomCam.matrixWorld, 0);
  sound.setListener([roomCam.position.x, roomCam.position.y, roomCam.position.z], [_sv.x, _sv.y, _sv.z]);
  pinky.head.getWorldPosition(_sv); const hd = [_sv.x, _sv.y, _sv.z];
  ball.g.getWorldPosition(_sv);
  sound.update(dt, t, {
    x: pinky.x, z: pinky.z, lift: pinky.lift, pose: pinky.tgt.name, head: hd, cmd: active ? active.name : null, touchActive: touch.active,
    chew: pinky.chew, lick: pinky.lick, pant: pinky.pant, sniff: pinky.sniff, sigh: pinky.sigh || 0, paddle: pinky.paddle, eyeOpen: pinky.eyeOpen,
    gait: pinky.gait, phase: pinky.phase, wagAmp: pinky.wagAmp, wagPhase: pinky.wagPhase,
    pouring, kibbles: kibbles.length, mound: mound.amount, bowl: [BOWL.x, 0.03, BOWL.z],
    ball: { on: ball.state === 'fly' || ball.state === 'roll', x: _sv.x, y: _sv.y, z: _sv.z, vx: ball.v.x, vy: ball.v.y, vz: ball.v.z },
  });
}
const sndBtns = document.querySelectorAll('.snd'); // 방 머리줄과 친구들 화면에 하나씩 (들어가기 전에 미리 끌 수 있게)
const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (/Mac/.test(navigator.platform || '') && navigator.maxTouchPoints > 1);
function paintSndBtn() { const on = sound.enabled; for (const b of sndBtns) { b.hidden = !sound.supported; b.textContent = on ? '🔊' : '🔇'; b.setAttribute('aria-pressed', String(on)); b.title = on ? '소리 끄기' : '소리 켜기'; b.classList.toggle('off', !on); } }
for (const b of sndBtns) b.addEventListener('click', () => { sound.setEnabled(!sound.enabled); paintSndBtn(); toast(!sound.supported ? '이 브라우저에서는 소리를 낼 수 없어요' : sound.enabled ? (IOS ? '소리를 켰어요 · 무음 모드에서는 들리지 않아요' : '소리를 켰어요') : '소리를 껐어요'); });
paintSndBtn();
if (location.hostname === 'localhost') setTimeout(() => { if (window.__dbg) window.__dbg.sound = sound; }); // 로컬 점검용

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
let sndErr = false;
let dbgPause = false; // 점검용: 화면 그리기를 멈추고 시간을 손으로 넘긴다
function frame(now) {
  if (dbgPause) { last = now; requestAnimationFrame(frame); return; }
  const dt = clamp((now - last) / 1000, 0, 0.05); last = now; clock += dt; // 첫 프레임의 시각이 불러오기 전일 수도 있다: 시간은 거꾸로 가지 않는다
  stepTimers();
  if (mode === 'select') { updateSelect(dt, clock); drawFrame(selScene, selCam); stepBubbles(dt, selCam); }
  else { updateRoom(dt, clock); drawFrame(roomScene, roomCam); stepBubbles(dt, roomCam); }
  try { updateSound(dt, clock); } catch (e) { if (!sndErr) { sndErr = true; console.warn('sound', e); } } // 소리가 방을 멈추게 해서는 안 된다
  if (!booted) { booted = true; $('#boot').classList.add('gone'); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 로컬에서만 쓰는 점검용 핸들
if (location.hostname === 'localhost') window.__dbg = { pinky, setPose, startCommand, CMDS, look, cam, ball, goRoom, goSelect, roomCam, CUSH, POSES, CURL, fitCurl, OBST, roomScene, renderer, ballToWorld,
  get clock() { return clock; }, get active() { return active; }, get idleT() { return idleT; }, set idleT(v) { idleT = v; }, pause(v) { dbgPause = v; },
  step(dt) { clock += dt; stepTimers(); updateRoom(dt, clock); stepBubbles(dt, roomCam); }, draw() { drawFrame(roomScene, roomCam); stepBubbles(0, roomCam); },
  plushAmb, plushU,
  cushionNapForTest: (tok) => cushionNap(tok, 6),
  NAP: (pk) => { Object.assign(pk, { x: SPOTS.cushion.x, z: SPOTS.cushion.z, yaw: CUSH.yaw, face: null, lift: cushLift(Math.hypot(CUSH.px, CUSH.pz)), eyeOpen: 0.04, wagAmpT: 0.03, curlK: 1, tailW: 1 }); setPose(pk, 'curl', 50); },
  SPOTS, HOME, handR, handL, treat, rope, ROPE_REST, yogurt, yogurtDab, goguma, buildYogurt, buildGoguma, releaseProps, resetProps, toy, sitAs, SIT_F, bringToy, sitCommand, sitLatch, faceFill,
  tick: (dt) => { clock += dt; stepTimers(); updateRoom(dt, clock); stepBubbles(dt, roomCam); }, isActive: () => active && active.name,
  get dog() { return pinky; }, get dami() { return DAMI; }, get DP() { return DP; }, DUCK_OB, DUCK_SPOTS, damiTreatWag, damiDig, get RP() { return RP; }, useRoom, PARK, ROOM_HOME, ROOM_PARK, HOME_KIDS, inSand,
  brain, BRAIN, drops, dropTreat, wait, until, idleGap, idleLook, yawn, shakeOff, stretch, momCheck, hideTreat, nearestDrop, mound, updateMound, brainPoke, startSpecial, momGreet, payBall, findTreat, eatLeft, sneeze, roam, resetRoom, special: () => (active && active.special) || null, bubbles: () => bubbles.map((b) => b.el.textContent),
  DM, friendStart, friendOff, damiAttn, damiWoof, friendScene, sndUpdate: (dt, t) => updateSound(dt, t), get mode() { return mode; },
  get pupu() { return PUPU; }, get NS() { return NS; }, poseFor, ROOM_NAMSAN, nsGround, nsInWater, nsWaterY, NS_SX, NS_SW, NS_SPOT, contact, toyOff, buildDog, COLORS };
