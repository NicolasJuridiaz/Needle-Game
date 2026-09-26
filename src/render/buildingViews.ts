import * as THREE from 'three';
import type { Building } from '../sim/building';
import { buildingCenter, rotatedSize } from '../sim/grid';
import type { BuildingType, Level, MachineStatus, Rot } from '../sim/types';
import type { ModelInstance } from './models/api';
import { createModel } from './models/index';

/** Types drawn by BeltView as instanced tiles instead of full models. */
const TILE_TYPES: ReadonlySet<BuildingType> = new Set<BuildingType>(['conveyor', 'conveyorRamp']);

export type HighlightMode = 'hover' | 'remove' | 'move';
const HIGHLIGHT_COLOR: Record<HighlightMode, number> = { hover: 0xffffff, remove: 0xff3b30, move: 0x3fa9ff };

interface View {
  building: Building;
  model: ModelInstance;
  x: number; z: number; level: Level; rot: Rot;
  variant: string | undefined;
  status: MachineStatus | null;
}

/**
 * One ModelInstance per placed (non-tile) building: transform from buildingCenter/rot, per-frame
 * update(anim), status lamp, and the remove/move hover highlight (tinted overlay on the model's meshes +
 * a translucent footprint box, which also covers conveyor tiles drawn by BeltView).
 */
export class BuildingViews {
  private readonly root = new THREE.Group();
  private readonly views = new Map<number, View>();
  private buildings: Map<number, Building> | null = null;

  // ----- highlight
  private hlId: number | null = null;
  private hlMode: HighlightMode | null = null;
  private readonly hlOverlays: THREE.Mesh[] = [];
  private readonly hlMaterial: THREE.MeshBasicMaterial;
  private readonly boxGeo: THREE.BoxGeometry;
  private readonly boxMat: THREE.MeshBasicMaterial;
  private readonly box: THREE.Mesh;
  private readonly edgeGeo: THREE.EdgesGeometry;
  private readonly edgeMat: THREE.LineBasicMaterial;
  private readonly edges: THREE.LineSegments;
  private readonly hlBox = new THREE.Group();

