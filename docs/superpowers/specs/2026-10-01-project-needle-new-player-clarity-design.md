# Project Needle — New Player Clarity Pass

**Status:** Approved direction. The owner selected **A · Focus + Full Tree** on 2026-10-01 and approved the supporting HUD, SUPPLY CO., guidance and compact-resolution changes described below.

## 1. Goal

Make the first 10–15 minutes understandable by delaying presentation of systems that do not yet affect the player's next decision.

The intended inferred loop is:

1. collect hay;
2. sell hay;
3. complete Orders to earn Work Points;
4. spend Work Points in the Work Tree to unlock plans;
5. buy unlocked items at SUPPLY CO.;
6. place them in Build Mode and begin automation.

This is a presentation, exposure and connection pass. It does not change prices, income, total run length, machine production, stamina, Hand Levels, hay quantity, Order rewards, Work Point economy, technology costs, Needle buffs, prerequisites or unlockable content. Instrument Rails remains the approved visual base.

## 2. Design principles

- Show information because it affects the current or next decision, not because the system exists.
- Preserve all real choices. Focus may remove future noise but may not hide a node that the player can currently buy.
- Derive progressive disclosure from the real prerequisite graph and current progression state.
- Treat timers as a QA lens, not as reveal gates. Players who progress faster or slower receive the correct information for their state.
- Reuse the Work Tree, shop, hint, toast and HUD systems already in the game.
- Keep the 3D world as the main surface. No tutorial modal, slideshow, tutorial level, NPC explanation, permanent arrows or large checklist.

## 3. Work Tree modes

### 3.1 Focus is the default

Every new UI session opens the Work Tree in **Focus**. Focus is the visually dominant mode and uses compact groups instead of the complete graph canvas.

Focus always includes:

1. **Owned:** every node with a purchased/base level.
2. **Available now:** every node or next level that `canUnlock` reports as purchasable with the player's current WP, money and prerequisites. A real choice is never hidden.
3. **Up next:** a small prerequisite-connected frontier defined in section 3.2.

Each node states its current role in plain language: `Owned`, `Available now`, `Need X WP`, `Need $X`, or its prerequisite. Existing Ready, Locked, Owned and Maxed meanings remain unchanged.

Focus is organized by the six existing branch names. Empty branches are absent. At desktop sizes, relevant branch groups can share the view. Branches do not reserve empty graph space.

### 3.2 Up-next frontier

The frontier is based only on the current prerequisite graph. Historical earnings or hypothetical accumulated cost are never reveal inputs.

A hidden node becomes an Up-next candidate when all of the following are true:

- it is not owned and not currently purchasable;
- it has at least one prerequisite, or it is one of the explicit first-decision roots described below;
- every prerequisite is either already satisfied or points directly to a node currently shown in Focus;
- at most one prerequisite chain step remains unresolved.

The initial first-decision roots are limited to the manual loop: the current Hands level and Carry Capacity. This makes a zero-WP tree legible without inventing a progression gate. As soon as other prerequisite-free roots become currently purchasable, they appear under **Available now**, because Focus may not hide a real purchase.

Frontier limits:

- no more than two Up-next nodes per visible branch;
- choose the lowest graph depth first, then the existing technology configuration order;
- a cross-branch node can introduce its branch only when its prerequisite node is owned or currently purchasable;
- nodes excluded by the limit remain available in Full Tree and enter Focus when their prerequisite connection becomes nearer or they become purchasable.

This rule reveals `Piston Rake` after its Generator connection becomes relevant, for example, while avoiding unrelated late systems at the beginning. It does not rank nodes by an invented recommendation score and does not choose a build for the player.

### 3.3 Levels inside owned nodes

An owned leveled technology remains one Focus card. The card shows the current level and the next level only. Later levels remain inside the existing detail view rather than becoming separate decisions on the main surface.

### 3.4 Full Tree is advanced and optional

The existing complete graph remains accessible from the beginning through a subdued header action labelled **Advanced · Full Tree**. It is not a peer primary tab and receives no onboarding hint, pulse or notification.

Entering Full Tree preserves the current graph, all nodes, dependency lines, pan behaviour, details and unlock actions. It includes a clear **Back to Focus** action. Selecting Full Tree is remembered for the current panel session, but reopening the Work Tree after closing returns to Focus. No save-format field is added.

Full Tree must never be required to buy a valid node; all currently purchasable nodes are present in Focus.

### 3.5 Compact Work Tree at 907 × 510

At compact height/width, Focus shows one relevant branch at a time. A short branch strip switches among branches that currently contain Focus nodes. The active branch displays Owned, Available now and Up next in that order.

