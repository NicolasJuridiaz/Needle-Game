# Project Needle — Retención, monetización y meta-progresión (investigación V1)

Fecha de la investigación: **27-09-2026**. Build de referencia: commit `00b7206` (RC2).

**Etiquetas usadas en todo el documento**

| Etiqueta | Significado |
|---|---|
| **[OFICIAL]** | Leído hoy en la documentación o los términos oficiales de la plataforma (enlace en §Fuentes) |
| **[EXTERNO]** | Evidencia de terceros (informe, ficha de tienda, foro) |
| **[BENCHMARK]** | Dato agregado de mercado; otra población distinta de Needle |
| **[INFERENCIA]** | Deducción mía a partir de lo anterior o de los datos del juego |
| **[RECOMENDACIÓN]** | Lo que haría |
| **[DATO NEEDLE]** | Medido en este repo (bot de balance, código) |
| **NO VERIFICADO / NO PÚBLICO** | No encontrado en una fuente fiable; no te fíes de ninguna cifra |

---

## 0. Veredicto en 10 líneas

1. **Todavía no construyas una máquina de retención.** Poki lo dice explícitamente: en web la primera sesión pesa más, los loops de ~3 min funcionan mejor y **"about an hour of content is usually the right scope"** [OFICIAL, Poki Engagement]. Needle (mediana de 64,7 min) ya tiene el tamaño adecuado. El riesgo no es que falte meta, sino que la gente se vaya en el minuto 3.
2. **La mayor palanca de D1 de Needle es la partida sin terminar**, no un login reward. Una run de 65 min casi nunca se juega de una sentada, así que volver al día siguiente para terminar la fábrica **es** tu D1. Eso exige un guardado impecable y una bienvenida de vuelta muy buena, no rachas [INFERENCIA].
3. **Tu analítica hoy no sale del navegador.** `src/platform/analytics.ts` solo escribe en un buffer local (`window.__pnAnalytics`) [DATO NEEDLE]. Si publicas así, solo verás las 3–4 métricas del dashboard de CrazyGames y no sabrás **dónde** abandona la gente. Esto es P0.
4. **Hoy el juego no tiene ningún punto natural de pausa para un midgame.** Al encontrar una aguja sale una tarjeta, pero la partida sigue [DATO NEEDLE]. Sin eso no hay monetización limpia en CrazyGames. La solución barata es convertir la tarjeta de aguja en un punto de parada.
5. **Poki no es viable ahora mismo.** Exige soporte para escritorio, móvil y tablet como *hard requirement* [OFICIAL], y Needle muestra un aviso de "solo escritorio" en dispositivos táctiles [DATO NEEDLE]. Además, Poki quiere exclusividad web (5 años por defecto, indicativo) [OFICIAL]. **Recomendación: CrazyGames primero.**
6. **Las cifras de "certeza 93–96 %" del borrador que pegaste son precisión inventada.** No hay datos para ello. Las he eliminado.
7. **Una segunda moneda de prestigio ("Insight") va contra la guía oficial de Poki** ("one understandable currency… no secondary currencies (web players dislike them)") [OFICIAL]. Mi Rebirth V1 no tiene moneda: usa la colección de agujas (Needle Codex) como meta.
8. **La leaderboard de CrazyGames es solo por invitación, una por juego y con temporada semanal** (lunes 09:00 UTC) [OFICIAL]. Un "Daily Challenge con ranking diario" **no encaja** con esa API. Encaja un **Weekly Contract**.
9. **No hay A/B testing posible en Basic Launch.** Termina a los ≥7 días y ≥500 partidas [OFICIAL]; con 500 jugadores no se detecta nada. Los experimentos van después del Full Launch.
10. **Conjunto mínimo antes de publicar:** analítica remota + bienvenida de vuelta + AdService con tarjeta de aguja como pausa + 2 rewarded bien diseñados (P1, cuando llegue el Full Launch). Todo lo demás espera a los datos.

---

## 1. Contexto del juego (lo que ya existe)

[DATO NEEDLE] RC2, pila de 750k, 50 semillas: completado 50/50; min 55,3 / P10 59,4 / **mediana 64,7** / P90 68,9 / max 80,3 min. Unos 195 edificios, 18 brazos, 6 collectors, 3 scanners, 145 cintas. Tecnologías Lv1–5 y Hay Sell Value Lv1–10. El árbol queda comprado en un ~63 % de niveles y un ~68 % de WP.

**Tiempos reales de una run** (bot, semilla 1000, `npm run balance -- --seed 1000 --decisions`), que determinan la estrategia de anuncios:

| Aguja | Tiempo | Pila retirada |
|---|---|---|
| #1 (Strength) | 14:15 | 0,7 % |
| #2 (Momentum) | 16:42 | 0,8 % |
| #3 (Industry) | 35:24 | 10,7 % |
| #4 (Thrift) | 50:44 | 35,0 % |
| #5 (Fortune) | 57:57 | 60,2 % |
| #6 (Claw) → fin | 59:45 | 68,1 % |

Se completaron 22 de 24 pedidos. Recompensas en dinero de pedidos ≈ $153k de $1,31M ganados (≈ 12 %).

**Plataforma ya integrada** [DATO NEEDLE]: `gameplayStart/Stop` en los cambios de modo, `happytime`, `reportGameCompletedPercentage`, `muteAudio` del SDK, Data module con respaldo en localStorage/memoria, `setGameContext`. **No hay anuncios ni sink de analítica remoto.** El guardado tardío de RC1 pesa ~96 KB, muy lejos del límite de 1 MB.

---

## 2. Objetivo principal: cómo convertir una partida de ~60 min en un juego al que se vuelve

| Horizonte | Qué lo mueve en Needle | Sistema mínimo |
|---|---|---|
| **Primera sesión** | Minutos 0–10: primera venta, primer upgrade, primer pedido, primera máquina. CrazyGames mide la conversión a ≥1 min de juego [OFICIAL]; Poki mide C2P hasta el primer `gameplayStart()` [OFICIAL] | Ninguno nuevo. Pulir el onboarding con datos del embudo |
| **D1** | La fábrica a medias. Con una mediana de 65 min, la mayoría de jugadores reales **no** terminan en una sesión [INFERENCIA] | Guardado fiable (Data module), pantalla "Welcome back" y offline limitado |
| **D3 / D7** | Quien termina la run no tiene nada que hacer | Resumen final más rico; **luego** New Farm (Rebirth) si los datos muestran que quieren repetir |
| **D30** | Solo con contenido recurrente (Weekly Contract) o colección | Weekly Contract + Codex, **no** antes de validar D7 |
| **Rejugabilidad** | Semilla nueva = agujas nuevas y otro layout. Ya existe en el motor | New Farm con semilla nueva y una modificación |
| **Competición** | Tiempo de la run o contrato con semilla fija | Leaderboard semanal de CrazyGames (si te invitan) |
| **Monetización** | Midgames en pausas naturales y 2 rewarded útiles | AdService + tarjeta de aguja + pedidos ×2 + pista de aguja |

Prioridad aplicada: **diversión → retención → monetización**. Ningún sistema de esta lista bloquea el core ni castiga no ver anuncios.

---

## 3. CrazyGames (verificado hoy)

