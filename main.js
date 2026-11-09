import * as THREE from './vendor/three.module.min.js';

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
  renderer = new THREE.WebGLRenderer({ canvas: $('#c'), antialias: true, powerPreference: 'high-performance' });
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
// 강아지 (2등신 · 큰 머리)
// ================================================================
const COLORS = {
  pinky: { base: 0xf4ede3, tan: 0xd3a477, saddle: 0x5a473b, ear: 0xc9976a, nose: 0x1c1513, rim: 0x6a442f, collar: 0xe88fa1, blush: 0xff9aa8 },
  pupu: { base: 0xf1e6d2, tan: 0xe7d0ab, saddle: 0xe7d0ab, ear: 0xe0c49a, nose: 0x6f4a46, rim: 0x3a2a22 },
  generic: { base: 0xe9e1d6, tan: 0xc99a6c, saddle: 0x4a3c34, ear: 0xc39066, nose: 0x1c1513, rim: 0x55382a },
};
const P = (x, y, z) => V3(x, y, z);
const POSES = {
  stand: { bodyY: 0.3, bodyZ: 0, pitch: 0, roll: 0, yawOff: -0.5, gaze: 1, headPitch: 0, headTilt: 0, tail: -0.35, level: 1,
    paws: [P(0.07, 0.03, 0.165), P(-0.07, 0.03, 0.165), P(0.075, 0.03, -0.14), P(-0.075, 0.03, -0.14)] },
  sit: { bodyY: 0.215, bodyZ: -0.03, pitch: -0.62, roll: 0, yawOff: -0.6, gaze: 1, headPitch: 0, headTilt: 0, tail: -0.97, level: 1,
    paws: [P(0.065, 0.03, 0.12), P(-0.065, 0.03, 0.12), P(0.1, 0.03, 0.06), P(-0.1, 0.03, 0.06)] },
  down: { bodyY: 0.135, bodyZ: -0.02, pitch: 0.02, roll: 0, yawOff: -0.7, gaze: 1, headPitch: 0, headTilt: 0, tail: -1.4, level: 1,
    paws: [P(0.075, 0.03, 0.36), P(-0.075, 0.03, 0.36), P(0.12, 0.03, 0.0), P(-0.12, 0.03, 0.0)] },
  side: { bodyY: 0.13, bodyZ: 0, pitch: 0, roll: 1.45, yawOff: -1.15, gaze: 0.6, headPitch: 0.15, headTilt: 0.2, tail: -1.5, level: 0,
    paws: [P(0.36, 0.12, 0.2), P(0.33, 0.16, 0.12), P(0.36, 0.12, -0.15), P(0.33, 0.16, -0.22)] },
  belly: { bodyY: 0.14, bodyZ: 0, pitch: 0, roll: 2.45, yawOff: -1.15, gaze: 0.75, headPitch: -0.2, headTilt: -0.55, tail: -1.4, level: 0,
    paws: [P(0.2, 0.36, 0.22), P(0.12, 0.38, 0.12), P(0.22, 0.33, -0.12), P(0.14, 0.36, -0.2)] },
};
const POSE_KEYS = ['bodyY', 'bodyZ', 'pitch', 'roll', 'yawOff', 'gaze', 'headPitch', 'headTilt', 'tail', 'level'];

function poseFor(name, d) {
  const p = POSES[name];
  const o = { ...p, name, paws: p.paws.map((v) => v.clone()) };
  if (name === 'stand') o.bodyY += d.L1 + d.L2 - 0.22;
  return o;
}
function setPose(d, name, rate = 5) {
  const p = poseFor(name, d);
  for (const k of POSE_KEYS) d.tgt[k] = p[k];
  d.tgt.name = name;
  p.paws.forEach((v, i) => d.tgt.paws[i].copy(v));
  d.poseRate = rate;
}

