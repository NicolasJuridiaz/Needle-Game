# CrazyGames readiness

> 2026-09-27 (P0 Basic Launch): re-checked against docs.crazygames.com (intro, Basic Launch Guide, requirements
> intro / technical / gameplay / ads / account integration, SDK game / data / video ads / leaderboards, partners).
> No obsolete or unsafe SDK call found. Basic Launch does not need the SDK; the existing integration stays (it is
> required for Full Launch and already correct). See "Basic Launch vs Full Launch" at the end.

Checked against the official docs (docs.crazygames.com, 2026-09-26): SDK HTML5 v3 intro, Game module, Data module,
Technical / Gameplay / Quality requirements, Account integration.

## Integrated (HTML5 SDK v3)

| Requirement | Implementation |
|---|---|
| SDK loaded before game code | `index.html` `<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js">` |
| `await SDK.init()` | `src/platform/crazygames.ts`: timeout + silent fallback when the script is blocked (ad blocker), missing, init rejects/hangs or the environment is `disabled`; every SDK call is guarded, so a throwing SDK never reaches game code (`tests/platform.test.ts`). |
| Console hygiene | `src/platform/log.ts`: the platform layer prints only its **first** notice per page (`console.info`/`warn`); later ones are kept in `Platform.diagnostics`. `?debug=1` prints all. The only unavoidable line when the SDK host is blocked is the browser's own "Failed to load resource" for the SDK script. |
| Loading events | `loadingStart()` after init, `loadingStop()` when the Game is constructed (`src/main.ts`) |
| Gameplay start/stop | `gameplayStart()` when entering FPS play/build; `gameplayStop()` on pause, menus (Work Tree/Shop/Orders), summary. Not on focus loss (platform handles it). Idempotent wrapper. |
| Initial download ≤ 20 MB (mobile homepage) / ≤ 50 MB | Procedural assets (no textures/audio files). See build size in the final report. |
| Land in gameplay with ≤ 1 click | Boot → "Click to play" (click = pointer lock + audio unlock) → gameplay. |
| `muteAudio` setting (+ listener) | `Platform.onMuteChange` → `AudioEngine.setPlatformMuted` (overrides in-game volume). |
| Progress save (Data module) | The save **really uses the Data module** on CrazyGames: `Platform.init()` calls `PlatformStorage.useSdkData(SDK.data)` in `crazygames`/`local` environments, and from then on every read/write (`pn_save_v1`, `pn_settings`, `pn_analytics_consent_v1`, `pn_profile`) goes through `SDK.data`. localStorage is used only without the SDK (standalone, dev), in-memory when neither works. A backend that throws mid-session switches to the next one and the game keeps going. Late-game save ≈ 95 KB (1 MB limit). See "Data Module" below before filling the submission form. |
| `happytime()` | Needle found, run completed (sparingly). |
| `reportGameCompletedPercentage` | `src/platform/progress.ts`: 0 on a new game, the save's real value on load (n × 100 / 6, rounded: 0, 17, 33, 50, 67, 83), updated on every needle, 100 on completion. Never reported lower within a run ("Keep playing" stays at 100); a New Run restarts at 0. |
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
2. Submission form: choose **HTML5**, **Progress Save → "Yes, using the Data Module"** (the code really uses it; see
   "Data Module" below), orientation landscape, desktop only.
3. Test in the CrazyGames **Preview tool** (`crazygames.com/preview`) — the only place with the real `crazygames` environment.
4. Provide store assets: cover/thumbnail images, description, controls text, category.
5. Final name check (working title "Project Needle"; must stay original and not confusable with "Find The Needle").

## Basic Launch vs Full Launch (2026-09-27)

Official process (https://docs.crazygames.com/): Basic Launch = limited audience, 7-21 days (ends after ≥ 7 days
and ≥ 500 plays, or at 21 days), SDK optional, monetization disabled; Full Launch requires the full implementation.

