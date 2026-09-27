# Real-hardware QA (FPS) — required before Basic Launch

**Performance is NOT approved.** The dev container has no GPU (SwiftShader, ~1-2 FPS). Draw calls, triangle counts,
headless tests and the balance bot are budgets, not FPS. Only this checklist, filled in on real machines, can
approve performance. `docs/RELEASE_CHECKLIST.md` B1 has the pass criteria.

Reference budget (1280×720, late-game save, measured in the container): Low 29 draw calls / 206 k triangles,
Medium 129 / 457 k, High 130 / 561 k. The hay pile mesh is 29 k triangles at every pile size (750 k units are logical).

## Machines (at least the first two)

| # | Machine | CPU | GPU | RAM | OS | Browser + version | Screen / window |
|---|---|---|---|---|---|---|---|
| 1 | Laptop with integrated GPU (Intel Iris Xe / Radeon Vega class) | | | | | Chrome | 1920×1080 fullscreen + 1216×684 window |
| 2 | Chromebook 4 GB RAM (CrazyGames disables games that are not smooth there) | | | | ChromeOS | Chrome | |
| 3 | Desktop with a dedicated GPU | | | | | Edge | |

## How to measure

- Settings → Show FPS counter (updates every 0.5 s, uses real frame time).
- Better: Chrome DevTools → Performance → record 20 s → look at the frames bar. Average FPS; **1 % / 10 % low** =
  the FPS of the slowest 1 % / 10 % of frames (from the frame list, or estimate from the worst frames).
  GC spikes appear as yellow "Minor/Major GC" blocks; note any > 50 ms.
- Input latency: move the mouse quickly left/right; note whether the camera feels delayed (yes / no / slight).
- Stutter: regular hitches every few seconds while walking = stutter; note period and length.
- If the game lowers the quality by itself (toast "Graphics set to ..."), write it down: that is the failsafe
  (< 24 FPS for 15 s).
- With the analytics build, `performance_snapshot` events (5 min, 15 min, late game, run complete) give
  `avg_fps` / `p10_fps`; compare them with your own measurement.

## Saves

- Early game: fresh run (Esc → New Run), stand in front of the full pile.
- Mid game: play ~25-30 min, or a save around 25 min (`npx vite-node tools/balance/makeSave.ts 25 1000`).
- Late game: `npx vite-node tools/balance/makeSave.ts 55 1000` → `late-save.json` (~190 buildings, ~18 arms,
  ~145 belt tiles, RC2 levels); paste into `localStorage.pn_save_v1` from a tab where the game is not running,
  then open the game.

## Sheet (one row per machine × preset × phase)

| Machine | Preset | Phase | Resolution | Avg FPS | 1 % low | 10 % low | GC spikes > 50 ms | Input latency | Stutter | Auto-lowered? | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Low | early | | | | | | | | | |
| 1 | Low | mid | | | | | | | | | |
| 1 | Low | late (195 bld / 18 arms / 145 belts) | | | | | | | | | |
| 1 | Medium | early | | | | | | | | | |
| 1 | Medium | mid | | | | | | | | | |
| 1 | Medium | late | | | | | | | | | |
| 1 | High | early | | | | | | | | | |
| 1 | High | mid | | | | | | | | | |
| 1 | High | late | | | | | | | | | |
| 2 | Low | early / mid / late | | | | | | | | | |
| 2 | Medium | early / mid / late | | | | | | | | | |

Late-game extra checks (each preset):

- [ ] Walk along the main belt looking across the whole factory: FPS.
- [ ] Open Work Tree and Shop over the factory: hitch when opening (ms).
- [ ] 10 minutes of play: Chrome Task Manager memory stays within ± 50 MB.
- [ ] Switch High → Low → High while playing: applies without reload (only High MSAA needs one).

## Pass (from RELEASE_CHECKLIST B1)

Medium ≥ 45 FPS typical on machine 1 in the late-game save, no hitch > 100 ms while playing, Low ≥ 30 FPS on the
Chromebook. Anything below: record it; do not "fix" it by guessing. Profile first (DevTools Performance → bottom-up).
