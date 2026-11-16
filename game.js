// ============================================================
//  SITE-7 v4 — single-player first-person tactical shooter
//  three.js (CDN) · static files only · no build step
//  Player vs 8 AI bots · rounds · A/B sites · hitscan weapons
//  v4: portrait-safe touch layout, jump queue, bots 1.35x with
//      orange-red bodies + cyan stripes, FPS counter opt-in (?fps=1)
// ============================================================
import * as THREE from './three.module.js';

// ---------- Config ----------
const CFG = {
  roundTime: 100,          // seconds per round
  botCount: 8,
  gravity: 22,
  jumpSpeed: 8,
  walkSpeed: 5.2,
  sprintSpeed: 8.4,
  eyeHeight: 1.62,
  playerRadius: 0.38,
  playerHeight: 1.72,
  spotDist: 32,            // bots only spot the player within this range + LOS
  noShootMs: 4000,         // no bot shooting for the first 4 s of a round
};

const WEAPONS = {
  rifle: {
    name: 'VK-47 Rifle', auto: true, rpm: 620, damage: 34, headMult: 2.2,
    mag: 30, reserve: 120, reloadTime: 2.1, spread: 0.011, kick: 0.011,
    range: 120, tracer: 0xffc46b, sound: 'rifle',
  },
  pistol: {
    name: 'P-9 Pistol', auto: false, rpm: 320, damage: 26, headMult: 2.5,
    mag: 12, reserve: 48, reloadTime: 1.3, spread: 0.008, kick: 0.007,
    range: 90, tracer: 0x9fd8ff, sound: 'pistol',
  },
};

// ---------- State ----------
const S = {
  mode: 'menu',            // menu | playing | paused | roundEnd
  yaw: 0, pitch: 0,
  pos: new THREE.Vector3(0, 0, 16),
  vel: new THREE.Vector3(),
  onGround: true,
  hp: 100,
  armor: 50,
  weapon: 'rifle',
  ammo: { rifle: 30, pistol: 12 },
  reserve: { rifle: 120, pistol: 48 },
  reloading: false,
  reloadEnd: 0,
  lastShot: 0,
  firing: false,
  triggerEdge: false,      // pistol fires once per press (semi-auto)
  jumpQueued: false,       // touch JUMP queues a jump (see updatePlayer)
  jumpQueuedAt: 0,
  shots: 0, hits: 0,        // accuracy stats
  kills: 0, deaths: 0, roundsWon: 0, roundsLost: 0, round: 1,
  timeLeft: CFG.roundTime,
  roundStartAt: 0,
  spreadNow: 0,
  recoil: 0,
  keys: {},
  bots: [],
  tracers: [],
  decals: [],
  lastStep: 0,
  hitmarkAt: 0,
  lockDenied: false,
  dragging: false,
  touchMove: { x: 0, y: 0 },
  touchLook: { id: -1, lx: 0, ly: 0 },
  isTouch: ('ontouchstart' in window) || navigator.maxTouchPoints > 0,
};

const BOT_SCALE = 1.35;   // bots are bigger and easier to read at range

// ---------- Renderer / scene ----------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !S.isTouch, powerPreference: 'default' });
renderer.setPixelRatio(Math.min(devicePixelRatio, S.isTouch ? 1 : 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = !S.isTouch;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xbfd9f2);          // light sky
scene.fog = new THREE.Fog(0xdfeaf5, 60, 150);          // light haze

const camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.08, 220);
camera.rotation.order = 'YXZ';
scene.add(camera);

// ---------- Lights — bright daylight ----------
scene.add(new THREE.HemisphereLight(0xeaf4ff, 0x9a8a76, 1.25));
const sun = new THREE.DirectionalLight(0xfff2d8, 2.4);
sun.position.set(28, 42, 18);
sun.castShadow = true;
sun.shadow.mapSize.set(S.isTouch ? 1024 : 2048, S.isTouch ? 1024 : 2048); // lighter shadows on touch
sun.shadow.camera.left = -45; sun.shadow.camera.right = 45;
sun.shadow.camera.top = 45; sun.shadow.camera.bottom = -45;
sun.shadow.camera.far = 120;
sun.shadow.bias = -0.0004;
scene.add(sun);
const fill = new THREE.DirectionalLight(0xbfd9ff, 0.5);
fill.position.set(-20, 25, -30);
scene.add(fill);

// ---------- Map data ----------
const colliders = [];   // {min:Vector3, max:Vector3}
const mapMeshes = [];   // solid meshes for bullet raycasts
const botParts = [];    // bot hitbox meshes

const MAT = {
  floor: new THREE.MeshStandardMaterial({ color: 0xcfc8b8, roughness: 0.95 }),
  floorA: new THREE.MeshStandardMaterial({ color: 0x9ec98f, roughness: 0.95 }),
  floorB: new THREE.MeshStandardMaterial({ color: 0xe0a08c, roughness: 0.95 }),
  wall: new THREE.MeshStandardMaterial({ color: 0xf0ead9, roughness: 0.85 }),
  wallDark: new THREE.MeshStandardMaterial({ color: 0x9fb2c8, roughness: 0.85 }),
  crate: new THREE.MeshStandardMaterial({ color: 0xe09132, roughness: 0.8 }),
  crate2: new THREE.MeshStandardMaterial({ color: 0x2fa08c, roughness: 0.8 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x8a97a8, roughness: 0.4, metalness: 0.5 }),
  accentA: new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.6, emissive: 0x1a5c1e, emissiveIntensity: 0.6 }),
  accentB: new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.6, emissive: 0x7a1a10, emissiveIntensity: 0.6 }),
};

function addBox(x, y, z, w, h, d, mat, collide = true, shadow = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = shadow; m.receiveShadow = true;
  scene.add(m);
  if (collide) {
    colliders.push({ min: new THREE.Vector3(x - w / 2, y - h / 2, z - d / 2), max: new THREE.Vector3(x + w / 2, y + h / 2, z + d / 2) });
    mapMeshes.push(m);
  }
  return m;
}

function textSprite(text, color = '#ffffff', scale = 4) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(255,255,255,0.92)'; g.beginPath(); g.arc(128, 128, 120, 0, 7); g.fill();
  g.strokeStyle = color; g.lineWidth = 10; g.beginPath(); g.arc(128, 128, 112, 0, 7); g.stroke();
  g.fillStyle = color; g.font = 'bold 150px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 134);
  const tex = new THREE.CanvasTexture(c);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(scale, scale, 1);
  return sp;
}

