import * as THREE from 'three';
import type { Building } from '../sim/building';
import { buildingCenter } from '../sim/grid';
import type { BeltItemView, ILogistics } from '../sim/interfaces';
import type { ItemType } from '../sim/types';
import { createConveyorGeometry, createItemGeometry, type ConveyorGeometryKind } from './models/index';
import type { ItemModelKind } from './models/api';
import { COLORS, paintGeometry, paletteMaterial } from './palette';
import { qualityProfile, type Quality } from './quality';
import { beltTexture } from './textures';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _up = new THREE.Vector3(0, 1, 0);

const TILE_KINDS: readonly ConveyorGeometryKind[] = ['straight', 'curveL', 'curveR', 'ramp', 'rampDown', 'legs'];
const ITEM_KINDS: readonly ItemType[] = ['hay', 'bale', 'wrapped'];
const ITEM_MODEL: Record<ItemType, ItemModelKind> = { hay: 'item:hay', bale: 'item:bale', wrapped: 'item:wrapped' };
const ITEM_COLOR: Record<ItemType, number> = { hay: COLORS.hay, bale: COLORS.hayDark, wrapped: COLORS.wrapFilm };
/** Belt texture repeats per metre of belt (UV v assumed to run 0..1 per metre along the belt). */
const BELT_REPEAT_PER_M = 1;

interface TileLayer {
  kind: ConveyorGeometryKind;
  frameGeo: THREE.BufferGeometry;
  beltGeo: THREE.BufferGeometry | null;
  frame: THREE.InstancedMesh | null;
  belt: THREE.InstancedMesh | null;
  capacity: number;
  count: number;
}

interface ItemLayer {
  type: ItemType;
  geo: THREE.BufferGeometry;
  mesh: THREE.InstancedMesh;
  capacity: number;
  count: number;
  overflow: boolean;
}

function hash01(n: number): number {
  let h = Math.imul(n ^ 0x5bd1e995, 0x9e3779b1) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0; h ^= h >>> 13;
  return (h >>> 0) / 0xffffffff;
}

/**
 * Conveyors + items on logistics.
 *  - Tiles: one InstancedMesh pair (frame + scrolling belt) per tile kind (straight / curveL / curveR /
 *    ramp up / ramp down) + support legs under elevated belts that do not stand on a platform.
 *    Rebuilt by sync() (topology change) or when a conveyor's automatic curve changes.
 *  - Items: one InstancedMesh per item type, refilled every frame from logistics.forEachItem(alpha).
 * Splitters, mergers, lifts etc. are full models rendered by BuildingViews.
 */
export class BeltView {
  private readonly root = new THREE.Group();
  private readonly beltMap: THREE.Texture;
  private readonly beltMaterial: THREE.MeshStandardMaterial;
  private readonly tiles = new Map<ConveyorGeometryKind, TileLayer>();
  private readonly items = new Map<ItemType, ItemLayer>();
  private buildings: Map<number, Building> | null = null;
  /** Conveyors and the curve value their tile was built with (auto-curve change detection). */
  private conveyors: Building[] = [];
  private conveyorCurves: number[] = [];
  /** Belt frames cast sun shadows (whenever shadows are on). */
  private shadows: boolean;
  /** Items on the belts cast sun shadows (high only: hundreds of small moving casters). */
  private itemShadows: boolean;
  private scroll = 0;
  private lastTime = -1;

