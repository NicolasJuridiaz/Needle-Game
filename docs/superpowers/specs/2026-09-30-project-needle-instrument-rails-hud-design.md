# Project Needle — Instrument Rails HUD redesign

**Status:** Chosen visual direction. The owner selected proposal **B · Instrument Rails** on 2026-09-30.

## 1. Goal

Replace the current collection of separate HUD boxes with a compact engineering interface that belongs to the factory world and preserves as much gameplay visibility as possible.

The redesign uses dark industrial surfaces, warm hay/amber interaction accents, restrained state colours, compact typography, thin rules and corner-aligned rails. It applies one hierarchy to the gameplay HUD, Build Mode and every major UI panel.

This is a presentation and interaction-clarity pass. Economy, progression, balance, orders, machine behaviour, power, stamina rules, save data, map geometry and controls remain unchanged.

## 2. Selected layout

The selected composition is **Instrument Rails**:

- **Top-left economy rail:** Money is primary. Work Points join the same rail after the first WP is earned.
- **Top-right mission rail:** Needles, active Order and Power form one aligned column. Order and Power continue to use the existing progression-based visibility rules.
- **Bottom-left player rail:** Stamina, Held Hay / capacity and wheelbarrow capacity share one compact contextual rail.
- **Bottom-centre tool rail:** unlocked tools form a narrow strip with one strong active state.
- **Centre:** only the reticle, interaction prompt and immediate denial feedback may occupy the aiming area.
- **Bottom-right machine rail:** aimed-machine context appears here only while relevant, leaving the centre and factory lanes readable.
- **Build Mode:** the bottom-left player rail and gameplay tool rail give way to one dedicated build console. The economy and mission rails remain stable.

The intended scan path is economy → objective → world → action. Persistent information stays at the screen edges; transient action information stays close to the reticle.

## 3. Visual language

### Surfaces and structure

- Near-black charcoal surfaces with enough opacity to stay readable over bright hay and the dark hall.
- One-pixel neutral borders and separators.
- A two- or three-pixel amber rule identifies the active edge of a rail.
- Small clipped corners may be used on the outer silhouette. Interior groups use alignment and rules instead of more boxes.
- No gradients, glass effects, decorative glow or straw texture.
- Shadows are short and dark, used only to detach text from the 3D scene.

### Colour roles

| Role | Use |
|---|---|
| Warm amber | selection, actionable values, active tool, valid build action |
| Off-white | primary labels and values |
| Muted warm grey | secondary labels, units, inactive tools |
| Green | valid placement, completed state, healthy positive state |
| Orange | low stamina, nearing capacity, constrained power |
| Red | blocked placement, insufficient funds, denied action, overload |

Every status includes text or an icon in addition to colour.

### Type and spacing

- Keep the existing Rubik font and tabular numerals.
- Micro labels: uppercase, 10–11 px at 1080p, increased tracking.
- Primary numeric values: 20–24 px at 1080p, semibold or bold.
- Body and prompt text: 12–14 px at 1080p.
- Use a 4 px base spacing rhythm. Most rails use 8–12 px internal gaps and 12–16 px edge offsets.
- Avoid headings that repeat information already expressed by position or icon.

## 4. Gameplay HUD behaviour

### Economy rail

- Money is always present during gameplay and Build Mode.
- Work Points are added as a second row after the player earns WP; they never create a separate floating card.
- Money and WP gain animations originate from their row and travel no farther than the rail.
- Spending uses a brief value response. It does not flash the entire panel.

### Mission rail

- Needle progress is the anchor at the top: six compact slots plus `n / 6`.
- The active Order follows under one separator with title, current / target and one progress line.
- Order reward is secondary microcopy, visible without competing with progress.
- Power follows under another separator only after the power system exists.
- Power states retain their exact current meaning. Overload adds a written warning and red rule; normal load stays amber.
- Clicking the Order region continues to open the Orders panel.

### Player rail

- Stamina appears while draining, recovering or below full and fades after the existing idle delay.
- Held Hay appears whenever the player carries hay, during the existing full-capacity warning and briefly after a relevant pickup/drop response.
- The value always shows `held / capacity`; the capacity is never represented only by bar length.
- Wheelbarrow capacity joins the same rail while held or otherwise relevant under current rules.
- When none of these states are relevant, the entire bottom-left gameplay rail disappears.

