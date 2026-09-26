# Release checklist — Project Needle V1

Status legend: **PASS** (verified, with evidence) · **TODO** (must be done by a person outside this environment).
Current verdict: **RELEASE CANDIDATE — REQUIRES REAL-HARDWARE QA**.

---

## A. AUTOMATED — PASS (verified in the dev container)

Run everything from a clean checkout:

```bash
npm ci
npm run typecheck          # expect: no output, exit 0
npm test                   # expect: all tests pass (see count in IMPLEMENTATION_STATUS.md)
npm run build              # expect: dist/ ~1.3 MB, 4 files, relative paths
npm run balance:many -- --seeds 50   # expect: 50/50 complete, P10 >= ~45, P90 <= ~70
```

| Area | Evidence |
|---|---|
| Type safety | `npm run typecheck` clean |
| Unit / integration tests | hay field, logistics (incl. side-loading, conservation), machines, power, progression, player actions, integration chains, platform/SDK isolation |
| Work Tree audit | `tests/worktreeAudit.test.ts`: every node reachable, no dead nodes, no no-op levels, no duplicates, descriptions match effects |
| Machine upgrade audit | `tests/machineUpgrades.test.ts` + `tests/upgrades.test.ts`: every upgrade of every machine family changes its stat to the expected value; behavioural before/after in a real Sim |
| Economy exploits | `tests/economy.test.ts`: refunds, place/remove loops, move/remove duplication, item conservation through every logistics piece, one-off orders/milestones/needles |
| Softlocks | `tests/softlock.test.ts`: broke player, no power, full carry, bad belts, needles never lost, order chain always has an achievable order |
| Save/load | `tests/saveFuzz.test.ts`: repeated save→load→advance cycles vs an uninterrupted control run; byte-stable re-save |
| Completion | `tests/completion.test.ts`: 6th needle while machines run, one completion event, keep playing, reload after completion |
| Refresh-rate independence | `tests/framerate.test.ts`: identical sim/economy at 60/120/144/165 Hz; walking distance within 2 % |
| CrazyGames SDK isolation | `tests/platform.test.ts`: blocked / missing / rejected / hanging SDK and throwing methods never break the game; progress 0 → n/6 → 100 reported |
| Pacing (bot) | `docs/PLAYTEST_V1.md` §Bot results (50 seeds) |
| Build size | 1.3 MB, 4 files (CrazyGames limits: 50 MB initial download / 20 MB mobile homepage / 1500 files) |
| Production build smoke test | `npm run build && npm run preview`: new game, late-game save, Work Tree, Shop, build mode, belts, machines, completion screen (headless Chromium, software GL) |

Limitations of the automated QA: the container has no GPU (SwiftShader, ~1–13 FPS) and no audio output.
Nothing below can be marked PASS from here.

---

## B. REQUIRES REAL HARDWARE — TODO

### B1. Performance (Chrome and Edge, latest)

Test machines: (1) mid laptop with integrated GPU (e.g. Intel Iris Xe / Radeon Vega) at 1920×1080,
(2) a 4 GB RAM Chromebook if available (CrazyGames disables games that are not smooth there).

For each machine, for quality **High / Medium / Low** (Esc → Settings → Quality):

1. Fresh run, stand in front of the full pile, look at it for 30 s → note typical / lowest FPS
   (enable Settings → Show FPS).
2. Load the late-game stress save (see B4) → walk along the main belt, look across the whole factory → FPS.
3. Open Work Tree and Shop over the late-game factory → FPS, any hitch when opening.
4. Play 10 minutes in the late-game save → watch for stutter every few seconds (GC), memory growth
   (Chrome Task Manager → memory footprint should stay flat ± 50 MB).
5. Switch quality High → Low → High while playing → the change applies without reload, no errors.

Pass criteria: Medium ≥ 45 FPS typical on the iGPU laptop in the late-game save, no hitch > 100 ms
while playing, Low ≥ 30 FPS on the Chromebook.

