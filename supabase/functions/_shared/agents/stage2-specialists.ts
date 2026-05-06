// _shared/agents/stage2-specialists.ts

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
  "modifies_probabilities": { "home_win": +/-N, "btts": +/-N },
  "candidate_picks": [
    { "market": "string", "selection": "string", "rationale": "string", "probability_estimate": 0-100, "odds_reference": number | null }
  ],
  "notes": "comentario libre"
}
NO uses markdown. NO escribas explicación previa.`;

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
1. Para cada selección con probabilidad >=80% del modelo (Stage 1), calcula edge = (prob_modelo - prob_implícita_cuota) / prob_implícita_cuota * 100
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
