# Playtest V1 — pacing report

## What this is (and is not)

- **Not a human playtest.** This container has no GPU: Chromium renders with SwiftShader at ~1–13 FPS, so a
  legitimate 50–70 min human run is impossible here. A human playtest on real hardware is still required
  (see "Pending").
- **What was measured:** `tools/balance/bot.ts` plays full runs against the real simulation with the same
  player actions as the game (dig with cooldowns, walk, sell, unlock, buy, build with real placement rules,
  belts via the belt planner, power poles, moving starved extractors). It charges human build overhead
  (5 s per machine, 0.8 s per belt tile, 6 s per move) and +15 % on every action. No cheats: all money and WP
  are earned. It is a competent, not optimal, player — real first-time players should be slower.

Command: `npm run balance -- --seeds 10 --minutes 110 [--snapshots]`

## Results (10 seeds, build `b0161bc`+)

| seed | first sale | detector | rake | trunk | splitter | arm | scanner | compr. | silo | wrapper | collector | MK2 | needles (min) | complete | longest idle |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1000 | 00:11 | 07:56 | 16:41 | 17:29 | 21:57 | 22:57 | 30:01 | 36:35 | 32:21 | 42:32 | 47:52 | — | 9, 11, 16, 42, 47, 50 | 51.1 | 04:46 |
| 8919 | 00:11 | 08:40 | 18:22 | 19:25 | 28:40 | 27:32 | 34:22 | 41:01 | 38:29 | 45:49 | — | — | 9, 12, 38, 46, 51, 54 | 53.7 | 05:53 |
| 16838 | 00:11 | 08:40 | 13:24 | 14:13 | 18:31 | 19:32 | 25:06 | 29:40 | 28:13 | — | — | — | 9, 10, 13, 25, 29, 34 | 34.4 | 02:59 |
| 24757 | 00:13 | 08:21 | 14:55 | 15:43 | 19:56 | 20:56 | 27:49 | 31:30 | 30:23 | 36:47 | — | — | 9, 13, 15, 31, 37, 41 | 41.1 | 03:37 |
| 32676 | 00:11 | 08:01 | 27:32 | 28:36 | 37:57 | 36:48 | 46:35 | 50:26 | 49:34 | 55:51 | — | — | 13, 24, 48, 52, 56, 60 | 60.1 | 10:27 |
| 40595 | 00:12 | 08:05 | 21:03 | 15:30 | 25:52 | 23:57 | 25:44 | 35:20 | 33:49 | 47:16 | — | — | 9, 11, 14, 47, 51, 57 | 57.4 | 03:35 |
| 48514 | 00:12 | 09:07 | 18:43 | 19:47 | 29:19 | 28:09 | 36:45 | 38:22 | 37:36 | 43:46 | — | — | 10, 12, 33, 40, 43, 48 | 48.1 | 06:12 |
| 56433 | 00:12 | 08:16 | 21:35 | 22:40 | 32:09 | 31:00 | 38:29 | 44:25 | 43:43 | 51:47 | — | — | 9, 15, 43, 47, 51, 55 | 55.1 | 06:19 |
| 64352 | 00:12 | 08:51 | 21:54 | 15:43 | 27:31 | 24:57 | 27:23 | 33:24 | 32:00 | 40:41 | — | — | 9, 12, 15, 31, 37, 46 | 46.0 | 02:54 |
| 72271 | 00:12 | 08:33 | 17:54 | 18:57 | 28:15 | 24:43 | 28:07 | 33:02 | 32:06 | — | — | — | 10, 12, 22, 28, 33, 38 | 37.7 | 05:24 |

**Completion: 10/10 · min 34.4 · median 51.1 · max 60.1 min.** Longest stretch without a new
purchase/unlock/order/needle: 3–10 min (before tuning: up to 25 min, and 2/5 seeds never finished).

GDD targets (§3.3) for reference: detector 10–13, hopper 13–16, rake 16–19, generator+pole 19–22,
conveyor 22–25, splitter 28–31, arm 31–34, scanner 34–37, compressor 37–40, silo 40–43, wrapper 49–52,
collector 55–58, MK2 58–62, final 62–70. The bot runs ~0.8× the GDD clock from the factory phase on, which
is the intended margin for a bot that builds instantly and never hesitates.

## Bottlenecks observed (5-minute snapshots)

- ~20–25 min: first automation; power is 10/54 P — the constraint is WP/plans, not throughput.
- ~25–40 min: **arms > belt** — 3–9 arms report "Output blocked" as the trunk saturates at 50 hay/s;
  Belt Speed upgrades lift it to 75/100 hay/s.
- ~30–45 min: **belt > scanner** after belt upgrades (MK1 60 hay/s) → Scan Speed / Batch Size.
- ~35–50 min: **processing** — compressor/wrapper back up into the silo; the processing splitter spills
  to the bypass (silo fills → Stockpile order).
- ~40–55 min: **power** — demand 100–150 P of 117–234 P; Generator Output / Industrial Generator.

## Needle distribution (30 seeds, generation only)

Fraction of the pile above each needle (uniform lowering) — every needle stays inside its band:
1: 0.04–0.14 · 2: 0.18–0.28 · 3: 0.32–0.44 · 4: 0.46–0.58 · 5: 0.61–0.78 · 6: 0.82–0.96.
Needle 6 sits 0.8–5.8 m from the pile centre. The bot found the last needle between 34 and 60 min.

## Known pacing caveats

- Variance comes mostly from where the deep needles sit relative to where the player digs (the bot trenches
  through the core, which finds deep needles early on some seeds → 34–41 min runs).
- The Vacuum Collector and Scanner MK2 are usually not reached by the bot before the 6th needle; slower
  human runs (~60–70 min) should reach them. If the human playtest confirms they are skipped, bring
  `x_collector` / `d_mk2` forward or push band 6 deeper.

## Pending (human)

- Full run from an empty save on real hardware; record the same columns as the table above.
- Watch for the 20–30 min phase (first line + power): it is the most complex step for a new player.
