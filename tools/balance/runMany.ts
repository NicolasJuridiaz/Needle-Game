/**
 * Many-seed pacing statistics + decision-gap analysis.
 *   npm run balance:many -- --seeds 50 [--gaps] [--minutes 120]
 */
import { Bot, fmt, type Gap } from './bot';

const args = process.argv.slice(2);
const arg = (name: string, def: number) => { const i = args.indexOf(`--${name}`); return i >= 0 ? Number(args[i + 1]) : def; };
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

const pct = (a: number[], p: number) => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.max(0, Math.round(p * (b.length - 1))))]; };
const stats = (a: number[]) => a.length ? `min ${pct(a, 0).toFixed(1)} · P10 ${pct(a, 0.1).toFixed(1)} · median ${pct(a, 0.5).toFixed(1)} · P90 ${pct(a, 0.9).toFixed(1)} · max ${pct(a, 1).toFixed(1)}` : '-';

const completion: number[] = [];
const gapsMax: number[] = [];
const first: Record<string, number[]> = {};
const needles: number[][] = [[], [], [], [], [], []];
let collectorUsed = 0, mk2Used = 0, collectorShare: number[] = [], mk2Share: number[] = [];
const allGaps: { seed: number; g: Gap }[] = [];
const t0 = performance.now();
for (let s = 0; s < seeds; s++) {
  const seed = 1000 + s * 7919;
  const bot = new Bot({ seed, maxMinutes: minutes, humanFactor: 1.15, verbose: false });
  const r = bot.run();
  const end = bot.sim.time;
  if (r.completed) completion.push(r.minutes);
  for (const [name, f] of MILESTONES) {
    const e = bot.log.find((x) => f(x.kind, x.detail));
    if (e) (first[name] ??= []).push(e.t / 60);
    if (name === 'collector' && e && r.completed && end - e.t >= 120) { collectorUsed++; collectorShare.push(e.t / end); }
    if (name === 'MK2' && e && r.completed && end - e.t >= 120) { mk2Used++; mk2Share.push(e.t / end); }
  }
  bot.log.filter((e) => e.kind === 'NEEDLE').forEach((e, i) => needles[i]?.push(e.t / 60));
  const g = bot.gaps(GAP);
  gapsMax.push(Math.max(0, ...bot.gaps(0).map((x) => x.seconds)) / 60);
  for (const x of g) allGaps.push({ seed, g: x });
  process.stdout.write(`seed ${seed}: ${r.completed ? r.minutes.toFixed(1) + ' min' : 'NOT COMPLETED'}  gaps>4min ${g.length}  maxgap ${fmt(Math.max(0, ...bot.gaps(0).map((x) => x.seconds)))}\n`);
}
console.log(`\n=== ${seeds} seeds (${Math.round((performance.now() - t0) / 1000)} s) ===`);
console.log(`completed ${completion.length}/${seeds}`);
console.log(`completion (min): ${stats(completion)}`);
console.log(`max decision gap (min): ${stats(gapsMax)}   seeds with a gap > 4 min: ${new Set(allGaps.map((g) => g.seed)).size}/${seeds}`);
for (const [name] of MILESTONES) console.log(`first ${name.padEnd(10)} (${String(first[name]?.length ?? 0).padStart(2)}/${seeds}): ${stats(first[name] ?? [])}`);
needles.forEach((n, i) => console.log(`needle ${i + 1} (${n.length}/${seeds}): ${stats(n)}`));
console.log(`Vacuum Collector used >= 2 min before the end: ${collectorUsed}/${seeds} (${Math.round((collectorUsed / seeds) * 100)}%), placed at ${stats(collectorShare.map((x) => x * 100))} % of the run`);
console.log(`Scanner MK2 used >= 2 min before the end:      ${mk2Used}/${seeds} (${Math.round((mk2Used / seeds) * 100)}%), placed at ${stats(mk2Share.map((x) => x * 100))} % of the run`);
if (showGaps) {
  console.log('\n--- gaps > 4 min ---');
  for (const { seed, g } of allGaps) {
    console.log(`seed ${seed}  ${fmt(g.from.t)} -> ${fmt(g.to.t)} (${fmt(g.seconds)})  after "${g.from.event}"  until "${g.to.event}"`);
    console.log(`    at start: $${g.from.money} ${g.from.wp}WP deliver ${g.from.delivered}/s power ${g.from.power} saving[${g.from.savingWP}] waiting[${g.from.waitingMoney}] orders[${g.from.orders}] needles ${g.from.needles}`);
    console.log(`    at end:   $${g.to.money} ${g.to.wp}WP deliver ${g.to.delivered}/s power ${g.to.power} saving[${g.to.savingWP}] waiting[${g.to.waitingMoney}] orders[${g.to.orders}] needles ${g.to.needles}`);
  }
}
