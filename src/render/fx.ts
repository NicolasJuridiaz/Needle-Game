import { BUILDABLES } from '../config/buildables';
import type { EventBus } from '../core/events';
import type { BuildingType } from '../sim/types';
import { COLORS } from './palette';
import type { ParticlePreset, Particles } from './particles';

// -------------------------------------------------------------------------------------------------
// Presets (created once, reused for every emit)
// -------------------------------------------------------------------------------------------------

const HAY_COLORS = [COLORS.hay, COLORS.hayLight, COLORS.hayDark] as const;

const STRAW: ParticlePreset = {
  shape: 'straw', color: COLORS.hay, colors: HAY_COLORS, colorVar: 0.12,
  life: [0.7, 1.3], size: [0.14, 0.24], sizeEnd: 0.9, speed: [1.2, 3.2], up: 1.6, hemisphere: true,
  gravity: 7, drag: 1.2, spin: 7, radius: 0.25, bounce: true,
};
const STRAW_CHUNK: ParticlePreset = {
  shape: 'chunk', color: COLORS.hay, colors: HAY_COLORS, colorVar: 0.1,
  life: [0.6, 1.0], size: [0.22, 0.36], sizeEnd: 0.8, speed: [0.8, 2.2], up: 1.8, hemisphere: true,
  gravity: 9, drag: 0.8, spin: 4, radius: 0.2, bounce: true,
};
const HAY_DUST: ParticlePreset = {
  shape: 'puff', color: 0xd9c08a, alpha: 0.45, colorVar: 0.08,
  life: [0.8, 1.5], size: [0.4, 0.7], sizeEnd: 2.2, speed: [0.2, 0.7], up: 0.35, hemisphere: true,
  gravity: -0.1, drag: 1.5, spin: 0.8, radius: 0.35,
};
const COIN: ParticlePreset = {
  shape: 'coin', color: COLORS.gold, colorVar: 0.1,
  life: [0.9, 1.3], size: [0.2, 0.28], speed: [0.8, 2.0], up: 3.8, hemisphere: true, vertical: 0.4,
  gravity: 9, drag: 0.4, spin: 5, radius: 0.2, bounce: true,
};
const COIN_GLINT: ParticlePreset = {
  shape: 'star', additive: true, color: 0xffe08a,
  life: [0.35, 0.6], size: [0.25, 0.4], sizeEnd: 0.2, speed: [0.3, 1.2], up: 2.0, spin: 2, radius: 0.3,
};
const NEEDLE_STAR: ParticlePreset = {
  shape: 'star', additive: true, color: 0xfff4d6, colors: [0xfff4d6, 0xbfe6ff, 0xffffff],
  life: [0.8, 1.6], size: [0.25, 0.6], sizeEnd: 0.1, speed: [0.5, 2.8], up: 0.8, gravity: -0.3, drag: 1.2, spin: 3, radius: 0.15,
};
const NEEDLE_RING: ParticlePreset = {
  shape: 'ring', additive: true, color: 0xcfe8ff, alpha: 0.9,
  life: [0.55, 0.7], size: [0.4, 0.5], sizeEnd: 7, speed: [0, 0],
};
const CONFETTI: ParticlePreset = {
  shape: 'confetti', color: 0xffffff, colors: [0xff5a5f, 0xffc93c, 0x4dd0e1, 0x7bd148, 0xb28dff, 0xffffff],
  life: [1.4, 2.2], size: [0.1, 0.16], speed: [2, 4.5], up: 3.5, hemisphere: true, vertical: 0.6,
  gravity: 6, drag: 1.4, spin: 10, radius: 0.2, bounce: true,
};
const NEEDLE_GLINT: ParticlePreset = {
  shape: 'star', additive: true, color: 0xfff4d6,
  life: [0.5, 0.9], size: [0.3, 0.5], sizeEnd: 0.2, speed: [0.1, 0.5], up: 0.6, spin: 2, radius: 0.1,
};
const BUILD_DUST: ParticlePreset = {
  shape: 'puff', color: 0xb9b2a4, alpha: 0.5, colorVar: 0.08,
  life: [0.7, 1.2], size: [0.35, 0.6], sizeEnd: 2.4, speed: [1.0, 2.2], up: 0.25, hemisphere: true, vertical: 0.12,
  gravity: -0.2, drag: 2.6, spin: 0.8, radius: 0.1,
};
const DEBRIS: ParticlePreset = {
  shape: 'chunk', color: COLORS.steel, colors: [COLORS.steel, COLORS.steelDark, COLORS.rust], colorVar: 0.15,
  life: [0.6, 1.0], size: [0.12, 0.2], speed: [1.5, 3], up: 2.5, hemisphere: true,
  gravity: 10, drag: 0.5, spin: 8, radius: 0.3, bounce: true,
};
const MACHINE_PUFF: ParticlePreset = {
  shape: 'puff', color: 0xdcd6c8, alpha: 0.4, colorVar: 0.06,
  life: [0.7, 1.2], size: [0.3, 0.5], sizeEnd: 2.0, speed: [0.2, 0.6], up: 0.6, hemisphere: true,
  gravity: -0.3, drag: 1.5, spin: 0.6, radius: 0.25,
};
const SMOKE: ParticlePreset = {
  shape: 'puff', color: 0x55524d, alpha: 0.5, colorVar: 0.1,
  life: [1.6, 2.6], size: [0.4, 0.6], sizeEnd: 3.2, speed: [0.1, 0.35], up: 1.4,
  gravity: -0.4, drag: 0.6, spin: 0.5, radius: 0.1,
};
const SPARK: ParticlePreset = {
  shape: 'spark', additive: true, color: 0xffa040, colors: [0xffa040, 0xffd070, 0xff6a20],
  life: [0.3, 0.7], size: [0.06, 0.12], sizeEnd: 0.4, speed: [1.5, 4], up: 1.5, hemisphere: true,
  gravity: 6, drag: 0.8, radius: 0.1, bounce: true,
};
const ALARM_SPARK: ParticlePreset = {
  ...SPARK, color: 0xff3030, colors: [0xff3030, 0xff7050], life: [0.4, 0.8],
};

