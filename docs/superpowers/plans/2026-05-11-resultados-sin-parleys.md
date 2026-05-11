# Resultados sin Parleys + Filtrado por Plan — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar completamente los parleys de la plataforma (popup, UI, servicios, edge functions, cron, tipos) y reestructurar la sección Resultados para que admins puedan filtrar por cualquier plan y usuarios finales vean por defecto su propio plan + un botón para ver el plan más alto ("Plan Máquina").

**Architecture:** Tres frentes en orden de menor a mayor riesgo. (1) Limpieza quirúrgica del popup `DailyRecapModal` — sólo afecta lo que el usuario ve al login. (2) Remoción completa de parleys de toda la plataforma manteniendo tablas DB intactas (no se hace `DROP TABLE`, sólo se desconecta el código y se desactiva el cron) para preservar histórico. (3) Reestructuración de `ResultadosPublic` con un selector visible: para admin un dropdown con los 4 planes, para usuario final un toggle "Mi Plan / Plan Máquina". Premium ve sólo su plan (ya es el más alto).

**Tech Stack:** React 19 + TypeScript + Vite + TailwindCSS, Supabase Edge Functions (Deno), PostgreSQL.

**Reglas:**
- ❌ NO hacer `DROP TABLE` en este plan. Las tablas `parlays`, `parlay_combos_v2`, `parlay_picks_v2`, `daily_auto_parlays` se mantienen para preservar histórico verificado. Sólo se desconecta el código.
- ❌ NO eliminar la columna `subscription_plans.parlay_percentage` en este plan (riesgo bajo, eliminación posterior).
- ✅ Sí eliminar los archivos de UI/services de parley que ya no se usan.
- ✅ Deploy frontend = `git push origin main` (Netlify auto-deploy).
- ✅ Deploy edge functions = `npx supabase functions deploy <nombre> --no-verify-jwt` (sólo las modificadas).

---

## FASE 1 — Limpiar Parleys del Popup DailyRecapModal

Bajo riesgo, alto impacto visual. Esto es lo PRIMERO que ve el usuario al login y hoy mezcla parleys con picks individuales.

### Tarea 1.1: Quitar la sección "Smart Parlays" del modal

**Files:**
- Modify: `components/recap/DailyRecapModal.tsx:487-510`

- [ ] **Step 1: Eliminar el bloque JSX completo de Smart Parlays**

En `components/recap/DailyRecapModal.tsx`, eliminar las líneas 487-510 (incluye el comentario `--- PARLAYS (starter+) ---` y todo el bloque `<motion.div>`):

Buscar y eliminar:

```tsx
                    {/* --- PARLAYS (starter+) --- */}
                    {isAtLeast('starter') && data.parlays && data.parlays.totalVerified > 0 && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 0.75 }}
                            className="mx-6 mb-4 px-4 py-3 rounded-xl bg-white/[0.03] border border-white/5"
                        >
                            <h4 className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">Smart Parlays</h4>
                            <div className="flex items-center gap-4">
                                <span className="text-sm">
                                    <span className="text-emerald-400 font-bold">{data.parlays.won}</span>
                                    <span className="text-slate-600 mx-1">/</span>
                                    <span className="text-red-400 font-bold">{data.parlays.lost}</span>
                                    <span className="text-slate-500 text-xs ml-1">({data.parlays.totalVerified} total)</span>
                                </span>
                                {data.parlays.bestOdds && data.parlays.bestOdds > 0 && (
                                    <span className="text-xs text-amber-400 font-semibold">
                                        Mejor: @{data.parlays.bestOdds.toFixed(2)}
                                    </span>
                                )}
                            </div>
                        </motion.div>
                    )}
```

### Tarea 1.2: Quitar parleys del recapService y del tipo DailyRecapData

**Files:**
- Modify: `services/recapService.ts:139-147`
- Modify: `services/recapService.ts:35` (cambiar filter `'all'` → `'picks'`)
- Modify: `services/recapService.ts:53` (cambiar filter `'all'` → `'picks'`)
- Modify: `types.ts:794-800` (eliminar propiedad `parlays`)

- [ ] **Step 1: Cambiar filter en `fetchPeriodStats` para excluir parleys**

En `services/recapService.ts:35`, cambiar:

```ts
const data = await getPublicResults(startDate, endDate, 'all');
```

por:

```ts
const data = await getPublicResults(startDate, endDate, 'picks');
```

- [ ] **Step 2: Cambiar filter en `fetchDailyRecapData` principal**

En `services/recapService.ts:53`, cambiar:

```ts
const publicResults = await getPublicResults(yesterday, yesterday, 'all');
```

por:

```ts
const publicResults = await getPublicResults(yesterday, yesterday, 'picks');
```

- [ ] **Step 3: Eliminar la propiedad `parlays` del objeto `recapData`**

En `services/recapService.ts:139-147`, eliminar:

```ts
        parlays: publicResults.parlays ? {
            won: publicResults.parlays.won,
            lost: publicResults.parlays.lost,
            totalVerified: publicResults.parlays.totalVerified,
            bestOdds: publicResults.parlays.recentResults
                .filter(p => p.status === 'WON')
                .reduce((max, p) => Math.max(max, p.combined_odds || 0), 0) || undefined,
        } : undefined,
```

- [ ] **Step 4: Eliminar la propiedad `parlays` del tipo `DailyRecapData`**

En `types.ts` (líneas 794-800 aprox.), eliminar el bloque:

```ts
    // Parlays (starter+)
    parlays?: {
        won: number;
        lost: number;
        totalVerified: number;
        bestOdds?: number;
    };
```

- [ ] **Step 5: Verificar typecheck**

Ejecutar:

```bash
npx tsc --noEmit
```

