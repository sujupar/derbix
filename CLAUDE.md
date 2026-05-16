# CLAUDE.md — Derbix Development Rules

## Misión del Producto

Derbix es una plataforma SaaS de inteligencia deportiva para apuestas de fútbol. El usuario objetivo es alguien apasionado por el fútbol que ha tenido malas experiencias con tipsters y estafas. La experiencia debe ser directa: el usuario entra, ve las oportunidades (pronósticos con valor), las aplica en su casa de apuestas, y gana dinero de forma consistente. Todo lo que se construya debe servir a este objetivo.

---

## Stack Tecnológico

- **Frontend**: React 19 + TypeScript + Vite + TailwindCSS v4 + PostCSS
- **Backend**: Supabase (PostgreSQL + Edge Functions en Deno)
- **AI**: Google Gemini API (análisis) + Perplexity (contexto web)
- **Data**: SportMonks API (fuente única de datos deportivos)
- **Deploy Frontend**: Netlify (auto-deploy al hacer push a GitHub)
- **Deploy Functions**: `npx supabase functions deploy <nombre> --no-verify-jwt`

---

## Arquitectura del Pipeline

```
v2-create-job-sportmonks (ETL) → v3-ai-analyzer (Gemini) → v2-generate-parlays (Oportunidades)
```

### Flujo completo:
1. Usuario hace clic en "Analizar" un partido en LiveFeed
2. `createAnalysisJob()` llama a `v2-create-job-sportmonks` (fire-and-forget)
3. ETL obtiene datos de SportMonks, crea registro en `analysis_jobs_v2` con status='etl'
4. Frontend hace polling cada 2-5s via `getAnalysisJob()`
5. `v3-ai-analyzer` procesa con Gemini, guarda en `reports_v2`, `value_picks_v2`, `analisis`
6. Status cambia a 'done', frontend muestra `AnalysisReportModal`
7. `v2-generate-parlays` (nombre legacy) marca las top 20 picks del día como `is_opportunity=true` en `value_picks_v2`. Los parleys fueron eliminados de la plataforma (mayo 2026); esta función SE MANTIENE como motor de Oportunidades visibles.

---

## Reglas Críticas de Datos

### NUNCA borrar datos antes de que los nuevos estén listos
- El ETL (`v2-create-job-sportmonks`) **NUNCA** debe eliminar datos existentes
- Solo `v3-ai-analyzer` limpia datos antiguos **DESPUÉS** de escribir los nuevos exitosamente
- `createAnalysisJob` en el frontend **NO** debe borrar la caché de `analisis` prematuramente
- Violar esta regla deja al usuario sin datos si el analyzer falla

### Sistema de IDs: Solo SportMonks
- El frontend usa exclusivamente IDs de SportMonks (`v2-list-fixtures-sportmonks`)
- `daily_matches` se puebla con IDs de SportMonks
- `daily-match-scanner` está **DESHABILITADO** (no-op desde Feb 14 2026) — causaba conflictos de IDs duales
- `v3-ai-analyzer` resuelve `finalFixtureId` contra `daily_matches` ANTES de guardar
- Datos históricos pueden tener IDs de API-Football; LiveFeed tiene `alternateIdsRef` como respaldo

### Constraints de Base de Datos
- `daily_matches` tiene constraint `UNIQUE(api_fixture_id, match_date)` — es **compuesto**, no solo api_fixture_id
- Upsert DEBE usar `onConflict: 'api_fixture_id,match_date'` (ambos campos)
- `daily_matches.league_id` tiene FK a `allowed_leagues(api_league_id)` — IDs de SportMonks difieren, usar NULL

