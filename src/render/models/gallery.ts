import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { BUILDABLES } from '../../config/buildables';
import { WORLD } from '../../config/world';
import type { MachineStatus } from '../../sim/types';
import { paletteMaterial } from '../palette';
import type { ItemModelKind, ModelInstance, ModelKind, ToolViewKind, ToolViewModel } from './api';
import { createItemGeometry, createModel, createToolViewModel } from './index';

/**
 * Dev gallery: every model in a labelled grid with animated anim fields and cycling statuses, a row of
 * belt items and a row of tool viewmodels. Orbit with the mouse.
 *   ?only=hopper,silo      show only matching labels (substring match)
 *   ?t=3.5                 freeze the clock at t seconds (deterministic screenshots)
 *   ?fp=detector           first-person viewmodel preview for one tool
 *   window.__gallery.focus(label[, distanceScale]) frames one entry.
 */

type AnimFn = (t: number) => Record<string, number>;

interface Entry {
  label: string;
  sub?: string;
  kind: ModelKind | 'item' | 'tool';
  variant?: string;
  anim?: AnimFn;
  item?: ItemModelKind;
  tool?: ToolViewKind;
  /** Base elevation (platform sits on the elevated level). */
  y?: number;
  row: number;
}

const STATUSES: MachineStatus[] = ['running', 'processing', 'idle', 'noInput', 'noHay', 'outputBlocked', 'full', 'noPower', 'lowPower', 'noFuel', 'disabled', 'needleAlarm'];
const pulse = (t: number, period: number): number => Math.max(0, 1 - ((t / period) % 1) * 3);
const wave = (t: number, f: number, ph = 0): number => 0.5 + 0.5 * Math.sin(t * f + ph);

function rakeAnim(ind: number): AnimFn {
  return (t) => {
    const ph = (t / 2.4) % 1;
    const ext = ph < 0.4 ? ph / 0.4 : ph < 0.8 ? 1 - (ph - 0.4) / 0.4 : 0;
    return { phase: ph, ext, reach: 4.5 + 2 * wave(t, 0.3), width: 1.5 + 1.2 * wave(t, 0.21), tray: wave(t, 0.4), industrial: ind };
  };
}
function armAnim(mk2: number): AnimFn {
  return (t) => {
    const c = (t / 3) % 1;
    const grip = c > 0.3 && c < 0.8 ? 1 : 0;
    return { yaw: Math.sin(t * 0.7) * 2.4, dist: 2.2 + 1.6 * wave(t, 0.9), height: 0.3 + 1.2 * wave(t, 1.3), grip, load: grip, mk2 };
  };
}
function vacAnim(ind: number): AnimFn {
  return (t) => ({ spin: t * 18, nozzleYaw: Math.sin(t * 0.5) * 0.9, nozzleDist: 3 + 2 * wave(t, 0.7), suck: wave(t, 0.8) > 0.2 ? 1 : 0.3, fill: wave(t, 0.3), industrial: ind });
}
function scanAnim(extra: Record<string, number>): AnimFn {
  return (t) => ({ scan: (t * 1.1) % 1, active: 1, alarm: t % 14 > 10 ? 1 : 0, needles: Math.floor(t / 2.5) % 7, fill: wave(t, 0.5), ...extra });
}

