/**
 * SAVE FUZZ: a real factory built by the balance bot is advanced in cycles of
 * advance -> serialize -> JSON round-trip -> Sim.fromSave -> advance ..., next to a control sim advanced the same
 * total time without save/load. Every load must restore the state exactly (heights are quantised to mm, so the hay
 * total is compared within 0.1 %), save -> load -> save must be byte-identical (except savedAt), and over the whole
 * run the fuzzed sim must track the control without drift or duplication.
 */
import { describe, expect, it } from 'vitest';
import { BUILDABLES } from '../src/config/buildables';
import { WORLD } from '../src/config/world';
import { NEEDLE_BUFFS } from '../src/config/needles';
import { TECH_NODES } from '../src/config/techTree';
import type { Building } from '../src/sim/building';
import { LogisticsBuilding } from '../src/sim/logistics/base';
import type { Splitter } from '../src/sim/logistics/index';
import type { SaveData } from '../src/sim/save';
import { Sim } from '../src/sim/sim';
import type { BuildingType, Rot } from '../src/sim/types';
import { Bot } from '../tools/balance/bot';
import { expectNeedleInvariant, feed, findSpot, outPorts, parkPlayer, place, rich, run, unlock } from './support/simKit';

/** Stats touched by needle buffs (compared after every load). */
const BUFF_STATS = [...new Set(NEEDLE_BUFFS.flatMap((b) => b.effects.map((e) => e.stat)))];

interface Fingerprint {
  buildings: string[];
  links: number;
  beltItems: number;
  contents: string;
  money: number;
  wp: number;
  needlesFound: number[];
  needleStatus: string[];
  buffs: number[];
  ordersCompleted: string[];
  ordersActive: string[];
  orderProgress: number[];
  milestones: string[];
  networks: string;
  supply: number;
  hay: number;
  stats: Record<string, number>;
  stableRate: number;
}

function fingerprint(sim: Sim): Fingerprint {
  let links = 0;
  const contents: string[] = [];
  for (const b of sim.buildings.values()) {
    for (const l of b.links) if (l) links++;
    const c = b.contents();
    contents.push(`${b.id}:${c.hay.toFixed(6)}/${c.bale}/${c.wrapped}/${[...c.needles].sort().join('.')}`);
  }
  return {
    buildings: [...sim.buildings.values()].map((b) => `${b.id}:${b.type}@${b.cell.x},${b.cell.z},${b.cell.level}r${b.rot}${b.variant ?? ''}${b.enabled ? '' : '(off)'}`),
    links,
    beltItems: sim.logistics.itemCount(),
    contents: contents.join('|'),
    money: sim.progress.money,
    wp: sim.progress.wp,
    needlesFound: [...sim.progress.needlesFound],
    needleStatus: sim.hay.needles.map((n) => `${n.id}:${n.status}`),
    buffs: BUFF_STATS.map((k) => sim.stat(k)),
    ordersCompleted: sim.progress.orders.filter((o) => o.completed).map((o) => o.id),
    ordersActive: sim.progress.activeOrders().map((o) => o.id),
    orderProgress: sim.progress.activeOrders().map((o) => o.progress),
    milestones: [...sim.progress.milestonesDone].sort(),
    networks: sim.power.networks.map((n) => `${n.generators.join(',')}/${n.poles.join(',')}/${n.consumers.join(',')}`).join(' | '),
    supply: sim.power.totalSupply,
    hay: sim.hay.totalUnits(),
    stats: { ...sim.progress.stats } as unknown as Record<string, number>,
    stableRate: sim.progress.stableRate(),
  };
}

/** JSON of a save without the wall-clock timestamp. */
function canonical(data: SaveData): string {
  const { savedAt: _t, ...rest } = data;
  return JSON.stringify(rest);
}

/** First differing path between two JSON values (for readable failures). */
function firstDiff(a: unknown, b: unknown, path = ''): string | null {
  if (a === b) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return `${path}: ${JSON.stringify(a)?.slice(0, 120)} != ${JSON.stringify(b)?.slice(0, 120)}`;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  for (const k of new Set([...ka, ...kb])) {
    const d = firstDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
    if (d) return d;
  }
  return null;
}

function reload(sim: Sim): { sim: Sim; text: string } {
  const text = JSON.stringify(sim.serialize());
  return { sim: Sim.fromSave(JSON.parse(text)), text };
}

