import * as THREE from 'three';
import { COLORS, emissiveMaterial, glassMaterial } from '../palette';
import type { ToolViewKind, ToolViewModel } from './api';
import { C, hayMound } from './kit';
import { glowMaterial, modelMaterial } from './materials';
import { flipFaces, Parts, shade } from './parts';

/**
 * First-person tool viewmodels. The root is added to the camera (camera space: +X right, +Y up, -Z
 * forward; near plane 0.08 m) so everything is authored ~0.25–1.1 m in front of the eye, low and to the
 * right. update() drives a walking bob (state.walking), the use animation (state.action 0..1), carried hay
 * (state.load), vacuum vibration (state.suck) and the detector screen (state.detector).
 */

type State = Parameters<ToolViewModel['update']>[2];

const LEATHER = 0xc9964f;
const CUFF = 0x8a5a33;
const SLEEVE = 0x3b5f86;
const WOOD = 0x9a6a3c;

/** Builds a mesh from a Parts (main + optional glass); geometries are tracked for disposal. */
class Kit {
  readonly geos: THREE.BufferGeometry[] = [];
  readonly mats: THREE.Material[] = [];
  mesh(p: Parts, parent: THREE.Object3D, name = 'part'): THREE.Group {
    const g = new THREE.Group();
    g.name = name;
    const b = p.build();
    if (b.main) { this.geos.push(b.main); g.add(this.prep(new THREE.Mesh(b.main, modelMaterial()))); }
    if (b.glass) { this.geos.push(b.glass); g.add(this.prep(new THREE.Mesh(b.glass, glassMaterial()))); }
    parent.add(g);
    return g;
  }
  prep<T extends THREE.Mesh>(m: T): T { m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false; return m; }
  dispose(): void { for (const g of this.geos) g.dispose(); for (const m of this.mats) m.dispose(); }
}

/**
 * Work glove closed around a handle running along local X through the origin; the sleeve leaves towards
 * +Z (the camera) and slightly down.
 */
function glove(p: Parts, left = false): void {
  const s = left ? -1 : 1;
  p.round('matte', [0.1, 0.085, 0.085], 0.028, LEATHER, { pos: [0, 0.005, 0.005] });
  for (let k = 0; k < 4; k++) p.round('matte', [0.022, 0.034, 0.032], 0.01, shade(LEATHER, 0.92), { pos: [-0.036 + k * 0.024, 0.02, -0.042] });
  p.round('matte', [0.03, 0.028, 0.065], 0.012, LEATHER, { pos: [s * 0.05, 0.04, -0.012], rot: [0.2, s * 0.5, 0] });
  p.round('matte', [0.07, 0.012, 0.02], 0.005, shade(LEATHER, 0.8), { pos: [0, 0.048, 0.03] });
  p.cyl('matte', 0.048, 0.044, 0.07, CUFF, { pos: [0, -0.012, 0.075] }, 10, 'z');
  p.cyl('matte', 0.058, 0.062, 0.34, SLEEVE, { pos: [0, -0.03, 0.27], rot: [0.12, 0, 0] }, 10, 'z');
}

const _gx = new THREE.Vector3();
const _gy = new THREE.Vector3();
const _gz = new THREE.Vector3();
const _gm = new THREE.Matrix4();
/**
 * Orients a glove (authored with the handle along local X and the sleeve towards local +Z) so the handle
 * runs along `handle` and the forearm leaves towards `sleeve` (parent space).
 */
function orientGlove(o: THREE.Object3D, handle: [number, number, number], sleeve: [number, number, number]): void {
  _gx.set(handle[0], handle[1], handle[2]).normalize();
  _gz.set(sleeve[0], sleeve[1], sleeve[2]);
  _gz.addScaledVector(_gx, -_gz.dot(_gx)).normalize();
  _gy.crossVectors(_gz, _gx);
  _gm.makeBasis(_gx, _gy, _gz);
  o.quaternion.setFromRotationMatrix(_gm);
}

function hayGeo(round = false): THREE.BufferGeometry { return hayMound(1, 1, 0.55, 5, 91, round); }

abstract class BaseVM implements ToolViewModel {
  readonly root = new THREE.Group();
  protected readonly sway = new THREE.Group();
  protected readonly kit = new Kit();

  constructor(name: string) {
    this.root.name = `viewmodel.${name}`;
    this.root.add(this.sway);
  }

