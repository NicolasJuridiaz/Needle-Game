/**
 * WORK TREE AUDIT — fully automated, data-driven over TECH_NODES (no hardcoded node lists, no costs).
 *
 *  - structure: ids unique, every `requires` exists, no cycles, every node reachable from the roots
 *    (fixpoint over `requires`, AND semantics) and actually maxable with the real Progression -> else DEAD;
 *  - every level does something: changes a stat (Progression.stat before/after, prerequisites unlocked),
 *    or is a plan whose building/tool becomes purchasable, or is a feature gate the game reads
 *    (splitter mode, gated port, id referenced in src) -> else NO-OP;
 *  - every effect does what its op says in two contexts (prerequisites only / everything else maxed);
 *  - descriptions: numeric claims parsed heuristically ("A -> B", "(was N)", "N instead of M", "+N%",
 *    "N% faster/less/more", "Nx", "twice/double", "+N hay", "N m more", "N m", "N P", "N m²"...) must match
 *    the resulting stat values (tolerant: "25% faster" on a x0.8 cycle time is fine) -> else DESC MISMATCH;
 *  - no accidental copies (two nodes/levels with the same effect list);
 *  - every building type (except the Market Chute) and every tool has exactly one reachable plan node.
 *
 * Prints (visible with --reporter=verbose):
 *   WORKTREE AUDIT total=N reachable=N tested=N dead=N noop=N descMismatch=N duplicates=N
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { BUILDABLES } from '../src/config/buildables';
import { BASE_STATS } from '../src/config/stats';
import { parseRequirement, TECH_NODES, type TechNode } from '../src/config/techTree';
import { grantTech } from './support/simKit';
import { TOOLS, WHEELBARROW } from '../src/config/tools';
import { WORLD } from '../src/config/world';
import { EventBus } from '../src/core/events';
import { resolvePorts } from '../src/sim/grid';
import type { SimContext } from '../src/sim/interfaces';
import { Splitter } from '../src/sim/logistics/index';
import { Progression } from '../src/sim/progression';
import type { BuildingType, Effect, ToolId } from '../src/sim/types';

// =====================================================================================================
// Known defects (documented in the audit report). Each one has an `it.fails` below that turns red once
// it is fixed, as a reminder to delete the entry. Everything NOT listed here must pass.
// =====================================================================================================

/** Effect defects that are known and accepted (none: f_industrial_gen was fixed by making f_gen_output a mul). */
const KNOWN_EFFECT_DEFECTS = new Set<string>();

// =====================================================================================================
// Helpers
// =====================================================================================================

const BY_ID = new Map<string, TechNode>(TECH_NODES.map((n) => [n.id, n]));
const STAT_KEYS = Object.keys(BASE_STATS);
const TOOL_IDS = (Object.keys(TOOLS) as ToolId[]).filter((t) => TOOLS[t].requiresNode !== null);
const BUILDING_TYPES = Object.keys(BUILDABLES) as BuildingType[];

function fresh(): Progression {
  const p = new Progression(new EventBus());
  p.addWP(1e9, 'milestone');
  p.addMoney(1e12, 'milestone');
  return p;
}

/** Unlocks the prerequisites of `id` (recursively, the minimum level each requirement asks for). */
function unlockRequires(p: Progression, id: string): boolean {
  const node = BY_ID.get(id);
  if (!node) return false;
  for (const r of node.requires) {
    if (!BY_ID.has(parseRequirement(r)[0])) return false;
    if (!p.isUnlocked(r)) grantTech(p, r);
  }
  return true;
}

/** Satisfies the per-level requirements of the next level of `id`. */
function unlockLevelRequires(p: Progression, id: string): void {
  const node = BY_ID.get(id)!;
  const next = node.levels[p.nodeLevel(id)];
  for (const r of next?.req ?? []) if (!p.isUnlocked(r)) grantTech(p, r);
}

/** Maxes every node except `except` (and whatever depends on it). */
function maxAllExcept(p: Progression, except: string): void {
  for (let pass = 0; pass < 30; pass++) {
    let any = false;
    for (const n of TECH_NODES) {
      if (n.id === except) continue;
      while (p.canUnlock(n.id).ok) { p.unlock(n.id); any = true; }
    }
    if (!any) break;
  }
}

