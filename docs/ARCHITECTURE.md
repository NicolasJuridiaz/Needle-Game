# Project Needle — Technical Architecture & Module Specs

> Source of truth for gameplay: `GDD_Project_Needle_V1.docx` (summarised in §3). This document turns it
> into implementable module contracts. Code contracts live in `src/sim/types.ts`, `src/sim/interfaces.ts`,
> `src/sim/building.ts`, `src/sim/animState.ts`, `src/render/models/api.ts`, `src/audio/api.ts`,
> `src/ui/context.ts`. **All balance numbers live in `src/config/*`** — never hardcode them.

## 1. Stack & layout

- **TypeScript + Vite + three.js** (WebGL2). No physics engine ("physics-lite": heightfield + AABB collisions).
- Web-first, CrazyGames target. Relative paths only (`base: './'`). Initial download goal < 5 MB.
- Audio: WebAudio synthesis at runtime (no sample files). Textures: generated procedurally on canvases.
  Models: procedural low-poly geometry in code. ⇒ Every asset is original and tiny.
- Tests: `vitest` (`npm test`), Node environment. Balance bot: `npm run balance`.

```
src/
  config/        balance data ONLY (stats, buildables, tools, techTree, orders, milestones, needles, world)
  core/          events bus, rng, small utils (no game logic)
  sim/           ENGINE-AGNOSTIC simulation — must never import three.js or touch DOM/window
    sim.ts          Sim hub (tick, build API, save/load)        [lead]
    grid.ts building.ts inventory.ts interfaces.ts types.ts save.ts animState.ts [lead]
    hayfield.ts     heightfield + needles                       [Hay agent]
    logistics/      belts, splitters, mergers, lifts, planner  [Logistics agent]
    machines/       all non-logistics buildings                 [Machines agent]
    power.ts        power network                               [Machines agent]
    progression.ts  money/WP/stats/tree/orders/milestones       [Progression agent]
    playerActions.ts dig/vacuum/detector/wheelbarrow            [Progression agent]
  render/        three.js presentation                          [Render agent]
    models/      procedural models + tool viewmodels            [Models agent]
  game/          game loop, input, FPS controller, interaction, build mode, views glue [lead + phase-2 agents]
  ui/            DOM/CSS UI                                     [UI agent]
  audio/         WebAudio engine + synth SFX + music            [Audio agent]
  platform/      CrazyGames SDK wrapper, storage, analytics     [Audio/Platform agent]
tools/balance/   headless balance bot                           [phase 2]
tests/           vitest specs
```

**File ownership is strict during parallel work.** Only edit files you own. If you need a change in a
lead-owned contract file, do NOT edit it: describe the change in your final report.
You MAY add new files inside your own folders.

## 2. Conventions

- Units: metres, seconds, hay units ("hay"), P (power), $ (money), WP (work points).
- Axes: +X east, +Z south, +Y up. Build grid = 1 m cells; cell (x,z) spans [x,x+1)×[z,z+1).
  Levels: 0 (floor, y=0) and 1 (elevated, y = `WORLD.levelHeight` = 2.5 m). Belt surface/ports at
  `WORLD.beltHeight` (0.45 m) above the level floor.
- `Dir`: 0=+X, 1=+Z, 2=-X, 3=-Z. A building with rotation `r` has its local +X facing `Dir r`.
  Footprint `[w,d]` is local (w along forward). `building.cell` = min corner of the ROTATED footprint.
  `grid.ts` has all helpers (`localToOffset`, `occupiedCells`, `resolvePorts`, `buildingCenter`).
  three.js yaw for a +X-authored model: `rotation.y = -rot * Math.PI / 2`.
- Hay heightfield: 0.5 m cells covering interior + annex. `heights[row*cols+col]`, col ↔ X, row ↔ Z.
- Sim runs at a **fixed 20 Hz** (`BALANCE.tickDt`). Render interpolates.
- Stats: every upgradable number is a key in `config/stats.ts`, read via `ctx.stat('rake.push')`.
  Effects: `add` then `mul` then `set` (set wins; later set overrides earlier). Buffs from needles are effects too.
- Events: `src/core/events.ts` (`GameEvents`). Sim emits; UI/audio/render/analytics listen.
- No `Math.random()` in sim logic that affects gameplay state — use `sim.rng` (deterministic per seed).
  (Cosmetic randomness in render/audio is fine.)
- Deterministic, allocation-light hot loops (no per-tick closures/arrays in belts & hayfield).

## 3. Game design summary (what we are building)

First-person incremental factory. The player starts in a big warehouse in front of a huge haystack
(~150k hay units). Goal: **find the 6 needles** hidden inside it. Loop: extract hay → sell/process →
money → buy physical things; complete Orders / milestones / find needles → **Work Points (WP)** → unlock
**plans and global upgrades in the Work Tree**. *Unlocking a plan ≠ owning the object*: plans make an
object purchasable with Money in the Shop.

Progression (target 50–70 min): hands → shovel/bucket/pitchfork/wheelbarrow (manual) → metal detector
(first needle ~10–13 min) → hay generator + piston rake (first automation) → hopper + conveyors
(first autonomous line) → splitters/mergers → robotic arms → scanner MK1 → compressor → silo → more arms
→ wrapper → belt lifts/platforms → vacuum collector → scanner MK2 → optimisation → last needles → summary.

Key rules:
- Needles are placed in 6 depth bands (controlled randomness, see §4.1). Manual digging that removes a
  needle's cell finds it instantly. Machines (rake/arm/collector) carry it **hidden inside a hay packet**.
  A **Scanner** detects it deterministically (never misses). If an unscanned needle reaches a consumer
  (sell station, generator, compressor), it **slips through and is tossed back onto the upper pile
  surface** (never lost, never a softlock). Needle buffs are granted in discovery order.
- Power: machines draw P; generators burn hay. Overload = **progressive slowdown** (satisfaction =
  supply/demand), never a hard shutdown. Unconnected = "No Power".
