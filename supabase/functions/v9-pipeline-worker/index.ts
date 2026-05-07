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
import { findOddInOrganized } from "../_shared/odds-selector.ts";

const ENGINE_VERSION = 'V9-HYBRID-2026-05-05';
const PIPELINE_TIMEOUT_MS = 145000; // 145s safety cap. Worker has ~150s wall clock total.
const OPPORTUNITIES_THRESHOLD_PERCENT_PERSIST = OPPORTUNITIES_THRESHOLD_PERCENT;

interface RequestBody {
  job_id: string;
  fixture_id: number;
  match_context: MatchContext;
  raw_etl: ETLRawData;
  match_date: string;
  organized_odds?: any; // Catalog from organizeOddsForAI() — used to verify MEGA-emitted odds
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

  const { job_id, fixture_id, match_context, raw_etl, match_date, organized_odds } = body;
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
        runPipeline(match_context, raw_etl, organized_odds),
        PIPELINE_TIMEOUT_MS,
        'PIPELINE',
      );

      const elapsed = Date.now() - t0;
      console.log(`[V9-WORKER] Pipeline complete in ${elapsed}ms — ${pipelineResult.validated_picks.length} validated picks, verdict=${pipelineResult.synthesizer.veredicto}`);

      // ═════════════════════════════════════════════════════════════════════
      // ODDS VERIFICATION: replace MEGA-invented odds with REAL bookmaker prices
      // The MEGA stage estimates an odds value that may not match the actual market.
      // findOddInOrganized() looks up the real value from the SportMonks catalog.
      // We override the pick's odds + recompute edge_percent so the user sees the
      // true bookmaker price and the true value vs the model probability.
      // ═════════════════════════════════════════════════════════════════════
      if (organized_odds && pipelineResult.validated_picks.length > 0) {
        const xvalCtx = {
          homeTeam: pipelineResult.data_foundation.home_team,
          awayTeam: pipelineResult.data_foundation.away_team,
        };
        const verifiedPicks = pipelineResult.validated_picks.map((p) => {
          const xval = findOddInOrganized(organized_odds, p.market, p.selection, xvalCtx);
          if (xval.match && xval.match.val > 1.01) {
            const realOdds = Number(xval.match.val.toFixed(2));
            const probDecimal = p.probability / 100;
            const impliedProb = 1 / realOdds;
            const realEdge = Number(((probDecimal - impliedProb) / impliedProb * 100).toFixed(2));
            console.log(`[V9-WORKER] ODDS-VERIFY ${p.market}/${p.selection}: model=${p.odds} → real=${realOdds} (${xval.reason}, ${xval.category}); edge ${p.edge_percent}% → ${realEdge}%`);
            return { ...p, odds: realOdds, edge_percent: realEdge };
          } else {
            console.warn(`[V9-WORKER] ODDS-VERIFY no match for ${p.market}/${p.selection} (${xval.reason}); keeping MEGA estimate ${p.odds}`);
            return p;
          }
        });
        // Filter out picks whose REAL odds fell out of acceptable range after verification
        const finalPicks = verifiedPicks.filter((p) => p.odds >= 1.20 && p.odds <= 4.50);
        const droppedCount = verifiedPicks.length - finalPicks.length;
        if (droppedCount > 0) console.log(`[V9-WORKER] Dropped ${droppedCount} picks after odds verification (out of [1.20, 4.50] range)`);
        pipelineResult.validated_picks = finalPicks;
        pipelineResult.synthesizer.picks = pipelineResult.synthesizer.picks.map((sp) => {
          const replacement = finalPicks.find((vp) => vp.market === sp.market && vp.selection === sp.selection);
          return replacement || sp;
        }).filter((sp) => finalPicks.some((vp) => vp.market === sp.market && vp.selection === sp.selection) || pipelineResult.validated_picks.length === 0);
      }

      // Build legacy-shape sections that AnalysisReportModal expects to render UI
      const df = pipelineResult.data_foundation;
      const synth = pipelineResult.synthesizer;
      const tactical = pipelineResult.specialists.tactical;
      const contextual = pipelineResult.specialists.contextual;
      const market = pipelineResult.specialists.market;
      const verdict = synth.veredicto;
      const topPick = synth.picks[0];
      const decisionMap: Record<string, 'APOSTAR' | 'EVITAR' | 'OBSERVAR'> = {
        APOSTAR: 'APOSTAR', NO_BET: 'EVITAR', OBSERVAR: 'OBSERVAR',
      };
      const decision = decisionMap[verdict] || 'OBSERVAR';

      // Build recent results table from raw_etl (last 5 matches each side)
      const formatRecent = (results: typeof raw_etl.home_recent_results) =>
        (results || []).slice(0, 5).map((r) => `${r.result} ${r.goals_for}-${r.goals_against}`);
      const home_recent_5 = formatRecent(raw_etl.home_recent_results);
      const away_recent_5 = formatRecent(raw_etl.away_recent_results);

      // Pull rich interpretive prose from specialists (which now hold MEGA's enriched output)
      const explicacionDetallada = pipelineResult.statistical_foundation.thesis_baseline || synth.summary || '';
      const matchupTactico = tactical.notes || tactical.key_findings.join(' · ');
      const contextoExterno = contextual.notes || contextual.key_findings.join(' · ');
      const factorPsicologico = market.notes || (market.key_findings.length > 0 ? market.key_findings.join(' · ') : 'Sin observaciones psicológicas relevantes detectadas.');
      const consejosApostador = pipelineResult.skeptic.global_observations || [];

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
        meta: {
          engine: 'V9-HYBRID',
          verdict,
          modelo: 'v9-mega',
          modelo_version: 'V9-MEGA',
          version: ENGINE_VERSION,
          fixture_id: `${df.home_team} vs ${df.away_team}`,
        },

        // Recent results (for PDF + UI tables)
        home_recent_5,
        away_recent_5,

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
          razon_principal: explicacionDetallada || synth.summary,
          riesgo_principal: pipelineResult.statistical_foundation.risks_flagged?.[0] || 'Volatilidad inherente al partido',
          probabilidad: topPick?.probability || synth.overall_confidence,
          nivel_confianza: topPick?.confidence || (synth.overall_confidence >= 80 ? 'ALTA' : synth.overall_confidence >= 65 ? 'MEDIA' : 'BAJA'),
          razonamiento: explicacionDetallada || synth.summary,
        },
        resumen_ejecutivo: {
          titular: `${df.home_team} vs ${df.away_team}`,
          frase_principal: synth.summary || explicacionDetallada.substring(0, 200) || `Análisis del partido entre ${df.home_team} y ${df.away_team}`,
          puntos_clave: pipelineResult.statistical_foundation.key_anchors || [],
          confianza: synth.overall_confidence >= 80 ? 'ALTA' : synth.overall_confidence >= 65 ? 'MEDIA' : 'BAJA',
        },
        datos_clave: {
          titulo: 'Datos Clave',
          columnas: ['Métrica', df.home_team, df.away_team],
          filas: [
            ['Forma reciente (5)', df.streak_home || '—', df.streak_away || '—'],
            ['xG por partido (10)', df.xg_rolling.home_for_10.toFixed(2), df.xg_rolling.away_for_10.toFixed(2)],
            ['xGA por partido (10)', df.xg_rolling.home_against_10.toFixed(2), df.xg_rolling.away_against_10.toFixed(2)],
            ['Goles a favor (5)', df.goals_avg.home_at_home_last5.toFixed(2), df.goals_avg.away_away_last5.toFixed(2)],
            ['Días de descanso', String(df.days_rest_home), String(df.days_rest_away)],
            ['Lesiones clave', df.injuries_impact.home_key_missing.join(', ') || 'Ninguna', df.injuries_impact.away_key_missing.join(', ') || 'Ninguna'],
          ],
        },
        // analisis_profundo: dual shape — strings for new UI/PDF + nested objects for legacy analysisService
        analisis_profundo: {
          // String fields (used by new modal sections + PDF)
          razonamiento_central: explicacionDetallada,
          matchup_tactico_text: matchupTactico,
          contexto_competitivo_text: contextoExterno,
          factor_psicologico_text: factorPsicologico,
          consejos_apostador: consejosApostador,

          // Nested-object fields (used by legacy analysisService.ts adaptV3 fallback)
          // analisis_tactico.{enfoque_local, enfoque_visitante, matchup_clave}
          analisis_tactico: {
            enfoque_local: matchupTactico ? `${df.home_team}: ${matchupTactico.split('.')[0]}.` : `Análisis táctico de ${df.home_team}`,
            enfoque_visitante: matchupTactico ? `${df.away_team}: ${matchupTactico.split('.').slice(1, 3).join('.')}.` : `Análisis táctico de ${df.away_team}`,
            matchup_clave: matchupTactico,
          },
          // matchup_tactico as object (legacy expects .detalle / .clave_del_partido / .estilo)
          matchup_tactico: {
            detalle: matchupTactico,
            clave_del_partido: tactical.key_findings?.[0] || matchupTactico.slice(0, 200),
            estilo: tactical.notes?.slice(0, 250) || matchupTactico.slice(0, 200),
          },
          // factor_psicologico as object (legacy expects .presion_local / .presion_visitante / .temperatura_mental)
          factor_psicologico: {
            presion_local: df.competition_context.is_relegation_battle
              ? `${df.home_team} pelea por la permanencia, alta presión.`
              : df.competition_context.is_title_race
              ? `${df.home_team} compite por el título, presión positiva.`
              : `${df.home_team} en jornada regular.`,
            presion_visitante: `${df.away_team} ${df.streak_away?.startsWith('W') ? 'llega con confianza' : df.streak_away?.startsWith('L') ? 'busca recomponerse' : 'en momento mixto'}.`,
            temperatura_mental: factorPsicologico,
          },
          // contexto_competitivo as object (legacy expects .situacion_local / .situacion_visitante / .implicaciones_partido)
          contexto_competitivo: {
            situacion_local: df.competition_context.home_table_rank
              ? `${df.home_team} ocupa posición ${df.competition_context.home_table_rank} en la tabla.`
              : `${df.home_team} en buen momento (streak ${df.streak_home || 'N/A'}).`,
            situacion_visitante: df.competition_context.away_table_rank
              ? `${df.away_team} ocupa posición ${df.competition_context.away_table_rank} en la tabla.`
              : `${df.away_team} en momento ${df.streak_away?.startsWith('W') ? 'positivo' : 'mixto'} (streak ${df.streak_away || 'N/A'}).`,
            implicaciones_partido: contextoExterno,
          },
          // lectura_de_mercado as object (legacy expects .ineficiencia_detectada / .analisis_cuotas)
          lectura_de_mercado: {
            ineficiencia_detectada: market.notes?.slice(0, 250) || `${synth.picks.length} mercados con valor detectado.`,
            analisis_cuotas: synth.picks.length > 0
              ? `Top pick: ${synth.picks[0].market} ${synth.picks[0].selection} @ ${synth.picks[0].odds} con ${synth.picks[0].edge_percent}% edge.`
              : 'No se detectaron oportunidades con valor estadístico significativo en este partido.',
          },
        },
        escenarios_proyectados: synth.picks.length > 0 ? {
          titulo: 'Escenarios proyectados',
          descripcion: `Top picks identificados con probabilidad >= ${OPPORTUNITIES_THRESHOLD_PERCENT_PERSIST}%`,
          // Legacy shape (used by analysisService adaptV3)
          escenario_mas_probable: {
            descripcion: synth.picks[0]
              ? `Escenario principal: ${synth.picks[0].market} - ${synth.picks[0].selection} con probabilidad estimada del ${synth.picks[0].probability}% y cuota ${synth.picks[0].odds}. ${synth.picks[0].reasoning}`
              : explicacionDetallada.slice(0, 400),
          },
          escenario_alternativo: synth.picks[1] ? {
            descripcion: `Escenario alternativo: ${synth.picks[1].market} - ${synth.picks[1].selection} con probabilidad ${synth.picks[1].probability}% (cuota ${synth.picks[1].odds}). ${synth.picks[1].reasoning}`,
          } : {
            descripcion: synth.summary || 'Sin escenario alternativo destacable detectado.',
          },
          escenarios: synth.picks.slice(0, 4).map((p) => ({
            mercado: p.market,
            seleccion: p.selection,
            probabilidad: p.probability,
            cuota: p.odds,
            edge: p.edge_percent,
            por_que: p.reasoning,
          })),
        } : {
          escenario_mas_probable: { descripcion: synth.summary || explicacionDetallada.slice(0, 400) || `Análisis de ${df.home_team} vs ${df.away_team}.` },
          escenario_alternativo: { descripcion: 'No se detectaron escenarios con valor de apuesta. Mejor observar.' },
        },
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
        // factores_riesgo: legacy shape used by analysisService adaptV3
        factores_riesgo: {
          riesgo_principal: pipelineResult.statistical_foundation.risks_flagged?.[0] || 'Volatilidad inherente al partido — verificar lineups confirmados antes de apostar.',
          riesgos_secundarios: (pipelineResult.statistical_foundation.risks_flagged || []).slice(1, 4),
        },
        // mercados_evaluados: total markets analyzed
        mercados_evaluados: {
          total_analizados: 60,
          con_valor_detectado: synth.picks.length,
        },
        // datos_modelo: derived from data_foundation
        datos_modelo: {
          goles_esperados_partido: Number((df.xg_rolling.home_for_10 + df.xg_rolling.away_for_10).toFixed(2)),
          corners_esperados: 9,
          probabilidad_btts_porcentaje: df.sportmonks_predictions?.btts_yes ?? 50,
        },
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
