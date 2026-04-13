// supabase/functions/v3-premium-parlay-engine/index.ts
// MOTOR V3: Análisis Independiente + 60+ Mercados + Cuotas Alto Valor
// NO reutiliza picks existentes - Hace análisis desde cero

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { callLLM } from '../_shared/llm-client.ts'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ═══════════════════════════════════════════════════════════════
// CONFIGURACIÓN V3 - CUOTAS DE ALTO VALOR
// ═══════════════════════════════════════════════════════════════
const CONFIG = {
    // Cuotas individuales objetivo (SUBIDAS para más valor)
    MIN_INDIVIDUAL_ODDS: 1.80,  // Subido de 1.60 → Más valor por pick
    MAX_INDIVIDUAL_ODDS: 2.50,

    // Probabilidad objetivo (más arriesgada pero rentable)
    MIN_PROBABILITY: 0.45,  // 45% - Permite cuotas más altas
    MAX_PROBABILITY: 0.65,  // 65%

    // Parlay combinado
    MIN_COMBINED_ODDS: 5.00,  // Subido de 4.00
    MAX_COMBINED_ODDS: 12.00, // Subido de 10.00
    PICKS_PER_PARLAY: 3,
    PARLAYS_TO_GENERATE: 3,

    // Modelo
    MODEL: 'gemini-2.5-flash',
    TEMPERATURE: 0.8  // Más creatividad para mercados diversos
}

