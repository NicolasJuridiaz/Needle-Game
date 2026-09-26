/**
 * Runs the balance bot headless and prints a pacing report.
 *   npm run balance -- --seeds 3 --minutes 90 --verbose
 */
import { Bot, fmt } from './bot';

const args = process.argv.slice(2);
const arg = (name: string, def: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const seeds = arg('seeds', 1);
const minutes = arg('minutes', 90);
const verbose = args.includes('--verbose');

const KEY_EVENTS = ['shovel', 'bucket', 'pitchfork', 'wheelbarrow', 'detector', 'vacuum'];

for (let s = 0; s < seeds; s++) {
  const seed = 1000 + s * 7919;
  const t0 = performance.now();
  const bot = new Bot({ seed, maxMinutes: minutes, humanFactor: 1.15, verbose });
  const res = bot.run();
  const ms = performance.now() - t0;
  const sim = bot.sim;
  const firsts = new Map<string, number>();
  for (const e of bot.log) {
    const key = e.kind === 'build' || e.kind === 'tool' ? `${e.kind}:${e.detail}` : e.kind === 'NEEDLE' ? `needle#${e.detail.split(' ')[0]}` : e.kind === 'unlock' ? `unlock:${e.detail}` : '';
    if (key && !firsts.has(key)) firsts.set(key, e.t);
  }
  console.log(`\n=== seed ${seed}: ${res.completed ? 'COMPLETED' : 'NOT COMPLETED'} at ${res.minutes.toFixed(1)} min (sim ${Math.round(ms)} ms) ===`);
  console.log(`pile removed ${(sim.hay.progress() * 100).toFixed(1)}%  money earned $${Math.round(sim.progress.stats.moneyEarned).toLocaleString('en-US')}  WP earned ${sim.progress.stats.wpEarned}  nodes ${sim.progress.nodes.size}  buildings ${sim.buildings.size}`);
  console.log(`longest stretch without a new decision: ${fmt(bot.longestNoDecision)}`);
  const rows = [...firsts.entries()].sort((a, b) => a[1] - b[1]);
  for (const [k, t] of rows) {
    if (k.startsWith('unlock:') && !/(Plans|_plans)/.test(k) && !k.includes('p_') && !k.includes('f_generator')) continue;
    if (k.startsWith('tool:') || k.startsWith('build:') || k.startsWith('needle') || KEY_EVENTS.some((e) => k.includes(e)) || k.startsWith('unlock:')) {
      console.log(`  ${fmt(t)}  ${k}`);
    }
  }
  const orders = bot.log.filter((e) => e.kind === 'order');
  console.log(`orders completed: ${orders.length}  (${orders.map((o) => `${fmt(o.t)} ${o.detail.split(' ')[0]}`).join(', ')})`);
}