Esperado: sin errores relacionados a `parlays` en `DailyRecapData` o `recapService`. Si aparecen, son indicador de que existen otras referencias que deben limpiarse en Fase 2.

- [ ] **Step 6: Commit**

```bash
git add components/recap/DailyRecapModal.tsx services/recapService.ts types.ts
git commit -m "feat(recap): remove parleys from daily recap popup"
```

---

## FASE 2 — Remover Parleys de la Plataforma

Limpieza completa: UI, navegación, servicios, edge functions, cron, system_settings, types. Mantenemos las tablas DB para no perder histórico.

### Tarea 2.1: Quitar tab "Smart Parlays" de LiveFeed

**Files:**
- Modify: `components/LiveFeed.tsx:14,154` (y cualquier render condicional `viewMode === 'parlays'`)

- [ ] **Step 1: Leer el archivo y localizar las líneas exactas**

```bash
grep -n "parlay\|smart-parlay\|SmartParlays" components/LiveFeed.tsx
```

- [ ] **Step 2: Eliminar import de SmartParlays (si existe) y el botón/tab del menú**

En `components/LiveFeed.tsx`, en la declaración del tipo:

```ts
const [viewMode, setViewMode] = useState<'fixtures' | 'top-picks' | 'parlays'>('top-picks');
```

cambiar a:

```ts
const [viewMode, setViewMode] = useState<'fixtures' | 'top-picks'>('top-picks');
```

Eliminar también:
- Cualquier botón `<button onClick={() => setViewMode('parlays')}>...</button>` en la barra de tabs.
- Cualquier render `{viewMode === 'parlays' && <SmartParlays ... />}`.
- Cualquier import `import { SmartParlays } from './ai/SmartParlays'` o similar.

- [ ] **Step 3: Verificar visualmente la barra de tabs queda con 3 items**

Tabs esperados: Oportunidades → Partidos → ROI. (Smart Parlays eliminado).

### Tarea 2.2: Quitar tab "Constructor de Parlays" de AiAnalysis

**Files:**
- Modify: `components/ai/AiAnalysis.tsx`

- [ ] **Step 1: Localizar y eliminar todo lo relacionado a parlays**

```bash
grep -n "parlay\|ParlayBuilder" components/ai/AiAnalysis.tsx
```

- [ ] **Step 2: Eliminar import, tab definition, y case del switch**

Eliminar:
- `import { ParlayBuilder } from './ParlayBuilder';`
- En la definición de tabs: `{ id: 'parlay', name: 'Constructor de Parlays', icon: <PuzzlePieceIcon /> },`
- En el tipo: `type AiTab = 'parlay' | 'compare';` → debe quedar sólo `'compare'` (o el resto de tabs que existan).
- En el switch/render: `case 'parlay': return <ParlayBuilder />;`
- Cualquier `setActiveTab('parlay')` en otros lugares.

Si después de eliminar `'parlay'` el archivo queda con un solo tab, considerar simplificar el componente para no mostrar tabs.

### Tarea 2.3: Quitar filtro y sección Parlays de ResultadosPublic

**Files:**
- Modify: `components/live/ResultadosPublic.tsx` (múltiples líneas — ver pasos)

- [ ] **Step 1: Eliminar el tipo `ResultFilter` y la constante `RESULT_FILTERS`**

En `components/live/ResultadosPublic.tsx`:

- Línea 8: cambiar `import type { PublicResultsData, ParlayResultData, PickResult, PlanTier } from '../../types';` por `import type { PublicResultsData, PickResult, PlanTier } from '../../types';`
- Línea 17: eliminar `type ResultFilter = 'all' | 'picks' | 'parlays';`
- Líneas 28-32: eliminar la constante `RESULT_FILTERS`.

- [ ] **Step 2: Eliminar el state `resultFilter` y todas sus referencias**

- Línea 93: eliminar `const [resultFilter, setResultFilter] = useState<ResultFilter>('all');`
- Línea 106: ajustar `cacheKey` para no incluir `resultFilter`:
  ```ts
  const cacheKey = `results_${selectedPeriod}_${effectiveViewMode}_${planName}`;
  ```
- Línea 123: cambiar `getResultsByPlan(startDate, endDate, planName, resultFilter)` por `getResultsByPlan(startDate, endDate, planName)` (parámetro `filter` se eliminará en tarea 2.6).
- Línea 125: cambiar `getPublicResults(startDate, endDate, resultFilter)` por `getPublicResults(startDate, endDate)`.
- Línea 143: cambiar `useEffect(() => { loadResults(); }, [selectedPeriod, resultFilter, refreshTrigger, effectiveViewMode]);` → eliminar `resultFilter` del array de deps.

- [ ] **Step 3: Eliminar todas las constantes y variables relacionadas a parley**

- Líneas 74-84: eliminar las constantes `RISK_COLORS` y `RISK_LABELS`.
- Línea 166: eliminar `const hasParlayResults = data?.parlays && data.parlays.totalVerified > 0;`
- Línea 167: cambiar `const hasAnyResults = hasPickResults || hasParlayResults;` por `const hasAnyResults = hasPickResults;`
- Línea 200: eliminar `const pl = s.parlays;`
- Líneas 203-211: simplificar bloque `displayWon`/`displayLost`/`displayTotal`/`displayWinRate`/`displayPending`/`stakingLabel` — quitar cualquier rama `resultFilter === 'parlays'` y dejar sólo el cálculo de picks individuales:
  ```ts
  const displayWon = s.won;
  const displayLost = s.lost;
  const displayTotal = displayWon + displayLost;
  const displayWinRate = displayTotal > 0 ? (displayWon / displayTotal) * 100 : 0;
  const displayPending = s.totalPending;
  const stakingLabel = getStakingLabel();  // o lo que aplique sin parámetro filter
  ```
  Verificar la firma actual de `getFilterStakingLabel`/`getStakingLabel` en `services/stakingService.ts` y ajustar el import en línea 13 si la función `getFilterStakingLabel` deja de usarse.

