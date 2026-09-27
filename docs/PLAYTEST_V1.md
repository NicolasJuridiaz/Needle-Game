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
npm run balance:many -- --seeds 50 --gaps          # this report (default pile 750k; --pile 500000 to compare)
# or in parallel: --shard i/4 --out sI.json (x4), then --merge s0.json s1.json s2.json s3.json --gaps
npm run balance -- --seed 135623 --minutes 90 --decisions   # one run, every decision with its state
```

`--decisions` prints one line per decision: TIME · EVENT · MONEY · WP · HAY RATE (delivered hay/s,
1-min window) · POWER (demand/supply) · NEXT PURCHASE ($ the bot is saving for) · NEXT TECH (WP) ·
ACTIVE ORDERS (id:progress) · NEEDLES.

**Decision** = buy a tool/machine/belt line, unlock a Work Tree node or research a level (WP + $), complete an order, find a needle,
move a machine, switch a machine off/on. Milestones are passive and do not count.

## 2. RC2 results — pile size test (50 seeds each, seeds 1000 + k·7919)

Level system, Hay Sell Value, RC2 prices, identical bot; only the pile size differs
(`npm run balance:many -- --seeds 50 --pile <units>`).

| | 500k | 650k | **750k (selected)** |
|---|---|---|---|
| Completed | 50/50 | 50/50 | 50/50 |
| Completion min / P10 / **median** / P90 / max (min) | 50.7 / 51.4 / **55.6** / 59.8 / 63.7 | 53.5 / 57.9 / **61.9** / 67.8 / 71.8 | 55.3 / 59.4 / **64.7** / 68.9 / 80.3 |
| Longest stretch without a decision: median / P90 / max (min) | 2.9 / 3.4 / 3.9 | 2.9 / 3.4 / 4.4 | 2.9 / 3.6 / 4.3 |
| Seeds with a stretch > 4 min | 0/50 | 1/50 | 1/50 |
| First Piston Rake / Conveyor / Robotic Arm (median, min) | 13.8 / 14.6 / 26.2 | 14.3 / 15.5 / 26.7 | 14.6 / 15.9 / 26.7 |
| First Scanner / Vacuum Collector / Scanner MK2 = Scanner Lv.5 (median) | 30.9 / 50.8 / 49.7 | 30.8 / 51.4 / 50.0 | 30.9 / 52.2 / 50.4 |
| **Vacuum Collector used** (>= 2 min before the end) | 58 % | 100 % | **100 %** (placed at 81 % of the run) |
| **Scanner MK2 / Lv.5 used** | 72 % | 100 % | **100 %** (placed at 79 % of the run) |
| Robotic Arms at the end (avg) | 8.1 | 15.5 | **18.3** |
| Buildings at the end (avg) | 183 | 192 | **195** |
| Levels bought (of 119) / Work Tree WP bought | 61 % / 66 % | 62 % / 67 % | 63 % / 68 % |
| Hay Sell Value level at the end (avg) | 9.2 | 9.1 | 9.3 |
| Avg levels: Arm / Rake / Collector / Conveyor / Scanner / Generator | 5.0 / 4.9 / 3.7 / 5.0 / 5.0 / 5.0 | 5.0 / 5.0 / 5.0 / 5.0 / 5.0 / 5.0 | 5.0 / 4.9 / 5.0 / 5.0 / 5.0 / 5.0 |
| Money earned / money left at the end (avg) | $1.21M / $173k | $1.61M / $309k | $1.84M / $416k |

**Selected: 750k.** It keeps the median inside the 55-65 min target (64.7), P90 at 68.9 (<= 75), the
late machines in 100 % of runs and the longest decision gaps at <= 4.3 min, and builds the biggest
factory. 500k is too short for the late game (Vacuum Collector used in 58 % of runs, MK2 in 72 %).
650k is the safe alternative (median 61.9, tighter tail). **Tail at 750k:** 3/50 seeds take 75-80 min;
all three find needle #2 very late (up to 48 min), so they lack WP and needle buffs and sit on Conveyor
Lv.4 for ~15 min — the same seed (135623) was the slowest in RC1 too. A human with the Metal Detector
should do better on those layouts; the human playtest has to confirm it.

Late-game throughput (seed 8919, 750k): 74 hay/s at 25 min, 249 at 50, 396 at 55, 512 at 60 min;
pile 48 % -> 94 % between 55 and 67 min. The slow stretch is 30-50 min (money-gated), not the end.

### RC1 -> RC2 factory scale (50 seeds, end of run)

| | RC1 (290k) | RC2 (750k) |
|---|---|---|
| Median completion | 56.0 min | 64.7 min |
| Robotic Arms | 10.0 | **18.3** |
| Piston Rakes / Vacuum Collectors | 4.0 / 3.6 | 6.0 / 6.0 |
| Scanners | 2.0 | 3.0 (MK1 trunk + MK2 on each feeder line) |
| Belt tiles | 109 | 145 |
| Processing machines (silo, compressor, wrapper) | 3.0 | 3.0 |
| Generators | 2.0 | 2.0 (power comes from Generator levels: 60 -> 290 P) |
| All buildings | 146 | **195** |
| Money earned | $473k | $1.84M |
| Late delivered rate (hay/s, sample logs) | 85-115 | 400-510 |

The bot also builds more *lines*: RC2 feeder lines run straight into their own Market Chute inputs
(three independent lines instead of one trunk), which is where the extra arms go.

### Payback (tools/balance/payback.ts, real machines at the pile edge, no belt limit)

| Machine | Lv.1 | Lv.3 | Lv.5 | 1st unit payback (Hay Value Lv.1 -> Lv.9) | 10th unit |
|---|---|---|---|---|---|
| Piston Rake ($2,500, x1.22) | 15 hay/s | 24 | 50 | Lv.1: 2.8 min -> 71 s; Lv.5: 49 s -> 21 s | Lv.1 17 min; Lv.5 4.9 -> 2.1 min |
| Robotic Arm ($7,000, x1.10) | 8.3 | 16.3 | 45 | Lv.1: 14 -> 6 min; Lv.5: 2.6 min -> 66 s | Lv.1 33 min; Lv.5 6.1 -> 2.6 min |
| Vacuum Collector ($18,700, x1.15) | 50 | 62 | 120 | Lv.1: 6.2 -> 2.7 min; Lv.5: 2.6 min -> 66 s | Lv.1 22 min; Lv.5 9.1 -> 3.9 min |

A machine bought when its technology is at the level players have at that moment pays back in 1-6
minutes; no machine pays back in seconds when it is typically bought (the first rake is bought at Lv.1:
2.8 min). Piston Rake Lv.5 used to make 92 hay/s (payback 12-27 s) and was toned down.

## 3. History: RC1 pacing pass (290k pile, 50 seeds)

RC1: P10 47.8 / median 56.0 / P90 65.7 min, 3/50 seeds with a 4:01-4:38 gap, Vacuum Collector 98 %,
Scanner MK2 100 %. Changes of that pass (order DAG, WP drought, arm price growth, pile 290k) are recorded
in docs/DESIGN_DECISIONS.md D12-D14.

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
Scanner MK2 (Scanner Lv.5):
Needle 1:
Needle 2:
Needle 3:
Needle 4:
Needle 5:
Needle 6:
Finish (summary screen):

Total time:

Levels at the end (Work Tree): Robotic Arm Lv.__  Conveyor Lv.__  Scanner Lv.__  Generator Lv.__
Hay Sell Value Lv.__   Number of Robotic Arms: __   Money left at the end: $__
Was a Level upgrade (Lv.x/5 card, WP + $) clear? What did you buy first with money: machines or levels?

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
