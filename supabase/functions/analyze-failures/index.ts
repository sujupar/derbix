import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from '../_shared/cors.ts'
import { callLLM } from '../_shared/llm-client.ts'

/**
 * EDGE FUNCTION: analyze-failures
 * 
 * Propósito: Analizar automáticamente predicciones fallidas
 *            para generar "lecciones aprendidas" que mejoren
 *            futuras predicciones.
 * 
 * Flujo:
 * 1. Buscar predicciones fallidas sin análisis post-mortem
 * 2. Obtener el contexto/evidencia utilizada en la predicción
 * 3. Usar Gemini para analizar POR QUÉ falló
 * 4. Almacenar la lección en learned_lessons
 */

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        console.log('[POST-MORTEM] Starting failure analysis...');

        // Setup
        const sbUrl = Deno.env.get('SUPABASE_URL')!;
        const sbKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

        const supabase = createClient(sbUrl, sbKey);

        // 1. BUSCAR PREDICCIONES FALLIDAS SIN POST-MORTEM
        // Primero obtener los IDs que ya tienen lecciones
        const { data: existingLessons } = await supabase
            .from('learned_lessons')
            .select('prediction_result_id');

        const existingIds = (existingLessons || []).map(l => l.prediction_result_id).filter(Boolean);

        // Luego buscar las fallidas que no tienen lección
        let query = supabase
            .from('predictions_results')
            .select('id, prediction_id, predicted_market, predicted_outcome, predicted_probability, actual_outcome, actual_score, confidence_delta')
            .eq('was_correct', false)
            .limit(10);

        if (existingIds.length > 0) {
            query = query.not('id', 'in', `(${existingIds.join(',')})`);
        }

        const { data: failedPredictions, error: fetchError } = await query;

        if (fetchError) throw fetchError;

        console.log(`[POST-MORTEM] Found ${failedPredictions?.length || 0} failures to analyze`);

        let analyzed = 0;
        let errors = 0;

        for (const failure of failedPredictions || []) {
            try {
                // 2. PREPARAR CONTEXTO PARA ANÁLISIS (usando solo datos de predictions_results)
                const analysisContext = {
                    prediction: {
                        market: failure.predicted_market,
                        selection: failure.predicted_outcome,
                        probability: failure.predicted_probability
                    },
                    result: {
                        actual: failure.actual_outcome,
                        score: failure.actual_score
                    }
                };

                // 3. LLAMAR A GEMINI PARA ANÁLISIS POST-MORTEM
                const postMortemPrompt = `
Eres un analista de control de calidad para predicciones deportivas.
Una predicción ha FALLADO. Tu trabajo es analizar POR QUÉ pudo haber fallado para prevenir errores similares.

PREDICCIÓN FALLIDA:
- Mercado: ${analysisContext.prediction.market}
- Selección: ${analysisContext.prediction.selection}
- Probabilidad estimada: ${analysisContext.prediction.probability}%

RESULTADO REAL:
- Lo que pasó: ${analysisContext.result.actual}
- Marcador: ${analysisContext.result.score}

PREGUNTA CLAVE: ¿Por qué pudo haber fallado esta predicción? Analiza posibles causas.

Responde SOLO en formato JSON:
{
  "failure_category": "TACTICAL" | "STATISTICAL" | "CONTEXTUAL" | "OVERCONFIDENCE" | "UNEXPECTED_EVENT",
  "overvalued_factors": ["factor1", "factor2"],
  "missing_context": ["context1", "context2"],
  "ideal_confidence": <número 0-100>,
  "lesson": "Descripción clara de qué aprendimos y cómo evitar este error"
}
`;

                let aiText: string;
                try {
                    const llmResult = await callLLM(postMortemPrompt, {
                        temperature: 0.3,
                        jsonMode: true,
                        timeoutMs: 30000,
                    });
                    aiText = llmResult.text || '{}';
                    console.log(`[POST-MORTEM] ${llmResult.provider} responded for ${failure.id}`);
                } catch (llmErr: any) {
                    console.error(`[POST-MORTEM] LLM error for ${failure.id}: ${llmErr.message}`);
                    errors++;
                    continue;
                }

                let analysis;
                try {
                    analysis = JSON.parse(aiText.replace(/```json/g, '').replace(/```/g, '').trim());
                } catch {
                    console.error(`[POST-MORTEM] Failed to parse AI response for ${failure.id}`);
                    errors++;
                    continue;
                }

                // 4. GUARDAR LECCIÓN APRENDIDA
                const { error: insertError } = await supabase
                    .from('learned_lessons')
                    .insert({
                        prediction_result_id: failure.id,
                        failure_category: analysis.failure_category || 'UNKNOWN',
                        overvalued_factors: analysis.overvalued_factors || [],
                        missing_context: analysis.missing_context || [],
                        ideal_confidence: analysis.ideal_confidence,
                        lesson_text: analysis.lesson || 'No lesson generated'
                    });

                if (insertError) {
                    console.error(`[POST-MORTEM] Error saving lesson for ${failure.id}:`, insertError);
                    errors++;
                    continue;
                }

                analyzed++;
                console.log(`[POST-MORTEM] ✓ Analyzed failure ${failure.id}: ${analysis.failure_category}`);

            } catch (err: any) {
                console.error(`[POST-MORTEM] Error processing ${failure.id}:`, err.message);
                errors++;
            }
        }

        console.log(`[POST-MORTEM] Completed: ${analyzed} analyzed, ${errors} errors`);

        return new Response(
            JSON.stringify({
                success: true,
                analyzed,
                errors,
                timestamp: new Date().toISOString()
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (err: any) {
        console.error('[POST-MORTEM] Fatal error:', err);
        return new Response(
            JSON.stringify({ error: err.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
