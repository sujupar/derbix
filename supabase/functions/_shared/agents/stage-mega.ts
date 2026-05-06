// _shared/agents/stage-mega.ts
// V9-MEGA: ONE LLM call to do everything (analysis + picks + verdict).
// Trades multi-stage rigor for reliability — fits in 30-50s wall clock.
// When DeepSeek-V4-Flash is too slow for a 2-stage pipeline, this is the fallback.

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

const SYSTEM_PROMPT = `Analista de fútbol expert. UNA pasada: analiza el partido y emite picks finales.

Output JSON único sin markdown:
{"thesis":"resumen 2-3 oraciones","veredicto":"APOSTAR|OBSERVAR|NO_BET","picks":[{"market":"BTTS|Over/Under|1X2|Tarjetas|Corners|Doble Oportunidad","selection":"","probability":${OPPORTUNITIES_THRESHOLD_PERCENT}-99,"odds":1.5-3.5,"edge_percent":0-30,"confidence":"ALTA|MEDIA|BAJA","reasoning":"1-2 oraciones citando datos"}],"summary":"párrafo de cierre","overall_confidence":0-100}

Reglas: probability >=${OPPORTUNITIES_THRESHOLD_PERCENT}, odds en [1.50,3.50], 0-5 picks máx, cita números del input.`;

export interface MegaOutput {
  thesis: string;
  veredicto: 'APOSTAR' | 'OBSERVAR' | 'NO_BET';
  picks: Array<{
    market: string;
    selection: string;
    probability: number;
    odds: number;
    edge_percent: number;
    confidence: 'ALTA' | 'MEDIA' | 'BAJA';
    reasoning: string;
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
H2H: ${(context.h2h || '').substring(0, 600)}
Hist L: ${(context.homeHistory || '').substring(0, 700)}
Hist V: ${(context.awayHistory || '').substring(0, 700)}
Externo: ${(context.external_context || '').substring(0, 1000)}
Lineups: ${context.lineups?.home.formation || '?'} vs ${context.lineups?.away.formation || '?'}, lesiones=${df.injuries_impact.home_key_missing.join('/') || '-'} | ${df.injuries_impact.away_key_missing.join('/') || '-'}

Devuelve JSON único.`;

  const result = await callWithSchemaRetry<MegaOutput>(
    async () => {
      const r = await callLLM(prompt, {
        systemPrompt: SYSTEM_PROMPT,
        jsonMode: true,
        temperature: 0,
        maxTokens: 5000,
        timeoutMs: 80000,
      });
      return r.text;
    },
    ['thesis', 'veredicto', 'picks', 'summary', 'overall_confidence'],
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
      reasoning: p.reasoning,
      survived_skeptic: true,
    })),
    summary: mega.summary,
    overall_confidence: mega.overall_confidence,
    total_data_volume: df.data_volume_score,
  };

  // Mega doesn't produce specialists/skeptic separately — emit empty placeholders for shape compat
  const statistical_foundation: StatisticalFoundationOutput = {
    thesis_baseline: mega.thesis,
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
    key_anchors: [`xG diff: ${(df.xg_rolling.home_for_10 - df.xg_rolling.away_for_10).toFixed(2)}`],
    risks_flagged: [],
  };

  const emptySpecialist = (name: 'TACTICAL' | 'CONTEXTUAL' | 'MARKET'): SpecialistOutput => ({
    agent_name: name,
    thesis_supports_or_opposes: 'SUPPORTS',
    key_findings: [`${name} merged into mega-stage`],
    modifies_probabilities: {},
    candidate_picks: mega.picks.map((p) => ({
      market: p.market,
      selection: p.selection,
      rationale: p.reasoning,
      probability_estimate: p.probability,
      odds_reference: p.odds,
    })),
    notes: '',
  });

  const specialists = {
    tactical: emptySpecialist('TACTICAL'),
    contextual: emptySpecialist('CONTEXTUAL'),
    market: emptySpecialist('MARKET'),
  };

  const skeptic: SkepticOutput = {
    attacks: [],
    picks_that_survive: mega.picks.map((p) => ({
      market: p.market,
      selection: p.selection,
      why_it_holds: p.reasoning,
    })),
    global_observations: ['Mega-stage: skeptic merged'],
  };

  return { statistical_foundation, specialists, skeptic, synthesizer };
}