/** Derived numbers that player-facing texts talk about (keys start with the machine prefix + '~'). */
const DERIVED: Record<string, (g: (k: string) => number) => number> = {
  'belt.~throughput': (g) => (g('belt.speed') / g('belt.spacing')) * BALANCE.hayPacketSize,
  'scanner.~throughput': (g) => g('scanner.batch') / g('scanner.cycle'),
  'scanner2.~throughput': (g) => (g('scanner2.batch') * g('scanner2.speedMul') / g('scanner2.cycle')) * (g('scanner2.dualLane') >= 1 ? 2 : 1),
  'compressor.~throughput': (g) => (g('compressor.hayPerBale') * g('compressor.chambers')) / g('compressor.cycle'),
  'rake.~throughput': (g) => g('rake.push') / g('rake.cycleTime'),
  'arm.~grabPerSwing': (g) => g('arm.grab') * g('arm.throughputMul'),
};

type Snap = Map<string, number>;
function snap(p: Progression): Snap {
  const m: Snap = new Map();
  for (const k of STAT_KEYS) m.set(k, p.stat(k));
  const g = (k: string) => m.get(k)!;
  for (const [k, f] of Object.entries(DERIVED)) m.set(k, f(g));
  return m;
}

const prefixOf = (stat: string) => stat.slice(0, stat.lastIndexOf('.') + 1);
const isTimeLike = (stat: string) => /(cycle|cycleTime|interval)$/.test(stat);
const close = (x: number, y: number, rel = 0.015) => Math.abs(x - y) <= Math.max(rel * Math.abs(y), 1e-6);

/** Game source outside config (feature gates are read by id there). */
function srcCode(): string {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) { if (!p.endsWith('config')) walk(p); } else if (p.endsWith('.ts')) files.push(p);
    }
  };
  walk(join(__dirname, '../src'));
  return files.map((f) => readFileSync(f, 'utf8')).join('\n');
}

// =====================================================================================================
// Description parsing
// =====================================================================================================

interface Claim { text: string; kind: 'fromTo' | 'ratio' | 'delta' | 'value' | 'area'; a: number; b: number; pct: boolean }

const N = '(\\d+(?:\\.\\d+)?)';
const RULES: { re: RegExp; make: (m: string[]) => Claim }[] = [
  // "4.5 -> 6 m", "40 -> 75 hay/s", "10% -> 3%"
  { re: new RegExp(`${N}\\s*(%|m|P|hay\\/s|hay)?\\s*->\\s*${N}\\s*(%)?`, 'g'),
    make: (m) => ({ text: m[0], kind: 'fromTo', a: +m[1], b: +m[3], pct: m[2] === '%' || m[4] === '%' }) },
  // "30 hay per swing (was 20)", "3 m deep (was 0.8 m)"
  { re: new RegExp(`${N}\\s*(%)?[^\\d()]*?\\(was ${N}\\s*(%)?`, 'g'),
    make: (m) => ({ text: m[0], kind: 'fromTo', a: +m[3], b: +m[1], pct: m[2] === '%' || m[4] === '%' }) },
  // "32 hay instead of 40"
  { re: new RegExp(`${N}[^\\d]*?\\binstead of ${N}`, 'g'), make: (m) => ({ text: m[0], kind: 'fromTo', a: +m[2], b: +m[1], pct: false }) },
  // "+900 m²"
  { re: new RegExp(`\\+?${N}\\s*m²`, 'g'), make: (m) => ({ text: m[0], kind: 'area', a: +m[1], b: 0, pct: false }) },
  // "+15 hay", "+200 hay", "2 m more reach"
  { re: new RegExp(`\\+${N}\\s*(?:hay|carry)\\b(?!\\/)`, 'g'), make: (m) => ({ text: m[0], kind: 'delta', a: +m[1], b: 0, pct: false }) },
  { re: new RegExp(`${N}\\s*m more\\b`, 'g'), make: (m) => ({ text: m[0], kind: 'delta', a: +m[1], b: 0, pct: false }) },
  { re: new RegExp(`\\+${N}\\s*m\\b`, 'g'), make: (m) => ({ text: m[0], kind: 'delta', a: +m[1], b: 0, pct: false }) },
  // "+50%", "25% faster", "33% tighter", "30% less", "3x", "twice", "double"
  { re: new RegExp(`\\+${N}%`, 'g'), make: (m) => ({ text: m[0], kind: 'ratio', a: 1 + +m[1] / 100, b: 0, pct: false }) },
  { re: new RegExp(`${N}%\\s*(?:faster|more|tighter|denser|bigger|larger|higher)`, 'g'),
    make: (m) => ({ text: m[0], kind: 'ratio', a: 1 + +m[1] / 100, b: 0, pct: false }) },
  { re: new RegExp(`${N}%\\s*(?:less|slower|fewer|lower|smaller|cheaper)`, 'g'),
    make: (m) => ({ text: m[0], kind: 'ratio', a: 1 - +m[1] / 100, b: 0, pct: false }) },
  { re: new RegExp(`\\b${N}x\\b`, 'g'), make: (m) => ({ text: m[0], kind: 'ratio', a: +m[1], b: 0, pct: false }) },
  { re: /\b(?:twice|double)\b/g, make: (m) => ({ text: m[0], kind: 'ratio', a: 2, b: 0, pct: false }) },
  { re: /\btwo\b/g, make: (m) => ({ text: m[0], kind: 'value', a: 2, b: 0, pct: false }) },
  // Any other number: an absolute value ("Silos hold 5,000.", "from 13 m away", "130 P").
  { re: new RegExp(`\\b${N}\\s*(%)?`, 'g'), make: (m) => ({ text: m[0].trim(), kind: 'value', a: +m[1], b: 0, pct: m[2] === '%' }) },
];