describe('save fuzz: repeated save/load of a real factory', () => {
  for (const seed of [1000, 8919]) {
    it(`seed ${seed}: >= 10 save/load cycles restore exactly and track a control run without drift`, () => {
      const bot = new Bot({ seed, maxMinutes: 42, humanFactor: 1.15, verbose: false });
      bot.run();
      const base = JSON.stringify(bot.sim.serialize());
      const control = Sim.fromSave(JSON.parse(base));
      let fuzz = Sim.fromSave(JSON.parse(base));
      expect(fuzz.buildings.size).toBeGreaterThan(40);
      expect(fuzz.logistics.itemCount()).toBeGreaterThan(20);

      const CYCLES = 12;
      const money0 = control.progress.stats.moneyEarned;
      const extract0 = control.progress.stats.hayExtractedMachine;
      const sold0 = control.progress.stats.haySold + 40 * control.progress.stats.baleSold;
      const diffs: number[] = [];
      for (let c = 0; c < CYCLES; c++) {
        const secs = 17 + ((c * 7) % 23); // uneven cycle lengths: saves land at every phase of every machine
        run(control, secs);
        run(fuzz, secs);

        // ---- save -> load restores everything exactly
        const before = fingerprint(fuzz);
        const { sim: loaded, text } = reload(fuzz);
        loaded.power.tick(0); // no time passes: power totals of the rebuilt networks only
        const after = fingerprint(loaded);
        expect(after.buildings, `cycle ${c} buildings`).toEqual(before.buildings);
        expect(after.links, `cycle ${c} links`).toBe(before.links);
        expect(after.beltItems, `cycle ${c} belt items`).toBe(before.beltItems);
        expect(after.contents, `cycle ${c} contents`).toBe(before.contents);
        expect(after.money, `cycle ${c} money`).toBe(before.money);
        expect(after.wp).toBe(before.wp);
        expect(after.needlesFound).toEqual(before.needlesFound);
        expect(after.needleStatus).toEqual(before.needleStatus);
        expect(after.buffs).toEqual(before.buffs);
        expect(after.ordersCompleted).toEqual(before.ordersCompleted);
        expect(after.ordersActive).toEqual(before.ordersActive);
        expect(after.orderProgress).toEqual(before.orderProgress);
        expect(after.milestones).toEqual(before.milestones);
        expect(after.networks, `cycle ${c} power networks`).toBe(before.networks);
        expect(after.supply, `cycle ${c} power supply`).toBeCloseTo(before.supply, 6);
        expect(Math.abs(after.hay - before.hay) / before.hay, `cycle ${c} hay total`).toBeLessThan(0.001);
        expect(after.stats, `cycle ${c} run stats`).toEqual(before.stats);
        expect(after.stableRate, `cycle ${c} stable delivery rate`).toBeCloseTo(before.stableRate, 6);
        expectNeedleInvariant(loaded, `cycle ${c}`);

        // ---- save -> load -> save is byte-identical (except savedAt)
        const again = JSON.stringify(Sim.fromSave(JSON.parse(text)).serialize());
        const a = canonical(JSON.parse(text) as SaveData);
        const b = canonical(JSON.parse(again) as SaveData);
        if (a !== b) expect.fail(`cycle ${c}: save -> load -> save differs at ${firstDiff(JSON.parse(a), JSON.parse(b))}`);

        fuzz = loaded;

        // ---- fuzzed vs control: no duplication, no drift
        const cm = control.progress.stats.moneyEarned - money0;
        const fm = fuzz.progress.stats.moneyEarned - money0;
        diffs.push((fm - cm) / Math.max(1, cm));
      }
      const cs = control.progress.stats;
      const fs = fuzz.progress.stats;
      const gain = (x: number) => x;
      const cMoney = gain(cs.moneyEarned - money0);
      const fMoney = gain(fs.moneyEarned - money0);
      const cExtract = cs.hayExtractedMachine - extract0;
      const fExtract = fs.hayExtractedMachine - extract0;
      const cSold = cs.haySold + 40 * cs.baleSold - sold0;
      const fSold = fs.haySold + 40 * fs.baleSold - sold0;
      expect(cMoney).toBeGreaterThan(0);
      expect(cExtract).toBeGreaterThan(0);
      const rel = (f: number, c: number) => (f - c) / Math.max(1, c);
      const report = `money ${Math.round(fMoney)} vs ${Math.round(cMoney)}, extracted ${Math.round(fExtract)} vs ${Math.round(cExtract)}, sold ${Math.round(fSold)} vs ${Math.round(cSold)}; per-cycle money diff ${diffs.map((d) => (d * 100).toFixed(2) + '%').join(' ')}`;
      console.info(`[save fuzz seed ${seed}] ${report}`);
      expect(Math.abs(rel(fMoney, cMoney)), report).toBeLessThan(0.02);
      expect(Math.abs(rel(fExtract, cExtract)), report).toBeLessThan(0.02);
      expect(Math.abs(rel(fSold, cSold)), report).toBeLessThan(0.02);
      // Never systematically ahead of the control (would mean items/money are duplicated by loading).
      const ahead = diffs.filter((d) => d > 0.005).length;
      expect(ahead, report).toBeLessThan(CYCLES);
      expect(fs.needlesReturned).toBeLessThanOrEqual(cs.needlesReturned + 1);
      expect(fuzz.buildings.size).toBe(control.buildings.size);
      expect(fuzz.progress.needlesFound.length).toBeGreaterThanOrEqual(control.progress.needlesFound.length - 1);
      expect(fuzz.progress.needlesFound.length).toBeLessThanOrEqual(control.progress.needlesFound.length + 1);
    }, 120_000);
  }
});

