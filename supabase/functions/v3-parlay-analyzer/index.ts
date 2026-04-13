// supabase/functions/v3-parlay-analyzer/index.ts
// MOTOR DE ANÁLISIS PARA PARLAYS - Busca picks de ALTO VALOR con cuotas altas
// Recibe el MISMO payload que v3-ai-analyzer pero con objetivo diferente
// NO toca reports_v2, value_picks_v2, ni analisis — guarda en parlay_picks_v2

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import JSON5 from "https://esm.sh/json5@2.2.3"
import { corsHeaders } from '../_shared/cors.ts'
import { callLLM } from '../_shared/llm-client.ts'

const MARKETS_CATALOG = `
═══ MERCADOS PRIORITARIOS PARA PARLAYS ═══

AMBOS ANOTAN (BTTS) - PRIORIDAD ALTA:
- Ambos Anotan: Sí
- Ambos Anotan: No
- BTTS + Over 2.5
- BTTS + Under 3.5

GOLES TOTALES:
- Over 1.5 Goles
- Under 1.5 Goles
- Over 2.5 Goles
- Under 2.5 Goles
- Over 3.5 Goles
- Under 3.5 Goles

GOLES POR TIEMPO - PRIORIDAD ALTA:
- Gol en 1er Tiempo: Sí
- Gol en 1er Tiempo: No
- 1er Tiempo Over 0.5
- 1er Tiempo Over 1.5
- 2do Tiempo Over 0.5
- 2do Tiempo Over 1.5
- Mayor Cantidad Goles: 1er Tiempo
- Mayor Cantidad Goles: 2do Tiempo

GOLES POR EQUIPO:
- Local Over 0.5 Goles
- Local Over 1.5 Goles
- Visitante Over 0.5 Goles
- Visitante Over 1.5 Goles
- Local Anota: Sí
- Visitante Anota: Sí

CORNERS - PRIORIDAD ALTA:
- Corners Over 7.5
- Corners Over 8.5
- Corners Over 9.5
- Corners Over 10.5
- Corners Under 9.5
- Corners Under 10.5

TARJETAS:
- Tarjetas Over 2.5
- Tarjetas Over 3.5
- Tarjetas Over 4.5

HANDICAP ASIÁTICO:
- Local -0.5
- Local -1.0
- Local -1.5
- Visitante +0.5
- Visitante +1.0
- Visitante +1.5

RESULTADO (solo si cuota >= 1.80):
- Doble Oportunidad: 1X
- Doble Oportunidad: X2
- Doble Oportunidad: 12
- Empate Apuesta No (DNB) Local
- Empate Apuesta No (DNB) Visitante

ESPECIALES:
- Primer Gol: Local
- Primer Gol: Visitante
`;

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    const startTime = Date.now();
    const GEMINI_MODEL = 'gemini-3.1-pro-preview';

    try {
        const sbUrl = Deno.env.get('SUPABASE_URL')!;
        const sbKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(sbUrl, sbKey);

        let { job_id, fixture_id, payload } = await req.json();
        if (!job_id || !fixture_id) {
            throw new Error('job_id and fixture_id are required');
        }

        // Fallback: leer payload de etl_context en la DB si no vino en el request
        if (!payload) {
            console.log(`[PARLAY-ANALYZER] Payload not in request, reading from DB...`);
            const { data: jobData, error: jobErr } = await supabase
                .from('analysis_jobs_v2')
                .select('etl_context, fixture_id')
                .eq('id', job_id)
                .single();
            if (jobErr || !jobData?.etl_context) {
                throw new Error(`Cannot read etl_context for job ${job_id}: ${jobErr?.message || 'no data'}`);
            }
            payload = jobData.etl_context;
            fixture_id = jobData.fixture_id || fixture_id;
            console.log(`[PARLAY-ANALYZER] Payload loaded from DB`);
        }

        console.log(`[PARLAY-ANALYZER] Starting for fixture: ${fixture_id}, job: ${job_id}`);

        // Update job status
        await supabase
            .from('analysis_jobs_v2')
            .update({ status: 'analyzing', current_motor: 'V1-PARLAY-HUNTER' })
            .eq('id', job_id);

        // ═══════════════════════════════════════════════════════════════
        // EXTRAER DATOS (Same as v3-ai-analyzer)
        // ═══════════════════════════════════════════════════════════════
        const match = payload.match || {};
        const datasets = payload.datasets || {};
        const odds = payload.odds || null;

        const homeTeam = match.teams?.home?.name || 'Local';
        const awayTeam = match.teams?.away?.name || 'Visitante';
        const leagueName = match.competition?.name || 'Liga';

        // Format match history (copied from v3-ai-analyzer)
        const formatMatchForPrompt = (m: any, index: number) => {
            const teamWon = m.was_home ? m.score_home > m.score_away : m.score_away > m.score_home;
            const teamLost = m.was_home ? m.score_home < m.score_away : m.score_away < m.score_home;
            const resultText = teamWon ? '✓ VICTORIA' : teamLost ? '✗ DERROTA' : '= EMPATE';
            const venueTag = m.was_home ? '(LOCAL)' : '(VISITANTE)';
            const teamGoals = m.was_home ? m.score_home : m.score_away;
            const oppGoals = m.was_home ? m.score_away : m.score_home;
            const d = m.details || {};

            const lines = [
                `${index + 1}. ${m.date} vs ${m.opponent_name || m.away_team}: ${teamGoals}-${oppGoals} ${resultText} ${venueTag}`,
                `   📊 Stats: ${d.possession || '?'}% Pos | ${d.shots_on_target || 0}/${d.shots_total || 0} Tiros | ${d.corners || 0} Corners | ${d.saves || 0} Atajadas`,
                `   📊 Rival: ${d.opponent_possession || '?'}% Pos | ${d.opponent_shots_on_target || 0}/${d.opponent_shots || 0} Tiros | ${d.opponent_corners || 0} Corners`,
                `   🟨 Disciplina: ${d.yellow_cards || 0} Amarillas | ${d.red_cards || 0} Rojas | ${d.fouls || 0} Faltas`,
                `   🎯 Formación: ${d.formation_used || '?'} (vs ${d.opponent_formation || '?'})`
            ];
            if (d.ht_score_team !== null && d.ht_score_team !== undefined) {
                lines.push(`   ⏱️ 1er Tiempo: ${d.ht_score_team}-${d.ht_score_opponent}`);
            }
            if (d.events && Array.isArray(d.events) && d.events.length > 0) {
                const eventLines = d.events.slice(0, 6).map((e: any) => {
                    const icon = e.type === 'Goal' ? '⚽' : e.type === 'Yellow Card' ? '🟨' : e.type === 'Red Card' ? '🟥' : '📌';
                    return `      ${e.minute}' ${icon} ${e.type} - ${e.player}${e.detail ? ` (${e.detail})` : ''}`;
                }).join('\n');
                lines.push(`   ⚡ Eventos:\n${eventLines}`);
            }
            return lines.join('\n');
        };

        const formatVenueSection = (matches: any[], label: string) => {
            if (!matches || matches.length === 0) return `${label}: Sin datos.\n`;
            const wins = matches.filter(m => (m.was_home ? m.score_home > m.score_away : m.score_away > m.score_home)).length;
            const draws = matches.filter(m => m.score_home === m.score_away).length;
            const losses = matches.length - wins - draws;
            const gf = matches.reduce((s, m) => s + (m.was_home ? m.score_home : m.score_away), 0);
            const ga = matches.reduce((s, m) => s + (m.was_home ? m.score_away : m.score_home), 0);
            let out = `\n${label} (${matches.length}p): ${wins}V-${draws}E-${losses}D | GF:${gf} GA:${ga} | ${(gf / matches.length).toFixed(1)} GF/p\n\n`;
            out += matches.map((m, i) => formatMatchForPrompt(m, i)).join('\n\n');
            return out;
        };

        const formatGeneralForm = (form: any[]) => {
            if (!form || form.length === 0) return 'Sin forma general.';
            const formString = form.slice(0, 30).map(m => m.result).join('');
            const wins = form.filter(m => m.result === 'W').length;
            const draws = form.filter(m => m.result === 'D').length;
            const losses = form.filter(m => m.result === 'L').length;
            return `Forma (${form.length}p): ${formString} | ${wins}W-${draws}D-${losses}L\n` +
                form.slice(0, 10).map(m => `  ${m.date} ${m.was_home ? '🏠' : '✈️'} vs ${m.opponent}: ${m.score} ${m.result}`).join('\n');
        };

        // Build data sections
        const homeData = datasets.home_team || {};
        const awayData = datasets.away_team || {};
        const homeAsHome = homeData.as_home || datasets.home_team_last40?.all?.filter((m: any) => m.was_home === true) || [];
        const homeAsAway = homeData.as_away || datasets.home_team_last40?.all?.filter((m: any) => m.was_home === false) || [];
        const awayAsHome = awayData.as_home || datasets.away_team_last40?.all?.filter((m: any) => m.was_home === true) || [];
        const awayAsAway = awayData.as_away || datasets.away_team_last40?.all?.filter((m: any) => m.was_home === false) || [];

        const deepHome = `📍 ${homeTeam} COMO LOCAL:\n` + formatVenueSection(homeAsHome, `Como LOCAL`) +
            `\n✈️ ${homeTeam} COMO VISITANTE:\n` + formatVenueSection(homeAsAway, `Como VISITANTE`) +
            (homeData.general_form ? `\n📋 FORMA GENERAL ${homeTeam}:\n` + formatGeneralForm(homeData.general_form) : '');

        const deepAway = `📍 ${awayTeam} COMO LOCAL:\n` + formatVenueSection(awayAsHome, `Como LOCAL`) +
            `\n✈️ ${awayTeam} COMO VISITANTE:\n` + formatVenueSection(awayAsAway, `Como VISITANTE`) +
            (awayData.general_form ? `\n📋 FORMA GENERAL ${awayTeam}:\n` + formatGeneralForm(awayData.general_form) : '');

        const externalContext = payload.external_context;
        const externalContextText = externalContext
            ? `\nCONTEXTO EXTERNO:\n${externalContext.raw_text || 'No disponible.'}`
            : '';

        const h2hText = datasets.h2h?.map((m: any) => {
            const s = m.stats || {};
            const statsInfo = s.home ?
                `\n   > ${m.home_team}: ${s.home.shots} Tiros (${s.home.shots_ot} Arco) | ${s.home.corners} Corners | ${s.home.cards} Tarjetas\n   > ${m.away_team}: ${s.away.shots} Tiros (${s.away.shots_ot} Arco) | ${s.away.corners} Corners | ${s.away.cards} Tarjetas`
                : '';
            return `${m.date}: ${m.home_team} ${m.score_home}-${m.score_away} ${m.away_team}${statsInfo}`;
        }).join('\n') || 'Sin H2H recientes';

        let oddsText = '';
        if (odds && (odds.MAIN || odds.GOALS)) {
            const fmtSection = (name: string, items: any[]) => {
                if (!items || items.length === 0) return '';
                return `>>> ${name}:\n` + items.map((o: any) => `- ${o.lbl}: ${o.val}`).join('\n') + '\n';
            };
            oddsText += fmtSection('PRINCIPALES (1X2, DC)', odds.MAIN);
            oddsText += fmtSection('GOLES (O/U)', odds.GOALS);
            oddsText += fmtSection('EQUIPOS (BTTS, Team Score)', odds.TEAMS);
            oddsText += fmtSection('COMBINADOS (Result+BTTS, HT/FT)', odds.COMBOS);
            oddsText += fmtSection('POR MITADES', odds.HALVES);
            oddsText += fmtSection('CORNERS', odds.CORNERS);
            oddsText += fmtSection('OTROS (ASIATICOS/ESPECIALES)', odds.OTHERS);
        } else {
            oddsText = 'SIN CUOTAS DISPONIBLES';
        }

        const standingsText = datasets.standings
            ? `Posición Local: ${datasets.standings.home_context?.position || '?'} | Puntos: ${datasets.standings.home_context?.points || '?'} | Forma: ${datasets.standings.home_context?.form || '?'}
Posición Visitante: ${datasets.standings.away_context?.position || '?'} | Puntos: ${datasets.standings.away_context?.points || '?'} | Forma: ${datasets.standings.away_context?.form || '?'}`
            : 'Sin tabla de posiciones';

        // ═══════════════════════════════════════════════════════════════
        // PROMPT DE PARLAY HUNTER
        // ═══════════════════════════════════════════════════════════════
        const prompt = `
════════════════════════════════════════════════════════════════════════════════
🎯 SISTEMA DERBIX PARLAY HUNTER V1 - MOTOR DE BÚSQUEDA DE VALOR PARA PARLAYS
Modelo: ${GEMINI_MODEL}
Fecha: ${new Date().toISOString().split('T')[0]}
════════════════════════════════════════════════════════════════════════════════

ERES EL CAZADOR DE VALOR DE DERBIX ESPECIALIZADO EN PARLAYS DE ALTO RENDIMIENTO.

⚠️ TU OBJETIVO ES FUNDAMENTALMENTE DIFERENTE AL ANÁLISIS NORMAL:
- Análisis Normal: Busca picks con ≥80% probabilidad (cuotas bajas ~1.20-1.50)
- TU MISIÓN: Buscar picks con 55-75% probabilidad REAL pero cuotas de mercado 1.60-4.50
- La clave: Encontrar dónde las casas de apuestas PAGAN DE MÁS respecto a la probabilidad real

═══ REGLAS DE ORO PARA PARLAY PICKS ═══

1. CUOTA MÍNIMA por pick: 1.60 (preferiblemente ≥1.80)
2. CUOTA MÁXIMA por pick: 4.50 (más allá es demasiado impredecible)
3. PROBABILIDAD REAL estimada: Entre 55% y 75% para cada pick
4. NO INVENTES CUOTAS. Usa las cuotas provistas en los datos del partido.
   Si un mercado no tiene cuota disponible, ESTIMA de forma conservadora basándote en la probabilidad.
5. Genera MÍNIMO 2 picks y MÁXIMO 5 picks para este partido.
6. DIVERSIFICA: Los picks deben cubrir mercados DIFERENTES (no 3 picks de goles).

═══ MERCADOS A PRIORIZAR (en orden) ═══

1. BTTS (Ambos Anotan) — Cuotas típicas: 1.70-2.10
2. Over/Under 2.5 Goles — Cuotas típicas: 1.75-2.10
3. Over/Under por Tiempos (1T/2T) — Cuotas: 1.70-2.50
4. Handicap Asiático — Cuotas: 1.85-2.20
5. Corners Over/Under — Cuotas: 1.80-2.20
6. Goles por Equipo (Local/Visitante Over) — Cuotas: 1.60-2.80
7. Tarjetas Over — Cuotas: 1.70-2.50
8. Doble Oportunidad con cuota ≥1.80

═══ MERCADOS A EVITAR ═══
- Victoria directa 1X2 con cuota < 1.80 (muy obvio para parlays)
- Over 0.5 goles (cuota ~1.05, no aporta valor)
- Doble Oportunidad simple con cuota < 1.50

═══ MÉTODO DE ANÁLISIS (DEEP DIVE) ═══

PASO 1 - ABSORCIÓN DE DATOS:
Analiza TODA la data del partido con la misma profundidad que un análisis normal:
- Forma reciente (como local/visitante)
- H2H (enfrentamientos directos)
- Estadísticas detalladas (tiros, corners, tarjetas, posesión, goles por tiempo)
- Contexto competitivo (tabla, motivación, urgencia)
- Cuotas de mercado disponibles

PASO 2 - BÚSQUEDA DE VALOR:
En vez de buscar "qué es más probable", busca "dónde paga de más la casa":
- Calcula TU probabilidad real para cada mercado alternativo
- Compara con la probabilidad implícita de la cuota (1/cuota)
- Si TU probabilidad > probabilidad implícita → HAY VALOR (edge positivo)

PASO 3 - FOCALIZAR EN MERCADOS SECUNDARIOS:
Los mercados principales (1X2) son los más eficientes. El VALOR está en:
- BTTS: Cruza datos de "ambos marcan" en últimos 10 partidos de cada equipo
- Corners: Cruza tiros, ataques, formaciones con extremos abiertos
- Tarjetas: Cruza faltas promedio + historial del árbitro
- Goles por tiempo: Cruza minutos de goles históricos
- Over/Under: No solo mires el promedio; mira la DISPERSIÓN

PASO 4 - VALIDACIÓN CRUZADA:
Para cada pick candidato:
- ¿Los datos estadísticos lo soportan? (≥ 3 indicadores alineados)
- ¿El H2H lo confirma o lo contradice?
- ¿El contexto (motivación, tabla, fatiga) ayuda o perjudica?
- ¿La cuota es justa, alta o baja respecto a tu cálculo?

PASO 5 - SELECCIÓN FINAL:
Elige los 2-5 picks con MAYOR edge positivo Y cuota ≥1.60.
Diversifica: máximo 2 picks de la misma categoría (ej: máx 2 de goles).

${MARKETS_CATALOG}

════════════════════════════════════════════════════════════════════════════════
DATOS COMPLETOS DEL PARTIDO
════════════════════════════════════════════════════════════════════════════════

PARTIDO: ${homeTeam} (LOCAL) vs ${awayTeam} (VISITANTE)
COMPETICIÓN: ${leagueName}
${standingsText}

>>> HISTORIAL ${homeTeam} (Equipo LOCAL):
${deepHome}

>>> HISTORIAL ${awayTeam} (Equipo VISITANTE):
${deepAway}

>>> ENFRENTAMIENTOS DIRECTOS (H2H):
${h2hText}

>>> CUOTAS DE MERCADO:
${oddsText}
${externalContextText}

════════════════════════════════════════════════════════════════════════════════
FORMATO DE SALIDA (JSON ESTRICTO)
════════════════════════════════════════════════════════════════════════════════

Responde ÚNICAMENTE con este JSON. Sin texto adicional, sin markdown.

{
    "meta": {
        "modelo": "${GEMINI_MODEL}",
        "version": "V1-PARLAY-HUNTER"
    },
    "analisis_breve": "Resumen de 2-3 frases del contexto del partido y por qué hay valor en ciertos mercados",
    "parlay_picks": [
        {
            "mercado": "Nombre exacto del mercado (ej: Ambos Anotan: Sí)",
            "seleccion": "La selección específica (ej: Sí)",
            "cuota_mercado": 1.85,
            "probabilidad_calculada_porcentaje": 62,
            "probabilidad_implicita_porcentaje": 54,
            "edge_porcentaje": 8,
            "nivel_riesgo": "medio",
            "razonamiento": "TEXTO DETALLADO (mínimo 100 palabras): Explica POR QUÉ hay valor. Usa datos específicos: 'Local marca en 8/10 como local (avg 1.8 GF/p), visitante marca en 7/10 fuera (avg 1.2 GF/p). H2H: BTTS en 4/5 últimos. Cuota 1.85 implica 54% pero datos sugieren 62%. Edge: +8%'",
            "datos_soporte": ["Dato 1: Local GF/p como local: 1.8", "Dato 2: Visitante GF/p fuera: 1.2", "Dato 3: H2H BTTS: 80%"],
            "tipo_mercado": "goles"
        }
    ],
    "nota_general": "Resumen de calidad: cuántos picks de valor se encontraron y nivel de confianza general"
}

REGLAS FINALES:
- "tipo_mercado" debe ser: "goles", "btts", "corners", "tarjetas", "handicap", "resultado", "tiempos", "especial"
- "nivel_riesgo": "bajo" (prob 65-75%), "medio" (prob 55-65%), "alto" (prob 45-55%)
- CADA pick DEBE tener edge positivo (tu prob > prob implícita)
- Si no encuentras suficiente valor, genera solo 2 picks con los que estés seguro
- Las cuotas DEBEN ser realistas basadas en los datos provistos
`;

        // ═══════════════════════════════════════════════════════════════
        // CALL LLM (multi-provider with automatic fallback)
        // ═══════════════════════════════════════════════════════════════
        const llmResult = await callLLM(prompt, {
            temperature: 0.5,
            jsonMode: true,
            maxTokens: 4096,
            timeoutMs: 90000,
        });

        let aiText = llmResult.text || '{}';
        const tokensUsed = llmResult.tokensUsed || 0;
        console.log(`[PARLAY-ANALYZER] ${llmResult.provider}/${llmResult.model} responded. Tokens: ${tokensUsed}`);

        // Clean JSON
        aiText = aiText.replace(/```json/g, '').replace(/```/g, '').trim();
        const startIdx = aiText.indexOf('{');
        const endIdx = aiText.lastIndexOf('}');
        if (startIdx !== -1 && endIdx > startIdx) {
            aiText = aiText.substring(startIdx, endIdx + 1);
        }

        let result: any;
        try {
            result = JSON5.parse(aiText);
        } catch (parseErr: any) {
            console.error('[PARLAY-ANALYZER] JSON parse error:', parseErr.message);
            result = { parlay_picks: [] };
        }

        const parlayPicks = result.parlay_picks || [];
        console.log(`[PARLAY-ANALYZER] Found ${parlayPicks.length} parlay picks`);

        if (parlayPicks.length === 0) {
            await supabase.from('analysis_jobs_v2')
                .update({ status: 'done', current_motor: 'V1-PARLAY-HUNTER', execution_time_ms: Date.now() - startTime })
                .eq('id', job_id);
            return new Response(JSON.stringify({ success: true, picks: 0 }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        // ═══════════════════════════════════════════════════════════════
        // RESOLVE finalFixtureId (same logic as v3-ai-analyzer)
        // ═══════════════════════════════════════════════════════════════
        let finalFixtureId = fixture_id;
        const normalizeTeam = (n: string) => n.toLowerCase().replace(/fc|cf|sc|sporting|club|athletic|atletico|real|inter|ac|as/g, '').replace(/[^a-z0-9]/g, '').trim();

        const { data: directMatch } = await supabase
            .from('daily_matches')
            .select('api_fixture_id')
            .eq('api_fixture_id', fixture_id)
            .maybeSingle();

        if (directMatch) {
            finalFixtureId = directMatch.api_fixture_id;
        } else {
            const homeNorm = normalizeTeam(homeTeam);
            const awayNorm = normalizeTeam(awayTeam);
            const { data: candidates } = await supabase
                .from('daily_matches')
                .select('api_fixture_id, home_team, away_team')
                .gte('match_date', new Date(Date.now() - 86400000 * 2).toISOString())
                .lte('match_date', new Date(Date.now() + 86400000 * 5).toISOString());

            if (candidates) {
                const best = candidates.find(c => {
                    const h = normalizeTeam(c.home_team);
                    const a = normalizeTeam(c.away_team);
                    return (h.includes(homeNorm) || homeNorm.includes(h)) &&
                        (a.includes(awayNorm) || awayNorm.includes(a));
                });
                if (best) {
                    console.log(`[PARLAY-ANALYZER] Resolved ${fixture_id} -> ${best.api_fixture_id}`);
                    finalFixtureId = best.api_fixture_id;
                }
            }
        }

        // Sync job fixture_id if resolved
        if (finalFixtureId !== fixture_id) {
            await supabase.from('analysis_jobs_v2').update({ fixture_id: finalFixtureId }).eq('id', job_id);
        }

        // ═══════════════════════════════════════════════════════════════
        // SAVE PARLAY PICKS
        // ═══════════════════════════════════════════════════════════════

        // Clean old picks for this fixture
        await supabase.from('parlay_picks_v2').delete().eq('fixture_id', finalFixtureId);
        if (fixture_id !== finalFixtureId) {
            await supabase.from('parlay_picks_v2').delete().eq('fixture_id', fixture_id);
        }

        const picksPayload = parlayPicks.map((p: any) => {
            let prob = p.probabilidad_calculada_porcentaje || 60;
            if (prob > 1) prob = prob / 100;

            return {
                job_id,
                fixture_id: finalFixtureId,
                market: p.mercado || 'Mercado',
                selection: p.seleccion || 'Selección',
                odds: p.cuota_mercado || null,
                p_model: prob,
                reasoning: p.razonamiento || '',
                risk_level: p.nivel_riesgo || 'medium',
                market_category: p.tipo_mercado || 'otro',
                home_team: homeTeam,
                away_team: awayTeam,
                league_name: leagueName,
                engine_version: 'V1-PARLAY'
            };
        });

        const { error: pickErr } = await supabase.from('parlay_picks_v2').insert(picksPayload);
        if (pickErr) console.error('[PARLAY-ANALYZER] Error saving picks:', pickErr);
        else console.log(`[PARLAY-ANALYZER] Saved ${picksPayload.length} picks for fixture ${finalFixtureId}`);

        // Clean old parlay jobs for same fixture (keep only current)
        const idsToClean = [finalFixtureId];
        if (fixture_id !== finalFixtureId) idsToClean.push(fixture_id);
        for (const fid of idsToClean) {
            await supabase.from('analysis_jobs_v2')
                .delete()
                .eq('fixture_id', fid)
                .eq('analysis_type', 'parlay')
                .neq('id', job_id);
        }

        // Update job to done
        await supabase.from('analysis_jobs_v2')
            .update({ status: 'done', current_motor: 'V1-PARLAY-HUNTER', execution_time_ms: Date.now() - startTime })
            .eq('id', job_id);

        console.log(`[PARLAY-ANALYZER] Done in ${Date.now() - startTime}ms`);

        return new Response(JSON.stringify({
            success: true,
            fixture_id: finalFixtureId,
            picks_saved: picksPayload.length,
            tokens_used: tokensUsed,
            execution_ms: Date.now() - startTime
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

    } catch (e: any) {
        const errorMsg = e.name === 'AbortError'
            ? 'Gemini timeout (90s) - el modelo no respondió a tiempo'
            : e.message?.substring(0, 500) || 'Error desconocido';
        console.error(`[PARLAY-ANALYZER] Fatal error: ${errorMsg}`);

        // Try to mark job as failed
        try {
            const { job_id } = await req.clone().json();
            if (job_id) {
                const sbUrl = Deno.env.get('SUPABASE_URL')!;
                const sbKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
                const supabase = createClient(sbUrl, sbKey);
                await supabase.from('analysis_jobs_v2')
                    .update({ status: 'failed', error_message: errorMsg, execution_time_ms: Date.now() - startTime })
                    .eq('id', job_id);
            }
        } catch (_) { /* ignore */ }

        return new Response(JSON.stringify({ success: false, error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
});
