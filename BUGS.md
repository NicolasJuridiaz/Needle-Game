# BUGS

Prioridades: **P0** impide jugar · **P1** rompe sistema importante · **P2** bug visible/relevante · **P3** polish.

| ID | Prio | Sistema | Descripción | Estado |
|---|---|---|---|---|
| B001 | P0 | Build | `game.ts` importaba 7 módulos de render y `audio/audioEngine` inexistentes; `tsc` fallaba y no había build. | FIXED (81cc460, acb0898) |
| B002 | P0 | Logística / Energía | `Logistics` y `PowerNetwork` eran stubs: ninguna cinta movía nada y ninguna máquina recibía energía. | FIXED (f54f080, 066d54a) |
| B003 | P1 | Máquinas | Compressor, Wrapper y Hay Generator no existían; `MACHINE_CLASSES` vacío (todas las máquinas eran `StaticBuilding`). | FIXED |
| B004 | P1 | Scanner | `canAccept` no preparaba las listas de puertos hasta el primer tick: nada entraba en un scanner recién colocado. | FIXED |
| B005 | P2 | Robotic Arm | En el borde fino del pajar el brazo agarraba ~9 hay en vez de ~20 (throughput muy por debajo de 10 hay/s). | FIXED (recarga desde disco de 0.9 m) |
| B006 | P2 | Logística | Un pase de logística añadía un "giro automático" en cintas sin salida (no está en GDD/spec, el render no lo dibujaba). Retirado. | FIXED (f54f080) |
| B007 | P2 | Tests | `tests/integration.test.ts`: escáner solapando el generador, cadena de producción sin cintas, brazos sin energía, esquina sin rotar, `beltX` de 1 tile con dirección errónea. | FIXED |
| B008 | P1 | Progresión | Generador sin carga no quemaba nada → el Order "Stoke the Fire" (quemar 300 hay) no avanzaba alimentándolo con E, y era el único Order activo → bloqueo de WP. Ahora quema una llama piloto (25 %). | FIXED |
| B009 | P2 | Render / Pajar | La mitad de las matas de paja se veían marrón oscuro: material `DoubleSide` invierte la normal en caras traseras. Ahora ambas caras en la geometría + `FrontSide`. | FIXED |
| B010 | P3 | Consola | 404 de `/favicon.ico` en cada carga. Añadido favicon vacío inline. | FIXED |
| B011 | P1 | Logística | Una cinta recta alimentada por detrás no aceptaba nada por los lados: un Robotic Arm/Rake junto a una línea en marcha no podía soltar en ella (imposible "varios brazos → una cinta", cuello ARMS > BELT del GDD). Añadido side-loading de máquinas (inserta en mitad del tile cuando hay hueco). | FIXED |
| B012 | P1 | Progresión | Tras `o_truck` el único Order activo era `o_stoke` (quemar 300 hay ≈ 10 min con la llama piloto) y `o_iron`/`o_handsoff` estaban encadenados detrás → ~13 min sin WP. `o_stoke`/`o_iron` ahora en paralelo tras `o_feed`, `o_stoke` = 150. | FIXED |
| B013 | P2 | Progresión | `o_industrial` (250 P) inalcanzable con 2 generadores al máximo (234 P tras pérdidas) y `o_throttle` (150 hay/s) igual al máximo teórico de una línea. Ajustados a 200 P / 120 hay/s. | FIXED |
| B014 | P2 | Balance | Primera partida del bot: detector a los 4 min, fábrica a los 8, luego muro de WP 10–40 min; órdenes intermedias se completaban en segundos. Retuneado (ver docs/PLAYTEST_V1.md). | FIXED |
| B015 | P2 | UI / Shop | En tarjetas bloqueadas el velo "Unlock … in the Work Tree" tapaba el nombre del objeto. Ahora el velo vive dentro de la cabecera de la tarjeta. | FIXED |
| B016 | P2 | UI / HUD | El tooltip de máquina tapaba el prompt `[E]` bajo la mira. Tooltip elevado (−74 %). | FIXED |
| B017 | P2 | Plataforma / Consola | La UI pedía Rubik a fonts.googleapis.com en cada carga (petición a terceros, error de consola sin red, transferencia de IP a Google). Fuente auto-alojada (OFL, 35 KB). | FIXED |
| B018 | P3 | UI | El banner de milestone y los toasts pueden solaparse con cabeceras de panel / el borde derecho del tooltip en ventanas ≤ 1024 px de ancho. Transitorio (3–4 s). | OPEN |
| B019 | P1 | Progresión | *Industrial Generator* (×2 salida) no hacía nada: *Generator Output* usaba `set`, que en el plegado add → mul → set anula el `mul`. Encontrado por la auditoría del Work Tree. Ahora `mul`. | FIXED (b66c409) |
| B020 | P2 | Guardado | Save → load no era exacto: la ventana del ritmo estable (*Steady Flow*, *Full Throttle*) se vaciaba en cada carga; fase del rake y temporizador del scanner se recortaban a 0,999; el crédito negativo de los RateGate se perdía (salida extra tras cargar); épsilon de "lleno" demasiado fino (carry/rake/collector parpadeaban entre lleno/no lleno). Encontrado por `tests/saveFuzz.test.ts`. | FIXED (d100507) |
| B021 | P1 | Agujas | Una aguja ya encontrada podía volver al pajar si una copia obsoleta de su id seguía viajando en un paquete. Ahora una aguja encontrada nunca se "resucita". | FIXED (af59249) |
| B022 | P2 | Logística | Los extremos de cinta estaban cuantizados a ticks enteros: un paquete solo entraba cuando el último ítem estaba a un espaciado completo y el que salía hacia una máquina perdía su sobrante. Belt Speed I daba 66,7 en vez de 75 hay/s y Belt Capacity I no añadía nada con Belt Speed II. | FIXED (a47404c) |
| B023 | P2 | Procesado | Compressor y Wrapper descartaban el resto sub-tick de cada ciclo: compresor base 57,3 en vez de 60 hay/s, Wrap Speed I +25 % en vez de +30 %. El wrapper además perdía ese resto al guardar. | FIXED (a47404c) |
| B024 | P1 | Economía | Un Robotic Arm sin nada enlazado volvía a coger su propio montón del suelo y cada recogida contaba otra vez como extracción: los orders *extractArm* / *extractMachine* se podían farmear sin vaciar el pajar. Ahora solo coge por detrás de su pedestal. | FIXED (a47404c) |
| B025 | P1 | Progresión / pacing | A ~30 min, con la primera cinta saturada a 50 hay/s, los brazos nuevos quedaban bloqueados, *Robot Friends* no avanzaba y no había WP para Belt Speed: 5–10 min sin decisiones en 1/3 de las semillas. *Steady Flow* abre ahora tras *Wholesale*. Además hueco de WP de 6 min tras la carretilla (Generator Plans 1 WP, *Truckload* 1600). | FIXED (ad680bd) |
| B026 | P2 | Render / HUD | El contador de FPS acumulaba el `dt` recortado a 0,1 s: con 1–2 FPS reales mostraba ≥ 10. Ahora usa el tiempo real de frame. | FIXED |
| B027 | P2 | Render | Sin failsafe de GPU: un equipo muy lento se quedaba en Medium/High. Nuevo `AutoQuality`: baja un nivel (con aviso) si el juego va < 24 FPS de media 15 s y el jugador no eligió calidad. Sin WebGL, mensaje claro en vez de "Something went wrong". | FIXED (17217bc +) |
| B028 | P3 | Bot de balance | El bot no tomaba ninguna decisión mientras desenterraba a mano una aguja profunda (hasta 5 min con $20k+ en el banco), inflando los huecos medidos. | FIXED (ad680bd) |
