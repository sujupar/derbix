# PROMPT MAESTRO — Reforma visual de Derbix (Composición 1)
## SOLO estética · TODAS las funciones quedan intactas
### Estado consolidado: lo ya trabajado + lo nuevo (MD Composición 1)

> Pégame completo en Claude Code, dentro del repo de Derbix.
> Objetivo visual: la **Composición 1** (sidebar con secciones + barra de controles agrupada + panel de contenido con filas de pick limpias), sobre fondo negro, texto blanco y verde de marca como acento (vía tokens).
> Este documento **mezcla lo que ya está implementado** (no rehacerlo) con **lo que falta**. Respeta los checkpoints.

---

## 0. Misión
Rediseño **100% visual** de Derbix (React 19 + Vite + Tailwind v4 + lucide/icons propios). La app ya funciona; esto es puramente cosmético. Fondo negro, texto blanco, verde `#1DE782` como acento único vía tokens `--dx-*`.

---

## 1. ⛔ REGLAS INNEGOCIABLES + 🥇 LA REGLA DE ORO DE LOS BOTONES

**NO TOQUES NADA DE FUNCIONALIDAD.** Prohibido modificar: lógica, estado, hooks, efectos, llamadas a APIs, fetching, auth, cálculos, datos, routing/navegación, nombres de funciones/variables de lógica, `.env`.

### 🥇 REGLA DE ORO — cada botón sigue haciendo EXACTAMENTE lo mismo
Cada botón/ítem/toggle/control **conserva su `onClick`/handler y su comportamiento actual**. Solo cambias **apariencia y posición**, nunca su función:
- "En vivo" sigue mostrando partidos en vivo · "Actualizar" sigue recargando la jornada.
- El toggle Oportunidades / Partidos sigue cambiando de vista.
- Los ítems del menú (Jornadas, Resultados, Admin) siguen navegando.
- El selector de fecha sigue filtrando · "Configurar" abre · "Cerrar sesión" cierra.

👉 Reusa los handlers existentes: envuélvelos/reestilízalos, jamás los reemplaces.

### No inventes ni elimines elementos
- **No agregues ni quites botones, vistas ni rutas.** Aplica el estilo a lo que YA existe.
- Si la Composición muestra algo que la app no tiene (un contador, "actualizado 5:00 AM"), **NO lo inventes**: omítelo salvo que el dato ya exista.
- Si la app tiene **más** de lo que muestra la Composición, **consérvalo**.

### Modo de trabajo
- Commit por checkpoint después de CADA pantalla/componente.
- Tras cada archivo: resumen de una línea + confirma "no toqué lógica ni handlers".
- Si un cambio estético obliga a tocar lógica → **PARA y pregunta**.
- No instales dependencias salvo fuentes de Google.

---

## 2. 🛟 COPIA DE SEGURIDAD
Trabajo en rama de prueba **`claude/trusting-pasteur-s1ccy3`** (clon). La Derbix real (rama `main`) **no se toca** hasta aprobación.
- `git status` limpio antes de cada bloque · commit por checkpoint · rama de respaldo congelada disponible.
- Devolverse: `git restore .` (sin commit) · `git checkout <hash>` (a un checkpoint).

---

## 3. Tokens (única fuente de verdad) — ✅ YA IMPLEMENTADO

En `index.css`, dentro de `@theme` de Tailwind v4 (se exponen como utilidades `dx-*`):

```css
@theme {
  --font-sans: 'Inter', sans-serif;
  --font-display: 'Space Grotesk', sans-serif;

  /* Fondo y superficies */
  --color-dx-bg: #000000;             /* fondo negro puro — TODAS las pantallas */
  --color-dx-surface: #0C1310;        /* tarjetas, toggles, campos, sidebar items */
  --color-dx-surface-2: #121E18;      /* hover / estado interno */
  --color-dx-border: rgba(255,255,255,0.07);
  --color-dx-border-active: rgba(29,231,130,0.30);

  /* Verde (acento único) + degradado verde→cian */
  --color-dx-green: #1DE782;
  --color-dx-green-bright: #5BFFAC;
  --color-dx-green-deep: #0BA35A;
  --color-dx-green-glow: rgba(29,231,130,0.20);
  --color-dx-cyan: #22E5C0;

  /* Texto */
  --color-dx-text: #FFFFFF;
  --color-dx-text-soft: rgba(255,255,255,0.58);
  --color-dx-text-mute: rgba(255,255,255,0.36);

  /* Funcionales */
  --color-dx-loss: #F4584E;           /* pérdidas */
  --color-dx-live: #FF3B30;           /* indicador EN VIVO */
  --color-dx-gold: #E7B84F;           /* cuota destacada / premium */
  --color-dx-platinum: #C7CCD1;       /* pro */
}
```

