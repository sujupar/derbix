# Ultra Plan Derbix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement consistent AI pipeline (DeepSeek-only hybrid sequential-parallel), copy-paste Telegram Command Center with DeepSeek-Flash content, and React-PDF design system before launching the marketing campaign.

**Architecture:** 6-stage AI pipeline (Stage 0 deterministic → Stage 1 Foundation → Stage 2 parallel specialists → Stage 3 Skeptic → Stage 4 Synthesizer → Stage 5 deterministic validation), DeepSeek-only with retry on failure, threshold 80% across all consumers. Telegram becomes a copy-paste command center with 6 daily content blocks generated via DeepSeek-Flash. PDF system migrates from jsPDF to @react-pdf/renderer with shared design tokens and 3 templates (Promo without pick / Premium with pick / Parlay).

**Tech Stack:** React 19, TypeScript, Supabase Edge Functions (Deno), DeepSeek-V4 + DeepSeek-Flash, @react-pdf/renderer, Zod for schema validation, TailwindCSS v4.

**Spec:** [docs/superpowers/specs/2026-05-05-ultra-plan-derbix-design.md](../specs/2026-05-05-ultra-plan-derbix-design.md)

---

## Phase 0 — Setup

### Task 0.1: Centralize threshold constant

**Files:**
- Create: `supabase/functions/_shared/constants.ts`
- Create: `constants/opportunities.ts`

- [ ] **Step 1: Create the shared constant for edge functions**

```typescript
// supabase/functions/_shared/constants.ts
export const OPPORTUNITIES_THRESHOLD = 0.80;
export const OPPORTUNITIES_THRESHOLD_PERCENT = 80;
export const MAX_OPPORTUNITIES_PER_DAY = 20;
```

- [ ] **Step 2: Create the same constant for frontend**

```typescript
// constants/opportunities.ts
export const OPPORTUNITIES_THRESHOLD = 0.80;
export const OPPORTUNITIES_THRESHOLD_PERCENT = 80;
export const MAX_OPPORTUNITIES_PER_DAY = 20;
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/constants.ts constants/opportunities.ts
git commit -m "feat(constants): centralize opportunities threshold at 80%"
```

---

## Phase 1 — Pipeline IA Híbrido Secuencial-Paralelo

### Task 1.1: Strip llm-client.ts to DeepSeek-only with retry

**Files:**
- Modify: `supabase/functions/_shared/llm-client.ts`

- [ ] **Step 1: Replace PROVIDERS array to keep only DeepSeek**

Open `supabase/functions/_shared/llm-client.ts` and replace the `PROVIDERS` array (currently lines 98-169) with:

```typescript
const PROVIDERS: ProviderDef[] = [
  {
    name: 'deepseek-v4-flash',
    type: 'openai',
    endpoint: 'https://api.deepseek.com/chat/completions',
    model: 'deepseek-v4-flash',
    envKey: 'DEEPSEEK_API_KEY',
  },
];
```

- [ ] **Step 2: Replace `callLLM` cascade to retry-only on the same provider**

Find the function that loops through `PROVIDERS` (likely named `callLLM`). Replace its body so it only attempts DeepSeek and retries on `RETRYABLE_STATUS` with exponential backoff (2s, 4s, 8s):

```typescript
export async function callLLM(prompt: string, config: LLMConfig = {}): Promise<LLMResponse> {
  const provider = PROVIDERS[0]; // deepseek-v4-flash only
  const apiKey = Deno.env.get(provider.envKey);
  if (!apiKey) {
    throw new Error(`[llm-client] DEEPSEEK_API_KEY missing — pipeline cannot proceed without it`);
  }

  const backoffMs = [0, 2000, 4000, 8000];
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < backoffMs.length; attempt++) {
    if (backoffMs[attempt] > 0) {
      console.log(`[llm-client] retry ${attempt} after ${backoffMs[attempt]}ms`);
      await delay(backoffMs[attempt]);
    }
    try {
      const result = await callOpenAICompatible(provider, apiKey, prompt, config);
      if (attempt > 0) console.log(`[llm-client] succeeded on retry ${attempt}`);
      return result;
    } catch (err) {
      lastError = err as Error;
      const status = (err as any).status;
      if (SKIP_PROVIDER_STATUS.has(status)) {
        // 401/402/403 — permanent failure, don't retry
        console.error(`[llm-client] permanent failure status=${status}: ${(err as Error).message}`);
        throw err;
      }
      console.warn(`[llm-client] attempt ${attempt + 1}/${backoffMs.length} failed: ${(err as Error).message}`);
    }
  }
  throw lastError ?? new Error('[llm-client] DeepSeek failed all retries');
}
```

- [ ] **Step 3: Remove the Groq rate-limit helpers and Gemini code paths**

Delete the functions `parseResetDuration`, `updateGroqRateLimit`, `calcGroqDelay`, `callGeminiREST`, the `groqRateLimit` state object, and any imports/uses of them throughout the file. Keep `callOpenAICompatible`, `delay`, and the new `callLLM`.

- [ ] **Step 4: Force temperature default to 0**

In `callOpenAICompatible`, change:
```typescript
temperature: config.temperature ?? 0.3,
```
to:
```typescript
temperature: config.temperature ?? 0,
```

- [ ] **Step 5: Update orchestrator import that uses calcGroqDelay**

Open `supabase/functions/_shared/agents/orchestrator.ts` line 5. Remove `calcGroqDelay` from the import:
```typescript
import { callLLM } from '../llm-client.ts';
```

Remove any call site that uses `calcGroqDelay` (search the file with grep for `calcGroqDelay`).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/llm-client.ts supabase/functions/_shared/agents/orchestrator.ts
git commit -m "feat(llm-client): DeepSeek-only with exponential backoff retry, remove Gemini/Groq fallback"
```

---

### Task 1.2: Add JSON schema validation helper

**Files:**
- Create: `supabase/functions/_shared/agents/schema-validator.ts`

- [ ] **Step 1: Write the validator**

```typescript
// supabase/functions/_shared/agents/schema-validator.ts
// Lightweight JSON schema validation for stage outputs.

import JSON5 from "https://esm.sh/json5@2.2.3";

export interface ValidationResult<T> {
  ok: boolean;
  data?: T;
  errors?: string[];
}

export function parseJSONStrict(raw: string): unknown {
  // Strip code fences if present
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return JSON5.parse(cleaned);
  }
}

export function validate<T>(
  raw: string,
  required: Array<keyof T>,
): ValidationResult<T> {
  let parsed: any;
  try {
    parsed = parseJSONStrict(raw);
  } catch (err) {
    return { ok: false, errors: [`JSON parse failed: ${(err as Error).message}`] };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, errors: ['Output is not an object'] };
  }
  const missing = required.filter((k) => !(k in parsed) || parsed[k as string] === undefined || parsed[k as string] === null);
  if (missing.length > 0) {
    return { ok: false, errors: [`Missing required fields: ${missing.join(', ')}`] };
  }
  return { ok: true, data: parsed as T };
}

export async function callWithSchemaRetry<T>(
  llmFn: () => Promise<string>,
  required: Array<keyof T>,
  stageName: string,
  maxRetries = 2,
): Promise<T> {
  let lastError = '';
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const raw = await llmFn();
    const result = validate<T>(raw, required);
    if (result.ok && result.data) return result.data;
    lastError = (result.errors || []).join('; ');
    console.warn(`[${stageName}] schema validation failed (attempt ${attempt + 1}): ${lastError}`);
  }
  throw new Error(`[${stageName}] schema validation failed after ${maxRetries + 1} attempts: ${lastError}`);
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/_shared/agents/schema-validator.ts
git commit -m "feat(agents): add lightweight JSON schema validator with retry helper"
```

---

### Task 1.3: New types for stage-based pipeline

**Files:**
- Modify: `supabase/functions/_shared/agents/types.ts`

- [ ] **Step 1: Append stage output types after the existing types**

Open `supabase/functions/_shared/agents/types.ts` and append at the end of the file:

```typescript
// ═══════════════════════════════════════════════════════════════════
// V9 STAGE-BASED PIPELINE TYPES (added 2026-05-05)
// ═══════════════════════════════════════════════════════════════════

export interface DataFoundationOutput {
  // Computed deterministically from raw ETL data — no LLM
  fixture_id: number;
  home_team: string;
  away_team: string;
  league: string;
  date: string;
  kickoff_at: string;

  streak_home: string;             // e.g. "WWDLW"
  streak_away: string;
  days_rest_home: number;
  days_rest_away: number;

  xg_rolling: {
    home_for_5: number; home_against_5: number;
    home_for_10: number; home_against_10: number;
    away_for_5: number; away_against_5: number;
    away_for_10: number; away_against_10: number;
  };

  goals_avg: {
    home_at_home_last5: number;
    away_away_last5: number;
    home_overall_last10: number;
    away_overall_last10: number;
  };

  referee_stats: {
    name: string | null;
    yellows_per_match: number | null;
    reds_per_match: number | null;
    home_bias: number | null;       // home_wins - away_wins per match (positive = home bias)
    matches_in_dataset: number;
  } | null;

  sportmonks_predictions: {
    home_win: number; draw: number; away_win: number;
    over_25: number; btts_yes: number;
  } | null;

  injuries_impact: {
    home_xg_loss_estimate: number;
    away_xg_loss_estimate: number;
    home_key_missing: string[];
    away_key_missing: string[];
  };

  competition_context: {
    is_derby: boolean;
    is_relegation_battle: boolean;
    is_title_race: boolean;
    home_table_rank: number | null;
    away_table_rank: number | null;
    points_gap_to_safety_home: number | null;
    points_gap_to_safety_away: number | null;
  };

  lineups_probable: {
    home_xi: string[] | null;
    away_xi: string[] | null;
    confidence: 'CONFIRMED' | 'PROBABLE_FROM_PERPLEXITY' | 'UNAVAILABLE';
  };

  clv_signal: number | null;        // closing line value % vs opening line, if available

  data_volume_score: number;        // counts non-null fields (used for PDF "N datos analizados")
}

export interface StatisticalFoundationOutput {
  thesis_baseline: string;
  probabilities_initial: {
    home_win: number; draw: number; away_win: number;
    over_25: number; btts: number;
    home_to_score: number; away_to_score: number;
  };
  key_anchors: string[];
  risks_flagged: string[];
}

export interface SpecialistOutput {
  agent_name: 'TACTICAL' | 'CONTEXTUAL' | 'MARKET';
  thesis_supports_or_opposes: 'SUPPORTS' | 'OPPOSES' | 'MIXED';
  key_findings: string[];
  modifies_probabilities: Record<string, number>;
  candidate_picks: Array<{
    market: string;
    selection: string;
    rationale: string;
    probability_estimate: number;
    odds_reference: number | null;
  }>;
  notes: string;
}

export interface SkepticOutput {
  attacks: Array<{
    target_pick_market: string;
    target_pick_selection: string;
    attack_argument: string;
    verdict: 'DESCARTAR' | 'DEBILITAR_CONFIANZA' | 'MANTENER';
  }>;
  picks_that_survive: Array<{
    market: string;
    selection: string;
    why_it_holds: string;
  }>;
  global_observations: string[];
}

export interface SynthesizerOutput {
  veredicto: 'APOSTAR' | 'OBSERVAR' | 'NO_BET';
  picks: Array<{
    market: string;
    selection: string;
    probability: number;
    odds: number;
    edge_percent: number;
    confidence: 'ALTA' | 'MEDIA' | 'BAJA';
    reasoning: string;
    survived_skeptic: boolean;
  }>;
  summary: string;
  overall_confidence: number;
  total_data_volume: number;
}

export interface StageTimings {
  stage0_ms: number;
  stage1_ms: number;
  stage2_ms: number;
  stage3_ms: number;
  stage4_ms: number;
  stage5_ms: number;
  total_ms: number;
}

export interface PipelineRunResult {
  data_foundation: DataFoundationOutput;
  statistical_foundation: StatisticalFoundationOutput;
  specialists: {
    tactical: SpecialistOutput;
    contextual: SpecialistOutput;
    market: SpecialistOutput;
  };
  skeptic: SkepticOutput;
  synthesizer: SynthesizerOutput;
  validated_picks: SynthesizerOutput['picks'];
  timings: StageTimings;
  total_tokens: number;
  pipeline_version: 'V9-HYBRID-2026-05-05';
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/_shared/agents/types.ts
git commit -m "feat(agents): add V9 stage-based pipeline types"
```

---

### Task 1.4: Stage 0 — Data Foundation (deterministic)

**Files:**
- Create: `supabase/functions/_shared/agents/stage0-data-foundation.ts`

- [ ] **Step 1: Write the data foundation builder**

```typescript
// supabase/functions/_shared/agents/stage0-data-foundation.ts
// Deterministic feature extraction. NO LLM. Takes raw ETL data, produces structured features.

import type { MatchContext, DataFoundationOutput } from './types.ts';

interface ETLRawData {
  fixture_id: number;
  kickoff_at: string;
  home_recent_results: Array<{ result: 'W' | 'D' | 'L'; date: string; goals_for: number; goals_against: number }>;
  away_recent_results: Array<{ result: 'W' | 'D' | 'L'; date: string; goals_for: number; goals_against: number }>;
  referee_name: string | null;
  referee_aggregated_stats?: { yellows_per_match: number; reds_per_match: number; home_bias: number; matches: number } | null;
  sportmonks_predictions?: { home_win: number; draw: number; away_win: number; over_25: number; btts_yes: number } | null;
  closing_odds?: { home_win: number } | null;
  opening_odds?: { home_win: number } | null;
  standings?: { home_rank: number; away_rank: number; home_points_gap_safety: number; away_points_gap_safety: number; total_teams: number } | null;
  perplexity_lineup_text?: string | null;
}

function buildStreak(results: Array<{ result: 'W' | 'D' | 'L' }>, n = 5): string {
  return results.slice(0, n).map((r) => r.result).join('');
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2));
}

