// _shared/agents/stage4-synthesizer.ts

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
  // Compact representation: only fields needed for final synthesis
  const dfCompact = {
    home: df.home_team, away: df.away_team, league: df.league, date: df.date,
    streak: { home: df.streak_home, away: df.streak_away },
    xg: df.xg_rolling, injuries: df.injuries_impact,
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

CANDIDATE PICKS DE ESPECIALISTAS: ${JSON.stringify(allCandidatePicks)}

SKEPTIC ATTACKS: ${JSON.stringify(s3.attacks)}
SKEPTIC SOBREVIVIENTES: ${JSON.stringify(s3.picks_that_survive)}

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
        maxTokens: 3000,
        timeoutMs: 40000,
      });
      return r.text;
    },
    ['veredicto', 'picks', 'summary', 'overall_confidence', 'total_data_volume'],
    'STAGE4_SYNTHESIZER',
    2,
  );
}