The branch strip and resource header stay visible while its node list scrolls. Node text and costs stay readable; the solution may reduce columns but may not shrink essential text into illegibility. Full Tree remains available through the advanced action but is not the compact default.

## 4. Work Tree to SUPPLY CO.

### 4.1 Plan unlock feedback

When a plan node reaches its unlock level, the existing notification system shows a structured, brief message:

```text
PLAN UNLOCKED
Piston Rake
Available at SUPPLY CO. [B]
```

The exact item name comes from the same presentation source used by the Work Tree/shop. The feedback communicates that the plan is available for purchase; it must not use language such as `Owned`, `Received` or `Built`.

Upgrades and features that do not create a shop item keep a concise normal unlock message and do not claim SUPPLY CO. availability.

### 4.2 Six shared presentation groups

SUPPLY CO. presents the same six group names as the Work Tree without changing underlying build categories or progression:

| Presentation group | Existing shop categories |
|---|---|
| Player & Tools | `tools` |
| Extraction | `extraction` |
| Logistics | `logistics` |
| Needle Detection | `detection` |
| Processing & Economy | `processing`, `storage` |
| Power & Factory | `power`, `factory` |

Each shop card keeps its existing item name, lock, price, ownership and purchase/build behaviour. The grouping layer only controls navigation and filtering. Availability dots aggregate over every underlying category in the group.

The shop footer keeps the concise relationship: plans come from the Work Tree; unlocked items are bought or selected here.

## 5. Active Order reward

The active Order region in the mission rail adds one compact reward line based on the existing computed reward:

```text
REWARD  +$30  +1 WP
```

Work Points receive the stronger emphasis because they connect Orders to the Work Tree. Money remains visible when awarded. No new panel is created, and clicking the Order region continues to open Orders.

The reward display reads the current order definition and existing reward calculation. It does not duplicate or alter reward logic.

## 6. Contextual guidance priority

### 6.1 One action per message

Hint copy is shortened to one immediate action. Examples:

- `Hold LMB on the haystack.`
- `Take the hay to SELL HAY.`
- `Open the Work Tree with T.`
- `Buy the unlocked item at SUPPLY CO. with B.`
- `Enter Build Mode with Q.`

The guide keeps the existing waypoint where travel direction is useful. Explanations of the whole economy chain are removed from moment-to-moment copy; the chain is taught by successive state changes and the plan-unlock notification.

### 6.2 Interaction prompt wins

Priority is explicit:

1. relevant interaction prompt or denial;
2. contextual guide;
3. no central instruction.

When the HUD has a current interaction prompt, the guide line is hidden for that frame. Its waypoint may remain if it still helps navigation, but duplicate central text does not. When the prompt disappears and the hint is still unresolved, the guide returns under the normal hint timing rules.

The guide receives a smaller maximum width and concise wrapping. It must not form a second competing centre-screen panel.

## 7. Early-game information budget

These windows are validation checkpoints driven by progression events rather than fixed timers.

| Typical window | Immediate knowledge | Information presented |
|---|---|---|
| 0–2 min | Collect, carry, find SELL HAY, sell for money | Money, contextual collect/sell action, carry when relevant, interaction prompt at SELL HAY, active first Order only if it already affects the sale |
| 2–5 min | Understand the first Order and its reward | Order target/progress plus compact money/WP reward; no complete future Work Tree explanation |
| 5–10 min | Spend earned WP and distinguish unlock from ownership | Work Tree hint after WP exists, Focus nodes, structured plan-unlock feedback, SUPPLY CO. destination |
| 10–15 min | Buy, place and begin automation | Relevant shop group, Build Mode labels/status and only the connected next technologies |

Work Points stay hidden in the economy rail until first earned under the existing visibility rule. Systems reached early by an unusually fast player appear when their actual progression state makes them relevant.

## 8. Needle indicators

The six mission-rail slots keep their existing footprint and count. An unfound Needle remains a restrained empty needle slot. A found Needle shows its existing buff icon at small scale with the Needle silhouette/slot still visible.

This restores identity to each discovery without adding a codex, label list or larger panel. Existing buffs and discovery logic remain unchanged.

## 9. Build Mode and compact HUD

### 9.1 Build Mode labels at 907 × 510

Place, Belt, Remove and Move retain visible short text labels at 907 × 510. Spacing and padding may compact before labels disappear. The selected mode also appears in the console status line, so the player is never required to memorize icons.

Long secondary hints can wrap or reduce before tool names. Existing controls and build behaviour remain unchanged.

### 9.2 Machine plus detector

When the detector HUD and aimed-machine rail are visible together at compact resolution, the machine rail enters a condensed form containing machine name, operational state and the relevant action/reason. Secondary throughput/detail rows collapse temporarily.