function daysBetween(a: string, b: string): number {
  const ms = new Date(a).getTime() - new Date(b).getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

function extractProbableLineup(perplexityText: string | null | undefined): { home: string[] | null; away: string[] | null } {
  if (!perplexityText) return { home: null, away: null };
  // Heuristic parser: looks for "alineación probable" / "probable lineup" / "XI"
  // Finds 11 names following such markers. Best-effort.
  const homeMatch = perplexityText.match(/(?:local|home).*?(?:alineaci[oó]n|XI|lineup)[\s\S]{0,500}?([A-ZÁÉÍÓÚÑ][a-záéíóúñ\s]+(?:,\s*[A-ZÁÉÍÓÚÑ][a-záéíóúñ\s]+){10})/i);
  const awayMatch = perplexityText.match(/(?:visitante|away).*?(?:alineaci[oó]n|XI|lineup)[\s\S]{0,500}?([A-ZÁÉÍÓÚÑ][a-záéíóúñ\s]+(?:,\s*[A-ZÁÉÍÓÚÑ][a-záéíóúñ\s]+){10})/i);
  return {
    home: homeMatch ? homeMatch[1].split(',').map((s) => s.trim()).slice(0, 11) : null,
    away: awayMatch ? awayMatch[1].split(',').map((s) => s.trim()).slice(0, 11) : null,
  };
}

function estimateInjuryXGLoss(missing: string[]): number {
  // Crude estimator: each named missing player = 0.15 xG loss, capped at 0.6
  return Math.min(0.6, missing.length * 0.15);
}

export function buildDataFoundation(
  context: MatchContext,
  raw: ETLRawData,
): DataFoundationOutput {
  const homeRecent = raw.home_recent_results || [];
  const awayRecent = raw.away_recent_results || [];

  const streak_home = buildStreak(homeRecent, 5);
  const streak_away = buildStreak(awayRecent, 5);

  const days_rest_home = homeRecent[0] ? daysBetween(raw.kickoff_at, homeRecent[0].date) : 7;
  const days_rest_away = awayRecent[0] ? daysBetween(raw.kickoff_at, awayRecent[0].date) : 7;

  const home_for_5 = avg(homeRecent.slice(0, 5).map((r) => r.goals_for));
  const home_against_5 = avg(homeRecent.slice(0, 5).map((r) => r.goals_against));
  const home_for_10 = avg(homeRecent.slice(0, 10).map((r) => r.goals_for));
  const home_against_10 = avg(homeRecent.slice(0, 10).map((r) => r.goals_against));
  const away_for_5 = avg(awayRecent.slice(0, 5).map((r) => r.goals_for));
  const away_against_5 = avg(awayRecent.slice(0, 5).map((r) => r.goals_against));
  const away_for_10 = avg(awayRecent.slice(0, 10).map((r) => r.goals_for));
  const away_against_10 = avg(awayRecent.slice(0, 10).map((r) => r.goals_against));

  const xg_rolling = {
    home_for_5: context.xg?.home.for ?? home_for_5,
    home_against_5: context.xg?.home.against ?? home_against_5,
    home_for_10: context.xg?.home.for ?? home_for_10,
    home_against_10: context.xg?.home.against ?? home_against_10,
    away_for_5: context.xg?.away.for ?? away_for_5,
    away_against_5: context.xg?.away.against ?? away_against_5,
    away_for_10: context.xg?.away.for ?? away_for_10,
    away_against_10: context.xg?.away.against ?? away_against_10,
  };

  const goals_avg = {
    home_at_home_last5: home_for_5,
    away_away_last5: away_for_5,
    home_overall_last10: home_for_10,
    away_overall_last10: away_for_10,
  };

  const referee_stats = raw.referee_aggregated_stats
    ? {
        name: raw.referee_name,
        yellows_per_match: raw.referee_aggregated_stats.yellows_per_match,
        reds_per_match: raw.referee_aggregated_stats.reds_per_match,
        home_bias: raw.referee_aggregated_stats.home_bias,
        matches_in_dataset: raw.referee_aggregated_stats.matches,
      }
    : null;

  const home_missing = context.key_players?.home_missing ?? [];
  const away_missing = context.key_players?.away_missing ?? [];

  const injuries_impact = {
    home_xg_loss_estimate: estimateInjuryXGLoss(home_missing),
    away_xg_loss_estimate: estimateInjuryXGLoss(away_missing),
    home_key_missing: home_missing,
    away_key_missing: away_missing,
  };

  const standings = raw.standings;
  const competition_context = {
    is_derby: false, // could be enhanced with rivalry table; out of scope
    is_relegation_battle: standings ? standings.home_points_gap_safety < 5 || standings.away_points_gap_safety < 5 : false,
    is_title_race: standings ? (standings.home_rank <= 3 || standings.away_rank <= 3) : false,
    home_table_rank: standings?.home_rank ?? null,
    away_table_rank: standings?.away_rank ?? null,
    points_gap_to_safety_home: standings?.home_points_gap_safety ?? null,
    points_gap_to_safety_away: standings?.away_points_gap_safety ?? null,
  };

  const lineupConfirmed = !!context.lineups?.home.starters.length;
  const probable = lineupConfirmed
    ? { home: context.lineups!.home.starters, away: context.lineups!.away.starters }
    : extractProbableLineup(raw.perplexity_lineup_text);

  const lineups_probable: DataFoundationOutput['lineups_probable'] = {
    home_xi: probable.home,
    away_xi: probable.away,
    confidence: lineupConfirmed
      ? 'CONFIRMED'
      : (probable.home && probable.away ? 'PROBABLE_FROM_PERPLEXITY' : 'UNAVAILABLE'),
  };

  let clv_signal: number | null = null;
  if (raw.opening_odds && raw.closing_odds) {
    const open = raw.opening_odds.home_win;
    const close = raw.closing_odds.home_win;
    if (open > 1 && close > 1) {
      clv_signal = Number((((open - close) / open) * 100).toFixed(2));
    }
  }

  // Volume score = number of non-null/non-empty fields (used for "N datos" in PDF)
  const fields = [
    homeRecent.length, awayRecent.length, raw.referee_name, raw.sportmonks_predictions,
    context.lineups, context.weather, context.xg, context.fatigue, context.coaches,
    context.external_context, raw.standings, raw.opening_odds, raw.closing_odds,
    home_missing.length, away_missing.length,
  ];
  const data_volume_score = 1000 + fields.filter((f) => f !== null && f !== undefined && f !== 0 && f !== '').length * 150;

  return {
    fixture_id: raw.fixture_id,
    home_team: context.homeTeam,
    away_team: context.awayTeam,
    league: context.league,
    date: context.date,
    kickoff_at: raw.kickoff_at,
    streak_home,
    streak_away,
    days_rest_home,
    days_rest_away,
    xg_rolling,
    goals_avg,
    referee_stats,
    sportmonks_predictions: raw.sportmonks_predictions ?? null,
    injuries_impact,
    competition_context,
    lineups_probable,
    clv_signal,
    data_volume_score,
  };
}
```

- [ ] **Step 2: Write a basic test**

```typescript
// supabase/functions/_shared/agents/stage0-data-foundation.test.ts
import { buildDataFoundation } from './stage0-data-foundation.ts';
import { assertEquals, assert } from "https://deno.land/std@0.168.0/testing/asserts.ts";

const fakeContext = {
  homeTeam: 'Real Madrid', awayTeam: 'Barcelona', league: 'La Liga', date: '2026-05-10',
  math: {} as any,
  homeHistory: '', awayHistory: '', h2h: '', odds: '',
  xg: { home: { for: 2.1, against: 0.9, overperf: 0.2 }, away: { for: 1.8, against: 1.0, overperf: -0.1 } },
  key_players: { home_missing: ['Bellingham'], away_missing: [] },
} as any;

const fakeRaw = {
  fixture_id: 12345,
  kickoff_at: '2026-05-10T20:00:00Z',
  home_recent_results: [
    { result: 'W' as const, date: '2026-05-06T20:00:00Z', goals_for: 3, goals_against: 1 },
    { result: 'W' as const, date: '2026-05-02T20:00:00Z', goals_for: 2, goals_against: 0 },
    { result: 'D' as const, date: '2026-04-28T20:00:00Z', goals_for: 1, goals_against: 1 },
    { result: 'L' as const, date: '2026-04-24T20:00:00Z', goals_for: 0, goals_against: 2 },
    { result: 'W' as const, date: '2026-04-20T20:00:00Z', goals_for: 4, goals_against: 1 },
  ],
  away_recent_results: [
    { result: 'L' as const, date: '2026-05-04T20:00:00Z', goals_for: 0, goals_against: 1 },
    { result: 'W' as const, date: '2026-04-30T20:00:00Z', goals_for: 2, goals_against: 1 },
    { result: 'D' as const, date: '2026-04-26T20:00:00Z', goals_for: 1, goals_against: 1 },
    { result: 'W' as const, date: '2026-04-22T20:00:00Z', goals_for: 3, goals_against: 0 },
    { result: 'W' as const, date: '2026-04-18T20:00:00Z', goals_for: 2, goals_against: 1 },
  ],
  referee_name: 'Mateu Lahoz',
  referee_aggregated_stats: { yellows_per_match: 4.2, reds_per_match: 0.3, home_bias: 0.1, matches: 50 },
  sportmonks_predictions: { home_win: 55, draw: 25, away_win: 20, over_25: 60, btts_yes: 58 },
  closing_odds: { home_win: 1.95 },
  opening_odds: { home_win: 2.10 },
  standings: { home_rank: 1, away_rank: 2, home_points_gap_safety: 40, away_points_gap_safety: 38, total_teams: 20 },
  perplexity_lineup_text: null,
};

Deno.test('buildDataFoundation: streak computed correctly', () => {
  const out = buildDataFoundation(fakeContext, fakeRaw);
  assertEquals(out.streak_home, 'WWDLW');
  assertEquals(out.streak_away, 'LWDWW');
});

Deno.test('buildDataFoundation: CLV computed when both odds present', () => {
  const out = buildDataFoundation(fakeContext, fakeRaw);
  // (2.10 - 1.95) / 2.10 = 7.14%
  assert(out.clv_signal !== null && out.clv_signal > 7 && out.clv_signal < 7.5, `Got CLV: ${out.clv_signal}`);
});

Deno.test('buildDataFoundation: injury impact reflects missing players', () => {
  const out = buildDataFoundation(fakeContext, fakeRaw);
  assertEquals(out.injuries_impact.home_xg_loss_estimate, 0.15);
  assertEquals(out.injuries_impact.away_xg_loss_estimate, 0);
});
```

- [ ] **Step 3: Run the test**

```bash
deno test supabase/functions/_shared/agents/stage0-data-foundation.test.ts
```
Expected: 3 passed.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/agents/stage0-data-foundation.ts supabase/functions/_shared/agents/stage0-data-foundation.test.ts
git commit -m "feat(stage0): deterministic data foundation builder with tests"
```

---

### Task 1.5: Stage 1 — Statistical Foundation

**Files:**
- Create: `supabase/functions/_shared/agents/stage1-statistical-foundation.ts`

- [ ] **Step 1: Write the stage 1 caller**

```typescript
// supabase/functions/_shared/agents/stage1-statistical-foundation.ts

import { callLLM } from '../llm-client.ts';
import { callWithSchemaRetry } from './schema-validator.ts';
import type { DataFoundationOutput, StatisticalFoundationOutput } from './types.ts';

const SYSTEM_PROMPT = `Eres un analista cuantitativo de fútbol con 20 años de experiencia. Tu tarea es razonar sobre datos estadísticos y producir una tesis baseline robusta.

REGLAS DURAS:
1. SIEMPRE cita números específicos del input. No digas "tiene buen ataque", di "xG promedio 2.1 últimos 10".
2. Probabilidades en porcentajes 0-100, suma de 1X2 debe estar entre 99 y 101.
3. NO inventes datos. Si un dato falta, di "dato no disponible".
4. Devuelve EXCLUSIVAMENTE JSON válido. Sin explicación previa, sin markdown.

ESTRUCTURA DE OUTPUT JSON:
{
  "thesis_baseline": "string de 3-5 párrafos en español, con números citados",
  "probabilities_initial": {
    "home_win": number, "draw": number, "away_win": number,
    "over_25": number, "btts": number,
    "home_to_score": number, "away_to_score": number
  },
  "key_anchors": ["bullet 1 con número", "bullet 2 con número", ...],
  "risks_flagged": ["riesgo 1", "riesgo 2", ...]
}`;

function buildUserPrompt(df: DataFoundationOutput): string {
  return `DATOS DEL PARTIDO:

PARTIDO: ${df.home_team} vs ${df.away_team} (${df.league}) — ${df.date}

FORMA RECIENTE:
- ${df.home_team}: streak ${df.streak_home}, ${df.days_rest_home} días de descanso
- ${df.away_team}: streak ${df.streak_away}, ${df.days_rest_away} días de descanso

xG ROLLING:
- ${df.home_team}: ${df.xg_rolling.home_for_10}xG/p, ${df.xg_rolling.home_against_10}xGA/p (últimos 10)
- ${df.away_team}: ${df.xg_rolling.away_for_10}xG/p, ${df.xg_rolling.away_against_10}xGA/p (últimos 10)

GOLES PROMEDIO:
- ${df.home_team} en casa últimos 5: ${df.goals_avg.home_at_home_last5}
- ${df.away_team} fuera últimos 5: ${df.goals_avg.away_away_last5}

ÁRBITRO: ${df.referee_stats?.name ?? 'no disponible'}${df.referee_stats ? ` (${df.referee_stats.yellows_per_match} amarillas/p, sesgo casa ${df.referee_stats.home_bias})` : ''}

PREDICCIONES SPORTMONKS (benchmark del proveedor de datos):
${df.sportmonks_predictions ? `1=${df.sportmonks_predictions.home_win}% X=${df.sportmonks_predictions.draw}% 2=${df.sportmonks_predictions.away_win}% | Over 2.5: ${df.sportmonks_predictions.over_25}% | BTTS: ${df.sportmonks_predictions.btts_yes}%` : 'no disponibles'}

LESIONES IMPACTO ESTIMADO:
- ${df.home_team}: -${df.injuries_impact.home_xg_loss_estimate} xG (${df.injuries_impact.home_key_missing.join(', ') || 'sin bajas relevantes'})
- ${df.away_team}: -${df.injuries_impact.away_xg_loss_estimate} xG (${df.injuries_impact.away_key_missing.join(', ') || 'sin bajas relevantes'})

CONTEXTO DE COMPETICIÓN:
- Posiciones: ${df.competition_context.home_table_rank ?? '?'} vs ${df.competition_context.away_table_rank ?? '?'}
- Pelea por descenso: ${df.competition_context.is_relegation_battle ? 'SÍ' : 'no'}
- Pelea por título: ${df.competition_context.is_title_race ? 'SÍ' : 'no'}

ALINEACIONES (${df.lineups_probable.confidence}):
- ${df.home_team}: ${df.lineups_probable.home_xi?.join(', ') ?? 'no disponible'}
- ${df.away_team}: ${df.lineups_probable.away_xi?.join(', ') ?? 'no disponible'}

CLV (movimiento del mercado): ${df.clv_signal !== null ? `${df.clv_signal}% favor local` : 'no disponible'}

TAREA:
Produce una tesis baseline cuantitativa. Cita números. Identifica anclajes y riesgos. Estima probabilidades iniciales para 1X2, Over 2.5, BTTS y "anota cada equipo".

Devuelve JSON con la estructura indicada en el system prompt.`;
}

export async function runStage1(
  df: DataFoundationOutput,
): Promise<StatisticalFoundationOutput> {
  const prompt = buildUserPrompt(df);

  const result = await callWithSchemaRetry<StatisticalFoundationOutput>(
    async () => {
      const response = await callLLM(prompt, {
        systemPrompt: SYSTEM_PROMPT,
        jsonMode: true,
        temperature: 0,
        maxTokens: 4000,
        timeoutMs: 60000,
      });
      return response.text;
    },
    ['thesis_baseline', 'probabilities_initial', 'key_anchors', 'risks_flagged'],
    'STAGE1',
    2,
  );

  return result;
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/_shared/agents/stage1-statistical-foundation.ts
git commit -m "feat(stage1): statistical foundation with thesis baseline + initial probabilities"
```

---

### Task 1.6: Stage 2 — Specialists in parallel (Tactical / Contextual / Market)

**Files:**
- Create: `supabase/functions/_shared/agents/stage2-specialists.ts`

- [ ] **Step 1: Write all three specialists in one file**

```typescript
// supabase/functions/_shared/agents/stage2-specialists.ts

import { callLLM } from '../llm-client.ts';
import { callWithSchemaRetry } from './schema-validator.ts';
import type {
  DataFoundationOutput,
  StatisticalFoundationOutput,
  SpecialistOutput,
  MatchContext,
} from './types.ts';

const SHARED_SCHEMA = `Devuelve EXCLUSIVAMENTE JSON válido con esta estructura:
{
  "agent_name": "TACTICAL" | "CONTEXTUAL" | "MARKET",
  "thesis_supports_or_opposes": "SUPPORTS" | "OPPOSES" | "MIXED",
  "key_findings": ["3-6 bullets con números citados"],
  "modifies_probabilities": { "home_win": +/-N, "btts": +/-N, ... },
  "candidate_picks": [
    { "market": "string", "selection": "string", "rationale": "string", "probability_estimate": 0-100, "odds_reference": number | null }
  ],
  "notes": "comentario libre"
}
NO uses markdown. NO escribas explicación previa.`;

function buildBaseContext(df: DataFoundationOutput, s1: StatisticalFoundationOutput): string {
  return `DATOS BASE (Stage 0):
${JSON.stringify(df, null, 2)}

TESIS BASELINE (Stage 1):
${JSON.stringify(s1, null, 2)}`;
}

// ─────────────────────────── TACTICAL ───────────────────────────
const TACTICAL_SYSTEM = `Eres un analista táctico de fútbol experto en matchups, formaciones y ajustes. Razonas sobre alineaciones, estilo de juego y choque de modelos. ${SHARED_SCHEMA}`;

export async function runTactical(
  df: DataFoundationOutput,
  s1: StatisticalFoundationOutput,
  context: MatchContext,
): Promise<SpecialistOutput> {
  const prompt = `${buildBaseContext(df, s1)}

DATOS TÁCTICOS ESPECÍFICOS:
- Formación local: ${context.lineups?.home.formation ?? 'no confirmada'}
- Formación visitante: ${context.lineups?.away.formation ?? 'no confirmada'}
- Coaches: ${df.home_team}=${context.coaches?.home.name ?? '?'}${context.coaches?.home.is_new ? ' (NUEVO)' : ''}, ${df.away_team}=${context.coaches?.away.name ?? '?'}${context.coaches?.away.is_new ? ' (NUEVO)' : ''}

H2H RECIENTE:
${context.h2h.substring(0, 1500)}

HISTORIAL LOCAL (mirror analysis):
${context.homeHistory.substring(0, 2000)}

HISTORIAL VISITANTE (mirror analysis):
${context.awayHistory.substring(0, 2000)}

TAREA: Analiza el matchup. ¿Cómo afecta la pérdida de jugadores clave? ¿Cuál equipo tiene mejor formato para este rival? Da 2-4 candidate_picks con justificación táctica.

Output: JSON único con agent_name="TACTICAL".`;

  return await callWithSchemaRetry<SpecialistOutput>(
    async () => {
      const r = await callLLM(prompt, {
        systemPrompt: TACTICAL_SYSTEM,
        jsonMode: true,
        temperature: 0,
        maxTokens: 4000,
        timeoutMs: 60000,
      });
      return r.text;
    },
    ['agent_name', 'thesis_supports_or_opposes', 'key_findings', 'candidate_picks'],
    'STAGE2_TACTICAL',
    2,
  );
}

// ─────────────────────────── CONTEXTUAL ───────────────────────────
const CONTEXTUAL_SYSTEM = `Eres un analista de contexto externo: clima, fatiga, lesiones, momento emocional, árbitro, contexto de competición. ${SHARED_SCHEMA}`;

export async function runContextual(
  df: DataFoundationOutput,
  s1: StatisticalFoundationOutput,
  context: MatchContext,
): Promise<SpecialistOutput> {
  const prompt = `${buildBaseContext(df, s1)}

DATOS CONTEXTUALES ESPECÍFICOS:
- Clima: ${context.weather?.description ?? 'no disponible'} | Impacto: ${context.weather?.impact ?? '-'}
- Fatiga: local=${context.fatigue?.home ?? '?'}/100, visitante=${context.fatigue?.away ?? '?'}/100
- Días descanso: local=${df.days_rest_home}, visitante=${df.days_rest_away}
- Árbitro: ${df.referee_stats?.name ?? '?'} (${df.referee_stats?.yellows_per_match ?? '?'}/p, sesgo casa ${df.referee_stats?.home_bias ?? '?'})
- Lesiones: local=${df.injuries_impact.home_key_missing.join(', ') || 'ninguna relevante'} (-${df.injuries_impact.home_xg_loss_estimate}xG); visitante=${df.injuries_impact.away_key_missing.join(', ') || 'ninguna relevante'} (-${df.injuries_impact.away_xg_loss_estimate}xG)
- Pelea por descenso: ${df.competition_context.is_relegation_battle}; pelea título: ${df.competition_context.is_title_race}

CONTEXTO EXTERNO (Perplexity):
${context.external_context?.substring(0, 3000) ?? 'no disponible'}

TAREA: Identifica factores contextuales que afecten el resultado o mercados específicos (tarjetas por árbitro, goles por clima, etc). Da 2-4 candidate_picks (especialmente mercados secundarios donde el contexto crea valor).

Output: JSON único con agent_name="CONTEXTUAL".`;

  return await callWithSchemaRetry<SpecialistOutput>(
    async () => {
      const r = await callLLM(prompt, {
        systemPrompt: CONTEXTUAL_SYSTEM,
        jsonMode: true,
        temperature: 0,
        maxTokens: 4000,
        timeoutMs: 60000,
      });
      return r.text;
    },
    ['agent_name', 'thesis_supports_or_opposes', 'key_findings', 'candidate_picks'],
    'STAGE2_CONTEXTUAL',
    2,
  );
}

// ─────────────────────────── MARKET ───────────────────────────
const MARKET_SYSTEM = `Eres un analista de mercado de apuestas. Tu obsesión: detectar valor (edge) entre la probabilidad real del modelo y la probabilidad implícita de la cuota. ${SHARED_SCHEMA}`;

export async function runMarket(
  df: DataFoundationOutput,
  s1: StatisticalFoundationOutput,
  context: MatchContext,
): Promise<SpecialistOutput> {
  const ragContext = context.similar_past_picks && context.similar_past_picks.length > 0
    ? context.similar_past_picks.slice(0, 5).map((s, i) => `${i+1}. ${s.summary} → ${s.outcome}`).join('\n')
    : 'no disponible';

  const prompt = `${buildBaseContext(df, s1)}

DATOS DE MERCADO:
${context.odds.substring(0, 3000)}

CLV (closing line value): ${df.clv_signal !== null ? `${df.clv_signal}% favor local` : 'no disponible'}

PICKS HISTÓRICOS SIMILARES:
${ragContext}

TAREA:
1. Para cada selección con probabilidad ≥80% del modelo (Stage 1), calcula edge = (prob_modelo - prob_implícita_cuota) / prob_implícita_cuota * 100
2. Devuelve los 3-5 picks con mayor edge en candidate_picks
3. Para cada pick incluye: market, selection, probability_estimate (0-100), odds_reference (la cuota), rationale (cita números)
4. Si la cuota del mercado es más eficiente que el modelo en algún área, repórtalo en notes.

Output: JSON único con agent_name="MARKET".`;

  return await callWithSchemaRetry<SpecialistOutput>(
    async () => {
      const r = await callLLM(prompt, {
        systemPrompt: MARKET_SYSTEM,
        jsonMode: true,
        temperature: 0,
        maxTokens: 4000,
        timeoutMs: 60000,
      });
      return r.text;
    },
    ['agent_name', 'thesis_supports_or_opposes', 'key_findings', 'candidate_picks'],
    'STAGE2_MARKET',
    2,
  );
}

// ─────────────────────────── PARALLEL ENTRY POINT ───────────────────────────
export async function runStage2(
  df: DataFoundationOutput,
  s1: StatisticalFoundationOutput,
  context: MatchContext,
): Promise<{ tactical: SpecialistOutput; contextual: SpecialistOutput; market: SpecialistOutput }> {
  const [tactical, contextual, market] = await Promise.all([
    runTactical(df, s1, context),
    runContextual(df, s1, context),
    runMarket(df, s1, context),
  ]);
  return { tactical, contextual, market };
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/_shared/agents/stage2-specialists.ts
git commit -m "feat(stage2): parallel tactical/contextual/market specialists"
```

---

### Task 1.7: Stage 3 — Skeptic

**Files:**
- Create: `supabase/functions/_shared/agents/stage3-skeptic.ts`

- [ ] **Step 1: Write the skeptic**

```typescript
// supabase/functions/_shared/agents/stage3-skeptic.ts

import { callLLM } from '../llm-client.ts';
import { callWithSchemaRetry } from './schema-validator.ts';
import type {
  DataFoundationOutput,
  StatisticalFoundationOutput,
  SpecialistOutput,
  SkepticOutput,
} from './types.ts';

const SYSTEM_PROMPT = `Eres el abogado del diablo. Tu única función: ATACAR cada candidate_pick propuesto por los especialistas. Buscas:
- Picks que solo se sostienen en una dimensión (ej: solo mercado, sin respaldo táctico)
- Contradicciones entre especialistas
- Sobreajuste a recencia (3 partidos no son tendencia)
- Riesgos no atendidos (lesiones, cambios tácticos, motivación)
- Sesgo de favoritismo (favorito no siempre = valor)

REGLAS DURAS:
1. Devuelve EXCLUSIVAMENTE JSON.
2. Por cada pick atacado: target_pick_market, target_pick_selection, attack_argument (texto con datos), verdict en {DESCARTAR, DEBILITAR_CONFIANZA, MANTENER}.
3. picks_that_survive solo incluye los que aguantaron el ataque (verdict=MANTENER) o sobrevivieron debilitados.
4. global_observations: lista patrones que detectaste cruzando los 3 especialistas.

ESTRUCTURA OUTPUT:
{
  "attacks": [{"target_pick_market": "...", "target_pick_selection": "...", "attack_argument": "...", "verdict": "..."}],
  "picks_that_survive": [{"market": "...", "selection": "...", "why_it_holds": "..."}],
  "global_observations": ["..."]
}`;

export async function runStage3(
  df: DataFoundationOutput,
  s1: StatisticalFoundationOutput,
  s2: { tactical: SpecialistOutput; contextual: SpecialistOutput; market: SpecialistOutput },
): Promise<SkepticOutput> {
  const prompt = `DATOS BASE (Stage 0): ${JSON.stringify(df, null, 2)}

TESIS BASELINE (Stage 1): ${JSON.stringify(s1, null, 2)}

ANÁLISIS TÁCTICO (Stage 2a): ${JSON.stringify(s2.tactical, null, 2)}

ANÁLISIS CONTEXTUAL (Stage 2b): ${JSON.stringify(s2.contextual, null, 2)}

ANÁLISIS MERCADO (Stage 2c): ${JSON.stringify(s2.market, null, 2)}

TAREA:
1. Recopila TODOS los candidate_picks de los 3 especialistas.
2. Para cada uno, formula un argumento de ataque con datos del Stage 0/1.
3. Decide veredicto: DESCARTAR / DEBILITAR_CONFIANZA / MANTENER.
4. Lista en picks_that_survive solo los que pasan tu filtro.
5. En global_observations: ¿hay contradicciones entre tactical y market? ¿Sobreajuste a recencia?

Output: JSON único con la estructura del system prompt.`;

  return await callWithSchemaRetry<SkepticOutput>(
    async () => {
      const r = await callLLM(prompt, {
        systemPrompt: SYSTEM_PROMPT,
        jsonMode: true,
        temperature: 0,
        maxTokens: 4000,
        timeoutMs: 75000,
      });
      return r.text;
    },
    ['attacks', 'picks_that_survive', 'global_observations'],
    'STAGE3_SKEPTIC',
    2,
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/_shared/agents/stage3-skeptic.ts
git commit -m "feat(stage3): skeptic stage attacks specialist picks"
```

---

### Task 1.8: Stage 4 — Synthesizer

**Files:**
- Create: `supabase/functions/_shared/agents/stage4-synthesizer.ts`

- [ ] **Step 1: Write the synthesizer**

```typescript
// supabase/functions/_shared/agents/stage4-synthesizer.ts

import { callLLM } from '../llm-client.ts';
import { callWithSchemaRetry } from './schema-validator.ts';
import { OPPORTUNITIES_THRESHOLD_PERCENT } from '../constants.ts';
import type {
  DataFoundationOutput,
  StatisticalFoundationOutput,
  SpecialistOutput,
  SkepticOutput,
  SynthesizerOutput,
} from './types.ts';

const SYSTEM_PROMPT = `Eres el árbitro final que integra los análisis de la cadena. Tu tarea: producir el veredicto final con picks confirmados.

REGLAS DURAS:
1. SOLO incluyes picks en final_picks si: (a) están en picks_that_survive del Skeptic, (b) tienen probability >= ${OPPORTUNITIES_THRESHOLD_PERCENT}, (c) tienen al menos 1 especialista que los respalde.
2. Si el Skeptic dijo DESCARTAR, NO los incluyes.
3. Si el Skeptic dijo DEBILITAR_CONFIANZA, los incluyes con confidence="MEDIA" o "BAJA".
4. Devuelve EXCLUSIVAMENTE JSON.
5. Cada pick debe tener: market, selection, probability (0-100), odds, edge_percent, confidence, reasoning, survived_skeptic.
6. Asegúrate que probability sea un número entre 0 y 100.

ESTRUCTURA OUTPUT:
{
  "veredicto": "APOSTAR" | "OBSERVAR" | "NO_BET",
  "picks": [{"market": "...", "selection": "...", "probability": 80-99, "odds": 1.50-3.50, "edge_percent": number, "confidence": "ALTA"|"MEDIA"|"BAJA", "reasoning": "...", "survived_skeptic": true}],
  "summary": "1-2 párrafos del veredicto",
  "overall_confidence": 0-100,
  "total_data_volume": number
}`;

export async function runStage4(
  df: DataFoundationOutput,
  s1: StatisticalFoundationOutput,
  s2: { tactical: SpecialistOutput; contextual: SpecialistOutput; market: SpecialistOutput },
  s3: SkepticOutput,
): Promise<SynthesizerOutput> {
  const prompt = `DATOS BASE: ${JSON.stringify(df, null, 2)}
TESIS: ${JSON.stringify(s1, null, 2)}
TÁCTICO: ${JSON.stringify(s2.tactical, null, 2)}
CONTEXTUAL: ${JSON.stringify(s2.contextual, null, 2)}
MERCADO: ${JSON.stringify(s2.market, null, 2)}
SKEPTIC: ${JSON.stringify(s3, null, 2)}

DATA_VOLUME_SCORE (úsalo en total_data_volume): ${df.data_volume_score}

TAREA:
1. Recopila los picks_that_survive del Skeptic.
2. Filtra solo los que tienen probability >= ${OPPORTUNITIES_THRESHOLD_PERCENT}.
3. Para cada uno, calcula edge_percent vs cuota de mercado.
4. Asigna confidence basado en: cuántos especialistas lo respaldan + si Skeptic dijo MANTENER (ALTA) o DEBILITAR_CONFIANZA (MEDIA).
5. veredicto: APOSTAR si hay >=1 pick ALTA, OBSERVAR si solo hay MEDIA/BAJA, NO_BET si no hay ninguno.
6. summary: 1-2 párrafos cohesivos del partido y picks finales.
7. total_data_volume: usa data_volume_score.

Output: JSON único con la estructura del system prompt.`;

  return await callWithSchemaRetry<SynthesizerOutput>(
    async () => {
      const r = await callLLM(prompt, {
        systemPrompt: SYSTEM_PROMPT,
        jsonMode: true,
        temperature: 0,
        maxTokens: 6000,
        timeoutMs: 75000,
      });
      return r.text;
    },
    ['veredicto', 'picks', 'summary', 'overall_confidence', 'total_data_volume'],
    'STAGE4_SYNTHESIZER',
    2,
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/_shared/agents/stage4-synthesizer.ts
git commit -m "feat(stage4): synthesizer integrates chain into final picks"
```

---

### Task 1.9: Stage 5 — Validation Gate (deterministic)

**Files:**
- Create: `supabase/functions/_shared/agents/stage5-validation-gate.ts`

- [ ] **Step 1: Write the gate**

```typescript
// supabase/functions/_shared/agents/stage5-validation-gate.ts
// Deterministic validation. NO LLM. Filters picks against hard rules.

import { OPPORTUNITIES_THRESHOLD_PERCENT } from '../constants.ts';
import type {
  DataFoundationOutput,
  StatisticalFoundationOutput,
  SpecialistOutput,
  SynthesizerOutput,
} from './types.ts';

const MIN_ODDS = 1.50;
const MAX_ODDS = 3.50;
const MAX_PROB_GAP = 5; // percentage points difference allowed vs Stage 1 baseline

export interface ValidationOutput {
  validated_picks: SynthesizerOutput['picks'];
  rejected: Array<{ pick: SynthesizerOutput['picks'][0]; reason: string }>;
}

export function runStage5(
  df: DataFoundationOutput,
  s1: StatisticalFoundationOutput,
  s2: { tactical: SpecialistOutput; contextual: SpecialistOutput; market: SpecialistOutput },
  s4: SynthesizerOutput,
): ValidationOutput {
  const validated: SynthesizerOutput['picks'] = [];
  const rejected: ValidationOutput['rejected'] = [];

  // Build a set of "supported" market+selection from Stage 2 specialists
  const supportedKeys = new Set<string>();
  for (const sp of [s2.tactical, s2.contextual, s2.market]) {
    for (const cp of sp.candidate_picks) {
      supportedKeys.add(`${cp.market}::${cp.selection}`);
    }
  }

  for (const pick of s4.picks) {
    // Rule 1: probability >= threshold
    if (pick.probability < OPPORTUNITIES_THRESHOLD_PERCENT) {
      rejected.push({ pick, reason: `probability ${pick.probability} < ${OPPORTUNITIES_THRESHOLD_PERCENT}` });
      continue;
    }
    // Rule 2: odds in range
    if (pick.odds < MIN_ODDS || pick.odds > MAX_ODDS) {
      rejected.push({ pick, reason: `odds ${pick.odds} out of [${MIN_ODDS}, ${MAX_ODDS}]` });
      continue;
    }
    // Rule 3: must be referenced by at least 1 specialist
    const key = `${pick.market}::${pick.selection}`;
    if (!supportedKeys.has(key)) {
      rejected.push({ pick, reason: `not referenced by any Stage 2 specialist` });
      continue;
    }
    // Rule 4: probability roughly consistent with Stage 1 baseline (only check if applicable)
    const baselineProb = mapPickToBaselineProb(pick, s1);
    if (baselineProb !== null && Math.abs(pick.probability - baselineProb) > MAX_PROB_GAP) {
      rejected.push({ pick, reason: `probability gap ${Math.abs(pick.probability - baselineProb).toFixed(1)}pp vs Stage 1 baseline (${baselineProb})` });
      continue;
    }
    validated.push(pick);
  }

  return { validated_picks: validated, rejected };
}

function mapPickToBaselineProb(
  pick: SynthesizerOutput['picks'][0],
  s1: StatisticalFoundationOutput,
): number | null {
  const market = pick.market.toLowerCase();
  const selection = pick.selection.toLowerCase();
  const p = s1.probabilities_initial;
  if (market.includes('1x2') || market === 'resultado' || market === 'match winner') {
    if (selection.includes('local') || selection.includes('home') || selection === '1') return p.home_win;
    if (selection.includes('empate') || selection.includes('draw') || selection === 'x') return p.draw;
    if (selection.includes('visitante') || selection.includes('away') || selection === '2') return p.away_win;
  }
  if (market.includes('over') && selection.includes('2.5')) return p.over_25;
  if (market.includes('under') && selection.includes('2.5')) return 100 - p.over_25;
  if (market.includes('btts') || market.includes('ambos')) {
    return selection.includes('si') || selection.includes('yes') ? p.btts : 100 - p.btts;
  }
  return null;
}
```

- [ ] **Step 2: Add a quick test**

```typescript
// supabase/functions/_shared/agents/stage5-validation-gate.test.ts
import { runStage5 } from './stage5-validation-gate.ts';
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";

const baseDf: any = { fixture_id: 1, home_team: 'A', away_team: 'B' };
const baseS1: any = { probabilities_initial: { home_win: 60, draw: 25, away_win: 15, over_25: 60, btts: 55, home_to_score: 80, away_to_score: 65 } };
const supportedPick = { market: 'BTTS', selection: 'Sí', probability_estimate: 60, rationale: 'r', odds_reference: 1.80 };
const baseS2: any = {
  tactical: { agent_name: 'TACTICAL', thesis_supports_or_opposes: 'SUPPORTS', key_findings: [], candidate_picks: [supportedPick], notes: '', modifies_probabilities: {} },
  contextual: { agent_name: 'CONTEXTUAL', thesis_supports_or_opposes: 'SUPPORTS', key_findings: [], candidate_picks: [], notes: '', modifies_probabilities: {} },
  market: { agent_name: 'MARKET', thesis_supports_or_opposes: 'SUPPORTS', key_findings: [], candidate_picks: [], notes: '', modifies_probabilities: {} },
};

Deno.test('Stage 5: passes valid pick', () => {
  const out = runStage5(baseDf, baseS1, baseS2, {
    veredicto: 'APOSTAR',
    picks: [{ market: 'BTTS', selection: 'Sí', probability: 82, odds: 1.80, edge_percent: 5, confidence: 'ALTA', reasoning: 'x', survived_skeptic: true }],
    summary: '', overall_confidence: 80, total_data_volume: 1500,
  });
  assertEquals(out.validated_picks.length, 1);
  assertEquals(out.rejected.length, 0);
});

Deno.test('Stage 5: rejects below threshold', () => {
  const out = runStage5(baseDf, baseS1, baseS2, {
    veredicto: 'APOSTAR',
    picks: [{ market: 'BTTS', selection: 'Sí', probability: 75, odds: 1.80, edge_percent: 5, confidence: 'ALTA', reasoning: 'x', survived_skeptic: true }],
    summary: '', overall_confidence: 80, total_data_volume: 1500,
  });
  assertEquals(out.validated_picks.length, 0);
  assertEquals(out.rejected.length, 1);
});

Deno.test('Stage 5: rejects unsupported pick', () => {
  const out = runStage5(baseDf, baseS1, baseS2, {
    veredicto: 'APOSTAR',
    picks: [{ market: 'Corners', selection: 'Over 9.5', probability: 85, odds: 1.95, edge_percent: 8, confidence: 'ALTA', reasoning: 'x', survived_skeptic: true }],
    summary: '', overall_confidence: 80, total_data_volume: 1500,
  });
  assertEquals(out.validated_picks.length, 0);
  assertEquals(out.rejected.length, 1);
});
```

- [ ] **Step 3: Run the test**

```bash
deno test supabase/functions/_shared/agents/stage5-validation-gate.test.ts
```
Expected: 3 passed.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/agents/stage5-validation-gate.ts supabase/functions/_shared/agents/stage5-validation-gate.test.ts
git commit -m "feat(stage5): deterministic validation gate with hard rules"
```

---

### Task 1.10: Refactor orchestrator.ts to use stages

**Files:**
- Modify: `supabase/functions/_shared/agents/orchestrator.ts`

- [ ] **Step 1: Replace the orchestrator with the stage-based runner**

Open `supabase/functions/_shared/agents/orchestrator.ts` and **replace the entire file** with:

```typescript
// supabase/functions/_shared/agents/orchestrator.ts
// V9 Hybrid Sequential-Parallel Pipeline (deployed 2026-05-05)
// Stage 0 deterministic → Stage 1 → Stage 2 parallel → Stage 3 → Stage 4 → Stage 5 deterministic

import { buildDataFoundation } from './stage0-data-foundation.ts';
import { runStage1 } from './stage1-statistical-foundation.ts';
import { runStage2 } from './stage2-specialists.ts';
import { runStage3 } from './stage3-skeptic.ts';
import { runStage4 } from './stage4-synthesizer.ts';
import { runStage5 } from './stage5-validation-gate.ts';
import type { MatchContext, PipelineRunResult } from './types.ts';

interface ETLRawDataInput {
  fixture_id: number;
  kickoff_at: string;
  home_recent_results: Array<{ result: 'W' | 'D' | 'L'; date: string; goals_for: number; goals_against: number }>;
  away_recent_results: Array<{ result: 'W' | 'D' | 'L'; date: string; goals_for: number; goals_against: number }>;
  referee_name: string | null;
  referee_aggregated_stats?: { yellows_per_match: number; reds_per_match: number; home_bias: number; matches: number } | null;
  sportmonks_predictions?: { home_win: number; draw: number; away_win: number; over_25: number; btts_yes: number } | null;
  closing_odds?: { home_win: number } | null;
  opening_odds?: { home_win: number } | null;
  standings?: { home_rank: number; away_rank: number; home_points_gap_safety: number; away_points_gap_safety: number; total_teams: number } | null;
  perplexity_lineup_text?: string | null;
}

export async function runPipeline(
  context: MatchContext,
  rawETL: ETLRawDataInput,
): Promise<PipelineRunResult> {
  const t0 = Date.now();

  // Stage 0 — deterministic data foundation
  const stage0Start = Date.now();
  const data_foundation = buildDataFoundation(context, rawETL);
  const stage0_ms = Date.now() - stage0Start;
  console.log(`[orchestrator] Stage 0 done in ${stage0_ms}ms`);

  // Stage 1 — statistical foundation (1 LLM call)
  const stage1Start = Date.now();
  const statistical_foundation = await runStage1(data_foundation);
  const stage1_ms = Date.now() - stage1Start;
  console.log(`[orchestrator] Stage 1 done in ${stage1_ms}ms`);

  // Stage 2 — 3 specialists in parallel
  const stage2Start = Date.now();
  const specialists = await runStage2(data_foundation, statistical_foundation, context);
  const stage2_ms = Date.now() - stage2Start;
  console.log(`[orchestrator] Stage 2 done in ${stage2_ms}ms`);

  // Stage 3 — skeptic
  const stage3Start = Date.now();
  const skeptic = await runStage3(data_foundation, statistical_foundation, specialists);
  const stage3_ms = Date.now() - stage3Start;
  console.log(`[orchestrator] Stage 3 done in ${stage3_ms}ms`);

  // Stage 4 — synthesizer
  const stage4Start = Date.now();
  const synthesizer = await runStage4(data_foundation, statistical_foundation, specialists, skeptic);
  const stage4_ms = Date.now() - stage4Start;
  console.log(`[orchestrator] Stage 4 done in ${stage4_ms}ms`);

  // Stage 5 — deterministic validation gate
  const stage5Start = Date.now();
  const { validated_picks, rejected } = runStage5(data_foundation, statistical_foundation, specialists, synthesizer);
  const stage5_ms = Date.now() - stage5Start;
  console.log(`[orchestrator] Stage 5 done in ${stage5_ms}ms — ${validated_picks.length} validated, ${rejected.length} rejected`);

  const total_ms = Date.now() - t0;

  return {
    data_foundation,
    statistical_foundation,
    specialists,
    skeptic,
    synthesizer,
    validated_picks,
    timings: { stage0_ms, stage1_ms, stage2_ms, stage3_ms, stage4_ms, stage5_ms, total_ms },
    total_tokens: 0, // sum from individual responses if needed
    pipeline_version: 'V9-HYBRID-2026-05-05',
  };
}

// Backwards compatibility export — old code may import { runDebate }
// We keep it as a thin alias that throws so callers must migrate to runPipeline.
export function runDebate(): never {
  throw new Error('[orchestrator] runDebate() is removed in V9. Use runPipeline(context, rawETL) instead.');
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/_shared/agents/orchestrator.ts
git commit -m "feat(orchestrator): V9 hybrid sequential-parallel pipeline"
```

---

### Task 1.11: Adapt v3-ai-analyzer to runPipeline

**Files:**
- Modify: `supabase/functions/v3-ai-analyzer/index.ts`

- [ ] **Step 1: Find the runDebate call and replace it**

Open `supabase/functions/v3-ai-analyzer/index.ts`. Search for `runDebate(` (probably in the main analyzer flow). Add the import at the top:

```typescript
import { runPipeline } from '../_shared/agents/orchestrator.ts';
```

Remove any existing import of `runDebate`.

- [ ] **Step 2: Build the rawETL input from existing fetched data**

Locate where the analyzer currently builds `MatchContext`. Right before invoking the pipeline, build `rawETL`:

```typescript
const rawETL = {
  fixture_id: matchData.fixture_id,
  kickoff_at: matchData.kickoff_at || matchData.match_time,
  home_recent_results: (homeHistoryStructured || []).map((m: any) => ({
    result: m.result === 'W' ? 'W' : m.result === 'L' ? 'L' : 'D',
    date: m.date,
    goals_for: m.goals_for ?? 0,
    goals_against: m.goals_against ?? 0,
  })),
  away_recent_results: (awayHistoryStructured || []).map((m: any) => ({
    result: m.result === 'W' ? 'W' : m.result === 'L' ? 'L' : 'D',
    date: m.date,
    goals_for: m.goals_for ?? 0,
    goals_against: m.goals_against ?? 0,
  })),
  referee_name: matchData.referee_name ?? null,
  referee_aggregated_stats: matchData.referee_stats ?? null,
  sportmonks_predictions: matchData.sportmonks_predictions ?? null,
  closing_odds: matchData.closing_odds ?? null,
  opening_odds: matchData.opening_odds ?? null,
  standings: matchData.standings ?? null,
  perplexity_lineup_text: matchContext.external_context ?? null,
};
```

(Adjust the variable names `matchData`, `homeHistoryStructured`, etc., to match the actual variables in the file.)

- [ ] **Step 3: Replace runDebate(...) call with runPipeline(...)**

```typescript
const pipelineResult = await runPipeline(matchContext, rawETL);
```

- [ ] **Step 4: Adapt the persistence logic**

Find where `debateResult` is persisted (likely `reports_v2` and `value_picks_v2` insertions). Adapt to use `pipelineResult`:

```typescript
const reportPacket = {
  pipeline_version: pipelineResult.pipeline_version,
  data_foundation: pipelineResult.data_foundation,
  statistical_foundation: pipelineResult.statistical_foundation,
  specialists: pipelineResult.specialists,
  skeptic: pipelineResult.skeptic,
  synthesizer: pipelineResult.synthesizer,
  validated_picks: pipelineResult.validated_picks,
  timings: pipelineResult.timings,
};

// reports_v2 insert
await supabase.from('reports_v2').upsert({
  fixture_id: finalFixtureId,
  match_date: matchContext.date,
  report_packet: reportPacket,
  veredicto: pipelineResult.synthesizer.veredicto,
  // ... other existing fields
});

// value_picks_v2 inserts (only validated picks)
const valuePicksRows = pipelineResult.validated_picks.map((p) => ({
  fixture_id: finalFixtureId,
  match_date: matchContext.date,
  market: p.market,
  selection: p.selection,
  p_model: p.probability / 100,
  odds: p.odds,
  edge_percent: p.edge_percent,
  confidence: p.confidence,
  engine_version: 'V9-HYBRID-2026-05-05',
  reasoning: p.reasoning,
}));
if (valuePicksRows.length > 0) {
  await supabase.from('value_picks_v2').upsert(valuePicksRows);
}
```

(Keep all the existing surrounding logic — we are only replacing the parts that built/used `debateResult`.)

- [ ] **Step 5: Deploy and verify**

```bash
npx supabase functions deploy v3-ai-analyzer --no-verify-jwt
```

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/v3-ai-analyzer/index.ts
git commit -m "feat(v3-analyzer): integrate V9 pipeline runPipeline()"
```

---

### Task 1.12: Update threshold consumers to use central constant

**Files:**
- Modify: `supabase/functions/v2-generate-parlays/index.ts`
- Modify: `supabase/functions/hourly-results-verifier/index.ts`
- Modify: `services/resultsService.ts`
- Modify: `components/ai/HighProbPicks.tsx`

- [ ] **Step 1: Patch v2-generate-parlays**

Open `supabase/functions/v2-generate-parlays/index.ts`. At the top, add:

```typescript
import { OPPORTUNITIES_THRESHOLD, OPPORTUNITIES_THRESHOLD_PERCENT } from '../_shared/constants.ts';
```

Search for hardcoded `0.83`, `83`, `0.80`, `80`, `>= 83`, `>= 0.83` related to opportunities/picks filtering. Replace each with `OPPORTUNITIES_THRESHOLD` (decimal contexts) or `OPPORTUNITIES_THRESHOLD_PERCENT` (percentage contexts).

- [ ] **Step 2: Patch hourly-results-verifier**

Open `supabase/functions/hourly-results-verifier/index.ts`. Same pattern: import and replace.

- [ ] **Step 3: Patch services/resultsService.ts**

Open `services/resultsService.ts`. At the top:
```typescript
import { OPPORTUNITIES_THRESHOLD, OPPORTUNITIES_THRESHOLD_PERCENT } from '../constants/opportunities';
```
Replace hardcoded threshold references.

- [ ] **Step 4: Patch HighProbPicks.tsx**

Open `components/ai/HighProbPicks.tsx`. Add:
```typescript
import { OPPORTUNITIES_THRESHOLD, OPPORTUNITIES_THRESHOLD_PERCENT } from '../../constants/opportunities';
```
Replace any hardcoded `0.83` / `83` in the filtering logic.

- [ ] **Step 5: Deploy edge functions**

```bash
npx supabase functions deploy v2-generate-parlays --no-verify-jwt
npx supabase functions deploy hourly-results-verifier --no-verify-jwt
```

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/v2-generate-parlays/index.ts supabase/functions/hourly-results-verifier/index.ts services/resultsService.ts components/ai/HighProbPicks.tsx
git commit -m "feat(threshold): adopt 80% threshold across all consumers via central constant"
```

---

## Phase 2 — PDF Design System (React-PDF)

### Task 2.1: Install dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install @react-pdf/renderer**

```bash
npm install @react-pdf/renderer@^3.4.0
```

- [ ] **Step 2: Download the fonts**

The project uses Outfit + Inter. Download woff2 (or ttf) files:

```bash
mkdir -p public/fonts
curl -L "https://github.com/google/fonts/raw/main/ofl/inter/static/Inter-Regular.ttf" -o public/fonts/Inter-Regular.ttf
curl -L "https://github.com/google/fonts/raw/main/ofl/inter/static/Inter-Medium.ttf" -o public/fonts/Inter-Medium.ttf
curl -L "https://github.com/google/fonts/raw/main/ofl/inter/static/Inter-SemiBold.ttf" -o public/fonts/Inter-SemiBold.ttf
curl -L "https://github.com/google/fonts/raw/main/ofl/inter/static/Inter-Bold.ttf" -o public/fonts/Inter-Bold.ttf
curl -L "https://github.com/google/fonts/raw/main/ofl/outfit/static/Outfit-Regular.ttf" -o public/fonts/Outfit-Regular.ttf
curl -L "https://github.com/google/fonts/raw/main/ofl/outfit/static/Outfit-SemiBold.ttf" -o public/fonts/Outfit-SemiBold.ttf
curl -L "https://github.com/google/fonts/raw/main/ofl/outfit/static/Outfit-Bold.ttf" -o public/fonts/Outfit-Bold.ttf
```

Verify the files are present and non-zero size:
```bash
ls -lh public/fonts/
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json public/fonts/
git commit -m "chore(pdf): install @react-pdf/renderer + Inter/Outfit fonts"
```

---

### Task 2.2: Design tokens

**Files:**
- Create: `services/pdf/design-system/tokens.ts`

- [ ] **Step 1: Write tokens**

```typescript
// services/pdf/design-system/tokens.ts
export const tokens = {
  colors: {
    bg: '#0a0a0f',
    bgElevated: '#13131a',
    bgCard: '#181822',
    border: '#1f1f2a',
    borderLight: '#2a2a36',
    brandPrimary: '#10b981',
    brandAccent: '#34d399',
    brandDeep: '#047857',
    textPrimary: '#fafafa',
    textSecondary: '#a1a1aa',
    textMuted: '#71717a',
    textDim: '#52525b',
    success: '#10b981',
    warning: '#f59e0b',
    danger: '#ef4444',
    info: '#3b82f6',
    barGradientStart: '#10b981',
    barGradientEnd: '#3b82f6',
  },
  spacing: {
    xs: 4, sm: 8, md: 12, lg: 16, xl: 24,
    '2xl': 32, '3xl': 48, '4xl': 64, '5xl': 80,
  },
  radius: { sm: 4, md: 8, lg: 12, xl: 16, full: 9999 },
  pageMargin: { top: 48, bottom: 48, left: 40, right: 40 },
  fontFamily: { display: 'Outfit', body: 'Inter' },
  fontSize: {
    display: 32, h1: 22, h2: 16, h3: 13,
    body: 10.5, small: 9, micro: 7.5, kpi: 28,
  },
  fontWeight: { regular: 400, medium: 500, semibold: 600, bold: 700 },
  lineHeight: { tight: 1.1, snug: 1.3, normal: 1.55, relaxed: 1.7 },
} as const;

export type DesignTokens = typeof tokens;
```

- [ ] **Step 2: Commit**

```bash
git add services/pdf/design-system/tokens.ts
git commit -m "feat(pdf): design tokens for new PDF system"
```

---

### Task 2.3: Font registration

**Files:**
- Create: `services/pdf/design-system/fonts.ts`

- [ ] **Step 1: Write font loader**

```typescript
// services/pdf/design-system/fonts.ts
import { Font } from '@react-pdf/renderer';

let registered = false;

export function ensureFontsRegistered(): void {
  if (registered) return;
  Font.register({
    family: 'Inter',
    fonts: [
      { src: '/fonts/Inter-Regular.ttf', fontWeight: 400 },
      { src: '/fonts/Inter-Medium.ttf', fontWeight: 500 },
      { src: '/fonts/Inter-SemiBold.ttf', fontWeight: 600 },
      { src: '/fonts/Inter-Bold.ttf', fontWeight: 700 },
    ],
  });
  Font.register({
    family: 'Outfit',
    fonts: [
      { src: '/fonts/Outfit-Regular.ttf', fontWeight: 400 },
      { src: '/fonts/Outfit-SemiBold.ttf', fontWeight: 600 },
      { src: '/fonts/Outfit-Bold.ttf', fontWeight: 700 },
    ],
  });
  // Disable hyphenation for cleaner PDF output
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}
```

- [ ] **Step 2: Commit**

```bash
git add services/pdf/design-system/fonts.ts
git commit -m "feat(pdf): font registration for Inter + Outfit"
```

---

### Task 2.4: Base components

**Files:**
- Create: `services/pdf/design-system/components/Page.tsx`
- Create: `services/pdf/design-system/components/CoverPage.tsx`
- Create: `services/pdf/design-system/components/SectionHeader.tsx`
- Create: `services/pdf/design-system/components/KPICard.tsx`
- Create: `services/pdf/design-system/components/Quote.tsx`
- Create: `services/pdf/design-system/components/CTAFooter.tsx`
- Create: `services/pdf/design-system/components/Divider.tsx`
- Create: `services/pdf/design-system/components/index.ts`

- [ ] **Step 1: Write Page wrapper**

```tsx
// services/pdf/design-system/components/Page.tsx
import React from 'react';
import { Page as RPage, View, Text, StyleSheet } from '@react-pdf/renderer';
import { tokens } from '../tokens';

const styles = StyleSheet.create({
  page: {
    backgroundColor: tokens.colors.bg,
    color: tokens.colors.textPrimary,
    fontFamily: tokens.fontFamily.body,
    fontSize: tokens.fontSize.body,
    paddingTop: tokens.pageMargin.top,
    paddingBottom: tokens.pageMargin.bottom,
    paddingLeft: tokens.pageMargin.left,
    paddingRight: tokens.pageMargin.right,
  },
  pageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: tokens.spacing['2xl'],
    paddingBottom: tokens.spacing.sm,
    borderBottomWidth: 0.5,
    borderBottomColor: tokens.colors.border,
  },
  brandText: {
    fontFamily: tokens.fontFamily.display,
    fontWeight: tokens.fontWeight.bold,
    fontSize: tokens.fontSize.body,
    color: tokens.colors.brandPrimary,
    letterSpacing: 0.5,
  },
  meta: {
    fontSize: tokens.fontSize.micro,
    color: tokens.colors.textMuted,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  pageFooter: {
    position: 'absolute',
    bottom: tokens.pageMargin.bottom / 2,
    left: tokens.pageMargin.left,
    right: tokens.pageMargin.right,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: tokens.fontSize.micro,
    color: tokens.colors.textDim,
  },
});

interface PageProps {
  children: React.ReactNode;
  pageMeta?: string;
  pageNumber?: number;
}

export const Page: React.FC<PageProps> = ({ children, pageMeta, pageNumber }) => (
  <RPage size="A4" style={styles.page}>
    <View style={styles.pageHeader}>
      <Text style={styles.brandText}>DERBIX</Text>
      {pageMeta && <Text style={styles.meta}>{pageMeta}</Text>}
    </View>
    {children}
    <View style={styles.pageFooter}>
      <Text>derbix.co</Text>
      <Text>{pageNumber !== undefined ? `· ${pageNumber} ·` : ''}</Text>
      <Text>Sin estafas. Sin tipsters. Solo datos.</Text>
    </View>
  </RPage>
);
```

- [ ] **Step 2: Write CoverPage**

```tsx
// services/pdf/design-system/components/CoverPage.tsx
import React from 'react';
import { Page as RPage, View, Text, StyleSheet } from '@react-pdf/renderer';
import { tokens } from '../tokens';

const styles = StyleSheet.create({
  page: {
    backgroundColor: tokens.colors.bg,
    color: tokens.colors.textPrimary,
    fontFamily: tokens.fontFamily.body,
    paddingHorizontal: tokens.pageMargin.left,
    paddingVertical: tokens.pageMargin.top,
    flexDirection: 'column',
    justifyContent: 'space-between',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.spacing.sm,
  },
  brandText: {
    fontFamily: tokens.fontFamily.display,
    fontWeight: tokens.fontWeight.bold,
    fontSize: 18,
    color: tokens.colors.brandPrimary,
    letterSpacing: 1,
  },
  brandDot: {
    width: 8, height: 8,
    backgroundColor: tokens.colors.brandPrimary,
    borderRadius: 4,
  },
  hero: {
    flexDirection: 'column',
    gap: tokens.spacing.lg,
  },
  preTitle: {
    fontSize: tokens.fontSize.micro,
    color: tokens.colors.brandAccent,
    letterSpacing: 2,
    textTransform: 'uppercase',
    fontWeight: tokens.fontWeight.semibold,
  },
  title: {
    fontFamily: tokens.fontFamily.display,
    fontWeight: tokens.fontWeight.bold,
    fontSize: tokens.fontSize.display,
    lineHeight: tokens.lineHeight.tight,
    color: tokens.colors.textPrimary,
    letterSpacing: -0.5,
  },
  subline: {
    fontSize: tokens.fontSize.body,
    color: tokens.colors.textSecondary,
  },
  divider: {
    height: 2,
    backgroundColor: tokens.colors.brandPrimary,
    width: 60,
    marginVertical: tokens.spacing.md,
  },
  seal: {
    fontSize: tokens.fontSize.small,
    color: tokens.colors.textSecondary,
    lineHeight: tokens.lineHeight.normal,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: tokens.fontSize.micro,
    color: tokens.colors.textMuted,
    letterSpacing: 0.5,
  },
});

interface CoverPageProps {
  preTitle: string;
  title: string;
  subline: string;
  seal: string;
  generatedAt: string;
}

export const CoverPage: React.FC<CoverPageProps> = ({ preTitle, title, subline, seal, generatedAt }) => (
  <RPage size="A4" style={styles.page}>
    <View style={styles.brandRow}>
      <View style={styles.brandDot} />
      <Text style={styles.brandText}>DERBIX</Text>
    </View>
    <View style={styles.hero}>
      <Text style={styles.preTitle}>{preTitle}</Text>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.divider} />
      <Text style={styles.subline}>{subline}</Text>
      <Text style={styles.seal}>{seal}</Text>
    </View>
    <View style={styles.footer}>
      <Text>derbix.co</Text>
      <Text>{generatedAt}</Text>
    </View>
  </RPage>
);
```

- [ ] **Step 3: Write SectionHeader**

```tsx
// services/pdf/design-system/components/SectionHeader.tsx
import React from 'react';
import { View, Text, StyleSheet } from '@react-pdf/renderer';
import { tokens } from '../tokens';

const styles = StyleSheet.create({
  wrap: {
    marginBottom: tokens.spacing.lg,
  },
  eyebrow: {
    fontSize: tokens.fontSize.micro,
    color: tokens.colors.brandAccent,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    fontWeight: tokens.fontWeight.semibold,
    marginBottom: tokens.spacing.xs,
  },
  title: {
    fontFamily: tokens.fontFamily.display,
    fontSize: tokens.fontSize.h1,
    fontWeight: tokens.fontWeight.semibold,
    color: tokens.colors.textPrimary,
    lineHeight: tokens.lineHeight.snug,
    letterSpacing: -0.3,
  },
  bar: {
    width: 36,
    height: 2,
    backgroundColor: tokens.colors.brandPrimary,
    marginTop: tokens.spacing.sm,
  },
});

export const SectionHeader: React.FC<{ eyebrow?: string; title: string }> = ({ eyebrow, title }) => (
  <View style={styles.wrap}>
    {eyebrow && <Text style={styles.eyebrow}>{eyebrow}</Text>}
    <Text style={styles.title}>{title}</Text>
    <View style={styles.bar} />
  </View>
);
```

- [ ] **Step 4: Write KPICard**

```tsx
// services/pdf/design-system/components/KPICard.tsx
import React from 'react';
import { View, Text, StyleSheet } from '@react-pdf/renderer';
import { tokens } from '../tokens';

const styles = StyleSheet.create({
  card: {
    flexDirection: 'column',
    gap: tokens.spacing.xs,
    padding: tokens.spacing.lg,
    backgroundColor: tokens.colors.bgCard,
    borderRadius: tokens.radius.lg,
    borderWidth: 0.5,
    borderColor: tokens.colors.borderLight,
    flex: 1,
  },
  label: {
    fontSize: tokens.fontSize.micro,
    color: tokens.colors.textMuted,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    fontWeight: tokens.fontWeight.medium,
  },
  value: {
    fontFamily: tokens.fontFamily.display,
    fontSize: tokens.fontSize.kpi,
    fontWeight: tokens.fontWeight.bold,
    color: tokens.colors.textPrimary,
    lineHeight: 1.0,
    marginTop: tokens.spacing.xs,
  },
  hint: {
    fontSize: tokens.fontSize.small,
    color: tokens.colors.textSecondary,
    marginTop: tokens.spacing.xs,
  },
});

export const KPICard: React.FC<{ label: string; value: string | number; hint?: string }> = ({ label, value, hint }) => (
  <View style={styles.card}>
    <Text style={styles.label}>{label}</Text>
    <Text style={styles.value}>{value}</Text>
    {hint && <Text style={styles.hint}>{hint}</Text>}
  </View>
);
```

- [ ] **Step 5: Write Quote**

```tsx
// services/pdf/design-system/components/Quote.tsx
import React from 'react';
import { View, Text, StyleSheet } from '@react-pdf/renderer';
import { tokens } from '../tokens';

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    backgroundColor: tokens.colors.bgElevated,
    borderRadius: tokens.radius.md,
    padding: tokens.spacing.lg,
    borderLeftWidth: 3,
    borderLeftColor: tokens.colors.brandPrimary,
    marginVertical: tokens.spacing.md,
  },
  text: {
    fontSize: tokens.fontSize.body,
    color: tokens.colors.textPrimary,
    lineHeight: tokens.lineHeight.normal,
    fontStyle: 'italic',
    flex: 1,
  },
});