- Throughput everywhere (hay/s). Bottlenecks are the core gameplay: arms > belt > scanner > compressor...
- Belts are optional for first interactions (player can hand-feed/hand-empty machines) but hugely useful.
- Completion: 6th needle found → run summary → "Keep playing" (sandbox) or "New run".

## 4. Simulation module specs

### 4.1 HayField (`src/sim/hayfield.ts`, implements `IHayField`)

**Grid**: covers `WORLD.interior` ∪ `WORLD.annex` at `WORLD.hayCell` (0.5 m). originX = interior.minX,
originZ = interior.minZ. `unitsPerMeter` is chosen in `generate()` so that the initial pile holds exactly
`WORLD.pile.totalUnits`.

**Pile shape** (`generate(seed)`): organic mound centred at (pile.cx, pile.cz) with radii rx, rz, peak
`height`. Suggested profile: normalised elliptical radius `r`; `h = height * (1 - smoothstep(0.0, 1.0, r))^0.9`
clamped by the angle of repose from the edge, plus low-frequency value noise (`valueNoise2D`, amplitude
`noise`) and a few lumps so the silhouette is not a perfect cone. Must be stable under relaxation
(no slope > repose at t=0). Cells outside the ellipse = 0.

**Needle placement** (deterministic from seed, `NEEDLE_BANDS[i]` for needle i):
1. V0 = Σ H0. Define V(d) = Σ max(H0 − d, 0) ("uniform lowering by d").
2. For band [a,b] pick t ∈ [a+0.01, b−0.01] (seeded) and binary-search d with V(d) = (1−t)·V0.
3. Candidate columns: H0(c) ≥ d + 0.25 and ≥ 2 m (4 cells) from other needles, not within 1 m of the
   pile edge for bands ≥ 2. Pick one (seeded); needle y = H0(c) − d (≥ 0.1).
   → band 1 needles sit ~0.1–0.4 m under the surface, band 6 deep in the core.
4. `NeedleState { id: i, band, pos:{x,y,z} (cell centre), status:'buried', returns:0 }`.

**Extraction** (`extractRadius`): remove up to maxUnits from cells whose centre is within `radius`
(at least the single nearest cell with hay), **highest cells first**, lowering them towards the average
of the removed region (a scoop, not a spike). Never below 0. Returns units, centroid pos, and needles
whose column was cut below `needle.y` (their status → 'inTransit'; the caller decides if found/hidden).
`extractStrip` (rake): cells inside the oriented rectangle from the start point along dir; take from
the NEAREST cells with hay first (the rake pulls from the face of the stack); `reach` = distance of the
furthest touched cell (0 if none).
`deposit`: add units spread over a small disc (radius ~0.6–1.2 m depending on amount), never into
blocked cells; needles deposited are placed at the new surface ('exposed', y = surface).

**Relaxation** (`tick`): angle of repose `WORLD.pile.reposeDeg` → maxDiff = tan(θ)·cellSize between
4-neighbours. Process a queue/set of *active* cells (touched by extraction/deposit/neighbour change);
move (diff − maxDiff)/2 (times a rate ≈ 0.5 for smooth slumping) from high to low; activate neighbours.
Budget ~4000 cell relaxations per tick; carry the rest over. Blocked cells neither give nor receive.
Conservation of units must hold (tests!).

**Needle dynamics**: a buried needle whose column surface drops to ≤ needle.y + 0.02 becomes 'exposed'
(y = surface height, sits on top; emit nothing here — Sim/game polls or uses the returned list; you may
add `onExposed?: (id)=>void` callback property). If hay later covers it (surface > y + 0.1) → 'buried'.
Extraction that cuts an exposed needle's cell takes it ('inTransit').

**Detector** (`detectorReading`): for each buried/exposed needle: horizontal distance dh ≤ range and
depth dd = surface(x,z) − needle.y. If dd ≤ depth: strength = (1 − dh/range)^1.5 · (1 − 0.5·dd/depth).
If dd > depth and dh ≤ range → `tooDeep` candidate. Return the strongest; `noise` jitters strength
(±25%·noise, deterministic per call time bucket is fine) and direction (±40°·noise).

**tossBack(id)**: pick a random cell in the upper 40% of the current pile surface (or any cell with hay
if the pile is small; if no hay at all, the centre of the original pile at floor level), set y = surface,
status 'exposed'... then deposit ~20 hay on top so it is 'buried' shallowly (the detector finds it).
Increment `returns`. Return its pos.

**setBlocked**: displace existing hay from newly blocked cells to the nearest free neighbour ring
(conserve units), mark blocked; unblocking just clears the flag (cells start empty).

**Dirty rect**: union of all changed cells since last `consumeDirtyRect()`.

**Serialization**: heights quantised to uint16 millimetres → base64 (browser: btoa over binary string;
Node: Buffer — write a helper that works in both). blocked as base64 bytes. needles as-is.

**Perf**: generate < 50 ms, tick < 1 ms typical; `heightAt` O(1) bilinear.

**Tests** (`tests/hayfield.test.ts`): initial total ≈ totalUnits (±0.5%); extraction conserves
(removed + remaining = before); deposit conserves; relaxation conserves and reduces max slope; needles
are all inside the pile, one per band, bands monotonic in depth; needle found when its column is dug;
detector finds band-1 needle from above; serialize → deserialize round-trip equal (±1 mm);
blocked cells stay 0.

### 4.2 Logistics (`src/sim/logistics/*`, implements `ILogistics`; building classes registered in `LOGISTICS_CLASSES`)

**Linking** (`relink()`): clear all `links`. For every building `b` and every OUT port `p`:
target cell `n = neighbor(p.cell, p.dir)` at `p.cell.level`; `t = buildingAt(n)`; if `t` and `t !== b`:
`idx = t.inputPortAt(n, oppositeDir(p.dir))`; if `idx >= 0` → `b.links[p.index] = {target:t, port:idx}`.
Each input port accepts at most ONE feeder (first come in a deterministic order, e.g. by building id).
The Sim calls `relink()` after any placement/removal/move/unlock (via `markTopologyDirty`).