  update(dt: number, time: number, state: State): void {
    const w = Math.max(0, Math.min(1, state.walking ?? 0));
    const f = time * 6.2;
    this.sway.position.set(Math.sin(f) * 0.011 * w, -Math.abs(Math.cos(f)) * 0.014 * w, 0);
    this.sway.rotation.z = Math.sin(f) * 0.012 * w;
    this.animate(dt, time, state);
  }

  protected abstract animate(dt: number, time: number, state: State): void;

  dispose(): void { this.kit.dispose(); this.root.removeFromParent(); }
}

/** Shows / scales a hay object by load (hidden when empty). */
function setLoad(o: THREE.Object3D, load: number, base: THREE.Vector3): void {
  if (load < 0.02) { o.visible = false; return; }
  o.visible = true;
  const k = 0.45 + 0.55 * load;
  o.scale.set(base.x * (0.8 + 0.2 * load), base.y * k, base.z * (0.8 + 0.2 * load));
}

// ---------------------------------------------------------------------------------------------

class HandsVM extends BaseVM {
  private readonly hands: THREE.Group[] = [];
  private readonly hay: THREE.Object3D;
  private readonly hayBase = new THREE.Vector3(0.26, 0.16, 0.22);
  constructor() {
    super('hands');
    for (const left of [false, true]) {
      const p = new Parts();
      glove(p, left);
      const g = this.kit.mesh(p, this.sway, left ? 'leftHand' : 'rightHand');
      this.hands.push(g);
    }
    const hp = new Parts();
    hp.add('decal', hayGeo(true), 0xffffff);
    hp.sphere('matte', 0.35, C.hay, { pos: [0, 0.05, 0], scale: [1, 0.5, 1] }, 8, 5);
    this.hay = this.kit.mesh(hp, this.sway, 'hay');
  }
  protected animate(_dt: number, _time: number, s: State): void {
    const a = Math.sin(Math.PI * Math.max(0, Math.min(1, s.action)));
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const h = this.hands[i];
      h.position.set(side * (0.16 - a * 0.05), -0.2 - a * 0.05, -0.42 - a * 0.13);
      h.rotation.set(-0.25 + a * 0.5, side * (0.45 + a * 0.2), side * (0.35 - a * 0.2));
    }
    this.hay.position.set(0, -0.2 - a * 0.04, -0.47 - a * 0.13);
    setLoad(this.hay, s.load, this.hayBase);
  }
}

// ---------------------------------------------------------------------------------------------