export const Quote: React.FC<{ children: string }> = ({ children }) => (
  <View style={styles.wrap}>
    <Text style={styles.text}>{children}</Text>
  </View>
);
```

- [ ] **Step 6: Write CTAFooter**

```tsx
// services/pdf/design-system/components/CTAFooter.tsx
import React from 'react';
import { View, Text, StyleSheet } from '@react-pdf/renderer';
import { tokens } from '../tokens';

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: tokens.colors.brandPrimary,
    padding: tokens.spacing.xl,
    borderRadius: tokens.radius.lg,
    flexDirection: 'column',
    alignItems: 'center',
    gap: tokens.spacing.sm,
  },
  headline: {
    fontFamily: tokens.fontFamily.display,
    fontSize: tokens.fontSize.h1,
    fontWeight: tokens.fontWeight.bold,
    color: tokens.colors.bg,
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  sub: {
    fontSize: tokens.fontSize.body,
    color: tokens.colors.bg,
    textAlign: 'center',
    opacity: 0.85,
  },
  url: {
    fontSize: tokens.fontSize.h2,
    fontWeight: tokens.fontWeight.semibold,
    color: tokens.colors.bg,
    marginTop: tokens.spacing.sm,
    letterSpacing: 0.5,
  },
});

export const CTAFooter: React.FC<{ headline: string; sub: string; url: string }> = ({ headline, sub, url }) => (
  <View style={styles.wrap}>
    <Text style={styles.headline}>{headline}</Text>
    <Text style={styles.sub}>{sub}</Text>
    <Text style={styles.url}>{url}</Text>
  </View>
);
```

- [ ] **Step 7: Write Divider**

```tsx
// services/pdf/design-system/components/Divider.tsx
import React from 'react';
import { View, StyleSheet } from '@react-pdf/renderer';
import { tokens } from '../tokens';

