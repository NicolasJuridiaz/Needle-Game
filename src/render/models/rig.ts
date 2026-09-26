import * as THREE from 'three';
import type { MachineStatus } from '../../sim/types';
import { glassMaterial } from '../palette';
import type { ModelInstance } from './api';
import { modelMaterial } from './materials';
import { Parts, type V3 } from './parts';
import { StatusLamp, type LampSpec } from './statusLamp';

/**
 * Model templates and instances.
 *
 * A Template is the cached, shareable part of a model (one per type/variant): one merged static geometry
 * (+ glass), one merged SKINNED geometry for every moving piece, the bone layout and the lamp spot.
 * Instances only own their Object3D hierarchy, bones and skeleton (bone texture) — cheap to create and
 * to dispose. Moving parts are authored in their bone's local frame (identity bind), so animating a part is
 * just setting its bone's position / rotation / scale. Scaling a bone to ~0 hides its parts for free
 * (upgrade toggles, carried hay, needles in trays...).
 */

export interface BoneSpec { parent: number; pos: V3; rot: V3 }

export interface Template {
  main?: THREE.BufferGeometry;
  glass?: THREE.BufferGeometry;
  rigMain?: THREE.BufferGeometry;
  rigGlass?: THREE.BufferGeometry;
  bones: BoneSpec[];
  /** Culling sphere for the skinned mesh (model space). */
  cull: THREE.Sphere;
  lamp?: LampSpec;
}

/** Scale used to hide a bone's parts. */
export const HIDDEN = 1e-4;

export class TemplateBuilder {
  /** Static parts (model space). */
  readonly s = new Parts();
  /** Animated parts (bone space; select the bone with `xf.bone`). */
  readonly r = new Parts(true);
  readonly bones: BoneSpec[] = [{ parent: -1, pos: [0, 0, 0], rot: [0, 0, 0] }];
  lamp?: LampSpec;
  /** Explicit culling radius around `cullCentre` (defaults to the static bounds, generously padded). */
  cullRadius?: number;
  cullCentre?: V3;

  /** Adds a bone (index returned). Bone 0 is the model root. */
  bone(parent: number, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0]): number {
    this.bones.push({ parent, pos, rot });
    return this.bones.length - 1;
  }

  build(): Template {
    const st = this.s.build();
    const rg = this.r.build();
    let cull: THREE.Sphere;
    if (this.cullRadius !== undefined) {
      const c = this.cullCentre ?? [0, 1, 0];
      cull = new THREE.Sphere(new THREE.Vector3(c[0], c[1], c[2]), this.cullRadius);
    } else {
      const bs = st.main?.boundingSphere ?? new THREE.Sphere(new THREE.Vector3(0, 1, 0), 1);
      cull = new THREE.Sphere(bs.center.clone(), bs.radius * 1.25 + 0.5);
    }
    return { main: st.main, glass: st.glass, rigMain: rg.main, rigGlass: rg.glass, bones: this.bones, cull, lamp: this.lamp };
  }
}

/** Instantiated template: meshes + bones under one root. */
export class RigInstance {
  readonly root = new THREE.Group();
  readonly bones: THREE.Bone[] = [];
  readonly lamp: StatusLamp | null;
  private readonly skeleton: THREE.Skeleton | null = null;

  constructor(readonly t: Template, name: string) {
    this.root.name = name;
    const mat = modelMaterial();
    if (t.main) this.addStatic(new THREE.Mesh(t.main, mat), 'body');
    if (t.glass) this.addStatic(new THREE.Mesh(t.glass, glassMaterial()), 'glass', false);
    if (t.rigMain || t.rigGlass) {
      for (let i = 0; i < t.bones.length; i++) {
        const spec = t.bones[i];
        const b = new THREE.Bone();
        b.position.set(spec.pos[0], spec.pos[1], spec.pos[2]);
        b.rotation.set(spec.rot[0], spec.rot[1], spec.rot[2]);
        this.bones.push(b);
        if (spec.parent < 0) this.root.add(b); else this.bones[spec.parent].add(b);
      }
      const inverses = this.bones.map(() => new THREE.Matrix4());
      this.skeleton = new THREE.Skeleton(this.bones, inverses);
      const identity = new THREE.Matrix4();
      const addSkinned = (geo: THREE.BufferGeometry, material: THREE.Material, label: string, shadow: boolean): void => {
        const m = new THREE.SkinnedMesh(geo, material);
        m.name = label;
        m.bind(this.skeleton!, identity);
        m.boundingSphere = t.cull.clone();
        m.castShadow = shadow;
        m.receiveShadow = shadow;
        this.root.add(m);
      };
      if (t.rigMain) addSkinned(t.rigMain, mat, 'moving', true);
      if (t.rigGlass) addSkinned(t.rigGlass, glassMaterial(), 'movingGlass', false);
    }
    this.lamp = t.lamp ? new StatusLamp(this.root, t.lamp) : null;
  }

  private addStatic(m: THREE.Mesh, label: string, shadow = true): void {
    m.name = label;
    m.castShadow = shadow;
    m.receiveShadow = shadow;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    this.root.add(m);
  }

  /** Hide / show every part skinned to a bone (and its children). */
  show(bone: number, visible: boolean): void {
    const s = visible ? 1 : HIDDEN;
    const b = this.bones[bone];
    if (b.scale.x !== s) b.scale.setScalar(s);
  }

  dispose(): void {
    this.skeleton?.dispose();
    this.root.removeFromParent();
  }
}

/** Base class for model instances: status lamp + rig lifecycle. Subclasses implement `animate`. */
export abstract class RigModel implements ModelInstance {
  readonly root: THREE.Object3D;
  protected readonly rig: RigInstance;

  constructor(t: Template, name: string) {
    this.rig = new RigInstance(t, name);
    this.root = this.rig.root;
  }

  update(anim: Record<string, number>, dt: number, time: number): void {
    this.animate(anim, dt, time);
    this.rig.lamp?.update(dt, time);
  }

  protected abstract animate(anim: Record<string, number>, dt: number, time: number): void;

  setStatus(status: MachineStatus): void { this.rig.lamp?.setStatus(status); }

  dispose(): void { this.rig.dispose(); }
}

/** A model with no moving parts (platform, stairs, props). */
export class StaticModel extends RigModel {
  protected animate(): void { /* static */ }
}

/** Reads an anim field (missing = 0), clamped to [lo, hi]. */
export function af(anim: Record<string, number>, key: string, lo = -Infinity, hi = Infinity): number {
  const v = anim[key];
  if (v === undefined || !Number.isFinite(v)) return Math.max(lo, Math.min(hi, 0));
  return v < lo ? lo : v > hi ? hi : v;
}

/** Exponential smoothing factor for frame-rate independent easing. */
export function ease(dt: number, rate: number): number {
  return 1 - Math.exp(-Math.max(0, dt) * rate);
}