function buildMap() {
  // Floor (60 x 40) + clearly tinted site areas
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 40), MAT.floor);
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const siteA = new THREE.Mesh(new THREE.PlaneGeometry(12, 10), MAT.floorA);
  siteA.rotation.x = -Math.PI / 2; siteA.position.set(-22, 0.02, -12); siteA.receiveShadow = true; scene.add(siteA);
  const siteB = new THREE.Mesh(new THREE.PlaneGeometry(12, 10), MAT.floorB);
  siteB.rotation.x = -Math.PI / 2; siteB.position.set(22, 0.02, 12); siteB.receiveShadow = true; scene.add(siteB);

  // Perimeter walls (h=4.5)
  addBox(0, 2.25, -20, 60, 4.5, 1, MAT.wall);
  addBox(0, 2.25, 20, 60, 4.5, 1, MAT.wall);
  addBox(-30, 2.25, 0, 1, 4.5, 40, MAT.wall);
  addBox(30, 2.25, 0, 1, 4.5, 40, MAT.wall);

  // Mid wall with two gaps (creates mid + connector)
  addBox(-18, 2.25, 0, 24, 4.5, 1, MAT.wallDark);
  addBox(18, 2.25, 0, 24, 4.5, 1, MAT.wallDark);
  addBox(0, 2.25, -14, 1, 4.5, 12, MAT.wallDark);
  addBox(0, 2.25, 14, 1, 4.5, 12, MAT.wallDark);

  // Site A structures (top-left) — green accent trim
  addBox(-22, 1.5, -16, 10, 3, 1, MAT.wallDark);
  addBox(-26, 1.25, -8, 1, 2.5, 6, MAT.wallDark);
  addBox(-22, 0.6, -12, 3, 1.2, 3, MAT.crate);
  addBox(-18.5, 0.6, -14.5, 2, 1.2, 2, MAT.crate2);
  addBox(-24, 1.8, -12, 2, 1.2, 2, MAT.crate2); // stacked on crate
  addBox(-22, 3.15, -16, 10, 0.3, 1.2, MAT.accentA, false); // green trim

  // Site B structures (bottom-right) — red accent trim
  addBox(22, 1.5, 16, 10, 3, 1, MAT.wallDark);
  addBox(26, 1.25, 8, 1, 2.5, 6, MAT.wallDark);
  addBox(22, 0.6, 12, 3, 1.2, 3, MAT.crate2);
  addBox(18.5, 0.6, 14.5, 2, 1.2, 2, MAT.crate);
  addBox(24, 1.8, 12, 2, 1.2, 2, MAT.crate);
  addBox(22, 3.15, 16, 10, 0.3, 1.2, MAT.accentB, false); // red trim

  // Mid / connector cover — alternating orange / teal crates
  addBox(-6, 0.75, -6, 3, 1.5, 3, MAT.crate);
  addBox(6, 0.75, 6, 3, 1.5, 3, MAT.crate2);
  addBox(-8, 0.75, 8, 2.4, 1.5, 2.4, MAT.crate2);
  addBox(8, 0.75, -8, 2.4, 1.5, 2.4, MAT.crate);
  addBox(0, 0.6, -4, 2, 1.2, 2, MAT.metal);
  addBox(0, 0.6, 4, 2, 1.2, 2, MAT.metal);
  addBox(-14, 1.1, 12, 4, 2.2, 1, MAT.wallDark);
  addBox(14, 1.1, -12, 4, 2.2, 1, MAT.wallDark);
  addBox(-24, 0.6, 4, 2, 1.2, 2, MAT.crate);
  addBox(24, 0.6, -4, 2, 1.2, 2, MAT.crate2);

  // Site markers — big floating letters + poles
  const a = textSprite('A', '#2e7d32', 6); a.position.set(-22, 5.6, -12); scene.add(a);
  const b = textSprite('B', '#c0392b', 6); b.position.set(22, 5.6, 12); scene.add(b);
  const poleA = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 5, 8), MAT.accentA);
  poleA.position.set(-27.5, 2.5, -16.5); poleA.castShadow = true; scene.add(poleA);
  const poleB = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 5, 8), MAT.accentB);
  poleB.position.set(27.5, 2.5, 16.5); poleB.castShadow = true; scene.add(poleB);

  // Skyline silhouettes outside the walls (cheap depth cue)
  const skyMat = new THREE.MeshBasicMaterial({ color: 0x9db8d6 });
  for (let i = 0; i < 14; i++) {
    const h = 8 + Math.random() * 16;
    const bx = -70 + i * 11 + Math.random() * 4;
    const bld = new THREE.Mesh(new THREE.BoxGeometry(8, h, 8), skyMat);
    bld.position.set(bx, h / 2 - 1, -34 - Math.random() * 8);
    scene.add(bld);
    const bld2 = bld.clone(); bld2.position.z = 34 + Math.random() * 8; scene.add(bld2);
  }
}
buildMap();

// Waypoints for bot patrol + cover spots (behind crates/walls)
const WAYPOINTS = [
  new THREE.Vector3(-22, 0, -12), new THREE.Vector3(-14, 0, -14), new THREE.Vector3(-6, 0, -6),
  new THREE.Vector3(0, 0, -10), new THREE.Vector3(8, 0, -8), new THREE.Vector3(22, 0, 12),
  new THREE.Vector3(14, 0, 14), new THREE.Vector3(6, 0, 6), new THREE.Vector3(0, 0, 10),
  new THREE.Vector3(-8, 0, 8), new THREE.Vector3(-24, 0, 4), new THREE.Vector3(24, 0, -4),
  new THREE.Vector3(-14, 0, 12), new THREE.Vector3(14, 0, -12), new THREE.Vector3(0, 0, 0),
];
const COVER_SPOTS = [
  new THREE.Vector3(-20.5, 0, -10.5), new THREE.Vector3(-16.5, 0, -15.5),
  new THREE.Vector3(20.5, 0, 10.5), new THREE.Vector3(16.5, 0, 15.5),
  new THREE.Vector3(-7.5, 0, -4.5), new THREE.Vector3(7.5, 0, 4.5),
  new THREE.Vector3(-9.5, 0, 9.5), new THREE.Vector3(9.5, 0, -9.5),
  new THREE.Vector3(-14, 0, 10.5), new THREE.Vector3(14, 0, -10.5),
];
const SPAWNS = [
  new THREE.Vector3(-26, 0, -16), new THREE.Vector3(-18, 0, -16), new THREE.Vector3(-26, 0, -8),
  new THREE.Vector3(26, 0, 16), new THREE.Vector3(18, 0, 16), new THREE.Vector3(26, 0, 8),
  new THREE.Vector3(-24, 0, 16), new THREE.Vector3(24, 0, -16),
];
const SITE_A = new THREE.Vector3(-22, 0, -12);
const SITE_B = new THREE.Vector3(22, 0, 12);

// ============================================================
//  AUDIO — all synthesized with WebAudio, no assets
// ============================================================
let AC = null;
function audio() {
  if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
  if (AC.state === 'suspended') AC.resume();
  return AC;
}
function noiseBuffer(ac, dur) {
  const b = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
function playNoise(dur, filterFreq, gain, type = 'lowpass', when = 0) {
  try {
    const ac = audio();
    const src = ac.createBufferSource(); src.buffer = noiseBuffer(ac, dur);
    const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = filterFreq;
    const g = ac.createGain();
    g.gain.setValueAtTime(gain, ac.currentTime + when);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + when + dur);
    src.connect(f); f.connect(g); g.connect(ac.destination);
    src.start(ac.currentTime + when); src.stop(ac.currentTime + when + dur);
  } catch (e) { /* audio unavailable */ }
}
function playTone(freq, dur, gain, type = 'sine', when = 0, slideTo = 0) {
  try {
    const ac = audio();
    const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, ac.currentTime + when);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, ac.currentTime + when + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(gain, ac.currentTime + when);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + when + dur);
    o.connect(g); g.connect(ac.destination);
    o.start(ac.currentTime + when); o.stop(ac.currentTime + when + dur + 0.02);
  } catch (e) { /* audio unavailable */ }
}
const sfx = {
  // rifle: deep crack + low thump; pistol: sharper, shorter snap
  rifle: () => { playNoise(0.11, 1500, 0.55); playTone(150, 0.09, 0.3, 'square', 0, 55); playNoise(0.05, 5000, 0.18, 'highpass'); },
  pistol: () => { playNoise(0.06, 3200, 0.42); playTone(260, 0.05, 0.22, 'square', 0, 90); },
  enemyShot: (d) => { const v = Math.max(0.03, 0.32 - d * 0.008); playNoise(0.08, 1100, v); playTone(140, 0.06, v * 0.5, 'square', 0, 60); },
  dry: () => playTone(900, 0.04, 0.15, 'square'),
  hit: () => playTone(1500, 0.05, 0.22, 'sine'),
  headshot: () => { playTone(1900, 0.05, 0.25, 'sine'); playTone(2400, 0.06, 0.2, 'sine', 0.04); },
  kill: () => { playTone(880, 0.07, 0.2); playTone(1320, 0.1, 0.2, 'sine', 0.07); },
  hurt: () => { playNoise(0.12, 500, 0.4); playTone(110, 0.12, 0.3, 'sine', 0, 55); },
  reload: () => { playTone(600, 0.04, 0.15, 'square'); playTone(450, 0.04, 0.15, 'square', 0.25); playTone(750, 0.05, 0.18, 'square', 0.55); },
  step: () => playNoise(0.05, 700, 0.06),
  swap: () => { playTone(500, 0.04, 0.14, 'square'); playTone(700, 0.04, 0.14, 'square', 0.08); },
  win: () => [523, 659, 784, 1047].forEach((f, i) => playTone(f, 0.16, 0.22, 'triangle', i * 0.13)),
  lose: () => [392, 330, 262, 196].forEach((f, i) => playTone(f, 0.2, 0.22, 'triangle', i * 0.15)),
  round: () => playTone(660, 0.12, 0.2, 'triangle'),
};

