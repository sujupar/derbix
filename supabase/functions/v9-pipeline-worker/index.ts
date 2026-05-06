// supabase/functions/v9-pipeline-worker/index.ts
// Background worker that runs the V9-HYBRID pipeline for one job.
// Invoked fire-and-forget by v3-ai-analyzer. Has its own 150s wall clock budget,
// independent of the dispatcher's HTTP request lifetime.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { runPipeline, type ETLRawData } from "../_shared/agents/orchestrator.ts";
import type { MatchContext } from "../_shared/agents/types.ts";
import { OPPORTUNITIES_THRESHOLD_PERCENT } from "../_shared/constants.ts";

const ENGINE_VERSION = 'V9-HYBRID-2026-05-05';
const PIPELINE_TIMEOUT_MS = 145000; // 145s safety cap. Worker has ~150s wall clock total.
const OPPORTUNITIES_THRESHOLD_PERCENT_PERSIST = OPPORTUNITIES_THRESHOLD_PERCENT;

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

      // Build legacy-shape sections that AnalysisReportModal expects to render UI
      const df = pipelineResult.data_foundation;
      const synth = pipelineResult.synthesizer;
      const verdict = synth.veredicto;
      const topPick = synth.picks[0];
      const decisionMap: Record<string, 'APOSTAR' | 'EVITAR' | 'OBSERVAR'> = {
        APOSTAR: 'APOSTAR', NO_BET: 'EVITAR', OBSERVAR: 'OBSERVAR',
      };
      const decision = decisionMap[verdict] || 'OBSERVAR';

      const reportPacket = {
        // V9 internal shape
        pipeline_version: pipelineResult.pipeline_version,
        engine_version: ENGINE_VERSION,
        data_foundation: df,
        statistical_foundation: pipelineResult.statistical_foundation,
        specialists: pipelineResult.specialists,
        skeptic: pipelineResult.skeptic,
        synthesizer: synth,
        validated_picks: pipelineResult.validated_picks,
        timings: pipelineResult.timings,
        meta: { engine: 'V9-HYBRID', verdict, modelo: 'v9-mega', version: ENGINE_VERSION },

        // Legacy shape for AnalysisReportModal
        header_partido: {
          titulo: `${df.home_team} vs ${df.away_team}`,
          subtitulo: `${df.league} · ${df.date}`,
          fecha: df.date,
          liga: df.league,
        },
        veredicto_analista: {
          decision,
          titulo_accion: decision === 'APOSTAR'
            ? (topPick ? `OPORTUNIDAD: ${topPick.market} ${topPick.selection}` : 'OPORTUNIDAD CLARA')
            : decision === 'EVITAR' ? 'NO APOSTAR' : 'OBSERVAR',
          seleccion_clave: topPick ? `${topPick.market}: ${topPick.selection}` : null,
          razon_principal: synth.summary || pipelineResult.statistical_foundation.thesis_baseline || '',
          riesgo_principal: pipelineResult.statistical_foundation.risks_flagged?.[0] || 'Volatilidad inherente al partido',
          probabilidad: topPick?.probability || synth.overall_confidence,
          nivel_confianza: topPick?.confidence || (synth.overall_confidence >= 80 ? 'ALTA' : synth.overall_confidence >= 65 ? 'MEDIA' : 'BAJA'),
          razonamiento: synth.summary || '',
        },
        resumen_ejecutivo: {
          titular: `${df.home_team} vs ${df.away_team}`,
          frase_principal: synth.summary || pipelineResult.statistical_foundation.thesis_baseline || `Análisis del partido entre ${df.home_team} y ${df.away_team}`,
          puntos_clave: pipelineResult.statistical_foundation.key_anchors || [],
          confianza: synth.overall_confidence >= 80 ? 'ALTA' : synth.overall_confidence >= 65 ? 'MEDIA' : 'BAJA',
        },
        datos_clave: {
          titulo: 'Datos Clave',
          columnas: ['Métrica', df.home_team, df.away_team],
          filas: [
            ['Forma reciente (5)', df.streak_home, df.streak_away],
            ['xG por partido (10)', String(df.xg_rolling.home_for_10), String(df.xg_rolling.away_for_10)],
            ['xGA por partido (10)', String(df.xg_rolling.home_against_10), String(df.xg_rolling.away_against_10)],
            ['Días de descanso', String(df.days_rest_home), String(df.days_rest_away)],
            ['Lesiones clave', df.injuries_impact.home_key_missing.join(', ') || 'Ninguna', df.injuries_impact.away_key_missing.join(', ') || 'Ninguna'],
          ],
        },
        analisis_profundo: {
          razonamiento_central: synth.summary || pipelineResult.statistical_foundation.thesis_baseline,
          matchup_tactico: pipelineResult.specialists.tactical?.notes || (pipelineResult.specialists.tactical?.key_findings || []).join(' · '),
          factor_psicologico: pipelineResult.specialists.contextual?.notes || (pipelineResult.specialists.contextual?.key_findings || []).join(' · '),
          contexto_competitivo: df.competition_context.is_derby ? 'Derby — alta tensión psicológica'
            : df.competition_context.is_relegation_battle ? 'Pelea por permanencia'
            : df.competition_context.is_title_race ? 'Pelea por título' : 'Partido de jornada regular',
        },
        escenarios_proyectados: synth.picks.length > 0 ? {
          titulo: 'Escenarios proyectados',
          descripcion: `Top picks identificados con probabilidad >= ${OPPORTUNITIES_THRESHOLD_PERCENT_PERSIST}%`,
          escenarios: synth.picks.slice(0, 4).map((p) => ({
            mercado: p.market,
            seleccion: p.selection,
            probabilidad: p.probability,
            cuota: p.odds,
            edge: p.edge_percent,
          })),
        } : null,
        predicciones_finales: {
          detalle: synth.picks.map((p) => ({
            mercado: p.market,
            seleccion: p.selection,
            probabilidad_estimado_porcentaje: p.probability,
            cuota_actual: p.odds,
            edge: p.edge_percent,
            ventaja: p.edge_percent,
            decision: 'APOSTAR',
            nivel_confianza: p.confidence,
            justificacion_detallada: p.reasoning,
            justificacion: p.reasoning,
          })),
        },
        pronosticos: synth.picks.map((p) => ({
          mercado: p.market,
          seleccion: p.selection,
          probabilidad_calculada_porcentaje: p.probability,
          cuota_actual: p.odds,
          edge_porcentaje: p.edge_percent,
          nivel_confianza: p.confidence,
          decision: 'BET',
          razonamiento: p.reasoning,
        })),
        advertencias: pipelineResult.statistical_foundation.risks_flagged?.length > 0 ? {
          titulo: 'Riesgos identificados',
          bullets: pipelineResult.statistical_foundation.risks_flagged,
        } : null,
        scores_duales: {
          score_estadistico: Math.min(100, synth.overall_confidence + 5),
          score_inteligencia_partido: synth.overall_confidence,
          confianza_final_calculada: synth.overall_confidence,
          justificacion_balance: `Modelo V9-MEGA con ${synth.picks.length} picks confirmados, confianza global ${synth.overall_confidence}%.`,
        },
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
        const confidenceToInt = (c: string): number =>
          c === 'ALTA' ? 90 : c === 'MEDIA' ? 70 : 50;
        const valuePicksRows = pipelineResult.validated_picks.map((p, idx) => ({
          fixture_id: fixture_id,
          job_id: job_id,
          market: p.market,
          selection: p.selection,
          p_model: p.probability / 100,
          p_implied: 1 / Math.max(p.odds, 1.01),
          odds: p.odds,
          edge: p.edge_percent / 100,
          confidence: confidenceToInt(p.confidence),
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
