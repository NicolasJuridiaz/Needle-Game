import type { BuildingType, ItemType, MachineStatus, ToolId, Vec3 } from '../sim/types';

/**
 * Typed event map. The simulation emits; render / UI / audio / analytics subscribe.
 * Keep payloads small and plain (no class instances) so they can be logged / replayed.
 */
export interface GameEvents {
  // ----- Economy / progression
  'money:changed': { money: number; delta: number };
  'wp:changed': { wp: number; delta: number };
  'sale': { item: ItemType; amount: number; value: number; pos: Vec3; viaBelt: boolean };
  'node:unlocked': { id: string; level: number };
  'tool:bought': { tool: ToolId | 'wheelbarrow' };
  'order:progress': { id: string; progress: number; target: number };
  'order:completed': { id: string; money: number; wp: number };
  'order:available': { id: string };
  'milestone': { id: string; name: string; wp: number; money: number };

  // ----- Hay / needles
  'hay:extracted': { amount: number; pos: Vec3; source: 'manual' | 'rake' | 'arm' | 'collector' | 'vacuumTool' };
  'hay:deposited': { amount: number; pos: Vec3 };
  'pile:progress': { progress: number };
  'needle:exposed': { id: number; pos: Vec3 };
  'needle:found': { id: number; index: number; pos: Vec3; by: 'manual' | 'scanner' | 'detector'; buffName: string; buffDesc: string; wp: number; money: number };
  'needle:returned': { id: number; pos: Vec3; where: BuildingType | 'unknown' };
  'needle:inTransit': { id: number; source: BuildingType };

  // ----- Buildings
  'building:placed': { id: number; type: BuildingType; pos: Vec3 };
  'building:removed': { id: number; type: BuildingType; pos: Vec3; refund: number };
  'building:moved': { id: number; type: BuildingType; pos: Vec3 };
  'building:status': { id: number; type: BuildingType; status: MachineStatus };
  'machine:cycle': { id: number; type: BuildingType; pos: Vec3 }; // one work cycle done (sfx/fx hook)
  'scanner:alarm': { id: number; pos: Vec3; needleId: number };
  'generator:fed': { id: number; amount: number; pos: Vec3 };

  // ----- Player
  'player:dig': { tool: ToolId; amount: number; pos: Vec3; full: boolean };
  'player:deposit': { targetId: number; type: BuildingType | 'wheelbarrow'; amount: number; pos: Vec3 };
  'player:take': { sourceId: number; amount: number; pos: Vec3 };
  'player:full': Record<string, never>;
  'player:denied': { reason: string };

  // ----- Power
  'power:changed': { supply: number; demand: number; satisfaction: number };

  // ----- Game flow
  'toast': { text: string; kind: 'info' | 'good' | 'warn' | 'bad'; icon?: string };
  'game:completed': { time: number };
  'game:saved': { auto: boolean };
  'game:loaded': Record<string, never>;
}

type Handler<T> = (payload: T) => void;

export class EventBus<M extends object = GameEvents> {
  private handlers = new Map<keyof M, Set<Handler<unknown>>>();

  on<K extends keyof M>(type: K, fn: Handler<M[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) { set = new Set(); this.handlers.set(type, set); }
    set.add(fn as Handler<unknown>);
    return () => this.off(type, fn);
  }

  off<K extends keyof M>(type: K, fn: Handler<M[K]>): void {
    this.handlers.get(type)?.delete(fn as Handler<unknown>);
  }

  emit<K extends keyof M>(type: K, payload: M[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of set) {
      try { (fn as Handler<M[K]>)(payload); } catch (err) { console.error(`[events] handler for ${String(type)} failed`, err); }
    }
  }

  clear(): void { this.handlers.clear(); }
}
