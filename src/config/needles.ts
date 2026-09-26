import type { Effect } from '../sim/types';

/**
 * NEEDLES — 6 per run. Placement uses controlled randomness: needle i is placed inside depth band i,
 * measured as "fraction of the pile removed when the surface is uniformly lowered to it".
 * Buffs are granted in DISCOVERY order, so early needles always power early-game systems.
 */
export const NEEDLE_BANDS: [number, number][] = [
  [0.02, 0.15],
  [0.15, 0.30],
  [0.30, 0.45],
  [0.45, 0.60],
  [0.66, 0.84],
  [0.88, 0.98],
];

export interface NeedleBuffDef {
  name: string;
  desc: string;
  icon: string;
  effects: Effect[];
  /** Money bonus paid when found. */
  money: number;
}

export const NEEDLE_BUFFS: NeedleBuffDef[] = [
  { name: 'Needle of Strength', desc: '+15% player carry capacity', icon: 'carry', money: 400,
    effects: [{ stat: 'player.carry', op: 'mul', value: 1.15 }, { stat: 'wheelbarrow.capacity', op: 'mul', value: 1.15 }] },
  { name: 'Needle of Momentum', desc: '+15% conveyor speed', icon: 'conveyor', money: 2500,
    effects: [{ stat: 'belt.speed', op: 'mul', value: 1.15 }] },
  { name: 'Needle of Industry', desc: '+15% machine speed', icon: 'gear', money: 6000,
    effects: [{ stat: 'global.machineSpeed', op: 'mul', value: 1.15 }] },
  { name: 'Needle of Thrift', desc: '-15% power consumption', icon: 'power', money: 12000,
    effects: [{ stat: 'power.useMul', op: 'mul', value: 0.85 }] },
  { name: 'Needle of Fortune', desc: '+20% sale value', icon: 'money', money: 20000,
    effects: [{ stat: 'econ.saleMul', op: 'mul', value: 1.2 }] },
  { name: 'Needle of the Claw', desc: '+20% robotic arm capacity', icon: 'claw', money: 30000,
    effects: [{ stat: 'arm.grab', op: 'mul', value: 1.2 }] },
];

export const NEEDLE_COUNT = NEEDLE_BANDS.length;