### LLM y costo por análisis (post-incidente 2026-05-15)
- **Modelo productivo: `deepseek-v4-flash`** vía `https://api.deepseek.com` (proveedor que expone solo `v4-flash` y `v4-pro`, ambos modelos de reasoning).
- **`deepseek-v4-pro` NO funciona en Supabase Edge**: consistentemente >130s solo el LLM (test directo: 0.3s, pero en pipeline genera demasiado reasoning_tokens). Wall-clock de Edge es ~150s — no cabe. Si se quiere v4-pro, mover `v9-pipeline-worker` a Cloud Run/VPS.
- **Costo real medido**: ~$0.006 USD por análisis MEGA (~3858 prompt + 4948 completion tokens). Datos en `llm_usage_log` (insertada por `_shared/llm-client.ts` con cost_usd estimado).
- **`stage-mega.ts`** debe pasar `stage: 'mega'` en config para que el log tenga atribución.
- `_shared/llm-client.ts` tiene multi-provider chain (actualmente solo deepseek-v4-flash). El fallback a Gemini está deshabilitado mientras la key esté suspendida.
- **Bug conocido pendiente**: el JSON.stringify del body falla con `"unexpected end of hex escape"` para fixtures con caracteres CJK/diacríticos especiales en nombres (Chinese Super League, algunos Eliteserien). Causa ~5% de los análisis a fallar con HTTP 400. Workaround pendiente: sanitizar/escapar el prompt antes del fetch.

### Sanity gate prob ↔ odds (post-incidente cuotas infladas 2026-05-15)
- `_shared/odds-selector.ts` exporta `checkProbOddsCoherence(prob, odds)` con tabla `PROB_ODDS_SANITY_TABLE` que cap el implied edge en ~25-30% por banda (0.80→1.60, 0.83→1.55, 0.85→1.50, 0.90→1.35, 0.95→1.25).
- **`v9-pipeline-worker` aplica el sanity gate DESPUÉS del cross-val** — picks incoherentes son rechazados antes de persistir en `value_picks_v2`. NUNCA quitar este gate.
- **El frontend `AnalysisReportModal.tsx`** tiene una versión espejo de `isProbOddsCoherent()` que muestra banner ámbar "Cuota incoherente" en picks rechazados — NO badge "Oportunidad de Valor". Si tocas la tabla del backend, sincroniza también el frontend.
- **Modelo de coherencia**: edge = (prob − 1/odds) / (1/odds). Real bookmaker margin es 5-8%, así que edge >25% es casi siempre error (catálogo envenenado o LLM hallucinando).

### Catálogo de odds — m_id mal clasificados (fix 2026-05-15)
- `_shared/sportmonks-normalizer.ts` MARKET_DICT: `m_id=60` añadido a `CORNERS` (Corners 2-Way Over/Under estándar). `m_id=63, 334, 336` MOVIDOS a `OTHERS` (sus valores son incoherentes con Over/Under simple — probablemente Asian Handicaps/Goal Range).
- Si SportMonks añade nuevos `m_id`, NUNCA los pongas en GOALS/CORNERS sin verificar que los valores son coherentes (Over+Under sum implied prob ~1.06-1.08). Si suma da otra cosa, es Asian/Handicap y va a OTHERS.

### Gating de picks por plan
- `v9-pipeline-worker` debe persistir `opportunity_rank: null` (no `idx + 1`) — el ranking global lo asigna `v2-generate-parlays` Step 5.5.
- `HighProbPicks.tsx` ordena con `opportunity_rank.asc.nullsfirst,p_model.desc` como secondary — sin esto, free user ve un pick distinto cada refresh.
- `PLAN_PREDICTIONS_PERCENTAGES`: free=1, starter=35, pro=80, premium=100. `getAllowedPickCount` usa `Math.min(1, n)` para free → siempre 1 pick.
- `v2-generate-parlays` Step 5.5 hace **surgical unmark** (NO bulk reset) — si el slow path encuentra menos picks que los ya persistidos por v9, NO los borra.

