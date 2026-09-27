# Analytics — privacy notes (P0.1, opt-in)

**This is technical documentation, not a privacy policy and not legal advice. It makes no claim of GDPR, COPPA or
any other compliance.** Everything marked **REQUIRES OWNER/LEGAL REVIEW BEFORE PROD** is a decision for the game
owner, ideally with legal advice.

Labels: **[OFICIAL]** = read in official documentation (links in §9, checked 2026-09-27) · **[CÓDIGO]** = observed
in this repository or in the installed `bytebrew-web-sdk` 1.0.1 · **[QA]** = observed in Chromium with the network
intercepted (no data reached ByteBrew) · **[INFERENCIA]** / **[RECOMENDACIÓN]**.

## 1. Consent model (opt-in)

| State | How it happens | ByteBrew | Our analytics storage |
|---|---|---|---|
| `unknown` | New player, no choice yet | SDK chunk **never requested**, never initialised; 0 requests; 0 `bb_*` cookies [QA] | Nothing: no consent key, no `pn_profile`, no run id in the save [CÓDIGO] |
| `granted` | Player clicks **Allow analytics** (title-screen card) or switches the Settings toggle **on** | Loaded and initialised at that moment; then at every page load while granted | `pn_analytics_consent_v1 = "granted"`, `pn_profile`, `meta.telemetry` in the save |
| `denied` | **Continue without analytics** (card), or Settings toggle **off** (withdrawal) | Never initialised again; if it was running on this page, `stopTracking()` is called | `pn_analytics_consent_v1 = "denied"`; `pn_profile` removed; `meta.telemetry` dropped from the save |

- The game is 100 % playable in every state. Clicking the game without answering keeps `unknown` (nothing is sent);
  the card appears again on the title screen of the next visit. After "Continue without analytics" it is not
  shown again.
- **No replay of earlier events.** On consent we send one `analytics_consent_granted` event with a minimal snapshot
  (source, stage, whether a run is active, building counts, plus the common context). Everything that happened
  before (session start, `first_*`, purchases, needles ...) is never sent. Those milestones count as already done,
  so they are not re-sent later either [CÓDIGO, `tests/consent.test.ts`].
- Remote analytics is only *possible* when the build has both ByteBrew keys, `VITE_ANALYTICS_ENABLED` is not
  `false`, and `VITE_PRIVACY_POLICY_URL` is an absolute https URL. Otherwise the card is not shown, the Settings row
  says "Not available in this version", and consent cannot be granted [CÓDIGO + QA].
- Kill switch: `?analytics=0` in the page URL disables remote analytics for that page load, whatever the stored
  consent. It always wins [CÓDIGO + QA]. No query parameter, debug flag or configuration can grant consent.
- Development exception (only one): the Vite dev server opened on `localhost` / `127.0.0.1` / `[::1]`
  (`import.meta.env.DEV`) may run ByteBrew **without a privacy policy URL**, to test with the DEV ByteBrew game.
  It still requires clicking "Allow analytics". Never true in a production build (`isLocalDevelopment`,
  `src/platform/analyticsConfig.ts`).

## 2. ByteBrew lifecycle [CÓDIGO + QA]

1. Page load, consent not granted: nothing ByteBrew-related happens.
2. Consent granted (click, or already granted at boot): `AnalyticsService.setEnabled(true)` → dynamic `import()` of the
   `ByteBrewSDK-*.js` chunk → `initializeByteBrew(appId, sdkKey, version)`. The SDK sends a `user` event
   (`new_user` / `game_open`) and receives a session key in the `session_key` response header. Our events wait in a
   queue until `isByteBrewInitialized()` is true, or are dropped after 10 s (the game never waits).
3. Withdrawal on the same page: `stopTracking()`; nothing more is sent (verified: 0 requests after withdrawal).
4. Re-consent on the same page: `restartTracking()`. Re-consent on a later page: the SDK remembers the withdrawal in
   its own cookie `bb_tr_on=false` and refuses to initialise ("Tracking is disabled. Not initializing."). Only after
   an explicit re-consent, the adapter calls `restartTracking()` before `initializeByteBrew()` (verified: init OK,
   `bb_tr_on=true`, new events delivered).
5. On page unload while granted the SDK sends `game_close`; when the tab closes that request is often cut, and the SDK
   logs `TypeError: Failed to fetch` to the console.

## 3. Storage and cookies

### What the game stores (in CrazyGames: the SDK Data module; elsewhere: localStorage; see docs/CRAZYGAMES.md §Data Module)

