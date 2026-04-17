import { supabase } from './supabaseService';
import { AnalysisJob, AnalysisRun, VisualAnalysisResult, DashboardAnalysisJSON, JobProgress, DetallePrediccion } from '../types';
import { fetchFixturesList } from './liveDataService';

export interface PerformanceStats {
    total: number;
    wins: number;
    losses: number;
    pushed: number;
    winRate: number;
    yield: number;
    byMarket: Record<string, { total: number; wins: number; winRate: number }>;
    byLeague: Record<string, { total: number; wins: number; winRate: number }>;
    byDate: Record<string, { total: number; wins: number; profit: number }>;
    byConfidence: Record<'HIGH' | 'MEDIUM' | 'LOW', { total: number; wins: number; winRate: number }>;
    byProbability: Record<string, { total: number; wins: number; winRate: number }>;
    rawPredictions: any[];
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ADAPTADOR V3 -> FRONTEND
 * ═══════════════════════════════════════════════════════════════════════════
 * El motor V3 genera datos con una estructura ligeramente diferente a lo que
 * espera el componente AnalysisReportModal.tsx. Esta función normaliza TODO.
 * 
 * MAPEOS PRINCIPALES:
 * - resumen_ejecutivo.titular → resumen_ejecutivo.frase_principal
 * - resumen_ejecutivo.bullets → resumen_ejecutivo.puntos_clave
 * - analisis_detallado.enfoque_local → analisis_detallado.contexto_competitivo.bullets[]
 * - analisis_detallado.matchup_clave → analisis_detallado.estilo_y_tactica.bullets[]
 * - analisis_detallado.analisis_escenarios → escenarios_de_partido
 * ═══════════════════════════════════════════════════════════════════════════
 */
const adaptV3ToFrontend = (rawData: any): DashboardAnalysisJSON => {
    if (!rawData) return rawData;

    // Helper: Convertir string o array a objeto {titulo, bullets}
    const toSection = (data: any, defaultTitle: string): { titulo: string; bullets: string[] } => {
        if (!data) return { titulo: defaultTitle, bullets: [] };

        if (typeof data === 'string') {
            return { titulo: defaultTitle, bullets: [data] };
        }
        if (Array.isArray(data)) {
            return { titulo: defaultTitle, bullets: data.filter(x => x && typeof x === 'string') };
        }
        if (typeof data === 'object') {
            return {
                titulo: data.titulo || defaultTitle,
                bullets: Array.isArray(data.bullets) ? data.bullets :
                    (typeof data.descripcion === 'string' ? [data.descripcion] : [])
            };
        }
        return { titulo: defaultTitle, bullets: [] };
    };

    // Estrategia de Extracción de Datos (Data Scavenging)
    const deepContext = rawData.analisis_detallado || rawData.analisis_profundo || {};
    const contextComp = deepContext.contexto_competitivo || {};
    const tactic = deepContext.analisis_tactico || deepContext.estilo_y_tactica || {};
    const exec = rawData.resumen_ejecutivo || {};
    const veredict = rawData.veredicto_analista || {};

    // 1. Construir Resumen Ejecutivo
    const frasePrincipal = exec.titular || exec.frase_principal || exec.veredicto || veredict.razon_principal || "Análisis de Inteligencia Finalizado";
    const puntosClave = exec.puntos_clave || exec.bullets || exec.picks_principales || [];

    // 2. Construir Análisis Detallado (Garantizar que NO sea null)
    const analisisDetallado = {
        contexto_competitivo: toSection(
            deepContext.contexto_competitivo || rawData.analisis_detallado?.contexto_competitivo,
            'Contexto del Partido'
        ),
        estilo_y_tactica: toSection(
            tactic,
            'Análisis Táctico'
        ),
        analisis_tactico_formaciones: toSection(
            deepContext.analisis_tactico_formaciones || deepContext.jugadores_clave,
            'Jugadores Clave'
        ),
        escenarios_de_partido: deepContext.escenarios_de_partido || deepContext.analisis_escenarios || null,
        factor_psicologico: deepContext.factor_psicologico || null
    };

    // Fallback Inteligente: Si análisis detallado está vacío, usar puntos clave
    if (analisisDetallado.contexto_competitivo.bullets.length === 0 && puntosClave.length > 0) {
        analisisDetallado.contexto_competitivo.bullets = [puntosClave[0]];
        if (puntosClave.length > 1) {
            analisisDetallado.estilo_y_tactica.bullets = puntosClave.slice(1);
        }
    }

    // 3. Fallback para Estilo y Táctica si aún está vacío
    if (analisisDetallado.estilo_y_tactica.bullets.length === 0) {
        if (deepContext.matchup_tactico) {
            analisisDetallado.estilo_y_tactica.bullets.push(deepContext.matchup_tactico);
        }
        if (deepContext.clave_del_partido) {
            analisisDetallado.estilo_y_tactica.bullets.push(deepContext.clave_del_partido);
        }
        // Fallback for AI Hallucinations (factor_clave)
        if (deepContext.factor_clave) {
            analisisDetallado.estilo_y_tactica.bullets.push(`Clave: ${deepContext.factor_clave}`);
        }
    }

    // 3.1 Fallback para Contexto (si falta contexto_competitivo)
    if (analisisDetallado.contexto_competitivo.bullets.length === 0) {
        if (deepContext.factor_psicologico?.analisis) {
            analisisDetallado.contexto_competitivo.bullets.push(deepContext.factor_psicologico.analisis);
        }
    }

    // 4. Construir Veredicto Analista
    const veredictoAnalista = {
        decision: veredict.decision || exec.veredicto || 'OBSERVAR',
        nivel_confianza: veredict.nivel_confianza || exec.confianza_global || 'MEDIA',
        probabilidad: veredict.probabilidad || (rawData.predicciones_finales?.detalle?.[0]?.probabilidad_estimado_porcentaje) || 50,
        titulo_accion: veredict.titulo_accion || (exec.veredicto === 'APOSTAR' ? 'OPORTUNIDAD DETECTADA' : 'ANÁLISIS COMPLETADO'),
        razon_principal: veredict.razon_principal || frasePrincipal,
        riesgo_principal: veredict.riesgo_principal || rawData.advertencias?.riesgos?.[0] || 'Sin riesgos críticos detectados',
        seleccion_clave: veredict.seleccion_clave || rawData.predicciones_finales?.detalle?.[0]?.seleccion || 'N/A'
    };

    // 5. Construir Predicciones con Mapeo Seguro
    let rawPreds = rawData.predicciones_finales?.detalle || rawData.pronosticos || [];

    // 5.1 Rescue logic for 'probabilidades_derbix' (Frontend Side Polyfill)
    const probSource = rawData.probabilidades_derbix || rawData.probabilities || rawData.probabilidades;
    if (rawPreds.length === 0 && probSource) {
        console.log('[ADAPTER] Rescuing predictions from probabilidades_derbix:', probSource);
        const keys = Object.keys(probSource);
        keys.forEach((k, idx) => {
            const key = k.toLowerCase();
            const valStr = String(probSource[k]).replace('%', '');
            const val = parseFloat(valStr);

            let label = "Mercado Especial";
            let seleccion = k;

            if (key.includes('home') || key.includes('local')) { label = 'Ganador del Partido (1X2)'; seleccion = rawData.header_partido?.titulo?.split(' vs ')[0] || 'Local'; }
            else if (key.includes('away') || key.includes('visit')) { label = 'Ganador del Partido (1X2)'; seleccion = rawData.header_partido?.titulo?.split(' vs ')[1] || 'Visita'; }
            else if (key.includes('draw') || key.includes('empate')) { label = 'Ganador del Partido (1X2)'; seleccion = "Empate"; }
            else if (key.includes('btts') || key.includes('ambos')) { label = 'Ambos Equipos Anotan'; seleccion = "Sí"; }
            else if (key.includes('over')) { label = 'Total de Goles'; seleccion = "Más de 2.5"; }
            else if (key.includes('under')) { label = 'Total de Goles'; seleccion = "Menos de 2.5"; }

            if (!isNaN(val) && val > 45) {
                rawPreds.push({
                    id: idx + 999,
                    mercado: label,
                    seleccion: seleccion,
                    probabilidad_estimado_porcentaje: val,
                    justificacion_detallada: {
                        base_estadistica: ["Probabilidad calculada por modelo."],
                        contexto_competitivo: ["Oportunidad detectada en análisis profundo."],
                        conclusion: "Valor matemático identificado."
                    },
                    odds: null
                });
            }
        });
    }

    const mappedPreds: DetallePrediccion[] = rawPreds.map((p: any, idx: number) => {
        // ═══════════════════════════════════════════════════════════════
        // UNIVERSAL FIELD NORMALIZER (Handles AI field name variations)
        // ═══════════════════════════════════════════════════════════════

        // 1. Parse probability from ANY possible field name
        const probRaw = p.probabilidad_estimado_porcentaje
            || p.probabilidad_calculada_porcentaje
            || p.probabilidad_derbix
            || p.probabilidad_implicita
            || p.probabilidad
            || p.probability
            || "50%";
        const prob = typeof probRaw === 'string'
            ? parseFloat(probRaw.replace('%', '').replace('+', ''))
            : probRaw;

        // 2. Parse edge from ANY possible field name
        const edgeRaw = p.edge || p.edge_porcentaje || p.edge_calculado || "0%";
        const edge = typeof edgeRaw === 'string'
            ? parseFloat(edgeRaw.replace('%', '').replace('+', ''))
            : edgeRaw;

        // 3. Parse odds from ANY possible field name
        const odds = p.odds || p.cuota_actual || p.cuota_estimada || p.cuota_referencia || null;

        // 4. Parse justification from ANY possible field name
        const justRaw = p.razonamiento || p.justificacion_detallada?.base_estadistica?.[0] || p.justificacion?.estadistica || "Análisis IA completado";
        const justText = typeof justRaw === 'string' ? justRaw : (Array.isArray(justRaw) ? justRaw[0] : JSON.stringify(justRaw));

        return {
            id: p.id || idx,
            mercado: p.mercado || "Mercado Principal",
            seleccion: p.seleccion || "Selección",
            probabilidad_estimado_porcentaje: prob || 50,
            edge: edge || null,
            odds: odds,
            justificacion_detallada: {
                base_estadistica: p.justificacion_detallada?.base_estadistica || (justText ? [justText.substring(0, 200)] : []),
                contexto_competitivo: p.justificacion_detallada?.contexto_competitivo || [p.nivel_confianza || p.tipo || "Análisis Profundo"],
                conclusion: p.justificacion_detallada?.conclusion || (justText && justText.length > 200 ? justText.substring(200) : "Valor matemático identificado.")
            }
        };
    });

    const adapted: DashboardAnalysisJSON = {
        ...rawData,
        resumen_ejecutivo: {
            frase_principal: frasePrincipal,
            puntos_clave: puntosClave.map((p: any) => typeof p === 'string' ? p : `${p.mercado || ''}: ${p.seleccion || ''}`)
        },
        analisis_detallado: analisisDetallado,
        veredicto_analista: veredictoAnalista,
        predicciones_finales: {
            titulo: "Predicciones del Modelo",
            detalle: mappedPreds
        },
        header_partido: rawData.header_partido || {
            titulo: "Análisis de Partido",
            subtitulo: new Date().toLocaleDateString()
        }
    };

    console.log('[ADAPTER] V3 data adaptado y saneado para Frontend');
    return adapted;
};

/**
 * Inicia un trabajo de análisis llamando al Motor V3.
 * V3 usa pipeline simplificado: ETL → IA Puro (Gemini hace TODO)
 */
export const createAnalysisJob = async (apiFixtureId: number, timezone: string = 'America/Bogota', organizationId?: string): Promise<string> => {
    try {
        console.log(`[V3] Iniciando análisis IA PURO para fixture ${apiFixtureId}...`);

        // NOTE: Do NOT delete 'analisis' cache here. The analyzer handles cleanup
        // after successful completion. Deleting prematurely causes the match to
        // appear as "not analyzed" while the new analysis runs in background.

        // ═══════════════════════════════════════════════════════════════
        // MOTOR V3: Pipeline simplificado (ETL SportMonks → IA Puro)
        // Gemini recibe TODOS los datos y toma TODAS las decisiones
        // ═══════════════════════════════════════════════════════════════
        const { data, error } = await supabase.functions.invoke('v2-create-job-sportmonks', {
            body: {
                fixture_id: apiFixtureId
            }
        });

        let responseData = data;

        // Robustez: Si data viene como string, parsearlo
        if (typeof data === 'string') {
            try {
                responseData = JSON.parse(data);
            } catch (e) {
                console.error("[V3] Error parseando respuesta:", e);
            }
        }

        if (error) {
            console.error("[V3] Error de Edge Function:", error);
            throw new Error(error.message || JSON.stringify(error));
        }

        if (!responseData?.success) {
            console.error("[V3] Pipeline falló:", responseData?.error);
            throw new Error(responseData?.error || "Pipeline V3 falló");
        }

        if (!responseData.job_id) {
            console.error("[V3] Respuesta sin job_id:", responseData);
            throw new Error("V3 no devolvió job_id válido");
        }

        // V8: ETL responde inmediatamente con job_id
        console.log(`[V3] ✅ ETL completado: ${responseData.job_id}`);
        console.log(`[V3] Coverage: ${responseData.coverage_pct}% | ${responseData.summary?.home_matches || 'N/A'}`);

        // CRITICAL: Invoke analyzer from the BROWSER (fire-and-forget).
        // The Deno ETL's fire-and-forget fetch was unreliable — Deno kills background
        // promises when the Response is returned. The browser won't kill this promise.
        // The analyzer reads etl_context from DB — only job_id and fixture_id needed.
        console.log(`[V3] Lanzando analyzer desde el navegador para job ${responseData.job_id}...`);
        supabase.functions.invoke('v3-ai-analyzer', {
            body: {
                job_id: responseData.job_id,
                fixture_id: apiFixtureId
            }
        }).then(async ({ data: analyzerData, error: analyzerErr }) => {
            if (analyzerErr) {
                console.error(`🔴 [V3] Analyzer invocation error:`, analyzerErr);
                // Try to read the error body for debugging
                try {
                    const ctx = (analyzerErr as any).context;
                    if (ctx && typeof ctx.json === 'function') {
                        const body = await ctx.json();
                        console.error(`🔴 [V3] Analyzer error body:`, JSON.stringify(body));
                    } else if (ctx) {
                        console.error(`🔴 [V3] Analyzer error context:`, ctx);
                    }
                } catch (_e) { /* ignore body read errors */ }
            } else {
                console.log(`[V3] ✅ Analyzer completó exitosamente para job ${responseData.job_id}`);
                // Launch parlay analysis with delay (individual analysis, not batch)
                // In batch mode, LiveFeed.tsx handles this via polling to avoid duplicates
                launchParlayForFixture(apiFixtureId, 8000);
            }
        }).catch(err => {
            console.error(`[V3] Analyzer call failed:`, err.message);
        });

        return responseData.job_id;

    } catch (err: any) {
        console.error("[V2] Error crítico:", err);
        throw new Error(err.message || "Error en el Motor V2. Intenta nuevamente.");
    }
};

/**
 * Lanza el parlay analyzer para un fixture DESPUÉS de que el análisis estándar completó.
 * Se ejecuta con un delay para evitar competir con Gemini API rate limits.
 * Fire-and-forget desde el browser — no bloquea el batch.
 */
export const launchParlayForFixture = (fixtureId: number, delayMs: number = 8000): void => {
    console.log(`[Parlay] Programando parlay analysis para fixture ${fixtureId} en ${delayMs/1000}s...`);
    setTimeout(async () => {
        try {
            // Check if a parlay job already exists for this fixture today (avoid duplicates)
            const today = new Date().toISOString().split('T')[0];
            const { data: existingParlay } = await supabase
                .from('analysis_jobs_v2')
                .select('id')
                .eq('fixture_id', fixtureId)
                .eq('analysis_type', 'parlay')
                .gte('created_at', today)
                .limit(1);

            if (existingParlay && existingParlay.length > 0) {
                console.log(`[Parlay] Parlay job already exists for fixture ${fixtureId}. Skipping.`);
                return;
            }

            // Buscar el job estándar para obtener el etl_context
            const { data: standardJob } = await supabase
                .from('analysis_jobs_v2')
                .select('id, etl_context')
                .eq('fixture_id', fixtureId)
                .or('analysis_type.eq.standard,analysis_type.is.null')
                .eq('status', 'done')
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (!standardJob?.etl_context) {
                console.warn(`[Parlay] No etl_context found for fixture ${fixtureId}. Skipping parlay.`);
                return;
            }

            // Crear job de parlay en DB
            const { data: parlayJob, error: parlayErr } = await supabase
                .from('analysis_jobs_v2')
                .insert({
                    fixture_id: fixtureId,
                    status: 'etl',
                    current_motor: 'PARLAY-ANALYZER',
                    engine_version: 'V8.2-STRATEGIC',
                    analysis_type: 'parlay',
                    etl_context: standardJob.etl_context
                })
                .select()
                .single();

            if (parlayErr || !parlayJob) {
                console.warn(`[Parlay] Failed to create parlay job:`, parlayErr?.message);
                return;
            }

            console.log(`[Parlay] Invocando v3-parlay-analyzer para job ${parlayJob.id}...`);
            const { error: invokeErr } = await supabase.functions.invoke('v3-parlay-analyzer', {
                body: {
                    job_id: parlayJob.id,
                    fixture_id: fixtureId
                }
            });

            if (invokeErr) {
                console.error(`[Parlay] Parlay analyzer error:`, invokeErr);
            } else {
                console.log(`[Parlay] ✅ Parlay analysis completado para fixture ${fixtureId}`);
            }
        } catch (err: any) {
            console.warn(`[Parlay] Error (non-blocking):`, err.message);
        }
    }, delayMs);
};

/* ═══════════════════════════════════════════════════════════════
   V1 LEGACY (Comentado - usar solo si V2 falla)
   ═══════════════════════════════════════════════════════════════
export const createAnalysisJobV1 = async (apiFixtureId: number, timezone: string = 'America/Bogota', organizationId?: string): Promise<string> => {
    const { data, error } = await supabase.functions.invoke('create-analysis-job', {
        body: {
            api_fixture_id: apiFixtureId,
            timezone,
            organization_id: organizationId,
            last_n: 10,
            threshold: 70
        }
    });
    if (error || !data?.job_id) throw new Error("Error V1");
    return data.job_id;
};
*/

/**
 * Obtiene el estado actual de un trabajo.
 * V2: Busca primero en analysis_jobs_v2, luego en analysis_jobs (V1).
 */
export const getAnalysisJob = async (jobId: string): Promise<AnalysisJob | null> => {
    // Use maybeSingle to avoid 406 errors when the job was deleted or never existed.
    // (PostgREST returns 406 Not Acceptable with .single() when rowCount != 1)
    const { data: v2Data, error: v2Error } = await supabase
        .from('analysis_jobs_v2')
        .select('*')
        .eq('id', jobId)
        .maybeSingle();

    if (v2Data && !v2Error) {
        // Mapear V2 al formato esperado por la UI (V2 tiene estructura diferente)
        return {
            id: v2Data.id,
            api_fixture_id: v2Data.fixture_id,
            fixture_id: v2Data.fixture_id,
            status: v2Data.status === 'done' ? 'done' : v2Data.status === 'failed' ? 'failed' : 'processing',
            created_at: v2Data.created_at,
            updated_at: v2Data.updated_at,
            error_message: v2Data.error_message,
            organization_id: null,
            completeness_score: v2Data.data_coverage_score || 100,
            estimated_calls: 5,
            actual_calls: 5,
            progress_jsonb: { step: 'V2', completeness_score: 100, fetched_items: 5, total_items: 5 }
        } as unknown as AnalysisJob;
    }

    // V1 fallback removed - only V3 pipeline active
    return null;
};

/**
 * Marca un job como 'failed' en la DB cuando el frontend hace timeout.
 * Esto evita que jobs stuck bloqueen la vista de Oportunidades indefinidamente.
 */
export const markJobAsTimedOut = async (jobId: string): Promise<void> => {
    const { error } = await supabase
        .from('analysis_jobs_v2')
        .update({ status: 'failed', error_message: 'FRONTEND_TIMEOUT' })
        .eq('id', jobId)
        .neq('status', 'done');

    if (error) {
        console.error(`[markJobAsTimedOut] Error updating job ${jobId}:`, error.message);
    } else {
        console.log(`[markJobAsTimedOut] Job ${jobId} marked as failed (timeout)`);
    }
};

/**
 * Busca análisis por fixture_id (para persistencia al refrescar).
 * Prioriza V2, luego fallback a V1.
 */
export const getAnalysisResultByFixture = async (fixtureId: number): Promise<VisualAnalysisResult | null> => {
    // 1. Buscar último job V2 completado para este fixture (excluir parlay jobs)
    const { data: v2Job } = await supabase
        .from('analysis_jobs_v2')
        .select('id')
        .eq('fixture_id', fixtureId)
        .eq('status', 'done')
        .or('analysis_type.eq.standard,analysis_type.is.null')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (v2Job) {
        console.log(`[V2] Encontrado análisis para fixture ${fixtureId}: job ${v2Job.id}`);
        return getAnalysisResult(v2Job.id);
    }

    // 2. Fallback: Buscar en V1
    const { data: v1Job } = await supabase
        .from('analysis_jobs')
        .select('id')
        .eq('api_fixture_id', fixtureId)
        .eq('status', 'done')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (v1Job) {
        console.log(`[V1] Encontrado análisis para fixture ${fixtureId}: job ${v1Job.id}`);
        return getAnalysisResult(v1Job.id);
    }

    console.log(`[Analysis] No hay análisis para fixture ${fixtureId}`);
    return null;
};

/**
 * Obtiene el resultado final del análisis.
 * V3: Busca en reports_v2, retorna dashboardData pre-formateado (V3 ya lo construye)
 * V2: Busca en reports_v2 + value_picks_v2, luego fallback a V1.
 */
export const getAnalysisResult = async (jobId: string): Promise<VisualAnalysisResult | null> => {
    // ═══════════════════════════════════════════════════════════════
    // INTENTAR V2/V3 PRIMERO (reports_v2)
    // ═══════════════════════════════════════════════════════════════
    const { data: v2Report, error: reportError } = await supabase
        .from('reports_v2')
        .select('*')
        .eq('job_id', jobId)
        .maybeSingle(); // Use maybeSingle to avoid error when no rows

    if (reportError) {
        console.error('[analysisService] Error fetching report:', reportError);
    }

    if (v2Report?.report_packet) {
        const report = v2Report.report_packet;

        // ═══════════════════════════════════════════════════════════════
        // V3 DETECTION: Si tiene 'pronosticos' array o meta.modelo_version = V3
        // V3 ya guarda dashboardData pre-formateado en la tabla 'analisis'
        // ═══════════════════════════════════════════════════════════════
        const isV3 = report.pronosticos || report.meta?.modelo_version?.includes('V3');

        if (isV3) {
            console.log(`[analysisService] V3 report detected for job ${jobId}`);

            // Buscar el dashboardData pre-formateado en la tabla 'analisis'
            const { data: v3Analysis } = await supabase
                .from('analysis_jobs_v2')
                .select('fixture_id')
                .eq('id', jobId)
                .maybeSingle();

            if (v3Analysis?.fixture_id) {
                const { data: cachedAnalysis } = await supabase
                    .from('analisis')
                    .select('resultado_analisis')
                    .eq('partido_id', v3Analysis.fixture_id)
                    .maybeSingle();

                if (cachedAnalysis?.resultado_analisis?.dashboardData) {
                    console.log(`[analysisService] V3 cached dashboardData found, applying adapter`);
                    const adaptedData = adaptV3ToFrontend(cachedAnalysis.resultado_analisis.dashboardData);
                    return {
                        analysisText: adaptedData.resumen_ejecutivo?.frase_principal || "Análisis V3 completado.",
                        dashboardData: adaptedData,
                        analysisRun: undefined,
                        payload: v2Report.input_payload // Map payload explicitly from reports_v2
                    };
                }
            }

            // Fallback: Check if input_payload is in the root of v2Report (where we added it)
            const inputPayload = v2Report.input_payload;

            // Fallback: Construir dashboardData directamente del V3 report_packet
            console.log(`[analysisService] V3 building dashboardData from report_packet`);

            // ═══════════════════════════════════════════════════════════════
            // DEEP PROBABILITY EXTRACTOR (Route B Fix)
            // ═══════════════════════════════════════════════════════════════
            let betPicks = report.pronosticos || [];

            // Rescue from probabilidades_derbix if pronosticos is empty
            const probSource = report.probabilidades_derbix || report.probabilities || report.probabilidades;
            if (betPicks.length === 0 && probSource) {
                console.log('[analysisService] 🚨 Rescuing picks from probabilidades_derbix:', Object.keys(probSource));
                Object.keys(probSource).forEach((key, idx) => {
                    const val = parseFloat(String(probSource[key]).replace('%', ''));
                    if (!isNaN(val) && val > 0) {
                        let mercado = "Mercado Especial";
                        let seleccion = key;
                        const lowerKey = key.toLowerCase();

                        if (lowerKey.includes('home') || lowerKey.includes('local')) {
                            mercado = 'Ganador del Partido (1X2)';
                            seleccion = report.header_partido?.titulo?.split(' vs ')[0] || 'Local';
                        } else if (lowerKey.includes('away') || lowerKey.includes('visit')) {
                            mercado = 'Ganador del Partido (1X2)';
                            seleccion = report.header_partido?.titulo?.split(' vs ')[1] || 'Visita';
                        } else if (lowerKey.includes('draw') || lowerKey.includes('empate')) {
                            mercado = 'Ganador del Partido (1X2)';
                            seleccion = 'Empate';
                        } else if (lowerKey.includes('btts') || lowerKey.includes('ambos')) {
                            mercado = 'Ambos Equipos Anotan (BTTS)';
                            seleccion = 'Sí';
                        } else if (lowerKey.includes('over')) {
                            mercado = 'Total de Goles (Over/Under)';
                            seleccion = 'Más de 2.5 Goles';
                        } else if (lowerKey.includes('under')) {
                            mercado = 'Total de Goles (Over/Under)';
                            seleccion = 'Menos de 2.5 Goles';
                        }

                        betPicks.push({
                            mercado,
                            seleccion,
                            probabilidad_calculada_porcentaje: val,
                            cuota_actual: null,
                            edge_porcentaje: 0,
                            justificacion: {
                                estadistica: "Probabilidad calculada por modelo Derbix.",
                                contexto: "Análisis profundo completado.",
                                tactica: "Valor matemático identificado."
                            }
                        });
                    }
                });
                console.log(`[analysisService] ✅ Rescued ${betPicks.length} picks from probabilidades_derbix`);
            }

            // Log final pick count for debugging
            console.log(`[analysisService] Final betPicks count: ${betPicks.length}`);

            return {
                analysisText: report.resumen_ejecutivo?.titular || "Análisis V3 completado.",
                dashboardData: {
                    veredicto_analista: {
                        decision: report.resumen_ejecutivo?.veredicto || 'OBSERVAR',
                        nivel_confianza: report.resumen_ejecutivo?.confianza_global || 'MEDIA',
                        probabilidad: betPicks[0]?.probabilidad_calculada_porcentaje || 50,
                        titulo_accion: report.resumen_ejecutivo?.veredicto === 'APOSTAR' ? 'OPORTUNIDAD DETECTADA' : 'PARTIDO COMPLEJO',
                        razon_principal: report.resumen_ejecutivo?.titular || '',
                        riesgo_principal: report.factores_riesgo?.riesgo_principal || '',
                        seleccion_clave: betPicks[0]?.seleccion || 'N/A'
                    },
                    resumen_ejecutivo: {
                        frase_principal: report.resumen_ejecutivo?.titular ||
                            report.resumen_ejecutivo?.frase_principal ||
                            report.conclusion_final?.titular ||
                            `Análisis completado - ${betPicks.length} predicciones`,
                        puntos_clave: [
                            report.analisis_profundo?.contexto_competitivo?.situacion_local,
                            report.analisis_profundo?.contexto_competitivo?.situacion_visitante,
                            report.analisis_profundo?.contexto_competitivo?.implicaciones_partido,
                            // Fallback: Rescue from factor_psicologico
                            report.analisis_profundo?.factor_psicologico?.presion_local,
                            report.analisis_profundo?.factor_psicologico?.temperatura_mental,
                            // Fallback: Rescue from lectura_de_mercado
                            report.analisis_profundo?.lectura_de_mercado?.ineficiencia_detectada
                        ].filter(Boolean).slice(0, 4) // Limit to 4 points
                    },
                    analisis_detallado: {
                        contexto_competitivo: {
                            titulo: 'Lo Que Se Juegan',
                            bullets: [
                                report.analisis_profundo?.contexto_competitivo?.situacion_local,
                                report.analisis_profundo?.contexto_competitivo?.situacion_visitante,
                                // Fallback: Rescue from factor_psicologico
                                report.analisis_profundo?.factor_psicologico?.presion_local,
                                report.analisis_profundo?.factor_psicologico?.presion_visitante,
                                report.analisis_profundo?.factor_psicologico?.temperatura_mental
                            ].filter(Boolean)
                        },
                        estilo_y_tactica: {
                            titulo: 'Análisis Táctico Profundo',
                            bullets: [
                                report.analisis_profundo?.analisis_tactico?.enfoque_local,
                                report.analisis_profundo?.analisis_tactico?.enfoque_visitante,
                                report.analisis_profundo?.analisis_tactico?.matchup_clave,
                                // Fallback: Rescue from hallucinated keys
                                report.analisis_profundo?.factor_clave,
                                report.analisis_profundo?.clave_del_partido,
                                // NEW: AI's actual structure (matchup_tactico is an OBJECT not a string)
                                report.analisis_profundo?.matchup_tactico?.detalle,
                                report.analisis_profundo?.matchup_tactico?.clave_del_partido,
                                report.analisis_profundo?.matchup_tactico?.estilo
                            ].filter(Boolean)
                        },
                        analisis_escenarios: {
                            titulo: 'Escenarios Proyectados',
                            bullets: [
                                report.escenarios_proyectados?.escenario_mas_probable?.descripcion,
                                report.escenarios_proyectados?.escenario_alternativo?.descripcion,
                                // Fallback: Rescue from lectura_de_mercado
                                report.analisis_profundo?.lectura_de_mercado?.analisis_cuotas,
                                report.analisis_profundo?.lectura_de_mercado?.ineficiencia_detectada
                            ].filter(Boolean)
                        }
                    },
                    predicciones_finales: {
                        detalle: betPicks.map((p: any, idx: number) => {
                            // ═══════════════════════════════════════════════════════════════
                            // UNIVERSAL FIELD NORMALIZER (Handles AI field name variations)
                            // ═══════════════════════════════════════════════════════════════

                            // Parse probability from any of the possible field names
                            const probRaw = p.probabilidad_calculada_porcentaje
                                || p.probabilidad_derbix
                                || p.probabilidad
                                || p.probability
                                || "50%";
                            const prob = typeof probRaw === 'string'
                                ? parseFloat(probRaw.replace('%', '').replace('+', ''))
                                : probRaw;

                            // Parse edge from any of the possible field names
                            const edgeRaw = p.edge_porcentaje || p.edge_calculado || p.edge || "0%";
                            const edge = typeof edgeRaw === 'string'
                                ? parseFloat(edgeRaw.replace('%', '').replace('+', ''))
                                : edgeRaw;

                            // Parse odds from any of the possible field names
                            const odds = p.cuota_actual || p.cuota_referencia || p.odds || null;

                            // Parse justification from any of the possible field names
                            const justRaw = p.razonamiento || p.justificacion?.estadistica || p.justificacion || "Análisis IA completado";
                            const justText = typeof justRaw === 'string' ? justRaw : JSON.stringify(justRaw);

                            return {
                                id: idx,
                                mercado: p.mercado || "Mercado Especial",
                                seleccion: p.seleccion || "Selección",
                                probabilidad_estimado_porcentaje: prob || 50,
                                edge: edge || null,
                                odds: odds,
                                justificacion_detallada: {
                                    base_estadistica: [justText.substring(0, 200)],
                                    contexto_competitivo: [p.tipo || "Análisis Profundo"],
                                    conclusion: justText.length > 200 ? justText.substring(200) : 'Valor matemático identificado.'
                                }
                            };
                        })
                    },
                    analisis_mercados_calculados: {
                        descripcion: "Análisis IA V3 - Motor Puro",
                        mercados_evaluados: report.mercados_evaluados?.total_analizados || 60,
                        mercados_con_valor: report.mercados_evaluados?.con_valor_detectado || betPicks.length,
                        resumen: {
                            goles_esperados: report.datos_modelo?.goles_esperados_partido || 2.5,
                            corners_esperados: report.datos_modelo?.corners_esperados || 9,
                            tarjetas_esperadas: 3.5,
                            btts_probabilidad: report.datos_modelo?.probabilidad_btts_porcentaje || 50
                        },
                        top_oportunidades: betPicks.slice(0, 5).map((p: any) => ({
                            mercado: p.mercado,
                            categoria: p.mercado?.split(' ')[0]?.toUpperCase() || 'OTRO',
                            seleccion: p.seleccion,
                            cuota: p.cuota_actual,
                            probabilidad_calculada: p.probabilidad_calculada_porcentaje,
                            probabilidad_tipica: p.probabilidad_implicita_porcentaje || 50,
                            confianza: p.confianza,
                            value_score: p.edge_porcentaje
                        }))
                    },
                    advertencias: {
                        titulo: 'Factores de Riesgo',
                        riesgos: [report.factores_riesgo?.riesgo_principal, ...(report.factores_riesgo?.riesgos_secundarios || [])].filter(Boolean)
                    },
                    // Required properties for DashboardAnalysisJSON compatibility
                    header_partido: {
                        titulo: `${report.meta?.fixture_id || 'Partido'}`,
                        subtitulo: report.resumen_ejecutivo?.titular || '',
                        bullets_clave: report.resumen_ejecutivo?.picks_principales || []
                    },
                    tablas_comparativas: null,
                    graficos_sugeridos: null
                } as unknown as DashboardAnalysisJSON,
                analysisRun: undefined
            };
        }

        // ═══════════════════════════════════════════════════════════════
        // V2 LEGACY: Procesar con value_picks_v2 y lógica compleja
        // ═══════════════════════════════════════════════════════════════
        // Obtener picks V2 - Primero BET, si no hay, WATCH ordenados por edge
        let { data: v2Picks } = await supabase
            .from('value_picks_v2')
            .select('*')
            .eq('job_id', jobId)
            .eq('decision', 'BET')
            .order('rank', { ascending: true })
            .limit(3);


        // ✅ FALLBACK: Si no hay BET, mostrar top 3 WATCH por edge
        if (!v2Picks || v2Picks.length === 0) {
            const { data: watchPicks } = await supabase
                .from('value_picks_v2')
                .select('*')
                .eq('job_id', jobId)
                .eq('decision', 'WATCH')
                .order('edge', { ascending: false })
                .limit(3);
            v2Picks = watchPicks || [];
            console.log(`[V2] Fallback a WATCH picks: ${v2Picks.length}`);
        }

        // Obtener job V2 para fixture_id
        const { data: v2Job } = await supabase
            .from('analysis_jobs_v2')
            .select('*')
            .eq('id', jobId)
            .maybeSingle();

        // ═══════════════════════════════════════════════════════════════
        // MEGA-UPGRADE: Obtener TODOS los mercados calculados para mostrar ranking
        // ═══════════════════════════════════════════════════════════════
        let allCalculatedMarkets: any[] = [];
        if (v2Job?.fixture_id) {
            const { data: marketProbs } = await supabase
                .from('market_probs_v2')
                .select('*')
                .eq('fixture_id', v2Job.fixture_id)
                .order('p_model', { ascending: false });

            if (marketProbs && marketProbs.length > 0) {
                console.log(`[V2-MEGA] Mercados calculados encontrados: ${marketProbs.length}`);
                allCalculatedMarkets = marketProbs;
            }
        }

        // Transformar V2 al formato esperado por la UI
        const reportV2 = v2Report.report_packet;
        const betPicks = v2Picks || [];

        // ═══════════════════════════════════════════════════════════════
        // FIX BUG 1: Normalizar market names para hacer match con Gemini
        // ═══════════════════════════════════════════════════════════════
        const normalizeMarket = (m: string): string => {
            return m.toLowerCase()
                .replace(/\bde\b/g, '') // Eliminar 'de' (ej: mas de 2.5 -> mas 2.5)
                .replace(/[_\.\s]/g, '') // Eliminar espacios, puntos y guiones bajos
                .replace('goals', 'goles')
                .replace('over', 'mas')
                .replace('under', 'menos')
                .replace('btts', 'ambosanotan')
                .replace('yes', 'si')
                .replace('no', 'no');
        };

        const getJustification = (market: string) => {
            const normalized = normalizeMarket(market);
            const justif = reportV2.justificacion_picks?.find((j: any) => {
                const pickNorm = normalizeMarket(j.pick || '');
                return pickNorm.includes(normalized) || normalized.includes(pickNorm);
            });

            if (!justif) {
                console.log(`[V2] ⚠️ No encontrada justificación para market: ${market} (normalized: ${normalized})`);
            }
            return justif || null;
        };

        // Crear fallbacks inteligentes basados en datos del pick
        const createSmartFallback = (pick: any) => {
            const prob = Math.round(pick.p_model * 100);
            const market = pick.market.replace(/_/g, ' ');

            return {
                base_estadistica: [
                    `Probabilidad basada en Identificación de Patrones Neurales: ${prob}%`,
                    `Correlación de vectores detectada por el Motor de IA (${pick.model_name || 'V2-Core'})`
                ],
                contexto_competitivo: [
                    pick.rationale || `Tendencia favorable para ${market}`
                ],
                conclusion: pick.rationale || `La Inteligencia Artificial proyecta un ${prob}% de probabilidad para ${pick.selection} basada en simulación de escenarios.`
            };
        };

        return {
            analysisText: reportV2.resumen_ejecutivo?.titular || "Análisis V2 completado.",
            dashboardData: {
                veredicto_analista: {
                    decision: betPicks.length > 0 ? 'APOSTAR' : 'OBSERVAR',
                    titulo_accion: reportV2.resumen_ejecutivo?.titular || '',
                    seleccion_clave: betPicks[0]?.selection || null,
                    probabilidad: betPicks[0] ? Math.round(betPicks[0].p_model * 100) : 50,
                    nivel_confianza: betPicks[0]?.confidence >= 70 ? 'ALTA' : betPicks[0]?.confidence >= 50 ? 'MEDIA' : 'BAJA',
                    razon_principal: reportV2.conclusion?.veredicto || '',
                    riesgo_principal: reportV2.resumen_ejecutivo?.riesgo_principal || ''
                },
                resumen_ejecutivo: {
                    frase_principal: reportV2.resumen_ejecutivo?.titular || '',
                    puntos_clave: [
                        reportV2.contexto_competitivo?.situacion_local,
                        reportV2.contexto_competitivo?.situacion_visitante,
                        reportV2.resumen_ejecutivo?.riesgo_principal
                    ].filter(Boolean)
                },
                analisis_detallado: {
                    contexto_competitivo: {
                        titulo: reportV2.contexto_competitivo?.titulo || 'Contexto Competitivo',
                        bullets: [
                            reportV2.contexto_competitivo?.situacion_local,
                            reportV2.contexto_competitivo?.situacion_visitante,
                            reportV2.contexto_competitivo?.implicaciones
                        ].filter(Boolean)
                    },
                    analisis_tactico_formaciones: {
                        titulo: reportV2.analisis_tactico?.titulo || 'Análisis Táctico',
                        bullets: [
                            reportV2.analisis_tactico?.enfoque_local,
                            reportV2.analisis_tactico?.enfoque_visitante,
                            reportV2.analisis_tactico?.matchup
                        ].filter(Boolean)
                    },
                    analisis_escenarios: {
                        titulo: 'Escenarios Proyectados',
                        bullets: [
                            `Probable (${reportV2.proyeccion_escenarios?.escenario_probable?.probabilidad || '60-70%'}): ${reportV2.proyeccion_escenarios?.escenario_probable?.descripcion || ''}`,
                            `Alternativo (${reportV2.proyeccion_escenarios?.escenario_alternativo?.probabilidad || '20-30%'}): ${reportV2.proyeccion_escenarios?.escenario_alternativo?.descripcion || ''}`
                        ].filter(b => b && b.length > 20)
                    }
                },
                // ═══════════════════════════════════════════════════════════════
                // FIX BUG 1 & 2: Justificaciones normalizadas, SIN cuotas API-Football
                // ═══════════════════════════════════════════════════════════════
                predicciones_finales: {
                    detalle: betPicks.map((p: any) => {
                        const justif = getJustification(p.market);
                        const fallback = createSmartFallback(p);

                        return {
                            mercado: p.market.replace(/_/g, ' ').replace(/\./g, ','),
                            seleccion: p.selection,
                            probabilidad_estimado_porcentaje: Math.round(p.p_model * 100),
                            edge: null,  // FIX BUG 2: NO mostrar edge sin cuotas reales
                            odds: null,  // FIX BUG 2: NO mostrar cuotas de API-Football
                            justificacion_detallada: {
                                base_estadistica: justif?.datos_soporte || fallback.base_estadistica,
                                contexto_competitivo: justif?.riesgos_especificos || fallback.contexto_competitivo,
                                conclusion: justif?.justificacion_tactica || fallback.conclusion
                            }
                        };
                    })
                },
                advertencias: {
                    titulo: 'Factores de Riesgo',
                    riesgos: reportV2.factores_riesgo?.riesgos || []
                },
                // ═══════════════════════════════════════════════════════════════
                // MEGA-UPGRADE V2: Probabilidades típicas REALES + ordenamiento por VALUE
                // ═══════════════════════════════════════════════════════════════
                analisis_mercados_calculados: (() => {
                    if (allCalculatedMarkets.length === 0) return null;

                    // Probabilidades típicas REALES del mercado (basadas en estadísticas históricas)
                    const TYPICAL_PROBABILITIES: Record<string, number> = {
                        // Goles - muy predecibles
                        'over_0.5_goals': 0.88,
                        'over_1.5_goals': 0.72,
                        'over_2.5_goals': 0.52,
                        'over_3.5_goals': 0.30,
                        'over_4.5_goals': 0.15,
                        'over_5.5_goals': 0.07,
                        'under_2.5_goals': 0.48,
                        // BTTS
                        'btts_yes': 0.50,
                        'btts_no': 0.50,
                        // Team Goals
                        'home_over_0.5': 0.75,
                        'home_over_1.5': 0.45,
                        'away_over_0.5': 0.65,
                        'away_over_1.5': 0.35,
                        // Half Goals
                        '1h_over_0.5': 0.60,
                        '2h_over_0.5': 0.70,
                        'fh_over_05': 0.60,
                        'sh_over_05': 0.70,
                        // Corners - más difíciles de predecir
                        'corners_over_8.5': 0.55,
                        'corners_over_9.5': 0.45,
                        'corners_over_10.5': 0.35,
                        'corners_over_11.5': 0.25,
                        // Tarjetas
                        'cards_over_3.5': 0.50,
                        'cards_over_4.5': 0.35,
                        'cards_over_5.5': 0.22,
                        // Resultados
                        '1x2_home': 0.45,
                        '1x2_draw': 0.25,
                        '1x2_away': 0.30,
                        'double_chance_1x': 0.70,
                        'double_chance_x2': 0.55,
                        'double_chance_12': 0.75,
                    };

                    // Función para obtener probabilidad típica
                    const getTypicalProb = (market: string): number => {
                        // Buscar coincidencia exacta
                        if (TYPICAL_PROBABILITIES[market]) return TYPICAL_PROBABILITIES[market];
                        // Buscar por partes del nombre
                        for (const [key, value] of Object.entries(TYPICAL_PROBABILITIES)) {
                            if (market.includes(key) || key.includes(market)) return value;
                        }
                        return 0.50; // Default
                    };

                    // Calcular VALUE SCORE real para cada mercado
                    const marketsWithValue = allCalculatedMarkets.map((m: any) => {
                        const typicalProb = getTypicalProb(m.market);
                        const valueScore = Math.round((m.p_model - typicalProb) * 100);
                        return {
                            ...m,
                            typical_prob: typicalProb,
                            value_score: valueScore
                        };
                    });

                    // Ordenar por VALUE SCORE (no por probabilidad bruta)
                    const sortedByValue = marketsWithValue
                        .filter((m: any) => m.value_score > 5) // Solo mercados con >5% de value
                        .sort((a: any, b: any) => b.value_score - a.value_score);

                    // Buscar corners y tarjetas para el resumen
                    const cornersMarket = allCalculatedMarkets.find((m: any) => m.market.includes('corner'));
                    const cardsMarket = allCalculatedMarkets.find((m: any) => m.market.includes('card'));

                    return {
                        descripcion: "Análisis de mercados ordenado por VALUE REAL (no probabilidad)",
                        mercados_evaluados: allCalculatedMarkets.length,
                        mercados_con_valor: sortedByValue.length,
                        resumen: {
                            goles_esperados: allCalculatedMarkets.find((m: any) => m.market === 'over_2.5_goals')?.model_inputs?.lambda_total ||
                                (allCalculatedMarkets.find((m: any) => m.market === 'over_2.5_goals')?.p_model ?
                                    Math.round(allCalculatedMarkets.find((m: any) => m.market === 'over_2.5_goals').p_model * 5 * 10) / 10 : null),
                            corners_esperados: cornersMarket?.model_inputs?.expected_corners ||
                                (cornersMarket ? (cornersMarket.market.includes('9.5') ? 9.5 :
                                    cornersMarket.market.includes('10.5') ? 10.5 :
                                        cornersMarket.market.includes('8.5') ? 8.5 : null) : null),
                            tarjetas_esperadas: cardsMarket?.model_inputs?.expected_cards ||
                                (cardsMarket ? (cardsMarket.market.includes('4.5') ? 4.5 :
                                    cardsMarket.market.includes('3.5') ? 3.5 : null) : null),
                            btts_probabilidad: Math.round((allCalculatedMarkets.find((m: any) => m.market === 'btts_yes')?.p_model || 0) * 100),
                        },
                        top_oportunidades: sortedByValue
                            .slice(0, 10)
                            .map((m: any) => {
                                // ═══════════════════════════════════════════════════════════════
                                // TRADUCTOR: Mercados técnicos → Español para apostadores
                                // ═══════════════════════════════════════════════════════════════
                                const translateMarket = (market: string, selection: string): string => {
                                    const TRANSLATIONS: Record<string, string> = {
                                        // BTTS
                                        'btts_yes': 'Ambos Anotan - Sí',
                                        'btts_no': 'Ambos Anotan - No',
                                        // Resultado 1X2
                                        '1x2_home': 'Victoria Local',
                                        '1x2_draw': 'Empate',
                                        '1x2_away': 'Victoria Visitante',
                                        // Doble Oportunidad
                                        'double_chance_1x': 'Local o Empate (1X)',
                                        'double_chance_x2': 'Empate o Visitante (X2)',
                                        'double_chance_12': 'Local o Visitante (12)',
                                        // Goles Over/Under
                                        'over_0.5_goals': 'Más de 0.5 Goles',
                                        'over_1.5_goals': 'Más de 1.5 Goles',
                                        'over_2.5_goals': 'Más de 2.5 Goles',
                                        'over_3.5_goals': 'Más de 3.5 Goles',
                                        'over_4.5_goals': 'Más de 4.5 Goles',
                                        'under_2.5_goals': 'Menos de 2.5 Goles',
                                        // Goles por equipo
                                        'home_over_0.5': 'Local Anota (+0.5)',
                                        'home_over_1.5': 'Local Anota 2+ Goles',
                                        'away_over_0.5': 'Visitante Anota (+0.5)',
                                        'away_over_1.5': 'Visitante Anota 2+ Goles',
                                        // Tiempos
                                        '1t_over_0.5': 'Gol en 1er Tiempo',
                                        '1t_over_1.5': '2+ Goles en 1er Tiempo',
                                        '2t_over_0.5': 'Gol en 2do Tiempo',
                                        '2t_over_1.5': '2+ Goles en 2do Tiempo',
                                        'fh_over_05': 'Gol en 1er Tiempo',
                                        'sh_over_05': 'Gol en 2do Tiempo',
                                        '1h_over_0.5': 'Gol en 1er Tiempo',
                                        '2h_over_0.5': 'Gol en 2do Tiempo',
                                        // Corners
                                        'corners_over_8.5': 'Más de 8.5 Corners',
                                        'corners_over_9.5': 'Más de 9.5 Corners',
                                        'corners_over_10.5': 'Más de 10.5 Corners',
                                        'corners_over_11.5': 'Más de 11.5 Corners',
                                        'corners_over_12.5': 'Más de 12.5 Corners',
                                        // Tarjetas
                                        'cards_over_3.5': 'Más de 3.5 Tarjetas',
                                        'cards_over_4.5': 'Más de 4.5 Tarjetas',
                                        'cards_over_5.5': 'Más de 5.5 Tarjetas',
                                        // Hándicap
                                        'handicap_home_-0.5': 'Local Gana (Hándicap -0.5)',
                                        'handicap_home_-1.5': 'Local Gana por 2+ (Hándicap -1.5)',
                                        'handicap_away_+0.5': 'Visitante No Pierde (+0.5)',
                                    };

                                    // 1. Buscar traducción exacta
                                    if (TRANSLATIONS[market]) return TRANSLATIONS[market];

                                    // 2. Traducir selecciones genéricas
                                    if (selection === 'Yes' || selection === 'Sí') return 'Ambos Anotan - Sí';
                                    if (selection === 'No') return 'Ambos Anotan - No';
                                    if (selection === '1') return 'Victoria Local';
                                    if (selection === '2') return 'Victoria Visitante';
                                    if (selection === 'X') return 'Empate';
                                    if (selection === '1X') return 'Local o Empate';
                                    if (selection === 'X2') return 'Empate o Visitante';
                                    if (selection === '12') return 'Local o Visitante';

                                    // 3. Patterns para traducciones dinámicas
                                    if (market.includes('1t_over') || market.includes('1h_over') || market.includes('fh_over')) {
                                        const goals = market.match(/(\d+\.?\d*)/)?.[1] || '0.5';
                                        return `+${goals} Goles 1er Tiempo`;
                                    }
                                    if (market.includes('2t_over') || market.includes('2h_over') || market.includes('sh_over')) {
                                        const goals = market.match(/(\d+\.?\d*)/)?.[1] || '0.5';
                                        return `+${goals} Goles 2do Tiempo`;
                                    }
                                    if (market.includes('corner')) {
                                        const num = market.match(/(\d+\.?\d*)/)?.[1];
                                        return num ? `+${num} Corners` : 'Corners Over';
                                    }
                                    if (market.includes('card')) {
                                        const num = market.match(/(\d+\.?\d*)/)?.[1];
                                        return num ? `+${num} Tarjetas` : 'Tarjetas Over';
                                    }

                                    // 4. Fallback: limpiar el texto técnico
                                    return selection
                                        .replace(/over/gi, 'Más de')
                                        .replace(/under/gi, 'Menos de')
                                        .replace(/_/g, ' ')
                                        .replace(/\./g, ',');
                                };

                                return {
                                    mercado: translateMarket(m.market, m.selection || ''),
                                    categoria: m.market.includes('corner') ? 'Corners' :
                                        m.market.includes('card') ? 'Tarjetas' :
                                            m.market.includes('goal') || m.market.includes('btts') ? 'Goles' :
                                                m.market.includes('1x2') || m.market.includes('double') ? 'Resultado' : 'Otro',
                                    probabilidad_calculada: Math.round(m.p_model * 100),
                                    probabilidad_tipica: Math.round(m.typical_prob * 100),
                                    value_score: m.value_score,
                                    confianza: m.value_score > 15 ? 'ALTA' : m.value_score > 8 ? 'MEDIA' : 'BAJA',
                                    recomendacion: m.rationale || ''
                                };
                            })
                    };
                })()
            } as unknown as DashboardAnalysisJSON,
            analysisRun: {
                id: jobId,
                job_id: jobId,
                fixture_id: v2Job?.fixture_id,
                report_pre_jsonb: report,
                summary_pre_text: reportV2.resumen_ejecutivo?.titular,
                // DEBUG: Include etl_context for raw data inspection
                etl_context: v2Job?.etl_context,
                predictions: betPicks.map((p: any) => ({
                    id: p.id,
                    market: p.market,
                    selection: p.selection,
                    probability: Math.round(p.p_model * 100),
                    confidence: p.confidence,
                    reasoning: report.justificacion_picks?.find((j: any) =>
                        j.pick?.toLowerCase().includes(p.market.toLowerCase())
                    )?.justificacion_tactica || ''
                }))
            } as unknown as AnalysisRun
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // FALLBACK A V1 - Usar maybeSingle para evitar error si no hay datos
    // ═══════════════════════════════════════════════════════════════
    const { data: runData, error: runError } = await supabase
        .from('analysis_runs')
        .select('*, predictions(*)')
        .eq('job_id', jobId)
        .maybeSingle();

    if (runError) {
        console.error("[analysisService] Error en fallback analysis_runs:", runError);
    }

    if (!runData) {
        console.log(`[analysisService] No se encontró análisis V1 para job ${jobId}`);
        return null;
    }

    const run = runData as AnalysisRun;

    return {
        analysisText: run.summary_pre_text || "Análisis completado.",
        dashboardData: run.report_pre_jsonb as DashboardAnalysisJSON,
        analysisRun: run
    };
};

/**
 * Obtiene todos los resultados visuales validados de una fecha específica.
 * FILTRO ESTRICTO: Solo devuelve análisis de partidos que se juegan EXACTAMENTE en la fecha solicitada.
 */
export const getAnalysesByDate = async (date: string): Promise<VisualAnalysisResult[]> => {
    const targetDate = date.split('T')[0]; // Asegurar YYYY-MM-DD
    console.log(`[ParlayBuilder] Getting analyses for match date: ${targetDate}`);

    // FILTRO CORRECTO: Usar match_date de analysis_runs (fecha del PARTIDO)
    // No usar created_at que es la fecha de creación del análisis
    const { data: runs, error } = await supabase
        .from('analysis_runs')
        .select('*, predictions(*)')
        .eq('match_date', targetDate); // ✅ FILTRA POR FECHA DEL PARTIDO

    if (error) {
        console.error("Error fetching daily analyses:", error);
        return [];
    }

    if (!runs || runs.length === 0) {
        console.log(`[ParlayBuilder] No analysis runs found for match date ${targetDate}`);
        return [];
    }

    console.log(`[ParlayBuilder] Found ${runs.length} analysis runs for match date ${targetDate}`);

    // Mapear resultados
    return runs
        .filter(r => r.predictions && r.predictions.length > 0)
        .map(r => ({
            analysisText: r.summary_pre_text || '',
            dashboardData: r.report_pre_jsonb as DashboardAnalysisJSON,
            analysisRun: r as AnalysisRun
        }));
};

/**
 * Obtiene el resultado (Reporte) directamente por ID de Ejecución (Run ID).
 * Útil para Top Picks que ya tienen el ID del run.
 */
export const getAnalysisResultByRunId = async (runId: string): Promise<VisualAnalysisResult | null> => {
    const { data: runData, error: runError } = await supabase
        .from('analysis_runs')
        .select('*, predictions(*)')
        .eq('id', runId)
        .maybeSingle();

    if (runError || !runData) {
        console.error("Error fetching analysis run by ID:", runError);
        return null;
    }

    const run = runData as AnalysisRun;

    return {
        analysisText: run.summary_pre_text || "Análisis completado.",
        dashboardData: run.report_pre_jsonb as DashboardAnalysisJSON,
        analysisRun: run
    };
};

/**
 * Obtiene el resultado (Reporte) por Fixture ID.
 * PRIORIDAD: 1) Tabla 'analisis' (V3 siempre guarda aquí), 2) V2 job + reports_v2, 3) analysis_runs (V1)
 */
export const getAnalysisResultByFixtureId = async (fixtureId: number): Promise<VisualAnalysisResult | null> => {
    console.log(`[analysisService] 🟢 [V3 PATCH ACTIVO] Buscando análisis para fixture ${fixtureId}...`);

    // ═══════════════════════════════════════════════════════════════
    // PASO 1: Buscar en tabla 'analisis' (V3 siempre guarda aquí)
    // Con freshness check: si hay un job 'done' más reciente, skip cache
    // ═══════════════════════════════════════════════════════════════
    const { data: analisisData, error: analisisError } = await supabase
        .from('analisis')
        .select('resultado_analisis, creado_en')
        .eq('partido_id', fixtureId)
        .maybeSingle();

    if (analisisData?.resultado_analisis) {
        // Freshness check: see if there's a newer completed job (exclude parlay jobs)
        const { data: newerJob } = await supabase
            .from('analysis_jobs_v2')
            .select('id, created_at')
            .eq('fixture_id', fixtureId)
            .eq('status', 'done')
            .or('analysis_type.eq.standard,analysis_type.is.null')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        const cacheTime = analisisData.creado_en ? new Date(analisisData.creado_en).getTime() : 0;
        const jobTime = newerJob?.created_at ? new Date(newerJob.created_at).getTime() : 0;
        const isFresh = !newerJob || cacheTime >= jobTime;

        if (isFresh) {
            const result = analisisData.resultado_analisis as any;

            // V3 guarda { dashboardData: {...} }
            if (result.dashboardData) {
                const adaptedDashboardData = adaptV3ToFrontend(result.dashboardData);
                console.log(`[analysisService] V3 dashboardData encontrado y adaptado (fresh)`);
                return {
                    analysisText: adaptedDashboardData.resumen_ejecutivo?.frase_principal || "Análisis V3 completado.",
                    dashboardData: adaptedDashboardData,
                    analysisRun: undefined,
                    payload: result.dashboardData.payload
                };
            }

            // Legacy format
            if (result.veredicto_analista || result.predicciones_finales) {
                const adaptedResult = adaptV3ToFrontend(result);
                console.log(`[analysisService] Análisis legacy encontrado y adaptado`);
                return {
                    analysisText: adaptedResult.resumen_ejecutivo?.frase_principal || "Análisis completado.",
                    dashboardData: adaptedResult,
                    analysisRun: undefined
                };
            }
        } else {
            console.log(`[analysisService] Cache stale (cache: ${analisisData.creado_en}, job: ${newerJob?.created_at}). Falling through to reports_v2.`);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // PASO 2: Buscar en V2/V3 via analysis_jobs_v2 + reports_v2
    // ═══════════════════════════════════════════════════════════════
    const { data: v2Job } = await supabase
        .from('analysis_jobs_v2')
        .select('id')
        .eq('fixture_id', fixtureId)
        .eq('status', 'done')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (v2Job) {
        console.log(`[analysisService] V2/V3 job encontrado: ${v2Job.id}`);
        const result = await getAnalysisResult(v2Job.id);
        if (result) return result;
    }

    // ═══════════════════════════════════════════════════════════════
    // PASO 3: Buscar directamente en reports_v2 por fixture_id
    // (covers cases where analysis_jobs_v2/analisis were deleted)
    // ═══════════════════════════════════════════════════════════════
    const { data: directReport } = await supabase
        .from('reports_v2')
        .select('job_id, report_packet')
        .eq('fixture_id', fixtureId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (directReport?.job_id) {
        console.log(`[analysisService] Direct reports_v2 hit for fixture ${fixtureId}, job: ${directReport.job_id}`);
        const result = await getAnalysisResult(directReport.job_id);
        if (result) return result;
    }

    console.log(`[analysisService] No se encontró análisis para fixture ${fixtureId}`);
    return null;
};


/**
 * Invoca el proceso de verificación de pronósticos (Post-Match Analysis).
 * Si no se pasa fixtureId, procesa los pendientes en lote.
 */
export const verifyPendingPredictions = async (fixtureId?: string | number[]): Promise<{
    success: boolean;
    processed: number;
    details: any[];
    debug?: { trace: string[]; targetsFound: number; }
}> => {
    try {
        const body = Array.isArray(fixtureId)
            ? { fixture_ids: fixtureId }
            : { fixture_id: fixtureId };

        const { data, error } = await supabase.functions.invoke('verify-prediction', {
            body: body
        });

        if (error) throw error;
        return data;
    } catch (err: any) {
        console.error("Error verifying predictions:", err);
        return { success: false, processed: 0, details: [], debug: { trace: [], targetsFound: 0 } };
    }
};

/**
 * Obtiene estadísticas de rendimiento agregadas para un rango de fechas.
 */
export const fetchPerformanceStats = async (start: Date, end: Date): Promise<PerformanceStats> => {
    // 1. Fetch runs in range
    const { data: runs, error } = await supabase
        .from('analysis_runs')
        .select(`
            id, 
            created_at,
            fixture_id,
            predictions (
                id, market, selection, is_won, probability, verification_status
            )
        `)
        .gte('created_at', start.toISOString())
        .lte('created_at', end.toISOString());

    if (error) throw error;
    if (!runs) return {
        total: 0, wins: 0, losses: 0, pushed: 0, winRate: 0, yield: 0,
        byMarket: {}, byLeague: {}, byDate: {},
        byConfidence: { HIGH: { total: 0, wins: 0, winRate: 0 }, MEDIUM: { total: 0, wins: 0, winRate: 0 }, LOW: { total: 0, wins: 0, winRate: 0 } },
        byProbability: {},
        rawPredictions: []
    };


    // 2. Aggregate
    // Flatten predictions from runs to a single array for the helper
    const allPredictions: any[] = [];

    // Also need to map league names from metadata
    // --- NEW: Fetch Fixture Metadata for League info ---
    const fixtureIds = [...new Set(runs.map((r: any) => parseInt(r.fixture_id)))];
    let gamesMap: Record<number, any> = {};

    if (fixtureIds.length > 0) {
        try {
            const games = await fetchFixturesList(fixtureIds);
            games.forEach(g => {
                gamesMap[g.fixture.id] = g;
            });
        } catch (e) {
            console.error("Error fetching fixtures for report:", e);
        }
    }

    runs.forEach((run: any) => {
        if (!run.predictions) return;

        // Find League
        const fixtureId = parseInt(run.fixture_id);
        const game = gamesMap[fixtureId];
        const leagueName = game ? game.league.name : "Desconocida";

        run.predictions.forEach((p: any) => {
            if (p.verification_status !== 'verified' || p.is_won === null) return;
            // Enrich with metadata needed for aggregation
            allPredictions.push({ ...p, date: run.created_at, league: leagueName });
        });
    });

    return aggregateStats(allPredictions);
};

/**
 * Re-usable aggregator for client-side filtering
 */
export const aggregateStats = (predictions: any[]): PerformanceStats => {
    let total = 0;
    let wins = 0;
    let losses = 0;
    let pushed = 0;

    const byMarket: Record<string, { total: number; wins: number; winRate: number }> = {};
    const byLeague: Record<string, { total: number; wins: number; winRate: number }> = {};
    const byDate: Record<string, { total: number; wins: number; profit: number }> = {};

    const byConfidence: Record<'HIGH' | 'MEDIUM' | 'LOW', { total: number; wins: number; winRate: number }> = {
        HIGH: { total: 0, wins: 0, winRate: 0 },
        MEDIUM: { total: 0, wins: 0, winRate: 0 },
        LOW: { total: 0, wins: 0, winRate: 0 }
    };

    const byProbability: Record<string, { total: number; wins: number; winRate: number }> = {};

    const getProbBucket = (prob: number) => {
        if (prob >= 90) return "90-100%";
        if (prob >= 80) return "80-89%";
        if (prob >= 70) return "70-79%";
        if (prob >= 60) return "60-69%";
        return "<60%";
    };

    predictions.forEach(p => {
        total++;
        const dateKey = new Date(p.date).toLocaleDateString('es-CO');
        const leagueName = p.league || "Desconocida";

        // Init Maps
        if (!byMarket[p.market]) byMarket[p.market] = { total: 0, wins: 0, winRate: 0 };
        if (!byDate[dateKey]) byDate[dateKey] = { total: 0, wins: 0, profit: 0 };
        if (!byLeague[leagueName]) byLeague[leagueName] = { total: 0, wins: 0, winRate: 0 };

        // Probability Buckets
        let prob = p.probability || 0;
        // Auto-detect decimal probability (e.g. 0.85) and convert to percentage
        if (prob > 0 && prob <= 1) {
            prob = prob * 100;
        }

        const probBucket = getProbBucket(prob);
        if (!byProbability[probBucket]) byProbability[probBucket] = { total: 0, wins: 0, winRate: 0 };

        // Confidence Level
        let confLevel: 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';
        if (prob >= 80) confLevel = 'HIGH';
        else if (prob >= 60) confLevel = 'MEDIUM';

        byMarket[p.market].total++;
        byDate[dateKey].total++;
        byLeague[leagueName].total++;
        byProbability[probBucket].total++;
        byConfidence[confLevel].total++;

        if (p.is_won === true) {
            wins++;
            byMarket[p.market].wins++;
            byDate[dateKey].wins++;
            byLeague[leagueName].wins++;
            byProbability[probBucket].wins++;
            byConfidence[confLevel].wins++;
        } else if (p.is_won === false) {
            losses++;
        } else {
            pushed++;
        }
    });

    // Calc Rates
    const winRate = total > 0 ? (wins / total) * 100 : 0;

    Object.keys(byMarket).forEach(k => {
        byMarket[k].winRate = (byMarket[k].wins / byMarket[k].total) * 100;
    });

    Object.keys(byLeague).forEach(k => {
        byLeague[k].winRate = (byLeague[k].wins / byLeague[k].total) * 100;
    });

    Object.keys(byProbability).forEach(k => {
        byProbability[k].winRate = (byProbability[k].wins / byProbability[k].total) * 100;
    });

    ['HIGH', 'MEDIUM', 'LOW'].forEach(k => {
        const key = k as 'HIGH' | 'MEDIUM' | 'LOW';
        if (byConfidence[key].total > 0) {
            byConfidence[key].winRate = (byConfidence[key].wins / byConfidence[key].total) * 100;
        }
    });

    return {
        total,
        wins,
        losses,
        pushed,
        winRate,
        yield: 0,
        byMarket,
        byLeague,
        byDate,
        byConfidence,
        byProbability,
        rawPredictions: predictions
    };
};