// =====================================================================================================
// Deterministic "zoo": every logistics / processing building, no hay-field extraction involved.
// =====================================================================================================

interface Zoo { loop: Building[]; entry: Building; silo: Building; gens: Building[] }

/** Closed loop (hay circulates forever, scanned each lap) + silo -> compressor -> wrapper -> chute. */
function buildZoo(sim: Sim): Zoo {
  const loop: Building[] = [];
  const L = (b: Building): Building => { loop.push(b); return b; };
  const belt = (x: number, z: number, rot: Rot, level: 0 | 1 = 0): Building => L(place(sim, 'conveyor', x, z, rot, undefined, level));
  const entry = belt(-6, -17, 2);
  const split = L(place(sim, 'splitter', -7, -17, 2)) as Splitter;
  split.setMode('priority');
  belt(-8, -17, 2);
  belt(-7, -16, 1); belt(-7, -15, 2); belt(-8, -15, 2); belt(-9, -15, 3); belt(-9, -16, 3);
  belt(-7, -18, 3); belt(-7, -19, 2); belt(-8, -19, 2); belt(-9, -19, 1); belt(-9, -18, 1);
  L(place(sim, 'merger', -9, -17, 2));
  belt(-10, -17, 2);
  L(place(sim, 'uSplitter', -11, -18, 2));
  belt(-12, -17, 2); belt(-12, -18, 2);
  L(place(sim, 'scannerMk2', -16, -18, 2));
  belt(-17, -17, 2); belt(-17, -18, 2);
  L(place(sim, 'uMerger', -18, -18, 2));
  belt(-19, -17, 2);
  L(place(sim, 'beltLift', -20, -17, 2, 'up'));
  belt(-21, -17, 2, 1); belt(-22, -17, 2, 1);
  L(place(sim, 'conveyorRamp', -25, -17, 2, 'down'));
  for (let z = -17; z <= -14; z++) belt(-26, z, 1);
  belt(-26, -13, 0);
  for (let x = -25; x <= -6; x++) belt(x, -13, 0);
  belt(-5, -13, 3);
  for (let z = -14; z >= -16; z--) belt(-5, z, 3);
  belt(-5, -17, 2);
  // Processing chain.
  const silo = place(sim, 'silo', -12, -22, 2);
  place(sim, 'conveyor', -13, -21, 2);
  place(sim, 'compressor', -16, -22, 2);
  place(sim, 'conveyor', -17, -21, 2);
  place(sim, 'wrapper', -20, -22, 2);
  for (let x = -21; x >= -28; x--) place(sim, 'conveyor', x, -21, 2);
  for (let z = -21; z <= 4; z++) place(sim, 'conveyor', -29, z, 1);
  place(sim, 'conveyor', -29, 5, 2);
  // Power.
  const gens = [place(sim, 'hayGenerator', -24, -11, 0), place(sim, 'hayGenerator', -20, -11, 0)];
  place(sim, 'powerPole', -15, -19, 0);
  place(sim, 'powerPole', -18, -15, 0);
  sim.rebuildTopology();
  for (const b of loop) {
    if (!(b instanceof LogisticsBuilding)) continue;
    for (const p of outPorts(b)) expect(sim.logistics.isLinked(b, p.index), `${b.type}#${b.id} out ${p.index}`).toBe(true);
  }
  return { loop, entry, silo, gens };
}