### Tool rail

- The tool strip remains centred near the bottom edge and contains only unlocked tools.
- The active slot uses an amber fill, dark icon and clear key number.
- Inactive slots share one surface rather than individual card silhouettes.
- Tool-specific progress or mode text appears only when that tool needs it.

### Reticle and interaction prompt

- The reticle stays visually minimal and preserves existing target / hay feedback.
- An enabled prompt sits directly below the reticle with a keycap, verb and target name.
- The prompt uses a short amber leading rule instead of a full highlighted card.
- Disabled interactions use the same position and geometry with a written reason and red or orange state.
- Denial messages replace or extend the prompt briefly; they do not open another centre-screen box.

### Machine context

- Aimed-machine information moves to a compact bottom-right rail.
- It shows machine name, operational state and only the most useful current metrics already provided by `BuildingInfo`.
- Switch and configuration actions remain explicit with their current key labels.
- Status labels such as blocked, disabled or unpowered always include the reason.
- The rail disappears immediately when no machine is targeted.

## 5. Build Mode

Build Mode uses a dedicated bottom-left console and removes gameplay-only player telemetry and the normal tool rail.

The console contains:

1. A single row for Place, Belt, Remove and Move with the active tool in amber.
2. Selected object name, category / footprint metadata, price and power requirement.
3. Placement state in words: Ready, blocked reason, powered / unpowered and network when available.
4. Rotation or route state only for tools that use it.
5. Current key hints on one low-contrast footer line.

Valid and invalid states must be readable without relying on the placement ghost colour. The console keeps the same footprint while the reason changes so it does not jump during aiming.

Target budget at 1920 × 1080: no more than about 29% of screen width and 14% of screen height. At lower resolutions it may widen, but it must not cover the centre reticle or the bottom-right machine area.

## 6. Panels and secondary UI

All panels reuse the same rails, typography, separators, tokens and state meanings.

### SUPPLY CO. / Store

- One full panel frame with title / resources on the top rail.
- Category navigation forms a compact horizontal strip.
- Product cards use hierarchy, separators and state text instead of decorative fills.
- Locked reason, owned count, price and primary stats stay visible without hover.
- Selection and purchase actions use amber; insufficient funds uses red text and reason.

### Work Tree

- Preserve the current node graph, costs and level model.
- Reduce card chrome and let branch colour identify technology families.
- The selected-node detail panel uses a strict Now → Next hierarchy.
- Ready, locked, purchased and maxed states include icons / labels as well as colour.
- Work Points and Money remain visible in the panel header.

### Orders

- Active and available Orders share one engineering-board layout.
- Progress, requirement and reward align consistently across cards.
- Completed orders recede visually but remain legible.
- The HUD mission rail and Orders panel use the same terminology and progress formatting.

### Pause, settings and summary

- Pause uses one centred industrial sheet with navigation on the left and content on the right when space allows.
- Settings rows align labels, controls and values to a shared grid.
- Confirmation dialogs inherit the same frame rather than adding a stylistically separate modal.
- Run summary uses the same restrained palette; needle rewards and major totals provide the visual emphasis.

### Notifications and needle feedback

- Routine toasts stack under the economy rail and expire without crossing into the centre.
- Order / milestone banners use a narrow top-centre strip and queue as they do now.
- Needle discovery remains a major event, but its presentation uses solid surfaces, crisp amber geometry and restrained particles instead of glow-heavy decoration.
- The six-needle count in the mission rail updates immediately after the event closes.

## 7. Visibility contract

| Element | Default | Contextual rule |
|---|---|---|
| Money | Visible | Always in gameplay and Build Mode |
| Work Points | Hidden initially | Visible after first WP is earned |
| Needles | Visible | Always in gameplay and Build Mode |
| Active Order | Visible when available | Hidden if no current order |
| Power | Hidden initially | Visible once a generator / power system exists |
| Stamina | Hidden at rest | Visible while used, recovering, low or denied |
| Held Hay | Hidden empty | Visible while carrying or during capacity feedback |
| Wheelbarrow | Hidden | Visible under current held / relevant rules |
| Tool rail | Visible in play | Hidden in Build Mode and pointer-free panels |
| Interaction prompt | Hidden | Visible only for an aimed interaction or denial |
| Machine context | Hidden | Visible only while a machine is aimed at |
| Build console | Hidden | Replaces gameplay lower HUD in Build Mode |
| Toasts / banners | Hidden | Event driven and queued |