  constructor(private readonly scene: THREE.Scene, quality: Quality) {
    this.root.name = 'belts';
    const prof = qualityProfile(quality);
    this.shadows = prof.shadows;
    this.itemShadows = prof.shadows && prof.itemShadows;
    const base = beltTexture();
    this.beltMap = base.clone();
    this.beltMap.wrapS = THREE.RepeatWrapping;
    this.beltMap.wrapT = THREE.RepeatWrapping;
    this.beltMap.needsUpdate = true;
    this.beltMaterial = new THREE.MeshStandardMaterial({ map: this.beltMap, roughness: 0.88, metalness: 0.05 });

    for (const kind of TILE_KINDS) {
      const g = createConveyorGeometry(kind);
      if (!g.frame.getAttribute('color')) paintGeometry(g.frame, COLORS.logistics);
      let beltGeo: THREE.BufferGeometry | null = g.belt;
      if (kind === 'legs' || !g.belt.getAttribute('position') || g.belt.getAttribute('position').count === 0) { g.belt.dispose(); beltGeo = null; }
      this.tiles.set(kind, { kind, frameGeo: g.frame, beltGeo, frame: null, belt: null, capacity: 0, count: 0 });
    }
    for (const type of ITEM_KINDS) {
      const geo = createItemGeometry(ITEM_MODEL[type]);
      if (!geo.getAttribute('color')) paintGeometry(geo, ITEM_COLOR[type]);
      const layer: ItemLayer = { type, geo, mesh: this.makeItemMesh(geo, 256, type), capacity: 256, count: 0, overflow: false };
      this.items.set(type, layer);
    }
    scene.add(this.root);
  }

  private makeItemMesh(geo: THREE.BufferGeometry, cap: number, type: ItemType): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(geo, paletteMaterial(), cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.count = 0;
    m.frustumCulled = false;
    m.name = `belt:item:${type}`;
    m.castShadow = this.itemShadows;
    m.receiveShadow = true;
    this.root.add(m);
    return m;
  }

  // ---------------------------------------------------------------------------------------------
  // Tiles
  // ---------------------------------------------------------------------------------------------

  /** Rebuild tile instances from the building map (call on topology change). */
  sync(buildings: Map<number, Building>): void {
    this.buildings = buildings;
    this.rebuildTiles();
  }

  private tileKindOf(b: Building): ConveyorGeometryKind | null {
    if (b.type === 'conveyor') {
      const c = b.anim.curve ?? 0;
      return c < -0.5 ? 'curveL' : c > 0.5 ? 'curveR' : 'straight';
    }
    if (b.type === 'conveyorRamp') return b.variant === 'down' ? 'rampDown' : 'ramp';
    return null;
  }

  private rebuildTiles(): void {
    const buildings = this.buildings;
    if (!buildings) return;
    // Count per kind first so capacities grow once.
    for (const layer of this.tiles.values()) layer.count = 0;
    const platforms = new Set<number>();
    for (const b of buildings.values()) if (b.type === 'platform') platforms.add(b.cell.x * 4096 + b.cell.z);
    this.conveyors.length = 0;
    this.conveyorCurves.length = 0;
    const need = new Map<ConveyorGeometryKind, number>();
    for (const b of buildings.values()) {
      const k = this.tileKindOf(b);
      if (!k) continue;
      need.set(k, (need.get(k) ?? 0) + 1);
      if (b.type === 'conveyor' && b.cell.level === 1 && !platforms.has(b.cell.x * 4096 + b.cell.z)) need.set('legs', (need.get('legs') ?? 0) + 1);
    }
    for (const [k, n] of need) this.ensureTileCapacity(this.tiles.get(k)!, n);

    for (const b of buildings.values()) {
      const k = this.tileKindOf(b);
      if (!k) continue;
      if (b.type === 'conveyor') { this.conveyors.push(b); this.conveyorCurves.push(b.anim.curve ?? 0); }
      const c = buildingCenter(b.type, b.cell, b.rot);
      _q.setFromAxisAngle(_up, -b.rot * Math.PI / 2);
      _p.set(c.x, c.y, c.z);
      _m.compose(_p, _q, _s);
      this.pushTile(this.tiles.get(k)!, _m);
      if (b.type === 'conveyor' && b.cell.level === 1 && !platforms.has(b.cell.x * 4096 + b.cell.z)) {
        // Legs stand on the ground floor and reach up to the elevated belt (authored from y = 0).
        _p.set(c.x, 0, c.z);
        _m.compose(_p, _q, _s);
        this.pushTile(this.tiles.get('legs')!, _m);
      }
    }
    for (const layer of this.tiles.values()) {
      for (const m of [layer.frame, layer.belt]) {
        if (!m) continue;
        m.count = layer.count;
        m.instanceMatrix.needsUpdate = true;
        m.visible = layer.count > 0;
        m.computeBoundingSphere();
      }
    }
  }

