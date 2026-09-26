import * as THREE from 'three';
import { BUILDABLES } from '../../config/buildables';
import type { BuildingType, MachineStatus } from '../../sim/types';
import type { ItemModelKind, ModelInstance, ModelKind, ModelOptions, ToolViewKind, ToolViewModel } from './api';
import { buildConveyorGeometry, type ConveyorGeometryKind } from './conveyor';
import { createHopper, createArm, createCollector, createRake } from './extraction';
import { createScannerMk1, createScannerMk2 } from './detection';
import { createPlatform, createSellStation, createStairs } from './factory';
import { buildItemGeometry } from './items';
import { createConveyor, createLift, createMerger, createRamp, createSplitter, createUMerger, createUSplitter } from './logistics';
import { createGenerator, createPole } from './power';
import { createCompressor, createSilo, createWrapper } from './processing';
import { createProp } from './props';
import { buildToolViewModel } from './tools';

/**
 * Public entry points of the procedural model library (see api.ts for the contract).
 */

type Factory = (opts: ModelOptions) => ModelInstance;

const FACTORIES: Record<ModelKind, Factory> = {
  sellStation: () => createSellStation(),
  hopper: () => createHopper(),
  pistonRake: () => createRake(),
  roboticArm: () => createArm(),
  vacuumCollector: () => createCollector(),
  conveyor: () => createConveyor(),
  conveyorRamp: (o) => createRamp(o.variant ?? BUILDABLES.conveyorRamp.defaultVariant),
  splitter: () => createSplitter(),
  merger: () => createMerger(),
  uSplitter: () => createUSplitter(),
  uMerger: () => createUMerger(),
  beltLift: (o) => createLift(o.variant ?? BUILDABLES.beltLift.defaultVariant),
  scannerMk1: () => createScannerMk1(),
  scannerMk2: () => createScannerMk2(),
  compressor: () => createCompressor(),
  wrapper: () => createWrapper(),
  silo: () => createSilo(),
  hayGenerator: () => createGenerator(),
  powerPole: () => createPole(),
  platform: () => createPlatform(),
  stairs: () => createStairs(),
  wheelbarrow: () => createProp('wheelbarrow'),
  needle: () => createProp('needle'),
  orderBoard: () => createProp('orderBoard'),
  needleCase: () => createProp('needleCase'),
  truck: () => createProp('truck'),
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
  if (!f) return fallbackModel(kind);
  try {
    return f(opts);
  } catch (e) {
    console.error(`[models] failed to build ${kind}`, e);
    return fallbackModel(kind);
  }
}

export function createToolViewModel(kind: ToolViewKind): ToolViewModel {
  return buildToolViewModel(kind);
}

/**
 * Belt item geometry for instancing: base at y = 0 (sits on the belt surface), centred in X/Z, long axis
 * along +X (travel). Returns a fresh geometry owned by the caller.
 */
export function createItemGeometry(kind: ItemModelKind): THREE.BufferGeometry {
  return buildItemGeometry(kind);
}

export type { ConveyorGeometryKind };

/**
 * Conveyor tile geometry (fresh, caller owns it). Tile origin = footprint centre on the level floor, travel
 * +X, belt surface at WORLD.beltHeight; curveL = fed from local -Z, curveR = fed from local +Z; ramp /
 * rampDown span 3 cells; legs = supports for a level-1 tile down to the floor below (belt geometry empty).
 * Belt UV: u across (0..1), v = path length in tiles along travel (scroll the texture by time × belt.speed).
 */
export function createConveyorGeometry(kind: ConveyorGeometryKind): { frame: THREE.BufferGeometry; belt: THREE.BufferGeometry } {
  return buildConveyorGeometry(kind);
}
