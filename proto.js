import * as THREE from 'three';
import { GLTFLoader } from './vendor/jsm/loaders/GLTFLoader.js';

const $ = (s) => document.querySelector(s);
const renderer = new THREE.WebGLRenderer({ canvas: $('#c'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene(); scene.background = new THREE.Color(0xe9dfd2);
const cam = new THREE.PerspectiveCamera(35, 1, 0.01, 50);
scene.add(new THREE.HemisphereLight(0xfff4e6, 0x6d5a4a, 1.6));
const sun = new THREE.DirectionalLight(0xffe2c2, 2.6); sun.position.set(2, 4, 3); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -1, right: 1, top: 1, bottom: -1 }); scene.add(sun);
const fill = new THREE.DirectionalLight(0xdfe8ff, 0.8); fill.position.set(-3, 2, -2); scene.add(fill);
const ground = new THREE.Mesh(new THREE.CircleGeometry(3, 48), new THREE.MeshStandardMaterial({ color: 0xd8cbb9, roughness: 1 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

const params = new URLSearchParams(location.search);
const FILE = params.get('m') || 'shiba';
let mixer, actions = {}, current, dog, bones = {}, info = [];
const view = { yaw: 0.6, pitch: 0.18, dist: 1.35, ty: 0.25 };

new GLTFLoader().load(`models/${FILE}.glb`, (g) => {
  dog = g.scene; scene.add(dog);
  dog.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } if (o.isBone) { bones[o.name] = o; bones[o.name.replace(/[._]/g, '')] = o; } });
  const box = new THREE.Box3().setFromObject(dog), size = box.getSize(new THREE.Vector3());
  info.push(`size ${size.x.toFixed(2)} ${size.y.toFixed(2)} ${size.z.toFixed(2)}`);
  dog.scale.setScalar(0.17);
  dog.updateMatrixWorld(true);
  const wp = (n) => (bones[n.replace(/[._]/g, '')] ? bones[n.replace(/[._]/g, '')].getWorldPosition(new THREE.Vector3()) : null);
  for (const n of ['Head', 'Ear1.L', 'Ear4.L', 'Body', 'Tail1', 'Neck1', 'FrontLowerLeg.L']) { const p = wp(n); if (p) info.push(`${n} ${p.x.toFixed(3)} ${p.y.toFixed(3)} ${p.z.toFixed(3)}`); }
  if (!params.has('orig')) pinkify(dog);
  mixer = new THREE.AnimationMixer(dog);
  for (const clip of g.animations) if (!clip.name.includes('|')) actions[clip.name] = mixer.clipAction(clip);
  const ui = $('#ui');
  for (const name of Object.keys(actions)) {
    const b = document.createElement('button'); b.textContent = name; b.onclick = () => play(name); ui.appendChild(b);
  }
  for (const [label, v] of [['정면', [0, 0.12, 1.1, 0.28]], ['3/4', [0.7, 0.2, 1.3, 0.25]], ['옆', [1.57, 0.1, 1.4, 0.22]], ['뒤3/4', [2.5, 0.2, 1.3, 0.25]], ['얼굴', [0.25, 0.05, 0.6, 0.34]]]) {
    const b = document.createElement('button'); b.textContent = label; b.onclick = () => Object.assign(view, { yaw: v[0], pitch: v[1], dist: v[2], ty: v[3] }); ui.appendChild(b);
  }
  play(params.get('a') || 'Idle');
  $('#info').textContent = info.join('\n');
  window.__p = { dog, bones, actions, play, view, THREE, scene };
});
function play(name) {
  if (!actions[name]) return;
  if (current) current.fadeOut(0.25);
  current = actions[name].reset().fadeIn(0.25).play();
  document.querySelectorAll('#ui button').forEach((b) => b.classList.toggle('on', b.textContent === name));
}

function resize() { renderer.setSize(innerWidth, innerHeight, false); cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (mixer) mixer.update(dt);
  if (window.__p && window.__p.after) window.__p.after(dt);
  cam.position.set(Math.sin(view.yaw) * Math.cos(view.pitch) * view.dist, view.ty + Math.sin(view.pitch) * view.dist, Math.cos(view.yaw) * Math.cos(view.pitch) * view.dist);
  cam.lookAt(0, view.ty, 0);
  renderer.render(scene, cam);
});

