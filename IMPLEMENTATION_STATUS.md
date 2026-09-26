# IMPLEMENTATION STATUS — Project Needle V1

Estados: NOT STARTED · IN PROGRESS · IMPLEMENTED · QA PASS · BLOCKED
**QA PASS = ejecutado y comprobado por el lead** (tests, sim headless y/o navegador). IMPLEMENTED ≠ QA PASS.

Última actualización: 2026-09-26 (pasada final de balance, auditorías y Release Candidate).

**Veredicto: RELEASE CANDIDATE — REQUIRES REAL-HARDWARE QA.** Lo pendiente está en `docs/RELEASE_CHECKLIST.md` (B y C).

## Verificación global (ejecutada por el lead)

| Check | Resultado |
|---|---|
| `npm run typecheck` | PASS (0 errores) |
| `npm test` | PASS — 377/377 (17 ficheros) |
| `npm run build` | PASS — `dist/` 1,26 MB, 4 ficheros (JS 1,15 MB / 327 KB gzip), rutas relativas |
| `npm run balance:many -- --seeds 50` | 50/50 completan · P10 47,8 · mediana 56,0 · P90 65,7 · máx. 70,2 min · Vacuum Collector usado en 98 %, Scanner MK2 en 100 % · 47/50 sin tramo > 4 min sin decisión (3 en 4:01–4:38) |
| Auditoría Work Tree | 95 nodos · 95 alcanzables · 95 probados · 0 muertos · 0 no-op · 109/109 niveles |
| Auditoría upgrades de máquinas | 13 familias, cada nivel con valor esperado y antes/después en sim · 0 defectos conocidos |
| Economía / softlock / save fuzz / completion | PASS (`tests/economy`, `softlock`, `saveFuzz`, `completion`) |
| Build de producción (`npm run preview`, Chromium headless) | QA funcional PASS: partida nueva, save tardío, Work Tree, Shop, build, cintas, máquinas, pantalla final — ver RELEASE_CHECKLIST A |

## Sistemas

| Sistema | Estado | QA | Observaciones |
|---|---|---|---|
| Arquitectura / contratos / config de balance | IMPLEMENTED | QA PASS | 95 nodos (235 WP), 23 orders, 23 milestones, 6 agujas; una partida da como máximo 163 WP (D13) |
| Hay field (pajar, relajación, agujas, detector, tossBack, save) | IMPLEMENTED | QA PASS | 16 tests; distribución de agujas verificada en 30 semillas (cada una en su banda) |
| Logística (belts, curvas, side-loading de máquinas, splitters 5 modos, mergers, U, lift, rampa, planner) | IMPLEMENTED | QA PASS | throughput exacto en todos los niveles de cinta (B022); planner de 2 clics probado en build de producción |
| Máquinas (hopper, rake, brazo, collector, scanners, compressor, wrapper, silo, generador) | IMPLEMENTED | QA PASS | 13 tests + integración; animación del brazo verificada en navegador |
| Red eléctrica (polos, generadores, sobrecarga progresiva) | IMPLEMENTED | QA PASS | tests de sobrecarga/noPower/alcance; HUD de potencia visto en navegador |
| Progresión (money, WP, Work Tree, shop, orders, milestones, buffs) | IMPLEMENTED | QA PASS | 34 tests; DAG de orders corregido (B012) |
| Upgrades (efecto real de cada nivel) | IMPLEMENTED | QA PASS | `tests/upgrades.test.ts`: cada nivel cambia algo; 16 familias con ≥2 niveles; 7 upgrades medidos en sim |
| Acciones del jugador (herramientas, detector, carretilla) | IMPLEMENTED | QA PASS | 21 tests; cavar/vender probado en navegador |
| Render (almacén, pajar, belts, items, ghost, cables, partículas, FX, agujas) | IMPLEMENTED | QA PASS (funcional) | Calidad High/Medium/Low diferenciada (Medium por defecto, cambio en vivo), tope de DPR + presupuesto de píxeles, AutoQuality, mensaje sin WebGL. Draw calls: 30 / 113 / 117. FPS en GPU real NO medido |
| Modelos 3D + viewmodels | IMPLEMENTED | QA PASS (visual) | Todos los tipos tienen modelo; galería renderiza 48 entradas |
| UI (HUD, Work Tree, Shop, Orders, pausa, resumen, needle found, build HUD, tooltips) | IMPLEMENTED | QA PASS (funcional) | B015/B016 corregidos; B018 abierto (P3) |
| Audio procedural + música | IMPLEMENTED | PARCIAL | Motor arranca (`AudioContext` running, 10 loops renderizados, música). Volumen/mezcla NO escuchados por un humano |
| Plataforma CrazyGames / guardado / analytics | IMPLEMENTED | QA PASS (standalone) | Progreso 0 → n×100/6 → 100; SDK bloqueado/ausente/rechazado no bloquea ni ensucia la consola (47 tests); almacenamiento SDK → localStorage → memoria. SDK real no ejecutado (sin entorno CrazyGames) |
| Game loop, controlador FPS, interacción, build mode, hints | IMPLEMENTED | QA PASS | Paso fijo 20 Hz; independencia de refresco probada (60/120/144/165 Hz) |
| Bot de balance headless | IMPLEMENTED | QA PASS | Construye la fábrica real completa; log de decisiones con estado (`--decisions`), análisis de huecos > 4 min, 50 semillas en paralelo (`--shard/--merge`) |
| Playtest humano completo 50–70 min | NOT STARTED | — | No realizable en este entorno (ver abajo) |
| Rendimiento en hardware real | NOT STARTED | — | Solo coste de CPU medido |

## Limitaciones de la QA de esta sesión (explícitas)

- El contenedor no tiene GPU: Chromium usa SwiftShader (render por CPU) a ~1–2 FPS reales (medidos con
  el contador corregido, B026). Esos FPS **no** representan hardware real. CPU por frame con la fábrica
  tardía: sim 0,08 ms/tick, sync de vistas ~2 ms, audio 0,75 ms, UI 0,4 ms.
- A esos FPS una partida humana de 50–70 min es imposible aquí. El pacing se valida con el bot headless
  (sim real + coste humano de construcción modelado) — ver `docs/PLAYTEST_V1.md`.
- La QA de navegador usó andamiaje (posicionar al jugador, encontrar las últimas agujas por API) solo donde
  andar a 1–2 FPS era impracticable; cavar, vender, desbloquear, Shop, build y cintas fueron con input real.
- Sin salida de audio: la mezcla no se ha escuchado.
- Sin entorno CrazyGames: el SDK real no se ha ejecutado (en el contenedor el script del SDK está bloqueado
  por el proxy, lo que de paso verifica el fallback silencioso).

## Siguiente acción (fuera de este entorno)

1. `docs/RELEASE_CHECKLIST.md` B1: FPS real en Chrome/Edge (portátil iGPU + Chromebook 4 GB), High/Medium/Low,
   save tardío.
2. B2: QA de audio con auriculares y altavoces (12 comprobaciones).
3. B3: playtest humano completo desde save vacío rellenando la hoja de `docs/PLAYTEST_V1.md`.
4. C: subir `dist/` al Developer Portal de CrazyGames y pasar las 13 comprobaciones del SDK/QA tool.

## Incidencias

- 2026-09-26 10:44 — límite de sesión en la Fase 1: 8 de 9 agentes interrumpidos. Reanudado 14:45.
- 2026-09-26 (integración) — logística, energía, 3 máquinas, 7 módulos de render, motor de audio y modelos
  estaban sin terminar; completados e integrados. Ver `BUGS.md` B001–B018.