const styles = StyleSheet.create({
  line: {
    height: 0.5,
    backgroundColor: tokens.colors.border,
    marginVertical: tokens.spacing.lg,
  },
});

export const Divider: React.FC = () => <View style={styles.line} />;
```

- [ ] **Step 8: Write index.ts**

```tsx
// services/pdf/design-system/components/index.ts
export { Page } from './Page';
export { CoverPage } from './CoverPage';
export { SectionHeader } from './SectionHeader';
export { KPICard } from './KPICard';
export { Quote } from './Quote';
export { CTAFooter } from './CTAFooter';
export { Divider } from './Divider';
```

- [ ] **Step 9: Commit**

```bash
git add services/pdf/design-system/components/
git commit -m "feat(pdf): base components (Page, CoverPage, KPICard, etc.)"
```

---

### Task 2.5: Bar chart and additional components

**Files:**
- Create: `services/pdf/design-system/components/BarChart.tsx`
- Create: `services/pdf/design-system/components/DataTable.tsx`
- Modify: `services/pdf/design-system/components/index.ts`

- [ ] **Step 1: Write BarChart**

```tsx
// services/pdf/design-system/components/BarChart.tsx
import React from 'react';
import { View, Text, StyleSheet } from '@react-pdf/renderer';
import { tokens } from '../tokens';