function buildDog({ kind, colors: C, silhouette = false, scale = 1, seed = 0 }) {
  const J = kind === 'jindo';
  const silMat = silhouette ? new THREE.MeshStandardMaterial({ color: 0x2b201b, roughness: 0.9, emissive: 0x170f0b }) : null;
  const mk = (c, o) => silMat || M(c, { roughness: 0.75, ...o });
  const d = { kind, J, scale, seed, meshes: [], ears: [], eyes: [], legs: [] };
  d.root = new THREE.Group();
  const sc = new THREE.Group(); sc.scale.setScalar(scale); d.root.add(sc);
  const body = new THREE.Group(); sc.add(body); d.body = body;
  const put = (par, geo, mat, p, r, s) => { const m = add(par, geo, mat, p, r, s); d.meshes.push(m); return m; };

  const bR = J ? 0.13 : 0.122;
  d.torso = put(body, new THREE.CapsuleGeometry(bR, 0.28, 8, 20), mk(C.base), [0, 0, 0], [Math.PI / 2, 0, 0]);
  put(body, new THREE.CapsuleGeometry(bR + 0.004, J ? 0.22 : 0.19, 8, 20), mk(C.saddle), [0, 0.03, -0.05], [Math.PI / 2, 0, 0]);
  put(body, SPH, mk(C.base), [0, -0.01, 0.14], null, [0.118, 0.125, 0.118]);
  for (const sx of [1, -1]) put(body, SPH, mk(C.base), [sx * 0.06, -0.015, -0.14], null, [0.068, 0.098, 0.105]);
  put(body, new THREE.CapsuleGeometry(0.072, 0.06, 6, 16), mk(C.base), [0, 0.07, 0.19], [0.6, 0, 0]);
  if (!silhouette && C.collar) put(body, new THREE.TorusGeometry(0.077, 0.014, 8, 28), M(C.collar, { roughness: 0.55 }), [0, 0.055, 0.18], [-0.97, 0, 0]);

  // 머리 (크게: 2등신 느낌)
  const hp = new THREE.Group(); hp.rotation.order = 'YXZ'; hp.position.set(0, 0.13, 0.25); body.add(hp); d.hp = hp;
  const head = new THREE.Group(); head.scale.setScalar(J ? 1.4 : 1.48); hp.add(head); d.head = head;
  put(head, SPH, mk(C.base), [0, 0.05, 0.03], null, J ? [0.112, 0.102, 0.105] : [0.106, 0.1, 0.108]);
  if (!J) for (const sx of [1, -1]) put(head, SPH, mk(C.tan), [sx * 0.05, 0.08, 0.012], null, [0.074, 0.072, 0.08]);
  put(head, SPH, mk(C.base), [0, 0.005, 0.118], null, J ? [0.058, 0.05, 0.075] : [0.06, 0.052, 0.085]);
  put(head, SPH, mk(C.nose, { roughness: 0.3 }), [0, 0.032, J ? 0.188 : 0.198], null, [0.03, 0.022, 0.022]);
  const jaw = new THREE.Group(); jaw.position.set(0, -0.026, 0.07); head.add(jaw); d.jaw = jaw;
  put(jaw, SPH, mk(C.base), [0, -0.006, 0.05], null, [0.044, 0.02, 0.064]);
  d.tongue = put(jaw, SPH, mk(0xe9808e, { roughness: 0.45 }), [0, 0.006, 0.055], null, [0.025, 0.008, 0.045]);
  for (const sx of [1, -1]) {
    const eg = new THREE.Group(); eg.position.set(sx * 0.045, 0.068, J ? 0.11 : 0.117); eg.rotation.y = sx * 0.36; head.add(eg);
    if (!silhouette) {
      put(eg, SPH, M(C.rim, { roughness: 0.8 }), [0, 0, -0.004], null, [0.028, 0.026, 0.013]);
      put(eg, SPH, M(0x0e0a08, { roughness: 0.12 }), [0, 0, 0.002], null, [0.021, 0.022, 0.013]);
      const hl = new THREE.Mesh(SPH, new THREE.MeshBasicMaterial({ color: 0xffffff })); hl.position.set(sx * -0.004 - 0.003, 0.009, 0.013); hl.scale.setScalar(0.0062); eg.add(hl);
      const hl2 = new THREE.Mesh(SPH, new THREE.MeshBasicMaterial({ color: 0xffffff })); hl2.position.set(0.006, -0.008, 0.013); hl2.scale.setScalar(0.003); eg.add(hl2);
      if (C.blush) {
        const b = new THREE.Mesh(new THREE.CircleGeometry(0.019, 18), new THREE.MeshBasicMaterial({ color: C.blush, transparent: true, opacity: 0.55, depthWrite: false }));
        b.position.set(sx * 0.068, 0.028, 0.098); b.rotation.y = sx * 0.62; head.add(b);
      }
      if (!J) put(head, SPH, M(C.tan), [sx * 0.044, 0.1, 0.098], [0, 0, sx * -0.35], [0.021, 0.009, 0.013]);
    }
    d.eyes.push(eg);
  }
  for (const sx of [1, -1]) {
    const ep = new THREE.Group(); head.add(ep);
    if (J) { ep.position.set(sx * 0.056, 0.128, 0); put(ep, new THREE.ConeGeometry(0.042, 0.1, 12), mk(C.ear), [0, 0.044, 0], null, [1, 1, 0.55]); ep.rotation.z = sx * -0.22; }
    else { ep.position.set(sx * 0.09, 0.088, 0.005); put(ep, SPH, mk(C.ear), [sx * 0.012, -0.068, 0.004], null, [0.02, 0.082, 0.056]); }
    d.ears.push({ g: ep, side: sx, ax: 0, vx: 0, az: 0, vz: 0 });
  }

  // 꼬리
  const tp = new THREE.Group(); tp.position.set(0, 0.07, -0.24); body.add(tp); d.tail = tp;
  if (J) put(tp, new THREE.TorusGeometry(0.055, 0.03, 10, 20, Math.PI * 1.5), mk(C.base), [0, 0.06, 0], [0, Math.PI / 2, 0.5]);
  else { put(tp, new THREE.CapsuleGeometry(0.02, 0.12, 6, 10), mk(C.saddle), [0, 0.075, 0]); put(tp, SPH, mk(C.base), [0, 0.15, 0], null, [0.024, 0.04, 0.024]); }

  // 다리 (짧게)
  const L1 = J ? 0.12 : 0.11, L2 = J ? 0.12 : 0.11; d.L1 = L1; d.L2 = L2;
  for (const [sx, z, front] of [[1, 0.155, true], [-1, 0.155, true], [1, -0.14, false], [-1, -0.14, false]]) {
    const hip = new THREE.Group(); hip.position.set(sx * 0.07, -0.05, z); body.add(hip);
    put(hip, new THREE.CapsuleGeometry(front ? 0.037 : 0.046, L1 * 0.7, 6, 12), mk(C.base), [0, -L1 / 2, 0]);
    const knee = new THREE.Group(); knee.position.set(0, -L1, 0); hip.add(knee);
    put(knee, new THREE.CapsuleGeometry(0.031, L2 * 0.75, 6, 12), mk(C.base), [0, -L2 / 2, 0]);
    const ank = new THREE.Group(); ank.position.set(0, -L2, 0); knee.add(ank);
    put(ank, SPH, mk(C.base), [0, -0.004, 0.014], null, [0.038, 0.025, 0.05]);
    d.legs.push({ sx, front, hip, knee, ank });
  }

  d.cur = poseFor('stand', d); d.tgt = poseFor('stand', d);
  Object.assign(d, {
    x: 0, z: 0, yaw: 0, external: false, phase: 0, gait: 0, walkTarget: null, walkSpeed: 0.5,
    face: 'cam', lookFn: null, wagPhase: seed, wagAmp: 0.3, wagSpeed: 6, wagAmpT: 0.3, wagSpeedT: 6,
    jawOpen: 0, chew: false, lick: 0, tongueOut: 0, pant: false, sniff: 0, paddle: 0,
    eyeOpen: 1, eyeY: 1, blinkT: 1 + seed, blinkDur: 0, tilt: 0, tiltT: 0, hx: 0, hy: 0, hz: 0, poseRate: 5, earPerk: 0,
  });
  return d;
}

