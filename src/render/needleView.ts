import * as THREE from 'three';
import type { NeedleState } from '../sim/types';
import { createNeedleGeometry } from './geometry';
import { glintTexture } from './textures';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

/** Needle length in the world (m). Slightly larger than life so it can be spotted. */
const NEEDLE_LENGTH = 0.34;
const GLINT_SIZE = 0.55;

interface Slot {
  id: number;
  status: string;
  x: number; y: number; z: number;
  sprite: THREE.Sprite;
  phase: number;
  /** Visual-minus-logical surface offset used when this needle was last placed. */
  oy: number;
}

function hash(n: number): number {
  let h = (n * 0x9e3779b1) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b) >>> 0; h ^= h >>> 13;
  return (h >>> 0) / 0xffffffff;
}

/**
 * Needles lying in the world. Only EXPOSED needles are visible (buried ones are secret, in-transit ones
 * live inside hay packets, found ones sit in the trophy case rendered by the Environment):
 * a small steel needle mesh poking out of the hay + a pulsing star glint sprite above it.
 */
export class NeedleView {
  private readonly root = new THREE.Group();
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly glintMaterial: THREE.SpriteMaterial;
  private mesh: THREE.InstancedMesh;
  private capacity = 8;
  private slots: Slot[] = [];
  private visibleCount = 0;

  constructor(private readonly scene: THREE.Scene) {
    this.root.name = 'needles';
    this.geometry = createNeedleGeometry(NEEDLE_LENGTH);
    this.material = new THREE.MeshStandardMaterial({ color: 0xe8eef2, metalness: 1, roughness: 0.18, emissive: 0x30363a, envMapIntensity: 1.4 });
    this.glintMaterial = new THREE.SpriteMaterial({
      map: glintTexture(), color: 0xfff4d6, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false,
    });
    this.mesh = this.makeMesh(this.capacity);
    scene.add(this.root);
  }

  private makeMesh(cap: number): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(this.geometry, this.material, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.count = 0;
    m.frustumCulled = false;
    m.castShadow = false;
    this.root.add(m);
    return m;
  }

  /** Cheap per-frame diff against the sim's needle list; rebuilds instances only when something changed. */
  sync(needles: readonly NeedleState[], surfaceOffset: (x: number, z: number) => number = () => 0): void {
    let changed = needles.length !== this.slots.length;
    if (!changed) {
      for (let i = 0; i < needles.length; i++) {
        const n = needles[i], s = this.slots[i];
        if (s.id !== n.id || s.status !== n.status || s.x !== n.pos.x || s.y !== n.pos.y || s.z !== n.pos.z) { changed = true; break; }
        // the visual pile under an exposed needle moved (hay dug / slid nearby)
        if (n.status === 'exposed' && Math.abs(surfaceOffset(n.pos.x, n.pos.z) - s.oy) > 0.02) { changed = true; break; }
      }
    }
    if (!changed) return;

    // Grow slot list (sprites are pooled per needle; there are only a handful).
    while (this.slots.length < needles.length) {
      const sprite = new THREE.Sprite(this.glintMaterial);
      sprite.visible = false;
      sprite.renderOrder = 5;
      this.root.add(sprite);
      this.slots.push({ id: -1, status: '', x: 0, y: 0, z: 0, oy: 0, sprite, phase: 0 });
    }
    for (let i = needles.length; i < this.slots.length; i++) this.slots[i].sprite.visible = false;
    if (needles.length > this.capacity) {
      this.root.remove(this.mesh);
      this.mesh.dispose();
      this.capacity = Math.max(needles.length, this.capacity * 2);
      this.mesh = this.makeMesh(this.capacity);
    }

    let count = 0;
    for (let i = 0; i < needles.length; i++) {
      const n = needles[i], s = this.slots[i];
      s.id = n.id; s.status = n.status; s.x = n.pos.x; s.y = n.pos.y; s.z = n.pos.z;
      s.oy = n.status === 'exposed' ? surfaceOffset(n.pos.x, n.pos.z) : 0;
      s.phase = hash(n.id) * Math.PI * 2;
      const show = n.status === 'exposed';
      s.sprite.visible = show;
      if (!show) continue;
      // Half buried, tilted out of the hay at a per-needle random angle.
      const yaw = hash(n.id + 17) * Math.PI * 2;
      const tilt = 0.25 + hash(n.id + 31) * 0.35;
      _e.set(0, yaw, tilt, 'YXZ');
      _q.setFromEuler(_e);
      const y = n.pos.y + s.oy; // drawn on the visual pile surface
      _p.set(n.pos.x, y + 0.03, n.pos.z);
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(count++, _m);
      s.sprite.position.set(n.pos.x, y + 0.14, n.pos.z);
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.visibleCount = count;
  }

  /** Glint pulse (twinkle) animation. */
  update(_dt: number, time: number): void {
    if (this.visibleCount === 0) return;
    for (const s of this.slots) {
      if (!s.sprite.visible) continue;
      const t = time * 2.2 + s.phase;
      const pulse = Math.max(0, Math.sin(t)) ** 6;
      const k = GLINT_SIZE * (0.35 + 0.9 * pulse);
      s.sprite.scale.set(k, k, 1);
    }
  }

  dispose(): void {
    this.scene.remove(this.root);
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.glintMaterial.dispose();
    this.slots = [];
  }
}
