// supabase/functions/ml-index-picks/index.ts
// V9 RAG: Indexes approved verified picks into pgvector for similarity retrieval.
// Triggered from admin UI or manually via curl.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from '../_shared/cors.ts'

const EMBEDDING_MODEL = 'models/text-embedding-004';

async function generateEmbedding(text: string, apiKey: string): Promise<number[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/${EMBEDDING_MODEL}:embedContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBEDDING_MODEL, content: { parts: [{ text }] } }),
  });
  if (!res.ok) throw new Error(`Embedding error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.embedding.values;
}

function buildPickText(pick: any, report: any): string {
  const rp = report?.report_packet || {};
  const teams = rp.meta?.teams || {};
  return `
Match: ${rp.resumen_ejecutivo?.titular || 'N/A'}
Market: ${pick.market} | Selection: ${pick.selection}
Predicted: ${pick.p_model} | Odds: ${pick.odds}
League: ${rp.meta?.league || 'unknown'}
Score A (stats): ${rp.scores_duales?.score_estadistico || 0}
Score B (context): ${rp.scores_duales?.score_inteligencia_partido || 0}
Reasoning: ${(rp.analisis_profundo?.razonamiento_central || '').substring(0, 500)}
`.trim();
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const sbUrl = Deno.env.get('SUPABASE_URL')!;
    const sbKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const geminiKey = Deno.env.get('GEMINI_API_KEY')!;
    const supabase = createClient(sbUrl, sbKey);

    const body = await req.json().catch(() => ({}));
    const limit = Math.min(body.limit || 50, 100);

    // Find approved picks that are NOT yet indexed
    const { data: toIndex, error } = await supabase
      .from('ml_verified_picks')
      .select('id, pick_id, admin_verdict, system_verdict')
      .eq('approved_for_learning', true)
      .limit(limit);

    if (error) throw error;
    if (!toIndex || toIndex.length === 0) {
      return new Response(JSON.stringify({ success: true, indexed: 0, message: 'No picks to index' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    let indexed = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const v of toIndex) {
      try {
        // Check if already indexed
        const { data: existing } = await supabase
          .from('ml_pick_embeddings')
          .select('id')
          .eq('verified_pick_id', v.id)
          .maybeSingle();
        if (existing) { skipped++; continue; }

        // Fetch full pick + report
        const { data: pick } = await supabase
          .from('value_picks_v2')
          .select('*, analysis_jobs_v2!inner(id)')
          .eq('id', v.pick_id)
          .single();
        if (!pick) continue;

        const { data: report } = await supabase
          .from('reports_v2')
          .select('report_packet')
          .eq('job_id', pick.analysis_jobs_v2.id)
          .maybeSingle();

        const text = buildPickText(pick, report);
        const embedding = await generateEmbedding(text, geminiKey);

        // Determine probability band
        const prob = Number(pick.p_model || 0);
        const probBand =
          prob >= 0.90 ? '90+' :
          prob >= 0.85 ? '85-90' :
          prob >= 0.80 ? '80-85' :
          prob >= 0.75 ? '75-80' :
          prob >= 0.70 ? '70-75' : '65-70';

        const outcome = v.admin_verdict || v.system_verdict || 'PENDING';

        const { error: insertErr } = await supabase
          .from('ml_pick_embeddings')
          .insert({
            pick_id: pick.id,
            verified_pick_id: v.id,
            embedding,
            features: {
              market: pick.market,
              selection: pick.selection,
              probability: prob,
              odds: pick.odds,
              score_estadistico: report?.report_packet?.scores_duales?.score_estadistico,
              score_inteligencia: report?.report_packet?.scores_duales?.score_inteligencia_partido,
            },
            outcome,
            league: report?.report_packet?.meta?.league || null,
            market: pick.market,
            probability_band: probBand,
          });

        if (insertErr) throw insertErr;
        indexed++;
      } catch (e: any) {
        errors.push(`${v.id}: ${e.message}`);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      indexed,
      skipped,
      errors: errors.slice(0, 10),
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err: any) {
    console.error('[ml-index-picks] Error:', err);
    return new Response(JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
