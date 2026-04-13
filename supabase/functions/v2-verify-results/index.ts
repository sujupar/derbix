// supabase/functions/v2-verify-results/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from '../_shared/cors.ts'
import { callLLM } from '../_shared/llm-client.ts'

const API_FOOTBALL_BASE = 'https://v3.football.api-sports.io';

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    const trace: string[] = [];
    const log = (msg: string, data?: any) => {
        const line = `[${new Date().toISOString().split('T')[1].split('.')[0]}] ${msg} ${data ? JSON.stringify(data) : ''}`;
        console.log(line);
        trace.push(line);
    };

    try {
        const { date, manual_fixture_id } = await req.json().catch(() => ({}));

        // 1. Determine Target Date (Yesterday if not provided, since we verify finished games)
        // Or Today if run late at night. Default to "Yesterday" for safety if auto-running.
        // If manual trigger with date, use that.
        let targetDate = date;
        if (!targetDate) {
            const d = new Date();
            d.setDate(d.getDate() - 1); // Yesterday
            targetDate = d.toISOString().split('T')[0];
        }

        // 1. Init Supabase & Secrets (Moved UP to fix ReferenceError)
        const sbUrl = Deno.env.get('SUPABASE_URL')!;
        const sbKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(sbUrl, sbKey);

        // Load API Keys
        const apiKeys = (Deno.env.get('API_FOOTBALL_KEYS') || '').split(',').map(k => k.trim());
        // 1.5 CHECK AUTOMATION SETTING (Safety Gate)
        // Only strictly enforce if we are running for "yesterday" (auto mode) and no manual override
        if (!manual_fixture_id) {
            const { data: settings } = await supabase
                .from('system_settings')
                .select('*')
                .eq('key', 'verification_v2_enabled')
                .single();

            const isEnabled = settings?.value === true;

            if (!isEnabled) {
                log(`⚠️ Automation is DISABLED in system_settings. Skipping verification.`);
                return new Response(JSON.stringify({ success: true, msg: "Automation Disabled", trace }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            }
        }

        log(`🚀 Starting V2 Verification for Date: ${targetDate}`);

        if (apiKeys.length === 0 || (apiKeys.length === 1 && !apiKeys[0])) {
            log(`❌ Error: Missing API_FOOTBALL_KEYS`);
            return new Response(JSON.stringify({
                success: false,
                msg: "Missing API Keys. Please set API_FOOTBALL_KEYS in Supabase Secrets.",
                trace
            }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // 2A. DEBUG: Check Data Visibility (Service Role)
        const { count: totalParlays } = await supabase.from('parlays').select('*', { count: 'exact', head: true });
        const { count: dateParlays } = await supabase.from('parlays').select('*', { count: 'exact', head: true }).eq('date', targetDate);
        log(`🔍 DEBUG DB: Total Parlays=${totalParlays}, For Date ${targetDate}=${dateParlays}`);

        // 2. Fetch Pending Items
        // A. Pending Parlays for Date
        const { data: parlays, error: parlaysError } = await supabase
            .from('parlays')
            .select('*')
            .eq('date', targetDate)
            .eq('status', 'PENDING');

        if (parlaysError) log(`Error fetching parlays: ${parlaysError.message}`);
        else log(`Found ${parlays?.length} PENDING parlays for ${targetDate}`);

        // B. Pending Analysis Picks (from analysis_jobs_v2 -> value_picks_v2)
        // We need picks that are generated for fixtures on this date
        // First get jobs for the date
        // Note: Analysis works on 'fixture_id', we need to link date. 
        // Usually jobs are created same day or day before. 
        // Better strategy: Get "pending" results from `pick_results_v2` IS NOT RELIABLE yet as it might be empty.
        // Let's look at `value_picks_v2` linked to `analysis_jobs_v2` via fixture_id logic or just verifying everything for the date.

        // Simplification: We will Fetch ALL `dailymatches` for the date -> Get their IDs -> Verify related stuff.
        // 2B. Fetch ALL Daily Matches for Date (Robust Mode)
        // We do NOT filter by 'FT' here because the DB might be stale (showing 'NS' even if match finished).
        // We will filter by checking the REAL status from API-Football later.
        const { data: fixtures } = await supabase
            .from('daily_matches')
            .select('api_fixture_id, match_status, home_team, away_team')
            .eq('match_date', targetDate);

        if (!fixtures || fixtures.length === 0) {
            log(`No fixtures found in DB for ${targetDate}`);
            return new Response(JSON.stringify({ success: true, msg: "No fixtures in DB", trace }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        const fixtureIds = fixtures.map(f => f.api_fixture_id);
        if (manual_fixture_id) fixtureIds.length = 0; // Clear if manual
        if (manual_fixture_id) fixtureIds.push(manual_fixture_id);

        log(`Found ${fixtureIds.length} fixtures in DB. Checking real-time status via API...`);

        log(`Found ${fixtureIds.length} finished fixtures to verify.`);

        // 3. Fetch Data per Fixture & Verify
        let stats = { processed: 0, updated_parlays: 0, updated_picks: 0, errors: 0 };

        // Helper to fetch football data
        const fetchFootball = async (endpoint: string) => {
            for (const key of apiKeys) {
                try {
                    const res = await fetch(`${API_FOOTBALL_BASE}/${endpoint}`, { headers: { 'x-apisports-key': key } });
                    if (res.ok) {
                        const json = await res.json();
                        if (!json.errors || Object.keys(json.errors).length === 0) return json.response;
                    }
                } catch (e) { /* ignore */ }
            }
            return null;
        };

        for (const fId of fixtureIds) {
            try {
                // Check if we have any business with this fixture
                // 1. Any parlays involving this fixture?
                // 2. Any value_picks?

                // Get relevant picks for this fixture
                const { data: picks } = await supabase
                    .from('value_picks_v2')
                    .select('*, analysis_jobs_v2!inner(fixture_id)')
                    .eq('analysis_jobs_v2.fixture_id', fId)
                    // Filter verified? No, maybe re-verify to be safe or add field later.
                    // For now, let's verify all 'BET' or 'WATCH' picks
                    .in('decision', ['BET', 'WATCH']);

                // Get relevant parlays legs
                // Parlays store legs as JSONB. Querying exact leg is hard. 
                // We will Iterate Parlays later.

                if ((!picks || picks.length === 0) && (!parlays || parlays.length === 0)) {
                    continue; // Nothing to verify for this match
                }

                log(`>>> Verifying Match ${fId} (${picks?.length || 0} picks)`);

                // Fetch Real Data
                const matchData = await fetchFootball(`fixtures?id=${fId}`);
                if (!matchData || matchData.length === 0) {
                    log(`Failed to fetch match data for ${fId}`);
                    continue;
                }

                // Match Data Fetched
                const fixture = matchData[0];
                const realStatus = fixture.fixture.status.short;

                // 3.1 Verify Match Status Loop
                // If match is NOT finished (and we are not manually forcing), skip.
                // Statuses: 'FT', 'AET', 'PEN'. ('ABD' or 'PST' might be handled as VOID later if logic dictates, but for now we want COMPLETED matches)
                if (!manual_fixture_id && !['FT', 'AET', 'PEN', 'ABD', 'INT'].includes(realStatus)) {
                    log(`Match ${fId} is ${realStatus} (Not Finished). Skipping.`);
                    continue;
                }

                // 3.2 Self-Healing: Update DB Status if different
                // This ensures next time we don't query 'NS' matches if we wanted to revert to strictly querying FT.
                // Also helps UI.
                await supabase.from('daily_matches').update({ match_status: realStatus }).eq('api_fixture_id', fId);

                const events = await fetchFootball(`fixtures/events?fixture=${fId}`);
                const statsData = await fetchFootball(`fixtures/statistics?fixture=${fId}`);

                // Prepare Context for Judge (Gemini)
                const context = {
                    score: fixture.score,
                    status: fixture.fixture.status,
                    events: events || [],
                    stats: statsData || [],
                    teams: fixture.teams
                };

                // Collect "Claims" to verify
                // We will ask Gemini to verify specific claims string representations
                const claimsToVerify = [];
                const pickMap = new Map(); // id -> claim

                // Add Picks
                if (picks) {
                    for (const p of picks) {
                        const claim = `Market: ${p.market}, Selection: ${p.selection}`;
                        claimsToVerify.push({ type: 'pickup', id: p.id, claim });
                        pickMap.set(p.id, p);
                    }
                }

                // Add Parlay Legs for this fixture (Manual matching)
                // Simplified: We verify Picks. Then Parlays are verified based on Picks status? 
                // PROBLEM: Manual Parlays might have ad-hoc legs not in value_picks.
                // SOLUTION: We verify the Parlay LEGS description directly.

                // Filter parlays that have this match
                const relevantParlays = parlays?.filter(p => {
                    const legs = p.legs as any[];
                    return legs.some((l: any) => l.match.includes(fixture.teams.home.name) || l.match.includes(fixture.teams.away.name) || (l.fixture_id === fId)); // fixture_id in leg is ideal
                }) || [];

                for (const par of relevantParlays) {
                    const legs = par.legs as any[];
                    for (const leg of legs) {
                        // Try to match fixture
                        // Assuming leg has fixture_id or we match loosely by team name if needed
                        // ideally legs have fixture_id
                        let isMatch = leg.fixture_id === fId;
                        if (!isMatch && (leg.match.includes(fixture.teams.home.name) || leg.match.includes(fixture.teams.away.name))) {
                            isMatch = true;
                        }

                        if (isMatch) {
                            const claim = `Market: ${leg.market}, Selection: ${leg.selection}`;
                            claimsToVerify.push({ type: 'parlay_leg', id: par.id, leg_idx: legs.indexOf(leg), claim });
                        }
                    }
                }

                if (claimsToVerify.length === 0) continue;

                // GEMINI JUDGE
                const prompt = `
            ACT AS A PROFESSIONAL SPORTS DATA VALIDATOR.
            
            MATCH: ${fixture.teams.home.name} vs ${fixture.teams.away.name}
            SCORE: ${fixture.score.fulltime.home}-${fixture.score.fulltime.away} (HT: ${fixture.score.halftime.home}-${fixture.score.halftime.away})
            STATUS: ${fixture.fixture.status.short}
            
            KEY EVENTS: ${JSON.stringify(events?.slice(0, 10) || [])}
            STATS: ${JSON.stringify(statsData || [])}
            
            YOUR TASK: Verify if the following predictions (claims) are WON or LOST based on the match data.
            Rules:
            - "Over 2.5 goals" -> Won if total goals > 2.5
            - "BTTS Yes" -> Won if both teams scored > 0
            - "1" or "Home" -> Won if Home Score > Away Score
            - Handicaps: Apply handicap math.
            - Corner markets: Use stats.
            - BE PRECISE.
            - If data is missing or match abandoned, mark as VOID.
            
            CLAIMS TO VERIFY:
            ${JSON.stringify(claimsToVerify)}
            
            OUTPUT JSON:
            {
                "verifications": [
                    { "type": "pickup"|"parlay_leg", "id": "...", "result": "WON"|"LOST"|"VOID"|"PUSH", "reason": "..." }
                ]
            }
            `;

                const llmResult = await callLLM(prompt, {
                    temperature: 0.1,
                    jsonMode: true,
                    timeoutMs: 30000,
                });
                log(`✓ LLM (${llmResult.provider}) responded for fixture ${fId}`);

                const text = llmResult.text;
                if (!text) throw new Error("No AI response");

                const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
                const resultData = JSON.parse(cleanJson);

                // Process Results
                for (const v of resultData.verifications || []) {
                    if (v.type === 'pickup') {
                        // Update Pick Result
                        await supabase.from('pick_results_v2').insert({
                            pick_id: v.id,
                            fixture_id: fId,
                            market: pickMap.get(v.id)?.market || 'unknown',
                            selection: pickMap.get(v.id)?.selection || 'unknown',
                            result: v.result,
                            verified_at: new Date().toISOString(),
                            verified_by: 'auto_v2'
                        });

                        stats.updated_picks++;
                    }
                }

                // For Parlays, we need to aggregate leg results
                // This is tricky because one API call handles one fixture, but generic parlays span multiple.
                // Strategy: Store Verification Result in a separate helper table? Or just log it?
                // BETTER: We can't update Parlay Status until ALL legs are checked.
                // So we really need to store "Leg Result".
                // Since we don't have a "parlay_legs" table (it's JSON), we might need to update the JSON itself?

                // Let's UPDATE the parlay `legs` JSON with the status for that leg.
                for (const v of resultData.verifications || []) {
                    if (v.type === 'parlay_leg') {
                        // Get current parlay data again to avoid race conditions (or use the one we have and optimistic lock?)
                        // Simplest: fetch, update array, patch.
                        const { data: currentParlay } = await supabase.from('parlays').select('legs').eq('id', v.id).single();
                        if (currentParlay && currentParlay.legs) {
                            const legs = currentParlay.legs;
                            if (legs[v.leg_idx]) {
                                legs[v.leg_idx].status = v.result;
                                legs[v.leg_idx].verified_at = new Date().toISOString();
                            }
                            await supabase.from('parlays').update({ legs }).eq('id', v.id);
                        }
                    }
                }

                stats.processed++;

            } catch (e: any) {
                log(`Error processing fixture ${fId}: ${e.message}`);
                stats.errors++;
            }
        }

        // 4. Final Sweep: Check Parlays status
        // If all legs have status, update main status
        const { data: pendingParlays } = await supabase.from('parlays').select('*').eq('status', 'PENDING');
        if (pendingParlays) {
            for (const p of pendingParlays) {
                const legs = p.legs as any[];
                const statuses = legs.map((l: any) => l.status); // undefined, WON, LOST, VOID

                if (statuses.some(s => s === 'LOST')) {
                    await supabase.from('parlays').update({ status: 'LOST', result_verified_at: new Date().toISOString() }).eq('id', p.id);
                    stats.updated_parlays++;
                } else if (statuses.every(s => s === 'WON')) {
                    await supabase.from('parlays').update({ status: 'WON', result_verified_at: new Date().toISOString() }).eq('id', p.id);
                    stats.updated_parlays++;
                } else if (statuses.every(s => s === 'VOID')) {
                    await supabase.from('parlays').update({ status: 'VOID', result_verified_at: new Date().toISOString() }).eq('id', p.id);
                    stats.updated_parlays++;
                }
                // else remain PENDING (waiting for other legs)
            }
        }

        return new Response(JSON.stringify({ success: true, stats, trace }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

    } catch (error: any) {
        return new Response(JSON.stringify({ success: false, error: error.message, trace }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
});