/** Same player actions in both sims: top up generators and the silo. */
function service(sim: Sim, zoo: { silo: number; gens: number[] }): void {
  for (const id of zoo.gens) { sim.player.carry.add('hay', 400); sim.buildings.get(id)!.interact(sim); sim.player.carry.clear(); }
  sim.player.carry.add('hay', 900);
  sim.buildings.get(zoo.silo)!.interact(sim);
  sim.player.carry.clear();
}

function loopItems(sim: Sim, ids: number[]): { n: number; hay: number } {
  let n = 0, hay = 0;
  for (const id of ids) {
    const b = sim.buildings.get(id)!;
    const c = b.contents();
    hay += c.hay;
    n += b instanceof LogisticsBuilding ? b.itemCount() : 0;
  }
  return { n, hay };
}

/** Packets queued inside the MK2 scanner lanes (from its save state). */
function scannerPackets(sim: Sim): number {
  const st = sim.buildingsOfType('scannerMk2')[0].saveState() as { lanes: { input: unknown[]; output: unknown[] }[] };
  return st.lanes.reduce((a, l) => a + l.input.length + l.output.length, 0);
}

describe('save fuzz: deterministic zoo of every logistics / processing building', () => {
  it('mid-transfer junctions, lift, ramp, dual-lane MK2, compressor and wrapper survive 12 save/load cycles', () => {
    const sim = new Sim(5150);
    parkPlayer(sim);
    unlock(sim, TECH_NODES.map((n) => n.id));
    rich(sim);
    const zoo = buildZoo(sim);
    const ids = { silo: zoo.silo.id, gens: zoo.gens.map((g) => g.id) };
    const loopIds = zoo.loop.map((b) => b.id);
    service(sim, ids);
    sim.hay.needles[3].status = 'inTransit';
    let injected = 0;
    let hayIn = 0;
    run(sim, 30, (s) => {
      if (injected < 40) {
        const p = { type: 'hay' as const, amount: injected % 2 ? 10 : 7.5, ...(injected === 5 ? { needleId: 3 } : {}) };
        if (feed(s, zoo.entry, 0, p) === 1) { injected++; hayIn += p.amount; }
      }
    });
    expect(injected).toBe(40);
    const inLoop = (s: Sim) => loopItems(s, loopIds);
    const base = JSON.stringify(sim.serialize());
    const earned0 = sim.progress.stats.moneyEarned;
    const control = Sim.fromSave(JSON.parse(base));
    let fuzz = Sim.fromSave(JSON.parse(base));
    for (let c = 0; c < 12; c++) {
      const secs = 13 + ((c * 11) % 19);
      for (const s of [control, fuzz]) { service(s, ids); run(s, secs); }
      const before = fingerprint(fuzz);
      const { sim: loaded, text } = reload(fuzz);
      loaded.power.tick(0);
      const after = fingerprint(loaded);
      expect(after.contents, `zoo cycle ${c} contents`).toBe(before.contents);
      expect(after.beltItems).toBe(before.beltItems);
      expect(after.links).toBe(before.links);
      expect(after.networks).toBe(before.networks);
      expect(after.stats).toEqual(before.stats);
      const again = JSON.stringify(Sim.fromSave(JSON.parse(text)).serialize());
      const a = canonical(JSON.parse(text) as SaveData);
      const b = canonical(JSON.parse(again) as SaveData);
      if (a !== b) expect.fail(`zoo cycle ${c}: save -> load -> save differs at ${firstDiff(JSON.parse(a), JSON.parse(b))}`);
      fuzz = loaded;
      // The closed loop never gains or loses a packet or a unit of hay (scanner lanes included).
      const lf = inLoop(fuzz);
      const lc = inLoop(control);
      expect(lf.hay, `zoo cycle ${c} loop hay (fuzz)`).toBeCloseTo(hayIn, 6);
      expect(lf.n + scannerPackets(fuzz), `zoo cycle ${c} loop packets (fuzz)`).toBe(40);
      expect(lc.n + scannerPackets(control), `zoo cycle ${c} loop packets (control)`).toBe(40);
      expect(lc.hay, `zoo cycle ${c} loop hay (control)`).toBeCloseTo(hayIn, 6);
      expectNeedleInvariant(fuzz, `zoo cycle ${c}`);
    }
    const cs = control.progress.stats;
    const fs = fuzz.progress.stats;
    const fMoney = fs.moneyEarned - earned0;
    const cMoney = cs.moneyEarned - earned0;
    const report = `wrapped ${fs.wrappedSold} vs ${cs.wrappedSold}, scanned ${Math.round(fs.hayScanned)} vs ${Math.round(cs.hayScanned)}, money ${Math.round(fMoney)} vs ${Math.round(cMoney)}`;
    console.info(`[save fuzz zoo] ${report}`);
    expect(cs.wrappedSold).toBeGreaterThan(20);
    expect(cs.hayScanned).toBeGreaterThan(2000);
    expect(Math.abs(fs.wrappedSold - cs.wrappedSold), report).toBeLessThanOrEqual(1);
    expect(Math.abs(fs.hayScanned - cs.hayScanned) / cs.hayScanned, report).toBeLessThan(0.005);
    expect(cMoney).toBeGreaterThan(0);
    expect(Math.abs(fMoney - cMoney) / cMoney, report).toBeLessThan(0.005);
    expect(fuzz.progress.needlesFound).toEqual(control.progress.needlesFound);
    expect(fuzz.progress.needlesFound).toContain(3);
  }, 120_000);
});

