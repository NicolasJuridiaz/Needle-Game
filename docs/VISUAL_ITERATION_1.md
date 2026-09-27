# Visual iteration 1 — manual sell belt, low-poly pile, hands

Render / spatial / manual-sell change only. Economy, prices, Work Tree, levels, Hay Sell Value, needles, orders,
machines, power, analytics/consent, Welcome Back, CrazyGames integration and save format are unchanged
(the chute's saved state gains an optional `intake` list; older saves load with an empty belt).

## What changed
- **Manual sell loop**: pile → carry → drop on the fixed SELL HAY intake belt (x = -32, z 1..4; E while aiming at
  the belt or the painted drop pad) → 1.8 s transit → Market Chute sells it with the same `recordSale` call as
  before (manual, `viaBelt = false`). E on the chute never sells. Needles in dropped hay slip back to the pile at
  drop time, as before. Automation (ports) unchanged. Decisions: docs/DESIGN_DECISIONS.md D20.
- **Store kiosk** (x = -32, z -1..0) next to the belt: E opens the Shop; B still works.
- **Haystack**: flat-shaded faceted mesh, 4-tone straw palette, low-poly straw lumps; photo hay texture removed.
  Sim heightfield (shape, size, depletion) untouched. D21.
- **Hands**: procedural low-poly bare hands (palm, thumb, 4 two-segment fingers), `open` / `grip` poses shared by
  every tool; hands tool animates idle, grab, hold, drop.

## Measurements (Chromium + SwiftShader, no GPU: FPS here is NOT real hardware)
| Spawn view 1280×720 | Before draw calls / tris | After |
|---|---|---|
| Low | 15 / 65.7 k | 16 / 62.5 k |
| Medium | 25 / 135.1 k | 28 / 131.6 k |
| High | 25 / 157.1 k | 28 / 150.2 k |

Late saves (bot 55 min, RC1 fixture): load, 0 console errors; 113–226 draw calls depending on view (same order as RC2).
Bundle: JS 1,184.5 → 1,190.7 KB (339.1 → 341.5 KB gzip).

## Balance check (bot, 12 seeds, same seeds)
| | Before | After |
|---|---|---|
| Completion median (P10–P90) | 65.3 (59.4–66.7) | 64.6 (59.3–66.4) |
| First rake median | 14.9 | 15.5 |
| Needle 1 median | 9.8 | 10.4 |
| Max decision gap > 4 min | 0/12 | 0/12 |

Early manual phase ~0.5 min later (the 1.8 s transit delays each payout); whole-run pacing unchanged.

## Known limits
- Pile silhouette still comes from the sim heightfield (tall dome with shoulders): BUGS.md B047.
- Hands/FOV checked at 1280×720 and 907×510 only in SwiftShader; real-GPU check pending (docs/REAL_HARDWARE_QA.md).

# Visual Pass 2 — pile silhouette decoupled from the sim (B047)

**Coupling audit.** Before: `HayView` drew one vertex per sim cell at `hay.heights` (display = logical). Aiming
(`Interaction.rayHay`) ray-marched `sim.hay.heightAt`; walking (`PlayerController.groundAt`) used `hay.heightAt`;
digging (`playerDig` / `playerVacuum`) only takes the aimed X/Z and extracts from the sim column there; needles, depth
bands, machines and the bot never read the render. So the visual shape could be decoupled in the render/game layer.

**Solution.** `src/render/hayShape.ts` maps the sim heightfield to a visual one (3×3 smoothing, flank-raising remap,
broad lobes, bounded offset +1.6 / -2.4 m, a cell shows hay iff it has hay, monotonic). HayView draws it; aim, walk,
exposed needles and the parked barrow use it. The sim is unchanged (no diff under `src/sim`, `src/config`, `tools`).

**Checks.** `tests/hayShape.test.ts` (6): bounds, hay-iff-hay, monotonic, less peaked, depletion + incremental =
full rebuild, sim untouched (750,000 units), 400 aim rays: every hay hit lies on the visual surface and digs hay.
Bot 12 seeds: results byte-identical to Pass 1 (only the wall-clock field differs).

| Spawn view 1280×720 | Pass 1 | Pass 2 |
|---|---|---|
| Low | 16 / 62.5 k | 16 / 63.2 k |
| Medium | 28 / 131.6 k | 28–29 / 133.0 k |
| High | 28 / 150.2 k | 29 / 153.1 k |

JS 1,190.7 → 1,193.9 KB (341.5 → 342.6 KB gzip). Also: centred `+$X` pop when a belt load sells (B048), bare
hands lifted on windows < 720 px tall (B049), build mode refuses the intake / Store cells ("Reserved for the Market
intake and Store", red ghost).