| Tema | Qué dice | Tipo |
|---|---|---|
| **Lanzamiento en dos fases** | Basic Launch con audiencia limitada 7–21 días, monetización desactivada. Termina con ≥7 días **y** ≥500 partidas, o a los 21 días. El paso a Full Launch depende de playtime medio, conversión y retención comparados con otros juegos | [OFICIAL] Docs intro y Basic Launch Guide |
| **Referencias de Basic Launch** | "Successful titles often see **10+ minutes**" de playtime medio; "Strong games often achieve **10–15 %** Day 1 Retention"; los mejores convierten "**80 %+**", cargan en <10 s y pesan <20 MB | [OFICIAL] Son orientaciones, no umbrales |
| **Sugerencias de retención** | La propia guía propone "simple login bonuses or daily quests" y "Save player progress" | [OFICIAL] Discrepo en parte con lo primero (§10) |
| **SDK v3 init** | `await window.CrazyGames.SDK.init()` antes de usar módulos | [OFICIAL] Data |
| **Vídeo** | `SDK.ad.requestAd("midgame" \| "rewarded", { adStarted, adFinished, adError })` | [OFICIAL] Video ads |
| **Códigos de error** | `adsDisabledBasicLaunch`, `unfilled`, `adblock`, `adCooldown` ("usual midgame ad request interval is 3 minutes, taking rewarded and preroll ads into consideration"), `other` | [OFICIAL] |
| **Frecuencia** | "midroll frequency (max 1 every 3 minutes)". La plataforma la gestiona; las peticiones demasiado pronto se ignoran sin impacto | [OFICIAL] Ads requirements |
| **Reglas de midgame** | No interrumpir el gameplay; en momentos lógicos (cambio de nivel, muerte). **No en botones de navegación** (menú, ajustes, tienda). Pausar e impedir la interacción hasta `adFinished`/`adError`. Silenciar **solo** cuando el anuncio empieza. Seguir jugando si `adError` | [OFICIAL] |
| **Reglas de rewarded** | Botón en una ubicación consistente; **no en una pantalla de gameplay activo**; no ofrecer demasiado a menudo (timer o botón oculto); no encadenar anuncios; la opción de no ver el anuncio con el mismo tamaño, fuente y color; icono de vídeo; ofrecer una alternativa (p. ej. comprar con monedas); no dar recompensa en `adError`; no combinar midgame y "rewarded para seguir" en la misma transición | [OFICIAL] |
| **Banners** | Solo en pantallas útiles abiertas ≥5 s de media, nunca en gameplay, máximo 2 | [OFICIAL] |
| **Adblock** | El juego debe ser jugable; se pueden bloquear funciones extra con aviso; **no usar popups**; no dejar rewarded clicables sin efecto | [OFICIAL] |
| **gameplayStart/Stop** | Start al jugar o reanudar; Stop en cada pausa o menú; no en cambios de foco | [OFICIAL] Game module |
| **loadingStart/Stop** | Existen para medir la carga | [OFICIAL] |
| **happytime** | Para logros especiales, "sparingly" | [OFICIAL] |
| **reportGameCompletedPercentage** | Valor 0–100. Si añades contenido, reporta el % correcto al cargar | [OFICIAL] |
| **muteAudio** | Obligatorio en Full Implementation (HTML5); tiene prioridad sobre tu toggle | [OFICIAL] |
| **Data module** | API de localStorage; invitado → localStorage; login → sincronizado. **1 MB** (JSON en texto). Debounce de 1 s (hasta 30 s). Activar "Progress Save" en el envío. "fully rely on the Data Module… avoid relying on local saves" | [OFICIAL] |
| **Cuentas** | +35 M cuentas. Sin login externo. Guardado vinculado a la cuenta de CrazyGames en Full. Botón de login permitido pero no como CTA principal; no abrir el auth prompt automáticamente | [OFICIAL] |
| **Leaderboards** | **Solo juegos invitados. Una por juego.** Temporadas semanales lunes→lunes, reset a las 09:00 UTC. Global/país/amigos. Trofeos top 1/2/3 y 1/5/10 %. Métricas `XP \| KDA \| POINTS \| MINUTES`, ASC/DESC, incremental o no, min/max, cooldown. Cliente: "scores can be manipulated"; servidor: API | [OFICIAL] |
| **Envío desde cliente** | AES-GCM con una encryption key de 32 bytes; `SDK.user.submitScore({ encryptedScore, score })`; el servidor siempre responde OK | [OFICIAL]. **La clave va dentro del bundle** → es ofuscación, no seguridad [INFERENCIA] |
| **Social** | Invites, room data, `inviteLink`: pensados para multijugador por salas. Invite button **deprecated** | [OFICIAL] |
| **Rechazo en QA** | Bugs, sin inglés, clones, contenido inadecuado, no PEGI-12, dirigido a niños, incumplir los requisitos | [OFICIAL] FAQ |
| **Técnico** | Descarga inicial ≤50 MB, total ≤250 MB, ≤1500 archivos. Aterrizar en gameplay (máx. 1 clic). Sin botón propio de fullscreen. Sin cross-promo. Física estable a 144/165 Hz | [OFICIAL] |
| **IAP** | Solo por invitación (Xsolla) | [OFICIAL] |
| **Revenue share** | Los términos (versión 18-08-2025, §5.4) calculan la compensación mensualmente según popularidad y rendimiento de los anuncios. **No publican ningún porcentaje** | **NO PÚBLICO** |
| **Exclusividad** | **+50 % de compensación** si optas por exclusividad web durante 2 meses tras el Full Launch y el juego está alojado en CrazyGames. Steam y las tiendas de apps no cuentan como web | [OFICIAL] Términos §5.4 |
| **Pagos** | Mensual, mínimo €100, factura a 30 días | [OFICIAL] Términos §5.6 y FAQ |
| **Analítica** | Dashboard: jugadores, playtime medio, conversión, retención, ingresos. Recomiendan **ByteBrew** (gratis) para embudos | [OFICIAL] |
| **eCPM / fill rate** | — | **NO PÚBLICO** |

**Correcciones al borrador:**
- "Máximo técnico de 1 cada 3 min" es correcto, pero es un **techo**, no un objetivo.
- Poner midgames en "transiciones de tier" no se puede hacer hoy, porque Needle no tiene transiciones de tier que pausen el juego.
- "Invite button solo multijugador" es correcto (y además está deprecated).

---

## 4. Poki (verificado hoy)

| Tema | Qué dice | Tipo |
|---|---|---|
| Init | `PokiSDK.init()` (cargar el juego aunque falle) → `PokiSDK.gameLoadingFinished()` | [OFICIAL] HTML5 guide |
| gameplayStart/Stop | Start **en el primer input** del jugador (no al cargar), nunca dos seguidos | [OFICIAL] Requirements |
| commercialBreak | En paradas naturales; "we recommend calling `commercialBreak()` before every `gameplayStart()`". QA: "must fire **only when exiting a pause and heading back into gameplay**" (cerrar pausa = ✅; ir a selección de nivel = ❌). No todas las llamadas muestran anuncio | [OFICIAL] |
| rewardedBreak | Solo por elección explícita; `then(success)`; sin recompensa si falla; **resetea el temporizador** de commercial | [OFICIAL] |
| Temporizadores | "do not implement internal ad timers", "Don't add internal cooldowns or timers to force ad frequency" | [OFICIAL] |
| UI de rewarded | Siempre un botón normal alternativo, mostrado a la vez; del **mismo tamaño o mayor**; al lado o encima; rewarded **nunca verde**; icono 🎬; nunca varios vídeos por recompensa | [OFICIAL] |
| Límites de rewarded | "Unlimited rewarded videos are allowed, but set limits that protect your balance" | [OFICIAL] Monetization tips |
| Adblock | Jugable, **sin mensajes propios** (Poki los gestiona); sin recompensa | [OFICIAL] (≠ CrazyGames, que permite un aviso) |
| Economía | "one understandable currency… **no secondary currencies**" | [OFICIAL] |
| Monetización | Solo anuncios de Poki; **no IAP**; sin botón "quitar anuncios" | [OFICIAL] |
| Cuentas | `login()`, `getUser()`, `getToken()` (JWT de 1 min, verificación en servidor) | [OFICIAL] |
| Guardado en la nube | Automático si el usuario inicia sesión: sincroniza **localStorage e IndexedDB**. Prefijo `poki_ignore` para excluir datos. **1 MB tras gzip** | [OFICIAL] |
| Compartir | `PokiSDK.shareableURL(params)` → parámetros `gd*`; `PokiSDK.getURLParam()` | [OFICIAL] |
| Backend | AUDS (prototipo, solo juegos publicados): datos de usuario compartibles; menciona leaderboards como caso de uso | [OFICIAL] |
| **Hard requirements** | **Soporte de escritorio, móvil y tablet**; 16:9; incógnito; **sin peticiones externas por defecto**; sin anuncios externos; sin bloqueo de adblock | [OFICIAL] |
| Tests | Player fit test → **Web fit test** con ~10.000 jugadores durante 3–5 días. Mide CTR, tiempo en página y C2P, cada uno puntuado 0–5 frente a la media de la categoría | [OFICIAL] |
| Revenue share | 100 % de los usuarios que llegan directamente; **50/50** de los que trae Poki | [OFICIAL] "Working with Poki". La página de deal types avisa: "indicative… set out in your agreement" |
| Exclusividad | Web exclusivo preferido, **5 años por defecto** (indicativo). Si el juego ya está en otros portales: licencia fija única, **sin revenue share** | [OFICIAL] |
| Evento `measure` | Aparece en la integración de GDevelop ("Measure event") | **NO VERIFICADO** para el SDK HTML5 |

