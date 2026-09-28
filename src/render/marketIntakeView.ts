import * as THREE from 'three';
import { WORLD } from '../config/world';
import type { IntakeLoad } from '../sim/machines/sellStation';
import type { Sim } from '../sim/sim';
import { createConveyorGeometry } from './models/index';
import { Parts, shade } from './models/parts';
import { strawHeapGeometry } from './models/strawHeap';
import { modelMaterial } from './models/materials';
import { COLORS, paintGeometry, paletteMaterial } from './palette';
import { beltTexture } from './textures';

/**
 * Market intake + Store kiosk (render only; the sim side is SellStation.depositIntake / WORLD.intake / WORLD.store).
 *   - Intake belt: 4 straight conveyor tiles (the SAME tile geometry and belt texture as player-built belts, so it
 *     reads as "a conveyor"), running south along the west wall into the Market Chute. 2 draw calls (instanced).
 *   - Hay bundles riding it: ONE InstancedMesh (max MAX_BUNDLES), 1-3 chunky bundles per dropped load, whatever the
 *     logical amount. The money still comes from the sim when a load arrives.
 *   - Drop-zone highlight (shown while the player aims at the belt carrying something) and a "SELL HAY" sign.
 *   - Store kiosk: a small stall (one merged mesh) + sign. Opens the Shop with E (game layer).
 */

const MAX_BUNDLES = 30;
const TILE_COUNT = WORLD.intake.z1 - WORLD.intake.z0;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();