const ENTRIES: Entry[] = [
  // row 0 — factory & extraction
  { label: 'sellStation', sub: 'Market Chute', kind: 'sellStation', anim: (t) => ({ pulse: pulse(t, 1.3) }), row: 0 },
  { label: 'hopper', kind: 'hopper', anim: (t) => ({ fill: wave(t, 0.6), out: Math.sin(t) > 0 ? 1 : 0 }), row: 0 },
  { label: 'pistonRake', kind: 'pistonRake', anim: rakeAnim(0), row: 0 },
  { label: 'pistonRake industrial', kind: 'pistonRake', anim: rakeAnim(1), row: 0 },
  { label: 'roboticArm', kind: 'roboticArm', anim: armAnim(0), row: 0 },
  { label: 'roboticArm mk2', kind: 'roboticArm', anim: armAnim(1), row: 0 },
  { label: 'vacuumCollector', kind: 'vacuumCollector', anim: vacAnim(0), row: 0 },
  { label: 'vacuumCollector industrial', kind: 'vacuumCollector', anim: vacAnim(1), row: 0 },
  // row 1 — logistics
  { label: 'conveyor', kind: 'conveyor', anim: () => ({ curve: 0 }), row: 1 },
  { label: 'conveyor curveL', kind: 'conveyor', anim: () => ({ curve: -1 }), row: 1 },
  { label: 'conveyor curveR', kind: 'conveyor', anim: () => ({ curve: 1 }), row: 1 },
  { label: 'conveyorRamp up', kind: 'conveyorRamp', variant: 'up', row: 1 },
  { label: 'conveyorRamp down', kind: 'conveyorRamp', variant: 'down', row: 1 },
  { label: 'splitter', kind: 'splitter', anim: (t) => ({ mode: Math.floor(t / 2) % 5, filter: Math.floor(t / 10) % 3, flash: pulse(t, 0.7) }), row: 1 },
  { label: 'merger', kind: 'merger', anim: (t) => ({ flash: pulse(t, 0.6) }), row: 1 },
  { label: 'uSplitter', kind: 'uSplitter', anim: (t) => ({ flash: pulse(t, 0.8) }), row: 1 },
  { label: 'uMerger', kind: 'uMerger', anim: (t) => ({ flash: pulse(t, 0.9) }), row: 1 },
  { label: 'beltLift up', kind: 'beltLift', variant: 'up', anim: (t) => ({ phase: wave(t, 1.1) }), row: 1 },
  { label: 'beltLift down', kind: 'beltLift', variant: 'down', anim: (t) => ({ phase: wave(t, 1.1, 2) }), row: 1 },
  // row 2 — detection, processing, storage
  { label: 'scannerMk1', kind: 'scannerMk1', anim: scanAnim({}), row: 2 },
  { label: 'scannerMk2', kind: 'scannerMk2', anim: scanAnim({ lanes: 1 }), row: 2 },
  { label: 'scannerMk2 dual', kind: 'scannerMk2', anim: scanAnim({ lanes: 2 }), row: 2 },
  { label: 'compressor', kind: 'compressor', anim: (t) => ({ press: 0.5 - 0.5 * Math.cos(t * 3), fill: wave(t, 0.4), chambers: 1 }), row: 2 },
  { label: 'compressor x2', kind: 'compressor', anim: (t) => ({ press: 0.5 - 0.5 * Math.cos(t * 3), fill: wave(t, 0.4), chambers: 2 }), row: 2 },
  { label: 'wrapper', kind: 'wrapper', anim: (t) => ({ spin: t * 5, wrap: (t * 0.35) % 1, premium: 0, hasBale: 1 }), row: 2 },
  { label: 'wrapper premium', kind: 'wrapper', anim: (t) => ({ spin: t * 5, wrap: (t * 0.35) % 1, premium: 1, hasBale: 1 }), row: 2 },
  { label: 'silo', kind: 'silo', anim: (t) => ({ fill: wave(t, 0.35) }), row: 2 },
  // row 3 — power & construction
  { label: 'hayGenerator', kind: 'hayGenerator', anim: (t) => ({ fire: 0.75 + 0.25 * Math.sin(t * 9), fuel: wave(t, 0.25), load: 0.8, industrial: 0 }), row: 3 },
  { label: 'hayGenerator industrial', kind: 'hayGenerator', anim: (t) => ({ fire: 0.75 + 0.25 * Math.sin(t * 9), fuel: wave(t, 0.25), load: 1, industrial: 1 }), row: 3 },
  { label: 'powerPole', kind: 'powerPole', row: 3 },
  { label: 'platform', kind: 'platform', y: WORLD.levelHeight, row: 3 },
  { label: 'stairs', kind: 'stairs', row: 3 },
  // row 4 — props
  { label: 'wheelbarrow', kind: 'wheelbarrow', anim: (t) => ({ fill: wave(t, 0.5), held: Math.floor(t / 4) % 2 }), row: 4 },
  { label: 'needle', kind: 'needle', row: 4 },
  { label: 'orderBoard', kind: 'orderBoard', row: 4, y: 1.2 },
  { label: 'needleCase', kind: 'needleCase', anim: (t) => ({ found: Math.floor(t / 1.5) % 7 }), row: 4, y: 1.2 },
  { label: 'truck', kind: 'truck', row: 4 },
  // row 5 — items & tools
  { label: 'item:hay', kind: 'item', item: 'item:hay', row: 5 },
  { label: 'item:bale', kind: 'item', item: 'item:bale', row: 5 },
  { label: 'item:wrapped', kind: 'item', item: 'item:wrapped', row: 5 },
  { label: 'item:wrappedPremium', kind: 'item', item: 'item:wrappedPremium', row: 5 },
  ...(['hands', 'shovel', 'bucket', 'pitchfork', 'vacuum', 'detector', 'wheelbarrow'] as ToolViewKind[]).map((k): Entry => ({ label: `tool:${k}`, kind: 'tool', tool: k, row: 5 })),
];