// ============================================================
//  VIEWMODEL — detailed gun + muzzle flash quad
// ============================================================
const gunGroup = new THREE.Group();
const gunMat = new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.35, metalness: 0.75 });
const gunDark = new THREE.MeshStandardMaterial({ color: 0x14171b, roughness: 0.5, metalness: 0.6 });
const gunAccent = new THREE.MeshStandardMaterial({ color: 0xc9962e, roughness: 0.45, metalness: 0.6 });
const gloveMat = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.9 });
let flashQuad, flashLight;

function flashTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,240,180,1)');
  grad.addColorStop(0.35, 'rgba(255,170,60,0.9)');
  grad.addColorStop(1, 'rgba(255,120,20,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
const flashTex = flashTexture();

function buildGun() {
  gunGroup.clear();
  const isPistol = S.weapon === 'pistol';
  const add = (geo, mat, x, y, z, rx = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.x = rx;
    gunGroup.add(m); return m;
  };
  if (isPistol) {
    add(new THREE.BoxGeometry(0.07, 0.1, 0.3), gunMat, 0, 0, -0.1);            // slide
    add(new THREE.BoxGeometry(0.06, 0.16, 0.09), gunDark, 0, -0.11, 0.02);     // grip
    add(new THREE.BoxGeometry(0.02, 0.03, 0.05), gunAccent, 0, 0.06, -0.22);   // front sight
    add(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 8), gunDark, 0, 0.01, -0.3).rotation.x = Math.PI / 2;
  } else {
    add(new THREE.BoxGeometry(0.09, 0.13, 0.42), gunMat, 0, 0, -0.02);          // receiver
    add(new THREE.BoxGeometry(0.08, 0.1, 0.3), gunDark, 0, 0, -0.34);           // handguard
    add(new THREE.CylinderGeometry(0.022, 0.022, 0.3, 10), gunMat, 0, 0.015, -0.6).rotation.x = Math.PI / 2; // barrel
    add(new THREE.BoxGeometry(0.05, 0.05, 0.08), gunAccent, 0, 0.015, -0.74);  // muzzle brake
    add(new THREE.BoxGeometry(0.07, 0.11, 0.16), gunDark, 0, 0, 0.26);          // stock
    add(new THREE.BoxGeometry(0.07, 0.2, 0.11), gunAccent, 0, -0.15, -0.06, 0.2); // magazine
    add(new THREE.BoxGeometry(0.06, 0.14, 0.09), gunDark, 0, -0.12, 0.08, 0.35);  // pistol grip
    add(new THREE.BoxGeometry(0.02, 0.045, 0.06), gunAccent, 0, 0.085, -0.14); // rear sight
    add(new THREE.BoxGeometry(0.02, 0.035, 0.03), gunAccent, 0, 0.07, -0.46);  // front sight
    // rail slots on the handguard
    for (let i = 0; i < 3; i++) add(new THREE.BoxGeometry(0.085, 0.02, 0.03), gunMat, 0, 0.055, -0.26 - i * 0.09);
  }
  // support hand gripping the front
  add(new THREE.BoxGeometry(0.09, 0.08, 0.12), gloveMat, 0, -0.09, isPistol ? -0.14 : -0.36);
  // muzzle flash quad at the barrel tip
  flashQuad = new THREE.Mesh(
    new THREE.PlaneGeometry(0.34, 0.34),
    new THREE.MeshBasicMaterial({ map: flashTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  flashQuad.position.set(0, 0.015, isPistol ? -0.38 : -0.82);
  gunGroup.add(flashQuad);
  gunGroup.scale.setScalar(isPistol ? 0.9 : 1);
  gunGroup.position.set(0.26, -0.24, -0.5);
  gunGroup.rotation.set(0, 0, 0);
}
buildGun();
camera.add(gunGroup);
flashLight = new THREE.PointLight(0xffc46b, 0, 9, 2);
flashLight.position.set(0.26, -0.2, -1.1);
camera.add(flashLight);

function showMuzzleFlash() {
  if (!flashQuad) return;
  flashQuad.material.opacity = 1;
  flashQuad.rotation.z = Math.random() * Math.PI;
  flashLight.intensity = 16;
  setTimeout(() => { if (flashQuad) flashQuad.material.opacity = 0; flashLight.intensity = 0; }, 45);
}

// ============================================================
//  INPUT — pointer lock, drag-look fallback, keys, touch
// ============================================================
const overlay = document.getElementById('overlay');
const endScreen = document.getElementById('endScreen');
const scoreboard = document.getElementById('scoreboard');
let locked = false;

document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === renderer.domElement;
  if (!locked && S.mode === 'playing') showPause();
});
document.addEventListener('pointerlockerror', () => {
  S.lockDenied = true;
  $('lockHint').textContent = 'Pointer lock unavailable — drag with the mouse to look around.';
  $('lockHint').classList.remove('hidden');
});
document.addEventListener('mousemove', (e) => {
  if (S.mode !== 'playing') return;
  if (locked) {
    S.yaw -= e.movementX * 0.0021;
    S.pitch -= e.movementY * 0.0021;
  } else if (S.dragging) {
    // drag-to-look fallback (pointer lock denied / not locked)
    S.yaw -= e.movementX * 0.0032;
    S.pitch -= e.movementY * 0.0032;
  } else return;
  S.pitch = Math.max(-1.5, Math.min(1.5, S.pitch));
});
document.addEventListener('mousedown', (e) => {
  if (S.mode !== 'playing') return;
  if (e.target.closest('button') || e.target.closest('#touchUI')) return;
  S.dragging = true;
  if (e.button === 0 && (locked || S.lockDenied || S.isTouch)) { S.firing = true; S.triggerEdge = true; }
  if (!locked && !S.lockDenied && !S.isTouch) lockPointer();
});
document.addEventListener('mouseup', (e) => {
  S.dragging = false;
  if (e.button === 0) { S.firing = false; S.triggerEdge = false; }
});
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('wheel', (e) => {
  if (S.mode !== 'playing' || !(locked || S.lockDenied)) return;
  switchWeapon(S.weapon === 'rifle' ? 'pistol' : 'rifle');
});
addEventListener('keydown', (e) => {
  S.keys[e.code] = true;
  if (e.code === 'KeyR') startReload();
  if (e.code === 'Digit1') switchWeapon('rifle');
  if (e.code === 'Digit2') switchWeapon('pistol');
  if (e.code === 'KeyQ') switchWeapon(S.weapon === 'rifle' ? 'pistol' : 'rifle');
  if (e.code === 'Tab') { e.preventDefault(); showScoreboard(true); }
  if (e.code === 'KeyP') togglePause();
  if (e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', (e) => {
  S.keys[e.code] = false;
  if (e.code === 'Tab') showScoreboard(false);
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

function lockPointer() {
  if (S.isTouch) return; // touch uses drag-look
  audio();
  try {
    const p = renderer.domElement.requestPointerLock();
    if (p && p.catch) p.catch(() => { S.lockDenied = true; });
  } catch (e) { S.lockDenied = true; }
}
document.getElementById('playBtn').addEventListener('click', () => {
  overlay.classList.add('hidden');
  startRound();
  lockPointer();
});
document.getElementById('resumeBtn').addEventListener('click', () => {
  overlay.classList.add('hidden');
  S.mode = 'playing';
  lockPointer();
});
document.getElementById('nextRoundBtn').addEventListener('click', () => {
  endScreen.classList.add('hidden');
  startRound();
  lockPointer();
});
document.getElementById('restartBtn').addEventListener('click', () => {
  endScreen.classList.add('hidden');
  S.roundsWon = 0; S.roundsLost = 0; S.round = 1; S.kills = 0; S.deaths = 0;
  startRound();
  lockPointer();
});
document.getElementById('pauseRestartBtn').addEventListener('click', () => {
  overlay.classList.add('hidden');
  document.getElementById('pauseRestartBtn').classList.add('hidden');
  startRound();
  lockPointer();
});

function showPause() {
  if (S.mode !== 'playing') return;
  S.mode = 'paused';
  S.firing = false;
  S.triggerEdge = false;
  document.getElementById('pauseTitle').textContent = 'Paused';
  document.getElementById('playBtn').classList.add('hidden');
  document.getElementById('resumeBtn').classList.remove('hidden');
  document.getElementById('pauseRestartBtn').classList.remove('hidden');
  overlay.classList.remove('hidden');
}
function togglePause() {
  if (S.mode === 'playing') {
    if (document.pointerLockElement) document.exitPointerLock();
    showPause();
  } else if (S.mode === 'paused') {
    overlay.classList.add('hidden');
    S.mode = 'playing';
    lockPointer();
  }
}

// ---------- Touch controls (basic, shown only on touch devices) ----------
const touchUI = document.getElementById('touchUI');
if (S.isTouch) {
  document.body.classList.add('touch');
  touchUI.classList.remove('hidden');
  const stick = document.getElementById('stick');
  const knob = document.getElementById('stickKnob');
  let stickId = -1, stickOX = 0, stickOY = 0;
  const lookZone = document.getElementById('lookZone');
  stick.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    stickId = t.identifier;
    const r = stick.getBoundingClientRect();
    stickOX = r.left + r.width / 2; stickOY = r.top + r.height / 2;
  }, { passive: false });
  lookZone.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    S.touchLook.id = t.identifier; S.touchLook.lx = t.clientX; S.touchLook.ly = t.clientY;
  }, { passive: false });
  document.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) {
        let dx = (t.clientX - stickOX) / 48, dy = (t.clientY - stickOY) / 48;
        const l = Math.hypot(dx, dy);
        if (l > 1) { dx /= l; dy /= l; }
        S.touchMove.x = dx; S.touchMove.y = dy;
        knob.style.transform = `translate(${dx * 34}px, ${dy * 34}px)`;
      } else if (t.identifier === S.touchLook.id) {
        S.yaw -= (t.clientX - S.touchLook.lx) * 0.0042;
        S.pitch -= (t.clientY - S.touchLook.ly) * 0.0042;
        S.pitch = Math.max(-1.5, Math.min(1.5, S.pitch));
        S.touchLook.lx = t.clientX; S.touchLook.ly = t.clientY;
      }
    }
  }, { passive: false });
  const endTouch = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) { stickId = -1; S.touchMove.x = 0; S.touchMove.y = 0; knob.style.transform = 'translate(0,0)'; }
      if (t.identifier === S.touchLook.id) S.touchLook.id = -1;
    }
  };
  document.addEventListener('touchend', endTouch);
  document.addEventListener('touchcancel', endTouch);
  const bindHold = (id, on, off) => {
    const el = document.getElementById(id);
    el.addEventListener('touchstart', (e) => { e.preventDefault(); on(); }, { passive: false });
    el.addEventListener('touchend', (e) => { e.preventDefault(); if (off) off(); }, { passive: false });
  };
  bindHold('btnFire', () => { S.firing = true; S.triggerEdge = true; }, () => { S.firing = false; S.triggerEdge = false; });
  // JUMP queues the jump instead of holding Space for 120 ms:
  // slow frames could miss a 120 ms press, a queued jump survives
  // until the next physics step (or expires after ~400 ms).
  bindHold('btnJump', () => { S.jumpQueued = true; S.jumpQueuedAt = performance.now(); });
  bindHold('btnReload', () => startReload());
  bindHold('btnSwap', () => switchWeapon(S.weapon === 'rifle' ? 'pistol' : 'rifle'));
  document.getElementById('btnPause').addEventListener('click', (e) => { e.preventDefault(); togglePause(); });
}

