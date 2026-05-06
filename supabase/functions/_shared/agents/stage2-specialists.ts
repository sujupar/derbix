// _shared/agents/stage2-specialists.ts

import { callLLM } from '../llm-client.ts';
import { callWithSchemaRetry } from './schema-validator.ts';
import type {
  DataFoundationOutput,
  StatisticalFoundationOutput,
  SpecialistOutput,
  MatchContext,
} from './types.ts';

const SHARED_SCHEMA = `Output JSON ÚNICO sin markdown:
{"agent_name":"TACTICAL|CONTEXTUAL|MARKET","thesis_supports_or_opposes":"SUPPORTS|OPPOSES|MIXED","key_findings":["b1","b2","b3"],"modifies_probabilities":{},"candidate_picks":[{"market":"","selection":"","rationale":"","probability_estimate":0,"odds_reference":null}],"notes":""}
Sé conciso. 2-4 picks máx.`;

function buildBaseContext(df: DataFoundationOutput, s1: StatisticalFoundationOutput | null): string {
  // Compact data foundation: only the most discriminative fields
  const compact = {
    home: df.home_team, away: df.away_team, league: df.league, date: df.date,
    streak: { home: df.streak_home, away: df.streak_away },
    days_rest: { home: df.days_rest_home, away: df.days_rest_away },
    xg: df.xg_rolling,
    goals_avg: df.goals_avg,
    referee: df.referee_stats?.name ? { name: df.referee_stats.name, yellows: df.referee_stats.yellows_per_match, home_bias: df.referee_stats.home_bias } : null,
    sportmonks_pred: df.sportmonks_predictions,
    injuries: df.injuries_impact,
    competition: df.competition_context,
    lineups_confidence: df.lineups_probable.confidence,
    clv: df.clv_signal,
  };
  let out = `DATOS BASE: ${JSON.stringify(compact)}`;
  if (s1) out += `\n\nTESIS BASELINE: ${JSON.stringify(s1)}`;
  return out;
}

// ─────────────────────────── TACTICAL ───────────────────────────
const TACTICAL_SYSTEM = `Analista táctico de fútbol. ${SHARED_SCHEMA}`;

export async function runTactical(
  df: DataFoundationOutput,
  s1: StatisticalFoundationOutput,
  context: MatchContext,
): Promise<SpecialistOutput> {
  const prompt = `${buildBaseContext(df, s1)}
TAC: form=${context.lineups?.home.formation ?? '?'} vs ${context.lineups?.away.formation ?? '?'}
H2H: ${context.h2h.substring(0, 800)}
Hist L: ${context.homeHistory.substring(0, 1000)}
Hist V: ${context.awayHistory.substring(0, 1000)}
Da 2-4 candidate_picks tácticos. agent_name="TACTICAL".`;

  return await callWithSchemaRetry<SpecialistOutput>(
    async () => {
      const r = await callLLM(prompt, {
        systemPrompt: TACTICAL_SYSTEM,
        jsonMode: true,
        temperature: 0,
        maxTokens: 5000,
        timeoutMs: 45000,
      });
      return r.text;
    },
    ['agent_name', 'thesis_supports_or_opposes', 'key_findings', 'candidate_picks'],
    'STAGE2_TACTICAL',
    0,
  );
}

// ─────────────────────────── CONTEXTUAL ───────────────────────────
const CONTEXTUAL_SYSTEM = `Analista contextual (clima/fatiga/lesiones/árbitro). ${SHARED_SCHEMA}`;

