import * as THREE from 'three';
import { WORLD } from '../config/world';
import { SupplyStall } from './supplyStall';
import { getSupplyBounds } from '../sim/supplyBounds';
import type { IntakeLoad } from '../sim/machines/sellStation';
import type { Sim } from '../sim/sim';
import { createConveyorGeometry } from './models/index';
import { Parts, shade } from './models/parts';
import { strawHeapGeometry } from './models/strawHeap';
import { modelMaterial } from './models/materials';
import { COLORS, paintGeometry, paletteMaterial } from './palette';
import { beltTexture } from './textures';

/**
 * SELL HAY intake + SUPPLY CO. stand (render only; the sim side is SellStation.depositIntake / WORLD.intake / WORLD.store).
 *   - Intake belt: 4 straight conveyor tiles (the SAME tile geometry and belt texture as player-built belts, so it
 *     reads as "a conveyor"), running south along the west wall into SELL HAY. 2 draw calls (instanced).
 *   - Hay bundles riding it: ONE InstancedMesh (max MAX_BUNDLES), 1-3 chunky bundles per dropped load, whatever the
 *     logical amount. The money still comes from the sim when a load arrives.
 *   - Drop-zone highlight (shown while the player aims at the belt carrying something) and a "SELL HAY" sign.
 *   - SUPPLY CO.: timber counter, displayed tools and live price board. Opens the catalog with E.
 */

const MAX_BUNDLES = 30;
const TILE_COUNT = WORLD.intake.z1 - WORLD.intake.z0;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();

export class MarketIntakeView {
  readonly root = new THREE.Group();
  private readonly beltMap: THREE.Texture;
  private readonly beltMat: THREE.MeshStandardMaterial;
  private readonly bundles: THREE.InstancedMesh;
  private readonly highlight: THREE.Mesh;
  private readonly disposables: { dispose(): void }[] = [];
  private scroll = 0;
  private flash = 0;
  private readonly supply = new SupplyStall();
  private boundSim: Sim | null = null;
  private unbindSale: (() => void) | null = null;
  private saleValue = 0;
  private saleAge = Infinity;
  private displayDirty = true;
  private displayCooldown = 0;
  private readonly receiptCanvas = document.createElement('canvas');
  private readonly receiptMap: THREE.CanvasTexture;

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
    p.box('paint', [padW, 0.012, TILE_COUNT - 0.4], 0xb5a375, { pos: [padX, 0.006, (I.z0 + z1) / 2] });
    p.box('paint', [padW - 0.2, 0.014, TILE_COUNT - 0.8], 0x2a2620, { pos: [padX, 0.007, (I.z0 + z1) / 2] });
    const built = p.build();
    if (built.main) {
      const mesh = new THREE.Mesh(built.main, modelMaterial());
      mesh.receiveShadow = true;
      this.root.add(mesh);
      this.disposables.push(built.main);
    }


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

    const S = WORLD.store;
    this.supply.root.position.set(S.x, 0, (S.z0 + S.z1) / 2);
    this.root.add(this.supply.root);
    // A real cash readout on the register, fed only by the existing sale event.
    this.receiptCanvas.width = 384; this.receiptCanvas.height = 112;
    this.receiptMap = new THREE.CanvasTexture(this.receiptCanvas);
    this.receiptMap.colorSpace = THREE.SRGBColorSpace;
    const receiptMat = new THREE.MeshBasicMaterial({ map: this.receiptMap, toneMapped: false });
    const receiptGeo = new THREE.PlaneGeometry(.33, .096);
    const receipt = new THREE.Mesh(receiptGeo, receiptMat);
    receipt.rotation.y = Math.PI / 2;
    receipt.position.set(WORLD.fixed.sellStation.x + 1.5 + .94, 1.39, WORLD.fixed.sellStation.z + 2 + .22);
    this.root.add(receipt);
    this.disposables.push(this.receiptMap, receiptMat, receiptGeo);
    // Repeat the actual receipt in the scale's inset window (same texture and material).
    const scaleReadoutGeo = new THREE.PlaneGeometry(.264, .070);
    const scaleReadout = new THREE.Mesh(scaleReadoutGeo, receiptMat);
    scaleReadout.rotation.y = Math.PI / 2;
    scaleReadout.position.set(WORLD.fixed.sellStation.x + 1.5 + 1.166, 1.741, WORLD.fixed.sellStation.z + 2 - 1.13);
    this.root.add(scaleReadout); this.disposables.push(scaleReadoutGeo);
    scene.add(this.root);
  }

  /** Per frame: belt scroll, bundles from the chute's intake loads, highlight. */
  update(dt: number, sim: Sim, aimed: boolean, carrying: boolean): void {
    this.supply.update(sim);
    const supplyBounds = getSupplyBounds(sim);
    this.supply.root.position.z = (supplyBounds.z0 + supplyBounds.z1) / 2;
    this.supply.root.scale.z = (supplyBounds.z1 - supplyBounds.z0) / 4;
    if (this.boundSim !== sim) {
      this.unbindSale?.(); this.boundSim = sim;
      this.saleValue = 0; this.saleAge = Infinity; this.displayDirty = true;
      this.unbindSale = sim.events.on('sale', e => {
        this.saleValue = this.saleAge < .35 ? this.saleValue + e.value : e.value;
        this.saleAge = 0; this.displayDirty = true;
      });
    }
    this.saleAge += dt;
    this.displayCooldown -= dt;
    if (this.displayDirty && this.displayCooldown <= 0) {
      const g = this.receiptCanvas.getContext('2d');
      if (g) {
        g.fillStyle = '#17221c'; g.fillRect(0, 0, 384, 112);
        g.fillStyle = '#dfdfaa'; g.font = 'bold 64px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(`$${this.saleValue.toFixed(2)}`, 192, 58, 370);
        this.receiptMap.needsUpdate = true;
      }
      this.displayDirty = false; this.displayCooldown = .1;
    }
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
    this.unbindSale?.();
    this.supply.dispose();
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

/** The legacy compact variant uses the same bounds for aiming, collision and rendering. */
export function storeAimBox(sim: Sim): typeof STORE_AIM_BOX {
  const s = getSupplyBounds(sim);
  return { ...STORE_AIM_BOX, z0: s.z0 + .2, z1: s.z1 - .2 };
}