**Consecuencia estratégica** [INFERENCIA]: publicar en CrazyGames implica que, si luego vas a Poki, solo te ofrecerán un acuerdo no exclusivo de tarifa fija. Aun así, hoy Poki te rechazaría por no soportar móvil y tablet. **CrazyGames primero** es la única ruta realista. Dado eso, **activar la exclusividad de 2 meses (+50 %) no te cuesta nada** [RECOMENDACIÓN].

### Comparativa y abstracción

| Sistema | CrazyGames | Poki | Abstracción recomendada |
|---|---|---|---|
| Init | `SDK.init()` | `PokiSDK.init()` + `gameLoadingFinished()` | `platform.init()` + `platform.loadingDone()` |
| Gameplay | `game.gameplayStart/Stop` (ya integrado) | `gameplayStart` en el primer input; sin duplicados | `platform.setGameplay(bool)` con deduplicación |
| Midgame | `requestAd('midgame')`; no en navegación | `commercialBreak()` solo al volver al juego | `ads.breakOpportunity(ctx)`; cada adapter decide si `ctx` es válido |
| Rewarded | `requestAd('rewarded')` + timer de oferta permitido | `rewardedBreak()`, resetea el timer | `ads.rewarded(placement) → Promise<boolean>` |
| Frecuencia | Plataforma, máx. 1/3 min | Plataforma; prohibidos los timers internos | **Nunca** timers de midgame en el juego; solo límites de oferta de rewarded por balance |
| Adblock | Aviso permitido (sin popup) | Sin mensaje | `ads.canOfferRewarded()`; aviso solo si `caps.adblockNotice` |
| Guardado | Data module, 1 MB sin comprimir | localStorage/IDB automático, 1 MB gzip | `SaveService` sobre el `KeyValueBackend` actual |
| Usuario | `user.getUser()`, auth prompt | `getUser()`, `login()` | `user.current()` (opcional, solo nombre y avatar) |
| Leaderboard | Invitación, 1, semanal | No hay nativa (AUDS prototipo) | `LeaderboardPort` opcional; Local = best local |
| Compartir | `inviteLink` (multijugador) | `shareableURL` | `share.link(params)`; en CrazyGames, copiar texto |
| Progreso | `reportGameCompletedPercentage` | — | `platform.reportProgress(p)` (ya existe `ProgressSink`) |
| Celebración | `happytime()` | `happyTime(v)` en la integración de Defold; HTML5 **NO VERIFICADO** | `platform.celebrate()` |
| Analítica | Dashboard + ByteBrew | Dashboard; externas bloqueadas | `AnalyticsService` con sinks por plataforma |

---

## 5. Estrategia exacta de anuncios

**Principio:** una pausa solo existe si el juego ya se detendría ahí por diseño. Hoy no existe ninguna, así que se crea **una**: la tarjeta de aguja pasa a ser un momento de parada, como un "nivel completado". Sale `gameplayStop()`, la tarjeta muestra el buff y el Codex, el jugador pulsa **Continue** → oportunidad de midgame → `gameplayStart()`. Es el análogo de "level transition" de CrazyGames [INFERENCIA; confirmar en el QA tool].

| Momento | Tipo | Trigger | Cooldown | Frecuencia máx. | Recompensa | ¿Rechazable? | Impacto esperado | Riesgo UX | Prioridad |
|---|---|---|---|---|---|---|---|---|---|
| Continuar tras aguja #1–#5 | Midgame | Clic en Continue de la tarjeta | El de la plataforma (3 min en CrazyGames) | 5/run | — | No (es un midgame) | Monetización principal | Bajo: la pausa es celebratoria y ya existe | P1 |
| Resumen final → "Keep playing" / "New Farm" | Midgame | Clic para salir del resumen | Plataforma | 1/run | — | No | Bajo volumen | Bajo | P1 |
| Pausa → reanudar | Midgame | Solo Poki (`commercialBreak` al salir de pausa) | Plataforma | Plataforma | — | No | — | Medio; en CrazyGames **prohibido** (botón de navegación) | Solo en el adapter de Poki |
| Pedido completado ×2 | Rewarded | Botón "🎬 Claim ×2" junto a "Claim" en el panel de Orders | 1 oferta cada 4 min (límite de balance) | ~8/run | ×2 **dinero** del pedido (no WP) | Sí, "Claim" del mismo tamaño | Medio | Bajo | P1 |
| Pista de aguja (Needle Sense) | Rewarded | ≥8 min sin encontrar aguja; en el panel de Orders | Una por aguja | ≤6/run | Pulso de 60 s con la dirección de la aguja más cercana | Sí; alternativa: comprarla por 3 min de ingresos | Retención del tail | Medio: puede trivializar la búsqueda (limitado) | P1 |
| Vuelta tras ausencia ×2 | Rewarded | Pantalla Welcome back | 1 por regreso | 1/sesión | ×2 del dinero offline | Sí | Bajo-medio | Bajo | P2 |
| Carga / minuto 0 | — | — | — | — | — | — | — | Preroll gestionado por la plataforma | **No hacer nada** |
| Banner | — | — | — | — | — | — | — | Needle no tiene pantallas estáticas útiles ≥5 s salvo el resumen | **No en V1** |

**Oportunidades por run (60–70 min):**
- Con los tiempos de la semilla 1000: 5 tarjetas de aguja + 1 resumen = **6 peticiones de midgame**. La #2 (2,5 min después de la #1) y la #6/resumen (1,8 min después de la #5) caen dentro del cooldown de 3 min y CrazyGames las ignora. Quedan **~4 midgames mostrados** (antes de fill y adblock, que son **NO PÚBLICO**).
- Primer midgame hacia el minuto 14; el primero en el que el jugador ya ha jugado razonablemente [OFICIAL: "should not appear before the user has experienced a reasonable amount of gameplay"].
- Hueco sin anuncios entre el minuto 17 y el 35 [DATO NEEDLE]. **No lo rellenes** con pausas artificiales.
- Rewarded: 0–10 por run según lo que quiera el jugador.

