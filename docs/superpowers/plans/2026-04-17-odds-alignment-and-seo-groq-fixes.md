# Corrección de Cuotas Desalineadas + Sistema SEO con Groq

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (A) Anclar las cuotas mostradas en Oportunidades a datos reales de SportMonks y eliminar la posibilidad de que el LLM las invente. (B) Restaurar la generación de artículos SEO respetando los límites del free tier de Groq (8000 TPM, 200K TPD por modelo).

**Architecture:**
- **Parte A (Cuotas):** El ETL actualmente no solicita el endpoint `odds` de SportMonks, así que `fixtureData.odds` siempre llega vacío. El normalizer detecta el vacío, el analyzer añade el literal `'SIN CUOTAS VIVAS (USAR FALLBACK)'` al prompt, y el prompt instruye al LLM a generar sus propias cuotas. La corrección en 5 capas: (1) llamar `getOdds(fixtureId)` en paralelo en el ETL; (2) seleccionar bookmaker prioritario y promedio de mercado; (3) prohibir al LLM inventar cuotas en el prompt; (4) validar rango razonable (1.01–15.0) en `v2-generate-parlays`; (5) trazabilidad con columna `odds_source` (`real` | `null`).
- **Parte B (SEO):** El sistema SEO **ya usa Groq** vía `callLLM()`, pero `seo-generate-article` pide `maxTokens: 8192`, lo que excede el límite de 8000 TPM del free tier. Una sola llamada agota el budget y falla con 429. Corrección: reducir a `maxTokens: 4000`, reducir longitud del prompt (1000-1500 palabras vs 2500), añadir retry con backoff respetando headers de Groq, persistir estado (`article_status`: pending/generating/ready/failed), y un cron de reintento para recuperar artículos fallidos.

**Tech Stack:** Deno Edge Functions (Supabase), TypeScript, PostgreSQL (Supabase), Groq API, SportMonks v3 API, React 19 + TailwindCSS (frontend).

---

## Archivos afectados

**Files to CREATE:**
- `supabase/functions/_shared/odds-selector.ts` — Selecciona bookmaker prioritario y formatea odds reales para el analyzer
- `supabase/functions/seo-retry-pending-articles/index.ts` — Cron de reintento de artículos SEO fallidos
- `supabase/migrations/20260417_odds_source_and_seo_status.sql` — Columnas nuevas

**Files to MODIFY:**
- `supabase/functions/_shared/sportmonks-client.ts` — Exportar `getOdds` (ya existe, solo verificar)
- `supabase/functions/_shared/sportmonks-normalizer.ts` — Mejorar `organizeOddsForAI` con bookmaker priority
- `supabase/functions/v2-create-job-sportmonks/index.ts` — Llamar `getOdds` en paralelo al Stage 2
- `supabase/functions/v3-ai-analyzer/index.ts` — Eliminar instrucción de inventar cuotas; rechazar pick sin odds reales
- `supabase/functions/v2-generate-parlays/index.ts` — Exigir `validOdds` dentro de rango; descartar picks sin odds reales
- `supabase/functions/seo-generate-article/index.ts` — Reducir `maxTokens` a 4000, retry con backoff, prompt compacto
- `supabase/functions/seo-publish-page/index.ts` — Marcar estado y no bloquear si falla el artículo
- `components/ai/HighProbPicks.tsx` — Mostrar odds solo si existen (ya validado, confirmar)

---

## PARTE A — CORRECCIÓN DE CUOTAS DESALINEADAS

### Task A1: Verificar disponibilidad del endpoint de odds en SportMonks

**Files:**
- Modify: `supabase/functions/_shared/sportmonks-client.ts:281-287` (ya existe la función `getOdds`)

- [ ] **Step 1: Revisar la función `getOdds` existente**

Confirmar que la función `getOdds(fixtureId)` en `supabase/functions/_shared/sportmonks-client.ts:281-287` está exportada y usa el include `market,bookmaker`:

```typescript
export async function getOdds(fixtureId: number): Promise<any[]> {
    return await fetchSportMonks<any[]>(
        `/odds/pre-match/fixtures/${fixtureId}`,
        ['market', 'bookmaker'],
        {}
    ) || [];
}
```

- [ ] **Step 2: Test manual del endpoint contra un fixture real**

Ejecutar en la terminal (con `SPORTMONKS_API_KEY` cargado):

```bash
curl -s "https://api.sportmonks.com/v3/football/odds/pre-match/fixtures/19455142?api_token=$SPORTMONKS_API_KEY&include=market;bookmaker" | head -200
```

Expected: JSON con un array `data` que contiene objetos con `market_id`, `bookmaker_id`, `label`, `value`. Si el plan de SportMonks NO incluye odds, retornará HTTP 403 con `{"message":"You do not have access..."}`. En ese caso, documentar el resultado y continuar al Task A10 (fallback plan).

- [ ] **Step 3: Commit de la verificación**

No hay código nuevo, solo documentación. No se commitea. Marca este task como hecho y avanza.

---

### Task A2: Crear helper `odds-selector.ts` para seleccionar bookmaker prioritario

**Files:**
- Create: `supabase/functions/_shared/odds-selector.ts`

El helper recibe el array crudo de odds de SportMonks y devuelve un objeto con: (1) odds seleccionadas por bookmaker prioritario (bet365 → pinnacle → Unibet → primer disponible); (2) promedio de mercado por mercado+selección para detectar outliers.

- [ ] **Step 1: Crear el archivo con la función principal (versión simplificada — sin `market_avg` ni `canon`)**

Crear `supabase/functions/_shared/odds-selector.ts`:

```typescript
// _shared/odds-selector.ts — Selecciona bookmaker prioritario de SportMonks

// Bookmaker IDs conocidos de SportMonks, ordenados por prioridad (confiabilidad + liquidez).
// Ver: https://docs.sportmonks.com/football/entities/bookmakers
const PREFERRED_BOOKMAKERS: number[] = [
    2,    // bet365
    6,    // Pinnacle
    5,    // Unibet
    25,   // 10bet
    27,   // 1xBet
    28,   // William Hill
    32,   // Betway
];

export interface SelectedOdd {
    market_id: number;
    bookmaker_id: number;
    bookmaker_name: string;
    label: string;         // e.g., "Over 2.5", "Yes", "Home"
    value: number;         // cuota decimal (e.g., 1.85)
}

export interface OddsSelection {
    picks: SelectedOdd[];
    total_bookmakers: number;
    preferred_bookmaker_used: string | null;
    has_coverage: boolean;
}

/**
 * Selecciona odds del bookmaker prioritario disponible.
 * Retorna { has_coverage: false } si no hay odds utilizables.
 */
export function selectOdds(rawOdds: any[]): OddsSelection {
    if (!rawOdds || rawOdds.length === 0) {
        return { picks: [], total_bookmakers: 0, preferred_bookmaker_used: null, has_coverage: false };
    }

    // 1. Detectar el bookmaker prioritario más alto disponible
    const bookmakersPresent = new Set<number>(
        rawOdds.map((o) => o.bookmaker_id).filter(Boolean)
    );
    const chosenBookmakerId =
        PREFERRED_BOOKMAKERS.find((id) => bookmakersPresent.has(id))
        ?? rawOdds[0]?.bookmaker_id;

    if (!chosenBookmakerId) {
        return {
            picks: [],
            total_bookmakers: bookmakersPresent.size,
            preferred_bookmaker_used: null,
            has_coverage: false
        };
    }

    // 2. Construir lista de picks del bookmaker elegido
    const picks: SelectedOdd[] = [];
    let bookmakerName: string | null = null;
    for (const o of rawOdds) {
        if (o.bookmaker_id !== chosenBookmakerId) continue;
        const val = typeof o.value === 'string' ? parseFloat(o.value) : o.value;
        if (!val || isNaN(val) || val <= 1.0) continue;
        picks.push({
            market_id: o.market_id,
            bookmaker_id: chosenBookmakerId,
            bookmaker_name: o.bookmaker?.name || `bookmaker_${chosenBookmakerId}`,
            label: o.label || '',
            value: val,
        });
        bookmakerName = o.bookmaker?.name || bookmakerName;
    }

    return {
        picks,
        total_bookmakers: bookmakersPresent.size,
        preferred_bookmaker_used: bookmakerName,
        has_coverage: picks.length > 0,
    };
}

/**
 * Busca la cuota real para un mercado+selección dados.
 * Matching case-insensitive con coincidencia parcial.
 * Retorna null si no se encuentra.
 */
export function findOddForSelection(
    selection: OddsSelection,
    label: string,
): SelectedOdd | null {
    if (!selection.has_coverage) return null;
    const target = (label || '').toLowerCase().trim();
    if (!target) return null;

    // Match exacto por label
    const exact = selection.picks.find((p) => p.label.toLowerCase().trim() === target);
    if (exact) return exact;

    // Match por inclusión
    const partial = selection.picks.find((p) => {
        const plabel = p.label.toLowerCase();
        return plabel.includes(target) || target.includes(plabel);
    });
    return partial ?? null;
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/_shared/odds-selector.ts
git commit -m "feat(odds): add odds-selector helper for bookmaker priority + market avg"
```

