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

BASELINE MATEMÁTICO — ANCLA OBLIGATORIA:
- En el input verás un bloque "MODELOS MATEMÁTICOS" con probabilidades calculadas por Dixon-Coles, Elo y Monte Carlo (10.000 simulaciones) para los mercados principales (1X2, doble oportunidad, goles, BTTS, goles por equipo).
- Estas probabilidades son tu ANCLA. Tu probability para un mercado cubierto NO debe alejarse del modelo sin una razón concreta citada (lesión de titular, alineación confirmada, clima, contexto Perplexity).
- Si tu juicio difiere del modelo en más de 15 puntos, EXPLICA por qué en el "reasoning". Si no tienes una razón sólida, acércate al modelo.
- Para córners, tarjetas, hándicap asiático y mitades NO hay modelo matemático: sé más conservador y usa confidence MEDIA o BAJA.

DIVERSIDAD DE MERCADOS — CRÍTICO:
- DEBES considerar EXPLÍCITAMENTE estas 7 categorías de mercado y emitir picks de las que tengan valor:
  1. RESULTADO (1X2): Local / Empate / Visitante
  2. DOBLE OPORTUNIDAD: Local o Empate / Empate o Visitante / Local o Visitante
  3. GOLES (Over/Under): Más / Menos de X.5 goles
  4. AMBOS ANOTAN (BTTS): Sí / No
  5. CÓRNERS: Más / Menos de X.5 córneres
  6. TARJETAS: Más / Menos de X.5 tarjetas
  7. HÁNDICAP: Asian -1.5 / +0.5 / etc.
- En la sección "ODDS" del input verás el catálogo real con las cuotas de bookmakers para CADA categoría.
- Si una categoría tiene cuotas listadas en el catálogo y tu modelo le da prob >= ${OPPORTUNITIES_THRESHOLD_PERCENT}%, EMITE el pick. NO te limites a Over/Under.
- Idealmente tu output tiene picks de 2-3 categorías DIFERENTES (no todos goles).
- Si solo encuentras valor en una sola categoría, está bien — pero verifica que evaluaste las 7.

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
  "evaluacion_mercados": ["1X2: razón breve por la que descarté/incluí", "Doble Op: ...", "Goles: ...", "BTTS: ...", "Córners: ...", "Tarjetas: ...", "Hándicap: ..."],
  "picks": [{"market":"Resultado 1X2|Doble Oportunidad|Más/Menos Goles|BTTS|Córners|Tarjetas|Hándicap","selection":"texto en español","probability":${OPPORTUNITIES_THRESHOLD_PERCENT}-99,"odds":1.5-3.5,"edge_percent":0-30,"confidence":"ALTA|MEDIA|BAJA","reasoning":"2-3 oraciones citando datos específicos","por_que_este_pick":"párrafo explicativo de por qué este pick específicamente, en lenguaje de principiante"}],
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
  evaluacion_mercados?: string[];
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

// 2026-05-15 FIX: surrogate-safe truncation. Plain `.substring(N)` operates
// on UTF-16 code units and can split surrogate pairs (emojis, some CJK chars),
// producing strings that JSON.stringify serializes with an orphan `\uD8XX`
// escape. DeepSeek (and other strict parsers) then fail to parse the body
// with "unexpected end of hex escape at line 1 column XXXX". Affected
// fixtures so far: Wuhan vs Liaoning, Union Berlin vs Augsburg, Viking vs
// Start — descriptions had emoji or surrogate-pair characters that fell at
// the substring boundary.
function safeTruncate(s: string, maxChars: number): string {
  if (!s || s.length <= maxChars) return s || '';
  // Iterate by code points (Array.from respects surrogate pairs as ONE element)
  const codePoints = Array.from(s);
  return codePoints.slice(0, maxChars).join('');
}

