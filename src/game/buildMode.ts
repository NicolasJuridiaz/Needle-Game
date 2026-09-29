import { BUILDABLES, LOGISTICS_TYPES } from '../config/buildables';
import { WORLD } from '../config/world';
import type { BeltPlan, BeltPlanStep, PlacementCheck } from '../sim/interfaces';
import { neighbor, resolvePorts, rotatedSize } from '../sim/grid';
import type { Sim } from '../sim/sim';
import { oppositeDir, type BuildingType, type Cell, type Level, type Rot, type Vec3, type WorldPort } from '../sim/types';
import type { BuildHudState, BuildTool } from '../ui/context';
import type { Input } from './input';
import type { Aim, Interaction } from './interaction';

/** Render-side hooks the build mode drives (implemented by the game with the render module). */
export interface BuildVisuals {
  setGridVisible(on: boolean): void;
  showGhost(type: BuildingType, cell: Cell, rot: Rot, variant: string | undefined, valid: boolean, ports: WorldPort[], connected: boolean[]): void;
  showBeltPath(steps: BeltPlanStep[], valid: boolean): void;
  hideGhost(): void;
  setHighlight(id: number | null, mode: 'hover' | 'remove' | 'move' | null): void;
}

export interface BuildSounds { play(id: 'place' | 'placeBelt' | 'remove' | 'rotate' | 'invalid' | 'modeCycle' | 'deny'): void }

type RouteMode = 'xFirst' | 'zFirst' | 'auto';

/**
 * Build mode: ghost preview, snapping, rotation, validity, belts (click start -> click end),
 * remove (with drag-remove for belts) and move (contents kept). All rules live in the Sim.
 */
export class BuildMode {
  active = false;
  tool: BuildTool = 'place';
  selected: BuildingType | null = null;
  variant: string | undefined;
  rot: Rot = 0;
  elevated = false;
  routeMode: RouteMode = 'xFirst';
  private beltStart: Cell | null = null;
  private plan: BeltPlan | null = null;
  private movingId = 0;
  private hoverId = 0;
  private cursor: Cell | null = null;
  private check: PlacementCheck | null = null;
  private lastRemoveAt = 0;
  private reason = '';

  constructor(
    private readonly sim: Sim,
    private readonly interaction: Interaction,
    private readonly visuals: BuildVisuals,
    private readonly sounds: BuildSounds,
    private readonly keyLabel: (code: string) => string,
  ) {}

  enter(type?: BuildingType, variant?: string): void {
    this.active = true;
    if (type) this.select(type, variant);
    else if (!this.selected) this.tool = 'remove';
    this.visuals.setGridVisible(true);
  }

  exit(): void {
    this.active = false;
    this.beltStart = null;
    this.plan = null;
    this.movingId = 0;
    this.visuals.hideGhost();
    this.visuals.setHighlight(null, null);
    this.visuals.setGridVisible(false);
  }

  select(type: BuildingType, variant?: string): void {
    this.selected = type;
    this.variant = variant ?? BUILDABLES[type].defaultVariant;
    this.tool = type === 'conveyor' ? 'belt' : 'place';
    this.beltStart = null;
    this.plan = null;
    this.movingId = 0;
    const lv = BUILDABLES[type].levels;
    if (!lv.includes(1)) this.elevated = false;
  }

  private buildRange(): number { return this.sim.stat('player.buildRange'); }

  /**
   * Per-frame update. `o`,`d` = camera ray. Handles input for build mode.
   * Returns true if build mode wants to exit.
   */
  update(o: Vec3, d: Vec3, input: Input, time: number): boolean {
    if (!this.active) return false;

    // ----- tool / option keys
    if (input.wasPressed('KeyX')) { this.setTool(this.tool === 'remove' ? (this.selected ? this.defaultToolFor(this.selected) : 'remove') : 'remove'); }
    if (input.wasPressed('KeyM')) { this.setTool(this.tool === 'move' ? (this.selected ? this.defaultToolFor(this.selected) : 'remove') : 'move'); }
    if (input.wasPressed('KeyR') || input.wheel !== 0) {
      if (this.tool === 'place' || (this.tool === 'move' && this.movingId)) {
        const dir = input.wheel < 0 ? 3 : 1;
        this.rot = ((this.rot + dir) & 3) as Rot;
        this.sounds.play('rotate');
      }
    }
    if (input.wasPressed('KeyF') && this.tool === 'belt') {
      const modes: RouteMode[] = this.sim.stat('global.autoRoute') >= 1 ? ['xFirst', 'zFirst', 'auto'] : ['xFirst', 'zFirst'];
      this.routeMode = modes[(modes.indexOf(this.routeMode) + 1) % modes.length];
      this.sounds.play('modeCycle');
    }
    if (input.wasPressed('KeyC') && this.canElevate()) { this.elevated = !this.elevated; this.sounds.play('modeCycle'); }
    if (input.wasPressed('KeyV') && this.selected && BUILDABLES[this.selected].variants) {
      const keys = Object.keys(BUILDABLES[this.selected].variants!);
      this.variant = keys[(keys.indexOf(this.variant ?? keys[0]) + 1) % keys.length];
      this.sounds.play('modeCycle');
    }
    if (input.mouseWasPressed(2)) {
      if (this.beltStart) { this.beltStart = null; this.plan = null; }
      else if (this.movingId) { this.movingId = 0; this.visuals.setHighlight(null, null); }
      else return true;
    }

    const aim = this.interaction.aim(o, d, this.buildRange() + 4, { hay: false, needles: false, barrow: false });
    switch (this.tool) {
      case 'place': this.updatePlace(o, d, input, aim); break;
      case 'belt': this.updateBelt(o, d, input, aim); break;
      case 'remove': this.updateRemove(input, aim, time); break;
      case 'move': this.updateMove(o, d, input, aim); break;
    }
    return false;
  }

