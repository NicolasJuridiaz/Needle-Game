import { WORLD } from '../config/world';
import { rotatedSize } from '../sim/grid';
import type { Sim } from '../sim/sim';
import type { Input } from './input';

/** Axis-aligned solid box (world metres). `walkable` tops can be stood on. */
export interface Box { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }

const PLAYER_RADIUS = 0.34;
const PLAYER_HEIGHT = 1.78;
const EYE_HEIGHT = 1.62;
const STEP_HEIGHT = 0.68; // walk over belts
const GRAVITY = 21;
const JUMP_SPEED = 6.6;
const GROUND_ACCEL = 42;
const AIR_ACCEL = 9;
const HAY_SINK = 0.1;      // feet sink slightly into hay
const HAY_SPEED_MUL = 0.88;

/**
 * Kinematic first-person controller ("physics-lite"): capsule approximated by a vertical cylinder,
 * resolved against building boxes, walls, the hay heightfield (walkable), platforms and stairs.
 */
export class PlayerController {
  /** Feet position. */
  x: number; y: number; z: number;
  vx = 0; vy = 0; vz = 0;
  yaw: number;
  pitch = 0;
  onGround = true;
  /** 0..1 how much the player is moving horizontally (for head bob / viewmodel bob). */
  walk = 0;
  private bobPhase = 0;
  /** Distance walked (footstep sounds). */
  stepDistance = 0;
  onFootstep: (() => void) | null = null;
  onLand: ((speed: number) => void) | null = null;
  onJump: (() => void) | null = null;
  private boxes: Box[] = [];

  constructor(private readonly sim: Sim) {
    const p = sim.player;
    this.x = p.pos.x; this.y = p.pos.y; this.z = p.pos.z;
    this.yaw = p.yaw; this.pitch = p.pitch;
    this.y = Math.max(this.y, this.groundAt(this.x, this.z, this.y + 10));
  }

  get eyeY(): number { return this.y + EYE_HEIGHT + this.bobOffset(); }

  private bobOffset(): number { return this.onGround ? Math.sin(this.bobPhase * 2) * 0.035 * this.walk : 0; }
  /** Sideways bob for the viewmodel. */
  get bobX(): number { return Math.sin(this.bobPhase) * 0.02 * this.walk; }

  /** Mouse look (radians per pixel scaled by sensitivity). */
  look(dx: number, dy: number, sensitivity: number, invertY: boolean): void {
    const k = 0.0022 * sensitivity;
    this.yaw -= dx * k;
    this.pitch -= dy * k * (invertY ? -1 : 1);
    const lim = Math.PI / 2 - 0.02;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  }

  /** Forward vector on the ground plane (yaw 0 faces +X; three.js camera looks down -Z so the game converts). */
  forward(): { x: number; z: number } { return { x: Math.cos(this.yaw), z: -Math.sin(this.yaw) }; }

