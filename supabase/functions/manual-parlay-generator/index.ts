import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { callLLM } from '../_shared/llm-client.ts'
import { requireAdminOrService, authErrorResponse } from '../_shared/auth-guard.ts'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-secret',
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    // SECURITY: triggers paid LLM + writes to production parlays. Admins/cron only.
    const auth = await requireAdminOrService(req)
    if (!auth.ok) return authErrorResponse(auth as any, corsHeaders)

    try {
        const sbUrl = Deno.env.get('SUPABASE_URL')!
        const sbKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

        const supabase = createClient(sbUrl, sbKey)

        // Get date from request body
        const { date } = await req.json()
        const targetDate = (date || new Date().toISOString()).split('T')[0]

        console.log(`[ManualParlayGen] Generating for date: ${targetDate}`)

        // 1. Fetch analysis runs with predictions
        // CRITICAL: Filter by match_date (fecha del partido), NOT created_at (fecha de creación)
        // Esto asegura que solo se usen análisis de partidos del día seleccionado

        const { data: runs, error } = await supabase
            .from('analysis_runs')
            .select('*, predictions(*)')
            .eq('match_date', targetDate)  // ✅ FILTRO POR FECHA DEL PARTIDO

        if (error) throw error

        // Log para debugging
        console.log(`[ManualParlayGen] Query: analysis_runs where match_date = ${targetDate}`)
        console.log(`[ManualParlayGen] Found ${runs?.length || 0} runs`)

        const matches = runs
            ?.filter(r => r.predictions && r.predictions.length > 0)
            .map(r => ({
                dashboardData: r.report_pre_jsonb,
                analysisRun: r,
                matchDate: r.match_date  // Incluir para validación
            })) || []

        console.log(`[ManualParlayGen] ${matches.length} matches with predictions for ${targetDate}`)

        if (matches.length === 0) {
            return new Response(JSON.stringify({
                success: false,
                error: 'No hay análisis completados para esta fecha'
            }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 400
            })
        }

        // 2. Build enriched prompt (same as generateDailyParlay)
        const matchesSummary = matches.map((m, idx) => {
            const d = m.dashboardData
            if (!d) return null

            const fixtureId = m.analysisRun?.fixture_id || "Unknown"
            const statsTable = d.tablas_comparativas?.promedio_goles?.filas || []
            const homeName = d.header_partido?.titulo?.split(' vs ')?.[0] || "Local"
            const awayName = d.header_partido?.titulo?.split(' vs ')?.[1] || "Visitante"

            const getVal = (table: any[], teamIdx: number, colIdx: number) => table[teamIdx]?.[colIdx] || "N/A"
            const homeGF = getVal(statsTable, 0, 1)
            const homeGC = getVal(statsTable, 0, 2)
            const awayGF = getVal(statsTable, 1, 1)
            const awayGC = getVal(statsTable, 1, 2)

            const refInfo = d.analisis_detallado?.impacto_arbitro?.bullets?.join(' ') || "No info"
            const styleNotes = d.analisis_detallado?.estilo_y_tactica?.bullets?.join(' ') || ""

            const preds = d.predicciones_finales?.detalle?.map(p =>
                `   > ${p.mercado}: ${p.seleccion} (${p.probabilidad_estimado_porcentaje}%)`
            ).join('\n') || "   > Sin predicciones"

            return `
=== PARTIDO #${idx + 1} (ID: ${fixtureId}) ===
EQUIPOS: ${homeName} vs ${awayName}
COMPETICIÓN: ${d.header_partido?.subtitulo || 'N/A'}

DATOS ESTADÍSTICOS:
- GOLES PROMEDIO: 
  * ${homeName}: Anota ${homeGF}, Recibe ${homeGC}
  * ${awayName}: Anota ${awayGF}, Recibe ${awayGC}

CONTEXTO: ${styleNotes}
ÁRBITRO: ${refInfo}

PREDICCIONES INDIVIDUALES:
${preds}
`
        }).filter(Boolean).join('\n\n')

        // 3. Call Gemini with the super prompt
        const prompt = `
FECHA: ${targetDate}

ACTÚA COMO EXPERTO EN APUESTAS DEPORTIVAS.

OBJETIVO:
Crear 2 opciones de Parlay PROFESIONALES basadas en estos datos.

PRIORIDAD: MERCADOS ALTERNATIVOS (Goles, Córners, Tarjetas, etc.)
EVITA mercados 1X2 simples a menos que sea muy obvio.

DATOS:
${matchesSummary}

ESTRUCTURA JSON REQUERIDA:
[
  {
    "parlayTitle": "Parlay 'Seguro' (Alta Probabilidad)",
    "overallStrategy": "...",
    "finalOdds": 0.0,
    "winProbability": 75,
    "legs": [
      {
        "fixtureId": 12345,
        "game": "Equipo A vs B",
        "market": "Total Goles",
        "prediction": "Más de 2.5",
        "odds": 0,
        "reasoning": "Data específica del análisis"
      }
    ]
  }
]

REGLAS:
1. USA SOLO IDs REALES del input
2. SÉ PRECISO con reasoning (cita datos)
3. Calidad > Cantidad (máx 4 selecciones por parlay)
4. SÉ CREATIVO con mercados alternativos
    `

        const result = await callLLM(prompt, {
            temperature: 0.5,
            jsonMode: true,
            timeoutMs: 60000,
        })
        console.log(`[ManualParlayGen] LLM provider: ${result.provider}`)
        const text = result.text

        // 4. Parse and validate
        const clean = text.replace(/```json/g, '').replace(/```/g, '').trim()
        let parlays = JSON.parse(clean)

        if (!Array.isArray(parlays)) {
            parlays = [parlays]
        }

        console.log(`[ManualParlayGen] Generated ${parlays.length} parlays`)

        return new Response(JSON.stringify({
            success: true,
            parlays: parlays,
            matchesAnalyzed: matches.length
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })

    } catch (e: any) {
        console.error('[ManualParlayGen] Error:', e)
        return new Response(JSON.stringify({
            success: false,
            error: e.message
        }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
    }
})
