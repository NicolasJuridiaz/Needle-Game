import * as THREE from 'three';
import { WORLD } from '../config/world';
import type { IHayField } from '../sim/interfaces';
import {
  HAY_TONES, TUFT_MIN_HEIGHT, TuftSlots, displayHeight, gridNormal, hash01, hayToneIndex, patchTone,
} from './hayGrid';
import { qualityProfile, type Quality } from './quality';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qYaw = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _n = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();

/**
 * Stylised straw palette (sRGB), darkest → palest. Flat colours, no texture: the pile reads as a big faceted
 * low-poly mound; lighting on the flat-shaded facets does the rest.
 */
const HAY_PALETTE = [0xa06a22, 0xbf8b34, 0xd6a847, 0xe6c165].map((h) => new THREE.Color(h));
/** Straw clump size (m) before per-instance scale. */
const CLUMP_RADIUS = 0.26;
const CLUMP_HEIGHT = 0.12;
/** Cosmetic surface jitter: horizontal (fraction of a hay cell) and vertical (m, only on hay deeper than 0.25 m). */
const JITTER_XZ = 0.22;
const JITTER_Y = 0.07;

/**
 * Hay heightfield view: one mesh with a vertex per hay cell centre (positions/normals/colours rewritten only
 * where the heightfield changed) + an instanced carpet of crossed straw tufts on covered cells.
 * Change detection against the last applied heights keeps large dirty rects (several machines digging at
 * opposite ends of the pile) cheap: only cells that really changed, and their neighbours, are recomputed.
 */
export class HayView {
  private readonly scene: THREE.Scene;
  private readonly hay: IHayField;
  private quality: Quality;

  private cols = 0;
  private rows = 0;
  private cellSize = 0.5;
  private mesh: THREE.Mesh | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private dynamicAttributes: THREE.BufferAttribute[] = [];
  private readonly material: THREE.MeshStandardMaterial;
  private positions = new Float32Array(0);
  private normals = new Float32Array(0);
  private colors = new Float32Array(0);
  /** Heights as last applied to the mesh (change detection). */
  private applied = new Float32Array(0);
  /** Static per-vertex colour patch value (0..1). */
  private patch = new Float32Array(0);
  /** Static per-vertex vertical facet jitter (m) and tone jitter (0..1). */
  private jitterY = new Float32Array(0);
  private jitterT = new Float32Array(0);
  /** Cells needing normal/colour/tuft refresh (pass 2). */
  private marks = new Uint8Array(0);

  private tufts: THREE.InstancedMesh | null = null;
  private readonly tuftGeometry: THREE.BufferGeometry;
  private readonly tuftMaterial: THREE.MeshStandardMaterial;
  private slots: TuftSlots | null = null;
  private tuftProbability = 0;
  private tuftMin = Infinity;
  private tuftMax = -1;