// ============================================================
//  PLAYER MOVEMENT + COLLISION (AABB, per-axis resolve)
// ============================================================
function collideAxis(p, half, height, axis, delta) {
  p[axis] += delta;
  const min = new THREE.Vector3(p.x - half, p.y, p.z - half);
  const max = new THREE.Vector3(p.x + half, p.y + height, p.z + half);
  for (const c of colliders) {
    if (max.x > c.min.x && min.x < c.max.x && max.y > c.min.y && min.y < c.max.y && max.z > c.min.z && min.z < c.max.z) {
      if (axis === 'x') p.x = delta > 0 ? c.min.x - half : c.max.x + half;
      if (axis === 'z') p.z = delta > 0 ? c.min.z - half : c.max.z + half;
      if (axis === 'y') {
        if (delta > 0) { p.y = c.min.y - height; S.vel.y = Math.min(S.vel.y, 0); }
        else { p.y = c.max.y; S.vel.y = 0; S.onGround = true; }
      }
      min.set(p.x - half, p.y, p.z - half);
      max.set(p.x + half, p.y + height, p.z + half);
    }
  }
}

function updatePlayer(dt) {
  const stickMag = Math.hypot(S.touchMove.x, S.touchMove.y);
  const sprint = S.keys['ShiftLeft'] || S.keys['ShiftRight'] || stickMag > 0.85; // push stick far to sprint
  const speed = sprint ? CFG.sprintSpeed : CFG.walkSpeed;
  let fx = 0, fz = 0;
  if (S.keys['KeyW']) fz -= 1;
  if (S.keys['KeyS']) fz += 1;
  if (S.keys['KeyA']) fx -= 1;
  if (S.keys['KeyD']) fx += 1;
  // touch joystick (forward = -y on the stick)
  fx += S.touchMove.x;
  fz += S.touchMove.y;
  const len = Math.hypot(fx, fz);
  if (len > 1) { fx /= len; fz /= len; }
  const sin = Math.sin(S.yaw), cos = Math.cos(S.yaw);
  const mx = (fx * cos - fz * sin) * speed;
  const mz = (fx * sin + fz * cos) * speed;

  // smooth acceleration
  S.vel.x += (mx - S.vel.x) * Math.min(1, dt * 12);
  S.vel.z += (mz - S.vel.z) * Math.min(1, dt * 12);

  // Jump: keyboard Space, or a queued touch JUMP. The queue is consumed
  // the first physics step where the player is on the ground, and
  // expires after ~400 ms so a stale tap can't fire much later.
  if (S.jumpQueued) {
    if (S.onGround) { S.vel.y = CFG.jumpSpeed; S.onGround = false; S.jumpQueued = false; }
    else if (performance.now() - S.jumpQueuedAt > 400) { S.jumpQueued = false; }
  }
  if (S.keys['Space'] && S.onGround) { S.vel.y = CFG.jumpSpeed; S.onGround = false; }
  S.vel.y -= CFG.gravity * dt;

  const p = S.pos;
  S.onGround = false;
  collideAxis(p, CFG.playerRadius, CFG.playerHeight, 'x', S.vel.x * dt);
  collideAxis(p, CFG.playerRadius, CFG.playerHeight, 'z', S.vel.z * dt);
  collideAxis(p, CFG.playerRadius, CFG.playerHeight, 'y', S.vel.y * dt);
  if (p.y <= 0) { p.y = 0; S.vel.y = 0; S.onGround = true; }
  p.x = Math.max(-29.2, Math.min(29.2, p.x));
  p.z = Math.max(-19.2, Math.min(19.2, p.z));

  camera.position.set(p.x, p.y + CFG.eyeHeight, p.z);
  camera.rotation.y = S.yaw;
  camera.rotation.x = S.pitch + S.recoil * 0.35;
  S.recoil = Math.max(0, S.recoil - dt * 0.09);

  // footsteps
  const moving = Math.hypot(S.vel.x, S.vel.z) > 2 && S.onGround;
  if (moving && performance.now() - S.lastStep > (sprint ? 300 : 420)) {
    S.lastStep = performance.now(); sfx.step();
  }
  // spread grows while moving / airborne
  const moveFactor = Math.hypot(S.vel.x, S.vel.z) / CFG.sprintSpeed;
  S.spreadNow = (sprint ? 1.7 : 1) * (1 + moveFactor * 0.9) * (S.onGround ? 1 : 1.6);
}

// ============================================================
//  WEAPONS — hitscan shooting, recoil, reload, switch, decals
// ============================================================
const raycaster = new THREE.Raycaster();
const _dir = new THREE.Vector3();
const decalMat = new THREE.MeshBasicMaterial({ color: 0x2a2118, transparent: true, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false });
const decalGeo = new THREE.CircleGeometry(0.09, 12);