- [ ] **Step 4: Eliminar el render `<ResultFilterButtons>` y todos los componentes auxiliares de parley**

- Línea 184 (sin resultados) y línea 252 (con resultados): eliminar `<ResultFilterButtons selected={resultFilter} onSelect={setResultFilter} />`.
- Líneas 203-204: eliminar `const showPicks = resultFilter !== 'parlays';` y `const showParlays = resultFilter !== 'picks';` — ya no son necesarios. Reemplazar `{showPicks && ...}` por el render directo en la línea 380.
- Líneas 419-422: eliminar el bloque completo `{showParlays && <ParlayResultsSection ... />}`.
- Líneas 516-532: eliminar el componente `ResultFilterButtons`.
- Líneas 534-639: eliminar el componente `ParlayResultsSection` completo.
- Líneas 641-688: eliminar el componente `ParlayCard` completo.
- Líneas 690-714: eliminar el componente `LegResultIcon` completo.

- [ ] **Step 5: Verificar typecheck**

```bash
npx tsc --noEmit
```

Esperado: errores sólo en archivos que se modificarán en pasos siguientes (services/parlayService.ts, etc.). Si aparecen errores en otros componentes que importan tipos de parley desde `types.ts`, anotarlos y resolverlos en sus respectivas tareas.

### Tarea 2.4: Eliminar componentes UI de parleys

**Files:**
- Delete: `components/ai/SmartParlays.tsx`
- Delete: `components/ai/SmartParlaysList.tsx`
- Delete: `components/ai/ParlayBuilder.tsx` (si existe)

- [ ] **Step 1: Verificar que no haya imports activos de estos componentes**

```bash
grep -rn "from.*SmartParlays\|from.*ParlayBuilder" components/ services/ App.tsx
```

Esperado: sin resultados (ya removidos en tareas 2.1 y 2.2).

- [ ] **Step 2: Eliminar los archivos**

```bash
rm components/ai/SmartParlays.tsx
rm components/ai/SmartParlaysList.tsx
[ -f components/ai/ParlayBuilder.tsx ] && rm components/ai/ParlayBuilder.tsx
```

### Tarea 2.5: Eliminar el toggle `auto_parlay_enabled` de OperationsCenter

**Files:**
- Modify: `components/superadmin/OperationsCenter.tsx:34, 239-256`

- [ ] **Step 1: Localizar y eliminar el toggle**

```bash
grep -n "auto_parlay\|Generador de Parlays" components/superadmin/OperationsCenter.tsx
```

- [ ] **Step 2: Eliminar el state `autoParlayEnabled` y todos sus usos**

Eliminar:
- Cualquier `useState` de `autoParlayEnabled`.
- Cualquier `useEffect` que lea/escriba `system_settings.auto_parlay_enabled`.
- El bloque JSX del toggle "Generador de Parlays" (líneas 239-256 aprox).
- Cualquier función `handleToggleParlays`/`updateAutoParlay`.

Resultado: OperationsCenter queda con 1 sólo toggle (Análisis Diario). Si esto deja el componente vacío visualmente, dejar el toggle solo y un texto explicativo.

### Tarea 2.6: Limpiar resultsService — eliminar funciones de parley

**Files:**
- Modify: `services/resultsService.ts` (varias líneas)

- [ ] **Step 1: Cambiar firma de `getPublicResults`**

En `services/resultsService.ts` (línea 56 aprox):

```ts
export async function getPublicResults(startDate: string, endDate: string, filter: 'all' | 'picks' | 'parlays' = 'all'): Promise<PublicResultsData> {
```

cambiar a:

```ts
export async function getPublicResults(startDate: string, endDate: string): Promise<PublicResultsData> {
```

Dentro del cuerpo de la función eliminar toda la lógica condicional `if (filter === 'parlays')` y la rama que mezcla parleys; dejar sólo el camino de picks. Eliminar la asignación `result.parlays = ...`.

- [ ] **Step 2: Hacer lo mismo con `getResultsByPlan`**

Cambiar firma para eliminar `filter` parameter. Dentro del cuerpo eliminar cualquier código que toque parleys.

- [ ] **Step 3: Eliminar funciones de parley**

Eliminar completamente las funciones:
- `getParlayResults()` (líneas ~251-310)
- `getParlayProfit()` 
- `calculateParlayProfit()` (líneas ~335-345)
- `manualOverrideParlayLeg()` (línea ~596)

Eliminar también cualquier import o referencia a `ParlayResultData` dentro del archivo.

- [ ] **Step 4: Eliminar la propiedad `parlays` de `PublicResultsData` en types.ts**

En `types.ts`, en la interface `PublicResultsData`, eliminar la propiedad:

```ts
parlays?: {
    won: number;
    lost: number;
    totalVerified: number;
    totalPending: number;
    periodProfit: number;
    periodStaked: number;
    recentResults: ParlayResultData[];
};
```

- [ ] **Step 5: Verificar typecheck**

```bash
npx tsc --noEmit
```

Resolver errores si aparecen — probablemente en componentes que aún importan `ParlayResultData` o llaman `getPublicResults(.., .., 'all')`.

### Tarea 2.7: Eliminar servicios de parley y limpiar analysisService

**Files:**
- Delete: `services/parlayService.ts`
- Delete: `services/smartParlayService.ts`
- Modify: `services/analysisService.ts` (eliminar `launchParlayForFixture`)