### Mercado Empate No Acción (Draw No Bet) — gotcha de cross-validation
- **NO confundir**: "Draw No Bet" / "Empate No Acción" es un **mercado de apuestas a 2 vías** (gana el equipo, o se devuelve la stake si empatan). NO es una recomendación de "no apostar".
- SportMonks lo expone con `m_id=6` y label **"Match Winner (no draw)"** (en inglés). En `_shared/sportmonks-normalizer.ts` se renombra a **"Empate No Acción"** para consistencia con el resto del catálogo en español.
- El cross-validator en `_shared/odds-selector.ts` tiene un **short-circuit dedicado para DNB**: `isDrawNoBetPick()` detecta picks con "draw no bet" / "no bet" / "empate no" en market o selection y los enruta SOLO a entradas DNB del catálogo (rechaza match contra "Resultado 1X2: Empate" que tendría odds 5x+ y haría fallar el rango `[1.20, 4.50]`).
- `buildSelectionTokens()` NO agrega tokens 'draw'/'empate' para selecciones DNB (eso causaba el matching cruzado).
- `services/marketTranslator.ts` tiene un check `isDrawNoBetMarket()` ANTES de Doble Oportunidad/1X2 para mostrar "Empate No Acción — Manchester City (Local) (refund si empate)" en lugar de "Manchester City (Local) - Draw No Bet" crudo.

---

## Tablas Principales

| Tabla | Propósito |
|-------|-----------|
| `daily_matches` | Partidos del día sincronizados desde SportMonks |
| `analysis_jobs_v2` | Tracking de jobs ETL/AI (status: etl → analyzing → done/failed) |
| `reports_v2` | Reportes completos de análisis (report_packet JSONB) |
| `value_picks_v2` | Predicciones individuales (mercado, selección, probabilidad, odds) |
| `analisis` | Caché de análisis para frontend (resumen ejecutivo, detalles) |
| `profiles` | Perfiles de usuario |
| `organizations` | Multi-tenancy (organizaciones/equipos) |
| `organization_members` | Relación usuario-organización con roles |
| `subscriptions` / `subscription_usage` | Control de planes y uso mensual |
---

## Estructura del Proyecto (Post-Simplificación MVP Feb 2026)

```
/
├── App.tsx                    # Routing principal — 3 páginas: live, admin, pricing
├── types.ts                   # Todas las definiciones de tipos TypeScript
├── components/
│   ├── Layout.tsx             # Sidebar simplificado: Jornadas, Planes, Admin
│   ├── LiveFeed.tsx           # Jornadas (página principal y landing por defecto)
│   │                          #   Tabs: Oportunidades → Partidos
│   ├── ai/
│   │   ├── AnalysisReportModal.tsx  # Modal de reporte de análisis
│   │   └── HighProbPicks.tsx  # Picks de alta probabilidad (tab Oportunidades)
│   ├── auth/                  # Flujo de autenticación
│   ├── admin/                 # Panel de administración
│   │   ├── TeamManagement.tsx # Gestión de equipo/org
│   │   └── ProfitabilityDashboard.tsx  # ROI tracking
│   ├── agency/                # Agency Suite
│   │   ├── AgencyLayout.tsx   # Layout con sidebar: Dashboard, Clientes, Analítica
│   │   ├── AgencySidebar.tsx  # 3 items: dashboard, subaccounts, analytics
│   │   └── PerformanceReports.tsx  # Analítica Global
│   ├── live/                  # Componentes de datos en vivo
│   ├── pricing/               # Planes y suscripciones
│   └── superadmin/
│       └── OperationsCenter.tsx  # Toggle: Análisis Diario (parleys eliminados may 2026)
├── contexts/                  # Estado global (React Context API)
│   ├── OrganizationContext    # Multi-tenancy
│   ├── SubscriptionContext    # Planes y límites
│   └── LanguageContext        # i18n (ES/EN)
├── hooks/
│   ├── useAuth.tsx            # Autenticación y perfil
│   ├── useAnalysisCache.ts    # Caché de análisis
│   └── useSubscriptionLimits  # Control de límites
├── services/
│   ├── supabaseService.ts     # Cliente Supabase
│   ├── analysisService.ts     # Gestión del pipeline de análisis
│   ├── liveDataService.ts     # Datos deportivos en vivo
│   ├── subscriptionService.ts # Lógica de suscripciones
│   └── organizationService.ts # Multi-tenancy
├── supabase/functions/        # Edge Functions (Deno)
│   ├── v2-create-job-sportmonks/  # ETL (datos SportMonks)
│   ├── v3-ai-analyzer/            # Análisis IA (Gemini)
│   ├── v2-generate-parlays/       # Generación de oportunidades (nombre legacy)
│   ├── v2-list-fixtures-sportmonks/ # Listado de partidos
│   ├── daily-analysis-generator/  # Cron: análisis automático
│   ├── hourly-results-verifier/   # Cron: verificación horaria de resultados
│   ├── _shared/                   # Utilidades compartidas
│   └── [otras funciones]
├── utils/
│   ├── dateUtils.ts           # Manejo de timezone Bogotá
│   └── formatters.ts          # Formateo de moneda
└── index.html                 # Entry point
```