  constructor(private readonly scene: THREE.Scene) {
    this.root.name = 'buildings';
    this.hlMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false, depthFunc: THREE.LessEqualDepth,
      blending: THREE.AdditiveBlending, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    this.boxGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    this.boxMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false, toneMapped: false });
    this.box = new THREE.Mesh(this.boxGeo, this.boxMat);
    this.edgeGeo = new THREE.EdgesGeometry(this.boxGeo);
    this.edgeMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, toneMapped: false });
    this.edges = new THREE.LineSegments(this.edgeGeo, this.edgeMat);
    this.box.renderOrder = 6;
    this.edges.renderOrder = 6;
    this.hlBox.add(this.box, this.edges);
    this.hlBox.visible = false;
    this.root.add(this.hlBox);
    scene.add(this.root);
  }

  /** Add / remove / re-place models to match the building map (call on topology change). */
  sync(buildings: Map<number, Building>): void {
    this.buildings = buildings;
    for (const [id, v] of this.views) {
      const b = buildings.get(id);
      if (!b || b !== v.building || b.variant !== v.variant) this.removeView(id);
    }
    for (const b of buildings.values()) {
      if (TILE_TYPES.has(b.type)) continue;
      let v = this.views.get(b.id);
      if (!v) {
        const model = createModel(b.type, { variant: b.variant });
        model.root.name = `building:${b.type}:${b.id}`;
        model.root.userData.buildingId = b.id;
        this.root.add(model.root);
        v = { building: b, model, x: NaN, z: NaN, level: 0, rot: 0, variant: b.variant, status: null };
        this.views.set(b.id, v);
      }
      if (v.x !== b.cell.x || v.z !== b.cell.z || v.level !== b.cell.level || v.rot !== b.rot) {
        v.x = b.cell.x; v.z = b.cell.z; v.level = b.cell.level; v.rot = b.rot;
        const c = buildingCenter(b.type, b.cell, b.rot);
        v.model.root.position.set(c.x, c.y, c.z);
        v.model.root.rotation.set(0, -b.rot * Math.PI / 2, 0);
        v.model.root.updateMatrixWorld(true);
      }
    }
    // Re-apply the highlight (the target may have moved or been rebuilt).
    if (this.hlId !== null) { const id = this.hlId, mode = this.hlMode; this.clearHighlight(); this.setHighlight(id, mode); }
  }

  private removeView(id: number): void {
    const v = this.views.get(id);
    if (!v) return;
    if (this.hlId === id) this.clearOverlays();
    this.root.remove(v.model.root);
    v.model.dispose();
    this.views.delete(id);
  }

  /** Animate models + status lamps. */
  update(dt: number, time: number): void {
    for (const v of this.views.values()) {
      const b = v.building;
      if (b.status !== v.status) { v.status = b.status; v.model.setStatus(b.status); }
      v.model.update(b.anim, dt, time);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Highlight
  // ---------------------------------------------------------------------------------------------

  setHighlight(id: number | null, mode: HighlightMode | null): void {
    if (id === this.hlId && mode === this.hlMode) {
      // Keep the box glued to a building being moved/rebuilt without re-traversing.
      if (id !== null) this.placeBox(id);
      return;
    }
    this.clearHighlight();
    if (id === null || mode === null) return;
    const b = this.buildings?.get(id);
    if (!b) return;
    this.hlId = id;
    this.hlMode = mode;
    const color = HIGHLIGHT_COLOR[mode];
    this.hlMaterial.color.setHex(color);
    this.boxMat.color.setHex(color);
    this.edgeMat.color.setHex(color);
    const v = this.views.get(id);
    if (v) {
      v.model.root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || (o as THREE.InstancedMesh).isInstancedMesh || (o as THREE.SkinnedMesh).isSkinnedMesh) return;
        if (o.userData.highlightOverlay) return;
        const overlay = new THREE.Mesh(m.geometry, this.hlMaterial);
        overlay.userData.highlightOverlay = true;
        overlay.renderOrder = 5;
        overlay.raycast = () => { /* not pickable */ };
        this.hlOverlays.push(overlay);
      });
      // Attach after traversal (adding children while traversing would visit them).
      let i = 0;
      v.model.root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || (o as THREE.InstancedMesh).isInstancedMesh || (o as THREE.SkinnedMesh).isSkinnedMesh || o.userData.highlightOverlay) return;
        const ov = this.hlOverlays[i++];
        if (ov && ov.geometry === m.geometry && ov.parent !== m) m.add(ov);
      });
    }
    this.placeBox(id);
  }

  private placeBox(id: number): void {
    const b = this.buildings?.get(id);
    if (!b) { this.hlBox.visible = false; return; }
    const [w, d] = rotatedSize(b.def, b.rot);
    const c = buildingCenter(b.type, b.cell, b.rot);
    const h = Math.max(0.3, b.def.height) + 0.08;
    this.hlBox.position.set(c.x, c.y - 0.02, c.z);
    this.hlBox.scale.set(w + 0.06, h, d + 0.06);
    this.hlBox.visible = true;
  }

  private clearOverlays(): void {
    for (const o of this.hlOverlays) o.removeFromParent();
    this.hlOverlays.length = 0;
  }

  private clearHighlight(): void {
    this.clearOverlays();
    this.hlBox.visible = false;
    this.hlId = null;
    this.hlMode = null;
  }

  /** Model root of a building (e.g. for attaching world-space UI). */
  modelOf(id: number): THREE.Object3D | null { return this.views.get(id)?.model.root ?? null; }

  dispose(): void {
    this.clearHighlight();
    for (const id of [...this.views.keys()]) this.removeView(id);
    this.scene.remove(this.root);
    this.hlMaterial.dispose();
    this.boxGeo.dispose();
    this.boxMat.dispose();
    this.edgeGeo.dispose();
    this.edgeMat.dispose();
    this.buildings = null;
  }
}