function parseClaims(desc: string): Claim[] {
  let s = desc.replace(/(\d),(?=\d{3}\b)/g, '$1');
  const out: Claim[] = [];
  for (const rule of RULES) {
    s = s.replace(rule.re, (...args: unknown[]) => {
      const m = args.slice(0, -2) as string[];
      out.push(rule.make(m));
      return ' '.repeat(m[0].length);
    });
  }
  return out;
}

interface Cand { key: string; before: number; after: number }

function claimHolds(c: Claim, cands: Cand[], siblings: Cand[]): boolean {
  const scales = c.pct ? [100, 1] : [1];
  switch (c.kind) {
    case 'fromTo':
      return cands.some((k) => scales.some((s) => close(k.before * s, c.a) && close(k.after * s, c.b)));
    case 'delta':
      return cands.some((k) => close(k.after - k.before, c.a));
    case 'ratio':
      return cands.some((k) => {
        if (k.before === 0 || k.after === k.before) return false;
        const r = k.after / k.before;
        if (close(r, c.a, 0.03)) return true;
        if (!isTimeLike(k.key)) return false;
        // Time stats: "25% faster" is fine for x0.8 (speed x1.25) and for x0.75 (time -25%).
        return close(1 / r, c.a, 0.03) || (c.a > 1 && Math.abs((1 - r) - (c.a - 1)) <= 0.03);
      });
    case 'value':
      return [...cands, ...siblings].some((k) => scales.some((s) => close(k.after * s, c.a)));
    case 'area': {
      const A = WORLD.annex;
      const area = (A.maxX - A.minX) * (A.maxZ - A.minZ);
      return cands.some((k) => k.key === 'global.warehouseExpansion' && k.after >= 1) && close(area, c.a, 0.05);
    }
  }
}

/** Stat prefixes of the object a plan unlocks (its numbers must be the object's base values). */
const OBJECT_PREFIXES: Record<string, string[]> = {
  hopper: ['hopper.'], pistonRake: ['rake.'], roboticArm: ['arm.'], vacuumCollector: ['collector.'],
  conveyor: ['belt.'], conveyorRamp: ['belt.'], beltLift: ['belt.'], splitter: ['belt.'], merger: ['belt.'], uSplitter: ['belt.'], uMerger: ['belt.'],
  scannerMk1: ['scanner.'], scannerMk2: ['scanner2.'], compressor: ['compressor.', 'econ.baleValue'], wrapper: ['wrapper.', 'econ.wrappedValue'],
  silo: ['silo.'], hayGenerator: ['generator.'], powerPole: ['pole.', 'power.'], platform: ['global.'], stairs: ['global.'],
  shovel: ['tool.shovel.'], bucket: ['tool.bucket.'], pitchfork: ['tool.pitchfork.'], vacuum: ['tool.vacuum.'], detector: ['tool.detector.'],
  wheelbarrow: ['wheelbarrow.'],
};

