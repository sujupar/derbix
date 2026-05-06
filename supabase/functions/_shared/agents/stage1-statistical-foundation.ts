// _shared/agents/stage1-statistical-foundation.ts

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
  "key_anchors": ["bullet 1 con número", "bullet 2 con número"],
  "risks_flagged": ["riesgo 1", "riesgo 2"]
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
        maxTokens: 2000,
        timeoutMs: 35000,
      });
      return response.text;
    },
    ['thesis_baseline', 'probabilities_initial', 'key_anchors', 'risks_flagged'],
    'STAGE1',
    1,
  );

  return result;
}