const _v = V3(), _m = new THREE.Matrix4();
function solveLeg(d, L, py, pz, level, bodyPitch) {
  const L1 = d.L1, L2 = d.L2;
  const base = Math.atan2(-pz, -py);
  const dist = clamp(Math.hypot(py, pz), 0.03, L1 + L2 - 1e-4);
  const a = Math.acos(clamp((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1));
  const tu = base + (L.front ? a : -a);
  const ky = -L1 * Math.cos(tu), kz = -L1 * Math.sin(tu);
  const ty = -dist * Math.cos(base), tz = -dist * Math.sin(base);
  const tl = Math.atan2(-(tz - kz), -(ty - ky));
  L.hip.rotation.x = tu; L.knee.rotation.x = tl - tu; L.ank.rotation.x = -(tl + bodyPitch) * level;
}

function updateDog(d, dt, t, camPos) {
  const c = d.cur, g = d.tgt, k = 1 - Math.exp(-d.poseRate * dt);
  for (const key of POSE_KEYS) c[key] += (g[key] - c[key]) * k;
  for (let i = 0; i < 4; i++) c.paws[i].lerp(g.paws[i], k);

  // 걷기 · 방향
  let moving = 0;
  if (d.walkTarget) {
    const dx = d.walkTarget.x - d.x, dz = d.walkTarget.z - d.z, dist = Math.hypot(dx, dz);
    if (dist < 0.025) d.walkTarget = null;
    else {
      const want = Math.atan2(dx, dz), diff = angDiff(d.yaw, want);
      d.yaw += diff * (1 - Math.exp(-5 * dt));
      const sp = d.walkSpeed * Math.max(0, 1 - Math.abs(diff) / 1.3) * Math.min(1, dist / 0.18 + 0.25);
      d.x += Math.sin(d.yaw) * sp * dt; d.z += Math.cos(d.yaw) * sp * dt;
      moving = Math.max(sp / d.walkSpeed, Math.min(1, Math.abs(diff) * 1.5));
      d.phase += Math.max(sp, 0.16) * dt * Math.PI / (2 * 0.055 * d.scale);
    }
  } else if (!d.external) {
    let want = null;
    if (d.face === 'cam' && camPos) want = Math.atan2(camPos.x - d.x, camPos.z - d.z) + c.yawOff;
    else if (d.face && d.face.x !== undefined) want = Math.atan2(d.face.x - d.x, d.face.z - d.z);
    if (want !== null) {
      const diff = angDiff(d.yaw, want);
      d.yaw += diff * (1 - Math.exp(-3.5 * dt));
      if (Math.abs(diff) > 0.3 && g.name === 'stand') { moving = Math.min(1, Math.abs(diff)); d.phase += dt * 9; }
    }
  }
  d.gait += (moving - d.gait) * (1 - Math.exp(-8 * dt));
  if (!d.external) { d.root.position.set(d.x, 0, d.z); d.root.rotation.y = d.yaw; }

  // 몸
  const br = Math.sin(t * (d.pant ? 7 : 2.3) + d.seed * 3) * (d.pant ? 0.006 : 0.0035);
  const bob = d.gait * Math.abs(Math.cos(d.phase)) * 0.01;
  d.body.position.set(0, c.bodyY + br + bob, c.bodyZ);
  d.body.rotation.set(c.pitch, 0, c.roll);
  d.torso.scale.set(1 + br * 3, 1, 1 + br * 3);
  d.root.updateMatrixWorld(true);

  // 머리 · 시선
  let yaw = 0, pitch = 0;
  const look = d.lookFn ? d.lookFn() : camPos;
  if (look && c.gaze > 0.01) {
    _v.copy(look); d.body.worldToLocal(_v); _v.sub(d.hp.position);
    yaw = clamp(Math.atan2(_v.x, _v.z), -1.05, 1.05);
    pitch = clamp(Math.atan2(_v.y, Math.hypot(_v.x, _v.z)), -1.0, 1.1);
  }
  d.tilt += (d.tiltT - d.tilt) * (1 - Math.exp(-6 * dt));
  const hx = c.headPitch * (1 - c.gaze) - pitch * c.gaze;
  const hy = yaw * c.gaze, hz = c.headTilt + d.tilt;
  const hk = 1 - Math.exp(-7 * dt);
  d.hx += (hx - d.hx) * hk; d.hy += (hy - d.hy) * hk; d.hz += (hz - d.hz) * hk;
  const sniffBob = d.sniff ? Math.sin(t * 15) * 0.035 * d.sniff : 0;
  const chewBob = d.chew ? Math.sin(t * 15) * 0.03 : 0;
  d.hp.rotation.set(d.hx + sniffBob + chewBob, d.hy, d.hz);

  // 다리 IK
  d.body.updateMatrix(); _m.copy(d.body.matrix).invert();
  for (let i = 0; i < 4; i++) {
    const L = d.legs[i]; _v.copy(c.paws[i]);
    if (d.gait > 0.001) {
      const ph = d.phase + (i === 0 || i === 3 ? 0 : Math.PI);
      _v.z += Math.sin(ph) * 0.055 * d.gait; _v.y += Math.max(0, Math.cos(ph)) * 0.04 * d.gait;
    }
    if (d.paddle > 0.001) { _v.y += Math.sin(t * 8 + i * 1.7) * 0.035 * d.paddle; _v.z += Math.cos(t * 8 + i * 1.7) * 0.03 * d.paddle; }
    _v.applyMatrix4(_m).sub(L.hip.position);
    solveLeg(d, L, _v.y, _v.z, c.level, c.pitch);
  }

  // 귀 (중력 따라 덜렁)
  const hwP = c.pitch + d.hp.rotation.x, hwR = c.roll + d.hp.rotation.z;
  for (const e of d.ears) {
    if (d.J) { e.g.rotation.x = -d.earPerk * 0.2; continue; }
    const tx = -hwP * 0.85 + d.gait * Math.sin(d.phase * 2) * 0.12 - d.earPerk * 0.3;
    const tz = e.side * (0.1 + d.earPerk * 0.25) - hwR * 0.6;
    e.vx += (tx - e.ax) * 120 * dt; e.vx *= Math.exp(-8 * dt); e.ax += e.vx * dt;
    e.vz += (tz - e.az) * 120 * dt; e.vz *= Math.exp(-8 * dt); e.az += e.vz * dt;
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
  for (const e of d.eyes) e.scale.y = Math.max(0.08, d.eyeY);

  // 입 · 혀
  let jt = d.jawOpen;
  if (d.chew) jt = 0.06 + 0.2 * (0.5 + 0.5 * Math.sin(t * 15));
  if (d.pant) jt = Math.max(jt, 0.16 + 0.04 * Math.sin(t * 14));
  d.jaw.rotation.x += (jt - d.jaw.rotation.x) * (1 - Math.exp(-28 * dt));
  const to = Math.max(d.tongueOut, d.lick, d.pant ? 0.7 : 0);
  d.tongue.position.set(d.lick ? Math.sin(t * 11) * 0.02 * d.lick : 0, 0.006 - 0.012 * to, 0.055 + 0.042 * to);
  d.tongue.scale.set(0.025, 0.008, 0.045 + 0.02 * to);
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
roomScene.background = new THREE.Color(0x120c09);
const roomCam = new THREE.PerspectiveCamera(50, 1, 0.03, 40);
const roomUpd = [];
const H = 2.7, X0 = -3.2, X1 = 3.2, Z0 = -2.8, Z1 = 3.8;

function buildRoom(S) {
  const R = rng(11);
  // 바닥 (큰 포세린 타일)
  const floorTex = canvasTex(1024, 1024, (x, w) => {
    const n = 4, s = w / n, r = rng(7);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const v = 178 + Math.floor(r() * 10);
      x.fillStyle = `rgb(${v + 8},${v + 2},${v - 6})`; x.fillRect(i * s, j * s, s, s);
      for (let k = 0; k < 500; k++) { x.fillStyle = r() < 0.5 ? 'rgba(255,250,240,.05)' : 'rgba(60,50,40,.05)'; x.fillRect(i * s + r() * s, j * s + r() * s, 2, 2); }
    }
    x.strokeStyle = 'rgba(132,120,108,.6)'; x.lineWidth = 3;
    for (let i = 0; i <= n; i++) { x.beginPath(); x.moveTo(i * s, 0); x.lineTo(i * s, w); x.stroke(); x.beginPath(); x.moveTo(0, i * s); x.lineTo(w, i * s); x.stroke(); }
  }, [6.4 / 2.4, 6.6 / 2.4]);
  add(S, new THREE.PlaneGeometry(6.4, 6.6), M(0xffffff, { map: floorTex, roughness: 0.5 }), [0, 0, 0.5], [-Math.PI / 2, 0, 0], null, false);

  // 벽 · 천장
  const wallM = M(0xefe6da, { roughness: 0.95 });
  const wall = (w, h, p, ry) => add(S, new THREE.PlaneGeometry(w, h), wallM, p, [0, ry, 0], null, false);
  wall(6.4, H, [0, H / 2, Z0], 0);
  wall(6.4, H, [0, H / 2, Z1], Math.PI);
  wall(6.6, H, [X1, H / 2, 0.5], -Math.PI / 2);
  // 왼쪽 벽: 큰 창 (z -1.7 ~ 0.3, y 0.2 ~ 2.25)
  wall(1.1, H, [X0, H / 2, -2.25], Math.PI / 2);
  wall(3.5, H, [X0, H / 2, 2.05], Math.PI / 2);
  wall(2.0, 0.2, [X0, 0.1, -0.7], Math.PI / 2);
  wall(2.0, 0.45, [X0, 2.475, -0.7], Math.PI / 2);
  add(S, new THREE.PlaneGeometry(6.4, 6.6), M(0xf3ede5, { roughness: 1 }), [0, H, 0.5], [Math.PI / 2, 0, 0], null, false);
  const baseM = M(0xe2d8ca, { roughness: 0.9 });
  add(S, box(6.4, 0.08, 0.015), baseM, [0, 0.04, Z0 + 0.008], null, null, false);
  add(S, box(0.015, 0.08, 6.6), baseM, [X1 - 0.008, 0.04, 0.5], null, null, false);

  // 창문 + 블라인드
  const frameM = M(0x3b3836, { roughness: 0.6 });
  for (const z of [-1.7, -0.7, 0.3]) add(S, box(0.06, 2.05, 0.05), frameM, [X0 + 0.02, 1.225, z], null, null, false);
  for (const y of [0.2, 2.25]) add(S, box(0.06, 0.05, 2.0), frameM, [X0 + 0.02, y, -0.7], null, null, false);
  add(S, box(0.22, 0.03, 2.1), M(0xe9e2d7), [X0 + 0.1, 0.2, -0.7], null, null, false);
  add(S, new THREE.PlaneGeometry(2, 2.05), new THREE.MeshStandardMaterial({ color: 0xa9bbd2, transparent: true, opacity: 0.07, roughness: 0.05, depthWrite: false }), [X0 + 0.01, 1.225, -0.7], [0, Math.PI / 2, 0], null, false);
  const slatM = M(0xddd7cd, { roughness: 0.7 });
  for (let i = 0; i < 15; i++) add(S, box(0.05, 0.011, 1.96), slatM, [X0 + 0.08, 2.21 - i * 0.017, -0.7], null, null, false);
  add(S, box(0.06, 0.024, 1.98), slatM, [X0 + 0.08, 1.95, -0.7], null, null, false);

  // 창밖: 눈 내리는 마당 (단풍나무 · 화로 · 빨간 의자)
  const gardenTex = canvasTex(1024, 640, (x) => {
    const r = rng(21);
    let g = x.createLinearGradient(0, 0, 0, 640); g.addColorStop(0, '#0e182c'); g.addColorStop(0.65, '#223250'); g.addColorStop(1, '#2c3a56');
    x.fillStyle = g; x.fillRect(0, 0, 1024, 640);
    x.fillStyle = '#2a2230'; x.fillRect(0, 110, 290, 420);
    x.fillStyle = '#232a3a'; x.fillRect(660, 70, 364, 460);
    x.fillStyle = '#2c2434'; x.fillRect(470, 210, 190, 320);
    const win = (wx, wy, w, h, c) => { x.fillStyle = c; x.fillRect(wx, wy, w, h); };
    const lit = '#f3c27a', dim = '#4d4350';
    win(50, 170, 46, 56, lit); win(130, 170, 46, 56, dim); win(210, 170, 46, 56, lit); win(50, 270, 46, 56, dim); win(130, 270, 46, 56, lit);
    win(700, 120, 64, 44, lit); win(800, 120, 64, 44, lit); win(900, 120, 64, 44, dim); win(700, 220, 64, 44, dim); win(800, 220, 64, 44, lit);
    win(500, 250, 36, 44, lit); win(580, 250, 36, 44, dim);
    g = x.createLinearGradient(0, 470, 0, 640); g.addColorStop(0, '#c7d2e5'); g.addColorStop(1, '#a3b3cb');
    x.fillStyle = g; x.fillRect(0, 460, 1024, 180);
    // 단풍나무
    x.strokeStyle = '#24160f'; x.lineCap = 'round';
    x.lineWidth = 20; x.beginPath(); x.moveTo(330, 520); x.bezierCurveTo(318, 430, 352, 360, 338, 250); x.stroke();
    x.lineWidth = 9; x.beginPath(); x.moveTo(340, 360); x.lineTo(268, 270); x.moveTo(344, 320); x.lineTo(418, 238); x.stroke();
    const leaf = ['#6c1d1b', '#8b2a22', '#561819', '#a23b2b', '#7a2420'];
    for (let i = 0; i < 170; i++) {
      const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * 150;
      x.fillStyle = leaf[i % 5]; x.beginPath(); x.arc(345 + Math.cos(a) * rr * 1.35, 240 + Math.sin(a) * rr * 0.72, 10 + r() * 15, 0, 7); x.fill();
    }
    x.fillStyle = 'rgba(235,242,252,.85)';
    for (let i = 0; i < 70; i++) { const a = r() * Math.PI, rr = r() * 150; x.beginPath(); x.ellipse(345 + Math.cos(a + Math.PI) * rr * 1.3, 205 - Math.sin(a) * rr * 0.55, 9, 3.5, 0, 0, 7); x.fill(); }
    // 디딤돌
    x.fillStyle = '#8e9ab0';
    for (let i = 0; i < 6; i++) { x.beginPath(); x.ellipse(120 + i * 150, 590 - (i % 2) * 20, 46, 13, 0, 0, 7); x.fill(); }
    // 빨간 의자 · 테이블
    x.strokeStyle = '#a22d2a'; x.lineWidth = 5;
    x.beginPath(); x.moveTo(140, 530); x.lineTo(150, 470); x.lineTo(200, 470); x.lineTo(210, 530); x.moveTo(150, 470); x.lineTo(156, 430); x.lineTo(196, 430); x.stroke();
    x.beginPath(); x.moveTo(230, 535); x.lineTo(250, 455); x.moveTo(320, 535); x.lineTo(300, 455); x.moveTo(236, 455); x.lineTo(316, 455); x.stroke();
    x.fillStyle = '#7d5638'; x.fillRect(232, 448, 88, 8);
    // 화로
    x.fillStyle = '#16120f';
    x.beginPath(); x.moveTo(612, 420); x.lineTo(668, 420); x.lineTo(690, 470); x.lineTo(684, 540); x.lineTo(596, 540); x.lineTo(590, 470); x.closePath(); x.fill();
    x.fillRect(624, 392, 32, 30); x.beginPath(); x.ellipse(640, 392, 26, 9, 0, 0, 7); x.fill();
    g = x.createRadialGradient(640, 492, 4, 640, 492, 90); g.addColorStop(0, 'rgba(255,170,80,.95)'); g.addColorStop(0.3, 'rgba(255,120,40,.45)'); g.addColorStop(1, 'rgba(255,120,40,0)');
    x.fillStyle = g; x.fillRect(540, 400, 200, 180);
    x.fillStyle = '#ffb45a'; x.beginPath(); x.ellipse(640, 495, 24, 18, 0, 0, 7); x.fill();
    x.fillStyle = 'rgba(255,240,200,.9)'; x.beginPath(); x.ellipse(640, 500, 10, 8, 0, 0, 7); x.fill();
    // 난간
    x.strokeStyle = '#0c0c10'; x.lineWidth = 4;
    x.beginPath(); x.moveTo(0, 455); x.lineTo(1024, 455); x.moveTo(0, 470); x.lineTo(1024, 470); x.stroke();
    x.lineWidth = 3;
    for (let px = 8; px < 1024; px += 26) { x.beginPath(); x.moveTo(px, 455); x.lineTo(px, 520); x.stroke(); }
  });
  add(S, new THREE.PlaneGeometry(9, 5.6), new THREE.MeshBasicMaterial({ map: gardenTex }), [-6.6, 1.7, -0.7], [0, Math.PI / 2, 0], null, false);
  add(S, new THREE.PlaneGeometry(3.4, 9), M(0xb9c5d9, { roughness: 1 }), [-4.9, -0.03, -0.7], [-Math.PI / 2, 0, 0], null, false);
  const moon = new THREE.DirectionalLight(0x9fb3e0, 0.5); moon.position.set(-7, 4, -1); moon.target.position.set(0, 0, -0.7); S.add(moon, moon.target);
  // 눈송이
  {
    const N = 260, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { pos[i * 3] = -6.3 + R() * 2.9; pos[i * 3 + 1] = R() * 3.4; pos[i * 3 + 2] = -2.6 + R() * 3.8; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const snow = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.045, map: glowTex, transparent: true, opacity: 0.9, depthWrite: false }));
    S.add(snow);
    roomUpd.push((t, dt) => {
      const a = g.attributes.position;
      for (let i = 0; i < N; i++) {
        let y = a.getY(i) - dt * (0.22 + (i % 7) * 0.03);
        if (y < 0) y = 3.4;
        a.setY(i, y); a.setZ(i, a.getZ(i) + Math.sin(t * 0.8 + i) * 0.0012);
      }
      a.needsUpdate = true;
    });
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
  const lamp = new THREE.PointLight(0xffb769, 3.5, 7, 2); lamp.position.copy(shade.position); S.add(lamp);
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
    treeLight.intensity = 4.6 + Math.sin(t * 2.2) * 0.5 + Math.sin(t * 5.3) * 0.2;
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
  const pend = new THREE.PointLight(0xffc98a, 4, 7, 2); pend.position.set(-1.55, 1.85, -0.5); S.add(pend);
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
  S.add(new THREE.HemisphereLight(0xfff0dc, 0x6b4c3a, 0.75));
  const spot = new THREE.SpotLight(0xffd8ae, 24, 9, 0.95, 0.85, 2);
  spot.position.set(0.3, H - 0.05, 1.5); spot.target.position.set(0.1, 0, 0.75);
  spot.castShadow = true; spot.shadow.mapSize.set(1024, 1024); spot.shadow.bias = -0.0004; spot.shadow.normalBias = 0.02;
  spot.shadow.camera.near = 0.3; spot.shadow.camera.far = 7;
  S.add(spot, spot.target);
}
buildRoom(roomScene);

// 핑키
const HOME = { x: 0.1, z: 0.85 };
const pinky = buildDog({ kind: 'beagle', colors: COLORS.pinky, scale: 1, seed: 7 });
roomScene.add(pinky.root);

// 사람 손 + 간식
function buildHand() {
  const g = new THREE.Group();
  const skin = M(0xeab89b, { roughness: 0.6 });
  add(g, SPH, skin, [0, 0, 0], null, [0.048, 0.017, 0.058]);
  for (let i = 0; i < 4; i++) add(g, new THREE.CapsuleGeometry(0.0095, 0.04, 4, 8), skin, [-0.03 + i * 0.02, 0.006, 0.075 - Math.abs(i - 1.5) * 0.006], [Math.PI / 2 - 0.25, 0, 0]);
  add(g, new THREE.CapsuleGeometry(0.011, 0.035, 4, 8), skin, [0.056, 0.01, 0.015], [Math.PI / 2, 0, -0.9]);
  add(g, new THREE.CapsuleGeometry(0.032, 0.12, 6, 12), skin, [0, 0, -0.1], [Math.PI / 2, 0, 0]);
  add(g, cyl(0.05, 0.054, 0.34, 18), M(0x9e3b36, { roughness: 1 }), [0, 0, -0.32], [Math.PI / 2, 0, 0]);
  add(g, new THREE.TorusGeometry(0.05, 0.012, 8, 20), M(0xefe6d6, { roughness: 1 }), [0, 0, -0.155]);
  return g;
}
function buildTreat() {
  const g = new THREE.Group(); const m = M(0xc98a4b, { roughness: 0.8 });
  add(g, new THREE.CapsuleGeometry(0.011, 0.045, 4, 8), m, [0, 0, 0], [0, 0, Math.PI / 2]);
  for (const sx of [1, -1]) for (const sz of [1, -1]) add(g, SPH, m, [sx * 0.032, 0, sz * 0.009], null, 0.013);
  return g;
}
const hand = buildHand(); hand.visible = false; roomScene.add(hand);
const treat = buildTreat(); treat.visible = false; roomScene.add(treat);

// 부스러기
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
    if (c.age > 2.2) { c.m.scale.setScalar(Math.max(0.01, 1 - (c.age - 2.2) * 2)); }
    if (c.age > 2.7) { roomScene.remove(c.m); crumbs.splice(i, 1); }
  }
}

