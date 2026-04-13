import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { callLLM } from '../_shared/llm-client.ts'

// FIX: Declare global Deno
declare const Deno: any;

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ═══════════════════════════════════════════════════════════════════════════
// V2 PREMIUM PARLAY ENGINE
// Sistema de análisis profundo para generar parlays de alto valor
// Usa toda la data de análisis + mercados alternativos
// ═══════════════════════════════════════════════════════════════════════════

interface MatchData {
    fixture_id: number;
    home_team: string;
    away_team: string;
    league: string;
    match_date: string;
    statistics: any;
    h2h: any[];
    teamStats: { home: any; away: any };
    valuePicks: any[];
    predictions: any[];
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const sbUrl = Deno.env.get('SUPABASE_URL')!
        const sbKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

        const supabase = createClient(sbUrl, sbKey)

        const { date } = await req.json()
        const targetDate = (date || new Date().toISOString()).split('T')[0]

        console.log(`[V2-PremiumParlay] ═══ Iniciando para fecha: ${targetDate} ═══`)

        // ═══════════════════════════════════════════════════════════════
        // FASE 1: EXTRACCIÓN PROFUNDA DE DATOS
        // ═══════════════════════════════════════════════════════════════
        console.log('[V2-PremiumParlay] FASE 1: Extracción profunda de datos')

        // 1.1 Obtener analysis_jobs_v2 con toda la data
        // NOTA: Usar created_at en rango (igual que v2-generate-parlays) porque match_date puede no estar poblado
        const { data: analysisJobs, error: jobsError } = await supabase
            .from('analysis_jobs_v2')
            .select('*')
            .gte('created_at', `${targetDate}T00:00:00`)
            .lt('created_at', `${targetDate}T23:59:59`)
            .eq('status', 'done')  // 'done' no 'completed'

        if (jobsError) {
            console.error('[V2-PremiumParlay] Error fetching analysis_jobs_v2:', jobsError)
        }

        // Obtener job IDs para buscar picks
        const jobIds = (analysisJobs || []).map(j => j.id)
        console.log(`[V2-PremiumParlay] Found ${jobIds.length} analysis jobs`)

        // DEBUG: Ver estructura real de data_football
        if (analysisJobs && analysisJobs.length > 0) {
            const sampleJob = analysisJobs[0]
            const df = sampleJob.data_football || {}
            console.log('[V2-PremiumParlay] DEBUG data_football keys:', Object.keys(df))
            console.log('[V2-PremiumParlay] DEBUG match exists:', !!df.match)
            console.log('[V2-PremiumParlay] DEBUG match.teams:', df.match?.teams)
            console.log('[V2-PremiumParlay] DEBUG teams:', df.teams)

            // Intentar encontrar nombres de equipos en diferentes rutas
            const possibleHomeNames = [
                df.match?.teams?.home?.name,
                df.teams?.home?.name,
                df.fixture?.teams?.home?.name,
                df.game?.home?.name,
                sampleJob.home_team  // directo del job
            ].filter(Boolean)
            console.log('[V2-PremiumParlay] DEBUG possible home names:', possibleHomeNames)
        }

        // 1.2 Obtener value_picks_v2 usando job_id (más confiable que match_date)
        let valuePicks: any[] = []
        if (jobIds.length > 0) {
            const { data: picks, error: picksError } = await supabase
                .from('value_picks_v2')
                .select('*')
                .in('job_id', jobIds)
                .eq('decision', 'BET')
                .gte('p_model', 0.60)

            if (picksError) {
                console.error('[V2-PremiumParlay] Error fetching value_picks_v2:', picksError)
            }
            valuePicks = picks || []
        }

        // 1.3 Obtener analysis_runs tradicionales (respaldo) - también por created_at
        const { data: analysisRuns, error: runsError } = await supabase
            .from('analysis_runs')
            .select('*, predictions(*)')
            .gte('created_at', `${targetDate}T00:00:00`)
            .lt('created_at', `${targetDate}T23:59:59`)

        if (runsError) {
            console.error('[V2-PremiumParlay] Error fetching analysis_runs:', runsError)
        }

        // Consolidar datos
        const jobsCount = analysisJobs?.length || 0
        const picksCount = valuePicks?.length || 0
        const runsCount = analysisRuns?.length || 0