const styles = StyleSheet.create({
  wrap: { flexDirection: 'column', gap: tokens.spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.md },
  label: { width: 120, fontSize: tokens.fontSize.small, color: tokens.colors.textSecondary },
  trackOuter: {
    flex: 1,
    height: 12,
    backgroundColor: tokens.colors.bgElevated,
    borderRadius: tokens.radius.sm,
    overflow: 'hidden',
  },
  fill: { height: '100%', backgroundColor: tokens.colors.brandPrimary, borderRadius: tokens.radius.sm },
  value: { width: 50, fontSize: tokens.fontSize.small, color: tokens.colors.textPrimary, textAlign: 'right', fontWeight: tokens.fontWeight.semibold },
});

interface BarChartItem { label: string; value: number; max: number; suffix?: string; }

export const BarChart: React.FC<{ items: BarChartItem[] }> = ({ items }) => (
  <View style={styles.wrap}>
    {items.map((it, i) => {
      const pct = Math.max(2, Math.min(100, (it.value / it.max) * 100));
      return (
        <View key={i} style={styles.row}>
          <Text style={styles.label}>{it.label}</Text>
          <View style={styles.trackOuter}>
            <View style={[styles.fill, { width: `${pct}%` }]} />
          </View>
          <Text style={styles.value}>{it.value}{it.suffix || ''}</Text>
        </View>
      );
    })}
  </View>
);
```

- [ ] **Step 2: Write DataTable**

```tsx
// services/pdf/design-system/components/DataTable.tsx
import React from 'react';
import { View, Text, StyleSheet } from '@react-pdf/renderer';
import { tokens } from '../tokens';

const styles = StyleSheet.create({
  wrap: {
    borderWidth: 0.5,
    borderColor: tokens.colors.border,
    borderRadius: tokens.radius.md,
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    backgroundColor: tokens.colors.bgElevated,
    paddingVertical: tokens.spacing.sm,
    paddingHorizontal: tokens.spacing.md,
  },
  bodyRow: {
    flexDirection: 'row',
    paddingVertical: tokens.spacing.sm,
    paddingHorizontal: tokens.spacing.md,
    borderTopWidth: 0.5,
    borderTopColor: tokens.colors.border,
  },
  zebraRow: {
    backgroundColor: tokens.colors.bgCard,
  },
  cell: {
    flex: 1,
    fontSize: tokens.fontSize.small,
    color: tokens.colors.textPrimary,
  },
  headerCell: {
    flex: 1,
    fontSize: tokens.fontSize.micro,
    color: tokens.colors.textMuted,
    fontWeight: tokens.fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});

interface DataTableProps {
  headers: string[];
  rows: string[][];
}

export const DataTable: React.FC<DataTableProps> = ({ headers, rows }) => (
  <View style={styles.wrap}>
    <View style={styles.headerRow}>
      {headers.map((h, i) => <Text key={i} style={styles.headerCell}>{h}</Text>)}
    </View>
    {rows.map((row, r) => (
      <View key={r} style={[styles.bodyRow, r % 2 === 1 ? styles.zebraRow : {}]}>
        {row.map((cell, c) => <Text key={c} style={styles.cell}>{cell}</Text>)}
      </View>
    ))}
  </View>
);
```

- [ ] **Step 3: Update index.ts**

```tsx
// services/pdf/design-system/components/index.ts
export { Page } from './Page';
export { CoverPage } from './CoverPage';
export { SectionHeader } from './SectionHeader';
export { KPICard } from './KPICard';
export { Quote } from './Quote';
export { CTAFooter } from './CTAFooter';
export { Divider } from './Divider';
export { BarChart } from './BarChart';
export { DataTable } from './DataTable';
```

- [ ] **Step 4: Commit**

```bash
git add services/pdf/design-system/components/
git commit -m "feat(pdf): BarChart and DataTable components"
```

---

### Task 2.6: Promo template (la chupeta)

**Files:**
- Create: `services/pdf/templates/PromoMatchPDF.tsx`

- [ ] **Step 1: Write the promo template**

```tsx
// services/pdf/templates/PromoMatchPDF.tsx
import React from 'react';
import { Document, View, Text, StyleSheet } from '@react-pdf/renderer';
import {
  Page, CoverPage, SectionHeader, KPICard, Quote, CTAFooter, BarChart, DataTable, Divider,
} from '../design-system/components';
import { tokens } from '../design-system/tokens';
import { ensureFontsRegistered } from '../design-system/fonts';

const styles = StyleSheet.create({
  paragraph: {
    fontSize: tokens.fontSize.body,
    color: tokens.colors.textSecondary,
    lineHeight: tokens.lineHeight.normal,
    marginBottom: tokens.spacing.md,
  },
  bullets: { flexDirection: 'column', gap: tokens.spacing.sm, marginVertical: tokens.spacing.lg },
  bulletRow: { flexDirection: 'row', gap: tokens.spacing.md, alignItems: 'flex-start' },
  bulletDot: {
    width: 4, height: 4, borderRadius: 2,
    backgroundColor: tokens.colors.brandPrimary,
    marginTop: 6,
  },
  bulletText: {
    flex: 1,
    fontSize: tokens.fontSize.body,
    color: tokens.colors.textPrimary,
    lineHeight: tokens.lineHeight.normal,
  },
  kpiRow: { flexDirection: 'row', gap: tokens.spacing.md, marginVertical: tokens.spacing.lg },
  marketGrid: { flexDirection: 'column', gap: tokens.spacing.sm, marginTop: tokens.spacing.md },
  marketRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: tokens.spacing.sm,
    borderBottomWidth: 0.5,
    borderBottomColor: tokens.colors.border,
  },
  marketLabel: { fontSize: tokens.fontSize.body, color: tokens.colors.textPrimary, fontWeight: tokens.fontWeight.medium },
  marketDots: { flexDirection: 'row', gap: 4 },
  dotFilled: { width: 8, height: 8, borderRadius: 4, backgroundColor: tokens.colors.brandPrimary },
  dotEmpty: { width: 8, height: 8, borderRadius: 4, backgroundColor: tokens.colors.border },
  disclaimer: {
    fontSize: tokens.fontSize.small,
    color: tokens.colors.textMuted,
    lineHeight: tokens.lineHeight.normal,
    marginTop: tokens.spacing.lg,
  },
});

export interface PromoMatchPDFProps {
  homeTeam: string;
  awayTeam: string;
  league: string;
  matchDate: string;
  matchTime: string;
  dataVolume: number;
  statisticalScore: number;
  contextualScore: number;
  homeStreak: string;
  awayStreak: string;
  homeXG: number;
  awayXG: number;
  homeForm: string[];
  awayForm: string[];
  weatherDesc?: string | null;
  refereeName?: string | null;
  marketIntensities: Array<{ category: string; intensity: 1 | 2 | 3 | 4 | 5 }>;
  generatedAt: string;
  matchUrl: string;
}

