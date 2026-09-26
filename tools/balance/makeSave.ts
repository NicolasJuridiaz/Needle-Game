/**
 * Writes a late-game stress save produced by the balance bot (real sim, no cheats).
 *   npx vite-node tools/balance/makeSave.ts [minutes=40] [seed=1000] [out=late-save.json]
 * Load it in the browser: DevTools console -> localStorage.setItem('pn_save_v1', <file contents>) -> reload.
 */
import { writeFileSync } from 'node:fs';
import { Bot } from './bot';

const [minutes = '40', seed = '1000', out = 'late-save.json'] = process.argv.slice(2);
const bot = new Bot({ seed: Number(seed), maxMinutes: Number(minutes), humanFactor: 1.15, verbose: false });
bot.run();
bot.sim.player.pos = { x: -14, y: 0, z: 9 };
writeFileSync(out, JSON.stringify({ sim: bot.sim.serialize(), meta: { hintsDone: [], continuedAfterCompletion: false } }));
console.log(`wrote ${out}: ${bot.sim.buildings.size} buildings, ${bot.sim.progress.needlesFound.length}/6 needles, ${(bot.sim.time / 60).toFixed(1)} min`);
