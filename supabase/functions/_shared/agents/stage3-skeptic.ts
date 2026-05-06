// _shared/agents/stage3-skeptic.ts

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