function toolState(t: number, kind: ToolViewKind) {
  const cyc = (t / 1.4) % 1;
  return {
    action: kind === 'detector' || kind === 'wheelbarrow' ? 0 : cyc < 0.6 ? cyc / 0.6 : 0,
    walking: wave(t, 0.4) > 0.5 ? 1 : 0,
    load: wave(t, 0.5),
    suck: kind === 'vacuum' ? (Math.sin(t) > -0.3 ? 1 : 0) : 0,
    detector: kind === 'detector' ? {
      strength: wave(t, 0.8), dirAngle: Math.sin(t * 0.6) * 2.5, distance: 1 + 5 * wave(t, 0.3), tooDeep: t % 10 > 7.5,
      directional: true, precise: t % 20 > 10,
    } : undefined,
  };
}

// ---------------------------------------------------------------------------------------------

const params = new URLSearchParams(location.search);
const only = params.get('only')?.split(',').map((s) => s.trim()).filter(Boolean);
const frozenT = params.has('t') ? Number(params.get('t')) : null;
const fpKind = params.get('fp') as ToolViewKind | null;

const container = document.getElementById('view')!;
const hud = document.getElementById('hud')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2520);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.5;

const camera = new THREE.PerspectiveCamera(fpKind ? 75 : 45, window.innerWidth / window.innerHeight, 0.08, 400);
scene.add(camera);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xfff1dc, 0x4a3f33, 1.1));
const sun = new THREE.DirectionalLight(0xfff0d6, 2.4);
sun.position.set(-30, 45, 25);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
const sc = sun.shadow.camera;
sc.left = -70; sc.right = 70; sc.top = 60; sc.bottom = -60; sc.near = 1; sc.far = 160;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun);
scene.add(sun.target);

// floor with 1 m grid (matches the build grid)
{
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#8d8a83'; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(40,36,30,0.35)'; g.lineWidth = 2; g.strokeRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(200, 200); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
}

interface Live { e: Entry; holder: THREE.Group; model?: ModelInstance; tool?: ToolViewModel; box: THREE.Box3; labelEl: HTMLDivElement; idx: number }
const lives: Live[] = [];

function footprintOf(e: Entry): [number, number] {
  if (e.kind === 'item') return [1.2, 1];
  if (e.kind === 'tool') return [1.4, 1.2];
  const def = (BUILDABLES as Record<string, { footprint: [number, number] } | undefined>)[e.kind];
  if (def) return def.footprint;
  if (e.kind === 'truck') return [7, 3];
  if (e.kind === 'orderBoard' || e.kind === 'needleCase') return [1, 2.4];
  return [1.6, 1.2];
}

function build(): void {
  const rows = new Map<number, Entry[]>();
  for (const e of ENTRIES) {
    if (only && !only.some((o) => e.label.includes(o))) continue;
    if (!rows.has(e.row)) rows.set(e.row, []);
    rows.get(e.row)!.push(e);
  }
  let z = 0;
  let idx = 0;
  for (const [, list] of [...rows.entries()].sort((a, b) => a[0] - b[0])) {
    let x = 0;
    let depth = 0;
    const placed: { e: Entry; x: number; w: number }[] = [];
    for (const e of list) {
      const [w, d] = footprintOf(e);
      placed.push({ e, x: x + w / 2, w });
      x += w + 2.8;
      depth = Math.max(depth, d);
    }
    const shift = -x / 2;
    for (const pl of placed) {
      const holder = new THREE.Group();
      holder.position.set(pl.x + shift, pl.e.y ?? 0, z + depth / 2);
      scene.add(holder);
      const live: Live = { e: pl.e, holder, box: new THREE.Box3(), labelEl: document.createElement('div'), idx: idx++ };
      if (pl.e.kind === 'item') {
        const mesh = new THREE.Mesh(createItemGeometry(pl.e.item!), paletteMaterial());
        mesh.castShadow = true; mesh.scale.setScalar(1.6);
        holder.add(mesh);
      } else if (pl.e.kind === 'tool') {
        const tool = createToolViewModel(pl.e.tool!);
        const cam = new THREE.Group();
        cam.position.set(0, 1.45, 0.9);
        cam.scale.setScalar(2.2);
        cam.add(tool.root);
        holder.add(cam);
        live.tool = tool;
      } else {
        const m = createModel(pl.e.kind, { variant: pl.e.variant });
        holder.add(m.root);
        m.root.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.name !== 'statusLamp') { o.castShadow = true; o.receiveShadow = true; } });
        live.model = m;
      }
      live.labelEl.className = 'label';
      live.labelEl.innerHTML = `${pl.e.label}${pl.e.sub ? `<small>${pl.e.sub}</small>` : ''}`;
      document.body.appendChild(live.labelEl);
      lives.push(live);
    }
    z += depth + 5;
  }
}