export async function runMegaStage(
  df: DataFoundationOutput,
  context: MatchContext,
  organizedOdds?: any, // Optional: full bookmaker catalog from organizeOddsForAI()
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

  // Build a STRUCTURED catalog of available markets from the organized odds.
  // This is the most important input for diversity: the model needs to SEE that
  // there are corners, cards, handicaps, halves available with real bookmaker odds,
  // not just goals.
  let oddsCatalog = '';
  if (organizedOdds && typeof organizedOdds === 'object') {
    const formatCat = (cat: string, items: any[]): string => {
      if (!items || items.length === 0) return '';
      const sample = items.slice(0, 12).map((it) => `${it.lbl} @ ${it.val}`).join(' | ');
      const more = items.length > 12 ? ` (+${items.length - 12} más)` : '';
      return `  ${cat}: ${sample}${more}`;
    };
    const catalogLines = [
      formatCat('RESULTADO 1X2 + DOBLE OPORTUNIDAD', organizedOdds.MAIN || []),
      formatCat('GOLES (Over/Under, BTTS)', organizedOdds.GOALS || []),
      formatCat('GOLES POR EQUIPO + HANDICAPS', organizedOdds.TEAMS || []),
      formatCat('CÓRNERS', organizedOdds.CORNERS || []),
      formatCat('MITADES (1er/2do tiempo)', organizedOdds.HALVES || []),
      formatCat('COMBINADOS', organizedOdds.COMBOS || []),
      formatCat('OTROS (incluye tarjetas)', (organizedOdds.OTHERS || []).slice(0, 30)),
    ].filter(Boolean).join('\n');
    oddsCatalog = catalogLines || safeTruncate(context.odds || '', 2500);
  } else {
    oddsCatalog = safeTruncate(context.odds || '', 2500);
  }

  // Build the MATHEMATICAL BASELINE block from the models the pipeline already
  // computed (Dixon-Coles + Elo + Monte Carlo). Before V10 this was discarded;
  // now it anchors the LLM's probabilities so picks are statistically grounded.
  let mathBlock = 'No disponible (se usará solo el juicio del analista).';
  const math = context.math;
  if (math?.monte_carlo?.market_probabilities) {
    const mc = math.monte_carlo.market_probabilities;
    const ens = math.ensemble_probabilities;
    const pct = (x: number | undefined | null) => (x == null ? '—' : `${Math.round(x * 100)}%`);
    const dcTop = math.dixon_coles?.probabilities?.most_likely_scorelines?.slice(0, 3)
      .map((s) => `${s.score} (${pct(s.probability)})`).join(', ') || '—';
    const diag = math.diagnostics;
    mathBlock = [
      `1X2 (ensemble): Local ${pct(ens?.home_win)} | Empate ${pct(ens?.draw)} | Visitante ${pct(ens?.away_win)}`,
      `Doble oportunidad: 1X ${pct(mc.home_or_draw)} | X2 ${pct(mc.away_or_draw)} | 12 ${pct(mc.home_or_away)}`,
      `Goles (over): +0.5 ${pct(mc.over_05)} | +1.5 ${pct(mc.over_15)} | +2.5 ${pct(ens?.over_25 ?? mc.over_25)} | +3.5 ${pct(mc.over_35)}`,
      `BTTS: Sí ${pct(ens?.btts_yes ?? mc.btts_yes)} | No ${pct(mc.btts_no)}`,
      `Goles equipo — Local: +0.5 ${pct(mc.home_over_05)} +1.5 ${pct(mc.home_over_15)} | Visitante: +0.5 ${pct(mc.away_over_05)} +1.5 ${pct(mc.away_over_15)}`,
      `λ esperados: Local ${math.dixon_coles?.lambdaHome ?? '?'} / Visitante ${math.dixon_coles?.lambdaAway ?? '?'} (total ${math.dixon_coles?.expected_total_goals ?? '?'} goles)`,
      `Marcadores más probables (Dixon-Coles): ${dcTop}`,
      `Elo: ${math.elo?.homeElo ?? '?'} vs ${math.elo?.awayElo ?? '?'} | Confianza modelo: ${diag?.elo_confidence ?? '?'} | Consistencia entre modelos: ${diag?.model_consistency ?? '?'} | Muestra: ${diag?.home_sample_size ?? 0}/${diag?.away_sample_size ?? 0} partidos`,
    ].join('\n');
  }

  const prompt = `Datos del partido: ${JSON.stringify(dfCompact)}

MODELOS MATEMÁTICOS (ancla obligatoria — Dixon-Coles + Elo + Monte Carlo 10k sims):
${mathBlock}

CATÁLOGO DE CUOTAS REALES (Bet365/Pinnacle):
${oddsCatalog}

H2H: ${safeTruncate(context.h2h || '', 800)}
Hist L: ${safeTruncate(context.homeHistory || '', 900)}
Hist V: ${safeTruncate(context.awayHistory || '', 900)}
Externo (lesiones/contexto): ${safeTruncate(context.external_context || '', 1200)}
Lineups: ${context.lineups?.home.formation || '?'} vs ${context.lineups?.away.formation || '?'}, lesiones=${df.injuries_impact.home_key_missing.join('/') || '-'} | ${df.injuries_impact.away_key_missing.join('/') || '-'}

INSTRUCCIONES:
1. Considera CADA categoría del catálogo arriba (Resultado, Doble Op, Goles, BTTS, Córners, Tarjetas/Otros, Combinados).
2. Para cada categoría, evalúa si tu modelo identifica probabilidad >= ${OPPORTUNITIES_THRESHOLD_PERCENT}% en alguna selección. Si la cuota real está en el catálogo, calcula el edge.
3. En "evaluacion_mercados" reporta brevemente por qué descartaste o incluiste cada una de las 7 categorías.
4. NO te limites a Over/Under de goles. Si encuentras valor en córners, tarjetas, doble oportunidad o handicaps, EMÍTELO.
5. Escribe explicacion_detallada con prosa interpretativa larga (mínimo 800 caracteres) en español, didáctica.
6. Para cada pick de un mercado cubierto por MODELOS MATEMÁTICOS, tu "probability" debe estar anclada a ese baseline. Si te alejas >15 puntos, justifica la razón concreta en "reasoning". Sin razón sólida, acércate al modelo.

Devuelve JSON único.`;

  const result = await callWithSchemaRetry<MegaOutput>(
    async () => {
      const r = await callLLM(prompt, {
        systemPrompt: SYSTEM_PROMPT,
        jsonMode: true,
        temperature: 0,
        maxTokens: 9000,
        // 110s — v4-flash typically completes in ~47s. 110s gives 3x headroom
        // and leaves 35s of the 145s pipeline budget for post-processing.
        timeoutMs: 110000,
        stage: 'mega',
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