La frecuencia es baja a propósito: ~4 midgames/h frente al techo de 20/h. Subirla exige más pausas naturales, no trucos.

---

## 6. Rewarded ads: evaluación

| Opción | Diversión | Encaja con las reglas | Riesgo de balance | Veredicto |
|---|---|---|---|---|
| **Pedido ×2 (dinero)** | Alta: momento de recompensa y ejemplo "end-of-mission multiplier" de CrazyGames [OFICIAL] | Sí (panel de menú, alternativa "Claim") | Bajo: los pedidos son ~12 % del dinero; ×2 en ~8 pedidos ≈ +6–8 % de dinero [INFERENCIA] | **V1** |
| **Needle Sense** (helping hand) | Alta para quien está atascado; resuelve el tail medido (aguja #2 tardía en 3/50 semillas) | Sí, si se ofrece en un panel y no en el HUD de juego | Medio: acotar a 1/aguja y ≥8 min | **V1** |
| Overclock +25 % 5 min (propuesta del borrador) | Baja: botón estático e invisible en una fábrica espacial | Sí | Bajo | **No en V1**. Poki recomienda momentos dinámicos antes que botones estáticos [OFICIAL] |
| Dinero instantáneo (X min de ingresos) | Media | Sí | Medio (rompe el pacing medido) | No |
| Offline ×2 | Media | Sí | Bajo si el offline está acotado | P2, con offline |
| Cosmético | Baja-media | Sí (Poki: "customization") | Nulo | P3; los cosméticos se ganan con logros |
| WP extra | — | — | **Alto**: el WP es el recurso escaso (163 obtenibles de 224) | **Nunca** |
| Revivir / saltar aguja | — | — | Destruye el core | **Nunca** |

**Valores iniciales para A/B** (después del Full Launch):
- Pedido: ×2 frente a ×1,5 con oferta cada 2 min.
- Needle Sense: umbral de 8 frente a 12 min; pulso de 60 frente a 30 s.
- Guardrails: tiempo de run (±10 %), % de runs completadas y ratio de clics en rewarded.

---

## 7. Rebirth / Prestige

**Crítica:** un prestige con moneda y árbol propio es el reflejo móvil que Poki desaconseja [OFICIAL]. Además, Needle es un juego **de descubrimiento**: lo divertido se agota cuando conoces el layout. La rejugabilidad debe venir de la **variación de la búsqueda**, no de hacer lo mismo un 30 % más rápido.

**Rebirth V1 = "New Farm"** [RECOMENDACIÓN]
- **Se revela** únicamente en el resumen final de la primera run completada. Antes no se menciona. Única excepción: el Codex muestra huecos "?" desde la aguja #1.
- **Se resetea:** pila (semilla nueva → layout y agujas nuevos), edificios, dinero, WP, niveles de tecnología, pedidos.
- **Permanece:** Needle Codex, logros, cosméticos, mejores tiempos, ajustes y el flag "veterano" (se saltan los 3 primeros pedidos tutoriales).
- **Sin moneda.** La meta es el **Codex**: un pool de 12 agujas (las 6 actuales con buff + 6 nuevas), de las que cada run esconde 6. Hoy los buffs dependen del **orden** en que se encuentran (`NEEDLE_BUFFS[k]`) [DATO NEEDLE]; habría que asociar el buff a cada aguja.
- **Heirloom:** al empezar una New Farm eliges **una** aguja ya descubierta y su buff está activo desde el minuto 0. Una segunda ranura se desbloquea al completar Rebirth 3.

| Run | Qué cambia | Duración objetivo |
|---|---|---|
| Run 1 | Juego actual | 55–70 min [DATO NEEDLE] |
| Run 2 | Semilla nueva, heirloom, se saltan los tutoriales; 6 agujas del pool con buffs distintos → otra estrategia | 45–55 min [INFERENCIA; medir con el bot] |
| Run 3 | + Primera **Contract Clause** opcional (p. ej. "potencia ×0,7", "sin Scanner MK2", "pila 1M") que da un sello en el Codex, no poder | 45–60 min |
| Run 5+ | Codex completo → aguja dorada que solo aparece con ≥2 cláusulas | Libre |

**Alternativas descartadas:**
- Moneda "Insight" + Protocols (borrador): segunda moneda y árbol extra, justo lo que Poki desaconseja.
- Arrancar con niveles comprados: acorta la run sin cambiarla.
- Prestige a mitad de run: no tiene sentido en un juego con final.

**Gate** [RECOMENDACIÓN]: construir New Farm **solo** si en Full Launch se cumplen dos condiciones: ≥15 % de los jugadores que llegan al minuto 10 completan la run, y ≥40 % de quienes la completan responden "Sí" a la encuesta de 1 clic del resumen. Ambos umbrales son míos; no hay benchmark público.

---

## 8. Leaderboards

| Periodo | ¿Encaja? | Motivo |
|---|---|---|
| Diaria | No | La API de CrazyGames es semanal [OFICIAL]; una propia exige un backend |
| **Semanal** | **Sí** | Coincide con la temporada nativa (lunes 09:00 UTC) |
| Mensual / all-time | No | No existen en la API; all-time de "tiempo de run" se satura con tramposos |

| Métrica | Veredicto |
|---|---|
| Tiempo de run completa (MINUTES, ASC) | Mala: solo la envían quienes terminan (~65 min); los heirlooms la hacen injusta |
| Heno total (incremental) | Mala: premia horas y no habilidad; trivial de falsear |
| **Puntuación de Weekly Contract** (POINTS, DESC, no incremental) | **Buena**: semilla fija, 15 min, compara la misma partida |

**Anti-cheat realista solo en cliente** [INFERENCIA]:
- La clave de cifrado viaja en el bundle, así que asume que es pública.
- Defensas baratas: `maxAllowedScore` = el techo que alcanza el bot en ese contrato ×1,3; `cooldown` = 600 s; enviar solo una vez por intento terminado; validar en el cliente la coherencia de la simulación (tiempo simulado ≈ ticks); no enviar si hubo cambios de velocidad o debug.
- Como la simulación es determinista y funciona por semilla, la solución real es un servidor que reproduzca un log de inputs (P3).
- Leaderboard V1 = **ninguna**, hasta que exista Weekly Contract **y** CrazyGames te invite. Mientras tanto, récords personales locales.

---

## 9. Daily Factory Challenge

- **Diaria:** requiere volver cada día (retención) pero no tiene ranking nativo y multiplica el coste de QA de semillas. Coin Factory en Poki tiene "daily and nightly challenges" [EXTERNO: ficha de Poki]. Mini Metro tiene Daily Challenge con leaderboard [EXTERNO: App Store], pero Mini Metro dura 10–20 min por partida, no 65.
- **Recomendación: Weekly Contract.** Mapa pequeño (pila de 60k), semilla fija por semana ISO, 15 min, todo desbloqueado hasta un tier y objetivo "máximo dinero entregado". Reutiliza la simulación, el bot (para calcular techos y validar semillas) y la leaderboard semanal.
- Se desbloquea tras la primera aguja #3 (el jugador ya conoce belts, arms y scanner).
- Coste: modo de juego con temporizador, generación de semilla, pantalla de resultado. Unos 3–5 días [INFERENCIA]. **P2.**

---

## 10. Misiones, login rewards y rachas

- **Misiones diarias o semanales: no en V1.** Los 24 pedidos **ya son** misiones dentro de la run. Misiones fuera de la run en un juego con final generan tareas sin sentido. El Weekly Contract cumple el papel de misión semanal.
- **Login rewards y rachas: no.** CrazyGames los sugiere de forma genérica [OFICIAL]. Discrepo para Needle: tras completar la run no hay nada en qué gastar la recompensa, y la racha es el patrón que más castiga y se acerca al dark pattern.
- Si algún día existen, que sean **perdonadoras**: 7 días acumulativos que nunca se reinician.
- **Sustituto:** pantalla Welcome back con lo que pasó mientras no estabas y tu siguiente objetivo.

---

## 11. Achievements y Needle Codex

**14 logros**, casi ninguno contador [RECOMENDACIÓN]:
- **Primeros:** First Sale; Hands Off (primer pedido sin cavar a mano); First Robotic Arm.
- **Estilo y habilidad:** Lean Line (completar con ≤10 brazos); Detective (encontrar 3 agujas a mano después del minuto 30); Full Chain (un fardo envuelto de la pila a la venta sin intervención); Clean Grid (ninguna máquina parada >60 s en los últimos 10 min).
- **Tiempo:** Under the Hour (<60:00); Speedrunner (<50:00).
- **Colección:** Codex 6/12 y 12/12.
- **Economía:** Hay Baron (Hay Sell Value Lv10); Tinkerer (cualquier tecnología a Lv5).
- **Secreto:** "Needle in a Needlestack".

Cada logro llama a `happytime` como mucho una vez; ya hay un throttle en `crazygames.ts` [DATO NEEDLE].

**Codex:** una ficha por aguja con buff, lore breve, primer hallazgo (fecha y minuto) y si fue a mano o con scanner. Da sentido a New Farm sin moneda. Coste: iconos y texto.

---

## 12. Cosméticos (valor / coste)

| Cosmético | Valor | Coste | Veredicto |
|---|---|---|---|
| Color de cintas (3 paletas) | Alto: son el 75 % de lo que ves | Muy bajo (tinte de material; sin draw calls extra) | P2 |
| Pintura de máquinas (3 esquemas) | Medio | Bajo (uniform de color en los templates) | P2 |
| Banderín sobre la pila | Bajo | Muy bajo | P3 |
| Skins de herramientas en primera persona | Medio | Medio (modelos) | No |

Se desbloquean **con logros**, no con anuncios.

---

## 13. Progreso offline

- **Qué resuelve:** el regreso a mitad de run (el caso de D1), no el post-Rebirth como proponía el borrador.
- **Desbloqueo:** con el primer Robotic Arm colocado (la automatización ya existe en la fantasía del juego).
- **Fórmula:** `dinero = ingreso_medio_5min × 0,25 × min(ausencia, 2 h)`, con **techo** de 10 min de ingreso activo. Sin cambio en la pila, **sin WP y sin agujas**; los niveles no avanzan.
- **Rewarded ×2** una vez por regreso → como mucho equivale a 20 min activos tras 2 h fuera. **Nunca** supera jugar [INFERENCIA]. Con un ingreso de ≈$470/s (media de toda la run en las 50 semillas: $1,84M / 65 min), el techo es ≈ $280k (≈ 15 % del dinero de una run). Al final de la run el ingreso es mayor, y el techo también. **Validar con el bot antes de subirlo.**
- Se calcula de forma pura desde `savedAt`; no hace falta simular.
- **P1** (después de la analítica).

---

## 14. Eventos procedurales

- **Market Rush:** venta ×1,5 durante 60 s, avisado 20 s antes, cada 12–18 min aleatorios. Da un motivo para mirar la cinta de salida.
- **Hay Gust:** se abre un bolsillo de la pila más fácil de extraer.
- **Riesgo:** distraen en un juego de planificación y cambian el pacing medido. **P3**, y solo si el embudo muestra aburrimiento en el tramo de minuto 17 a 35.

---

## 15. Loops de retención

```
SESIÓN (3–15 min)
  cavar/construir → vender → pedido → upgrade Lv → más throughput
        │                                  ▲
        └── aguja encontrada ─→ buff + Codex ─┘  (pausa natural → midgame)

DIARIO (D1–D3)
  run a medias guardada → Welcome back (+offline acotado, 🎬×2 opcional) → terminar la fábrica

SEMANAL (D7)
  Weekly Contract (semilla fija, 15 min) → leaderboard semanal CrazyGames → reset lunes 09:00 UTC

LARGO PLAZO (D30)
  run completada → Codex incompleto → New Farm (heirloom) → Contract Clauses → Codex 12/12

core → recompensas (pedidos, agujas) → meta (Codex/logros) → semanal (Contract)
     → Rebirth (New Farm) → competición (leaderboard) → razón para volver (run a medias / Codex / semana nueva)
```

---

## 16. Qué mostrar y cuándo

| Momento | Mostrar | No mostrar |
|---|---|---|
| **Minuto 0** | El juego. Clic para jugar (máx. 1 clic, [OFICIAL]) | Login, anuncios, Codex, menús |
| **Primera run** | Pedidos; tarjeta de aguja con huecos del Codex a partir de la #1; oferta de Pedido ×2 desde el primer pedido ≥ $2000 (~min 20); Needle Sense solo si hay atasco; logros en toast discreto | Rebirth, contract, leaderboard |
| **Completar** | Resumen: tiempo, récord, estadísticas, logros, Codex; `happytime`; encuesta de 1 clic ("¿Jugarías otra granja con otro layout?"); texto para compartir | Presión para ver anuncios |
| **Después de Rebirth** | Selector de heirloom; Weekly Contract (si existe) | Clauses hasta Run 3 |
| **Día 2+** | Welcome back con dinero offline y el siguiente objetivo; contract de la semana | Rachas y recordatorios insistentes |

---

## 17. Viralidad y competición (bajo coste)

- **Texto para compartir** en el resumen ("Found all 6 needles in 58:12 — Project Needle") copiado al portapapeles. Funciona en cualquier plataforma sin API.
- **Semilla compartible:** en Poki, `shareableURL({ seed })` [OFICIAL]. En CrazyGames, `inviteLink` está pensado para salas multijugador; usarlo para semillas está **NO VERIFICADO**, así que pregúntalo a soporte antes.
- **Foto de fábrica** (captura del canvas con marco y tiempo) para descargar: coste bajo y útil para redes. P3.
- **Competición:** solo el Weekly Contract.

---

## 18. Analítica

**Sink** [RECOMENDACIÓN]: ByteBrew en CrazyGames (partner oficial [OFICIAL]). En Poki, las peticiones externas están bloqueadas por defecto [OFICIAL], así que allí solo el dashboard. Sumar ByteBrew es una **dependencia nueva**: tu CLAUDE.md dice que no se añaden sin decidirlo. **Decisión tuya.**

**Eventos** (los que ya existen están en *cursiva*):
- *`game_loaded {hasSave}`*
- `first_input`
- `tutorial_step {id}`
- *`order_completed {id,t}`*
- *`work_node_unlocked {id,level}`*
- `machine_placed {type,count}` (solo el primero de cada tipo y cada 10)
- *`needle_found {index,by,t,progress}`*
- `run_milestone {min: 5,10,15,20,30,45,60}`
- *`quit_state`* (ya incluye estado al salir)
- *`session_duration`*
- `session_start {n, daysSinceFirst, runMinutes}`
- *`game_completed {minutes}`*
- `summary_survey {answer}`
- `ad_request {kind,ctx}` / `ad_result {kind,ctx,result}`
- `rewarded_offer_shown {placement}` / `rewarded_claimed {placement}`
- `offline_claim {amount,doubled}`
- `achievement {id}`
- `settings_quality {from,to,auto}`
- `perf_sample {fps_p50,fps_p5,quality}` (1/min)
- `error {msg}`

**KPIs:**

| KPI | Referencia | Tipo |
|---|---|---|
| Conversión (≥1 min) | 80 %+ en los mejores títulos de CrazyGames | [OFICIAL] |
| Playtime medio por sesión | 10+ min | [OFICIAL] |
| D1 | 10–15 % en juegos fuertes de CrazyGames | [OFICIAL] |
| D1 PC (otra población) | Mediana ~7 %, P75 12–13 %, P90 21–23 % (2025) | [BENCHMARK] GameAnalytics 2026 |
| D1 móvil (otra población) | Mediana ~22 % | [BENCHMARK]; **no comparable** |
| D3 / D7 / D30 web | — | **NO PÚBLICO** para CrazyGames/Poki |
| Completado de run 1 (de los que llegan al min 10) | Sin referencia; fija tu línea base | [RECOMENDACIÓN] |
| Sesiones hasta completar | Sin referencia | — |
| Midgames por hora de juego y ratio de rewarded | Sin referencia pública | **NO PÚBLICO** |

---

## 19. A/B testing

**No en Basic Launch.** Con ~500 partidas y D1 ~10 %, un brazo de 250 jugadores tiene un IC del 95 % de ±3,7 pp: no detecta nada útil [INFERENCIA estadística]. Tras Full Launch: asignación con hash estable del id local, configuración en el build y override por URL para QA (Poki bloquea la configuración remota externa [OFICIAL]).

| Hipótesis | Variante A | Variante B | KPI principal | Guardrails | Riesgo |
|---|---|---|---|---|---|
| El primer midgame en la aguja #1 no daña la retención | Midgame desde aguja #1 | Desde aguja #3 | D1 | Playtime, % run completada | Pierdes impresiones con B |
| Menos midgames no reducen los ingresos por jugador | Todas las tarjetas | Solo agujas 1, 3, 5 y resumen | Ingreso/DAU | D1, playtime | Ingreso NO PÚBLICO hasta Full |
| El multiplicador de pedidos define la adopción | ×2 cada 4 min | ×1,5 cada 2 min | Rewarded/sesión | Tiempo de run ±10 % | Acelerar el pacing |
| El offline sube D1 | Offline ON (25 %, techo 10 min) | OFF | D1 | Tiempo de run, completado | Saltarse contenido |
| La recompensa de Rebirth cambia la adopción | Heirloom 1 ranura | Heirloom + skip de tutorial | % completadores que inician Run 2 | Duración Run 2 ≥40 min | Run 2 trivial |
| Revelar el Codex pronto sube la intención de Rebirth | Huecos "?" desde aguja #1 | Solo en el resumen | Respuestas "Sí" en la encuesta | D1 | Confusión temprana |
| El contract semanal sube D7 | Contract visible tras aguja #3 | Tras completar la run | D7 | Completado de run 1 | Canibalizar la run |
| La leaderboard sube D7 | Contract + leaderboard | Contract sin leaderboard | D7 | Reportes de trampas | Necesita invitación |
| Un bonus de login no aporta | Sin bonus | Bonus acumulativo 7 días | D3 | Playtime | Dark pattern leve |
| Una Run 2 más corta retiene más | Pila 750k | Pila 600k en Run 2 | % que completan Run 2 | Satisfacción (encuesta) | Sensación de "lo mismo" |

---

## 20. Benchmarks y casos reales

| Caso | HECHO OBSERVADO | INTERPRETACIÓN | APLICACIÓN |
|---|---|---|---|
| Guía de Basic Launch de CrazyGames | 10+ min, D1 10–15 %, conversión 80 %+ [OFICIAL] | La plataforma selecciona por la primera sesión y D1 | Optimizar los minutos 0–10 y el regreso |
| Engagement de Poki | "about an hour of content", loops ~3 min, "first minutes brilliant before tenth hour deep" [OFICIAL] | Needle tiene el alcance correcto | No inflar la meta antes de lanzar |
| Web fit test de Poki | ~10.000 jugadores; CTR, tiempo en página y C2P puntuados 0–5 frente a la categoría [OFICIAL] | La muestra de Poki es 20× la del Basic Launch de CrazyGames | Si algún día hay versión móvil, es el mejor test disponible |
| GameAnalytics 2026 | PC: D1 mediana ~7 %, P75 12–13 %; móvil: mediana ~22 % [BENCHMARK] | Web y PC se juegan en sesiones largas y poco frecuentes | Esperar un D1 bajo; no copiar sistemas móviles |
| Coin Factory (Poki y Steam) | Fábrica incremental de puzle con "daily and nightly challenges" [EXTERNO] | Los retos con semilla funcionan en el género | Weekly Contract con semilla fija |
| Mini Metro | Daily Challenge con ranking mundial diario [EXTERNO] | Partidas cortas y deterministas → ranking justo | Contract corto y no la run de 65 min |
| Gridle (CrazyGames) | Rebirth con "over 190 unique knowledge upgrades" [EXTERNO, ficha replicada por terceros] | Funciona en un RPG idle sin final | **No** transferible a un juego con final y búsqueda |
| Pixel Aquarium Tycoon, Starsmith Idle, Idle Breakout (citados en el borrador) | — | — | **NO VERIFICADO** en esta investigación; no los uses como argumento |
| Retención D3/D7/D30 de juegos concretos de CrazyGames/Poki | — | — | **NO PÚBLICO** |

---

## 21. Arquitectura

La simulación sigue siendo pura (regla de CLAUDE.md). La meta vive en `src/sim/meta.ts` (sin DOM) y los servicios en `src/platform/`. Se reutiliza lo que ya existe: `Platform`, `PlatformStorage`/`KeyValueBackend`, `Analytics` con `sinks` y `ProgressSink`.

```ts
// src/platform/adapter.ts
export interface Capabilities { leaderboard: boolean; share: 'url' | 'text'; adblockNotice: boolean; unpauseBreak: boolean }
export type BreakContext = 'needleCard' | 'summary' | 'unpause';
export type RewardPlacement = 'orderDouble' | 'needleSense' | 'offlineDouble';

export interface AdPort {
  breakOpportunity(ctx: BreakContext): Promise<void>;          // resuelve siempre; el adapter filtra ctx inválidos
  rewarded(p: RewardPlacement): Promise<boolean>;               // true solo con adFinished / success
  rewardedAvailable(): boolean;                                 // false en Basic Launch, adblock o sin SDK
}
export interface PlatformAdapter {
  readonly id: 'crazygames' | 'poki' | 'local';
  readonly caps: Capabilities;
  readonly ads: AdPort;
  readonly storage: KeyValueBackend;                            // existente
  init(): Promise<void>; loadingDone(): void;
  setGameplay(active: boolean): void;                           // con dedupe (regla de Poki)
  celebrate(): void; reportProgress(pct: number): void;
  submitScore?(score: number): Promise<void>;
  shareLink?(params: Record<string, string>): Promise<string | null>;
}
```

```ts
// src/sim/meta.ts (puro)
export interface MetaState { v: 1; runs: number; bestRunS?: number; codex: Record<string, { firstAt: number; by: 'manual' | 'scanner' }>;
  achievements: string[]; cosmetics: string[]; heirloomSlots: number; veteran: boolean; lastIncome5m: number; savedAt: number }
export function offlineEarnings(m: MetaState, now: number, caps = { rate: 0.25, maxAwayS: 7200, capActiveS: 600 }): number {
  const away = Math.max(0, Math.min((now - m.savedAt) / 1000, caps.maxAwayS));
  return Math.min(m.lastIncome5m * caps.rate * away, m.lastIncome5m * caps.capActiveS);
}
```

| Servicio | Responsabilidad | Ya existe |
|---|---|---|
| PlatformService | Adapter activo, capacidades | Parcial (`Platform`) |
| AdService | Oportunidades, rewarded, mute/pausa, `gameplayStop/Start` alrededor | No |
| AnalyticsService | Taxonomía + sinks por plataforma | Sí (sin sink remoto) |
| SaveService / CloudSave | Clave de run (`pn_save_v1`) + clave de meta (`pn_meta_v1`); en CrazyGames el Data module ya es la nube; en Poki, localStorage se sincroniza solo | Sí |
| OfflineProgressService | `offlineEarnings` puro + pantalla | No |
| AchievementService | Reglas sobre eventos de la simulación | No |
| PrestigeService | New Farm: reset + heirloom | No (P2) |
| DailyChallengeService → **WeeklyContractService** | Semilla ISO-semana, temporizador, score | No (P2) |
| LeaderboardService | `submitScore` del adapter | No (P2, con invitación) |
| MissionService | **No construir** | — |
| RemoteConfig / Experiment | JSON en el build + `?cfg=` para QA + bucket por hash | No (tras Full Launch) |

Todas las reglas de plataforma viven **en el adapter**: el juego solo pide oportunidades y el adapter aplica "no navegación" (CrazyGames) o "solo al salir de pausa" (Poki). Así nunca hay timers de midgame propios.

---

## 22. Roadmap

| Prioridad | Contenido |
|---|---|
| **P0: antes del Basic Launch** | Sink de analítica remoto + eventos `run_milestone`/`session_start`/`first_input`/`perf_sample`; pantalla Welcome back (sin offline); verificar que en CrazyGames el guardado depende solo del Data module; playtest humano y FPS reales (siguen pendientes de RC2) |
| **P1: integración de Full Launch** (solo si el Basic Launch pasa) | AdPort + adapter de CrazyGames; tarjeta de aguja como pausa; midgame en tarjetas y resumen; rewarded Pedido ×2 y Needle Sense con fallback sin anuncio; ocultar rewarded en `adsDisabledBasicLaunch`/adblock; offline acotado; 14 logros; resumen con récord, texto para compartir y encuesta; opt-in de exclusividad 2 meses |
| **P2: si el gate de §7 se cumple** | Codex de 12 + New Farm con heirloom; Weekly Contract; leaderboard (si hay invitación); cosméticos de cintas y máquinas; offline ×2 |
| **P3** | Contract Clauses (Run 3+); eventos Market Rush; foto de fábrica; validación de scores en servidor; adapter de Poki (requiere versión táctil) |
| **NO CONSTRUIR TODAVÍA** | Login rewards y rachas; misiones diarias; segunda moneda; IAP (invitación en CrazyGames, prohibido en Poki); banners; midgame al reanudar la pausa en CrazyGames; progreso offline de pila o agujas; battle pass, gacha, notificaciones; multijugador o invites |

---

## 23. Pregunta crítica: ¿más mecánicas de retención ⇒ más jugadores que vuelven?

**No.**
- En web la gente vuelve menos que en móvil y la primera sesión decide [OFICIAL, Poki].
- Cada sistema extra añade UI en un juego que ya tiene Work Tree, shop, pedidos, detector y build mode. La carga cognitiva es tu mayor riesgo de conversión [INFERENCIA].
- Los sistemas de retención solo multiplican algo que ya retiene. Si el D1 de Needle es un 4 %, un login reward no lo lleva al 12 %. Si es un 12 %, lo que falta es un motivo para la run 2, no una racha.
- Los CrazyGames y Poki que citas se evalúan con conversión, playtime, D1 y CTR [OFICIAL]. **Ninguno de esos cuatro depende de meta-sistemas post-run.**

**Qué debe existir ANTES de lanzar para aprender:**
1. Embudo remoto por minutos (`run_milestone`) y por hitos (primera venta, pedido 3, primera cinta, primer brazo, aguja #1).
2. `quit_state` enviado de verdad; hoy se pierde.
3. `session_start` con número de sesión y días desde la primera (D1–D7 propios, independientes del dashboard).
4. FPS reales por dispositivo (`perf_sample`); el rendimiento sigue sin medirse en hardware.
5. La encuesta de 1 clic en el resumen, para decidir si construir Rebirth.

---

# PROJECT NEEDLE — RETENTION & MONETIZATION V1

1. **Qué implementar antes de publicar (Basic Launch):** sink de analítica remoto con la taxonomía de §18, pantalla Welcome back, auditoría del guardado en el Data module y playtest humano + FPS real. Nada de anuncios: están desactivados en Basic Launch y un rewarded sin efecto provoca rechazo [OFICIAL].
2. **Qué NO implementar antes de publicar:** anuncios, Rebirth, Codex ampliado, leaderboards, daily/weekly, logros, cosméticos, offline, eventos, login rewards, misiones, adapter de Poki.
3. **Dónde poner anuncios:** midgame al pulsar Continue en la tarjeta de aguja (#1–#5) y al salir del resumen final. Rewarded en el panel de Orders (Pedido ×2, Needle Sense) y en Welcome back (×2 offline, P2). Nunca en carga, navegación, Work Tree o shop, ni durante el gameplay.
4. **Cuántos anuncios por run:** 6 peticiones de midgame → ~4 mostrados (cooldown de 3 min de CrazyGames), es decir, ~4/h. Rewarded: 0–10, a elección del jugador.
5. **Rewarded ads:** Pedido ×2 (dinero, no WP; oferta cada 4 min como máximo) y Needle Sense (≥8 min sin aguja, 1 por aguja, pulso de dirección de 60 s; alternativa: pagarlo con 3 min de ingresos).
6. **Rebirth V1:** "New Farm", revelada solo en el resumen de la primera run completada. Semilla nueva con 6 agujas de un pool de 12 y una aguja heirloom con buff activo desde el minuto 0. Solo se construye si se cumple el gate de §7.
7. **Prestige Currency:** **ninguna.** La progresión persistente es el Needle Codex más las ranuras de heirloom (1, y 2 tras Rebirth 3). Sigue la regla de una sola moneda de Poki [OFICIAL].
8. **Qué se resetea:** pila, layout, agujas, edificios, dinero, WP, niveles de tecnología, Hay Sell Value y pedidos.
9. **Qué permanece:** Codex, logros, cosméticos, récords, ranuras de heirloom, flag veterano (saltar 3 pedidos tutoriales) y ajustes.
10. **Cómo cambia la Run 2:** layout y agujas distintos, un buff desde el inicio y sin tutorial. Objetivo de 45–55 min, a validar con el bot. No es "más rápida": son **otras decisiones** por los buffs y el layout.
11. **Cómo cambian las Run 3+:** Contract Clauses opcionales (restricciones que dan sellos en el Codex, no poder). Con el Codex 12/12, una aguja dorada que exige ≥2 cláusulas.
12. **Daily Challenge V1:** **no existe.** En su lugar, Weekly Contract (P2): pila de 60k, semilla por semana ISO, 15 min, score = dinero entregado. Se desbloquea tras la aguja #3.
13. **Leaderboards V1:** ninguna al lanzar. En P2, la única leaderboard de CrazyGames (si hay invitación) para el Weekly Contract, con POINTS DESC, no incremental, min 0, max = techo del bot ×1,3 y cooldown de 600 s. Récords personales locales desde P1.
14. **Daily/Weekly Missions:** no. Los pedidos son las misiones dentro de la run y el Weekly Contract es la misión semanal. Sin login rewards ni rachas.
15. **Offline Progress:** P1. Se desbloquea con el primer brazo. 25 % del ingreso medio de 5 min, ausencia máxima de 2 h, techo de 10 min de ingreso activo. Solo dinero (sin WP, pila ni agujas). ×2 con rewarded una vez por regreso.
16. **Achievements:** 14, sobre todo de estilo y habilidad (§11). `happytime` limitado y cada uno desbloquea un cosmético.
17. **Cosmetics:** 3 paletas de cintas y 3 esquemas de máquinas (tintes de material, sin draw calls nuevos), desbloqueados por logros. Nunca por anuncios en V1.
18. **Analytics:** taxonomía de §18. Sink ByteBrew en CrazyGames (decisión tuya por ser una dependencia) y dashboard nativo. KPIs: conversión, playtime, D1 y D7 propios, % de completado de run 1, sesiones hasta completar y midgames por hora.
19. **Arquitectura:** `PlatformAdapter` con `AdPort` (reglas de plataforma dentro del adapter), `MetaState` puro en `src/sim/meta.ts`, clave de guardado separada `pn_meta_v1` y servicios en `src/platform/` sobre `Platform`, `PlatformStorage` y `Analytics` existentes (§21).
20. **Orden exacto de desarrollo:**
    1. Analítica remota y eventos.
    2. Welcome back.
    3. Playtest humano y FPS → **Basic Launch.**
    4. Si pasa: AdPort + adapter de CrazyGames + mute/pausa.
    5. Tarjeta de aguja como pausa y midgames.
    6. Pedido ×2.
    7. Needle Sense.
    8. Offline.
    9. Logros y cosméticos.
    10. Resumen con récord, compartir y encuesta → **Full Launch** (+ opt-in de exclusividad de 2 meses).
    11. Evaluar el gate de Rebirth.
    12. Codex de 12 + New Farm.
    13. Weekly Contract.
    14. Leaderboard (si hay invitación).
    15. Clauses y eventos.

| Sistema | Impacto esperado | Coste dev | Riesgo | Momento recomendado |
|---|---:|---:|---:|---|
| Analítica remota + taxonomía | Alto (permite todo lo demás) | Bajo | Bajo | P0 |
| Welcome back | Medio (D1) | Bajo | Bajo | P0 |
| AdPort + adapter CrazyGames + mute/pausa | Alto (ingresos) | Medio | Medio (rechazo en QA si falla) | P1 |
| Tarjeta de aguja como pausa + midgame | Alto | Bajo | Bajo | P1 |
| Rewarded Pedido ×2 | Medio | Bajo | Bajo | P1 |
| Rewarded Needle Sense | Medio (tail y diversión) | Bajo-medio | Medio (trivializar la búsqueda) | P1 |
| Offline acotado | Medio (D1) | Bajo | Medio (pacing) | P1 |
| 14 logros | Medio | Medio | Bajo | P1 |
| Resumen: récord + compartir + encuesta | Medio | Bajo | Bajo | P1 |
| Codex de 12 + New Farm (heirloom) | Alto si hay intención de repetir; nulo si no | Alto | Alto | P2 (con gate) |
| Weekly Contract | Medio (D7) | Medio-alto | Medio | P2 |
| Leaderboard semanal | Medio | Bajo (si hay invitación) | Medio (trampas) | P2 |
| Cosméticos de cintas y máquinas | Bajo-medio | Bajo | Bajo | P2 |
| Contract Clauses / eventos | Bajo-medio | Medio | Medio | P3 |
| Adapter de Poki | Alto (otra audiencia) | Muy alto (requiere controles táctiles) | Alto (exclusividad) | P3 / decisión de negocio |
| Login rewards / misiones diarias / segunda moneda | Bajo o negativo | Medio | Alto | No construir |

## TOP 10 IMPLEMENTACIONES

Ordenadas por (retención + monetización + diversión) / coste:

1. **Analítica remota con embudo por minutos e hitos.** Coste bajo; sin ella todo lo demás es adivinar.
2. **Tarjeta de aguja como pausa natural + midgame.** Crea el único punto de anuncio limpio del juego sin añadir interrupciones nuevas.
3. **Welcome back** con el siguiente objetivo. El D1 de Needle es la run a medias.
4. **Rewarded Pedido ×2.** Encaja en el ejemplo oficial de multiplicador, está en un menú y apenas afecta al balance.
5. **Needle Sense** (rewarded o dinero). Arregla el tail de agujas tardías medido y ayuda a quien está atascado.
6. **Resumen final** con récord, texto para compartir y encuesta de 1 clic. Cierra la run y decide con datos si construir Rebirth.
7. **Offline acotado** (solo dinero, 25 %, techo de 10 min). Recompensa el regreso sin superar el juego activo.
8. **14 logros con cosméticos de cintas y máquinas.** Objetivos de estilo que alargan la run 1 y dan motivo para Run 2.
9. **Needle Codex + New Farm con heirloom** (solo tras el gate). Rejugabilidad por variación de la búsqueda y sin segunda moneda.
10. **Weekly Contract + leaderboard semanal de CrazyGames.** Competición justa (misma semilla, 15 min) alineada con la temporada nativa; único sistema con impacto en D7/D30.

---

## Fuentes (consultadas el 27-09-2026)

**CrazyGames (oficial)**
- Introducción, Basic/Full Launch: https://docs.crazygames.com/
- Basic Launch Guide (métricas): https://docs.crazygames.com/resources/basic-launch-metrics/
- Requisitos (intro, tamaños, analítica, IAP): https://docs.crazygames.com/requirements/intro/
- Requisitos de anuncios: https://docs.crazygames.com/requirements/ads/
- SDK Video ads (requestAd, códigos de error): https://docs.crazygames.com/sdk/video-ads/
- SDK Game (gameplay, loading, happytime, completion, invites): https://docs.crazygames.com/sdk/game/
- SDK Data (1 MB, guest/login): https://docs.crazygames.com/sdk/data/
- SDK User: https://docs.crazygames.com/sdk/user/
- Integración de cuentas: https://docs.crazygames.com/requirements/account-integration/
- Leaderboards: https://docs.crazygames.com/sdk/leaderboards/ y https://docs.crazygames.com/sdk/leaderboards-client/
- Requisitos de gameplay: https://docs.crazygames.com/requirements/gameplay/
- Quality guidelines: https://docs.crazygames.com/requirements/quality/
- FAQ (QA, pagos, ranking): https://docs.crazygames.com/faq/
- Términos del desarrollador, 18-08-2025 (§5.4 compensación y +50 % de exclusividad, §5.6 pagos): https://files.crazygames.com/documents/developer_terms_20250818.pdf

**Poki (oficial)**
- SDK HTML5: https://developers.poki.com/guide/sdk-html5
- SDK overview y orden de eventos: https://developers.poki.com/guide/sdk-overview
- Requisitos y calidad: https://developers.poki.com/guide/requirements-quality
- Consejos de monetización: https://developers.poki.com/guide/monetization
- Engagement (sesión 0, ~1 h de contenido): https://developers.poki.com/guide/engagement
- User Accounts y cloud saves: https://developers.poki.com/guide/accounts
- AUDS: https://developers.poki.com/guide/auds
- Working with Poki (100 % / 50-50): https://developers.poki.com/guide/working-with-poki
- Deal types (exclusiva 5 años indicativa, no exclusiva con tarifa fija): https://developers.poki.com/guide/revenue-deal-types
- Web fit test: https://developers.poki.com/guide/web-fit-test

**Externas**
- GameAnalytics, 2026 Mobile & PC Gaming Benchmarks: https://www.gameanalytics.com/reports/2026-mobile-pc-gaming-benchmarks
- Coin Factory en Poki: https://poki.com/en/g/coin-factory
- Mini Metro+ (App Store): https://apps.apple.com/us/app/mini-metro/id1550663539
- Gridle en CrazyGames (ficha replicada por terceros): https://www.openparable.com/game/crazygame/gridle