/** Canvas sign (big bold label + optional icon glyph). Cheap: one small texture per sign. */
function signTexture(text: string, bg: string, fg: string, sub?: string): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 512; c.height = 160;
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = bg; g.fillRect(0, 0, 512, 160);
  g.strokeStyle = fg; g.lineWidth = 10; g.strokeRect(8, 8, 496, 144);
  g.fillStyle = fg;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `900 ${sub ? 70 : 84}px Rubik, "Segoe UI", system-ui, sans-serif`;
  g.fillText(text, 256, sub ? 64 : 82);
  if (sub) { g.font = '700 34px Rubik, "Segoe UI", system-ui, sans-serif'; g.fillText(sub, 256, 124); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class MarketIntakeView {
  readonly root = new THREE.Group();
  private readonly beltMap: THREE.Texture;
  private readonly beltMat: THREE.MeshStandardMaterial;
  private readonly bundles: THREE.InstancedMesh;
  private readonly highlight: THREE.Mesh;
  private readonly disposables: { dispose(): void }[] = [];
  private scroll = 0;
  private flash = 0;

  constructor(scene: THREE.Scene) {
    this.root.name = 'marketIntake';
    const I = WORLD.intake;
    const cx = I.x + 0.5;

    // ----- belt: straight tiles, travel +Z (tile local +X rotated by -90° about Y)
    const g = createConveyorGeometry('straight');
    if (!g.frame.getAttribute('color')) paintGeometry(g.frame, COLORS.logistics);
    this.beltMap = beltTexture().clone();
    this.beltMap.wrapS = THREE.RepeatWrapping;
    this.beltMap.wrapT = THREE.RepeatWrapping;
    this.beltMap.needsUpdate = true;
    this.beltMat = new THREE.MeshStandardMaterial({ map: this.beltMap, roughness: 0.88, metalness: 0.05 });
    const frame = new THREE.InstancedMesh(g.frame, paletteMaterial(), TILE_COUNT);
    const belt = g.belt ? new THREE.InstancedMesh(g.belt, this.beltMat, TILE_COUNT) : null;
    _q.setFromEuler(_e.set(0, -Math.PI / 2, 0));
    _s.set(1, 1, 1);
    for (let k = 0; k < TILE_COUNT; k++) {
      _p.set(cx, 0, I.z0 + k + 0.5);
      _m.compose(_p, _q, _s);
      frame.setMatrixAt(k, _m);
      belt?.setMatrixAt(k, _m);
    }
    for (const m of [frame, belt]) {
      if (!m) continue;
      m.castShadow = true; m.receiveShadow = true;
      m.computeBoundingSphere();
      this.root.add(m);
    }
    this.disposables.push(g.frame, this.beltMat, this.beltMap);
    if (g.belt) this.disposables.push(g.belt);

    // ----- static details: rubber flap into the chute, side guards, floor drop pad, SELL HAY sign
    const p = new Parts();
    const z1 = I.z1;
    // flap curtain where the belt enters the chute
    for (let k = 0; k < 4; k++) p.box('matte', [0.19, 0.46, 0.03], 0x2a2a2a, { pos: [cx - 0.3 + k * 0.2, I.beltY + 0.28, z1 - 0.06] });
    p.box('paint', [0.96, 0.12, 0.14], COLORS.logistics, { pos: [cx, I.beltY + 0.58, z1 - 0.06] });
    // low side guard on the wall side + short one on the open side near the chute
    p.box('paint', [0.06, 0.2, TILE_COUNT - 0.1], shade(COLORS.logistics, 0.8), { pos: [I.x + 0.07, I.beltY + 0.12, (I.z0 + z1) / 2] });
    // drop pad painted on the floor next to the belt (yellow/black)
    const padW = I.dropPadX1 - (I.x + 1.1), padX = I.x + 1.1 + padW / 2; // part of the drop zone (INTAKE_AIM_BOX)
    p.box('paint', [padW, 0.012, TILE_COUNT - 0.4], 0xf2c14e, { pos: [padX, 0.006, (I.z0 + z1) / 2] });
    p.box('paint', [padW - 0.2, 0.014, TILE_COUNT - 0.8], 0x2a2620, { pos: [padX, 0.007, (I.z0 + z1) / 2] });
    // sign gantry: the belt stands in the loading doorway, so the sign hangs on its own two posts (not on air)
    const sz = (I.z0 + z1) / 2 - 0.3;
    for (const dz of [-1.08, 1.08]) p.box('paint', [0.08, 2.72, 0.08], 0x2b2f33, { pos: [I.x + 0.07, 1.36, sz + dz] });
    p.box('paint', [0.05, 0.72, 2.12], 0x2b2f33, { pos: [I.x + 0.07, 2.35, sz] });
    const built = p.build();
    if (built.main) {
      const mesh = new THREE.Mesh(built.main, modelMaterial());
      mesh.receiveShadow = true;
      this.root.add(mesh);
      this.disposables.push(built.main);
    }
    this.addSign('SELL HAY', '#1b1a17', '#f2c14e', 'drop it on the belt', I.x + 0.1, 2.35, sz, 2.0, 0.62);

    // ----- aim highlight (a glowing outline box just above the belt)
    const hg = new THREE.BoxGeometry(1.02, 0.36, TILE_COUNT + 0.02);
    this.disposables.push(hg);
    const hm = new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.18, depthWrite: false });
    this.disposables.push(hm);
    this.highlight = new THREE.Mesh(hg, hm);
    this.highlight.position.set(cx, I.beltY + 0.18, (I.z0 + z1) / 2);
    this.highlight.visible = false;
    this.root.add(this.highlight);

    // ----- hay bundles: straw mini-heaps (same family as the belt items), slight per-instance tint
    const bg = strawHeapGeometry(2, { radius: 0.26, height: 0.24, sticks: 60 });
    const bm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
    this.disposables.push(bg, bm);
    this.bundles = new THREE.InstancedMesh(bg, bm, MAX_BUNDLES);
    this.bundles.count = 0;
    this.bundles.castShadow = true;
    this.bundles.frustumCulled = false;
    for (let k = 0; k < MAX_BUNDLES; k++) this.bundles.setColorAt(k, _c.setRGB(1, 1, 1));
    this.root.add(this.bundles);

    this.buildStore();
    scene.add(this.root);
  }

  private addSign(text: string, bg: string, fg: string, sub: string | undefined, x: number, y: number, z: number, w: number, h: number): void {
    const tex = signTexture(text, bg, fg, sub);
    const geo = new THREE.PlaneGeometry(w, h);
    const mat = tex ? new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }) : new THREE.MeshBasicMaterial({ color: bg });
    const sign = new THREE.Mesh(geo, mat);
    sign.position.set(x, y, z);
    sign.rotation.y = Math.PI / 2; // faces +X (into the hall)
    this.root.add(sign);
    this.disposables.push(geo, mat);
    if (tex) this.disposables.push(tex);
  }

  /** Store kiosk: counter + back board + striped awning, against the west wall. */
  private buildStore(): void {
    const S = WORLD.store;
    const x0 = S.x, zc = (S.z0 + S.z1) / 2, len = S.z1 - S.z0 - 0.45; // clear of the door post (z = 1) and the order board
    const TEAL = 0x2f7f8f, TEAL_DK = shade(0x2f7f8f, 0.7), WHITE = 0xf1ece0, WOOD = 0x9a6a3c;
    const p = new Parts();
    // counter (front at x0 + 0.95)
    p.bev('paint', [0.8, 1.0, len - 0.1], 0.03, TEAL, { pos: [x0 + 0.55, 0.5, zc] });
    p.bev('paint', [0.9, 0.07, len], 0.02, WOOD, { pos: [x0 + 0.57, 1.04, zc] });
    p.box('paint', [0.02, 0.5, len - 0.4], TEAL_DK, { pos: [x0 + 0.96, 0.5, zc] });
    // back board + posts
    p.box('paint', [0.08, 2.3, len], shade(TEAL, 0.85), { pos: [x0 + 0.06, 1.15, zc] });
    for (const dz of [-len / 2 + 0.06, len / 2 - 0.06]) p.box('paint', [0.07, 2.35, 0.07], WHITE, { pos: [x0 + 0.95, 1.18, zc + dz] });
    // striped awning (sloped towards the hall)
    const stripes = 6;
    for (let k = 0; k < stripes; k++) {
      p.box('paint', [1.2, 0.05, len / stripes], k % 2 ? WHITE : TEAL, { pos: [x0 + 0.62, 2.42, zc - len / 2 + (k + 0.5) * (len / stripes)], rot: [0, 0, -0.22] });
    }
    // a few "goods" on the counter: tool silhouettes as simple blocks
    p.box('metal', [0.1, 0.34, 0.1], 0x8a949a, { pos: [x0 + 0.5, 1.25, zc - 0.5] });
    p.cyl('paint', 0.12, 0.14, 0.2, 0xd4523b, { pos: [x0 + 0.5, 1.18, zc + 0.45] }, 10);
    const built = p.build();
    if (built.main) {
      const mesh = new THREE.Mesh(built.main, modelMaterial());
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.root.add(mesh);
      this.disposables.push(built.main);
    }
    this.addSign('STORE', '#1f5f6b', '#fff3d0', 'tools & upgrades', x0 + 0.2, 2.95, zc, 1.6, 0.5);
  }

  /** Per frame: belt scroll, bundles from the chute's intake loads, highlight. */
  update(dt: number, sim: Sim, aimed: boolean, carrying: boolean): void {
    const I = WORLD.intake;
    const len = I.z1 - I.z0;
    const speed = len / I.transitSeconds;
    this.scroll = (this.scroll + dt * speed) % 1;
    this.beltMap.offset.y = -this.scroll;

    this.highlight.visible = aimed && carrying;
    if (this.highlight.visible) {
      this.flash += dt;
      (this.highlight.material as THREE.MeshBasicMaterial).opacity = 0.14 + 0.08 * (0.5 + 0.5 * Math.sin(this.flash * 6));
    }

    const chute = sim.sellStation as unknown as { intakeLoads?(): readonly IntakeLoad[] } | undefined;
    const loads = chute?.intakeLoads?.() ?? [];
    let n = 0;
    const cx = I.x + 0.5;
    for (let li = 0; li < loads.length && n < MAX_BUNDLES; li++) {
      const l = loads[li];
      const amount = l.hay + l.bale * 40 + l.wrapped * 40;
      const count = amount >= 80 ? 3 : amount >= 25 ? 2 : 1;
      const f = Math.min(1, l.t / I.transitSeconds);
      for (let k = 0; k < count && n < MAX_BUNDLES; k++) {
        const z = I.z0 + 0.35 + f * (len - 0.2) - k * 0.42;
        if (z < I.z0 + 0.1 || z > I.z1 - 0.05) continue;
        const seed = (li * 7 + k * 13) % 17;
        const bob = Math.sin((l.t * 9) + seed) * 0.012;
        _p.set(cx + ((seed % 3) - 1) * 0.1, I.beltY + 0.005 + Math.max(0, bob), z);
        _q.setFromEuler(_e.set(0, seed * 0.7, 0));
        const sc = 0.85 + (seed % 5) * 0.08;
        _s.set(sc, sc, sc);
        _m.compose(_p, _q, _s);
        this.bundles.setMatrixAt(n, _m);
        this.bundles.setColorAt(n, _c.setRGB(1, 0.94 + (seed % 3) * 0.03, 0.9 + (seed % 5) * 0.025));
        n++;
      }
    }
    this.bundles.count = n;
    this.bundles.instanceMatrix.needsUpdate = true;
    if (this.bundles.instanceColor) this.bundles.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.root.removeFromParent();
  }
}

