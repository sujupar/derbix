// _shared/agents/stage3-skeptic.ts
// COMBINED Stage 3+4: Skeptic + Synthesizer in a SINGLE LLM call.
// Done together because 4 sequential DeepSeek calls don't fit in the 130s pipeline budget.
// The combined prompt asks the LLM to (a) attack candidate picks, then (b) emit final picks.

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

const SYSTEM_PROMPT = `Eres el árbitro final + abogado del diablo combinado. Realizas DOS tareas en una sola pasada:

PASO A — SKEPTIC (atacar):
Para cada candidate_pick de los 3 especialistas, formula un argumento de ataque y decide:
- DESCARTAR: el pick no aguanta crítica
- DEBILITAR_CONFIANZA: tiene mérito pero con riesgos importantes
- MANTENER: pick robusto

PASO B — SYNTHESIZER (sintetizar):
De los picks que sobrevivieron (MANTENER + DEBILITAR_CONFIANZA), produce el veredicto final.

REGLAS DURAS:
1. Devuelve EXCLUSIVAMENTE JSON válido (sin markdown, sin explicación previa).
2. SOLO incluyes en final picks aquellos con probability >= ${OPPORTUNITIES_THRESHOLD_PERCENT} y respaldados por al menos 1 especialista.
3. Skeptic.attacks debe contener TODOS los picks evaluados (los 3 veredictos posibles).
4. Final picks: confidence ALTA si MANTENER, MEDIA o BAJA si DEBILITAR_CONFIANZA.

ESTRUCTURA OUTPUT:
{
  "skeptic": {
    "attacks": [{"target_pick_market": "...", "target_pick_selection": "...", "attack_argument": "...", "verdict": "DESCARTAR|DEBILITAR_CONFIANZA|MANTENER"}],
    "picks_that_survive": [{"market": "...", "selection": "...", "why_it_holds": "..."}],
    "global_observations": ["..."]
  },
  "synthesizer": {
    "veredicto": "APOSTAR" | "OBSERVAR" | "NO_BET",
    "picks": [{"market": "...", "selection": "...", "probability": 80-99, "odds": 1.50-3.50, "edge_percent": number, "confidence": "ALTA"|"MEDIA"|"BAJA", "reasoning": "...", "survived_skeptic": true}],
    "summary": "1-2 párrafos del veredicto",
    "overall_confidence": 0-100,
    "total_data_volume": number
  }
}`;

export interface CombinedSkepticSynthesizerOutput {
  skeptic: SkepticOutput;
  synthesizer: SynthesizerOutput;
}

export async function runStage3and4(
  df: DataFoundationOutput,
  s1: StatisticalFoundationOutput,
  s2: { tactical: SpecialistOutput; contextual: SpecialistOutput; market: SpecialistOutput },
): Promise<CombinedSkepticSynthesizerOutput> {
  const dfCompact = {
    home: df.home_team, away: df.away_team, league: df.league, date: df.date,
    streak: { home: df.streak_home, away: df.streak_away },
    xg: df.xg_rolling, injuries: df.injuries_impact,
    referee: df.referee_stats?.name, clv: df.clv_signal,
    sportmonks_pred: df.sportmonks_predictions,
    data_volume_score: df.data_volume_score,
  };
  const allCandidatePicks = [
    ...s2.tactical.candidate_picks.map((p) => ({...p, from: 'TACTICAL'})),
    ...s2.contextual.candidate_picks.map((p) => ({...p, from: 'CONTEXTUAL'})),
    ...s2.market.candidate_picks.map((p) => ({...p, from: 'MARKET'})),
  ];

  const prompt = `DATOS BASE: ${JSON.stringify(dfCompact)}

TESIS BASELINE: ${JSON.stringify(s1)}

CANDIDATE PICKS DE 3 ESPECIALISTAS (${allCandidatePicks.length} totales):
${JSON.stringify(allCandidatePicks)}

DATA_VOLUME_SCORE (úsalo en synthesizer.total_data_volume): ${df.data_volume_score}

TAREA:
1. Skeptic: ataca cada candidate pick, decide veredicto, lista los que sobreviven.
2. Synthesizer: emite picks finales (solo los sobrevivientes con prob >= ${OPPORTUNITIES_THRESHOLD_PERCENT}, en odds [1.50, 3.50]).
3. Devuelve JSON único con la estructura del system prompt.`;

  const result = await callWithSchemaRetry<CombinedSkepticSynthesizerOutput>(
    async () => {
      const r = await callLLM(prompt, {
        systemPrompt: SYSTEM_PROMPT,
        jsonMode: true,
        temperature: 0,
        maxTokens: 6500,
        timeoutMs: 70000,
      });
      return r.text;
    },
    ['skeptic', 'synthesizer'],
    'STAGE3_COMBINED',
    0,
  );

  return result;
}

// Backwards compat: keep runStage3 as a thin wrapper that returns just the skeptic part.
// Used by orchestrator until orchestrator is migrated to runStage3and4.
export async function runStage3(
  df: DataFoundationOutput,
  s1: StatisticalFoundationOutput,
  s2: { tactical: SpecialistOutput; contextual: SpecialistOutput; market: SpecialistOutput },
): Promise<SkepticOutput> {
  const combined = await runStage3and4(df, s1, s2);
  // Stash the synthesizer output on the skeptic object for orchestrator to pick up
  (combined.skeptic as any).__synthesizer = combined.synthesizer;
  return combined.skeptic;
}