  private defaultToolFor(type: BuildingType): BuildTool { return type === 'conveyor' ? 'belt' : 'place'; }

  private setTool(t: BuildTool): void {
    this.tool = t;
    this.beltStart = null;
    this.plan = null;
    this.movingId = 0;
    this.visuals.hideGhost();
    this.visuals.setHighlight(null, null);
    this.sounds.play('modeCycle');
  }

  private canElevate(): boolean {
    if (!this.selected) return false;
    const def = BUILDABLES[this.selected];
    return def.levels.includes(1) && def.levels.includes(0) && (this.sim.progress.isUnlocked('l_lift') || this.sim.progress.isUnlocked('f_platform'));
  }

  /** Level to build at for the current selection and aim. */
  private targetLevel(o: Vec3, d: Vec3, type: BuildingType): Level {
    const def = BUILDABLES[type];
    if (!def.levels.includes(0)) return 1;
    if (!def.levels.includes(1)) return 0;
    if (this.elevated) return 1;
    // Aiming at a platform deck -> level 1.
    const t = (WORLD.levelHeight - o.y) / d.y;
    if (d.y < 0 && t > 0) {
      const x = o.x + d.x * t, z = o.z + d.z * t;
      if (this.sim.grid.hasPlatform(Math.floor(x), Math.floor(z))) return 1;
    }
    return 0;
  }

  /** Ray -> footprint min cell at a level so the footprint is centred on the aimed point. */
  private cellFromRay(o: Vec3, d: Vec3, type: BuildingType, rot: Rot, level: Level): Cell | null {
    const y = level * WORLD.levelHeight;
    if (d.y >= -1e-4) return null;
    const t = (y - o.y) / d.y;
    if (t <= 0 || t > this.buildRange() * 2) return null;
    const x = o.x + d.x * t, z = o.z + d.z * t;
    const [w, dd] = rotatedSize(BUILDABLES[type], rot);
    return { x: Math.floor(x - (w - 1) / 2), z: Math.floor(z - (dd - 1) / 2), level };
  }

  private inRange(cell: Cell, type: BuildingType, rot: Rot): boolean {
    const [w, dd] = rotatedSize(BUILDABLES[type], rot);
    const p = this.sim.player.pos;
    const cx = Math.max(cell.x, Math.min(p.x, cell.x + w)), cz = Math.max(cell.z, Math.min(p.z, cell.z + dd));
    return Math.hypot(cx - p.x, cz - p.z) <= this.buildRange();
  }

  private portsFor(type: BuildingType, cell: Cell, rot: Rot, variant: string | undefined): { ports: WorldPort[]; connected: boolean[] } {
    const ports = resolvePorts(type, cell, rot, variant, (n) => this.sim.progress.isUnlocked(n));
    const connected = ports.map((p) => {
      const n = neighbor(p.cell, p.dir);
      const other = this.sim.buildingAtCell(n.x, n.z, n.level);
      if (!other) return false;
      if (p.kind === 'out') return other.inputPortAt(n, oppositeDir(p.dir)) >= 0;
      return other.ports.some((q) => q.kind === 'out' && q.cell.x === n.x && q.cell.z === n.z && q.cell.level === n.level && q.dir === oppositeDir(p.dir));
    });
    return { ports, connected };
  }

