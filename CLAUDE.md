# Project Needle

Project Needle is a first-person 3D incremental factory game for the web, built with TypeScript, Three.js, and Vite. The target platform is CrazyGames (with Poki-compatible web constraints in mind).

## Current project state

- The game starts with the player searching a large haystack by hand.
- The long-term loop is to extract hay, build conveyors and machines, automate processing, and find six hidden needles.
- Simulation code lives under `src/sim/` and is engine-agnostic; rendering and browser code live under `src/render/`, `src/game/`, `src/ui/`, and `src/platform/`.
- Design intent and implementation context are documented in `docs/reference/GDD_Project_Needle_V1.txt`, `docs/ARCHITECTURE.md`, `docs/DESIGN_DECISIONS.md`, and `IMPLEMENTATION_STATUS.md`.

## Working rules

1. Read the relevant documentation and existing implementation before changing behavior.
2. Preserve the current TypeScript/Vite architecture and keep the browser build runnable.
3. Keep simulation modules independent from Three.js and the DOM.
4. Prefer small, testable changes; update or add tests under `tests/` when behavior changes.
5. Run `npm run typecheck`, focused tests, and `npm run build` when practical.
6. Do not add generated output, dependencies, credentials, or local environment files to Git.
   Authorized runtime dependencies: `three`, and `bytebrew-web-sdk` (analytics only, imported solely in
   `src/platform/bytebrewAdapter.ts`). Analytics keys live in git-ignored `.env*` files (see `.env.example`).
7. Remote analytics is opt-in: never load, initialise or send to ByteBrew before the player's explicit consent
   (`src/game/analyticsConsent.ts`); `?analytics=0` always wins. See docs/ANALYTICS_PRIVACY_NOTES.md.

## Useful commands

```bash
npm install
npm run dev
npm run typecheck
npm test
npm run build
```

Before implementing a new feature, compare it with the GDD and current status so existing systems are not unnecessarily rewritten.
