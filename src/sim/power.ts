import { BALANCE } from '../config/balance';
import type { Building } from './building';
import type { IPowerNetwork, PowerNetworkInfo, SimContext } from './interfaces';
import type { HayGenerator } from './machines/generator';

/** Minimum change (P) of the totals that emits `power:changed`. */
const CHANGE_THRESHOLD = 0.5;

function isGenerator(b: Building): b is HayGenerator { return b.type === 'hayGenerator'; }
function isPole(b: Building): boolean { return b.type === 'powerPole'; }

/** Horizontal distance from (x,z) to an axis-aligned rect [x0, z0, x1, z1] (0 inside). */
function rectDistance(r: number[], x: number, z: number): number {
  const dx = x < r[0] ? r[0] - x : x > r[2] ? x - r[2] : 0;
  const dz = z < r[1] ? r[1] - z : z > r[3] ? z - r[3] : 0;
  return Math.hypot(dx, dz);
}

/**
 * Power network (docs/ARCHITECTURE.md §4.3).
 * - Nodes: generators + poles. Edges pole-pole and pole-generator when centres are within `pole.range`
 *   (horizontal distance). Connected components are networks (a lone generator is its own network).
 *   Network ids are indices into `networks`, ordered by their smallest building id (deterministic).
 * - Consumers (def.power > 0), in id order, attach to the nearest pole within `pole.range` that still
 *   has capacity (`pole.connections`), else to the nearest generator within BALANCE.generatorDirectRadius
 *   (measured from the consumer's centre to the generator's footprint, i.e. "5 m from the generator").
 *   Unattached consumers get network -1 and satisfaction 0 (status noPower).
 * - tick: per network supply = sum of fuelled generator outputs x (1 - power.loss), demand = sum of
 *   consumer draws x power.useMul, satisfaction = min(1, supply/demand) (0 without supply).
 *   Generators get load = min(1, demand / raw supply). Overload never shuts machines down: they
 *   slow down proportionally through speedFactor().
 */
export class PowerNetwork implements IPowerNetwork {
  networks: PowerNetworkInfo[] = [];
  totalSupply = 0;
  totalDemand = 0;
  wires: { a: number; b: number }[] = [];
  feeds: { from: number; to: number }[] = [];

  /** Building id -> network id (nodes and attached consumers). */
  private readonly netOf = new Map<number, number>();
  /** Stat values / building count used by the last rebuild (auto-rebuild when they change). */
  private builtRange = NaN;
  private builtConnections = NaN;
  private builtCount = -1;
  private lastSupply = NaN;
  private lastDemand = NaN;
  // Node positions of the last rebuild (for networkAt).
  private nodeX: number[] = [];
  private nodeZ: number[] = [];
  private nodeNet: number[] = [];
  private nodeIsGen: boolean[] = [];
  /** Generator footprint rects [x0, z0, x1, z1] per node (unused for poles). */
  private nodeRect: number[][] = [];

  constructor(protected ctx: SimContext, protected buildings: Map<number, Building>) {}