### B2. Audio QA (headphones, then laptop speakers)

| # | Check | Pass |
|---|---|---|
| 1 | Master / SFX / Music sliders each change only their bus; 0 = silent | ☐ |
| 2 | Music toggle off/on; music loops without clicks at the loop point | ☐ |
| 3 | Dig with each tool, sell, buy, unlock: distinct, not harsh, not too loud relative to music | ☐ |
| 4 | 10+ robotic arms working within 15 m: servo sounds stay a texture, not a drill in the ear | ☐ |
| 5 | 30+ belt tiles running near the player: belt loop audible but not dominant; only nearest sources play | ☐ |
| 6 | Scanner MK1 needle alarm: clearly noticeable once, not unbearable while it lasts | ☐ |
| 7 | Generator (fire loop), compressor press, wrapper spin: recognisable, balanced | ☐ |
| 8 | Needle found: special, clearly louder/brighter than normal SFX, no clipping | ☐ |
| 9 | Walk away from the factory: sounds fade with distance and pan left/right correctly | ☐ |
| 10 | Pause (Esc): world sounds stop, UI sounds still play; resume restores them | ☐ |
| 11 | Switch tab and come back: audio resumes (also on iOS/iPadOS Safari if mobile is tested) | ☐ |
| 12 | Full factory (≥10 machines + belts + generators) for 5 minutes: overall mix is not fatiguing, no distortion | ☐ |

### B3. Human playtest (first-time player)

- Clear the save (Esc → New Run, or DevTools → Application → Local Storage → delete `pn_save_v1`).
- Play from the first hay to the 6th needle without debug tools. Fill `docs/PLAYTEST_V1.md` (sheet).
- Pass: completion 50–75 min, no stretch > 4 min where the player has nothing to do, no blocker bug.

### B4. Save/load on a real browser

1. Play ~20 min, build a line (belts, arm, scanner), note money/WP/needles.
2. Reload the tab (F5) → everything identical; machines resume.
3. Close the browser completely, reopen → same.
4. Late-game stress save: generate with
   `npx vite-node tools/balance/makeSave.ts` (writes `late-save.json`) and paste it into DevTools →
   `localStorage.setItem('pn_save_v1', <contents>)`, reload.

---

## C. CRAZYGAMES DEVELOPER PORTAL — TODO

Upload `dist/` as a zip to the Developer Portal QA tool (https://developer.crazygames.com/) and check,
following https://docs.crazygames.com/requirements/ :

| # | Check | Pass |
|---|---|---|
| 1 | SDK environment is `crazygames` (console: `[platform]` log says SDK active) | ☐ |
| 2 | `loadingStart` / `loadingStop` fire once during boot | ☐ |
| 3 | `gameplayStart` fires on the first click-to-play; `gameplayStop` on pause (Esc), Work Tree/Shop/Orders open, completion summary; `gameplayStart` again on resume. Not on tab/focus change | ☐ |
| 4 | Initial download (until first `gameplayStart`) reported ≤ 20 MB (expected ~1.3 MB) | ☐ |
| 5 | `muteAudio` from the portal mutes everything and in-game volume cannot un-mute it | ☐ |
| 6 | Data module: progress survives reload on crazygames.com (not only localStorage) | ☐ |
| 7 | `happytime` on needles and on completion only (sparingly) | ☐ |
| 8 | `reportGameCompletedPercentage`: 0 on new game, n×100/6 after each needle and on load, 100 on completion | ☐ |
| 9 | Game works inside the portal iframe at 821×462 (minimum) and fullscreen; UI readable | ☐ |
| 10 | Pointer lock works in the iframe; Esc releases it and pauses | ☐ |
| 11 | Ads: **not implemented in V1**. If ads are added later, mute audio + `gameplayStop` during ads and re-test | ☐ |
| 12 | No console errors other than documented third-party ones | ☐ |
| 13 | Submission form: title, description, controls, 6 screenshots/trailer, tags | ☐ |
