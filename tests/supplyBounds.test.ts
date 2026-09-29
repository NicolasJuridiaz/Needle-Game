import { describe, expect, it } from 'vitest';
import { WORLD } from '../src/config/world';
import type { Input } from '../src/game/input';
import { PlayerController } from '../src/game/playerController';
import { Sim } from '../src/sim/sim';
import { getSupplyBounds } from '../src/sim/supplyBounds';
import type { Level } from '../src/sim/types';

/** These cells were buildable before the supply stall grew from two to four metres. */
function legacyFactory(z: number, level: Level): Sim {
  const save = new Sim(712).serialize();
  save.buildings.push({
    id: 999, type: level === 0 ? 'conveyor' : 'platform',
    cell: { x: -32, z, level }, rot: 0, enabled: true, paid: 40, state: {},
  });
  return Sim.fromSave(save);
}

describe('Supply Co. legacy factory clearance', () => {
  it('uses the full stall when its added cells are empty, including during initialization', () => {
    expect(getSupplyBounds(new Sim(711, { generate: false }))).toEqual(WORLD.store);
    expect(getSupplyBounds(new Sim(711))).toEqual(WORLD.store);
  });

  it.each([[-3, 0], [-2, 0], [-3, 1], [-2, 1]] as const)(
    'keeps a saved building at z=%s, level=%s and fits the shop in its original space', (z, level) => {
      const sim = legacyFactory(z, level);
      expect(sim.buildings.get(999)?.cell).toEqual({ x: -32, z, level });
      expect(sim.grid.get(-32, z, level)).toBe(999);
      expect(sim.progress.money).toBe(0); // no forced removal/refund
      expect(getSupplyBounds(sim)).toEqual({ x: -32, z0: -1, z1: 1 });
      const restored = Sim.fromSave(sim.serialize());
      expect(restored.buildings.get(999)?.cell).toEqual({ x: -32, z, level });
      expect(getSupplyBounds(restored)).toEqual(getSupplyBounds(sim));
    },
  );

  it('leaves the old conveyor accessible instead of putting an invisible shop wall in front of it', () => {
    const sim = legacyFactory(-3, 0);
    sim.player.pos = { x: -29.8, y: 0, z: -2.5 };
    sim.player.yaw = Math.PI;
    const player = new PlayerController(sim);
    const walkWest = { isDown: (key: string) => key === 'KeyW', wasPressed: () => false } as unknown as Input;
    for (let i = 0; i < 30; i++) player.update(0.05, walkWest, 1);
    expect(player.x).toBeLessThan(-31.2);
    expect(player.z).toBeCloseTo(-2.5);
  });
});
