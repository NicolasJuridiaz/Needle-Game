import * as THREE from 'three';
import { Rng } from '../core/rng';
import { WORLD } from '../config/world';
import { DOOR, FLOOR_RECT, ORDER_BOARD_PX, createFloorTexture, createSignAtlas, drawOrderBoard, signAspect, signUV, type SignName } from './envTextures';
import { GeometryBuilder, boxProjectUVs, createNeedleGeometry, shadeVertexColors } from './geometry';
import { COLORS, glassMaterial, paletteMaterial } from './palette';
import { qualityProfile, type Quality } from './quality';
import { CONCRETE_DETAIL_METRES, CORRUGATED_METRES, concreteDetailTexture, corrugatedTextures, createCanvas, canvasTexture, plywoodTexture } from './textures';

type V3 = [number, number, number];

const I = WORLD.interior;
const A = WORLD.annex;
const EAVE = WORLD.wallHeight;
const PEAK = WORLD.roofPeak;
const HALL_CZ = (I.minZ + I.maxZ) / 2;
const HALL_HALF = (I.maxZ - I.minZ) / 2;
/** Annex lean-to roof: height at the hall junction and at its far wall. */
const ANNEX_HIGH = 9.5;
const ANNEX_LOW = 8;
/** Clear height of the hall → annex opening (under the header beam). */
const ANNEX_OPENING = 9;
/** Truss x positions (every 8 m). */
const TRUSS_X = [-24, -16, -8, 0, 8, 16, 24];
/** Pendant lamp fixtures (x, z); the first `lamps` (by quality) also carry a real point light. */
const LAMPS: readonly [number, number][] = [[-8, 11], [8, -11], [-24, -11], [24, 11], [-8, -11], [8, 11], [-24, 11], [24, -11]];
const LAMP_Y = 8.3;
/** Direction TOWARDS the sun (west, high, a little south). */
const SUN_DIR = new THREE.Vector3(-0.64, 0.72, 0.27).normalize();

const COL = {
  wall: 0xb4b9b6, roof: 0xc6c1b4, steel: 0x8f3f2e, galv: 0x98a0a3, concrete: 0x8b867c, timber: 0x7a4f2c,
  plywood: 0xffffff, tarp: 0x2f6fb5, dark: 0x2a2a2a, walnut: 0x4a2f1c, velvet: 0x5a1f22, brass: 0xc9a24a,
  truckRed: 0xb8352b, truckWhite: 0xeeeae0, rubber: 0x1d1d1d, glassDark: 0x2c3e4c, headlight: 0xfff2c0,
  bale: 0xd9ad4f, grass: 0x86a04f, stubble: 0xc9a95a, gravel: 0x9c9282, dirt: 0x8d7556, enamel: 0x35604c,
} as const;

function roofY(z: number): number {
  return EAVE + (PEAK - EAVE) * (1 - Math.min(1, Math.abs(z - HALL_CZ) / HALL_HALF));
}
function annexRoofY(z: number): number {
  return ANNEX_HIGH + (ANNEX_LOW - ANNEX_HIGH) * ((z - A.minZ) / (A.maxZ - A.minZ));
}

// ------------------------------------------------------------------------------------------------
// Quad soup: explicit-quad geometry accumulator (walls, roofs, panels) — construction time only.
// ------------------------------------------------------------------------------------------------

const _va = new THREE.Vector3();
const _vb = new THREE.Vector3();
const _vn = new THREE.Vector3();

class QuadSoup {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private uv: number[] = [];

  get empty(): boolean { return this.pos.length === 0; }

  /** Quad a-b-c-d; winding is flipped if needed so the face looks along `facing`. */
  quad(a: V3, b: V3, c: V3, d: V3, facing: V3, color: THREE.Color, uv?: readonly number[], colorTop?: THREE.Color): void {
    _va.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    _vb.set(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
    _vn.crossVectors(_va, _vb);
    if (_vn.lengthSq() < 1e-12) return;
    _vn.normalize();
    let p = [a, b, c, d];
    let t = uv ?? [0, 0, 1, 0, 1, 1, 0, 1];
    let cols = [color, color, colorTop ?? color, colorTop ?? color];
    if (_vn.x * facing[0] + _vn.y * facing[1] + _vn.z * facing[2] < 0) {
      p = [a, d, c, b];
      t = [t[0], t[1], t[6], t[7], t[4], t[5], t[2], t[3]];
      cols = [cols[0], cols[3], cols[2], cols[1]];
      _vn.negate();
    }
    for (const k of [0, 1, 2, 0, 2, 3]) {
      this.pos.push(p[k][0], p[k][1], p[k][2]);
      this.nor.push(_vn.x, _vn.y, _vn.z);
      this.col.push(cols[k].r, cols[k].g, cols[k].b);
      this.uv.push(t[k * 2], t[k * 2 + 1]);
    }
  }

  build(projectUVMetres?: number): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (projectUVMetres) boxProjectUVs(g, projectUVMetres);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    this.pos = []; this.nor = []; this.col = []; this.uv = [];
    return g;
  }
}

interface Hole { u0: number; u1: number; v0: number; v1: number }
interface WallFrame { o: V3; u: V3; n: V3 }

function sortedBreaks(values: number[], lo: number, hi: number): number[] {
  const out = values.filter((v) => v >= lo - 1e-6 && v <= hi + 1e-6).map((v) => Math.min(hi, Math.max(lo, v)));
  out.sort((a, b) => a - b);
  return out.filter((v, i) => i === 0 || v - out[i - 1] > 1e-4);
}

/** Corrugated wall panels in 2 m columns, with vertical bands (grime gradient) and rectangular holes. */
function wallPanels(s: QuadSoup, f: WallFrame, u0: number, u1: number, top: (u: number) => number, holes: Hole[], base: number, rng: Rng, extra: number[] = []): void {
  const ub: number[] = [u0, u1, ...extra];
  for (let u = Math.ceil(u0 / 2) * 2; u < u1; u += 2) ub.push(u);
  for (const h of holes) ub.push(h.u0, h.u1);
  const us = sortedBreaks(ub, u0, u1);
  const vb = [0, 1.1, 3.5, ...holes.flatMap((h) => [h.v0, h.v1])];
  const vs = sortedBreaks(vb, 0, 100);
  const baseCol = new THREE.Color(base);
  const P = (u: number, v: number): V3 => [f.o[0] + f.u[0] * u, f.o[1] + v, f.o[2] + f.u[2] * u];
  for (let i = 0; i < us.length - 1; i++) {
    const ua = us[i], ubb = us[i + 1];
    const ta = top(ua), tb = top(ubb);
    const tint = baseCol.clone().multiplyScalar(0.93 + rng.next() * 0.1);
    for (let j = 0; j < vs.length; j++) {
      const va = vs[j];
      const vtop = j + 1 < vs.length ? vs[j + 1] : Infinity;
      if (va >= Math.max(ta, tb) - 1e-4) break;
      const inHole = holes.some((h) => ua >= h.u0 - 1e-4 && ubb <= h.u1 + 1e-4 && va >= h.v0 - 1e-4 && Math.min(vtop, Math.max(ta, tb)) <= h.v1 + 1e-4);
      if (inHole) continue;
      const ya = Math.min(vtop, ta), yb = Math.min(vtop, tb);
      s.quad(P(ua, va), P(ubb, va), P(ubb, yb), P(ua, ya), f.n, tint);
    }
  }
}

interface Rect { x0: number; x1: number; z0: number; z1: number }

/** Roof sheets over an x/z range (y from `yAt`), leaving skylight holes; faces point down. */
function roofPanels(s: QuadSoup, x0: number, x1: number, z0: number, z1: number, yAt: (z: number) => number, holes: Rect[], base: number, rng: Rng, zExtra: number[]): void {
  const xb: number[] = [x0, x1];
  for (let x = Math.ceil(x0 / 2) * 2; x < x1; x += 2) xb.push(x);
  const zb: number[] = [z0, z1, ...zExtra];
  for (const h of holes) { xb.push(h.x0, h.x1); zb.push(h.z0, h.z1); }
  const xs = sortedBreaks(xb, x0, x1), zs = sortedBreaks(zb, z0, z1);
  const baseCol = new THREE.Color(base);
  for (let i = 0; i < xs.length - 1; i++) {
    const tint = baseCol.clone().multiplyScalar(0.94 + rng.next() * 0.08);
    for (let j = 0; j < zs.length - 1; j++) {
      const xa = xs[i], xbb = xs[i + 1], za = zs[j], zbb = zs[j + 1];
      const cx = (xa + xbb) / 2, cz = (za + zbb) / 2;
      if (holes.some((h) => cx > h.x0 && cx < h.x1 && cz > h.z0 && cz < h.z1)) continue;
      s.quad([xa, yAt(za), za], [xbb, yAt(za), za], [xbb, yAt(zbb), zbb], [xa, yAt(zbb), zbb], [0, -1, 0], tint);
    }
  }
}

