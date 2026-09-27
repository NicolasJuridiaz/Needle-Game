/**
 * Many-seed pacing statistics + decision-gap analysis.
 *   npm run balance:many -- --seeds 50 [--gaps] [--minutes 120]
 * Parallel: run shards into JSON files, then merge them into one report:
 *   npm run balance:many -- --seeds 50 --shard 0/4 --out s0.json   (x4, one per core)
 *   npm run balance:many -- --merge s0.json s1.json s2.json s3.json [--gaps]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { displayLevel, TECH_NODES } from '../../src/config/techTree';
import { Bot, fmt, type Gap } from './bot';

const args = process.argv.slice(2);
const argStr = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const arg = (name: string, def: number) => { const v = argStr(name); return v === undefined ? def : Number(v); };
const seeds = arg('seeds', 50);
const minutes = arg('minutes', 120);
const showGaps = args.includes('--gaps');
const GAP = 240;

const MILESTONES: [string, (k: string, d: string) => boolean][] = [
  ['conveyor', (k, d) => k === 'line' && d.startsWith('trunk')],
  ['rake', (k, d) => k === 'build' && d === 'pistonRake'],
  ['arm', (k, d) => k === 'build' && d === 'roboticArm'],
  ['scanner', (k, d) => k === 'build' && d === 'scannerMk1'],
  ['compressor', (k, d) => k === 'build' && d === 'compressor'],
  ['wrapper', (k, d) => k === 'build' && d === 'wrapper'],
  ['collector', (k, d) => k === 'build' && d === 'vacuumCollector'],
  ['MK2', (k, d) => k === 'build' && d === 'scannerMk2'],
];

/** Everything the report needs from one seed (serialisable, so shards can run in parallel processes). */
interface SeedResult {
  seed: number;
  completed: boolean;
  minutes: number;
  /** Run length (s): completion time, or the time limit. */
  end: number;
  first: Record<string, number>;
  needles: number[];
  maxGap: number;
  gaps: Gap[];
  /** WP earned during the run / WP spent on the Work Tree. */
  wpEarned: number;
  wpSpent: number;
  /** Buildings by type at the end of the run. */
  counts: Record<string, number>;
  /** Displayed level of every technology at the end of the run. */
  levels: Record<string, number>;
  money: number;
  moneyEarned: number;
  /** Displayed levels bought / all displayed levels of the tree (Work Tree completion). */
  levelsBought: number;
}

function runSeed(seed: number): SeedResult {
  const bot = new Bot({ seed, maxMinutes: minutes, humanFactor: 1.15, pileUnits: arg('pile', 0) || undefined, verbose: false });
  const r = bot.run();
  const first: Record<string, number> = {};
  for (const [name, f] of MILESTONES) {
    const e = bot.log.find((x) => f(x.kind, x.detail));
    if (e) first[name] = e.t;
  }
  return {
    seed, completed: r.completed, minutes: r.minutes, end: bot.sim.time, first,
    needles: bot.log.filter((e) => e.kind === 'NEEDLE').map((e) => e.t),
    maxGap: Math.max(0, ...bot.gaps(0).map((x) => x.seconds)),
    gaps: bot.gaps(GAP),
    wpEarned: bot.sim.progress.stats.wpEarned,
    wpSpent: bot.sim.progress.stats.wpEarned - bot.sim.progress.wp,
    counts: Object.fromEntries([...new Set([...bot.sim.buildings.values()].map((b) => b.type))].map((t) => [t, bot.sim.ownedCount(t)])),
    levels: Object.fromEntries(TECH_NODES.map((t) => [t.id, displayLevel(t, bot.sim.progress.nodeLevel(t.id))])),
    money: Math.round(bot.sim.progress.money),
    moneyEarned: Math.round(bot.sim.progress.stats.moneyEarned),
    levelsBought: TECH_NODES.reduce((a, t) => a + bot.sim.progress.nodeLevel(t.id), 0),
  };
}

const pct = (a: number[], p: number) => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.max(0, Math.round(p * (b.length - 1))))]; };
const stats = (a: number[]) => a.length ? `min ${pct(a, 0).toFixed(1)} · P10 ${pct(a, 0.1).toFixed(1)} · median ${pct(a, 0.5).toFixed(1)} · P90 ${pct(a, 0.9).toFixed(1)} · max ${pct(a, 1).toFixed(1)}` : '-';

