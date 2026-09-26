import * as THREE from 'three';
import type { Building } from '../sim/building';
import { COLORS } from './palette';

const SEGMENTS = 12;
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

interface LineLayer {
  line: THREE.LineSegments;
  geo: THREE.BufferGeometry;
  attr: THREE.BufferAttribute;
  capacity: number; // in segments
  count: number;
}

/**
 * Power cables: catenary lines pole/generator <-> pole (`power.wires`) and thinner-looking copper feeds
 * pole/generator -> consumer (`power.feeds`). Geometry is rebuilt only when the wiring or the positions of
 * the wired buildings change (cheap per-frame signature check, no allocations).
 */
export class PowerWires {
  private readonly root = new THREE.Group();
  private readonly wireLayer: LineLayer;
  private readonly feedLayer: LineLayer;
  private signature = NaN;

  constructor(private readonly scene: THREE.Scene) {
    this.root.name = 'powerWires';
    this.wireLayer = this.makeLayer(new THREE.LineBasicMaterial({ color: 0x1d1f21 }), 128);
    this.feedLayer = this.makeLayer(new THREE.LineBasicMaterial({ color: COLORS.copper, transparent: true, opacity: 0.85 }), 128);
    scene.add(this.root);
  }

  private makeLayer(mat: THREE.LineBasicMaterial, segments: number): LineLayer {
    const geo = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(new Float32Array(segments * 6), 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', attr);
    geo.setDrawRange(0, 0);
    const line = new THREE.LineSegments(geo, mat);
    line.frustumCulled = false;
    this.root.add(line);
    return { line, geo, attr, capacity: segments, count: 0 };
  }

  private ensure(layer: LineLayer, segments: number): void {
    if (segments <= layer.capacity) return;
    layer.capacity = Math.max(segments, layer.capacity * 2);
    layer.attr = new THREE.BufferAttribute(new Float32Array(layer.capacity * 6), 3).setUsage(THREE.DynamicDrawUsage);
    layer.geo.dispose();
    layer.geo.setAttribute('position', layer.attr);
  }

  /** Attachment point of a cable on a building (world space). */
  private anchor(b: Building, out: THREE.Vector3): THREE.Vector3 {
    const c = b.center;
    const h = b.def.height;
    let y: number;
    if (b.type === 'powerPole') y = h - 0.35;
    else if (b.type === 'hayGenerator') y = h * 0.8;
    else y = Math.min(h, 2.2) * 0.9;
    return out.set(c.x, c.y + y, c.z);
  }

  private hashBuildings(h: number, b: Building | undefined): number {
    if (!b) return Math.imul(h ^ 0x7f, 16777619);
    h = Math.imul(h ^ b.id, 16777619);
    h = Math.imul(h ^ (b.cell.x + 1024), 16777619);
    h = Math.imul(h ^ (b.cell.z + 1024), 16777619);
    h = Math.imul(h ^ (b.cell.level * 4 + b.rot), 16777619);
    return h;
  }

  sync(wires: readonly { a: number; b: number }[], feeds: readonly { from: number; to: number }[], buildings: Map<number, Building>): void {
    let h = 2166136261 | 0;
    h = Math.imul(h ^ wires.length, 16777619);
    h = Math.imul(h ^ feeds.length, 16777619);
    for (let i = 0; i < wires.length; i++) { h = this.hashBuildings(h, buildings.get(wires[i].a)); h = this.hashBuildings(h, buildings.get(wires[i].b)); }
    for (let i = 0; i < feeds.length; i++) { h = this.hashBuildings(h, buildings.get(feeds[i].from)); h = this.hashBuildings(h, buildings.get(feeds[i].to)); }
    if (h === this.signature) return;
    this.signature = h;

    this.ensure(this.wireLayer, wires.length * SEGMENTS);
    this.ensure(this.feedLayer, feeds.length * SEGMENTS);
    this.wireLayer.count = 0;
    this.feedLayer.count = 0;
    for (const w of wires) {
      const a = buildings.get(w.a), b = buildings.get(w.b);
      if (!a || !b) continue;
      this.catenary(this.wireLayer, this.anchor(a, _a), this.anchor(b, _b), 0.035, 0.08);
    }
    for (const f of feeds) {
      const a = buildings.get(f.from), b = buildings.get(f.to);
      if (!a || !b) continue;
      this.catenary(this.feedLayer, this.anchor(a, _a), this.anchor(b, _b), 0.025, 0.05);
    }
    for (const layer of [this.wireLayer, this.feedLayer]) {
      layer.geo.setDrawRange(0, layer.count * 2);
      layer.attr.needsUpdate = true;
      layer.line.visible = layer.count > 0;
    }
  }

  private catenary(layer: LineLayer, a: THREE.Vector3, b: THREE.Vector3, sagPerM: number, sagMin: number): void {
    const len = a.distanceTo(b);
    const sag = sagMin + len * sagPerM;
    const arr = layer.attr.array as Float32Array;
    let px = a.x, py = a.y, pz = a.z;
    for (let i = 1; i <= SEGMENTS; i++) {
      const t = i / SEGMENTS;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      // Parabola approximates the catenary well for shallow sags.
      const y = a.y + (b.y - a.y) * t - sag * 4 * t * (1 - t);
      const o = layer.count * 6;
      arr[o] = px; arr[o + 1] = py; arr[o + 2] = pz;
      arr[o + 3] = x; arr[o + 4] = y; arr[o + 5] = z;
      layer.count++;
      px = x; py = y; pz = z;
    }
  }

  dispose(): void {
    this.scene.remove(this.root);
    for (const layer of [this.wireLayer, this.feedLayer]) {
      layer.geo.dispose();
      (layer.line.material as THREE.Material).dispose();
    }
  }
}