describe('save fuzz: per-building state round trip', () => {
  it('saveState -> loadState -> saveState is identical for every type, also at edge values of timers / phases / credits', () => {
    const sim = new Sim(77);
    parkPlayer(sim);
    unlock(sim, TECH_NODES.map((n) => n.id));
    rich(sim);
    const all: Building[] = [];
    for (const type of Object.keys(BUILDABLES) as BuildingType[]) {
      if (type === 'sellStation') { all.push(sim.sellStation!); continue; }
      const level = BUILDABLES[type].levels.includes(0) ? 0 : 1;
      const spot = findSpot(sim, type, -28, -12, -21, -2, level);
      expect(spot, type).not.toBeNull();
      all.push(sim.place(type, spot!.cell, spot!.rot)!);
    }
    sim.rebuildTopology();
    for (const b of all) if (b.inPorts().length) feed(sim, b, b.inPorts()[0].index, { type: 'hay', amount: 10 }, 2);
    run(sim, 3);
    const roundTrip = (b: Building, label: string): void => {
      const a = JSON.stringify(b.saveState());
      b.loadState(JSON.parse(a));
      expect(JSON.stringify(b.saveState()), `${b.type} ${label}`).toBe(a);
    };
    for (const b of all) roundTrip(b, 'running');
    // Edge values a real tick can leave behind (a save can land on any tick).
    const w = (type: BuildingType) => all.find((b) => b.type === type)! as unknown as Record<string, unknown>;
    Object.assign(w('pistonRake'), { phase: 0.9995, cycling: true });
    ((w('scannerMk1').lanes as { timer: number }[])[0]).timer = 0.9995;
    ((w('scannerMk2').lanes as { timer: number }[])[0]).timer = 0.99999;
    (w('hopper').gates as { credit: number }[]).forEach((g) => { g.credit = -28; });
    (w('silo').gates as { credit: number }[]).forEach((g) => { g.credit = -30; });
    for (const b of all) roundTrip(b, 'edge');
    run(sim, 30);
    for (const b of all) roundTrip(b, 'after 30 s');
  });

  it('powered arm with nothing in reach and a collector that fills up round-trip exactly on every tick', () => {
    const sim = new Sim(78);
    parkPlayer(sim);
    unlock(sim, TECH_NODES.map((n) => n.id));
    rich(sim);
    const gen = place(sim, 'hayGenerator', -26, -18, 0);
    const arm = place(sim, 'roboticArm', -22, -17, 0); // far from any hay: retries every RETRY_INTERVAL
    const edgeX = Math.floor(WORLD.pile.cx - WORLD.pile.rx) - 4;
    let col: Building | null = null;
    for (let x = edgeX; x < edgeX + 8 && !col; x++) if (sim.canPlace('vacuumCollector', { x, z: -3, level: 0 }, 0).ok) col = sim.place('vacuumCollector', { x, z: -3, level: 0 }, 0);
    expect(col).not.toBeNull();
    const gen2 = place(sim, 'hayGenerator', col!.cell.x - 4, col!.cell.z, 0);
    for (const g of [gen, gen2]) { sim.player.carry.add('hay', 500); g.interact(sim); sim.player.carry.clear(); }
    sim.rebuildTopology();
    let full = 0;
    run(sim, 20, () => {
      for (const b of [arm, col!]) {
        const a = JSON.stringify(b.saveState());
        b.loadState(JSON.parse(a));
        expect(JSON.stringify(b.saveState()), `${b.type} t=${sim.time.toFixed(2)}`).toBe(a);
      }
      if (col!.status === 'outputBlocked') full++;
    });
    expect(arm.status).toBe('noHay');
    expect(full, 'collector ran full').toBeGreaterThan(20);
  });
});
