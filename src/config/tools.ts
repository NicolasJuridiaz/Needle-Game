import type { ToolId } from '../sim/types';

export type ToolKind = 'dig' | 'suction' | 'detector';

export interface ToolDef {
  id: ToolId;
  name: string;
  kind: ToolKind;
  /** Hotbar slot key (1-6). */
  slot: number;
  requiresNode: string | null;
  cost: number;
  desc: string;
  icon: string;
}

export const TOOLS: Record<ToolId, ToolDef> = {
  hands: { id: 'hands', name: 'Hands', kind: 'dig', slot: 1, requiresNode: null, cost: 0, desc: 'Grab hay by the fistful.', icon: 'hands' },
  shovel: { id: 'shovel', name: 'Shovel', kind: 'dig', slot: 2, requiresNode: 'p_shovel', cost: 40, desc: 'Scoops three times more than your hands.', icon: 'shovel' },
  bucket: { id: 'bucket', name: 'Bucket', kind: 'dig', slot: 3, requiresNode: 'p_bucket', cost: 180, desc: 'Big scoops. Owning it adds +40 carry capacity.', icon: 'bucket' },
  pitchfork: { id: 'pitchfork', name: 'Pitchfork', kind: 'dig', slot: 4, requiresNode: 'p_pitchfork', cost: 650, desc: 'Fast, deep stabs into the stack.', icon: 'pitchfork' },
  vacuum: { id: 'vacuum', name: 'Vacuum Tool', kind: 'suction', slot: 5, requiresNode: 'p_vacuum', cost: 3200, desc: 'Continuous suction at range. Hold to vacuum.', icon: 'vacuum' },
  detector: { id: 'detector', name: 'Metal Detector', kind: 'detector', slot: 6, requiresNode: 'p_detector', cost: 1500, desc: 'Beeps near buried needles. Faster beeps = closer.', icon: 'detector' },
};

/** The wheelbarrow is a pushable world object, bought like a tool. */
export const WHEELBARROW = {
  name: 'Wheelbarrow',
  requiresNode: 'p_wheelbarrow',
  cost: 1400,
  desc: 'Park it by the stack: hay you dig overflows into it. Push it to sell (E).',
  icon: 'wheelbarrow',
};