  private ensureTileCapacity(layer: TileLayer, n: number): void {
    if (n <= layer.capacity) return;
    const cap = Math.max(32, n, layer.capacity * 2);
    for (const m of [layer.frame, layer.belt]) if (m) { this.root.remove(m); m.dispose(); }
    layer.frame = new THREE.InstancedMesh(layer.frameGeo, paletteMaterial(), cap);
    layer.frame.castShadow = this.shadows;
    layer.frame.receiveShadow = true;
    layer.frame.name = `belt:${layer.kind}:frame`;
    this.root.add(layer.frame);
    if (layer.beltGeo) {
      layer.belt = new THREE.InstancedMesh(layer.beltGeo, this.beltMaterial, cap);
      layer.belt.receiveShadow = true;
      layer.belt.name = `belt:${layer.kind}:belt`;
      this.root.add(layer.belt);
    }
    layer.capacity = cap;
  }

  private pushTile(layer: TileLayer, m: THREE.Matrix4): void {
    const i = layer.count++;
    layer.frame!.setMatrixAt(i, m);
    layer.belt?.setMatrixAt(i, m);
  }

  // ---------------------------------------------------------------------------------------------
  // Per frame
  // ---------------------------------------------------------------------------------------------

  /** Scroll belts, refresh items. `speed` = belt speed stat (m/s along the belt). */
  update(logistics: ILogistics, alpha: number, time: number, speed: number): void {
    // Automatic curves change after relinks (possibly a tick after the topology event).
    for (let i = 0; i < this.conveyors.length; i++) {
      if ((this.conveyors[i].anim.curve ?? 0) !== this.conveyorCurves[i]) { this.rebuildTiles(); break; }
    }

    const dt = this.lastTime < 0 ? 0 : Math.min(0.25, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    this.scroll = (this.scroll + dt * speed * BELT_REPEAT_PER_M) % 1;
    this.beltMap.offset.y = -this.scroll;

    for (const layer of this.items.values()) {
      if (layer.overflow) {
        this.root.remove(layer.mesh);
        layer.mesh.dispose();
        layer.capacity *= 2;
        layer.mesh = this.makeItemMesh(layer.geo, layer.capacity, layer.type);
        layer.overflow = false;
      }
      layer.count = 0;
    }
    logistics.forEachItem(alpha, this.onItem);
    for (const layer of this.items.values()) {
      layer.mesh.count = layer.count;
      if (layer.count > 0) layer.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private readonly onItem = (v: BeltItemView): void => {
    const layer = this.items.get(v.type);
    if (!layer) return;
    if (layer.count >= layer.capacity) { layer.overflow = true; return; }
    let yaw = v.yaw;
    let sc = 1;
    if (v.type === 'hay') {
      const h = hash01(v.uid);
      yaw += h * Math.PI * 2;
      sc = 0.85 + h * 0.3;
    }
    _q.setFromAxisAngle(_up, yaw);
    _p.set(v.x, v.y, v.z);
    _s.set(sc, sc, sc);
    _m.compose(_p, _q, _s);
    _s.set(1, 1, 1);
    layer.mesh.setMatrixAt(layer.count++, _m);
  };

  setQuality(q: Quality): void {
    const prof = qualityProfile(q);
    this.shadows = prof.shadows;
    this.itemShadows = prof.shadows && prof.itemShadows;
    for (const layer of this.tiles.values()) if (layer.frame) layer.frame.castShadow = this.shadows;
    for (const layer of this.items.values()) layer.mesh.castShadow = this.itemShadows;
  }

  dispose(): void {
    this.scene.remove(this.root);
    for (const layer of this.tiles.values()) {
      layer.frame?.dispose(); layer.belt?.dispose();
      layer.frameGeo.dispose(); layer.beltGeo?.dispose();
    }
    for (const layer of this.items.values()) { layer.mesh.dispose(); layer.geo.dispose(); }
    this.tiles.clear();
    this.items.clear();
    this.beltMaterial.dispose();
    this.beltMap.dispose();
    this.conveyors = [];
    this.buildings = null;
  }
}