  private updatePlace(o: Vec3, d: Vec3, input: Input, _aim: Aim): void {
    const type = this.selected;
    if (!type) { this.visuals.hideGhost(); this.reason = 'Pick something at SUPPLY CO.'; return; }
    const level = this.targetLevel(o, d, type);
    const cell = this.cellFromRay(o, d, type, this.rot, level);
    this.cursor = cell;
    if (!cell) { this.visuals.hideGhost(); this.check = null; return; }
    let chk = this.sim.canPlace(type, cell, this.rot, this.variant);
    if (chk.ok && !this.inRange(cell, type, this.rot)) chk = { ...chk, ok: false, reason: 'Too far away' };
    this.check = chk;
    const { ports, connected } = this.portsFor(type, cell, this.rot, this.variant);
    this.visuals.showGhost(type, cell, this.rot, this.variant, chk.ok, ports, connected);
    if (input.mouseWasPressed(0)) {
      if (!chk.ok) { this.sounds.play('invalid'); this.sim.events.emit('player:denied', { reason: chk.reason ?? 'Cannot build here' }); return; }
      const b = this.sim.place(type, cell, this.rot, this.variant);
      this.sounds.play(b ? (LOGISTICS_TYPES.has(type) ? 'placeBelt' : 'place') : 'invalid');
    }
  }

  /** Belt endpoints snap to machine ports when aiming at a machine. */
  private beltCellFromAim(o: Vec3, d: Vec3, aim: Aim, wantOutput: boolean): Cell | null {
    if (aim.kind === 'building' && aim.building && aim.building.type !== 'conveyor') {
      const b = aim.building;
      let best: Cell | null = null, bestD = Infinity;
      for (const p of b.ports) {
        if (p.kind !== (wantOutput ? 'out' : 'in')) continue;
        const n = neighbor(p.cell, p.dir);
        const dist = Math.hypot(n.x + 0.5 - aim.point.x, n.z + 0.5 - aim.point.z);
        if (dist < bestD) { bestD = dist; best = n; }
      }
      if (best) return best;
    }
    if (aim.kind === 'building' && aim.building?.type === 'conveyor') return { ...aim.building.cell };
    const level: Level = this.elevated ? 1 : 0;
    return this.cellFromRay(o, d, 'conveyor', 0, level);
  }

  private updateBelt(o: Vec3, d: Vec3, input: Input, aim: Aim): void {
    const allowLevel = this.sim.progress.isUnlocked('l_lift');
    if (!this.beltStart) {
      const c = this.beltCellFromAim(o, d, aim, true);
      this.cursor = c;
      if (!c) { this.visuals.hideGhost(); return; }
      const occupied = this.sim.grid.get(c.x, c.z, c.level);
      const okStart = occupied === 0 || this.sim.buildings.get(occupied)?.type === 'conveyor';
      const inRange = this.inRange(c, 'conveyor', 0);
      this.visuals.showBeltPath([{ type: 'conveyor', cell: c, rot: this.rot }], okStart && inRange);
      this.reason = !inRange ? 'Too far away' : okStart ? 'Click to set the start' : 'Space is occupied';
      if (input.mouseWasPressed(0)) {
        if (okStart && inRange) { this.beltStart = c; this.sounds.play('modeCycle'); } else this.sounds.play('invalid');
      }
      return;
    }
    const end = this.beltCellFromAim(o, d, aim, false);
    this.cursor = end;
    if (!end) return;
    this.plan = this.sim.planBelt(this.beltStart, end, { mode: this.routeMode, allowLevelChange: allowLevel });
    const affordable = this.plan.ok && this.sim.progress.money >= this.plan.cost;
    const inRange = this.inRange(end, 'conveyor', 0);
    this.reason = !this.plan.ok ? (this.plan.reason ?? 'Invalid path') : !affordable ? `Need $${Math.ceil(this.plan.cost - this.sim.progress.money)} more` : !inRange ? 'Too far away' : '';
    this.visuals.showBeltPath(this.plan.steps, this.plan.ok && affordable && inRange);
    if (input.mouseWasPressed(0)) {
      if (this.plan.ok && affordable && inRange && this.sim.placeBelt(this.plan)) {
        this.sounds.play('placeBelt');
        this.beltStart = null;
        this.plan = null;
      } else {
        this.sounds.play('invalid');
        if (this.reason) this.sim.events.emit('player:denied', { reason: this.reason });
      }
    }
  }

  private updateRemove(input: Input, aim: Aim, time: number): void {
    this.visuals.hideGhost();
    const b = aim.kind === 'building' ? aim.building : undefined;
    this.hoverId = b && b.def.removable ? b.id : 0;
    this.visuals.setHighlight(this.hoverId || null, this.hoverId ? 'remove' : null);
    if (!b) { this.reason = 'Aim at something to remove'; return; }
    const chk = this.sim.canRemove(b.id);
    this.reason = chk.ok ? `Refund $${chk.refund.toLocaleString('en-US')}` : (chk.reason ?? '');
    const click = input.mouseWasPressed(0);
    // Drag-remove belts quickly while holding LMB.
    const drag = input.mouse(0) && LOGISTICS_TYPES.has(b.type) && time - this.lastRemoveAt > 0.12;
    if ((click || drag) && chk.ok) {
      if (this.sim.remove(b.id)) { this.sounds.play('remove'); this.lastRemoveAt = time; this.visuals.setHighlight(null, null); }
    } else if (click && !chk.ok) this.sounds.play('invalid');
  }

