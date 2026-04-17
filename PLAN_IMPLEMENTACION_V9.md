# Plan de Implementación Derbix V9 — Sistema de Análisis Predictivo de Élite

## Contexto

Este documento describe la transformación completa del sistema de análisis Derbix desde V8.2 (LLM puro con prompt monolítico) hacia V9 (sistema híbrido: modelos matemáticos + multi-agent LLM + RAG + calibración con gate manual).

**Objetivo**: Pasar de 65.1% WR general a 73-75% general + 82-87% en picks selectivos (top 20%), con ROI +20-25% sostenido y CLV positivo +3-5%.

**Restricción crítica del usuario**: El aprendizaje ML NO puede ser automático. El verificador de resultados falla ~5% del tiempo, y eso contamina el aprendizaje. Debe haber gate manual (botón en admin) que aprueba qué picks alimentan al sistema.

---

## Arquitectura V9 Final

```
Layer 0 — Data Ingestion (MEJORADO)
  SportMonks + lineups + coaches + weather + xG real + referee DB

Layer 1 — Feature Engineering (NUEVO)
  xG/xGA rolling | PPDA | Style Similarity Score | Fatigue | Set pieces

Layer 2 — Base Mathematical Models (NUEVO CRÍTICO)
  Dixon-Coles (λ_h, λ_a) | Club Elo | Bivariate Poisson

Layer 3 — Multi-Agent Debate (NUEVO)
  6 agentes especializados + 1 juez sintetizador

Layer 4 — Self-Consistency + Monte Carlo (NUEVO)
  N runs + majority voting + 10K simulaciones

Layer 5 — Calibration + Value Detection (MEJORADO)
  Isotonic regression + Kelly sizing + CLV filter

Layer 6 — RAG Histórico (NUEVO)
  pgvector con picks pasados verificados manualmente

Layer 7 — Feedback Loop MANUAL (NUEVO)
  Admin UI aprueba cada pick verificado → dispara re-training
```

---

## FASE 1 — Rescate de Datos (3-5 días de trabajo original)

### 1.1 Restaurar `lineups` en ETL
**Problema**: `v2-create-job-sportmonks/index.ts` línea 134 descarta lineups por "optimización".
**Acción**:
- Añadir `lineups` a `deepIncludes` en fixture complete
- Crear `normalizeLineups()` en `_shared/sportmonks-normalizer.ts`
- Agregar `etl_context.lineups.home/away` con jugadores titulares, suplentes, posiciones
- Detectar ausencias de jugadores clave vs forma típica

### 1.2 Normalizar `coaches`
**Problema**: Se solicitan pero no se procesan.
**Acción**:
- Crear tabla `coach_profiles` con historial táctico
- `normalizeCoach()` extrae formación favorita, % victorias, promedio goles/partido
- Detectar "luna de miel" de nuevo DT (últimos 3-5 partidos)

### 1.3 Activar `weatherReport`
**Problema**: Se extrae pero no llega al prompt.
**Acción**:
- Pasar `match.weather` a todas las capas
- Inyectar en prompt con factores: lluvia, viento, temperatura, altitud
- Aplicar ajustes matemáticos: lluvia -0.3 goles, viento +15% corners

### 1.4 Implementar xG real
**Problema**: `xg: null` en payload.
**Acción**:
- Verificar que SportMonks plan incluye xG
- Extraer `xGFixture` y computar xG rolling últimos 5/10/20 por equipo
- Crear tabla `team_xg_rolling` actualizada después de cada partido

### 1.5 Player statistics
**Problema**: Stats solo a nivel equipo.
**Acción**:
- Extraer stats por jugador clave (delantero, mediocampista central, portero)
- Identificar "anotador clave" (top scorer) y su disponibilidad
- Alertar si lesión de jugador con >10 goles temporada

### 1.6 Referee Database
**Problema**: Sin historial del árbitro asignado.
**Acción**:
- Crear tabla `referee_stats` con: fouls/game, yellow/game, red/10games, penalty_rate
- Edge function `compute-referee-stats` que se ejecuta diariamente
- Inyectar perfil específico del árbitro en prompts

### 1.7 Fix Calibration Bug
**Problema**: `applyCalibrationPostProcessingV3` se saltea cuando Strategic Insights ON.
**Acción**:
- Remover early return que desactiva calibración
- Aplicar AMBAS: strategic insights (texto) + calibration numérica
- Agregar flag `ENABLE_NUMERICAL_CALIBRATION=true` (default)

### 1.8 No truncar entre capas
**Problema**: Capa 1 → Capa 3 trunca datos a 800 chars.
**Acción**:
- Pasar datos estructurados (JSON) entre capas, no strings truncados
- Crear `LayerContext` type con todos los datos brutos + resúmenes
- Aumentar maxTokens donde sea necesario

