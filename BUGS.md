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
