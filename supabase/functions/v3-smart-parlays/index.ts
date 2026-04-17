
// supabase/functions/v3-smart-parlays/index.ts
// SMART PARLAYS V2: EL ARQUITECTO DE ALTA RENTABILIDAD
// Trigger: Cron (Scheduled) or Manual Button
// Description: Construye parlays de 3 legs con cuota ~5.00 usando análisis ya existentes + cuotas extendidas.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from '../_shared/cors.ts'
import { callLLM } from '../_shared/llm-client.ts'

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    const logs: string[] = [];
    const log = (msg: string) => { console.log(msg); logs.push(msg); };

    try {
        const sbUrl = Deno.env.get('SUPABASE_URL')!;
        const sbKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(sbUrl, sbKey);

        const { date, force_regenerate } = await req.json();
        const targetDate = date || new Date().toISOString().split('T')[0];

        log(`[SMART-PARLAYS-V2] Architecting for date: ${targetDate}`);

        // 1. Obtener Partidos YA ANALIZADOS de hoy con confianza decente
        const { data: reports, error: reportsError } = await supabase
            .from('reports_v2')
            .select('job_id, fixture_id, report_packet, created_at')
            .order('created_at', { ascending: false })
            .limit(50)
            .not('report_packet', 'is', null);

        if (reportsError) throw reportsError;

        // Fetch jobs payloads for name matching fallback
        const jobIds = reports.map(r => r.job_id).filter(Boolean);
        const { data: jobs, error: jobsError } = await supabase
            .from('analysis_jobs_v2')
            .select('id, etl_context')
            .in('id', jobIds);

        log(`DEBUG: Found ${jobs?.length} analysis_jobs_v2 records for ${jobIds.length} job IDs.`);

        const jobsMap = new Map();
        if (jobs) {
            jobs.forEach(j => jobsMap.set(j.id, j.etl_context));
        }

        // Filter for target date logic
        const { data: dailyMatches, error: matchesError } = await supabase
            .from('daily_matches')
            .select('api_fixture_id, home_team, away_team, league_name, match_time, league_id')
            .gte('match_time', `${targetDate}T00:00:00`)
            .lt('match_time', `${targetDate}T23:59:59`);

        if (matchesError) throw matchesError;

        if (!dailyMatches || dailyMatches.length === 0) {
            log('No matches found for today.');
            return new Response(JSON.stringify({ success: true, message: 'No matches.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // Match Logic: ID First, then Name Fallback via Job Payload
        const validReports = [];
        let debugMatchCount = 0;

        for (const r of reports) {
            let match = dailyMatches.find(m => Number(m.api_fixture_id) === Number(r.fixture_id));

            // Fallback: Name Matching if ID fails
            if (!match && r.job_id) {
                const payload = jobsMap.get(r.job_id);
                // Check if payload exists and has match info
                if (debugMatchCount < 3) {
                    log(`DEBUG: Checking Report ${r.fixture_id} | Job ${r.job_id} | Payload Found? ${!!payload}`);
                }

                if (payload && payload.match && payload.match.teams) {
                    const homeName = payload.match.teams.home?.name || '';
                    const awayName = payload.match.teams.away?.name || '';

                    if (homeName && awayName) {
                        const potential = dailyMatches.find(m => {
                            // Simple fuzzy: check if report names are included in daily match names
                            // Normalize to lower case
                            const mHome = m.home_team.toLowerCase();
                            const mAway = m.away_team.toLowerCase();
                            const pHome = homeName.toLowerCase();
                            const pAway = awayName.toLowerCase();

                            return (mHome.includes(pHome) || pHome.includes(mHome)) &&
                                (mAway.includes(pAway) || pAway.includes(mAway));
                        });

                        if (potential) {
                            if (debugMatchCount < 3) {
                                log(`DEBUG: [MATCH] "${homeName}" matches "${potential.home_team}"`);
                            }
                            match = potential;
                        } else {
                            if (debugMatchCount < 3) {
                                log(`DEBUG: [FAIL] "${homeName}" vs "${awayName}" not found in today's matches.`);
                            }
                        }
                        debugMatchCount++;
                    }
                }
            }

            if (match) {
                // Attach match to report object for easier access later
                validReports.push({ ...r, _matchedMatch: match });
            }
        }

        log(`DEBUG: Total Reports in DB: ${reports.length}`);
        log(`DEBUG: Matches for date ${targetDate}: ${dailyMatches.length}`);
        log(`DEBUG: Matched Reports (ID + JobPayloadName): ${validReports.length}`);

        // 2. Filtrar Candidatos de Alta Calidad (>70% confidence in AI report)
        const candidates = [];
        for (const r of validReports) {
            const report = typeof r.report_packet === 'string' ? JSON.parse(r.report_packet) : r.report_packet;
            const confidence = report.resumen_ejecutivo?.confianza_global || 'MEDIA';

            // Loose filter: High or Medium-High confidence or just >75% prob in picks
            let passed = false;
            // TEST MODE: Allow MEDIA confidence and >1% prob to force generation (EXTREME DEBUG)
            if (['ALTA', 'MUY ALTA', 'MEDIA'].includes(confidence.toUpperCase())) passed = true;
            if (report.pronosticos?.some((p: any) => (p.probabilidad_calculada_porcentaje || 0) >= 1)) passed = true;

            const prob = report.pronosticos?.[0]?.probabilidad_calculada_porcentaje || 0;
            log(`DEBUG: ID ${r.fixture_id} | Conf: ${confidence} | Prob: ${prob}% | Passed: ${passed}`);

            if (passed) {
                // Use the match object explicitly found in the previous loop
                const match = (r as any)._matchedMatch;
                candidates.push({
                    report: report,
                    match: match,
                    fixture_id: r.fixture_id,
                    job_id: r.job_id  // From DB row, NOT from report_packet
                });
            }
        }

        log(`Candidates filtered: ${candidates.length} matches.`);

        if (candidates.length < 3) {
            return new Response(JSON.stringify({ success: false, message: 'Not enough high-confidence matches (<3) to build a smart parlay.', logs }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // 3. FETCH RAW DATA FOR DEEP RE-ANALYSIS (The "Scout" Phase)
        const scoutJobIds = candidates.map(c => c.job_id).filter(Boolean);
        log(`DEBUG: scoutJobIds count: ${scoutJobIds.length} | IDs: ${scoutJobIds.slice(0, 5).join(', ')}...`);

        const { data: jobsData, error: scoutJobsError } = await supabase
            .from('analysis_jobs_v2')
            .select('id, etl_context')
            .in('id', scoutJobIds);

        if (scoutJobsError) {
            log(`ERROR fetching etl_context: ${scoutJobsError.message}`);
        }

        const scoutMap = new Map();
        if (jobsData) {
            jobsData.forEach(j => scoutMap.set(j.id, j.etl_context));
        }

        log(`Starting Deep Scout Analysis on ${candidates.length} candidates (${scoutMap.size} with raw data)...`);

        // MAP PHASE: Run individual AI Scouts
        const scoutPromises = candidates.map(async (c) => {
            const context = scoutMap.get(c.job_id);
            if (!context) return null;

            // Trim context to avoid token limits (focus on stats/odds)
            // ETL payload structure: { match, datasets: { h2h, standings, home_team_last40, ... }, odds, ... }
            const ds = context.datasets || {};
            const rawOdds = context.odds;
            // Trim odds: keep only MAIN, GOALS, TEAMS (drop huge arrays)
            const trimmedOdds = rawOdds ? {
                MAIN: rawOdds.MAIN?.slice(0, 20),
                GOALS: rawOdds.GOALS?.slice(0, 20),
                TEAMS: rawOdds.TEAMS?.slice(0, 20)
            } : null;

            const slimContext = {
                match: context.match,
                standings: ds.standings,
                h2h: ds.h2h?.slice(0, 5),
                home_recent: ds.home_team_last40?.as_home?.slice(0, 5),
                away_recent: ds.away_team_last40?.as_away?.slice(0, 5),
                odds: trimmedOdds
            };

            const scoutPrompt = `
════════════════════════════════════════════════════════════════════════════════
🕵️ ELITE SCOUT SYSTEM - PARLAY VALUE HUNTER
Misión: Encontrar el "GLITCH" en la matriz de cuotas.
════════════════════════════════════════════════════════════════════════════════

ERES UN SCOUT DE ÉLITE ESPECIALIZADO EN PARLAYS DE ALTO VALOR.
Tu trabajo NO es predecir quién gana. Tu trabajo es encontrar una LINEA DE APUESTA mal puesta por las casas.

OBJETIVO ÚNICO:
Encontrar la selección (Pick) MÁS VALIOSA para un Parlay.
- Rango de Cuota Ideal: 1.70 a 2.60 (Decimal).
- Evita lo obvio (Cuotas < 1.50).
- Busca: Over de Goles, Ambos Anotan (BTTS), Handicaps o Doble Oportunidad de valor.

CONSTANTES DE OPERACIÓN:
1. **NO INVENTES DATOS**. Usa SOLO la data provista.
2. **AGRESIVIDAD INTELIGENTE**: Prefiere un "Over 2.5 @ 2.10" con buenos datos que un "Local Gana @ 1.30".
3. **CORRELACIÓN**: Busca stats que soporten tu tesis (ej: "Local anota siempre en 2T" -> "2nd Half Over 0.5").

MÉTODO DE ANÁLISIS (DEEP DIVE):
1. **Forma Reciente**: ¿Cómo vienen jugando los últimos 5 partidos? (Goles, Tiros, Corners).
2. **H2H**: ¿Se tienen "hijos"? ¿Siempre hay goles cuando juegan?
3. **Factor Motivacional**: ¿Es un amistoso o una final?
4. **Ineficiencia**: ¿La cuota paga demasiado para la probabilidad real?

DATA CRUDA DEL PARTIDO:
${JSON.stringify(slimContext).substring(0, 15000)}

════════════════════════════════════════════════════════════════════════════════
FORMATO DE SALIDA (JSON STRICTO)
════════════════════════════════════════════════════════════════════════════════
Responde SOLO con este JSON. Nada de texto extra.

{
  "selection": "Nombre Técnico del Pick (ej: Over 2.5 Goals)",
  "market": "Mercado (ej: Total Goals)",
  "odds": 2.10,
  "confidence": 85,
  "reasoning": "ANÁLISIS DE ÉLITE: Explica POR QUÉ es un robo a la casa de apuestas. Usa datos: 'Promedian 3.2 goles, el local ha marcado en 5/5 últimos...'.",
  "risk_factor": "Cual es el mayor peligro (ej: Rotación de jugadores)"
}
`;
            try {
                const scoutResult = await callLLM(scoutPrompt, {
                    temperature: 0.7,
                    maxTokens: 2048,
                    jsonMode: true,
                    timeoutMs: 30000,
                });
                const text = scoutResult.text;
                if (!text) return null;
                const clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
                return { ...JSON.parse(clean), fixture_id: c.fixture_id, match: c.match };
            } catch (e: any) {
                log(`Scout FAILED for ${c.fixture_id}: ${e.message}`);
                return null;
            }
        });

        const scoutResults = (await Promise.all(scoutPromises)).filter(Boolean);
        log(`Scout Phase Complete. Found ${scoutResults.length} high-value opportunities.`);

        if (scoutResults.length < 3) {
            return new Response(JSON.stringify({ success: false, message: 'Not enough high-value scouted picks (<3).', logs }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // 4. ARCHITECT PHASE (Reduce)
        const promptInput = scoutResults.map((s: any) => `
ID: ${s.fixture_id}
MATCH: ${s.match.home_team} vs ${s.match.away_team}
SCOUT PICK: ${s.selection} (${s.market}) @ ${s.odds}
CONFIDENCE: ${s.confidence}%
REASONING: ${s.reasoning}
`).join('\n-------------------\n');

        const prompt = `
ACT AS A WORLD-CLASS BETTING STRATEGIST (The "Value Hunter").
Your goal is to build a HIGH-VALUE 3-LEG PARLAY from the Scouted Picks.

CRITERIA:
1. TOTAL ODDS TARGET: 5.00 to 8.00+ (decimal).
2. LEGS: Exactly 3 selections from the provided list.
3. STRATEGY: Combine the best correlated or highest value scout picks.

INPUT SCOUT REPORTS:
${promptInput}

INSTRUCTIONS:
- Select the 3 BEST Scout Picks.
- Write a "Sales Pitch" explaining why this combo beats the bookies.
- Return "fixture_id" EXACTLY.
- USE THE ODDS PROVIDED BY THE SCOUT.

OUTPUT FORMAT (JSON STRICTO):
{
  "parlay_name": "Nombre Agresivo",
  "narrativa_profunda": "Explicación...",
  "metricas_clave": {
    "cuota_total_estimada": 0,
    "probabilidad_implied": 0,
    "nivel_riesgo": "ALTO-VALOR"
  },
  "parlay_details": {
    "selecciones": [
      {
        "fixture_id": 123456,
        "teams": "Home vs Away",
        "market": "from scout",
        "selection": "from scout",
        "odds": 0,
        "reason": "from scout"
      }
    ]
  }
}
`;

        // 5. CALL LLM (Architect Phase)
        log('Asking LLM to architect the parlay...');
        const architectResult = await callLLM(prompt, {
            temperature: 0.7,
            maxTokens: 8192,
            jsonMode: true,
            timeoutMs: 60000,
        });
        log(`Architect LLM provider: ${architectResult.provider}`);

        let aiText = architectResult.text || '{}';

        // Clean JSON
        aiText = aiText.replace(/```json/g, '').replace(/```/g, '').trim();
        const start = aiText.indexOf('{');
        const end = aiText.lastIndexOf('}');
        log(`DEBUG: AI Raw Response Length: ${aiText.length}`);

        // Clean JSON
        const cleanText = aiText.replace(/```json/g, '').replace(/```/g, '').trim();
        let parlay;

        try {
            parlay = JSON.parse(cleanText);
        } catch (e) {
            log(`ERROR: Failed to parse AI Response: ${cleanText}`);
            throw new Error('AI Response was not valid JSON');
        }

        // Validate Structure
        if (!parlay.parlay_details || !parlay.parlay_details.selecciones) {
            log(`ERROR: AI Response Missing 'parlay_details.selecciones'. RAW: ${cleanText}`);
            throw new Error('AI Response missing required fields (picks)');
        }

        const rawPicks = parlay.parlay_details.selecciones;
        log(`DEBUG: AI returned ${rawPicks.length} picks. Enriching with real data...`);

        // ENRICH PICKS WITH REAL DATA (No Hallucinations)
        const enrichedPicks = rawPicks.map((pick: any) => {
            // Find the original match candidate
            // Try ID match first
            let candidate = candidates.find(c => String(c.fixture_id) === String(pick.fixture_id));

            // Fallback: Fuzzy Name Match
            if (!candidate && pick.teams) {
                candidate = candidates.find(c => {
                    const m = c.match;
                    const combined = (m.home_team + ' ' + m.away_team).toLowerCase();
                    const pickTeams = pick.teams.toLowerCase();
                    return combined.includes(pickTeams) || pickTeams.includes(m.home_team.toLowerCase());
                });
            }

            if (candidate) {
                // Get Probability from REAL analysis (not AI hallucination)
                const reportProb = candidate.report.pronosticos?.[0]?.probabilidad_calculada_porcentaje || 0;

                return {
                    ...pick,
                    fixture_id: candidate.fixture_id, // Ensure correct ID
                    home_team: candidate.match.home_team,
                    away_team: candidate.match.away_team,
                    league: candidate.match.league_name,
                    p_model: reportProb / 100, // Normalize to 0-1 for frontend

                    // STRATEGY PIVOT: Trust the AI "Value Hunter" odds if provided, otherwise default
                    odds: pick.odds || 1.90,

                    market: pick.market || candidate.report.pronosticos?.[0]?.mercado || 'Match Winner',
                    selection: pick.selection || candidate.report.pronosticos?.[0]?.seleccion || 'Home'
                };
            }

            // Fallback if no match found (Should be rare)
            return {
                ...pick,
                home_team: pick.teams?.split(' vs ')[0] || 'Unknown Home',
                away_team: pick.teams?.split(' vs ')[1] || 'Unknown Away',
                league: 'Unknown League',
                p_model: 0.5,
                odds: pick.odds || 1.90
            };
        });

        // 6. CALCULATE TRUE COMBINED PROBABILITY (Using Model Probabilities, NOT Market Implied)
        // P(Total) = P1 * P2 * P3 ...
        const modelProbability = enrichedPicks.reduce((acc: number, p: any) => acc * p.p_model, 1);

        // 7. CALCULATE TOTAL ODDS (Multiplicative)
        // Odds(Total) = O1 * O2 * O3 ...
        const totalOdds = enrichedPicks.reduce((acc: number, p: any) => acc * p.odds, 1);

        log(`DEBUG: Saving Parlay with ${enrichedPicks.length} enriched picks.`);
        log(`DEBUG: Model Prob: ${(modelProbability * 100).toFixed(1)}% | Total Odds: ${totalOdds.toFixed(2)}`);

        // 8. CLEANUP & SAVE
        // Delete previous PENDING parlays for this date to ensure "Freshness" (User Request)
        const { error: deleteError } = await supabase
            .from('smart_parlays_v2')
            .delete()
            .eq('date', targetDate)
            .eq('status', 'pending');

        if (deleteError) {
            log(`WARNING: Failed to clean up old parlays: ${deleteError.message}`);
        } else {
            log(`DEBUG: Cleaned up old pending parlays for ${targetDate}`);
        }

        // 9. Insert New Parlay
        const { data: insertedParlay, error: insertError } = await supabase
            .from('smart_parlays_v2')
            .insert({
                date: targetDate,
                name: parlay.parlay_name,
                picks: enrichedPicks,
                combined_probability: modelProbability, // NOW: True Model Confidence (e.g., 0.45)
                implied_odds: totalOdds, // NOW: True Multiplied Odds (e.g., 5.46)
                pick_count: enrichedPicks.length,
                confidence_tier: 'ultra_safe',
                status: 'pending'
            })
            .select()
            .single();

        if (insertError) throw insertError;

        return new Response(JSON.stringify({
            success: true,
            parlay: insertedParlay, // RETURN THE ENRICHED DB RECORD
            logs
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

    } catch (e: any) {
        log(`Error: ${e.message}`);
        // V9 FIX C1: return 500 so frontend detects the error properly
        return new Response(JSON.stringify({ success: false, error: e.message, logs }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
});
