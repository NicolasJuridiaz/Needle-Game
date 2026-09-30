import { WORLD } from '../config/world';
import type { Sim } from '../sim/sim';
import { carryCapacity } from '../sim/playerActions';
import type { GameMode } from '../ui/context';

/**
 * Contextual onboarding: one short line at a time, shown only while it is relevant.
 * No modal tutorials. Each hint resolves itself when the player does the thing.
 */
export interface Hint { id: string; title: string; text: string; key?: string; /** world target for the waypoint arrow */ target?: { x: number; y: number; z: number } }

interface HintRule {
  id: string;
  /** Short stage label. The HUD renders it above the action so the player understands why it matters. */
  title: string;
  /** Should this hint be offered now? */
  when: (g: HintEnv) => boolean;
  /** Is the hint satisfied (never show again)? */
  done: (g: HintEnv) => boolean;
  text: (g: HintEnv) => string;
  key?: string;
  target?: (g: HintEnv) => { x: number; y: number; z: number } | undefined;
  /** Max seconds on screen before giving up (still relevant hints come back after a cool-down). */
  maxTime?: number;
}

export interface HintEnv {
  sim: Sim;
  mode: GameMode;
  label: (code: string) => string;
  /** Seconds since the game started this session. */
  time: number;
  flags: Set<string>;
}

/** Waypoint above the Market intake belt (the SELL HAY belt next to the chute). */
const sellTarget = (_g: HintEnv) => {
  const i = WORLD.intake;
  return { x: i.x + 0.5, y: 2.2, z: (i.z0 + i.z1) / 2 };
};

