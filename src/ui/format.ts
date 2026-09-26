import { ITEMS } from '../config/items';
import type { OrderDef } from '../config/orders';

/**
 * Pure formatting helpers for the UI (no DOM access, unit-tested in Node).
 */

const INT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const ONE = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 0 });

/** 12345.6 -> "12,346". Negative values keep their sign. */
export function fmtInt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return INT.format(Math.round(n));
}

/** Up to one decimal, without trailing zero: 3.25 -> "3.3", 4 -> "4". */
export function fmtOne(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return ONE.format(n);
}

/** Compact number: 999 -> "999", 12500 -> "12.5k", 1234567 -> "1.23M". */
export function fmtCompact(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const a = Math.abs(n);
  const s = n < 0 ? '-' : '';
  if (a < 1000) return s + fmtInt(a);
  if (a < 100_000) return s + trimZeros((a / 1000).toFixed(1)) + 'k';
  if (a < 1_000_000) return s + Math.round(a / 1000) + 'k';
  if (a < 100_000_000) return s + trimZeros((a / 1_000_000).toFixed(2)) + 'M';
  if (a < 1_000_000_000) return s + Math.round(a / 1_000_000) + 'M';
  return s + trimZeros((a / 1_000_000_000).toFixed(2)) + 'B';
}

function trimZeros(s: string): string {
  return s.indexOf('.') >= 0 ? s.replace(/\.?0+$/, '') : s;
}

/** Money for the HUD: full digits below one million, compact above. */
export function fmtMoney(n: number): string {
  const v = Math.floor(Math.max(0, n) + 1e-6);
  return '$' + (v < 1_000_000 ? fmtInt(v) : fmtCompact(v));
}

/** Money for prices/rewards: "$1,250", "$45k" when large. */
export function fmtPrice(n: number): string {
  const v = Math.round(Math.max(0, n));
  return '$' + (v < 100_000 ? fmtInt(v) : fmtCompact(v));
}

/** Seconds -> "m:ss" (or "h:mm:ss" from one hour). */
export function fmtClock(sec: number): string {
  const t = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const ss = s < 10 ? '0' + s : '' + s;
  if (h > 0) return `${h}:${m < 10 ? '0' + m : m}:${ss}`;
  return `${m}:${ss}`;
}

/** Seconds -> "42 min" / "1 h 05 min" / "35 s" (run summary). */
export function fmtDuration(sec: number): string {
  const t = Math.max(0, Math.round(Number.isFinite(sec) ? sec : 0));
  if (t < 60) return `${t} s`;
  const m = Math.floor(t / 60);
  if (m < 60) return `${m} min ${t % 60 < 10 ? '0' : ''}${t % 60} s`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h} h ${mm < 10 ? '0' : ''}${mm} min`;
}

/** Elapsed milliseconds -> "just now" / "12 s ago" / "3 min ago". */
export function fmtAgo(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const s = Math.floor(ms / 1000);
  if (s < 3) return 'just now';
  if (s < 60) return `${s} s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return `${h} h ago`;
}

/** Throughput / rates: one decimal below 10, integer above. */
export function fmtRate(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  return n < 10 ? fmtOne(n) : fmtInt(n);
}

/** 0..1 -> "69%". */
export function fmtPct(f: number): string {
  if (!Number.isFinite(f)) return '0%';
  return Math.round(f * 100) + '%';
}

// ---------------------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------------------

const CODE_RE = /^(Key[A-Z]|Digit\d|Numpad\w+|Arrow(Up|Down|Left|Right)|Shift(Left|Right)|Control(Left|Right)|Alt(Left|Right)|Meta(Left|Right)|Space|Escape|Tab|Enter|Backspace|CapsLock|Backquote|Minus|Equal|Bracket(Left|Right)|Semicolon|Quote|Comma|Period|Slash|Backslash|F\d{1,2})$/;

/** True when `k` is a KeyboardEvent.code (to be translated with ctx.keyLabel) rather than a ready label. */
export function isKeyCode(k: string): boolean {
  return CODE_RE.test(k);
}

/** Mouse button pseudo-keys rendered with a mouse glyph. */
export type MouseKey = 'LMB' | 'RMB' | 'MMB' | 'Wheel';
export function mouseKey(k: string): MouseKey | null {
  return k === 'LMB' || k === 'RMB' || k === 'MMB' || k === 'Wheel' ? k : null;
}

/** Normalize a hint/prompt key: codes are translated to the user's layout; labels pass through. */
export function keyText(k: string, keyLabel: (code: string) => string): string {
  if (!k) return '';
  if (isKeyCode(k)) {
    const l = keyLabel(k);
    return l || k;
  }
  return k;
}

// ---------------------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------------------

export interface OrderProgressText {
  /** Current value, formatted. */
  cur: string;
  /** Target value, formatted. */
  target: string;
  /** Unit / description after the numbers, e.g. "hay sold". */
  unit: string;
  /** 0..1 completion. */
  frac: number;
}

/** Player-facing description of what an order counts. */
export function orderMetricLabel(def: OrderDef): string {
  switch (def.metric) {
    case 'sell': {
      const item = def.item ?? 'hay';
      return item === 'hay' ? 'hay sold' : `${ITEMS[item].plural.toLowerCase()} sold`;
    }
    case 'sellViaBelt': return 'hay delivered by belt';
    case 'extractManual': return 'hay dug by hand';
    case 'extractMachine': return 'hay dug by machines';
    case 'extractArm': return 'hay picked by arms';
    case 'burn': return 'hay burned';
    case 'scan': return 'hay scanned';
    case 'needles': return def.target === 1 ? 'needle found' : 'needles found';
    case 'poweredMachines': return 'powered machines running';
    case 'powerGen': return 'P generated';
    case 'siloStored': return 'hay stored in silos';
    case 'stableRate': return 'hay/s delivered (1 min avg)';
    case 'pileProgress': return 'of the stack cleared';
  }
}

/** Progress numbers of an order for bars and labels. */
export function orderProgress(def: OrderDef, progress: number): OrderProgressText {
  const p = Math.max(0, Number.isFinite(progress) ? progress : 0);
  const frac = def.target > 0 ? Math.min(1, p / def.target) : 1;
  const unit = orderMetricLabel(def);
  if (def.metric === 'pileProgress') {
    return { cur: fmtPct(Math.min(p, def.target)), target: fmtPct(def.target), unit, frac };
  }
  if (def.metric === 'stableRate') {
    return { cur: fmtRate(Math.min(p, def.target)), target: fmtInt(def.target), unit, frac };
  }
  return { cur: fmtInt(Math.min(Math.floor(p), def.target)), target: fmtInt(def.target), unit, frac };
}

// ---------------------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------------------

/** Relative arrow angle (radians, 0 = straight ahead, + = clockwise/right) of a world direction
 * seen by a player with the controller's yaw convention (forward = (cos yaw, -sin yaw)). */
export function relativeBearing(dirX: number, dirZ: number, yaw: number): number {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const fwd = dirX * c - dirZ * s;
  const right = dirX * s + dirZ * c;
  return Math.atan2(right, fwd);
}

/** Number of lit bars (0..n) for a 0..1 signal strength. Any detectable signal lights at least one bar. */
export function signalBars(strength: number, n: number): number {
  if (!(strength > 0)) return 0;
  return Math.max(1, Math.min(n, Math.ceil(strength * n - 1e-9)));
}