// ================================================================
// 말풍선 (킁킁 · 냠냠)
// ================================================================
const bubbles = [], bubbleLayer = $('#bubbles'), _p = V3();
function say(text, anchor, cls = '', life = 1.7, dx = null) {
  const el = document.createElement('div'); el.className = 'bubble ' + cls; el.textContent = text;
  bubbleLayer.appendChild(el);
  bubbles.push({ el, anchor, age: 0, life, dx: dx ?? (Math.random() - 0.5) * 40 });
}
const headTop = () => pinky.head.localToWorld(V3(0, 0.2, 0.06));
const noseTip = () => pinky.head.localToWorld(V3(0, 0.05, 0.24));
const mouthPt = () => pinky.head.localToWorld(V3(0, -0.02, 0.2));
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
let active = null;
const actionsEl = $('#actions');
function setActiveBtn(name) { [...actionsEl.querySelectorAll('button')].forEach((b) => b.classList.toggle('on', b.dataset.cmd === name)); }
function cancelActive() { if (active) { active.cancelled = true; active.cleanups.forEach((f) => f()); active = null; setActiveBtn(null); } }
function startCommand(name, fn) {
  cancelActive();
  const tok = { cancelled: false, cleanups: [], name };
  active = tok; setActiveBtn(name); idleT = 6;
  resetTransient(pinky);
  fn(tok).then(() => { if (active === tok) { active = null; setActiveBtn(null); } })
    .catch((e) => { if (e !== CANCEL) console.error(e); });
}
function resetTransient(d) {
  Object.assign(d, { walkTarget: null, chew: false, lick: 0, tongueOut: 0, pant: false, sniff: 0, paddle: 0, lookFn: null, face: 'cam', eyeOpen: 1, tiltT: 0, jawOpen: 0, earPerk: 0, wagAmpT: 0.3, wagSpeedT: 6 });
}
async function walkTo(tok, x, z) {
  pinky.walkTarget = { x, z };
  tok.cleanups.push(() => { pinky.walkTarget = null; });
  await until(tok, () => pinky.walkTarget === null);
}
function faceAndWait(tok, pt, sec) { pinky.face = pt; return wait(tok, sec); }