function switchWeapon(name) {
  if (S.weapon === name || S.reloading) return;
  S.weapon = name;
  S.triggerEdge = false;
  buildGun();
  sfx.swap();
  updateHUD();
}
function startReload() {
  const w = WEAPONS[S.weapon];
  if (S.reloading || S.mode !== 'playing') return;
  if (S.ammo[S.weapon] >= w.mag || S.reserve[S.weapon] <= 0) return;
  S.reloading = true;
  S.reloadEnd = performance.now() + w.reloadTime * 1000;
  sfx.reload();
  updateHUD();
}
function finishReload() {
  const w = WEAPONS[S.weapon];
  const need = w.mag - S.ammo[S.weapon];
  const take = Math.min(need, S.reserve[S.weapon]);
  S.ammo[S.weapon] += take;
  S.reserve[S.weapon] -= take;
  S.reloading = false;
  updateHUD();
}

function shoot() {
  const w = WEAPONS[S.weapon];
  const now = performance.now();
  const interval = 60000 / w.rpm;
  if (now - S.lastShot < interval) return;
  if (S.reloading) return;
  // pistol is semi-auto: one shot per trigger press
  if (!w.auto) {
    if (!S.triggerEdge) return;
    S.triggerEdge = false;
  }
  if (S.ammo[S.weapon] <= 0) { sfx.dry(); S.lastShot = now; startReload(); return; }
  S.lastShot = now;
  S.ammo[S.weapon]--;
  S.shots++;

  // direction with spread + recoil
  camera.getWorldDirection(_dir);
  const spread = w.spread * S.spreadNow;
  _dir.x += (Math.random() - 0.5) * spread * 2;
  _dir.y += (Math.random() - 0.5) * spread * 2;
  _dir.z += (Math.random() - 0.5) * spread * 2;
  _dir.normalize();
  S.pitch += w.kick * (0.7 + Math.random() * 0.6);
  S.recoil = Math.min(0.09, S.recoil + w.kick);
  gunGroup.position.z = -0.5 + 0.09; // kick back, eased in render loop

  raycaster.set(camera.position, _dir);
  raycaster.far = w.range;
  const hits = raycaster.intersectObjects([...botParts, ...mapMeshes], false);
  let end = camera.position.clone().addScaledVector(_dir, w.range);
  if (hits.length) {
    const h = hits[0];
    end = h.point.clone();
    if (h.object.userData.bot) {
      const bot = h.object.userData.bot;
      const isHead = h.object.userData.part === 'head';
      damageBot(bot, w.damage * (isHead ? w.headMult : 1), isHead);
    } else {
      spawnImpact(h.point);
      spawnDecal(h.point, h.face ? h.face.normal.clone() : _dir.clone().negate());
    }
  }
  spawnTracer(camera.position.clone().addScaledVector(_dir, 0.6).add(new THREE.Vector3(0.2, -0.15, 0)), end, w.tracer);
  showMuzzleFlash();
  sfx[w.sound]();
  updateHUD();
}

function spawnTracer(from, to, color) {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 }));
  scene.add(line);
  S.tracers.push({ line, born: performance.now() });
}
function spawnImpact(point) {
  const geo = new THREE.BufferGeometry();
  const pts = [];
  for (let i = 0; i < 8; i++) {
    pts.push(point.x + (Math.random() - 0.5) * 0.15, point.y + (Math.random() - 0.5) * 0.15, point.z + (Math.random() - 0.5) * 0.15);
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const p = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffd27d, size: 0.12, transparent: true, opacity: 0.9 }));
  scene.add(p);
  S.tracers.push({ line: p, born: performance.now() });
}
function spawnDecal(point, normal) {
  const d = new THREE.Mesh(decalGeo, decalMat);
  d.position.copy(point).addScaledVector(normal, 0.02);
  d.lookAt(point.clone().add(normal));
  d.rotation.z = Math.random() * Math.PI;
  scene.add(d);
  S.decals.push({ mesh: d, born: performance.now() });
  if (S.decals.length > 48) {
    const old = S.decals.shift();
    scene.remove(old.mesh);
  }
}
function updateTracers() {
  const now = performance.now();
  for (let i = S.tracers.length - 1; i >= 0; i--) {
    const t = S.tracers[i];
    const age = now - t.born;
    if (age > 90) { scene.remove(t.line); t.line.geometry.dispose(); t.line.material.dispose(); S.tracers.splice(i, 1); }
    else if (t.line.material) t.line.material.opacity = 0.85 * (1 - age / 90);
  }
  for (let i = S.decals.length - 1; i >= 0; i--) {
    if (now - S.decals[i].born > 12000) { scene.remove(S.decals[i].mesh); S.decals.splice(i, 1); }
  }
  // gun kick recovery
  gunGroup.position.z += (-0.5 - gunGroup.position.z) * 0.35;
  gunGroup.position.y += (-0.24 - gunGroup.position.y) * 0.3;
  gunGroup.rotation.x += (S.recoil * 2.2 - gunGroup.rotation.x) * 0.3;
}

// ============================================================
//  BOTS — patrol, spot (LOS + 32 m), react, burst fire,
//  cover + peek, strafe, lose track -> patrol
// ============================================================
const BOT_COLORS = [0xff3d00, 0xff6d00, 0xff1744, 0xf50057, 0xff9100, 0xd50000, 0xff5722, 0xc51162]; // saturated orange-red family
const outlineMat = new THREE.MeshBasicMaterial({ color: 0x111111, side: THREE.BackSide });
let botId = 0;

function addOutline(mesh, scale = 1.09) {
  const shell = new THREE.Mesh(mesh.geometry, outlineMat);
  shell.scale.setScalar(scale);
  mesh.add(shell);
}

