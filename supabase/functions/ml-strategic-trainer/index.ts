// supabase/functions/ml-strategic-trainer/index.ts
// ML Strategic Trainer: Genera aprendizajes cualitativos a partir de picks verificados.
// En vez de calibración numérica, usa Gemini para analizar POR QUÉ los picks ganan/pierden
// y extrae insights accionables que mejoran la LÓGICA del análisis.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from '../_shared/cors.ts'
import { callLLM } from '../_shared/llm-client.ts'

const MIN_PICKS_FOR_TRAINING = 20;
const MAX_PICKS_PER_BATCH = 100;
const GEMINI_TIMEOUT_MS = 90000; // 90s

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    const startTime = Date.now();
    console.log('[ml-strategic-trainer] Starting strategic training...');

    try {
        const sbUrl = Deno.env.get('SUPABASE_URL')!;
        const sbKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(sbUrl, sbKey);

        // 1. Count unprocessed picks in pool
        const { data: poolPicks, error: poolErr } = await supabase
            .from('ml_insight_pick_pool')
            .select('*')
            .is('processed_in_batch', null)
            .order('created_at', { ascending: true })
            .limit(MAX_PICKS_PER_BATCH);

        if (poolErr) throw new Error(`Error reading pool: ${poolErr.message}`);

        const totalPicks = poolPicks?.length || 0;
        console.log(`[ml-strategic-trainer] Found ${totalPicks} unprocessed picks in pool`);

        if (totalPicks < MIN_PICKS_FOR_TRAINING) {
            return new Response(JSON.stringify({
                success: false,
                error: `Necesitas al menos ${MIN_PICKS_FOR_TRAINING} picks verificados para entrenar. Actual: ${totalPicks}`,
                pool_count: totalPicks,
                min_required: MIN_PICKS_FOR_TRAINING,
            }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 400,
            });
        }

        // 2. Separate WON and LOST
        const wonPicks = poolPicks!.filter((p: any) => p.result === 'WON');
        const lostPicks = poolPicks!.filter((p: any) => p.result === 'LOST');
        console.log(`[ml-strategic-trainer] WON: ${wonPicks.length}, LOST: ${lostPicks.length}`);

        // 3. Build extraction prompt
        const formatPick = (p: any) => {
            let text = `- Liga: ${p.league_name || 'N/A'}, Partido: ${p.home_team || '?'} vs ${p.away_team || '?'}`;
            text += `\n  Mercado: ${p.market}, Selección: ${p.selection}`;
            text += `\n  Probabilidad: ${(p.p_model * 100).toFixed(1)}%, Cuota: ${p.odds || 'N/A'}`;
            if (p.razonamiento) {
                text += `\n  Razonamiento del analista: ${p.razonamiento.substring(0, 300)}`;
            }
            return text;
        };

        const wonText = wonPicks.map(formatPick).join('\n\n');
        const lostText = lostPicks.map(formatPick).join('\n\n');

        const extractionPrompt = `Eres un analista de control de calidad para un sistema de predicción deportiva llamado Derbix.

Te voy a dar ${totalPicks} predicciones verificadas: ${wonPicks.length} acertadas (WON) y ${lostPicks.length} falladas (LOST).
Cada predicción incluye: liga, partido, mercado, selección, probabilidad asignada, cuota, y el razonamiento original del analista.

Tu trabajo es encontrar PATRONES CUALITATIVOS que expliquen POR QUÉ algunas predicciones aciertan y otras fallan.

NO quiero:
- Ajustes numéricos de probabilidad (no digas "reducir 5% para tal liga")
- Estadísticas generales obvias (no digas "el WR es 65%")
- Observaciones triviales

SÍ quiero:
- Patrones en la LÓGICA de análisis que correlacionan con aciertos
- Errores recurrentes en el razonamiento que correlacionan con fallos
- Qué TIPO de evidencia produce mejores predicciones
- Qué COMBINACIONES de factores son más predictivas
- Insights sobre METODOLOGÍA: cómo analizar mejor, no qué número asignar

=== PREDICCIONES ACERTADAS (WON: ${wonPicks.length}) ===

${wonText || 'No hay picks ganados en este lote.'}

=== PREDICCIONES FALLADAS (LOST: ${lostPicks.length}) ===

${lostText || 'No hay picks perdidos en este lote.'}

Responde SOLO con un JSON válido (sin markdown, sin comentarios):
{
    "insights": [
        {
            "type": "winning_pattern | losing_pattern | market_insight | league_insight | methodology_insight",
            "text": "Frase concisa (máximo 200 caracteres) que el analista puede usar como guía",
            "context": "Explicación detallada (2-3 frases) de por qué este patrón importa y cómo aplicarlo",
            "confidence": 0.5
        }
    ],
    "summary": "Resumen general del rendimiento en 2-3 frases"
}

REGLAS ESTRICTAS:
- Genera entre 3 y 8 insights (no más de 8)
- Cada insight debe estar soportado por evidencia visible en los datos
- Los insights deben ser ACCIONABLES (el analista puede aplicarlos en su próximo análisis)
- Prioriza insights sobre METODOLOGÍA (cómo analizar) sobre CONTENIDO (qué analizar)
- El campo "type" debe ser EXACTAMENTE uno de: winning_pattern, losing_pattern, market_insight, league_insight, methodology_insight
- El campo "confidence" debe ser un número entre 0.3 y 0.9
- Si no hay suficientes datos para un insight confiable, no lo generes`;

        console.log(`[ml-strategic-trainer] Extraction prompt: ${extractionPrompt.length} chars`);

        // 4. Call LLM (multi-provider with automatic fallback)
        let geminiResponse: any = null;
        let modelUsed = '';

        try {
            console.log(`[ml-strategic-trainer] Calling LLM...`);
            const llmResult = await callLLM(extractionPrompt, {
                temperature: 0.4,
                jsonMode: true,
                maxTokens: 4096,
                timeoutMs: GEMINI_TIMEOUT_MS,
            });

            geminiResponse = JSON.parse(llmResult.text);
            modelUsed = `${llmResult.provider}/${llmResult.model}`;
            console.log(`[ml-strategic-trainer] ${modelUsed} returned ${geminiResponse.insights?.length || 0} insights`);
        } catch (err) {
            console.error(`[ml-strategic-trainer] LLM call failed:`, err);
        }

        if (!geminiResponse || !geminiResponse.insights || geminiResponse.insights.length === 0) {
            return new Response(JSON.stringify({
                success: false,
                error: 'Gemini no pudo generar insights. Intenta de nuevo más tarde.',
            }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 500,
            });
        }

        // 5. Get next batch number
        const { data: lastBatch } = await supabase
            .from('ml_training_batches')
            .select('batch_number')
            .order('batch_number', { ascending: false })
            .limit(1);

        const nextBatchNumber = (lastBatch?.[0]?.batch_number || 0) + 1;

        // 6. Create batch record
        const pickIds = poolPicks!.map((p: any) => p.pick_id);
        const { data: batchData, error: batchErr } = await supabase
            .from('ml_training_batches')
            .insert({
                batch_number: nextBatchNumber,
                picks_analyzed: totalPicks,
                picks_won: wonPicks.length,
                picks_lost: lostPicks.length,
                pick_ids: pickIds,
                gemini_raw_response: geminiResponse,
                insights_generated: geminiResponse.insights.length,
                status: 'completed',
            })
            .select('id')
            .single();

        if (batchErr) throw new Error(`Error creating batch: ${batchErr.message}`);
        const batchId = batchData.id;
        console.log(`[ml-strategic-trainer] Created batch #${nextBatchNumber} (${batchId})`);

        // 7. Insert insights
        const validTypes = ['winning_pattern', 'losing_pattern', 'market_insight', 'league_insight', 'methodology_insight'];
        const insightsToInsert = geminiResponse.insights
            .filter((i: any) => i.text && validTypes.includes(i.type))
            .map((i: any) => ({
                batch_id: batchId,
                insight_type: i.type,
                insight_text: i.text.substring(0, 300),
                insight_context: i.context?.substring(0, 500) || null,
                based_on_picks: totalPicks,
                based_on_won: wonPicks.length,
                based_on_lost: lostPicks.length,
                confidence_score: Math.max(0.3, Math.min(0.9, i.confidence || 0.5)),
                active: true,
            }));

        if (insightsToInsert.length > 0) {
            const { error: insErr } = await supabase
                .from('ml_strategic_insights')
                .insert(insightsToInsert);
            if (insErr) console.error(`[ml-strategic-trainer] Error inserting insights:`, insErr);
        }

        // 8. Mark picks as processed
        const { error: markErr } = await supabase
            .from('ml_insight_pick_pool')
            .update({ processed_in_batch: batchId })
            .in('pick_id', pickIds);

        if (markErr) console.error(`[ml-strategic-trainer] Error marking picks:`, markErr);

        const elapsed = Date.now() - startTime;
        console.log(`[ml-strategic-trainer] Done in ${elapsed}ms. Batch #${nextBatchNumber}: ${insightsToInsert.length} insights from ${totalPicks} picks`);

        return new Response(JSON.stringify({
            success: true,
            batch_number: nextBatchNumber,
            batch_id: batchId,
            picks_analyzed: totalPicks,
            picks_won: wonPicks.length,
            picks_lost: lostPicks.length,
            insights_generated: insightsToInsert.length,
            insights: insightsToInsert.map((i: any) => ({ type: i.insight_type, text: i.insight_text })),
            summary: geminiResponse.summary || '',
            model_used: modelUsed,
            elapsed_ms: elapsed,
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });

    } catch (err) {
        console.error('[ml-strategic-trainer] Fatal error:', err);
        return new Response(JSON.stringify({
            success: false,
            error: err instanceof Error ? err.message : String(err),
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500,
        });
    }
});
