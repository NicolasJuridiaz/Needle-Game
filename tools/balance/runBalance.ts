/**
 * Runs the balance bot headless and prints a pacing report.
 *   npm run balance -- --seeds 3 --minutes 90 [--verbose] [--snapshots]
 */
import { Bot, fmt } from './bot';

const args = process.argv.slice(2);
const arg = (name: string, def: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const seeds = arg('seeds', 1);
const minutes = arg('minutes', 90);
const firstSeed = arg('seed', 1000);
const verbose = args.includes('--verbose');
const showSnapshots = args.includes('--snapshots');

/** GDD §3.3 pacing targets (minutes) for the first occurrence of each event. */
const TARGETS: [string, string, number, number][] = [
  ['first sale', 'firstSale', 0, 3],
  ['shovel', 'tool:shovel', 3, 6],
  ['pitchfork / wheelbarrow', 'tool:pitchfork', 6, 10],
  ['metal detector', 'tool:detector', 10, 13],
  ['needle #1', 'needle#1', 10, 16],
  ['hopper', 'build:hopper', 13, 16],
  ['piston rake', 'build:pistonRake', 16, 19],
  ['generator', 'build:hayGenerator', 19, 22],
  ['conveyor trunk', 'line:trunk', 22, 28],
  ['splitter', 'build:splitter', 28, 31],
  ['robotic arm', 'build:roboticArm', 31, 34],
  ['scanner MK1', 'build:scannerMk1', 34, 37],
  ['compressor', 'build:compressor', 37, 40],
  ['silo', 'build:silo', 40, 43],
  ['wrapper', 'build:wrapper', 49, 52],
  ['vacuum collector', 'build:vacuumCollector', 55, 58],
  ['scanner MK2', 'build:scannerMk2', 58, 62],
  ['needle #6 / complete', 'COMPLETE', 50, 70],
];

const summary: string[] = [];
for (let s = 0; s < seeds; s++) {
  const seed = firstSeed + s * 7919;
  const t0 = performance.now();
  const bot = new Bot({ seed, maxMinutes: minutes, humanFactor: 1.15, verbose });
  const res = bot.run();
  const ms = performance.now() - t0;
  const sim = bot.sim;
  const firsts = new Map<string, number>();
  const put = (k: string, t: number) => { if (!firsts.has(k)) firsts.set(k, t); };
  if (sim.progress.stats.firstSaleAt >= 0) put('firstSale', sim.progress.stats.firstSaleAt);
  for (const e of bot.log) {
    if (e.kind === 'build' || e.kind === 'tool') put(`${e.kind}:${e.detail}`, e.t);
    else if (e.kind === 'NEEDLE') put(`needle${e.detail.split(' ')[0]}`, e.t);
    else if (e.kind === 'line') put(`line:${e.detail.split(' ')[0]}`, e.t);
    else if (e.kind === 'COMPLETE') put('COMPLETE', e.t);
    else if (e.kind === 'unlock') put(`unlock:${e.detail.split(' ')[0]}`, e.t);
  }
  console.log(`\n=== seed ${seed}: ${res.completed ? 'COMPLETED' : 'NOT COMPLETED'} at ${res.minutes.toFixed(1)} min (sim ${Math.round(ms)} ms) ===`);
  console.log(`pile removed ${(sim.hay.progress() * 100).toFixed(1)}%  money earned $${Math.round(sim.progress.stats.moneyEarned).toLocaleString('en-US')}  WP earned ${sim.progress.stats.wpEarned} (unspent ${sim.progress.wp})  nodes ${sim.progress.nodes.size}  buildings ${sim.buildings.size}  needles ${sim.progress.needlesFound.length}/6`);
  console.log(`longest stretch without a new decision: ${fmt(bot.longestNoDecision)} (from ${fmt(bot.longestNoDecisionAt)})`);
  console.log('  event                     actual   GDD target');
  for (const [label, key, a, b] of TARGETS) {
    const t = firsts.get(key);
    const m = t === undefined ? NaN : t / 60;
    const flag = t === undefined ? '  MISSING' : m < a - 3 ? '  early' : m > b + 3 ? '  LATE' : '';
    console.log(`  ${label.padEnd(24)} ${t === undefined ? '  --  ' : fmt(t)}   ${String(a).padStart(2)}-${b}${flag}`);
  }
  const needles = bot.log.filter((e) => e.kind === 'NEEDLE').map((e) => `${fmt(e.t)} ${e.detail}`);
  console.log(`needles:\n  ${needles.join('\n  ') || '(none)'}`);
  const orders = bot.log.filter((e) => e.kind === 'order');
  console.log(`orders completed: ${orders.length}  (${orders.map((o) => `${fmt(o.t)} ${o.detail.split(' ')[0]}`).join(', ')})`);
  const active = sim.progress.activeOrders().map((o) => `${o.id} ${Math.round(o.progress)}`);
  console.log(`orders still active: ${active.join(', ') || '-'}`);
  if (showSnapshots) {
    console.log('  time   money     WP  pile%  ndl  extract  delivered  power(d/s)  machines  bottleneck');
    for (const p of bot.snapshots) {
      console.log(`  ${fmt(p.t)}  ${String(p.money).padStart(8)} ${String(p.wp).padStart(4)}  ${String(p.pile).padStart(5)}  ${p.needles}    ${String(p.extract).padStart(5)}  ${String(p.delivered).padStart(8)}  ${p.power.padStart(10)}  ${String(p.machines).padStart(7)}   ${p.bottleneck}`);
    }
  }
  summary.push(`seed ${seed}: ${res.completed ? 'completed' : 'NOT completed'} ${res.minutes.toFixed(1)} min, needles ${sim.progress.needlesFound.length}/6, longest idle ${fmt(bot.longestNoDecision)}`);
}
console.log(`\n${summary.join('\n')}`);