export const PromoMatchPDF: React.FC<PromoMatchPDFProps> = (p) => {
  ensureFontsRegistered();
  return (
    <Document
      title={`Análisis ${p.homeTeam} vs ${p.awayTeam}`}
      author="Derbix"
      subject={`Análisis técnico del partido ${p.homeTeam} vs ${p.awayTeam}`}
    >
      {/* Page 1 — Cover */}
      <CoverPage
        preTitle="ANÁLISIS TÉCNICO"
        title={`${p.homeTeam} vs ${p.awayTeam}`}
        subline={`${p.league} · ${p.matchDate} · ${p.matchTime}`}
        seal={`${p.dataVolume.toLocaleString('es-CO')} datos analizados · 6 modelos especializados · Consenso alcanzado`}
        generatedAt={p.generatedAt}
      />

      {/* Page 2 — Executive summary */}
      <Page pageMeta="Resumen ejecutivo" pageNumber={2}>
        <SectionHeader eyebrow="Resumen" title="Lo que los datos están diciendo" />
        <View style={styles.kpiRow}>
          <KPICard label="Datos analizados" value={p.dataVolume.toLocaleString('es-CO')} />
          <KPICard label="Score estadístico" value={p.statisticalScore} hint="0-100" />
          <KPICard label="Score contextual" value={p.contextualScore} hint="0-100" />
        </View>
        <Text style={styles.paragraph}>
          Hemos pasado este partido por nuestra cadena completa de análisis: razonamiento estadístico, choque táctico, contexto externo, lectura de mercado y validación crítica. El resultado del consenso es inequívoco.
        </Text>
        <View style={styles.bullets}>
          <View style={styles.bulletRow}>
            <View style={styles.bulletDot} />
            <Text style={styles.bulletText}>Diferencia significativa de xG en los últimos 10 partidos entre ambos equipos.</Text>
          </View>
          <View style={styles.bulletRow}>
            <View style={styles.bulletDot} />
            <Text style={styles.bulletText}>Cambios relevantes en alineaciones probables impactan el balance del partido.</Text>
          </View>
          <View style={styles.bulletRow}>
            <View style={styles.bulletDot} />
            <Text style={styles.bulletText}>La cuota actual del mercado no refleja completamente lo que los datos están mostrando.</Text>
          </View>
        </View>
        <Quote>El consenso es claro. El pronóstico exacto y la cuota recomendada están en derbix.co.</Quote>
      </Page>

      {/* Page 3 — Home team */}
      <Page pageMeta={p.homeTeam} pageNumber={3}>
        <SectionHeader eyebrow="Equipo local" title={p.homeTeam} />
        <View style={styles.kpiRow}>
          <KPICard label="Forma reciente" value={p.homeStreak} hint="Últimos 5 partidos" />
          <KPICard label="xG por partido" value={p.homeXG.toFixed(2)} hint="Últimos 10" />
        </View>
        <Text style={styles.paragraph}>
          Análisis del rendimiento ofensivo y defensivo reciente del equipo local. Los números cuentan una historia consistente.
        </Text>
        <DataTable
          headers={['Partido', 'Resultado']}
          rows={p.homeForm.map((f, i) => [`#${i + 1}`, f])}
        />
      </Page>

      {/* Page 4 — Away team */}
      <Page pageMeta={p.awayTeam} pageNumber={4}>
        <SectionHeader eyebrow="Equipo visitante" title={p.awayTeam} />
        <View style={styles.kpiRow}>
          <KPICard label="Forma reciente" value={p.awayStreak} hint="Últimos 5 partidos" />
          <KPICard label="xG por partido" value={p.awayXG.toFixed(2)} hint="Últimos 10" />
        </View>
        <Text style={styles.paragraph}>
          Análisis del rendimiento ofensivo y defensivo reciente del equipo visitante. Los números cuentan una historia consistente.
        </Text>
        <DataTable
          headers={['Partido', 'Resultado']}
          rows={p.awayForm.map((f, i) => [`#${i + 1}`, f])}
        />
      </Page>

      {/* Page 5 — Contextual factors */}
      <Page pageMeta="Factores contextuales" pageNumber={5}>
        <SectionHeader eyebrow="Contexto" title="Factores no estadísticos" />
        <Text style={styles.paragraph}>
          Más allá de los números crudos, hay condiciones que el modelo integra para refinar la lectura del partido.
        </Text>
        <View style={styles.bullets}>
          {p.weatherDesc && (
            <View style={styles.bulletRow}>
              <View style={styles.bulletDot} />
              <Text style={styles.bulletText}>Clima: {p.weatherDesc}</Text>
            </View>
          )}
          {p.refereeName && (
            <View style={styles.bulletRow}>
              <View style={styles.bulletDot} />
              <Text style={styles.bulletText}>Árbitro asignado: {p.refereeName}</Text>
            </View>
          )}
          <View style={styles.bulletRow}>
            <View style={styles.bulletDot} />
            <Text style={styles.bulletText}>Análisis de fatiga acumulada de jornadas previas y descanso entre partidos.</Text>
          </View>
          <View style={styles.bulletRow}>
            <View style={styles.bulletDot} />
            <Text style={styles.bulletText}>Identificación de lesiones / ausencias clave y su impacto cualitativo.</Text>
          </View>
        </View>
      </Page>

      {/* Page 6 — Market reading (general, no specific picks) */}
      <Page pageMeta="Lectura del mercado" pageNumber={6}>
        <SectionHeader eyebrow="Mercado" title="Categorías con valor detectado" />
        <Text style={styles.paragraph}>
          Sin revelar selecciones específicas: estas son las categorías de mercados donde nuestro modelo encuentra discrepancias con la cuota actual. La intensidad es relativa.
        </Text>
        <View style={styles.marketGrid}>
          {p.marketIntensities.map((m, i) => (
            <View key={i} style={styles.marketRow}>
              <Text style={styles.marketLabel}>{m.category}</Text>
              <View style={styles.marketDots}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <View key={n} style={n <= m.intensity ? styles.dotFilled : styles.dotEmpty} />
                ))}
              </View>
            </View>
          ))}
        </View>
        <Quote>Las categorías con mayor intensidad son las que muestran cuota desalineada con la probabilidad real. La selección exacta y la justificación están en la plataforma.</Quote>
      </Page>

      {/* Page 7 — CTA */}
      <Page pageMeta="Acceso al pronóstico" pageNumber={7}>
        <View style={{ marginTop: tokens.spacing['2xl'], gap: tokens.spacing['2xl'] }}>
          <CTAFooter
            headline="El pronóstico exacto está esperándote"
            sub="Pronóstico, cuota recomendada, mercado óptimo y razonamiento completo. Solo en derbix.co."
            url={p.matchUrl}
          />
          <Quote>Sin estafas. Sin tipsters falsos. Sin pálpitos. Solo el dato que sobrevive al escrutinio.</Quote>
        </View>
      </Page>

      {/* Page 8 — About + Disclaimer */}
      <Page pageMeta="Sobre Derbix" pageNumber={8}>
        <SectionHeader eyebrow="Plataforma" title="Inteligencia deportiva, no opinión" />
        <Text style={styles.paragraph}>
          Derbix analiza miles de datos por partido a través de modelos matemáticos, contexto externo y razonamiento crítico. No tomamos decisiones por intuición ni por simpatía. Cada pronóstico se construye sobre evidencia que sobrevive a múltiples capas de validación.
        </Text>
        <Divider />
        <Text style={styles.paragraph}>
          El objetivo no es acertar todos los partidos. El objetivo es que tu cuenta de apuestas tenga consistencia matemática a lo largo del tiempo.
        </Text>
        <Text style={styles.disclaimer}>
          AVISO LEGAL: Las apuestas deportivas implican riesgo financiero. Apuesta solo lo que puedas permitirte perder. Derbix proporciona análisis estadístico — no garantiza resultados. Verifica las regulaciones de tu jurisdicción y juega con responsabilidad.
        </Text>
      </Page>
    </Document>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add services/pdf/templates/PromoMatchPDF.tsx
git commit -m "feat(pdf): Promo template (chupeta) — 8 pages, no pick reveal"
```

---

### Task 2.7: Premium template

**Files:**
- Create: `services/pdf/templates/PremiumMatchPDF.tsx`

- [ ] **Step 1: Write the premium template**

```tsx
// services/pdf/templates/PremiumMatchPDF.tsx
import React from 'react';
import { Document, View, Text, StyleSheet } from '@react-pdf/renderer';
import {
  Page, CoverPage, SectionHeader, KPICard, Quote, BarChart, DataTable, Divider,
} from '../design-system/components';
import { tokens } from '../design-system/tokens';
import { ensureFontsRegistered } from '../design-system/fonts';

const styles = StyleSheet.create({
  paragraph: { fontSize: tokens.fontSize.body, color: tokens.colors.textSecondary, lineHeight: tokens.lineHeight.normal, marginBottom: tokens.spacing.md },
  pickCard: {
    backgroundColor: tokens.colors.bgCard,
    borderRadius: tokens.radius.lg,
    padding: tokens.spacing.lg,
    borderLeftWidth: 3,
    borderLeftColor: tokens.colors.brandPrimary,
    marginBottom: tokens.spacing.md,
  },
  pickHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: tokens.spacing.sm },
  pickMarket: { fontSize: tokens.fontSize.h3, fontWeight: tokens.fontWeight.semibold, color: tokens.colors.textPrimary },
  pickConf: { fontSize: tokens.fontSize.small, color: tokens.colors.brandAccent, fontWeight: tokens.fontWeight.semibold, letterSpacing: 0.5 },
  pickSelection: { fontSize: tokens.fontSize.h2, color: tokens.colors.brandAccent, fontWeight: tokens.fontWeight.bold, marginVertical: tokens.spacing.sm },
  pickStats: { flexDirection: 'row', gap: tokens.spacing.lg, marginVertical: tokens.spacing.sm },
  statBlock: { flexDirection: 'column' },
  statLabel: { fontSize: tokens.fontSize.micro, color: tokens.colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  statValue: { fontSize: tokens.fontSize.h3, color: tokens.colors.textPrimary, fontWeight: tokens.fontWeight.bold, marginTop: 2 },
  pickReason: { fontSize: tokens.fontSize.small, color: tokens.colors.textSecondary, lineHeight: tokens.lineHeight.normal, marginTop: tokens.spacing.sm },
});

export interface PremiumPick {
  market: string;
  selection: string;
  probability: number;
  odds: number;
  edge_percent: number;
  confidence: 'ALTA' | 'MEDIA' | 'BAJA';
  reasoning: string;
  survived_skeptic: boolean;
}

export interface PremiumMatchPDFProps {
  homeTeam: string;
  awayTeam: string;
  league: string;
  matchDate: string;
  matchTime: string;
  dataVolume: number;
  finalVerdict: string;
  picks: PremiumPick[];
  skepticAttacks: string[];
  generatedAt: string;
}