// =====================================================================================================
// The audit (computed once)
// =====================================================================================================

interface LevelResult { node: string; level: number; unlocked: boolean; changed: string[]; plan: boolean; gate: string | null }

interface Audit {
  total: number;
  reachable: Set<string>;
  maxable: Set<string>;
  tested: number;
  levelsTested: number;
  dead: string[];
  noop: string[];
  descMismatch: string[];
  duplicates: string[];
  effectDefects: string[];
  levels: LevelResult[];
}

let cached: Audit | null = null;

function audit(): Audit {
  if (cached) return cached;
  const code = srcCode();
  const dead: string[] = [];
  const noop: string[] = [];
  const descMismatch: string[] = [];
  const duplicates: string[] = [];
  const effectDefects: string[] = [];
  const levels: LevelResult[] = [];

  // ----- structure --------------------------------------------------------------------------------
  const seenIds = new Set<string>();
  for (const n of TECH_NODES) {
    if (seenIds.has(n.id)) duplicates.push(`duplicate node id ${n.id}`);
    seenIds.add(n.id);
  }
  const badReq = new Set<string>();
  for (const n of TECH_NODES) {
    for (const r of [...n.requires, ...n.levels.flatMap((l) => l.req ?? [])]) {
      const [rid, lv] = parseRequirement(r);
      const rn = BY_ID.get(rid);
      if (!rn) { badReq.add(n.id); dead.push(`${n.id}: requires unknown node "${r}"`); continue; }
      if (lv > rn.levels.length + (rn.levelBase ?? 0)) { badReq.add(n.id); dead.push(`${n.id}: requires ${r} but ${rid} stops at Lv.${rn.levels.length + (rn.levelBase ?? 0)}`); }
    }
    if (n.requires.some((r) => parseRequirement(r)[0] === n.id)) { badReq.add(n.id); dead.push(`${n.id}: requires itself`); }
  }
  // Cycles (DFS colouring).
  const colour = new Map<string, 0 | 1 | 2>();
  const inCycle = new Set<string>();
  const stack: string[] = [];
  const dfs = (id: string): void => {
    colour.set(id, 1);
    stack.push(id);
    // Node-level graph = what gates the FIRST purchase. Level requirements (generator Lv.5 needs poles Lv.3
    // while poles need the generator plans) are no cycles; the real Progression below proves they resolve.
    for (const r0 of BY_ID.get(id)?.requires ?? []) {
      const r = parseRequirement(r0)[0];
      if (!BY_ID.has(r)) continue;
      const c = colour.get(r) ?? 0;
      if (c === 1) { for (const s of stack.slice(stack.indexOf(r))) inCycle.add(s); }
      else if (c === 0) dfs(r);
    }
    stack.pop();
    colour.set(id, 2);
  };
  for (const n of TECH_NODES) if (!colour.get(n.id)) dfs(n.id);
  for (const id of inCycle) dead.push(`${id}: part of a requires cycle`);
  // Reachability from the roots (a node opens once ALL its requirements are open).
  const reachable = new Set<string>();
  for (let changed = true; changed;) {
    changed = false;
    for (const n of TECH_NODES) {
      if (reachable.has(n.id) || badReq.has(n.id)) continue;
      const reqs = n.requires.map((r) => parseRequirement(r)[0]);
      if (reqs.every((r) => reachable.has(r))) { reachable.add(n.id); changed = true; }
    }
  }
  // The real Progression can max every node with enough WP.
  const all = fresh();
  maxAllExcept(all, '');
  const maxable = new Set<string>();
  for (const n of TECH_NODES) if (all.nodeLevel(n.id) === n.levels.length && n.levels.length > 0) maxable.add(n.id);
  for (const n of TECH_NODES) {
    if (inCycle.has(n.id) || badReq.has(n.id)) continue;
    if (!reachable.has(n.id)) dead.push(`${n.id}: not reachable from the roots`);
    else if (!maxable.has(n.id)) dead.push(`${n.id}: reachable but the Progression cannot max it (${all.nodeLevel(n.id)}/${n.levels.length}: ${all.canUnlock(n.id).reason})`);
    if (n.levels.length === 0) dead.push(`${n.id}: has no levels`);
  }

  // ----- per level: something happens + descriptions ----------------------------------------------
  const splitterModes = (p: Progression) =>
    new Splitter({ id: 1, type: 'splitter', cell: { x: 0, z: 0, level: 0 }, rot: 0 }).availableModes({ progress: p } as unknown as SimContext).length;
  const gatedPortTypes = (id: string) => BUILDING_TYPES.filter((t) => BUILDABLES[t].ports.concat(
    ...Object.values(BUILDABLES[t].variants ?? {}).map((v) => v.ports)).some((p) => p.requiresNode !== undefined && parseRequirement(p.requiresNode)[0] === id));
  const portCount = (p: Progression, t: BuildingType) => resolvePorts(t, { x: 0, z: 0, level: 0 }, 0, undefined, (n) => p.isUnlocked(n)).length;

  let tested = 0;
  let levelsTested = 0;
  for (const node of TECH_NODES) {
    if (!reachable.has(node.id)) continue;
    const p = fresh();
    if (!unlockRequires(p, node.id)) continue;
    let allOk = true;
    for (let li = 0; li < node.levels.length; li++) {
      const lv = node.levels[li];
      const tag = `${node.id} L${li + 1}`;
      const before = snap(p);
      const bUnlocked = BUILDING_TYPES.filter((t) => p.buildingUnlocked(t));
      const bTool = node.unlocks?.tool ? p.canBuyTool(node.unlocks.tool).ok : false;
      const bBarrow = p.canBuyTool('wheelbarrow').ok;
      const bModes = splitterModes(p);
      const gTypes = gatedPortTypes(node.id);
      const bPorts = gTypes.map((t) => portCount(p, t));
      unlockLevelRequires(p, node.id);
      const ok = p.unlock(node.id);
      if (!ok) { allOk = false; dead.push(`${tag}: cannot be unlocked with prerequisites met (${p.canUnlock(node.id).reason})`); break; }
      levelsTested++;
      const after = snap(p);

      // Did anything happen?
      const changed = STAT_KEYS.filter((k) => before.get(k) !== after.get(k));
      let plan = false;
      if (li === 0 && node.unlocks) {
        const bs = node.unlocks.building ?? [];
        const bOk = bs.every((t) => !bUnlocked.includes(t) && p.buildingUnlocked(t));
        const tOk = !node.unlocks.tool || (!bTool && p.canBuyTool(node.unlocks.tool).ok);
        const wOk = !node.unlocks.wheelbarrow || (!bBarrow && p.canBuyTool('wheelbarrow').ok);
        plan = bOk && tOk && wOk && (bs.length > 0 || !!node.unlocks.tool || !!node.unlocks.wheelbarrow);
      }
      let gate: string | null = null;
      if (splitterModes(p) > bModes) gate = 'splitter mode';
      else if (gTypes.some((t, i) => portCount(p, t) > bPorts[i])) gate = `port on ${gTypes.join('/')}`;
      else if (code.includes(`'${node.id}'`)) gate = 'id read in src';
      levels.push({ node: node.id, level: li + 1, unlocked: true, changed, plan, gate });
      if (!changed.length && !plan && !gate) noop.push(`${tag}: "${lv.desc}" changes no stat, unlocks no plan and gates nothing`);

      // Description vs numbers.
      if (lv.effects.length) {
        const stats = [...new Set(lv.effects.map((e) => e.stat))];
        const prefixes = new Set(stats.map(prefixOf));
        const keys = [...stats, ...Object.keys(DERIVED).filter((d) => prefixes.has(d.slice(0, d.indexOf('~'))))];
        const cands: Cand[] = keys.map((k) => ({ key: k, before: before.get(k) ?? NaN, after: after.get(k) ?? NaN }));
        const siblings: Cand[] = [...after.keys()].filter((k) => prefixes.has(prefixOf(k)) && !keys.includes(k))
          .map((k) => ({ key: k, before: before.get(k)!, after: after.get(k)! }));
        for (const c of parseClaims(lv.desc)) {
          if (claimHolds(c, cands, siblings)) continue;
          const actual = cands.map((k) => `${k.key} ${+k.before.toFixed(4)} -> ${+k.after.toFixed(4)}`).join(', ');
          descMismatch.push(`${tag}: "${lv.desc}" claims "${c.text}" but ${actual}`);
        }
      } else if (li === 0 && node.unlocks) {
        // Plan text: every number must be a (base) value of the unlocked object.
        const objs = [...(node.unlocks.building ?? []), ...(node.unlocks.tool ? [node.unlocks.tool] : []), ...(node.unlocks.wheelbarrow ? ['wheelbarrow'] : [])];
        const pre = objs.flatMap((o) => OBJECT_PREFIXES[o] ?? []);
        const vals = [...after.entries()].filter(([k]) => pre.some((x) => k.startsWith(x))).map(([, v]) => v);
        const nums = [...lv.desc.replace(/(\d),(?=\d{3}\b)/g, '$1').matchAll(new RegExp(`\\b${N}\\b`, 'g'))].map((m) => +m[1]);
        for (const v of nums) {
          if (vals.some((x) => close(x, v))) continue;
          descMismatch.push(`${tag}: plan text "${lv.desc}" mentions ${v}, which is no base value of ${objs.join('/')}`);
        }
      }
    }
    if (allOk) tested++;
  }

  // ----- every effect does what its op says (two contexts) -----------------------------------------
  for (const node of TECH_NODES) {
    if (!maxable.has(node.id)) continue;
    for (const ctxName of ['prerequisites only', 'everything else maxed'] as const) {
      const p = fresh();
      if (ctxName === 'prerequisites only') unlockRequires(p, node.id); else maxAllExcept(p, node.id);
      for (let li = 0; li < node.levels.length; li++) {
        const effects = node.levels[li].effects;
        if (ctxName === 'prerequisites only') unlockLevelRequires(p, node.id);
        const before = new Map(effects.map((e) => [e.stat, p.stat(e.stat)]));
        if (!p.unlock(node.id)) break;
        const expected = new Map(before);
        for (const e of effects) expected.set(e.stat, applyExpected(p, e, expected.get(e.stat)!));
        for (const e of new Set(effects.map((x) => x.stat))) {
          const b = before.get(e)!, a = p.stat(e), x = expected.get(e)!;
          if (a !== b && close(a, x, 1e-6)) continue;
          effectDefects.push(`${node.id}:L${li + 1}:${e}|${ctxName}: ${e} ${b} -> ${a}, expected ${x}`);
        }
      }
    }
  }

  // ----- duplicates -------------------------------------------------------------------------------
  const sig = new Map<string, { node: string; level: number; desc: string }[]>();
  for (const n of TECH_NODES) {
    n.levels.forEach((lv, i) => {
      if (!lv.effects.length) return;
      const s = lv.effects.map((e) => `${e.stat}:${e.op}:${e.value}`).sort().join('|');
      const list = sig.get(s) ?? [];
      list.push({ node: n.id, level: i + 1, desc: lv.desc });
      sig.set(s, list);
    });
  }
  for (const [s, list] of sig) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      // Repeating the same step inside one node is intentional ("another 25% faster") unless the text is copied too.
      if (a.node === b.node && a.desc !== b.desc) continue;
      duplicates.push(`${a.node} L${a.level} and ${b.node} L${b.level} have identical effects [${s}]`);
    }
  }
  const unlockers = new Map<string, string[]>();
  for (const n of TECH_NODES) {
    const objs = [...(n.unlocks?.building ?? []), ...(n.unlocks?.tool ? [`tool:${n.unlocks.tool}`] : []), ...(n.unlocks?.wheelbarrow ? ['wheelbarrow'] : [])];
    for (const o of objs) unlockers.set(o, [...(unlockers.get(o) ?? []), n.id]);
  }
  for (const [o, ids] of unlockers) if (ids.length > 1) duplicates.push(`${o} is unlocked by several plans: ${ids.join(', ')}`);

  cached = {
    total: TECH_NODES.length, reachable, maxable, tested, levelsTested,
    dead, noop, descMismatch, duplicates, effectDefects, levels,
  };
  return cached;
}