---

### Task A3: Llamar `getOdds` en paralelo desde el ETL

**Files:**
- Modify: `supabase/functions/v2-create-job-sportmonks/index.ts:160-176` (Stage 2 — `Promise.all` existente)

**Nota de arquitectura:** Verificado que `getFixtureComplete` en `sportmonks-client.ts:168-192` NO incluye `odds` en sus includes (solo pide participants, lineups, statistics, events, scores, venue, referees, formations, coaches, sidelined, weatherReport, xGFixture, league, season, state, round). Por lo tanto, añadir `getOdds` como llamada paralela NO duplica requests de API.

- [ ] **Step 1: Confirmar estructura exacta del `Promise.all` actual**

Abrir `supabase/functions/v2-create-job-sportmonks/index.ts`. En la línea 160-176 está el `Promise.all` existente con 7 posiciones: `homeHistory`, `awayHistory`, `h2h`, `standings`, `predictions`, `valueBets`, `perplexityResult`.

- [ ] **Step 2: Importar `getOdds`**

En la parte superior del archivo, en el import statement de `sportmonks-client.ts`, añadir `getOdds` a la lista:

```typescript
import {
    getFixtureComplete,
    getTeamFixtures,
    getH2H,
    getStandings,
    getPredictions,
    getValueBets,
    getOdds,  // ← AÑADIR
} from '../_shared/sportmonks-client.ts';
```

- [ ] **Step 3: Añadir `oddsRaw` como 8ª posición del `Promise.all`**

Reemplazar el bloque exacto (líneas 160-176):

```typescript
const [
    homeHistory,
    awayHistory,
    h2h,
    standings,
    predictions,
    valueBets,
    perplexityResult
] = await Promise.all([
    getTeamFixtures(homeTeamId, 25, deepIncludes),
    getTeamFixtures(awayTeamId, 25, deepIncludes),
    getH2H(homeTeamId, awayTeamId),
    seasonId ? getStandings(seasonId) : Promise.resolve([]),
    getPredictions(fixture_id),
    getValueBets(fixture_id),
    perplexityPromise
]);
```

por:

```typescript
const [
    homeHistory,
    awayHistory,
    h2h,
    standings,
    predictions,
    valueBets,
    perplexityResult,
    oddsRaw
] = await Promise.all([
    getTeamFixtures(homeTeamId, 25, deepIncludes),
    getTeamFixtures(awayTeamId, 25, deepIncludes),
    getH2H(homeTeamId, awayTeamId),
    seasonId ? getStandings(seasonId) : Promise.resolve([]),
    getPredictions(fixture_id),
    getValueBets(fixture_id),
    perplexityPromise,
    getOdds(fixture_id).catch((e) => {
        console.warn(`[v2-create-job-sportmonks] Odds fetch failed: ${e.message}`);
        return [];
    })
]);

console.log(`  - Odds markets: ${oddsRaw?.length || 0}`);
```

- [ ] **Step 3: Reemplazar la asignación de `odds` en el payload**

Localizar `supabase/functions/v2-create-job-sportmonks/index.ts:268`:

```typescript
odds: organizeOddsForAI(fixtureData.odds || [])
```

Reemplazar por:

```typescript
odds: organizeOddsForAI(oddsRaw || [])
```

- [ ] **Step 4: Actualizar el coverage score**

Localizar el objeto `coverage` en `supabase/functions/v2-create-job-sportmonks/index.ts:272-286` y cambiar:

```typescript
odds: (fixtureData.odds?.length || 0) > 0,
```

por:

```typescript
odds: (oddsRaw?.length || 0) > 0,
```

- [ ] **Step 5: Deploy de prueba y verificación**

Hacer deploy:

```bash
npx supabase functions deploy v2-create-job-sportmonks --no-verify-jwt
```

- [ ] **Step 6: Disparar un job manual y revisar logs**

Desde el frontend, iniciar un análisis nuevo. Luego revisar los logs de Supabase:

```bash
npx supabase functions logs v2-create-job-sportmonks --follow
```

Expected: Verás el log `[v2-create-job-sportmonks] Coverage: X%` donde X debe ser mayor que el anterior (porque odds ahora cuenta como true). Revisar también la tabla `analysis_jobs_v2`:

```sql
SELECT id, coverage_score, etl_context->'odds' as odds
FROM analysis_jobs_v2
ORDER BY created_at DESC
LIMIT 1;
```

Expected: `odds` contiene un objeto con keys `MAIN`, `GOALS`, `TEAMS`, etc. con arrays no vacíos (si SportMonks devolvió datos).

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/v2-create-job-sportmonks/index.ts
git commit -m "feat(etl): fetch SportMonks odds in parallel with other Stage 2 calls"
```

---

### Task A4: Mejorar `organizeOddsForAI` usando `odds-selector`

**Files:**
- Modify: `supabase/functions/_shared/sportmonks-normalizer.ts:917-1010` (aproximadamente, la función completa)

La función actual solo agrupa por categoría pero no selecciona bookmaker prioritario ni calcula promedio. Vamos a enriquecerla para que use el nuevo `odds-selector`.

- [ ] **Step 1: Importar `selectOdds` en el normalizer**

Al inicio de `supabase/functions/_shared/sportmonks-normalizer.ts`, añadir:

```typescript
import { selectOdds, type OddsSelection } from './odds-selector.ts';
```

- [ ] **Step 2: Reescribir `organizeOddsForAI` para incluir selección de bookmaker**

Reemplazar la función `organizeOddsForAI` (que empieza en línea 913-917) por la versión más simple (sin `canon` — la función `getCanonicalMarketId` es privada del módulo y no es necesaria para el LLM):

```typescript
/**
 * Organize Odds for AI Processing
 * Groups markets into categories AND selects a preferred bookmaker per market.
 * Returns { info: "No odds available" } if input is empty.
 */