/** Machines that exhale hay dust / steam puffs when they finish a cycle. */
const PUFF_TYPES: ReadonlySet<BuildingType> = new Set<BuildingType>([
  'compressor', 'wrapper', 'scannerMk1', 'scannerMk2', 'pistonRake', 'roboticArm', 'vacuumCollector', 'hopper', 'silo',
]);

/**
 * Event-driven visual effects: subscribes to sim events and emits particle bursts.
 * Owns no GPU resources (Particles does); dispose() unsubscribes.
 */
export class Fx {
  private readonly unsub: (() => void)[] = [];
  /** Per-building cooldowns so 20 Hz machine events do not flood the pool. */
  private readonly lastAt = new Map<number, number>();

  constructor(events: EventBus, private readonly particles: Particles) {
    const on: typeof events.on = (t, fn) => { const u = events.on(t, fn); this.unsub.push(u); return u; };
    const now = () => performance.now() / 1000;

    on('hay:extracted', (e) => {
      const p = e.pos;
      if (e.source === 'manual' || e.source === 'vacuumTool') {
        const n = Math.min(14, 3 + Math.round(e.amount * 0.6));
        this.particles.burst(STRAW, p.x, p.y + 0.1, p.z, n);
        this.particles.burst(HAY_DUST, p.x, p.y + 0.1, p.z, 1 + (n >> 3));
        if (e.amount >= 6) this.particles.burst(STRAW_CHUNK, p.x, p.y + 0.1, p.z, 1 + (n >> 3));
      } else {
        // Machines extract continuously: throttle per location bucket.
        const key = -1e9 - ((Math.floor(p.x) + 512) * 1024 + (Math.floor(p.z) + 512));
        if (!this.ready(key, now(), 0.15)) return;
        const n = Math.min(8, 2 + Math.round(e.amount * 0.2));
        this.particles.burst(STRAW, p.x, p.y + 0.1, p.z, n);
        this.particles.burst(HAY_DUST, p.x, p.y + 0.1, p.z, 1);
      }
    });
    on('hay:deposited', (e) => {
      this.particles.burst(STRAW, e.pos.x, e.pos.y + 0.2, e.pos.z, Math.min(10, 2 + Math.round(e.amount * 0.3)));
      this.particles.burst(HAY_DUST, e.pos.x, e.pos.y + 0.1, e.pos.z, 1);
    });
    on('player:deposit', (e) => {
      this.particles.burst(STRAW, e.pos.x, e.pos.y + 0.6, e.pos.z, Math.min(12, 3 + Math.round(e.amount * 0.1)));
    });
    on('sale', (e) => {
      const key = e.viaBelt ? -2 : -3;
      if (e.viaBelt && !this.ready(key, now(), 0.25)) return;
      const n = Math.min(14, 2 + Math.round(Math.log10(1 + e.value) * 3));
      this.particles.burst(COIN, e.pos.x, e.pos.y + 0.8, e.pos.z, n);
      this.particles.burst(COIN_GLINT, e.pos.x, e.pos.y + 0.9, e.pos.z, Math.max(1, n >> 2));
    });
    on('needle:found', (e) => this.needleSparkle(e.pos.x, e.pos.y, e.pos.z));
    on('needle:exposed', (e) => this.particles.burst(NEEDLE_GLINT, e.pos.x, e.pos.y + 0.15, e.pos.z, 4));
    on('needle:returned', (e) => this.particles.burst(NEEDLE_GLINT, e.pos.x, e.pos.y + 0.15, e.pos.z, 6));
    on('building:placed', (e) => this.dust(e.type, e.pos.x, e.pos.y, e.pos.z, false));
    on('building:moved', (e) => this.dust(e.type, e.pos.x, e.pos.y, e.pos.z, false));
    on('building:removed', (e) => this.dust(e.type, e.pos.x, e.pos.y, e.pos.z, true));
    on('machine:cycle', (e) => {
      if (!this.ready(e.id, now(), 0.3)) return;
      const h = BUILDABLES[e.type]?.height ?? 1;
      if (e.type === 'hayGenerator') {
        this.particles.burst(SPARK, e.pos.x, e.pos.y + 0.8, e.pos.z, 4);
        this.particles.burst(SMOKE, e.pos.x, e.pos.y + h + 0.3, e.pos.z, 1);
      } else if (PUFF_TYPES.has(e.type)) {
        this.particles.burst(MACHINE_PUFF, e.pos.x, e.pos.y + Math.min(h, 1.6) * 0.8, e.pos.z, 2);
        if (e.type === 'compressor' || e.type === 'wrapper') this.particles.burst(STRAW, e.pos.x, e.pos.y + 0.7, e.pos.z, 3);
      }
    });
    on('generator:fed', (e) => {
      if (!this.ready(-10 - e.id, now(), 0.2)) return;
      this.particles.burst(SPARK, e.pos.x, e.pos.y + 0.8, e.pos.z, Math.min(10, 3 + Math.round(e.amount * 0.1)));
      this.particles.burst(SMOKE, e.pos.x, e.pos.y + (BUILDABLES.hayGenerator.height + 0.3), e.pos.z, 1);
    });
    on('scanner:alarm', (e) => {
      this.particles.burst(ALARM_SPARK, e.pos.x, e.pos.y + 1.2, e.pos.z, 10);
      this.particles.burst(NEEDLE_GLINT, e.pos.x, e.pos.y + 0.8, e.pos.z, 4);
    });
  }