const CMDS = {
  async sit(tok) {
    setPose(pinky, 'sit', 6);
    pinky.wagAmpT = 0.4; pinky.wagSpeedT = 8; pinky.earPerk = 0.4;
    await wait(tok, 1.2); pinky.earPerk = 0;
  },
  async down(tok) {
    setPose(pinky, 'down', 4);
    pinky.wagAmpT = 0.25; pinky.wagSpeedT = 5;
    await wait(tok, 1.4);
    pinky.tiltT = 0.18; await wait(tok, 1.2); pinky.tiltT = 0;
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
  },
  async treat(tok) {
    setPose(pinky, 'sit', 9);
    pinky.wagAmpT = 0.75; pinky.wagSpeedT = 17; pinky.earPerk = 1;
    say('!', headTop, '', 1.1);
    const startW = () => roomCam.localToWorld(V3(0.26, -0.48, -0.3));
    const near = () => { const m = mouthPt(), c = roomCam.position; const dir = V3(c.x - m.x, 0, c.z - m.z).normalize(); return m.add(dir.multiplyScalar(0.2)).add(V3(0, -0.01, 0)); };
    const s0 = startW();
    hand.visible = true; hand.position.copy(s0); hand.add(treat); treat.position.set(0, 0.025, 0.02); treat.rotation.set(0, 0.4, 0); treat.scale.setScalar(1); treat.visible = true;
    const retreat = { cancelled: false };
    tok.cleanups.push(() => { retreat.cancelled = true; hand.visible = false; treat.visible = false; roomScene.add(treat); });
    pinky.lookFn = () => treat.getWorldPosition(V3());
    await tween(tok, 0.9, (k) => { hand.position.lerpVectors(s0, near(), ease(k)); hand.lookAt(mouthPt()); });
    await wait(tok, 0.7);
    pinky.jawOpen = 0.3;
    const n0 = hand.position.clone();
    await tween(tok, 0.4, (k) => { hand.position.lerpVectors(n0, mouthPt().add(V3(0, -0.035, 0)), ease(k)); hand.lookAt(mouthPt()); });
    pinky.jaw.attach(treat); treat.position.set(0, 0.0, 0.085); pinky.jawOpen = 0;
    const h0 = hand.position.clone();
    tween(retreat, 0.7, (k) => { hand.position.lerpVectors(h0, startW(), ease(k)); if (k >= 1) hand.visible = false; }).catch(() => {});
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
    await wait(tok, 2.2); pinky.tiltT = 0; pinky.earPerk = 0;
  },
  async sniff(tok) {
    setPose(pinky, 'stand', 6);
    const nose = () => { pinky.tgt.gaze = 0; pinky.tgt.headPitch = 0.55; };
    const up = () => { pinky.tgt.gaze = 1; pinky.tgt.headPitch = 0; };
    tok.cleanups.push(up);
    const stop = async (x, z, fx, fz, line, extra) => {
      nose(); pinky.sniff = 0.5;
      await walkTo(tok, x, z);
      pinky.tgt.headPitch = 0.8; pinky.sniff = 1;
      say('킁킁', noseTip); await faceAndWait(tok, { x: fx, z: fz }, 0.9);
      say('킁킁', noseTip); await wait(tok, 0.9);
      if (line) { up(); pinky.sniff = 0; pinky.tiltT = 0.25; say(line, headTop, 'soft', 1.9); await wait(tok, 1.5); pinky.tiltT = 0; }
      if (extra) await extra();
    };
    pinky.wagAmpT = 0.45; pinky.wagSpeedT = 10;
    await stop(1.25, -0.55, 1.75, -1.15, '선물 냄새…');
    await stop(1.82, 0.85, 2.15, 1.0, '밥그릇 비었네…');
    await stop(-0.72, 0.15, -1.3, -0.3, '여기 뭐 떨어진 거 없나');
    up(); pinky.sniff = 0;
    await walkTo(tok, HOME.x, HOME.z);
    pinky.face = 'cam'; pinky.wagAmpT = 0.4; pinky.wagSpeedT = 8;
    await wait(tok, 0.8);
  },
};
actionsEl.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-cmd]'); if (!b) return;
  const name = b.dataset.cmd; startCommand(name, CMDS[name]);
});

