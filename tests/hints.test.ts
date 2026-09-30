import { describe, expect, it } from 'vitest';
import { Hints } from '../src/game/hints';
import { Sim } from '../src/sim/sim';

const env = (sim: Sim, time: number) => ({
  sim,
  mode: 'play' as const,
  label: (code: string) => code === 'KeyT' ? 'T' : code,
  time,
  flags: new Set<string>(),
});

describe('contextual guidance', () => {
  it('explains the early loop as staged actions with a reason', () => {
    const sim = new Sim(1000);
    const hints = new Hints();

    expect(hints.update(env(sim, 0))).toMatchObject({
      id: 'dig',
      title: 'Start with hay',
    });

    sim.progress.stats.hayExtractedManual = 1;
    sim.player.carry.add('hay', 10);
    expect(hints.update(env(sim, 1))).toMatchObject({
      id: 'sell',
      title: 'Sell the load',
    });

    sim.player.carry.clear();
    sim.progress.stats.firstSaleAt = 1;
    sim.progress.wp = 1;
    const tree = hints.update(env(sim, 2));
    expect(tree).toMatchObject({ id: 'tree', title: 'Spend the Work Point', key: 'KeyT' });
    expect(tree?.text).toContain('unlock plans');
  });

  it('reminds an existing player how the three progression systems connect', () => {
    const sim = new Sim(1000);
    sim.progress.stats.firstSaleAt = 1;
    sim.progress.nodes.set('p_shovel', 1);
    const hints = new Hints(['dig', 'sell', 'tree', 'shop', 'equip', 'orders']);

    expect(hints.update(env(sim, 30))).toMatchObject({
      id: 'systems',
      title: 'How progression works',
    });
  });
});