// ═══════════════════════════════════════════════════════════════
// CATÁLOGO COMPLETO DE 60+ MERCADOS DISPONIBLES
// ═══════════════════════════════════════════════════════════════
const FULL_MARKET_CATALOG = {
    // === MERCADOS PRINCIPALES ===
    match_winner: {
        category: 'Principal',
        markets: ['home_win', 'draw', 'away_win'],
        typical_odds: { home_win: [1.20, 5.00], draw: [3.00, 5.00], away_win: [1.30, 8.00] }
    },
    double_chance: {
        category: 'Principal',
        markets: ['1x', '12', 'x2'],
        typical_odds: { '1x': [1.10, 1.80], '12': [1.05, 1.50], 'x2': [1.15, 2.00] }
    },
    draw_no_bet: {
        category: 'Principal',
        markets: ['dnb_home', 'dnb_away'],
        typical_odds: { dnb_home: [1.15, 3.00], dnb_away: [1.20, 4.00] }
    },

    // === MERCADOS DE GOLES TOTALES ===
    total_goals: {
        category: 'Goles',
        markets: ['over_0.5', 'under_0.5', 'over_1.5', 'under_1.5', 'over_2.5', 'under_2.5',
            'over_3.5', 'under_3.5', 'over_4.5', 'under_4.5'],
        typical_odds: {
            'over_0.5': [1.05, 1.20], 'under_0.5': [6.00, 15.00],
            'over_1.5': [1.15, 1.50], 'under_1.5': [2.50, 5.00],
            'over_2.5': [1.50, 2.50], 'under_2.5': [1.40, 2.20],
            'over_3.5': [2.00, 4.00], 'under_3.5': [1.20, 1.60],
            'over_4.5': [3.00, 8.00], 'under_4.5': [1.08, 1.30]
        }
    },

    // === AMBOS EQUIPOS MARCAN ===
    btts: {
        category: 'Goles',
        markets: ['btts_yes', 'btts_no'],
        typical_odds: { btts_yes: [1.50, 2.50], btts_no: [1.40, 2.20] }
    },

    // === GOLES POR EQUIPO ===
    home_goals: {
        category: 'Goles Equipo',
        markets: ['home_over_0.5', 'home_over_1.5', 'home_over_2.5',
            'home_under_0.5', 'home_under_1.5', 'home_under_2.5'],
        typical_odds: {
            'home_over_0.5': [1.15, 1.60], 'home_under_0.5': [2.50, 6.00],
            'home_over_1.5': [1.60, 3.00], 'home_under_1.5': [1.30, 2.00],
            'home_over_2.5': [2.50, 5.00], 'home_under_2.5': [1.15, 1.50]
        }
    },
    away_goals: {
        category: 'Goles Equipo',
        markets: ['away_over_0.5', 'away_over_1.5', 'away_over_2.5',
            'away_under_0.5', 'away_under_1.5', 'away_under_2.5'],
        typical_odds: {
            'away_over_0.5': [1.30, 2.00], 'away_under_0.5': [1.70, 3.50],
            'away_over_1.5': [2.00, 4.00], 'away_under_1.5': [1.20, 1.70],
            'away_over_2.5': [3.50, 7.00], 'away_under_2.5': [1.10, 1.40]
        }
    },

    // === MERCADOS POR TIEMPO ===
    first_half: {
        category: 'Por Tiempo',
        markets: ['1h_over_0.5', '1h_over_1.5', '1h_under_0.5', '1h_under_1.5',
            '1h_home_win', '1h_draw', '1h_away_win', '1h_btts_yes', '1h_btts_no'],
        typical_odds: {
            '1h_over_0.5': [1.30, 1.80], '1h_under_0.5': [1.80, 3.50],
            '1h_over_1.5': [2.00, 3.50], '1h_under_1.5': [1.25, 1.60],
            '1h_home_win': [2.00, 4.00], '1h_draw': [2.00, 2.80], '1h_away_win': [3.00, 6.00],
            '1h_btts_yes': [3.00, 5.00], '1h_btts_no': [1.15, 1.40]
        }
    },
    second_half: {
        category: 'Por Tiempo',
        markets: ['2h_over_0.5', '2h_over_1.5', '2h_under_0.5', '2h_under_1.5',
            '2h_home_win', '2h_draw', '2h_away_win', '2h_btts_yes', '2h_btts_no'],
        typical_odds: {
            '2h_over_0.5': [1.20, 1.60], '2h_under_0.5': [2.50, 5.00],
            '2h_over_1.5': [1.80, 3.00], '2h_under_1.5': [1.30, 1.70],
            '2h_home_win': [2.20, 4.50], '2h_draw': [2.20, 3.00], '2h_away_win': [3.50, 7.00],
            '2h_btts_yes': [3.50, 6.00], '2h_btts_no': [1.12, 1.35]
        }
    },

    // === MITAD CON MÁS GOLES ===
    half_with_most_goals: {
        category: 'Por Tiempo',
        markets: ['first_half_most', 'second_half_most', 'equal_halves'],
        typical_odds: { first_half_most: [2.50, 4.50], second_half_most: [1.80, 3.00], equal_halves: [3.00, 5.00] }
    },

    // === MITAD/TIEMPO COMPLETO ===
    halftime_fulltime: {
        category: 'Combinado',
        markets: ['ht_ft_1_1', 'ht_ft_1_x', 'ht_ft_1_2',
            'ht_ft_x_1', 'ht_ft_x_x', 'ht_ft_x_2',
            'ht_ft_2_1', 'ht_ft_2_x', 'ht_ft_2_2'],
        typical_odds: {
            ht_ft_1_1: [2.00, 5.00], ht_ft_1_x: [10.00, 30.00], ht_ft_1_2: [15.00, 50.00],
            ht_ft_x_1: [4.00, 8.00], ht_ft_x_x: [4.00, 8.00], ht_ft_x_2: [6.00, 15.00],
            ht_ft_2_1: [20.00, 60.00], ht_ft_2_x: [12.00, 35.00], ht_ft_2_2: [4.00, 10.00]
        }
    },

    // === CLEAN SHEET / PORTERÍA A CERO ===
    clean_sheet: {
        category: 'Defensa',
        markets: ['home_clean_sheet_yes', 'home_clean_sheet_no',
            'away_clean_sheet_yes', 'away_clean_sheet_no'],
        typical_odds: {
            home_clean_sheet_yes: [2.00, 4.00], home_clean_sheet_no: [1.20, 1.60],
            away_clean_sheet_yes: [2.50, 5.00], away_clean_sheet_no: [1.15, 1.50]
        }
    },

    // === GANAR SIN RECIBIR GOL ===
    win_to_nil: {
        category: 'Combinado',
        markets: ['home_win_to_nil', 'away_win_to_nil'],
        typical_odds: { home_win_to_nil: [2.50, 6.00], away_win_to_nil: [4.00, 10.00] }
    },

    // === MARGEN DE VICTORIA ===
    winning_margin: {
        category: 'Resultado',
        markets: ['home_by_1', 'home_by_2', 'home_by_3plus',
            'away_by_1', 'away_by_2', 'away_by_3plus', 'draw_exactly'],
        typical_odds: {
            home_by_1: [3.50, 6.00], home_by_2: [5.00, 10.00], home_by_3plus: [5.00, 15.00],
            away_by_1: [5.00, 9.00], away_by_2: [8.00, 18.00], away_by_3plus: [10.00, 30.00],
            draw_exactly: [3.00, 5.00]
        }
    },

    // === GOLES PARES/IMPARES ===
    odd_even: {
        category: 'Especial',
        markets: ['total_odd', 'total_even'],
        typical_odds: { total_odd: [1.85, 2.10], total_even: [1.80, 2.05] }
    },

    // === PRIMER GOL ===
    first_goal: {
        category: 'Especial',
        markets: ['first_goal_home', 'first_goal_away', 'no_goal'],
        typical_odds: { first_goal_home: [1.60, 2.50], first_goal_away: [2.00, 3.50], no_goal: [8.00, 20.00] }
    },

    // === ÚLTIMO GOL ===
    last_goal: {
        category: 'Especial',
        markets: ['last_goal_home', 'last_goal_away', 'no_goal_last'],
        typical_odds: { last_goal_home: [1.70, 2.80], last_goal_away: [2.20, 4.00], no_goal_last: [8.00, 20.00] }
    },

    // === GANA AMBAS MITADES ===
    win_both_halves: {
        category: 'Combinado',
        markets: ['home_wins_both_halves', 'away_wins_both_halves'],
        typical_odds: { home_wins_both_halves: [3.50, 8.00], away_wins_both_halves: [6.00, 15.00] }
    },

    // === ANOTA EN AMBAS MITADES ===
    score_both_halves: {
        category: 'Combinado',
        markets: ['home_scores_both_halves', 'away_scores_both_halves'],
        typical_odds: { home_scores_both_halves: [2.50, 5.00], away_scores_both_halves: [3.50, 7.00] }
    },

    // === HANDICAP EUROPEO ===
    handicap: {
        category: 'Handicap',
        markets: ['home_-1', 'home_-2', 'home_+1', 'home_+2',
            'away_-1', 'away_-2', 'away_+1', 'away_+2'],
        typical_odds: {
            'home_-1': [2.00, 4.00], 'home_-2': [3.50, 8.00],
            'home_+1': [1.30, 1.80], 'home_+2': [1.10, 1.40],
            'away_-1': [3.50, 8.00], 'away_-2': [6.00, 15.00],
            'away_+1': [1.50, 2.20], 'away_+2': [1.20, 1.60]
        }
    },

    // === RESULTADO EXACTO (Los más comunes) ===
    exact_score: {
        category: 'Resultado Exacto',
        markets: ['1-0', '2-0', '2-1', '3-0', '3-1', '0-0', '1-1', '2-2',
            '0-1', '0-2', '1-2', '0-3', '1-3'],
        typical_odds: {
            '1-0': [5.00, 10.00], '2-0': [7.00, 15.00], '2-1': [7.00, 13.00],
            '3-0': [12.00, 25.00], '3-1': [12.00, 22.00],
            '0-0': [8.00, 18.00], '1-1': [5.50, 10.00], '2-2': [10.00, 20.00],
            '0-1': [7.00, 15.00], '0-2': [12.00, 25.00], '1-2': [10.00, 18.00],
            '0-3': [20.00, 45.00], '1-3': [18.00, 35.00]
        }
    },

    // === GANA AL MENOS UNA MITAD ===
    win_either_half: {
        category: 'Combinado',
        markets: ['home_win_either_half', 'away_win_either_half'],
        typical_odds: { home_win_either_half: [1.40, 2.20], away_win_either_half: [1.80, 3.00] }
    }
}