/** Long-handled tools (shovel, pitchfork): shaft along -Z from the rear grip. */
class LongToolVM extends BaseVM {
  private readonly tool = new THREE.Group();
  private readonly hay: THREE.Object3D;
  private readonly hayBase: THREE.Vector3;
  constructor(readonly kind: 'shovel' | 'pitchfork') {
    super(kind);
    this.sway.add(this.tool);
    const p = new Parts();
    const L = 0.85;
    p.cyl('paint', 0.017, 0.019, L, WOOD, { pos: [0, 0, -L / 2 + 0.05] }, 8, 'z');
    p.torus('metal', 0.045, 0.012, C.steelDark, { pos: [0, 0, 0.1], rot: [0, 0, 0] }, 5, 10);
    p.cyl('metal', 0.02, 0.02, 0.1, C.black, { pos: [0, 0.0, 0.1] }, 6, 'x');
    const tip = -L + 0.05;
    if (kind === 'shovel') {
      p.cyl('metal', 0.024, 0.03, 0.12, C.steelDark, { pos: [0, 0, tip - 0.02] }, 8, 'z');
      p.bev('metal', [0.3, 0.018, 0.32], 0.006, C.steelLight, { pos: [0, -0.02, tip - 0.22], rot: [0.08, 0, 0] });
      for (const s of [-1, 1]) p.bev('metal', [0.018, 0.05, 0.3], 0.005, C.steelLight, { pos: [s * 0.148, 0.0, tip - 0.22], rot: [0.08, 0, 0] });
      p.bev('paint', [0.26, 0.03, 0.05], 0.008, C.extraction, { pos: [0, -0.005, tip - 0.07] });
      this.hayBase = new THREE.Vector3(0.22, 0.12, 0.24);
    } else {
      p.cyl('metal', 0.022, 0.026, 0.1, C.steelDark, { pos: [0, 0, tip - 0.02] }, 8, 'z');
      p.bev('metal', [0.24, 0.025, 0.03], 0.008, C.steelDark, { pos: [0, 0, tip - 0.08] });
      for (let k = 0; k < 4; k++) {
        const x = -0.1 + k * (0.2 / 3);
        p.cyl('chrome', 0.006, 0.009, 0.3, C.steelLight, { pos: [x, 0.012, tip - 0.23], rot: [0.12, 0, 0] }, 5, 'z');
      }
      this.hayBase = new THREE.Vector3(0.22, 0.14, 0.2);
    }
    // two hands on the shaft
    const gp = new Parts();
    glove(gp);
    const right = this.kit.mesh(gp, this.tool, 'rightHand');
    right.position.set(0, -0.02, 0.02);
    orientGlove(right, [0, 0, -1], [0.5, -0.45, 0.3]);
    const lp = new Parts();
    glove(lp, true);
    const left = this.kit.mesh(lp, this.tool, 'leftHand');
    left.position.set(0, -0.02, -0.4);
    orientGlove(left, [0, 0, -1], [-0.8, -0.5, 0.1]);
    this.kit.mesh(p, this.tool, kind);
    const hp = new Parts();
    hp.add('decal', hayGeo(), 0xffffff);
    const hay = this.kit.mesh(hp, this.tool, 'hay');
    hay.position.set(0, 0.0, tip - 0.22);
    this.hay = hay;
  }
  protected animate(_dt: number, _time: number, s: State): void {
    const t = Math.max(0, Math.min(1, s.action));
    // thrust forward & down in the first half, lift back in the second
    const dig = Math.sin(Math.PI * Math.min(1, t * 1.6));
    const lift = t > 0.45 ? Math.sin(Math.PI * (t - 0.45) / 0.55) : 0;
    this.tool.position.set(0.2 - dig * 0.06, -0.22 - dig * 0.05 + lift * 0.06, -0.22 - dig * 0.16);
    this.tool.rotation.set(-0.26 - dig * 0.35 + lift * 0.45, 0.22 - dig * 0.1, -0.12);
    setLoad(this.hay, s.load, this.hayBase);
  }
}

// ---------------------------------------------------------------------------------------------

class BucketVM extends BaseVM {
  private readonly bucket = new THREE.Group();
  private readonly hay: THREE.Object3D;
  private readonly hayBase = new THREE.Vector3(0.25, 0.3, 0.25);
  constructor() {
    super('bucket');
    this.sway.add(this.bucket);
    const p = new Parts();
    const H = 0.24, rT = 0.15, rB = 0.115;
    p.add('paint', new THREE.CylinderGeometry(rT, rB, H, 16, 1, true), 0x6f8fa0, { pos: [0, H / 2, 0] });
    p.add('paint', flipFaces(new THREE.CylinderGeometry(rT - 0.004, rB - 0.004, H, 16, 1, true)), 0x4f6b78, { pos: [0, H / 2, 0] });
    p.cyl('paint', rB, rB, 0.01, 0x4f6b78, { pos: [0, 0.006, 0] }, 16);
    p.torus('metal', rT, 0.008, C.steelLight, { pos: [0, H, 0], rot: [Math.PI / 2, 0, 0] }, 4, 20);
    p.torus('metal', rT * 0.93, 0.006, C.steelDark, { pos: [0, H * 0.55, 0], rot: [Math.PI / 2, 0, 0] }, 4, 20);
    p.torus('metal', rT, 0.006, C.steelDark, { pos: [0, H, 0], rot: [0, 0, 0] }, 4, 14, Math.PI);
    p.cyl('paint', 0.016, 0.016, 0.1, C.black, { pos: [0, H + rT, 0] }, 8, 'x');
    this.kit.mesh(p, this.bucket, 'bucket');
    const gp = new Parts();
    glove(gp);
    const g = this.kit.mesh(gp, this.bucket, 'hand');
    g.position.set(0, H + rT + 0.01, 0);
    orientGlove(g, [1, 0, 0], [0.15, -0.35, 1]);
    const hp = new Parts();
    hp.add('decal', hayGeo(true), 0xffffff);
    const hay = this.kit.mesh(hp, this.bucket, 'hay');
    hay.position.set(0, H * 0.72, 0);
    this.hay = hay;
  }
  protected animate(_dt: number, _time: number, s: State): void {
    const a = Math.sin(Math.PI * Math.max(0, Math.min(1, s.action)));
    this.bucket.position.set(0.26 - a * 0.05, -0.54 - a * 0.06, -0.62 - a * 0.14);
    this.bucket.rotation.set(0.45 + a * 0.9, -0.3, 0.05);
    setLoad(this.hay, s.load, this.hayBase);
    if (this.hay.visible) this.hay.position.y = 0.24 * (0.35 + 0.5 * s.load);
  }
}