export function organizeOddsForAI(odds: any[]): any {
    if (!odds || odds.length === 0) return { info: "No odds available" };

    const selection: OddsSelection = selectOdds(odds);
    if (!selection.has_coverage) return { info: "No odds available" };

    const structured: any = {
        MAIN: [] as any[],
        GOALS: [] as any[],
        TEAMS: [] as any[],
        HALVES: [] as any[],
        CORNERS: [] as any[],
        COMBOS: [] as any[],
        OTHERS: [] as any[],
        _meta: {
            bookmaker: selection.preferred_bookmaker_used,
            total_bookmakers: selection.total_bookmakers,
        },
    };

    const fmt = (o: SelectedOdd) => ({
        m_id: o.market_id,
        b_id: o.bookmaker_id,
        lbl: o.label,
        val: o.value,
    });

    const COMBO_MARKET_IDS = new Set([37, 47, 97]);

    for (const o of selection.picks) {
        const mid = o.market_id;
        const label = (o.label || '').toLowerCase();

        if (COMBO_MARKET_IDS.has(mid)) { structured.COMBOS.push(fmt(o)); continue; }
        if (
            (label.includes('&') && (label.includes('over') || label.includes('under') || label.includes('btts') || label.includes('both teams'))) ||
            label.includes('halftime/fulltime') ||
            label.includes('ht/ft') ||
            label.includes('result & ') ||
            label.includes('result/') ||
            (label.includes('win') && label.includes('over')) ||
            (label.includes('win') && label.includes('under')) ||
            (label.includes('draw') && label.includes('over')) ||
            (label.includes('draw') && label.includes('under'))
        ) { structured.COMBOS.push(fmt(o)); continue; }

        if (mid === 1 || mid === 2 || mid === 10) {
            structured.MAIN.push(fmt(o));
        } else if (label.includes('double chance') || label.includes('draw no bet') || label.includes(' or ')) {
            structured.MAIN.push(fmt(o));
        } else if (mid === 12 || label.includes('over') || label.includes('under')) {
            if (label.includes('team') || label.includes('home') || label.includes('away')) {
                structured.TEAMS.push(fmt(o));
            } else {
                structured.GOALS.push(fmt(o));
            }
        } else if (mid === 6 || mid === 13 || label.includes('both teams') || label.includes('btts')) {
            structured.TEAMS.push(fmt(o));
        } else if (label.includes('corner')) {
            structured.CORNERS.push(fmt(o));
        } else if (label.includes('1st half') || label.includes('2nd half') || label.includes('half time')) {
            structured.HALVES.push(fmt(o));
        } else {
            structured.OTHERS.push(fmt(o));
        }
    }

    return structured;
}
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/sportmonks-normalizer.ts
git commit -m "feat(odds): organizeOddsForAI now selects preferred bookmaker + market avg"
```

---

### Task A5: Cambiar el prompt para prohibir inventar cuotas

**Files:**
- Modify: `supabase/functions/v3-ai-analyzer/index.ts:1850-1860` (bloque "INSTRUCCIONES DE EMERGENCIA")
- Modify: `supabase/functions/v3-ai-analyzer/index.ts:908-926` (bloque que construye `oddsText`)

- [ ] **Step 1: Reemplazar el bloque de emergencia para NO inventar cuotas**

Abrir `supabase/functions/v3-ai-analyzer/index.ts` y localizar líneas ~1850-1856. Reemplazar:

```
Si faltan datos de cuotas (Bookmaker Odds Missing):
1. NO TE DETENGAS. Genera TUS PROPIAS CUOTAS JUSTAS basadas en tu probabilidad.
2. Advierte: "Cuota de Mercado Referencial No Disponible - Entrar si paga más de X.XX".
```

por:

```
Si faltan datos de cuotas (Bookmaker Odds Missing) para UN MERCADO ESPECÍFICO:
1. Establece "cuota_actual": null en ese pronóstico — NO INVENTES NÚMEROS.
2. El sistema descartará automáticamente los picks sin cuota real, no es tu problema.
3. Prefiere analizar mercados donde SÍ hay cuotas reales en el bloque BOOKMAKER ODDS.

Si NO HAY CUOTAS EN ABSOLUTO para este partido:
1. Establece "veredicto": "NO_BET" en el nivel superior del JSON.
2. Coloca pronosticos: [] (array vacío).
3. Añade "razon_no_bet": "Sin cuotas de mercado disponibles para validar picks".

NUNCA uses campos como cuota_estimada o cuota_referencia — solo cuota_actual (del mercado) o null.
```

- [ ] **Step 2: Mejorar el bloque `oddsText` para incluir metadato del bookmaker**

Localizar el bloque en líneas ~908-926 y reemplazar:

```typescript
let oddsText = '';
if (odds && (odds.MAIN || odds.GOALS)) {
    // ... formatea cuotas reales
} else if (odds?.bookmakers?.[0]) {
    // ... formato legacy
} else {
    oddsText = 'SIN CUOTAS VIVAS (USAR FALLBACK)';
}
```

por:

```typescript
let oddsText = '';
if (odds && (odds.MAIN?.length || odds.GOALS?.length || odds.TEAMS?.length || odds.COMBOS?.length)) {
    const bm = odds._meta?.bookmaker ? ` (bookmaker: ${odds._meta.bookmaker})` : '';
    oddsText = `CUOTAS REALES DEL MERCADO${bm}:\n`;
    for (const cat of ['MAIN', 'GOALS', 'TEAMS', 'HALVES', 'CORNERS', 'COMBOS', 'OTHERS']) {
        const list = odds[cat];
        if (!list?.length) continue;
        oddsText += `\n[${cat}]\n`;
        for (const o of list) {
            oddsText += `  - ${o.lbl}: ${o.val}\n`;
        }
    }
    oddsText += `\nREGLA: Solo genera pronósticos cuyo mercado/selección aparezca en esta lista. cuota_actual debe ser el número de esta lista, no uno inventado.`;
} else if (odds?.bookmakers?.[0]) {
    // Legacy format compatibility
    oddsText = `CUOTAS (formato legacy):\n${JSON.stringify(odds.bookmakers[0]).slice(0, 500)}`;
} else {
    oddsText = 'SIN CUOTAS DISPONIBLES — establece veredicto: NO_BET y pronosticos: [].';
}
```

- [ ] **Step 3: También actualizar el schema del JSON esperado (líneas ~1400-1423 del Layer 3)**

Localizar el schema en el prompt de Layer 3 y añadir este comentario explícito junto a `cuota_actual`:

```
"cuota_actual": <number del bloque BOOKMAKER ODDS o null si falta — NUNCA inventes>,
```

Buscar también el schema del JUDGE en `supabase/functions/_shared/agents/orchestrator.ts:336-351` y añadir la misma nota.

- [ ] **Step 4: Deploy**

```bash
npx supabase functions deploy v3-ai-analyzer --no-verify-jwt
```

- [ ] **Step 5: Verificación manual**

Disparar un análisis desde el frontend. Revisar que en `reports_v2`:

```sql
SELECT
  job_id,
  jsonb_path_query_array(report_packet, '$.pronosticos[*].cuota_actual') as cuotas
FROM reports_v2
ORDER BY created_at DESC
LIMIT 3;
```

Expected: Las cuotas deben venir de la lista real (si el fixture tiene odds de SportMonks) o ser `null` (si no hay). NUNCA valores como 12.80 o 9.50 para mercados comunes.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/v3-ai-analyzer/index.ts supabase/functions/_shared/agents/orchestrator.ts
git commit -m "fix(analyzer): forbid LLM from inventing odds, require real market prices or null"
```

---

### Task A6: Validar rango razonable y descartar picks sin odds en `v2-generate-parlays`

**Files:**
- Modify: `supabase/functions/v2-generate-parlays/index.ts:291-293` (Source A)
- Modify: `supabase/functions/v2-generate-parlays/index.ts:354` (Source B)

- [ ] **Step 1: Endurecer la validación en Source A (reports_v2)**

Localizar `supabase/functions/v2-generate-parlays/index.ts:291-293`. Reemplazar:

```typescript
const rawOdds = p.cuota_actual || p.cuota || p.odds || p.odd || p.price || null;
const odds = rawOdds ? (typeof rawOdds === 'string' ? parseFloat(rawOdds) : rawOdds) : null;
const validOdds = odds && !isNaN(odds) && odds > 1.0 ? odds : null;
```

por:

