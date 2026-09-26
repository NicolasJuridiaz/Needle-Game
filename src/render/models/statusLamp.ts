import * as THREE from 'three';
import type { MachineStatus } from '../../sim/types';
import { COLORS, emissiveMaterial } from '../palette';
import { additiveMaterial } from './materials';
import type { V3 } from './parts';

/**
 * Status lamp shared by every machine model. The bulb is a separate tiny mesh whose material is swapped
 * between pooled emissive materials (no per-instance materials, no per-frame allocation).
 *   running/processing = green, idle = dim white, noInput/noHay = amber, outputBlocked/full = orange,
 *   noPower/noFuel = red blinking, lowPower = yellow blinking, disabled = off,
 *   needleAlarm = red rotating beacon (scanners; fast red blink elsewhere).
 */

export interface LampSpec {
  pos: V3;
  /** Bulb radius (m). */
  size?: number;
  /** Rotating alarm beacon (scanners). */
  beacon?: boolean;
}

interface Look { color: number; on: number; blink: number }

const LOOKS: Record<MachineStatus, Look> = {
  running: { color: COLORS.statusGreen, on: 2.2, blink: 0 },
  processing: { color: COLORS.statusGreen, on: 2.2, blink: 0 },
  idle: { color: COLORS.statusIdle, on: 0.35, blink: 0 },
  noInput: { color: COLORS.statusAmber, on: 1.9, blink: 0 },
  noHay: { color: COLORS.statusAmber, on: 1.9, blink: 0 },
  outputBlocked: { color: COLORS.statusOrange, on: 2.1, blink: 0 },
  full: { color: COLORS.statusOrange, on: 2.1, blink: 0 },
  noPower: { color: COLORS.statusRed, on: 2.4, blink: 1.6 },
  noFuel: { color: COLORS.statusRed, on: 2.4, blink: 1.6 },
  lowPower: { color: COLORS.statusYellow, on: 2.0, blink: 1.1 },
  disabled: { color: COLORS.statusOff, on: 0, blink: 0 },
  needleAlarm: { color: COLORS.statusRed, on: 2.8, blink: 4 },
};

let _bulbGeo: THREE.BufferGeometry | null = null;
let _beamGeo: THREE.BufferGeometry | null = null;

function bulbGeometry(): THREE.BufferGeometry {
  if (!_bulbGeo) {
    const g = new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62);
    g.scale(1, 1.15, 1);
    _bulbGeo = g;
  }
  return _bulbGeo;
}

/** Two opposite flat light fans (rotating beacon beams). Unit length along ±X. */
function beamGeometry(): THREE.BufferGeometry {
  if (!_beamGeo) {
    const pos: number[] = [];
    for (const s of [1, -1]) {
      // fan of 3 quads widening away from the bulb
      for (const [y0, y1] of [[-0.05, 0.05], [-0.02, 0.02]]) {
        pos.push(0, y0 * 0.2, 0, s, y0 * 6, 0, s, y1 * 6, 0);
        pos.push(0, y0 * 0.2, 0, s, y1 * 6, 0, 0, y1 * 0.2, 0);
      }
      pos.push(0, 0, 0, s, 0, -0.25, s, 0, 0.25);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    _beamGeo = g;
  }
  return _beamGeo;
}

export class StatusLamp {
  readonly bulb: THREE.Mesh;
  private readonly beacon: THREE.Object3D | null;
  private status: MachineStatus = 'idle';
  private look: Look = LOOKS.idle;
  private onMat: THREE.Material = emissiveMaterial(LOOKS.idle.color, LOOKS.idle.on);
  private offMat: THREE.Material = this.onMat;
  private beaconAngle = 0;

  constructor(parent: THREE.Object3D, spec: LampSpec) {
    const r = spec.size ?? 0.085;
    this.bulb = new THREE.Mesh(bulbGeometry(), this.onMat);
    this.bulb.name = 'statusLamp';
    this.bulb.position.set(spec.pos[0], spec.pos[1], spec.pos[2]);
    this.bulb.scale.setScalar(r);
    this.bulb.castShadow = false;
    parent.add(this.bulb);
    if (spec.beacon) {
      const beams = new THREE.Mesh(beamGeometry(), additiveMaterial(COLORS.statusRed, 0.45));
      beams.name = 'alarmBeacon';
      beams.position.set(spec.pos[0], spec.pos[1] + r * 0.45, spec.pos[2]);
      beams.scale.set(1.6, 1, 1.6);
      beams.visible = false;
      beams.castShadow = false;
      parent.add(beams);
      this.beacon = beams;
    } else {
      this.beacon = null;
    }
  }

  setStatus(s: MachineStatus): void {
    if (s === this.status) return;
    this.status = s;
    this.look = LOOKS[s] ?? LOOKS.idle;
    this.onMat = emissiveMaterial(this.look.color, this.look.on);
    this.offMat = this.look.blink > 0 ? emissiveMaterial(this.look.color, 0.12) : this.onMat;
    this.bulb.material = this.onMat;
    if (this.beacon) this.beacon.visible = s === 'needleAlarm';
  }

  /** Forces the alarm beacon (scanner anim.alarm) independently of the reported status. */
  setAlarm(on: boolean): void {
    if (!this.beacon) return;
    const vis = on || this.status === 'needleAlarm';
    if (this.beacon.visible !== vis) this.beacon.visible = vis;
    if (on && this.status !== 'needleAlarm') this.bulb.material = emissiveMaterial(COLORS.statusRed, 2.8);
    else if (!on && this.status !== 'needleAlarm') this.bulb.material = this.onMat;
  }

  update(dt: number, time: number): void {
    if (this.beacon && this.beacon.visible) {
      this.beaconAngle = (this.beaconAngle + dt * 7.5) % (Math.PI * 2);
      this.beacon.rotation.y = this.beaconAngle;
      return;
    }
    if (this.look.blink > 0) {
      const on = Math.sin(time * Math.PI * 2 * this.look.blink) > -0.2;
      this.bulb.material = on ? this.onMat : this.offMat;
    }
  }
}