- [ ] **Step 1: Verificar imports activos**

```bash
grep -rn "from.*parlayService\|from.*smartParlayService" components/ services/ App.tsx
```

Esperado: sin resultados después de las tareas anteriores. Si aparecen, resolver primero.

- [ ] **Step 2: Eliminar archivos**

```bash
rm services/parlayService.ts
rm services/smartParlayService.ts
```

- [ ] **Step 3: Eliminar `launchParlayForFixture` de analysisService**

En `services/analysisService.ts` (líneas ~311-400), eliminar toda la función `launchParlayForFixture` (que ya está comentada como deshabilitada). Eliminar también cualquier `analysis_type: 'parlay'` y la invocación a `v3-parlay-analyzer`.

Buscar y eliminar cualquier llamado a `launchParlayForFixture` desde otros componentes.

### Tarea 2.8: Eliminar tipos de parley de types.ts

**Files:**
- Modify: `types.ts`

- [ ] **Step 1: Eliminar interfaces y tipos**

En `types.ts`, eliminar:
- `interface ParlayLeg` (línea ~564)
- `interface ParlayAnalysisResult` (línea ~565)
- `interface ParlayResultData` (línea ~638)
- Cualquier otro tipo prefijado con `Parlay*` o `SmartParlay*`.

- [ ] **Step 2: Verificar typecheck**

```bash
npx tsc --noEmit
```

Esperado: sin errores. Si aparecen, los archivos que aún importan estos tipos deben actualizarse.

### Tarea 2.9: Limpiar parlay_percentage de SubscriptionContext y planAccessUtils

**Files:**
- Modify: `contexts/SubscriptionContext.tsx:32, 78, 140`
- Modify: `services/subscriptionService.ts:36`
- Modify: `utils/planAccessUtils.ts` (líneas ~39-63, 136-141)

- [ ] **Step 1: Eliminar campo `parlay_percentage` de las interfaces**

En `contexts/SubscriptionContext.tsx`, en la interface `SubscriptionPlan`, eliminar:

```ts
parlay_percentage: number;
```

(línea 32). Eliminar también cualquier uso de `plan.parlay_percentage` en líneas 78 y 140.

En `services/subscriptionService.ts`, hacer lo mismo en la interface `SubscriptionPlan` (línea 36).

- [ ] **Step 2: Eliminar funciones de utils**

En `utils/planAccessUtils.ts`, eliminar:
- `canViewParlays(parlayPercentage, isHistorical): boolean` (líneas ~39-63)
- `getAllowedParlayCount(totalParlays, parlayPercentage, isHistorical): number`
- `isUnlimitedParlays(limit): boolean`
- Constante `PLAN_PARLAY_PERCENTAGES` (líneas ~136-141)

- [ ] **Step 3: Verificar typecheck y resolver errores**

```bash
npx tsc --noEmit
```

Si algún componente de pricing aún importa estas funciones, ir a la Tarea 2.10.

### Tarea 2.10: Quitar features de parleys de los componentes Pricing

**Files:**
- Modify: `components/landing/LandingPricing.tsx:42-44`
- Modify: `components/auth/PlanSelector.tsx:32-33`
- Modify: `components/pricing/PricingPage.tsx:56-57`
- Modify: `components/pricing/PublicPricingPage.tsx:77`

- [ ] **Step 1: Localizar y eliminar features de parleys en cada archivo**

```bash
grep -n "parlay" components/landing/LandingPricing.tsx components/auth/PlanSelector.tsx components/pricing/PricingPage.tsx components/pricing/PublicPricingPage.tsx
```

En cada uno de los 4 archivos, eliminar:
- Cualquier feature item que mencione "parlay/parley/combinada".
- Cualquier `plan.parlay_percentage` y los textos generados a partir de él.

Si una feature item es del tipo `${plan.parlay_percentage}% de parlays`, eliminarla del array de features.

### Tarea 2.11: Limpiar edge functions críticas (sin eliminar las funciones aún)

**Files:**
- Modify: `supabase/functions/send-whatsapp-notification/index.ts:161-187, 223-241`
- Modify: `supabase/functions/hourly-results-verifier/index.ts` (eliminar bloques que tocan parlay_combos_v2)
- Modify: `supabase/functions/ml-train-calibration/index.ts:623`
- Modify: `supabase/functions/daily-results-verifier/index.ts:217-221` (eliminar query a daily_auto_parlays)

Las edge functions de parley en sí (`v3-generate-parlay-combos`, `daily-parlay-generator`, `verify-parlay-leg`, `v3-parlay-analyzer`, `v3-smart-parlays`, `v2-generate-parlays`, `v2-premium-parlay-engine`, `v3-premium-parlay-engine`, `manual-parlay-generator`, `test-parlay-gen`) **NO se eliminan en este plan** — sólo se desactivan vía cron en la siguiente tarea, y se dejan dormidas para evitar romper algo que dependa de ellas. Una limpieza posterior puede eliminarlas.

- [ ] **Step 1: Quitar conteo de parlays de `send-whatsapp-notification`**

En `supabase/functions/send-whatsapp-notification/index.ts`:

- En `buildPredictionsReadyContent` (líneas 161-187): eliminar `const parlaysCount = String(...)`. Cambiar el template `'pronosticos_listos_paid'` y los `params` para no incluir `parlaysCount`. Si el template requiere ese parámetro, dejar el código pero pasar `'0'` y abrir un ticket en project memory para actualizar el template en Meta WhatsApp Business — ahora está fuera de alcance.
- En `fetchPredictionsStats` (líneas 223-241): eliminar la query a `parlay_combos_v2` y el `stats.parlays_count = parlaysCount || 0;`.