  private ready(key: number, t: number, cooldown: number): boolean {
    if (this.lastAt.size > 1024) this.lastAt.clear();
    const last = this.lastAt.get(key);
    if (last !== undefined && t - last < cooldown) return false;
    this.lastAt.set(key, t);
    return true;
  }

  /** Big celebratory sparkle (needle found). */
  needleSparkle(x: number, y: number, z: number): void {
    this.particles.burst(NEEDLE_RING, x, y + 0.3, z, 1);
    this.particles.burst(NEEDLE_STAR, x, y + 0.3, z, 26);
    this.particles.burst(CONFETTI, x, y + 0.4, z, 40);
  }

  /** Dust ring at a building's base (placed / moved), plus debris when removed. */
  dust(type: BuildingType, x: number, y: number, z: number, removed: boolean): void {
    const fp = BUILDABLES[type]?.footprint ?? [1, 1];
    const area = fp[0] * fp[1];
    const scale = Math.min(2, 0.7 + Math.sqrt(area) * 0.3);
    this.particles.burst(BUILD_DUST, x, y + 0.1, z, Math.min(16, 3 + area * 2), scale);
    if (removed) this.particles.burst(DEBRIS, x, y + 0.4, z, Math.min(12, 3 + area));
  }

  /** Straw burst helper (e.g. for game-side one-offs). */
  straw(x: number, y: number, z: number, count = 6): void { this.particles.burst(STRAW, x, y, z, count); }

  /** Coin fountain helper. */
  coins(x: number, y: number, z: number, count = 6): void { this.particles.burst(COIN, x, y, z, count); }

  dispose(): void {
    for (const u of this.unsub) u();
    this.unsub.length = 0;
    this.lastAt.clear();
  }
}