        console.log(`[V2-PremiumParlay] Datos encontrados: ${jobsCount} jobs V2, ${picksCount} picks, ${runsCount} runs`)

        // Si no hay NINGUNA fuente de datos, retornar error
        if (jobsCount === 0 && runsCount === 0 && picksCount === 0) {
            return new Response(JSON.stringify({
                success: false,
                error: `No hay análisis completados para ${targetDate}. Analiza partidos primero.`
            }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 400
            })
        }

        // ═══════════════════════════════════════════════════════════════
        // FASE 1.5: OBTENER NOMBRES DE EQUIPOS DESDE daily_matches
        // (igual que v2-generate-parlays que SÍ funciona)
        // ═══════════════════════════════════════════════════════════════
        console.log('[V2-PremiumParlay] FASE 1.5: Obteniendo nombres de equipos desde daily_matches')

        // Obtener todos los fixture_ids de los jobs
        const fixtureIds = (analysisJobs || []).map(j => j.fixture_id).filter(Boolean)
        console.log(`[V2-PremiumParlay] Fixture IDs a buscar: ${fixtureIds.join(', ')}`)

        // Consultar daily_matches para obtener nombres reales
        let matchDataMap = new Map<number, any>()
        if (fixtureIds.length > 0) {
            const { data: dailyMatches, error: matchesError } = await supabase
                .from('daily_matches')
                .select('api_fixture_id, home_team, away_team, league_name')
                .in('api_fixture_id', fixtureIds)

            if (matchesError) {
                console.error('[V2-PremiumParlay] Error fetching daily_matches:', matchesError)
            } else {
                (dailyMatches || []).forEach(m => matchDataMap.set(m.api_fixture_id, m))
                console.log(`[V2-PremiumParlay] ✅ Encontrados ${matchDataMap.size} partidos en daily_matches`)
            }
        }

        // ═══════════════════════════════════════════════════════════════
        // FASE 2: ENRIQUECIMIENTO Y ESTRUCTURACIÓN
        // ═══════════════════════════════════════════════════════════════
        console.log('[V2-PremiumParlay] FASE 2: Enriquecimiento de datos')

        // Mapear fixture_id -> picks
        const picksByFixture = new Map<number, any[]>()
        valuePicks?.forEach(pick => {
            const fid = pick.fixture_id
            if (!picksByFixture.has(fid)) picksByFixture.set(fid, [])
            picksByFixture.get(fid)!.push(pick)
        })

        // Construir estructura enriquecida
        const enrichedMatches: MatchData[] = []

        // Priorizar analysis_jobs_v2 (más completos)
        for (const job of (analysisJobs || [])) {
            const fixtureId = job.fixture_id
            const dataFootball = job.data_football || {}

            // FUENTE PRINCIPAL: daily_matches (tiene los nombres correctos)
            const matchInfo = matchDataMap.get(fixtureId)

            // Extraer nombres de equipos - Priorizar daily_matches, luego data_football, luego fallback
            const homeTeam = matchInfo?.home_team ||
                dataFootball.match?.teams?.home?.name ||
                dataFootball.teams?.home?.name ||
                'Local'
            const awayTeam = matchInfo?.away_team ||
                dataFootball.match?.teams?.away?.name ||
                dataFootball.teams?.away?.name ||
                'Visitante'
            const leagueName = matchInfo?.league_name ||
                dataFootball.match?.competition?.name ||
                dataFootball.league?.name ||
                'Liga'

            enrichedMatches.push({
                fixture_id: fixtureId,
                home_team: homeTeam,
                away_team: awayTeam,
                league: leagueName,
                match_date: job.match_date || targetDate,
                statistics: dataFootball.statistics || null,
                h2h: dataFootball.h2h || [],
                teamStats: dataFootball.teamStats || { home: null, away: null },
                valuePicks: picksByFixture.get(fixtureId) || [],
                predictions: []
            })
        }