class Bot {
  constructor(spawn) {
    this.id = botId++;
    this.hp = 100;
    this.alive = true;
    this.state = 'patrol';           // patrol | chase | cover
    this.speed = 3.1 + Math.random() * 0.7;
    this.target = WAYPOINTS[Math.floor(Math.random() * WAYPOINTS.length)].clone();
    this.coverTarget = null;
    this.coverArrived = false;
    this.coverMode = 'hide';         // hide | peek
    this.coverModeAt = 0;
    this.peekPos = null;
    this.loseSightAt = 0;
    this.reactAt = 0;
    this.burstLeft = 0;
    this.nextShot = 0;
    this.nextThink = Math.random() * 0.5;
    this.kills = 0;

    const g = new THREE.Group();
    const col = BOT_COLORS[this.id % BOT_COLORS.length];
    const bodyMat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.55, emissive: col, emissiveIntensity: 0.35 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.7 });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xf0c8a0, roughness: 0.8 });
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.8, 0.22), darkMat);
    legL.position.set(-0.14, 0.4, 0);
    const legR = legL.clone(); legR.position.x = 0.14;
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.7, 0.36), bodyMat);
    torso.position.y = 1.15;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), skinMat);
    head.position.y = 1.68;
    const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.16, 0.38), bodyMat);
    helmet.position.y = 1.86;
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.7), darkMat);
    gun.position.set(0.25, 1.25, -0.3);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.5), bodyMat);
    arm.position.set(0.25, 1.3, -0.1);
    // contrasting cyan emissive stripe across chest and helmet — reads at 30 m
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0x00e5ff, emissive: 0x00e5ff, emissiveIntensity: 1.4 });
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.1, 0.38), stripeMat);
    stripe.position.y = 1.32;
    const stripeHead = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.06, 0.36), stripeMat);
    stripeHead.position.y = 1.78;
    g.add(legL, legR, torso, head, helmet, gun, arm, stripe, stripeHead);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
    // dark outline shells so bots read against any background
    addOutline(torso); addOutline(head);
    [legL, legR, torso, arm].forEach((m) => { m.userData.bot = this; m.userData.part = 'body'; botParts.push(m); });
    [head, helmet].forEach((m) => { m.userData.bot = this; m.userData.part = 'head'; botParts.push(m); });
    this.meshes = { legL, legR, torso, head, gun };
    this.group = g;
    this.group.scale.setScalar(BOT_SCALE);
    this.group.position.copy(spawn);
    scene.add(g);

    // health bar (two sprites, always face camera)
    this.barBg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x111111, depthTest: false }));
    this.barBg.scale.set(0.95, 0.1, 1); this.barBg.position.y = 2.2;
    this.barFg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x37d67a, depthTest: false }));
    this.barFg.scale.set(0.9, 0.06, 1); this.barFg.position.y = 2.2;
    g.add(this.barBg, this.barFg);
    this.walkPhase = Math.random() * 6;
  }

  eyePos() { return new THREE.Vector3(this.group.position.x, this.group.position.y + 1.55 * BOT_SCALE, this.group.position.z); }

  canSeePlayer() {
    const from = this.eyePos();
    const to = new THREE.Vector3(S.pos.x, S.pos.y + 1.3, S.pos.z);
    const dist = from.distanceTo(to);
    if (dist > CFG.spotDist) return false;
    const dir = to.clone().sub(from).normalize();
    raycaster.set(from, dir); raycaster.far = dist;
    const hits = raycaster.intersectObjects(mapMeshes, false);
    return hits.length === 0;
  }

  moveToward(target, dt, speed) {
    const p = this.group.position;
    const dx = target.x - p.x, dz = target.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.15) return true;
    const vx = (dx / d) * speed, vz = (dz / d) * speed;
    const np = p.clone();
    collideAxis(np, 0.55, 2.5, 'x', vx * dt);
    collideAxis(np, 0.55, 2.5, 'z', vz * dt);
    np.y = 0;
    p.copy(np);
    this.group.rotation.y = Math.atan2(vx, vz);
    this.walkPhase += dt * speed * 3.2;
    const sw = Math.sin(this.walkPhase) * 0.35;
    this.meshes.legL.rotation.x = sw; this.meshes.legR.rotation.x = -sw;
    return false;
  }

  strafe(dt) {
    // circle-strafe around the player while facing them
    const p = this.group.position;
    const toPlayer = new THREE.Vector3(S.pos.x - p.x, 0, S.pos.z - p.z);
    const dist = toPlayer.length();
    const dir = toPlayer.normalize();
    const perp = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(this.id % 2 === 0 ? 1 : -1);
    const want = dist > 14 ? dir : dist < 7 ? dir.clone().negate() : new THREE.Vector3();
    const move = want.add(perp.multiplyScalar(0.8)).normalize().multiplyScalar(this.speed * 0.85);
    const np = p.clone();
    collideAxis(np, 0.55, 2.5, 'x', move.x * dt);
    collideAxis(np, 0.55, 2.5, 'z', move.z * dt);
    np.y = 0; p.copy(np);
    this.group.rotation.y = Math.atan2(S.pos.x - p.x, S.pos.z - p.z);
    this.walkPhase += dt * 8;
    const sw = Math.sin(this.walkPhase) * 0.3;
    this.meshes.legL.rotation.x = sw; this.meshes.legR.rotation.x = -sw;
  }

  tryShoot(now) {
    // no bot fire in the first 4 s of a round
    if (now - S.roundStartAt < CFG.noShootMs) { this.nextShot = now + 200; return; }
    if (now < this.nextShot) return;
    const from = this.eyePos().add(new THREE.Vector3(0, -0.1, 0));
    const to = new THREE.Vector3(S.pos.x, S.pos.y + 1.25, S.pos.z);
    const dist = from.distanceTo(to);
    // aim error: 0.6 + 0.02 per meter
    const err = 0.6 + 0.02 * dist;
    const aim = to.clone();
    aim.x += (Math.random() - 0.5) * err * 2;
    aim.y += (Math.random() - 0.5) * err * 2;
    aim.z += (Math.random() - 0.5) * err * 2;
    const dir = aim.sub(from).normalize();
    const hit = rayHitsPlayer(from, dir, dist + 1);
    spawnTracer(from, from.clone().addScaledVector(dir, Math.min(dist + 2, 60)), 0xff6b5e);
    muzzleFlashAt(this.group.position);
    sfx.enemyShot(dist);
    if (hit) damagePlayer(hit === 'head' ? 8 : 5, this);
    this.burstLeft--;
    if (this.burstLeft > 0) {
      this.nextShot = now + 220 + Math.random() * 130;   // 220-350 ms inside a burst
    } else {
      this.nextShot = now + 1100 + Math.random() * 900;  // 1.1-2 s pause between bursts
    }
  }

  update(dt, now) {
    if (!this.alive) return;
    if (now >= this.nextThink) {
      this.nextThink = now + 250 + Math.random() * 200;
      const sees = this.canSeePlayer();
      const near = this.group.position.distanceTo(S.pos) < 8;
      if (sees) {
        if (this.state !== 'chase' && this.state !== 'cover') {
          this.reactAt = now + 1000 + Math.random() * 900; // 1.0-1.9 s reaction
        }
        this.loseSightAt = now + 3500;
        if (this.hp < 35 && !near) {
          if (this.state !== 'cover') {
            this.state = 'cover';
            let best = null, bd = 1e9;
            for (const c of COVER_SPOTS) {
              const d = c.distanceTo(this.group.position);
              if (d < bd) { bd = d; best = c; }
            }
            this.coverTarget = best.clone();
            this.coverArrived = false;
            this.coverMode = 'hide';
            this.coverModeAt = now + 1000;
          }
        } else if (this.state !== 'cover') {
          this.state = 'chase';
        } else if (this.state === 'cover' && near) {
          this.state = 'chase'; this.coverTarget = null;
        }
      } else if ((this.state === 'chase' || this.state === 'cover') && now > this.loseSightAt) {
        this.state = 'patrol';
        this.coverTarget = null;
        this.target = WAYPOINTS[Math.floor(Math.random() * WAYPOINTS.length)].clone();
      }
      if (this.state === 'cover' && this.hp > 60) { this.state = 'patrol'; this.coverTarget = null; }
    }

    if (this.state === 'patrol') {
      if (this.moveToward(this.target, dt, this.speed * 0.7)) {
        this.target = WAYPOINTS[Math.floor(Math.random() * WAYPOINTS.length)].clone();
      }
    } else if (this.state === 'cover' && this.coverTarget) {
      if (!this.coverArrived) {
        this.coverArrived = this.moveToward(this.coverTarget, dt, this.speed);
      } else if (this.coverMode === 'hide') {
        this.moveToward(this.coverTarget, dt, this.speed * 0.5);
        this.group.rotation.y = Math.atan2(S.pos.x - this.group.position.x, S.pos.z - this.group.position.z);
        if (now > this.coverModeAt) {
          // peek: step out toward the player's side and shoot
          const dir = new THREE.Vector3(S.pos.x - this.coverTarget.x, 0, S.pos.z - this.coverTarget.z).normalize();
          this.peekPos = this.coverTarget.clone().addScaledVector(dir, 1.6);
          this.coverMode = 'peek';
          this.coverModeAt = now + 1200 + Math.random() * 500;
        }
      } else {
        this.moveToward(this.peekPos, dt, this.speed);
        this.group.rotation.y = Math.atan2(S.pos.x - this.group.position.x, S.pos.z - this.group.position.z);
        if (this.canSeePlayer() && now > this.reactAt) {
          if (this.burstLeft <= 0 && now > this.nextShot) this.burstLeft = 3 + Math.floor(Math.random() * 3);
          if (this.burstLeft > 0) this.tryShoot(now);
        }
        if (now > this.coverModeAt) { this.coverMode = 'hide'; this.coverModeAt = now + 1200 + Math.random() * 600; }
      }
    } else if (this.state === 'chase') {
      this.strafe(dt);
      if (now > this.reactAt) {
        if (this.burstLeft <= 0 && now > this.nextShot) this.burstLeft = 3 + Math.floor(Math.random() * 3);
        if (this.burstLeft > 0) this.tryShoot(now);
      }
    }
    // health bar colour + visibility (sprites always face the camera;
    // shown up to sight range 32 m, hidden when dead via die())
    const distToPlayer = this.group.position.distanceTo(S.pos);
    this.barBg.visible = distToPlayer <= CFG.spotDist;
    this.barFg.visible = distToPlayer <= CFG.spotDist;
    const f = this.hp / 100;
    this.barFg.scale.x = 0.9 * f;
    this.barFg.material.color.setHSL(f * 0.33, 0.8, 0.5);
  }

  die() {
    this.alive = false;
    this.group.rotation.z = Math.PI / 2;
    this.group.position.y = 0.3;
    this.barBg.visible = false; this.barFg.visible = false;
    setTimeout(() => { scene.remove(this.group); }, 4000);
  }
}

function muzzleFlashAt(pos) {
  const l = new THREE.PointLight(0xff8a5e, 6, 8, 2);
  l.position.set(pos.x, pos.y + 1.4, pos.z);
  scene.add(l);
  setTimeout(() => { scene.remove(l); }, 60);
}

