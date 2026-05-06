// _shared/agents/stage-mega.ts
// V9-MEGA: ONE LLM call to do everything (analysis + picks + verdict + interpretation).
// The output now includes interpretive prose so the platform UI and PDFs have real
// substance — not just numbers and verdicts.

import { callLLM } from '../llm-client.ts';
import { callWithSchemaRetry } from './schema-validator.ts';
import { OPPORTUNITIES_THRESHOLD_PERCENT } from '../constants.ts';
import type {
  DataFoundationOutput,
  StatisticalFoundationOutput,
  SpecialistOutput,
  SkepticOutput,
  SynthesizerOutput,
  MatchContext,
} from './types.ts';

const SYSTEM_PROMPT = `Eres un analista de fútbol experto que escribe para apostadores que están aprendiendo. Tu misión: en UNA pasada, analiza el partido con profundidad y produce TANTO los picks como interpretación didáctica.

REGLAS DURAS:
- Output JSON único, sin markdown, sin explicación previa.
- Cita números específicos del input (xG, streaks, lesiones, días de descanso).
- "explicacion_detallada" debe ser prosa larga (4-6 párrafos) en español que un principiante entienda.
- "matchup_tactico" explica el choque de estilos en 2-3 párrafos.
- "contexto_externo" cubre clima, lesiones, fatiga, árbitro en 2-3 párrafos.
- "consejos_apostador" 3-4 bullets educativos sobre cómo pensar este tipo de partidos.
- Picks: probability >= ${OPPORTUNITIES_THRESHOLD_PERCENT}, odds [1.50-3.50], 0-5 picks máx.

ESTRUCTURA OUTPUT JSON:
{
  "thesis": "una oración sintética del partido (50-80 chars)",
  "veredicto": "APOSTAR|OBSERVAR|NO_BET",
  "explicacion_detallada": "prosa de 4-6 párrafos en español, citando números, explicando para principiante",
  "matchup_tactico": "2-3 párrafos sobre choque de estilos, formaciones, cómo se enfrentan los equipos",
  "contexto_externo": "2-3 párrafos sobre clima/lesiones/fatiga/árbitro/momento emocional",
  "factor_psicologico": "1-2 párrafos sobre presión, motivación, momento del equipo",
  "puntos_clave": ["bullet 1 con número", "bullet 2 con número", "bullet 3 con número", "bullet 4", "bullet 5"],
  "datos_destacados": ["dato concreto 1", "dato concreto 2", "dato concreto 3"],
  "riesgos_identificados": ["riesgo 1", "riesgo 2"],
  "consejos_apostador": ["consejo educativo 1", "consejo 2", "consejo 3"],
  "picks": [{"market":"BTTS|Over/Under|1X2|Tarjetas|Corners|Doble Oportunidad","selection":"","probability":${OPPORTUNITIES_THRESHOLD_PERCENT}-99,"odds":1.5-3.5,"edge_percent":0-30,"confidence":"ALTA|MEDIA|BAJA","reasoning":"2-3 oraciones citando datos específicos","por_que_este_pick":"párrafo explicativo de por qué este pick específicamente, en lenguaje de principiante"}],
  "summary": "párrafo de cierre que sintetiza todo",
  "overall_confidence": 0-100
}`;

export interface MegaOutput {
  thesis: string;
  veredicto: 'APOSTAR' | 'OBSERVAR' | 'NO_BET';
  explicacion_detallada: string;
  matchup_tactico: string;
  contexto_externo: string;
  factor_psicologico: string;
  puntos_clave: string[];
  datos_destacados: string[];
  riesgos_identificados: string[];
  consejos_apostador: string[];
  picks: Array<{
    market: string;
    selection: string;
    probability: number;
    odds: number;
    edge_percent: number;
    confidence: 'ALTA' | 'MEDIA' | 'BAJA';
    reasoning: string;
    por_que_este_pick: string;
  }>;
  summary: string;
  overall_confidence: number;
}

