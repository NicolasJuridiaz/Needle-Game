import type * as THREE from 'three';
import type { BuildingType, MachineStatus, ToolId } from '../../sim/types';

/**
 * 3D MODEL CONTRACT (render layer). Implemented in src/render/models/*.
 *
 * Conventions:
 *  - Units: metres. Y up.
 *  - Buildings are authored in their LOCAL frame facing +X (forward), with the root origin at the
 *    CENTRE of the footprint, on the floor of their base level (y = 0).
 *    Footprint extents: x in [-w/2, w/2], z in [-d/2, d/2] with [w, d] = BUILDABLES[type].footprint.
 *    The view positions the root at buildingCenter() and sets rotation.y = -rot * PI/2.
 *  - Ports: input ports should be visibly marked (dark intake / chute), outputs with a spout / arrow plate.
 *  - Every machine model has a small STATUS LAMP (emissive) that setStatus() colours:
 *      running/processing = green, idle = dim white, noInput/noHay = amber, outputBlocked/full = orange,
 *      noPower/noFuel = red blinking, lowPower = yellow blinking, disabled = off/grey, needleAlarm = red rotating beacon.
 *  - Draw-call budget: merge static parts into as few meshes as possible (vertex colours on the shared
 *    palette material). Animated parts are separate meshes. Target <= 6 meshes per machine.
 *  - Style: stylised low-poly industrial, chunky bevelled shapes, slightly absurd. ORIGINAL designs only.
 */
export interface ModelInstance {
  readonly root: THREE.Object3D;
  /** Drive animated parts from the building's anim fields (see src/sim/animState.ts). */
  update(anim: Record<string, number>, dt: number, time: number): void;
  setStatus(status: MachineStatus): void;
  dispose(): void;
}

export type PropKind = 'wheelbarrow' | 'needle' | 'orderBoard' | 'needleCase' | 'truck';
export type ItemModelKind = 'item:hay' | 'item:bale' | 'item:wrapped' | 'item:wrappedPremium';

export type ModelKind = BuildingType | PropKind;

/** Options for model creation. */
export interface ModelOptions {
  variant?: string;
}

/** First-person tool viewmodels (held in hand, rendered by the FPS camera). */
export interface ToolViewModel {
  readonly root: THREE.Object3D;
  /** action: 0..1 progress of the current use animation (dig swing / scoop), 0 = rest. */
  update(dt: number, time: number, state: { action: number; walking: number; load: number; suck: number; detector?: { strength: number; dirAngle: number; distance: number; tooDeep: boolean; directional: boolean; precise: boolean } }): void;
  dispose(): void;
}

export type ToolViewKind = ToolId | 'wheelbarrow';
