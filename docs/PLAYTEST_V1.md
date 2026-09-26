# Playtest V1 — pacing report + human playtest sheet

## 1. What this is (and is not)

- **Not a human playtest.** The dev container has no GPU: Chromium renders with SwiftShader at ~1–2 FPS
  (real frame time, measured), so a 50–70 min human run is impossible here. Section 4 is the sheet a
  person fills on real hardware.
- **What was measured:** `tools/balance/bot.ts` plays complete runs against the real simulation with the
  same actions as the game (dig with tool cooldowns, walk, sell, unlock, buy, build with real placement
  rules, belts via the belt planner, power poles, moving starved extractors, switching machines off/on).
  It pays human build overhead (5 s per machine, 0.8 s per belt tile, 6 s per move) and +15 % on every
  action. No cheats: all money and WP are earned. It is a competent, not optimal, player; a first-time
  human should be slower, not faster.

```bash
npm run balance:many -- --seeds 50 --gaps          # this report (≈4 min on one core)
# or in parallel: --shard i/4 --out sI.json (x4), then --merge s0.json s1.json s2.json s3.json --gaps
npm run balance -- --seed 135623 --minutes 90 --decisions   # one run, every decision with its state
```

`--decisions` prints one line per decision: TIME · EVENT · MONEY · WP · HAY RATE (delivered hay/s,
1-min window) · POWER (demand/supply) · NEXT PURCHASE ($ the bot is saving for) · NEXT TECH (WP) ·
ACTIVE ORDERS (id:progress) · NEEDLES.

**Decision** = buy a tool/machine/belt line, unlock a Work Tree node, complete an order, find a needle,
move a machine, switch a machine off/on. Milestones are passive and do not count.

## 2. Results — 50 seeds (seeds 1000 + k·7919), build `ad680bd`+

| | min | P10 | median | P90 | max |
|---|---|---|---|---|---|
| **Completion (6th needle), min** | 43.2 | **47.8** | **56.0** | **65.7** | 70.2 |
| Longest stretch without a decision, min | 2.8 | 2.9 | 3.0 | 3.8 | 4.6 |
| First conveyor line | 13.9 | 14.1 | 15.2 | 16.1 | 21.6 |
| First Piston Rake | 11.7 | 12.6 | 13.2 | 15.3 | 19.5 |
| First Robotic Arm | 19.7 | 22.3 | 24.5 | 25.7 | 31.2 |
| First Scanner MK1 | 24.0 | 25.0 | 27.1 | 28.3 | 33.0 |
| First Compressor | 30.3 | 32.5 | 36.3 | 40.5 | 46.7 |
| First Wrapper | 34.8 | 37.3 | 42.7 | 46.6 | 51.9 |
| First Vacuum Collector | 35.9 | 38.6 | 43.4 | 47.6 | 53.0 |
| First Scanner MK2 | 35.1 | 38.0 | 43.1 | 47.7 | 52.5 |
| Needle 1 | 2.2 | 8.5 | 8.9 | 10.0 | 11.2 |
| Needle 2 | 5.6 | 11.6 | 12.3 | 13.9 | 44.0 |
| Needle 3 | 14.3 | 20.9 | 31.1 | 46.1 | 48.9 |
| Needle 4 | 23.7 | 32.3 | 45.6 | 51.9 | 60.3 |
| Needle 5 | 32.3 | 42.5 | 50.7 | 58.2 | 62.1 |
| Needle 6 | 43.0 | 47.6 | 55.8 | 65.5 | 70.0 |
| WP earned in the run | 128 | 131 | 149 | 152 | 160 |
| Work Tree bought (% of 235 WP) | 51 | 53 | 61 | 62 | 66 |

- 50/50 runs complete. Targets: P10 ≥ ~45 ✔ · median ~55 ✔ · P90 ≤ ~70 ✔.
- **Vacuum Collector** running ≥ 2 min before the 6th needle: **49/50 (98 %)**, placed at a median
  **77 %** of the run (P10 69 %, P90 85 %).
- **Scanner MK2** running ≥ 2 min before the 6th needle: **50/50 (100 %)**, placed at a median **78 %**
  of the run (P10 68 %, P90 84 %).
- Stretches > 4 min without a decision: **3/50 seeds**, all 4:01–4:38, all in the arm phase
  (36–44 min) waiting for the money for the next Robotic Arm:

  | seed | stretch | state at start |
  |---|---|---|
  | 24757 | 40:01 → 44:03 (4:01) | $5.0k, 4 WP saving for Wrapper Plans (5 WP), 87 hay/s delivered |
  | 135623 | 36:37 → 41:15 (4:38) | $2.7k, 0 WP saving for Belt Speed II (5 WP), 60 hay/s, only 1 needle found (unlucky seed) |
  | 333598 | 36:01 → 40:03 (4:01) | $2.6k, 4 WP saving for Belt Speed II (5 WP), 65 hay/s |

