// supabase/functions/v2-create-job-sportmonks/index.ts
// Motor ETL con SportMonks API - Reemplazo de API-Football
// Versión: 3.0.0-SPORTMONKS

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from '../_shared/cors.ts'
import {
    fetchSportMonks,
    getFixtureComplete,
    getTeamFixtures,
    getH2H,
    getStandings,
    getPredictions,
    getValueBets
} from '../_shared/sportmonks-client.ts'
import { organizeOddsForAI, normalizeDetailedMatchHistory, normalizeSimpleForm } from '../_shared/sportmonks-normalizer.ts'

const ENGINE_VERSION = '5.0.0-SPORTMONKS-V8';

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    const startTime = Date.now();
    let supabase: any;
    let jobId: string | null = null;

    try {
        const { fixture_id } = await req.json();

        if (!fixture_id) {
            throw new Error('fixture_id is required');
        }

        console.log(`[v2-create-job-sportmonks] Starting ETL for SportMonks fixture: ${fixture_id}`);

        const sbUrl = Deno.env.get('SUPABASE_URL')!;
        const sbKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        supabase = createClient(sbUrl, sbKey);

        // NOTE: Do NOT delete old data here. The analyzer (v3-ai-analyzer) handles
        // cleanup AFTER successful completion. Deleting here would destroy data
        // if the analyzer fails, leaving the user with nothing.

        // Create job record
        const { data: job, error: jobError } = await supabase
            .from('analysis_jobs_v2')
            .insert({
                fixture_id,
                status: 'etl',
                current_motor: 'SPORTMONKS-ETL',
                engine_version: ENGINE_VERSION
            })
            .select()
            .single();

        if (jobError) throw jobError;
        jobId = job.id;

        console.log(`[v2-create-job-sportmonks] Job created: ${jobId}`);

        // ═══════════════════════════════════════════════════════════════
        // STAGE 1: FETCH COMPLETE FIXTURE DATA (single call with includes)
        // ═══════════════════════════════════════════════════════════════
        console.log('[v2-create-job-sportmonks] Stage 1: Fetching complete fixture data...');

        const fixtureData = await getFixtureComplete(fixture_id);

        if (!fixtureData) {
            throw new Error(`Fixture ${fixture_id} not found in SportMonks`);
        }

        // Extract team IDs
        const homeTeam = fixtureData.participants?.find((p: any) => p.meta?.location === 'home');
        const awayTeam = fixtureData.participants?.find((p: any) => p.meta?.location === 'away');

        if (!homeTeam || !awayTeam) {
            throw new Error('Could not identify home/away teams');
        }

        const homeTeamId = homeTeam.id;
        const awayTeamId = awayTeam.id;
        const seasonId = fixtureData.season_id;

        console.log(`[v2-create-job-sportmonks] Teams: ${homeTeam.name} vs ${awayTeam.name}`);

        // ═══════════════════════════════════════════════════════════════
        // CRITICAL DATA QUALITY CHECK (State-Aware)
        // ═══════════════════════════════════════════════════════════════
        const hasStats = fixtureData.statistics && fixtureData.statistics.length > 0;
        const hasLineups = fixtureData.lineups && fixtureData.lineups.length > 0;

        // Check Match State (NS, LIVE, FT, etc.)
        const stateCode = fixtureData.state?.state;
        const isLiveOrFinished = ['LIVE', 'FT', 'AET', 'FT_PEN'].includes(stateCode);

        console.log(`[v2-create-job-sportmonks] State: ${stateCode} (Live/Fin: ${isLiveOrFinished}) | Stats: ${hasStats} | Lineups: ${hasLineups}`);

        // LOGIC:
        // 1. If Pre-Match (NS), we ALLOW clean slate (we rely on History).
        // 2. If Live/Finished, we EXPECT stats or lineups. If both missing -> Abort.

        if (isLiveOrFinished && !hasStats && !hasLineups) {
            console.warn(`[v2-create-job-sportmonks] ⚠️ INSUFFICIENT DATA for ${stateCode} match. Aborting.`);

            await supabase
                .from('analysis_jobs_v2')
                .update({
                    status: 'failed', // FIXED: Use 'failed' (valid enum) instead of 'insufficient_data'
                    error_message: 'Aborted: Match is LIVE/FT but missing stats & lineups.'
                })
                .eq('id', jobId);

            return new Response(JSON.stringify({
                success: false,
                error: 'INSUFFICIENT_DATA: Match is active/done but has no data.',
                job_id: jobId,
                status: 'failed'
            }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        // For NS (Not Started), we proceed even if !hasStats (normal).


        // ═══════════════════════════════════════════════════════════════
        // STAGE 2: FETCH ADDITIONAL DATA (parallel) - V8 UPGRADED
        // ═══════════════════════════════════════════════════════════════
        console.log('[v2-create-job-sportmonks] Stage 2: Fetching data (V8 Deep Dive + Perplexity)...');

        // V9: Historical matches include xGFixture when available (for rolling xG).
        // Lineups/coaches/weather are not included in history to limit payload size.
        const deepIncludes = ['participants', 'scores', 'venue', 'league', 'statistics', 'events', 'formations', 'referees', 'xGFixture'];

        // Fetch Perplexity context in parallel with data fetching (with 10s timeout)
        const sbUrl2 = Deno.env.get('SUPABASE_URL')!;
        const perplexityController = new AbortController();
        const perplexityTimeout = setTimeout(() => perplexityController.abort(), 10000); // 10s max
        const perplexityPromise = fetch(`${sbUrl2}/functions/v1/v2-perplexity-context`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
            },
            signal: perplexityController.signal,
            body: JSON.stringify({
                home_team: homeTeam.name,
                away_team: awayTeam.name,
                competition: fixtureData.league?.name || '',
                date: fixtureData.starting_at?.split('T')[0] || new Date().toISOString().split('T')[0]
            })
        }).then(r => { clearTimeout(perplexityTimeout); return r.json(); }).catch(err => {
            clearTimeout(perplexityTimeout);
            console.warn('[v2-create-job] Perplexity context failed (non-blocking):', err.message);
            return null;
        });

        const [
            homeHistory,
            awayHistory,
            h2h,
            standings,
            predictions,
            valueBets,
            perplexityResult
        ] = await Promise.all([
            getTeamFixtures(homeTeamId, 25, deepIncludes), // 25 matches (enough for 10 home + 10 away)
            getTeamFixtures(awayTeamId, 25, deepIncludes), // 25 matches
            getH2H(homeTeamId, awayTeamId),
            seasonId ? getStandings(seasonId) : Promise.resolve([]),
            getPredictions(fixture_id),
            getValueBets(fixture_id),
            perplexityPromise
        ]);

        console.log(`[v2-create-job-sportmonks] Data fetched:`);
        console.log(`  - Home raw history: ${homeHistory.length} matches`);
        console.log(`  - Away raw history: ${awayHistory.length} matches`);
        console.log(`  - H2H: ${h2h.length} matches`);
        console.log(`  - Standings: ${standings.length} teams`);
        console.log(`  - Predictions: ${predictions ? 'YES' : 'NO'}`);
        console.log(`  - Value Bets: ${valueBets.length} bets`);
        console.log(`  - Perplexity context: ${perplexityResult?.success ? 'YES' : 'NO/SKIPPED'}`);

        // ═══════════════════════════════════════════════════════════════
        // STAGE 3: BUILD NORMALIZED PAYLOAD (V8 STRUCTURED)
        // ═══════════════════════════════════════════════════════════════
        console.log('[v2-create-job-sportmonks] Stage 3: Building V8 structured payload...');

        // V8: Split history by venue (home/away) for each team
        const homeAllDetailed = normalizeDetailedMatchHistory(homeHistory, homeTeamId);
        const awayAllDetailed = normalizeDetailedMatchHistory(awayHistory, awayTeamId);

        // Split into as_home / as_away (10 each) + general_form (30 simple)
        const homeAsHome = homeAllDetailed.filter((m: any) => m.was_home === true).slice(0, 10);
        const homeAsAway = homeAllDetailed.filter((m: any) => m.was_home === false).slice(0, 10);
        const homeGeneralForm = normalizeSimpleForm(homeHistory.slice(0, 30), homeTeamId);

        const awayAsHome = awayAllDetailed.filter((m: any) => m.was_home === true).slice(0, 10);
        const awayAsAway = awayAllDetailed.filter((m: any) => m.was_home === false).slice(0, 10);
        const awayGeneralForm = normalizeSimpleForm(awayHistory.slice(0, 30), awayTeamId);

        console.log(`  - Home splits: ${homeAsHome.length} as home, ${homeAsAway.length} as away, ${homeGeneralForm.length} general`);
        console.log(`  - Away splits: ${awayAsHome.length} as home, ${awayAsAway.length} as away, ${awayGeneralForm.length} general`);

        // Build V8/V9 normalized payload
        const normalizedPayload = {
            match: {
                fixture_id: fixtureData.id,
                stats: fixtureData.statistics,
                venue: fixtureData.venue,
                league_id: fixtureData.league_id,
                season_id: fixtureData.season_id,
                date_time_utc: fixtureData.starting_at,
                teams: {
                    home: { id: homeTeamId, name: homeTeam.name, image: homeTeam.image_path },
                    away: { id: awayTeamId, name: awayTeam.name, image: awayTeam.image_path }
                },
                competition: {
                    id: fixtureData.league?.id,
                    name: fixtureData.league?.name,
                    country: fixtureData.league?.country?.name,
                    round: fixtureData.round?.name
                },
                // V9: Raw data for enrichers (lineups, coaches, weather, xG)
                _raw_fixture: {
                    lineups: fixtureData.lineups || [],
                    coaches: fixtureData.coaches || [],
                    formations: fixtureData.formations || [],
                    weatherReport: fixtureData.weatherReport || null,
                    referees: fixtureData.referees || [],
                    xGFixture: fixtureData.xGFixture || null,
                    events: fixtureData.events || [],
                    sidelined: fixtureData.sidelined || []
                }
            },
            // V8: Structured datasets by venue
            datasets: {
                home_team: {
                    as_home: homeAsHome,
                    as_away: homeAsAway,
                    general_form: homeGeneralForm,
                    injuries: fixtureData.sidelined?.filter((s: any) => s.team_id === homeTeamId) || []
                },
                away_team: {
                    as_home: awayAsHome,
                    as_away: awayAsAway,
                    general_form: awayGeneralForm,
                    injuries: fixtureData.sidelined?.filter((s: any) => s.team_id === awayTeamId) || []
                },
                h2h: h2h,
                standings: {
                    home_context: standings.find((s: any) => s.participant_id === homeTeamId),
                    away_context: standings.find((s: any) => s.participant_id === awayTeamId),
                    table: standings
                },
                injuries: {
                    home: fixtureData.sidelined?.filter((s: any) => s.team_id === homeTeamId) || [],
                    away: fixtureData.sidelined?.filter((s: any) => s.team_id === awayTeamId) || []
                }
            },
            // V8: External context from Perplexity
            external_context: perplexityResult?.success ? perplexityResult.context : null,
            predictions,
            value_bets: valueBets,
            odds: organizeOddsForAI(fixtureData.odds || [])
        };

        // Calculate coverage score
        const coverage = {
            fixture: !!fixtureData,
            lineups: (fixtureData.lineups?.length || 0) > 0,
            statistics: (fixtureData.statistics?.length || 0) > 0,
            odds: (fixtureData.odds?.length || 0) > 0,
            predictions: !!predictions,
            h2h: h2h.length > 0,
            standings: standings.length > 0,
            injuries: (fixtureData.sidelined?.length || 0) > 0,
            xg: !!fixtureData.xGFixture,
            value_bets: valueBets.length > 0,
            deep_history: homeAsHome.length > 0 && homeAsHome[0]?.details,
            venue_split: homeAsHome.length > 0 && homeAsAway.length > 0,
            external_context: !!normalizedPayload.external_context
        };

        const coverageScore = Object.values(coverage).filter(Boolean).length / Object.keys(coverage).length;
        console.log(`[v2-create-job-sportmonks] Coverage: ${Math.round(coverageScore * 100)}%`);

        // ═══════════════════════════════════════════════════════════════
        // STAGE 4: UPDATE JOB AND CALL V3-AI-ANALYZER
        // ═══════════════════════════════════════════════════════════════
        console.log('[v2-create-job-sportmonks] Stage 4: Updating job and calling analyzer...');

        const { error: updateError } = await supabase
            .from('analysis_jobs_v2')
            .update({
                status: 'interpret', // Valid status: pending, etl, features, interpret, done, failed
                // Use correct column name: data_coverage_score (not data_coverage or coverage_pct)
                data_coverage_score: Math.round(coverageScore * 100),
                etl_context: normalizedPayload // SAVE CONTEXT for debugging & re-runs
            })
            .eq('id', jobId);

        if (updateError) {
            console.error('[v2-create-job-sportmonks] CRITICAL: Failed to save etl_context!', JSON.stringify(updateError));
        } else {
            console.log('[v2-create-job-sportmonks] etl_context saved successfully. Keys:', Object.keys(normalizedPayload).join(', '));
            console.log('[v2-create-job-sportmonks] Payload size:', JSON.stringify(normalizedPayload).length, 'chars');
        }

        // ═══════════════════════════════════════════════════════════════
        // ANALYZER INVOCATION: Handled by the FRONTEND (browser-side)
        // The Deno fire-and-forget fetch was unreliable — Deno kills background
        // promises when the Response is returned. The frontend invokes
        // v3-ai-analyzer after receiving this ETL response. The analyzer
        // reads etl_context from DB (saved above in Stage 4).
        // ═══════════════════════════════════════════════════════════════
        const payloadSize = JSON.stringify(normalizedPayload).length;
        console.log(`[v2] ETL complete. Analyzer will be invoked by frontend. Payload: ${payloadSize} chars`);
        const parlayJobId: string | null = null;

        const duration = Date.now() - startTime;
        console.log(`[v2-create-job-sportmonks] ETL completed in ${duration}ms. Analyzer running in background.`);

        return new Response(JSON.stringify({
            success: true,
            job_id: jobId,
            parlay_job_id: parlayJobId,
            fixture_id,
            engine: ENGINE_VERSION,
            coverage: coverage,
            coverage_pct: Math.round(coverageScore * 100),
            duration_ms: duration,
            data_source: 'SportMonks',
            predictions_available: !!predictions,
            value_bets_count: valueBets.length,
            summary: {
                home_matches: `${homeAsHome.length} home + ${homeAsAway.length} away`,
                away_matches: `${awayAsHome.length} home + ${awayAsAway.length} away`,
                h2h_count: h2h.length,
                perplexity: perplexityResult?.success ? 'YES' : 'NO',
                payload_size_chars: payloadSize
            }
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

    } catch (error: any) {
        console.error('[v2-create-job-sportmonks] Error:', error);

        if (jobId && supabase) {
            await supabase
                .from('analysis_jobs_v2')
                .update({
                    status: 'failed',
                    error_message: error.message?.substring(0, 500)
                })
                .eq('id', jobId);
        }

        return new Response(JSON.stringify({
            success: false,
            error: error.message,
            job_id: jobId
        }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
});