        // Añadir de analysis_runs si no están ya
        for (const run of (analysisRuns || [])) {
            if (!enrichedMatches.find(m => m.fixture_id === run.fixture_id)) {
                const report = run.report_pre_jsonb || {}
                const header = report.header_partido || {}
                const teams = header.titulo?.split(' vs ') || ['Local', 'Visitante']

                enrichedMatches.push({
                    fixture_id: run.fixture_id,
                    home_team: teams[0] || 'Local',
                    away_team: teams[1] || 'Visitante',
                    league: header.subtitulo || 'Liga',
                    match_date: run.match_date,
                    statistics: null,
                    h2h: [],
                    teamStats: { home: null, away: null },
                    valuePicks: picksByFixture.get(run.fixture_id) || [],
                    predictions: run.predictions || []
                })
            }
        }

        // NUEVO: Si solo tenemos value_picks_v2, construir partidos desde ahí
        // Esto cubre el caso donde el Motor V2 generó picks pero no hay jobs ni runs
        for (const [fixtureId, picks] of picksByFixture.entries()) {
            if (!enrichedMatches.find(m => m.fixture_id === fixtureId)) {
                // Tomar info del primer pick
                const firstPick = picks[0]
                enrichedMatches.push({
                    fixture_id: fixtureId,
                    home_team: firstPick?.home_team || 'Local',
                    away_team: firstPick?.away_team || 'Visitante',
                    league: firstPick?.league || 'Liga',
                    match_date: targetDate,
                    statistics: null,
                    h2h: [],
                    teamStats: { home: null, away: null },
                    valuePicks: picks,
                    predictions: []
                })
            }
        }

        console.log(`[V2-PremiumParlay] ${enrichedMatches.length} partidos enriquecidos`)

        if (enrichedMatches.length < 2) {
            return new Response(JSON.stringify({
                success: false,
                error: `Solo hay ${enrichedMatches.length} partido(s) analizados. Se necesitan mínimo 2 para crear parlays.`
            }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 400
            })
        }

        // ═══════════════════════════════════════════════════════════════
        // FASE 3: CONSTRUCCIÓN DEL SUPER PROMPT SECUENCIAL
        // ═══════════════════════════════════════════════════════════════
        console.log('[V2-PremiumParlay] FASE 3: Construcción de Super Prompt')

        // Formatear datos para el prompt
        const matchesSummary = enrichedMatches.map((m, idx) => {
            // Estadísticas de equipo
            let statsText = "Sin estadísticas detalladas"
            const homeStats = m.teamStats?.home
            const awayStats = m.teamStats?.away

            if (homeStats && awayStats) {
                const homeGoalsFor = homeStats.goals?.for?.average?.total || 'N/A'
                const homeGoalsAgainst = homeStats.goals?.against?.average?.total || 'N/A'
                const awayGoalsFor = awayStats.goals?.for?.average?.total || 'N/A'
                const awayGoalsAgainst = awayStats.goals?.against?.average?.total || 'N/A'

                // Corners (si disponible)
                const homeCorners = homeStats.fixtures?.corners?.total?.average || 'N/A'
                const awayCorners = awayStats.fixtures?.corners?.total?.average || 'N/A'

                // Tarjetas
                const homeCards = homeStats.cards?.yellow?.total || 'N/A'
                const awayCards = awayStats.cards?.yellow?.total || 'N/A'

                statsText = `
  - GOLES: ${m.home_team} (Anota: ${homeGoalsFor}, Recibe: ${homeGoalsAgainst}) | ${m.away_team} (Anota: ${awayGoalsFor}, Recibe: ${awayGoalsAgainst})
  - CORNERS PROMEDIO: ${m.home_team}: ${homeCorners} | ${m.away_team}: ${awayCorners}
  - TARJETAS AMARILLAS TOTALES: ${m.home_team}: ${homeCards} | ${m.away_team}: ${awayCards}`
            }

            // H2H resumen
            let h2hText = "Sin historial directo"
            if (m.h2h && m.h2h.length > 0) {
                const last5 = m.h2h.slice(0, 5)
                const totalGoals = last5.reduce((sum, g) => sum + (g.goals?.home || 0) + (g.goals?.away || 0), 0)
                const avgGoals = (totalGoals / last5.length).toFixed(1)
                h2hText = `Últimos ${last5.length} enfrentamientos: Promedio ${avgGoals} goles/partido`
            }

            // Value Picks identificados
            let picksText = "Sin picks de valor identificados"
            if (m.valuePicks && m.valuePicks.length > 0) {
                picksText = m.valuePicks.map(p =>
                    `  ✓ ${p.market}: ${Math.round(p.p_model * 100)}% prob (${p.decision})`
                ).join('\n')
            }

            // Predicciones del análisis original
            let predsText = ""
            if (m.predictions && m.predictions.length > 0) {
                predsText = `\nPREDICCIONES DEL ANÁLISIS:\n` + m.predictions.map(p =>
                    `  → ${p.selection}: ${p.confidence || 'N/A'}`
                ).join('\n')
            }

            return `
════════════════════════════════════════════════════════
PARTIDO #${idx + 1} | ID: ${m.fixture_id}
════════════════════════════════════════════════════════
${m.home_team} vs ${m.away_team}
Liga: ${m.league} | Fecha: ${m.match_date}

ESTADÍSTICAS:${statsText}

H2H: ${h2hText}

OPORTUNIDADES DETECTADAS:
${picksText}
${predsText}
`
        }).join('\n')

