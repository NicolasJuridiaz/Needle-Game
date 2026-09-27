# IMPLEMENTATION STATUS — Project Needle V1

Estados: NOT STARTED · IN PROGRESS · IMPLEMENTED · QA PASS · BLOCKED
**QA PASS = ejecutado y comprobado por el lead** (tests, sim headless y/o navegador). IMPLEMENTED ≠ QA PASS.

Última actualización: 2026-09-27 (iteración visual 1: venta manual por cinta SELL HAY, Store junto a la cinta, pajar low-poly, manos nuevas — docs/VISUAL_ITERATION_1.md; antes P0.1: analytics OPT-IN con consentimiento explícito, auditoría Data Module / Basic Launch; RC2 sin cambios de balance).

**Veredicto: RELEASE CANDIDATE — REQUIRES REAL-HARDWARE QA.** Lo pendiente está en `docs/RELEASE_CHECKLIST.md` (B y C).
**P0.1 Basic Launch: BLOCKED — OWNER ACTION REQUIRED** para lanzar CON ByteBrew (decisión sobre menores 13-15 frente a
la política de ByteBrew "under 16", política de privacidad publicada, claves). Sin ByteBrew (`VITE_ANALYTICS_ENABLED=false`)
el código está listo y solo falta QA manual (playtest, FPS real, Preview). Ver `docs/ANALYTICS_PRIVACY_NOTES.md` §5-6,
`docs/ANALYTICS_SETUP.md` §7, `docs/CRAZYGAMES.md` "Data Module".

## Verificación global (ejecutada por el lead)

| Check | Resultado |
|---|---|
| `npm run typecheck` | PASS (0 errores) |
| `npm test` | PASS — 443/443 (23 ficheros; visual 1 +8 intake; P0 +27, P0.1 +13: consentimiento unknown/granted/denied, retirada, reactivación, configuración ausente) |
| `npm run build` | PASS — `dist/` 1,32 MB, 5 ficheros (JS 1,18 MB / 339 KB gzip + chunk ByteBrew 25,7 KB / 9,3 KB gzip, pedido solo tras el consentimiento), rutas relativas |
| `npm run balance:many -- --seeds 50` (pajar 750k) | 50/50 completan · P10 59,4 · mediana 64,7 · P90 68,9 · máx. 80,3 min · Vacuum Collector y Scanner MK2 usados en 100 % · 49/50 sin tramo > 4 min (1 en 4:18) |
| Test de tamaño de pajar (50 semillas c/u) | 500k mediana 55,6 (Collector 58 %) · 650k mediana 61,9 · 750k mediana 64,7 → 750k elegido (docs/PLAYTEST_V1.md §2) |
| Auditoría Work Tree | 39 nodos · 39 alcanzables · 119 niveles probados · 0 muertos · 0 no-op · 0 descripciones incorrectas |
| Auditoría Level System | 18 tecnologías Lv.1→Lv.5 (sin Lv.6), stats cambian, máquinas existentes y nuevas siguen el nivel, save/load; Hay Sell Value Lv.1→10 |
| Auditoría upgrades de máquinas | 13 familias, cada nivel con valor esperado y antes/después en sim |
| Economía / softlock / save fuzz / completion | PASS; auditoría de economía con TODO el árbol al máximo (Hay Sell Value Lv.10 incluido) |
| Migración de saves RC1 → RC2 | PASS con un save tardío real de RC1 (151 edificios): carga, conserva fábrica/dinero/pajar, re-guarda v2 idéntico; probado también en el build de producción |
| Build de producción (`npm run preview`, Chromium headless) | Work Tree con niveles (compra Lv.2/Lv.3 por clic, WP + $), detalle Now→Next, tooltip de máquina "Level Lv. x / 5", save RC1 migrado |

## Sistemas