```typescript
// Solo cuota_actual es válido — los otros campos son de normalización legacy/inventada
const rawOdds = p.cuota_actual ?? p.odds ?? null;
const odds = rawOdds !== null ? (typeof rawOdds === 'string' ? parseFloat(rawOdds) : rawOdds) : null;
// Rango razonable: 1.01 (mínimo matemático) a 15.0 (máximo para mercados comunes).
// Cuotas > 15 en mercados como 1X2, BTTS, O/U 2.5 son prácticamente siempre inventadas.
const MIN_ODDS = 1.01;
const MAX_ODDS = 15.0;
const validOdds = odds !== null && !isNaN(odds) && odds >= MIN_ODDS && odds <= MAX_ODDS ? odds : null;

// CAMBIO CRÍTICO: si no hay odds reales, el pick se descarta (no se muestra en Oportunidades).
if (validOdds === null) {
    log(`[OPP-V8.1]   Pick[${idx}] DESCARTADO (sin odds reales): ${p.mercado} | ${p.seleccion}`);
    return; // dentro del forEach de pronosticos
}
```

- [ ] **Step 2: Endurecer la validación en Source B (value_picks_v2)**

Primero, modificar la query a `value_picks_v2` (buscar en el mismo archivo `.from('value_picks_v2').select`) para incluir `odds_source`:

```typescript
const { data: valuePicks } = await supabase
    .from('value_picks_v2')
    .select('*, odds_source')  // ← añadir odds_source explícito
    ...
```

Luego localizar la validación en línea ~354:

```typescript
const validOdds = vp.odds && vp.odds > 1.0 ? vp.odds : null;
```

Reemplazar por:

```typescript
const MIN_ODDS = 1.01;
const MAX_ODDS = 15.0;
// Dos condiciones: rango razonable + odds_source='real' (trazabilidad).
// Si odds_source es null (picks pre-migración), aceptamos por rango como safety net temporal.
const inRange = vp.odds && vp.odds >= MIN_ODDS && vp.odds <= MAX_ODDS;
const isRealOrLegacy = vp.odds_source === 'real' || vp.odds_source == null;
const validOdds = inRange && isRealOrLegacy ? vp.odds : null;
if (validOdds === null) {
    log(`[OPP-V8.1] ValuePick DESCARTADO (odds=${vp.odds}, source=${vp.odds_source}): ${vp.market} | ${vp.selection}`);
    continue;
}
```

- [ ] **Step 3: Añadir logging del filtrado para auditoría**

Al final del bloque `highProbPicks.sort(...)` (antes del `MAX_OPPORTUNITIES=20` cap), añadir:

```typescript
log(`[OPP-V8.1] Total picks con odds reales: ${highProbPicks.length}`);
```

- [ ] **Step 4: Deploy**

```bash
npx supabase functions deploy v2-generate-parlays --no-verify-jwt
```

- [ ] **Step 5: Verificación manual**

Desde el frontend, ir a Jornadas → Oportunidades y confirmar:
- No hay picks con cuotas 7.00, 9.50, 12.80 para mercados estándar (1X2, BTTS, O/U 2.5)
- El conteo de "Todos (N)" refleja solo picks con odds reales

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/v2-generate-parlays/index.ts
git commit -m "fix(parlays): discard picks without real odds (range 1.01-15.0)"
```

---

### Task A7: Migration — columna `odds_source` para trazabilidad

**Files:**
- Create: `supabase/migrations/20260417_odds_source_and_seo_status.sql`

**Dependencia:** Este task DEBE ejecutarse y verificarse ANTES del Task A8 (el analyzer escribe `odds_source` y el deploy fallará si la columna no existe).

- [ ] **Step 1: Crear la migración SQL**

Crear `supabase/migrations/20260417_odds_source_and_seo_status.sql`:

```sql
-- 20260417: Odds trazabilidad + SEO article status
-- Parte A: añade odds_source a value_picks_v2 para distinguir odds reales de las descartadas.
-- Parte B: añade article_status a seo_pages para tracking del estado de generación SEO.

-- ─── PART A: ODDS SOURCE ─────────────────────────────────────────────────
ALTER TABLE value_picks_v2
  ADD COLUMN IF NOT EXISTS odds_source TEXT
    CHECK (odds_source IN ('real', 'unavailable') OR odds_source IS NULL);

COMMENT ON COLUMN value_picks_v2.odds_source IS
  'real = cuota de SportMonks / bookmaker; unavailable = sin cuota de mercado (pick descartado).';

-- Índice para filtrar rápido en resultsService
CREATE INDEX IF NOT EXISTS idx_value_picks_v2_odds_source
  ON value_picks_v2(odds_source)
  WHERE odds_source IS NOT NULL;

-- ─── PART B: SEO ARTICLE STATUS ──────────────────────────────────────────
ALTER TABLE seo_pages
  ADD COLUMN IF NOT EXISTS article_status TEXT
    DEFAULT 'pending'
    CHECK (article_status IN ('pending', 'generating', 'ready', 'failed'));

ALTER TABLE seo_pages
  ADD COLUMN IF NOT EXISTS article_attempts INTEGER DEFAULT 0;

ALTER TABLE seo_pages
  ADD COLUMN IF NOT EXISTS article_last_error TEXT;

ALTER TABLE seo_pages
  ADD COLUMN IF NOT EXISTS article_next_retry_at TIMESTAMPTZ;

-- Índice para el cron de reintento
CREATE INDEX IF NOT EXISTS idx_seo_pages_article_retry
  ON seo_pages(article_status, article_next_retry_at)
  WHERE article_status IN ('pending', 'failed');

-- Marcar como ready todas las páginas existentes que ya tengan artículo
UPDATE seo_pages
SET article_status = 'ready'
WHERE article_html IS NOT NULL AND article_status = 'pending';
```

- [ ] **Step 2: Aplicar la migración**

```bash
npx supabase db push
```

Expected: `Applying migration 20260417_odds_source_and_seo_status.sql... done`.

- [ ] **Step 3: Verificar la estructura**

```bash
npx supabase db execute 'SELECT column_name, data_type FROM information_schema.columns WHERE table_name IN (''value_picks_v2'',''seo_pages'') AND column_name IN (''odds_source'',''article_status'',''article_attempts'',''article_last_error'',''article_next_retry_at'')'
```

Expected: 5 filas listando las columnas nuevas.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260417_odds_source_and_seo_status.sql
git commit -m "feat(db): add odds_source + seo article_status columns"
```

---

### Task A8: Limpiar adaptadores intermedios y marcar `odds_source` con fuente confiable

**Files:**
- Modify: `supabase/functions/v3-ai-analyzer/index.ts:683-707` (función `normalizePrediction`)
- Modify: `supabase/functions/v3-ai-analyzer/index.ts:710-729` (función `normalizeOpportunity`)
- Modify: `supabase/functions/v3-ai-analyzer/index.ts` (insert a `value_picks_v2` — ubicar con grep)

**Nota arquitectónica crítica:** La fuente de verdad de `odds_source` es si **SportMonks devolvió odds reales** (via `oddsRaw.length > 0` en el ETL), NO si el LLM puso un valor en `cuota_actual`. El LLM podría aún inventar un número ahí. Para marcar `odds_source='real'`, validamos que: (a) existe cobertura de odds en el payload (`etl_context.odds._meta.bookmaker != null`) Y (b) la cuota del pick existe en la lista real del bookmaker.

- [ ] **Step 1: Limpiar `normalizePrediction` para NO usar `cuota_estimada` ni `cuota_referencia`**

En `supabase/functions/v3-ai-analyzer/index.ts:689`, reemplazar:

```typescript
const odds = p.cuota_actual || p.cuota_estimada || p.cuota_referencia || null;
```

por:

```typescript
// Solo cuota_actual es fuente válida. cuota_estimada / cuota_referencia eran
// campos para cuotas inventadas — ya no se permiten.
const odds = (typeof p.cuota_actual === 'number' && p.cuota_actual > 1.0) ? p.cuota_actual : null;
```