/**
 * Expected value of `stat` after applying effect `e` on top of `before`, with the natural meaning of the op:
 * set -> value, mul -> before * value, add -> before + value * (active tech multipliers on that stat).
 */
function applyExpected(p: Progression, e: Effect, before: number): number {
  if (e.op === 'set') return e.value;
  if (e.op === 'mul') return before * e.value;
  // Stats compose as (base + adds) * muls, so an add is scaled by every active multiplier (this level's included).
  let mul = 1;
  for (const n of TECH_NODES) {
    n.levels.slice(0, p.nodeLevel(n.id)).forEach((lv) => { for (const x of lv.effects) if (x.stat === e.stat && x.op === 'mul') mul *= x.value; });
  }
  return before + e.value * mul;
}

// =====================================================================================================
// Tests
// =====================================================================================================

describe('Work Tree audit', () => {
  it('prints the audit summary', () => {
    const a = audit();
    const line = `WORKTREE AUDIT total=${a.total} reachable=${a.reachable.size} tested=${a.tested} dead=${a.dead.length} noop=${a.noop.length} descMismatch=${a.descMismatch.length} duplicates=${a.duplicates.length}`;
    const details = [
      `  levels tested=${a.levelsTested} (of ${TECH_NODES.reduce((s, n) => s + n.levels.length, 0)}), effect defects=${a.effectDefects.length} (not in KNOWN_EFFECT_DEFECTS: ${a.effectDefects.filter((d) => !KNOWN_EFFECT_DEFECTS.has(d.split('|')[0])).length})`,
      ...a.dead.map((s) => `  DEAD ${s}`),
      ...a.noop.map((s) => `  NOOP ${s}`),
      ...a.descMismatch.map((s) => `  DESC ${s}`),
      ...a.duplicates.map((s) => `  DUP  ${s}`),
      ...a.effectDefects.map((s) => `  EFFECT ${s}`),
    ];
    console.log([line, ...details].join('\n'));
    expect(a.total).toBeGreaterThan(0);
    expect(a.levelsTested).toBeGreaterThan(0);
  });

  it('structure: every requires exists, no cycles, every node reachable and maxable (dead = 0)', () => {
    const a = audit();
    expect(a.dead, a.dead.join('\n')).toEqual([]);
    expect(a.reachable.size).toBe(a.total);
    expect(a.maxable.size).toBe(a.total);
    expect(a.tested).toBe(a.total);
  });

  it('every level changes a stat, is a purchasable plan, or is a feature gate the game reads (noop = 0)', () => {
    const a = audit();
    expect(a.noop, a.noop.join('\n')).toEqual([]);
    // Plans really make their object purchasable; gates really gate something.
    for (const r of a.levels) {
      const node = BY_ID.get(r.node)!;
      if (r.level === 1 && node.kind === 'plan') expect(r.plan, `${r.node}: plan does not make its object purchasable`).toBe(true);
      if (node.kind === 'feature' && !node.levels[r.level - 1].effects.length) expect(r.gate, `${r.node}: feature gates nothing`).not.toBeNull();
    }
  });

  it('level descriptions match the numbers they change (descMismatch = 0)', () => {
    const a = audit();
    expect(a.descMismatch, `Description mismatches:\n${a.descMismatch.join('\n')}`).toEqual([]);
  });

  it('no accidental duplicate nodes/levels (duplicates = 0)', () => {
    const a = audit();
    expect(a.duplicates, a.duplicates.join('\n')).toEqual([]);
  });

  it('every effect changes its stat exactly as its op says, with prerequisites only and with everything else maxed', () => {
    const a = audit();
    const unknown = a.effectDefects.filter((d) => !KNOWN_EFFECT_DEFECTS.has(d.split('|')[0]));
    expect(unknown, unknown.join('\n')).toEqual([]);
  });

  it('every building type (except the Market Chute) and every tool is unlocked by exactly one reachable plan', () => {
    const a = audit();
    expect(BUILDABLES.sellStation.requiresNode).toBeNull();
    for (const t of BUILDING_TYPES) {
      if (t === 'sellStation') continue;
      const req = BUILDABLES[t].requiresNode!;
      if (req.includes('@')) {
        // Unlocked by a technology level (Scanner MK2 = Needle Scanner Lv.5): no separate plan node.
        const [id] = parseRequirement(req);
        expect(TECH_NODES.filter((n) => n.unlocks?.building?.includes(t)), `${t}: level-unlocked, no plan`).toHaveLength(0);
        expect(a.reachable.has(id) && BY_ID.get(id)!.leveled, `${t} level tech ${id}`).toBe(true);
        continue;
      }
      const plans = TECH_NODES.filter((n) => n.unlocks?.building?.includes(t));
      expect(plans.map((n) => n.id), `${t} plans`).toHaveLength(1);
      expect(a.reachable.has(plans[0].id), `${t} plan reachable`).toBe(true);
      expect(plans[0].kind, `${plans[0].id} kind`).toBe('plan');
      expect(req, `${t}.requiresNode`).toBe(plans[0].id);
    }
    for (const t of TOOL_IDS) {
      const plans = TECH_NODES.filter((n) => n.unlocks?.tool === t);
      expect(plans.map((n) => n.id), `${t} plans`).toHaveLength(1);
      expect(a.reachable.has(plans[0].id)).toBe(true);
      expect(TOOLS[t].requiresNode, `${t}.requiresNode`).toBe(plans[0].id);
    }
    const barrow = TECH_NODES.filter((n) => n.unlocks?.wheelbarrow);
    expect(barrow.map((n) => n.id)).toHaveLength(1);
    expect(a.reachable.has(barrow[0].id)).toBe(true);
    expect(WHEELBARROW.requiresNode).toBe(barrow[0].id);
    // And the other way round: every plan node unlocks something whose shop entry points back at it.
    for (const n of TECH_NODES.filter((x) => x.kind === 'plan')) {
      const objs = [...(n.unlocks?.building ?? []), ...(n.unlocks?.tool ? [n.unlocks.tool] : []), ...(n.unlocks?.wheelbarrow ? ['wheelbarrow'] : [])];
      expect(objs.length, `${n.id} unlocks nothing`).toBeGreaterThan(0);
    }
  });

  it('layout: no two nodes of a branch share a panel cell', () => {
    const seen = new Map<string, string>();
    for (const n of TECH_NODES) {
      const k = `${n.branch}:${n.pos[0]},${n.pos[1]}`;
      expect(seen.get(k), `${n.id} overlaps ${seen.get(k)} at ${k}`).toBeUndefined();
      seen.set(k, n.id);
    }
  });

  it('the description parser understands the phrasing used in the tree (self-test)', () => {
    const kinds = (d: string) => parseClaims(d).map((c) => `${c.kind}:${+c.a.toFixed(3)}${c.kind === 'fromTo' ? `>${c.b}` : ''}`);
    expect(kinds('Arm reach 4.5 -> 6 m.')).toEqual(['fromTo:4.5>6']);
    expect(kinds('Transmission loss 10% -> 3%.')).toEqual(['fromTo:10>3']);
    expect(kinds('Arms grab 30 hay per swing (was 20).')).toEqual(['fromTo:20>30']);
    expect(kinds('Bales need 32 hay instead of 40.')).toEqual(['fromTo:40>32']);
    expect(kinds('Rake cycles 25% faster.')).toEqual(['ratio:1.25']);
    expect(kinds('Generators burn 30% less hay.')).toEqual(['ratio:0.7']);
    expect(kinds('+50% hay per cycle and 2 m more reach.')).toEqual(['delta:2', 'ratio:1.5']);
    expect(kinds('Silos hold 5,000.')).toEqual(['value:5000']);
    expect(kinds('All arms upgraded to MK2: +50% throughput, new look.')).toEqual(['ratio:1.5']);
    expect(kinds('Knock down the north wall: +900 m² of factory floor.')).toEqual(['area:900']);
    // Tolerant matching, but real contradictions are caught.
    const c = (key: string, before: number, after: number): Cand[] => [{ key, before, after }];
    expect(claimHolds(parseClaims('Rake cycles 25% faster.')[0], c('rake.cycleTime', 2, 1.6), [])).toBe(true);
    expect(claimHolds(parseClaims('Pitchfork stabs 25% faster.')[0], c('tool.pitchfork.interval', 0.55, 0.4125), [])).toBe(true);
    expect(claimHolds(parseClaims('Rake cycles 25% faster.')[0], c('rake.cycleTime', 2, 2.4), [])).toBe(false);
    expect(claimHolds(parseClaims('Generators make 2x power.')[0], c('generator.output', 90, 90), [])).toBe(false);
    expect(claimHolds(parseClaims('Arm reach 4.5 -> 6 m.')[0], c('arm.reach', 4.5, 7.5), [])).toBe(false);
  });
});