/** Ray vs axis-aligned box (world): distance to the entry point, or null. */
export function rayBox(o: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }, b: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }): number | null {
  let tmin = 0, tmax = Infinity;
  for (const [oa, da, a0, a1] of [[o.x, d.x, b.x0, b.x1], [o.y, d.y, b.y0, b.y1], [o.z, d.z, b.z0, b.z1]] as const) {
    if (Math.abs(da) < 1e-9) { if (oa < a0 || oa > a1) return null; continue; }
    let t0 = (a0 - oa) / da, t1 = (a1 - oa) / da;
    if (t0 > t1) [t0, t1] = [t1, t0];
    tmin = Math.max(tmin, t0); tmax = Math.min(tmax, t1);
    if (tmin > tmax) return null;
  }
  return tmin;
}

/** Aim boxes (world metres) of the intake drop zone (belt + drop pad in front of it) and of the Store kiosk. */
export const INTAKE_AIM_BOX = { x0: WORLD.intake.x, x1: WORLD.intake.dropPadX1, y0: 0, y1: WORLD.intake.beltY + 0.7, z0: WORLD.intake.z0, z1: WORLD.intake.z1 };
export const STORE_AIM_BOX = { x0: WORLD.store.x, x1: WORLD.store.x + 1.05, y0: 0, y1: 2.6, z0: WORLD.store.z0 + 0.2, z1: WORLD.store.z1 - 0.2 };