  update(dt: number, input: Input | null, speedMul: number): void {
    dt = Math.min(dt, 0.05);
    const s = this.sim;
    // ----- desired horizontal velocity
    let mx = 0, mz = 0;
    if (input) {
      const f = this.forward();
      const r = { x: -f.z, z: f.x }; // right = forward rotated -90° (clockwise seen from above)
      if (input.isDown('KeyW') || input.isDown('ArrowUp')) { mx += f.x; mz += f.z; }
      if (input.isDown('KeyS') || input.isDown('ArrowDown')) { mx -= f.x; mz -= f.z; }
      if (input.isDown('KeyD') || input.isDown('ArrowRight')) { mx += r.x; mz += r.z; }
      if (input.isDown('KeyA') || input.isDown('ArrowLeft')) { mx -= r.x; mz -= r.z; }
    }
    const len = Math.hypot(mx, mz);
    if (len > 0) { mx /= len; mz /= len; }
    const sprint = input && (input.isDown('ShiftLeft') || input.isDown('ShiftRight')) ? s.stat('player.sprintMul') : 1;
    const onHay = this.hayHeight(this.x, this.z) > this.y - 0.05 + HAY_SINK && this.onGround;
    const speed = s.stat('player.moveSpeed') * sprint * speedMul * (onHay ? HAY_SPEED_MUL : 1);
    const tx = mx * speed, tz = mz * speed;
    const accel = (this.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt;
    const dvx = tx - this.vx, dvz = tz - this.vz;
    const dl = Math.hypot(dvx, dvz);
    if (dl <= accel) { this.vx = tx; this.vz = tz; } else { this.vx += (dvx / dl) * accel; this.vz += (dvz / dl) * accel; }

    // ----- jump / gravity
    if (input && this.onGround && input.wasPressed('Space')) {
      this.vy = JUMP_SPEED;
      this.onGround = false;
      this.onJump?.();
    }
    this.vy -= GRAVITY * dt;

    // ----- horizontal move with collision (axis separated)
    this.gatherBoxes();
    this.moveAxis(this.vx * dt, 0);
    this.moveAxis(0, this.vz * dt);
    this.clampToBounds();

    // ----- vertical
    const ground = this.groundAt(this.x, this.z, this.y);
    let ny = this.y + this.vy * dt;
    const ceiling = this.ceilingAt(this.x, this.z, this.y);
    if (ny + PLAYER_HEIGHT > ceiling && this.vy > 0) { ny = ceiling - PLAYER_HEIGHT; this.vy = 0; }
    const wasGround = this.onGround;
    if (ny <= ground) {
      if (!wasGround && this.vy < -4) this.onLand?.(-this.vy);
      ny = ground;
      this.vy = 0;
      this.onGround = true;
    } else if (this.onGround && ny - ground < STEP_HEIGHT * 0.6 && this.vy <= 0) {
      // Walking down slopes / steps: stick to the ground.
      ny = ground;
      this.vy = 0;
    } else {
      this.onGround = false;
    }
    this.y = ny;

    // ----- bob & footsteps
    const hs = Math.hypot(this.vx, this.vz);
    this.walk += ((this.onGround ? Math.min(1, hs / 4) : 0) - this.walk) * Math.min(1, dt * 10);
    if (this.onGround && hs > 0.5) {
      this.bobPhase += hs * dt * 2.1;
      this.stepDistance += hs * dt;
      if (this.stepDistance > 2.1) { this.stepDistance = 0; this.onFootstep?.(); }
    }

    // ----- write back to the sim
    s.player.pos.x = this.x; s.player.pos.y = this.y; s.player.pos.z = this.z;
    s.player.yaw = this.yaw; s.player.pitch = this.pitch;
  }

  /** Teleport (load / reset). */
  setPosition(x: number, y: number, z: number): void {
    this.x = x; this.z = z;
    this.y = Math.max(y, this.groundAt(x, z, y + 10));
    this.vx = this.vy = this.vz = 0;
  }

  // ===================================================================================

  private clampToBounds(): void {
    const I = WORLD.interior;
    const open = this.sim.stat('global.warehouseExpansion') >= 1;
    const maxZ = open ? WORLD.annex.maxZ : I.maxZ;
    this.x = Math.min(I.maxX - PLAYER_RADIUS, Math.max(I.minX + PLAYER_RADIUS, this.x));
    this.z = Math.min(maxZ - PLAYER_RADIUS, Math.max(I.minZ + PLAYER_RADIUS, this.z));
  }

  /** Collect solid boxes of buildings around the player. */
  private gatherBoxes(): void {
    this.boxes.length = 0;
    const s = this.sim;
    const seen = new Set<number>();
    const cx = Math.floor(this.x), cz = Math.floor(this.z);
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) for (let lv = 0; lv < 2; lv++) {
      const id = s.grid.get(cx + dx, cz + dz, lv);
      if (id <= 0 || seen.has(id)) continue;
      seen.add(id);
      const b = s.buildings.get(id);
      if (!b || b.type === 'stairs' || b.type === 'platform') continue;
      const [w, d] = rotatedSize(b.def, b.rot);
      const base = b.cell.level * WORLD.levelHeight;
      // Slightly inset so players can slide along belts next to each other.
      this.boxes.push({ x0: b.cell.x + 0.02, x1: b.cell.x + w - 0.02, z0: b.cell.z + 0.02, z1: b.cell.z + d - 0.02, y0: base, y1: base + b.def.height });
    }
    // Store kiosk (a fixed prop, not a grid building): solid like a machine.
    const st = WORLD.store;
    if (Math.abs(this.x - (st.x + 0.5)) < 4 && Math.abs(this.z - (st.z0 + st.z1) / 2) < 4) {
      this.boxes.push({ x0: st.x, x1: st.x + 1, z0: st.z0 + 0.2, z1: st.z1 - 0.2, y0: 0, y1: 2.5 });
    }
    // Platform decks as thin boxes (block from below, walkable on top).
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
      if (s.grid.hasPlatform(cx + dx, cz + dz)) {
        const x = cx + dx, z = cz + dz;
        this.boxes.push({ x0: x, x1: x + 1, z0: z, z1: z + 1, y0: WORLD.levelHeight - 0.22, y1: WORLD.levelHeight });
      }
    }
  }

  private blocked(x: number, z: number, feetY: number): boolean {
    for (const b of this.boxes) {
      if (b.y1 <= feetY + STEP_HEIGHT || b.y0 >= feetY + PLAYER_HEIGHT) continue;
      // circle vs AABB
      const nx = Math.max(b.x0, Math.min(x, b.x1));
      const nz = Math.max(b.z0, Math.min(z, b.z1));
      if ((nx - x) ** 2 + (nz - z) ** 2 < PLAYER_RADIUS * PLAYER_RADIUS) return true;
    }
    return false;
  }

  private moveAxis(dx: number, dz: number): void {
    if (dx === 0 && dz === 0) return;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.15));
    const sx = dx / steps, sz = dz / steps;
    for (let i = 0; i < steps; i++) {
      const nx = this.x + sx, nz = this.z + sz;
      if (this.blocked(nx, nz, this.y)) {
        if (dx !== 0) this.vx = 0; else this.vz = 0;
        return;
      }
      // Step up onto low obstacles / hay.
      const g = this.groundAt(nx, nz, this.y);
      if (g > this.y + STEP_HEIGHT) { if (dx !== 0) this.vx = 0; else this.vz = 0; return; }
      this.x = nx; this.z = nz;
      if (this.onGround && g > this.y) this.y = g;
    }
  }

  /** Hay surface the player walks on: the visual pile when the game provides it (render mapping), else the sim's. */
  hayHeight: (x: number, z: number) => number = (x, z) => this.sim.hay.heightAt(x, z);

  /** Highest walkable surface under (x,z) not above feetY + step height. */
  groundAt(x: number, z: number, feetY: number): number {
    const s = this.sim;
    let g = 0;
    const limit = feetY + STEP_HEIGHT;
    const hay = this.hayHeight(x, z) - HAY_SINK;
    if (hay > g && hay <= limit + 0.3) g = hay; // hay is soft: allow climbing slightly steeper
    // Surfaces from buildings under the circle centre.
    const cx = Math.floor(x), cz = Math.floor(z);
    if (s.grid.hasPlatform(cx, cz) && WORLD.levelHeight <= limit && WORLD.levelHeight > g) g = WORLD.levelHeight;
    for (const b of this.boxes) {
      if (x < b.x0 - 0.05 || x > b.x1 + 0.05 || z < b.z0 - 0.05 || z > b.z1 + 0.05) continue;
      if (b.y1 <= limit && b.y1 > g) g = b.y1;
    }
    // Stairs: ramp surface.
    for (let lv = 0; lv < 1; lv++) {
      const id = s.grid.get(cx, cz, lv);
      const b = id > 0 ? s.buildings.get(id) : undefined;
      if (b && b.type === 'stairs') {
        const [w, d] = rotatedSize(b.def, b.rot);
        // Progress along the stair's forward direction (rot): 0 at the bottom cell, 1 at the top edge.
        let t: number;
        switch (b.rot) {
          case 0: t = (x - b.cell.x) / w; break;
          case 1: t = (z - b.cell.z) / d; break;
          case 2: t = (b.cell.x + w - x) / w; break;
          default: t = (b.cell.z + d - z) / d; break;
        }
        const h = Math.max(0, Math.min(1, t)) * WORLD.levelHeight;
        if (h <= limit + 0.2 && h > g) g = h;
      }
    }
    return g;
  }

  private ceilingAt(x: number, z: number, feetY: number): number {
    let c = Infinity;
    for (const b of this.boxes) {
      if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
      if (b.y0 >= feetY + 0.5 && b.y0 < c) c = b.y0;
    }
    return c;
  }
}