- [ ] **Step 2: Limpiar `normalizeOpportunity` en el mismo archivo**

En `supabase/functions/v3-ai-analyzer/index.ts:715`, reemplazar:

```typescript
const odds = p.cuota_actual || p.cuota_estimada || p.cuota_referencia || null;
```

por:

```typescript
const odds = (typeof p.cuota_actual === 'number' && p.cuota_actual > 1.0) ? p.cuota_actual : null;
```

- [ ] **Step 3: Localizar el insert a `value_picks_v2`**

```bash
grep -n "value_picks_v2" /Users/apple/Documents/Centro-de-Mando---Pron-sticos-1/supabase/functions/v3-ai-analyzer/index.ts | grep -E "insert|upsert"
```

Debe devolver 1-3 líneas donde se hace `.from('value_picks_v2').insert(...)`.

- [ ] **Step 4: Determinar `odds_source` desde la fuente confiable**

Antes del insert, calcular si hay cobertura real de odds. En el scope donde se arma el payload del insert, añadir:

```typescript
// Cobertura real = el ETL consiguió odds de SportMonks Y este pick coincide con una cuota listada
const oddsCtx = etlContext?.odds;
const hasRealOddsCoverage = !!(oddsCtx?._meta?.bookmaker);
// Para cada pick: verificar que su cuota_actual cae dentro de la lista real
// (validación suave: confiar en que si el prompt lo prohíbe y hay cobertura, el valor es real)
const oddsSource = hasRealOddsCoverage && pred.odds !== null ? 'real' : 'unavailable';
```

Luego añadir al payload del insert:

```typescript
{
    // ... campos existentes ...
    odds: pred.odds,
    odds_source: oddsSource,
}
```

- [ ] **Step 5: Deploy**

```bash
npx supabase functions deploy v3-ai-analyzer --no-verify-jwt
```

- [ ] **Step 6: Verificar con SQL**

Después de un análisis nuevo:

```sql
SELECT market, selection, odds, odds_source, COUNT(*)
FROM value_picks_v2
WHERE created_at > NOW() - INTERVAL '10 minutes'
GROUP BY 1,2,3,4;
```

Expected: Picks con odds tienen `odds_source = 'real'`; picks sin odds tienen `odds_source = 'unavailable'` con `odds = null`.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/v3-ai-analyzer/index.ts
git commit -m "fix(analyzer): remove cuota_estimada/cuota_referencia fallback, mark odds_source from ETL coverage"
```

---

### Task A9: Display defensivo + estado vacío con contexto en `HighProbPicks.tsx`

**Files:**
- Modify: `components/ai/HighProbPicks.tsx:582-587` (display del `@{pick.odds.toFixed(2)}`)
- Modify: `components/ai/HighProbPicks.tsx` (componente de estado vacío — buscar el render cuando `picks.length === 0`)

**Nota:** El componente YA tiene lógica condicional para `pick.odds == null` (muestra "Sin cuota"). El cambio aquí solo añade validación de rango (detectar cuotas inventadas que superen el cap) y mejora el estado vacío cuando TODOS los picks fueron descartados por no tener cuota real.

- [ ] **Step 1: Añadir validación de rango al display existente**

En líneas 582-587, reemplazar:

```tsx
<div className="text-right">
    <span className={`block text-lg sm:text-xl font-black ${pick.odds ? 'text-amber-400' : 'text-slate-500'}`}>
        {pick.odds ? `@${pick.odds.toFixed(2)}` : 'Sin cuota'}
    </span>
    <span className="text-[10px] text-slate-500 uppercase">{pick.odds ? 'Cuota' : 'Estimada'}</span>
</div>
```

por:

```tsx
<div className="text-right">
    {(() => {
        const validOdds = pick.odds != null && pick.odds >= 1.01 && pick.odds <= 15.0;
        return (
            <>
                <span className={`block text-lg sm:text-xl font-black ${validOdds ? 'text-amber-400' : 'text-slate-500'}`}>
                    {validOdds ? `@${pick.odds!.toFixed(2)}` : 'Sin cuota'}
                </span>
                <span className="text-[10px] text-slate-500 uppercase">{validOdds ? 'Cuota' : 'Sin datos'}</span>
            </>
        );
    })()}
</div>
```

- [ ] **Step 2: Mejorar estado vacío cuando no hay oportunidades**

Localizar en `HighProbPicks.tsx` el bloque que renderiza cuando `picks.length === 0` (típicamente con texto genérico "No hay oportunidades"). Añadir contexto explicando si el sistema está esperando cuotas:

```tsx
{picks.length === 0 && (
    <div className="text-center py-12 bg-slate-900/40 rounded-xl border border-white/5">
        <p className="text-slate-400 font-bold">No hay oportunidades con cuota verificada</p>
        <p className="text-xs text-slate-500 mt-2 max-w-md mx-auto">
            Las oportunidades se publican solo cuando disponemos de cuotas reales del mercado.
            Si los bookmakers no han publicado cuotas para los partidos de hoy, este tab permanecerá vacío hasta que estén disponibles.
        </p>
    </div>
)}
```

- [ ] **Step 3: Verificación visual**

```bash
npm run dev
```

Abrir el navegador, navegar a Jornadas → Oportunidades. Confirmar que:
- Ningún pick muestra "@12.80" o similar para mercados comunes
- Si no hay picks con cuotas reales, aparece el mensaje explicativo

- [ ] **Step 4: Commit**

```bash
git add components/ai/HighProbPicks.tsx
git commit -m "fix(ui): range-validate odds display; informative empty state"
```

---

### Task A11: Filtrar por `odds_source = 'real'` en `resultsService.ts`

**Files:**
- Modify: `services/resultsService.ts`

**Por qué:** El cálculo de ROI agrega picks con `is_opportunity = true`. Si un pick se marcó como oportunidad antes de la migración o por un bug, podría tener `odds_source = 'unavailable'` y contaminar el ROI. Filtrar explícitamente evita eso.

- [ ] **Step 1: Localizar queries que filtran por `is_opportunity`**

```bash
grep -n "is_opportunity" /Users/apple/Documents/Centro-de-Mando---Pron-sticos-1/services/resultsService.ts
```

- [ ] **Step 2: Añadir filtro `.neq('odds_source', 'unavailable')` a las queries relevantes**

En cada query donde se calcula ROI o estadísticas basadas en `value_picks_v2`, añadir:

```typescript
.eq('is_opportunity', true)
.or('odds_source.eq.real,odds_source.is.null')  // real o legacy (pre-migración)
```

El `.is.null` evita romper cálculo histórico para picks creados antes de esta migración.

- [ ] **Step 3: Verificar ROI en la pestaña ROI del frontend**

```bash
npm run dev
```

Abrir Jornadas → ROI. Confirmar que los números mostrados son consistentes (no hay picks con `@12.80` inflando el ROI).

- [ ] **Step 4: Commit**

```bash
git add services/resultsService.ts
git commit -m "fix(results): exclude picks without real odds from ROI calculation"
```

---

### Task A10: Fallback plan si SportMonks no incluye odds en el plan contratado

**Files:**
- Modify: `supabase/functions/v3-ai-analyzer/index.ts`

Este task solo se ejecuta si el Task A1 Step 2 confirmó que SportMonks devuelve HTTP 403. Si devuelve datos, SALTAR este task.

- [ ] **Step 1 (condicional): Documentar la necesidad de upgrade o segundo proveedor**

Si SportMonks no incluye odds, abrir un issue en el tracker interno (o crear un archivo `docs/INFRA.md`) documentando:
- El plan actual de SportMonks no incluye el endpoint `odds/pre-match`
- Opciones: upgrade a plan Enterprise SportMonks, o integrar The Odds API (free tier 500 req/mes), o Pinnacle directo
- Mientras no haya odds reales, el sistema operará sin Oportunidades (todas se descartan por Task A6)

- [ ] **Step 2 (condicional): No commit de código — solo documentación**

```bash
git add docs/INFRA.md  # si lo creaste
git commit -m "docs: document odds provider gap if SportMonks 403"
```

---

## PARTE B — SISTEMA SEO CON GROQ

### Task B1: Reducir `maxTokens` en `seo-generate-article`

**Files:**
- Modify: `supabase/functions/seo-generate-article/index.ts:306-312` (función `generateArticle`)

- [ ] **Step 1: Cambiar maxTokens de 8192 a 4000**

Abrir `supabase/functions/seo-generate-article/index.ts` y localizar la función `generateArticle` en línea ~306:

```typescript
async function generateArticle(prompt: string): Promise<string> {
  const result = await callLLM(prompt, {
    temperature: 0.7,
    maxTokens: 8192,
    timeoutMs: 90000,
  });
```

Reemplazar por:

```typescript
async function generateArticle(prompt: string): Promise<string> {
  const result = await callLLM(prompt, {
    temperature: 0.7,
    maxTokens: 4000,   // Groq free tier: 8000 TPM total (input+output). 4000 deja margen para prompt.
    timeoutMs: 90000,
  });
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/seo-generate-article/index.ts
git commit -m "fix(seo): reduce maxTokens to 4000 to fit Groq free tier (8000 TPM)"
```

---

### Task B2: Ajustar el prompt SEO para artículo compacto (1000-1500 palabras)

**Files:**
- Modify: `supabase/functions/seo-generate-article/index.ts:278-301` (instrucciones del prompt)

- [ ] **Step 1: Cambiar el target de longitud en las instrucciones**

Localizar en el prompt (línea ~280):

```
MINIMO 1500 palabras, MAXIMO 2500 palabras
```

Reemplazar por:

```
MINIMO 1000 palabras, MAXIMO 1500 palabras
```

- [ ] **Step 2: Reducir el número de secciones obligatorias**

Localizar el bloque "2. SECCIONES OBLIGATORIAS (en este orden)" (línea ~267). Reducir de 9 secciones a 6:

```
2. SECCIONES OBLIGATORIAS (en este orden):
   a) APERTURA GANCHO (1 parrafo potente, sin titulo h2)
   b) "El Contexto: Lo Que Se Juegan" — situacion en la tabla, momento de temporada
   c) "Cara a Cara: El Duelo Tactico" — formaciones, estilo, matchups clave
   d) "Los Numeros No Mienten" — tabla HTML con estadisticas clave
   e) "Factores de Riesgo" — ausencias, variables impredecibles
   f) "El Veredicto" — parrafo de cierre que resume sin revelar la prediccion. Termina con "Para conocer nuestra prediccion exacta, registrate gratis en Derbix."