---

## FASE 2 — Modelos Matemáticos Base (7-10 días)

### 2.1 Dixon-Coles
**Archivo nuevo**: `supabase/functions/_shared/math-models/dixon-coles.ts`

```typescript
interface DixonColesInput {
  homeHistory: MatchData[];  // últimos 40+ partidos
  awayHistory: MatchData[];
  league: string;
  daysSince: number[];  // para time decay
}

interface DixonColesOutput {
  lambdaHome: number;  // goles esperados local
  lambdaAway: number;  // goles esperados visitante
  scorelineMatrix: number[][];  // P(home_score, away_score)
  probabilities: {
    home_win: number;
    draw: number;
    away_win: number;
    over_05: number; over_15: number; over_25: number; over_35: number; over_45: number;
    btts_yes: number; btts_no: number;
  };
}

function dixonColes(input: DixonColesInput): DixonColesOutput;
```

**Features clave**:
- Time decay: φ(t) = exp(-ξ·t), ξ = 0.0025/día
- Corrección rho (ρ) para bajas puntuaciones (0-0, 1-0, 0-1, 1-1)
- Fuerzas ataque/defensa normalizadas por liga

### 2.2 Club Elo
**Archivo nuevo**: `supabase/functions/_shared/math-models/elo.ts`

```typescript
interface EloRating {
  teamId: number;
  rating: number;
  lastUpdated: string;
}

function computeElo(history: MatchData[]): EloRating[];
function eloProbability(homeElo: number, awayElo: number, homeAdv: number): {
  home: number; draw: number; away: number;
};
```

**Fórmula**: R_new = R_old + K × (actual - expected)
- K adaptive: 20 liga, 40 copa, 60 final
- Home advantage: +65 puntos
- Goal difference multiplier: √(|gd|+1)

### 2.3 Monte Carlo Simulator
**Archivo nuevo**: `supabase/functions/_shared/math-models/monte-carlo.ts`

```typescript
function simulateMatch(lambdaH: number, lambdaA: number, runs: number = 10000): {
  scoreline_probs: Map<string, number>;  // "2-1" -> 0.12
  market_probs: {
    home_win: number;
    draw: number;
    away_win: number;
    btts_yes: number;
    over_25: number;
    // ... todos los mercados derivados de scoreline matrix
  };
}
```

**Por qué**: Un LLM es malo derivando probabilidades de mercados compuestos. Monte Carlo lo hace perfecto y consistente.

### 2.4 Integración en v3-ai-analyzer
**Cambio**: ANTES de la Capa 1 LLM, correr modelos matemáticos y pasarlos como input a los agentes.

```typescript
const mathBase = {
  dixonColes: dixonColes(input),
  elo: { home: homeElo, away: awayElo },
  monteCarlo: simulateMatch(lambdaH, lambdaA, 10000)
};
// Luego pasar mathBase a todos los agentes LLM
```

---

## FASE 3 — Multi-Agent Debate (10-14 días)

### 3.1 Arquitectura
**Archivo nuevo**: `supabase/functions/_shared/agents/index.ts`

```typescript
interface AgentConfig {
  name: string;
  role: string;
  systemPrompt: string;
  preferredModel: string;  // 'groq-gpt-oss-120b' | 'groq-kimi-k2' etc
  temperature: number;
}

interface AgentResponse {
  agent: string;
  analysis: string;
  recommendations: Pick[];
  confidence: number;
  devilsAdvocate?: string;  // contraargumentos
}
```

### 3.2 Los 6 Agentes + Juez

1. **Agente Ofensivo** (gpt-oss-120b, temp 0.3)
   - Especialista en xG, xT, progressive passes, creación
   - Focus: ¿Qué equipo creará más chances?

2. **Agente Defensivo** (gpt-oss-120b, temp 0.3)
   - PPDA, xGA, clean sheets, organización
   - Focus: ¿Qué equipo defenderá mejor?

3. **Agente Táctico** (Kimi K2, temp 0.4)
   - Mirror analysis, Style Similarity, choque de sistemas
   - Focus: Matchup táctico específico

4. **Agente Contextual** (Llama 3.3 70B, temp 0.3)
   - Lesiones, clima, viajes, fatiga, motivación
   - Focus: Factores externos al juego

5. **Agente Mercado** (gpt-oss-120b, temp 0.2)
   - Cuotas, edge, CLV estimado, ineficiencias
   - Focus: ¿Dónde está el valor?

