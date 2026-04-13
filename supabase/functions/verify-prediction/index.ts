
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from '../_shared/cors.ts'
import { callLLM } from '../_shared/llm-client.ts'

declare const Deno: any;

const API_FOOTBALL_BASE = 'https://v3.football.api-sports.io';

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    const trace: string[] = [];
    let targets: any[] = [];

    const log = (msg: string, data?: any) => {
        console.log(msg, data || '');
        trace.push(`${msg} ${data ? JSON.stringify(data) : ''}`);
    };

    try {
        log("[INIT] Starting verification");

        // 1. Parse Request Body (ONCE)
        const reqBody = await req.json().catch((e: any) => {
            log(`[FATAL] Error parsing JSON body: ${e.message}`);
            return {};
        });

        const { fixture_id, fixture_ids } = reqBody;

        // Init Supabase
        const sbUrl = Deno.env.get('SUPABASE_URL')!;
        const sbKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(sbUrl, sbKey);
        const footballKeys = Deno.env.get('API_FOOTBALL_KEYS');

        if (!footballKeys) throw new Error("Missing API_FOOTBALL_KEYS secret");

        // CHECK SYSTEM SETTINGS
        let learningActive = false;
        try {
            const { data: settingsData } = await supabase.from('system_settings').select('*');
            const setting = settingsData?.find((r: any) => r.key === 'auto_learning_enabled');
            learningActive = setting ? setting.value : false; // Default false
            log(`[CONFIG] Auto-Learning is ${learningActive ? 'ENABLED' : 'DISABLED'}`);
        } catch (e) {
            log(`[CONFIG] Error reading settings, defaulting to disabled: ${e.message}`);
        }

        // Helper: API Fetch
        const rawKeys = typeof footballKeys === 'string' ? footballKeys : '';
        const apiKeys = rawKeys.split(',').map((k: any) => k.trim()).filter((k: string) => k.length > 0);
        const fetchFootball = async (path: string) => {
            for (const key of apiKeys) {
                try {
                    const res = await fetch(`${API_FOOTBALL_BASE}/${path}`, { headers: { 'x-apisports-key': key } });
                    if (res.ok) {
                        const json = await res.json();
                        if (!json.errors || Object.keys(json.errors).length === 0) return json.response;
                    }
                } catch (e) { log(`[API] Error fetching ${path}:`, e); }
            }
            return [];
        };

        if (fixture_ids && Array.isArray(fixture_ids) && fixture_ids.length > 0) {
            // Force Number casting to avoid type mismatch
            const safeIds = fixture_ids.map((id: any) => Number(id)).filter((n: number) => !isNaN(n));
            log(`[LOOKUP] Batch for ${safeIds.length} fixtures (Original: ${fixture_ids.length})`, safeIds);

            // 1. Robust Lookup via Predictions Table (API ID -> Prediction -> Run)
            const { data: linkedPredictions, error: predError } = await supabase
                .from('predictions')
                .select('fixture_id, analysis_run_id')
                .in('fixture_id', safeIds);

            if (predError) {
                log(`[LOOKUP] Error querying predictions:`, predError);
            } else {
                log(`[LOOKUP] Found ${linkedPredictions?.length || 0} linked predictions in DB.`);
            }

            const runIds = [...new Set(linkedPredictions?.map((p: any) => p.analysis_run_id).filter((id: any) => id))];
            log(`[LOOKUP] Unique Run IDs extracted:`, runIds);

            if (runIds.length > 0) {
                const { data: runsByPreds, error: runError } = await supabase
                    .from('analysis_runs')
                    .select('*, predictions(*)')
                    .in('id', runIds);

                if (runError) log(`[LOOKUP] Error fetching runs:`, runError);

                targets = runsByPreds || [];
                log(`[LOOKUP] Fetched ${targets.length} full Run objects.`);
            } else {
                log(`[LOOKUP] No run IDs linked.`);
            }

        } else {
            // Default Batch Trigger
            log(`[LOOKUP] Default mode (no IDs).`);
            const { data: runs } = await supabase
                .from('analysis_runs')
                .select('*, predictions(*)')
                .is('post_match_analysis', null)
                .order('created_at', { ascending: true }) // Oldest first
                .limit(5);
            targets = runs || [];
            log(`[LOOKUP] Found ${targets.length} default pending runs.`);
        }

        const results = [];

        for (const run of targets) {
            log(`[PROCESS] Processing Run ${run.id}...`);

            // We need the API fixture ID.
            let apiFixtureId = null;
            if (run.predictions && run.predictions.length > 0) {
                apiFixtureId = run.predictions[0].fixture_id;
            } else {
                // Fallback attempt via Job
                const { data: job } = await supabase.from('analysis_jobs').select('api_fixture_id').eq('id', run.job_id).single();
                if (job) apiFixtureId = job.api_fixture_id;
            }

            if (!apiFixtureId) {
                log(`[PROCESS] SKIP: No API ID found for run ${run.id}`);
                continue;
            }

            // 2. Fetch Result
            const fixtures = await fetchFootball(`fixtures?id=${apiFixtureId}`);
            if (!fixtures || fixtures.length === 0) {
                log(`[PROCESS] SKIP: Football API returned no data for ${apiFixtureId}`);
                continue;
            }
            const fixture = fixtures[0];

            const statusShort = fixture.fixture.status.short;
            if (!['FT', 'AET', 'PEN'].includes(statusShort)) {
                log(`[PROCESS] SKIP: Match ${apiFixtureId} status is ${statusShort} (not finished)`);
                continue;
            }

            const score = fixture.score.fulltime;
            const winner = fixture.teams.home.winner ? 'Home' : (fixture.teams.away.winner ? 'Away' : 'Draw');
            const scoreStr = `${score.home}-${score.away}`;

            log(`[PROCESS] Match ${apiFixtureId} Finished: ${scoreStr}. Verifying with AI...`);

            // 2.1 Fetch Technical Statistics & Events
            const stats = await fetchFootball(`fixtures/statistics?fixture=${apiFixtureId}`);
            const events = await fetchFootball(`fixtures/events?fixture=${apiFixtureId}`); // Added Events

            let statsText = "Stats not available.";
            if (stats && stats.length > 0) {
                statsText = JSON.stringify(stats);
            }

            let eventsText = "Events not available.";
            if (events && events.length > 0) {
                eventsText = JSON.stringify(events);
            }

            // 3. AI Verification (Deep Post-Mortem)
            const learningTask = learningActive ? `
        TASK 3: SYSTEM FEEDBACK (Machine Learning)
        - "Self-Correction": What did we miss? Was it a bad read or bad luck (variance)?
        - Provide actionable feedback for future predictions.
            ` : `
        TASK 3: SYSTEM FEEDBACK
        - SKIPPED by User Configuration. Leave "learning_feedback" empty or null.
            `;

            const prompt = `
        ACT AS A WORLD-CLASS FOOTBALL ANALYST AND SPORTS SCIENTIST.
        
        MATCH: ${fixture.teams.home.name} vs ${fixture.teams.away.name}
        FINAL SCORE: ${score.home} - ${score.away}
        WINNER: ${winner}
        MATCH STATISTICS: ${statsText}
        KEY EVENTS: ${eventsText}
        
        PREDICTIONS MADE:
        ${JSON.stringify(run.predictions.map((p: any) => ({
                id: p.id,
                market: p.market,
                selection: p.selection,
                reasoning: p.reasoning,
                probability: p.probability,
                confidence: p.confidence
            })))}
        
        OBJECTIVE:
        Perform a high-level "Post-Mortem" analysis to evaluate the prediction performance against reality.
        
        CRITICAL INSTRUCTION:
        ALL OUTPUT MUST BE IN SPANISH (ESPAÑOL).
        The tactical analysis, statistical breakdown, and reviews MUST be written in professional Spanish suitable for a sports report.
        
        TASK 1: VERIFY RESULTS (BE STRICT)
        - Determine if each prediction WON, LOST, or PUSHED.
        - Rules:
          - Over/Under: Compare goals/corners/cards vs line.
          - BTTS: Did both score?
          - 1X2: Did selection win?
          - Asian Handicaps: Apply handicap math.
        
        TASK 2: DEEP ANALYSIS (The Core)
        - CRITICAL: Analyze the result of the MAIN PREDICTION (Highest Probability/Confidence). Why did it Win/Lose?
        - Compare Pre-Match Expectations (Reasoning) vs. Actual Reality.
        - Analyze TACTICAL factors (formations, subs, style).
        - Analyze STATISTICAL factors (xG, dominance, efficiency).
        - Identify Key Moments (Red cards, penalties, injuries).
        
        ${learningTask}
        
        OUTPUT JSON:
        {
            "prediction_results": [
                { "id": "uuid", "is_won": true|false, "outcome_note": "Short explaining result" }
            ],
            "post_match_analysis": {
                "tactical_analysis": "Detailed paragraphs on tactical adaptation...",
                "statistical_breakdown": "Analysis of key stats (xG, Shots) and what they mean...",
                "key_moments": "List of game-changing events...",
                "performance_review": "Did the AI read the game well? (Good Process/Bad Result vs Bad Process)",
                "learning_feedback": "Actionable advice for the AI model for next time."
            },
            "performance_rating": number (1-10)
        }
        `;

                log(`[AI] Sending request to LLM...`);
            const start = Date.now();
            let llmResult;
            try {
                llmResult = await callLLM(prompt, { temperature: 0.1, jsonMode: true, timeoutMs: 60000 });
            } catch (fetchErr: any) {
                log(`[AI] LLM call failed: ${fetchErr.message}`);
                throw fetchErr;
            }
            const duration = Date.now() - start;
            log(`[AI] ${llmResult.provider} responded in ${duration}ms`);

            const aiText = llmResult.text;
            if (!aiText) {
                log(`[AI ERROR] No text generated from ${llmResult.provider}`);
                continue;
            }

            const cleanJson = aiText.replace(/```json/g, '').replace(/```/g, '').trim();
            let analysisResult;
            try {
                analysisResult = JSON.parse(cleanJson);
            } catch (e: any) {
                log(`[AI ERROR] JSON Parse failed: ${e.message}. Text: ${cleanJson}`);
                continue;
            }

            // Validating Schema
            if (!analysisResult.prediction_results || !Array.isArray(analysisResult.prediction_results)) {
                log(`[AI ERROR] Invalid Schema (Missing prediction_results array). Got:`, analysisResult);
                continue;
            }

            // 4. Save Updates
            // Update Predictions
            for (const res of analysisResult.prediction_results) {
                await supabase.from('predictions').update({
                    is_won: res.is_won,
                    verification_status: 'verified',
                    result_verified_at: new Date().toISOString()
                }).eq('id', res.id);
            }

            // Update Run with FULL DATA
            await supabase.from('analysis_runs').update({
                post_match_analysis: analysisResult.post_match_analysis,
                actual_outcome: {
                    score: fixture.score,
                    status: statusShort,
                    winner,
                    statistics: stats,  // Saving RAW STATS
                    events: events      // Saving RAW EVENTS
                }
            }).eq('id', run.id);

            results.push({
                fixture: apiFixtureId,
                teams: { home: fixture.teams.home.name, away: fixture.teams.away.name },
                result: analysisResult
            });
        }

        return new Response(JSON.stringify({
            success: true,
            processed: results.length,
            details: results,
            debug: {
                trace: trace,
                targetsFound: targets.length,
            }
        }), { headers: corsHeaders });

    } catch (err: any) {
        log(`[FATAL] Error catch: ${err.message}`);
        // Return 200 even on error so Frontend can read the trace
        return new Response(JSON.stringify({
            success: false,
            error: err.message,
            debug: { trace }
        }), { status: 200, headers: corsHeaders });
    }
});