// Ray vs two spheres approximating the player (head + torso)
function rayHitsPlayer(origin, dir, maxDist) {
  const spheres = [
    { c: new THREE.Vector3(S.pos.x, S.pos.y + 1.55, S.pos.z), r: 0.28, part: 'head' },
    { c: new THREE.Vector3(S.pos.x, S.pos.y + 0.95, S.pos.z), r: 0.5, part: 'body' },
  ];
  let best = null, bd = maxDist;
  for (const s of spheres) {
    const oc = s.c.clone().sub(origin);
    const t = oc.dot(dir);
    if (t < 0 || t > bd) continue;
    const closest = origin.clone().addScaledVector(dir, t);
    if (closest.distanceTo(s.c) < s.r) { bd = t; best = s.part; }
  }
  return best;
}

function damageBot(bot, dmg, isHead) {
  if (!bot.alive || S.mode !== 'playing') return;
  bot.hp -= dmg;
  S.hits++;
  S.hitmarkAt = performance.now();
  showHitmarker(isHead);
  if (bot.hp <= 0) {
    bot.hp = 0;
    bot.die();
    S.kills++;
    addKillfeed(`You ${isHead ? '☠ headshot ' : '✕ '} BOT-${String(bot.id + 1).padStart(2, '0')}`);
    sfx.kill();
    const alive = S.bots.filter((b) => b.alive).length;
    if (alive === 0) endRound(true);
  } else {
    if (isHead) sfx.headshot(); else sfx.hit();
    // getting shot makes the bot notice the player
    if (bot.state === 'patrol') {
      bot.state = 'chase'; bot.reactAt = performance.now() + 1000 + Math.random() * 900;
      bot.loseSightAt = performance.now() + 4000;
    }
  }
  updateHUD();
}

function damagePlayer(dmg, bot) {
  if (S.mode !== 'playing' || S.hp <= 0) return;
  // armor absorbs half the damage until depleted
  const absorbed = Math.min(S.armor, dmg * 0.5);
  S.armor -= absorbed;
  S.hp -= (dmg - absorbed);
  sfx.hurt();
  flashDamage();
  if (bot) showDamageDirection(bot.group.position);
  if (S.hp <= 0) {
    S.hp = 0;
    S.deaths++;
    if (bot) bot.kills++;
    addKillfeed(`BOT-${String(bot.id + 1).padStart(2, '0')} ✕ You`);
    endRound(false);
  }
  updateHUD();
}

// ============================================================
//  HUD / COMPASS / KILL FEED / SCOREBOARD / ROUNDS
// ============================================================
const $ = (id) => document.getElementById(id);
const healthFill = $('healthFill'), healthText = $('healthText'),
  armorFill = $('armorFill'), armorText = $('armorText'),
  ammoText = $('ammoText'), weaponText = $('weaponText'), weaponIcon = $('weaponIcon'),
  magPips = $('magPips'),
  timerText = $('timerText'), scoreText = $('scoreText'),
  killfeed = $('killfeed'), crosshair = $('crosshair'), hitmarker = $('hitmarker'),
  dmgFlash = $('dmgFlash'), dmgDir = $('dmgDir'), fpsText = $('fpsText'), roundText = $('roundText'),
  minimap = $('minimap'), roundBanner = $('roundBanner');
const mmCtx = minimap ? minimap.getContext('2d') : null;
let lastMinimap = 0;

function updateHUD() {
  const w = WEAPONS[S.weapon];
  healthFill.style.width = Math.max(0, S.hp) + '%';
  healthFill.style.background = S.hp > 50 ? '#37d67a' : S.hp > 25 ? '#f5a623' : '#e5484d';
  healthText.textContent = Math.ceil(Math.max(0, S.hp)) + ' HP';
  armorFill.style.width = Math.max(0, S.armor) + '%';
  armorText.textContent = Math.ceil(Math.max(0, S.armor)) + ' ARMOR';
  ammoText.textContent = S.reloading ? '-- / --' : `${S.ammo[S.weapon]} / ${S.reserve[S.weapon]}`;
  weaponText.textContent = w.name + (S.reloading ? '  — RELOADING —' : '');
  weaponIcon.innerHTML = ICONS[S.weapon];
  updateSwapBtn();
  // magazine pips: 10 segments showing mag fraction
  const segs = 10;
  const filled = Math.round((S.ammo[S.weapon] / w.mag) * segs);
  let pips = '';
  for (let i = 0; i < segs; i++) pips += `<span class="pip${i < filled ? ' on' : ''}"></span>`;
  magPips.innerHTML = pips;
  scoreText.textContent = `K ${S.kills} · D ${S.deaths} · Rounds ${S.roundsWon}–${S.roundsLost}`;
  roundText.textContent = `ROUND ${S.round}`;
  const t = Math.max(0, Math.ceil(S.timeLeft));
  timerText.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  timerText.style.color = t <= 15 ? '#ff5a5a' : '#fff';
  // crosshair spread
  const gap = 6 + WEAPONS[S.weapon].spread * S.spreadNow * 900;
  crosshair.style.setProperty('--gap', gap.toFixed(1) + 'px');
  const nowMs = performance.now();
  if (mmCtx && nowMs - lastMinimap > 150) { lastMinimap = nowMs; drawMinimap(); }
}

// Weapon icons (inline SVG, no emoji)
const ICONS = {
  rifle: '<svg viewBox="0 0 64 24" aria-hidden="true"><path d="M2 9h34l3-4h8l2 4h9l4 3-4 3h-9l-2 3H10l-2-3H2l-1-3z" fill="currentColor"/><rect x="34" y="15" width="5" height="8" rx="1" fill="currentColor"/></svg>',
  pistol: '<svg viewBox="0 0 32 24" aria-hidden="true"><path d="M2 5h26l2 2v4H14l-2 8H6l2-8H2z" fill="currentColor"/></svg>',
};
function updateSwapBtn() {
  const b = $('btnSwap');
  if (!b) return;
  b.innerHTML = `<span class="tbtn-ico">${ICONS[S.weapon]}</span><span class="tbtn-lbl">SWAP</span>`;
}

// Minimap: top-down radar drawn on a 2D canvas
function drawMinimap() {
  const W = minimap.width, H = minimap.height;
  const sx = W / 60, sy = H / 40;
  const X = (x) => (x + 30) * sx;
  const Y = (z) => (z + 20) * sy;
  mmCtx.clearRect(0, 0, W, H);
  mmCtx.fillStyle = 'rgba(8,14,24,0.72)';
  mmCtx.fillRect(0, 0, W, H);
  // site zones
  mmCtx.fillStyle = 'rgba(46,125,50,0.4)';
  mmCtx.fillRect(X(-28), Y(-17), 12 * sx, 10 * sy);
  mmCtx.fillStyle = 'rgba(192,57,43,0.4)';
  mmCtx.fillRect(X(16), Y(7), 12 * sx, 10 * sy);
  // walls / crates from colliders
  mmCtx.fillStyle = 'rgba(160,175,195,0.85)';
  for (const c of colliders) {
    mmCtx.fillRect(X(c.min.x), Y(c.min.z), (c.max.x - c.min.x) * sx, (c.max.z - c.min.z) * sy);
  }
  // site letters
  mmCtx.fillStyle = '#7dff8a'; mmCtx.font = 'bold 11px sans-serif'; mmCtx.textAlign = 'center';
  mmCtx.fillText('A', X(-22), Y(-12) + 4);
  mmCtx.fillStyle = '#ff8a7d';
  mmCtx.fillText('B', X(22), Y(12) + 4);
  // bots as team-colored dots
  for (const b of S.bots) {
    if (!b.alive) continue;
    mmCtx.fillStyle = '#' + BOT_COLORS[b.id % BOT_COLORS.length].toString(16).padStart(6, '0');
    mmCtx.beginPath();
    mmCtx.arc(X(b.group.position.x), Y(b.group.position.z), 3.2, 0, 7);
    mmCtx.fill();
  }
  // player arrow
  const px = X(S.pos.x), py = Y(S.pos.z);
  const fdx = -Math.sin(S.yaw), fdz = -Math.cos(S.yaw);
  mmCtx.save();
  mmCtx.translate(px, py);
  mmCtx.rotate(Math.atan2(fdz, fdx) + Math.PI / 2);
  mmCtx.fillStyle = '#ffffff';
  mmCtx.beginPath();
  mmCtx.moveTo(0, -6); mmCtx.lineTo(4.5, 5); mmCtx.lineTo(-4.5, 5); mmCtx.closePath();
  mmCtx.fill();
  mmCtx.restore();
}

