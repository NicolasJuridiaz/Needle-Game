import * as THREE from 'three';
import { BUILDABLES } from '../../config/buildables';
import type { BuildingType, MachineStatus } from '../../sim/types';
import type { ItemModelKind, ModelInstance, ModelKind, ModelOptions, ToolViewKind, ToolViewModel } from './api';
import { createHopper } from './extraction';

/**
 * Public entry points of the procedural model library (see api.ts for the contract).
 */

type Factory = (opts: ModelOptions) => ModelInstance;

const FACTORIES: Partial<Record<ModelKind, Factory>> = {
  hopper: () => createHopper(),
};

function fallbackModel(kind: ModelKind): ModelInstance {
  const def = (BUILDABLES as Record<string, { footprint: [number, number]; height: number } | undefined>)[kind as BuildingType];
  const [w, d] = def?.footprint ?? [1, 1];
  const h = def?.height ?? 1;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w * 0.95, h, d * 0.95), new THREE.MeshStandardMaterial({ color: 0x888888 }));
  mesh.position.y = h / 2;
  const root = new THREE.Group();
  root.add(mesh);
  return {
    root,
    update() { /* fallback */ },
    setStatus(_s: MachineStatus) { /* fallback */ },
    dispose() { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); },
  };
}

export function createModel(kind: ModelKind, opts: ModelOptions = {}): ModelInstance {
  const f = FACTORIES[kind];
  return f ? f(opts) : fallbackModel(kind);
}

export function createToolViewModel(_kind: ToolViewKind): ToolViewModel {
  const root = new THREE.Group();
  return { root, update() { /* fallback */ }, dispose() { /* fallback */ } };
}

export function createItemGeometry(kind: ItemModelKind): THREE.BufferGeometry {
  return kind === 'item:hay' ? new THREE.IcosahedronGeometry(0.16, 0) : new THREE.BoxGeometry(0.5, 0.35, 0.35);
}

export type ConveyorGeometryKind = 'straight' | 'curveL' | 'curveR' | 'ramp' | 'rampDown' | 'legs';

export function createConveyorGeometry(kind: ConveyorGeometryKind): { frame: THREE.BufferGeometry; belt: THREE.BufferGeometry } {
  const len = kind === 'ramp' || kind === 'rampDown' ? 3 : 1;
  return { frame: new THREE.BoxGeometry(len, 0.4, 0.9).translate(0, 0.2, 0), belt: new THREE.PlaneGeometry(len, 0.8).rotateX(-Math.PI / 2).translate(0, 0.45, 0) };
}