export async function runMegaStage(
  df: DataFoundationOutput,
  context: MatchContext,
): Promise<MegaOutput> {
  const dfCompact = {
    home: df.home_team, away: df.away_team, league: df.league, date: df.date,
    streak: { home: df.streak_home, away: df.streak_away },
    days_rest: { home: df.days_rest_home, away: df.days_rest_away },
    xg: df.xg_rolling,
    goals_avg: df.goals_avg,
    referee: df.referee_stats?.name ? `${df.referee_stats.name} (${df.referee_stats.yellows_per_match}y)` : null,
    sportmonks_pred: df.sportmonks_predictions,
    injuries: df.injuries_impact,
    competition: df.competition_context,
    clv: df.clv_signal,
  };

  const prompt = `Datos: ${JSON.stringify(dfCompact)}
Odds: ${(context.odds || '').substring(0, 1500)}
H2H: ${(context.h2h || '').substring(0, 800)}
Hist L: ${(context.homeHistory || '').substring(0, 900)}
Hist V: ${(context.awayHistory || '').substring(0, 900)}
Externo (lesiones/contexto): ${(context.external_context || '').substring(0, 1200)}
Lineups: ${context.lineups?.home.formation || '?'} vs ${context.lineups?.away.formation || '?'}, lesiones=${df.injuries_impact.home_key_missing.join('/') || '-'} | ${df.injuries_impact.away_key_missing.join('/') || '-'}

ANÁLISIS COMPLETO requerido. Escribe prosa interpretativa LARGA en explicacion_detallada (mínimo 800 caracteres). Cita los datos. Explica como si el lector estuviera aprendiendo.

Devuelve JSON único.`;

  const result = await callWithSchemaRetry<MegaOutput>(
    async () => {
      const r = await callLLM(prompt, {
        systemPrompt: SYSTEM_PROMPT,
        jsonMode: true,
        temperature: 0,
        maxTokens: 9000,
        timeoutMs: 110000,
      });
      return r.text;
    },
    ['thesis', 'veredicto', 'explicacion_detallada', 'matchup_tactico', 'puntos_clave', 'picks', 'summary', 'overall_confidence'],
    'STAGE_MEGA',
    1,
  );

  return result;
}

// Adapter: map MegaOutput to the V9 shape that the worker / persistence expect
export function megaToV9Shape(mega: MegaOutput, df: DataFoundationOutput): {
  statistical_foundation: StatisticalFoundationOutput;
  specialists: { tactical: SpecialistOutput; contextual: SpecialistOutput; market: SpecialistOutput };
  skeptic: SkepticOutput;
  synthesizer: SynthesizerOutput;
} {
  const synthesizer: SynthesizerOutput = {
    veredicto: mega.veredicto,
    picks: mega.picks.map((p) => ({
      market: p.market,
      selection: p.selection,
      probability: p.probability,
      odds: p.odds,
      edge_percent: p.edge_percent,
      confidence: p.confidence,
      reasoning: p.por_que_este_pick || p.reasoning,
      survived_skeptic: true,
    })),
    summary: mega.summary,
    overall_confidence: mega.overall_confidence,
    total_data_volume: df.data_volume_score,
  };

  const statistical_foundation: StatisticalFoundationOutput = {
    thesis_baseline: mega.explicacion_detallada || mega.thesis,
    probabilities_initial: df.sportmonks_predictions
      ? {
          home_win: df.sportmonks_predictions.home_win,
          draw: df.sportmonks_predictions.draw,
          away_win: df.sportmonks_predictions.away_win,
          over_25: df.sportmonks_predictions.over_25,
          btts: df.sportmonks_predictions.btts_yes,
          home_to_score: 65,
          away_to_score: 60,
        }
      : { home_win: 40, draw: 28, away_win: 32, over_25: 55, btts: 55, home_to_score: 65, away_to_score: 60 },
    key_anchors: mega.datos_destacados || mega.puntos_clave || [],
    risks_flagged: mega.riesgos_identificados || [],
  };

  const tacticalSpecialist: SpecialistOutput = {
    agent_name: 'TACTICAL',
    thesis_supports_or_opposes: 'SUPPORTS',
    key_findings: mega.puntos_clave || [],
    modifies_probabilities: {},
    candidate_picks: mega.picks.map((p) => ({
      market: p.market,
      selection: p.selection,
      rationale: p.reasoning,
      probability_estimate: p.probability,
      odds_reference: p.odds,
    })),
    notes: mega.matchup_tactico || '',
  };

  const contextualSpecialist: SpecialistOutput = {
    agent_name: 'CONTEXTUAL',
    thesis_supports_or_opposes: 'SUPPORTS',
    key_findings: mega.consejos_apostador || [],
    modifies_probabilities: {},
    candidate_picks: mega.picks.map((p) => ({
      market: p.market,
      selection: p.selection,
      rationale: p.reasoning,
      probability_estimate: p.probability,
      odds_reference: p.odds,
    })),
    notes: mega.contexto_externo || '',
  };

  const marketSpecialist: SpecialistOutput = {
    agent_name: 'MARKET',
    thesis_supports_or_opposes: 'SUPPORTS',
    key_findings: mega.datos_destacados || [],
    modifies_probabilities: {},
    candidate_picks: mega.picks.map((p) => ({
      market: p.market,
      selection: p.selection,
      rationale: p.reasoning,
      probability_estimate: p.probability,
      odds_reference: p.odds,
    })),
    notes: mega.factor_psicologico || '',
  };

  const specialists = {
    tactical: tacticalSpecialist,
    contextual: contextualSpecialist,
    market: marketSpecialist,
  };

  const skeptic: SkepticOutput = {
    attacks: [],
    picks_that_survive: mega.picks.map((p) => ({
      market: p.market,
      selection: p.selection,
      why_it_holds: p.por_que_este_pick || p.reasoning,
    })),
    global_observations: mega.consejos_apostador || ['MEGA stage: análisis integrado'],
  };

  return { statistical_foundation, specialists, skeptic, synthesizer };
}