| Item | Basic Launch | Status in this build | Full Launch (pending) |
|---|---|---|---|
| Size ≤ 50 MB initial / ≤ 250 MB total / ≤ 1500 files | required | 1.31 MB, 5 files | same |
| `gameplayStart` (if SDK integrated) | required | yes, on the first click | yes |
| `gameplayStart/Stop` everywhere | — | done | re-check in the QA tool |
| Data module (progress save) | optional | **in use** since RC1 whenever the SDK is active → select "Data Module" in the submission (see below) | required (or another official option) |
| `muteAudio` | — | done | required (HTML5) |
| Ads (midgame / rewarded) | disabled | **not implemented (on purpose)** | to design after Basic Launch data; mute + pause + `gameplayStop` during ads, no reward on `adError` |
| Account integration (User module) | — | not used (guest play + Data module) | only if accounts are ever added |
| Leaderboards | invitation only | not implemented | only if CrazyGames invites the game |
| User Consent notice | required when collecting data beyond the SDK | P0.1: **opt-in** card on the title screen (Allow / Continue without), link = `VITE_PRIVACY_POLICY_URL`; ByteBrew is impossible without that URL. **The policy itself must be written** (docs/ANALYTICS_PRIVACY_NOTES.md §6) | same |
| ByteBrew data partner | — | manual: invite `bytebrew@crazygames.com` in ByteBrew (docs/ANALYTICS_SETUP.md §11) | same |
| Land in gameplay ≤ 1 click | Full requirement | yes ("Click to play" / "Click to continue") | same |

## Data Module (P0.1 audit, 2026-09-27)

**Official facts** (https://docs.crazygames.com/sdk/data/, https://docs.crazygames.com/requirements/account-integration/#progress-save,
https://docs.crazygames.com/other/aps/):
- "If you intend to use the data module, don't forget to select the appropriate Progress Save toggle in the submission
  flow. The data module will be disabled otherwise." Error code `dataModuleDisabled`: "be sure you selected the 'Yes,
  using the Data Module from the CrazyGames SDK' option when submitting your game".
- "You need to fully rely on the Data Module save (for both guest and logged-in users on CrazyGames) and avoid relying
  on local saves." Guests: the SDK itself keeps the data in localStorage and moves it to the account on login. Limit 1 MB.
- Full Implementation requires a cloud progress save "unless progress is not applicable": preferably the Data module;
  or your own back-end via the User module; or APS (Automatic Progress Save: automatic backup of localStorage /
  IndexedDB, not allowed with in-game purchases).
- Basic Launch: SDK optional; the Data module is not required.

**Observed in code:** Project Needle does NOT use its own localStorage save on CrazyGames. Since RC1, `PlatformStorage`
routes every key through `SDK.data` as soon as the SDK reports `crazygames` / `local` (`src/platform/storage.ts`,
`src/platform/crazygames.ts`; covered by `tests/platform.test.ts`). The save format (RC2 v2, envelope v2) is the same
whichever backend stores it. P0.1 did not change this.

**Decision for the Basic Launch submission:** select **"Yes, using the Data Module"**, because the code relies on it.
Not selecting it would leave the SDK active with a disabled Data module. [INFERENCIA, not testable here] Our storage
switches to localStorage for the session only when a Data-module call throws; if a disabled module returned "no data"
instead of throwing, saves would not load in the next session. That is exactly the risk the official warning points at.
**Verify in the Preview tool** (RELEASE_CHECKLIST C6): play, reload, progress is still there; DevTools console has no
`[storage] CrazyGames data module failed` line.

Alternative (only if the owner prefers not to use the Data module): remove the SDK script from `index.html` for Basic
Launch (the SDK is optional there, the game already runs without it) and use APS or the Data module later for Full
Launch. That is a code change with its own QA and was **not** made.

Full Launch options (not implemented, for later): (1) keep the Data module (current code, just keep the toggle on);
(2) APS if the game stays without in-game purchases; (3) own back-end + User module (not planned).
