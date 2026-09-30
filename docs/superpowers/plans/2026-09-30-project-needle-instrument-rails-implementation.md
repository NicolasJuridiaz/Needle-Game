# Project Needle Instrument Rails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved B · Instrument Rails HUD and panel language over the current real game without changing simulation, economy, progression, saves, world geometry or controls.

**Architecture:** Keep the existing `UI` parts, DOM helpers, event subscriptions and update cadence. Add semantic rail classes to the existing HUD components and perform the redesign primarily in `src/ui/styles.css`; TypeScript changes are limited to markup grouping or class names required for hierarchy and accessibility. Validate the presentation with a small source contract test plus real browser states and screenshots.

**Tech Stack:** TypeScript 5.9, Three.js, Vite 8, Vitest 5, DOM/CSS UI, in-app browser QA.

---

## File map

- Create `tests/uiDesign.test.ts`: static contract for the selected rail structure and non-neon visual rules.
- Modify `src/ui/hud.ts`: semantic economy, mission and player rail classes; keep all current values and events.
- Modify `src/ui/hotbar.ts`: shared bottom-centre tool rail class.
- Modify `src/ui/buildHud.ts`: semantic Build Mode rail class and labels.
- Modify `src/ui/tooltip.ts`: semantic bottom-right machine rail class.
- Modify `src/ui/detectorHud.ts`: align detector context with the machine rail area.
- Modify `src/ui/toasts.ts` and `src/ui/banners.ts`: edge-aligned notification treatment only if markup needs a semantic class.
- Modify `src/ui/shop.ts`, `src/ui/workTree.ts`, `src/ui/orders.ts`, `src/ui/pause.ts`, `src/ui/settingsPanel.ts`, `src/ui/summary.ts`: only when a shared panel class or semantic grouping is missing.
- Modify `src/ui/styles.css`: Instrument Rails tokens, HUD layout, Build Mode, panels, contextual feedback, responsive rules and reduced motion.
- Update `docs/DESIGN_DECISIONS.md`: record the selected B direction after implementation is verified.

### Task 1: Lock the visual contract with a failing test

**Files:**
- Create: `tests/uiDesign.test.ts`
- Test: `tests/uiDesign.test.ts`

