# CrazyGames readiness

Checked against the official docs (docs.crazygames.com, 2026-09-26): SDK HTML5 v3 intro, Game module, Data module,
Technical / Gameplay / Quality requirements, Account integration.

## Integrated (HTML5 SDK v3)

| Requirement | Implementation |
|---|---|
| SDK loaded before game code | `index.html` `<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js">` |
| `await SDK.init()` | `src/platform/crazygames.ts` (timeout + fallback when blocked/missing/disabled environment) |
| Loading events | `loadingStart()` after init, `loadingStop()` when the Game is constructed (`src/main.ts`) |
| Gameplay start/stop | `gameplayStart()` when entering FPS play/build; `gameplayStop()` on pause, menus (Work Tree/Shop/Orders), summary. Not on focus loss (platform handles it). Idempotent wrapper. |
| Initial download ≤ 20 MB (mobile homepage) / ≤ 50 MB | Procedural assets (no textures/audio files). See build size in the final report. |
| Land in gameplay with ≤ 1 click | Boot → "Click to play" (click = pointer lock + audio unlock) → gameplay. |
| `muteAudio` setting (+ listener) | `Platform.onMuteChange` → `AudioEngine.setPlatformMuted` (overrides in-game volume). |
| Progress save (Data module) | `src/platform/storage.ts` uses `SDK.data` in `crazygames`/`local` environments, localStorage otherwise. Save ≤ ~200 KB (1 MB limit). **Submission: select "Yes, using the Data Module".** |
| `happytime()` | Needle found, run completed (sparingly). |
| `reportGameCompletedPercentage` | needles found × 100 / 6 (reported at load and on each needle). |
| `setGameContext` | Every 60 s: minutes, needles, pile %, money, nodes, machines. |
| Relative paths | Vite `base: './'`. |
| Restricted keys | Keys by `event.code` (AZERTY friendly, labels via Keyboard Layout Map); no Ctrl+W; Esc = platform-standard pointer-lock release → pause. |
| No custom fullscreen button | None. |
| English | Game text in English. |
| `user-select: none` | Set on `body`. |
| Consistent physics across refresh rates | Fixed 20 Hz simulation + interpolation; controller uses dt clamping. |

## Not applicable / decided

- Ads: not integrated in V1 (Basic launch disallows ads; no natural rewarded moment designed yet). Architecture allows adding `SDK.ad.requestAd` later (see POST_V1_IDEAS.md).
- User module / accounts: no in-game accounts (guest play; progress via Data module syncs automatically when a guest logs in).
- Mobile: desktop-only in V1 (first-person factory building needs mouse). Submit as desktop; touch devices see a notice.
- Sitelock: not used.

## Pending — needs the developer's CrazyGames account (cannot be done from here)

1. Create the game in the Developer Portal and upload `dist/` (zip of the Vite build).
2. Submission form: choose **HTML5**, enable **Progress Save → Data Module**, orientation landscape, desktop only.
3. Test in the CrazyGames **Preview tool** (`crazygames.com/preview`) — the only place with the real `crazygames` environment.
4. Provide store assets: cover/thumbnail images, description, controls text, category.
5. Final name check (working title "Project Needle"; must stay original and not confusable with "Find The Needle").
