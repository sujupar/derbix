
// supabase/functions/v2-generate-parlays/index.ts
// OPPORTUNITIES ENGINE V8.1: DIRECT DATA ACCESS (no job status dependency)
// Bypasses analysis_jobs_v2 status entirely - queries reports_v2 + value_picks_v2 directly
// This fixes the issue where the analyzer fails to update job status to 'done'

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from '../_shared/cors.ts'
import { findOddInOrganized, oddsWithinTolerance, checkProbOddsCoherence } from '../_shared/odds-selector.ts'
import { OPPORTUNITIES_THRESHOLD, OPPORTUNITIES_THRESHOLD_PERCENT, MAX_OPPORTUNITIES_PER_DAY } from '../_shared/constants.ts'

/** Get next day string YYYY-MM-DD */
function getNextDay(dateStr: string): string {
    const d = new Date(dateStr + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().split('T')[0];
}

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    const logs: string[] = [];
    const log = (msg: string) => { console.log(msg); logs.push(msg); };

    try {
        const sbUrl = Deno.env.get('SUPABASE_URL')!;
        const sbKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(sbUrl, sbKey);

        const { date } = await req.json();
        if (!date) throw new Error('date is required (YYYY-MM-DD)');

        log(`[OPP-V8.1] Fetching picks >=83% for date: ${date}`);

        // ═══════════════════════════════════════════════════════════════
        // STEP 1: Get daily matches for the date (use match_date for reliability)
        // ═══════════════════════════════════════════════════════════════
        const { data: dailyMatches, error: matchesError } = await supabase
            .from('daily_matches')
            .select('api_fixture_id, home_team, away_team, league_name, match_time, home_team_logo, away_team_logo')
            .eq('match_date', date);

        if (matchesError) throw matchesError;

        let fixtureIds: number[] = [];
        const dailyByFixture = new Map<number, any>();

        if (dailyMatches && dailyMatches.length > 0) {
            fixtureIds = dailyMatches.map((m: any) => m.api_fixture_id);
            dailyMatches.forEach((m: any) => dailyByFixture.set(m.api_fixture_id, m));
            log(`[OPP-V8.1] ${dailyMatches.length} daily matches from DB`);
        } else {
            // ═══════════════════════════════════════════════════════════════
            // FALLBACK: daily_matches empty (stale cleanup or API issue).
            // Recover fixture IDs from value_picks_v2 by date range.
            // This ensures past dates with verified picks still show.
            // ═══════════════════════════════════════════════════════════════
            log(`[OPP-V8.1] No matches in daily_matches for ${date}, trying fallback...`);

            // Bogotá = UTC-5: 00:00 Bogotá = 05:00 UTC
            const bogotaStart = `${date}T05:00:00+00:00`;
            const bogotaEnd = `${getNextDay(date)}T05:00:00+00:00`;

            const { data: fallbackPicks } = await supabase
                .from('value_picks_v2')
                .select('fixture_id')
                .gte('created_at', bogotaStart)
                .lt('created_at', bogotaEnd);

            if (fallbackPicks && fallbackPicks.length > 0) {
                fixtureIds = [...new Set(fallbackPicks.map((p: any) => p.fixture_id))];
                log(`[OPP-V8.1] Fallback: recovered ${fixtureIds.length} fixture IDs from value_picks_v2`);
            } else {
                // Second fallback: try reports_v2
                const { data: fallbackReports } = await supabase
                    .from('reports_v2')
                    .select('fixture_id')
                    .gte('created_at', bogotaStart)
                    .lt('created_at', bogotaEnd);

                if (fallbackReports && fallbackReports.length > 0) {
                    fixtureIds = [...new Set(fallbackReports.map((r: any) => r.fixture_id))];
                    log(`[OPP-V8.1] Fallback: recovered ${fixtureIds.length} fixture IDs from reports_v2`);
                } else {
                    log(`[OPP-V8.1] No data found for ${date} in any source`);
                    return jsonResponse({ success: true, message: 'No hay partidos programados.', parlays: [], singles: [], stats: { matches: 0 }, debug_logs: logs });
                }
            }
        }

        // NOTE: Step 1.5 (analysis_jobs_v2 fallback) was REMOVED.
        // It had timezone bugs (+05:00 instead of -05:00 for Bogotá) that caused
        // fixture IDs from other dates to contaminate results.
        // daily_matches.match_date is the single source of truth, with value_picks_v2 as fallback.
        const allDoneJobs = null; // kept as null for downstream compat (lines below use ?. fallback)

        log(`[OPP-V8.1] Using ${fixtureIds.length} fixture IDs`);

        // ═══════════════════════════════════════════════════════════════
        // STEP 2: DIRECT DATA ACCESS - Skip jobs table entirely
        // Query reports_v2 and value_picks_v2 directly by fixture_id
        // This is immune to job status issues (analyzing/done/failed)
        // ═══════════════════════════════════════════════════════════════

        // 2A: Get reports directly by fixture_id (ordered by newest first)
        let reports: any[] | null = null;
        const { data: reportsDirect, error: reportsError } = await supabase
            .from('reports_v2')
            .select('job_id, fixture_id, report_packet, created_at')
            .in('fixture_id', fixtureIds)
            .order('created_at', { ascending: false });

        if (reportsError) log(`[OPP-V8.1] reports_v2 error: ${reportsError.message}`);

        // Deduplicate: keep only the LATEST report per fixture_id
        if (reportsDirect && reportsDirect.length > 0) {
            const seenFixtures = new Set<number>();
            reports = reportsDirect.filter((r: any) => {
                if (seenFixtures.has(r.fixture_id)) return false;
                seenFixtures.add(r.fixture_id);
                return true;
            });
            if (reports.length < reportsDirect.length) {
                log(`[OPP-V8.1] Deduplicated: ${reportsDirect.length} -> ${reports.length} reports (removed stale duplicates)`);
            }
        } else {
            reports = reportsDirect;
        }

        // 2B: Get value_picks directly by fixture_id
        const { data: valuePicks, error: vpError } = await supabase
            .from('value_picks_v2')
            .select('job_id, fixture_id, market, selection, p_model, odds, odds_source, decision, confidence, result, verified_at, actual_score')
            .in('fixture_id', fixtureIds)
            .gte('p_model', 0.50);

        if (vpError) log(`[OPP-V8.1] value_picks_v2 error: ${vpError.message}`);

        // 2C: Check for jobs (status info + fallback source, exclude parlay jobs)
        const { data: jobs } = await supabase
            .from('analysis_jobs_v2')
            .select('id, fixture_id, status, created_at')
            .in('fixture_id', fixtureIds)
            .or('analysis_type.eq.standard,analysis_type.is.null')
            .order('created_at', { ascending: false });

        // 2D: FALLBACK - If fewer reports than done jobs, try via job_id
        const doneJobCount = allDoneJobs?.length || (jobs || []).filter((j: any) => j.status === 'done').length;
        if ((reports?.length || 0) < doneJobCount && (allDoneJobs || jobs) ) {
            const jobSource = allDoneJobs || (jobs || []).filter((j: any) => j.status === 'done');
            const latestJobPerFixture = new Map<number, string>();
            jobSource.forEach((j: any) => {
                if (!latestJobPerFixture.has(j.fixture_id)) latestJobPerFixture.set(j.fixture_id, j.id);
            });
            const jobIds = Array.from(latestJobPerFixture.values());
            log(`[OPP-V8.1] Only ${reports?.length || 0} reports for ${doneJobCount} done jobs. Trying fallback via ${jobIds.length} job_ids...`);
            const { data: reportsByJob } = await supabase
                .from('reports_v2')
                .select('job_id, fixture_id, report_packet, created_at')
                .in('job_id', jobIds)
                .order('created_at', { ascending: false });
            if (reportsByJob && reportsByJob.length > 0) {
                // Merge: add any reports not already found
                const existingJobIds = new Set((reports || []).map((r: any) => r.job_id));
                const newReports = reportsByJob.filter((r: any) => !existingJobIds.has(r.job_id));
                if (newReports.length > 0) {
                    reports = [...(reports || []), ...newReports];
                    log(`[OPP-V8.1] Fallback: added ${newReports.length} extra reports via job_id (total: ${reports.length})`);
                }
            }
        }

        const jobsByFixture = new Map<number, any>();
        (jobs || []).forEach((j: any) => {
            if (!jobsByFixture.has(j.fixture_id)) jobsByFixture.set(j.fixture_id, j);
        });

        // Load etl_context (organized odds) ONLY for jobs whose reports we actually use,
        // so cross-val can use real bookmaker catalog as second defense layer.
        const jobIdsWithReports = Array.from(new Set((reports || []).map((r: any) => r.job_id).filter(Boolean)));
        const etlOddsByJobId = new Map<string, any>();
        if (jobIdsWithReports.length > 0) {
            const { data: etlRows, error: etlErr } = await supabase
                .from('analysis_jobs_v2')
                .select('id, etl_context')
                .in('id', jobIdsWithReports);
            if (etlErr) {
                log(`[OPP-V8.1] etl_context fetch warning: ${etlErr.message}`);
            } else if (etlRows) {
                for (const row of etlRows) {
                    const ctx = row.etl_context;
                    const organized = ctx?.odds || ctx?.payload?.odds || null;
                    if (organized && organized._meta?.bookmaker) {
                        etlOddsByJobId.set(row.id, organized);
                    }
                }
                log(`[OPP-V8.1] Loaded etl_odds for ${etlOddsByJobId.size}/${jobIdsWithReports.length} jobs`);
            }
        }

        const doneCount = (jobs || []).filter((j: any) => j.status === 'done').length;
        // Only count jobs as "analyzing" if created within last 10 minutes (ignore stuck jobs)
        const STALE_THRESHOLD_MS = 10 * 60 * 1000;
        const now = Date.now();
        const analyzingCount = (jobs || []).filter((j: any) => {
            if (j.status !== 'analyzing' && j.status !== 'interpret') return false;
            const age = now - new Date(j.created_at).getTime();
            return age < STALE_THRESHOLD_MS;
        }).length;

        log(`[OPP-V8.1] Query results: ${reports?.length || 0} reports, ${valuePicks?.length || 0} value_picks, jobs: ${doneCount} done + ${analyzingCount} analyzing`);

        // ═══════════════════════════════════════════════════════════════
        // STEP 3: Extract picks >= threshold% from ALL sources
        // ═══════════════════════════════════════════════════════════════
        const highProbPicks: any[] = [];
        const seenPickKeys = new Set<string>();

        // Build job_id -> fixture_id mapping for fallback resolution
        const jobToFixture = new Map<string, number>();
        (jobs || []).forEach((j: any) => jobToFixture.set(j.id, j.fixture_id));

        // Build result lookup map from value_picks_v2 (fixture_market_selection → result)
        const vpResultMap = new Map<string, { result: string; verified_at: string | null; actual_score: string | null }>();
        if (valuePicks && valuePicks.length > 0) {
            for (const vp of valuePicks) {
                if (vp.result && vp.result !== 'PENDING') {
                    const key = `${vp.fixture_id}_${(vp.market || '').toLowerCase()}_${(vp.selection || '').toLowerCase()}`;
                    vpResultMap.set(key, { result: vp.result, verified_at: vp.verified_at, actual_score: vp.actual_score });
                }
            }
        }

        // SOURCE A: Extract from report_packet.pronosticos
        if (reports && reports.length > 0) {
            for (const report of reports) {
                // Try direct lookup, then fallback via job's fixture_id
                let dailyMatch = dailyByFixture.get(report.fixture_id);
                let resolvedFixtureId = report.fixture_id;
                if (!dailyMatch && report.job_id) {
                    const jobFixtureId = jobToFixture.get(report.job_id);
                    if (jobFixtureId) {
                        dailyMatch = dailyByFixture.get(jobFixtureId);
                        if (dailyMatch) resolvedFixtureId = jobFixtureId;
                    }
                }
                // Last resort: extract team info from report_packet itself
                if (!dailyMatch) {
                    let packet: any;
                    try {
                        packet = typeof report.report_packet === 'string'
                            ? JSON.parse(report.report_packet)
                            : report.report_packet;
                    } catch { packet = null; }

                    const titulo = packet?.header_partido?.titulo || packet?.meta?.match_title || '';
                    const parts = titulo.split(' vs ');
                    if (parts.length === 2) {
                        dailyMatch = {
                            api_fixture_id: report.fixture_id,
                            home_team: parts[0].trim(),
                            away_team: parts[1].trim(),
                            league_name: packet?.meta?.league_name || 'Unknown',
                            home_team_logo: '',
                            away_team_logo: ''
                        };
                        dailyByFixture.set(report.fixture_id, dailyMatch);
                        log(`[OPP-V8.1] Extracted team info from report: ${dailyMatch.home_team} vs ${dailyMatch.away_team}`);
                    } else {
                        log(`[OPP-V8.1] Report fixture_id ${report.fixture_id} - no team info available, skipping`);
                        continue;
                    }
                }

                let packet: any;
                try {
                    packet = typeof report.report_packet === 'string'
                        ? JSON.parse(report.report_packet)
                        : report.report_packet;
                } catch (parseErr) {
                    log(`[OPP-V8.1] Failed to parse report_packet for fixture ${report.fixture_id}`);
                    continue;
                }

                if (!packet) continue;

                // Try multiple paths for pronosticos
                const pronosticos = packet.pronosticos
                    || packet.predicciones_finales?.detalle
                    || [];

                if (!Array.isArray(pronosticos)) {
                    log(`[OPP-V8.1] pronosticos not array for fixture ${report.fixture_id}, type: ${typeof pronosticos}`);
                    continue;
                }

                log(`[OPP-V8.1] Fixture ${resolvedFixtureId} (${dailyMatch.home_team} vs ${dailyMatch.away_team}): ${pronosticos.length} pronosticos found`);

                const etlOdds = report.job_id ? etlOddsByJobId.get(report.job_id) : null;

                pronosticos.forEach((p: any, idx: number) => {
                    // Extract probability from any possible field name
                    const probRaw = p.probabilidad_calculada_porcentaje
                        || p.probabilidad_estimado_porcentaje
                        || p.probabilidad_derbix
                        || p.probabilidad
                        || p.probability
                        || p.confidence_score
                        || p.confianza
                        || 0;
                    let prob = typeof probRaw === 'string' ? parseFloat(probRaw.replace('%', '').replace('+', '')) : probRaw;

                    // Auto-detect decimal format (0.85 → 85)
                    if (prob > 0 && prob < 1) prob = prob * 100;

                    // Only cuota_actual is trusted — other fields were inventable slots.
                    const rawOdds = p.cuota_actual ?? null;
                    let odds = rawOdds !== null
                        ? (typeof rawOdds === 'string' ? parseFloat(rawOdds) : rawOdds)
                        : null;

                    // Cross-val secondary defense: if we have etl_context odds for this report,
                    // verify the pick's market+selection exists and the odds match within 5%.
                    // If etlOdds is null (older reports pre-fix), fall back to range validation only.
                    if (etlOdds) {
                        const xv = findOddInOrganized(etlOdds, p.mercado || '', p.seleccion || '', { homeTeam: dailyMatch.home_team, awayTeam: dailyMatch.away_team });
                        if (!xv.match) {
                            log(`[OPP-V8.1]   Pick[${idx}] DISCARDED (xval ${xv.reason}): ${p.mercado} | ${p.seleccion}`);
                            return;
                        }
                        if (odds !== null && isFinite(odds) && !oddsWithinTolerance(odds, xv.match.val, 0.05)) {
                            log(`[OPP-V8.1]   Pick[${idx}] DISCARDED (tolerance llm=${odds} vs real=${xv.match.val}): ${p.mercado} | ${p.seleccion}`);
                            return;
                        }
                        // Authoritative: overwrite with real bookmaker odds.
                        odds = xv.match.val;
                    }

                    // Range: 1.01 (min mathematical) to 15.0 (above = inventado for common markets).
                    const MIN_ODDS = 1.01;
                    const MAX_ODDS = 15.0;
                    const validOdds = odds !== null && !isNaN(odds) && odds >= MIN_ODDS && odds <= MAX_ODDS
                        ? odds
                        : null;

                    // Discard pick if no real odds (gets reported in logs for audit).
                    if (validOdds === null) {
                        log(`[OPP-V8.1]   Pick[${idx}] DISCARDED (no real odds): ${p.mercado} | ${p.seleccion}`);
                        return; // exits the current forEach callback
                    }

                    // SANITY: probability ↔ odds coherence (catches inflated probs vs absurd odds).
                    const sanityA = checkProbOddsCoherence(prob / 100, validOdds);
                    if (!sanityA.coherent) {
                        log(`[OPP-V8.1]   Pick[${idx}] DISCARDED (sanity ${sanityA.reason}): ${p.mercado} | ${p.seleccion} prob=${prob.toFixed(1)}% odds=${validOdds}`);
                        return;
                    }

                    // Log every pick for debugging
                    if (idx < 5) {
                        log(`[OPP-V8.1]   Pick[${idx}]: ${p.mercado} | ${p.seleccion} | prob=${prob.toFixed(1)}% | odds=${validOdds || 'null'}`);
                    }

                    // FILTER >= OPPORTUNITIES_THRESHOLD_PERCENT (V9 pipeline, 2026-05-05)
                    if (prob >= OPPORTUNITIES_THRESHOLD_PERCENT) {
                        const pickKey = `${resolvedFixtureId}_${(p.mercado || '').toLowerCase()}_${(p.seleccion || '').toLowerCase()}`;
                        if (seenPickKeys.has(pickKey)) return;
                        seenPickKeys.add(pickKey);

                        // Lookup result from value_picks_v2
                        const resultKey = `${resolvedFixtureId}_${(p.mercado || '').toLowerCase()}_${(p.seleccion || '').toLowerCase()}`;
                        const vpRes = vpResultMap.get(resultKey);

                        highProbPicks.push({
                            id: `${report.job_id}_${p.mercado}_${p.seleccion}`,
                            job_id: report.job_id,
                            fixture_id: resolvedFixtureId,
                            market: p.mercado || 'Mercado',
                            selection: p.seleccion || 'Seleccion',
                            p_model: prob / 100,
                            decision: "ALTA",
                            home_team: dailyMatch.home_team,
                            away_team: dailyMatch.away_team,
                            league: dailyMatch.league_name,
                            odds: validOdds,
                            logo_home: dailyMatch.home_team_logo,
                            logo_away: dailyMatch.away_team_logo,
                            tesis: packet?.analisis_profundo?.razonamiento_central || packet?.analisis_profundo?.factor_psicologico || "Análisis IA V8.",
                            tactica: packet?.analisis_profundo?.matchup_tactico || "Ver reporte completo.",
                            stake: p.stake_recomendado || null,
                            result: vpRes?.result || 'PENDING',
                            verified_at: vpRes?.verified_at || null,
                            actual_score: vpRes?.actual_score || null
                        });
                    }
                });
            }
        }

        // SOURCE B: Complement with value_picks_v2
        if (valuePicks && valuePicks.length > 0) {
            log(`[OPP-V8.1] Checking ${valuePicks.length} value_picks_v2 entries...`);
            for (const vp of valuePicks) {
                let prob = vp.p_model;
                // Normalize: if stored as decimal (0.85), convert to percentage (85)
                if (prob > 0 && prob < 1) prob = prob * 100;
                // If stored as percentage already (85), keep as is
                if (prob < 83) continue;

                const pickKey = `${vp.fixture_id}_${(vp.market || '').toLowerCase()}_${(vp.selection || '').toLowerCase()}`;
                if (seenPickKeys.has(pickKey)) continue;
                seenPickKeys.add(pickKey);

                const dailyMatch = dailyByFixture.get(vp.fixture_id);
                if (!dailyMatch) continue;

                const MIN_ODDS = 1.01;
                const MAX_ODDS = 15.0;
                // Two conditions: reasonable range + odds_source='real' (traceability).
                // If odds_source is null (pre-migration pick), accept by range (safety net).
                const inRange = vp.odds && vp.odds >= MIN_ODDS && vp.odds <= MAX_ODDS;
                const isRealOrLegacy = vp.odds_source === 'real' || vp.odds_source == null;
                let validOdds: number | null = inRange && isRealOrLegacy ? vp.odds : null;
                if (validOdds === null) {
                    log(`[OPP-V8.1] ValuePick DISCARDED (odds=${vp.odds}, source=${vp.odds_source}): ${vp.market} | ${vp.selection}`);
                    continue;
                }

                // CROSS-VAL: re-validate against the bookmaker catalog when we have it for this job.
                // This closes the historical gap where pre-fix picks (composite/asian thresholds,
                // wrong-market odds) survived in value_picks_v2 and showed up here unchecked.
                const vpEtlOdds = vp.job_id ? etlOddsByJobId.get(vp.job_id) : null;
                if (vpEtlOdds) {
                    const xv = findOddInOrganized(vpEtlOdds, vp.market || '', vp.selection || '', { homeTeam: dailyMatch.home_team, awayTeam: dailyMatch.away_team });
                    if (!xv.match) {
                        log(`[OPP-V8.1] ValuePick DISCARDED (xval ${xv.reason}): ${vp.market} | ${vp.selection}`);
                        continue;
                    }
                    if (!oddsWithinTolerance(validOdds, xv.match.val, 0.05)) {
                        log(`[OPP-V8.1] ValuePick DISCARDED (tolerance stored=${validOdds} vs real=${xv.match.val}): ${vp.market} | ${vp.selection}`);
                        continue;
                    }
                    // Authoritative: align with bookmaker truth.
                    validOdds = xv.match.val;
                }

                // SANITY: probability ↔ odds coherence.
                const sanityB = checkProbOddsCoherence(prob / 100, validOdds);
                if (!sanityB.coherent) {
                    log(`[OPP-V8.1] ValuePick DISCARDED (sanity ${sanityB.reason}): ${vp.market} | ${vp.selection} prob=${prob.toFixed(1)}% odds=${validOdds}`);
                    continue;
                }

                highProbPicks.push({
                    id: `vp_${vp.job_id}_${vp.market}_${vp.selection}`,
                    job_id: vp.job_id,
                    fixture_id: vp.fixture_id,
                    market: vp.market,
                    selection: vp.selection,
                    p_model: prob >= 1 ? prob / 100 : prob,
                    decision: vp.decision || "ALTA",
                    home_team: dailyMatch.home_team,
                    away_team: dailyMatch.away_team,
                    league: dailyMatch.league_name,
                    odds: validOdds,
                    logo_home: dailyMatch.home_team_logo,
                    logo_away: dailyMatch.away_team_logo,
                    tesis: "Análisis IA V8.",
                    tactica: "Ver reporte completo.",
                    result: vp.result || 'PENDING',
                    verified_at: vp.verified_at || null,
                    actual_score: vp.actual_score || null
                });
            }
        }

        // SOURCE C: Fallback - Extract from 'analisis' table (dashboardData.predicciones_finales)
        // This covers cases where reports_v2 was cleaned up but analisis still has the data
        if (highProbPicks.length === 0 || (reports?.length || 0) < (dailyMatches?.length || 0) / 2) {
            const { data: analisisRows } = await supabase
                .from('analisis')
                .select('partido_id, resultado_analisis')
                .in('partido_id', fixtureIds);

            if (analisisRows && analisisRows.length > 0) {
                log(`[OPP-V8.1] SOURCE C: Checking ${analisisRows.length} analisis entries...`);
                for (const row of analisisRows) {
                    const dailyMatch = dailyByFixture.get(row.partido_id);
                    if (!dailyMatch) continue;

                    const result = row.resultado_analisis;
                    if (!result) continue;

                    // Extract pronosticos from dashboardData
                    const dashboard = result.dashboardData || result;
                    const preds = dashboard?.predicciones_finales?.detalle
                        || dashboard?.pronosticos
                        || [];

                    if (!Array.isArray(preds)) continue;

                    for (const p of preds) {
                        const probRaw = p.probabilidad_estimado_porcentaje
                            || p.probabilidad_calculada_porcentaje
                            || p.probabilidad_derbix
                            || p.probabilidad
                            || 0;
                        let prob = typeof probRaw === 'string' ? parseFloat(probRaw.replace('%', '')) : probRaw;
                        if (prob > 0 && prob < 1) prob = prob * 100;
                        if (prob < 83) continue;

                        const pickKey = `${row.partido_id}_${(p.mercado || '').toLowerCase()}_${(p.seleccion || '').toLowerCase()}`;
                        if (seenPickKeys.has(pickKey)) continue;
                        seenPickKeys.add(pickKey);

                        // Lookup result from value_picks_v2
                        const cResKey = `${row.partido_id}_${(p.mercado || '').toLowerCase()}_${(p.seleccion || '').toLowerCase()}`;
                        const cRes = vpResultMap.get(cResKey);

                        // Only cuota_actual is trusted (same as Source A).
                        const cOddsRaw = p.cuota_actual ?? null;
                        const cOdds = cOddsRaw !== null
                            ? (typeof cOddsRaw === 'string' ? parseFloat(cOddsRaw) : cOddsRaw)
                            : null;
                        const MIN_ODDS_C = 1.01;
                        const MAX_ODDS_C = 15.0;
                        const cValidOdds = cOdds !== null && !isNaN(cOdds) && cOdds >= MIN_ODDS_C && cOdds <= MAX_ODDS_C
                            ? cOdds
                            : null;
                        if (cValidOdds === null) {
                            log(`[OPP-V8.1]   Source C pick DISCARDED (no real odds): ${p.mercado} | ${p.seleccion}`);
                            continue;
                        }

                        // SANITY: probability ↔ odds coherence. Source C lacks per-job etl_context
                        // for cross-val, so this is the last line of defense for analisis-cached picks.
                        const sanityC = checkProbOddsCoherence(prob / 100, cValidOdds);
                        if (!sanityC.coherent) {
                            log(`[OPP-V8.1]   Source C pick DISCARDED (sanity ${sanityC.reason}): ${p.mercado} | ${p.seleccion} prob=${prob.toFixed(1)}% odds=${cValidOdds}`);
                            continue;
                        }

                        highProbPicks.push({
                            id: `analisis_${row.partido_id}_${p.mercado}_${p.seleccion}`,
                            job_id: null,
                            fixture_id: row.partido_id,
                            market: p.mercado || 'Mercado',
                            selection: p.seleccion || 'Seleccion',
                            p_model: prob / 100,
                            decision: "ALTA",
                            home_team: dailyMatch.home_team,
                            away_team: dailyMatch.away_team,
                            league: dailyMatch.league_name,
                            odds: cValidOdds,
                            logo_home: dailyMatch.home_team_logo,
                            logo_away: dailyMatch.away_team_logo,
                            tesis: "Análisis IA V8.",
                            tactica: "Ver reporte completo.",
                            result: cRes?.result || 'PENDING',
                            verified_at: cRes?.verified_at || null,
                            actual_score: cRes?.actual_score || null
                        });
                    }
                }
                log(`[OPP-V8.1] SOURCE C: Total picks after analisis fallback: ${highProbPicks.length}`);
            }
        }

        // ═══════════════════════════════════════════════════════════════
        // STEP 4: Return results
        // ═══════════════════════════════════════════════════════════════
        if (highProbPicks.length === 0) {
            const hasAnalysis = (reports?.length || 0) > 0 || (valuePicks?.length || 0) > 0;
            const hasOnlyInProgress = !hasAnalysis && analyzingCount > 0;

            let message = '';
            if (hasOnlyInProgress) {
                message = `Hay ${analyzingCount} análisis en progreso. Espera unos segundos y vuelve a intentar.`;
            } else if (hasAnalysis) {
                // We found reports but no picks >= threshold%
                const allProbs = (valuePicks || []).map((vp: any) => {
                    const p = vp.p_model > 0 && vp.p_model < 1 ? vp.p_model * 100 : vp.p_model;
                    return p;
                }).sort((a: number, b: number) => b - a);
                const maxProb = allProbs.length > 0 ? allProbs[0].toFixed(1) : '?';
                message = `Se analizaron ${reports?.length || 0} partidos. Máxima probabilidad encontrada: ${maxProb}%. No hay picks >= ${OPPORTUNITIES_THRESHOLD_PERCENT}%.`;
            } else {
                message = 'No hay análisis completados para esta fecha. Ejecuta el análisis primero.';
            }

            return jsonResponse({
                success: true,
                message,
                parlays: [],
                singles: [],
                stats: {
                    matches: dailyMatches?.length || 0,
                    reports: reports?.length || 0,
                    value_picks: valuePicks?.length || 0,
                    picks_found: 0,
                    jobs_done: doneCount,
                    jobs_analyzing: analyzingCount,
                    in_progress: hasOnlyInProgress ? analyzingCount : 0
                },
                debug_logs: logs
            });
        }

        // Sort by Probability Descending, then by fixture_id for deterministic tiebreaking
        highProbPicks.sort((a, b) => b.p_model - a.p_model || a.fixture_id - b.fixture_id);

        // CAP: Top-N opportunities by probability (single source of truth: shared constants)
        if (highProbPicks.length > MAX_OPPORTUNITIES_PER_DAY) {
            log(`[OPP-V8.1] CAP: Trimming ${highProbPicks.length} → ${MAX_OPPORTUNITIES_PER_DAY} picks (keeping top probability)`);
            highProbPicks.length = MAX_OPPORTUNITIES_PER_DAY;
        }

        log(`[OPP-V8.1] SUCCESS: ${highProbPicks.length} picks found (${highProbPicks.filter((p: any) => p.odds).length} with odds)`);

        // ═══════════════════════════════════════════════════════════════
        // STEP 5: SYNC to value_picks_v2
        // Picks extracted from reports_v2 or analisis may NOT exist in
        // value_picks_v2. The verifier needs them there to work.
        // This ensures every displayed Oportunidad can be verified.
        // ═══════════════════════════════════════════════════════════════
        try {
            // Get all existing picks in value_picks_v2 for these fixtures (WITH p_model and odds for UPSERT)
            const pickFixtureIds = [...new Set(highProbPicks.map((p: any) => p.fixture_id))];
            const { data: existingVPs } = await supabase
                .from('value_picks_v2')
                .select('id, fixture_id, market, selection, p_model, odds')
                .in('fixture_id', pickFixtureIds);

            // Case-insensitive key mapping for dedup
            const existingMap = new Map<string, any>();
            (existingVPs || []).forEach((vp: any) => {
                const key = `${vp.fixture_id}_${(vp.market || '').toLowerCase()}_${(vp.selection || '').toLowerCase()}`;
                existingMap.set(key, vp);
            });

            // Classify picks into: INSERT (missing) or UPDATE (existing but with worse data)
            const picksToInsert: any[] = [];
            const picksToUpdate: Array<{ id: string; p_model?: number; odds?: number }> = [];

            for (const p of highProbPicks) {
                const key = `${p.fixture_id}_${(p.market || '').toLowerCase()}_${(p.selection || '').toLowerCase()}`;
                const existing = existingMap.get(key);

                if (!existing) {
                    // MISSING — needs INSERT
                    picksToInsert.push(p);
                } else {
                    // EXISTS — check if we have BETTER data
                    const existingProb = existing.p_model > 1 ? existing.p_model / 100 : existing.p_model;
                    const incomingProb = p.p_model > 1 ? p.p_model / 100 : p.p_model;
                    const betterProb = incomingProb >= OPPORTUNITIES_THRESHOLD && existingProb < OPPORTUNITIES_THRESHOLD;
                    const betterOdds = p.odds && p.odds >= 1.40 && (!existing.odds || existing.odds <= 1.0);

                    if (betterProb || betterOdds) {
                        const updates: any = { id: existing.id };
                        if (betterProb) updates.p_model = incomingProb;
                        if (betterOdds) updates.odds = p.odds;
                        picksToUpdate.push(updates);
                    }

                    // Map the real UUID back to the highProbPick for the frontend
                    p.id = existing.id;
                }
            }

            // UPSERT: Update existing picks with better data
            if (picksToUpdate.length > 0) {
                for (const upd of picksToUpdate) {
                    const updateData: any = {};
                    if (upd.p_model !== undefined) updateData.p_model = upd.p_model;
                    if (upd.odds !== undefined) updateData.odds = upd.odds;
                    await supabase.from('value_picks_v2').update(updateData).eq('id', upd.id);
                }
                log(`[OPP-V8.1] SYNC: Updated ${picksToUpdate.length} picks with corrected p_model/odds`);
            }

            // INSERT missing picks
            if (picksToInsert.length > 0) {
                const payload = picksToInsert.map((p: any) => ({
                    job_id: p.job_id || null,
                    fixture_id: p.fixture_id,
                    market: p.market,
                    selection: p.selection,
                    p_model: p.p_model, // already 0-1
                    odds: p.odds || null,
                    // These picks reached here via the odds validation in Sources A/B/C,
                    // so their odds are already filtered to real (1.01–15.0, cuota_actual only).
                    odds_source: p.odds ? 'real' : 'unavailable',
                    decision: 'BET',
                    confidence: 8,
                    engine_version: 'V8-SYNC',
                    result: 'PENDING',
                    created_at: new Date().toISOString(),
                }));

                const { error: syncErr } = await supabase
                    .from('value_picks_v2')
                    .insert(payload);

                if (syncErr) {
                    log(`[OPP-V8.1] SYNC: Error inserting ${payload.length} picks: ${syncErr.message}`);
                } else {
                    log(`[OPP-V8.1] SYNC: Inserted ${payload.length} missing picks into value_picks_v2`);
                    // Update the pick IDs with real UUIDs for the frontend
                    const { data: insertedPicks } = await supabase
                        .from('value_picks_v2')
                        .select('id, fixture_id, market, selection')
                        .in('fixture_id', picksToInsert.map((p: any) => p.fixture_id))
                        .eq('engine_version', 'V8-SYNC');

                    if (insertedPicks) {
                        const idMap = new Map<string, string>();
                        insertedPicks.forEach((ip: any) => {
                            idMap.set(`${ip.fixture_id}_${(ip.market || '').toLowerCase()}_${(ip.selection || '').toLowerCase()}`, ip.id);
                        });
                        for (const p of highProbPicks) {
                            const key = `${p.fixture_id}_${(p.market || '').toLowerCase()}_${(p.selection || '').toLowerCase()}`;
                            if (idMap.has(key)) {
                                p.id = idMap.get(key);
                            }
                        }
                    }
                }
            }

            if (picksToInsert.length === 0 && picksToUpdate.length === 0) {
                log(`[OPP-V8.1] SYNC: All ${highProbPicks.length} picks already in value_picks_v2 with correct data`);
            }
        } catch (syncErr: any) {
            log(`[OPP-V8.1] SYNC failed (non-blocking): ${syncErr.message}`);
        }

        // ═══════════════════════════════════════════════════════════════
        // STEP 5.5: PERSIST OPPORTUNITY SELECTION
        // Mark the final top-20 picks as is_opportunity=true in value_picks_v2.
        // This ensures the same picks appear on every page refresh.
        // Must run AFTER SYNC (Step 5) so all picks have real UUIDs.
        // ═══════════════════════════════════════════════════════════════
        try {
            // RESET: Clear previous opportunity flags for this date
            const { error: resetErr } = await supabase
                .from('value_picks_v2')
                .update({ is_opportunity: false, opportunity_rank: null, opportunity_date: null })
                .eq('opportunity_date', date);
            if (resetErr) log(`[OPP-V8.1] PERSIST reset warning: ${resetErr.message}`);

            // SET: Mark each of the final picks as opportunity with rank
            let persistedCount = 0;
            for (let i = 0; i < highProbPicks.length; i++) {
                const p = highProbPicks[i];
                if (!p.id) continue;
                const { error: setErr } = await supabase
                    .from('value_picks_v2')
                    .update({
                        is_opportunity: true,
                        opportunity_rank: i + 1,
                        opportunity_date: date
                    })
                    .eq('id', p.id);
                if (!setErr) persistedCount++;
            }
            log(`[OPP-V8.1] PERSIST: Marked ${persistedCount}/${highProbPicks.length} picks as opportunities for ${date}`);
        } catch (persistErr: any) {
            log(`[OPP-V8.1] PERSIST failed (non-blocking): ${persistErr.message}`);
        }

        // Register in profitability tracking (non-blocking)
        try {
            const picksWithOdds = highProbPicks.filter((p: any) => p.odds);
            if (picksWithOdds.length > 0) {
                const profitRes = await fetch(`${sbUrl}/functions/v1/v2-track-profitability`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sbKey}` },
                    body: JSON.stringify({ action: 'register', date, picks: picksWithOdds })
                });
                const profitData = await profitRes.json();
                if (profitData.success) log(`[OPP-V8.1] Registered ${profitData.picks_registered} picks in profitability`);
            }
        } catch (profitErr: any) {
            log(`[OPP-V8.1] Profitability tracking failed (non-blocking): ${profitErr.message}`);
        }

        return jsonResponse({
            success: true,
            parlays: [],
            singles: highProbPicks,
            stats: {
                matches: dailyMatches?.length || 0,
                reports: reports?.length || 0,
                value_picks: valuePicks?.length || 0,
                picks_found: highProbPicks.length,
                picks_with_odds: highProbPicks.filter((p: any) => p.odds).length,
                jobs_done: doneCount,
                jobs_analyzing: analyzingCount,
                in_progress: analyzingCount
            },
            debug_logs: logs
        });

    } catch (e: any) {
        log(`Error: ${e.message}`);
        return new Response(JSON.stringify({
            success: false,
            error: e.message || "Unknown error",
            parlays: [],
            singles: [],
            debug_logs: [e.message, ...logs]
        }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
});

function jsonResponse(body: any) {
    return new Response(JSON.stringify(body), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
}
