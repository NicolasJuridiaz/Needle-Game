import * as THREE from 'three';
import { BUILDABLES } from '../config/buildables';
import { WORLD } from '../config/world';
import { buildingCenter, localToOffset } from '../sim/grid';
import type { BeltPlanStep } from '../sim/interfaces';
import type { BuildingType, Cell, Dir, Rot, WorldPort } from '../sim/types';
import { DIR_DX, DIR_DZ } from '../sim/types';
import type { ModelInstance } from './models/api';
import { createConveyorGeometry, createModel } from './models/index';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _up = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();

const VALID_COLOR = 0x4dff6a;
const INVALID_COLOR = 0xff4040;
const OUT_COLOR = 0x2fcf4f, OUT_CONNECTED = 0xb8ffb8;
const IN_COLOR = 0x2f7dff, IN_CONNECTED = 0xb5dcff;
const FLOW_COLOR = 0xf2f2f2;

interface GhostModel {
  key: string;
  model: ModelInstance;
  meshes: THREE.Mesh[];
  originals: (THREE.Material | THREE.Material[])[];
  hidden: THREE.Object3D[];
  valid: boolean | null;
}

/** Growable InstancedMesh with per-instance colours. */
class InstancePool {
  mesh: THREE.InstancedMesh;
  count = 0;
  constructor(private readonly parent: THREE.Object3D, private readonly geo: THREE.BufferGeometry, private readonly mat: THREE.Material, private cap: number, private readonly colored: boolean, private readonly order: number) {
    this.mesh = this.make();
  }
  private make(): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(this.geo, this.mat, this.cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (this.colored) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    m.count = 0;
    m.renderOrder = this.order;
    m.castShadow = false;
    m.receiveShadow = false;
    this.parent.add(m);
    return m;
  }
  begin(): void { this.count = 0; }
  push(matrix: THREE.Matrix4, color?: number): void {
    if (this.count >= this.cap) {
      // Grow (rare: very long belt paths). The old contents are rewritten this frame anyway.
      const old = this.mesh;
      this.cap *= 2;
      this.mesh = this.make();
      for (let i = 0; i < this.count; i++) {
        old.getMatrixAt(i, _m2);
        this.mesh.setMatrixAt(i, _m2);
        if (this.colored) { old.getColorAt(i, _c2); this.mesh.setColorAt(i, _c2); }
      }
      old.removeFromParent();
      old.dispose();
    }
    this.mesh.setMatrixAt(this.count, matrix);
    if (this.colored && color !== undefined) this.mesh.setColorAt(this.count, _c.setHex(color));
    this.count++;
  }
  end(): void {
    this.mesh.count = this.count;
    this.mesh.visible = this.count > 0;
    if (this.count > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }
  dispose(): void { this.mesh.removeFromParent(); this.mesh.dispose(); }
}
const _m2 = new THREE.Matrix4();
const _c2 = new THREE.Color();

/** Flat arrow in the XZ plane pointing +X (~0.5 m long). */
function arrowGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0.26, 0);
  s.lineTo(0.02, 0.2);
  s.lineTo(0.02, 0.08);
  s.lineTo(-0.24, 0.08);
  s.lineTo(-0.24, -0.08);
  s.lineTo(0.02, -0.08);
  s.lineTo(0.02, -0.2);
  s.closePath();
  return new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2);
}

/**
 * Build preview: the real model with a translucent green/red override material, a footprint cell
 * overlay, and port arrows (green = output, blue = input, brighter + larger when they would connect).
 * Belt paths are drawn as instanced ghost conveyor tiles (ramps / lifts as ghost models) with flow arrows.
 */
export class Ghost {
  private readonly root = new THREE.Group();
  private readonly validMat: THREE.MeshStandardMaterial;
  private readonly invalidMat: THREE.MeshStandardMaterial;
  private readonly cellMat: THREE.MeshBasicMaterial;
  private readonly arrowMat: THREE.MeshBasicMaterial;
  private readonly cellGeo: THREE.BufferGeometry;
  private readonly arrowGeo: THREE.BufferGeometry;
  private readonly tileFrameGeo: THREE.BufferGeometry;
  private readonly tileBeltGeo: THREE.BufferGeometry;
  private readonly cells: InstancePool;
  private readonly arrows: InstancePool;
  private readonly tileFrames: InstancePool;
  private readonly tileBelts: InstancePool;
  /** Ghost models pooled by type|variant (several copies for belt paths with ramps / lifts). */
  private readonly pool = new Map<string, GhostModel[]>();
  private readonly used = new Map<string, number>();