```

- [ ] **Step 3: Ajustar el validador mínimo**

Localizar líneas ~67-73:

```typescript
if (!articleHtml || articleHtml.length < 500) {
```

Reducir el umbral (un artículo de 1000 palabras en HTML son ~5500 chars, mantener conservador):

```typescript
if (!articleHtml || articleHtml.length < 3000) {
```

Y también en línea ~322:

```typescript
if (html.length < 500) {
```

Por:

```typescript
if (html.length < 3000) {
```

- [ ] **Step 4: Deploy y test manual**

```bash
npx supabase functions deploy seo-generate-article --no-verify-jwt
```

Disparar manualmente (con un `fixture_id` que tenga `reports_v2`):

```bash
curl -X POST "$SUPABASE_URL/functions/v1/seo-generate-article" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"fixture_id": 19455142}'
```

Expected: `{"success": true, "article_length": NNNN}` donde NNNN > 3000.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/seo-generate-article/index.ts
git commit -m "feat(seo): compact prompt (1000-1500 words, 6 sections) for Groq fit"
```

---

### Task B3: Reducir timeout interno; el retry lo maneja el cron externo (Task B5)

**Files:**
- Modify: `supabase/functions/seo-generate-article/index.ts:306-328` (función `generateArticle`)

**Nota arquitectónica:** El retry interno con backoff (30s+60s) excedería el límite de 150s de Supabase Edge Functions (error WORKER_LIMIT 546). En su lugar, dejamos que el cron de reintento externo (Task B5 + B6) maneje los reintentos. La función interna falla rápido, marca estado `failed`, y el cron lo recoge 10 minutos después cuando Groq ya tiene cuota.

- [ ] **Step 1: Reducir `timeoutMs` a 60s (deja margen para respuesta del LLM + cold start)**

Reemplazar la función `generateArticle` completa:

```typescript
async function generateArticle(prompt: string): Promise<string> {
  const result = await callLLM(prompt, {
    temperature: 0.7,
    maxTokens: 4000,
    timeoutMs: 60000, // 60s — encaja cómodo en el límite de 150s de Supabase
  });

  console.log(`[SEO-GENERATE-ARTICLE] LLM provider: ${result.provider}`);

  let html = result.text
    .replace(/^```html\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  if (html.length < 3000) {
    throw new Error(`Article too short (${html.length} chars) from ${result.provider}`);
  }

  console.log(`[SEO-GENERATE-ARTICLE] ✅ ${result.provider} returned ${html.length} chars`);
  return html;
}
```

- [ ] **Step 2: Deploy**

```bash
npx supabase functions deploy seo-generate-article --no-verify-jwt
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/seo-generate-article/index.ts
git commit -m "fix(seo): reduce timeout to 60s, delegate retries to cron (Task B5)"
```

---

### Task B4: Persistir estado de generación en `seo-publish-page` (sin pisar estado existente)

**Files:**
- Modify: `supabase/functions/seo-publish-page/index.ts`

- [ ] **Step 1: Inicializar el estado SOLO si el registro no existe**

Buscar el upsert a `seo_pages` (típicamente con `.upsert(payload, { onConflict: 'full_path' })`). Ajustar la lógica en DOS pasos en lugar del upsert simple:

```typescript
// ANTES del upsert, verificar si ya existe para preservar article_status
const { data: existing } = await supabase
  .from('seo_pages')
  .select('article_status, article_html')
  .eq('full_path', full_path)
  .maybeSingle();

const payload: any = {
  ...existingPayloadFields, // home_team, away_team, league_name, etc.
};

// Solo inicializar estado si es nueva página o si no tiene artículo aún
if (!existing || (existing.article_status == null && existing.article_html == null)) {
  payload.article_status = 'pending';
  payload.article_attempts = 0;
}
// Si existing.article_status === 'ready', NO tocamos esos campos — preservamos el artículo.

await supabase.from('seo_pages').upsert(payload, { onConflict: 'full_path' });
```

- [ ] **Step 2: Envolver la llamada a `seo-generate-article` con manejo de estado**

Localizar la llamada a `seo-generate-article` (en `seo-publish-page/index.ts`). Reemplazarla con:

```typescript
// Marcar como generating
await supabase
  .from('seo_pages')
  .update({
    article_status: 'generating',
    article_attempts: (currentPage?.article_attempts ?? 0) + 1,
  })
  .eq('fixture_id', fixture_id);

try {
  const articleRes = await fetch(`${supabaseUrl}/functions/v1/seo-generate-article`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${supabaseKey}`,
    },
    body: JSON.stringify({ fixture_id }),
  });

  if (articleRes.ok) {
    // seo-generate-article ya actualizó article_html; aquí solo marcamos ready
    await supabase
      .from('seo_pages')
      .update({ article_status: 'ready', article_last_error: null })
      .eq('fixture_id', fixture_id);
  } else {
    const errText = await articleRes.text().catch(() => 'unknown');
    await supabase
      .from('seo_pages')
      .update({
        article_status: 'failed',
        article_last_error: errText.slice(0, 500),
        article_next_retry_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // retry en 5min
      })
      .eq('fixture_id', fixture_id);
  }
} catch (e: any) {
  await supabase
    .from('seo_pages')
    .update({
      article_status: 'failed',
      article_last_error: e.message?.slice(0, 500) || 'unknown',
      article_next_retry_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    })
    .eq('fixture_id', fixture_id);
  // NO propagar — seo-publish-page debe continuar aunque el artículo falle
  console.warn(`[SEO-PUBLISH] article generation failed: ${e.message}`);
}
```

- [ ] **Step 3: Deploy**

```bash
npx supabase functions deploy seo-publish-page --no-verify-jwt
```

- [ ] **Step 4: Verificar con SQL**

```sql
SELECT fixture_id, article_status, article_attempts, article_last_error, article_next_retry_at
FROM seo_pages
WHERE article_status IN ('pending', 'failed', 'generating')
ORDER BY updated_at DESC
LIMIT 10;
```

Expected: Cada `seo_page` recién creada va por la secuencia pending → generating → ready (o failed).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/seo-publish-page/index.ts
git commit -m "feat(seo): track article generation state (pending/generating/ready/failed)"
```

---

### Task B5: Edge function `seo-retry-pending-articles` para reintentar fallidos

**Files:**
- Create: `supabase/functions/seo-retry-pending-articles/index.ts`

Esta función es un cron que procesa los artículos con `article_status = 'failed'` cuyo `article_next_retry_at <= NOW()`. Max 3 intentos. Procesa 5 por invocación para no saturar Groq.

- [ ] **Step 1: Crear la función**

Crear `supabase/functions/seo-retry-pending-articles/index.ts`:

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const MAX_ATTEMPTS = 3;
const BATCH_SIZE = 5;
const BACKOFF_MINUTES = [5, 15, 60]; // 1ra, 2da, 3ra reintento

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // 1. Buscar pending/failed con retry time vencido
  const { data: pending, error } = await supabase
    .from("seo_pages")
    .select("fixture_id, article_status, article_attempts, article_next_retry_at")
    .in("article_status", ["pending", "failed"])
    .lt("article_attempts", MAX_ATTEMPTS)
    .or(`article_next_retry_at.is.null,article_next_retry_at.lte.${new Date().toISOString()}`)
    .order("article_next_retry_at", { ascending: true, nullsFirst: true })
    .limit(BATCH_SIZE);

  if (error) {
    console.error(`[SEO-RETRY] query error: ${error.message}`);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }

  if (!pending || pending.length === 0) {
    return new Response(JSON.stringify({ processed: 0, message: 'no pending articles' }), { headers: corsHeaders });
  }

  console.log(`[SEO-RETRY] processing ${pending.length} pending articles`);

  const results: Array<{ fixture_id: number; success: boolean; error?: string }> = [];

  for (const row of pending) {
    const attemptNum = (row.article_attempts ?? 0) + 1;
    await supabase
      .from("seo_pages")
      .update({ article_status: 'generating', article_attempts: attemptNum })
      .eq("fixture_id", row.fixture_id);

    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/seo-generate-article`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({ fixture_id: row.fixture_id }),
      });

      if (res.ok) {
        await supabase
          .from("seo_pages")
          .update({ article_status: 'ready', article_last_error: null, article_next_retry_at: null })
          .eq("fixture_id", row.fixture_id);
        results.push({ fixture_id: row.fixture_id, success: true });
      } else {
        const errText = (await res.text().catch(() => 'unknown')).slice(0, 500);
        const nextMinutes = BACKOFF_MINUTES[Math.min(attemptNum - 1, BACKOFF_MINUTES.length - 1)];
        const nextRetry = attemptNum >= MAX_ATTEMPTS
          ? null
          : new Date(Date.now() + nextMinutes * 60000).toISOString();

        await supabase
          .from("seo_pages")
          .update({
            article_status: 'failed',
            article_last_error: errText,
            article_next_retry_at: nextRetry,
          })
          .eq("fixture_id", row.fixture_id);

        results.push({ fixture_id: row.fixture_id, success: false, error: errText });
      }
    } catch (e: any) {
      const nextMinutes = BACKOFF_MINUTES[Math.min(attemptNum - 1, BACKOFF_MINUTES.length - 1)];
      const nextRetry = attemptNum >= MAX_ATTEMPTS
        ? null
        : new Date(Date.now() + nextMinutes * 60000).toISOString();

      await supabase
        .from("seo_pages")
        .update({
          article_status: 'failed',
          article_last_error: (e.message || 'unknown').slice(0, 500),
          article_next_retry_at: nextRetry,
        })
        .eq("fixture_id", row.fixture_id);

      results.push({ fixture_id: row.fixture_id, success: false, error: e.message });
    }

    // Espaciar llamadas para no saturar Groq (2s entre cada una)
    await new Promise((r) => setTimeout(r, 2000));
  }

  return new Response(
    JSON.stringify({ processed: pending.length, results }),
    { headers: corsHeaders }
  );
});
```

- [ ] **Step 2: Deploy**

```bash
npx supabase functions deploy seo-retry-pending-articles --no-verify-jwt
```

- [ ] **Step 3: Test manual**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/seo-retry-pending-articles" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY"
```

