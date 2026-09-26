import { BALANCE } from '../../config/balance';
import type { InteractionOption } from '../building';
import type { SimContext, WheelbarrowState } from '../interfaces';
import type { Inventory } from '../inventory';
import { carryCapacity } from '../playerActions';
import type { Sim } from '../sim';
import type { ItemType, Vec3 } from '../types';
import { EPS, foundByPlayer, itemLabel, takeHay } from './shared';

/**
 * Hay / item transfers between the player (carry + HELD wheelbarrow) and machines (E interactions).
 * Deposits empty the held barrow first, then the carry. Takes fill the held barrow first
 * (capacity `wheelbarrow.capacity`), then the carry (capacity from playerActions.carryCapacity).
 */

/** The wheelbarrow if the player is pushing it, else null. */
export function heldBarrow(ctx: SimContext): WheelbarrowState | null {
  const b = ctx.player.wheelbarrow;
  return b && b.held ? b : null;
}

/** Items of `type` the player can hand over (held barrow + carry). */
export function playerAmount(ctx: SimContext, type: ItemType): number {
  const b = heldBarrow(ctx);
  return ctx.player.carry[type] + (b ? b.inv[type] : 0);
}

/** True when neither the carry nor the held barrow contains anything. */
export function playerEmpty(ctx: SimContext): boolean {
  const b = heldBarrow(ctx);
  return ctx.player.carry.isEmpty() && (!b || b.inv.isEmpty());
}

function takeFrom(inv: Inventory, type: ItemType, max: number, needlesOut: number[]): number {
  if (max <= 0) return 0;
  if (type === 'hay') return takeHay(inv, Math.min(max, inv.hay), needlesOut);
  return inv.remove(type, Math.floor(Math.min(max, inv[type]) + EPS));
}

/**
 * Removes up to `max` of `type` from the player (held barrow first, then carry). Hidden needles
 * that leave with the last hay of an inventory are appended to `needlesOut`. Returns the amount removed.
 */
export function takeFromPlayer(ctx: SimContext, type: ItemType, max: number, needlesOut: number[]): number {
  let left = Math.max(0, max);
  let moved = 0;
  const b = heldBarrow(ctx);
  if (b) { const r = takeFrom(b.inv, type, left, needlesOut); moved += r; left -= r; }
  if (left > EPS) moved += takeFrom(ctx.player.carry, type, left, needlesOut);
  return moved;
}

function roomIn(inv: Inventory, capacity: number, type: ItemType): number {
  const w = BALANCE.itemWeight[type];
  const free = Math.max(0, capacity - inv.weight()) / w;
  return type === 'hay' ? free : Math.floor(free + EPS);
}

/** How many `type` items the player can take right now (held barrow + carry). */
export function playerRoom(ctx: SimContext, type: ItemType): number {
  const b = heldBarrow(ctx);
  const barrowRoom = b ? roomIn(b.inv, ctx.stat('wheelbarrow.capacity'), type) : 0;
  return barrowRoom + roomIn(ctx.player.carry, carryCapacity(ctx as unknown as Sim), type);
}

/**
 * Gives up to `n` items of `type` to the player: held barrow first, then carry. Returns the amount
 * given (callers remove exactly that much from their store).
 */
export function giveToPlayer(ctx: SimContext, type: ItemType, n: number): number {
  let left = type === 'hay' ? Math.max(0, n) : Math.floor(Math.max(0, n) + EPS);
  let given = 0;
  const b = heldBarrow(ctx);
  if (b && left > EPS) {
    const r = Math.min(left, roomIn(b.inv, ctx.stat('wheelbarrow.capacity'), type));
    if (r > EPS) { b.inv.add(type, r); given += r; left -= r; }
  }
  if (left > EPS) {
    const r = Math.min(left, roomIn(ctx.player.carry, carryCapacity(ctx as unknown as Sim), type));
    if (r > EPS) { ctx.player.carry.add(type, r); given += r; }
  }
  return given;
}

const noticed: number[] = [];

/**
 * E on a tray/buffer of loose hay: give as much as fits to the player (barrow first). The player
 * rummages through the hay, so every hidden needle stored in `inv` is FOUND ('manual').
 * Returns the hay taken.
 */
export function playerTakesHay(ctx: SimContext, inv: Inventory, source: { id: number }, pos: Vec3): number {
  const n = giveToPlayer(ctx, 'hay', Math.min(inv.hay, playerRoom(ctx, 'hay')));
  if (n <= EPS) return 0;
  noticed.length = 0;
  takeHay(inv, n, noticed);
  for (let i = 0; i < inv.needles.length; i++) noticed.push(inv.needles[i]);
  inv.needles.length = 0;
  if (noticed.length) foundByPlayer(ctx, noticed, pos);
  noticed.length = 0;
  ctx.events.emit('player:take', { sourceId: source.id, amount: n, pos: { x: pos.x, y: pos.y, z: pos.z } });
  return n;
}

/** Prompt for taking loose hay from `inv` ("Take 20 hay"). */
export function takeHayOption(ctx: SimContext, inv: Inventory, emptyReason: string): InteractionOption {
  if (inv.hay <= EPS) return { kind: 'take', label: 'Take hay', enabled: false, reason: emptyReason };
  const n = Math.min(inv.hay, playerRoom(ctx, 'hay'));
  if (n <= EPS) return { kind: 'take', label: `Take ${itemLabel('hay', Math.max(1, inv.hay))}`, enabled: false, reason: 'No room to carry more' };
  return { kind: 'take', label: `Take ${itemLabel('hay', Math.max(1, n))}`, enabled: true };
}