  rebuild(): void {
    const ctx = this.ctx;
    const range = Math.max(0, ctx.stat('pole.range'));
    const maxConn = Math.max(0, Math.floor(ctx.stat('pole.connections') + 1e-6));
    const direct = BALANCE.generatorDirectRadius;
    this.builtRange = range;
    this.builtConnections = maxConn;
    this.builtCount = this.buildings.size;

    const all = [...this.buildings.values()].sort((a, b) => a.id - b.id);
    const nodes: Building[] = [];
    for (const b of all) if (isPole(b) || isGenerator(b)) nodes.push(b);
    const n = nodes.length;
    const xs = new Array<number>(n);
    const zs = new Array<number>(n);
    for (let i = 0; i < n; i++) { const c = nodes[i].center; xs[i] = c.x; zs[i] = c.z; }

    // Union-find over nodes.
    const parent = new Array<number>(n);
    for (let i = 0; i < n; i++) parent[i] = i;
    const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    this.wires = [];
    const r2 = range * range;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        // Generators only link through poles.
        if (!isPole(nodes[i]) && !isPole(nodes[j])) continue;
        const dx = xs[i] - xs[j], dz = zs[i] - zs[j];
        if (dx * dx + dz * dz > r2 + 1e-9) continue;
        this.wires.push({ a: nodes[i].id, b: nodes[j].id });
        const ri = find(i), rj = find(j);
        if (ri !== rj) { if (ri < rj) parent[rj] = ri; else parent[ri] = rj; }
      }
    }

    // Components -> networks (ordered by smallest node index = smallest id).
    this.networks = [];
    this.netOf.clear();
    const netOfRoot = new Map<number, number>();
    const nodeNet = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      const r = find(i);
      let id = netOfRoot.get(r);
      if (id === undefined) {
        id = this.networks.length;
        netOfRoot.set(r, id);
        this.networks.push({ id, supply: 0, demand: 0, satisfaction: 1, generators: [], poles: [], consumers: [] });
      }
      nodeNet[i] = id;
      const net = this.networks[id];
      (isGenerator(nodes[i]) ? net.generators : net.poles).push(nodes[i].id);
      this.netOf.set(nodes[i].id, id);
      nodes[i].network = id;
      nodes[i].powerSatisfaction = 1;
    }
    this.nodeX = xs; this.nodeZ = zs; this.nodeNet = nodeNet;
    this.nodeIsGen = nodes.map((b) => isGenerator(b));
    this.nodeRect = nodes.map((b) => { const [w, d] = b.size; return [b.cell.x, b.cell.z, b.cell.x + w, b.cell.z + d]; });

    // Consumers.
    this.feeds = [];
    const used = new Array<number>(n).fill(0);
    for (const b of all) {
      if (b.def.power <= 0) {
        if (!isPole(b) && !isGenerator(b)) { b.network = -1; b.powerSatisfaction = 1; }
        continue;
      }
      const c = b.center;
      let best = -1;
      let bestD = Infinity;
      // Nearest pole with capacity.
      for (let i = 0; i < n; i++) {
        if (!isPole(nodes[i]) || used[i] >= maxConn) continue;
        const d = Math.hypot(xs[i] - c.x, zs[i] - c.z);
        if (d <= range + 1e-9 && d < bestD) { bestD = d; best = i; }
      }
      // Else nearest generator (direct connection, no capacity limit).
      if (best < 0) {
        for (let i = 0; i < n; i++) {
          if (!isGenerator(nodes[i])) continue;
          const d = rectDistance(this.nodeRect[i], c.x, c.z);
          if (d <= direct + 1e-9 && d < bestD) { bestD = d; best = i; }
        }
      }
      if (best < 0) {
        b.network = -1;
        b.powerSatisfaction = 0;
        continue;
      }
      used[best]++;
      const id = nodeNet[best];
      b.network = id;
      this.netOf.set(b.id, id);
      this.networks[id].consumers.push(b.id);
      this.feeds.push({ from: nodes[best].id, to: b.id });
    }
  }

  /** Pole range / connection limit changed, or buildings were added/removed without a rebuild. */
  private needsRebuild(): boolean {
    const ctx = this.ctx;
    return ctx.stat('pole.range') !== this.builtRange
      || Math.max(0, Math.floor(ctx.stat('pole.connections') + 1e-6)) !== this.builtConnections
      || this.buildings.size !== this.builtCount;
  }

  tick(_dt: number): void {
    if (this.needsRebuild()) this.rebuild();
    const ctx = this.ctx;
    const loss = Math.min(1, Math.max(0, ctx.stat('power.loss')));
    const useMul = Math.max(0, ctx.stat('power.useMul'));
    let totalSupply = 0;
    let totalDemand = 0;

    for (const net of this.networks) {
      let raw = 0;
      for (const id of net.generators) {
        const g = this.buildings.get(id);
        if (g && isGenerator(g)) raw += g.outputPower(ctx);
      }
      let demand = 0;
      for (const id of net.consumers) {
        const b = this.buildings.get(id);
        if (b) demand += Math.max(0, b.powerDraw(ctx)) * useMul;
      }
      const supply = raw * (1 - loss);
      const sat = supply <= 1e-9 ? 0 : demand > 1e-9 ? Math.min(1, supply / demand) : 1;
      net.supply = supply;
      net.demand = demand;
      net.satisfaction = sat;
      const load = raw > 1e-9 ? Math.min(1, demand / raw) : 0;
      for (const id of net.generators) {
        const g = this.buildings.get(id);
        if (g && isGenerator(g)) g.load = g.isFuelled() ? load : 0;
      }
      for (const id of net.consumers) {
        const b = this.buildings.get(id);
        if (b) { b.powerSatisfaction = sat; b.network = net.id; }
      }
      totalSupply += supply;
      totalDemand += demand;
    }

    this.totalSupply = totalSupply;
    this.totalDemand = totalDemand;
    const st = ctx.progress.stats;
    if (totalSupply > st.peakPower) st.peakPower = totalSupply;
    if (Number.isNaN(this.lastSupply) || Math.abs(totalSupply - this.lastSupply) > CHANGE_THRESHOLD
        || Math.abs(totalDemand - this.lastDemand) > CHANGE_THRESHOLD) {
      this.lastSupply = totalSupply;
      this.lastDemand = totalDemand;
      const satisfaction = totalDemand > 1e-9 ? Math.min(1, totalSupply / totalDemand) : 1;
      ctx.events.emit('power:changed', { supply: totalSupply, demand: totalDemand, satisfaction });
    }
  }

  /**
   * Network a machine centred at world (x,z) would join (-1 none): nearest pole within range
   * (ignoring its connection limit), else a generator within the direct radius.
   */
  networkAt(x: number, z: number): number {
    if (this.needsRebuild()) this.rebuild();
    const range = this.builtRange;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < this.nodeX.length; i++) {
      if (this.nodeIsGen[i]) continue;
      const d = Math.hypot(this.nodeX[i] - x, this.nodeZ[i] - z);
      if (d <= range + 1e-9 && d < bestD) { bestD = d; best = this.nodeNet[i]; }
    }
    if (best >= 0) return best;
    for (let i = 0; i < this.nodeX.length; i++) {
      if (!this.nodeIsGen[i]) continue;
      const d = rectDistance(this.nodeRect[i], x, z);
      if (d <= BALANCE.generatorDirectRadius + 1e-9 && d < bestD) { bestD = d; best = this.nodeNet[i]; }
    }
    return best;
  }

  /** Network id of a building (-1 = none). */
  networkOf(id: number): number { return this.netOf.get(id) ?? -1; }
}