  constructor(scene: THREE.Scene, hay: IHayField, quality: Quality) {
    this.scene = scene;
    this.hay = hay;
    this.quality = quality;
    // Flat-shaded facets + palette vertex colours: no photographic texture, no normal map.
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.96,
      metalness: 0,
      envMapIntensity: 0.55,
    });
    this.tuftGeometry = createClumpGeometry();
    this.tuftMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.95,
      metalness: 0,
      envMapIntensity: 0.5,
    });
    this.build();
  }

  /** Apply the heightfield's dirty rect (call once per frame). */
  update(): void {
    const hay = this.hay;
    if (hay.cols !== this.cols || hay.rows !== this.rows || hay.cellSize !== this.cellSize) {
      this.build();
      hay.consumeDirtyRect();
      return;
    }
    if (!this.mesh) return;
    const rect = hay.consumeDirtyRect();
    if (!rect) return;
    // Treat the rect as inclusive and scan one extra row/column (cheap thanks to change detection).
    this.apply(rect.c0, rect.r0, rect.c1 + 1, rect.r1 + 1);
  }

  /** Live: rebuilds the straw clump pool for the new budget. */
  setQuality(q: Quality): void {
    if (q === this.quality) return;
    this.quality = q;
    this.buildTufts();
    if (this.mesh) this.refreshAllTufts();
  }

  /** Live tuft instances / pool capacity (QA). */
  get tuftStats(): { live: number; capacity: number } {
    return { live: this.tufts?.count ?? 0, capacity: this.slots?.capacity ?? 0 };
  }

  dispose(): void {
    this.destroyMesh();
    this.destroyTufts();
    this.material.dispose();
    this.tuftGeometry.dispose();
    this.tuftMaterial.dispose();
  }

  // ------------------------------------------------------------------------------------------------

  private build(): void {
    this.destroyMesh();
    const hay = this.hay;
    this.cols = hay.cols;
    this.rows = hay.rows;
    this.cellSize = hay.cellSize;
    const cols = this.cols, rows = this.rows;
    if (cols < 2 || rows < 2 || hay.heights.length < cols * rows) {
      this.destroyTufts();
      return;
    }
    const n = cols * rows;
    const cs = this.cellSize;
    this.positions = new Float32Array(n * 3);
    this.normals = new Float32Array(n * 3);
    this.colors = new Float32Array(n * 3);
    this.applied = new Float32Array(n);
    this.patch = new Float32Array(n);
    this.jitterY = new Float32Array(n);
    this.jitterT = new Float32Array(n);
    this.marks = new Uint8Array(n);
    const h = hay.heights;
    for (let r = 0; r < rows; r++) {
      const z = hay.originZ + (r + 0.5) * cs;
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const x = hay.originX + (c + 0.5) * cs;
        // Jittered vertex positions break the regular grid into irregular low-poly facets (cosmetic only:
        // the sim heightfield is untouched, the offset stays well inside the vertex's own cell).
        this.positions[i * 3] = x + (hash01(i, 11) - 0.5) * 2 * JITTER_XZ * cs;
        this.positions[i * 3 + 2] = z + (hash01(i, 12) - 0.5) * 2 * JITTER_XZ * cs;
        this.jitterY[i] = (hash01(i, 13) - 0.5) * 2 * JITTER_Y;
        this.jitterT[i] = hash01(i, 14);
        this.positions[i * 3 + 1] = this.surfaceY(i, h[i]);
        this.applied[i] = h[i];
        this.patch[i] = 0.7 * patchTone(x, z, 3.6, 17) + 0.3 * patchTone(x, z, 1.3, 29);
      }
    }
    const quads = (cols - 1) * (rows - 1);
    const index = new Uint32Array(quads * 6);
    let o = 0;
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
        // Alternate the diagonal in a checkerboard so ridges do not all lean the same way.
        if ((r + c) & 1) { index[o++] = a; index[o++] = d; index[o++] = b; index[o++] = b; index[o++] = d; index[o++] = e; }
        else { index[o++] = a; index[o++] = d; index[o++] = e; index[o++] = a; index[o++] = e; index[o++] = b; }
      }
    }
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) this.shadeVertex(c, r);

    const g = new THREE.BufferGeometry();
    const pos = new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage);
    const nor = new THREE.BufferAttribute(this.normals, 3).setUsage(THREE.DynamicDrawUsage);
    const col = new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', pos);
    g.setAttribute('normal', nor);
    g.setAttribute('color', col);
    g.setIndex(new THREE.BufferAttribute(index, 1));
    this.dynamicAttributes = [pos, nor, col];
    // Static bounds covering every height the pile can reach (avoids recomputing on edits).
    const w = cols * cs, d = rows * cs;
    const top = WORLD.pile.height + 2;
    g.boundingBox = new THREE.Box3(
      new THREE.Vector3(hay.originX, -0.2, hay.originZ),
      new THREE.Vector3(hay.originX + w, top, hay.originZ + d),
    );
    g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
    this.geometry = g;
    const mesh = new THREE.Mesh(g, this.material);
    mesh.name = 'hay';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.mesh = mesh;
    this.scene.add(mesh);

    this.buildTufts();
    this.refreshAllTufts();
  }

  private destroyMesh(): void {
    if (this.mesh) { this.mesh.removeFromParent(); this.mesh = null; }
    if (this.geometry) { this.geometry.dispose(); this.geometry = null; }
    this.dynamicAttributes = [];
  }

  private buildTufts(): void {
    this.destroyTufts();
    if (this.cols < 2 || this.rows < 2) return;
    const prof = qualityProfile(this.quality);
    const cap = prof.tufts;
    this.slots = new TuftSlots(this.cols * this.rows, prof.tuftsPerCell, cap);
    // Clumps are bigger than the old straw cards: ~60 % of the profile density covers the surface as well.
    this.tuftProbability = Math.min(1, (prof.tuftDensity * 0.6) / prof.tuftsPerCell);
    const mesh = new THREE.InstancedMesh(this.tuftGeometry, this.tuftMaterial, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.name = 'hayTufts';
    this.tufts = mesh;
    this.scene.add(mesh);
  }

  private destroyTufts(): void {
    if (this.tufts) { this.tufts.removeFromParent(); this.tufts.dispose(); this.tufts = null; }
    this.slots = null;
  }

  private refreshAllTufts(): void {
    if (!this.tufts || !this.slots) return;
    this.slots.clear();
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) this.updateTufts(c, r);
    this.flushTufts(true);
  }

  /** Pass 1: detect changed cells in the rect; pass 2: refresh them and their neighbours. */
  private apply(c0: number, r0: number, c1: number, r1: number): void {
    const cols = this.cols, rows = this.rows;
    c0 = Math.max(0, c0); r0 = Math.max(0, r0);
    c1 = Math.min(cols - 1, c1); r1 = Math.min(rows - 1, r1);
    if (c1 < c0 || r1 < r0) return;
    const h = this.hay.heights, applied = this.applied, pos = this.positions, marks = this.marks;
    let mc0 = cols, mr0 = rows, mc1 = -1, mr1 = -1;
    for (let r = r0; r <= r1; r++) {
      let i = r * cols + c0;
      for (let c = c0; c <= c1; c++, i++) {
        const v = h[i];
        if (v === applied[i]) continue;
        applied[i] = v;
        pos[i * 3 + 1] = this.surfaceY(i, v);
        const ca = c > 0 ? c - 1 : 0, cb = c < cols - 1 ? c + 1 : c;
        const ra = r > 0 ? r - 1 : 0, rb = r < rows - 1 ? r + 1 : r;
        for (let rr = ra; rr <= rb; rr++) for (let cc = ca; cc <= cb; cc++) marks[rr * cols + cc] = 1;
        if (ca < mc0) mc0 = ca;
        if (cb > mc1) mc1 = cb;
        if (ra < mr0) mr0 = ra;
        if (rb > mr1) mr1 = rb;
      }
    }
    if (mc1 < 0) return;
    for (let r = mr0; r <= mr1; r++) {
      let i = r * cols + mc0;
      for (let c = mc0; c <= mc1; c++, i++) {
        if (!marks[i]) continue;
        marks[i] = 0;
        this.shadeVertex(c, r);
        this.updateTufts(c, r);
      }
    }
    const start = mr0 * cols + mc0;
    const count = (mr1 * cols + mc1) - start + 1;
    for (let k = 0; k < this.dynamicAttributes.length; k++) {
      const a = this.dynamicAttributes[k];
      a.clearUpdateRanges();
      a.addUpdateRange(start * 3, count * 3);
      a.needsUpdate = true;
    }
    this.flushTufts(false);
  }

  /** Normal + tone of one vertex from the current display heights. */
  private shadeVertex(c: number, r: number): void {
    const cols = this.cols, rows = this.rows;
    const i = r * cols + c;
    const pos = this.positions;
    gridNormal(pos, 3, cols, rows, this.cellSize, c, r, this.normals, i * 3);
    const y = pos[i * 3 + 1];
    const yl = pos[(r * cols + (c > 0 ? c - 1 : c)) * 3 + 1];
    const yr = pos[(r * cols + (c < cols - 1 ? c + 1 : c)) * 3 + 1];
    const yu = pos[((r > 0 ? r - 1 : r) * cols + c) * 3 + 1];
    const yd = pos[((r < rows - 1 ? r + 1 : r) * cols + c) * 3 + 1];
    const cavity = (yl + yr + yu + yd) * 0.25 - y;
    const t = hayToneIndex(this.applied[i], cavity, this.patch[i], this.jitterT[i], WORLD.pile.height);
    const col = HAY_PALETTE[t];
    this.colors[i * 3] = col.r; this.colors[i * 3 + 1] = col.g; this.colors[i * 3 + 2] = col.b;
  }

  /** Display height of vertex i: the sim height (or sunk under the floor) + a small facet jitter on deep hay. */
  private surfaceY(i: number, h: number): number {
    const y = displayHeight(h);
    return h > 0.25 ? y + this.jitterY[i] * Math.min(1, (h - 0.25) * 4) : y;
  }

  /** Bilinear display height between vertex centres at world (x, z). */
  private surfaceAt(x: number, z: number): number {
    const cs = this.cellSize;
    const fx = (x - this.hay.originX) / cs - 0.5, fz = (z - this.hay.originZ) / cs - 0.5;
    const c0 = Math.max(0, Math.min(this.cols - 2, Math.floor(fx)));
    const r0 = Math.max(0, Math.min(this.rows - 2, Math.floor(fz)));
    const tx = Math.min(1, Math.max(0, fx - c0)), tz = Math.min(1, Math.max(0, fz - r0));
    const p = this.positions, cols = this.cols;
    const a = p[(r0 * cols + c0) * 3 + 1], b = p[(r0 * cols + c0 + 1) * 3 + 1];
    const c = p[((r0 + 1) * cols + c0) * 3 + 1], d = p[((r0 + 1) * cols + c0 + 1) * 3 + 1];
    return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * tz;
  }

  private updateTufts(c: number, r: number): void {
    const slots = this.slots, mesh = this.tufts;
    if (!slots || !mesh) return;
    const i = r * this.cols + c;
    const h = this.applied[i];
    const spc = slots.slotsPerCell;
    const cs = this.cellSize;
    for (let s = 0; s < spc; s++) {
      const slot = i * spc + s;
      let want = h > TUFT_MIN_HEIGHT && hash01(slot, 1) < this.tuftProbability;
      let x = 0, y = 0, z = 0;
      if (want) {
        x = this.hay.originX + (c + 0.5 + (hash01(slot, 2) - 0.5) * 0.9) * cs;
        z = this.hay.originZ + (r + 0.5 + (hash01(slot, 3) - 0.5) * 0.9) * cs;
        y = this.surfaceAt(x, z) - 0.035;
        if (y < 0.015) want = false;
      }
      if (!want) {
        const freed = slots.release(slot);
        if (freed >= 0) {
          if (freed !== slots.count) this.copyTuft(slots.count, freed);
          this.touchTuft(freed);
        }
        continue;
      }
      const idx = slots.acquire(slot);
      if (idx < 0) continue;
      // Lean along the surface normal (half way) and spin randomly.
      const ni = i * 3;
      _n.set(this.normals[ni], this.normals[ni + 1], this.normals[ni + 2]).lerp(_up, 0.45).normalize();
      _q.setFromUnitVectors(_up, _n);
      _qYaw.setFromAxisAngle(_up, hash01(slot, 4) * Math.PI * 2);
      _q.multiply(_qYaw);
      const thin = h < 0.25 ? 0.55 + h * 1.8 : 1;
      const sc = (0.75 + hash01(slot, 5) * 0.6) * thin;
      _p.set(x, y, z);
      _s.set(sc, sc * (0.85 + hash01(slot, 6) * 0.35), sc);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(idx, _m);
      // palette tone of the underlying surface, sometimes one step lighter (never the darkest crease tone)
      const base = hayToneIndex(h, 0, this.patch[i], this.jitterT[i], WORLD.pile.height);
      const t = Math.max(1, Math.min(HAY_TONES - 1, base + (hash01(slot, 7) < 0.3 ? 1 : 0)));
      mesh.setColorAt(idx, _c.copy(HAY_PALETTE[t]));
      this.touchTuft(idx);
    }
  }

  private copyTuft(from: number, to: number): void {
    const mesh = this.tufts!;
    const m = mesh.instanceMatrix.array as Float32Array;
    m.copyWithin(to * 16, from * 16, from * 16 + 16);
    const col = mesh.instanceColor!.array as Float32Array;
    col.copyWithin(to * 3, from * 3, from * 3 + 3);
  }

  private touchTuft(idx: number): void {
    if (idx < this.tuftMin) this.tuftMin = idx;
    if (idx > this.tuftMax) this.tuftMax = idx;
  }

  private flushTufts(all: boolean): void {
    const mesh = this.tufts, slots = this.slots;
    if (!mesh || !slots) return;
    mesh.count = slots.count;
    if (all) { this.tuftMin = 0; this.tuftMax = Math.max(0, slots.count - 1); }
    if (this.tuftMax < this.tuftMin) return;
    const lo = this.tuftMin, n = Math.min(slots.capacity - 1, this.tuftMax) - lo + 1;
    const im = mesh.instanceMatrix;
    im.clearUpdateRanges();
    im.addUpdateRange(lo * 16, n * 16);
    im.needsUpdate = true;
    const ic = mesh.instanceColor!;
    ic.clearUpdateRanges();
    ic.addUpdateRange(lo * 3, n * 3);
    ic.needsUpdate = true;
    this.tuftMin = Infinity;
    this.tuftMax = -1;
  }
}

