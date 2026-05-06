// supabase/functions/v9-judge-runner/index.ts
// Final stage of the V9 chain. Runs after all 6 agents finish.
// Steps (within its own 150s wall clock):
//   1. Read v9_debate_runs + v9_agent_outputs
//   2. Call DeepSeek-V4 Pro for the synthesis (judge)
//   3. Apply odds cross-validation against the bookmaker catalog
//   4. Apply lineup-aware confidence adjustment
//   5. Build analysisResult and dashboardData
//   6. Persist reports_v2 / value_picks_v2 / analisis
//   7. Mark analysis_jobs_v2 as 'done'

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import JSON5 from "https://esm.sh/json5@2.2.3";
import { corsHeaders } from "../_shared/cors.ts";
import { callLLM } from "../_shared/llm-client.ts";
import { AGENTS } from "../_shared/agents/configs.ts";
import { buildJudgePrompt } from "../_shared/agents/orchestrator.ts";
import { findOddInOrganized, oddsWithinTolerance } from "../_shared/odds-selector.ts";
import type { MatchContext, AgentAnalysis } from "../_shared/agents/types.ts";

serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    const startTime = Date.now();
    const sbUrl = Deno.env.get("SUPABASE_URL")!;
    const sbKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(sbUrl, sbKey);

    let runId: string | null = null;

    try {
        const body = await req.json();
        runId = body.run_id;
        if (!runId) throw new Error("run_id required");

        // Lock the run as judge_running (idempotent — if already completed, skip)
        const { data: lockedRun, error: lockErr } = await supabase
            .from("v9_debate_runs")
            .update({ status: "judge_running", updated_at: new Date().toISOString() })
            .eq("id", runId)
            .in("status", ["agents_done", "agents_running"])
            .select("id, job_id, fixture_id, context_json, payload_meta, agents_completed, agents_failed, agents_total")
            .single();

        if (lockErr || !lockedRun) {
            console.warn(`[v9-judge-runner] Could not lock run ${runId} (already finalized?): ${lockErr?.message}`);
            return new Response(JSON.stringify({ success: false, error: "run not in lockable state" }), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const context: MatchContext = lockedRun.context_json;
        const payloadMeta = lockedRun.payload_meta || {};
        const jobId = lockedRun.job_id;
        const fixtureId = lockedRun.fixture_id;

        // Load all 6 agent outputs
        const { data: agentRows } = await supabase
            .from("v9_agent_outputs")
            .select("agent_key, status, output_json")
            .eq("run_id", runId);

        const analyses: AgentAnalysis[] = (agentRows || []).map((r: any) => {
            if (r.status === "done" && r.output_json) {
                return r.output_json as AgentAnalysis;
            }
            const cfg = AGENTS[r.agent_key];
            return {
                agent_name: cfg?.name || r.agent_key,
                agent_role: cfg?.role || r.agent_key,
                key_findings: [],
                recommended_picks: [],
                confidence_overall: 0,
                key_risks: [`Agent ${r.agent_key} did not complete`],
                error: r.status === "failed" ? "agent_failed" : "agent_pending",
            };
        });

        const successOnly = analyses.filter((a) => !a.error);
        console.log(`[v9-judge-runner] run=${runId} agents_ok=${successOnly.length}/${analyses.length}, calling judge...`);

        // ═══ STEP 2: Judge LLM call ═══
        const judgeCfg = AGENTS.JUDGE;
        const judgePrompt = buildJudgePrompt(context, analyses);

        let judgeVerdict: any = null;
        try {
            // Aggressive timeout: if Pro stalls due to DeepSeek saturation, fall through
                // the provider chain (Pro → Flash → Groq) so the judge always completes within
                // the 150s wall clock. Provider chain is defined in llm-client PROVIDERS list.
            const judgeRes = await callLLM(judgePrompt, {
                temperature: judgeCfg.temperature,
                maxTokens: judgeCfg.max_tokens,
                jsonMode: true,
                timeoutMs: 75000, // Pro target. If saturated, llm-client cascades to Flash automatically.
                preferredProvider: judgeCfg.preferred_provider,
                systemPrompt: judgeCfg.system_prompt,
            });

            let cleaned = judgeRes.text.replace(/```json/g, "").replace(/```/g, "").trim();
            const si = cleaned.indexOf("{");
            const ei = cleaned.lastIndexOf("}");
            if (si !== -1 && ei > si) cleaned = cleaned.substring(si, ei + 1);

            try { judgeVerdict = JSON5.parse(cleaned); } catch {
                try { judgeVerdict = JSON.parse(cleaned); } catch { judgeVerdict = null; }
            }
            console.log(`[v9-judge-runner] judge done via ${judgeRes.provider} (${judgeRes.tokensUsed} tokens, picks=${(judgeVerdict?.pronosticos || []).length})`);
        } catch (judgeErr: any) {
            console.error(`[v9-judge-runner] judge call failed: ${judgeErr.message}`);
        }

        // ═══ STEP 3: Build consensus + fallback if judge failed ═══
        const pickMap = new Map<string, { count: number; probabilities: number[] }>();
        for (const a of successOnly) {
            if (a.agent_role === "skeptic") continue;
            for (const pick of a.recommended_picks) {
                const key = `${pick.market}|${pick.selection}`;
                if (!pickMap.has(key)) pickMap.set(key, { count: 0, probabilities: [] });
                const e = pickMap.get(key)!;
                e.count++;
                e.probabilities.push(pick.probability_estimate);
            }
        }
        // Two-tier consensus picks:
        //  - strongPicks: ≥2 agents agree (best signal)
        //  - looseTakes: any pick from any agent with prob≥60 (used only when consensus empty)
        // Original 3+ threshold was for full 6-agent runs; partial runs need looser criteria.
        const allPickEntries = Array.from(pickMap.entries()).map(([key, v]) => {
            const [market, selection] = key.split("|");
            const avgProb = Math.round(v.probabilities.reduce((s, p) => s + p, 0) / v.probabilities.length);
            const confidence: "ALTA" | "MEDIA" | "BAJA" = v.count >= 4 ? "ALTA" : v.count === 3 ? "MEDIA" : v.count === 2 ? "MEDIA" : "BAJA";
            return { market, selection, agreed_by: v.count, avg_probability: avgProb, confidence };
        });
        const strongPicks = allPickEntries.filter((p) => p.agreed_by >= 2).sort((a, b) => b.agreed_by - a.agreed_by);
        const looseTakes = strongPicks.length > 0 ? strongPicks : allPickEntries.filter((p) => p.avg_probability >= 60).sort((a, b) => b.avg_probability - a.avg_probability).slice(0, 3);

        // Fallback verdict if the judge LLM failed entirely OR returned empty picks.
        // The latter happens when LLM cascade lands on a model that synthesizes
        // verbiage but skips the recommendation list under token pressure.
        const judgeProducedPicks = (judgeVerdict?.pronosticos || []).length > 0;
        const fallbackPool = looseTakes.length > 0 ? looseTakes : strongPicks;
        const shouldUseConsensusFallback = !judgeVerdict || (!judgeProducedPicks && fallbackPool.length > 0);
        if (shouldUseConsensusFallback && fallbackPool.length > 0) {
            console.warn(`[v9-judge-runner] Using consensus fallback: judge=${judgeVerdict ? 'empty-picks' : 'failed'}, strongPicks=${strongPicks.length}, looseTakes=${looseTakes.length}`);
            const m = (context as any).math;
            const modelConsistency = m?.diagnostics?.model_consistency ?? 0.5;
            const topProb = Math.max(
                m?.ensemble_probabilities?.home_win ?? 0,
                m?.ensemble_probabilities?.draw ?? 0,
                m?.ensemble_probabilities?.away_win ?? 0,
            );
            const scoreEstadistico = Math.round(((modelConsistency * 0.6) + (topProb * 0.4)) * 100);

            const ctxAgents = successOnly.filter((a) =>
                a.agent_role === "tactical_analyst" || a.agent_role === "contextual_analyst" || a.agent_role === "skeptic"
            );
            const avgContextConf = ctxAgents.length
                ? Math.round(ctxAgents.reduce((s, a) => s + (a.confidence_overall || 0), 0) / ctxAgents.length)
                : 50;
            const cappedFinal = Math.min(88, Math.max(0, Math.round((scoreEstadistico * 0.5) + (avgContextConf * 0.5)) - 12));

            const findingsByAgent = successOnly
                .filter((a) => a.agent_role !== "skeptic" && (a.key_findings?.length || 0) > 0)
                .map((a) => `${a.agent_name}: ${a.key_findings.slice(0, 2).join(". ")}`)
                .slice(0, 5);
            const skepticAgent = successOnly.find((a) => a.agent_role === "skeptic");
            const skepticArgs = skepticAgent?.devil_arguments?.slice(0, 2) || skepticAgent?.key_risks?.slice(0, 2) || [];

            // Preserve any narrative the judge LLM did produce — only fill in what's missing.
            const existingNarrative = judgeVerdict?.analisis_profundo || {};
            const existingResumen = judgeVerdict?.resumen_ejecutivo || {};
            const fallbackPronosticos = fallbackPool.slice(0, 3).map((sp) => ({
                mercado: sp.market,
                seleccion: sp.selection,
                probabilidad_calculada_porcentaje: Math.min(sp.avg_probability, 85),
                cuota_actual: null,
                confianza: sp.confidence,
                tipo_pick: "consensus_fallback",
                justificacion: { estadistica: `${sp.agreed_by}/${successOnly.length} agentes coincidieron` },
            }));
            judgeVerdict = {
                resumen_ejecutivo: {
                    titular: existingResumen.titular || `${fallbackPool[0].selection} en ${fallbackPool[0].market} (${fallbackPool[0].agreed_by}/${successOnly.length} agentes)`,
                    veredicto: existingResumen.veredicto || (cappedFinal >= 75 ? "APOSTAR" : cappedFinal >= 60 ? "OBSERVAR" : "NO_BET"),
                    confianza_global: existingResumen.confianza_global || (cappedFinal >= 80 ? "ALTA" : cappedFinal >= 65 ? "MEDIA" : "BAJA"),
                    picks_principales: existingResumen.picks_principales?.length ? existingResumen.picks_principales : fallbackPool.slice(0, 2).map((p) => `${p.market}: ${p.selection}`),
                },
                analisis_profundo: {
                    razonamiento_central: existingNarrative.razonamiento_central && existingNarrative.razonamiento_central !== 'Análisis no disponible' && existingNarrative.razonamiento_central.length > 30
                        ? existingNarrative.razonamiento_central
                        : [
                            `Consenso de ${successOnly.length}/${analyses.length} agentes activos.`,
                            ...findingsByAgent,
                            skepticArgs.length ? `Riesgos: ${skepticArgs.join(". ")}` : "",
                          ].filter(Boolean).join(" "),
                    matchup_tactico: existingNarrative.matchup_tactico && existingNarrative.matchup_tactico !== 'N/A' && existingNarrative.matchup_tactico.length > 10
                        ? existingNarrative.matchup_tactico
                        : (successOnly.find((a) => a.agent_role === "tactical_analyst")?.key_findings?.slice(0, 2).join(". ") || "Sin análisis táctico detallado"),
                    factor_psicologico: existingNarrative.factor_psicologico && existingNarrative.factor_psicologico !== 'N/A'
                        ? existingNarrative.factor_psicologico
                        : (successOnly.find((a) => a.agent_role === "contextual_analyst")?.key_findings?.slice(0, 2).join(". ") || "Sin contexto disponible"),
                    contexto_competitivo: existingNarrative.contexto_competitivo && existingNarrative.contexto_competitivo !== 'N/A' ? existingNarrative.contexto_competitivo : "Ver agentes",
                },
                pronosticos: fallbackPronosticos,
                factores_riesgo: judgeVerdict?.factores_riesgo || {
                    riesgo_principal: skepticArgs[0] || "Síntesis del juez no completada",
                    nivel_incertidumbre: cappedFinal >= 75 ? "BAJO" : cappedFinal >= 60 ? "MEDIO" : "ALTO",
                },
                scores_duales: judgeVerdict?.scores_duales || {
                    score_estadistico: scoreEstadistico,
                    score_inteligencia_partido: avgContextConf,
                    confianza_final_calculada: cappedFinal,
                    justificacion_balance: `Estadístico ${scoreEstadistico} + Contexto ${avgContextConf}, penalty -12 por fallo del juez`,
                },
            };
        }

        // ═══ STEP 4: Build final analysisResult ═══
        const m = (context as any).math || {};
        const homeTeam = context.homeTeam;
        const awayTeam = context.awayTeam;
        const ENGINE_VERSION = "V9-CHAIN";

        // Always-real dual scores
        const computedScoresDuales = (() => {
            const modelConsistency = m?.diagnostics?.model_consistency ?? 0.5;
            const topProb = Math.max(
                m?.ensemble_probabilities?.home_win ?? 0,
                m?.ensemble_probabilities?.draw ?? 0,
                m?.ensemble_probabilities?.away_win ?? 0,
            );
            const computedEstadistico = Math.round(((modelConsistency * 0.6) + (topProb * 0.4)) * 100);
            const ctxAgents = successOnly.filter((a) =>
                a.agent_role === "tactical_analyst" || a.agent_role === "contextual_analyst" || a.agent_role === "skeptic"
            );
            const computedContexto = ctxAgents.length
                ? Math.round(ctxAgents.reduce((s, a) => s + (a.confidence_overall || 0), 0) / ctxAgents.length)
                : 50;
            const j = judgeVerdict?.scores_duales || {};
            const finalEst = (typeof j.score_estadistico === "number" && j.score_estadistico > 0) ? j.score_estadistico : computedEstadistico;
            const finalCtx = (typeof j.score_inteligencia_partido === "number" && j.score_inteligencia_partido > 0) ? j.score_inteligencia_partido : computedContexto;
            const finalConf = (typeof j.confianza_final_calculada === "number" && j.confianza_final_calculada > 0)
                ? Math.min(95, j.confianza_final_calculada)
                : Math.round((finalEst + finalCtx) / 2);
            return {
                score_estadistico: finalEst,
                score_inteligencia_partido: finalCtx,
                confianza_final_calculada: finalConf,
                justificacion_balance: j.justificacion_balance || `Estadístico ${finalEst} + Contexto ${finalCtx}`,
            };
        })();

        const analysisResult: any = {
            meta: { engine: ENGINE_VERSION, modelo: "v9-chain-multi-provider", version: ENGINE_VERSION, agents_completed: successOnly.length, agents_failed: analyses.length - successOnly.length },
            resumen_ejecutivo: judgeVerdict?.resumen_ejecutivo || {
                titular: `Análisis ${homeTeam} vs ${awayTeam}`,
                veredicto: "OBSERVAR",
                confianza_global: "BAJA",
                picks_principales: [],
            },
            scores_duales: computedScoresDuales,
            analisis_profundo: judgeVerdict?.analisis_profundo || {
                razonamiento_central: "Análisis no disponible",
                matchup_tactico: "N/A",
                factor_psicologico: "N/A",
                contexto_competitivo: "N/A",
            },
            pronosticos: judgeVerdict?.pronosticos || [],
            factores_riesgo: judgeVerdict?.factores_riesgo || { riesgo_principal: "No evaluado", nivel_incertidumbre: "MEDIO" },
            datos_modelo: {
                goles_esperados_partido: m?.dixon_coles?.expected_total_goals ?? 2.5,
                corners_esperados: 9,
                probabilidad_btts_porcentaje: Math.round((m?.ensemble_probabilities?.btts_yes ?? 0.5) * 100),
                lambda_home: m?.dixon_coles?.lambdaHome,
                lambda_away: m?.dixon_coles?.lambdaAway,
            },
            mercados_evaluados: judgeVerdict?.mercados_evaluados || { con_valor_detectado: 0, total_analizados: 0 },
            v9_chain: {
                run_id: runId,
                agents_used: analyses.map((a: any) => ({
                    name: a.agent_name,
                    confidence: a.confidence_overall,
                    provider: a.provider_used,
                    failed: !!a.error,
                })),
                strong_picks: strongPicks,
            },
        };

        // Normalize pick field names: agents and some judge LLM outputs use English keys
        // (`market`, `selection`, `probability_estimate`) while the rest of the pipeline
        // expects Spanish keys (`mercado`, `seleccion`, etc.). Map both ways defensively.
        analysisResult.pronosticos = (analysisResult.pronosticos || []).map((p: any) => {
            const mercado = p.mercado || p.market || '';
            const seleccion = p.seleccion || p.selection || '';
            const probCalc = p.probabilidad_calculada_porcentaje ?? p.probability_estimate ?? p.probabilidad ?? 0;
            const probImpl = p.probabilidad_implicita_porcentaje ?? p.implied_probability ?? null;
            const edge = p.edge_porcentaje ?? p.edge ?? null;
            const cuota = p.cuota_actual ?? p.cuota ?? p.odds ?? null;
            const conf = p.confianza || p.confidence || (p.risk_level === 'LOW' ? 'ALTA' : p.risk_level === 'MEDIUM' ? 'MEDIA' : p.risk_level === 'HIGH' ? 'BAJA' : 'MEDIA');
            const just = p.justificacion || p.reasoning ? (typeof (p.justificacion || p.reasoning) === 'string' ? { estadistica: p.justificacion || p.reasoning } : p.justificacion) : { estadistica: '' };
            return {
                mercado,
                seleccion,
                probabilidad_calculada_porcentaje: probCalc,
                probabilidad_implicita_porcentaje: probImpl,
                edge_porcentaje: edge,
                cuota_actual: cuota,
                confianza: conf,
                tipo_pick: p.tipo_pick || 'standard',
                justificacion: just,
                _normalized_from: (p.market || p.selection) ? 'english' : 'spanish',
            };
        });

        // ═══ STEP 5: Cross-val odds against the bookmaker catalog ═══
        const odds = payloadMeta?.odds || null;
        const hasRealOdds = !!(odds?._meta?.bookmaker);
        if (!hasRealOdds) {
            console.warn(`[v9-judge-runner] No real odds coverage — discarding ${analysisResult.pronosticos.length} picks`);
            analysisResult.pronosticos = [];
        } else {
            const xvalCtx = { homeTeam, awayTeam };
            const kept: any[] = [];
            const rejects: any[] = [];
            for (const p of analysisResult.pronosticos) {
                const xv = findOddInOrganized(odds, p.mercado || "", p.seleccion || "", xvalCtx);
                if (!xv.match) {
                    rejects.push({ m: p.mercado, s: p.seleccion, reason: xv.reason || 'no_match' });
                    continue;
                }
                const llmOddsRaw = p.cuota_actual ?? null;
                const llmOdds = typeof llmOddsRaw === "string" ? parseFloat(llmOddsRaw) : llmOddsRaw;
                if (llmOdds !== null && isFinite(llmOdds) && !oddsWithinTolerance(llmOdds, xv.match.val, 0.05)) {
                    rejects.push({ m: p.mercado, s: p.seleccion, reason: 'odds_mismatch' });
                    continue;
                }
                p.cuota_actual = xv.match.val;
                p._xval_category = xv.category;
                p._xval_reason = xv.reason;
                kept.push(p);
            }
            console.log(`[v9-judge-runner] cross-val: kept ${kept.length}/${analysisResult.pronosticos.length}, rejects:`, JSON.stringify(rejects.slice(0, 5)));
            analysisResult.pronosticos = kept;
        }

        // Lineup-aware confidence adjustment
        const matchStartMs = payloadMeta?.match_start_iso ? new Date(payloadMeta.match_start_iso).getTime() : 0;
        const hoursToKickoff = matchStartMs > 0 ? (matchStartMs - Date.now()) / 3600000 : 99;
        if (!payloadMeta?.has_confirmed_lineup && hoursToKickoff < 2 && hoursToKickoff > -1) {
            const prev = analysisResult.scores_duales.confianza_final_calculada;
            analysisResult.scores_duales.confianza_final_calculada = Math.max(0, prev - 15);
            console.log(`[v9-judge-runner] -15pts confianza (lineup unconfirmed, ${hoursToKickoff.toFixed(1)}h to kickoff)`);
        }

        // ═══════════════════════════════════════════════════════════════
        // QUALITY GATE — STRICT
        // The user repeatedly reports the bug "informe vacío con scores 47%".
        // Root cause: when agents mostly fail, the judge fallback writes a report
        // with "matchup_tactico: N/A" and scores 44/50/47. We must NEVER persist
        // such a report. Two regimes:
        //   (a) PRIOR GOOD EXISTS → preserve it, mark this job failed.
        //   (b) NO PRIOR GOOD     → still mark failed (no fake report). The retry
        //       CRON will pick it up later. The frontend shows "en reintento".
        // ═══════════════════════════════════════════════════════════════
        const goodAgents = successOnly.length;
        const totalAgents = analyses.length;
        const finalConf = analysisResult.scores_duales?.confianza_final_calculada || 0;
        const matchupText = (analysisResult.analisis_profundo?.matchup_tactico || '').toString().trim();
        const reasoningText = (analysisResult.analisis_profundo?.razonamiento_central || '').toString().trim();
        // Two narrative bars: STRICT (full 6 agents) vs RELAXED (partial run, 3-5 agents).
        // With fewer agents the judge has less material so we accept shorter narratives;
        // we still reject true placeholder text ('N/A', 'Análisis no disponible', empty).
        const hasAnyNarrative = (matchupText && matchupText !== 'N/A' && matchupText.length > 0)
            || (reasoningText && reasoningText !== 'Análisis no disponible' && reasoningText.length > 0);
        const hasFullNarrative = matchupText && matchupText !== 'N/A' && matchupText.length > 30
            && reasoningText && reasoningText !== 'Análisis no disponible' && reasoningText.length > 60;
        const isPartialRun = goodAgents < totalAgents;
        // Quality regimes:
        //   - Verdict APOSTAR + 0 picks after xval → INCONSISTENT (says "bet" but no picks)
        //   - Verdict APOSTAR + low confidence → INCONSISTENT (says "bet" but unsure)
        //   - <3 successful agents → DEGRADED data
        //   - Full run + missing narrative → DEGRADED (judge fallback)
        //   - Partial run + truly empty narrative → DEGRADED
        const verdict = String(analysisResult.resumen_ejecutivo?.veredicto || '').toUpperCase();
        const finalPicksCount = (analysisResult.pronosticos || []).length;
        const isAposting = verdict === 'APOSTAR';
        const isInconsistent = isAposting && finalPicksCount === 0;
        const isUnsureBet = isAposting && finalConf < 55;
        const narrativeOk = isPartialRun ? hasAnyNarrative : hasFullNarrative;
        const isLowQuality = goodAgents < 3 || !narrativeOk || isInconsistent || isUnsureBet;

        if (isLowQuality) {
            const finalFixtureIdEarly = payloadMeta?.final_fixture_id || fixtureId;
            const { data: existingReports } = await supabase
                .from("reports_v2")
                .select("job_id, report_packet")
                .eq("fixture_id", finalFixtureIdEarly)
                .neq("job_id", jobId)
                .order("created_at", { ascending: false })
                .limit(1);

            const prior = existingReports?.[0];
            const priorScore = prior?.report_packet?.scores_duales?.confianza_final_calculada || 0;
            const priorPicks = (prior?.report_packet?.pronosticos || []).length;
            const priorMatchup = (prior?.report_packet?.analisis_profundo?.matchup_tactico || '').toString().trim();
            const priorIsGood = prior && priorScore >= 60 && priorMatchup && priorMatchup !== 'N/A' && priorMatchup.length > 30;

            const reasonDetail = `agents=${goodAgents}/${totalAgents}, conf=${finalConf}, narrative=${narrativeOk ? 'ok' : 'missing'}, picks_after_xval=${finalPicksCount}, verdict=${verdict || '-'}`;

            if (priorIsGood) {
                console.warn(`[v9-judge-runner] LOW-QUALITY GUARD: ${reasonDetail}. Prior good report exists (job=${prior.job_id}, conf=${priorScore}, ${priorPicks} picks). PRESERVING prior.`);
            } else {
                console.warn(`[v9-judge-runner] LOW-QUALITY GUARD: ${reasonDetail}. No prior good report. NOT writing empty report — job will be retried by CRON.`);
            }

            await supabase
                .from("v9_debate_runs")
                .update({ status: "failed", error_message: `low-quality (${reasonDetail}); ${priorIsGood ? 'prior preserved' : 'no report written'}`, updated_at: new Date().toISOString() })
                .eq("id", runId);

            await supabase
                .from("analysis_jobs_v2")
                .update({ status: "failed", error_message: `low-quality run (${reasonDetail})`, updated_at: new Date().toISOString() })
                .eq("id", jobId);

            return new Response(JSON.stringify({
                success: false,
                reason: priorIsGood ? "low_quality_prior_preserved" : "low_quality_no_report",
                run_id: runId,
                conf_final: finalConf,
                agents_ok: goodAgents,
            }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        // ═══ STEP 6: Persist reports + value_picks + analisis ═══
        const finalFixtureId = payloadMeta?.final_fixture_id || fixtureId;
        const idsToClean = payloadMeta?.ids_to_clean || [fixtureId];

        // Clean stale: this job's previous report AND any older reports for the same fixture.
        // We keep only the latest authoritative report per fixture so the frontend never reads stale data.
        await supabase.from("reports_v2").delete().eq("fixture_id", finalFixtureId);
        await supabase
            .from("reports_v2")
            .insert({
                job_id: jobId,
                fixture_id: finalFixtureId,
                report_packet: analysisResult,
                prompt_version: "V9-CHAIN-1.0",
                engine_version: ENGINE_VERSION,
                created_at: new Date().toISOString(),
            });

        // Insert value_picks
        const picksForInsert = analysisResult.pronosticos || [];
        if (picksForInsert.length > 0) {
            const mapConf = (str: string) => {
                if (!str) return 5;
                const s = String(str).toUpperCase();
                if (s.includes("MUY ALTA")) return 9;
                if (s.includes("ALTA")) return 8;
                if (s.includes("MEDIA")) return 6;
                return 5;
            };
            const picksPayload = picksForInsert.map((p: any) => {
                let prob = p.probabilidad_calculada_porcentaje
                    ?? p.probabilidad_estimado_porcentaje
                    ?? p.probabilidad
                    ?? p.probability
                    ?? 50;
                if (typeof prob === "string") prob = parseFloat(prob);
                if (prob > 1) prob = prob / 100;

                const pickOdds = typeof p.cuota_actual === "number" ? p.cuota_actual : parseFloat(String(p.cuota_actual));
                const validPickOdds = isFinite(pickOdds) && pickOdds > 1.0 ? pickOdds : null;
                let decision = "AVOID";
                if (prob >= 0.70) decision = "BET";

                return {
                    job_id: jobId,
                    fixture_id: finalFixtureId,
                    market: p.mercado || "Mercado",
                    selection: p.seleccion || "Selección",
                    p_model: prob,
                    decision,
                    confidence: mapConf(p.confianza),
                    engine_version: ENGINE_VERSION,
                    odds: validPickOdds,
                    odds_source: validPickOdds !== null ? "real" : "unavailable",
                    created_at: new Date().toISOString(),
                };
            });
            // Wipe ALL picks for this fixture (not just this job_id) so older runs
            // can't leave ghost picks that resurface as opportunities. This is the bug
            // where a regenerate that fails kept old 99% picks from a previous good run.
            await supabase.from("value_picks_v2").delete().eq("fixture_id", finalFixtureId);
            await supabase.from("value_picks_v2").insert(picksPayload);
        } else {
            // No new picks → still wipe old ones for this fixture so we don't keep
            // ghost opportunities from a previous generation.
            await supabase.from("value_picks_v2").delete().eq("fixture_id", finalFixtureId);
        }

        // Insert dashboard cache
        for (const fid of idsToClean) {
            await supabase.from("analisis").delete().eq("partido_id", fid);
        }
        const tit = analysisResult.resumen_ejecutivo.titular;
        const ap = analysisResult.analisis_profundo || {};
        const dashboardData = {
            header_partido: {
                titulo: `${homeTeam} vs ${awayTeam}`,
                subtitulo: 'Inteligencia Artificial aplicada',
                bullets_clave: analysisResult.resumen_ejecutivo.picks_principales || [],
            },
            veredicto_analista: {
                decision: analysisResult.resumen_ejecutivo.veredicto || "OBSERVAR",
                nivel_confianza: analysisResult.resumen_ejecutivo.confianza_global || "MEDIA",
                probabilidad: picksForInsert[0]?.probabilidad_calculada_porcentaje || 50,
                titulo_accion: analysisResult.resumen_ejecutivo.veredicto === "APOSTAR" ? "OPORTUNIDAD DETECTADA" : "PARTIDO COMPLEJO",
                razon_principal: tit,
                riesgo_principal: analysisResult.factores_riesgo?.riesgo_principal || 'Sin riesgos críticos',
                seleccion_clave: picksForInsert[0]?.seleccion || "N/A",
            },
            resumen_ejecutivo: {
                titular: tit,
                frase_principal: tit,
                puntos_clave: analysisResult.resumen_ejecutivo.picks_principales,
                bullets: [ap.contexto_competitivo, ap.factor_psicologico].filter(Boolean),
            },
            scores_duales: analysisResult.scores_duales,
            predicciones_finales: { titulo: "Pronósticos del Motor V9-CHAIN", detalle: picksForInsert },
            // The frontend adapter (services/analysisService.ts) expects this exact shape under
            // `analisis_detallado`. We map the V9 string fields (matchup_tactico, factor_psicologico,
            // contexto_competitivo, razonamiento_central) into the structures the UI renders.
            analisis_detallado: ap.matchup_tactico || ap.razonamiento_central ? {
                razonamiento_central: ap.razonamiento_central || tit,
                contexto_competitivo: typeof ap.contexto_competitivo === 'string'
                    ? { titulo: 'Contexto del Partido', bullets: [ap.contexto_competitivo] }
                    : (ap.contexto_competitivo || { titulo: 'Contexto del Partido', bullets: [] }),
                estilo_y_tactica: {
                    titulo: 'Análisis Táctico',
                    bullets: [
                        ap.matchup_tactico,
                        ap.clave_del_partido,
                    ].filter(Boolean),
                },
                factor_psicologico: typeof ap.factor_psicologico === 'string'
                    ? { titulo: 'Factor Psicológico', bullets: [ap.factor_psicologico] }
                    : (ap.factor_psicologico || null),
                matchup_tactico: ap.matchup_tactico,
            } : null,
            patrones_detectados: analysisResult.patrones_detectados || null,
            v9_chain_source: true,
            generated_at: new Date().toISOString(),
        };
        await supabase.from("analisis").insert({ partido_id: finalFixtureId, resultado_analisis: { dashboardData } });

        // Mark run + job as done
        await supabase
            .from("v9_debate_runs")
            .update({
                status: "completed",
                judge_completed: true,
                judge_output: judgeVerdict,
                updated_at: new Date().toISOString(),
            })
            .eq("id", runId);

        await supabase
            .from("analysis_jobs_v2")
            .update({ status: "done", current_motor: ENGINE_VERSION, updated_at: new Date().toISOString() })
            .eq("id", jobId);

        const totalMs = Date.now() - startTime;
        console.log(`[v9-judge-runner] DONE run=${runId} in ${totalMs}ms — ${picksForInsert.length} picks final`);

        return new Response(JSON.stringify({ success: true, run_id: runId, picks: picksForInsert.length, elapsed_ms: totalMs }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    } catch (err: any) {
        console.error(`[v9-judge-runner] FATAL: ${err.message}`);
        if (runId) {
            await supabase
                .from("v9_debate_runs")
                .update({ status: "failed", error_message: err.message?.substring(0, 500), updated_at: new Date().toISOString() })
                .eq("id", runId)
                .catch(() => {});

            // Mark the parent job as failed too so the retry CRON can pick it up
            const { data: runData } = await supabase
                .from("v9_debate_runs")
                .select("job_id")
                .eq("id", runId)
                .single();
            if (runData?.job_id) {
                await supabase
                    .from("analysis_jobs_v2")
                    .update({ status: "failed", error_message: `v9-judge-runner: ${err.message?.substring(0, 300)}` })
                    .eq("id", runData.job_id)
                    .catch(() => {});
            }
        }
        return new Response(JSON.stringify({ success: false, error: err.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