        // ═══════════════════════════════════════════════════════════════
        // PROMPT SECUENCIAL DE 4 FASES
        // ═══════════════════════════════════════════════════════════════
        const superPrompt = `
FECHA DE ANÁLISIS: ${targetDate}
TOTAL PARTIDOS DISPONIBLES: ${enrichedMatches.length}

════════════════════════════════════════════════════════════════════════════
🎯 ERES EL MOTOR DE PARLAYS MÁS SOFISTICADO DEL MUNDO
════════════════════════════════════════════════════════════════════════════

Tu objetivo es crear PARLAYS DE ALTO VALOR usando MERCADOS ALTERNATIVOS.
NO te limites a los mercados obvios (1X2, Over 2.5 básico).

MERCADOS ALTERNATIVOS A CONSIDERAR:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• GOLES POR TIEMPO: 1T Más de 0.5, 1T Más de 1.5, 2T Más de 0.5, 2T Más de 1.5
• GOLES POR EQUIPO: Local anota, Visitante anota, Local +1.5, Over/Under por equipo
• CORNERS: Más de 8.5, Más de 9.5, Más de 10.5 (total), Corners por equipo
• TARJETAS: Más de 3.5, Más de 4.5, Tarjetas por equipo
• COMBINADOS: Ambos marcan + Over 2.5, Resultado + Total goles
• ESPECIALES: Gol en ambos tiempos, Primer tiempo/Segundo tiempo resultado

DATOS DE LOS PARTIDOS:
${matchesSummary}

════════════════════════════════════════════════════════════════════════════
INSTRUCCIONES SECUENCIALES
════════════════════════════════════════════════════════════════════════════

PASO 1 - ANÁLISIS POR PARTIDO:
Para cada partido, identifica:
- ¿Qué equipo ataca más? ¿Cuál defiende peor?
- ¿El historial H2H tiene patrón de goles?
- ¿Hay picks de valor ya identificados que puedas usar?

PASO 2 - MERCADOS ALTERNATIVOS:
Para cada partido, selecciona 1-2 mercados alternativos con cuota estimada >= 1.25.
EVITA: Over 0.5 global (cuota ~1.05), Double Chance muy obvio.
PRIORIZA: Goles por tiempo, corners, tarjetas si hay data.

PASO 3 - CONSTRUCCIÓN DE PARLAYS:
Crea 2-3 parlays con estas reglas ESTRICTAS:
- EXACTAMENTE 3 selecciones por parlay
- Las 3 selecciones deben ser de 3 PARTIDOS DIFERENTES
- Cuota individual mínima: 1.25 (NO incluir cuotas < 1.20)
- Cuota combinada objetivo: >= 3.0
- Probabilidad combinada: >= 30%

PASO 4 - VALIDACIÓN:
Verifica que cada parlay cumpla las reglas antes de incluirlo.

════════════════════════════════════════════════════════════════════════════
FORMATO DE RESPUESTA (JSON ESTRICTO)
════════════════════════════════════════════════════════════════════════════

[
  {
    "parlayTitle": "Premium Parlay #1: [Nombre descriptivo]",
    "overallStrategy": "[Explicación de 2-3 oraciones de la estrategia general]",
    "finalOdds": 3.50,
    "winProbability": 38,
    "legs": [
      {
        "fixtureId": ${enrichedMatches[0]?.fixture_id || 123456},
        "game": "Equipo A vs Equipo B",
        "market": "1T Más de 0.5 Goles",
        "prediction": "Sí",
        "odds": 1.40,
        "reasoning": "[Datos específicos que justifican esta selección]"
      },
      {
        "fixtureId": ${enrichedMatches[1]?.fixture_id || 123457},
        "game": "Equipo C vs Equipo D",
        "market": "Corners: Más de 9.5",
        "prediction": "Sí",
        "odds": 1.65,
        "reasoning": "[Datos específicos que justifican esta selección]"
      },
      {
        "fixtureId": ${enrichedMatches[Math.min(2, enrichedMatches.length - 1)]?.fixture_id || 123458},
        "game": "Equipo E vs Equipo F",
        "market": "Ambos Marcan",
        "prediction": "Sí",
        "odds": 1.52,
        "reasoning": "[Datos específicos que justifican esta selección]"
      }
    ]
  }
]

IMPORTANTE:
- USA SOLO los fixtureId reales del input (${enrichedMatches.map(m => m.fixture_id).join(', ')})
- CITA DATOS ESPECÍFICOS en el reasoning (goles promedio, H2H, etc.)
- NO inventes estadísticas
- Si solo hay 2 partidos, crea parlays de 2 selecciones
`

