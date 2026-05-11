// supabase/functions/daily-results-verifier/index.ts
// Edge Function para verificar resultados de partidos y actualizar predicciones
// Ejecuta: 11:00 PM Colombia (4:00 AM UTC día siguiente)

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        const footballKeys = Deno.env.get('API_FOOTBALL_KEYS');
        if (!footballKeys) throw new Error("Missing API_FOOTBALL_KEYS");
        const apiKeys = footballKeys.split(',').map(k => k.trim()).filter(k => k.length > 0);

        const supabase = createClient(supabaseUrl, supabaseServiceKey)

        // Parsear fecha
        let reqBody: any = {}
        let executionDate = new Date().toISOString().split('T')[0]
        try {
            reqBody = await req.json().catch(() => ({}))
            if (reqBody && reqBody.date) {
                executionDate = reqBody.date
                console.log(`[Verifier] 🛠️ Ejecución manual detectada para fecha: ${executionDate}`)
            }
        } catch (e) { /* ignore */ }

        const today = executionDate
        console.log(`[Verifier] Iniciando verificación para: ${today}`)

        // 1. Iniciar log job
        let jobId = null;
        try {
            const { data: id } = await supabase.rpc('start_automation_job', {
                p_job_type: 'verifier',
                p_execution_date: today
            })
            jobId = id;
        } catch (err) { console.error('[Verifier] Job Log Error:', err); }

        // 2. Obtener partidos
        let matchQuery = supabase.from('daily_matches').select('*').eq('match_date', today)
        if (!reqBody || !reqBody.date) {
            matchQuery = matchQuery.eq('match_status', 'NS')
        }
        const { data: matches, error: matchError } = await matchQuery
        if (matchError) throw matchError;

        const fixtureIds = matches?.map(m => m.api_fixture_id) || []

        // 3. Obtener predicciones
        let predictions = []
        if (fixtureIds.length > 0) {
            const { data, error: predError } = await supabase
                .from('predictions')
                .select('*')
                .in('fixture_id', fixtureIds)

            if (predError) throw predError;
            predictions = data || []
        }

        console.log(`[Verifier] Partidos: ${matches?.length || 0} | Predicciones: ${predictions?.length || 0}`)

        // Helper: API-Football
        const fetchFootball = async (path: string) => {
            for (const key of apiKeys) {
                try {
                    const res = await fetch(`https://v3.football.api-sports.io/${path}`, {
                        headers: { 'x-apisports-key': key }
                    });
                    if (res.ok) {
                        const json = await res.json();
                        if (!json.errors || Object.keys(json.errors).length === 0) {
                            return json.response;
                        }
                    }
                } catch (e) { console.error('[Verifier] API Error:', e); }
            }
            return null;
        };

        let verifiedFixtures = 0
        let updatedPredictions = 0
        let failedCount = 0

        const uniqueFIds = [...new Set(predictions.map(p => p.fixture_id))]

        for (const fId of uniqueFIds) {
            try {
                const fixtureData = await fetchFootball(`fixtures?id=${fId}`);
                if (!fixtureData || fixtureData.length === 0) {
                    failedCount++;
                    continue;
                }

                const fixture = fixtureData[0];
                const homeScore = fixture.goals.home;
                const awayScore = fixture.goals.away;
                const status = fixture.fixture.status.short;

                if (!['FT', 'AET', 'PEN'].includes(status)) continue;

                // Sync daily_matches score
                await supabase.from('daily_matches').update({
                    home_score: homeScore,
                    away_score: awayScore,
                    match_status: status
                }).eq('api_fixture_id', fId);

                const related = predictions.filter(p => p.fixture_id === fId);
                const matchInfo = {
                    home_score: homeScore,
                    away_score: awayScore,
                    home_team: fixture.teams.home.name,
                    away_team: fixture.teams.away.name
                };

                for (const p of related) {
                    const isWon = evaluatePrediction(p, matchInfo);

                    if (isWon === null) {
                        failedCount++;
                        continue;
                    }

                    const { error: upError } = await supabase
                        .from('predictions')
                        .update({
                            is_won: isWon,
                            result_verified_at: new Date().toISOString(),
                            verification_status: 'verified'
                        })
                        .eq('id', p.id);

                    if (upError) {
                        console.error(`[Verifier] Update error ${p.id}:`, upError.message);
                        failedCount++;
                    } else {
                        updatedPredictions++;
                        await supabase.from('predictions_results').upsert({
                            prediction_id: p.id,
                            fixture_id: fId,
                            was_correct: isWon,
                            actual_score: `${homeScore}-${awayScore}`,
                            verified_at: new Date().toISOString(),
                            verification_source: 'automation'
                        }, { onConflict: 'prediction_id' });

                        // V8: Update profitability tracking
                        try {
                            const result = isWon ? 'won' : 'lost';
                            // Find pending entries for this fixture
                            const { data: profitEntries } = await supabase
                                .from('profitability_tracking')
                                .select('id, stake_amount, odds, bankroll_after')
                                .eq('fixture_id', fId)
                                .eq('result', 'pending');

                            if (profitEntries && profitEntries.length > 0) {
                                // Get latest bankroll
                                const { data: lastBankroll } = await supabase
                                    .from('profitability_tracking')
                                    .select('bankroll_after')
                                    .not('bankroll_after', 'is', null)
                                    .not('result', 'eq', 'pending')
                                    .order('verified_at', { ascending: false })
                                    .limit(1)
                                    .maybeSingle();

                                let runningBankroll = lastBankroll?.bankroll_after || 100;

                                for (const pe of profitEntries) {
                                    // Match by market name (fuzzy)
                                    const profitLoss = result === 'won'
                                        ? pe.stake_amount * (pe.odds - 1)
                                        : -pe.stake_amount;
                                    runningBankroll += profitLoss;

                                    await supabase
                                        .from('profitability_tracking')
                                        .update({
                                            result,
                                            profit_loss: profitLoss,
                                            bankroll_after: runningBankroll,
                                            verified_at: new Date().toISOString()
                                        })
                                        .eq('id', pe.id);
                                }
                                console.log(`[Verifier] Updated ${profitEntries.length} profitability entries for fixture ${fId}`);
                            }
                        } catch (profitErr: any) {
                            console.warn(`[Verifier] Profitability update failed (non-blocking): ${profitErr.message}`);
                        }
                    }
                }
                verifiedFixtures++;

            } catch (err) {
                console.error(`[Verifier] Fixture ${fId} fail:`, err);
                failedCount++;
            }
            await new Promise(r => setTimeout(r, 100));
        }

        if (jobId) {
            await supabase.rpc('complete_automation_job', {
                p_job_id: jobId,
                p_status: failedCount > 0 ? 'partial' : 'success',
                p_processed: verifiedFixtures,
                p_success: updatedPredictions,
                p_failed: failedCount,
                p_details: { fixtures: verifiedFixtures, preds: updatedPredictions }
            });
        }

        return new Response(JSON.stringify({
            success: true,
            fixtures: verifiedFixtures,
            updated: updatedPredictions,
            failed: failedCount
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    } catch (error: any) {
        return new Response(JSON.stringify({ success: false, error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500
        });
    }
});

function evaluatePrediction(prediction: any, match: any): boolean | null {
    const { market: marketName, selection: predicted_outcome } = prediction;
    const m = (marketName || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const o = (predicted_outcome || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const { home_score: h, away_score: a, home_team: ht, away_team: at } = match;

    if (h === null || a === null) return null;

    const tot = h + a;
    const homeWin = h > a;
    const awayWin = a > h;
    const draw = h === a;

    const cleanHT = (ht || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const cleanAT = (at || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    // BTTS
    if (m.includes('ambos') || m.includes('btts') || m.includes('marcan')) {
        const both = h > 0 && a > 0;
        if (o.includes('no')) return !both;
        return both;
    }

    // Over/Under
    const ou = o.match(/(mas|menos|over|under|o\/u|\+|\-)\s*(de\s+)?(\d+(\.\d+)?)/i);
    if (ou) {
        const type = ou[1];
        const val = parseFloat(ou[3]);

        // CORNERS - Detectar si es de un equipo específico
        if (m.includes('corner') || m.includes('córner') || m.includes('corners') || m.includes('esquina')) {
            // Detectar si menciona un equipo específico
            const isHome = cleanHT && o.includes(cleanHT);
            const isAway = cleanAT && o.includes(cleanAT);

            if (isHome || isAway) {
                // Team Corners - necesitamos datos de corners por equipo
                // Como no los tenemos en match, retornamos null
                console.warn(`[EVAL] Team Corners detected but no corner data available: ${marketName} | ${predicted_outcome}`);
                return null;
            }

            // Total Corners del partido - también necesitamos datos
            console.warn(`[EVAL] Total Corners detected but no corner data available: ${marketName} | ${predicted_outcome}`);
            return null;
        }

        // TEAM TOTALS - Detectar si es "goles de un equipo"
        const isTeamTotal = m.includes('equipo') || m.includes('team total') ||
            m.includes('goles del') || m.includes('totales del') ||
            m.includes('team goals');

        if (isTeamTotal) {
            // Determinar qué equipo
            const isHome = m.includes('local') || m.includes('home') ||
                m.includes('casa') || (cleanHT && (m.includes(cleanHT) || o.includes(cleanHT)));
            const isAway = m.includes('visita') || m.includes('away') ||
                m.includes('visitante') || (cleanAT && (m.includes(cleanAT) || o.includes(cleanAT)));

            const teamGoals = isHome ? h : (isAway ? a : null);

            if (teamGoals === null) {
                console.warn(`[EVAL] Could not determine team for Team Total: ${marketName} | ${predicted_outcome}`);
                return null;
            }

            // Evaluar Team Total
            if (['mas', 'over', '+', 'más'].some(t => type.includes(t))) {
                return teamGoals > val;
            }
            if (['menos', 'under', '-'].some(t => type.includes(t))) {
                return teamGoals < val;
            }
        }

        // Over/Under normal (total del partido)
        if (['mas', 'over', '+', 'más'].some(t => type.includes(t))) return tot > val;
        if (['menos', 'under', '-'].some(t => type.includes(t))) return tot < val;
    }

    // 1X2 / Double Chance
    if (o.includes('1x') || (o.includes('local') && o.includes('empate'))) return homeWin || draw;
    if (o.includes('x2') || (o.includes('visita') && o.includes('empate')) || (o.includes('visitante') && o.includes('empate'))) return awayWin || draw;
    if (o.includes('12')) return homeWin || awayWin;
    if (o.includes('local') || o.includes('home') || o === '1') return homeWin;
    if (o.includes('visita') || o.includes('visitante') || o.includes('away') || o === '2') return awayWin;
    if (o.includes('empate') || o.includes('draw') || o === 'x') return draw;

    // Team Name (para 1X2 con nombre de equipo)
    if (cleanHT && o.includes(cleanHT)) return homeWin;
    if (cleanAT && o.includes(cleanAT)) return awayWin;

    console.warn(`[EVAL] Unknown market type: ${marketName} | selection: ${predicted_outcome}`);
    return null;
}