function step(t: number, dt: number): void {
  for (const l of lives) {
    if (l.model) {
      l.model.update(l.e.anim ? l.e.anim(t) : {}, dt, t);
      l.model.setStatus(STATUSES[(Math.floor(t / 1.6) + l.idx) % STATUSES.length]);
    } else if (l.tool) {
      l.tool.update(dt, t, toolState(t, l.e.tool!));
    }
  }
}

function refreshBoxes(): void {
  scene.updateMatrixWorld(true);
  for (const l of lives) l.box.setFromObject(l.holder, false);
}

const _v = new THREE.Vector3();
function placeLabels(): void {
  const w = window.innerWidth, h = window.innerHeight;
  for (const l of lives) {
    _v.set((l.box.min.x + l.box.max.x) / 2, l.box.max.y + 0.25, (l.box.min.z + l.box.max.z) / 2).project(camera);
    const vis = _v.z < 1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1 && !fpKind;
    l.labelEl.style.display = vis ? 'block' : 'none';
    if (vis) l.labelEl.style.left = `${(_v.x * 0.5 + 0.5) * w}px`, l.labelEl.style.top = `${(-_v.y * 0.5 + 0.5) * h}px`;
  }
}

function focus(label: string, distScale = 1): string {
  const l = lives.find((x) => x.e.label === label) ?? lives.find((x) => x.e.label.includes(label));
  if (!l) return `no entry ${label}`;
  l.box.setFromObject(l.holder, false);
  const c = l.box.getCenter(new THREE.Vector3());
  const s = l.box.getSize(new THREE.Vector3());
  const r = Math.max(1.2, s.length() * 0.5);
  const dist = (r / Math.sin((camera.fov * Math.PI) / 360)) * 0.95 * distScale;
  camera.position.set(c.x + dist * 0.62, c.y + dist * 0.42, c.z + dist * 0.66);
  controls.target.copy(c);
  controls.update();
  return `${l.e.label} size ${s.x.toFixed(2)}x${s.y.toFixed(2)}x${s.z.toFixed(2)}`;
}

function frameAll(): void {
  const all = new THREE.Box3();
  for (const l of lives) all.union(l.box);
  const c = all.getCenter(new THREE.Vector3());
  const s = all.getSize(new THREE.Vector3());
  camera.position.set(c.x, c.y + s.z * 0.75 + 8, c.z + s.z * 0.55 + s.x * 0.45);
  controls.target.copy(c);
  controls.update();
}

// first-person viewmodel preview
let fpTool: ToolViewModel | null = null;
function setupFirstPerson(kind: ToolViewKind): void {
  for (const l of lives) { l.holder.visible = false; l.labelEl.style.display = 'none'; }
  fpTool = createToolViewModel(kind);
  camera.add(fpTool.root);
  camera.position.set(0, 1.62, 4);
  controls.target.set(0, 1.2, 0);
  controls.update();
  const pile = new THREE.Mesh(new THREE.SphereGeometry(3, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe2b857, roughness: 1 }));
  pile.scale.y = 0.6;
  pile.position.set(0, 0, -2);
  pile.receiveShadow = true;
  scene.add(pile);
}

build();
refreshBoxes();
if (fpKind) setupFirstPerson(fpKind);
else frameAll();

let last = performance.now() / 1000;
let clock = frozenT ?? 0;
function loop(): void {
  const now = performance.now() / 1000;
  const dt = Math.min(0.05, now - last);
  last = now;
  if (frozenT === null) clock += dt;
  step(clock, frozenT === null ? dt : 0.016);
  if (fpTool && fpKind) fpTool.update(dt, clock, toolState(clock, fpKind));
  controls.update();
  placeLabels();
  renderer.render(scene, camera);
  const info = renderer.info.render;
  hud.textContent = `${lives.length} entries · ${info.calls} draw calls · ${(info.triangles / 1000).toFixed(0)}k tris · t=${clock.toFixed(1)}`;
  requestAnimationFrame(loop);
}
loop();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

declare global { interface Window { __gallery: unknown } }
window.__gallery = {
  focus,
  frameAll,
  list: () => lives.map((l) => l.e.label),
  /** Draw calls per entry (static count of meshes that are visible). */
  meshes: (label: string) => {
    const l = lives.find((x) => x.e.label === label);
    let n = 0;
    l?.holder.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.visible) n++; });
    return n;
  },
  setTime: (t: number) => { clock = t; step(t, 0.016); },
  view: (x: number, y: number, z: number, tx: number, ty: number, tz: number) => { camera.position.set(x, y, z); controls.target.set(tx, ty, tz); controls.update(); },
};