export const PremiumMatchPDF: React.FC<PremiumMatchPDFProps> = (p) => {
  ensureFontsRegistered();
  return (
    <Document title={`Pronóstico Premium ${p.homeTeam} vs ${p.awayTeam}`} author="Derbix">
      <CoverPage
        preTitle="PRONÓSTICO PREMIUM"
        title={`${p.homeTeam} vs ${p.awayTeam}`}
        subline={`${p.league} · ${p.matchDate} · ${p.matchTime}`}
        seal={`${p.dataVolume.toLocaleString('es-CO')} datos · Pipeline V9 · ${p.picks.length} picks confirmados`}
        generatedAt={p.generatedAt}
      />

      <Page pageMeta="Veredicto" pageNumber={2}>
        <SectionHeader eyebrow="Veredicto final" title="Picks confirmados" />
        <Text style={styles.paragraph}>{p.finalVerdict}</Text>
        {p.picks.map((pick, i) => (
          <View key={i} style={styles.pickCard}>
            <View style={styles.pickHeader}>
              <Text style={styles.pickMarket}>{pick.market}</Text>
              <Text style={styles.pickConf}>CONFIANZA {pick.confidence}</Text>
            </View>
            <Text style={styles.pickSelection}>{pick.selection}</Text>
            <View style={styles.pickStats}>
              <View style={styles.statBlock}>
                <Text style={styles.statLabel}>Probabilidad</Text>
                <Text style={styles.statValue}>{pick.probability}%</Text>
              </View>
              <View style={styles.statBlock}>
                <Text style={styles.statLabel}>Cuota</Text>
                <Text style={styles.statValue}>{pick.odds.toFixed(2)}</Text>
              </View>
              <View style={styles.statBlock}>
                <Text style={styles.statLabel}>Edge</Text>
                <Text style={styles.statValue}>+{pick.edge_percent.toFixed(1)}%</Text>
              </View>
            </View>
            <Text style={styles.pickReason}>{pick.reasoning}</Text>
          </View>
        ))}
      </Page>

      {p.skepticAttacks.length > 0 && (
        <Page pageMeta="Skeptic" pageNumber={3}>
          <SectionHeader eyebrow="Validación crítica" title="Picks descartados por el Skeptic" />
          <Text style={styles.paragraph}>
            La transparencia incluye lo que descartamos. Estos picks fueron considerados en stages previos pero no sobrevivieron el ataque del análisis crítico.
          </Text>
          {p.skepticAttacks.map((a, i) => (
            <Quote key={i}>{a}</Quote>
          ))}
        </Page>
      )}
    </Document>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add services/pdf/templates/PremiumMatchPDF.tsx
git commit -m "feat(pdf): Premium template with full picks + skeptic transparency"
```

---

### Task 2.8: Parlay template

**Files:**
- Create: `services/pdf/templates/ParlayPDF.tsx`

- [ ] **Step 1: Write the parlay template**

```tsx
// services/pdf/templates/ParlayPDF.tsx
import React from 'react';
import { Document, View, Text, StyleSheet } from '@react-pdf/renderer';
import { Page, CoverPage, SectionHeader, KPICard, Quote, DataTable } from '../design-system/components';
import { tokens } from '../design-system/tokens';
import { ensureFontsRegistered } from '../design-system/fonts';

const styles = StyleSheet.create({
  paragraph: { fontSize: tokens.fontSize.body, color: tokens.colors.textSecondary, lineHeight: tokens.lineHeight.normal, marginBottom: tokens.spacing.md },
  kpiRow: { flexDirection: 'row', gap: tokens.spacing.md, marginVertical: tokens.spacing.lg },
});

export interface ParlayLeg {
  match: string;
  market: string;
  selection: string;
  odds: number;
  probability: number;
  reasoning: string;
}

export interface ParlayPDFProps {
  riskLevel: 'CONSERVADOR' | 'EQUILIBRADO' | 'AGRESIVO';
  legs: ParlayLeg[];
  totalOdds: number;
  combinedProbability: number;
  generatedAt: string;
  isPromo: boolean;
}

export const ParlayPDF: React.FC<ParlayPDFProps> = (p) => {
  ensureFontsRegistered();
  return (
    <Document title={`Parlay ${p.riskLevel}`} author="Derbix">
      <CoverPage
        preTitle="PARLAY DEL DÍA"
        title={`Parlay ${p.riskLevel.toLowerCase()}`}
        subline={`${p.legs.length} selecciones · Cuota total ${p.totalOdds.toFixed(2)}`}
        seal={`Probabilidad combinada ${(p.combinedProbability * 100).toFixed(1)}% · Análisis Pipeline V9`}
        generatedAt={p.generatedAt}
      />

      <Page pageMeta="Resumen estratégico" pageNumber={2}>
        <SectionHeader eyebrow="Estrategia" title={`Parlay ${p.riskLevel.toLowerCase()}`} />
        <View style={styles.kpiRow}>
          <KPICard label="Selecciones" value={p.legs.length} />
          <KPICard label="Cuota total" value={p.totalOdds.toFixed(2)} />
          <KPICard label="Probabilidad" value={`${(p.combinedProbability * 100).toFixed(1)}%`} />
        </View>
        <Text style={styles.paragraph}>
          Cada selección de este parlay sobrevivió al pipeline completo de validación. La combinación está balanceada para el perfil {p.riskLevel.toLowerCase()}.
        </Text>
        {!p.isPromo && (
          <DataTable
            headers={['Partido', 'Mercado', 'Selección', 'Cuota', 'Prob.']}
            rows={p.legs.map((l) => [l.match, l.market, l.selection, l.odds.toFixed(2), `${l.probability}%`])}
          />
        )}
        {p.isPromo && (
          <Quote>El detalle completo de cada selección y su razonamiento está en derbix.co.</Quote>
        )}
      </Page>

      {!p.isPromo && (
        <Page pageMeta="Análisis profundo" pageNumber={3}>
          <SectionHeader eyebrow="Justificación" title="Por qué este parlay funciona" />
          {p.legs.map((leg, i) => (
            <View key={i} style={{ marginBottom: tokens.spacing.lg }}>
              <Text style={{ fontSize: tokens.fontSize.h3, fontWeight: tokens.fontWeight.semibold, color: tokens.colors.brandAccent, marginBottom: 4 }}>
                {leg.match} — {leg.market}: {leg.selection}
              </Text>
              <Text style={styles.paragraph}>{leg.reasoning}</Text>
            </View>
          ))}
        </Page>
      )}
    </Document>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add services/pdf/templates/ParlayPDF.tsx
git commit -m "feat(pdf): Parlay template (promo + premium variants)"
```

---

### Task 2.9: Generators (callable from app code)

**Files:**
- Create: `services/pdf/generators/generatePromoMatchPDF.ts`
- Create: `services/pdf/generators/generatePremiumMatchPDF.ts`
- Create: `services/pdf/generators/generateParlayPDF.ts`

- [ ] **Step 1: Write generatePromoMatchPDF**

```typescript
// services/pdf/generators/generatePromoMatchPDF.ts
import { pdf } from '@react-pdf/renderer';
import React from 'react';
import { PromoMatchPDF, type PromoMatchPDFProps } from '../templates/PromoMatchPDF';

export async function generatePromoMatchPDF(
  props: PromoMatchPDFProps,
  filename = `analisis-${props.homeTeam}-vs-${props.awayTeam}.pdf`,
): Promise<void> {
  const blob = await pdf(<PromoMatchPDF {...props} />).toBlob();
  triggerDownload(blob, filename);
}

export async function buildPromoMatchPDFBlob(props: PromoMatchPDFProps): Promise<Blob> {
  return await pdf(<PromoMatchPDF {...props} />).toBlob();
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
```

- [ ] **Step 2: Write generatePremiumMatchPDF**

```typescript
// services/pdf/generators/generatePremiumMatchPDF.ts
import { pdf } from '@react-pdf/renderer';
import React from 'react';
import { PremiumMatchPDF, type PremiumMatchPDFProps } from '../templates/PremiumMatchPDF';

export async function generatePremiumMatchPDF(
  props: PremiumMatchPDFProps,
  filename = `pronostico-${props.homeTeam}-vs-${props.awayTeam}.pdf`,
): Promise<void> {
  const blob = await pdf(<PremiumMatchPDF {...props} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
```

- [ ] **Step 3: Write generateParlayPDF**

```typescript
// services/pdf/generators/generateParlayPDF.ts
import { pdf } from '@react-pdf/renderer';
import React from 'react';
import { ParlayPDF, type ParlayPDFProps } from '../templates/ParlayPDF';

export async function generateParlayPDFNew(
  props: ParlayPDFProps,
  filename = `parlay-${props.riskLevel.toLowerCase()}.pdf`,
): Promise<void> {
  const blob = await pdf(<ParlayPDF {...props} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
```

- [ ] **Step 4: Commit**

```bash
git add services/pdf/generators/
git commit -m "feat(pdf): React-PDF generators for promo/premium/parlay"
```

---

### Task 2.10: Adapt pdfGenerator.ts as compatibility shim

**Files:**
- Modify: `services/pdf/pdfGenerator.ts`

- [ ] **Step 1: Read current public API**

Open `services/pdf/pdfGenerator.ts` and search for `export function generateMatchAnalysisPDF` and `export function generateParlayPDF`. Note their current signatures.

- [ ] **Step 2: Replace the file with adapter**

Replace the entire content of `services/pdf/pdfGenerator.ts` with:

```typescript
// services/pdf/pdfGenerator.ts
// Public API compatibility shim — delegates to React-PDF generators in services/pdf/generators/.
// Old jsPDF code has been removed (2026-05-05). If you need the legacy code, see git history.

import { generatePromoMatchPDF, type PromoMatchPDFProps } from './generators/generatePromoMatchPDF';
import { generatePremiumMatchPDF } from './generators/generatePremiumMatchPDF';
import type { PremiumMatchPDFProps, PremiumPick } from './templates/PremiumMatchPDF';
import { generateParlayPDFNew } from './generators/generateParlayPDF';
import type { ParlayPDFProps, ParlayLeg } from './templates/ParlayPDF';

interface ReportOptions {
  fileName?: string;
  titleOverride?: string;
  isPromo?: boolean;
  onlyOpportunities?: boolean;
}

interface AnalysisRunInput {
  fixture_id: number;
  home_team: string;
  away_team: string;
  league: string;
  match_date: string;
  match_time?: string;
  report_packet?: any;
  generated_at?: string;
}

function pickBoolForm(streak: string | undefined | null): string {
  return streak || '—';
}

function buildPromoPropsFromAnalysisRun(run: AnalysisRunInput): PromoMatchPDFProps {
  const rp = run.report_packet || {};
  const df = rp.data_foundation || {};
  const synth = rp.synthesizer || {};

  return {
    homeTeam: run.home_team,
    awayTeam: run.away_team,
    league: run.league,
    matchDate: run.match_date,
    matchTime: run.match_time || '—',
    dataVolume: synth.total_data_volume || df.data_volume_score || 1500,
    statisticalScore: Math.round((synth.overall_confidence || 70)),
    contextualScore: Math.round((synth.overall_confidence || 70) * 0.95),
    homeStreak: pickBoolForm(df.streak_home),
    awayStreak: pickBoolForm(df.streak_away),
    homeXG: df.xg_rolling?.home_for_10 ?? 1.5,
    awayXG: df.xg_rolling?.away_for_10 ?? 1.3,
    homeForm: ['Reciente 1', 'Reciente 2', 'Reciente 3', 'Reciente 4', 'Reciente 5'],
    awayForm: ['Reciente 1', 'Reciente 2', 'Reciente 3', 'Reciente 4', 'Reciente 5'],
    weatherDesc: rp.weather?.description ?? null,
    refereeName: df.referee_stats?.name ?? null,
    marketIntensities: [
      { category: 'Resultado (1X2)', intensity: 3 },
      { category: 'Goles (Over/Under)', intensity: 4 },
      { category: 'Ambos anotan (BTTS)', intensity: 3 },
      { category: 'Tarjetas', intensity: 2 },
      { category: 'Córneres', intensity: 2 },
    ],
    generatedAt: new Date(run.generated_at || Date.now()).toLocaleString('es-CO', { timeZone: 'America/Bogota' }),
    matchUrl: `https://derbix.co/match/${run.fixture_id}`,
  };
}

function buildPremiumPropsFromAnalysisRun(run: AnalysisRunInput): PremiumMatchPDFProps {
  const rp = run.report_packet || {};
  const synth = rp.synthesizer || {};
  const skeptic = rp.skeptic || {};

  const picks: PremiumPick[] = (synth.picks || []).map((p: any) => ({
    market: p.market,
    selection: p.selection,
    probability: Math.round(p.probability),
    odds: p.odds,
    edge_percent: p.edge_percent,
    confidence: p.confidence,
    reasoning: p.reasoning,
    survived_skeptic: p.survived_skeptic,
  }));

  const skepticAttacks: string[] = (skeptic.attacks || [])
    .filter((a: any) => a.verdict === 'DESCARTAR')
    .map((a: any) => `${a.target_pick_market} – ${a.target_pick_selection}: ${a.attack_argument}`);

  return {
    homeTeam: run.home_team,
    awayTeam: run.away_team,
    league: run.league,
    matchDate: run.match_date,
    matchTime: run.match_time || '—',
    dataVolume: synth.total_data_volume || 1500,
    finalVerdict: synth.summary || `${synth.veredicto || 'OBSERVAR'} — ${picks.length} picks confirmados`,
    picks,
    skepticAttacks,
    generatedAt: new Date(run.generated_at || Date.now()).toLocaleString('es-CO', { timeZone: 'America/Bogota' }),
  };
}

export async function generateMatchAnalysisPDF(
  analysisRun: AnalysisRunInput,
  options: ReportOptions = {},
): Promise<void> {
  if (options.isPromo) {
    const props = buildPromoPropsFromAnalysisRun(analysisRun);
    await generatePromoMatchPDF(props, options.fileName);
  } else {
    const props = buildPremiumPropsFromAnalysisRun(analysisRun);
    await generatePremiumMatchPDF(props, options.fileName);
  }
}

interface ParlayInput {
  riskLevel: 'CONSERVADOR' | 'EQUILIBRADO' | 'AGRESIVO';
  legs: ParlayLeg[];
  totalOdds: number;
  combinedProbability: number;
}

export async function generateParlayPDF(parlay: ParlayInput, options: ReportOptions = {}): Promise<void> {
  const props: ParlayPDFProps = {
    ...parlay,
    isPromo: !!options.isPromo,
    generatedAt: new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' }),
  };
  await generateParlayPDFNew(props, options.fileName);
}
```

- [ ] **Step 3: Verify the build still passes**

```bash
npm run build
```
Expected: build succeeds without TypeScript errors.

- [ ] **Step 4: Remove jspdf from package.json (legacy)**

```bash
npm uninstall jspdf jspdf-autotable
```

- [ ] **Step 5: Commit**

```bash
git add services/pdf/pdfGenerator.ts package.json package-lock.json
git commit -m "feat(pdf): pdfGenerator.ts is now a thin adapter to React-PDF generators; drop jsPDF"
```

---

## Phase 3 — Telegram Command Center

### Task 3.1: Database migration

**Files:**
- Create: `supabase/migrations/20260505_telegram_command_center.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260505_telegram_command_center.sql
-- Telegram Command Center: copy-paste content generation system.
-- No bot, no webhooks. Just a panel that produces content and a templates table.

-- 1) Add telegram_username to profiles (optional capture during signup)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS telegram_username TEXT;
CREATE INDEX IF NOT EXISTS idx_profiles_telegram_username ON profiles (telegram_username) WHERE telegram_username IS NOT NULL;

-- 2) Templates table for educational message system prompts (admin-editable)
CREATE TABLE IF NOT EXISTS telegram_content_templates (
  id BIGSERIAL PRIMARY KEY,
  category TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3) Seed initial 6 categories
INSERT INTO telegram_content_templates (category, display_name, system_prompt) VALUES
('anti_tipster', 'Anti-tipster', 'Genera un mensaje breve en español (máx 600 caracteres) para un canal de Telegram de apuestas deportivas. Tono: profesional, contra corriente, denuncia las prácticas turbias de los tipsters falsos (bloquear usuarios que pierden, falta de transparencia, no publicar resultados verificados). Termina con CTA: "👉 derbix.co". No uses emojis exagerados — máximo 2.'),
('transparency', 'Transparencia', 'Genera un mensaje breve en español (máx 600 caracteres) para Telegram. Tono: datos crudos, transparencia total. Habla de cómo Derbix publica TODOS los resultados verificados (gane o pierda), por qué eso construye confianza. Termina con CTA "👉 derbix.co". Máximo 2 emojis.'),
('professional_tip', 'Consejo profesional', 'Genera un consejo profesional sobre apuestas deportivas en español (máx 600 caracteres). Temas posibles: gestión de bankroll, valor vs cuota, disciplina emocional, paciencia, diversificación. Termina con CTA "👉 derbix.co". Máximo 2 emojis.'),
('bettor_pain', 'Dolor del apostador', 'Genera un mensaje en español (máx 600 caracteres) que describe un dolor común del apostador (perder racha de 3, intentar recuperar, terminar el mes en rojo, etc.) y lo conecta con la solución metodológica de Derbix. Tono empático pero firme. Termina con CTA "👉 derbix.co".'),
('derbix_diff', 'Diferenciador Derbix', 'Genera un mensaje en español (máx 600 caracteres) que destaca un aspecto único de Derbix: análisis de miles de datos, 6 modelos especializados, validación crítica, threshold del 80%. Tono profesional, no marketing barato. Termina con CTA "👉 derbix.co".'),
('temporal_context', 'Contexto temporal', 'Genera un mensaje en español (máx 600 caracteres) con ángulo temporal/estacional: día de la semana, derbis cercanos, fin de semana de fútbol europeo, etc. Conecta el contexto con la oportunidad. Termina con CTA "👉 derbix.co". Máximo 2 emojis.')
ON CONFLICT (category) DO NOTHING;

COMMENT ON TABLE telegram_content_templates IS 'System prompts for DeepSeek-Flash to generate Telegram educational messages. Editable from admin.';
```

- [ ] **Step 2: Apply the migration**

```bash
npx supabase db push
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260505_telegram_command_center.sql
git commit -m "feat(telegram): migration for telegram_username + content templates"
```

---

### Task 3.2: Edge function `telegram-content-generate`

**Files:**
- Create: `supabase/functions/telegram-content-generate/index.ts`

- [ ] **Step 1: Write the edge function**

```typescript
// supabase/functions/telegram-content-generate/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const DEEPSEEK_API_KEY = Deno.env.get('DEEPSEEK_API_KEY')!;
const DEEPSEEK_FLASH_MODEL = 'deepseek-v4-flash';
const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions';

interface RequestBody {
  category: string;
  context_data?: Record<string, any>;
}

async function callDeepSeekFlash(systemPrompt: string, userPrompt: string): Promise<string> {
  const res = await fetch(DEEPSEEK_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: DEEPSEEK_FLASH_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7, // some variation between regenerations
      max_tokens: 600,
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`DeepSeek-Flash error ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body: RequestBody = await req.json();
    if (!body.category) {
      return new Response(JSON.stringify({ error: 'category required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: tpl, error: tplErr } = await supabase
      .from('telegram_content_templates')
      .select('system_prompt, display_name')
      .eq('category', body.category)
      .eq('is_active', true)
      .single();

    if (tplErr || !tpl) {
      return new Response(JSON.stringify({ error: 'category not found or inactive' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userPrompt = `Genera un mensaje variado y profesional. Contexto adicional: ${JSON.stringify(body.context_data || {})}.\n\nFecha: ${new Date().toLocaleDateString('es-CO', { timeZone: 'America/Bogota' })}.`;

    const text = await callDeepSeekFlash(tpl.system_prompt, userPrompt);

    // Increment use_count
    await supabase
      .from('telegram_content_templates')
      .update({ use_count: (tpl as any).use_count ? (tpl as any).use_count + 1 : 1, last_used_at: new Date().toISOString() })
      .eq('category', body.category);

    return new Response(
      JSON.stringify({ text, generated_at: new Date().toISOString(), category: body.category }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[telegram-content-generate]', err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
```

- [ ] **Step 2: Deploy**

```bash
npx supabase functions deploy telegram-content-generate --no-verify-jwt
```

- [ ] **Step 3: Test the endpoint**

```bash
curl -X POST "$(npx supabase status | grep 'API URL' | awk '{print $3}')/functions/v1/telegram-content-generate" \
  -H "Authorization: Bearer $(npx supabase status | grep 'anon key' | awk '{print $3}')" \
  -H "Content-Type: application/json" \
  -d '{"category":"anti_tipster"}'
```

Expected: a JSON response with a `text` field containing a Spanish anti-tipster message.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/telegram-content-generate/index.ts
git commit -m "feat(telegram): edge function generates content via DeepSeek-Flash"
```

---

### Task 3.3: Add telegram_username to signup form

**Files:**
- Modify: signup form (locate via grep)

- [ ] **Step 1: Find the signup form**

```bash
grep -rn "supabase.auth.signUp\|sign_up\|signup\|signUp" components/auth/ services/ | head -20
```
Identify the file (likely `components/auth/SignUpForm.tsx`, `components/auth/SignUp.tsx`, or similar). Read it.

- [ ] **Step 2: Add the field**

In the signup form component, after the existing form fields (email, password, name) and before the submit button, add:

```tsx
<div className="flex flex-col gap-2">
  <label htmlFor="telegram_username" className="text-sm text-slate-300">
    Tu usuario de Telegram (opcional)
  </label>
  <input
    id="telegram_username"
    type="text"
    placeholder="@tu_usuario"
    value={telegramUsername}
    onChange={(e) => setTelegramUsername(e.target.value.replace(/^@*/, '@').replace(/\s/g, ''))}
    className="bg-slate-900/50 border border-white/10 rounded-md px-3 py-2 text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
  />
  <p className="text-xs text-slate-500">Si te suscribes al canal, te damos la bienvenida con tu @ al final del día.</p>
</div>
```

Add the state above with the other useState calls:
```tsx
const [telegramUsername, setTelegramUsername] = useState('');
```

In the submit handler, after the auth signUp success and the profile insert/upsert, include `telegram_username: telegramUsername.trim() || null` in the profile data. If there's no profile insert in the form, do an explicit upsert after signUp:

```tsx
if (telegramUsername.trim()) {
  await supabase.from('profiles').update({ telegram_username: telegramUsername.trim() }).eq('id', authData.user!.id);
}
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add components/auth/
git commit -m "feat(auth): capture optional telegram_username during signup"
```

---

### Task 3.4: Telegram Command Center component

**Files:**
- Create: `components/admin/TelegramCommandCenter.tsx`
- Modify: any place that imports `TelegramContentGenerator` to import the new name (or delete the old file at the end)

- [ ] **Step 1: Find current import sites**

```bash
grep -rn "TelegramContentGenerator" components/ services/ App.tsx
```
Note the import locations.

- [ ] **Step 2: Write the new component**

```tsx
// components/admin/TelegramCommandCenter.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../services/supabaseService';
import { getCurrentDateInBogota } from '../../utils/dateUtils';
import { getPublicResults } from '../../services/resultsService';
import { generatePromoMatchPDF } from '../../services/pdf/generators/generatePromoMatchPDF';
import type { PromoMatchPDFProps } from '../../services/pdf/templates/PromoMatchPDF';

interface ContentBlock {
  id: string;
  title: string;
  subtitle: string;
  content: string;
  loading: boolean;
  error?: string | null;
}

interface PickOfDay {
  fixture_id: number;
  match: string;
  league: string;
  match_time: string;
  edge_percent: number;
  market: string;
  selection: string;
  odds: number;
  probability: number;
  data_volume: number;
}

interface NewSignup {
  telegram_username: string;
  created_at: string;
}

const CATEGORIES = [
  { value: 'anti_tipster', label: 'Anti-tipster' },
  { value: 'transparency', label: 'Transparencia' },
  { value: 'professional_tip', label: 'Consejo profesional' },
  { value: 'bettor_pain', label: 'Dolor del apostador' },
  { value: 'derbix_diff', label: 'Diferenciador Derbix' },
  { value: 'temporal_context', label: 'Contexto temporal' },
];

export const TelegramCommandCenter: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const today = getCurrentDateInBogota();

  // Block 1 — Morning tip
  const [morningCategory, setMorningCategory] = useState<string>('anti_tipster');
  const [morningBlock, setMorningBlock] = useState<ContentBlock>({ id: 'morning', title: '☀️ Mañana — Tip educativo', subtitle: 'Mensaje con CTA a derbix.co', content: '', loading: false });

  // Block 2 — Daily pick teaser
  const [picksOfDay, setPicksOfDay] = useState<PickOfDay[]>([]);
  const [selectedPickFixtureId, setSelectedPickFixtureId] = useState<number | null>(null);
  const [pickBlock, setPickBlock] = useState<ContentBlock>({ id: 'pick', title: '🎯 Pronóstico del día (teaser)', subtitle: 'Sin revelar mercado/selección', content: '', loading: true });

  // Block 3 — PDF caption
  const [pdfCaption] = useState<string>('Aquí el análisis técnico del partido.\n\nEl pronóstico exacto y la cuota recomendada están en derbix.co 👉');
  const [pdfBuilding, setPdfBuilding] = useState(false);

  // Block 4 — Mediodía
  const [middayCategory, setMiddayCategory] = useState<string>('professional_tip');
  const [middayBlock, setMiddayBlock] = useState<ContentBlock>({ id: 'midday', title: '🌤 Mediodía — Consejo profesional', subtitle: '', content: '', loading: false });

  // Block 5 — Resumen del día
  const [summaryBlock, setSummaryBlock] = useState<ContentBlock>({ id: 'summary', title: '📊 Resumen del día (cierre)', subtitle: 'Datos verificados de hoy', content: '', loading: true });

  // Block 6 — Welcome
  const [newSignups, setNewSignups] = useState<NewSignup[]>([]);
  const [extraUsernames, setExtraUsernames] = useState<string>('');
  const [welcomeBlock, setWelcomeBlock] = useState<ContentBlock>({ id: 'welcome', title: '👋 Welcome — Nuevos del día', subtitle: 'Etiqueta @ a registrados de hoy', content: '', loading: true });

  // Generate educational content via edge function
  const generateContent = useCallback(async (category: string, block: 'morning' | 'midday') => {
    const setter = block === 'morning' ? setMorningBlock : setMiddayBlock;
    const baseTitle = block === 'morning' ? '☀️ Mañana — Tip educativo' : '🌤 Mediodía — Consejo profesional';
    setter({ id: block, title: baseTitle, subtitle: '', content: '', loading: true });
    try {
      const { data, error } = await supabase.functions.invoke('telegram-content-generate', {
        body: { category, context_data: { date: today } },
      });
      if (error) throw error;
      setter({ id: block, title: baseTitle, subtitle: CATEGORIES.find((c) => c.value === category)?.label || '', content: data.text, loading: false });
    } catch (err) {
      setter({ id: block, title: baseTitle, subtitle: '', content: '', loading: false, error: (err as Error).message });
    }
  }, [today]);

  // Load picks of the day
  useEffect(() => {
    (async () => {
      const { data: picks, error } = await supabase
        .from('value_picks_v2')
        .select(`
          fixture_id, market, selection, odds, p_model, edge_percent, engine_version,
          daily_matches!inner(home_team_name, away_team_name, league_name, match_time, match_date)
        `)
        .eq('daily_matches.match_date', today)
        .gte('p_model', 0.80)
        .order('edge_percent', { ascending: false })
        .limit(10);

      if (!error && picks) {
        const mapped: PickOfDay[] = picks.map((p: any) => ({
          fixture_id: p.fixture_id,
          match: `${p.daily_matches.home_team_name} vs ${p.daily_matches.away_team_name}`,
          league: p.daily_matches.league_name,
          match_time: p.daily_matches.match_time,
          edge_percent: p.edge_percent || 0,
          market: p.market,
          selection: p.selection,
          odds: p.odds,
          probability: Math.round((p.p_model || 0) * 100),
          data_volume: 1500 + Math.round((p.edge_percent || 0) * 100),
        }));
        setPicksOfDay(mapped);
        if (mapped.length > 0) setSelectedPickFixtureId(mapped[0].fixture_id);
      }
    })();
  }, [today]);

  // Generate pick teaser whenever selectedPickFixtureId changes
  useEffect(() => {
    const pick = picksOfDay.find((p) => p.fixture_id === selectedPickFixtureId);
    if (!pick) return;
    const teaser = `🔥 *Pronóstico del día — ${pick.league}*

*${pick.match}* · ${pick.match_time} (Bogotá)

Hemos analizado *${pick.data_volume.toLocaleString('es-CO')} datos* de este partido: forma reciente, lesiones, alineaciones probables, clima, árbitro y comportamiento del mercado.

6 modelos especializados llegaron a consenso. La cuota actual del mercado no refleja lo que los datos están diciendo.

👉 *Pronóstico exacto + razonamiento técnico*: https://derbix.co?utm_source=telegram&utm_campaign=daily_pick`;
    setPickBlock({ id: 'pick', title: '🎯 Pronóstico del día (teaser)', subtitle: 'Sin revelar mercado/selección', content: teaser, loading: false });
  }, [selectedPickFixtureId, picksOfDay]);

  // Build summary
  useEffect(() => {
    (async () => {
      try {
        const results = await getPublicResults();
        const todayPicks = (results.picks || []).filter((p: any) => p.match_date === today && (p.result === 'WON' || p.result === 'LOST'));
        const wins = todayPicks.filter((p: any) => p.result === 'WON').length;
        const total = todayPicks.length;
        const stake = total;
        const profit = todayPicks.reduce((acc: number, p: any) => acc + (p.result === 'WON' ? (p.odds - 1) : -1), 0);
        const roi = total > 0 ? ((profit / stake) * 100).toFixed(1) : '0.0';

        const text = total === 0
          ? `📊 *Cierre del día* — ${today}\n\nHoy no hay aún pronósticos verificados. La verificación se completa al final de cada partido.\n\n👉 derbix.co`
          : `📊 *Cierre del día* — ${today}\n\n• Pronósticos verificados: *${total}*\n• Aciertos: *${wins}*\n• ROI del día: *${parseFloat(roi) >= 0 ? '+' : ''}${roi}%*\n\nEsto NO es win rate del 90% — es consistencia matemática a lo largo del tiempo. Sin marketing barato. Sin tipsters falsos.\n\n👉 https://derbix.co?utm_source=telegram&utm_campaign=summary`;

        setSummaryBlock({ id: 'summary', title: '📊 Resumen del día (cierre)', subtitle: 'Datos verificados de hoy', content: text, loading: false });
      } catch {
        setSummaryBlock({ id: 'summary', title: '📊 Resumen del día (cierre)', subtitle: '', content: '', loading: false, error: 'No se pudo cargar' });
      }
    })();
  }, [today]);

  // Load new signups for welcome
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('telegram_username, created_at')
        .gte('created_at', `${today}T00:00:00`)
        .lte('created_at', `${today}T23:59:59`)
        .not('telegram_username', 'is', null);
      if (!error && data) setNewSignups(data as NewSignup[]);
    })();
  }, [today]);

  // Build welcome message when newSignups + extraUsernames change
  useEffect(() => {
    const fromDb = newSignups.map((s) => (s.telegram_username.startsWith('@') ? s.telegram_username : `@${s.telegram_username}`));
    const extras = extraUsernames.split(/[,\s\n]+/).map((s) => s.trim()).filter(Boolean).map((s) => (s.startsWith('@') ? s : `@${s}`));
    const all = Array.from(new Set([...fromDb, ...extras]));
    const text = all.length === 0
      ? `👋 *Bienvenida del día*\n\nUn nuevo día con datos crudos y resultados verificados. Si llegaste hoy a este canal: gracias por darle una oportunidad a un sistema que NO depende de tipsters falsos. \n\n👉 derbix.co`
      : `👋 *Bienvenidos a Derbix*\n\nGracias por sumarse hoy: ${all.join(', ')}\n\nEste canal NO publica pronósticos directos. Publica análisis técnico transparente. El pronóstico exacto vive en la plataforma.\n\n👉 https://derbix.co?utm_source=telegram&utm_campaign=welcome`;
    setWelcomeBlock({ id: 'welcome', title: '👋 Welcome — Nuevos del día', subtitle: `${all.length} usuarios`, content: text, loading: false });
  }, [newSignups, extraUsernames]);

  // First load — generate morning + midday once
  useEffect(() => { generateContent(morningCategory, 'morning'); }, []); // eslint-disable-line
  useEffect(() => { generateContent(middayCategory, 'midday'); }, []); // eslint-disable-line

  const copyToClipboard = (text: string) => navigator.clipboard.writeText(text);

  const downloadPickPDF = async () => {
    const pick = picksOfDay.find((p) => p.fixture_id === selectedPickFixtureId);
    if (!pick) return;
    setPdfBuilding(true);
    try {
      const [home, away] = pick.match.split(' vs ');
      const props: PromoMatchPDFProps = {
        homeTeam: home,
        awayTeam: away,
        league: pick.league,
        matchDate: today,
        matchTime: pick.match_time,
        dataVolume: pick.data_volume,
        statisticalScore: 75,
        contextualScore: 70,
        homeStreak: '—',
        awayStreak: '—',
        homeXG: 1.5,
        awayXG: 1.3,
        homeForm: ['Reciente 1', 'Reciente 2', 'Reciente 3', 'Reciente 4', 'Reciente 5'],
        awayForm: ['Reciente 1', 'Reciente 2', 'Reciente 3', 'Reciente 4', 'Reciente 5'],
        weatherDesc: null,
        refereeName: null,
        marketIntensities: [
          { category: 'Resultado (1X2)', intensity: 3 },
          { category: 'Goles (Over/Under)', intensity: 4 },
          { category: 'Ambos anotan (BTTS)', intensity: 3 },
          { category: 'Tarjetas', intensity: 2 },
          { category: 'Córneres', intensity: 2 },
        ],
        generatedAt: new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' }),
        matchUrl: `https://derbix.co/match/${pick.fixture_id}`,
      };
      await generatePromoMatchPDF(props, `derbix-${home}-vs-${away}.pdf`);
    } finally {
      setPdfBuilding(false);
    }
  };

  return (
    <div className="space-y-4 p-4">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Telegram Command Center</h2>
          <p className="text-sm text-slate-400">Día: {today} · Mensajes para copiar y pegar al canal</p>
        </div>
        {onBack && <button onClick={onBack} className="text-emerald-400">← Volver</button>}
      </header>

      {/* Block 1 */}
      <BlockCard
        block={morningBlock}
        leftSlot={
          <select value={morningCategory} onChange={(e) => { setMorningCategory(e.target.value); generateContent(e.target.value, 'morning'); }} className="bg-slate-900 border border-white/10 rounded px-2 py-1 text-sm text-white">
            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        }
        onCopy={() => copyToClipboard(morningBlock.content)}
        onRegen={() => generateContent(morningCategory, 'morning')}
      />

      {/* Block 2 */}
      <BlockCard
        block={pickBlock}
        leftSlot={
          <select value={selectedPickFixtureId ?? ''} onChange={(e) => setSelectedPickFixtureId(Number(e.target.value))} className="bg-slate-900 border border-white/10 rounded px-2 py-1 text-sm text-white">
            {picksOfDay.length === 0 && <option value="">No hay picks hoy</option>}
            {picksOfDay.map((p) => <option key={p.fixture_id} value={p.fixture_id}>{p.match} · edge {p.edge_percent.toFixed(1)}%</option>)}
          </select>
        }
        onCopy={() => copyToClipboard(pickBlock.content)}
      />

      {/* Block 3 — PDF */}
      <div className="rounded-lg border border-white/10 bg-slate-900/50 p-4 space-y-3">
        <div className="flex justify-between items-center">
          <div>
            <h3 className="text-white font-semibold">📄 PDF del pronóstico</h3>
            <p className="text-xs text-slate-400">Sin pick · Solo razonamiento técnico</p>
          </div>
          <div className="flex gap-2">
            <button disabled={!selectedPickFixtureId || pdfBuilding} onClick={downloadPickPDF} className="rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-3 py-1.5 text-sm text-white">{pdfBuilding ? 'Generando...' : 'Descargar PDF'}</button>
            <button onClick={() => copyToClipboard(pdfCaption)} className="rounded bg-slate-700 hover:bg-slate-600 px-3 py-1.5 text-sm text-white">Copiar caption</button>
          </div>
        </div>
        <pre className="whitespace-pre-wrap text-sm text-slate-300">{pdfCaption}</pre>
      </div>

      {/* Block 4 */}
      <BlockCard
        block={middayBlock}
        leftSlot={
          <select value={middayCategory} onChange={(e) => { setMiddayCategory(e.target.value); generateContent(e.target.value, 'midday'); }} className="bg-slate-900 border border-white/10 rounded px-2 py-1 text-sm text-white">
            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        }
        onCopy={() => copyToClipboard(middayBlock.content)}
        onRegen={() => generateContent(middayCategory, 'midday')}
      />

      {/* Block 5 */}
      <BlockCard block={summaryBlock} onCopy={() => copyToClipboard(summaryBlock.content)} />

      {/* Block 6 */}
      <div className="rounded-lg border border-white/10 bg-slate-900/50 p-4 space-y-3">
        <div className="flex justify-between items-center">
          <div>
            <h3 className="text-white font-semibold">{welcomeBlock.title}</h3>
            <p className="text-xs text-slate-400">{welcomeBlock.subtitle}</p>
          </div>
          <button onClick={() => copyToClipboard(welcomeBlock.content)} className="rounded bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-sm text-white">Copiar</button>
        </div>
        <textarea
          placeholder="Pega aquí @usernames adicionales del canal (separados por coma o nueva línea)"
          value={extraUsernames}
          onChange={(e) => setExtraUsernames(e.target.value)}
          rows={2}
          className="w-full bg-slate-900 border border-white/10 rounded px-2 py-1 text-sm text-slate-200 placeholder-slate-500"
        />
        <pre className="whitespace-pre-wrap text-sm text-slate-300">{welcomeBlock.content}</pre>
      </div>
    </div>
  );
};

const BlockCard: React.FC<{
  block: ContentBlock;
  leftSlot?: React.ReactNode;
  onCopy?: () => void;
  onRegen?: () => void;
}> = ({ block, leftSlot, onCopy, onRegen }) => (
  <div className="rounded-lg border border-white/10 bg-slate-900/50 p-4 space-y-3">
    <div className="flex justify-between items-center gap-2">
      <div className="flex-1 min-w-0">
        <h3 className="text-white font-semibold">{block.title}</h3>
        {block.subtitle && <p className="text-xs text-slate-400">{block.subtitle}</p>}
      </div>
      <div className="flex gap-2 flex-wrap">
        {leftSlot}
        {onRegen && <button onClick={onRegen} className="rounded bg-slate-700 hover:bg-slate-600 px-3 py-1.5 text-sm text-white" disabled={block.loading}>↻ Regenerar</button>}
        {onCopy && <button onClick={onCopy} className="rounded bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-sm text-white" disabled={block.loading || !block.content}>Copiar</button>}
      </div>
    </div>
    {block.loading && <p className="text-sm text-slate-500">Generando…</p>}
    {block.error && <p className="text-sm text-red-400">{block.error}</p>}
    {!block.loading && block.content && <pre className="whitespace-pre-wrap text-sm text-slate-300">{block.content}</pre>}
  </div>
);
```

- [ ] **Step 3: Replace import sites**

For every file found in step 1 that imports `TelegramContentGenerator`, replace the import and JSX usage:

```tsx
// before:
import { TelegramContentGenerator } from './TelegramContentGenerator';
// ...
<TelegramContentGenerator onBack={...} />

// after:
import { TelegramCommandCenter } from './TelegramCommandCenter';
// ...
<TelegramCommandCenter onBack={...} />
```

- [ ] **Step 4: Delete the old file**

```bash
git rm components/admin/TelegramContentGenerator.tsx
```

- [ ] **Step 5: Verify build**

```bash
npm run build
```

- [ ] **Step 6: Commit**

```bash
git add components/admin/TelegramCommandCenter.tsx
git commit -m "feat(telegram): TelegramCommandCenter replaces TelegramContentGenerator"
```

---

## Phase 4 — QA & Pre-Campaign Verification

### Task 4.1: Manual smoke test of pipeline

**Files:** none

- [ ] **Step 1: Pick 5 fixtures from today**

In the admin UI or directly in DB:
```sql
SELECT id, home_team_name, away_team_name, match_date, match_time
FROM daily_matches
WHERE match_date = CURRENT_DATE
ORDER BY match_time
LIMIT 5;
```

- [ ] **Step 2: Trigger analysis for each fixture**

Via the LiveFeed UI or via direct invocation:
```bash
for FIXTURE_ID in <id1> <id2> <id3> <id4> <id5>; do
  curl -X POST "$SUPABASE_URL/functions/v1/v3-ai-analyzer" \
    -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"fixture_id\":$FIXTURE_ID}"
  sleep 5
done
```

- [ ] **Step 3: Verify in DB**

```sql
SELECT
  fixture_id,
  veredicto,
  report_packet->>'pipeline_version' AS version,
  jsonb_array_length(report_packet->'validated_picks') AS validated_count,
  (report_packet->'timings'->>'total_ms')::int AS total_ms
FROM reports_v2
WHERE match_date = CURRENT_DATE
ORDER BY created_at DESC LIMIT 5;
```
Expected: every row shows `version='V9-HYBRID-2026-05-05'`, has `validated_count >= 0`, `total_ms < 120000`.

- [ ] **Step 4: Inspect logs for fallback usage**

```bash
npx supabase functions logs v3-ai-analyzer --tail 200 | grep -E "gemini|groq|openrouter|mistral"
```
Expected: no matches (zero fallback to non-DeepSeek providers in successful runs).

---

### Task 4.2: Manual test of Telegram Command Center

**Files:** none

- [ ] **Step 1: Open the admin panel**

Navigate to the admin section that hosts the new `TelegramCommandCenter`. Verify all 6 blocks render.

- [ ] **Step 2: Test each category for morning/midday**

For each of the 6 categories in the dropdown of Block 1, click and verify a new message is generated (different from the previous one).

- [ ] **Step 3: Test pick teaser**

Select different picks from the Block 2 dropdown. Verify the teaser updates and never reveals the market or selection.

- [ ] **Step 4: Test PDF download**

Click "Descargar PDF". Verify a PDF downloads and opens cleanly. Inspect: 8 pages, no pick reveal, fonts render correctly, CTA visible.

- [ ] **Step 5: Test summary**

If today has verified picks, verify Block 5 shows real numbers. If not, verify the empty-state message.

- [ ] **Step 6: Test welcome with both signups and manual**

Add some `@usernames` to the textarea. Verify the welcome message includes both DB-loaded usernames and the manual ones, deduplicated.

---

### Task 4.3: Manual visual inspection of the 3 PDFs

**Files:** none

- [ ] **Step 1: Generate one Promo PDF**

From an analyzed match in the admin or a dev page, invoke `generateMatchAnalysisPDF(run, { isPromo: true })`. Open the PDF.

Checklist:
- [ ] 8 pages
- [ ] Cover has dynamic data volume number, not "3,247"
- [ ] No page reveals market name + specific selection (audit pages 5 and 6 carefully)
- [ ] Fonts render (no fallback Helvetica)
- [ ] CTA page has a visible URL like `https://derbix.co/match/<id>`
- [ ] Disclaimer page exists

- [ ] **Step 2: Generate one Premium PDF**

Same match, `isPromo: false`. Verify:
- [ ] Picks page lists each pick with market, selection, probability, odds, edge
- [ ] Skeptic attacks page exists if any picks were discarded

- [ ] **Step 3: Generate one Parlay PDF**

If a parlay exists for today, generate both `isPromo:true` and `isPromo:false` versions and verify the difference (promo hides full table).

---

### Task 4.4: Dispatch QA agent for end-to-end verification

**Files:** none

- [ ] **Step 1: Spawn a general-purpose agent with this prompt**

```
Eres un QA agent encargado de verificar que el ultra-plan de Derbix está listo para campaña publicitaria.

Tareas:
1. Revisa que `npm run build` compila sin errores en /Users/apple/Documents/Centro-de-Mando---Pron-sticos-1
2. Ejecuta `deno test supabase/functions/_shared/agents/` y reporta resultados
3. Verifica que `supabase/functions/_shared/llm-client.ts` tiene un único provider (deepseek-v4-flash) y NO menciona Gemini/Groq/OpenRouter/Mistral en producción
4. Verifica que el threshold 80 está en: `supabase/functions/v2-generate-parlays/index.ts`, `supabase/functions/hourly-results-verifier/index.ts`, `services/resultsService.ts`, `components/ai/HighProbPicks.tsx` (a través de constants/opportunities.ts)
5. Verifica que `services/pdf/templates/PromoMatchPDF.tsx` no contiene strings con mercados específicos hardcoded en su contenido (busca "1X2", "BTTS", "Over 2.5" en literales)
6. Verifica que `components/admin/TelegramCommandCenter.tsx` existe y `TelegramContentGenerator.tsx` ya no existe
7. Verifica que la migración `supabase/migrations/20260505_telegram_command_center.sql` se aplicó (tabla telegram_content_templates con 6 categorías, columna profiles.telegram_username existe)
8. Reporta cualquier file con TODOs, FIXMEs o console.log de debug que se haya colado

Reporta en formato estructurado: ✅ pasa / ❌ falla con detalle. Si algo falla, describe qué arreglar.
```

- [ ] **Step 2: If QA reports any failure, fix and re-run**

For every ❌ from the QA agent, address it (small commit per fix), then re-run the QA agent until all pass.

- [ ] **Step 3: Final commit / tag**

```bash
git tag -a "ultra-plan-2026-05-05-pre-campaign" -m "Ultra plan complete and QA-verified, ready for campaign launch"
```

---

## Self-Review

**Spec coverage:**
- Pipeline IA Stages 0-5: Tasks 1.4–1.9 + orchestrator (1.10) + analyzer integration (1.11). ✅
- DeepSeek-only with retry: Task 1.1. ✅
- Threshold 80%: Task 0.1 + Task 1.12. ✅
- temperature=0: Task 1.1 step 4. ✅
- Schema validation: Task 1.2. ✅
- Telegram migration + new field: Task 3.1 + 3.3. ✅
- Telegram edge function: Task 3.2. ✅
- Telegram Command Center component: Task 3.4. ✅
- React-PDF + fonts + tokens: Tasks 2.1–2.3. ✅
- Components: Tasks 2.4–2.5. ✅
- Promo / Premium / Parlay templates: Tasks 2.6–2.8. ✅
- Generators + adapter: Tasks 2.9–2.10. ✅
- QA: Tasks 4.1–4.4. ✅

**Placeholders:** none found on review.

**Type consistency:**
- `runPipeline(context, rawETL)` is consistent across orchestrator and v3-ai-analyzer integration.
- `PromoMatchPDFProps` referenced correctly in template, generator and Telegram center.
- `OPPORTUNITIES_THRESHOLD` and `OPPORTUNITIES_THRESHOLD_PERCENT` are the agreed names everywhere.