// Damage direction indicator: red chevron toward the attacker
let dmgDirTimer = 0;
function showDamageDirection(fromPos) {
  if (!dmgDir) return;
  const dx = fromPos.x - S.pos.x, dz = fromPos.z - S.pos.z;
  const fx = -Math.sin(S.yaw), fz = -Math.cos(S.yaw);
  const len = Math.hypot(dx, dz) || 1;
  const dot = fx * (dx / len) + fz * (dz / len);
  const cross = fx * (dz / len) - fz * (dx / len);
  const rel = Math.atan2(cross, dot); // 0 = ahead, + = right
  dmgDir.style.transform = `translate(-50%,-50%) rotate(${rel}rad)`;
  dmgDir.classList.remove('hidden');
  dmgDir.classList.remove('anim');
  void dmgDir.offsetWidth;
  dmgDir.classList.add('anim');
  clearTimeout(dmgDirTimer);
  dmgDirTimer = setTimeout(() => dmgDir.classList.add('hidden'), 900);
}

function addKillfeed(text) {
  const div = document.createElement('div');
  div.className = 'feed-item';
  div.textContent = text;
  killfeed.prepend(div);
  setTimeout(() => { div.classList.add('fade'); }, 3800);
  setTimeout(() => { div.remove(); }, 4500);
  while (killfeed.children.length > 5) killfeed.lastChild.remove();
}

function showHitmarker(head) {
  hitmarker.classList.remove('head');
  if (head) hitmarker.classList.add('head');
  hitmarker.classList.add('show');
  setTimeout(() => hitmarker.classList.remove('show'), 120);
}

function flashDamage() {
  dmgFlash.classList.remove('flash');
  void dmgFlash.offsetWidth; // restart animation
  dmgFlash.classList.add('flash');
}

function showScoreboard(show) {
  if (S.mode !== 'playing' && !show) { scoreboard.classList.add('hidden'); return; }
  if (show) {
    const rows = S.bots.map((b) => {
      const st = b.alive ? `<span class="alive">● ALIVE</span> ${Math.ceil(b.hp)} HP` : '<span class="dead">✕ DEAD</span>';
      return `<div class="sb-row"><span>BOT-${String(b.id + 1).padStart(2, '0')}</span><span>Kills ${b.kills}</span><span>${st}</span></div>`;
    }).join('');
    $('sbBody').innerHTML =
      `<div class="sb-row sb-head"><span>YOU</span><span>Kills ${S.kills} · Deaths ${S.deaths}</span><span>${Math.ceil(S.hp)} HP · ${Math.ceil(S.armor)} ARMOR</span></div>` + rows;
    scoreboard.classList.remove('hidden');
  } else {
    scoreboard.classList.add('hidden');
  }
}

function showBanner(text, sub) {
  roundBanner.innerHTML = `<div class="rb-title">${text}</div><div class="rb-sub">${sub}</div>`;
  roundBanner.classList.remove('hidden');
  roundBanner.classList.remove('anim');
  void roundBanner.offsetWidth;
  roundBanner.classList.add('anim');
  setTimeout(() => roundBanner.classList.add('hidden'), 2600);
}

function spawnBots() {
  for (const b of S.bots) scene.remove(b.group);
  S.bots = [];
  botParts.length = 0;
  botId = 0;
  const spots = [...SPAWNS];
  for (let i = 0; i < CFG.botCount; i++) {
    const s = spots.splice(Math.floor(Math.random() * spots.length), 1)[0];
    S.bots.push(new Bot(s));
  }
}

function startRound() {
  S.mode = 'playing';
  S.hp = 100;
  S.armor = 50;
  S.pos.set(0, 0, 16);
  S.vel.set(0, 0, 0);
  S.yaw = 0; S.pitch = 0;
  S.ammo = { rifle: 30, pistol: 12 };
  S.reserve = { rifle: 120, pistol: 48 };
  S.weapon = 'rifle';
  buildGun();
  S.reloading = false;
  S.kills = 0;
  S.shots = 0; S.hits = 0;
  S.timeLeft = CFG.roundTime;
  S.roundStartAt = performance.now();
  killfeed.innerHTML = '';
  spawnBots();
  sfx.round();
  updateHUD();
  showBanner(`ROUND ${S.round}`, 'Eliminate all 8 bots — good luck');
}

function endRound(won) {
  if (S.mode !== 'playing') return;
  S.mode = 'roundEnd';
  S.firing = false;
  if (document.pointerLockElement) document.exitPointerLock();
  if (won) { S.roundsWon++; sfx.win(); } else { S.roundsLost++; sfx.lose(); }
  try {
    const best = parseInt(localStorage.getItem('site7_best_rounds') || '0', 10);
    if (S.roundsWon > best) localStorage.setItem('site7_best_rounds', String(S.roundsWon));
  } catch (e) { /* storage unavailable */ }
  $('endTitle').textContent = won ? 'ROUND WON' : 'ROUND LOST';
  $('endTitle').style.color = won ? '#37d67a' : '#e5484d';
  const alive = S.bots.filter((b) => b.alive).length;
  const acc = S.shots > 0 ? Math.round((S.hits / S.shots) * 100) + '%' : '—';
  const used = Math.round(CFG.roundTime - S.timeLeft);
  $('endStats').innerHTML =
    `Round ${S.round} · Kills ${S.kills} · Bots remaining ${alive}<br>` +
    `Accuracy ${acc} · Time used ${used}s<br>` +
    `Score — You ${S.roundsWon} : ${S.roundsLost} Bots`;
  $('nextRoundBtn').textContent = won ? 'Next Round ▶' : 'Retry Round ↻';
  S.round++;
  endScreen.classList.remove('hidden');
  updateHUD();
}

// Crosshair turns red when aiming at a bot (checked ~7x/sec)
let lastAimCheck = 0;
function updateAimHot(now) {
  if (now - lastAimCheck < 140) return;
  lastAimCheck = now;
  camera.getWorldDirection(_dir);
  raycaster.set(camera.position, _dir);
  raycaster.far = 120;
  const hits = raycaster.intersectObjects(botParts, false);
  crosshair.classList.toggle('hot', hits.length > 0);
}

// ============================================================
//  MAIN LOOP
// ============================================================
const clock = new THREE.Clock();
let fpsFrames = 0, fpsTime = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const now = performance.now();

  if (S.mode === 'playing') {
    S.timeLeft -= dt;
    if (S.timeLeft <= 0) { S.timeLeft = 0; endRound(false); }
    if (S.reloading && now >= S.reloadEnd) finishReload();
    updatePlayer(dt);
    if (S.firing) shoot();
    for (const b of S.bots) b.update(dt, now);
    updateAimHot(now);
  } else if (S.mode === 'roundEnd') {
    // let the scene idle behind the end screen
    for (const b of S.bots) if (b.alive) b.update(dt, now);
  }
  updateTracers();
  if (S.mode === 'playing') updateHUD();

  // fps meter
  fpsFrames++; fpsTime += dt;
  if (fpsTime >= 0.5) {
    fpsText.textContent = Math.round(fpsFrames / fpsTime) + ' FPS';
    fpsFrames = 0; fpsTime = 0;
  }

  renderer.render(scene, camera);
}

// best-score line on the menu
try {
  const best = parseInt(localStorage.getItem('site7_best_rounds') || '0', 10);
  if (best > 0) $('bestLine').textContent = `Best match so far: ${best} round${best === 1 ? '' : 's'} won`;
} catch (e) { /* storage unavailable */ }
// FPS counter: hidden by default on every device; shown only on desktop
// with ?fps=1 in the URL. (Touch devices never show it — see style.css.)
if (S.isTouch || new URLSearchParams(location.search).get('fps') !== '1') {
  $('fpsText').classList.add('hidden');
}
// Rotate hint is a gentle nudge, not permanent UI — fade it after 6 s.
setTimeout(() => { const rh = $('rotateHint'); if (rh) rh.classList.add('fade-out'); }, 6000);

updateHUD();
animate();

// Debug handle (harmless in production; used by automated smoke tests)
window.__site7 = { S, WEAPONS, CFG, startRound, endRound, damageBot, damagePlayer, spawnBots };

