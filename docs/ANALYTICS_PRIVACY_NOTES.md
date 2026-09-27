# Analytics — privacy notes (P0 Basic Launch)

Status: written by the developer team for internal use. **This is not a privacy policy.** The legal text
(privacy policy / terms) must be written and hosted by the game owner; see "Pending before production".

## 1. Provider

| | |
|---|---|
| Provider | ByteBrew (https://bytebrew.io), CrazyGames' listed analytics partner (https://docs.crazygames.com/resources/partners/) |
| SDK | `bytebrew-web-sdk` 1.0.1 (npm, MIT, obfuscated bundle), lazy-loaded chunk `ByteBrewSDK-*.js` (25.7 KB, 9.3 KB gzip) |
| Endpoints (observed) | `POST https://web-platform.bytebrew.io/api/game/logs/add` (events), `.../api/game/configurations/remote/` (remote configs, not used) |
| When it loads | Only if the build has `VITE_BYTEBREW_WEB_APP_ID` and `VITE_BYTEBREW_WEB_SDK_KEY`, `VITE_ANALYTICS_ENABLED` is not `false`, the player has not turned statistics off, and the URL has no `?analytics=0` |
| Code | `src/platform/bytebrewAdapter.ts` is the only file importing the SDK. The game talks to `AnalyticsService` (`src/platform/analyticsService.ts`); game events are produced by `GameTelemetry` (`src/game/telemetry.ts`) |

## 2. What the ByteBrew SDK sends by itself (observed in QA, not controlled by us)

Captured from the real SDK in Chromium with the network intercepted (no data reached ByteBrew):

| Field | Example | Notes |
|---|---|---|
| `user_id` | random UUID | ByteBrew's own id, stored in the cookie `bb_u_id` |
| `session_id`, `session_key` | UUID / server key | per page session |
| `game_id`, `version_number`, `sdk_version` | our app id, `VITE_APP_VERSION`, `1.0.1` | |
| `platform` | `Web` | |
| `deviceScreenSize` | `1280x720` | screen size |
| `geo` | `US` | country code. How the SDK derives it is **not verified** (obfuscated code) |
| `externalData.userLocale` | `en-US` | browser language |
| `tracking_enabled` | `true` | |
| Cookies | `bb_u_id`, `bb_u_h_init`, `bb_tr_on` | set by the SDK on the game's origin |

Like any web request, ByteBrew's server also sees the player's IP address. We never send it ourselves.

## 3. What we send (custom events)

Every remote event carries this context (`GameTelemetry.context()`):
`game_version`, `platform` (`crazygames` / `crazygames_local` / `web`), `run_id` (random, per run), `run_index`,
`elapsed_seconds` (in-game time of the run), `hay_remaining` (% of the haystack left), `money`, `work_points`,
`needle_count`. The session event has only `game_version` and `platform`, because no run is attached yet.

Wire format (ByteBrew rules: no spaces, periods or colons): snake_case keys; all values are strings;
numbers are rounded to integers; text is reduced to `[a-z0-9_]`, at most 48 characters; at most 24 params per event.

| Event | Trigger | Params (besides the context) | Once / repeat | Why |
|---|---|---|---|---|
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

Local only (in the in-memory buffer `window.__pnAnalytics`, never sent): `quit_state`, `session_duration`.
They fire on tab close, where a request is not reliable.

**Safety limits** (`AnalyticsService`): at most 200 queued events before ByteBrew is ready, and at most 1500 remote
events per page session. Analytics never throws into the game, never blocks boot, and a ByteBrew failure turns the
service local-only.

## 4. What we deliberately do NOT send

- No name, email, CrazyGames username, user id or avatar (the CrazyGames User module is not used).
- No IP address or location of our own. ByteBrew's country field (section 2) is theirs.
- No save data, no free text (the game has no text input), no error messages or stack traces (codes only).
- No hardware fingerprint: no GPU string, CPU, RAM, user agent or resolution from our side. The only device field
  is `device_class`, and only when CrazyGames reports it.
- No per-frame or per-tick events, and no per-belt events.

## 5. Configuration

`.env.example` has all variables. Copy it to `.env.production.local`; files matching `.env*` are git-ignored.

| Variable | Meaning |
|---|---|
| `VITE_BYTEBREW_WEB_APP_ID`, `VITE_BYTEBREW_WEB_SDK_KEY` | ByteBrew Web keys. Empty = remote analytics off (noop) |
| `VITE_APP_VERSION` | `game_version`. Set a new value per upload. Fallback: the `package.json` version |
| `VITE_ANALYTICS_ENABLED` | `false` = no remote analytics for this build |
| `VITE_PRIVACY_POLICY_URL` | https link shown in the in-game notice |

These values are compiled into the public JavaScript bundle. They are identifiers, not secrets; ByteBrew's own docs
say client-side keys cannot be hidden.

## 6. Turning tracking off

| Who | How | Effect |
|---|---|---|
| Player | Esc → Settings → Privacy → "Share anonymous gameplay statistics" off (saved) | Nothing more is sent; ByteBrew `stopTracking()` is called if it was running; the SDK is never loaded on the next visits |
| Anyone, one page load | `?analytics=0` in the URL | SDK not loaded, notice hidden |
| Build | `VITE_ANALYTICS_ENABLED=false` or no keys | No SDK in use (the chunk file exists but is never requested) |

In-game notice (CrazyGames "User Consent", https://docs.crazygames.com/requirements/technical/#user-consent): when
ByteBrew is active, the title screen shows a small, non-blocking line with a link to `VITE_PRIVACY_POLICY_URL`.

## 7. Pending before production (manual, owner)

1. **Write and host a privacy policy** covering ByteBrew (section 2 data, cookies, purpose, retention, contact,
   opt-out) and set `VITE_PRIVACY_POLICY_URL`. Without it, do not upload a build with ByteBrew keys.
2. Decide with a legal advisor whether opt-out (current default: statistics on, notice shown) is enough for your
   audience (EU/UK players, CrazyGames audience 13+), or whether ByteBrew must only start after explicit consent.
   The code supports both: to require opt-in, set `shareAnalytics` default to `false` in `src/game/settings.ts`
   and add a consent control. That is a product and legal decision; it has not been made here.
3. Check ByteBrew's data processing terms and retention settings in its dashboard.
4. **Known limitation:** ByteBrew identifies users with a cookie on the game's origin. Inside the CrazyGames iframe,
   browsers that block or partition third-party cookies (Safari, Firefox strict mode) may reset that id, which
   inflates "new users" in ByteBrew. Use our own `returning_player` / `session_index` (stored with the save through
   the CrazyGames Data module / localStorage) as the reference for returning players.