The detector keeps the signal needed for its active task. Neither panel moves into the centre. At larger resolutions both may show their normal detail if their combined footprint remains clear.

## 10. Motion and feedback

Existing Instrument Rails motion rules remain in force. New clarity feedback uses the same short opacity/translation entrances and respects `prefers-reduced-motion`.

The plan-unlock notification may hold long enough to read its three short lines, then joins the normal notification queue. No repeating pulse, permanent badge or additional tutorial animation is introduced.

## 11. Implementation boundaries

Expected implementation areas:

- `src/ui/workTree.ts` and a small pure visibility helper if useful: Focus rendering, frontier calculation, mode switch and compact branch navigation.
- `src/ui/shop.ts`: six presentation groups over existing categories.
- `src/ui/toasts.ts`: structured plan-unlock feedback using the current event.
- `src/ui/hud.ts`: active Order reward, guide/prompt priority and Needle buff identity.
- `src/game/hints.ts`: concise single-action copy.
- `src/ui/buildHud.ts`, detector/machine HUD code and `src/ui/styles.css`: compact labels and detector/machine coexistence.
- targeted tests for frontier visibility, group mapping and prompt/hint priority.

No UI framework, new tutorial subsystem or save migration is required. Existing event subscriptions, controls, simulation APIs and panel architecture should be reused.

## 12. New-player validation flow

Start with a clean save and record the visible information at every step:

| Step | Action | Required visible information |
|---|---|---|
| A | Pick up first hay | One collect action, carry feedback; no future-system explanation |
| B | Sell hay | Waypoint while travelling; `E Deposit Hay` prompt at the station with the guide suppressed |
| C | Read first Order | Target, progress and compact reward |
| D | Earn WP | WP becomes visible; Order feedback makes its source clear |
| E | Open Work Tree | Focus is default; only Owned, Available now and connected Up next appear |
| F | Choose a purchase | Every actually purchasable option is present with cost/state |
| G | Unlock a plan | Structured `PLAN UNLOCKED` feedback names the item |
| H | Find SUPPLY CO. | Feedback and guide say the plan is available there and show `[B]` |
| I | Buy/select the item | Matching six-group name and same item name; price/ownership state remains clear |
| J | Enter Build Mode | Mode names remain textual; selection, price and placement state are legible |

At each step, note any system visible before it affects a decision. Such a finding is a clarity defect unless required by the approved persistent Instrument Rails HUD.

## 13. Screenshot matrix

Capture the real game, not a static concept:

1. New Game Work Tree in Focus.
2. Work Tree after first WP.
3. Work Tree after first plan unlock.
4. Active Order HUD with reward.
5. Plan-unlock feedback directing to SUPPLY CO.
6. Contextual guide while travelling to SELL HAY.
7. Interaction prompt at SELL HAY with redundant guide absent.
8. 907 × 510 Work Tree showing one Focus branch.
9. 907 × 510 Build Mode with readable text labels.

Use consistent states/resolutions where possible so hierarchy and obstruction can be compared. Also inspect an advanced factory to ensure disclosure and compact HUD changes do not damage established play.

## 14. Verification

Required automated checks:

- full test suite;
- typecheck;
- production build;
- targeted tests only for the new progressive-disclosure and hint-priority behaviour where they protect real logic.

Required browser checks:

- complete steps A–J from a clean save;
- verify Focus never omits a currently purchasable node;
- verify Full Tree is available from the beginning and contains the complete unchanged graph;
- verify the six shop groups contain every existing item exactly once;
- verify interaction prompts suppress competing guide text;
- inspect Work Tree and Build Mode at 907 × 510;
- inspect detector plus aimed machine at 907 × 510;
- inspect early and advanced factory states;
- confirm no new browser console errors or warnings attributable to the pass.

## 15. Definition of done

- A new player can infer the six-step loop without learning future systems first.
- Focus is the default and Full Tree feels like a quiet advanced option.
- Focus includes every purchased and currently purchasable node plus a bounded prerequisite-connected frontier.
- Reveal decisions never use historical earnings or hypothetical cost accumulation.
- Work Tree and SUPPLY CO. use the same six presentation groups and item names.
- A plan unlock clearly means available for purchase, not owned.
- Active Orders visibly explain their money/WP value.
- A relevant interaction prompt replaces competing guide text.
- Needle slots retain a small visual identity for discovered buffs.
- Work Tree and Build Mode remain readable at 907 × 510, and machine/detector panels do not dominate one corner.
- Economy, balance, pacing, prerequisites and content are unchanged.
- The requested nine screenshots and A–J visibility notes document the result.
- Tests, typecheck and production build pass, and browser console QA is clean.