/**
 * Low-poly straw clump, base at y = 0 (sits half sunk in the surface): an irregular six-sided lump with a twisted
 * shoulder ring and an off-centre crown. 18 triangles, flat shaded, no texture; the per-instance palette tone
 * colours it (the shoulder faces are a touch lighter so each clump reads as a tuft, not a pyramid).
 */
function createClumpGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const tri = (a: number[], b: number[], c: number[], l: number) => {
    pos.push(...a, ...b, ...c);
    for (let k = 0; k < 3; k++) col.push(l, l, l);
  };
  const R = CLUMP_RADIUS, H = CLUMP_HEIGHT;
  const base: number[][] = [], mid: number[][] = [];
  const rb = [1, 0.78, 1.1, 0.86, 1.04, 0.8], rm = [0.62, 0.5, 0.66, 0.48, 0.58, 0.54], hm = [0.62, 0.7, 0.55, 0.74, 0.6, 0.68];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2, am = a + Math.PI / 6;
    base.push([Math.cos(a) * R * rb[k], 0, Math.sin(a) * R * rb[k]]);
    mid.push([Math.cos(am) * R * rm[k], H * hm[k], Math.sin(am) * R * rm[k]]);
  }
  const top = [R * 0.12, H, -R * 0.08];
  for (let k = 0; k < 6; k++) {
    const n = (k + 1) % 6;
    tri(base[k], mid[k], base[n], 0.94);
    tri(base[n], mid[k], mid[n], 1.02);
    tri(mid[k], top, mid[n], 1.1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