- [ ] **Step 1: Write the failing structure and style contract**

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('Instrument Rails UI contract', () => {
  it('names each gameplay information rail explicitly', () => {
    expect(read('src/ui/hud.ts')).toContain('pn-rail--economy');
    expect(read('src/ui/hud.ts')).toContain('pn-rail--mission');
    expect(read('src/ui/hud.ts')).toContain('pn-rail--player');
    expect(read('src/ui/hotbar.ts')).toContain('pn-rail--tools');
    expect(read('src/ui/buildHud.ts')).toContain('pn-rail--build');
    expect(read('src/ui/tooltip.ts')).toContain('pn-rail--machine');
  });

  it('contains the approved responsive and reduced-motion contracts', () => {
    const css = read('src/ui/styles.css');
    expect(css).toContain('.pn-rail--economy');
    expect(css).toContain('.pn-rail--mission');
    expect(css).toContain('.pn-rail--player');
    expect(css).toContain('@media (max-height: 720px)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });
});
```

- [ ] **Step 2: Run the test and verify the expected failure**

Run: `npm test -- tests/uiDesign.test.ts`

Expected: FAIL because `pn-rail--economy` and the other selected-direction classes do not exist yet.

- [ ] **Step 3: Commit the red test with the implementation plan**

```bash
git add tests/uiDesign.test.ts docs/superpowers/plans/2026-09-30-project-needle-instrument-rails-implementation.md
git commit -m "Plan Instrument Rails HUD implementation"
```

### Task 2: Build the gameplay Instrument Rails structure

**Files:**
- Modify: `src/ui/hud.ts`
- Modify: `src/ui/hotbar.ts`
- Modify: `src/ui/styles.css`
- Test: `tests/uiDesign.test.ts`

- [ ] **Step 1: Add semantic rail classes without changing data flow**

Use the existing elements and append the shared class:

```ts
const res = h('div', 'pn-res pn-rail pn-rail--economy', el);
const tr = h('div', 'pn-tr pn-rail pn-rail--mission', el);
const player = h('div', 'pn-player pn-rail pn-rail--player', el);
```

In `hotbar.ts`, construct the root with `pn-hotbar pn-rail pn-rail--tools`. Do not change unlock filtering or active tool behaviour.

- [ ] **Step 2: Add the common rail primitive**

Add a solid shared surface and edge rule in `styles.css`:

```css
.pn-rail {
  background: color-mix(in srgb, var(--bg-0) 92%, transparent);
  border: 1px solid var(--line-2);
  box-shadow: var(--shadow-sm);
  backdrop-filter: none;
}
.pn-rail::before {
  content: '';
  position: absolute;
  background: var(--acc);
}
```

Implement direction-specific edge rules and use internal separators rather than nested card borders.

- [ ] **Step 3: Place the four gameplay zones**

At 1080p:

```css
.pn-rail--economy { top: calc(var(--u) * 0.9); left: calc(var(--u) * 0.9); width: min(15vw, calc(var(--u) * 15)); }
.pn-rail--mission { top: calc(var(--u) * 0.9); right: calc(var(--u) * 0.9); width: min(18vw, calc(var(--u) * 18)); }
.pn-rail--player { left: calc(var(--u) * 0.9); bottom: calc(var(--u) * 0.9); width: min(19vw, calc(var(--u) * 19)); }
.pn-rail--tools { left: 50%; bottom: calc(var(--u) * 0.9); transform: translateX(-50%); }
```

Remove borders and rounded card silhouettes from money/WP rows, Needles, Order, Power, Stamina, Held Hay and wheelbarrow subgroups. Use one-pixel separators between rows.

- [ ] **Step 4: Keep contextual visibility and centre feedback intact**

Preserve all `ClassSlot` decisions in `Hud.update`, including:

```ts
this.staminaVisible.set(mode !== 'build' && this.staminaShowT > 0);
this.carryVisible.set(mode !== 'build' && (weight > 0 || this.fullFlash > 0));
```

Style the prompt with a short leading amber or state-colour rule; do not change prompt strings, keys or enabled logic.

- [ ] **Step 5: Run the focused test and typecheck**

Run: `npm test -- tests/uiDesign.test.ts && npm run typecheck`

Expected: both commands pass.

- [ ] **Step 6: Commit gameplay rails**

```bash
git add src/ui/hud.ts src/ui/hotbar.ts src/ui/styles.css tests/uiDesign.test.ts
git commit -m "Implement Instrument Rails gameplay HUD"
```

### Task 3: Integrate Build Mode and machine context

**Files:**
- Modify: `src/ui/buildHud.ts`
- Modify: `src/ui/tooltip.ts`
- Modify: `src/ui/detectorHud.ts`
- Modify: `src/ui/styles.css`
- Test: `tests/uiDesign.test.ts`

- [ ] **Step 1: Add the Build and machine rail classes**

```ts
const el = (this.el = h('div', 'pn-build pn-rail pn-rail--build', parent));
const el = (this.el = h('div', 'pn-tip pn-rail pn-rail--machine', parent));
```

Keep `BuildHudState`, `BuildingInfo`, key hints, validity, affordability and power calculation unchanged.

- [ ] **Step 2: Make Build Mode replace gameplay lower rails**

Use the existing `data-mode` on `.pn-ui`:

```css
.pn-ui[data-mode='build'] .pn-rail--player,
.pn-ui[data-mode='build'] .pn-rail--tools { display: none; }
.pn-rail--build { left: calc(var(--u) * 0.9); bottom: calc(var(--u) * 0.9); width: min(29vw, calc(var(--u) * 29)); }
```

Keep one stable console footprint for Place, Belt, Remove and Move. Put tool tabs on one row, current object / cost in the main row, placement and power state on the right, and hints on one footer rule.

- [ ] **Step 3: Move machine context to the bottom-right**

```css
.pn-rail--machine {
  right: calc(var(--u) * 0.9);
  bottom: calc(var(--u) * 0.9);
  width: min(22vw, calc(var(--u) * 22));
}
```

Keep the current title, state pill, explanation, metrics and action key. Remove nested card backgrounds and preserve written reasons for blocked / disabled / unpowered states.

- [ ] **Step 4: Align detector context with the same lower-right system**

Use matching width, border, label scale and separators. Ensure detector and machine tooltip cannot overlap; detector wins only while its current UI rule says it is active.

- [ ] **Step 5: Verify focused test, typecheck and a build-mode browser state**

Run: `npm test -- tests/uiDesign.test.ts && npm run typecheck`

Then load the real local game and capture a valid and invalid Build Mode state at 1920 × 1080.

- [ ] **Step 6: Commit contextual rails**

```bash
git add src/ui/buildHud.ts src/ui/tooltip.ts src/ui/detectorHud.ts src/ui/styles.css
git commit -m "Align Build Mode and machine context rails"
```

### Task 4: Unify Store, Work Tree, Orders, Pause and Summary

**Files:**
- Modify: `src/ui/styles.css`
- Modify only if needed: `src/ui/shop.ts`
- Modify only if needed: `src/ui/workTree.ts`
- Modify only if needed: `src/ui/orders.ts`
- Modify only if needed: `src/ui/pause.ts`
- Modify only if needed: `src/ui/settingsPanel.ts`
- Modify only if needed: `src/ui/summary.ts`

- [ ] **Step 1: Flatten the shared panel shell**

Change `.pn-panel`, `.pn-panel-head`, panel navigation and footer CSS to use a single outer frame, neutral internal sections and hairline separators. Keep every existing button, key binding and action.

- [ ] **Step 2: Restyle SUPPLY CO. cards without touching the stall or purchase logic**

Cards use one surface, a top or left category rule, visible price / owned / lock reason and no gradient or glow. Do not change `selectBuildable`, shop filtering or prices.

- [ ] **Step 3: Restyle Work Tree hierarchy**

Keep node positions, requirements, branch colours, Now → Next values, costs and clicks. Reduce node chrome and use text / icon state labels with colour.

- [ ] **Step 4: Compact Orders**

Use consistent columns for client, title, progress and reward. Preserve progress formatting and clickable behaviour. Cards must remain readable at 907 × 510.

- [ ] **Step 5: Align Pause, Settings and Summary**

Use the same title rail, content separators, controls and state colours. Keep settings persistence, analytics consent, new-game confirmation and summary actions unchanged.

- [ ] **Step 6: Run typecheck and build**

Run: `npm run typecheck && npm run build`

Expected: both pass with no new dependency or bundle-loading failure.

- [ ] **Step 7: Commit shared panels**

```bash
git add src/ui/styles.css src/ui/shop.ts src/ui/workTree.ts src/ui/orders.ts src/ui/pause.ts src/ui/settingsPanel.ts src/ui/summary.ts
git commit -m "Unify Project Needle industrial panels"
```

### Task 5: Notifications, responsiveness and visual QA

**Files:**
- Modify: `src/ui/styles.css`
- Modify only if needed: `src/ui/toasts.ts`
- Modify only if needed: `src/ui/banners.ts`
- Modify: `docs/DESIGN_DECISIONS.md`

- [ ] **Step 1: Align notifications**

Place routine toasts under the economy rail, milestone / order banners in a narrow top-centre strip and keep needle discovery as the only large event. Use solid surfaces, concise motion and no neon effect.

- [ ] **Step 2: Add responsive and reduced-motion rules**

Add explicit rules for 1280 × 720 and 907 × 510 under `@media (max-height: 720px)` and narrower width breakpoints. Collapse micro labels before values, keep reasons visible and prevent overlap between bottom rails.

Add:

```css
@media (prefers-reduced-motion: reduce) {
  .pn-ui *, .pn-ui *::before, .pn-ui *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
  }
}
```

- [ ] **Step 3: Record the shipped design decision**

Append D27 to `docs/DESIGN_DECISIONS.md`: proposal B selected, rail ownership, contextual visibility, shared panel language and explicit statement that no gameplay systems changed.

- [ ] **Step 4: Capture real before / after evidence**

Use the real game, not a static reconstruction:

- early game at 1920 × 1080 and 1280 × 720;
- advanced factory fixture at 1920 × 1080 and 1280 × 720;
- gameplay, carrying / stamina context and Build Mode;
- before images already captured from commit `8a632a6`; after images from the implementation head.

Save screenshots under `outputs/hud-instrument-rails/` outside Git.

- [ ] **Step 5: Check browser console**

Inspect the real game after early and late-state navigation. Expected: zero new error-level console messages caused by UI code or CSS.

- [ ] **Step 6: Run the full engineering gate**

Run separately and inspect every exit code:

```bash
npm test
npm run typecheck
npm run build
git diff --check
```

- [ ] **Step 7: Commit final QA and decision record**

```bash
git add src/ui/styles.css src/ui/toasts.ts src/ui/banners.ts docs/DESIGN_DECISIONS.md
git commit -m "Finish Instrument Rails responsive UI pass"
```

### Task 6: Final review

**Files:**
- Review all files changed since `3c142a5`.

- [ ] **Step 1: Compare the final diff with every spec section**

Confirm HUD, Money / WP, Held Hay, Stamina, prompt, Order, Build Mode, Store, Work Tree, machine context, notifications, needle feedback, Pause / Settings and responsive behaviour are represented.

- [ ] **Step 2: Confirm implementation boundaries**

Run:

```bash
git diff --name-only 3c142a5..HEAD
```

Expected: UI, tests and documentation files only; no simulation, economy, progression, config, save or world files.

- [ ] **Step 3: Review visual exceptions**

Document any conservative deviation from the approved mockup, including the real-game condition that made it necessary and the exact replacement.

- [ ] **Step 4: Report commit IDs, screenshots, tests, console result and remaining visual limitations**