// ---------------------------------------------------------------------------------------------

class VacuumVM extends BaseVM {
  private readonly wand = new THREE.Group();
  private readonly fan: THREE.Object3D;
  private readonly glowRing: THREE.Mesh;
  private fanA = 0;
  constructor() {
    super('vacuum');
    this.sway.add(this.wand);
    // canister (hip / backpack tank peeking in from the lower right)
    const cp = new Parts();
    cp.cyl('paint', 0.13, 0.13, 0.36, C.extraction, { pos: [0, 0, 0] }, 16, 'z');
    for (const z of [-0.15, 0.0, 0.15]) cp.cyl('metal', 0.135, 0.135, 0.02, C.steelDark, { pos: [0, 0, z] }, 16, 'z');
    cp.cyl('metal', 0.1, 0.1, 0.02, C.black, { pos: [0, 0, -0.18] }, 14, 'z');
    cp.cyl('glass', 0.085, 0.085, 0.01, 0xffffff, { pos: [0, 0, -0.192] }, 14, 'z');
    const can = this.kit.mesh(cp, this.sway, 'canister');
    can.position.set(0.46, -0.47, -0.56);
    can.rotation.set(0.2, -0.25, 0);
    const fp = new Parts();
    for (let k = 0; k < 4; k++) fp.box('paint', [0.14, 0.02, 0.005], C.factory, { rot: [0, 0, (k * Math.PI) / 4] });
    this.fan = this.kit.mesh(fp, can, 'fan');
    this.fan.position.set(0, 0, -0.185);
    // hose from canister to wand
    const hp = new Parts();
    hp.tube('matte', [[0.42, -0.36, -0.62], [0.3, -0.26, -0.66], [0.2, -0.22, -0.52], [0.17, -0.235, -0.4]], 0.028, 0x2e2e2e, 8);
    this.kit.mesh(hp, this.sway, 'hose');
    // wand + nozzle
    const wp = new Parts();
    wp.cyl('metal', 0.022, 0.022, 0.75, C.steelLight, { pos: [0, 0, -0.375] }, 10, 'z');
    wp.cyl('paint', 0.032, 0.032, 0.16, C.extraction, { pos: [0, 0, 0.0] }, 10, 'z');
    wp.cyl('paint', 0.1, 0.03, 0.14, C.frame, { pos: [0, 0, -0.8] }, 12, 'z', true);
    wp.torus('metal', 0.1, 0.012, C.black, { pos: [0, 0, -0.87] }, 5, 16);
    this.kit.mesh(wp, this.wand, 'wand');
    const gp = new Parts();
    glove(gp);
    const g = this.kit.mesh(gp, this.wand, 'hand');
    orientGlove(g, [0, 0, -1], [0.5, -0.45, 0.4]);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.01, 5, 16), glowMaterial());
    this.kit.geos.push(ring.geometry);
    ring.geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Array(ring.geometry.getAttribute('position').count * 3).fill(0).map((_, i) => [0.25, 0.95, 0.9][i % 3]), 3));
    ring.position.set(0, 0, -0.875);
    this.kit.prep(ring);
    this.wand.add(ring);
    this.glowRing = ring;
  }
  protected animate(dt: number, time: number, s: State): void {
    const suck = Math.max(0, Math.min(1, s.suck));
    const jx = suck * (Math.sin(time * 71) * 0.004 + Math.sin(time * 43) * 0.003);
    const jy = suck * Math.sin(time * 59) * 0.004;
    this.wand.position.set(0.17 + jx, -0.25 + jy, -0.38);
    this.wand.rotation.set(-0.3, 0.16, 0);
    this.fanA = (this.fanA + dt * (2 + suck * 40)) % (Math.PI * 2);
    this.fan.rotation.z = this.fanA;
    this.glowRing.visible = suck > 0.05;
    if (this.glowRing.visible) this.glowRing.scale.setScalar(0.9 + 0.12 * Math.sin(time * 30));
  }
}

// ---------------------------------------------------------------------------------------------

type Reading = NonNullable<State['detector']>;