**Conveyor** (`type:'conveyor'`, 1 cell, rot = flow direction): ordered queue of items with position
`s ∈ [0,1)` along the tile (0 = entry, 1 = exit). Speed `ctx.stat('belt.speed')` tiles/s, minimum spacing
`ctx.stat('belt.spacing')` tiles. Items advance, respecting spacing to the item ahead (and to the first
item of the next tile, via its free space). When an item reaches s=1 it tries `pushOut` into the next
building (belt/machine); if refused it waits at the end (belt backs up → upstream sees "blocked").
**Automatic curves**: `inputPortAt(cell, outwardDir)`: accepts feeding from its back (outwardDir ==
opposite of flow) or — only if nothing feeds its back — from ONE side (perpendicular). Record
`anim.curve` (0 straight, −1 fed from local left/−Z side, +1 from local right). Curved tiles have path
length ≈ 0.785 (quarter circle) — item world positions follow the arc. A belt is fed head-on: never.
Conveyors at level 1 are elevated (render adds legs). `canAccept`: space at s=0 (first item's s ≥ spacing).
Throughput at base: 1.667/0.333 = 5 items/s = 50 hay/s (10 hay packets) ✔.

**Ramp** (`conveyorRamp`, variants up/down, 3 cells): behaves like a 3-tile conveyor whose world
path rises/falls one level; ports per config. **Belt Lift** (`beltLift`, 1 cell, both levels): vertical
carriage; items enter at bottom (up) and exit at top (or vice versa), capacity ~3 items, speed from belt
speed (lift height counts as 2.5 tiles).

**Splitter** (1 in, outputs: primary=front, left, right). Holds ≤ 2 items internally; each tick tries
to dispatch the head item according to `mode` (saved state; `anim.mode`), cycling only among LINKED outputs:
- `even`: round-robin among linked outputs that can accept now (never waits if any can).
- `alternating` (needs node `l_alternating`): strict round-robin among linked outputs; waits for the next one.
- `priority` (needs `l_priority`): pattern P,P,S (2 of 3 to primary, 1 to the sides round-robin); if the
  chosen one is blocked, give it to another that can accept (don't stall).
- `overflow` (needs `l_overflow`): primary always; sides only when primary cannot accept.
- `smart` (needs `l_smart`): items whose type == `filter` go to primary; others to sides (even). If a
  destination is blocked, wait.
Interaction (E): cycles to the next unlocked mode (smart: then cycles filter hay→bale→wrapped).
Info lines show mode + per-output counts.
**Merger** (inputs back/left/right → front): internal buffer 2; accepts from inputs round-robin fairly
(track last-served port; `canAccept` true for the port whose turn it is or if others are empty).
**U-Splitter** (1 in → lane A/B): even alternation. **U-Merger** (lane A/B → 1 out): fair.

**Item views** (`forEachItem(alpha, cb)`): world positions at belt height (+ level·levelHeight), items
interpolated between previous and current tick positions using `alpha`. Stable `uid` per packet (assign a
global counter when the item first enters logistics; keep a `uid` field on internal item records, not on
ItemPacket). Include items inside splitters/mergers/lifts.

**pushOut(from, port, item)**: resolve `from.links[port]`; if linked and `target.canAccept(item,
link.port, ctx)` → `target.accept(...)`, return true. **Machines' outputs are also delivered this way**.

**Belt planner** (`planBeltPath(sim, start, end, opts)`): returns `BeltPlan` of steps.
- Route modes: `xFirst`/`zFirst` = L-shaped (straight then one corner) — the default, always available;
  `auto` (requires `global.autoRoute` ≥ 1) = A* over free cells (4-neighbour, turn penalty) max ~400 nodes.
- Each step's `rot` = flow direction out of that cell. The last tile points toward the next cell in the
  path; if `end` is adjacent to an input port of a building, the last tile points INTO it (connectsEnd).
  If `start` is adjacent to an output port facing it, the path starts there (connectsStart).
  If the start cell already holds a conveyor, begin AFTER it (extend belts). Existing conveyors on the path
  with a compatible direction may be reused (`existing` id) — otherwise the cell is blocked.
- Validation: every new cell free (`sim.canPlace('conveyor', ...)` style checks without money), in floor,
  hay ≤ threshold; `cost` = new tiles × `sim.nextCost('conveyor')` (+ ramps/lifts). `ok=false` + reason
  otherwise (“Blocked by Silo”, “Path too long”, “Not enough money” is checked by Sim at placement).
- Level change: when start and end levels differ and `allowLevelChange`, insert a `beltLift` (1 cell) at a
  suitable point (or a ramp if there is room, 3 cells) with the right variant.
- Max length 60 tiles.

**Tests** (`tests/logistics.test.ts`): straight line throughput 50 hay/s ±5%; belt backs up when the end
is blocked and resumes; curve feeding; head-on not linked; splitter even distributes 1:1(:1); priority
2:1; overflow only spills when primary blocked; merger fairness; lift moves items up; relink after
removal; planner L-route + snapping into a machine input; A* avoids an obstacle.

### 4.3 Machines (`src/sim/machines/*`, registered in `MACHINE_CLASSES`) & Power (`src/sim/power.ts`)

Common: every machine updates `status` (and `setStatus`), `anim` fields (see `animState.ts`),
`rateIn/rateOut` (hay-equivalent via `BALANCE.hayEquivalent`), `info()` (title, status, statusText,
3–6 lines: rate "42 / 60 hay/s", buffer "120 / 400", power "15 P", etc.), `saveState/loadState`
(buffers, timers, modes), `contents()/clearContents()`. Processing speed multiplier = `speedFactor(ctx)`
(disabled → 0, power satisfaction, `global.machineSpeed`). Use `powerGate(ctx)` first.
Status texts must explain WHY: "No power — place a Power Pole within 8 m", "Output blocked — connect a
belt or empty the tray (E)", "No hay in reach — move it closer to the stack", "Waiting for hay",
"Low power (68%) — build more generators", "Firebox empty — feed hay (E)".

**Needles in packets**: consumers of RAW hay (sell station, generator, compressor) that receive a packet
with `needleId` and `!scanned` call `ctx.needleSlipped(id, type, pos)`. Hoppers/silos/belts just carry it
(Inventory keeps hidden needles). Extractors put needles returned by `hay.extract*` into their output
packets (`Inventory.needles` → `takePacket`). Player-emptied trays: if the player TAKES hay containing a
hidden needle from a tray/hopper/silo with E, the needle is FOUND ('manual') — the player notices it.

- **sellStation** (Market Chute): accepts any item at any input port, instantly sells:
  `ctx.progress.recordSale(type, amount, viaBelt=true, pos)`; anim.pulse. Manual: E sells the player's
  whole carry (and a HELD wheelbarrow's load): "Sell 35 hay ($35)". Unscanned needles → needleSlipped.
- **hopper**: Inventory, capacity `hopper.capacity` (hay-eq). Accepts any item from belts; manual E
  deposits the whole carry (or held wheelbarrow) — if `tool.bucket.quickDump` the game allows it from
  `tool.bucket.dumpRange` (game layer checks range). Outputs packets (10 hay / 1 bale) to linked out ports
  at `hopper.outputRate` hay-eq/s each (dual output: alternate). Without a linked output, E on a hopper with
  empty carry TAKES hay back. Status: idle/full/outputBlocked(no link & not empty)/running.
- **pistonRake**: faces forward (local +X). Cycle `rake.cycleTime / speedFactor`: extend (40%), rake back
  (40%), dump (20%). On dump: `hay.extractStrip(frontEdgeCentre, forwardDir, rake.width, rake.reach,
  min(rake.push, trayFree))` → tray (Inventory, cap `rake.trayCapacity`). anim.ext follows the phase with
  reach = returned reach (or max reach if nothing). Tray unloads to the out port at `rake.trayOutputRate`.
  Tray full & can't unload → `outputBlocked` (stops raking). Nothing raked for 2 cycles → `noHay`.
  Manual E: take tray contents into carry. Power 10.
- **roboticArm**: 1×1 pedestal, drop point = front cell. State machine: IDLE → pick target
  (`hay.findTarget(center, arm.reach, smart?'densest':'nearest', minRadius 0.8)`; none → `noHay`) →
  ROTATE to target yaw (`arm.rotSpeed`°/s) → REACH/LOWER (0.35 s/arm.speed) → GRAB
  (`hay.extractRadius(target, 0.45, arm.grab * arm.throughputMul)`; grip anim) → LIFT (0.3 s) → ROTATE to
  drop yaw (local 0) → RELEASE: output as packets through port 0 if linked (wait while blocked:
  `outputBlocked`), else `hay.deposit()` on the floor in front (drop point) → repeat. All durations divided
  by `speedFactor`. The claw must visibly carry hay (anim.load). Power 15. Interaction: none (info only).
  Throughput ≈ 10 hay/s at base with typical 150° swings — verify in a test.
- **vacuumCollector**: sucks `collector.rate` hay/s (× speedFactor) from `hay.extractRadius(center,
  collector.radius)` in small steps (e.g. every 0.25 s, choosing the densest spot in radius; nozzle anim
  moves there) into a buffer (`collector.buffer`), outputs packets at `collector.outputRate` via port.
  Power `50 × collector.powerMul`. Full → outputBlocked. Empty radius → noHay.
- **scannerMk1**: input buffer (hay units, cap `scanner.buffer`) fed by belt (or manual E deposit). Scan
  cycle `scanner.cycle / speedFactor` processes up to `scanner.batch` hay: packets are moved from input
  queue to an output queue marked `scanned: true`; `ctx.progress.stats.hayScanned += n`. If a packet carries
  a needle → `ctx.needleDetected(id, this.id, pos)`; if `scanner.autoEject` < 1: ALARM — scanner stops for
  `scanner.alarmTime` s (status `needleAlarm`, anim.alarm=1, event `scanner:alarm`) then resumes; the
  needle goes to the tray (`anim.needles++`, purely visual). Output queue drains to out port at belt speed;
  if blocked → outputBlocked (scanning pauses when the output queue > 2 batches). Power 20.
- **scannerMk2**: same logic, per lane (lane B only with `scanner2.dualLane`), batch `scanner2.batch`,
  cycle `scanner2.cycle / scanner2.speedMul`, buffer `scanner2.buffer`, ALWAYS auto-eject. Power 40.
- **compressor**: input hay buffer (`compressor.buffer`), chambers `compressor.chambers`; each chamber
  consumes `compressor.hayPerBale` hay per `compressor.cycle / speedFactor` → 1 bale into output queue;
  press anim. Outputs bales via port (belt) — if not linked, bales accumulate (max 10) and the player can
  TAKE them (E) — carried bales weigh `BALANCE.itemWeight.bale`. Unscanned needles in consumed hay →
  needleSlipped. Power 25. Manual E with carry hay → deposit.
- **wrapper**: input bale buffer (`wrapper.buffer`), `wrapper.cycle / speedFactor` per bale → wrapped;
  output like compressor; anim spin/wrap/premium (`wrapper.premium`). Power 30. Manual E deposit bales /
  take wrapped.
- **silo**: Inventory of mixed items, capacity `silo.capacity` hay-eq; accepts up to `silo.inputRate` hay-eq/s
  (per-tick budget); outputs to port A (and B with `silo.dualOutput`) at `silo.outputRate` hay-eq/s each,
  FIFO by type order (keep an ordered queue of item types to preserve order roughly). anim.fill. Manual E:
  deposit carry / take (if carry empty). Unpowered.
- **hayGenerator**: firebox fuel (hay, cap `generator.firebox`). Produces `generator.output` P while it
  has fuel, burning `generator.burnRate × load` hay/s where load = network demand share (given by power
  tick: `this.load` 0..1). Manual E: feed the whole carry (up to free space) — `generator:fed` event. Belt
  input only with `generator.autoFeed` (port gated by node `f_autofeed`). Unscanned needles in fuel →
  needleSlipped. Status noFuel / running / idle (no demand). anim.fire, fuel, load, industrial.
  `ctx.progress.stats.hayBurned += burned`.
- **powerPole** / **platform** / **stairs**: `StaticBuilding` is fine (poles are read by PowerNetwork).

**PowerNetwork** (`rebuild`, `tick`):
- Nodes: generators + poles. Edges: pole–pole and pole–generator if centre distance ≤ `pole.range`.
  Connected components = networks. A generator with no poles is its own network.
- Consumers (buildings with `def.power > 0`): attach to the nearest pole (in any network) within
  `pole.range` that still has capacity (`pole.connections` consumers per pole), else to a generator within
  `BALANCE.generatorDirectRadius` (5 m). Unattached → network −1 (status noPower).
- tick: supply = Σ generator output (only fuelled ones) × (1 − `power.loss`) ; demand = Σ consumer
  `powerDraw(ctx)` × `power.useMul` (× `collector.powerMul` is inside the collector's draw);
  satisfaction = demand>0 ? min(1, supply/demand) : 1. Set `b.powerSatisfaction`, `b.network`; generator
  `load` = min(1, demand/supplyRaw). Emit `power:changed` when totals change > 0.5 P. Track stats.peakPower.
- `wires`, `feeds` for rendering cables. `networkAt(x,z)` for ghost feedback.
- Rebuild on topology change and whenever pole range stat changes.

**Tests** (`tests/machines.test.ts` using real HayField/Logistics if available, otherwise small fakes):
rake fills tray and outputs to a linked sink; arm cycle throughput within ±25% of 10 hay/s; scanner
detects a needle deterministically and stops without auto-eject; unscanned needle into sell station →
needleSlipped; compressor ratio 40:1; generator burns proportional to load; overload → satisfaction
< 1 and machines slow down proportionally; disconnected → noPower.

### 4.4 Progression (`src/sim/progression.ts`) & Player actions (`src/sim/playerActions.ts`)

**Stats**: `stat(key)` = fold of BASE_STATS[key] with effects from all unlocked node levels (in tree
order, level order) and needle buffs (discovery order). Order of ops per key: all `add`, then all `mul`,
then last `set` overrides everything *before the needle buffs*; needle buff effects are applied after
(so +15% belt speed also scales upgraded speeds). Cache in a Map, invalidate on unlock/needle.
Unknown key → throw in dev (console.error) and return 0.

**Unlock rules**: node exists; next level exists; the next purchase's requirements are met (the node's
`requires` for the first purchase, plus the level's own `req`); `wp ≥ cost` and `money ≥ money cost`.
A requirement is `"id"` (owned at any level) or `"id@N"` (that technology at displayed Lv.N or higher;
`isUnlocked` understands both, also for gated ports such as `x_hopper@5`). `unlock()` spends WP and Money,
sets level, invalidates stats, emits `node:unlocked`, and calls a hook so the Sim can refresh ports/power
and the machines' `anim.tier` (`onUnlocked?: (id)=>void` property set by Sim). Reasons: "Requires Robotic
Arm Lv.3", "Need N more WP", "Need $N more", "Maxed".

**Level System (RC2, `config/techTree.ts`, `sim/levels.ts`)**: each tool / machine family is one
`leveled` technology node: level 1 = plans (or the free starting level when `levelBase: 1`: Hands, Hay
Sell Value), levels 2..5 = upgrades. Displayed level = owned levels + `levelBase`. Levels are global per
technology: buildings never store a level, they read stats; `techForBuilding(type)` maps a building to
its technology (all logistics pieces -> Conveyor Network, Scanner MK2 -> Needle Scanner) for the
inspection line "Level Lv. x / 5", the Shop card and `anim.tier` (models show an upgrade kit from Lv.3).
Hay Sell Value writes `econ.hayMul`, applied by `recordSale` to every product.
Save v2: `sim/save.ts` migrates RC1 node lists (`RC1_TO_RC2`).

**Shop**: `buildingUnlocked(type)`: requiresNode null or unlocked. `buildingCost(type, owned)` =
`round(cost × costGrowth^owned)`. Tools: `canBuyTool` (plan unlocked, not owned, money), `buyTool`
spends money, adds to `ownedTools` (wheelbarrow → `hasWheelbarrow`), emits `tool:bought`.

**Economy**: `recordSale(item, amount, viaBelt, pos)`: value = amount × stat(ITEMS[item].valueStat) ×
stat('econ.saleMul'); addMoney; stats (haySold/baleSold/wrappedSold, hayViaBelt += hay-eq if viaBelt,
firstSaleAt); emit `sale`; feed the stable-rate tracker (hay-eq delivered per second, sliding window
`BALANCE.stableWindow`) — record ALL sales (manual too) for stableRate but only belt/port for sellViaBelt.
`addMoney` emits `money:changed` and updates moneyEarned (not for refunds). `addWP` → `wp:changed`.

**Needles**: `onNeedleFound(id, by, pos)`: push to `needlesFound`; k = index → `NEEDLE_BUFFS[k]` effects
become active; addWP(BALANCE.needleWP,'needle'); addMoney(buff.money,'needle'); emit `needle:found`
with buff name/desc, then return k.

**Orders**: runtime list over `ORDERS`. An order becomes available when all `after` ids are completed.
Active = first `MAX_ACTIVE_ORDERS` available, not completed (in list order). When an order becomes active,
record `base` = current value of its cumulative counter. Progress = counter − base (cumulative) or the
instant metric. Completion: reward money × `econ.orderRewardMul`, WP; emit `order:completed`, then newly
available orders are activated (emit `order:available`). Instant metrics are read from ctx
(`needlesFound.length`, count of powered running machines, `power.totalSupply`, silo stored,
stable rate, `hay.progress()`). Also emit `order:progress` at most ~4×/s per order when it changes.

**Milestones**: check each tick (cheap) → reward + emit `milestone`.

**Stats tracked**: see `RunStats`. peakThroughput = max of the stable-rate average.

**Serialization**: `ProgressSave` round-trip (Maps/Sets → arrays).

**Player actions** (`playerActions.ts`) — all take the `Sim`:
- `carryCapacity(sim)` = `player.carry` stat + (`tool.bucket.carryBonus` if bucket owned).
- `playerDig(sim, tool, x,y,z)`: if `player.cooldown > 0` → no-op. Amount = `tool.<id>.dig`; free space =
  capacity − carry.weight(); if free ≤ 0 and a parked (not held) wheelbarrow within
  `wheelbarrow.collectRange` has space → dig into the barrow instead (toBarrow). If neither → full=true,
  emit `player:full` (throttled), no extraction. Extract `hay.extractRadius(x,z, tool radius, amount)`;
  add to carry/barrow. Needles in the extraction → `sim.foundNeedle(id,'manual',pos)` (manual = found).
  cooldown = `tool.<id>.interval`. `ctx.creditExtraction(units,'manual',pos)`; emit `player:dig`.
- `playerVacuum(sim, dt, x,y,z)`: continuous `tool.vacuum.rate × dt` (same capacity/barrow/needle rules,
  source 'vacuumTool').
- `detectorReading(sim)`: `hay.detectorReading(player.pos, range, depth, noise = 1 − precision)`.
- `pickupNeedle(sim, id)`: exposed needle within interact range → foundNeedle(id,'detector' if the
  detector is equipped else 'manual').
- `spawnWheelbarrow(sim)`: create the barrow 1.5 m in front of the player on the floor/hay surface.
- `toggleWheelbarrow(sim)`: within 2.5 m → held = !held. While held, the game positions it (pos/yaw)
  every frame in front of the player and applies `wheelbarrow.speedMul`.
- Deposits/takes go through `building.interaction()/interact()`; the building implementations use
  `ctx.player.carry` and, when the barrow is HELD, also its inventory (sell/hopper/generator/silo).

**Tests** (`tests/progression.test.ts`): stat folding; unlock requires + WP; plan≠purchase (cost with
growth); tool purchase; orders activate/complete/rewards with cumulative bases; milestones; needle buff
order; save round-trip; dig respects capacity & cooldown; barrow overflow; manual needle find.

## 5. Render (`src/render/*`)

- `Renderer` class: `THREE.WebGLRenderer` (antialias on high), sRGB output, ACES tone mapping,
  pixelRatio = min(devicePixelRatio, quality high 2 / medium 1.5 / low 1), lowered further so the drawing
  buffer stays within a pixel budget (high 3840×2160 / medium 2560×1440 / low 1920×1080, never below 0.5;
  `effectivePixelRatio`). Resize to the container; browser zoom / monitor changes re-evaluate the DPR.
- Quality presets (`src/render/quality.ts`), default **Medium** for new players, switchable live from
  Settings (only MSAA, on High, needs a reload — the panel says so):

  | | High | Medium | Low |
  |---|---|---|---|
  | Pixel ratio cap / budget | 2 / 4K | 1.5 / 1440p | 1 / 1080p |
  | MSAA | on | off | off |
  | Sun shadows | 2048, soft, belt items cast | 1024 | off |
  | Lamps (point lights) | 4 | 3 | 2 |
  | Straw tufts | 4000 | 2000 | 800 |
  | Particles cap | 1500 | 900 | 400 |
  | Dust motes / light shafts | 700 / on | 400 / on | 0 / off |
  | Anisotropy / floor texture | 8 / 2048 | 4 / 2048 | 2 / 1024 |
  | Cable segments | 12 | 8 | 5 |

  Measured in the late-game stress save (151 buildings, 111 belts), same view, 1280×720:
  Low 30 draw calls / 145 k triangles, Medium 113 / 338 k, High 117 / 393 k (the shadow pass is the
  difference). Buildings are merged per building and belts/items/tufts are instanced.
- GPU failsafes: WebGL context loss is `preventDefault`ed so the browser can restore it; no WebGL at boot
  shows a "turn on hardware acceleration" message; `src/game/autoQuality.ts` lowers the preset one step
  (High → Medium → Low, with a toast) when gameplay averages < 24 FPS over 15 s, unless the player picked
  a quality in Settings (`settings.qualityManual`).
- Scene: warehouse interior (concrete floor with subtle painted grid, corrugated metal walls, timber/steel
  trusses, skylights with light shafts, big sliding door on the west wall with the Market Chute, the
  closed north annex wall with "EXPANSION" signage that can be removed (`setAnnexOpen(bool)`), outdoor
  backdrop through door/skylights (sky gradient, distant hills). Order board + needle trophy case on the
  west wall (6 slots, lit when found).
- Lighting: hemisphere + one directional "sun" through skylights with shadows (high: 2048 PCFSoft;
  medium: 1024; low: off) + a few warm lamps (no shadows). Light the pile nicely (it's the hero).
- Materials: one shared vertex-coloured MeshStandardMaterial "palette" for most props/machines, a few
  special materials (hay, metal, glass, emissive). Procedural canvas textures: hay straw, concrete,
  corrugated metal, wood, belt rubber (scrolling), hazard stripes, labels/decals.
- **HayView**: mesh over the hay grid (vertices at cell centres), positions from `heights` (hidden under
  the floor where h≈0), normals recomputed in the dirty rect only; hay material with straw texture +
  vertex colour variation (darker in crevices, lighter on top). Straw tufts: InstancedMesh of crossed
  alpha-tested quads (~4000 high / 2000 medium / 800 low) scattered on hay cells, updated only for dirty
  cells. Exposed needles: glinting sprite + small mesh. Update budget < 2 ms/frame.
- **BeltView**: instanced conveyor tiles (straight / curve L / curve R / ramp / legs for level 1),
  scrolling belt texture (UV offset by time × speed). Items: InstancedMesh per item type from
  `logistics.forEachItem(alpha)`; hay clumps, bales, wrapped (white film; premium gold stripe).
- **Particles**: pooled GPU-friendly system (InstancedMesh or Points): straw bits burst (extraction),
  dust puffs, sparks (generator/machines), needle sparkle, sale coins. Hard cap (e.g. 1500 live).
- **BuildingViews**: create a `ModelInstance` per building, sync transform, call `update(anim)` and
  `setStatus`. Power wires as catenary lines between poles/generators and thin feeds to consumers.
- **Ghost**: build preview renders the model with a translucent green/red override material + footprint
  cell overlay + port arrows (green out, blue in; highlighted when they would connect).
- Performance budget (mid laptop iGPU @1080p, high): ≥ 60 FPS early game, ≥ 45 late game; draw calls
  < 300; no per-frame allocations in hot paths.

## 6. Models (`src/render/models/*`)

`createModel(kind, opts)` for every `BuildingType` + props (`wheelbarrow`, `needle`, `orderBoard`,
`needleCase`, `truck`) and `createToolViewModel(kind)` for hands/shovel/bucket/pitchfork/vacuum/detector/
wheelbarrow (held handles). Items: `createItemGeometry('item:hay'|...)` returning BufferGeometry for
instancing. Style guide:
- Stylised low-poly industrial with a wink: chunky bevelled boxes (RoundedBoxGeometry), cylinders with
  few segments, bolts, hazard stripes, big friendly lamps, rivets. Silhouettes readable from 20 m.
- Category colours: extraction = safety orange #e8743b, logistics = steel blue #4f7fa8 + black belts,
  detection = teal #2bb5a8 with cyan emissive screens, processing = green #6aa84f, storage = galvanised
  silver, power = red #c8453b + copper, factory = yellow #f2c230. Each machine also shows its function:
  rake = hydraulic pistons + wide comb head; arm = 3-segment arm with claw; collector = turbine + hose
  nozzle; scanner = tunnel over a belt with scan light; compressor = press ram + bale chute; wrapper =
  rotating ring arm; silo = tall tank with level window; generator = boiler + firebox door + chimney.
- Upgrade visuals (driven by anim flags): industrial rake (bigger, darker steel, double pistons), arm MK2
  (sleeker, chrome + orange), collector industrial turbine (twin turbines), premium wrap (gold stripes),
  industrial generator (second chimney, copper pipes).
- Viewmodels: hands (stylised gloves), shovel, bucket (shows hay level via `load`), pitchfork, vacuum
  (backpack tank + nozzle, `suck` vibrates), metal detector (coil + LED meter + small screen that shows
  strength bars / arrow / distance per state), wheelbarrow handles.
- Provide `src/render/models/gallery.html` + `gallery.ts` (dev page) rendering every model in a grid with
  labels and animated anim values, for screenshot review.

## 7. UI (`src/ui/*`)

DOM overlay above the canvas. `new UI(rootEl, ctx: UIContext)`, `update(dt)` each frame (HUD numbers at
~10 Hz). Design: original, bold, readable at 821×462 with DPR 1. Font: system UI stack + one Google Font
optional (fallback). Colour: warm dark panels (#1d1a16 at 88%), hay yellow accents (#f2c14e), clean icons
(inline SVG, original). Panels open with a short scale/fade animation; every button has hover/press
feedback + `playUiSound`.
- **HUD**: money + WP (top-left, animated count-up, +$ floaters), needles 0/6 with buff icons (top-right),
  power bar "145/100 P" (appears once any power exists; red + "Factory at 69% speed" when overloaded),
  current order line (top-centre: title + progress bar; click opens Orders when pointer free),
  hotbar 1–6 (owned tools highlighted, locked slots dimmed), carry meter near crosshair
  ("35/55" + bar, "FULL" pulse), crosshair, interaction prompt `[E] Sell 35 hay ($35)`, machine tooltip
  (name, status pill with colour + explanation, lines), toasts (right side, stack of 4), milestone/order
  complete banners, **needle found** big presentation (needle icon, "NEEDLE 2/6 FOUND", buff name/desc),
  detector HUD (signal bars, beeps are audio; arrow + distance if directional/precise; "TOO DEEP"),
  build mode HUD (item, cost, rotation, valid/invalid reason, key hints), FPS counter (setting).
- **Work Tree** (T): full screen, 6 branch columns with colour headers, nodes as cards/circles at `pos`,
  dependency lines (SVG), states: locked (grey + lock), available (glowing border), unlocked (filled),
  maxed; hover tooltip with name, level, cost, effect text, requirements; click to unlock (sound + burst).
  WP counter; pan with drag / wheel scroll; "N available" badge. Must feel BIG.
- **Shop** (B): categories tabs (Tools, Extraction, Logistics, Detection, Processing, Storage, Power,
  Factory); cards with model icon (SVG), name, price (next unit), power, throughput label, footprint, desc;
  locked cards show "Unlock <plan> in the Work Tree"; not affordable = price red. Tools: Buy button;
  buildings: Select → enters build mode.
- **Orders** (O or click): up to 3 cards (client, title, progress bar, reward $ + WP, hint).
- **Pause** (Esc / pointer lock lost): Resume, Settings (volumes, music toggle, sensitivity, invert Y, FOV,
  quality, show FPS, hold-to-dig), Controls reference, "Saved 12 s ago", New Run (confirm dialog).
- **Summary** (on completion): time, needles (with when/how found), money earned, hay processed, peak
  throughput, peak power, machines/belts built; buttons Keep Playing / New Run.
- **Click to play** overlay: title logo "PROJECT NEEDLE", "Click to start", controls hint; 1 click.
- **Onboarding hints**: small contextual line from `ctx.getHint()` above the hotbar.
- Provide `src/ui/dev.html` + `dev.ts` with a mock UIContext (fake data) to review all panels.

## 8. Audio (`src/audio/*`)

`AudioEngine implements IAudio`. WebAudio synthesis: noise buffers (white/pink/brown), oscillators,
filters, envelopes, simple convolver-free reverb (feedback delay) for the warehouse. Every `SfxId` must
sound distinct and pleasant; UI sounds soft. Loops: belt (rattle, pitch by speed), generator (low rumble
+ crackle), scanner (hum + periodic beep), collector (whoosh), arm (servo whine bursts), rake (hydraulic
hiss). Positional: gain by distance (inverse, max 40 m) + stereo pan from listener yaw; max 3 voices
per loop type. Music: light procedural country/lo-fi loop (plucked Karplus–Strong strings, simple chord
progression, soft percussion), 4–8 bars variations, low volume, toggleable. Respect `setPlatformMuted`.
`needleFound` must feel special (chime arpeggio + shimmer), `complete` a fanfare.

## 9. Platform (`src/platform/*`)

- `crazygames.ts`: loads nothing itself — `index.html` includes `https://sdk.crazygames.com/crazygames-sdk-v3.js`.
  `await window.CrazyGames.SDK.init()` guarded (script may be blocked). Use exactly the documented v3 API:
  `SDK.environment` ('local' | 'crazygames' | 'disabled'), `SDK.game.loadingStart()/loadingStop()`,
  `SDK.game.gameplayStart()/gameplayStop()` (start when entering play, stop on pause/menus/summary —
  NOT on focus loss), `SDK.game.happytime()` (needle found, run complete — sparingly),
  `SDK.game.reportGameCompletedPercentage(p)` (needles × 100/6), `SDK.game.settings.muteAudio` +
  `addSettingsChangeListener`, `SDK.game.setGameContext({...})`, `SDK.data.getItem/setItem/removeItem`
  (≤ 1 MB, debounced by SDK). When environment is 'disabled' or SDK missing → no-op adapter.
- `storage.ts`: `Storage` interface { get(key), set(key, value), remove(key) } → CrazyGames data module
  when available (environment crazygames/local), else localStorage (try/catch). Keys: `pn_save_v1`,
  `pn_settings`. Save JSON must stay < ~600 KB.
- `platformService.ts`: `PlatformService` interface (what the game needs from a portal). `Platform`
  (`crazygames.ts`) implements it and doubles as the standalone platform when the SDK is absent. No other portal
  is implemented (no Poki code in the bundle).
- Analytics (P0 Basic Launch, see docs/ANALYTICS_SETUP.md and docs/ANALYTICS_PRIVACY_NOTES.md):
  - `analyticsService.ts`: `AnalyticsService`, the only analytics entry point: local buffer always, remote adapter
    when enabled; queue until the adapter is ready, caps, opt-out, never throws.
  - `analytics.ts`: local in-memory ring buffer (`window.__pnAnalytics`, `?debug=1` console output).
  - `bytebrewAdapter.ts`: the ONLY file importing `bytebrew-web-sdk` (lazy chunk). `analyticsConfig.ts`: Vite env
    (`VITE_BYTEBREW_*`, `VITE_APP_VERSION`, `VITE_ANALYTICS_ENABLED`, `VITE_PRIVACY_POLICY_URL`), `?analytics=0`.
  - `analyticsEvents.ts`: event catalog + ByteBrew wire format (snake_case, string values, integers).
  - Game side: `src/game/telemetry.ts` (`GameTelemetry`: sim/game events -> catalog, run-level dedupe persisted in
    the save envelope, progress marks, playtime checkpoints, performance snapshots, error dedupe),
    `src/game/profile.ts` (`pn_profile`: session/run counters), `src/game/welcomeBack.ts` (read-only card data).
  - `src/game/analyticsConsent.ts` (P0.1): opt-in consent (`unknown` / `granted` / `denied`, key
    `pn_analytics_consent_v1`), the only switch that enables AnalyticsService; analytics-only storage (`pn_profile`,
    `meta.telemetry`) is persisted only while granted. Remote analytics additionally needs keys + an https
    `VITE_PRIVACY_POLICY_URL` (dev server on localhost excepted) and no `?analytics=0`.
  - Gameplay, machines, UI and sim never import analytics providers.

## 10. Game layer (`src/game/*`, phase 2)

- `main.ts`: loading screen, SDK init, storage load, create Game.
- `Game`: owns Sim, Renderer, views, UI, Audio, Input; fixed-step accumulator (max 5 steps/frame),
  render interpolation alpha; autosave every 30 s + on pause/visibilitychange/pagehide; pause on pointer
  lock loss (Esc) with gameplayStop.
- `Input`: keyboard by `event.code` (layout independent), mouse, pointer lock, key labels via
  `navigator.keyboard.getLayoutMap()` when available. Bindings (GDD): WASD move, mouse look, LMB use /
  confirm, RMB cancel, E interact, Q build mode, R rotate, F snap/route mode, 1–6 tools, Esc pause,
  T Work Tree, B shop, O orders, X remove mode (build), M move mode (build), Shift sprint, Space jump,
  G drop/grab wheelbarrow? (E handles it), Tab = orders (optional).
- `PlayerController`: capsule vs world (walls, building AABBs, hay heightfield as walkable surface with
  slight sink, platforms/stairs, step-up 0.55 m), accel/decel, head bob, fall.
- `Interaction`: raycast from camera → aimed building (AABB/mesh), hay surface (heightfield ray-march),
  exposed needles, wheelbarrow; prompts; tool use timing + viewmodel animations; quick-dump range.
- `BuildMode`: ghost, grid snapping, rotation, validity (Sim.canPlace), belt start/end with live plan
  (Sim.planBelt), remove (hover red + refund), move (pick + place), cost display, key hints.

## 11. QA / done criteria per system

Implement → run → interact → edge cases → fix → re-run. Record in `IMPLEMENTATION_STATUS.md`
(statuses: NOT STARTED / IN PROGRESS / IMPLEMENTED / QA PASS / BLOCKED) and bugs in `BUGS.md` (P0–P3).