6. **Agente Escéptico / Devil's Advocate** (Kimi K2, temp 0.5)
   - Busca razones para NO apostar
   - Identifica riesgos ocultos
   - Counterfactual reasoning

**Agente Juez** (gpt-oss-120b, temp 0.2)
- Lee análisis de los 6
- Busca consenso o divergencia
- Decide picks finales
- Ajusta confianza según nivel de acuerdo

### 3.3 Sistema de Debate
```
Ronda 1: Cada agente escribe análisis independiente
Ronda 2: Cada agente lee los otros 5 y refina su posición
Juez: Sintetiza con regla "si ≥4/6 coinciden → ALTA confianza"
```

---

## FASE 4 — Feedback Loop Manual (5-7 días)

### 4.1 Schema DB
**Tabla nueva**: `ml_verified_picks`

```sql
CREATE TABLE ml_verified_picks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pick_id UUID REFERENCES value_picks_v2(id),
  actual_outcome TEXT NOT NULL,  -- 'WON' | 'LOST' | 'VOID' | 'PUSH'
  verified_by_system BOOLEAN DEFAULT FALSE,  -- hourly-results-verifier
  verified_by_admin BOOLEAN DEFAULT FALSE,  -- gate manual
  approved_for_learning BOOLEAN DEFAULT FALSE,  -- botón "Aprobar"
  verified_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  admin_notes TEXT,
  system_verdict TEXT,  -- lo que dijo el verificador
  admin_verdict TEXT,   -- lo que dice el admin (override)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ml_verified_pending ON ml_verified_picks(approved_for_learning) WHERE NOT approved_for_learning;
```

### 4.2 Admin UI
**Archivo**: `components/admin/MLLearningGate.tsx`

Muestra tabla con:
- Pick original (mercado, selección, prob, cuota)
- Veredicto del sistema (WON/LOST)
- Resultado real del partido
- Botones: "✓ Aprobar" | "✗ Rechazar" | "Editar veredicto"
- Filtros: Pendientes / Aprobados / Rechazados
- Batch actions

### 4.3 Edge function trainer manual
**Archivo nuevo**: `supabase/functions/ml-manual-trainer/index.ts`

Se triggerea SOLO desde admin. Procesa:
- Lee `ml_verified_picks WHERE approved_for_learning=true AND processed=false`
- Actualiza `ml_calibration_factors` (Platt scaling)
- Actualiza `ml_learned_patterns` (boosts)
- Marca picks como `processed=true`
- NO se ejecuta automáticamente vía cron

---

## FASE 5 — RAG con Historia (5-7 días)

### 5.1 Setup pgvector
```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE ml_pick_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pick_id UUID REFERENCES value_picks_v2(id),
  embedding VECTOR(768),  -- gemini-embedding-004 dim
  features JSONB,  -- xG, Elo diff, league, market
  outcome TEXT,  -- WON/LOST
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pick_embeddings_vec ON ml_pick_embeddings 
USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

### 5.2 Indexación
**Edge function nueva**: `ml-index-picks`

Toma todos los picks aprobados manualmente (gate de Fase 4) y genera embeddings.

### 5.3 RAG en análisis
**En v3-ai-analyzer**, antes del multi-agent:
```typescript
const similarPicks = await supabase.rpc('match_picks', {
  query_embedding: currentMatchEmbedding,
  match_threshold: 0.75,
  match_count: 5
});
// Inyectar en contexto: "Partidos similares pasados: X ganó, Y perdió porque..."
```

---

## FASE 6 — CLV Tracking + Métricas (3-5 días)

### 6.1 CLV capture
**Cron nuevo**: `capture-closing-odds` (5 min antes de cada partido)
- Consulta odds actuales de SportMonks
- Guarda en `value_picks_v2.closing_odds`
- Calcula CLV: (odds_tomada / closing_odds) - 1

### 6.2 Dashboard métricas
**Componente**: `components/admin/MetricsDashboard.tsx`

Muestra:
- ROI histórico (por liga, mercado, rango cuotas)
- Brier score (calibración)
- CLV promedio (por modelo)
- Win rate por confianza band
- Overconfidence gap

---

## Criterios de éxito

| Métrica | Baseline | Target V9 |
|---------|----------|-----------|
| WR general | 65.1% | 73-75% |
| WR top 20% picks | 70% | 82-87% |
| ROI mensual | +5% est | +20% |
| CLV | -0.5% | +3% |
| Brier score | 0.205 | 0.185 |
| Overconfidence gap | 18.9pt | <5pt |

## Rollback strategy

- Variable env `ANALYZER_VERSION=V8|V9` para toggle
- Cada fase es feature-flaggeable
- V8 se mantiene como código legacy durante transición