| Sistema | Estado | QA | Observaciones |
|---|---|---|---|
| Arquitectura / contratos / config de balance | IMPLEMENTED | QA PASS | RC2: 39 nodos / 119 niveles (224 WP + $1,04M), 23 orders, 23 milestones, 6 agujas; una partida da como máximo 163 WP (D13) |
| Level System Lv.1→Lv.5 (RC2) | IMPLEMENTED | QA PASS (tests + build) | Global por tecnología; WP + Money por nivel; requisitos por nivel; UI de Work Tree/tooltip/Shop; kit visual Lv.3 y modelos Lv.5 |
| Hay Sell Value Lv.1→Lv.10 (RC2) | IMPLEMENTED | QA PASS (tests) | ×1,00→×2,65 sobre todos los productos; 2,5×–4× el precio de un upgrade del mismo tier |
| Save v2 + migración RC1 (RC2) | IMPLEMENTED | QA PASS | Tabla RC1_TO_RC2 (src/sim/save.ts) |
| Hay field (pajar, relajación, agujas, detector, tossBack, save) | IMPLEMENTED | QA PASS | 16 tests; distribución de agujas verificada en 30 semillas (cada una en su banda) |
| Logística (belts, curvas, side-loading de máquinas, splitters 5 modos, mergers, U, lift, rampa, planner) | IMPLEMENTED | QA PASS | throughput exacto en todos los niveles de cinta (B022); planner de 2 clics probado en build de producción |
| Máquinas (hopper, rake, brazo, collector, scanners, compressor, wrapper, silo, generador) | IMPLEMENTED | QA PASS | 13 tests + integración; animación del brazo verificada en navegador |
| Red eléctrica (polos, generadores, sobrecarga progresiva) | IMPLEMENTED | QA PASS | tests de sobrecarga/noPower/alcance; HUD de potencia visto en navegador |
| Progresión (money, WP, Work Tree, shop, orders, milestones, buffs) | IMPLEMENTED | QA PASS | 34 tests; DAG de orders corregido (B012) |
| Upgrades (efecto real de cada nivel) | IMPLEMENTED | QA PASS | `tests/upgrades.test.ts`: cada nivel cambia algo; 16 familias con ≥2 niveles; 7 upgrades medidos en sim |
| Acciones del jugador (herramientas, detector, carretilla) | IMPLEMENTED | QA PASS | 21 tests; cavar/vender probado en navegador |
| Render (almacén, pajar, belts, items, ghost, cables, partículas, FX, agujas) | IMPLEMENTED | QA PASS (funcional) | Calidad High/Medium/Low diferenciada, tope de DPR, AutoQuality, mensaje sin WebGL. Save tardío RC2 (193 edificios): draw calls 29 / 129 / 130, triángulos 206k / 457k / 561k (malla del pajar idéntica a RC1: 29k). FPS en GPU real NO medido |
| Modelos 3D + viewmodels | IMPLEMENTED | QA PASS (visual) | Todos los tipos tienen modelo; galería renderiza 48 entradas |
| UI (HUD, Work Tree, Shop, Orders, pausa, resumen, needle found, build HUD, tooltips) | IMPLEMENTED | QA PASS (funcional) | B015/B016 corregidos; B018 abierto (P3) |
| Audio procedural + música | IMPLEMENTED | PARCIAL | Motor arranca (`AudioContext` running, 10 loops renderizados, música). Volumen/mezcla NO escuchados por un humano |
| Plataforma CrazyGames / guardado / analytics | IMPLEMENTED | QA PASS (standalone) | Progreso 0 → n×100/6 → 100; SDK bloqueado/ausente/rechazado no bloquea ni ensucia la consola (47 tests); almacenamiento SDK → localStorage → memoria. SDK real no ejecutado (sin entorno CrazyGames) |
| Game loop, controlador FPS, interacción, build mode, hints | IMPLEMENTED | QA PASS | Paso fijo 20 Hz; independencia de refresco probada (60/120/144/165 Hz) |
| Bot de balance headless | IMPLEMENTED | QA PASS | Construye la fábrica real completa (RC2: 3 líneas independientes al Market Chute, escáner por línea, niveles con reserva de dinero, `--pile`); log de decisiones, huecos > 4 min, métricas de escala; payback (`tools/balance/payback.ts`) |
| Consentimiento analytics opt-in (P0.1) | IMPLEMENTED | QA PASS (tests + Chromium con red interceptada) | unknown/denied: 0 peticiones, 0 cookies `bb_*`, chunk no pedido; Allow → init + solo eventos nuevos; retirada → `stopTracking` (cookies `bb_u_id`/`bb_u_h_init` quedan, hecho del SDK); reactivación tras recarga OK; 1280×720 y 907×510 |
| Analytics remota (ByteBrew) + telemetría P0 | IMPLEMENTED | QA PASS (tests + Chromium con red interceptada) | `AnalyticsService` / adapter ByteBrew / catálogo de eventos / dedupe por run en el save / opt-out; SDK real ejercitado en Chromium (init con cabecera `session_key`, cola vaciada en orden, `?analytics=0` = 0 peticiones). Dashboard de ByteBrew NO verificado (sin claves reales) |
| Welcome Back | IMPLEMENTED | QA PASS (tests + navegador) | Tarjeta de solo lectura en la pantalla click-to-play tras ≥ 20 min fuera; probada con el save real de RC1 a 907×510 |
| Save envelope v2 (`meta.telemetry`) | IMPLEMENTED | QA PASS | Formato de sim sin cambios (v2); envelopes v1 (RC1/RC2) cargan y se rellenan sin enviar eventos |
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

0. P0 Basic Launch: acciones manuales de `docs/ANALYTICS_SETUP.md` §11 (proyecto ByteBrew, claves, política de
   privacidad, invitar `bytebrew@crazygames.com`), playtest a ciegas (`docs/HUMAN_PLAYTEST_V1.md`) y FPS real
   (`docs/REAL_HARDWARE_QA.md`).

1. `docs/RELEASE_CHECKLIST.md` B1: FPS real en Chrome/Edge (portátil iGPU + Chromebook 4 GB), High/Medium/Low,
   save tardío.
2. B2: QA de audio con auriculares y altavoces (12 comprobaciones).
3. B3: playtest humano completo desde save vacío rellenando la hoja de `docs/PLAYTEST_V1.md`. En RC2 vigilar
   especialmente: si la partida con 750k queda en 55–70 min para un humano, si el tramo 30–50 min se hace
   largo, si el sistema Lv.x/5 (WP + $) se entiende y si Hay Sell Value se percibe como decisión.
4. C: subir `dist/` al Developer Portal de CrazyGames y pasar las 13 comprobaciones del SDK/QA tool.

## Incidencias

- 2026-09-26 10:44 — límite de sesión en la Fase 1: 8 de 9 agentes interrumpidos. Reanudado 14:45.
- 2026-09-26 (integración) — logística, energía, 3 máquinas, 7 módulos de render, motor de audio y modelos
  estaban sin terminar; completados e integrados. Ver `BUGS.md` B001–B018.
