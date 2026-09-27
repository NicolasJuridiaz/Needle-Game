# Analytics setup (ByteBrew) — P0.1 (opt-in)

Privacy model, storage, cookies, minors: `docs/ANALYTICS_PRIVACY_NOTES.md`. Architecture:

```text
Game / GameTelemetry (src/game/telemetry.ts)          <- sim + game events, run dedupe, Welcome Back
  |   AnalyticsConsentController (src/game/analyticsConsent.ts)   <- unknown / granted / denied, the ONLY switch
  v
AnalyticsService (src/platform/analyticsService.ts)  <- starts disabled; queue, caps, never throws
  |-- local debug buffer (src/platform/analytics.ts, window.__pnAnalytics)   always, in memory only
  |-- ByteBrewAnalyticsAdapter (src/platform/bytebrewAdapter.ts)             consent granted + remote available
  '-- NoopAnalyticsAdapter                                                   otherwise
```

Remote analytics is **available** only with both keys + an https `VITE_PRIVACY_POLICY_URL` + no `?analytics=0`
(dev server on localhost: policy URL optional). It is **active** only after the player clicks *Allow analytics* or
turns the Settings toggle on. Nothing is loaded or sent before.

## 1. Create the ByteBrew Web projects

1. Sign up at https://bytebrew.io/startnow (CrazyGames' partner link, https://docs.crazygames.com/resources/partners/#bytebrew-analytics).
2. Dashboard → **Add game** → platform **Web** (https://docs.bytebrew.io/startup/addgames). Create **two** games:
   `Project Needle DEV` and `Project Needle PROD`, so testing never mixes with player data.

## 2. Get the Web App ID and SDK Key

Dashboard → the game → **Game Settings** → Web app keys (https://docs.bytebrew.io/sdk/javascript, step 2).

## 3. Configure the variables

```bash
cp .env.example .env.development.local   # npm run dev: DEV keys (policy URL optional on localhost)
cp .env.example .env.production.local    # npm run build: PROD keys + VITE_PRIVACY_POLICY_URL (required)
```

Vite loads `.env.[mode].local` automatically (https://vite.dev/guide/env-and-mode). `.env*` files are git-ignored;
only `.env.example` is committed. These values are compiled into the public JavaScript: identifiers, not secrets.

## 4. Build

```bash
npm run typecheck && npm test && npm run build
```

`dist/` = `index.html` + 4 assets. `ByteBrewSDK-*.js` is requested **only after consent**. Check the keys went in:
`grep -c "<your app id>" dist/assets/index-*.js` → `1`.

## 5. Verify (DEV keys, `npm run dev`, http://127.0.0.1:5173/?debug=1)

1. Fresh profile (incognito). DevTools → Network, filter `bytebrew`: **nothing**; Application → Cookies: no `bb_*`;
   `__pnAnalyticsQA.status()` → `enabled: false`. The title screen shows the card (top right).
2. Click **Allow analytics** → Network: `ByteBrewSDK-*.js`, then `POST .../api/game/logs/add` (`new_user`), then
   `analytics_consent_granted`. Cookies `bb_u_id`, `bb_u_h_init` appear. `status()` → `bytebrew ready`.
3. Play: new events (`first_*`, `machine_built` ...) appear. Nothing that happened before the click is sent.
4. `__pnAnalyticsQA.test()` sends `qa_test_event`; check it in the ByteBrew DEV dashboard → Custom Events
   (dashboard timing **NOT VERIFIED** here, no real keys).
5. Esc → Settings → Privacy → toggle **off**: no more requests; cookie `bb_tr_on=false`; `bb_u_id` stays (SDK behaviour).
   Reload: no card, no requests. Toggle **on** again: ByteBrew restarts, `analytics_consent_granted` (`source=settings`).
6. Fresh profile → **Continue without analytics** → play → reload: no card, no requests, no `bb_*` cookie.
7. `?analytics=0`: no card, Settings row "Not available in this version", no requests.
8. Returning player with consent: close and reopen → `game_session_start` with `returning_player=true`; no repeated `first_*`.
9. Old save: paste `tests/fixtures/rc1-late-save.json` into `pn_save_v1` from a tab where the game is not running →
   151 buildings, 4/6 needles, Welcome Back card; with consent, no `first_*` for the past.
10. Welcome Back (needs ≥ 20 min away, `WELCOME_BACK_MIN_AWAY_S`): before the game loads, in a new tab on the same
    origin, run `const e = JSON.parse(localStorage.pn_save_v1); e.sim.savedAt -= 3*3600e3; localStorage.pn_save_v1 = JSON.stringify(e)`,
    then load the game in that tab.

`npm run preview` serves the production build (PROD keys): keep it to one short check and filter `qa_test_event` out.
Debug handles: `__pnAnalytics` (local buffer, all builds), `__pnAnalyticsQA` (dev server or `?debug=1`). None of them
can grant consent or bypass it.

## 6. Events

Every event carries `game_version`, `platform`, `run_id`, `run_index`, `elapsed_seconds`, `hay_remaining`, `money`,
`work_points`, `needle_count` (`game_session_start` only the first two). Sent only while consent is granted.

| Event | Trigger | Params (besides the context) | Once / repeat | Why |
|---|---|---|---|---|
| `analytics_consent_granted` | The player allows analytics (card or Settings) | `source` (`prompt`/`settings`), `stage`, `has_active_run`, building counts | once per grant | Marks where measurement starts; nothing earlier is sent |
| `game_session_start` | Page load | `new_player`, `returning_player`, `has_active_run`, `save_version`, `session_index`, `time_since_last_session_seconds` | once per page load | New vs returning players; D1/D7 of our own that does not depend on ByteBrew's cookie |
| `run_start` | New run (first play or New Run) | `starting_hay`, `is_new_game` | once per run | Funnel start; run count |
| `first_input` | First click into the game | — | once per run | Conversion to gameplay |
| `first_dig` | First hay dug by the player | — | once per run | Understood the core action |
| `first_hay_processed` | First sale | — | once per run | Understood selling |
| `first_tool_purchase` / `tool_purchase` | Tool bought in the Shop | `tool_id`, `money_cost` | first: once per run; purchase: each (≤ 7 per run) | First purchase; tool order |
| `first_tool_upgrade` / `tool_upgrade` | Player tool technology level (Work Tree) | `tool_id`, `from_level`, `to_level`, `money_cost`, `wp_cost` | first: once; upgrade: each | First upgrade; level pacing |
| `technology_upgrade` | Machine / logistics technology level | `technology_id`, `from_level`, `to_level`, `money_cost`, `wp_cost` | each | Level System pacing |
| `hay_value_upgrade` | Hay Sell Value level | `from_level`, `to_level`, `money_cost`, `wp_cost` | each | Is it seen as a real choice |
| `worktree_purchase` | Other Work Tree nodes (features) | `node_id`, `level`, `wp_cost`, `money_cost` | each | Feature adoption |
| `first_worktree_purchase` | Any first Work Tree purchase | `node_id` | once per run | First upgrade |
| `machine_built` | Machine placed; logistics only at 1/10/25/50/100/150/200/300 pieces | `machine_type`, `technology_level`, `total_of_type`, `total_buildings` (logistics: `machine_type=logistics`, `last_piece`) | each machine; logistics at those counts | Factory growth without per-belt spam |
| `first_machine`, `first_conveyor`, `first_automation`, `first_rake`, `first_robotic_arm`, `first_scanner`, `first_vacuum_collector`, `first_scanner_mk2` | First of each | `machine_type` / `source` where useful | once per run | First-session funnel |
| `scanner_unlock`, `vacuum_collector_unlock`, `scanner_mk2_unlock` | Technology bought (Scanner Lv.1, Collector Lv.1, Scanner Lv.5) | — | once per run | Late-game funnel |
| `menu_first_open` | First open of Work Tree / Shop / Orders / Build / Pause | `menu` | once per menu per run | Do players find the menus |
| `needle_found` | Needle found | `needle_index` (1-6, order found), `depth_band` (`band_1`..`band_6`, where the needle was hidden), `depth_band_min_percent`, `detection_method`, `current_scanner` (`none`/`mk1`/`mk2`), `has_detector` | each (6 per run) | Needle timing, especially the late needle #2 seen in bot runs |
| `first_needle` | First needle | `detection_method` | once per run | Funnel |
| `order_started` | Order appears on the board | `order_id` | each (24 per run) | Order pacing |
| `order_completed` / `first_order_completed` | Order completed | `order_id`, `duration_seconds` (in-game; omitted when unknown), `reward_money`, `reward_wp` | each / once | Which orders stall |
| `run_progress` | Haystack removed crosses 10/25/50/75/90/100 % | `percent`, `total_buildings`, `robotic_arms`, `conveyors`, `scanners`, `vacuum_collectors`, `wp_remaining`, `stage` | once per mark per run | Where players stop, independent of machines. **Note:** a completed run removes about 60-75 % of the pile, so 90/100 mostly happen after completion ("keep playing") |
| `playtime_checkpoint` | In-game time reaches 60, 180, 300, 600, 900, 1800, 2700, 3600 s | `seconds`, `stage`, `session_play_seconds` | once per checkpoint per run (in-game time, so it survives reloads) | Drop-off by time. The 30-50 min stretch = checkpoints 1800/2700 + `run_progress` 10/25 |
| `run_complete` | 6th needle | `total_buildings`, `robotic_arms`, `conveyors`, `scanners`, `vacuum_collectors`, `minutes` | once per run | Completion rate and time |
| `welcome_back_shown` / `welcome_back_continue` | Welcome Back card shown / player clicks in | `seconds_away`, `run_progress`, `current_stage` / `seconds_away` | once per load | Returning players |
| `performance_snapshot` | 5 and 15 min of gameplay in the session, late game (≥ 45 min in-game), run complete | `moment`, `quality_preset`, `avg_fps`, `p10_fps` (last 60 s), `draw_calls`, `triangles_k`, `total_buildings`, `device_class` (`desktop`/`tablet`/`mobile`/`unknown`, only what CrazyGames reports) | ≤ 4 per session | Real FPS by quality level |
| `game_error` | Uncaught error, unhandled rejection, WebGL context lost, save failed, corrupt save | `error_code`, `system`, `recoverable`, `occurrence` | ≤ 3 per code, ≤ 10 per session | Session-breaking problems |
| `qa_test_event` | Manual, `__pnAnalyticsQA.test()` (dev builds or `?debug=1`) | `source` | manual | Verifying the pipeline |

Local only (never sent): `quit_state`, `session_duration`.

## 7. Checklist before the CrazyGames upload

- [ ] Minors decision taken (privacy notes §5). If unclear: build with `VITE_ANALYTICS_ENABLED=false` and skip the rest.
- [ ] Privacy policy published on https (content: privacy notes §6), `VITE_PRIVACY_POLICY_URL` set in `.env.production.local`.
- [ ] PROD keys set; `VITE_APP_VERSION` bumped; clean `git status`.
- [ ] `npm run typecheck`, `npm test`, `npm run build` pass.
- [ ] §5 steps 1-7 pass with DEV keys; `qa_test_event` seen in the DEV dashboard.
- [ ] ByteBrew PROD game → Game Settings → invite `bytebrew@crazygames.com` as Data Partner (listed by CrazyGames,
      https://docs.crazygames.com/resources/partners/#bytebrew-analytics; how to invite:
      https://docs.bytebrew.io/dashboard/gamesettings#InviteDevelopersToYourGame).
- [ ] Upload `dist/` to the Developer Portal Preview and run `docs/RELEASE_CHECKLIST.md` C.