class DetectorVM extends BaseVM {
  private readonly tool = new THREE.Group();
  private readonly canvas: HTMLCanvasElement | null;
  private readonly tex: THREE.Texture;
  private readonly coilGlow: THREE.Mesh;
  private key = '';
  private blink = 0;

  constructor() {
    super('detector');
    this.sway.add(this.tool);
    const p = new Parts();
    // shaft: grip + arm cuff near the hand, telescoping pole down to the coil
    p.cyl('matte', 0.02, 0.02, 0.14, C.black, { pos: [0, 0, 0] }, 8, 'z');
    p.cyl('metal', 0.014, 0.014, 0.9, C.steelLight, { pos: [0, 0, -0.5] }, 8, 'z');
    p.cyl('paint', 0.018, 0.018, 0.12, C.detection, { pos: [0, 0, -0.45] }, 8, 'z');
    // control box with the screen on top
    p.bev('paint', [0.14, 0.1, 0.08], 0.015, C.detection, { pos: [0, 0.07, -0.14], rot: [-0.35, 0, 0] });
    p.bev('paint', [0.125, 0.082, 0.01], 0.004, C.black, { pos: [0, 0.084, -0.098], rot: [-0.35, 0, 0] });
    p.cyl('paint', 0.012, 0.012, 0.02, 0xd33a2c, { pos: [0.055, 0.13, -0.15] }, 6);
    p.cyl('metal', 0.012, 0.012, 0.07, C.steelLight, { pos: [0, 0.03, -0.14] }, 6);
    // coil
    p.torus('paint', 0.13, 0.018, C.frame, { pos: [0, -0.02, -0.98], rot: [Math.PI / 2, 0, 0] }, 6, 20);
    p.cyl('paint', 0.11, 0.11, 0.012, C.detection, { pos: [0, -0.02, -0.98] }, 18);
    p.rod('metal', [0, 0, -0.9], [0, -0.02, -0.98], 0.012, C.steelLight, 6);
    this.kit.mesh(p, this.tool, 'detector');
    const gp = new Parts();
    glove(gp);
    const g = this.kit.mesh(gp, this.tool, 'hand');
    orientGlove(g, [0, 0, -1], [0.5, -0.45, 0.4]);
    // screen (canvas texture)
    this.canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    if (this.canvas) { this.canvas.width = 256; this.canvas.height = 160; }
    this.tex = this.canvas ? new THREE.CanvasTexture(this.canvas) : new THREE.Texture();
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const sm = new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false });
    this.kit.mats.push(sm);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.112, 0.07), sm);
    this.kit.geos.push(screen.geometry);
    screen.rotation.x = -0.35;
    screen.position.set(0, 0.085, -0.0915);
    this.kit.prep(screen);
    this.tool.add(screen);
    // coil glow ring
    this.coilGlow = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.006, 4, 24), emissiveMaterial(COLORS.detection, 0.2));
    this.kit.geos.push(this.coilGlow.geometry);
    this.coilGlow.rotation.x = Math.PI / 2;
    this.coilGlow.position.set(0, -0.012, -0.98);
    this.kit.prep(this.coilGlow);
    this.tool.add(this.coilGlow);
    this.draw(undefined, 0);
  }

  private draw(d: Reading | undefined, time: number): void {
    const c = this.canvas;
    if (!c) return;
    const g = c.getContext('2d');
    if (!g) return;
    const W = c.width, H = c.height;
    g.fillStyle = '#062421'; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(63,245,230,0.12)'; g.lineWidth = 1;
    for (let y = 4; y < H; y += 6) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    const strength = d ? Math.max(0, Math.min(1, d.strength)) : 0;
    // strength bars
    const n = 10, bw = (W - 40) / n;
    for (let i = 0; i < n; i++) {
      const on = strength * n > i + 0.01;
      const col = i < 4 ? '#3ff5a0' : i < 7 ? '#ffe23a' : '#ff5a3a';
      g.fillStyle = on ? col : 'rgba(63,245,230,0.12)';
      const h = 10 + i * 3;
      g.fillRect(20 + i * bw + 2, H - 14 - h, bw - 4, h);
    }
    g.fillStyle = '#3ff5e6';
    g.font = '700 20px "Arial Black", Arial, sans-serif';
    g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillText('NEEDLE-DAR', 14, 10);
    if (!d) { g.fillStyle = 'rgba(63,245,230,0.5)'; g.fillText('READY', 14, 42); }
    else if (d.tooDeep && strength < 0.05) {
      if (Math.sin(time * 8) > -0.3) { g.fillStyle = '#ffb020'; g.font = '900 30px "Arial Black", Arial, sans-serif'; g.fillText('TOO DEEP', 14, 44); }
    } else {
      if (d.precise && strength > 0.01) {
        g.fillStyle = '#e8fffd'; g.font = '900 34px "Arial Black", Arial, sans-serif';
        g.fillText(`${d.distance.toFixed(1)} m`, 14, 40);
      } else if (strength > 0.01) {
        g.fillStyle = '#e8fffd'; g.font = '900 30px "Arial Black", Arial, sans-serif';
        g.fillText(strength > 0.7 ? 'HOT!' : strength > 0.35 ? 'WARM' : 'COLD', 14, 42);
      } else { g.fillStyle = 'rgba(63,245,230,0.5)'; g.fillText('NO SIGNAL', 14, 44); }
      if (d.directional && strength > 0.01) {
        g.save();
        g.translate(W - 46, 60);
        g.rotate(d.dirAngle);
        g.fillStyle = '#3ff5e6';
        g.beginPath(); g.moveTo(0, -30); g.lineTo(20, 4); g.lineTo(7, 4); g.lineTo(7, 26); g.lineTo(-7, 26); g.lineTo(-7, 4); g.lineTo(-20, 4); g.closePath(); g.fill();
        g.restore();
      }
    }
    this.tex.needsUpdate = true;
  }

  protected animate(dt: number, time: number, s: State): void {
    const d = s.detector;
    this.tool.position.set(0.17, -0.2, -0.3);
    this.tool.rotation.set(-0.5 + Math.sin(time * 1.3) * 0.02, 0.16 + Math.sin(time * 0.9) * 0.03, 0);
    const strength = d ? Math.max(0, Math.min(1, d.strength)) : 0;
    const blinkOn = d?.tooDeep && strength < 0.05 ? Math.sin(time * 8) > -0.3 : true;
    const key = d
      ? `${Math.round(strength * 10)}|${d.directional ? Math.round(d.dirAngle * 12) : 0}|${d.precise ? Math.round(d.distance * 10) : 0}|${d.tooDeep ? 1 : 0}|${d.directional ? 1 : 0}|${d.precise ? 1 : 0}|${blinkOn ? 1 : 0}`
      : 'none';
    if (key !== this.key) { this.key = key; this.draw(d, time); }
    // coil pulses faster when closer
    this.blink = (this.blink + dt * (1 + strength * 9)) % 1;
    const glow = strength > 0.01 ? 0.3 + strength * 2.6 * (this.blink < 0.5 ? 1 : 0.35) : 0.15;
    this.coilGlow.material = emissiveMaterial(COLORS.detection, Math.round(glow * 5) / 5);
  }
}