  constructor(private readonly scene: THREE.Scene) {
    this.root.name = 'ghost';
    const ghostMat = (color: number) => new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 0.35, transparent: true, opacity: 0.42, depthWrite: false, roughness: 0.6, metalness: 0,
    });
    this.validMat = ghostMat(VALID_COLOR);
    this.invalidMat = ghostMat(INVALID_COLOR);
    this.cellMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.arrowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false, depthTest: false, toneMapped: false, side: THREE.DoubleSide });
    this.cellGeo = new THREE.PlaneGeometry(0.92, 0.92).rotateX(-Math.PI / 2);
    this.arrowGeo = arrowGeometry();
    const tile = createConveyorGeometry('straight');
    this.tileFrameGeo = tile.frame;
    this.tileBeltGeo = tile.belt;
    this.cells = new InstancePool(this.root, this.cellGeo, this.cellMat, 64, true, 7);
    this.arrows = new InstancePool(this.root, this.arrowGeo, this.arrowMat, 32, true, 9);
    this.tileFrames = new InstancePool(this.root, this.tileFrameGeo, this.validMat, 64, false, 8);
    this.tileBelts = new InstancePool(this.root, this.tileBeltGeo, this.validMat, 64, false, 8);
    this.root.visible = false;
    scene.add(this.root);
  }

  // ---------------------------------------------------------------------------------------------
  // Model pool
  // ---------------------------------------------------------------------------------------------

  private beginModels(): void { for (const k of this.used.keys()) this.used.set(k, 0); }

  private takeModel(type: BuildingType, variant: string | undefined): GhostModel {
    const key = `${type}|${variant ?? ''}`;
    let list = this.pool.get(key);
    if (!list) { list = []; this.pool.set(key, list); }
    const n = this.used.get(key) ?? 0;
    this.used.set(key, n + 1);
    let g = list[n];
    if (!g) {
      const model = createModel(type, { variant });
      model.setStatus('idle');
      const meshes: THREE.Mesh[] = [];
      const originals: (THREE.Material | THREE.Material[])[] = [];
      const hidden: THREE.Object3D[] = [];
      model.root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          meshes.push(m); originals.push(m.material);
          m.castShadow = false; m.receiveShadow = false;
          m.renderOrder = 8;
        } else if ((o as THREE.Line).isLine || (o as THREE.Points).isPoints || (o as THREE.Sprite).isSprite || (o as THREE.Light).isLight) {
          hidden.push(o); o.visible = false;
        }
      });
      model.root.traverse((o) => { o.raycast = () => { /* ghosts are never picked */ }; });
      g = { key, model, meshes, originals, hidden, valid: null };
      list.push(g);
      this.root.add(model.root);
    }
    g.model.root.visible = true;
    return g;
  }

  private endModels(): void {
    for (const [key, list] of this.pool) {
      const n = this.used.get(key) ?? 0;
      for (let i = n; i < list.length; i++) list[i].model.root.visible = false;
    }
  }

  private setModelValid(g: GhostModel, valid: boolean): void {
    if (g.valid === valid) return;
    g.valid = valid;
    const mat = valid ? this.validMat : this.invalidMat;
    for (const m of g.meshes) m.material = mat;
  }

  private placeModel(g: GhostModel, type: BuildingType, cell: Cell, rot: Rot): void {
    const c = buildingCenter(type, cell, rot);
    g.model.root.position.set(c.x, c.y + 0.01, c.z);
    g.model.root.rotation.set(0, -rot * Math.PI / 2, 0);
  }

  // ---------------------------------------------------------------------------------------------
  // Overlays
  // ---------------------------------------------------------------------------------------------

  private pushFootprint(type: BuildingType, cell: Cell, rot: Rot, color: number): void {
    const [w, d] = BUILDABLES[type].footprint;
    const y = cell.level * WORLD.levelHeight + 0.03;
    _q.identity();
    for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) {
      const [dx, dz] = localToOffset(i, j, w, d, rot);
      _p.set(cell.x + dx + 0.5, y, cell.z + dz + 0.5);
      _m.compose(_p, _q, _s);
      this.cells.push(_m, color);
    }
  }

  private pushArrow(x: number, y: number, z: number, dir: Dir, color: number, scale: number): void {
    _q.setFromAxisAngle(_up, -dir * Math.PI / 2);
    _p.set(x, y, z);
    _s.set(scale, 1, scale);
    _m.compose(_p, _q, _s);
    _s.set(1, 1, 1);
    this.arrows.push(_m, color);
  }

  private pushPort(p: WorldPort, connected: boolean): void {
    const out = p.kind === 'out';
    const edge = out ? 0.78 : 0.72;
    const x = p.cell.x + 0.5 + DIR_DX[p.dir] * edge;
    const z = p.cell.z + 0.5 + DIR_DZ[p.dir] * edge;
    const y = p.cell.level * WORLD.levelHeight + WORLD.beltHeight + 0.05;
    const dir = (out ? p.dir : (p.dir + 2) & 3) as Dir;
    const color = out ? (connected ? OUT_CONNECTED : OUT_COLOR) : (connected ? IN_CONNECTED : IN_COLOR);
    this.pushArrow(x, y, z, dir, color, connected ? 1.25 : 0.9);
  }

  private beginOverlays(): void {
    this.cells.begin(); this.arrows.begin(); this.tileFrames.begin(); this.tileBelts.begin();
  }

  private endOverlays(): void {
    this.cells.end(); this.arrows.end(); this.tileFrames.end(); this.tileBelts.end();
  }

  // ---------------------------------------------------------------------------------------------
  // Public API (driven by BuildMode through BuildVisuals)
  // ---------------------------------------------------------------------------------------------

  show(type: BuildingType, cell: Cell, rot: Rot, variant: string | undefined, valid: boolean, ports: readonly WorldPort[], connected: readonly boolean[]): void {
    this.root.visible = true;
    this.beginModels();
    this.beginOverlays();
    const g = this.takeModel(type, variant);
    this.setModelValid(g, valid);
    this.placeModel(g, type, cell, rot);
    this.pushFootprint(type, cell, rot, valid ? VALID_COLOR : INVALID_COLOR);
    for (let i = 0; i < ports.length; i++) this.pushPort(ports[i], !!connected[i]);
    this.endModels();
    this.endOverlays();
  }

  showBeltPath(steps: readonly BeltPlanStep[], valid: boolean): void {
    this.root.visible = true;
    this.beginModels();
    this.beginOverlays();
    const color = valid ? VALID_COLOR : INVALID_COLOR;
    const mat = valid ? this.validMat : this.invalidMat;
    this.tileFrames.mesh.material = mat;
    this.tileBelts.mesh.material = mat;
    for (const st of steps) {
      if (st.existing) continue;
      if (st.type === 'conveyor') {
        const c = buildingCenter('conveyor', st.cell, st.rot);
        _q.setFromAxisAngle(_up, -st.rot * Math.PI / 2);
        _p.set(c.x, c.y + 0.01, c.z);
        _m.compose(_p, _q, _s);
        this.tileFrames.push(_m);
        this.tileBelts.push(_m);
        this.pushFootprint('conveyor', st.cell, st.rot, color);
        this.pushArrow(c.x, c.y + WORLD.beltHeight + 0.06, c.z, st.rot, FLOW_COLOR, 0.8);
      } else {
        const g = this.takeModel(st.type, st.variant);
        this.setModelValid(g, valid);
        this.placeModel(g, st.type, st.cell, st.rot);
        this.pushFootprint(st.type, st.cell, st.rot, color);
      }
    }
    // Keep new tiles' material in sync if the pools grew this frame.
    this.tileFrames.mesh.material = mat;
    this.tileBelts.mesh.material = mat;
    this.endModels();
    this.endOverlays();
  }

  hide(): void {
    this.root.visible = false;
  }

  dispose(): void {
    this.scene.remove(this.root);
    for (const list of this.pool.values()) for (const g of list) {
      for (let i = 0; i < g.meshes.length; i++) g.meshes[i].material = g.originals[i];
      for (const o of g.hidden) o.visible = true;
      g.model.root.removeFromParent();
      g.model.dispose();
    }
    this.pool.clear();
    this.used.clear();
    this.cells.dispose(); this.arrows.dispose(); this.tileFrames.dispose(); this.tileBelts.dispose();
    this.cellGeo.dispose(); this.arrowGeo.dispose(); this.tileFrameGeo.dispose(); this.tileBeltGeo.dispose();
    this.validMat.dispose(); this.invalidMat.dispose(); this.cellMat.dispose(); this.arrowMat.dispose();
  }
}
