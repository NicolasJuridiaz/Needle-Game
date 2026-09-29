import { describe, expect, it } from 'vitest';
import { TOOLS, WHEELBARROW } from '../src/config/tools';
import { EventBus } from '../src/core/events';
import { Progression } from '../src/sim/progression';
import { supplyPriceRows } from '../src/render/supplyStall';

const progression = () => new Progression(new EventBus());

describe('Supply Co. price board', () => {
  it('lists the actual purchasable tools and wheelbarrow prices, excluding hands', () => {
    const rows = supplyPriceRows(progression());
    expect(rows.map(row => row.id)).toEqual(['shovel', 'bucket', 'pitchfork', 'vacuum', 'detector', 'wheelbarrow']);
    for (const row of rows) {
      const def = row.id === 'wheelbarrow' ? WHEELBARROW : TOOLS[row.id];
      expect(row.cost).toBe(def.cost);
      expect(row.price).toBe(`$${def.cost.toLocaleString('en-US')}`);
      expect(row.state).toBe('LOCKED');
    }
  });

  it('distinguishes a locked plan from an unlocked item regardless of cash balance', () => {
    const p = progression();
    p.nodes.set(TOOLS.shovel.requiresNode!, 1);
    expect(p.canBuyTool('shovel').ok).toBe(false);
    expect(supplyPriceRows(p).find(row => row.id === 'shovel')?.state).toBe('AVAILABLE');
    expect(supplyPriceRows(p).find(row => row.id === 'bucket')?.state).toBe('LOCKED');
    p.money = TOOLS.shovel.cost;
    expect(p.buyTool('shovel')).toBe(true);
    expect(supplyPriceRows(p).find(row => row.id === 'shovel')).toMatchObject({ state: 'OWNED', cost: TOOLS.shovel.cost });
  });

  it('tracks wheelbarrow ownership and restored ownership even if its plan is absent', () => {
    const p = progression();
    p.nodes.set(WHEELBARROW.requiresNode, 1);
    p.money = WHEELBARROW.cost;
    expect(supplyPriceRows(p).find(row => row.id === 'wheelbarrow')?.state).toBe('AVAILABLE');
    expect(p.buyTool('wheelbarrow')).toBe(true);
    p.nodes.clear();
    expect(supplyPriceRows(p).find(row => row.id === 'wheelbarrow')?.state).toBe('OWNED');
  });
});
