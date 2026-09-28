import { WORLD } from '../config/world';
import { Inventory } from './inventory';
import type { PlayerSave, WheelbarrowState } from './interfaces';
import { Stamina } from './stamina';
import type { ToolId, Vec3 } from './types';

/**
 * Sim-side player state. Position/orientation are written by the FPS controller (or the balance bot);
 * inventory, tools and the wheelbarrow are owned here.
 */
export class PlayerState {
  pos: Vec3 = { x: WORLD.spawn.x, y: 0, z: WORLD.spawn.z };
  yaw: number = WORLD.spawn.yaw;
  pitch = 0;
  carry = new Inventory();
  equipped: ToolId = 'hands';
  wheelbarrow: WheelbarrowState | null = null;
  /** Seconds until the equipped tool can act again. */
  cooldown = 0;
  /** Physical effort (sprint, manual digging). Not saved: always rested after loading. */
  readonly stamina = new Stamina();

  serialize(): PlayerSave {
    return {
      pos: { ...this.pos }, yaw: this.yaw, pitch: this.pitch,
      carry: this.carry.toJSON(),
      equipped: this.equipped,
      wheelbarrow: this.wheelbarrow
        ? { pos: { ...this.wheelbarrow.pos }, yaw: this.wheelbarrow.yaw, held: this.wheelbarrow.held, inv: this.wheelbarrow.inv.toJSON() }
        : null,
    };
  }

  deserialize(s: PlayerSave): void {
    this.stamina.reset();
    this.pos = { ...s.pos };
    this.yaw = s.yaw;
    this.pitch = s.pitch;
    this.carry = Inventory.from(s.carry);
    this.equipped = s.equipped;
    this.wheelbarrow = s.wheelbarrow
      ? { pos: { ...s.wheelbarrow.pos }, yaw: s.wheelbarrow.yaw, held: s.wheelbarrow.held, inv: Inventory.from(s.wheelbarrow.inv) }
      : null;
  }
}