### Funcionalidades ELIMINADAS (Feb 2026)
Las siguientes fueron removidas del frontend pero sus tablas DB persisten (ver migración `20260218_cleanup_removed_features.sql`):
- Apuestas manuales (BetTable, AddBetForm, useBets)
- ML/Auto-Learning (MLDashboard, model_stats)
- Ticket Scanner (TicketScanner/, scan-ticket edge function)
- Ajustes de capital (Settings, useSettings)
- Análisis IA legacy (ChatBot, GamedayAnalyzer, Comparativo, ApiTest, etc.)
- Dashboard separado (se redirige a Jornadas)
- Agency Launchpad y Configuración

---

## Patrones de Código

### Estado Global
Se usa **React Context API** (sin Redux). Jerarquía de providers:
```
AuthProvider → OrganizationProvider → SubscriptionProvider → LanguageProvider → AppContent
```

### Llamadas a Edge Functions
```typescript
const { data, error } = await supabase.functions.invoke('nombre-funcion', {
    body: { parametro1, parametro2 }
});
```

### Edge Functions (Deno)
```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from '../_shared/cors.ts'

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    // ...lógica
    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
```

### Multi-tenancy
- Todas las queries a datos de usuario filtran por `organization_id`
- El `OrganizationContext` gestiona la organización activa
- Superadmin puede impersonar cualquier organización

### Suscripciones
- Planes: `free`, `basic`, `pro`, `enterprise`
- `SubscriptionContext` provee `checkLimit()` y `trackUsage()` para controlar el acceso
- Features controladas: predicciones, análisis

### Roles de Usuario
```
platform_owner  → Acceso total (dueño de la plataforma)
agency_admin    → Acceso total (empleado de agencia)
superadmin      → Backward compatibility para platform_owner
org_owner       → Admin de su organización
admin           → Backward compatibility para org_owner
org_member      → Miembro con acceso limitado
user/usuario    → Usuario individual con acceso básico
```

---

## Patrones del Pipeline de Análisis

### v2-generate-parlays — Fuentes de datos (4 niveles de fallback):
1. `reports_v2` (report_packet completo)
2. `value_picks_v2` (picks con p_model >= 50%)
3. `analisis` (tabla de caché)
4. `analysis_jobs_v2.id` como último recurso

### v2-generate-parlays — Filtrado por fecha:
- Usa `match_date` de `daily_matches` (NO rango de match_time) para confiabilidad
- También consulta `analysis_jobs_v2` por `created_at` para encontrar análisis con IDs que no están en daily_matches

### Polling del frontend:
- Timeout de 3 minutos por job
- Skip después de 3 errores consecutivos (`pollErrorCount` ref) para evitar bloqueos de la cola
- `analysisService` verifica frescura comparando `analisis.updated_at` vs `analysis_jobs_v2.created_at`

### Adaptador V3 → Frontend:
- `adaptV3ToFrontend()` en `analysisService.ts` normaliza la salida de Gemini al formato que espera `AnalysisReportModal`
- Usa "data scavenging" — múltiples fallbacks para extraer datos de cualquier estructura que Gemini devuelva

### Oportunidades persistentes (is_opportunity):
- `v2-generate-parlays` marca las top 20 como `is_opportunity=true` en `value_picks_v2` (Step 5.5)
- `HighProbPicks.tsx` lee primero de DB (fast path) pero **verifica staleness**:
  - Si hay 20 persistidas → siempre usar fast path (ya alcanzó el máximo)
  - Si hay < 20 persistidas Y hay más picks elegibles (p_model >= 0.83) → regenerar vía edge function
  - Si hay < 20 persistidas Y NO hay más elegibles → usar fast path (es todo lo que hay)