export async function runContextual(
  df: DataFoundationOutput,
  s1: StatisticalFoundationOutput,
  context: MatchContext,
): Promise<SpecialistOutput> {
  const prompt = `${buildBaseContext(df, s1)}
CTX: clima="${context.weather?.description ?? 'na'}" fatiga=L${context.fatigue?.home ?? '?'}/V${context.fatigue?.away ?? '?'} ref=${df.referee_stats?.name ?? '?'}
Lesiones: L=${df.injuries_impact.home_key_missing.join('/') || '-'} V=${df.injuries_impact.away_key_missing.join('/') || '-'}
Externo: ${context.external_context?.substring(0, 1500) ?? '-'}
Da 2-4 candidate_picks contextuales (mercados secundarios). agent_name="CONTEXTUAL".`;

  return await callWithSchemaRetry<SpecialistOutput>(
    async () => {
      const r = await callLLM(prompt, {
        systemPrompt: CONTEXTUAL_SYSTEM,
        jsonMode: true,
        temperature: 0,
        maxTokens: 5000,
        timeoutMs: 45000,
      });
      return r.text;
    },
    ['agent_name', 'thesis_supports_or_opposes', 'key_findings', 'candidate_picks'],
    'STAGE2_CONTEXTUAL',
    0,
  );
}

// ─────────────────────────── MARKET ───────────────────────────
const MARKET_SYSTEM = `Analista de valor en cuotas. Edge = (prob_modelo - prob_implícita)/prob_implícita. ${SHARED_SCHEMA}`;

export async function runMarket(
  df: DataFoundationOutput,
  s1: StatisticalFoundationOutput,
  context: MatchContext,
): Promise<SpecialistOutput> {
  const ragContext = context.similar_past_picks && context.similar_past_picks.length > 0
    ? context.similar_past_picks.slice(0, 5).map((s, i) => `${i+1}. ${s.summary} → ${s.outcome}`).join('\n')
    : 'no disponible';

  const prompt = `${buildBaseContext(df, s1)}
ODDS: ${context.odds.substring(0, 1500)}
CLV: ${df.clv_signal !== null ? df.clv_signal + '%' : '-'}
Históricos: ${ragContext}
Devuelve 3-5 picks con mayor edge%. agent_name="MARKET". probability_estimate>=70.`;

  return await callWithSchemaRetry<SpecialistOutput>(
    async () => {
      const r = await callLLM(prompt, {
        systemPrompt: MARKET_SYSTEM,
        jsonMode: true,
        temperature: 0,
        maxTokens: 5000,
        timeoutMs: 45000,
      });
      return r.text;
    },
    ['agent_name', 'thesis_supports_or_opposes', 'key_findings', 'candidate_picks'],
    'STAGE2_MARKET',
    0,
  );
}

// ─────────────────────────── PARALLEL ENTRY POINT ───────────────────────────
function emptySpecialist(name: 'TACTICAL' | 'CONTEXTUAL' | 'MARKET', errMsg: string): SpecialistOutput {
  return {
    agent_name: name,
    thesis_supports_or_opposes: 'MIXED',
    key_findings: [`${name} fallback (specialist failed): ${errMsg.slice(0, 120)}`],
    modifies_probabilities: {},
    candidate_picks: [],
    notes: `${name} produced no analysis (LLM call failed)`,
  };
}

export async function runStage2(
  df: DataFoundationOutput,
  s1: StatisticalFoundationOutput,
  context: MatchContext,
): Promise<{ tactical: SpecialistOutput; contextual: SpecialistOutput; market: SpecialistOutput }> {
  const results = await Promise.allSettled([
    runTactical(df, s1, context),
    runContextual(df, s1, context),
    runMarket(df, s1, context),
  ]);

  const tactical = results[0].status === 'fulfilled'
    ? results[0].value
    : emptySpecialist('TACTICAL', (results[0] as any).reason?.message || 'unknown');
  const contextual = results[1].status === 'fulfilled'
    ? results[1].value
    : emptySpecialist('CONTEXTUAL', (results[1] as any).reason?.message || 'unknown');
  const market = results[2].status === 'fulfilled'
    ? results[2].value
    : emptySpecialist('MARKET', (results[2] as any).reason?.message || 'unknown');

  const failed = [tactical, contextual, market].filter((s) => s.candidate_picks.length === 0 && s.key_findings[0]?.includes('fallback'));
  if (failed.length > 0) {
    console.warn(`[STAGE2] ${failed.length}/3 specialists failed: ${failed.map(s => s.agent_name).join(', ')}`);
  }
  if (failed.length === 3) {
    throw new Error('[STAGE2] All 3 specialists failed — cannot proceed');
  }

  return { tactical, contextual, market };
}
