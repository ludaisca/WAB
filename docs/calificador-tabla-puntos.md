# Tabla de ponderación — Calificador de leads (equipo médico y veterinario)

**Fecha:** 2026-07-23
**Qué es esto:** el desglose en puntos de cómo el calificador de IA evalúa una conversación con un lead, para explicar la ponderación a equipo/stakeholders. El texto que la IA realmente recibe está en `docs/calificador-prompt.md` — esta tabla es la misma lógica en formato legible.

**Importante:** este sistema **no existía como tabla de puntos antes de esta fecha** — el prompt original solo describía las fases de forma cualitativa ("score más alto si...") y dejaba el número exacto dentro de cada rango a criterio del modelo de IA. Esta tabla formaliza esa ponderación con valores fijos.

---

## Filtro previo (elimina antes de puntuar)

Si el lead busca que se le **realice un procedimiento o servicio** (ej. "necesito una radiografía para mi perro") en vez de **comprar el equipo**, se descarta sin importar qué tan detallado o urgente suene el mensaje.

| Etiqueta | Score | Criterio |
|---|---|---|
| **Descartado** | 0 fijo | Filtro previo aplicado, o sin ninguna relación real con equipo médico/veterinario. No se evalúa nada más. |

---

## Tabla de puntos por fase

### Frío (1-15 puntos)

| Puntos | Criterio |
|---|---|
| +3 | Solo saludó o preguntó algo genérico, sin mencionar producto ni especialidad |
| +6 | Mencionó el tipo de equipo o categoría que le interesa (tomógrafo, mesa quirúrgica, Rayos X), aunque sea superficial |
| +6 | Dio alguna pista de su especialidad o uso, aunque no profundizó |
| **= 15** | **Máximo de la fase si aplican las tres** |

### Interesado (16-35 puntos) — requiere la base de 16

| Puntos | Criterio |
|---|---|
| +16 (base) | Interés explícito en un equipo concreto **Y** explicó su especialidad y uso en su propia clínica |
| +10 | Respondió con información específica a las preguntas del agente (no evasivo) |
| +9 | Sigue interactuando activamente, hace preguntas propias |
| **= 35** | **Máximo de la fase si aplican las tres** |

### Oportunidad (36-65 puntos) — requiere la base de 36

| Puntos | Criterio |
|---|---|
| +36 (base) | Necesidad de equipo clara **Y** ya pidió cotización, precios, opciones, llamada o visita |
| +15 | Quien escribe parece ser el doctor, dueño o decisor de la clínica |
| +14 | Continuidad sostenida: sigue interactuando tras recibir opciones, no abandonó |
| **= 65** | **Máximo de la fase si aplican las tres** |

### Prioridad alta (66-100 puntos) — requiere la base de 66 (Oportunidad completa)

| Puntos | Criterio |
|---|---|
| 66 (base) | Todo lo de Oportunidad ya cumplido |
| +8 | Mencionó plazo o fecha concreta |
| +8 | Mencionó presupuesto disponible o aproximado |
| +8 | Confirmó explícitamente ser quien decide la compra |
| +8 | Expresó intención de comprar de inmediato |
| **= 98** | Máximo con las 4 señales |
| **99-100** | Reservado para cierre explícitamente confirmado por el lead |

---

## Resumen ejecutivo

| Fase | Rango | Base obligatoria |
|---|---|---|
| Descartado | 0 | Filtro previo o sin relación con el producto |
| Frío | 1-15 | — (suma libre de las 3 señales) |
| Interesado | 16-35 | Interés en equipo concreto + especialidad/uso propio |
| Oportunidad | 36-65 | Necesidad clara + pidió cotización/llamada/visita |
| Prioridad alta | 66-100 | Oportunidad completa + al menos 1 señal fuerte (plazo, presupuesto, decisor, compra inmediata) |