> `brand` quedó reapuntado a `#1DE782` para que TODOS los usos viejos adopten el verde nuevo.
> Uso: `bg-dx-surface`, `text-dx-text-soft`, `border-dx-border`, `text-dx-green`, etc.
> Clases de componente ya creadas en `index.css`: `.dx-num` (tabular-nums), `.dx-seg` (toggle), `.dx-btn` / `.dx-btn-ghost`, `.dx-input`, `.dx-card`, `.dx-sidelabel`, `.dx-nav-item`, `.dx-plan`.

---

## 4. Fondo negro global + tipografía — ✅ base lista
- Fondo `#000000` en TODAS las pantallas. Reemplazar fondos viejos (`bg-slate-900/950`, grises, azules) por tokens dx. **(parcial: hecho en shell, login, sidebar y Jornadas; falta el resto de pantallas)**.
- Superficies elevadas en `--color-dx-surface` con borde `--color-dx-border`.
- **Space Grotesk** (títulos/números) + **Inter** (texto). Todo número con `font-variant-numeric: tabular-nums` (`.dx-num`).

---

## 5. Anatomía de la Composición 1

### 5.1 Sidebar — ✅ HECHO
- Logo arriba + divisoria · Switcher de cuenta (mantiene su acción).
- **Secciones con etiqueta** ("Menú", "Gestión") agrupando los ítems existentes (`.dx-sidelabel`).
- **Ítem activo** (`.dx-nav-item.on`): fondo surface + **barra vertical verde a la izquierda** + ícono/texto verde. Inactivos soft con hover surface.
- **Pie reorganizado:** tarjeta de plan (`.dx-plan`, borde dorado tenue, escudo, nombre de plan **saneado sin `(agency_admin)`** vía `utils/planDisplay.ts → cleanPlanLabel`), fila de cuenta (avatar + nombre + rol), botones WhatsApp y Cerrar sesión con tokens dx (handlers intactos).

### 5.2 Header del contenido — ✅ HECHO (Jornadas)
Título `font-display` + subtítulo `text-dx-text-soft`.

### 5.3 Barra de controles — ✅ HECHO (Jornadas)
- **Toggle** (segmented) a la **izquierda**; **fecha** (pill) + En vivo a la **derecha**, como barra propia pegada al contenido.
- Toggle: verde lleno + texto adentro (ver §7). Cada opción conserva su handler.
- ⏳ PENDIENTE: replicar este patrón de barra de controles en otras pantallas con filtros (Resultados).

### 5.4 Panel de contenido — ⏳ PENDIENTE
- Tarjeta con cabecera (ícono verde + título + subtítulo + meta a la derecha **solo si el dato existe**).
- **Filas de pick limpias** (`.dx-prow`): izquierda probabilidad grande en verde + barra de confianza; centro equipos + chip de mercado (verde) + liga/hora; derecha **cuota en dorado** + chevron. Resultado/dinero en `--dx-green` (ganado) / `--dx-loss` (perdido).
- Archivos objetivo: `components/ai/HighProbPicks.tsx`, `components/ai/TopPicks.tsx`, `components/ai/AnalysisReportModal.tsx`.
  - ⚠️ `AnalysisReportModal.tsx` tiene el espejo de `isProbOddsCoherent()` (banner ámbar "Cuota incoherente"): **no tocar esa lógica**, solo su estilo.

---

## 6. Aplica el MISMO lenguaje a TODA la app — ⏳ PENDIENTE (mayoría)
Recorre todo con los mismos tokens/clases; **cada botón conserva su handler**.

- **Transversales:** barra superior móvil, **burbuja de chat/soporte** (`--dx-green`), **splash/carga** (negro + acento), **skeletons** (`surface` + shimmer), **modales/toasts/dropdowns** (`surface` + borde + acción verde).
- **Login / Registro:** ✅ login hecho. ⏳ falta registro/SignUpFlow/ResetPassword: fondo negro, form en `surface`, inputs focus verde (`.dx-input`), botón primario `.dx-btn`.
- **Jornadas:** ✅ header + barra de controles + sidebar. ⏳ filas de pick (5.4) + tarjetas de Partidos (`FlashscoreLeagueGroup`, `GameCard`, `AnalysisGameCard` en `LiveFeed.tsx` — quedan azules `bg-blue-600` en botones ANALIZAR/BATCH → pasar a sistema dx).
- **Resultados (`ResultadosPage.tsx`):** filtros de período como **pills** (activo verde); toggle **Mi Plan / Plan Máquina** segmented (sin `(agency_admin)` ni "Acceso Total"); tarjetas resumen (% aciertos número grande verde + barra ganadas/perdidas); picks verificados como filas (✓/✗ verde/rojo, marcador, chip mercado, fecha `06/06/2026`, cuota); métricas bankroll con `dx-num` y etiquetas en español (§8). Gráfica de evolución: **NO construir** si requiere datos nuevos — avisar.
- **Informe / Formaciones / Planes / Admin:** mismo sistema. Formaciones: cancha verde oscuro sobre negro + líneas blancas tenues. Planes: recomendado en verde, premium en `--dx-gold`. Admin (incl. testimonios): reestilizar controles/tablas/formularios SIN tocar lógica.