## 8. Responsive rules and obstruction budget

Reference resolutions are 1920 × 1080, 1280 × 720 and 907 × 510.

- The centre 46% of the screen width remains free of persistent HUD.
- Top-left rail target: at most 15% width and 10% height at 1080p.
- Top-right rail target: at most 18% width and 22% height at 1080p.
- Bottom-left player rail target: at most 19% width and 10% height at 1080p.
- Bottom-centre tool rail target: at most 20% width and 6% height at 1080p.
- At 720p and below, micro labels may collapse before primary values. Required numeric values and action reasons never collapse.
- Long translated or dynamic strings wrap inside their rail; they never overlap the reticle or another rail.
- Respect safe edge spacing and browser aspect changes without stretching icons or bars.

## 9. Motion and feedback

- Values may count smoothly as they do now.
- Panel entrances use short opacity plus 4–8 px translation, generally 120–180 ms.
- Capacity, low stamina and denied actions use one short pulse on the affected row.
- Avoid continuous HUD motion except active warnings that already require attention.
- Honour `prefers-reduced-motion` by removing translations, looping pulses and decorative particles.

## 10. Implementation boundaries

Primary implementation files:

- `src/ui/hud.ts`: rail structure, visibility grouping, prompt and machine-context placement.
- `src/ui/hotbar.ts`: compact shared tool rail.
- `src/ui/buildHud.ts`: bottom-left Build Mode console.
- `src/ui/tooltip.ts` and `src/ui/detectorHud.ts`: contextual lower-right rail treatment.
- `src/ui/toasts.ts` and `src/ui/banners.ts`: event placement and visual treatment.
- `src/ui/shop.ts`, `src/ui/workTree.ts`, `src/ui/orders.ts`, `src/ui/pause.ts`, `src/ui/settingsPanel.ts`, `src/ui/summary.ts`: shared panel hierarchy.
- `src/ui/styles.css`: tokens, rails, panels, responsive rules and motion.
- `src/ui/ui.ts`: only if a structural layer or shared data attribute is required.

Existing `TextSlot`, `ClassSlot`, slow-update cadence, key-label formatting and event subscriptions should be preserved. Do not introduce a UI framework or dependency.

No change is allowed under simulation, economy, configuration, save migration or world-generation code unless a later implementation finding proves a UI value is unavailable. Such a finding must be handled through a read-only presentation adapter whenever possible.

## 11. Validation plan

Visual QA must use the real game and representative saves:

1. New game with only Hands and no WP / Power.
2. Early manual loop while carrying hay, sprinting and selling at SELL HAY.
3. Mid-game with an active Order, first generator and several unlocked tools.
4. Late factory with all six tool slots, dense automation and machine aiming.
5. Held Hay empty, partially full and full.
6. Stamina full, draining, recovering, low and denied.
7. Enabled and disabled interaction prompts with reasons.
8. Order progress, completion and reward notification.
9. Power healthy, constrained and overloaded.
10. Build Place, Belt, Remove and Move; valid / invalid; affordable / unaffordable; powered / unpowered.
11. Store, Work Tree, Orders, Pause, Settings and Summary.
12. Needle discovery and queued routine notifications.

For each important state, compare before / after screenshots at 1920 × 1080 and repeat the obstruction check at 1280 × 720 and 907 × 510.

Required engineering checks:

- `npm test`
- `npm run typecheck`
- `npm run build`
- zero new browser console errors or warnings attributable to the UI pass
- pointer lock, keyboard controls and panel clicks still work
- no save, economy, progression or simulation changes

## 12. Definition of done

- The game reads as one coherent dark industrial interface.
- The selected B layout is recognizable in real play, not only in a static mockup.
- Money / WP, Held Hay / capacity, Stamina, prompt, active Order and Build Mode have an obvious scan hierarchy.
- Persistent HUD leaves the central factory view clear.
- Early game is quieter than late game through contextual visibility.
- Every major panel follows the same tokens and interaction states.
- Before / after screenshots demonstrate reduced obstruction at both target resolutions.
- Tests, typecheck and production build pass, and the browser console is clean.