## 3. What changed in this pass and why (bot evidence)

| Run | P10 | median | P90 | seeds with a gap > 4 min | Collector / MK2 used |
|---|---|---|---|---|---|
| Start of pass | 44.4 | 48.8 | 57.5 | 18/50 (max 6.0 min) | 92 % / 92 % |
| + Steady Flow after Wholesale, bot keeps deciding while digging out a needle | 43.0 | 47.5 | 53.4 | 5/50 | 100 % / 100 % |
| + Generator Plans 1 WP, Truckload 1600, pile 240k | 45.1 | 50.9 | 60.6 | 0/50 (max 3.8) | 100 % / 100 % |
| + pile 290k | 47.8 | 55.8 | 63.9 | 7/50 (max 4.4) | 100 % / 100 % |
| + Robotic Arm cost growth 1.16 (**final**) | **47.8** | **56.0** | **65.7** | **3/50 (max 4.6)** | **98 % / 100 %** |

Causes found in the gap analysis:

1. **Mid-game WP stall (~30–41 min, 1/3 of seeds).** Rakes saturate the first 50 hay/s trunk, new arms
   stay "Output blocked", *Robot Friends* (hay picked by arms) cannot progress, *Steady Flow* was chained
   behind it and there was no WP for Belt Speed. → *Steady Flow* (45 hay/s for a minute) now opens after
   *Wholesale*: the saturated trunk itself pays the WP for Belt Speed (DESIGN_DECISIONS D14).
2. **Early WP drought (8:40 → 14:50, 4 seeds).** After the wheelbarrow nothing costs money and the only
   WP source was *Truckload* (2000 hay by hand). → Generator Plans 2 → 1 WP (the $5k milestone makes it
   affordable mid-stretch, the hand-fed generator opens *Stoke the Fire*), *Truckload* 2000 → 1600.
3. **Bot artefact:** while digging a detected deep needle out by hand the bot made no other decision for
   up to 5 min with $20k+ in the bank. It now spends money / WP between trips, as a player would.
4. **Run too short** (median 48.8): the factory phase ended before the late machines paid off. → pile
   200k → 290k units (same shape, D12): only dig depth changes, money per hay sold is unchanged.
5. **Money waits between arms** (arm #5 cost $18.7k): growth 1.2 → 1.16.

GDD §3.3 targets vs bot median: rake 16–19 (13.2), conveyor 22–25 (15.2),
arm 31–34 (24.5), scanner 34–37 (27.1), compressor 37–40 (36.3), wrapper 49–52 (42.7), collector 55–58
(43.4), MK2 58–62 (43.1), final 62–70 (56.0). The bot is ahead of the GDD clock by design (instant,
never-hesitating builder); the human playtest decides whether the early game needs slowing down.

## 4. Human playtest sheet (fill one per run)

Rules: fresh save (Esc → New Run, or DevTools → Application → Local Storage → delete `pn_save_v1`),
no DevTools console, no cheats. Turn on **Esc → Settings → Show FPS counter** before starting. The pause
menu (Esc) shows the play time; write times as mm:ss from the first click. Note the quality setting you
start on (new players start on Medium; if the game lowers it automatically a message says so — write it
down).

```
Tester:
Date:
Build (commit):

Device:
CPU:
GPU:
RAM:
Browser (+ version):
Resolution / window size:
Quality (start → end, and whether the game lowered it automatically):

Start:                 00:00
First sale:
First upgrade (Work Tree):
Rake:
Conveyor:
Robotic Arm:
Scanner MK1:
Compressor:
Wrapper:
Vacuum Collector:
Scanner MK2:
Needle 1:
Needle 2:
Needle 3:
Needle 4:
Needle 5:
Needle 6:
Finish (summary screen):

Total time:

Lowest observed FPS (and where):
Typical FPS:

Biggest boring stretch (from – to, what were you waiting for?):

Most confusing mechanic:

Most satisfying mechanic:

Audio problems (too loud / annoying / missing):

Visual problems (clipping, floating items, belts moving the wrong way, gaps belt↔machine):

Bugs (steps to reproduce, screenshot if possible):

Would you keep playing after 15 min? (yes/no, why)

Would you finish the game? (yes/no, why)
```

Pass criteria for V1: completion 50–75 min, no stretch > 4 min with nothing to decide, no blocker bug,
Medium ≥ 45 FPS typical on the test laptop (see docs/RELEASE_CHECKLIST.md B1).