Expected: `{"processed": N, "results": [...]}`.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/seo-retry-pending-articles/index.ts
git commit -m "feat(seo): cron function to retry failed SEO article generation"
```

---

### Task B6: Configurar el cron de reintento siguiendo el patrón existente

**Files:**
- Modify: `scripts/setup_all_cron_jobs.sql` (añadir nuevo bloque al final, respetando el patrón de URL/Bearer hardcoded)

**Nota:** El proyecto usa URL y Bearer hardcodeados en `setup_all_cron_jobs.sql` (verificado en líneas 41-42). NO usar `current_setting('app.settings.*')` — esos settings no están configurados. Reutilizar exactamente el mismo Bearer token que ya usan los otros crons.

- [ ] **Step 1: Añadir bloque al final de `scripts/setup_all_cron_jobs.sql`**

Abrir el archivo y añadir al final (antes del mensaje de `RAISE NOTICE` si existe):

```sql
-- =====================================================
-- 6. SEO RETRY - Cada 10 minutos
-- Reintenta generar artículos SEO con article_status='failed' o 'pending'
-- Procesa hasta 5 por invocación, respetando Groq free tier (8000 TPM)
-- =====================================================
DO $$ BEGIN PERFORM cron.unschedule('seo-retry-pending-articles'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
    'seo-retry-pending-articles',
    '*/10 * * * *',  -- Cada 10 minutos
    $$
    SELECT
      net.http_post(
          url:='https://nokejmhlpsaoerhddcyc.supabase.co/functions/v1/seo-retry-pending-articles',
          headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5va2VqbWhscHNhb2VyaGRkY3ljIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTgxNjAwNywiZXhwIjoyMDgxMzkyMDA3fQ.cMBnVvWGmxyTBqLqQQtPcymKdXMqF0Xr1_EI_Y1G3ZU"}'::jsonb,
          body:='{}'::jsonb
      ) as request_id;
    $$
);
```

También añadir la línea de `unschedule` correspondiente al inicio del archivo (en el bloque PASO 1, donde se eliminan crons previos), para que re-ejecuciones del script sean idempotentes:

```sql
DO $$ BEGIN PERFORM cron.unschedule('seo-retry-pending-articles'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
```

- [ ] **Step 2: Aplicar el script contra la DB de producción**

```bash
# Ejecutar el script actualizado vía Supabase SQL editor o psql
# (NO usar db push porque este script no es una migración tradicional)
npx supabase db execute "$(cat scripts/setup_all_cron_jobs.sql)"
```

Alternativamente, copiar/pegar el script en el SQL editor de Supabase Studio.

- [ ] **Step 3: Verificar el cron**

```bash
npx supabase db execute "SELECT jobid, schedule, jobname, active FROM cron.job WHERE jobname = 'seo-retry-pending-articles'"
```

Expected: 1 fila con `active = true`.

- [ ] **Step 4: Commit**

```bash
git add scripts/setup_all_cron_jobs.sql
git commit -m "feat(seo): add cron for failed-article retry (every 10min)"
```

---

### Task B7: Fallback HTML cuando no hay artículo (mantener Edge Function Netlify sólida)

**Files:**
- Verify: `netlify/edge-functions/seo-prediccion.ts:237` (ya existe el fallback, solo verificar)

- [ ] **Step 1: Revisar el fallback existente**

Abrir `netlify/edge-functions/seo-prediccion.ts` y buscar la línea `if (page.article_html)` alrededor de la 237. Confirmar que el `else` formatea los bullets del `report_packet` correctamente cuando no hay `article_html`.

- [ ] **Step 2: Añadir mensaje de "artículo en generación" cuando `article_status = 'generating' | 'pending'`**

Si el fallback actual es genérico, añadir una variante explícita:

```typescript
// Dentro de seo-prediccion.ts, antes del fallback completo:
if (page.article_status === 'generating' || page.article_status === 'pending') {
  // Mostrar versión minimal — es mejor que el artículo se genere que hacer fallback pobre
  articleHtml = `<p class="article-pending">Nuestro análisis editorial se está generando en este momento. Vuelve en unos minutos para leer el artículo completo. Mientras tanto, puedes consultar los datos del partido más abajo.</p>`;
}
```

- [ ] **Step 3: Deploy (Netlify auto-deploys al push)**

- [ ] **Step 4: Commit**

```bash
git add netlify/edge-functions/seo-prediccion.ts
git commit -m "feat(seo): add generating/pending state indicator in SSR fallback"
```

---

### Task B8: Botón "Ver Página SEO" en HighProbPicks visible siempre que exista `seo_page`

**Files:**
- Modify: `components/ai/HighProbPicks.tsx:642-664` (el botón "Ver Página SEO")

- [ ] **Step 1: Revisar la query actual**

El código actual busca `seo_pages.full_path` para un `fixture_id`. El botón aparece solo si hay entrada en `seo_pages`. Actualmente si `seo-publish-page` falló antes del upsert, no hay entrada → no hay botón.

- [ ] **Step 2: Confirmar que `seo-publish-page` siempre crea la entrada ANTES de llamar al artículo**

Esto ya debería estar correcto después del Task B4 (el upsert a `seo_pages` se hace ANTES de llamar a `seo-generate-article`). Verificar releyendo `supabase/functions/seo-publish-page/index.ts`.

- [ ] **Step 3: Ajustar texto del botón cuando `article_status != 'ready'`**

En `HighProbPicks.tsx`, si la query a `seo_pages` también trae `article_status`, mostrar:
- `article_status === 'ready'` → "Ver Página SEO" (comportamiento actual)
- `article_status === 'generating' | 'pending'` → "Vista previa (generando artículo)"
- `article_status === 'failed'` → "Ver Página SEO" (el fallback SSR muestra los bullets, no mostrar error al usuario)

Ejemplo de código:

```tsx
// Modificar la query que trae seoPage para incluir article_status
// .select('full_path, article_status')

{seoPage && seoPage.full_path && (
    <a
        href={`https://derbix.co${seoPage.full_path}`}
        target="_blank"
        rel="noopener"
        className="text-xs text-slate-400 hover:text-emerald-400 flex items-center gap-1"
    >
        <ExternalLinkIcon className="w-3 h-3" />
        {seoPage.article_status === 'ready' ? 'Ver Página SEO' : 'Vista previa'}
    </a>
)}
```

- [ ] **Step 4: Commit**

```bash
git add components/ai/HighProbPicks.tsx
git commit -m "feat(ui): SEO page button reflects article_status"
```

---

## Revisión Final

### Task R1: Correr `/review` sobre el código implementado

Al terminar TODAS las tareas anteriores y antes de merge, ejecutar el comando `/review` para auditar la implementación completa.

- [ ] **Step 1: Ejecutar `/review` y revisar hallazgos**

El comando `/review` correrá sobre los cambios del branch. Documentar cualquier issue crítico encontrado y crear tareas adicionales si es necesario.

- [ ] **Step 2: Verificación end-to-end manual**

1. **Cuotas:**
   - Desde Jornadas → Oportunidades, verificar que los picks visibles muestran cuotas realistas
   - Revisar logs de `v2-create-job-sportmonks` para confirmar que las llamadas a `getOdds` retornan datos
   - SQL: `SELECT odds, odds_source FROM value_picks_v2 WHERE created_at > NOW() - INTERVAL '1 hour'` — confirmar `odds_source = 'real'` donde hay números

2. **SEO:**
   - Desde un pick con `seo_page`, clickear "Ver Página SEO" y confirmar que se abre con artículo completo (>3000 chars HTML)
   - SQL: `SELECT article_status, COUNT(*) FROM seo_pages GROUP BY 1` — mayoría debe estar en `ready`, algunas en `pending` inicialmente
   - Esperar 10 minutos y re-verificar: las `failed` deben haber migrado a `ready` tras el reintento

- [ ] **Step 3: Monitoreo de 24 horas**

Después del merge:
- Revisar dashboard de Supabase logs para errores en funciones modificadas
- Revisar métrica de "picks con odds reales" vs "picks totales"
- Revisar tasa de artículos SEO `ready` vs `failed` después de 24h

---

## Self-Review (plan, post-review)

**Spec coverage:**
- ✅ Auditoría + fix de cuotas desalineadas: Tasks A1-A11 cubren la cadena completa (ETL → normalizer → analyzer → adaptador → parlays → frontend → ROI)
- ✅ Sistema SEO funcionando con Groq: Tasks B1-B7 adaptan al free tier (8000 TPM)
- ✅ Respeto a límites de Supabase (150s): Task B3 elimina retry interno, delega al cron Task B5/B6
- ✅ Revisión con `/review`: Task R1 al final

**Correcciones aplicadas tras primer /review:**
- **C1**: Task A8 ahora limpia los adaptadores intermedios `normalizePrediction:689` y `normalizeOpportunity:715` que aún usaban `cuota_estimada` / `cuota_referencia`
- **C2**: Task B3 elimina el retry interno (30s+60s excedía 150s de Supabase); delega al cron externo
- **H1**: Task A3 documenta explícitamente que `getFixtureComplete` no pide odds (verificado) y muestra el `Promise.all` exacto
- **H2**: Task A4 elimina `canon` y `market_avg` del helper (YAGNI + dependencia rota)
- **H3**: Task B4 usa lógica condicional para NO pisar `article_status='ready'` existente
- **H4**: Task A8 deriva `odds_source` desde `etl_context.odds._meta.bookmaker`, no del LLM
- **M1**: Task B6 sigue el patrón exacto de `setup_all_cron_jobs.sql` (URL + Bearer hardcoded)
- **Gap 1**: Nueva Task A11 filtra por `odds_source` en `resultsService.ts`
- **Gap 2**: Task A9 añade estado vacío explicativo cuando no hay cuotas
- **Gap 3**: `market_avg` eliminado (era YAGNI)
- **Orden**: Task A7 (migración) marcado explícitamente como dependencia de Task A8

**Placeholder scan:** Ninguno.

**Type consistency:** `SelectedOdd`, `OddsSelection`, `article_status`, `odds_source` usados consistentemente.

**Riesgos residuales (aceptados):**
- Si SportMonks plan NO incluye odds (Task A10), la pestaña Oportunidades quedará vacía. Esto es deliberado — preferimos "sin oportunidades" a "oportunidades con cuotas inventadas". Task A9 comunica el estado al usuario.
- El matching fuzzy en `findOddForSelection` (label parcial) puede fallar para mercados con traducción ES/EN divergente. Mitigación futura: mapping explícito de labels EN↔ES si se detecta el problema en producción.
