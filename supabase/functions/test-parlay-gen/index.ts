import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { callLLM } from '../_shared/llm-client.ts'

serve(async (req) => {
    try {
        const sbUrl = Deno.env.get('SUPABASE_URL')!;
        const sbKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

        const supabase = createClient(sbUrl, sbKey);

        const today = '2026-01-07';

        // 1. Get analyses like ParlayBuilder does
        const { data: runs } = await supabase
            .from('analysis_runs')
            .select('*, predictions(*)')
            .gte('created_at', today + 'T00:00:00')
            .lte('created_at', today + 'T23:59:59');

        const matches = runs
            ?.filter(r => r.predictions && r.predictions.length > 0)
            .map(r => ({
                analysisText: r.summary_pre_text || '',
                dashboardData: r.report_pre_jsonb,
                analysisRun: r
            })) || [];

        if (matches.length === 0) {
            return new Response(JSON.stringify({ success: false, error: 'No matches found' }), {
                headers: { "Content-Type": "application/json" }
            });
        }

        // 2. Build prompt (simplified version)
        const matchesSummary = matches.map((m, idx) => {
            const d = m.dashboardData;
            if (!d) return null;

            const fixtureId = m.analysisRun?.fixture_id || "Unknown";
            const homeName = d.header_partido?.titulo?.split(' vs ')?.[0] || "Local";
            const awayName = d.header_partido?.titulo?.split(' vs ')?.[1] || "Visitante";

            const preds = d.predicciones_finales?.detalle?.map(p =>
                `   > ${p.mercado}: ${p.seleccion} (${p.probabilidad_estimado_porcentaje}%)`
            ).join('\\n') || "   > Sin predicciones";

            return `PARTIDO #${idx + 1} (ID: ${fixtureId}): ${homeName} vs ${awayName}\\n${preds}`;
        }).filter(Boolean).join('\\n\\n');

        // 3. Call LLM (simple test)
        const prompt = `Genera 1 parlay simple para estos partidos:\\n${matchesSummary}\\n\\nDevuelve JSON: [{ "parlayTitle": "...", "legs": [] }]`;

        const result = await callLLM(prompt, { jsonMode: true });

        return new Response(JSON.stringify({
            success: true,
            matchesFound: matches.length,
            provider: result.provider,
            llmResponse: result.text.substring(0, 500)
        }), {
            headers: { "Content-Type": "application/json" }
        });

    } catch (e: any) {
        return new Response(JSON.stringify({
            error: e.message,
            stack: e.stack
        }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
        });
    }
})