- El botón "Actualizar" SIEMPRE regenera (`forceRegenerate=true`)
- `resultsService.ts` filtra por `is_opportunity=true` para calcular ROI real (no todos los picks)
- **NUNCA** confiar ciegamente en datos persistidos sin verificar si hay datos más recientes

---

## Convenciones de UI/UX

### Diseño Visual
- **Tema**: Dark mode exclusivo (slate-950 a slate-900)
- **Color brand**: Verde (#10b981 / emerald-500)
- **Estilo**: Glass-morphism (backdrop-blur + bordes white/5)
- **Fuentes**: Inter (UI), Outfit (Display)
- **Animaciones**: fade-in para entradas, spin para loading, pulse para indicadores

### Navegación
- **Sidebar**: 3 items — Jornadas, Planes, Admin
- **Página por defecto**: Jornadas (LiveFeed) — NO hay dashboard separado
- **Jornadas tabs** (en orden): Oportunidades → Partidos
- **Tab por defecto**: Oportunidades (top-picks)
- **ROI/Resultados**: sección standalone (sidebar). Admin tiene selector con 5 opciones (Global/Free/Starter/Pro/Premium); usuario no-premium tiene toggle "Mi Plan / Plan Máquina"; premium ve sólo su plan.
- **Partidos**: Todas las secciones de países/ligas expandidas por defecto
- **Agency Suite**: Dashboard (1 toggle), Cartera de Clientes, Analítica Global

### Layout
- Desktop: Sidebar fija izquierda (264px) + área de contenido principal
- Mobile: Responsive con clases de Tailwind

### Idioma
- La interfaz soporta ES/EN via `LanguageContext`
- Español como idioma por defecto

---

## Reglas de Desarrollo

### Al modificar Edge Functions:
1. Respetar el patrón CORS (preflight OPTIONS + headers)
2. Usar `SUPABASE_SERVICE_ROLE_KEY` del entorno, nunca hardcoded
3. Mantener logging con prefijo del nombre de la función: `[v2-create-job-sportmonks]`
4. Funciones del pipeline core son fire-and-forget — deben responder rápido
5. Después de cambios, deploy con: `npx supabase functions deploy <nombre> --no-verify-jwt`

### Al modificar el frontend:
1. Los tipos van en `types.ts` (archivo centralizado)
2. Lógica de negocio en `services/`, no en componentes
3. Estado global via Context, estado local via useState/useRef
4. Todas las fechas se manejan en timezone de Bogotá (ver `dateUtils.ts`)
5. Filtrar siempre por `organization_id` en queries de datos de usuario

### Al tocar el pipeline de análisis:
1. **NUNCA** borrar datos en el ETL
2. **SIEMPRE** resolver `finalFixtureId` contra `daily_matches` antes de guardar
3. Limpiar datos antiguos solo DESPUÉS de que los nuevos se guardaron exitosamente
4. Respetar el upsert compuesto: `onConflict: 'api_fixture_id,match_date'`
5. Probar que el adaptador V3 → Frontend normaliza correctamente la salida

### Al crear nuevas features:
1. Verificar si la feature necesita control de suscripción (`checkLimit`/`trackUsage`)
2. Verificar si necesita filtrado por organización
3. Verificar si necesita soporte de roles (quién puede acceder)
4. Mantener la experiencia del usuario simple — el usuario quiere ver oportunidades, no configurar cosas
5. Todo lo que se construya debe acercar al usuario a tomar mejores decisiones de apuestas

---

## Deploy

```bash
# Frontend (automático)
git push origin main  # Netlify auto-deploys

# Edge Functions (manual por función)
npx supabase functions deploy v2-create-job-sportmonks --no-verify-jwt
npx supabase functions deploy v3-ai-analyzer --no-verify-jwt
npx supabase functions deploy v2-generate-parlays --no-verify-jwt
npx supabase functions deploy v2-list-fixtures-sportmonks --no-verify-jwt
# etc.
```

---

## Comunicación

- Responder siempre en **español**
- Investigar a fondo antes de proponer correcciones
- No hacer suposiciones — verificar contra el código real