// ---------------------------------------------------------------------------------------------

class BarrowHandlesVM extends BaseVM {
  constructor() {
    super('wheelbarrow');
    for (const s of [-1, 1]) {
      const p = new Parts();
      p.rod('metal', [0, 0, 0.05], [s * -0.04, -0.36, -0.95], 0.022, C.steelDark, 8);
      p.cyl('matte', 0.03, 0.03, 0.2, C.black, { pos: [0, 0, 0] }, 8, 'z');
      const bar = this.kit.mesh(p, this.sway, s < 0 ? 'leftBar' : 'rightBar');
      bar.position.set(s * 0.24, -0.27, -0.42);
      const gp = new Parts();
      glove(gp, s < 0);
      const g = this.kit.mesh(gp, bar, 'hand');
      orientGlove(g, [0, 0, -1], [s * 0.15, -1, 0.35]);
    }
  }
  protected animate(_dt: number, time: number, s: State): void {
    const w = Math.max(0, Math.min(1, s.walking));
    // pushing: handles rock slightly as the wheel rolls
    this.sway.position.y += Math.sin(time * 12.4) * 0.004 * w;
  }
}

export function buildToolViewModel(kind: ToolViewKind): ToolViewModel {
  switch (kind) {
    case 'hands': return new HandsVM();
    case 'shovel': return new LongToolVM('shovel');
    case 'pitchfork': return new LongToolVM('pitchfork');
    case 'bucket': return new BucketVM();
    case 'vacuum': return new VacuumVM();
    case 'detector': return new DetectorVM();
    case 'wheelbarrow': return new BarrowHandlesVM();
    default: return new HandsVM();
  }
}