const RULES: HintRule[] = [
  {
    id: 'dig', title: 'Start with hay', key: 'LMB',
    when: () => true,
    done: (g) => g.sim.progress.stats.hayExtractedManual > 0,
    text: () => 'Hold LMB on the haystack to fill your carry meter',
  },
  {
    id: 'sell', title: 'Sell the load', key: 'E',
    when: (g) => g.sim.player.carry.weight() >= Math.min(10, carryCapacity(g.sim) * 0.5),
    done: (g) => g.sim.progress.stats.firstSaleAt >= 0,
    text: () => 'Take the hay to the SELL HAY intake and deposit it for money',
    target: sellTarget,
  },
  {
    id: 'tree', title: 'Spend the Work Point', key: 'KeyT',
    when: (g) => g.sim.progress.wp > 0,
    done: (g) => g.flags.has('workTreeOpened') || g.sim.progress.nodes.size > 0,
    text: (g) => `Work Points unlock plans. Press ${g.label('KeyT')} to open the Work Tree`,
  },
  {
    id: 'shop', title: 'Buy the unlocked tool', key: 'KeyB',
    when: (g) => [...g.sim.progress.nodes.keys()].some((id) => id === 'p_shovel' || id === 'p_bucket'),
    done: (g) => g.sim.progress.ownedTools.size > 1,
    text: (g) => `Plans make items available; money buys them at SUPPLY CO. Press ${g.label('KeyB')}`,
  },
  {
    id: 'equip', title: 'Equip the new tool',
    when: (g) => g.sim.progress.ownedTools.size > 1,
    done: (g) => g.sim.player.equipped !== 'hands' || g.flags.has('equippedTool'),
    text: () => 'Use 2–6 to switch tools. The highlighted slot is currently equipped',
  },
  {
    id: 'orders', title: 'Take the next contract', key: 'KeyO',
    when: (g) => g.sim.progress.stats.firstSaleAt >= 0 && g.sim.progress.orders.some((o) => o.completed),
    done: (g) => g.flags.has('ordersOpened'),
    text: (g) => `Orders are the main source of Work Points. Press ${g.label('KeyO')} to see the board`,
    maxTime: 12,
  },
  {
    id: 'systems', title: 'How progression works',
    when: (g) => g.sim.progress.stats.firstSaleAt >= 0 && g.sim.progress.nodes.size > 0,
    done: (g) => g.flags.has('ordersOpened') && g.flags.has('workTreeOpened') && g.flags.has('shopOpened'),
    text: () => 'Orders earn Work Points → Work Tree unlocks plans → SUPPLY CO. sells the unlocked items',
    maxTime: 16,
  },
  {
    id: 'detector', title: 'Track a buried needle',
    when: (g) => g.sim.player.equipped === 'detector',
    done: (g) => g.sim.progress.needlesFound.length > 0,
    text: () => 'Follow the beeps: faster = closer. Dig where the signal peaks',
    maxTime: 20,
  },
  {
    id: 'build', title: 'Start automation', key: 'KeyQ',
    when: (g) => g.sim.buildingsOfType('sellStation').length > 0 && [...g.sim.progress.nodes.keys()].some((id) => id === 'f_generator' || id === 'x_hopper'),
    done: (g) => g.sim.progress.stats.machinesBuilt > 0,
    text: (g) => `Buy a machine with ${g.label('KeyB')}, then enter Build Mode. LMB places; ${g.label('KeyR')} rotates`,
  },
  {
    id: 'machine', title: 'Read the machine rail',
    when: (g) => g.mode === 'play' && g.sim.progress.stats.machinesBuilt > 0,
    done: (g) => g.flags.has('machineInspected'),
    text: () => 'Aim at a machine: its status and the action needed appear at bottom-right',
    maxTime: 18,
  },
  {
    id: 'feed', title: 'Fuel the generator', key: 'E',
    when: (g) => g.sim.buildingsOfType('hayGenerator').some((b) => b.status === 'noFuel'),
    done: (g) => g.sim.progress.stats.hayBurned > 150,
    text: () => 'Generators burn hay to power machines. Carry hay to the firebox',
  },
  {
    id: 'rakeTray', title: 'Clear the machine output', key: 'E',
    when: (g) => g.sim.buildingsOfType('pistonRake').some((b) => b.status === 'outputBlocked'),
    done: (g) => g.sim.progress.isUnlocked('l_conveyor') && g.sim.ownedCount('conveyor') > 0,
    text: () => 'The rake tray is full: empty it with E, or connect a conveyor',
    maxTime: 15,
  },
  {
    id: 'belt', title: 'Connect the line',
    when: (g) => g.sim.progress.isUnlocked('l_conveyor') && g.mode === 'build',
    done: (g) => g.sim.ownedCount('conveyor') >= 3,
    text: () => 'Choose Belt, click the start, then the destination. Curves route automatically',
  },
  {
    id: 'power', title: 'Power is overloaded',
    when: (g) => g.sim.power.totalDemand > g.sim.power.totalSupply + 0.5 && g.sim.power.totalSupply > 0,
    done: () => false,
    text: () => 'Power overload: machines run slower. Add or upgrade generators',
    maxTime: 10,
  },
  {
    id: 'needleSlip', title: 'Protect needles in the line',
    when: (g) => g.sim.progress.stats.needlesReturned > 0 && !g.sim.progress.isUnlocked('d_scanner'),
    done: (g) => g.sim.progress.isUnlocked('d_scanner'),
    text: () => 'Machines hide needles inside the hay. Put a Needle Scanner on your belt',
    maxTime: 14,
  },
];

export class Hints {
  private shownTime = new Map<string, number>();
  private doneSet = new Set<string>();
  private current: HintRule | null = null;
  private currentSince = 0;
  private cooldownUntil = new Map<string, number>();

  constructor(done: Iterable<string> = []) { for (const d of done) this.doneSet.add(d); }

  /** Returns the hint to display now (or null). */
  update(env: HintEnv): Hint | null {
    if (env.mode !== 'play' && env.mode !== 'build') return null;
    // Resolve finished hints.
    for (const r of RULES) if (!this.doneSet.has(r.id) && r.done(env)) this.doneSet.add(r.id);
    if (this.current && (this.doneSet.has(this.current.id) || !this.current.when(env))) this.current = null;
    if (this.current && this.current.maxTime !== undefined && env.time - this.currentSince > this.current.maxTime) {
      this.cooldownUntil.set(this.current.id, env.time + 90);
      this.current = null;
    }
    if (!this.current) {
      for (const r of RULES) {
        if (this.doneSet.has(r.id)) continue;
        if ((this.cooldownUntil.get(r.id) ?? 0) > env.time) continue;
        if (!r.when(env)) continue;
        this.current = r;
        this.currentSince = env.time;
        this.shownTime.set(r.id, env.time);
        break;
      }
    }
    if (!this.current) return null;
    const r = this.current;
    return { id: r.id, title: r.title, text: r.text(env), key: r.key, target: r.target?.(env) };
  }

  doneIds(): string[] { return [...this.doneSet]; }
}