// 가만히 있을 때: 고개 갸웃
let idleT = 4;
function idleLife(dt) {
  if (active) return;
  idleT -= dt;
  if (idleT <= 0) {
    idleT = 4 + Math.random() * 4;
    pinky.tiltT = (Math.random() < 0.5 ? -1 : 1) * (0.2 + Math.random() * 0.15);
    pinky.earPerk = 0.3;
    setTimeout(() => { if (!active) { pinky.tiltT = 0; pinky.earPerk = 0; } }, 1300);
  }
}

// ================================================================
// 시점 (사람 눈 · 손만 나옴)
// ================================================================
const CAM_POS = V3(0, 1.22, 3.0), CAM_AIM = V3(0.08, 0.4, 0.62);
const baseYaw = Math.atan2(-(CAM_AIM.x - CAM_POS.x), -(CAM_AIM.z - CAM_POS.z));
const basePitch = Math.atan2(CAM_AIM.y - CAM_POS.y, Math.hypot(CAM_AIM.x - CAM_POS.x, CAM_AIM.z - CAM_POS.z));
const look = { y: 0, p: 0, ty: 0, tp: 0 };
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function resetRoom() {
  cancelActive(); clearBubbles();
  Object.assign(pinky, { x: HOME.x, z: HOME.z, yaw: 0 });
  resetTransient(pinky);
  setPose(pinky, 'stand', 50);
  const st = poseFor('stand', pinky);
  for (const k of POSE_KEYS) pinky.cur[k] = st[k];
  st.paws.forEach((v, i) => pinky.cur.paws[i].copy(v));
  look.y = look.ty = look.p = look.tp = 0;
  pinky.wagAmpT = 0.7; pinky.wagSpeedT = 15; pinky.earPerk = 0.6;
  setTimeout(() => { if (!active) { pinky.wagAmpT = 0.3; pinky.wagSpeedT = 6; pinky.earPerk = 0; } }, 2600);
}
function updateRoom(dt, t) {
  const k = 1 - Math.exp(-8 * dt);
  look.y += (look.ty - look.y) * k; look.p += (look.tp - look.p) * k;
  roomCam.position.copy(CAM_POS);
  if (!reduceMotion) roomCam.position.y += Math.sin(t * 0.7) * 0.005;
  roomCam.rotation.set(basePitch + look.p, baseYaw + look.y, 0, 'YXZ');
  roomCam.updateMatrixWorld(true);
  roomUpd.forEach((f) => f(t, dt));
  idleLife(dt);
  updateDog(pinky, dt, t, roomCam.position);
  stepCrumbs(dt);
}