// Lista plana de todos los mercados para el prompt
const ALL_MARKETS_LIST = Object.entries(FULL_MARKET_CATALOG)
    .flatMap(([key, val]) => val.markets.map(m => ({
        id: m,
        category: val.category,
        parent: key
    })))

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

    const startTime = Date.now()

    try {
        const { date } = await req.json()
        const targetDate = date || new Date().toISOString().split('T')[0]

        console.log(`[V3-PremiumParlay] ========================================`)
        console.log(`[V3-PremiumParlay] MOTOR V3 - ANÁLISIS INDEPENDIENTE`)
        console.log(`[V3-PremiumParlay] Fecha: ${targetDate}`)
        console.log(`[V3-PremiumParlay] ========================================`)

        // Initialize clients
        const sbUrl = Deno.env.get('SUPABASE_URL')!
        const sbKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        const supabase = createClient(sbUrl, sbKey)

        // ═══════════════════════════════════════════════════════════════
        // FASE 1: CARGAR REPORTES DE ANALISTAS (META-ANALYSIS)
        // ═══════════════════════════════════════════════════════════════
        console.log('[V3-MetaAnalyst] FASE 1: Recopilando inteligencia de campo...');

        // 1. Obtener partidos del día
        const { data: dailyMatches, error: matchError } = await supabase
            .from('daily_matches')
            .select('api_fixture_id, home_team, away_team, league_name')
            .eq('match_date', targetDate);

        if (matchError || !dailyMatches || dailyMatches.length < 3) {
            return new Response(JSON.stringify({
                success: false,
                error: `Insuficientes partidos rastreados. Encontrados: ${dailyMatches?.length || 0}`
            }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // 2. Obtener los reportes detallados (analisis table)
        const fixtureIds = dailyMatches.map(m => m.api_fixture_id);
        const { data: reports, error: reportsError } = await supabase
            .from('analisis')
            .select('partido_id, resultado_analisis')
            .in('partido_id', fixtureIds);

        if (reportsError || !reports) {
            console.error('Error fetching analysis reports:', reportsError);
            throw new Error('Failed to fetch analysis reports');
        }

        // 3. Cruzar datos
        const portfolio = [];
        for (const match of dailyMatches) {
            const reportReq = reports.find(r => r.partido_id === match.api_fixture_id);
            if (reportReq?.resultado_analisis?.dashboardData) {
                const data = reportReq.resultado_analisis.dashboardData;
                const verdict = data.veredicto_analista || {};
                const topPick = data.mercado_recomendado || {};

                // SOLO INCLUIR SI EL ANALISTA DIJO "APOSTAR"
                if (verdict.decision === 'APOSTAR' || (verdict.decision === 'OBSERVAR' && verdict.probabilidad > 70)) {
                    portfolio.push({
                        id: match.api_fixture_id,
                        match: `${match.home_team} vs ${match.away_team}`,
                        league: match.league_name,
                        analyst_verdict: {
                            decision: verdict.decision,
                            confidence: verdict.nivel_confianza,
                            probability: verdict.probabilidad,
                            reason: verdict.razon_principal,
                            risk: verdict.riesgo_principal
                        },
                        top_pick: {
                            market: topPick.market_name || verdict.seleccion_clave,
                            selection: topPick.market_key || "N/A", // We need the key logic
                            explanation: topPick.razonamiento
                        },
                        // Inyectamos oportunidades top del ranking
                        opportunities: data.analisis_mercados_completo?.ranking_oportunidades?.slice(0, 3) || []
                    });
                }
            }
        }

        console.log(`[V3-MetaAnalyst] Cartera de candidatos: ${portfolio.length} partidos aprobados por analistas.`);

        if (portfolio.length < 3) {
            return new Response(JSON.stringify({
                success: false,
                error: `Pocos candidatos de alta calidad (${portfolio.length}). Se requieren al menos 3 partidos con veredicto APOSTAR.`
            }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }


        // ═══════════════════════════════════════════════════════════════
        // FASE 2: PROMPT DEL GESTOR DE PORTFOLIO
        // ═══════════════════════════════════════════════════════════════
        console.log('[V3-MetaAnalyst] FASE 2: Generando estrategia de inversión...');

        const prompt = `
YOU ARE THE "META-ANALYST" (PORTFOLIO MANAGER) for a premium sports betting fund.
Your field analysts have sent you detailed reports on ${portfolio.length} matches.
Your job is to synthetic these reports and build 3 STRATEGIC PARLAYS.

TRADING RULES:
1. MAX 3 PARLAYS TO GENERATE.
2. EACH PARLAY MUST HAVE EXACTLY 3 LEGS (PICKS).
3. ⚠️ REGLA INQUEBRANTABLE - DIVERSIFICACIÓN TOTAL ⚠️:
   - NUNCA repitas el mismo pronóstico (fixture_id + market) en múltiples parlays.
   - Si usaste "Partido A Over 2.5" en Parlay 1, NO PUEDE aparecer en Parlay 2 o 3.
   - Cada parlay debe tener pronósticos COMPLETAMENTE ÚNICOS.
   - Esto es OBLIGATORIO - la violación invalidará el parlay.
4. TRUST YOUR ANALYSTS: Use the "analyst_verdict" and "confidence" to weigh your decisions.

INPUT DATA (FIELD REPORTS):
${JSON.stringify(portfolio)}

YOUR MISSION:
Build these 3 specific parlays:

1. "EL BANQUERO" (SAFE & SOLID)
   - Composition: The 3 highest confidence picks from the entire list.
   - Goal: High hit rate, steady bankroll growth.
   - Strategy: Low risk, clear favorites or safe overs.

2. "EL TÁCTICO" (SMART VALUE)
   - Composition: Picks based on specific tactical advantages (e.g., "Team A plays wide vs Team B narrow").
   - Goal: Value exploits.
   - Strategy: Use the "reason" and "opportunities" logic.

3. "EL CAZADOR" (HIGH REWARD)
   - Composition: Slightly riskier picks (draws, BTTS, higher odds) with solid reasoning.
   - Goal: Big payout.

OUTPUT FORMAT (STRICT JSON):
{
  "parlays": [
    {
      "name": "EL BANQUERO", // or "EL TÁCTICO", etc.
      "strategy": "Explanation of why these 3 fit the strategy.",
      "picks": [
        {
          "fixture_id": 12345,
          "home_team": "Team A",
          "away_team": "Team B",
          "market": "over_2.5", // MUST be a valid market key
          "selection": "Over 2.5 Goals",
          "probability": 0.85,
          "reasoning": "Synthesized reasoning from report."
        }
      ],
      "combined_probability": 0.75
    }
  ]
}

CRITICAL:
- OUTPUT IN SPANISH (Razonamientos y Nombres).
- DO NOT INVENT MATCHES. Only use the input portfolio.
- DO NOT INVENT ODDS.
`;

        const llmResult = await callLLM(prompt, {
            temperature: CONFIG.TEMPERATURE,
            jsonMode: true,
            timeoutMs: 90000,
        });
        console.log(`[V3-PremiumParlay] LLM provider: ${llmResult.provider}`);
        const responseText = llmResult.text;

        // ═══════════════════════════════════════════════════════════════
        // FASE 3: PARSE & VALIDATE
        // ═══════════════════════════════════════════════════════════════
        let parsed;
        try {
            const cleaned = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
            parsed = JSON.parse(cleaned);
        } catch (e) {
            console.error("Meta-Analyst JSON Error:", e);
            throw new Error("Failed to parse Meta-Analyst response");
        }

        // ═══════════════════════════════════════════════════════════════
        // FASE 4: REGLA INQUEBRANTABLE - NO DUPLICAR PICKS ENTRE PARLAYS
        // ═══════════════════════════════════════════════════════════════
        console.log('[V3-MetaAnalyst] FASE 4: Aplicando regla anti-duplicación...');

        const usedPicks = new Set<string>();
        const validatedParlays: any[] = [];

        for (const parlay of (parsed.parlays || [])) {
            if (!parlay.picks || parlay.picks.length === 0) {
                console.log(`[ANTI-DUP] Rechazado parlay "${parlay.name}": sin picks`);
                continue;
            }

            // Verificar si ALGÚN pick de este parlay ya fue usado
            let hasDuplicate = false;
            for (const pick of parlay.picks) {
                const pickKey = `${pick.fixture_id}_${pick.market}`;
                if (usedPicks.has(pickKey)) {
                    console.log(`[ANTI-DUP] ⚠️ Rechazado parlay "${parlay.name}": pick duplicado ${pickKey}`);
                    hasDuplicate = true;
                    break;
                }
            }

            if (hasDuplicate) continue;

            // Este parlay es válido - marcar todos sus picks como usados
            for (const pick of parlay.picks) {
                const pickKey = `${pick.fixture_id}_${pick.market}`;
                usedPicks.add(pickKey);
            }

            validatedParlays.push(parlay);
            console.log(`[ANTI-DUP] ✅ Parlay "${parlay.name}" validado con ${parlay.picks.length} picks únicos`);
        }

        console.log(`[V3-MetaAnalyst] Parlays finales: ${validatedParlays.length} (de ${parsed.parlays?.length || 0} generados)`);

        return new Response(JSON.stringify({
            success: true,
            parlays: validatedParlays, // USAR SOLO PARLAYS VALIDADOS
            stats: {
                matches_analyzed: dailyMatches.length,
                candidates_approved: portfolio.length,
                parlays_generated: validatedParlays.length,
                parlays_rejected_duplicates: (parsed.parlays?.length || 0) - validatedParlays.length
            }
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });


    } catch (error) {
        console.error('[V3-PremiumParlay] Error:', error)
        return new Response(JSON.stringify({
            success: false,
            error: error.message
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500
        })
    }
})
