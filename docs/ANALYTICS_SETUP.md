# Analytics setup (ByteBrew) — P0 Basic Launch

What gets sent and why: `docs/ANALYTICS_PRIVACY_NOTES.md`. Architecture:

```text
Game / GameTelemetry (src/game/telemetry.ts)      <- sim + game events, run dedupe, Welcome Back
        |
AnalyticsService (src/platform/analyticsService.ts)  <- queue, opt-out, caps, never throws
        |-- local buffer (src/platform/analytics.ts, window.__pnAnalytics)   always
        |-- ByteBrewAnalyticsAdapter (src/platform/bytebrewAdapter.ts)       keys set + enabled
        '-- NoopAnalyticsAdapter                                             otherwise
```

## 1. Create the ByteBrew Web project

1. Sign up at https://bytebrew.io/startnow (free; CrazyGames' partner link).
2. Dashboard → **Add game** → platform **Web**. Create **two** games: `Project Needle DEV` and
   `Project Needle PROD`, so local testing never pollutes production data.

## 2. Get the Web App ID and SDK Key

Dashboard → the game → **Game Settings** → Web app keys (https://docs.bytebrew.io/sdk/javascript, step 2).
Copy the **Web App ID** and the **Web SDK Key** of each game.

## 3. Configure the variables

```bash
cp .env.example .env.development.local   # dev server: DEV keys
cp .env.example .env.production.local    # npm run build: PROD keys
```

Fill in `VITE_BYTEBREW_WEB_APP_ID`, `VITE_BYTEBREW_WEB_SDK_KEY`, `VITE_APP_VERSION` (for example `0.2.0-bl1`, a new
value for every upload) and `VITE_PRIVACY_POLICY_URL` (the https URL of your privacy policy). `.env*` files are
git-ignored; only `.env.example` is committed. Vite loads `.env.[mode].local` automatically
(https://vite.dev/guide/env-and-mode).

These values end up in the public JavaScript. They are not secrets.

## 4. Build

```bash
npm run typecheck && npm test && npm run build
```

`dist/` contains `index.html` and 4 assets. `ByteBrewSDK-*.js` is a separate chunk, requested only when analytics
is active. Check the keys went in: `grep -c "<your app id>" dist/assets/index-*.js` should print `1`.

## 5. Check that events arrive

1. `npm run dev` (uses `.env.development.local`, the DEV ByteBrew game), open `http://127.0.0.1:5173/?debug=1`.
   For a last check of the production bundle use `npm run preview` (`http://127.0.0.1:4173/?debug=1`); that build
   has the PROD keys, so keep it to one short session and filter out `qa_test_event` in the dashboard.
2. DevTools console:
   - `__pnAnalyticsQA.status()` → `adapter: 'bytebrew'`, `adapterStatus: 'bytebrew ready'`, `state: 'ready'`,
     `sent` grows. `state: 'unavailable'` with `adapterStatus: 'bytebrew failed: ...'` means bad keys, a blocked
     request (ad blocker) or no network; the game keeps working.
   - `__pnAnalyticsQA.test()` sends a `qa_test_event`.
   - `__pnAnalytics.events()` lists every event of the session (local buffer, remote or not).
   - `?debug=1` also prints each event (`[analytics] ...`). The ByteBrew SDK prints its own `ByteBrew: ...` lines.
3. DevTools → Network → filter `bytebrew`: `POST .../api/game/logs/add`, status 200. The first response carries a
   `session_key` header; custom events look like `"category":"custom","externalData":{"eventType":"first_input","value":"game_version=...;run_index=1;..."}`.
4. ByteBrew dashboard → Custom Events. It updates in near real time
   (**NOT VERIFIED here**: the dashboard was not reachable from the dev container).

## 6. Events to expect in the first minute of a new player

`game_session_start` (new_player=true) → `run_start` → `order_started` (o_first) → click → `first_input` →
`menu_first_open` (pause/build/...) → `first_dig` → `first_hay_processed` → `order_completed` + `first_order_completed`
→ `order_started` ... → `playtime_checkpoint` 60. Full table: `docs/ANALYTICS_PRIVACY_NOTES.md` §3.

## 7. Test a new player

- New profile: incognito window, or DevTools → Application → Local Storage → delete `pn_save_v1`, `pn_profile`,
  `pn_settings`, and Cookies → delete `bb_*`.
- Expect `game_session_start` with `new_player=true`, `session_index=1`, then `run_start` with `run_index=1`.

## 8. Test a returning player

- Play 2-3 minutes (the run must be ≥ 120 s of in-game time), close the tab, reopen.
  Expect `game_session_start` with `returning_player=true`, `has_active_run=true`, `session_index=2`,
  `time_since_last_session_seconds` ≈ the pause; **no** `run_start`; no repeated `first_*`.
- Welcome Back needs ≥ 20 min away (`WELCOME_BACK_MIN_AWAY_S` in `src/game/welcomeBack.ts`). To test without
  waiting: close the tab, then in a new tab on the same origin, before the game loads, run in DevTools
  `const e = JSON.parse(localStorage.pn_save_v1); e.sim.savedAt -= 3*3600e3; localStorage.pn_save_v1 = JSON.stringify(e)`
  and reload **that** tab once. Closing or reloading a tab where the game runs saves again and resets `savedAt`.
  Expect the card, `welcome_back_shown`, and after the click `welcome_back_continue`. Money, hay and needles are the
  same as before.

## 9. Test an old save

Paste `tests/fixtures/rc1-late-save.json` (a real RC1 save) into `pn_save_v1` from a tab where the game is **not**
running, then open the game. Expect: 151 buildings, 4/6 needles; `game_session_start` with `save_version=1`; **no**
`first_*`, `run_progress` or `playtime_checkpoint` for the past (backfilled silently); after the next autosave
(30 s) the envelope has `"v":2` and `meta.telemetry`.

## 10. Turn analytics off

Settings → Privacy toggle (player), `?analytics=0` (page load), `VITE_ANALYTICS_ENABLED=false` or empty keys (build).
With it off: no request to `bytebrew.io`, `__pnAnalyticsQA.status().enabled === false`, no privacy line on the title screen.

## 11. Checklist before the CrazyGames upload

- [ ] Privacy policy written, hosted on https, `VITE_PRIVACY_POLICY_URL` set; the title screen shows the notice with the link.
- [ ] Opt-in or opt-out decided (see privacy notes §7.2).
- [ ] PROD keys in `.env.production.local`; `VITE_APP_VERSION` bumped; build from a clean `git status`.
- [ ] `npm run typecheck`, `npm test`, `npm run build` all pass.
- [ ] `npm run dev` + `?debug=1`: status `ready`, a `qa_test_event` visible in the ByteBrew dashboard (DEV game).
- [ ] `npm run preview` + `?debug=1` (PROD keys, one short session): status `ready`.
- [ ] Fresh profile → the first-minute sequence of §6 arrives. Returning player (§8) → no duplicate `first_*`.
- [ ] `?analytics=0` → no `bytebrew.io` request.
- [ ] ByteBrew dashboard → Game Settings → **invite `bytebrew@crazygames.com` as Data Partner** (manual step
      listed by CrazyGames, https://docs.crazygames.com/resources/partners/#bytebrew-analytics; how-to:
      https://docs.bytebrew.io/dashboard/gamesettings#InviteDevelopersToYourGame). Do it on the PROD game.
- [ ] Zip the **contents** of `dist/` and upload in the Developer Portal; test in the Preview tool (docs/CRAZYGAMES.md).