// ================================================================
// 화면 전환 · 입력
// ================================================================
let mode = 'select';
const fadeEl = $('#fade');
function fade(mid) {
  fadeEl.classList.add('on');
  setTimeout(() => { mid(); requestAnimationFrame(() => requestAnimationFrame(() => fadeEl.classList.remove('on'))); }, reduceMotion ? 0 : 560);
}
function goRoom() {
  fade(() => { mode = 'room'; $('#selectUI').hidden = true; $('#roomUI').hidden = false; resetRoom(); $('#backBtn').focus({ preventScroll: true }); });
}
function goSelect() {
  cancelActive(); clearBubbles();
  fade(() => { mode = 'select'; $('#roomUI').hidden = true; $('#selectUI').hidden = false; });
}
$('#backBtn').addEventListener('click', goSelect);

let toastTimer = 0;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200); }

const canvas = $('#c');
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let drag = null;
canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, moved: 0 }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', (e) => {
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
  if (i === sel) { if (DOGS[i].ready) goRoom(); else toast(`${DOGS[i].name}의 ${DOGS[i].place === '장소 정하는 중' ? '추억 장소' : DOGS[i].place}는 준비 중이에요`); }
  else select(i);
});
canvas.addEventListener('pointercancel', () => { drag = null; });
window.addEventListener('keydown', (e) => {
  if (mode !== 'select') { if (e.key === 'Escape') goSelect(); return; }
  if (e.key === 'ArrowLeft') select(sel - 1, -1);
  else if (e.key === 'ArrowRight') select(sel + 1, 1);
  else if (e.key === 'Enter' && document.activeElement === document.body && DOGS[sel].ready) goRoom();
});

function resize() {
  const w = innerWidth, h = innerHeight, a = w / h;
  renderer.setSize(w, h, false);
  selCam.aspect = a; selCam.fov = a < 0.8 ? 48 : 38; selCam.updateProjectionMatrix();
  selCam.position.set(0, 1.25, a < 0.8 ? 6.0 : 5.2); selCam.lookAt(0, a < 0.8 ? 0.42 : 0.36, RING_R - 0.1);
  roomCam.aspect = a; roomCam.fov = a < 0.8 ? 64 : 50; roomCam.updateProjectionMatrix();
}
window.addEventListener('resize', resize); resize();

// ================================================================
// 루프
// ================================================================
let last = performance.now(), booted = false;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now; clock += dt;
  stepTimers();
  if (mode === 'select') { updateSelect(dt, clock); renderer.render(selScene, selCam); stepBubbles(dt, selCam); }
  else { updateRoom(dt, clock); renderer.render(roomScene, roomCam); stepBubbles(dt, roomCam); }
  if (!booted) { booted = true; $('#boot').classList.add('gone'); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