- [ ] **Step 2: Quitar lógica de parley de `hourly-results-verifier`**

En `supabase/functions/hourly-results-verifier/index.ts`:

```bash
grep -n "parlay_combos_v2\|parlay" supabase/functions/hourly-results-verifier/index.ts
```

Eliminar todos los bloques que consultan o actualizan `parlay_combos_v2`. La función debe quedar verificando ÚNICAMENTE `value_picks_v2`.

- [ ] **Step 3: Quitar query de `ml-train-calibration`**

En `supabase/functions/ml-train-calibration/index.ts:623`, eliminar la query a `parlay_combos_v2` y cualquier lógica de calibración basada en parleys.

- [ ] **Step 4: Quitar query de `daily-results-verifier`**

Aunque CLAUDE.md dice que esta función está disabled, eliminar las líneas 217-221 que tocan `daily_auto_parlays` para evitar errores residuales.

- [ ] **Step 5: Deploy de las edge functions modificadas**

```bash
npx supabase functions deploy send-whatsapp-notification --no-verify-jwt
npx supabase functions deploy hourly-results-verifier --no-verify-jwt
npx supabase functions deploy ml-train-calibration --no-verify-jwt
npx supabase functions deploy daily-results-verifier --no-verify-jwt
```

### Tarea 2.12: Desactivar cron de parleys y limpiar system_settings

**Files:**
- Modify: `scripts/setup_all_cron_jobs.sql` (líneas 14, 36, 66, 135-137)
- Modify: `scripts/setup_system_settings.sql:39`

- [ ] **Step 1: Asegurar que el unschedule de `daily-parlay-generator` esté ACTIVO en setup_all_cron_jobs.sql**

En `scripts/setup_all_cron_jobs.sql:14`, asegurar que esta línea NO esté comentada:

```sql
DO $$ BEGIN PERFORM cron.unschedule('daily-parlay-generator'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
```

Si está comentada, descomentarla. Eliminar cualquier `cron.schedule('daily-parlay-generator', ...)` que aún quede en el archivo (comentado o no).

- [ ] **Step 2: Eliminar `auto_parlay_enabled` de setup_system_settings.sql**

En `scripts/setup_system_settings.sql:39`, eliminar la línea:

```sql
('auto_parlay_enabled', 'true'::jsonb, 'Activa/Desactiva la generación automática de parlays diarios')
```

(Cuidado con la coma final del item anterior si esta era la última línea de un INSERT VALUES — ajustar.)

- [ ] **Step 3: Crear migración SQL para desactivar el cron y limpiar system_settings en DB**

Crear archivo `supabase/migrations/20260511_remove_parley_cron_and_settings.sql`:

```sql
-- Desactivar cron de parleys (idempotente)
DO $$ BEGIN
    PERFORM cron.unschedule('daily-parlay-generator');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Eliminar setting auto_parlay_enabled (si existe)
DELETE FROM system_settings WHERE key = 'auto_parlay_enabled';
```

Aplicar la migración:

```bash
npx supabase db push
```

(O ejecutar manualmente en el SQL editor del dashboard si push falla.)

### Tarea 2.13: Build, typecheck, smoke

- [ ] **Step 1: Build del frontend**

```bash
npm run build
```

Esperado: build exitoso sin errores TS. Si hay errores residuales de imports rotos o referencias a tipos eliminados, resolverlos.

- [ ] **Step 2: Smoke local**

```bash
npm run dev
```

En el navegador (localhost):
1. Login → Verificar que el popup `DailyRecapModal` NO muestra sección de Smart Parlays.
2. Ir a Jornadas → verificar que sólo hay 3 tabs: Oportunidades, Partidos, ROI (sin Smart Parlays).
3. Ir al tab ROI/Resultados → verificar que NO hay filtros "Todos / Pronósticos / Parlays" ni sección "Rendimiento Parlays" ni "Detalle por Parlay".
4. Si tienes acceso superadmin: ir a Admin → verificar que OperationsCenter muestra sólo 1 toggle (Análisis Diario).
5. Ir a Pricing/Planes → verificar que ningún plan menciona parleys.

- [ ] **Step 3: Commit Fase 2**

```bash
git add -A
git commit -m "feat: remove parleys completely from platform UI/services/cron"
```

---

## FASE 3 — Reestructurar Resultados con Filtrado por Plan

Ahora la lógica de visibilidad por plan en `ResultadosPublic`:

- **Admin/Superadmin/Owner**: Ve un selector de planes (Free/Ventaja/Elite/Máquina + Global). Default: Global.
- **Usuario Premium (Máquina)**: Sólo ve su plan (que ya es el más alto). No hay toggle.
- **Usuario Free/Starter/Pro**: Ve por defecto su plan, con un botón "Ver Plan Máquina" para previsualizar lo que vería con el plan más alto. Botón regreso "Ver Mi Plan".

### Tarea 3.1: Definir nueva lógica de viewMode en ResultadosPublic

**Files:**
- Modify: `components/live/ResultadosPublic.tsx`

- [ ] **Step 1: Cambiar el tipo `ViewMode` y el estado**

En `components/live/ResultadosPublic.tsx:86`, cambiar:

```ts
type ViewMode = 'plan' | 'global';
```

por:

```ts
type ViewMode = 'plan' | 'maquina' | 'admin-select';
```

- [ ] **Step 2: Reescribir la inicialización del estado**

Reemplazar el bloque (líneas 94-99 aprox.):

```ts
const [viewMode, setViewMode] = useState<ViewMode>('plan');

const { plan, isAdmin } = useSubscription();
const planName = plan.plan_name as PlanTier;
const isUnlimited = planName === 'premium' || isAdmin;
const effectiveViewMode = isUnlimited ? 'global' : viewMode;
```

