// supabase/functions/v9-pipeline-worker/index.ts
// Background worker that runs the V9-HYBRID pipeline for one job.
// Invoked fire-and-forget by v3-ai-analyzer. Has its own 150s wall clock budget,
// independent of the dispatcher's HTTP request lifetime.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { runPipeline, type ETLRawData } from "../_shared/agents/orchestrator.ts";
import type { MatchContext } from "../_shared/agents/types.ts";

const ENGINE_VERSION = 'V9-HYBRID-2026-05-05';
const PIPELINE_TIMEOUT_MS = 145000; // 145s safety cap. Worker has ~150s wall clock total.

interface RequestBody {
  job_id: string;
  fixture_id: number;
  match_context: MatchContext;
  raw_etl: ETLRawData;
  match_date: string;
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`[${label}] safety timeout after ${ms}ms`)), ms),
    ),
  ]);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400, headers: corsHeaders });
  }

  const { job_id, fixture_id, match_context, raw_etl, match_date } = body;
  if (!job_id || !fixture_id || !match_context || !raw_etl) {
    return new Response(JSON.stringify({ error: 'missing fields' }), { status: 400, headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Fire-and-forget pattern: respond 200 immediately, run pipeline in background within this worker.
  // The worker has its OWN wall clock (~150s), so the pipeline (~120s) fits.
  const work = (async () => {
    const t0 = Date.now();
    try {
      console.log(`[V9-WORKER] Job ${job_id} fixture ${fixture_id} starting`);

      const pipelineResult = await withTimeout(
        runPipeline(match_context, raw_etl),
        PIPELINE_TIMEOUT_MS,
        'PIPELINE',
      );

      const elapsed = Date.now() - t0;
      console.log(`[V9-WORKER] Pipeline complete in ${elapsed}ms — ${pipelineResult.validated_picks.length} validated picks, verdict=${pipelineResult.synthesizer.veredicto}`);

      const reportPacket = {
        pipeline_version: pipelineResult.pipeline_version,
        engine_version: ENGINE_VERSION,
        data_foundation: pipelineResult.data_foundation,
        statistical_foundation: pipelineResult.statistical_foundation,
        specialists: pipelineResult.specialists,
        skeptic: pipelineResult.skeptic,
        synthesizer: pipelineResult.synthesizer,
        validated_picks: pipelineResult.validated_picks,
        timings: pipelineResult.timings,
        meta: { engine: 'V9-HYBRID', verdict: pipelineResult.synthesizer.veredicto },
      };

      console.log(`[V9-WORKER] Persisting reports_v2 for fixture=${fixture_id}`);
      // Delete previous V9 reports for this fixture (no unique constraint exists)
      await supabase.from('reports_v2').delete().eq('fixture_id', fixture_id).eq('engine_version', ENGINE_VERSION);
      const { error: repErr, data: repData } = await supabase
        .from('reports_v2')
        .insert({
          fixture_id: fixture_id,
          job_id: job_id,
          engine_version: ENGINE_VERSION,
          prompt_version: ENGINE_VERSION,
          report_packet: reportPacket,
        })
        .select('id, fixture_id');
      if (repErr) {
        console.error(`[V9-WORKER] reports_v2 insert error: ${repErr.message}, code=${repErr.code}, details=${repErr.details}, hint=${repErr.hint}`);
      } else {
        console.log(`[V9-WORKER] reports_v2 insert OK: ${JSON.stringify(repData)}`);
      }

      if (pipelineResult.validated_picks.length > 0) {
        const today = match_date || new Date().toISOString().slice(0, 10);
        const valuePicksRows = pipelineResult.validated_picks.map((p, idx) => ({
          fixture_id: fixture_id,
          job_id: job_id,
          market: p.market,
          selection: p.selection,
          p_model: p.probability / 100,
          p_implied: 1 / Math.max(p.odds, 1.01),
          odds: p.odds,
          edge: p.edge_percent / 100,
          confidence: p.confidence,
          decision: 'BET',
          engine_version: ENGINE_VERSION,
          risk_notes: p.reasoning,
          is_opportunity: p.probability >= 80,
          opportunity_date: today,
          opportunity_rank: idx + 1,
          is_primary_pick: idx === 0,
          rank: idx + 1,
        }));
        await supabase
          .from('value_picks_v2')
          .delete()
          .eq('fixture_id', fixture_id)
          .eq('engine_version', ENGINE_VERSION);
        const { error: vpErr, data: vpData } = await supabase.from('value_picks_v2').insert(valuePicksRows).select('id');
        if (vpErr) console.error(`[V9-WORKER] value_picks_v2 insert error: ${vpErr.message}, details=${vpErr.details}`);
        else console.log(`[V9-WORKER] value_picks_v2 inserted ${vpData?.length || 0} rows`);
      }

      await supabase
        .from('analysis_jobs_v2')
        .update({
          status: 'done',
          updated_at: new Date().toISOString(),
          error_message: `V9 ok: ${pipelineResult.validated_picks.length} picks, ${pipelineResult.timings.total_ms}ms`,
        })
        .eq('id', job_id);

      console.log(`[V9-WORKER] ✓ Done in ${Date.now() - t0}ms total (job ${job_id})`);
    } catch (err) {
      const msg = (err as Error)?.message || String(err);
      console.error(`[V9-WORKER] ✗ Failed for job ${job_id} after ${Date.now() - t0}ms: ${msg}`);
      try {
        await supabase
          .from('analysis_jobs_v2')
          .update({
            status: 'failed',
            error_message: `V9 failed: ${msg.slice(0, 240)}`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', job_id);
      } catch (e2) {
        console.error(`[V9-WORKER] Could not mark job failed: ${(e2 as Error)?.message}`);
      }
    }
  })();

  // @ts-ignore — Supabase Edge Runtime
  if (typeof EdgeRuntime !== 'undefined' && (EdgeRuntime as any).waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(work);
  } else {
    work.catch(() => {});
  }

  return new Response(
    JSON.stringify({ accepted: true, job_id, fixture_id, engine_version: ENGINE_VERSION }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