// ------------------------------------------------------------------------------------------------
// Shaders
// ------------------------------------------------------------------------------------------------

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAG = /* glsl */`
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
varying vec3 vDir;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.5));
  col = mix(col, uGround, smoothstep(0.0, -0.06, h));
  // Soft fair-weather clouds in a band above the horizon.
  vec2 cp = d.xz / max(0.12, h + 0.08) * 1.6;
  float c = noise(cp) * 0.6 + noise(cp * 2.3 + 7.0) * 0.3 + noise(cp * 5.1 + 3.0) * 0.1;
  float band = smoothstep(0.02, 0.12, h) * (1.0 - smoothstep(0.35, 0.7, h));
  col = mix(col, vec3(1.0, 0.99, 0.96), smoothstep(0.55, 0.78, c) * band * 0.85);
  float s = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(s, 900.0) * 8.0 + pow(s, 24.0) * 0.25 + pow(s, 4.0) * 0.06);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const SHAFT_VERT = /* glsl */`
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormalW;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const SHAFT_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uTime;
uniform float uIntensity;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormalW;
void main() {
  vec3 v = normalize(cameraPosition - vWorld);
  float facing = abs(dot(normalize(vNormalW), v));
  float across = pow(sin(3.14159 * clamp(vUv.x, 0.0, 1.0)), 1.4);
  float along = smoothstep(0.0, 0.18, vUv.y) * (1.0 - smoothstep(0.45, 1.0, vUv.y));
  float streak = 0.75 + 0.25 * sin(vWorld.x * 1.3 + vWorld.z * 0.9 + uTime * 0.25) * sin(vWorld.x * 0.37 - vWorld.z * 0.53 - uTime * 0.17);
  float near = smoothstep(0.8, 4.0, distance(cameraPosition, vWorld));
  float a = across * along * streak * near * facing * uIntensity;
  gl_FragColor = vec4(uColor * a, 1.0);
}`;

const MOTE_VERT = /* glsl */`
attribute float aPhase;
uniform float uTime;
uniform float uPixels;
varying float vAlpha;
void main() {
  vec3 p = position;
  float t = uTime;
  p.x += sin(t * 0.11 + aPhase * 6.283) * 0.5;
  p.y += sin(t * 0.07 + aPhase * 12.0) * 0.7;
  p.z += cos(t * 0.09 + aPhase * 9.0) * 0.5;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(0.03 * uPixels / max(0.2, -mv.z), 1.0, 7.0);
  vAlpha = (0.45 + 0.55 * sin(t * 0.8 + aPhase * 40.0)) * smoothstep(0.6, 3.0, -mv.z);
}`;

const MOTE_FRAG = /* glsl */`
uniform vec3 uColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.05, d) * vAlpha;
  gl_FragColor = vec4(uColor * a, 1.0);
}`;

const GRID_VERT = /* glsl */`
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const GRID_FRAG = /* glsl */`
uniform vec3 uColor;
uniform vec3 uAccent;
uniform float uMaxZ;
uniform float uOpacity;
varying vec3 vWorld;
void main() {
  if (vWorld.z > uMaxZ) discard;
  vec2 p = vWorld.xz;
  vec2 f = fract(p);
  vec2 d = min(f, 1.0 - f);
  vec2 w = fwidth(p);
  vec2 l = 1.0 - smoothstep(w * 0.6, w * 1.6 + 0.018, d);
  float line = max(l.x, l.y);
  vec2 f8 = fract(p / 8.0);
  vec2 d8 = min(f8, 1.0 - f8) * 8.0;
  vec2 l8 = 1.0 - smoothstep(w * 0.8, w * 2.0 + 0.04, d8);
  float major = max(l8.x, l8.y);
  float dist = distance(cameraPosition.xz, p);
  float fade = 1.0 - smoothstep(8.0, 26.0, dist);
  vec3 col = mix(uColor, uAccent, major);
  float a = (max(line * 0.55, major * 0.8) + 0.05) * fade * uOpacity;
  if (a < 0.003) discard;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

// ------------------------------------------------------------------------------------------------

interface Disposable { dispose(): void }

/**
 * The warehouse world: hall + annex shell, trusses, skylights with light shafts, the sunny exterior seen
 * through the west loading door (sky, hills, fields, a parked truck), wall props (order board, needle
 * trophy case, signage), lighting (hemisphere + shadowed sun + warm lamps) and build-mode overlays.
 */
export class Environment {
  private readonly scene: THREE.Scene;
  private quality: Quality;
  private readonly root = new THREE.Group();
  private readonly owned: Disposable[] = [];

  private readonly sun: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private readonly lampLights: THREE.PointLight[] = [];

  private readonly tempWall = new THREE.Group();
  private annexOpen = false;
  private readonly annexLight: THREE.PointLight;

  private readonly grid: THREE.Mesh;
  private readonly gridMat: THREE.ShaderMaterial;
  private highlight: THREE.InstancedMesh | null = null;
  private readonly highlightMat: THREE.MeshBasicMaterial;
  private readonly highlightGeo: THREE.PlaneGeometry;

  private readonly shafts: THREE.Mesh;
  private readonly shaftMat: THREE.ShaderMaterial;
  private readonly motes: THREE.Points;
  private readonly moteMat: THREE.ShaderMaterial;
  private readonly moteCapacity: number;
  private floorTex: THREE.CanvasTexture;
  private floorMat!: THREE.MeshStandardMaterial;

  private readonly boardCanvas: HTMLCanvasElement;
  private readonly boardTex: THREE.CanvasTexture;
  private boardKey = '\u0000';

  private readonly slotGlow: THREE.InstancedMesh;
  private readonly slotNeedles: THREE.InstancedMesh;
  private needleSlots = -1;

  private readonly clockStart = typeof performance !== 'undefined' ? performance.now() : 0;
  private readonly drawSize = new THREE.Vector2();

  constructor(scene: THREE.Scene, quality: Quality) {
    this.scene = scene;
    this.quality = quality;
    const prof = qualityProfile(quality);
    this.root.name = 'environment';
    scene.add(this.root);
    scene.background = new THREE.Color(0x9fb8cc);

    // ----- lights
    this.hemi = new THREE.HemisphereLight(0xd6e0ea, 0x7a6547, 1.25);
    this.root.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0d6, 3.4);
    this.setupSun();
    for (let i = 0; i < 4; i++) {
      const [x, z] = LAMPS[i];
      const l = new THREE.PointLight(0xffc88a, 140, 30, 2);
      l.position.set(x, LAMP_Y - 0.35, z);
      this.lampLights.push(l);
      this.root.add(l);
    }
    this.annexLight = new THREE.PointLight(0xffd29a, 90, 26, 2);
    this.annexLight.position.set(0, ANNEX_LOW - 0.8, (A.minZ + A.maxZ) / 2);
    this.root.add(this.annexLight);

    // ----- geometry
    const rng = new Rng(0xe7e);
    this.floorTex = createFloorTexture(prof.floorTexture, prof.anisotropy);
    this.own(this.floorTex);
    this.buildFloor();
    const skylights = this.skylightRects();
    this.buildShell(rng, skylights);
    const signs = createSignAtlas();
    this.own(signs);
    // One atlas for wall signs and the needle-case plaques (it used to be generated and uploaded twice).
    this.signAtlasTex = signs;
    const signMat = new THREE.MeshStandardMaterial({ map: signs, roughness: 0.75, metalness: 0, transparent: true, alphaTest: 0.05 });
    this.own(signMat);
    this.buildStructureAndProps(rng, skylights, signMat);
    this.buildExterior(rng);
    this.buildTempWall(rng, signMat);

    // ----- order board + needle case (dynamic parts)
    this.boardCanvas = createCanvas(ORDER_BOARD_PX.w, ORDER_BOARD_PX.h);
    this.boardTex = canvasTexture(this.boardCanvas, { anisotropy: 4 });
    this.own(this.boardTex);
    this.buildOrderBoard();
    const caseParts = this.buildNeedleCase();
    this.slotGlow = caseParts.glow;
    this.slotNeedles = caseParts.needles;

    // ----- light shafts + dust motes
    this.shaftMat = new THREE.ShaderMaterial({
      vertexShader: SHAFT_VERT, fragmentShader: SHAFT_FRAG,
      uniforms: { uColor: { value: new THREE.Color(0xffe2b0) }, uTime: { value: 0 }, uIntensity: { value: 0.085 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.own(this.shaftMat);
    this.shafts = new THREE.Mesh(this.own(this.shaftGeometry(skylights)), this.shaftMat);
    this.shafts.name = 'lightShafts';
    this.shafts.renderOrder = 5;
    this.shafts.onBeforeRender = () => { this.shaftMat.uniforms.uTime.value = this.time(); };
    this.root.add(this.shafts);

    this.moteCapacity = 700;
    this.moteMat = new THREE.ShaderMaterial({
      vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG,
      uniforms: { uColor: { value: new THREE.Color(0xffe9c0).multiplyScalar(0.55) }, uTime: { value: 0 }, uPixels: { value: 800 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.own(this.moteMat);
    this.motes = new THREE.Points(this.own(this.moteGeometry(skylights, this.moteCapacity, rng)), this.moteMat);
    this.motes.name = 'dustMotes';
    this.motes.frustumCulled = false;
    this.motes.renderOrder = 6;
    this.motes.onBeforeRender = (renderer, _s, camera) => {
      renderer.getDrawingBufferSize(this.drawSize);
      const proj = (camera as THREE.PerspectiveCamera).projectionMatrix.elements[5];
      this.moteMat.uniforms.uPixels.value = this.drawSize.y * 0.5 * proj;
      this.moteMat.uniforms.uTime.value = this.time();
    };
    this.root.add(this.motes);

    // ----- build overlays
    this.gridMat = new THREE.ShaderMaterial({
      vertexShader: GRID_VERT, fragmentShader: GRID_FRAG,
      uniforms: {
        uColor: { value: new THREE.Color(0xeaf6ff) }, uAccent: { value: new THREE.Color(0xffd45a) },
        uMaxZ: { value: I.maxZ }, uOpacity: { value: 0.8 },
      },
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.own(this.gridMat);
    const gridGeo = this.own(new THREE.PlaneGeometry(FLOOR_RECT.maxX - FLOOR_RECT.minX, FLOOR_RECT.maxZ - FLOOR_RECT.minZ).rotateX(-Math.PI / 2));
    this.grid = new THREE.Mesh(gridGeo, this.gridMat);
    this.grid.position.set((FLOOR_RECT.minX + FLOOR_RECT.maxX) / 2, 0.012, (FLOOR_RECT.minZ + FLOOR_RECT.maxZ) / 2);
    this.grid.renderOrder = 2;
    this.grid.visible = false;
    this.grid.name = 'buildGrid';
    this.root.add(this.grid);
    this.highlightGeo = this.own(new THREE.PlaneGeometry(0.94, 0.94).rotateX(-Math.PI / 2));
    this.highlightMat = new THREE.MeshBasicMaterial({ color: 0x5ce27a, transparent: true, opacity: 0.38, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    this.own(this.highlightMat);

    this.setOrderBoard([]);
    this.setNeedleSlots(0);
    this.setAnnexOpen(false);
    this.applyQuality(prof);
  }

  // =====================================================================================
  // Public API
  // =====================================================================================

  setGridVisible(on: boolean): void {
    this.grid.visible = on;
  }

  /** Tint build cells (world cells at a level). Pass an empty array to clear. */
  highlightCells(cells: readonly { x: number; z: number; level: number }[], color: number): void {
    const n = cells.length;
    if (n === 0) { if (this.highlight) this.highlight.visible = false; return; }
    if (!this.highlight || this.highlight.instanceMatrix.count < n) {
      if (this.highlight) { this.highlight.removeFromParent(); this.highlight.dispose(); }
      let cap = 16;
      while (cap < n) cap *= 2;
      this.highlight = new THREE.InstancedMesh(this.highlightGeo, this.highlightMat, cap);
      this.highlight.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.highlight.frustumCulled = false;
      this.highlight.renderOrder = 3;
      this.root.add(this.highlight);
    }
    const m = this.highlight.instanceMatrix.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const c = cells[i];
      const o = i * 16;
      m[o] = 1; m[o + 1] = 0; m[o + 2] = 0; m[o + 3] = 0;
      m[o + 4] = 0; m[o + 5] = 1; m[o + 6] = 0; m[o + 7] = 0;
      m[o + 8] = 0; m[o + 9] = 0; m[o + 10] = 1; m[o + 11] = 0;
      m[o + 12] = c.x + 0.5; m[o + 13] = c.level * WORLD.levelHeight + 0.02; m[o + 14] = c.z + 0.5; m[o + 15] = 1;
    }
    this.highlight.count = n;
    this.highlight.instanceMatrix.clearUpdateRanges();
    this.highlight.instanceMatrix.addUpdateRange(0, n * 16);
    this.highlight.instanceMatrix.needsUpdate = true;
    this.highlightMat.color.setHex(color);
    this.highlight.visible = true;
  }

  setAnnexOpen(open: boolean): void {
    this.annexOpen = open;
    this.tempWall.visible = !open;
    this.annexLight.visible = open;
    this.gridMat.uniforms.uMaxZ.value = open ? A.maxZ : I.maxZ;
  }

  /** Light the first `found` trophy slots (a silver needle appears in each). */
  setNeedleSlots(found: number): void {
    const n = Math.max(0, Math.min(6, Math.floor(found)));
    if (n === this.needleSlots) return;
    this.needleSlots = n;
    const lit = new THREE.Color(1.0, 0.8, 0.42);
    const dark = new THREE.Color(0.1, 0.035, 0.04);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 6; i++) {
      this.slotGlow.setColorAt(i, i < n ? lit : dark);
      this.slotNeedles.getMatrixAt(i, m);
      const base = this.caseNeedleMatrices[i];
      this.slotNeedles.setMatrixAt(i, i < n ? base : ZERO_MATRIX);
    }
    this.slotGlow.instanceColor!.needsUpdate = true;
    this.slotNeedles.instanceMatrix.needsUpdate = true;
    this.slotNeedles.visible = n > 0;
  }

  /** Redraws the order board when the lines change. */
  setOrderBoard(lines: readonly string[]): void {
    const key = lines.join('\n');
    if (key === this.boardKey) return;
    this.boardKey = key;
    drawOrderBoard(this.boardCanvas, lines);
    this.boardTex.needsUpdate = true;
  }

  setQuality(q: Quality): void {
    if (q === this.quality) return;
    this.quality = q;
    this.applyQuality(qualityProfile(q));
  }

  dispose(): void {
    this.root.removeFromParent();
    this.sun.shadow.dispose();
    if (this.highlight) this.highlight.dispose();
    for (const d of this.owned) d.dispose();
    this.owned.length = 0;
    if (this.scene.background instanceof THREE.Color) this.scene.background = null;
  }

  // =====================================================================================
  // Construction
  // =====================================================================================

  private readonly caseNeedleMatrices: THREE.Matrix4[] = [];

  private own<T extends Disposable>(d: T): T {
    this.owned.push(d);
    return d;
  }

  private time(): number {
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    return (now - this.clockStart) / 1000;
  }

  /** Everything here applies live (settings panel), including the floor texture resolution. */
  private applyQuality(prof: ReturnType<typeof qualityProfile>): void {
    const sh = this.sun.shadow;
    this.sun.castShadow = prof.shadows;
    if (sh.mapSize.x !== prof.shadowMapSize || (!prof.shadows && sh.map)) {
      // A new size needs a new map; with shadows off the depth texture is just wasted memory.
      sh.mapSize.set(prof.shadowMapSize, prof.shadowMapSize);
      if (sh.map) { sh.map.dispose(); sh.map = null; }
    }
    sh.radius = prof.shadowRadius;
    // Without shadows the roof cannot block the sun: tone it down and lift the sky fill instead.
    this.sun.intensity = prof.shadows ? 3.4 : 1.25;
    this.hemi.intensity = prof.shadows ? 1.25 : 1.7;
    for (let i = 0; i < this.lampLights.length; i++) this.lampLights[i].visible = i < prof.lamps;
    this.shafts.visible = prof.lightShafts;
    const motes = Math.min(this.moteCapacity, prof.motes);
    this.motes.geometry.setDrawRange(0, motes);
    this.motes.visible = motes > 0;
    if ((this.floorTex.image as { width?: number } | undefined)?.width !== prof.floorTexture) {
      const old = this.floorTex;
      this.floorTex = createFloorTexture(prof.floorTexture, prof.anisotropy);
      this.floorMat.map = this.floorTex;
      const i = this.owned.indexOf(old);
      if (i >= 0) this.owned[i] = this.floorTex; else this.own(this.floorTex);
      old.dispose();
    } else if (this.floorTex.anisotropy !== prof.anisotropy) {
      this.floorTex.anisotropy = prof.anisotropy;
      this.floorTex.needsUpdate = true;
    }
  }

  private setupSun(): void {
    const sun = this.sun;
    const target = new THREE.Vector3(-4, 0, 6);
    sun.position.copy(target).addScaledVector(SUN_DIR, 90);
    sun.target.position.copy(target);
    this.root.add(sun);
    this.root.add(sun.target);
    const sh = sun.shadow;
    sh.bias = -0.0004;
    sh.normalBias = 0.045;
    // Fit the orthographic shadow frustum around the whole building + yard in light space.
    const cam = sh.camera;
    cam.position.copy(sun.position);
    cam.lookAt(target);
    cam.updateMatrixWorld(true);
    const inv = cam.matrixWorldInverse;
    const lo = new THREE.Vector3(Infinity, Infinity, Infinity), hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    const p = new THREE.Vector3();
    for (const x of [-48, 34]) for (const y of [-1, PEAK + 1]) for (const z of [I.minZ - 2, A.maxZ + 2]) {
      p.set(x, y, z).applyMatrix4(inv);
      lo.min(p); hi.max(p);
    }
    cam.left = lo.x; cam.right = hi.x; cam.bottom = lo.y; cam.top = hi.y;
    cam.near = Math.max(0.5, -hi.z - 2);
    cam.far = -lo.z + 2;
    cam.updateProjectionMatrix();
  }

  private skylightRects(): Rect[] {
    const out: Rect[] = [];
    const segs: [number, number][] = [];
    const xs = [I.minX, ...TRUSS_X, I.maxX];
    for (let i = 0; i < xs.length - 1; i++) segs.push([xs[i] + 1.1, xs[i + 1] - 1.1]);
    for (const [x0, x1] of segs) {
      out.push({ x0, x1, z0: HALL_CZ - 1.6, z1: HALL_CZ + 1.6 });
      out.push({ x0, x1, z0: HALL_CZ - 12.4, z1: HALL_CZ - 9.6 });
      out.push({ x0, x1, z0: HALL_CZ + 9.6, z1: HALL_CZ + 12.4 });
    }
    return out;
  }

  private buildFloor(): void {
    const detail = concreteDetailTexture();
    const mat = new THREE.MeshStandardMaterial({ map: this.floorTex, roughness: 0.84, metalness: 0.0, envMapIntensity: 0.55 });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uDetail = { value: detail };
      shader.uniforms.uDetailScale = { value: 1 / CONCRETE_DETAIL_METRES };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vFloorXZ;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFloorXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uDetail;\nuniform float uDetailScale;\nvarying vec2 vFloorXZ;')
        .replace('#include <map_fragment>', `#include <map_fragment>
  float detA = texture2D(uDetail, vFloorXZ * uDetailScale).r;
  float detB = texture2D(uDetail, vFloorXZ * uDetailScale * 0.173 + vec2(0.37, 0.61)).r;
  float det = mix(detA, detB, 0.35);
  diffuseColor.rgb *= det * 2.0;`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = clamp(roughnessFactor * (0.78 + 0.45 * det), 0.0, 1.0);');
    };
    mat.customProgramCacheKey = () => 'pn-floor-v1';
    this.own(mat);
    this.floorMat = mat;
    const R = FLOOR_RECT;
    const geo = this.own(new THREE.PlaneGeometry(R.maxX - R.minX, R.maxZ - R.minZ).rotateX(-Math.PI / 2));
    const floor = new THREE.Mesh(geo, mat);
    floor.position.set((R.minX + R.maxX) / 2, 0, (R.minZ + R.maxZ) / 2);
    floor.receiveShadow = true;
    floor.name = 'floor';
    this.root.add(floor);
  }

  /** Walls + roofs (one corrugated mesh, double sided so the building also reads from outside). */
  private buildShell(rng: Rng, skylights: Rect[]): void {
    const s = new QuadSoup();
    const doorHole: Hole = { u0: -DOOR.z1, u1: -DOOR.z0, v0: 0, v1: DOOR.height };
    // Hall.
    wallPanels(s, { o: [0, 0, I.minZ], u: [1, 0, 0], n: [0, 0, 1] }, I.minX, I.maxX, () => EAVE, [], COL.wall, rng);
    wallPanels(s, { o: [I.minX, 0, 0], u: [0, 0, -1], n: [1, 0, 0] }, -I.maxZ, -I.minZ, (u) => roofY(-u), [doorHole], COL.wall, rng, [-HALL_CZ]);
    wallPanels(s, { o: [I.maxX, 0, 0], u: [0, 0, 1], n: [-1, 0, 0] }, I.minZ, I.maxZ, (u) => roofY(u), [], COL.wall, rng, [HALL_CZ]);
    wallPanels(s, { o: [0, 0, I.maxZ], u: [-1, 0, 0], n: [0, 0, -1] }, -I.maxX, -I.minX, () => EAVE, [{ u0: -I.maxX, u1: -I.minX, v0: 0, v1: ANNEX_HIGH }], COL.wall, rng, []);
    // Annex.
    wallPanels(s, { o: [I.minX, 0, 0], u: [0, 0, -1], n: [1, 0, 0] }, -A.maxZ, -A.minZ, (u) => annexRoofY(-u), [], COL.wall, rng);
    wallPanels(s, { o: [I.maxX, 0, 0], u: [0, 0, 1], n: [-1, 0, 0] }, A.minZ, A.maxZ, (u) => annexRoofY(u), [], COL.wall, rng);
    wallPanels(s, { o: [0, 0, A.maxZ], u: [-1, 0, 0], n: [0, 0, -1] }, -A.maxX, -A.minX, () => ANNEX_LOW, [], COL.wall, rng);
    // Roofs (overlapping the wall tops slightly so no light leaks at the eaves).
    roofPanels(s, I.minX - 0.3, I.maxX + 0.3, I.minZ - 0.3, I.maxZ + 0.02, (z) => roofY(Math.max(I.minZ, Math.min(I.maxZ, z))) + 0.02, skylights, COL.roof, rng, [HALL_CZ]);
    const annexSky: Rect = { x0: -20, x1: 20, z0: 27.5, z1: 30 };
    roofPanels(s, A.minX - 0.3, A.maxX + 0.3, A.minZ - 0.02, A.maxZ + 0.3, (z) => annexRoofY(Math.max(A.minZ, Math.min(A.maxZ, z))) + 0.02, [annexSky], COL.roof, rng, []);
    const geo = this.own(s.build(CORRUGATED_METRES));
    shadeVertexColors(geo, (_x, y) => (y < 1.2 ? 0.74 + 0.16 * (y / 1.2) : y < 3.6 ? 0.9 + 0.1 * ((y - 1.2) / 2.4) : 1));
    const tex = corrugatedTextures();
    const mat = this.own(new THREE.MeshStandardMaterial({
      map: tex.map, normalMap: tex.normalMap, normalScale: new THREE.Vector2(0.9, 0.9), vertexColors: true,
      roughness: 0.55, metalness: 0.35, side: THREE.DoubleSide, shadowSide: THREE.BackSide, envMapIntensity: 0.7,
    }));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'shell';
    this.root.add(mesh);

    // Glass: skylights (seen from below), clerestory windows, lamp bulbs are added in buildStructureAndProps.
    this.skyGlass = new QuadSoup();
    const gl = this.skyGlass;
    const skyCol = new THREE.Color(0.66, 0.66, 0.62), skyTop = new THREE.Color(0.7, 0.7, 0.66);
    for (const r of [...skylights]) {
      const split = r.z0 < HALL_CZ && r.z1 > HALL_CZ ? [r.z0, HALL_CZ, r.z1] : [r.z0, r.z1];
      for (let k = 0; k < split.length - 1; k++) {
        const za = split[k], zb = split[k + 1];
        gl.quad([r.x0, roofY(za) + 0.06, za], [r.x1, roofY(za) + 0.06, za], [r.x1, roofY(zb) + 0.06, zb], [r.x0, roofY(zb) + 0.06, zb], [0, -1, 0], skyCol, undefined, skyTop);
      }
    }
    gl.quad([annexSky.x0, annexRoofY(annexSky.z0) + 0.06, annexSky.z0], [annexSky.x1, annexRoofY(annexSky.z0) + 0.06, annexSky.z0],
      [annexSky.x1, annexRoofY(annexSky.z1) + 0.06, annexSky.z1], [annexSky.x0, annexRoofY(annexSky.z1) + 0.06, annexSky.z1], [0, -1, 0], skyCol);
    // Clerestory windows: north wall and east wall, between columns.
    const winLo = new THREE.Color(0.5, 0.56, 0.6), winHi = new THREE.Color(0.66, 0.7, 0.72);
    for (let x = I.minX; x < I.maxX; x += 8) {
      gl.quad([x + 1.3, 7.4, I.minZ + 0.03], [x + 6.7, 7.4, I.minZ + 0.03], [x + 6.7, 9.4, I.minZ + 0.03], [x + 1.3, 9.4, I.minZ + 0.03], [0, 0, 1], winLo, undefined, winHi);
      gl.quad([x + 1.3, 5.4, A.maxZ - 0.03], [x + 6.7, 5.4, A.maxZ - 0.03], [x + 6.7, 6.9, A.maxZ - 0.03], [x + 1.3, 6.9, A.maxZ - 0.03], [0, 0, -1], winLo, undefined, winHi);
    }
    for (const z of [-18, -10, 6, 14]) {
      gl.quad([I.maxX - 0.03, 7.4, z - 2.7], [I.maxX - 0.03, 7.4, z + 2.7], [I.maxX - 0.03, 9.4, z + 2.7], [I.maxX - 0.03, 9.4, z - 2.7], [-1, 0, 0], winLo, undefined, winHi);
    }
  }

  private skyGlass: QuadSoup | null = null;

  /** Trusses, columns, purlins, lamps, wall props, order-board frame and case cabinet (one palette mesh). */
  private buildStructureAndProps(rng: Rng, skylights: Rect[], signMat: THREE.Material): void {
    const b = new GeometryBuilder();
    const steel = COL.steel, galv = COL.galv;
    // Columns.
    for (let x = I.minX; x <= I.maxX + 1e-6; x += 8) {
      const cx = Math.min(I.maxX - 0.2, Math.max(I.minX + 0.2, x));
      b.box(0.36, EAVE, 0.36, cx, EAVE / 2, I.minZ + 0.2, steel);
      b.box(0.36, ANNEX_OPENING, 0.36, cx, ANNEX_OPENING / 2, I.maxZ - 0.2, steel);
      b.box(0.3, ANNEX_LOW, 0.3, cx, ANNEX_LOW / 2, A.maxZ - 0.18, steel);
    }
    for (const z of [-14, -6, 17]) b.box(0.36, roofY(z), 0.36, I.minX + 0.2, roofY(z) / 2, z, steel);
    for (const z of [-14, -6, 6, 14]) b.box(0.36, roofY(z), 0.36, I.maxX - 0.2, roofY(z) / 2, z, steel);
    // Header beam over the annex opening and the band girt.
    b.box(I.maxX - I.minX, 0.5, 0.45, 0, ANNEX_OPENING + 0.25, I.maxZ - 0.2, steel);
    // Trusses.
    for (const x of TRUSS_X) {
      const yb = 10.0;
      b.beam(x, EAVE - 0.15, I.minZ + 0.2, x, PEAK - 0.2, HALL_CZ, 0.22, 0.3, steel);
      b.beam(x, PEAK - 0.2, HALL_CZ, x, EAVE - 0.15, I.maxZ - 0.2, 0.22, 0.3, steel);
      b.beam(x, yb, I.minZ + 0.2, x, yb, I.maxZ - 0.2, 0.2, 0.24, steel);
      const n = 8;
      for (let k = 1; k < n * 2; k++) {
        const z = I.minZ + 0.2 + (k / (n * 2)) * (I.maxZ - I.minZ - 0.4);
        const yt = roofY(z) - 0.3;
        b.beam(x, yb, z, x, yt, z, 0.1, 0.1, steel);
        if (k < n * 2 - 1) {
          const z2 = I.minZ + 0.2 + ((k + 1) / (n * 2)) * (I.maxZ - I.minZ - 0.4);
          if (k % 2 === 1) b.beam(x, yb, z, x, roofY(z2) - 0.3, z2, 0.08, 0.08, steel);
          else b.beam(x, roofY(z) - 0.3, z, x, yb, z2, 0.08, 0.08, steel);
        }
      }
      b.box(0.5, 0.25, 0.5, x, yb, I.minZ + 0.25, galv);
      b.box(0.5, 0.25, 0.5, x, yb, I.maxZ - 0.25, galv);
    }
    // Gable rafters.
    for (const x of [I.minX + 0.2, I.maxX - 0.2]) {
      b.beam(x, EAVE - 0.15, I.minZ + 0.2, x, PEAK - 0.2, HALL_CZ, 0.22, 0.3, steel);
      b.beam(x, PEAK - 0.2, HALL_CZ, x, EAVE - 0.15, I.maxZ - 0.2, 0.22, 0.3, steel);
    }
    // Purlins.
    for (const z of [-19.5, -15.5, -11, -6.5, -3, 3, 6.5, 11, 15.5, 19.5]) {
      b.beam(I.minX, roofY(z) - 0.12, z, I.maxX, roofY(z) - 0.12, z, 0.12, 0.2, galv);
    }
    b.beam(I.minX, PEAK - 0.1, HALL_CZ, I.maxX, PEAK - 0.1, HALL_CZ, 0.2, 0.2, galv);
    for (const z of [26, 32]) b.beam(A.minX, annexRoofY(z) - 0.12, z, A.maxX, annexRoofY(z) - 0.12, z, 0.12, 0.2, galv);
    // Skylight frames.
    for (const r of skylights) {
      for (const x of [r.x0, r.x1]) {
        const za = r.z0, zb = r.z1;
        if (za < HALL_CZ && zb > HALL_CZ) {
          b.beam(x, roofY(za) - 0.05, za, x, roofY(HALL_CZ) - 0.05, HALL_CZ, 0.1, 0.1, galv);
          b.beam(x, roofY(HALL_CZ) - 0.05, HALL_CZ, x, roofY(zb) - 0.05, zb, 0.1, 0.1, galv);
        } else b.beam(x, roofY(za) - 0.05, za, x, roofY(zb) - 0.05, zb, 0.1, 0.1, galv);
      }
      for (const z of [r.z0, r.z1]) b.beam(r.x0, roofY(z) - 0.05, z, r.x1, roofY(z) - 0.05, z, 0.1, 0.1, galv);
    }
    // Wall girts + concrete plinth.
    for (const y of [4.2, 7.1]) {
      b.box(I.maxX - I.minX, 0.14, 0.12, 0, y, I.minZ + 0.08, galv);
      b.box(0.12, 0.14, I.maxZ - I.minZ, I.maxX - 0.08, y, HALL_CZ, galv);
    }
    for (const y of [7.35, 9.45]) {
      for (let x = I.minX; x < I.maxX; x += 8) b.box(5.5, 0.12, 0.1, x + 4, y, I.minZ + 0.06, COL.dark);
    }
    const plinth = 0.9;
    b.box(I.maxX - I.minX, plinth, 0.2, 0, plinth / 2, I.minZ + 0.1, COL.concrete);
    b.box(0.2, plinth, I.maxZ - I.minZ, I.maxX - 0.1, plinth / 2, HALL_CZ, COL.concrete);
    b.box(0.2, plinth, DOOR.z0 - I.minZ, I.minX + 0.1, plinth / 2, (I.minZ + DOOR.z0) / 2, COL.concrete);
    b.box(0.2, plinth, I.maxZ - DOOR.z1, I.minX + 0.1, plinth / 2, (DOOR.z1 + I.maxZ) / 2, COL.concrete);
    b.box(0.2, plinth, A.maxZ - A.minZ, I.minX + 0.1, plinth / 2, (A.minZ + A.maxZ) / 2, COL.concrete);
    b.box(0.2, plinth, A.maxZ - A.minZ, I.maxX - 0.1, plinth / 2, (A.minZ + A.maxZ) / 2, COL.concrete);
    b.box(A.maxX - A.minX, plinth, 0.2, 0, plinth / 2, A.maxZ - 0.1, COL.concrete);
    // Loading door: frame, rail, slid-open leaves outside.
    const dx = I.minX;
    for (const z of [DOOR.z0, DOOR.z1]) b.box(0.5, DOOR.height + 0.6, 0.4, dx, (DOOR.height + 0.6) / 2, z, steel);
    b.box(0.5, 0.6, DOOR.z1 - DOOR.z0 + 0.4, dx, DOOR.height + 0.3, (DOOR.z0 + DOOR.z1) / 2, steel);
    b.box(0.16, 0.22, 26, dx - 0.45, DOOR.height + 0.75, DOOR.z0 + 12, galv);
    const leafW = (DOOR.z1 - DOOR.z0) / 2 + 0.3;
    for (let k = 0; k < 2; k++) {
      const zc = DOOR.z1 + 0.2 + leafW / 2 + k * (leafW - 0.4);
      const x = dx - 0.62 - k * 0.2;
      b.box(0.14, DOOR.height + 0.4, leafW, x, (DOOR.height + 0.4) / 2, zc, 0xa8412f);
      b.box(0.18, 0.3, leafW, x - 0.03, 0.4, zc, 0xf1ece0);
      b.box(0.18, 0.3, leafW, x - 0.03, DOOR.height + 0.1, zc, 0xf1ece0);
      b.box(0.18, DOOR.height + 0.3, 0.3, x - 0.03, (DOOR.height + 0.4) / 2, zc - leafW / 2 + 0.15, 0xf1ece0);
      b.box(0.18, DOOR.height + 0.3, 0.3, x - 0.03, (DOOR.height + 0.4) / 2, zc + leafW / 2 - 0.15, 0xf1ece0);
      const diag = Math.hypot(DOOR.height, leafW) - 0.5;
      const ang = Math.atan2(DOOR.height, leafW);
      b.box(0.16, 0.26, diag, x - 0.04, (DOOR.height + 0.4) / 2, zc, 0xf1ece0, [ang, 0, 0]);
      b.box(0.16, 0.26, diag, x - 0.04, (DOOR.height + 0.4) / 2, zc, 0xf1ece0, [-ang, 0, 0]);
      b.cylinder(0.12, 0.12, 0.2, 8, x, DOOR.height + 0.72, zc - leafW / 3, galv, [0, 0, Math.PI / 2]);
      b.cylinder(0.12, 0.12, 0.2, 8, x, DOOR.height + 0.72, zc + leafW / 3, galv, [0, 0, Math.PI / 2]);
    }
    // Pendant lamps.
    const glass = this.skyGlass!;
    const bulb = new THREE.Color(1, 0.86, 0.6);
    for (const [x, z] of LAMPS) {
      b.rod(x, 10.0, z, x, LAMP_Y + 0.42, z, 0.025, 4, COL.dark);
      b.cylinder(0.12, 0.12, 0.18, 8, x, LAMP_Y + 0.4, z, COL.dark);
      b.cylinder(0.14, 0.62, 0.5, 12, x, LAMP_Y + 0.08, z, COL.enamel, undefined, true);
      b.cylinder(0.13, 0.6, 0.48, 12, x, LAMP_Y + 0.07, z, 0xe9e4d6, [Math.PI, 0, 0], true);
      glass.quad([x - 0.26, LAMP_Y - 0.14, z - 0.26], [x + 0.26, LAMP_Y - 0.14, z - 0.26], [x + 0.26, LAMP_Y - 0.14, z + 0.26], [x - 0.26, LAMP_Y - 0.14, z + 0.26], [0, -1, 0], bulb);
    }
    // Cable tray and conduits.
    b.box(I.maxX - I.minX - 1, 0.1, 0.36, 0, 6.2, I.minZ + 0.35, galv);
    b.rod(I.maxX - 0.25, 1.6, -16, I.maxX - 0.25, 6.2, -16, 0.04, 6, galv);
    b.box(0.26, 1.1, 0.8, I.maxX - 0.25, 2.0, -16, 0x7c8588);
    b.box(0.04, 0.8, 0.6, I.maxX - 0.39, 2.0, -16, 0x9aa3a6);
    b.box(0.26, 0.7, 0.5, I.maxX - 0.25, 2.1, -14.8, 0x7c8588);
    // Fire extinguisher points (red backing board + extinguisher).
    const ext = (x: number, z: number, nx: number, nz: number) => {
      b.box(nx !== 0 ? 0.04 : 0.45, 0.8, nz !== 0 ? 0.04 : 0.45, x + nx * 0.02, 1.6, z + nz * 0.02, 0xc8453b);
      b.cylinder(0.1, 0.1, 0.5, 10, x + nx * 0.16, 1.5, z + nz * 0.16, 0xd03a2e);
      b.cylinder(0.05, 0.08, 0.12, 8, x + nx * 0.16, 1.81, z + nz * 0.16, COL.dark);
    };
    ext(I.minX + 0.2, -14, 1, 0); ext(I.maxX - 0.2, 2, -1, 0); ext(-12, I.minZ + 0.2, 0, 1); ext(14, I.minZ + 0.2, 0, 1);
    // East wall personnel door.
    b.box(0.12, 2.3, 1.3, I.maxX - 0.12, 1.15, 10, 0x2f3a33);
    b.box(0.1, 2.2, 1.1, I.maxX - 0.18, 1.1, 10, 0x4c6b5a);
    b.box(0.1, 0.06, 0.2, I.maxX - 0.26, 1.05, 9.7, galv);
    // Order board frame + light bar.
    const ob = WORLD.props.orderBoard;
    const bw = 3.4, bh = 2.2;
    b.box(0.14, bh + 0.2, 0.12, ob.x + 0.05, ob.y, ob.z - bw / 2, COL.timber);
    b.box(0.14, bh + 0.2, 0.12, ob.x + 0.05, ob.y, ob.z + bw / 2, COL.timber);
    b.box(0.14, 0.12, bw + 0.12, ob.x + 0.05, ob.y + bh / 2 + 0.04, ob.z, COL.timber);
    b.box(0.14, 0.12, bw + 0.12, ob.x + 0.05, ob.y - bh / 2 - 0.04, ob.z, COL.timber);
    b.box(0.04, bh, bw, ob.x - 0.02, ob.y, ob.z, 0x5c3d22);
    b.box(0.3, 0.08, bw * 0.7, ob.x + 0.2, ob.y + bh / 2 + 0.3, ob.z, COL.dark);
    b.rod(ob.x + 0.02, ob.y + bh / 2 + 0.3, ob.z - bw * 0.3, ob.x + 0.2, ob.y + bh / 2 + 0.3, ob.z - bw * 0.3, 0.02, 4, COL.dark);
    b.rod(ob.x + 0.02, ob.y + bh / 2 + 0.3, ob.z + bw * 0.3, ob.x + 0.2, ob.y + bh / 2 + 0.3, ob.z + bw * 0.3, 0.02, 4, COL.dark);
    glass.quad([ob.x + 0.2, ob.y + bh / 2 + 0.255, ob.z - bw * 0.33], [ob.x + 0.2, ob.y + bh / 2 + 0.255, ob.z + bw * 0.33],
      [ob.x + 0.3, ob.y + bh / 2 + 0.255, ob.z + bw * 0.33], [ob.x + 0.3, ob.y + bh / 2 + 0.255, ob.z - bw * 0.33], [0, -1, 0], bulb);
    // Needle case cabinet.
    this.caseCabinet(b, glass);
    this.addOwnedMesh(b.build(), paletteMaterial(), 'structure', true, true);

    // Emissive glass/bulbs.
    const glassMat = this.own(new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(1.55, 1.55, 1.55), fog: false }));
    this.addOwnedMesh(glass.build(), glassMat, 'glow', false, false);
    this.skyGlass = null;

    // Wall signage.
    const signs = new QuadSoup();
    this.sign(signs, 'banner', [I.maxX - 0.06, 12.4, HALL_CZ], [-1, 0, 0], 11);
    this.sign(signs, 'loading', [I.minX + 0.3, DOOR.height + 1.25, (DOOR.z0 + DOOR.z1) / 2], [1, 0, 0], 4.2);
    this.sign(signs, 'noSmoking', [-20, 2.4, I.minZ + 0.06], [0, 0, 1], 0.8);
    this.sign(signs, 'hayHat', [-4, 2.4, I.minZ + 0.06], [0, 0, 1], 0.8);
    this.sign(signs, 'noSmoking', [20, 2.4, I.minZ + 0.06], [0, 0, 1], 0.8);
    this.sign(signs, 'daysWithout', [I.minX + 0.06, 2.3, -14.6], [1, 0, 0], 1.3);
    this.sign(signs, 'exit', [I.maxX - 0.06, 2.75, 10], [-1, 0, 0], 0.9);
    this.sign(signs, 'hayHat', [I.maxX - 0.06, 2.4, -6], [-1, 0, 0], 0.8);
    const nc = WORLD.props.needleCase;
    this.sign(signs, 'needles', [nc.x + 0.2, nc.y + 1.05, nc.z], [1, 0, 0], 1.9);
    const signMesh = new THREE.Mesh(this.own(signs.build()), signMat);
    signMesh.receiveShadow = true;
    signMesh.name = 'signs';
    this.root.add(signMesh);
    void rng;
  }

  /** Cabinet body; the slot glows / needles / plaques are separate instanced meshes. */
  private caseCabinet(b: GeometryBuilder, glass: QuadSoup): void {
    const nc = WORLD.props.needleCase;
    const w = 2.5, h = 1.7, d = 0.34;
    const x = nc.x + d / 2 - 0.12;
    b.box(0.06, h, w, nc.x - 0.12, nc.y, nc.z, COL.walnut);
    b.box(d, 0.12, w + 0.16, x, nc.y + h / 2, nc.z, COL.walnut);
    b.box(d + 0.06, 0.1, w + 0.24, x + 0.02, nc.y + h / 2 + 0.1, nc.z, 0x3a2414);
    b.box(d, 0.16, w + 0.16, x, nc.y - h / 2, nc.z, COL.walnut);
    b.box(d, h, 0.08, x, nc.y, nc.z - w / 2, COL.walnut);
    b.box(d, h, 0.08, x, nc.y, nc.z + w / 2, COL.walnut);
    b.box(d * 0.9, 0.05, w, x, nc.y, nc.z, COL.brass);
    for (const k of [-1, 1]) b.box(d * 0.9, h - 0.2, 0.05, x, nc.y, nc.z + k * 0.41, COL.brass);
    const bulb = new THREE.Color(1, 0.9, 0.7);
    glass.quad([x + 0.1, nc.y + h / 2 - 0.07, nc.z - w / 2 + 0.1], [x + 0.1, nc.y + h / 2 - 0.07, nc.z + w / 2 - 0.1],
      [x - 0.05, nc.y + h / 2 - 0.07, nc.z + w / 2 - 0.1], [x - 0.05, nc.y + h / 2 - 0.07, nc.z - w / 2 + 0.1], [0, -1, 0], bulb);
  }

  private buildNeedleCase(): { glow: THREE.InstancedMesh; needles: THREE.InstancedMesh } {
    const nc = WORLD.props.needleCase;
    const slotW = 0.72, slotH = 0.7;
    const glowGeo = this.own(new THREE.PlaneGeometry(slotW, slotH).rotateY(Math.PI / 2));
    const glowMat = this.own(new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
    const glow = new THREE.InstancedMesh(glowGeo, glowMat, 6);
    glow.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(18), 3);
    const needleGeo = this.own(createNeedleGeometry(0.56));
    const needleMat = this.own(new THREE.MeshStandardMaterial({ color: 0xe4ebef, metalness: 1, roughness: 0.16, envMapIntensity: 1.4 }));
    const needles = new THREE.InstancedMesh(needleGeo, needleMat, 6);
    needles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const plaques = new QuadSoup();
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < 6; i++) {
      const row = i < 3 ? 0 : 1, colIdx = i % 3;
      // Viewer faces -X: their left is +Z, so slot 1 is the +Z column of the top row.
      const z = nc.z + (1 - colIdx) * 0.82;
      const y = nc.y + (row === 0 ? 0.38 : -0.38);
      m.makeTranslation(nc.x - 0.07, y, z);
      glow.setMatrixAt(i, m);
      e.set(0.75 + (i % 2) * 0.15, 0, 0);
      q.setFromEuler(e);
      p.set(nc.x - 0.02, y + 0.02, z);
      const mm = new THREE.Matrix4().compose(p, q, s);
      this.caseNeedleMatrices.push(mm);
      needles.setMatrixAt(i, mm);
      this.sign(plaques, (`n${i + 1}`) as SignName, [nc.x - 0.03, y - slotH / 2 + 0.07, z + slotW / 2 - 0.1], [1, 0, 0], 0.11);
    }
    glow.name = 'caseSlots';
    needles.name = 'caseNeedles';
    this.root.add(glow, needles);
    const plaqueMat = this.own(new THREE.MeshStandardMaterial({ map: this.signTexture(), roughness: 0.6, transparent: true, alphaTest: 0.05 }));
    const plaqueMesh = new THREE.Mesh(this.own(plaques.build()), plaqueMat);
    plaqueMesh.name = 'casePlaques';
    this.root.add(plaqueMesh);
    // Glass front.
    const glassFront = new THREE.Mesh(this.own(new THREE.PlaneGeometry(2.4, 1.6).rotateY(Math.PI / 2)), glassMaterial());
    glassFront.position.set(nc.x + 0.22, nc.y, nc.z);
    glassFront.renderOrder = 4;
    glassFront.name = 'caseGlass';
    this.root.add(glassFront);
    return { glow, needles };
  }

  private signAtlasTex: THREE.CanvasTexture | null = null;
  private signTexture(): THREE.CanvasTexture {
    if (!this.signAtlasTex) this.signAtlasTex = this.own(createSignAtlas());
    return this.signAtlasTex;
  }

  private buildOrderBoard(): void {
    const ob = WORLD.props.orderBoard;
    const mat = this.own(new THREE.MeshStandardMaterial({
      map: this.boardTex, emissive: 0xffffff, emissiveMap: this.boardTex, emissiveIntensity: 0.22, roughness: 0.92, metalness: 0,
    }));
    const geo = this.own(new THREE.PlaneGeometry(3.3, 3.3 * ORDER_BOARD_PX.h / ORDER_BOARD_PX.w).rotateY(Math.PI / 2));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(ob.x + 0.02, ob.y, ob.z);
    mesh.receiveShadow = true;
    mesh.name = 'orderBoard';
    this.root.add(mesh);
  }

  /** Quad textured with a sign atlas region, centred at c, facing n, `width` metres wide. */
  private sign(s: QuadSoup, name: SignName, c: V3, n: V3, width: number): void {
    const h = width / signAspect(name);
    // Viewer's right when facing the sign: (-n) × up.
    const rx = n[2], rz = -n[0];
    const hw = width / 2, hh = h / 2;
    const [u0, v0, u1, v1] = signUV(name);
    const white = new THREE.Color(1, 1, 1);
    s.quad(
      [c[0] - rx * hw, c[1] - hh, c[2] - rz * hw], [c[0] + rx * hw, c[1] - hh, c[2] + rz * hw],
      [c[0] + rx * hw, c[1] + hh, c[2] + rz * hw], [c[0] - rx * hw, c[1] + hh, c[2] - rz * hw],
      n, white, [u0, v0, u1, v0, u1, v1, u0, v1],
    );
  }

  private addOwnedMesh(geo: THREE.BufferGeometry, mat: THREE.Material, name: string, cast: boolean, receive: boolean): THREE.Mesh {
    this.own(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    this.root.add(mesh);
    return mesh;
  }

  // ----- exterior -----------------------------------------------------------------------------

  private buildExterior(rng: Rng): void {
    const b = new GeometryBuilder();
    // Ground disc with field colours (vertex coloured, subdivided for variation).
    const ground = new THREE.CircleGeometry(160, 64, 0, Math.PI * 2).rotateX(-Math.PI / 2);
    const g = ground.toNonIndexed();
    ground.dispose();
    const gp = g.getAttribute('position');
    const gc = new Float32Array(gp.count * 3);
    const cA = new THREE.Color(COL.stubble), cB = new THREE.Color(COL.grass), cc = new THREE.Color();
    for (let i = 0; i < gp.count; i += 3) {
      const mx = (gp.getX(i) + gp.getX(i + 1) + gp.getX(i + 2)) / 3, mz = (gp.getZ(i) + gp.getZ(i + 1) + gp.getZ(i + 2)) / 3;
      const t = 0.5 + 0.5 * Math.sin(mx * 0.021 + Math.cos(mz * 0.017) * 2.1) * Math.cos(mz * 0.019 - mx * 0.007);
      cc.copy(cA).lerp(cB, t).multiplyScalar(0.92 + rng.next() * 0.12);
      for (let k = 0; k < 3; k++) { gc[(i + k) * 3] = cc.r; gc[(i + k) * 3 + 1] = cc.g; gc[(i + k) * 3 + 2] = cc.b; }
    }
    g.setAttribute('color', new THREE.BufferAttribute(gc, 3));
    g.translate(0, -0.04, 7);
    b.add(g, null);
    // Gravel yard + dirt road + field rows.
    b.box(30, 0.04, 34, I.minX - 15, -0.02, 7, COL.gravel);
    b.box(100, 0.04, 7, I.minX - 80, -0.025, 8, COL.dirt);
    for (let k = 0; k < 14; k++) {
      const z = -60 + k * 3.2;
      b.box(70, 0.05, 1.1, -95, -0.01, z, k % 2 ? 0xbfa052 : 0xa88c45);
    }
    // Fence along the yard.
    for (let x = I.minX - 29; x <= I.minX - 1; x += 2.5) {
      for (const z of [-10, 24]) b.box(0.14, 1.2, 0.14, x, 0.6, z, 0x8a6a45);
    }
    for (const z of [-10, 24]) for (const y of [0.5, 1.0]) b.box(28, 0.1, 0.06, I.minX - 15, y, z, 0x9b7a52);
    // Round bales in the field.
    for (let i = 0; i < 9; i++) {
      const x = -58 - rng.next() * 60, z = -45 + rng.next() * 40;
      b.cylinder(0.8, 0.8, 1.2, 14, x, 0.78, z, COL.bale, [Math.PI / 2, rng.next() * Math.PI, 0]);
    }
    // Trees and a distant farmstead.
    for (let i = 0; i < 46; i++) {
      const a = Math.PI * (0.45 + rng.next() * 1.1);
      const r = 70 + rng.next() * 75;
      const x = Math.cos(a) * r - 10, z = Math.sin(a) * r * 0.9 + 7;
      if (x > I.minX - 8) continue;
      const sc = 0.8 + rng.next() * 0.9;
      b.cylinder(0.25 * sc, 0.35 * sc, 2.4 * sc, 5, x, 1.2 * sc, z, 0x5b4630);
      b.cone(2.2 * sc, 4.6 * sc, 7, x, 4.2 * sc, z, rng.next() < 0.5 ? 0x3f6b35 : 0x4d7a3a);
      b.cone(1.6 * sc, 3.4 * sc, 7, x, 6.4 * sc, z, 0x55833f);
    }
    b.box(14, 8, 22, -150, 4, -40, 0xa8412f);
    b.box(14.6, 0.6, 22.6, -150, 8.2, -40, 0x6e6e6e);
    b.cylinder(3.2, 3.2, 16, 14, -146, 8, -24, 0xc9ced1);
    b.sphere(3.2, -146, 16, -24, 0xb0b6b9, 1, [1, 0.55, 1]);
    // Utility poles along the road.
    for (let x = -60; x > -150; x -= 22) {
      b.cylinder(0.14, 0.18, 8, 6, x, 4, 12.5, 0x6b5436);
      b.box(0.15, 0.15, 2.2, x, 7.6, 12.5, 0x6b5436);
    }
    this.buildTruck(b);
    const mesh = this.addOwnedMesh(b.build(), paletteMaterial(), 'exterior', true, true);
    mesh.frustumCulled = false;

    // Distant hills (own mesh: not a shadow caster).
    const hills = this.hillGeometry(rng);
    this.addOwnedMesh(hills, paletteMaterial(), 'hills', false, false);

    // Sky dome.
    const skyMat = this.own(new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false,
      uniforms: {
        uZenith: { value: new THREE.Color(0x4f8fd0) }, uHorizon: { value: new THREE.Color(0xdfe8ee) },
        uGround: { value: new THREE.Color(0x9a9a80) }, uSunDir: { value: SUN_DIR.clone() }, uSunColor: { value: new THREE.Color(0xfff1d6) },
      },
    }));
    const sky = new THREE.Mesh(this.own(new THREE.SphereGeometry(450, 32, 16)), skyMat);
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    sky.name = 'sky';
    this.root.add(sky);
  }

  private hillGeometry(rng: Rng): THREE.BufferGeometry {
    const seg = 96, rings = [150, 185, 225, 270, 330, 400];
    const pos: number[] = [], col: number[] = [];
    const near = new THREE.Color(0x6f8a45), far = new THREE.Color(0x9fb3c0), top = new THREE.Color(0x8fa25a), c = new THREE.Color();
    const phase = [rng.next() * 6, rng.next() * 6, rng.next() * 6];
    const height = (a: number, k: number): number => {
      const prof = [0, 0.45, 0.9, 1, 0.75, 0.3][k];
      const n = 0.55 + 0.25 * Math.sin(a * 3 + phase[0]) + 0.15 * Math.sin(a * 7 + phase[1]) + 0.1 * Math.sin(a * 13 + phase[2]);
      return prof * n * (k >= 4 ? 38 : 26);
    };
    const pt = (i: number, k: number): V3 => {
      const a = (i / seg) * Math.PI * 2;
      const r = rings[k];
      return [Math.cos(a) * r, height(a, k) - 0.5, Math.sin(a) * r + 7];
    };
    const colorAt = (k: number, y: number): THREE.Color => {
      c.copy(near).lerp(far, k / (rings.length - 1));
      return c.lerp(top, Math.min(0.5, y / 60));
    };
    for (let i = 0; i < seg; i++) {
      for (let k = 0; k < rings.length - 1; k++) {
        const p00 = pt(i, k), p10 = pt(i + 1, k), p01 = pt(i, k + 1), p11 = pt(i + 1, k + 1);
        for (const p of [p00, p01, p11, p00, p11, p10]) {
          pos.push(p[0], p[1], p[2]);
          const cl = colorAt(p === p00 || p === p10 ? k : k + 1, p[1]);
          col.push(cl.r, cl.g, cl.b);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }

  /** Original stylised flatbed hay truck parked at the loading door. */
  private buildTruck(b: GeometryBuilder): void {
    const z = (DOOR.z0 + DOOR.z1) / 2, y0 = 0;
    const back = I.minX - 3.4;
    const cabX = back - 9.6;
    // Chassis + wheels.
    b.box(10.8, 0.32, 1.7, back - 5.3, y0 + 0.72, z, COL.dark);
    for (const ax of [cabX + 0.9, back - 2.6, back - 1.3]) {
      for (const s of [-1, 1]) {
        b.cylinder(0.52, 0.52, 0.36, 14, ax, y0 + 0.52, z + s * 1.02, COL.rubber, [Math.PI / 2, 0, 0]);
        b.cylinder(0.27, 0.27, 0.38, 10, ax, y0 + 0.52, z + s * 1.02, 0xb7bdc0, [Math.PI / 2, 0, 0]);
      }
    }
    // Cab.
    b.roundedBox(2.7, 1.9, 2.3, 0.22, cabX + 0.1, y0 + 1.9, z, COL.truckRed);
    b.roundedBox(2.2, 0.28, 2.34, 0.1, cabX + 0.2, y0 + 2.9, z, COL.truckWhite);
    b.box(0.06, 0.78, 1.9, cabX - 1.23, y0 + 2.25, z, COL.glassDark);
    for (const s of [-1, 1]) {
      b.box(1.1, 0.62, 0.05, cabX + 0.2, y0 + 2.28, z + s * 1.16, COL.glassDark);
      b.box(0.08, 0.34, 0.12, cabX - 1.1, y0 + 2.35, z + s * 1.34, COL.dark);
      b.box(0.08, 0.2, 0.36, cabX - 1.24, y0 + 1.36, z + s * 0.74, COL.headlight);
    }
    b.box(0.1, 0.62, 1.4, cabX - 1.24, y0 + 1.5, z, 0x3a3a3a);
    b.box(0.24, 0.26, 2.4, cabX - 1.3, y0 + 0.96, z, 0x9aa1a4);
    b.box(0.07, 0.24, 1.6, cabX + 0.2, y0 + 1.6, z + 1.17, COL.truckWhite);
    b.box(0.07, 0.24, 1.6, cabX + 0.2, y0 + 1.6, z - 1.17, COL.truckWhite);
    b.cylinder(0.08, 0.08, 2.2, 8, cabX + 1.35, y0 + 2.6, z + 0.9, 0xb7bdc0);
    // Flatbed with stake posts.
    const bedX0 = cabX + 1.5, bedX1 = back;
    b.box(bedX1 - bedX0, 0.18, 2.5, (bedX0 + bedX1) / 2, y0 + 1.0, z, 0x9a6a3a);
    for (let x = bedX0 + 0.2; x <= bedX1 - 0.1; x += 1.35) {
      for (const s of [-1, 1]) b.box(0.1, 0.8, 0.1, x, y0 + 1.45, z + s * 1.2, COL.dark);
    }
    b.box(0.1, 0.12, 2.5, bedX1 - 0.05, y0 + 1.2, z, 0xf2c230);
    // A tidy load of square bales at the front of the bed.
    const bale = (x: number, y: number, zz: number, k: number) => {
      b.roundedBox(1.15, 0.52, 0.6, 0.06, x, y, zz, new THREE.Color(COL.bale).multiplyScalar(0.9 + (k % 3) * 0.06));
      b.box(0.02, 0.54, 0.62, x - 0.3, y, zz, 0x7a5a2a);
      b.box(0.02, 0.54, 0.62, x + 0.3, y, zz, 0x7a5a2a);
    };
    let k = 0;
    for (let layer = 0; layer < 2; layer++) {
      for (let i = 0; i < (layer === 0 ? 3 : 2); i++) {
        for (const s of [-0.62, 0, 0.62]) bale(bedX0 + 0.75 + i * 1.2 + layer * 0.6, y0 + 1.36 + layer * 0.53, z + s, k++);
      }
    }
  }

  // ----- temporary annex wall -------------------------------------------------------------------

  private buildTempWall(rng: Rng, signMat: THREE.Material): void {
    const zf = I.maxZ - 0.02;
    const sheets = new QuadSoup();
    const sw = 1.22, sh = 2.44;
    const face: V3 = [0, 0, -1];
    for (let x = I.minX; x < I.maxX - 1e-6; x += sw) {
      const x1 = Math.min(I.maxX, x + sw);
      for (let y = 0; y < ANNEX_OPENING - 1e-6; y += sh) {
        const y1 = Math.min(ANNEX_OPENING, y + sh);
        const uw = (x1 - x) / sw, vh = (y1 - y) / sh;
        const tone = 0.78 + rng.next() * 0.26;
        const tint = new THREE.Color(tone, tone * (0.96 + rng.next() * 0.04), tone * (0.9 + rng.next() * 0.08));
        const flip = rng.next() < 0.5;
        const uv = flip ? [uw, 1 - vh, 0, 1 - vh, 0, 1, uw, 1] : [0, 1 - vh, uw, 1 - vh, uw, 1, 0, 1];
        sheets.quad([-x, y, zf], [-x1, y, zf], [-x1, y1, zf], [-x, y1, zf], face, tint, uv);
      }
    }
    const ply = plywoodTexture();
    const plyMat = this.own(new THREE.MeshStandardMaterial({ map: ply, vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.FrontSide, shadowSide: THREE.BackSide }));
    const plyMesh = new THREE.Mesh(this.own(sheets.build()), plyMat);
    plyMesh.castShadow = true;
    plyMesh.receiveShadow = true;
    plyMesh.name = 'tempWallPlywood';
    this.tempWall.add(plyMesh);

    // Tarp section with folds, hazard tape band, battens.
    const b = new GeometryBuilder();
    const tarpX0 = 9, tarpX1 = 25, cols = 24;
    const tarpSoup = new QuadSoup();
    const tarp = new THREE.Color(COL.tarp);
    for (let i = 0; i < cols; i++) {
      const xa = tarpX0 + (i / cols) * (tarpX1 - tarpX0), xb = tarpX0 + ((i + 1) / cols) * (tarpX1 - tarpX0);
      const fa = Math.sin(i * 1.7) * 0.12, fb = Math.sin((i + 1) * 1.7) * 0.12;
      const shade = 0.82 + 0.18 * Math.cos(i * 1.7);
      tarpSoup.quad([xb, 0.25, zf - 0.08 - fb], [xa, 0.25, zf - 0.08 - fa], [xa, 8.8, zf - 0.05], [xb, 8.8, zf - 0.05], face, tarp.clone().multiplyScalar(shade * 0.9), undefined, tarp.clone().multiplyScalar(shade));
    }
    const tarpGeo = tarpSoup.build();
    b.add(tarpGeo, null);
    for (let x = tarpX0; x <= tarpX1; x += 1) b.cylinder(0.05, 0.05, 0.03, 8, x, 8.6, zf - 0.07, 0xc0c4c6, [Math.PI / 2, 0, 0]);
    // Hazard tape band at waist height.
    const tapeY = 1.15;
    for (let x = I.minX; x < I.maxX; x += 0.6) {
      b.box(0.3, 0.12, 0.02, x + 0.15, tapeY, zf - 0.12, 0xf2c230, [0, 0, 0.5]);
      b.box(0.3, 0.12, 0.02, x + 0.45, tapeY, zf - 0.12, 0x222222, [0, 0, 0.5]);
    }
    for (const x of [I.minX + 0.1, -16, 0, 16, I.maxX - 0.1]) b.box(0.12, ANNEX_OPENING, 0.1, x, ANNEX_OPENING / 2, zf - 0.07, 0x9c7a4c);
    b.box(I.maxX - I.minX, 0.14, 0.1, 0, 3.2, zf - 0.07, 0x9c7a4c);
    const tarpMesh = new THREE.Mesh(this.own(b.build()), paletteMaterial());
    tarpMesh.castShadow = true;
    tarpMesh.receiveShadow = true;
    tarpMesh.name = 'tempWallDetails';
    this.tempWall.add(tarpMesh);

    const signs = new QuadSoup();
    this.sign(signs, 'expansion', [-3, 5.3, zf - 0.14], face, 9.5);
    this.sign(signs, 'keepOut', [-18, 2.4, zf - 0.14], face, 1.1);
    this.sign(signs, 'keepOut', [5, 2.4, zf - 0.14], face, 1.1);
    this.sign(signs, 'soon', [-11, 2.4, zf - 0.13], face, 2.6);
    const signMesh = new THREE.Mesh(this.own(signs.build()), signMat);
    signMesh.receiveShadow = true;
    signMesh.name = 'tempWallSigns';
    this.tempWall.add(signMesh);
    this.tempWall.name = 'annexTempWall';
    this.root.add(this.tempWall);
  }

  // ----- light shafts / motes -------------------------------------------------------------------

  private shaftSources(skylights: Rect[]): Rect[] {
    // Every ridge skylight and alternating side skylights (keeps additive overdraw in check).
    return skylights.filter((r, i) => (r.z0 < HALL_CZ && r.z1 > HALL_CZ) || ((i / 3) | 0) % 2 === 0);
  }

  private shaftGeometry(skylights: Rect[]): THREE.BufferGeometry {
    const pos: number[] = [], nor: number[] = [], uv: number[] = [];
    const L = SUN_DIR;
    const down = (p: V3): V3 => { const t = p[1] / L.y; return [p[0] - L.x * t, 0, p[2] - L.z * t]; };
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();
    for (const r of this.shaftSources(skylights)) {
      const y0 = roofY(r.z0), y1 = roofY(r.z1);
      const top: V3[] = [[r.x0, y0, r.z0], [r.x1, y0, r.z0], [r.x1, y1, r.z1], [r.x0, y1, r.z1]];
      if (r.z0 < HALL_CZ && r.z1 > HALL_CZ) for (const t of top) t[1] = PEAK - 0.4;
      const bot = top.map(down);
      for (let k = 0; k < 4; k++) {
        const a = top[k], bb = top[(k + 1) % 4], c = bot[(k + 1) % 4], d = bot[k];
        e1.set(bb[0] - a[0], bb[1] - a[1], bb[2] - a[2]);
        e2.set(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
        n.crossVectors(e1, e2).normalize();
        const quad = [a, bb, c, a, c, d];
        const uvs = [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1];
        for (let q = 0; q < 6; q++) {
          pos.push(quad[q][0], quad[q][1], quad[q][2]);
          nor.push(n.x, n.y, n.z);
          uv.push(uvs[q * 2], uvs[q * 2 + 1]);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeBoundingSphere();
    return g;
  }

  private moteGeometry(skylights: Rect[], count: number, rng: Rng): THREE.BufferGeometry {
    const src = this.shaftSources(skylights);
    const pos = new Float32Array(count * 3), phase = new Float32Array(count);
    const L = SUN_DIR;
    for (let i = 0; i < count; i++) {
      const r = src[i % src.length];
      const x = r.x0 + rng.next() * (r.x1 - r.x0), z = r.z0 + rng.next() * (r.z1 - r.z0);
      const y = roofY(z);
      const t = (0.12 + rng.next() * 0.8) * (y / L.y);
      pos[i * 3] = x - L.x * t;
      pos[i * 3 + 1] = y - L.y * t;
      pos[i * 3 + 2] = z - L.z * t;
      phase[i] = rng.next();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    g.computeBoundingSphere();
    return g;
  }
}

const ZERO_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);