por:

```ts
const { plan, isAdmin } = useSubscription();
const planName = plan.plan_name as PlanTier;
const isPremium = planName === 'premium';

// Para admin: selector de plan a inspeccionar (todos los planes + global). Default global.
const [adminInspectPlan, setAdminInspectPlan] = useState<PlanTier | 'global'>('global');

// Para usuarios no-premium: toggle entre su plan y el plan máquina (premium).
const [viewMode, setViewMode] = useState<ViewMode>('plan');

// Plan efectivo a consultar:
//  - Admin → plan seleccionado en su selector (o 'global').
//  - Premium → siempre su plan (sin toggle).
//  - Resto → 'plan' = su propio plan; 'maquina' = premium.
const effectivePlanToQuery: PlanTier | 'global' = (() => {
    if (isAdmin) return adminInspectPlan;
    if (isPremium) return 'premium';
    return viewMode === 'maquina' ? 'premium' : planName;
})();
```

- [ ] **Step 3: Adaptar `loadResults` para usar el nuevo `effectivePlanToQuery`**

Reemplazar:

```ts
const cacheKey = `results_${selectedPeriod}_${effectiveViewMode}_${planName}`;
// ...
if (effectiveViewMode === 'plan' && !isUnlimited) {
    results = await getResultsByPlan(startDate, endDate, planName);
} else {
    results = await getPublicResults(startDate, endDate);
}
```

por:

```ts
const cacheKey = `results_${selectedPeriod}_${effectivePlanToQuery}`;
// ...
if (effectivePlanToQuery === 'global') {
    results = await getPublicResults(startDate, endDate);
} else {
    results = await getResultsByPlan(startDate, endDate, effectivePlanToQuery);
}
```

- [ ] **Step 4: Adaptar el `useEffect` de deps**

Reemplazar la línea 143:

```ts
useEffect(() => { loadResults(); }, [selectedPeriod, refreshTrigger, effectiveViewMode]);
```

por:

```ts
useEffect(() => { loadResults(); }, [selectedPeriod, refreshTrigger, effectivePlanToQuery]);
```

### Tarea 3.2: Renderizar selector adecuado según rol

**Files:**
- Modify: `components/live/ResultadosPublic.tsx` (zona del header)

- [ ] **Step 1: Reemplazar el bloque del ViewModeToggle**

Reemplazar líneas 234-239:

```tsx
{/* View Mode Toggle (Mi Plan / Global) — only for non-admin users */}
{!isUnlimited && (
    <div className="flex items-center gap-2">
        <ViewModeToggle selected={effectiveViewMode} onSelect={setViewMode} planDisplayName={PLAN_DISPLAY_NAMES[planName] || plan.display_name} />
    </div>
)}
```

por:

```tsx
{/* Selector según rol del usuario */}
{isAdmin ? (
    <div className="flex items-center gap-2">
        <AdminPlanSelector selected={adminInspectPlan} onSelect={setAdminInspectPlan} />
    </div>
) : !isPremium ? (
    <div className="flex items-center gap-2">
        <UserPlanToggle
            selected={viewMode}
            onSelect={setViewMode}
            myPlanDisplayName={PLAN_DISPLAY_NAMES[planName] || plan.display_name}
        />
    </div>
) : null}
```

- [ ] **Step 2: Reemplazar el componente `ViewModeToggle` por dos componentes nuevos**

Eliminar el componente `ViewModeToggle` (líneas 429-456) y crear en su lugar:

```tsx
const PLAN_OPTIONS: { value: PlanTier | 'global'; label: string }[] = [
    { value: 'global', label: 'Global' },
    { value: 'free', label: 'Explorador' },
    { value: 'starter', label: 'Ventaja' },
    { value: 'pro', label: 'Elite' },
    { value: 'premium', label: 'Máquina' },
];

const AdminPlanSelector: React.FC<{
    selected: PlanTier | 'global';
    onSelect: (p: PlanTier | 'global') => void;
}> = ({ selected, onSelect }) => (
    <div className="flex items-center bg-slate-800 rounded-lg border border-white/10 p-0.5 flex-wrap">
        {PLAN_OPTIONS.map(opt => (
            <button
                key={opt.value}
                onClick={() => onSelect(opt.value)}
                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                    selected === opt.value
                        ? 'bg-emerald-500/20 text-emerald-300 shadow-sm'
                        : 'text-slate-400 hover:text-white'
                }`}
            >
                {opt.label}
            </button>
        ))}
    </div>
);

