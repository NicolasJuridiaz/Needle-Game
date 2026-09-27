# Human blind playtest V1 (before CrazyGames Basic Launch)

Goal: see what a first-time player does in their first session, where they get confused or bored, and whether they
want to finish. Automated tests and the balance bot cannot answer this. `docs/PLAYTEST_V1.md` §4 is the older
timing sheet; this document is the observation protocol for the Basic Launch build.

## Rules for the observer

- **Blind test.** Do not explain the game, the controls or the goal. Say only: "Play as you would at home. Think out
  loud if you can. I will not help unless you are completely stuck." Help only after the tester has been stuck
  for 3+ minutes and asks; write down when and what you said.
- Do not point at the screen, do not react to mistakes, do not answer "what do I do now?" (say "what do you think?").
- Fresh build and fresh profile: incognito window, or clear Local Storage (`pn_save_v1`, `pn_profile`,
  `pn_settings`) and cookies `bb_*`.
- Record the screen if the tester agrees (OBS or the browser recorder). Note times as mm:ss from the first click.
- Turn on Settings → Show FPS counter only after the session, or ask a second observer to read it: the counter is
  itself a hint that something is being measured.
- Analytics: run with the DEV ByteBrew keys (`npm run dev`) or the QA build, so these sessions do not mix with real
  player data. Afterwards, match the notes against `__pnAnalytics.dump()` (copy it from the console before
  closing the tab).
- Stop at 75 minutes or when the tester wants to stop. Never push them to continue.

## Tester sheet (one per tester)

```
Tester id (no names):               Date:              Observer:
Build (commit / VITE_APP_VERSION):
Plays games like this? (factory / incremental / first person): yes / no / some
Device / browser / window size:     Quality preset (start -> end, auto-lowered?):

TIMES (mm:ss from first click; "-" if it never happened)
Start (first click):                00:00
First moment of fun (what):
First confusion (what, how long):
First purchase (what):
First Work Tree upgrade (what):
First order completed:
First needle:
First automation (hay moving without the player):
First conveyor:
First Piston Rake:
First Robotic Arm:
Scanner (MK1):
Vacuum Collector:
Scanner MK2 (Scanner Lv.5):
Needles 2 / 3 / 4 / 5 / 6:
Finish (summary screen) or ABANDON at:        Reason (tester's words):

OBSERVATIONS
Boring moments (from-to, what they were waiting for):
Waiting for money (from-to, what they wanted to buy):
Confusing menus / UI (which, what they tried):
"Obvious" purchases (bought without thinking):
Interesting decisions (hesitated between options, what they chose, why):
Did they understand Lv x/5 cards (WP + $)?        Did they buy Hay Sell Value? When, why?
Did they use the Metal Detector? Did needle #2 take long? (minute):
Opened Work Tree / Shop / Orders on their own? (minute of first open, each):
Perceived FPS (smooth / some stutter / bad; where):
Bugs (what happened, steps, time; screenshot):

QUESTIONS AT THE END (ask, write their words)
1. What was the game about?
2. What was the most fun part? The most annoying?
3. When did you want to stop? Why did you continue (or not)?
4. Would you play another run with a different layout? (yes / no / maybe, why)
5. Would you come back tomorrow to finish? (if not finished)
6. Anything you never understood?
```

## After all sessions

| | Tester 1 | Tester 2 | Tester 3 | ... |
|---|---|---|---|---|
| Finished? total time | | | | |
| Abandon minute + reason | | | | |
| First automation (min) | | | | |
| Needle #2 (min) | | | | |
| Longest boring stretch | | | | |
| Wants another run | | | | |

Decision rules (write the actual numbers next to them):

- 2+ testers confused by the same thing in the first 10 minutes → fix before Basic Launch.
- Any blocker bug → fix before Basic Launch.
- Boredom in 30-50 min for most testers → do NOT change the economy yet; confirm with Basic Launch data first
  (`run_progress`, `playtime_checkpoint` 1800/2700, `needle_found` timings).
- "Would play another run" answers feed the Rebirth / New Farm decision (docs/RETENTION_MONETIZATION_V1.md §7);
  they do not justify building it before launch.