---

## 7. Toggle (bug del texto que se sale) — ✅ HECHO
El verde se pinta **sobre el botón activo** (no un pill aparte), cada botón crece según su texto y el toggle no se aplasta. Implementado en el toggle Oportunidades/Partidos de Jornadas (gradiente verde→cian + `whitespace-nowrap`). Clase reutilizable `.dx-seg` disponible en `index.css` para los demás toggles.

---

## 8. Limpieza visual (texto, SIN lógica) — 🟡 PARCIAL
- ✅ **Sidebar:** `(agency_admin)` oculto vía `cleanPlanLabel`.
- ⏳ **Resultados:** quitar `(agency_admin)` y "Acceso Total" del toggle Mi Plan / Plan Máquina.
- ⏳ Iconos morados → verde.
- ⏳ **Español 100%:** `YIELD`→Rendimiento · `PROFIT (U)`→Ganancia (u) · `MAX DRAWDOWN`→Caída máx. · `RACHAS W/L`→Rachas G/P · `ODDS PROM`→Cuota prom. · `Manual: WON`→Verificado: GANADA · `Friendly International`→Amistoso Internacional.
- ⏳ **Fecha visible:** `2026-06-06` → `06/06/2026` (solo presentación; no tocar el dato).
- Canal de comunidad confirmado: **WhatsApp** (icono `PaperAirplaneIcon`).

---

## 9. (OPCIONAL) Tema según el plan — ⏳ PENDIENTE
El acento puede cambiar según el plan (verde estándar, **dorado** premium, platino élite) reasignando los `--color-dx-*` con `[data-plan="..."]` en el contenedor raíz, **leyendo el plan que YA existe** en estado/usuario. Solo lees y aplicas la clase; no toques otra lógica. Omitible.

```css
[data-plan="premium"]{ --color-dx-green:#E7B84F; --color-dx-cyan:#F6D27A; --color-dx-green-deep:#B8902E; }
[data-plan="elite"]{ --color-dx-green:#C2CDD8; --color-dx-cyan:#E8EEF3; --color-dx-green-deep:#8A97A4; }
```

---

## 10. ✅ Criterios de aceptación
- [ ] Cada botón/control existente sigue disparando su acción original.
- [ ] No se agregaron ni quitaron botones, vistas ni rutas.
- [ ] Copia de seguridad / rama de prueba; commits por checkpoint.
- [x] Tokens `--dx-*` como única fuente de color.
- [x] Sidebar Composición 1 (secciones, ítem activo barra verde, pie reorganizado).
- [x] Toggle verde completo, texto sin cortarse.
- [x] Barra de controles (toggle izq · fecha der) en Jornadas.
- [ ] Fondo `#000000` en TODAS las pantallas (falta extender).
- [ ] Filas de pick (5.4) + Resultados + Informe + Formaciones + Planes + Admin.
- [ ] Inputs (incl. registro) con focus verde; números `tabular-nums`.
- [ ] Inglés/etiquetas internas fuera de la vista (Resultados pendiente).
- [ ] Funcionalidad idéntica; sin dependencias nuevas (salvo fuentes).

---

## 11. Estado por commit (clon `claude/trusting-pasteur-s1ccy3`)
| Commit | Qué entró |
|--------|-----------|
| `4968684` | Fundación de tokens — negro + verde #1DE782 + Space Grotesk |
| `fd732ca` | Login al sistema dx (negro + verde) |
| `3a7ba1e` | App shell (marco negro) + icono Oportunidades a verde |
| `ac213bc` | Jornadas neon premium: header + toggle pastilla verde→cian |
| `c8c1ed6` | Fix toggle: seleccionado 100% verde + sin overflow de texto |
| `722e311` | Sidebar con secciones + pie con plan limpio (sin agency_admin) + barra de controles (toggle izq · fecha der) |

**PRÓXIMO checkpoint sugerido:** filas de pick limpias (`HighProbPicks.tsx`) — §5.4.

---

**Orden:** tokens (✅) → sidebar (✅) → barra de controles (✅) → filas de pick (⏳) → pantalla por pantalla (§6). Regla de oro siempre presente: **solo cambias cómo se ven los botones, nunca lo que hacen.**