        // ═══════════════════════════════════════════════════════════════
        // FASE 4: LLAMADA A GEMINI
        // ═══════════════════════════════════════════════════════════════
        console.log('[V2-PremiumParlay] FASE 4: Consultando LLM...')

        const llmResult = await callLLM(superPrompt, {
            temperature: 0.6,
            jsonMode: true,
            timeoutMs: 90000,
        })
        const text = llmResult.text
        console.log(`[V2-PremiumParlay] LLM responded via ${llmResult.provider}/${llmResult.model}`)

        // Parsear respuesta
        const clean = text.replace(/```json/g, '').replace(/```/g, '').trim()
        let parlays = JSON.parse(clean)

        if (!Array.isArray(parlays)) {
            parlays = [parlays]
        }

        // ═══════════════════════════════════════════════════════════════
        // FASE 5: VALIDACIÓN Y FILTRADO
        // ═══════════════════════════════════════════════════════════════
        console.log('[V2-PremiumParlay] FASE 5: Validación y filtrado')

        // Filtrar parlays que no cumplan reglas
        const validParlays = parlays.filter(parlay => {
            if (!parlay.legs || parlay.legs.length < 2) {
                console.log(`[V2-PremiumParlay] ⚠️ Parlay descartado: menos de 2 legs`)
                return false
            }

            // Verificar que los fixtureId sean reales
            const validFixtureIds = new Set(enrichedMatches.map(m => m.fixture_id))
            const allLegsValid = parlay.legs.every(leg => validFixtureIds.has(leg.fixtureId))

            if (!allLegsValid) {
                console.log(`[V2-PremiumParlay] ⚠️ Parlay descartado: fixtureId inválido`)
                return false
            }

            // Verificar partidos distintos
            const fixtureIdsInParlay = parlay.legs.map(l => l.fixtureId)
            const uniqueFixtures = new Set(fixtureIdsInParlay)
            if (uniqueFixtures.size < fixtureIdsInParlay.length) {
                console.log(`[V2-PremiumParlay] ⚠️ Parlay descartado: partidos repetidos`)
                return false
            }

            // Calcular cuota real
            const calculatedOdds = parlay.legs.reduce((acc, leg) => acc * (leg.odds || 1.3), 1)
            parlay.finalOdds = parseFloat(calculatedOdds.toFixed(2))

            return true
        })

        console.log(`[V2-PremiumParlay] ✅ ${validParlays.length} parlays válidos generados`)

        return new Response(JSON.stringify({
            success: true,
            parlays: validParlays,
            matchesAnalyzed: enrichedMatches.length,
            dataSource: jobsCount > 0 ? 'v2-engine' : 'legacy'
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })

    } catch (e: any) {
        console.error('[V2-PremiumParlay] ERROR:', e)
        return new Response(JSON.stringify({
            success: false,
            error: e.message
        }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
    }
})