  private updateMove(o: Vec3, d: Vec3, input: Input, aim: Aim): void {
    if (!this.movingId) {
      this.visuals.hideGhost();
      const b = aim.kind === 'building' ? aim.building : undefined;
      this.hoverId = b && b.def.movable ? b.id : 0;
      this.visuals.setHighlight(this.hoverId || null, this.hoverId ? 'move' : null);
      this.reason = b ? (b.def.movable ? 'Click to pick it up' : 'Cannot be moved') : 'Aim at a machine to move it';
      if (input.mouseWasPressed(0)) {
        if (b && b.def.movable) { this.movingId = b.id; this.rot = b.rot; this.variant = b.variant; this.sounds.play('modeCycle'); }
        else this.sounds.play('invalid');
      }
      return;
    }
    const b = this.sim.buildings.get(this.movingId);
    if (!b) { this.movingId = 0; return; }
    this.visuals.setHighlight(b.id, 'move');
    const level = this.targetLevel(o, d, b.type);
    const cell = this.cellFromRay(o, d, b.type, this.rot, level);
    this.cursor = cell;
    if (!cell) { this.visuals.hideGhost(); return; }
    let chk = this.sim.canMove(b.id, cell, this.rot);
    if (chk.ok && !this.inRange(cell, b.type, this.rot)) chk = { ...chk, ok: false, reason: 'Too far away' };
    this.check = chk;
    const { ports, connected } = this.portsFor(b.type, cell, this.rot, b.variant);
    this.visuals.showGhost(b.type, cell, this.rot, b.variant, chk.ok, ports, connected);
    if (input.mouseWasPressed(0)) {
      if (chk.ok && this.sim.move(b.id, cell, this.rot)) {
        this.sounds.play('place');
        this.movingId = 0;
        this.visuals.setHighlight(null, null);
      } else this.sounds.play('invalid');
    }
  }

  hud(): BuildHudState {
    const L = this.keyLabel;
    const hints: { key: string; label: string }[] = [];
    if (this.tool === 'place') {
      hints.push({ key: 'LMB', label: 'Place' }, { key: L('KeyR'), label: 'Rotate' });
      if (this.selected && BUILDABLES[this.selected].variants) hints.push({ key: L('KeyV'), label: `Variant: ${this.variant}` });
    } else if (this.tool === 'belt') {
      hints.push({ key: 'LMB', label: this.beltStart ? 'Set end' : 'Set start' }, { key: L('KeyF'), label: `Route: ${this.routeMode === 'auto' ? 'Auto' : this.routeMode === 'xFirst' ? 'X first' : 'Z first'}` });
    } else if (this.tool === 'remove') hints.push({ key: 'LMB', label: 'Remove (hold to sweep belts)' });
    else hints.push({ key: 'LMB', label: this.movingId ? 'Drop here' : 'Pick up' }, { key: L('KeyR'), label: 'Rotate' });
    if (this.canElevate()) hints.push({ key: L('KeyC'), label: this.elevated ? 'Upper level' : 'Ground level' });
    hints.push({ key: L('KeyX'), label: this.tool === 'remove' ? 'Back to build' : 'Remove' }, { key: L('KeyM'), label: 'Move' }, { key: 'RMB', label: 'Cancel' }, { key: L('KeyQ'), label: 'Exit' });

    const moving = this.movingId ? this.sim.buildings.get(this.movingId) : undefined;
    const hover = this.hoverId ? this.sim.buildings.get(this.hoverId) : undefined;
    const beltCost = this.plan?.cost ?? (this.selected === 'conveyor' ? this.sim.nextCost('conveyor') : 0);
    const cost = this.tool === 'belt' ? beltCost : this.tool === 'place' && this.selected ? this.sim.nextCost(this.selected) : 0;
    const valid = this.tool === 'belt' ? !!this.plan?.ok && this.reason === '' : this.tool === 'remove' ? !!hover : (this.check?.ok ?? false);
    const reason = this.tool === 'place' || (this.tool === 'move' && this.movingId) ? (this.check?.ok ? undefined : this.check?.reason) : this.reason || undefined;
    return {
      active: this.active,
      tool: this.tool,
      item: moving?.type ?? this.selected,
      variant: this.variant,
      rot: this.rot,
      cost,
      valid,
      reason,
      routeMode: this.routeMode,
      beltTiles: this.plan ? this.plan.steps.filter((s) => !s.existing).length : 0,
      beltStarted: !!this.beltStart,
      targetName: (moving ?? hover)?.def.name,
      refund: this.tool === 'remove' && hover ? this.sim.canRemove(hover.id).refund : undefined,
      network: this.check?.network,
      hints,
    };
  }
}