function report(results: SeedResult[], seconds: number): void {
  const n = results.length;
  const completion = results.filter((r) => r.completed).map((r) => r.minutes);
  /** A late machine counts as "used" when it runs at least 2 min before the 6th needle. */
  const used = (name: string) => results.filter((r) => r.completed && r.first[name] !== undefined && r.end - r.first[name] >= 120);
  const col = used('collector'), mk2 = used('MK2');
  console.log(`\n=== ${n} seeds (${Math.round(seconds)} s) ===`);
  console.log(`completed ${completion.length}/${n}`);
  console.log(`completion (min): ${stats(completion)}`);
  console.log(`max decision gap (min): ${stats(results.map((r) => r.maxGap / 60))}   seeds with a gap > 4 min: ${results.filter((r) => r.gaps.length).length}/${n}`);
  for (const [name] of MILESTONES) {
    const t = results.filter((r) => r.first[name] !== undefined).map((r) => r.first[name] / 60);
    console.log(`first ${name.padEnd(10)} (${String(t.length).padStart(2)}/${n}): ${stats(t)}`);
  }
  for (let i = 0; i < 6; i++) {
    const t = results.filter((r) => r.needles[i] !== undefined).map((r) => r.needles[i] / 60);
    console.log(`needle ${i + 1} (${t.length}/${n}): ${stats(t)}`);
  }
  const treeWP = TECH_NODES.reduce((a, t) => a + t.levels.reduce((b, l) => b + l.cost, 0), 0);
  console.log(`WP earned: ${stats(results.map((r) => r.wpEarned))} · Work Tree bought: ${stats(results.map((r) => (r.wpSpent / treeWP) * 100))} % of ${treeWP} WP`);
  const avg = (f: (r: SeedResult) => number) => (results.reduce((a, r) => a + f(r), 0) / Math.max(1, n));
  const c = (t: string) => (r: SeedResult) => r.counts[t] ?? 0;
  const totalLevels = TECH_NODES.reduce((a, t) => a + t.levels.length, 0);
  console.log(`factory at the end (avg): arms ${avg(c('roboticArm')).toFixed(1)} · rakes ${avg(c('pistonRake')).toFixed(1)} · collectors ${avg(c('vacuumCollector')).toFixed(1)} · scanners ${avg((r) => c('scannerMk1')(r) + c('scannerMk2')(r)).toFixed(1)} · generators ${avg(c('hayGenerator')).toFixed(1)} · processing ${avg((r) => c('compressor')(r) + c('wrapper')(r) + c('silo')(r)).toFixed(1)} · belt tiles ${avg(c('conveyor')).toFixed(0)} · buildings ${avg((r) => Object.values(r.counts).reduce((a, b) => a + b, 0)).toFixed(0)}`);
  console.log(`tech: levels bought ${avg((r) => r.levelsBought).toFixed(1)} / ${totalLevels} (${((avg((r) => r.levelsBought) / totalLevels) * 100).toFixed(0)} %) · Hay Sell Value Lv ${avg((r) => r.levels.e_hay_value).toFixed(1)} · money earned ${Math.round(avg((r) => r.moneyEarned)).toLocaleString('en-US')} · final money ${Math.round(avg((r) => r.money)).toLocaleString('en-US')}`);
  const main = ['p_hands', 'p_shovel', 'x_hopper', 'x_rake', 'x_arm', 'x_collector', 'l_conveyor', 'd_scanner', 'e_silo', 'e_compressor', 'e_wrapper', 'f_generator', 'f_pole'];
  console.log(`avg levels: ${main.map((id) => `${id} ${avg((r) => r.levels[id] ?? 0).toFixed(1)}`).join(' · ')}`);
  const share = (rs: SeedResult[], name: string) => stats(rs.map((r) => (r.first[name] / r.end) * 100));
  console.log(`Vacuum Collector used >= 2 min before the end: ${col.length}/${n} (${Math.round((col.length / n) * 100)}%), placed at ${share(col, 'collector')} % of the run`);
  console.log(`Scanner MK2 used >= 2 min before the end:      ${mk2.length}/${n} (${Math.round((mk2.length / n) * 100)}%), placed at ${share(mk2, 'MK2')} % of the run`);
  if (showGaps) {
    console.log('\n--- gaps > 4 min ---');
    for (const r of results) for (const g of r.gaps) {
      console.log(`seed ${r.seed}  ${fmt(g.from.t)} -> ${fmt(g.to.t)} (${fmt(g.seconds)})  after "${g.from.event}"  until "${g.to.event}"`);
      console.log(`    at start: $${g.from.money} ${g.from.wp}WP deliver ${g.from.delivered}/s power ${g.from.power} saving[${g.from.savingWP}] waiting[${g.from.waitingMoney}] orders[${g.from.orders}] needles ${g.from.needles}`);
      console.log(`    at end:   $${g.to.money} ${g.to.wp}WP deliver ${g.to.delivered}/s power ${g.to.power} saving[${g.to.savingWP}] waiting[${g.to.waitingMoney}] orders[${g.to.orders}] needles ${g.to.needles}`);
    }
  }
}

const mergeAt = args.indexOf('--merge');
if (mergeAt >= 0) {
  const files = args.slice(mergeAt + 1).filter((a) => !a.startsWith('--'));
  const all = files.flatMap((f) => JSON.parse(readFileSync(f, 'utf8')) as { seconds: number; results: SeedResult[] });
  const results = all.flatMap((a) => a.results).sort((a, b) => a.seed - b.seed);
  report(results, Math.max(0, ...all.map((a) => a.seconds)));
} else {
  const [shard, shards] = (argStr('shard') ?? '0/1').split('/').map(Number);
  const out = argStr('out');
  const t0 = performance.now();
  const results: SeedResult[] = [];
  for (let s = shard; s < seeds; s += shards) {
    const r = runSeed(1000 + s * 7919);
    results.push(r);
    process.stdout.write(`seed ${r.seed}: ${r.completed ? r.minutes.toFixed(1) + ' min' : 'NOT COMPLETED'}  gaps>4min ${r.gaps.length}  maxgap ${fmt(r.maxGap)}\n`);
  }
  const seconds = (performance.now() - t0) / 1000;
  if (out) writeFileSync(out, JSON.stringify({ seconds, results }));
  else report(results, seconds);
}