| Key | Content | When created | How it changes / is removed | Purpose |
|---|---|---|---|---|
| `pn_save_v1` | The run save. Analytics part: `meta.telemetry` = `{ runId (random), runIndex, fired[], orderStarts }` **only while consent is granted** | First save (autosave 30 s, pause, tab hidden) | New Run; withdrawal drops `meta.telemetry` at once | Gameplay (Welcome Back uses the save's own `savedAt`); analytics dedupe |
| `pn_settings` | Volume, controls, quality ... (no analytics setting) | First settings change | Settings | Gameplay |
| `pn_analytics_consent_v1` | Only the word `"granted"` or `"denied"` (no id, no timestamp) | First explicit choice | Card or Settings toggle; deleting it = `unknown` (card shown again) | Remember the choice |
| `pn_profile` | `{ v, sessions, runsStarted, firstSeenAt, lastSeenAt }` counters | Only when consent is granted | Removed on withdrawal and at boot whenever consent is not granted | `session_index`, `returning_player`, `run_index` |

The in-memory local debug buffer (`window.__pnAnalytics`, last 500 events) exists on every page load and is lost when
the page closes. It is never persisted and never sent.

### What the ByteBrew SDK creates (only after consent) [QA, bytebrew-web-sdk 1.0.1]

| Cookie | Value | When |
|---|---|---|
| `bb_u_id` | Random UUID (ByteBrew user id) | First initialisation |
| `bb_u_h_init` | Same UUID ("user has initialised") | First initialisation |
| `bb_tr_on` | `false` after `stopTracking()`, `true` after `restartTracking()` | Withdrawal / re-consent |

- **`stopTracking()` does NOT delete `bb_u_id` / `bb_u_h_init`** [QA]. After a withdrawal they stay in the browser
  until the player clears cookies. On re-consent ByteBrew reuses the same `bb_u_id`. We do not delete ByteBrew's
  cookies ourselves: that is not what `stopTracking()` does, and deleting them would not remove data already held by
  ByteBrew. **REQUIRES OWNER/LEGAL REVIEW BEFORE PROD**: whether the policy must tell players how to clear them.
- Cookies are set on the game's origin. Inside the CrazyGames iframe, browsers that block or partition third-party
  cookies (Safari, Firefox strict mode) may reset `bb_u_id` → more "new users" in ByteBrew than real ones (BUGS B035).
  `session_index` / `returning_player` from `pn_profile` are the more reliable signal, but they too exist only since
  consent.

### What the SDK sends by itself (observed request body) [QA]

`game_id`, `user_id` (= `bb_u_id`), `session_id`, `session_key`, `platform: "Web"`, `version_number`, `sdk_version`,
`deviceScreenSize` (e.g. `1280x720`), `tracking_enabled`, `geo` (country code; how it is derived is **not verified**,
obfuscated code), `externalData.userLocale` (e.g. `en-US`), event type (`new_user`, `game_open`, `game_close`).
ByteBrew's server also receives the IP address with every request (normal HTTP). ByteBrew's privacy policy lists, as
"End User Data", IP addresses, device information, device identifiers, time stamps, screen resolution, language,
coarse location and country code [OFICIAL].

## 4. What we send (custom events)

Unchanged from P0 except the new `analytics_consent_granted`. Full table in `docs/ANALYTICS_SETUP.md` §6; catalog in
`src/platform/analyticsEvents.ts`. Common context on every event: `game_version`, `platform`, `run_id`, `run_index`,
`elapsed_seconds`, `hay_remaining`, `money`, `work_points`, `needle_count`. Wire format: snake_case keys, string
values, integers only, ≤ 48 characters, ≤ 24 params; ≤ 1500 events per page.

We deliberately do **not** send: names, emails, CrazyGames username / user id / avatar, IP or location of our own,
save data, free text, error messages or stack traces (codes only), GPU / CPU / user agent / resolution of our own.

## 5. Minors — BLOCKER — OWNER DECISION REQUIRED

Verified facts:

- [OFICIAL] CrazyGames: "CrazyGames is a website for an audience aged 13 or more. Your game must be PEGI 12
  compliant"; kids games go to a separate site (Gameplay requirements).
- [OFICIAL] ByteBrew privacy policy: "we do not knowingly collect or solicit Personal Data about children under 16
  years of age. If we learn we have collected Personal Data from a child under 16 years of age, we will delete that
  information as quickly as possible."
- [OFICIAL] ByteBrew Terms of Service (effective 5 January 2026), §4.3: the customer (developer) represents that it has
  a lawful basis, has given appropriate notice to its end users, and "if required by applicable law, it has obtained
  appropriate consents". The terms also require compliance with laws "related to ... consumer and child protection".
  No explicit age limit for end users was found in the Terms themselves (NOT VERIFIED beyond the text read).
- [OFICIAL] CrazyGames lists ByteBrew as an official analytics partner for its developers (Partners page).

Consequence [INFERENCIA]: CrazyGames' audience includes players aged 13-15. ByteBrew says it does not knowingly
collect personal data of under-16s. Consent given by a 13-15 year old may not be valid consent everywhere (the age of
digital consent differs by country). That is a real incompatibility risk, and the code cannot resolve it.

What the code does and does not do: ByteBrew is opt-in, can be turned off for a whole build
(`VITE_ANALYTICS_ENABLED=false` or no keys), and players can withdraw at any time. There is **no age gate** and none
was added (no verified requirement asks for one).

Owner decisions needed before shipping ByteBrew in PROD:
1. Ask ByteBrew (privacy@bytebrew.io) and/or CrazyGames developer support, in writing, whether ByteBrew custom
   analytics on a 13+ CrazyGames audience is acceptable to them.
2. Get legal advice on whether an opt-in without age verification is enough for the jurisdictions you target.
3. If the answer is unclear: launch Basic Launch **without ByteBrew** (build with `VITE_ANALYTICS_ENABLED=false`).
   The CrazyGames dashboard still gives players, average playtime, conversion and retention [OFICIAL, requirements
   intro].

## 6. What the future privacy policy must cover — REQUIRES OWNER/LEGAL REVIEW BEFORE PROD

This repository does not ship a policy. Checklist of content, derived from the facts above (not legal advice):

- [ ] Name of the game (Project Needle) and of the controller / developer, with a contact address.
- [ ] That analytics is optional, off until the player allows it, and how to withdraw (Esc → Settings → Privacy →
      "Share anonymous gameplay statistics" off).
- [ ] Analytics provider: ByteBrew, with a link to its privacy policy (https://docs.bytebrew.io/BBSettings/privacypolicy);
      ByteBrew acts as processor for developers' end users [OFICIAL].
- [ ] Purpose: gameplay analytics and product improvement (progress, purchases, performance, errors).
- [ ] Data: gameplay events (§4); what ByteBrew collects (§3: identifiers, cookies, IP, country, device and screen
      info, language, time stamps).
- [ ] Cookies / identifiers: `bb_u_id`, `bb_u_h_init`, `bb_tr_on`, and that withdrawal does not delete them.
- [ ] Local storage keys of the game (§3) and what the CrazyGames Data module does with them (synced to the
      player's CrazyGames account when logged in) [OFICIAL].
- [ ] Retention: ByteBrew keeps End User Data up to 24 months unless the developer directs otherwise [OFICIAL];
      decide and state your own retention setting.
- [ ] International transfers (ByteBrew stores data in the U.S. and possibly other countries [OFICIAL]).
- [ ] Rights of the player according to the applicable jurisdiction, and how to exercise them (for data held by
      ByteBrew: the ByteBrew user id is in the `bb_u_id` cookie).
- [ ] Minors (§5): the position you decide on.
- [ ] Hosted at an https URL → `VITE_PRIVACY_POLICY_URL`.

## 7. Turning analytics off

| Who | How |
|---|---|
| Player | "Continue without analytics", or Settings → Privacy toggle off |
| One page load | `?analytics=0` |
| Whole build | `VITE_ANALYTICS_ENABLED=false`, empty keys, or no `VITE_PRIVACY_POLICY_URL` |

## 8. Known SDK facts (bytebrew-web-sdk 1.0.1, installed version) [CÓDIGO + QA]

- API used: `initializeByteBrew`, `isByteBrewInitialized`, `newCustomEvent(name, {key: "value"})`, `stopTracking`,
  `restartTracking` (all present in `dist/types/ByteBrew.d.ts`). Remote configs are not used.
- The documentation says initialisation can be delayed until the user consents [OFICIAL]: that is what the game does.
- Last npm publish 2024-07-02; obfuscated bundle; `npm audit` flags `uuid` (BUGS B036).

## 9. Sources (checked 2026-09-27)

- CrazyGames: https://docs.crazygames.com/ · https://docs.crazygames.com/requirements/intro/ ·
  https://docs.crazygames.com/requirements/technical/#user-consent · https://docs.crazygames.com/requirements/gameplay/ ·
  https://docs.crazygames.com/sdk/data/ · https://docs.crazygames.com/other/aps/ ·
  https://docs.crazygames.com/resources/partners/#bytebrew-analytics
- ByteBrew: https://docs.bytebrew.io/sdk/javascript · https://docs.bytebrew.io/BBSettings/privacypolicy ·
  https://docs.bytebrew.io/BBSettings/termsservice · https://docs.bytebrew.io/BBSettings/dpa