const UserPlanToggle: React.FC<{
    selected: ViewMode;
    onSelect: (m: ViewMode) => void;
    myPlanDisplayName: string;
}> = ({ selected, onSelect, myPlanDisplayName }) => (
    <div className="flex items-center bg-slate-800 rounded-lg border border-white/10 p-0.5">
        <button
            onClick={() => onSelect('plan')}
            className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${
                selected === 'plan'
                    ? 'bg-emerald-500/20 text-emerald-300 shadow-sm'
                    : 'text-slate-400 hover:text-white'
            }`}
        >
            Mi Plan ({myPlanDisplayName})
        </button>
        <button
            onClick={() => onSelect('maquina')}
            className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${
                selected === 'maquina'
                    ? 'bg-emerald-500/20 text-emerald-300 shadow-sm'
                    : 'text-slate-400 hover:text-white'
            }`}
        >
            Plan Máquina
        </button>
    </div>
);
```

- [ ] **Step 3: Adaptar el `PlanValueBanner` para que también se muestre en modo 'maquina' (vista de upgrade)**

En `components/live/ResultadosPublic.tsx`, reemplazar líneas 242-249:

```tsx
{effectiveViewMode === 'plan' && !isUnlimited && data && data.totalVerified > 0 && (
    <PlanValueBanner
        data={data}
        planName={planName}
        planDisplayName={PLAN_DISPLAY_NAMES[planName] || plan.display_name}
        predictionsPercentage={PLAN_PREDICTIONS_PERCENTAGES[planName] || plan.predictions_percentage}
    />
)}
```

por:

```tsx
{!isAdmin && !isPremium && data && data.totalVerified > 0 && (
    <PlanValueBanner
        data={data}
        planName={effectivePlanToQuery === 'global' ? planName : (effectivePlanToQuery as PlanTier)}
        planDisplayName={
            PLAN_DISPLAY_NAMES[(effectivePlanToQuery === 'global' ? planName : effectivePlanToQuery) as PlanTier]
            || plan.display_name
        }
        predictionsPercentage={
            PLAN_PREDICTIONS_PERCENTAGES[(effectivePlanToQuery === 'global' ? planName : effectivePlanToQuery) as PlanTier]
            || plan.predictions_percentage
        }
        isPreviewingMaquina={viewMode === 'maquina'}
    />
)}
```

Y luego en el componente `PlanValueBanner` (líneas 458-512), añadir el prop `isPreviewingMaquina?: boolean` a su interface y, cuando sea `true`, renderizar el título como `"Vista previa: Plan Máquina"` en lugar de `"Tu Plan {planDisplayName}"`. El CTA "Desbloquea más con..." se muestra sólo cuando `isPreviewingMaquina === false` (vista del plan propio del usuario).

- [ ] **Step 4: Para admin, mostrar un banner discreto indicando qué plan está inspeccionando**

Justo arriba del bloque de KPIs, añadir un banner de admin:

```tsx
{isAdmin && (
    <div className="px-4 py-2 rounded-lg bg-slate-800/50 border border-white/5 text-xs text-slate-400">
        <span className="font-semibold text-emerald-400">Vista Admin</span> — inspeccionando <span className="text-white font-bold">
            {adminInspectPlan === 'global' ? 'Global (todos los picks)' : (PLAN_OPTIONS.find(p => p.value === adminInspectPlan)?.label || adminInspectPlan)}
        </span>
    </div>
)}
```

- [ ] **Step 5: Verificar typecheck**

```bash
npx tsc --noEmit
```

### Tarea 3.3: Verificar/ajustar `getResultsByPlan` para que reciba PlanTier correctamente sin filter de parley

**Files:**
- Modify: `services/resultsService.ts` (función `getResultsByPlan`)

- [ ] **Step 1: Confirmar que `getResultsByPlan` ya quitó el `filter` parameter en Fase 2.6**

```bash
grep -n "getResultsByPlan" services/resultsService.ts
```

Firma esperada:

```ts
export async function getResultsByPlan(startDate: string, endDate: string, planName: PlanTier): Promise<PublicResultsData> {
```

Si todavía tiene `filter`, eliminarlo ahora.

- [ ] **Step 2: Asegurar que la función filtra picks por plan correctamente**

La función debe usar `filterPicksByPlan(picks, planName)` (que ya existe en utils/planAccessUtils, líneas 1177-1198 de resultsService según auditoría) y calcular bankroll/units sobre los picks filtrados.

Verificar leyendo la función completa. Si hay alguna lógica que aún consulta `parlay_combos_v2`, eliminarla.

### Tarea 3.4: Smoke local del nuevo Resultados

- [ ] **Step 1: Build y dev**

```bash
npm run build && npm run dev
```

- [ ] **Step 2: Smoke con cuenta de admin**

1. Login como admin/superadmin.
2. Ir a Jornadas → tab ROI.
3. Verificar que aparece un selector horizontal con 5 opciones: Global, Explorador, Ventaja, Elite, Máquina.
4. Click en cada uno y verificar que los KPIs (Win Rate, Profit, ROI) cambian.
5. Verificar el banner "Vista Admin — inspeccionando X".

- [ ] **Step 3: Smoke con cuenta de usuario plan Free/Starter/Pro**

1. Login como usuario no-admin con plan Free.
2. Ir a Jornadas → tab ROI.
3. Verificar el toggle "Mi Plan (Explorador)" / "Plan Máquina".
4. Default debe ser "Mi Plan (Explorador)". Banner debe decir "Tu Plan Explorador".
5. Click en "Plan Máquina" → KPIs cambian, banner cambia a "Vista previa: Plan Máquina" (o nombre similar). CTA de upgrade NO se muestra en preview, sólo cuando vuelve a "Mi Plan".

- [ ] **Step 4: Smoke con cuenta plan Premium**

1. Login como usuario plan Premium.
2. Ir a Jornadas → tab ROI.
3. Verificar que NO hay toggle ni selector — sólo se ven los KPIs de su plan (que es el más alto).

- [ ] **Step 5: Commit Fase 3**

```bash
git add -A
git commit -m "feat(resultados): plan selector for admin, my-plan/maquina toggle for users"
```

---

## FASE 4 — Build, Deploy y Verificación

### Tarea 4.1: Verificación final pre-push

- [ ] **Step 1: Buscar referencias residuales a parley en el código activo**

```bash
grep -rn -i "parlay\|parley\|combo" components/ services/ contexts/ hooks/ utils/ App.tsx types.ts | grep -v node_modules | grep -v ".test." | grep -v ".min." | grep -v "smartParlay\|parlayService\|SmartParlays\.tsx\|ParlayBuilder\.tsx" || echo "OK - sin residuos"
```

Esperado: la única salida posible son menciones en CLAUDE.md, MEMORY.md, migraciones SQL viejas, edge functions dormidas (las que NO tocamos), o comentarios. Si aparecen referencias en código React activo, resolverlas.

- [ ] **Step 2: Type-check final**

```bash
npx tsc --noEmit
```

Esperado: sin errores.

- [ ] **Step 3: Build de producción**

```bash
npm run build
```

Esperado: build exitoso. Anotar el bundle size resultante para comparar.

### Tarea 4.2: Deploy

- [ ] **Step 1: Push a main (Netlify auto-deploy del frontend)**

```bash
git push origin main
```

- [ ] **Step 2: Deploy de edge functions modificadas**

```bash
npx supabase functions deploy send-whatsapp-notification --no-verify-jwt
npx supabase functions deploy hourly-results-verifier --no-verify-jwt
npx supabase functions deploy ml-train-calibration --no-verify-jwt
npx supabase functions deploy daily-results-verifier --no-verify-jwt
```

- [ ] **Step 3: Aplicar migración SQL**

```bash
npx supabase db push
```

Si falla (Supabase CLI requiere link), aplicar manualmente el contenido de `supabase/migrations/20260511_remove_parley_cron_and_settings.sql` en el SQL Editor del dashboard.

- [ ] **Step 4: Verificar en producción**

Esperar ~2 min a que Netlify termine el deploy. Luego en la URL de producción:
1. Login → DailyRecapModal sin sección de Smart Parlays.
2. Tab ROI → selector de planes (admin) o toggle (user) funciona.
3. Tab Jornadas → sólo 3 sub-tabs (sin Smart Parlays).
4. Pricing → sin features de parleys.

### Tarea 4.3: Verificar cron desactivado

- [ ] **Step 1: Confirmar que `daily-parlay-generator` no se ejecutará**

En Supabase SQL Editor:

```sql
SELECT jobid, jobname, schedule FROM cron.job WHERE jobname LIKE '%parlay%';
```

Esperado: 0 filas (ningún cron de parleys agendado).

- [ ] **Step 2: Confirmar que `auto_parlay_enabled` ya no existe en system_settings**

```sql
SELECT * FROM system_settings WHERE key = 'auto_parlay_enabled';
```

Esperado: 0 filas.

---

## FASE 5 — Code Review y Security Review

### Tarea 5.1: Ejecutar /review

- [ ] **Step 1: Invocar el review automatizado**

Ejecutar el slash command `/review` (review de la rama actual).

- [ ] **Step 2: Atender hallazgos**

Por cada hallazgo categorizado como `must-fix`:
1. Verificar que es real (no falso positivo).
2. Aplicar el fix con un commit nuevo `fix(review): <descripción breve>`.

### Tarea 5.2: Ejecutar /security-review

- [ ] **Step 1: Invocar el security review**

Ejecutar el slash command `/security-review`.

- [ ] **Step 2: Atender vulnerabilidades**

Foco especial en:
- ¿Se eliminó algún check de auth/role al remover parleys?
- ¿La nueva ruta `getResultsByPlan(planName)` admite filtrado arbitrario sin validar que el usuario tenga permisos? (Específicamente: un usuario Free podría hacer un fetch directo simulando ser admin con plan='premium' — verificar que la lógica de admin está validada server-side o que el endpoint `getResultsByPlan` no expone más datos de los que el plan permite.)
- ¿La columna `parlay_percentage` en DB queda huérfana sin causar problemas? (No se elimina aún; sólo el código de lectura. Acción posterior: deprecar la columna.)
- ¿Hay alguna edge function dormida (v3-generate-parlay-combos, etc.) que aún sea invocable y pueda costar dinero o leak data?

Por cada vulnerabilidad real, commit `fix(security): <descripción>`.

### Tarea 5.3: Update memory

- [ ] **Step 1: Actualizar memorias del proyecto**

Actualizar `memory/MEMORY.md` con un nuevo bullet:
- Plataforma: parleys removidos completamente del frontend/services/cron el 2026-05-11. Tablas DB (`parlays`, `parlay_combos_v2`, `parlay_picks_v2`, `daily_auto_parlays`) preservadas para histórico. Edge functions de parley quedan dormidas — pendiente de deprecar en cleanup posterior.
- Resultados: Admin ve selector de planes (Global/Free/Starter/Pro/Premium). Usuario no-premium ve "Mi Plan / Plan Máquina". Premium sólo ve su plan.

---

## Self-Review (post-escritura del plan)

**Spec coverage check:**
- ✅ Popup quitar parleys → Fase 1 (Tareas 1.1, 1.2)
- ✅ Quitar parleys de toda la plataforma → Fase 2 (Tareas 2.1–2.12)
- ✅ Resultados por plan filtrados (admin) → Fase 3 (Tareas 3.1–3.3)
- ✅ Usuario ve por defecto su plan + botón al plan más alto (con palabra distinta: "Plan Máquina") → Tarea 3.2
- ✅ /review → Tarea 5.1
- ✅ Security review → Tarea 5.2
- ✅ Sin parleys en ninguna parte → Verificación final 4.1 Step 1

**Placeholder scan:** Sin TBD/TODO/"add appropriate". Cada paso tiene código exacto o comando exacto.

**Type consistency:** El tipo `PlanTier` se usa consistentemente. `effectivePlanToQuery` está definido en Tarea 3.1 Step 2 y usado en Steps 3, 4 y en Tarea 3.2 Step 3. `AdminPlanSelector`/`UserPlanToggle` definidos en 3.2 Step 2.

**Riesgo destructivo:** Sin `DROP TABLE`. Sin `--force`. Sólo `DELETE FROM system_settings WHERE key=...` (1 fila), `cron.unschedule` (idempotente), y `rm` de archivos React no usados.

---

**Plan completo. Total: 5 fases, 35 tareas, deploy + reviews al final.**