// ---------------------------------------------------------------
// 시바 → 핑키: 귀 바꾸기, 털색 칠하기, 눈, 목줄·메달
// ---------------------------------------------------------------
const C = { fawn: 0xd3b68c, fawnDark: 0xb89466, saddle: 0x403a36, saddle2: 0x5a524c, cream: 0xf1e9dc, ear: 0xc9a77a };
function pinkify(root) {
  const skinned = [];
  root.traverse((o) => { if (o.isSkinnedMesh) skinned.push(o); });
  root.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const v = new THREE.Vector3(), col = new THREE.Color();
  const cF = new THREE.Color(C.fawn), cFD = new THREE.Color(C.fawnDark), cS = new THREE.Color(C.saddle), cS2 = new THREE.Color(C.saddle2), cW = new THREE.Color(C.cream);
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const hash = (x, y, z) => { const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return h - Math.floor(h); };
  const sc = root.scale.x;
  const reshape = (mesh) => {
    const toRoot = rootInv.clone().multiply(mesh.matrixWorld), fromRoot = toRoot.clone().invert();
    const pos = mesh.geometry.attributes.position, name = mesh.material.name;
    const isEye = name.startsWith('Eyes');
    const ctr = { 1: new THREE.Vector3(), '-1': new THREE.Vector3() }, cnt = { 1: 0, '-1': 0 };
    if (isEye) for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(toRoot); const k = v.x >= 0 ? 1 : -1; ctr[k].add(v); cnt[k]++; }
    if (isEye) for (const k of [1, -1]) if (cnt[k]) ctr[k].divideScalar(cnt[k]);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(toRoot);
      if (isEye) { const k = v.x >= 0 ? 1 : -1; v.sub(ctr[k]).multiplyScalar(1.45).add(ctr[k]); }
      else {
        const front = ss(1.95, 2.25, v.z) * ss(2.0, 2.2, v.y);      // 주둥이
        v.x *= 1 + front * 0.28; v.y -= front * 0.03;
        const crown = ss(2.7, 2.95, v.y) * ss(1.3, 1.6, v.z);        // 정수리
        v.y += crown * 0.06; v.x *= 1 + crown * 0.08;
      }
      v.applyMatrix4(fromRoot); pos.setXYZ(i, v.x, v.y, v.z);
    }
    pos.needsUpdate = true; mesh.geometry.computeVertexNormals(); mesh.geometry.computeBoundingSphere();
  };
  for (const mesh of skinned) reshape(mesh);
  for (const mesh of skinned) {
    const name = mesh.material.name;
    if (name === 'Main' || name === 'Main_Light') {
      const toRoot = rootInv.clone().multiply(mesh.matrixWorld);
      const pos = mesh.geometry.attributes.position, colors = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(toRoot); // 강아지 기준(스케일 1): y 위, z 앞, 머리 높이 ≈ 2.65
        if (name === 'Main') {
          const n = hash(Math.round(v.x * 20), Math.round(v.y * 20), Math.round(v.z * 20)) - 0.5;
          const saddle = ss(1.3, 1.55, v.y + n * 0.1) * ss(1.2, 0.85, v.z) * ss(-1.25, -0.9, v.z);
          col.copy(cF).lerp(cFD, ss(1.1, 0.5, v.y) * 0.35).lerp(cS.clone().lerp(cS2, hash(v.x * 9, v.y * 7, v.z * 5) * 0.6), saddle);
          if (v.z < -1.15) col.lerp(cW, ss(2.0, 2.45, v.y));
        } else {
          // 시바의 흰 볼 무늬 → 비글: 머리는 황갈, 주둥이·이마 줄·턱 아래만 흰색
          const onHead = ss(2.15, 2.3, v.y) * ss(1.45, 1.6, v.z);
          const muzzle = ss(2.08, 2.2, v.z + (2.6 - v.y) * 0.15) ;
          const blaze = ss(0.07, 0.04, Math.abs(v.x)) * ss(2.55, 2.7, v.y);
          const chin = ss(2.42, 2.3, v.y) * ss(1.9, 2.05, v.z);
          const white = Math.max(muzzle, blaze, chin);
          col.copy(cW).lerp(cF, onHead * (1 - white));
        }
        colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
      }
      mesh.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      mesh.material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92, name });
    } else if (name === 'Eyes_White') mesh.material = new THREE.MeshStandardMaterial({ color: 0x24160d, roughness: 0.15 });
    else if (name === 'Eyes_Pupil' || name === 'Eyes_Black') mesh.material = new THREE.MeshStandardMaterial({ color: 0x050302, roughness: 0.1 });
    else if (name === 'Black') mesh.material = new THREE.MeshStandardMaterial({ color: 0x141010, roughness: 0.35 });
  }

  // 시바 귀 숨기기 (뼈를 접어 머리 안으로)
  for (const n of ['Ear1L', 'Ear1R']) bones[n].userData.hide = true;

  // 비글 귀: 머리 뼈에 붙이고, 매 프레임 중력 방향으로 늘어뜨림 (크기는 미터 → 뼈 좌표로 환산)
  const head = bones['Head'];
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const hs = head.getWorldScale(V3()).x;
  const qH0 = head.getWorldQuaternion(new THREE.Quaternion()), qH0i = qH0.clone().invert();
  const toHeadLocal = (w) => w.clone().applyQuaternion(qH0i).divideScalar(hs);
  const EAR = { len: 0.14, wid: 0.068, thick: 0.016 };
  const earGeo = new THREE.SphereGeometry(1, 7, 9); earGeo.translate(0, -1, 0); earGeo.scale(EAR.thick / 2, EAR.len / 2, EAR.wid / 2);
  const earMat = new THREE.MeshStandardMaterial({ color: C.ear, flatShading: true, roughness: 0.9 });
  const ears = [];
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? 1 : -1;
    const e1 = bones['Ear1' + side];
    const pivot = new THREE.Object3D(); head.add(pivot);
    pivot.position.copy(e1.position).add(toHeadLocal(V3(sx * 0.02, -0.03, -0.035)));
    const m = new THREE.Mesh(earGeo, earMat); m.castShadow = true; m.scale.setScalar(1 / hs); pivot.add(m);
    ears.push({ pivot, side: sx, ax: 0, vx: 0, az: 0, vz: 0, prev: new THREE.Vector3() });
  }

  // 목줄 + 메달: 목 뼈에 붙임 (고리 축 = 뼈 Y축 = 목 방향)
  const neck = bones['Neck2'] || bones['Neck1'];
  const ns = neck.getWorldScale(V3()).x;
  const ribbonTex = (() => { const c = document.createElement('canvas'); c.width = 16; c.height = 64; const x = c.getContext('2d'); ['#9e2b2b', '#9e2b2b', '#efe8dc', '#2c3a5c', '#2c3a5c', '#efe8dc', '#9e2b2b', '#9e2b2b'].forEach((b, i) => { x.fillStyle = b; x.fillRect(0, i * 8, 16, 9); }); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const collar = new THREE.Group(); collar.scale.setScalar(1 / ns); neck.add(collar);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.008, 8, 28), new THREE.MeshStandardMaterial({ map: ribbonTex, roughness: 0.7 }));
  ring.rotation.x = Math.PI / 2; ring.scale.set(1, 1, 1.7); collar.add(ring);
  // 메달: 목 기준 '아래' 방향 (월드 아래를 목 축에 수직으로)
  const qN = neck.getWorldQuaternion(new THREE.Quaternion()).invert();
  const down = V3(0, -1, 0.35).normalize().applyQuaternion(qN); down.y = 0; down.normalize();
  const bronze = new THREE.MeshStandardMaterial({ color: 0x5a4a3a, metalness: 0.75, roughness: 0.38 });
  const medal = new THREE.Group(); medal.position.copy(down.clone().multiplyScalar(0.064)); collar.add(medal);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.004, 20), bronze);
  disc.position.copy(down.clone().multiplyScalar(0.022)); disc.lookAt(down.clone().multiplyScalar(0.022).add(V3(0, 1, 0))); disc.rotateX(Math.PI / 2);
  medal.add(disc);
  window.__pk = { ears, collar, ring, medal, head, neck, earGeo, hs, ns };

  // 매 프레임: 시바 귀 접기, 비글 귀 흔들기
  const qHead = new THREE.Quaternion(), qWant = new THREE.Quaternion(), e = new THREE.Euler(), wp = new THREE.Vector3();
  const after = (dt) => {
    for (const n of ['Ear1L', 'Ear1R']) bones[n].scale.setScalar(0.001);
    for (const n of ['Tail2', 'Tail3']) if (bones[n]) bones[n].rotation.x *= 0.25;
    if (params.has('spin')) view.yaw += dt * 0.35;
    head.getWorldQuaternion(qHead);
    for (const ear of ears) {
      ear.pivot.getWorldPosition(wp);
      const vel = wp.clone().sub(ear.prev).divideScalar(Math.max(dt, 1e-3)); ear.prev.copy(wp);
      const tx = -vel.z * 0.25, tz = ear.side * 0.12 + vel.x * 0.25;
      ear.vx += (tx - ear.ax) * 90 * dt; ear.vx *= Math.exp(-7 * dt); ear.ax += ear.vx * dt;
      ear.vz += (tz - ear.az) * 90 * dt; ear.vz *= Math.exp(-7 * dt); ear.az += ear.vz * dt;
      // 원하는 월드 방향: 아래로 늘어지고, 바깥으로 살짝
      const dogYaw = new THREE.Euler().setFromQuaternion(dog.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y;
      e.set(ear.ax, dogYaw, ear.az, 'YXZ'); qWant.setFromEuler(e);
      ear.pivot.quaternion.copy(qHead.clone().invert().multiply(qWant));
    }
  };
  window.__p = Object.assign(window.__p || {}, { after });
  setTimeout(() => { window.__p.after = after; }, 0);
}
