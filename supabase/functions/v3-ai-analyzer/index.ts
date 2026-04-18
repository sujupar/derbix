// supabase/functions/v3-ai-analyzer/index.ts
// MOTOR V3: IA PURO - Gemini hace TODO el análisis y toma de decisiones
// Elimina dependencia de motores matemáticos B, C, D

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import JSON5 from "https://esm.sh/json5@2.2.3"
import { corsHeaders } from '../_shared/cors.ts'
import { callLLM, calcGroqDelay } from '../_shared/llm-client.ts'
import { runMathModels } from '../_shared/math-models/index.ts'
import { runDebate } from '../_shared/agents/orchestrator.ts'
import type { MatchContext } from '../_shared/agents/types.ts'
import {
  normalizeLineups,
  normalizeCoaches,
  normalizeWeather,
  computeTeamXGRolling,
  computeKeyPlayerImpact,
  computeFatigueIndex,
} from '../_shared/sportmonks-enrichers.ts'

// ENGINE_VERSION is declared inside serve() handler (line ~425) — single source of truth

// ── ML Calibration: Dynamic Prompt Injection ─────────────────────────

const HARDCODED_CALIBRATION_FALLBACK = `
📊 REFERENCIA: Asigna la probabilidad que refleje tu análisis honesto.
El sistema de calibración matemática ajustará según datos verificados de rendimiento real.

💰 CONTEXTO DE RENTABILIDAD:
- Picks con cuota < 1.40 históricamente tienen ROI NEGATIVO (ganas poco, pierdes todo cuando fallas).
- La intersección confianza alta + cuota 1.50-2.00 es donde generamos MAYOR RETORNO.
- Edge = Tu Probabilidad - (100/Cuota). Un pick de 83% @ 1.72 tiene edge de 25%. Uno de 90% @ 1.08 tiene edge de 3%.

🏆 MERCADOS CON MEJOR ROI HISTÓRICO:
- Combinados (Resultado+Total, DC+Total) → Cuotas naturales 1.60-2.20, ROI consistente.
- BTTS/Ambos Anotan → Cuotas típicas 1.60-1.90, buen análisis con datos de goles.
- Corners de equipo → Cuotas 1.65-2.10, mercado poco eficiente.
- Asian Handicap → Cuotas 1.75-2.05, elimina resultado exacto.

🏆 LIGAS CON BUEN HISTORIAL:
- Serie A, UEFA Champions League, Liga Argentina, Championship, Eredivisie.

PRINCIPIO: Evalúa cada partido por sus propios méritos. Los datos históricos son REFERENCIA,
no limitación. Un buen análisis del partido actual es más importante que tendencias pasadas.
`;

const HARDCODED_MARKET_PRIORITIES_FALLBACK = `
🧠 FILOSOFÍA DE ANÁLISIS DE VALOR:

Un analista MEDIOCRE dice: "El local gana" (cuota 1.25, edge 3%).
Un analista de ÉLITE dice: "El local gana Y habrá más de 1.5 goles" (cuota 1.75, edge 22%).
La diferencia NO es inventar — es ir MÁS PROFUNDO en el mismo análisis.

📊 REGLA DE ORO DEL VALOR:
83% en BTTS @ 1.72 (edge 25%) es SUPERIOR a 90% en Over 0.5 @ 1.08 (edge 3%).
El edge × cuota determina el retorno real. Prioriza EDGE, no probabilidad bruta.

🏆 PRIORIDAD 1 — MERCADOS DE ALTO VALOR (cuotas naturales ≥1.50):
   - Combinados (Resultado+Total): "Equipo & Más de 1.5 Goles" → cuotas típicas 1.65-2.20
   - BTTS/Ambos Anotan → cuotas típicas 1.60-1.90
   - Corners de equipo → cuotas típicas 1.65-2.10 (mercado ineficiente)
   - Asian Handicap → cuotas típicas 1.75-2.05
   - Goles del Local/Visitante (team totals) → cuotas típicas 1.55-1.85

📊 PRIORIDAD 2 — MERCADOS ESTÁNDAR (cuotas 1.40-1.65):
   - Over/Under Goles (2.5+, 3.5) → cuotas típicas 1.45-2.10
   - Draw No Bet → cuotas típicas 1.40-1.70
   - Handicap Europeo → cuotas típicas 1.50-2.00
   - HT/FT parciales → cuotas típicas 1.45-1.80

⚠️ PRIORIDAD 3 — MERCADOS DE BAJA CUOTA (usar con moderación):
   - Resultado 1X2 (favorito claro) → cuota típica 1.15-1.35
   - Doble Oportunidad → cuota típica 1.10-1.30
   - Over 0.5 / Over 1.5 → cuota típica 1.03-1.25
   Si SOLO encuentras valor en estos mercados, estás analizando SUPERFICIALMENTE.
   Pregúntate: ¿puedo combinar este insight para crear una cuota ≥1.50 sin perder más de 5-8pts de confianza?

💡 TÉCNICA DE COMBINACIÓN:
Si tienes un pick individual a 1.45 con 85% confianza, pregúntate:
- ¿Puedo combinarlo con otro insight para crear cuota 1.60+ sin perder más de 5-8pts?
- Ejemplo: "Local gana" (85%, 1.35) + "Más de 1.5 goles" (90%) → "Local & Más de 1.5" (83%, 1.72)
- Fórmula estimada: Cuota_Combo ≈ Cuota1 × Cuota2 × 0.85
`;

interface MLCalibrationBlock {
    calibrationText: string;
    marketPrioritiesText: string;
    source: string;
    factorCount: number;
}

async function buildCalibrationBlock(supabase: any): Promise<MLCalibrationBlock> {
    try {
        // Fetch active calibration factors
        const { data: factors, error: fErr } = await supabase
            .from('ml_calibration_factors')
            .select('*')
            .eq('status', 'active');

        // Fetch active learned patterns
        const { data: patterns, error: pErr } = await supabase
            .from('ml_learned_patterns')
            .select('*')
            .eq('active', true);

        if (fErr || pErr || !factors || factors.length === 0) {
            console.log('[v3-ai-analyzer] ML tables empty or error, using hardcoded calibration fallback');
            return {
                calibrationText: HARDCODED_CALIBRATION_FALLBACK,
                marketPrioritiesText: HARDCODED_MARKET_PRIORITIES_FALLBACK,
                source: 'hardcoded-fallback',
                factorCount: 0,
            };
        }

        // ── Build calibration text from real data (V3 — context only, math calibrates separately) ──
        let calText = `\n📊 CONTEXTO HISTÓRICO DE RENDIMIENTO (${factors.length} dimensiones, el post-procesamiento matemático se encarga de la calibración):\n`;
        calText += `REFERENCIA: Asigna la probabilidad que refleje tu análisis honesto. El sistema de calibración matemática ajustará según datos verificados.\n\n`;

        // Prob band factors
        const probBandFactors = factors.filter((f: any) => f.dimension === 'prob_band');
        const goodBands = probBandFactors.filter((f: any) => f.actual_wr >= 60 && f.sample_size >= 5);
        if (goodBands.length > 0) {
            calText += `BANDAS DE PROBABILIDAD CON BUEN RENDIMIENTO:\n`;
            for (const f of goodBands) {
                calText += `- Rango ${f.dimension_key} → ${f.actual_wr.toFixed(1)}% de acierto en ${f.sample_size} picks. Buena calibración.\n`;
            }
            calText += `\n`;
        }

        // League factors
        const leagueFactors = factors.filter((f: any) => f.dimension === 'league');
        const strong = leagueFactors.filter((f: any) => f.actual_wr >= 60 && f.sample_size >= 10);

        if (strong.length > 0) {
            calText += `LIGAS CON BUEN HISTORIAL:\n`;
            for (const f of strong) {
                calText += `- ${f.dimension_key} → ${f.actual_wr.toFixed(1)}% WR en ${f.sample_size} picks. Buen terreno para análisis.\n`;
            }
            calText += `\n`;
        }

        // ── Build market priorities from real data ──
        let marketText = `\nDatos de mercados (REFERENCIA HISTÓRICA — el contexto del partido es más importante):\n\n`;

        const marketFactors = factors.filter((f: any) => f.dimension === 'market' && f.sample_size >= 10);
        const sorted = marketFactors.length > 0 ? [...marketFactors].sort((a: any, b: any) => b.actual_wr - a.actual_wr) : [];
        const best = sorted.filter((f: any) => f.actual_wr >= 55);

        if (best.length > 0) {
            marketText += `MERCADOS CON MEJOR RENDIMIENTO HISTÓRICO:\n`;
            for (const f of best) {
                marketText += `- ${f.dimension_key}: ${f.actual_wr.toFixed(1)}% WR, ROI ${f.roi > 0 ? '+' : ''}${f.roi?.toFixed(1)}%, muestra ${f.sample_size}.\n`;
            }
            marketText += `\n`;
        }

        // Odds range factors
        const oddsFactors = factors.filter((f: any) => f.dimension === 'odds_range' && f.sample_size >= 10);
        if (oddsFactors.length > 0) {
            const bestOdds = [...oddsFactors].sort((a: any, b: any) => (b.roi || 0) - (a.roi || 0));
            marketText += `RENDIMIENTO POR RANGO DE CUOTAS:\n`;
            for (const f of bestOdds) {
                marketText += `- Cuotas ${f.dimension_key}: ${f.actual_wr.toFixed(1)}% WR, ROI ${f.roi > 0 ? '+' : ''}${f.roi?.toFixed(1)}%, muestra ${f.sample_size}.\n`;
            }
            marketText += `\n`;
        }

        // ── Inject only positive patterns (boost) — no penalties ──
        const boostPatterns = (patterns || []).filter((p: any) => p.active && p.pattern_type === 'boost');
        if (boostPatterns.length > 0) {
            calText += `\n📈 PATRONES POSITIVOS DETECTADOS:\n`;
            for (const p of boostPatterns) {
                calText += `- ${p.rule_text}\n`;
            }
            calText += `\n`;
        }

        // If no positive data was found, use hardcoded fallback
        const hasPositiveData = goodBands.length > 0 || (leagueFactors.length > 0 && strong.length > 0) || (marketFactors.length > 0 && best.length > 0) || boostPatterns.length > 0;
        if (!hasPositiveData) {
            console.log('[v3-ai-analyzer] No positive ML data found, using hardcoded fallback');
            return {
                calibrationText: HARDCODED_CALIBRATION_FALLBACK,
                marketPrioritiesText: HARDCODED_MARKET_PRIORITIES_FALLBACK,
                source: 'hardcoded-fallback-no-positive-data',
                factorCount: 0,
            };
        }

        return {
            calibrationText: calText,
            marketPrioritiesText: marketText,
            source: 'ml-dynamic',
            factorCount: factors.length,
        };
    } catch (err) {
        console.error('[v3-ai-analyzer] Error building ML calibration block, using fallback:', err);
        return {
            calibrationText: HARDCODED_CALIBRATION_FALLBACK,
            marketPrioritiesText: HARDCODED_MARKET_PRIORITIES_FALLBACK,
            source: 'hardcoded-fallback-error',
            factorCount: 0,
        };
    }
}

// ── Strategic Insights: Qualitative learnings injected at end of prompt ──

async function buildStrategicInsightsBlock(supabase: any): Promise<string> {
    try {
        // Check if toggle is enabled
        console.log('[v3-ai-analyzer] [SI-1] Checking strategic insights toggle...');
        const { data: setting, error: settingErr } = await supabase
            .from('system_settings')
            .select('value')
            .eq('key', 'ml_strategic_insights_enabled')
            .single();

        console.log(`[v3-ai-analyzer] [SI-2] Toggle result: value=${JSON.stringify(setting?.value)}, error=${settingErr?.message || 'none'}`);

        if (!setting || setting.value !== true) {
            console.log('[v3-ai-analyzer] Strategic insights DISABLED');
            return '';
        }

        // Fetch active insights
        console.log('[v3-ai-analyzer] [SI-3] Fetching active insights...');
        const { data: insights, error: insErr } = await supabase
            .from('ml_strategic_insights')
            .select('insight_type, insight_text, based_on_picks, confidence_score')
            .eq('active', true)
            .order('confidence_score', { ascending: false })
            .limit(10);

        console.log(`[v3-ai-analyzer] [SI-4] Insights result: count=${insights?.length || 0}, error=${insErr?.message || 'none'}`);

        if (insErr || !insights || insights.length === 0) {
            console.log('[v3-ai-analyzer] No active strategic insights found');
            return '';
        }

        // Get total picks analyzed across all batches
        console.log('[v3-ai-analyzer] [SI-5] Fetching batch stats...');
        const { data: batches } = await supabase
            .from('ml_training_batches')
            .select('picks_analyzed')
            .eq('status', 'completed');
        const totalPicks = (batches || []).reduce((s: number, b: any) => s + (b.picks_analyzed || 0), 0);
        console.log(`[v3-ai-analyzer] [SI-6] Total picks from batches: ${totalPicks}`);

        // Build the text block
        let text = `\n\n════════════════════════════════════════════════════════════════════════════════\n`;
        text += `🧠 APRENDIZAJES ESTRATÉGICOS (basados en ${totalPicks} picks verificados)\n`;
        text += `════════════════════════════════════════════════════════════════════════════════\n\n`;
        text += `Los siguientes patrones fueron identificados analizando predicciones pasadas verificadas.\n`;
        text += `Úsalos como GUÍA adicional. Tu análisis del partido actual tiene PRIORIDAD ABSOLUTA.\n\n`;

        const winning = insights.filter((i: any) => i.insight_type === 'winning_pattern');
        const losing = insights.filter((i: any) => i.insight_type === 'losing_pattern');
        const method = insights.filter((i: any) => i.insight_type === 'methodology_insight');
        const market = insights.filter((i: any) => i.insight_type === 'market_insight');
        const league = insights.filter((i: any) => i.insight_type === 'league_insight');

        if (winning.length > 0) {
            text += `✅ PATRONES QUE FUNCIONAN (mayor correlación con aciertos):\n`;
            for (const i of winning) text += `- ${i.insight_text}\n`;
            text += `\n`;
        }
        if (method.length > 0) {
            text += `🔧 MEJORAS METODOLÓGICAS:\n`;
            for (const i of method) text += `- ${i.insight_text}\n`;
            text += `\n`;
        }
        if (market.length > 0) {
            text += `📊 INSIGHTS DE MERCADOS:\n`;
            for (const i of market) text += `- ${i.insight_text}\n`;
            text += `\n`;
        }
        if (league.length > 0) {
            text += `🏆 INSIGHTS DE LIGAS:\n`;
            for (const i of league) text += `- ${i.insight_text}\n`;
            text += `\n`;
        }
        if (losing.length > 0) {
            text += `⚠️ TRAMPAS ANALÍTICAS (correlación con fallos — ten cuidado):\n`;
            for (const i of losing) text += `- ${i.insight_text}\n`;
            text += `\n`;
        }

        text += `IMPORTANTE: Estos aprendizajes son COMPLEMENTARIOS. NO reemplazan tu criterio.\n`;
        text += `Si un insight contradice la evidencia del partido actual, PRIORIZA la evidencia actual.\n`;

        console.log(`[v3-ai-analyzer] Injecting ${insights.length} strategic insights (${totalPicks} picks base)`);
        return text;
    } catch (err) {
        console.error('[v3-ai-analyzer] Error building strategic insights:', err);
        return '';
    }
}

// ── ML Post-Processing: Apply calibration factors to picks ──────────

interface CalibrationAdjustment {
    market: string;
    league: string;
    originalProb: number;
    adjustedProb: number;
    factorsApplied: string[];
}

async function applyCalibrationPostProcessing(
    picks: any[],
    leagueName: string,
    supabase: any
): Promise<{ adjustedPicks: any[]; adjustments: CalibrationAdjustment[] }> {
    const adjustments: CalibrationAdjustment[] = [];

    try {
        const { data: factors } = await supabase
            .from('ml_calibration_factors')
            .select('dimension, dimension_key, calibration_factor, confidence_adjustment, actual_wr, sample_size')
            .eq('status', 'active');

        if (!factors || factors.length === 0) {
            return { adjustedPicks: picks, adjustments: [] };
        }

        // Build lookup maps
        const factorMap = new Map<string, any>();
        for (const f of factors) {
            factorMap.set(`${f.dimension}|${f.dimension_key}`, f);
        }

        const adjustedPicks = picks.map((pick: any) => {
            const originalProb = pick.probabilidad_calculada_porcentaje || 50;
            const market = pick.mercado || '';
            const odds = pick.cuota_actual || 0;
            const probBandKey = originalProb < 80 ? '<80%' : originalProb < 83 ? '80-82%' : originalProb < 86 ? '83-85%' : originalProb < 90 ? '86-89%' : '90%+';
            const oddsRangeKey = odds < 1.40 ? '<1.40' : odds < 1.70 ? '1.40-1.69' : odds < 2.00 ? '1.70-1.99' : odds < 2.50 ? '2.00-2.49' : '2.50+';

            let adjustedProb = originalProb;
            const appliedFactors: string[] = [];

            // Apply market factor
            const marketFactor = factorMap.get(`market|${market}`);
            if (marketFactor && marketFactor.sample_size >= 5) {
                adjustedProb = adjustedProb * marketFactor.calibration_factor;
                appliedFactors.push(`market:${marketFactor.calibration_factor.toFixed(3)}`);
            }

            // Apply league factor
            const leagueFactor = factorMap.get(`league|${leagueName}`);
            if (leagueFactor && leagueFactor.sample_size >= 5) {
                // Use confidence_adjustment instead of multiplying (additive, not multiplicative)
                adjustedProb += leagueFactor.confidence_adjustment;
                appliedFactors.push(`league:${leagueFactor.confidence_adjustment > 0 ? '+' : ''}${leagueFactor.confidence_adjustment}`);
            }

            // Apply prob band factor (subtle — only if there's a significant gap)
            const probFactor = factorMap.get(`prob_band|${probBandKey}`);
            if (probFactor && probFactor.sample_size >= 5) {
                const gap = probFactor.predicted_avg - probFactor.actual_wr;
                if (gap > 10) {
                    // Significant overconfidence in this band — reduce
                    const reduction = Math.min(gap * 0.3, 15);
                    adjustedProb -= reduction;
                    appliedFactors.push(`prob_band:-${reduction.toFixed(1)}`);
                }
            }

            // Cap: never reduce more than 25 points from original
            adjustedProb = Math.max(originalProb - 25, Math.min(100, adjustedProb));
            // Floor: never go below 40%
            adjustedProb = Math.max(40, adjustedProb);

            adjustedProb = Math.round(adjustedProb * 10) / 10;

            if (appliedFactors.length > 0 && Math.abs(adjustedProb - originalProb) >= 0.5) {
                adjustments.push({
                    market,
                    league: leagueName,
                    originalProb,
                    adjustedProb,
                    factorsApplied: appliedFactors,
                });

                return {
                    ...pick,
                    probabilidad_calculada_porcentaje: adjustedProb,
                    probabilidad_original_pre_ml: originalProb,
                    ml_adjustments: appliedFactors,
                };
            }

            return pick;
        });

        return { adjustedPicks, adjustments };
    } catch (err) {
        console.error('[v3-ai-analyzer] ML post-processing error (non-blocking):', err);
        return { adjustedPicks: picks, adjustments: [] };
    }
}

// ── ML Post-Processing V4: Platt Scaling Bidireccional ──────────
// V4 approach: Gemini assigns raw probs freely. This function applies:
// 1. Global Platt Scaling (can INCREASE or DECREASE probs) — primary correction
// 2. Per-dimension adjustments (prob_band, market, league) — secondary corrections
// Both directions are symmetric. No more "death spiral".

const MIN_GLOBAL_SAMPLES_FOR_PLATT = 50;  // Need ≥50 verified picks for Platt
const MIN_DIM_SAMPLES = 30;               // Need ≥30 picks per dimension factor
const MAX_CORRECTION_PTS = 8;             // Max ±8pts total correction

function applyPlattScale(probPct: number, A: number, B: number): number {
    const epsilon = 1e-7;
    const prob = Math.max(epsilon, Math.min(1 - epsilon, probPct / 100));
    const logit = Math.log(prob / (1 - prob));
    const expVal = Math.exp(Math.max(-50, Math.min(50, A * logit + B)));
    return Math.max(1, Math.min(99, (1 / (1 + expVal)) * 100));
}

async function applyCalibrationPostProcessingV3(
    picks: any[],
    leagueName: string,
    supabase: any,
    _minSamplesForCorrection: number = 20
): Promise<{ adjustedPicks: any[]; adjustments: CalibrationAdjustment[] }> {
    const adjustments: CalibrationAdjustment[] = [];

    try {
        // If strategic insights are enabled, skip numerical calibration entirely
        // (qualitative insights replace numerical adjustments)
        const { data: insightsSetting } = await supabase
            .from('system_settings')
            .select('value')
            .eq('key', 'ml_strategic_insights_enabled')
            .single();

        if (insightsSetting?.value === true) {
            console.log('[v3-ai-analyzer] ML V4: Strategic insights ON → skipping numerical calibration');
            return { adjustedPicks: picks, adjustments: [] };
        }

        const { data: factors } = await supabase
            .from('ml_calibration_factors')
            .select('dimension, dimension_key, calibration_factor, confidence_adjustment, actual_wr, predicted_avg, sample_size')
            .eq('status', 'active');

        if (!factors || factors.length === 0) {
            console.log('[v3-ai-analyzer] ML V4: No calibration factors found. NO-OP.');
            return { adjustedPicks: picks, adjustments: [] };
        }

        // Build lookup maps
        const factorMap = new Map<string, any>();
        let totalSamples = 0;
        for (const f of factors) {
            factorMap.set(`${f.dimension}|${f.dimension_key}`, f);
            if (f.dimension === 'prob_band') totalSamples += (f.sample_size || 0);
        }

        // Check minimum data threshold
        if (totalSamples < MIN_GLOBAL_SAMPLES_FOR_PLATT) {
            console.log(`[v3-ai-analyzer] ML V4: Only ${totalSamples} total samples (need ${MIN_GLOBAL_SAMPLES_FOR_PLATT}). NO-OP.`);
            return { adjustedPicks: picks, adjustments: [] };
        }

        // ── Read Platt parameters (stored by ml-train-calibration as dimension='platt', key='global') ──
        const plattRow = factorMap.get('platt|global');
        const hasPlatt = plattRow && plattRow.calibration_factor != null && plattRow.confidence_adjustment != null;
        const plattA = hasPlatt ? plattRow.calibration_factor : 1.0;
        const plattB = hasPlatt ? (plattRow.confidence_adjustment / 1000) : 0.0; // B stored as B*1000

        if (hasPlatt) {
            console.log(`[v3-ai-analyzer] ML V4: Platt params A=${plattA.toFixed(4)}, B=${(plattB).toFixed(4)}, totalSamples=${totalSamples}`);
        }

        const adjustedPicks = picks.map((pick: any) => {
            const originalProb = pick.probabilidad_calculada_porcentaje || 50;
            const market = pick.mercado || '';
            const probBandKey = originalProb < 80 ? '<80%' : originalProb < 83 ? '80-82%' : originalProb < 86 ? '83-85%' : originalProb < 90 ? '86-89%' : '90%+';

            let adjustedProb = originalProb;
            const appliedFactors: string[] = [];

            // ── STEP 1: Global Platt Scaling (bidirectional — can INCREASE or DECREASE) ──
            if (hasPlatt && (plattA !== 1.0 || plattB !== 0.0)) {
                const plattProb = applyPlattScale(originalProb, plattA, plattB);
                const plattDelta = plattProb - originalProb;
                // Cap Platt correction at ±MAX_CORRECTION_PTS
                const cappedDelta = Math.max(-MAX_CORRECTION_PTS, Math.min(MAX_CORRECTION_PTS, plattDelta));
                adjustedProb = originalProb + cappedDelta;
                const direction = cappedDelta >= 0 ? '+' : '';
                appliedFactors.push(`platt:${direction}${cappedDelta.toFixed(1)}`);
            }

            // ── STEP 2: Per-dimension corrections (bidirectional) ──
            // Apply prob_band, market, league — each contributes a small delta
            const dimCorrections: { key: string; delta: number; weight: number }[] = [];

            // Prob band
            const probFactor = factorMap.get(`prob_band|${probBandKey}`);
            if (probFactor && probFactor.sample_size >= MIN_DIM_SAMPLES) {
                const gap = (probFactor.predicted_avg || originalProb) - (probFactor.actual_wr || originalProb);
                if (Math.abs(gap) > 3) {
                    const sign = gap > 0 ? -1 : 1; // overconfident→reduce, underconfident→increase
                    const rawAdj = Math.min(Math.abs(gap) * 0.3, MAX_CORRECTION_PTS);
                    const sampleWeight = Math.min(1.0, probFactor.sample_size / 100);
                    dimCorrections.push({ key: `prob_band(${probBandKey})`, delta: sign * rawAdj, weight: sampleWeight });
                }
            }

            // Market
            const marketFactor = factorMap.get(`market|${market}`);
            if (marketFactor && marketFactor.sample_size >= MIN_DIM_SAMPLES) {
                const gap = (marketFactor.predicted_avg || originalProb) - (marketFactor.actual_wr || originalProb);
                if (Math.abs(gap) > 5) {
                    const sign = gap > 0 ? -1 : 1;
                    const rawAdj = Math.min(Math.abs(gap) * 0.25, MAX_CORRECTION_PTS * 0.5); // Market: max ±4pts
                    const sampleWeight = Math.min(1.0, marketFactor.sample_size / 100);
                    dimCorrections.push({ key: `market(${market})`, delta: sign * rawAdj, weight: sampleWeight });
                }
            }

            // League
            const leagueFactor = factorMap.get(`league|${leagueName}`);
            if (leagueFactor && leagueFactor.sample_size >= MIN_DIM_SAMPLES) {
                const gap = (leagueFactor.predicted_avg || originalProb) - (leagueFactor.actual_wr || originalProb);
                if (Math.abs(gap) > 5) {
                    const sign = gap > 0 ? -1 : 1;
                    const rawAdj = Math.min(Math.abs(gap) * 0.25, MAX_CORRECTION_PTS * 0.5); // League: max ±4pts
                    const sampleWeight = Math.min(1.0, leagueFactor.sample_size / 100);
                    dimCorrections.push({ key: `league(${leagueName})`, delta: sign * rawAdj, weight: sampleWeight });
                }
            }

            // Combine dimension corrections (weighted average if multiple)
            if (dimCorrections.length > 0) {
                let totalWeight = 0;
                let weightedSum = 0;
                for (const dc of dimCorrections) {
                    weightedSum += dc.delta * dc.weight;
                    totalWeight += dc.weight;
                }
                const dimDelta = totalWeight > 0 ? weightedSum / totalWeight : 0;
                // Cap total dimension correction at ±4pts (secondary to Platt)
                const cappedDimDelta = Math.max(-4, Math.min(4, dimDelta));
                if (Math.abs(cappedDimDelta) >= 0.3) {
                    adjustedProb += cappedDimDelta;
                    const dir = cappedDimDelta >= 0 ? '+' : '';
                    for (const dc of dimCorrections) {
                        const d = dc.delta >= 0 ? '+' : '';
                        appliedFactors.push(`${dc.key}:${d}${dc.delta.toFixed(1)}×${dc.weight.toFixed(2)}`);
                    }
                    appliedFactors.push(`dim_combined:${dir}${cappedDimDelta.toFixed(1)}`);
                }
            }

            // ── STEP 3: Safety caps (bidirectional) ──
            const totalDelta = adjustedProb - originalProb;
            if (Math.abs(totalDelta) > MAX_CORRECTION_PTS) {
                adjustedProb = originalProb + (totalDelta > 0 ? MAX_CORRECTION_PTS : -MAX_CORRECTION_PTS);
            }
            adjustedProb = Math.max(50, Math.min(95, adjustedProb)); // Floor 50%, Ceiling 95%
            adjustedProb = Math.round(adjustedProb * 10) / 10;

            if (appliedFactors.length > 0 && Math.abs(adjustedProb - originalProb) >= 0.3) {
                adjustments.push({
                    market,
                    league: leagueName,
                    originalProb,
                    adjustedProb,
                    factorsApplied: appliedFactors,
                });

                return {
                    ...pick,
                    probabilidad_calculada_porcentaje: adjustedProb,
                    probabilidad_original_pre_ml: originalProb,
                    ml_adjustments: appliedFactors,
                };
            }

            return pick;
        });

        return { adjustedPicks, adjustments };
    } catch (err) {
        console.error('[v3-ai-analyzer] ML V4 post-processing error (non-blocking):', err);
        return { adjustedPicks: picks, adjustments: [] };
    }
}

// Lista completa de mercados a evaluar
const MARKETS_CATALOG = `
═══ MERCADOS DISPONIBLES PARA EVALUAR ═══

RESULTADO (1X2):
- Victoria Local
- Empate  
- Victoria Visitante
- Doble Oportunidad: 1X (Local o Empate)
- Doble Oportunidad: X2 (Empate o Visitante)
- Doble Oportunidad: 12 (Local o Visitante)
- Empate Apuesta No (DNB) Local
- Empate Apuesta No (DNB) Visitante

GOLES TOTALES:
- Over 0.5 Goles
- Under 0.5 Goles
- Over 1.5 Goles
- Under 1.5 Goles
- Over 2.5 Goles
- Under 2.5 Goles
- Over 3.5 Goles
- Under 3.5 Goles
- Over 4.5 Goles
- Under 4.5 Goles

AMBOS ANOTAN (BTTS):
- Ambos Anotan: Sí
- Ambos Anotan: No
- BTTS + Over 2.5
- BTTS + Under 3.5

GOLES POR EQUIPO:
- Local Over 0.5 Goles
- Local Over 1.5 Goles
- Local Over 2.5 Goles
- Visitante Over 0.5 Goles
- Visitante Over 1.5 Goles
- Visitante Over 2.5 Goles
- Local Anota: Sí
- Local Anota: No
- Visitante Anota: Sí
- Visitante Anota: No

GOLES POR TIEMPO:
- Gol en 1er Tiempo: Sí
- Gol en 1er Tiempo: No
- Gol en 2do Tiempo: Sí
- 1er Tiempo Over 0.5
- 1er Tiempo Over 1.5
- 2do Tiempo Over 0.5
- 2do Tiempo Over 1.5
- Mayor Cantidad Goles: 1er Tiempo
- Mayor Cantidad Goles: 2do Tiempo
- Mayor Cantidad Goles: Igual

CORNERS:
- Corners Over 7.5
- Corners Over 8.5
- Corners Over 9.5
- Corners Over 10.5
- Corners Over 11.5
- Corners Under 9.5
- Corners Under 10.5

TARJETAS:
- Tarjetas Over 2.5
- Tarjetas Over 3.5
- Tarjetas Over 4.5
- Tarjeta Roja: Sí
- Tarjeta Roja: No

HANDICAP ASIÁTICO:
- Local -0.5
- Local -1.0
- Local -1.5
- Visitante +0.5
- Visitante +1.0
- Visitante +1.5

ESPECIALES:
- Primer Gol: Local
- Primer Gol: Visitante
- Sin Goles (0-0)
`;

// Helper function to normalize prediction fields from AI output
function normalizePrediction(p: any, index: number) {
    const probRaw = p.probabilidad_calculada_porcentaje || p.probabilidad_derbix || p.probabilidad_implicita || p.probabilidad || "50%";
    const prob = typeof probRaw === 'string' ? parseFloat(probRaw.replace('%', '').replace('+', '')) : probRaw;
    const edgeRaw = p.edge_porcentaje || p.edge_calculado || p.edge || "0%";
    const edge = typeof edgeRaw === 'string' ? parseFloat(edgeRaw.replace('%', '').replace('+', '')) : edgeRaw;
    // Solo cuota_actual es fuente válida. cuota_estimada / cuota_referencia eran
    // campos para cuotas inventadas — ya no se permiten.
    const odds = (typeof p.cuota_actual === 'number' && p.cuota_actual > 1.0) ? p.cuota_actual : null;
    const justText = p.razonamiento || p.justificacion?.estadistica || p.justificacion?.tactica || "Análisis IA completado";

    return {
        id: `${p.mercado}_${p.seleccion}`.replace(/\s/g, '_'),
        mercado: p.mercado || "Mercado",
        seleccion: p.seleccion || "Seleccion",
        probabilidad_estimado_porcentaje: prob || 50,
        odds: odds,
        edge: edge || 0,
        nivel_confianza: p.nivel_confianza || 'MEDIA',
        stake_recomendado: p.stake_recomendado || 1,
        justificacion_detallada: {
            base_estadistica: [typeof justText === 'string' ? justText.substring(0, 300) : ''],
            contexto_competitivo: [p.tipo || p.nivel_confianza || 'Análisis Profundo'],
            conclusion: typeof justText === 'string' && justText.length > 300 ? justText.substring(300) : 'Valor matemático identificado.'
        }
    };
}

// Helper for top_oportunidades
function normalizeOpportunity(p: any) {
    const probRaw = p.probabilidad_calculada_porcentaje || p.probabilidad_derbix || p.probabilidad_implicita || "50%";
    const prob = typeof probRaw === 'string' ? parseFloat(probRaw.replace('%', '')) : probRaw;
    const edgeRaw = p.edge_porcentaje || p.edge_calculado || p.edge || "0%";
    const edge = typeof edgeRaw === 'string' ? parseFloat(edgeRaw.replace('%', '').replace('+', '')) : edgeRaw;
    // Solo cuota_actual es fuente válida. cuota_estimada / cuota_referencia eran
    // campos para cuotas inventadas — ya no se permiten.
    const odds = (typeof p.cuota_actual === 'number' && p.cuota_actual > 1.0) ? p.cuota_actual : null;
    const probImpl = p.probabilidad_implicita;
    const probTipica = typeof probImpl === 'string' ? parseFloat(probImpl.replace('%', '')) : (p.probabilidad_implicita_porcentaje || 50);

    return {
        mercado: p.mercado,
        categoria: p.mercado?.split(' ')[0]?.toUpperCase() || 'OTRO',
        seleccion: p.seleccion,
        cuota: odds,
        probabilidad_calculada: prob || 50,
        probabilidad_tipica: probTipica,
        confianza: p.nivel_confianza || p.confianza || 'MEDIA',
        value_score: edge || 0
    };
}

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    const startTime = Date.now();
    const GEMINI_MODEL = 'gemini-3.1-pro-preview';
    const ENGINE_VERSION = Deno.env.get('USE_V9_ENGINE') === 'true' ? 'V9-HYBRID' : 'V8.2-STRATEGIC';
    const USE_V9 = Deno.env.get('USE_V9_ENGINE') === 'true';
    let _jobId: string | null = null; // For error handler access

    try {
        const { job_id, fixture_id: inFixtureId, payload: inPayload } = await req.json();
        _jobId = job_id;

        if (!job_id) {
            throw new Error('job_id is required');
        }

        const sbUrl = Deno.env.get('SUPABASE_URL')!;
        const sbKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const geminiKey = Deno.env.get('GEMINI_API_KEY')!;

        const supabase = createClient(sbUrl, sbKey);

        // If no payload provided, read from etl_context saved by the ETL stage
        let payload = inPayload;
        let fixture_id = inFixtureId;
        if (!payload) {
            console.log(`[V4-MASTERMIND] No payload in body, reading etl_context from DB for job ${job_id}...`);
            const { data: jobData, error: jobErr } = await supabase
                .from('analysis_jobs_v2')
                .select('etl_context, fixture_id')
                .eq('id', job_id)
                .single();
            if (jobErr || !jobData?.etl_context) {
                throw new Error(`Cannot read etl_context for job ${job_id}: ${jobErr?.message || 'no data'}`);
            }
            payload = jobData.etl_context;
            fixture_id = fixture_id || jobData.fixture_id;
            console.log(`[V4-MASTERMIND] Loaded etl_context from DB (${JSON.stringify(payload).length} chars)`);
        }

        if (!fixture_id || !payload) {
            throw new Error('fixture_id and payload are required (either via body or etl_context)');
        }

        console.log(`[V4-MASTERMIND] Starting analysis using ${GEMINI_MODEL} for fixture: ${fixture_id}`);

        // Update job status
        await supabase
            .from('analysis_jobs_v2')
            .update({ status: 'analyzing', current_motor: ENGINE_VERSION })
            .eq('id', job_id);

        // ═══════════════════════════════════════════════════════════════
        // EXTRAER DATOS (DEEP DIVE)
        // ═══════════════════════════════════════════════════════════════
        const match = payload.match || {};
        const datasets = payload.datasets || {};
        const odds = payload.odds || null;

        const homeTeam = match.teams?.home?.name || 'Local';
        const awayTeam = match.teams?.away?.name || 'Visitante';
        const leagueName = match.competition?.name || 'Liga';

        // V8 UPGRADE: Format matches with events (minute-by-minute)
        const formatMatchForPrompt = (m: any, index: number) => {
            const teamWon = m.was_home
                ? m.score_home > m.score_away
                : m.score_away > m.score_home;
            const teamLost = m.was_home
                ? m.score_home < m.score_away
                : m.score_away < m.score_home;
            const resultText = teamWon ? '✓ VICTORIA' : teamLost ? '✗ DERROTA' : '= EMPATE';
            const venueTag = m.was_home ? '(LOCAL)' : '(VISITANTE)';

            const teamGoals = m.was_home ? m.score_home : m.score_away;
            const oppGoals = m.was_home ? m.score_away : m.score_home;

            const d = m.details || {};
            const statsLine = `   📊 Stats: ${d.possession || '?'}% Pos | ${d.shots_on_target || 0}/${d.shots_total || 0} Tiros | ${d.corners || 0} Corners | ${d.saves || 0} Atajadas`;
            const oppStatsLine = `   📊 Rival: ${d.opponent_possession || '?'}% Pos | ${d.opponent_shots_on_target || 0}/${d.opponent_shots || 0} Tiros | ${d.opponent_corners || 0} Corners`;
            const cardsLine = `   🟨 Disciplina: ${d.yellow_cards || 0} Amarillas | ${d.red_cards || 0} Rojas | ${d.fouls || 0} Faltas | ${d.free_kicks || 0} T.Libres`;
            const formLine = `   🎯 Formación: ${d.formation_used || '?'} (vs ${d.opponent_formation || '?'})`;

            // V8: Half-time score
            const htLine = (d.ht_score_team !== null && d.ht_score_team !== undefined)
                ? `   ⏱️ 1er Tiempo: ${d.ht_score_team}-${d.ht_score_opponent}`
                : '';

            // V8: Detailed events
            let eventsBlock = '';
            if (d.events && Array.isArray(d.events) && d.events.length > 0) {
                const eventLines = d.events.slice(0, 8).map((e: any) => {
                    const icon = e.type === 'Goal' ? '⚽' : e.type === 'Yellow Card' ? '🟨' : e.type === 'Red Card' ? '🟥' : e.type === 'Substitution' ? '🔄' : '📌';
                    return `      ${e.minute}' ${icon} ${e.type} - ${e.player}${e.detail ? ` (${e.detail})` : ''}${e.related_player ? ` ← ${e.related_player}` : ''}`;
                }).join('\n');
                eventsBlock = `   ⚡ Eventos:\n${eventLines}`;
            } else if (d.goal_timings) {
                eventsBlock = `   ⚽ Minutos de gol: ${d.goal_timings}`;
            }

            const lines = [
                `${index + 1}. ${m.date} vs ${m.opponent_name || m.away_team}: ${teamGoals}-${oppGoals} ${resultText} ${venueTag}`,
                statsLine,
                oppStatsLine,
                cardsLine,
                formLine
            ];
            if (htLine) lines.push(htLine);
            if (eventsBlock) lines.push(eventsBlock);

            return lines.join('\n');
        };

        // V8: Format venue-specific stats with summary
        const formatVenueSection = (matches: any[], label: string) => {
            if (!matches || matches.length === 0) return `${label}: Sin datos disponibles.\n`;

            const calcStats = (arr: any[]) => {
                const wins = arr.filter(m => (m.was_home ? m.score_home > m.score_away : m.score_away > m.score_home)).length;
                const draws = arr.filter(m => m.score_home === m.score_away).length;
                const losses = arr.length - wins - draws;
                const goalsFor = arr.reduce((sum, m) => sum + (m.was_home ? m.score_home : m.score_away), 0);
                const goalsAgainst = arr.reduce((sum, m) => sum + (m.was_home ? m.score_away : m.score_home), 0);
                return { wins, draws, losses, goalsFor, goalsAgainst, total: arr.length };
            };

            const stats = calcStats(matches);
            let output = `\n${label} (${matches.length} partidos): ${stats.wins}V-${stats.draws}E-${stats.losses}D | GF:${stats.goalsFor} GA:${stats.goalsAgainst} | Prom: ${(stats.goalsFor / matches.length).toFixed(1)} GF/p, ${(stats.goalsAgainst / matches.length).toFixed(1)} GA/p\n\n`;
            output += matches.map((m, i) => formatMatchForPrompt(m, i)).join('\n\n');
            return output;
        };

        // V8: Format general form (simple, lightweight)
        const formatGeneralForm = (form: any[]) => {
            if (!form || form.length === 0) return 'Sin forma general disponible.';
            const formString = form.slice(0, 30).map(m => m.result).join('');
            const wins = form.filter(m => m.result === 'W').length;
            const draws = form.filter(m => m.result === 'D').length;
            const losses = form.filter(m => m.result === 'L').length;
            return `Forma (${form.length}p): ${formString} | ${wins}W-${draws}D-${losses}L\n` +
                form.slice(0, 10).map(m => `  ${m.date} ${m.was_home ? '🏠' : '✈️'} vs ${m.opponent}: ${m.score} ${m.result}${m.formation ? ` (${m.formation})` : ''}`).join('\n');
        };

        // V8: Use new structured datasets (home_team / away_team with as_home/as_away)
        const homeData = datasets.home_team || {};
        const awayData = datasets.away_team || {};

        // Fallback to old format if V8 structure not present
        const homeAsHome = homeData.as_home || datasets.home_team_last40?.all?.filter((m: any) => m.was_home === true) || [];
        const homeAsAway = homeData.as_away || datasets.home_team_last40?.all?.filter((m: any) => m.was_home === false) || [];
        const awayAsHome = awayData.as_home || datasets.away_team_last40?.all?.filter((m: any) => m.was_home === true) || [];
        const awayAsAway = awayData.as_away || datasets.away_team_last40?.all?.filter((m: any) => m.was_home === false) || [];

        const deepHome = `\n📍 ${homeTeam} COMO LOCAL:\n` + formatVenueSection(homeAsHome, `📍 Como LOCAL`) +
            `\n\n✈️ ${homeTeam} COMO VISITANTE:\n` + formatVenueSection(homeAsAway, `✈️ Como VISITANTE`) +
            (homeData.general_form ? `\n\n📋 FORMA GENERAL ${homeTeam}:\n` + formatGeneralForm(homeData.general_form) : '');

        const deepAway = `\n📍 ${awayTeam} COMO LOCAL:\n` + formatVenueSection(awayAsHome, `📍 Como LOCAL`) +
            `\n\n✈️ ${awayTeam} COMO VISITANTE:\n` + formatVenueSection(awayAsAway, `✈️ Como VISITANTE`) +
            (awayData.general_form ? `\n\n📋 FORMA GENERAL ${awayTeam}:\n` + formatGeneralForm(awayData.general_form) : '');

        // V8: External context from Perplexity
        const externalContext = payload.external_context;
        const externalContextText = externalContext
            ? `\n>>> CONTEXTO EXTERNO (Noticias Recientes - Últimos 7 días)\n${externalContext.raw_text || 'Sin contexto externo disponible.'}\n${externalContext.citations?.length ? `\nFuentes: ${externalContext.citations.join(', ')}` : ''}`
            : '\n>>> CONTEXTO EXTERNO: No disponible (Perplexity no configurado o sin resultados).';

        // H2H Rich Format
        const h2hText = datasets.h2h?.map((m: any) => {
            const s = m.stats || {};
            // If stats exist, show them (Home vs Away)
            const statsInfo = s.home ?
                `\n   > ${m.home_team}: ${s.home.shots} Tiros (${s.home.shots_ot} Arco) | ${s.home.corners} Corners | ${s.home.cards} Tarjetas\n   > ${m.away_team}: ${s.away.shots} Tiros (${s.away.shots_ot} Arco) | ${s.away.corners} Corners | ${s.away.cards} Tarjetas`
                : '';
            return `${m.date}: ${m.home_team} ${m.score_home}-${m.score_away} ${m.away_team}${statsInfo}`;
        }).join('\n') || 'Sin H2H recientes';
        let oddsText = '';
        if (odds && (odds.MAIN?.length || odds.GOALS?.length || odds.TEAMS?.length || odds.COMBOS?.length)) {
            const bm = odds._meta?.bookmaker ? ` (bookmaker: ${odds._meta.bookmaker})` : '';
            oddsText = `CUOTAS REALES DEL MERCADO${bm}:\n`;
            for (const cat of ['MAIN', 'GOALS', 'TEAMS', 'HALVES', 'CORNERS', 'COMBOS', 'OTHERS']) {
                const list = (odds as any)[cat];
                if (!list?.length) continue;
                oddsText += `\n[${cat}]\n`;
                for (const o of list) {
                    oddsText += `  - ${o.lbl}: ${o.val}\n`;
                }
            }
            oddsText += `\nREGLA: Solo genera pronósticos cuyo mercado/selección aparezca en esta lista. cuota_actual debe ser el número de esta lista, no uno inventado.`;
        } else if (odds?.bookmakers?.[0]) {
            // Legacy format compatibility
            oddsText = `CUOTAS (formato legacy):\n${JSON.stringify(odds.bookmakers[0]).slice(0, 500)}`;
        } else {
            oddsText = 'SIN CUOTAS DISPONIBLES — establece veredicto: NO_BET y pronosticos: [].';
        }

        // ═══ ML AUTO-LEARNING: Build dynamic calibration block ═══
        const mlCalibration = await buildCalibrationBlock(supabase);
        console.log(`[v3-ai-analyzer] Using ${mlCalibration.source} calibration data (${mlCalibration.factorCount} factors)`);

        // ═══ STRATEGIC INSIGHTS: Qualitative learnings from verified picks ═══
        console.log(`[v3-ai-analyzer] [DEBUG] About to call buildStrategicInsightsBlock...`);
        const strategicInsightsBlock = await buildStrategicInsightsBlock(supabase);
        console.log(`[v3-ai-analyzer] [DEBUG] buildStrategicInsightsBlock returned: ${strategicInsightsBlock.length} chars`);
        if (strategicInsightsBlock) {
            console.log(`[v3-ai-analyzer] Strategic insights block injected into prompt`);
        }

        // ═══════════════════════════════════════════════════════════════
        // PIPELINE DE ANÁLISIS ESCALONADO (4 CAPAS — SECUENCIAL)
        // Groq free tier: 6,000 TPM → cada capa ~2-4K tokens
        // Se ejecutan en secuencia con delays calculados para no exceder el rate limit
        // Capa 1 → delay → Capa 2 → delay → Capa 3 → delay → Capa 4
        // ═══════════════════════════════════════════════════════════════
        const WALL_CLOCK_SAFE = 140000;
        const SAVE_RESERVE_MS = 15000;
        const remainingMs = () => WALL_CLOCK_SAFE - (Date.now() - startTime);

        const USE_STAGED = Deno.env.get('USE_STAGED_ANALYSIS') !== 'false';

        // Helper to parse stage JSON responses
        const parseStageJSON = (text: string, stageName: string): any => {
            let cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
            const si = cleaned.indexOf('{');
            const ei = cleaned.lastIndexOf('}');
            if (si !== -1 && ei > si) cleaned = cleaned.substring(si, ei + 1);
            try { return JSON5.parse(cleaned); } catch {}
            try { return JSON.parse(cleaned); } catch {}
            console.warn(`[V3-AI-ANALYZER] ${stageName} JSON parse failed, using raw text`);
            return { raw_text: cleaned };
        };

        let analysisResult: any;
        let tokensUsed = 0;

        // ═══════════════════════════════════════════════════════════════
        // V9 HYBRID ENGINE — Math Models + Multi-Agent Debate
        // Activado via env var USE_V9_ENGINE=true
        // ═══════════════════════════════════════════════════════════════
        if (USE_V9) {
            console.log('[V9-HYBRID] Running V9 engine: math models + multi-agent debate + RAG...');

            // ═══ RAG: Fetch similar past picks using embeddings ═══
            // This is best-effort; if embeddings/pgvector fail, we skip without blocking.
            let similarPastPicks: Array<{ summary: string; outcome: string; features: any }> = [];
            try {
                const queryText = `${homeTeam} vs ${awayTeam}. ${leagueName}. Key factors.`;
                const embeddingRes = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${geminiKey}`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            model: 'models/text-embedding-004',
                            content: { parts: [{ text: queryText }] },
                        }),
                    }
                );
                if (embeddingRes.ok) {
                    const embJson = await embeddingRes.json();
                    const queryEmbedding = embJson.embedding?.values;
                    if (queryEmbedding) {
                        const { data: similar } = await supabase.rpc('match_similar_picks', {
                            query_embedding: queryEmbedding,
                            match_threshold: 0.70,
                            match_count: 5,
                            filter_league: leagueName,
                        });
                        if (similar && similar.length > 0) {
                            similarPastPicks = similar.map((s: any) => ({
                                summary: `${s.features?.market || 'N/A'}: ${s.features?.selection || 'N/A'} @ ${s.features?.odds || '?'}`,
                                outcome: s.outcome || 'UNKNOWN',
                                features: s.features,
                            }));
                            console.log(`[V9-HYBRID] RAG: ${similarPastPicks.length} similar past picks retrieved`);
                        }
                    }
                }
            } catch (ragErr: any) {
                console.warn(`[V9-HYBRID] RAG retrieval failed (non-blocking): ${ragErr.message}`);
            }

            // Step 1: Run mathematical models (Dixon-Coles + Elo + Monte Carlo)
            const homeHistoryRaw = homeData.as_home || [];
            const awayHistoryRaw = awayData.as_away || [];
            const combinedHomeHistory = [...homeHistoryRaw, ...(homeData.as_away || [])];
            const combinedAwayHistory = [...awayHistoryRaw, ...(awayData.as_home || [])];

            // Build odds dict for value detection.
            // Canon keys from sportmonks-normalizer.ts organizeOddsForAI use format like
            // '1x2_home', '1x2_draw', '1x2_away', 'goals_over_2.5', 'goals_under_2.5', 'btts_yes', 'btts_no'.
            // We check several candidate patterns since SportMonks canons have evolved.
            const oddsDict: Record<string, number> = {};
            const organizedOdds = payload.odds || {};
            for (const section of ['MAIN', 'GOALS', 'TEAMS']) {
                const items = organizedOdds[section] || [];
                for (const o of items) {
                    if (!o.canon || typeof o.val !== 'number') continue;
                    const canon = String(o.canon).toLowerCase();
                    // 1X2
                    if (canon.includes('1x2') && (canon.includes('home') || canon.endsWith('_1'))) oddsDict.home_win = o.val;
                    else if (canon.includes('1x2') && (canon.includes('away') || canon.endsWith('_2'))) oddsDict.away_win = o.val;
                    else if (canon.includes('1x2') && (canon.includes('draw') || canon.endsWith('_x'))) oddsDict.draw = o.val;
                    // Over/Under 2.5
                    else if ((canon.includes('over') || canon.includes('mas')) && canon.includes('2.5')) oddsDict.over_25 = o.val;
                    else if ((canon.includes('under') || canon.includes('menos')) && canon.includes('2.5')) oddsDict.under_25 = o.val;
                    // BTTS
                    else if (canon.includes('btts') && canon.includes('yes')) oddsDict.btts_yes = o.val;
                    else if (canon.includes('btts') && canon.includes('no')) oddsDict.btts_no = o.val;
                    // Double chance
                    else if (canon.includes('dc') && (canon.includes('home_or_draw') || canon.endsWith('_1x'))) oddsDict.home_or_draw = o.val;
                    else if (canon.includes('dc') && (canon.includes('away_or_draw') || canon.endsWith('_x2'))) oddsDict.away_or_draw = o.val;
                }
            }
            // Also probe from the preformatted oddsText as a last resort (label fallback)
            if (Object.keys(oddsDict).length === 0 && organizedOdds.MAIN) {
                for (const o of organizedOdds.MAIN) {
                    const lbl = String(o.lbl || '').toLowerCase();
                    if (lbl.includes('home') || lbl === '1') oddsDict.home_win = o.val;
                    else if (lbl.includes('away') || lbl === '2') oddsDict.away_win = o.val;
                    else if (lbl.includes('draw') || lbl === 'x') oddsDict.draw = o.val;
                }
            }
            console.log(`[V9-HYBRID] Odds dict built: ${Object.keys(oddsDict).length} markets (${Object.keys(oddsDict).join(',')})`);

            const mathResult = runMathModels({
                homeTeamId: payload.match?.teams?.home?.id || 0,
                homeTeamName: homeTeam,
                awayTeamId: payload.match?.teams?.away?.id || 0,
                awayTeamName: awayTeam,
                homeHistory: combinedHomeHistory,
                awayHistory: combinedAwayHistory,
                marketOdds: oddsDict,
            });

            console.log(`[V9-HYBRID] Math models: λ_h=${mathResult.dixon_coles.lambdaHome}, λ_a=${mathResult.dixon_coles.lambdaAway}, Elo ${mathResult.elo.homeElo}/${mathResult.elo.awayElo}, ${mathResult.value_opportunities.length} value ops`);

            // Step 2: Enrich context (lineups, coaches, weather, xG, fatigue, key players)
            const rawFixture = (payload.match?._raw_fixture) || payload.match || {};
            const homeTeamId = payload.match?.teams?.home?.id || 0;
            const awayTeamId = payload.match?.teams?.away?.id || 0;

            const lineupsNorm = normalizeLineups(rawFixture, homeTeamId, awayTeamId);
            const coachesNorm = normalizeCoaches(rawFixture, homeTeamId, awayTeamId);
            const weatherNorm = normalizeWeather(rawFixture);
            const homeXG = computeTeamXGRolling(combinedHomeHistory, homeTeamId, 10);
            const awayXG = computeTeamXGRolling(combinedAwayHistory, awayTeamId, 10);
            const homeKeyPlayers = computeKeyPlayerImpact(homeTeamId, combinedHomeHistory, homeData.injuries || [], lineupsNorm.home);
            const awayKeyPlayers = computeKeyPlayerImpact(awayTeamId, combinedAwayHistory, awayData.injuries || [], lineupsNorm.away);
            const matchDateIso = payload.match?.date_time_utc || new Date().toISOString();
            const homeFatigue = computeFatigueIndex(combinedHomeHistory, matchDateIso);
            const awayFatigue = computeFatigueIndex(combinedAwayHistory, matchDateIso);

            // Step 3: Build MatchContext for the agents
            const matchContext: MatchContext = {
                homeTeam,
                awayTeam,
                league: leagueName,
                date: matchDateIso.split('T')[0],
                math: mathResult,
                homeHistory: deepHome,
                awayHistory: deepAway,
                h2h: h2hText,
                odds: oddsText,
                lineups: lineupsNorm.home.has_confirmed_lineup || lineupsNorm.away.has_confirmed_lineup ? {
                    home: {
                        formation: lineupsNorm.home.formation,
                        starters: lineupsNorm.home.starters.map((s) => s.player_name),
                        missing: homeKeyPlayers.missing_key_players.map((m) => `${m.name} (${m.role})`),
                    },
                    away: {
                        formation: lineupsNorm.away.formation,
                        starters: lineupsNorm.away.starters.map((s) => s.player_name),
                        missing: awayKeyPlayers.missing_key_players.map((m) => `${m.name} (${m.role})`),
                    },
                } : undefined,
                weather: weatherNorm ? {
                    description: weatherNorm.description || 'Normal',
                    impact: [
                        weatherNorm.impact_factors.rain_heavy && 'Lluvia fuerte (-0.3 goles esperados)',
                        weatherNorm.impact_factors.wind_strong && 'Viento fuerte (+15% corners)',
                        weatherNorm.impact_factors.temp_extreme && 'Temperatura extrema (-0.15 goles)',
                        weatherNorm.impact_factors.altitude_high && 'Altitud alta (+0.4 ventaja local)',
                    ].filter(Boolean).join(' | ') || 'Sin impacto relevante',
                } : null,
                coaches: (coachesNorm.home || coachesNorm.away) ? {
                    home: { name: coachesNorm.home?.name || 'Unknown', is_new: coachesNorm.home?.is_new_coach || false },
                    away: { name: coachesNorm.away?.name || 'Unknown', is_new: coachesNorm.away?.is_new_coach || false },
                } : undefined,
                xg: (homeXG.sample_size > 0 || awayXG.sample_size > 0) ? {
                    home: { for: homeXG.xg_for_avg, against: homeXG.xga_avg, overperf: homeXG.xg_overperformance },
                    away: { for: awayXG.xg_for_avg, against: awayXG.xga_avg, overperf: awayXG.xg_overperformance },
                } : undefined,
                fatigue: { home: homeFatigue.fatigue_score, away: awayFatigue.fatigue_score },
                key_players: {
                    home_missing: homeKeyPlayers.missing_key_players.map((m) => `${m.name} — ${m.role} (${m.reason})`),
                    away_missing: awayKeyPlayers.missing_key_players.map((m) => `${m.name} — ${m.role} (${m.reason})`),
                },
                external_context: typeof payload.external_context === 'string'
                    ? payload.external_context
                    : payload.external_context?.raw_text,
                similar_past_picks: similarPastPicks.length > 0 ? similarPastPicks.map((s) => ({
                    summary: s.summary,
                    outcome: s.outcome as 'WON' | 'LOST' | 'VOID',
                    features: s.features,
                })) : undefined,
            };

            // Step 4: Run debate
            const debate = await runDebate(matchContext);
            tokensUsed = debate.total_tokens;

            console.log(`[V9-HYBRID] Debate complete: ${debate.agents.length} agents, ${debate.consensus.strong_picks.length} strong picks, ${debate.final_verdict.picks.length} final picks, verdict=${debate.final_verdict.veredicto}`);

            // Step 5: Assemble final analysisResult (compatible with existing save/normalize pipeline)
            // @ts-expect-error _judgeOutput exposed from orchestrator
            const judgeOutput = debate._judgeOutput;

            analysisResult = {
                meta: { modelo: 'v9-multi-provider', version: ENGINE_VERSION, engine: 'V9-HYBRID' },
                resumen_ejecutivo: judgeOutput?.resumen_ejecutivo || {
                    titular: debate.final_verdict.summary,
                    veredicto: debate.final_verdict.veredicto,
                    confianza_global: debate.final_verdict.overall_confidence >= 82 ? 'ALTA' :
                                      debate.final_verdict.overall_confidence >= 70 ? 'MEDIA' : 'BAJA',
                    picks_principales: debate.final_verdict.picks.slice(0, 2).map((p: any) => `${p.mercado}: ${p.seleccion}`),
                },
                scores_duales: judgeOutput?.scores_duales || {
                    score_estadistico: Math.round(mathResult.ensemble_probabilities.home_win * 100),
                    score_inteligencia_partido: debate.final_verdict.overall_confidence,
                    confianza_final_calculada: debate.final_verdict.overall_confidence,
                    justificacion_balance: `Modelos matemáticos + ${debate.agents.filter(a => !a.error).length}/${debate.agents.length} agentes`,
                },
                analisis_profundo: judgeOutput?.analisis_profundo || {
                    razonamiento_central: debate.final_verdict.summary,
                    matchup_tactico: 'Ver análisis de agente táctico',
                    factor_psicologico: 'Ver análisis de agente contextual',
                    contexto_competitivo: 'Ver análisis de agente contextual',
                },
                pronosticos: debate.final_verdict.picks,
                patrones_detectados: {
                    goles_por_tiempo: { insight: 'Detectado por agentes' },
                    disciplina: { insight: 'Detectado por agentes' },
                },
                factores_riesgo: judgeOutput?.factores_riesgo || {
                    riesgo_principal: 'Evaluado por Abogado del Diablo',
                    nivel_incertidumbre: debate.final_verdict.overall_confidence >= 80 ? 'BAJO' :
                                          debate.final_verdict.overall_confidence >= 65 ? 'MEDIO' : 'ALTO',
                },
                datos_modelo: {
                    goles_esperados_partido: mathResult.dixon_coles.expected_total_goals,
                    corners_esperados: 9,
                    probabilidad_btts_porcentaje: Math.round(mathResult.ensemble_probabilities.btts_yes * 100),
                    lambda_home: mathResult.dixon_coles.lambdaHome,
                    lambda_away: mathResult.dixon_coles.lambdaAway,
                    elo_home: mathResult.elo.homeElo,
                    elo_away: mathResult.elo.awayElo,
                    model_consistency: mathResult.diagnostics.model_consistency,
                },
                mercados_evaluados: judgeOutput?.mercados_evaluados || {
                    con_valor_detectado: mathResult.value_opportunities.filter((v) => v.recommendation !== 'AVOID' && v.recommendation !== 'NEUTRAL').length,
                    total_analizados: mathResult.value_opportunities.length,
                },
                escenarios_proyectados: {
                    escenario_base: `Resultado más probable: ${mathResult.monte_carlo.stats.median_scoreline}`,
                    escenario_optimista: 'Ver agentes',
                    escenario_alternativo: 'Ver agentes',
                },
                v9_debate: {
                    agents_used: debate.agents.map((a) => ({
                        name: a.agent_name,
                        confidence: a.confidence_overall,
                        provider: a.provider_used,
                        failed: !!a.error,
                    })),
                    consensus: debate.consensus,
                    total_time_ms: debate.total_time_ms,
                },
            };

            console.log(`[V9-HYBRID] Analysis assembled. Picks: ${analysisResult.pronosticos?.length || 0}, verdict: ${analysisResult.resumen_ejecutivo.veredicto}`);
        } else if (USE_STAGED) {
        // ═══ CAPA 1 + 2 EN PARALELO ═══
        console.log(`[V3-AI-ANALYZER] Starting staged analysis (4 layers)...`);

        const layer1Prompt = `
Eres un analista estadístico deportivo de élite. Analiza los datos estadísticos puros de este partido.

PARTIDO: ${homeTeam} (LOCAL) vs ${awayTeam} (VISITANTE)
COMPETICIÓN: ${leagueName}

DATOS ESTADÍSTICOS (resumen):

>>> HISTORIAL ${homeTeam} (LOCAL):
${deepHome.substring(0, 1800)}

>>> HISTORIAL ${awayTeam} (VISITANTE):
${deepAway.substring(0, 1800)}

>>> H2H:
${h2hText.substring(0, 600)}

>>> CUOTAS:
${oddsText.substring(0, 1200)}

INSTRUCCIONES:
1. ABSORCIÓN DE DATOS: Cruza TIROS, ATAJADAS, CORNERS, TARJETAS, MINUTOS DE GOLES.
2. CORRELACIÓN MULTIVARIABLE: Busca patrones Causa-Efecto.
3. CORNERS & BALÓN PARADO: Correlaciona posesión + tiros + despejes.
4. ANÁLISIS DISCIPLINARIO: Faltas promedio + árbitro.
5. ANÁLISIS DE CUOTAS: Para cada mercado, calcula Edge = Prob_Estimada - (100/Cuota).
6. PATRONES TEMPORALES: ¿Goles en 1er o 2do tiempo? ¿Tarjetas tempraneras?

Responde en JSON:
{
  "score_estadistico": <0-100>,
  "insights_estadisticos": "Resumen de hallazgos estadísticos clave (300+ palabras)",
  "analisis_corners": "Análisis de corners con datos",
  "analisis_tarjetas": "Análisis de tarjetas con datos",
  "candidatos_combo": ["mercado1", "mercado2"],
  "patrones_goles": {
    "home_1er_tiempo_pct": <0-100>,
    "home_2do_tiempo_pct": <0-100>,
    "away_1er_tiempo_pct": <0-100>,
    "away_2do_tiempo_pct": <0-100>,
    "insight": "descripción"
  },
  "formacion_rendimiento": {
    "home_formacion_usual": "4-3-3",
    "home_win_pct_con_formacion": <0-100>,
    "away_formacion_usual": "4-4-2",
    "away_win_pct_con_formacion": <0-100>,
    "insight": "descripción"
  },
  "disciplina": {
    "home_avg_tarjetas": <number>,
    "away_avg_tarjetas": <number>,
    "insight": "descripción"
  },
  "datos_modelo": {
    "goles_esperados_partido": <number>,
    "corners_esperados": <number>,
    "probabilidad_btts_porcentaje": <number>
  },
  "mercados_con_valor": [
    { "mercado": "nombre", "prob_estimada": <number>, "cuota": <number>, "edge": <number> }
  ]
}
`;

        const layer2Prompt = `
Eres un estratega de inteligencia deportiva. Tu trabajo es analizar el CONTEXTO que las estadísticas NO pueden capturar.

PARTIDO: ${homeTeam} (LOCAL) vs ${awayTeam} (VISITANTE)
COMPETICIÓN: ${leagueName}

HISTORIAL RECIENTE:
${deepHome.substring(0, 1200)}

${deepAway.substring(0, 1200)}

CONTEXTO EXTERNO:
${(externalContextText || '').substring(0, 1500)}

INSTRUCCIONES — Analiza estos 5 factores:

♟️ B1. ANÁLISIS TÁCTICO: Choque de sistemas, formaciones, quién controla el mediocampo, juego aéreo.
🧠 B2. PSICOLOGÍA DEPORTIVA: Presión, motivación, momentum, factor vestuario, derby.
🏟️ B3. CONTEXTO COMPETITIVO: ¿Qué se juegan? ¿Fase del torneo? ¿Rotaciones esperadas?
🔮 B4. ESCENARIOS: Optimista, base, alternativo — ¿cuál es más probable?
⚡ B5. FACTORES INVISIBLES: Debuts, regresos de lesión, clima, horario.

Responde en JSON:
{
  "score_inteligencia_partido": <0-100>,
  "matchup_tactico": "Análisis detallado del choque táctico (200+ palabras)",
  "factor_psicologico": "Análisis de motivación, presión, mentalidad (150+ palabras)",
  "contexto_competitivo": "Qué se juegan, fase del torneo, rotaciones (100+ palabras)",
  "escenarios": {
    "escenario_optimista": "descripción",
    "escenario_base": "descripción",
    "escenario_alternativo": "descripción"
  },
  "factores_invisibles": "Factores no estadísticos relevantes",
  "contexto_externo_resumen": "Resumen de noticias/contexto externo relevante"
}
`;

        // Helper: wait for Groq rate limit + minimum safety delay between layers
        // Groq gpt-oss-120b: 8000 TPM, rolling window. Each layer consumes ~3-5K tokens.
        // We always wait at least MIN_DELAY between layers to let the rolling window restore.
        const MIN_LAYER_DELAY_SEC = 20;
        let lastLayerCall = 0;
        const waitForGroq = async (estimatedTokens: number, layerName: string) => {
            const sinceLast = Date.now() - lastLayerCall;
            const minDelay = lastLayerCall > 0 ? Math.max(0, MIN_LAYER_DELAY_SEC * 1000 - sinceLast) : 0;
            const apiDelay = calcGroqDelay(estimatedTokens) * 1000;
            const delayMs = Math.max(minDelay, apiDelay);
            if (delayMs > 0) {
                console.log(`[V3-AI-ANALYZER] ${layerName}: Waiting ${Math.round(delayMs/1000)}s (min=${Math.round(minDelay/1000)}s, api=${Math.round(apiDelay/1000)}s) for Groq TPM reset...`);
                await new Promise(r => setTimeout(r, delayMs));
            }
            lastLayerCall = Date.now();
        };

        console.log(`[V3-AI-ANALYZER] Layer 1: Statistical Analysis...`);
        const layerTimeout = Math.min(45000, (remainingMs() - SAVE_RESERVE_MS) / 4);

        // ═══ CAPA 1: SECUENCIAL ═══
        await waitForGroq(4000, 'Layer 1');
        const layer1Result = await callLLM(layer1Prompt, { temperature: 0.3, jsonMode: true, maxTokens: 2048, timeoutMs: layerTimeout })
            .catch(err => { console.error(`[V3-AI-ANALYZER] Layer 1 failed: ${err.message}`); return null; });

        // ═══ CAPA 2: SECUENCIAL (después de Capa 1) ═══
        console.log(`[V3-AI-ANALYZER] Layer 2: Match Intelligence (${Math.round(remainingMs()/1000)}s remaining)...`);
        await waitForGroq(3500, 'Layer 2');
        const layer2Result = await callLLM(layer2Prompt, { temperature: 0.4, jsonMode: true, maxTokens: 2048, timeoutMs: layerTimeout })
            .catch(err => { console.error(`[V3-AI-ANALYZER] Layer 2 failed: ${err.message}`); return null; });

        const layer1Data = layer1Result ? parseStageJSON(layer1Result.text, 'Layer1') : {
            score_estadistico: 50, insights_estadisticos: 'Análisis estadístico no disponible',
            datos_modelo: { goles_esperados_partido: 2.5, corners_esperados: 9, probabilidad_btts_porcentaje: 50 }
        };
        const layer2Data = layer2Result ? parseStageJSON(layer2Result.text, 'Layer2') : {
            score_inteligencia_partido: 50, matchup_tactico: 'Análisis táctico no disponible',
            factor_psicologico: 'No disponible', contexto_competitivo: 'No disponible',
            escenarios: { escenario_optimista: '', escenario_base: '', escenario_alternativo: '' }
        };
        tokensUsed += (layer1Result?.tokensUsed || 0) + (layer2Result?.tokensUsed || 0);
        console.log(`[V3-AI-ANALYZER] Layer 1 (${layer1Result?.provider || 'FAILED'}): score=${layer1Data.score_estadistico} | Layer 2 (${layer2Result?.provider || 'FAILED'}): score=${layer2Data.score_inteligencia_partido}`);

        // ═══ CAPA 3: CAZA DE OPORTUNIDADES ═══
        console.log(`[V3-AI-ANALYZER] Layer 3: Value Hunting (${Math.round(remainingMs()/1000)}s remaining)...`);
        await waitForGroq(4000, 'Layer 3');

        const layer3Prompt = `
Eres un cazador de valor en apuestas deportivas de clase mundial.
Tu misión: encontrar picks con ≥83% de confianza REAL Y cuota ≥ 1.40.

PARTIDO: ${homeTeam} (LOCAL) vs ${awayTeam} (VISITANTE) — ${leagueName}

═══ ESTADÍSTICAS (Score: ${layer1Data.score_estadistico}/100) ═══
${(layer1Data.insights_estadisticos || '').substring(0, 800)}
Modelo: ${JSON.stringify(layer1Data.datos_modelo || {})}
Valor: ${JSON.stringify((layer1Data.mercados_con_valor || []).slice(0, 3))}

═══ CONTEXTO (Score: ${layer2Data.score_inteligencia_partido}/100) ═══
${(layer2Data.matchup_tactico || '').substring(0, 300)}

═══ CUOTAS ═══
${oddsText.substring(0, 1500)}

PROCESO DE BÚSQUEDA (EN ORDEN):
1. PRIMERO busca COMBINADOS — cuotas ≥1.50, más ineficiencias.
2. LUEGO individuales de VALOR: BTTS, corners, handicaps, team totals.
3. FINALMENTE picks estándar con cuota ≥1.40.
4. ÚLTIMO RECURSO: Máximo 1 banker (cuota <1.40, confianza ≥88%).

FORMATOS DE MERCADO OBLIGATORIOS:
- "Resultado 1X2", "Más de X.5 Goles", "Menos de X.5 Goles"
- "Ambos Anotan", "Doble Oportunidad", "Corners Más de X.5"
- "Resultado y Total: [Equipo] & Más de X.5 Goles" (combinados)
- Selección para 1X2: nombre COMPLETO del equipo (nunca abreviaciones)

CONFIANZA FINAL = (Score_Estadístico × 0.50) + (Score_Inteligencia × 0.50)
Máximo 1 pick >90%. Máximo 2 picks >85%.

Responde en JSON:
{
  "pronosticos": [
    {
      "mercado": "formato exacto",
      "seleccion": "selección exacta",
      "probabilidad_calculada_porcentaje": <number>,
      "probabilidad_implicita_porcentaje": <number>,
      "edge_porcentaje": <number>,
      "cuota_actual": <number or null>,
      "confianza": "ALTA" | "MEDIA" | "BAJA",
      "tipo_pick": "combo" | "valor" | "standard" | "banker",
      "justificacion": {
        "estadistica": "dato estadístico clave",
        "contexto_partido": "factor de ESTE partido",
        "tactica": "razón táctica",
        "mercado": "ineficiencia detectada"
      }
    }
  ],
  "mercados_evaluados": {
    "con_valor_detectado": <number>,
    "total_analizados": <number>
  }
}
`;

        const layer3TimeoutMs = Math.min(60000, remainingMs() - SAVE_RESERVE_MS - 25000);
        console.log(`[V3-AI-ANALYZER] Layer 3 prompt size: ${layer3Prompt.length} chars, timeout: ${Math.round(layer3TimeoutMs/1000)}s`);
        const layer3Result = await callLLM(layer3Prompt, {
            temperature: 0.3, jsonMode: true, maxTokens: 3072, timeoutMs: Math.max(layer3TimeoutMs, 20000)
        }).catch(err => {
            console.error(`[V3-AI-ANALYZER] Layer 3 FAILED: ${err.message}`);
            return null;
        });

        if (layer3Result) {
            console.log(`[V3-AI-ANALYZER] Layer 3 raw text (first 300): ${layer3Result.text.substring(0, 300)}`);
        }

        const layer3Data = layer3Result ? parseStageJSON(layer3Result.text, 'Layer3') : {
            pronosticos: [], mercados_evaluados: { con_valor_detectado: 0, total_analizados: 0 }
        };
        tokensUsed += layer3Result?.tokensUsed || 0;
        console.log(`[V3-AI-ANALYZER] Layer 3 (${layer3Result?.provider || 'FAILED'}): ${layer3Data.pronosticos?.length || 0} picks | keys: ${Object.keys(layer3Data).join(',')}`);

        // ═══ CAPA 4: SÍNTESIS Y RESUMEN EJECUTIVO ═══
        console.log(`[V3-AI-ANALYZER] Layer 4: Synthesis (${Math.round(remainingMs()/1000)}s remaining)...`);
        await waitForGroq(3000, 'Layer 4');

        const confianzaFinal = Math.round(
            ((layer1Data.score_estadistico || 50) * 0.5) + ((layer2Data.score_inteligencia_partido || 50) * 0.5)
        );
        const numPicks = layer3Data.pronosticos?.length || 0;
        const veredictoAuto = numPicks > 0 && confianzaFinal >= 75 ? 'APOSTAR' : (confianzaFinal >= 65 ? 'OBSERVAR' : 'NO_BET');

        const layer4Prompt = `
Eres el editor en jefe de Derbix. Sintetiza el análisis completo en un reporte ejecutivo.

PARTIDO: ${homeTeam} vs ${awayTeam} — ${leagueName}

SCORES DUALES:
- Score Estadístico: ${layer1Data.score_estadistico}/100
- Score Inteligencia de Partido: ${layer2Data.score_inteligencia_partido}/100
- Confianza Final: ${confianzaFinal}/100

ESTADÍSTICO: ${(layer1Data.insights_estadisticos || 'N/A').substring(0, 300)}
TÁCTICO: ${(layer2Data.matchup_tactico || 'N/A').substring(0, 250)}
PSICOLÓGICO: ${(layer2Data.factor_psicologico || 'N/A').substring(0, 200)}

PRONÓSTICOS (${numPicks} picks):
${JSON.stringify((layer3Data.pronosticos || []).map((p: any) => ({
  m: p.mercado, s: p.seleccion, prob: p.probabilidad_calculada_porcentaje,
  cuota: p.cuota_actual, edge: p.edge_porcentaje, tipo: p.tipo_pick
})), null, 1).substring(0, 1200)}

Genera el reporte final. El "razonamiento_central" debe ser un texto DETALLADO (mínimo 200 palabras) que conecte datos duros con factores tácticos, psicológicos y competitivos. Usa lenguaje de "shark" profesional.

Responde en JSON:
{
  "resumen_ejecutivo": {
    "titular": "Titular de alto impacto",
    "veredicto": "${veredictoAuto}",
    "confianza_global": "${confianzaFinal >= 82 ? 'ALTA' : (confianzaFinal >= 70 ? 'MEDIA' : 'BAJA')}",
    "picks_principales": ["Pick 1 resumido", "Pick 2 resumido"]
  },
  "analisis_profundo": {
    "razonamiento_central": "TEXTO DETALLADO (200+ palabras)...",
    "matchup_tactico": "Choque de sistemas...",
    "factor_psicologico": "Mentalidad...",
    "contexto_competitivo": "Qué se juegan..."
  },
  "factores_riesgo": {
    "riesgo_principal": "El mayor peligro...",
    "nivel_incertidumbre": "BAJO" | "MEDIO" | "ALTO",
    "factores_que_podrian_romper_la_estadistica": "..."
  }
}
`;

        const layer4TimeoutMs = Math.min(45000, remainingMs() - SAVE_RESERVE_MS);
        const layer4Result = await callLLM(layer4Prompt, {
            temperature: 0.2, jsonMode: true, maxTokens: 2048, timeoutMs: Math.max(layer4TimeoutMs, 15000)
        }).catch(err => {
            console.error(`[V3-AI-ANALYZER] Layer 4 failed: ${err.message}`);
            return null;
        });

        const layer4Data = layer4Result ? parseStageJSON(layer4Result.text, 'Layer4') : {};
        tokensUsed += layer4Result?.tokensUsed || 0;
        console.log(`[V3-AI-ANALYZER] Layer 4 (${layer4Result?.provider || 'FAILED'}): synthesis complete`);

        // ═══ ENSAMBLAR RESULTADO FINAL (combinar las 4 capas) ═══
        analysisResult = {
            meta: { modelo: layer1Result?.model || 'multi-provider', version: ENGINE_VERSION },
            resumen_ejecutivo: layer4Data.resumen_ejecutivo || {
                titular: `Análisis ${homeTeam} vs ${awayTeam}`,
                veredicto: veredictoAuto,
                confianza_global: confianzaFinal >= 82 ? 'ALTA' : (confianzaFinal >= 70 ? 'MEDIA' : 'BAJA'),
                picks_principales: (layer3Data.pronosticos || []).slice(0, 2).map((p: any) => `${p.mercado}: ${p.seleccion}`)
            },
            scores_duales: {
                score_estadistico: layer1Data.score_estadistico || 50,
                score_inteligencia_partido: layer2Data.score_inteligencia_partido || 50,
                confianza_final_calculada: confianzaFinal,
                justificacion_balance: `Pilar A (${layer1Data.score_estadistico}) + Pilar B (${layer2Data.score_inteligencia_partido}) = ${confianzaFinal}`
            },
            analisis_profundo: layer4Data.analisis_profundo || {
                razonamiento_central: layer1Data.insights_estadisticos || 'Análisis no disponible',
                matchup_tactico: layer2Data.matchup_tactico || 'No disponible',
                factor_psicologico: layer2Data.factor_psicologico || 'No disponible',
                contexto_competitivo: layer2Data.contexto_competitivo || 'No disponible'
            },
            pronosticos: layer3Data.pronosticos || [],
            patrones_detectados: {
                goles_por_tiempo: layer1Data.patrones_goles || {},
                formacion_rendimiento: layer1Data.formacion_rendimiento || {},
                disciplina: layer1Data.disciplina || {}
            },
            contexto_externo_resumen: layer2Data.contexto_externo_resumen || '',
            factores_riesgo: layer4Data.factores_riesgo || { riesgo_principal: 'No evaluado', nivel_incertidumbre: 'MEDIO' },
            datos_modelo: layer1Data.datos_modelo || { goles_esperados_partido: 2.5, corners_esperados: 9, probabilidad_btts_porcentaje: 50 },
            mercados_evaluados: layer3Data.mercados_evaluados || { con_valor_detectado: 0, total_analizados: 0 },
            escenarios_proyectados: layer2Data.escenarios || { escenario_optimista: '', escenario_base: '', escenario_alternativo: '' }
        };

        console.log(`[V3-AI-ANALYZER] Staged analysis complete. Total tokens: ${tokensUsed}. Providers used: L1=${layer1Result?.provider || 'FAILED'}, L2=${layer2Result?.provider || 'FAILED'}, L3=${layer3Result?.provider || 'FAILED'}, L4=${layer4Result?.provider || 'FAILED'}`);

        } else {
        // ═══ MODO MONOLÍTICO (FALLBACK) ═══
        console.log(`[V3-AI-ANALYZER] Using monolithic mode (USE_STAGED_ANALYSIS=false)...`);
        const prompt = `
════════════════════════════════════════════════════════════════════════════════
🧠 SISTEMA DERBIX V8 [DUAL INTELLIGENCE + EVENTS + CONTEXT] - MOTOR DE ANÁLISIS DE ÉLITE
Modelo: multi-provider
Fecha Sistema: ${new Date().toISOString().split('T')[0]}
════════════════════════════════════════════════════════════════════════════════

ERES LA MENTE MAESTRA DE DERBIX.
No eres un simple asistente. Eres un estratega deportivo de clase mundial que combina MATEMÁTICAS con INTELIGENCIA DE PARTIDO. Tu objetivo: encontrar ineficiencias en las cuotas que los números solos NO pueden detectar.

⚠️ PRINCIPIO FUNDAMENTAL V6 — LA REGLA DEL 50/50:
Tu análisis se divide en DOS PILARES con IGUAL PESO:

┌─────────────────────────────────┬─────────────────────────────────┐
│  📊 PILAR A: INTELIGENCIA       │  🧠 PILAR B: INTELIGENCIA       │
│     ESTADÍSTICA (50%)           │     DE PARTIDO (50%)           │
│                                 │                                 │
│  Forma reciente, H2H,          │  Contexto competitivo, táctica, │
│  correlaciones, cuotas          │  psicología, escenarios,       │
│                                 │  factores invisibles           │
└─────────────────────────────────┴─────────────────────────────────┘

Los NÚMEROS son solo MITAD de la historia. Un equipo que ganó 5/5 puede
perder si: viene de viaje intercontinental, juega con suplentes porque
tiene final de Copa en 3 días, cambió de DT hace 1 semana, o el rival
tiene paternidad psicológica histórica sobre ellos.

CONSTANTES DE OPERACIÓN:
- PESO_ESTADISTICO = 50%
- PESO_INTELIGENCIA_PARTIDO = 50%
- DEFINICIÓN DE EDGE: (Tu Probabilidad % - Probabilidad Implícita del Mercado %).

SISTEMA DE CUOTAS ESCALONADAS (priorizado por VALOR, no por seguridad):

⭐ PRIORIDAD 1 — Buscar PRIMERO (donde generamos dinero real):
┌──────────────┬──────────────┬──────────────────┬─────────────────────────────────┐
│ 💎 VALOR     │ 1.60+        │ 75%+             │ Alta cuota con ineficiencia      │
│ 🎯 COMBO     │ 1.50+        │ 80%+             │ Mercado combinado               │
│ 📊 ESTÁNDAR  │ 1.40+        │ 78%+             │ Pick con edge claro             │
└──────────────┴──────────────┴──────────────────┴─────────────────────────────────┘

⚠️ PRIORIDAD 2 — Solo como complemento (MÁXIMO 1 por partido):
┌──────────────┬──────────────┬──────────────────┬─────────────────────────────────┐
│ 🔒 BANKER    │ 1.20-1.39    │ 88%+             │ Solo si es EXCEPCIONAL          │
└──────────────┴──────────────┴──────────────────┴─────────────────────────────────┘

📌 REGLA OBLIGATORIA: De tus picks, AL MENOS 3 deben tener cuota ≥ 1.40.
Si no los encuentras, NO estás explorando suficientes mercados (combinados, corners, BTTS, handicaps).
Un BANKER solo se justifica si la confianza es ≥88% Y no encontraste mejor valor en mercados combinados.

REGLAS DE ORO (A CUMPLIR O SERÁS APAGADO):
1. **NO INVENTES DATOS**. Usa SOLO la información proporcionada. Si no hay datos de corners, NO menciones corners.
2. **TEMPORALIDAD ESTRICTA**: Un partido de hace 3 meses NO define la forma actual.
3. **EQUILIBRIO OBLIGATORIO**: Tu razonamiento DEBE contener argumentos de AMBOS pilares. Un análisis puramente estadístico es INCOMPLETO e INACEPTABLE.
4. **LENGUAJE DE SHARK**: Usa términos como "Ineficiencia de mercado", "Valor esperado positivo", "Trampa de las bookies".
5. **JUSTIFICACIÓN DUAL**: No digas "van a ganar porque ganaron 5 de 5". Di "La dominancia estadística (5/5) se refuerza con la urgencia de clasificar + la ventaja táctica del bloque bajo contra el rival ofensivo".

════════════════════════════════════════════════════════════════════════════════
📊 PILAR A: INTELIGENCIA ESTADÍSTICA (50% del análisis)
════════════════════════════════════════════════════════════════════════════════

1. ABSORCIÓN DE DATOS (Deep Ingest):
   - CRÚZALO TODO: TIROS, ATAJADAS, CORNERS, TARJETAS, MINUTOS DE GOLES.
   - Si un equipo gana pero el portero hizo 12 atajadas, fue SUERTE, no dominancia. Eso BAJA tu confianza.
   - "Goal Timings": ¿Marcan siempre en el 2do tiempo? → Valor en "Gol en 2da Mitad".

2. CORRELACIÓN MULTIVARIABLE:
   - Busca patrones "Causa-Efecto".
   - Ej: "Contra defensas de 5 (5-3-2), su promedio de gol baja un 40%".
   - Árbitro + Estilo: Árbitro estricto + Equipos agresivos = Alta prob. Roja.

3. CORNERS & BALÓN PARADO:
   - Corners = f(Tiros a Puerta + Posesión en Campo Rival + Despejes del Rival).
   - Formación con Extremos Abiertos → más corners. Equipo defensivo → concede corners.

4. ANÁLISIS DISCIPLINARIO:
   - Revisá el Árbitro asignado + "Faltas Promedio" de los equipos.
   - Derby/H2H Caliente + Árbitro Tarjetero = Over Tarjetas.

5. ANÁLISIS DE CUOTAS (Value Hunting — PROCESO OBLIGATORIO):
   PASO 1: Escanea primero mercados COMBINADOS (donde hay más ineficiencias de cuota).
   PASO 2: Calcula el edge para cada mercado candidato: Edge = Prob_Derbix - (100/Cuota).
   PASO 3: Si edge > 8% Y cuota ≥ 1.40 → candidato FUERTE. Priorízalo.
   PASO 4: Ordena candidatos por (edge × cuota), NO por probabilidad sola.
           Ejemplo: 83% @ 1.72 (edge 25%, score=43) GANA a 90% @ 1.15 (edge 3%, score=3.5).
   PASO 5: Examina especialmente estos mercados (frecuentemente infraanalizados):
           - Corners de equipo (Over X.5 corners local/visitante)
           - BTTS (Ambos Anotan)
           - Goles del Local/Visitante (team totals)
           - Handicap Asiático
           - Combinados: Resultado + Total, DC + Total, BTTS + Over/Under

Después de analizar el Pilar A, asigna un SCORE ESTADÍSTICO (0-100) a tu nivel 
de confianza basado EXCLUSIVAMENTE en los datos duros.

════════════════════════════════════════════════════════════════════════════════
🧠 PILAR B: INTELIGENCIA DE PARTIDO (50% del análisis)
════════════════════════════════════════════════════════════════════════════════

ESTE PILAR ES TAN IMPORTANTE COMO LOS NÚMEROS. Aquí descubres lo que las
estadísticas NO pueden decirte: el CONTEXTO que hace único a ESTE partido.

♟️ B1. ANÁLISIS TÁCTICO PROFUNDO (Choque de Sistemas):
   - "Mirror Analysis": ¿Cómo le fue vs formaciones similares al rival de hoy?
   - MATCHUP CLAVE: ¿Bandas vs Centro? ¿Posesión vs Contraataque?
     Si el visitante juega a la contra y el local deja espacios atrás → "Ambos Anotan".
   - ¿Quién controla el mediocampo? El equipo que controle el medio suele controlar el partido.
   - ¿Juego Aéreo? Si un equipo centra mucho + el rival es bajo → Ventaja en balón parado.
   - ¿El DT es conservador o agresivo? Esto define si el partido será abierto o cerrado.

🧠 B2. PSICOLOGÍA DEPORTIVA (Temperatura Mental):
   Evalúa la mentalidad de CADA equipo:
   - PRESIÓN: ¿Quién tiene miedo de perder? El miedo paraliza → Under de goles.
   - MOTIVACIÓN: ¿Se juegan algo? ¿Hay "Venganza" por H2H? ¿Efecto "Nuevo DT" (luna de miel)?
   - RELAJACIÓN: ¿Es un partido intrascendente? → Rotaciones, baja intensidad.
   - MOMENTUM: ¿Racha positiva (confianza alta) o racha negativa (caos, presión interna)?
   - FACTOR VESTUARIO: ¿Hay conflictos internos? ¿Traspasos polémicos? ¿Lesión de líder?
   - DERBY/CLÁSICO: Los Derbies rompen TODA estadística. Aquí manda la emoción, 
     no la tabla. Un equipo último puede ganarle al líder en un Derby.

🏟️ B3. CONTEXTO COMPETITIVO (¿QUÉ SE JUEGAN?):
   - ¿Qué TORNEO es? (Liga vs Copa vs Amistoso vs Clasificatoria)
   - ¿Qué FASE? (Inicio de temporada, mitad, definición, eliminatoria)
   - ¿Necesitan puntos URGENTEMENTE? (Zona de descenso, zona de clasificación)
   - ¿El empate les sirve a AMBOS? → "Biscotto" (partido pactado).
   - ¿Tienen otro partido IMPORTANTE en 3-4 días? → Rotaciones probables.
   - ¿Vienen de viaje largo/intercontinental? → Factor Fatiga.

🔮 B4. ESCENARIOS DEL PARTIDO (Proyecciones):
   Construye 3 escenarios:
   - ESCENARIO OPTIMISTA (para el favorito): ¿Cómo luce si todo sale bien?
   - ESCENARIO BASE (lo más probable): ¿Cuál es el desarrollo más realista?
   - ESCENARIO ALTERNATIVO (la sorpresa): ¿Qué podría romper la estadística?
   ¿Cuál de los 3 es MÁS PROBABLE? Usa esto para afinar tu probabilidad.

⚡ B5. FACTORES INVISIBLES (Lo que los números NO dicen):
   - ¿Debutará un jugador clave? ¿Regresa alguien de lesión?  
   - ¿Hay un récord o racha histórica en juego (motivación extra)?
   - ¿Hay factor climático extremo? (Lluvia → equipo físico > equipo técnico)
   - ¿Es un horario inusual? (Partidos a las 12pm vs 9pm cambian intensidad)

Después de analizar el Pilar B, asigna un SCORE DE INTELIGENCIA DE PARTIDO (0-100)
a tu nivel de confianza basado EXCLUSIVAMENTE en el contexto del partido.

════════════════════════════════════════════════════════════════════════════════
⚖️ CÁLCULO DE CONFIANZA FINAL (FÓRMULA DUAL OBLIGATORIA)
════════════════════════════════════════════════════════════════════════════════

CONFIANZA FINAL = (Score Estadístico × 0.50) + (Score Inteligencia Partido × 0.50)

┌──────────┬──────────────────────────────────────────────────────────────────┐
│ 90-95%   │ ÉLITE: SOLO para convergencia EXTREMA de TODOS los factores.    │
│ (ÉLITE)  │ Ambos pilares >85%. Forma impecable + motivación máxima +       │
│          │ táctica ideal + H2H dominante + cuota con edge >15%. RARO.      │
├──────────┼──────────────────────────────────────────────────────────────────┤
│ 82-89%   │ ALTA: Ambos pilares >78%. Evidencia clara y consistente.        │
│ (ALTA)   │ Mínimo 3 de 5 factores alineados (forma, H2H, motivación,      │
│          │ táctica, valor en cuota). Sin riesgos significativos.            │
├──────────┼──────────────────────────────────────────────────────────────────┤
│ 75-81%   │ MEDIA+: Una pata fuerte con la otra aceptable. Edge claro       │
│ (MEDIA+) │ pero con algún factor de riesgo identificado. ESTO ES LO        │
│          │ NORMAL para un buen pick — no fuerces probabilidades más altas. │
├──────────┼──────────────────────────────────────────────────────────────────┤
│ 70-74%   │ MEDIA: Señales mixtas. Edge identificado pero con incertidumbre.│
│ (MEDIA)  │                                                                  │
├──────────┼──────────────────────────────────────────────────────────────────┤
│ <70%     │ BAJA: Contradicciones serias entre pilares → NO_BET recomendado.│
│ (BAJA)   │                                                                  │
└──────────┴──────────────────────────────────────────────────────────────────┘

⚠️ CALIBRACIÓN DE CONFIANZA:
- Asigna la probabilidad que GENUINAMENTE refleje tu análisis. No infles para cumplir umbrales.
- Máximo 1 pick >90% por partido (convergencia ÉLITE real).
- Máximo 2 picks >85% por partido.
- PREGÚNTATE: "¿Apostaría mi propio dinero con esta confianza Y esta cuota?" Si dudas → baja 5-10%.
- El sistema de post-procesamiento matemático ajustará probabilidades según datos reales de rendimiento.
- Para >80%, necesitas AMBOS pilares (stats + contexto). Si se contradicen, REDUCE 10-15%.

${mlCalibration.calibrationText}

═══ ANÁLISIS DE EVENTOS MINUTO A MINUTO (NUEVO V8) ═══

Cada partido del historial incluye EVENTOS DETALLADOS (goles, tarjetas, sustituciones).
EXPLÓTALOS para detectar patrones temporales:

1. PATRONES DE GOLES POR TIEMPO:
   - ¿El equipo marca más en 1er o 2do tiempo? → Valor en mercados de "Gol en 1er/2do Tiempo"
   - Si marca consistentemente antes del min 15 → "Arrancadores rápidos" → valor en "1er Gol: Local/Visitante"
   - Si concede después del min 75 → "Vulnerabilidad tardía" → valor en "Gol en 2do Tiempo"

2. PATRONES DE TARJETAS:
   - ¿Equipos agresivos en primeros 30 min? → Over Tarjetas 1er Tiempo
   - ¿Acumulan faltas? → Árbitro estricto + equipos agresivos = Over Tarjetas

3. PATRONES DE SUSTITUCIONES:
   - ¿DT hace cambios temprano (min 45-60)? → Equipo reactivo
   - ¿Cambios tardíos (min 80+)? → Equipo que gestiona ventaja

4. HALF-TIME ANALYSIS:
   - Usa los scores de 1er tiempo para determinar: ¿Quién domina la primera mitad?
   - Si un equipo gana el 1er tiempo en 7/10 partidos → Valor en "HT Result"

OPORTUNIDADES OCULTAS QUE LOS NÚMEROS NO VEN:
- Un equipo con stats mediocres pero que se está jugando la vida (descenso) puede 
  ser una JOYA OCULTA si las bookies no lo reflejan en la cuota.
- Un equipo en gran forma estadística pero relajado (ya clasificado, sin nada que 
  jugar) es una TRAMPA → busca "Under" o "BTTS No".

════════════════════════════════════════════════════════════════════════════════
🎯 CAZA DE OPORTUNIDADES DE VALOR (MÓDULO DE MÁXIMA PRIORIDAD)
════════════════════════════════════════════════════════════════════════════════

TU MISIÓN PRINCIPAL: Encontrar picks con ≥83% de confianza REAL **Y cuota ≥ 1.40**.
DATO POSITIVO: Cuando asignas 83-85%, tu calibración es EXCELENTE.
La zona 83-85% + cuota 1.50-2.00 es nuestro SWEET SPOT de rentabilidad.

PROCESO DE BÚSQUEDA (seguir EN ORDEN):
1. 🎯 PRIMERO busca COMBINADOS — cuotas naturalmente ≥1.50, más ineficiencias de mercado.
   Pregunta: "¿Puedo combinar dos insights fuertes en un mercado combinado?"
2. 💎 LUEGO busca individuales de VALOR: BTTS, corners, handicaps, goles por equipo, HT/FT.
   Pregunta: "¿Hay mercados especializados con cuota ≥1.40 donde tengo edge?"
3. 📊 FINALMENTE, picks estándar con cuota ≥1.40.
4. ⚠️ ÚLTIMO RECURSO: Solo si no hay nada mejor, máximo 1 pick con cuota <1.40 (tipo BANKER @ 88%+).

CHECKLIST ANTES DE FINALIZAR:
□ ¿Evaluaste mercados combinados? (Resultado+Total, DC+Over, BTTS+Over)
□ ¿Evaluaste corners, handicaps, team totals?
□ ¿Al menos 3 de tus picks tienen cuota ≥1.40?
□ ¿Calculaste edge para cada pick? (Edge = Prob - 100/Cuota)

${mlCalibration.marketPrioritiesText}

NOTA: Si no encuentras un pick que GENUINAMENTE merezca ≥83% con cuota ≥1.40,
reporta el mejor con su confianza REAL. Preferimos MENOS picks de MEJOR calidad.

════════════════════════════════════════════════════════════════════════════════
⚽ MERCADOS DE CORNERS Y TARJETAS — OBLIGATORIO EVALUAR
════════════════════════════════════════════════════════════════════════════════

DEBES analizar explícitamente al menos 2 mercados de corners y 1 de tarjetas en cada partido:

CORNERS (usa datos de corner_stats proporcionados):
- Correlacionar: equipos con alta posesión + muchos tiros = muchos corners
- Correlacionar: equipos defensivos que despejan mucho = corners para el rival
- Si ambos equipos promedian >5 corners cada uno → evaluar "Corners Más de 9.5" y "Corners Más de 10.5"
- Si un equipo domina corners (>6.5 promedio) → evaluar corners individuales del equipo
- Los corners son mercados MUY rentables porque las bookies ponen menos atención en ellos

TARJETAS (usa datos de disciplina):
- Correlacionar: árbitro estricto (>4.5 tarjetas/partido) + derby/rivalidad = Over tarjetas
- Si ambos equipos promedian >2 tarjetas cada uno → evaluar "Tarjetas Más de 4.5"
- Tarjeta roja: solo si hay historial claro del árbitro + partido muy caliente

Si no hay datos suficientes de corners/tarjetas en los datos proporcionados,
indica explícitamente "Sin datos de corners/tarjetas disponibles" y no inventes.

════════════════════════════════════════════════════════════════════════════════
🎯 TÁCTICA DE COMBINADOS — OBLIGATORIO EVALUAR
════════════════════════════════════════════════════════════════════════════════

DEBES evaluar al menos 2 mercados COMBINADOS por partido. Este es un paso OBLIGATORIO.

PROCESO:
1. Toma tu pick individual más fuerte (ej: "Local gana" @ 85%, cuota 1.35).
2. Identifica un segundo insight compatible del mismo análisis (ej: "Más de 1.5 goles" @ 90%).
3. Combina: "Local & Más de 1.5 Goles" → confianza estimada ~83%, cuota estimada ≈ 1.35 × 1.25 × 0.85 ≈ 1.43.
4. Si edge > 10% Y cuota ≥ 1.50 → reportar como tipo "combo".

COMBINACIONES DE ALTO VALOR:
- Resultado + Total: "Equipo & Más de X.5 Goles" — cuotas típicas 1.65-2.20
- DC + Total: "Local o Empate & Más de 1.5 Goles" — cuotas típicas 1.45-1.75
- BTTS + Total: "Ambos Anotan & Más de 2.5" — cuotas típicas 1.80-2.30
- Resultado + BTTS: "Equipo & Ambos Anotan" — cuotas típicas 2.00-3.00

⚠️ VALIDACIÓN: No combines eventos que se contradigan (ej: "Under 1.5" + "Ambos Anotan" es contradictorio).
Ambos componentes deben estar soportados por el análisis.

════════════════════════════════════════════════════════════════════════════════
📋 FORMATO OBLIGATORIO DE MERCADOS (para verificación automática)
════════════════════════════════════════════════════════════════════════════════

Para el campo "mercado" en pronosticos, usa EXACTAMENTE estos formatos:
- "Resultado 1X2" (NO "Ganador del Partido", NO "Victoria Local")
- "Más de X.5 Goles" (NO "Over X.5 Goals", NO "Total Goals Over")
- "Menos de X.5 Goles" (NO "Under X.5")
- "Ambos Anotan" (NO "BTTS", NO "Both Teams Score")
- "Doble Oportunidad" (NO "Double Chance", NO "1X")
- "Corners Más de X.5" (NO "Total Corners Over")
- "Tarjetas Más de X.5" (NO "Total Cards Over")
- "Resultado y Total: [Equipo] & Más de X.5 Goles" (para combinados)
- "Goles del Local Más de X.5" / "Goles del Visitante Más de X.5" (team totals)

Para el campo "seleccion" en pronosticos:
- Para 1X2: nombre COMPLETO del equipo tal como aparece en los datos (NUNCA abreviaciones como PSG, Barça, Real)
- Para Over/Under: "Más de X.5" o "Menos de X.5"
- Para BTTS: "Sí" o "No"
- Para Doble Oportunidad: "Local o Empate" / "Visitante o Empate" / "Local o Visitante"
- Para combinados: "NombreCompleto & Más de X.5 Goles"

════════════════════════════════════════════════════════════════════════════════
🚨 INSTRUCCIONES DE EMERGENCIA Y FALLBACKS
════════════════════════════════════════════════════════════════════════════════

Si faltan datos de cuotas (Bookmaker Odds Missing) para UN MERCADO ESPECÍFICO:
1. Establece "cuota_actual": null en ese pronóstico — NO INVENTES NÚMEROS.
2. El sistema descartará automáticamente los picks sin cuota real, no es tu problema.
3. Prefiere analizar mercados donde SÍ hay cuotas reales en el bloque BOOKMAKER ODDS.

Si NO HAY CUOTAS EN ABSOLUTO para este partido:
1. Establece "veredicto": "NO_BET" en el nivel superior del JSON.
2. Coloca pronosticos: [] (array vacío).
3. Añade "razon_no_bet": "Sin cuotas de mercado disponibles para validar picks".

NUNCA uses campos como cuota_estimada o cuota_referencia — solo cuota_actual (del mercado) o null.

Si faltan alineaciones confirmadas:
1. Asume la más probable basada en los últimos 3 partidos.
2. Aumenta ligeramente el factor de riesgo.

Si no hay NINGUNA estadística ni historial:
1. NO INVENTES DATOS. "veredicto": "NO_BET", "riesgo_principal": "Falta TOTAL de Datos".

════════════════════════════════════════════════════════════════════════════════
DATOS DEL PARTIDO (DEEP DIVE INPUT)
════════════════════════════════════════════════════════════════════════════════

PARTIDO: ${homeTeam} (LOCAL) vs ${awayTeam} (VISITANTE)
COMPETICIÓN: ${leagueName}

⚠️ IMPORTANTE - INTERPRETACIÓN DE DATOS DE HISTORIAL:
Los datos del historial de cada equipo están SEPARADOS en dos secciones:
- "📍 COMO LOCAL": Partidos que el equipo jugó EN SU CASA
- "✈️ COMO VISITANTE": Partidos que el equipo jugó FUERA DE CASA

Para este partido:
- Usa el rendimiento de ${homeTeam} "COMO LOCAL" (juega en casa)
- Usa el rendimiento de ${awayTeam} "COMO VISITANTE" (juega fuera)

Cada partido incluye:
- Resultado desde la perspectiva del equipo analizado
- Stats del equipo + Stats del rival
- Formación usada vs formación del rival

>>> HISTORIAL ${homeTeam} (Equipo LOCAL de este partido):
${deepHome}

>>> HISTORIAL ${awayTeam} (Equipo VISITANTE de este partido):
${deepAway}

>>> ENFRENTAMIENTOS DIRECTOS (H2H):
${h2hText}

>>> CUOTAS DE MERCADO (Referencia):
${oddsText}

${externalContextText}

════════════════════════════════════════════════════════════════════════════════
FORMATO DE SALIDA (JSON)
════════════════════════════════════════════════════════════════════════════════

Responde ÚNICAMENTE con un JSON válido que siga EXACTAMENTE esta estructura:

{
    "meta": { "modelo": "${GEMINI_MODEL}", "version": "${ENGINE_VERSION}" },
    "resumen_ejecutivo": {
        "titular": "Titular de alto impacto (ej: 'Dominancia total del local reforzada por final de temporada')",
        "veredicto": "APOSTAR" | "NO_BET" | "OBSERVAR",
        "confianza_global": "ALTA" | "MEDIA" | "BAJA",
        "picks_principales": ["Pick 1", "Pick 2"]
    },
    "scores_duales": {
        "score_estadistico": 82,
        "score_inteligencia_partido": 78,
        "confianza_final_calculada": 80,
        "justificacion_balance": "Breve explicación de cómo los 2 pilares se combinaron para dar este score."
    },
    "analisis_profundo": {
        "razonamiento_central": "TEXTO DETALLADO (mínimo 200 palabras) explicando LA TESIS DE INVERSIÓN. DEBE incluir argumentos de AMBOS PILARES. Conecta la data dura con el factor táctico, psicológico y competitivo. NO repitas estadísticas obvias, explica el 'POR QUÉ' profundo.",
        "matchup_tactico": "Análisis del choque de sistemas (formaciones, estilos, quién controla el medio).",
        "factor_psicologico": "Análisis detallado de motivación, presión, urgencia, y mentalidad de cada equipo.",
        "contexto_competitivo": "¿Qué se juegan? ¿Fase del torneo? ¿Rotaciones esperadas?"
    },
    "pronosticos": [
        {
            "mercado": "Ej: Resultado y Total: Manchester City & Más de 1.5 Goles",
            "seleccion": "Ej: Manchester City & Más de 1.5 Goles",
            "probabilidad_calculada_porcentaje": 84,
            "probabilidad_implicita_porcentaje": 54,
            "edge_porcentaje": 30,
            "cuota_actual": 1.85,
            "confianza": "ALTA",
            "tipo_pick": "combo",
            "justificacion": {
                "estadistica": "Dato estadístico clave que soporta esta selección...",
                "contexto_partido": "Factor de ESTE partido que refuerza o debilita la selección...",
                "tactica": "Razón táctica específica...",
                "mercado": "Ineficiencia detectada en la cuota..."
            },
            "stake_recomendado": "3% bankroll (basado en confianza y cuota)"
        }
    ],
    "patrones_detectados": {
        "goles_por_tiempo": {
            "home_1er_tiempo_pct": 60,
            "home_2do_tiempo_pct": 40,
            "away_1er_tiempo_pct": 45,
            "away_2do_tiempo_pct": 55,
            "insight": "Local marca mayoritariamente en 1er tiempo, visitante es equipo de 2do tiempo"
        },
        "formacion_rendimiento": {
            "home_formacion_usual": "4-3-3",
            "home_win_pct_con_formacion": 75,
            "away_formacion_usual": "4-4-2",
            "away_win_pct_con_formacion": 40,
            "insight": "Local con 4-3-3 es muy efectivo, visitante con 4-4-2 fuera es débil"
        },
        "disciplina": {
            "home_avg_tarjetas": 2.1,
            "away_avg_tarjetas": 2.5,
            "insight": "Partido con potencial de Over 4.5 Tarjetas"
        }
    },
    "contexto_externo_resumen": "Resumen de 2-3 frases del contexto externo más relevante (noticias, declaraciones, etc.)",
    "factores_riesgo": {
        "riesgo_principal": "El mayor peligro es...",
        "nivel_incertidumbre": "BAJO" | "MEDIO" | "ALTO",
        "factores_que_podrian_romper_la_estadistica": "Qué podría causar una SORPRESA que los números no predicen."
    },
    "datos_modelo": {
        "goles_esperados_partido": 2.8,
        "corners_esperados": 9.5,
        "probabilidad_btts_porcentaje": 60
    },
    "mercados_evaluados": {
        "con_valor_detectado": 2,
        "total_analizados": 60
    },
    "escenarios_proyectados": {
        "escenario_optimista": "Si todo sale bien para el favorito...",
        "escenario_base": "Lo más probable que ocurra...",
        "escenario_alternativo": "La sorpresa posible y por qué podría darse..."
    }
}

RECORDATORIO FINAL: Intenta que la MAYORÍA de pronósticos sean de tipo "combo", "valor" o "standard" con cuota ≥1.40.
Los picks tipo "banker" (cuota <1.40) deben ser MÁXIMO 1 por partido y solo si la confianza es ≥88%.
${strategicInsightsBlock}
`;

        // ═══════════════════════════════════════════════════════════════
        // LLAMAR A LLM (Modo Monolítico — Fallback)
        // ═══════════════════════════════════════════════════════════════
        console.log(`[V3-AI-ANALYZER] Sending monolithic prompt (${prompt.length} chars)...`);

        const monoTimeoutMs = Math.min(90000, remainingMs() - SAVE_RESERVE_MS);
        const monoResult = await callLLM(prompt, {
            temperature: 0.3,
            jsonMode: true,
            maxTokens: 16384,
            timeoutMs: Math.max(monoTimeoutMs, 25000),
        });

        tokensUsed = monoResult.tokensUsed || 0;
        console.log(`[V3-AI-ANALYZER] ${monoResult.provider} responded with ${tokensUsed} tokens`);

        let aiResponseText = monoResult.text || '{}';

        // Clean and parse response
        aiResponseText = aiResponseText.replace(/```json/g, '').replace(/```/g, '').trim();
        const startIndex = aiResponseText.indexOf('{');
        const endIndex = aiResponseText.lastIndexOf('}');
        if (startIndex !== -1 && endIndex > startIndex) {
            aiResponseText = aiResponseText.substring(startIndex, endIndex + 1);
        }

        // JSON truncation repair
        if (monoResult.finishReason === 'length' || monoResult.finishReason === 'MAX_TOKENS') {
            let openBraces = 0, openBrackets = 0;
            let inString = false, escaped = false;
            for (const ch of aiResponseText) {
                if (escaped) { escaped = false; continue; }
                if (ch === '\\') { escaped = true; continue; }
                if (ch === '"') { inString = !inString; continue; }
                if (inString) continue;
                if (ch === '{') openBraces++;
                if (ch === '}') openBraces--;
                if (ch === '[') openBrackets++;
                if (ch === ']') openBrackets--;
            }
            const suffix = ']'.repeat(Math.max(0, openBrackets)) + '}'.repeat(Math.max(0, openBraces));
            if (suffix) {
                aiResponseText += suffix;
                console.log(`[V3-AI-ANALYZER] JSON repair: added ${suffix.length} closing chars`);
            }
        }

        // ═══ PARSING MULTI-INTENTO ═══
        try {
            analysisResult = JSON5.parse(aiResponseText);
        } catch (e1: any) {
            console.warn('[V3-AI-ANALYZER] JSON5 parse failed:', e1.message);
            try {
                analysisResult = JSON.parse(aiResponseText);
            } catch (e2: any) {
                console.warn('[V3-AI-ANALYZER] Native JSON also failed, trying cleanup...');
                try {
                    const cleaned = aiResponseText
                        .replace(/[\x00-\x1F\x7F]/g, ' ')
                        .replace(/,\s*([}\]])/g, '$1');
                    analysisResult = JSON5.parse(cleaned);
                    console.log('[V3-AI-ANALYZER] Parse succeeded after cleanup');
                } catch (e3: any) {
                    console.error('[V3-AI-ANALYZER] All parse strategies failed');
                    analysisResult = {
                        resumen_ejecutivo: { titular: "Análisis completado con datos parciales", veredicto: "OBSERVAR", confianza_global: "BAJA", picks_principales: [] },
                        pronosticos: [],
                        analisis_profundo: { razonamiento_central: aiResponseText.substring(0, 2000) }
                    };
                    const titularMatch = aiResponseText.match(/"titular"\s*:\s*"([^"]+)"/);
                    if (titularMatch) analysisResult.resumen_ejecutivo.titular = titularMatch[1];
                    const veredictoMatch = aiResponseText.match(/"veredicto"\s*:\s*"(APOSTAR|NO_BET|OBSERVAR)"/);
                    if (veredictoMatch) analysisResult.resumen_ejecutivo.veredicto = veredictoMatch[1];
                }
            }
        }

        } // end of monolithic else block

        // ═══════════════════════════════════════════════════════════════
        // ROBUSTNESS LAYER: Normalize AI Response (V5 CRITICAL FIX)
        // ═══════════════════════════════════════════════════════════════
        // Ensure analysisResult has the expected structure even if AI hallucinated or omitted fields

        // 1. Ensure 'resumen_ejecutivo' exists
        if (!analysisResult.resumen_ejecutivo) {
            // Check for legacy/hallucinated 'conclusion_final'
            if (analysisResult.conclusion_final) {
                console.warn('[V3] Normalizing schema: Mapping conclusion_final to resumen_ejecutivo');
                analysisResult.resumen_ejecutivo = {
                    titular: analysisResult.conclusion_final.razon_principal || "Análisis completado",
                    veredicto: analysisResult.conclusion_final.veredicto || "OBSERVAR",
                    confianza_global: analysisResult.conclusion_final.nivel_confianza || "MEDIA",
                    picks_principales: []
                };
            } else {
                // Total failure fallback
                analysisResult.resumen_ejecutivo = {
                    titular: "Análisis completado (Datos insuficientes)",
                    veredicto: "OBSERVAR",
                    confianza_global: "BAJA",
                    picks_principales: []
                };
            }
        }

        // 2. Ensure 'titular' is populated (Critical for Frontend Adapter)
        if (!analysisResult.resumen_ejecutivo.titular) {
            analysisResult.resumen_ejecutivo.titular = analysisResult.resumen_ejecutivo.frase_principal || "Análisis de Inteligencia Finalizado";
        }

        // 3. Ensure 'veredicto' is valid
        if (!['APOSTAR', 'NO_BET', 'OBSERVAR'].includes(analysisResult.resumen_ejecutivo.veredicto)) {
            analysisResult.resumen_ejecutivo.veredicto = 'OBSERVAR';
        }

        // 4. Ensure 'picks_principales' is array
        if (!Array.isArray(analysisResult.resumen_ejecutivo.picks_principales)) {
            analysisResult.resumen_ejecutivo.picks_principales = [];
        }

        // 5. Ensure 'analisis_profundo' exists
        if (!analysisResult.analisis_profundo) {
            analysisResult.analisis_profundo = {};
        }

        // ═══════════════════════════════════════════════════════════════
        // DEEP NORMALIZATION LAYER (GEMINI 2.5 HALLUCINATION FIX)
        // ═══════════════════════════════════════════════════════════════

        // FIX 1: Map 'pronosticos_listado' (Hallucinated) to 'pronosticos' (Standard)
        if (!analysisResult.pronosticos && Array.isArray(analysisResult.pronosticos_listado)) {
            console.warn('[V3] Normalizing: Mapping pronosticos_listado -> pronosticos');
            analysisResult.pronosticos = analysisResult.pronosticos_listado;
        }

        // FIX 2: Map 'probabilidades_derbix' or 'probabilities' to 'pronosticos' if array is empty
        const probSource = analysisResult.probabilidades_derbix || analysisResult.probabilities || analysisResult.probabilidades;
        if ((!analysisResult.pronosticos || analysisResult.pronosticos.length === 0) && probSource) {
            console.warn('[V3] Normalizing: Extracting probabilities from object source:', Object.keys(probSource));
            analysisResult.pronosticos = [];

            // Map known keys to picks
            const mapKeyToPick = (key: string, label: string) => {
                if (probSource[key] !== undefined) {
                    const valStr = String(probSource[key]).replace('%', '');
                    const val = parseFloat(valStr);

                    // Determinar selección basada en key
                    let seleccion = "Sí";
                    if (key.includes('home') || key.includes('local')) seleccion = datasets.home_team || 'Local';
                    if (key.includes('away') || key.includes('visit')) seleccion = datasets.away_team || 'Visita';
                    if (key.includes('draw') || key.includes('empate')) seleccion = "Empate";
                    if (key.includes('over')) seleccion = "Más de 2.5";
                    if (key.includes('under')) seleccion = "Menos de 2.5";

                    if (!isNaN(val) && val > 0) {
                        analysisResult.pronosticos.push({
                            mercado: label,
                            seleccion: seleccion,
                            probabilidad_calculada_porcentaje: val,
                            justificacion: {
                                estadistica: "Alta probabilidad detectada por modelo Derbix.",
                                tactica: "Ineficiencia en cuotas detectada."
                            }
                        });
                    }
                }
            };

            // Intentar todas las variaciones posibles de keys
            const keys = Object.keys(probSource);
            keys.forEach(k => {
                const lowerK = k.toLowerCase();
                if (lowerK.includes('home') || lowerK.includes('local')) mapKeyToPick(k, 'Ganador del Partido (1X2)');
                else if (lowerK.includes('away') || lowerK.includes('visit')) mapKeyToPick(k, 'Ganador del Partido (1X2)');
                else if (lowerK.includes('draw') || lowerK.includes('empate')) mapKeyToPick(k, 'Ganador del Partido (1X2)');
                else if (lowerK.includes('btts') || lowerK.includes('ambos')) mapKeyToPick(k, 'Ambos Equipos Anotan (BTTS)');
                else if (lowerK.includes('over') || lowerK.includes('mas')) mapKeyToPick(k, 'Total de Goles (Over/Under)');
                else if (lowerK.includes('under') || lowerK.includes('menos')) mapKeyToPick(k, 'Total de Goles (Over/Under)');
            });

            // Filtrar solo las mejores para no saturar
            analysisResult.pronosticos = analysisResult.pronosticos.filter((p: any) => p.probabilidad_calculada_porcentaje > 45);
        }

        // 6. Ensure 'pronosticos' exists and is normalized (EXISTING LOGIC)
        if (!Array.isArray(analysisResult.pronosticos)) {
            analysisResult.pronosticos = [];
        } else {
            // NORMALIZE PREDICTIONS (Map synonyms and fix types)
            analysisResult.pronosticos = analysisResult.pronosticos.map((p: any) => {
                const prob = p.probabilidad_calculada_porcentaje
                    || p.probabilidad_estimado_porcentaje
                    || p.probabilidad_derbix
                    || p.probabilidad
                    || p.probability
                    || p.confidence_score
                    || p.confianza
                    || p.probabilidad_estimada
                    || 50;
                const edge = p.edge_porcentaje || p.edge || p.valor || 0;

                // STRICT: only cuota_actual. Other fields (cuota/odds/odd/price) were
                // fallback slots for the old "invent your own odds" flow — now removed.
                const rawOdds = p.cuota_actual ?? null;
                const odds = rawOdds !== null ? (typeof rawOdds === 'string' ? parseFloat(rawOdds) : rawOdds) : null;

                return {
                    ...p,
                    mercado: p.mercado || "Mercado Principal",
                    seleccion: p.seleccion || "Seleccion",
                    probabilidad_calculada_porcentaje: typeof prob === 'string' ? parseFloat(prob.replace('%', '')) : prob,
                    probabilidad_implicita_porcentaje: p.probabilidad_implicita_porcentaje || 50,
                    edge_porcentaje: typeof edge === 'string' ? parseFloat(edge) : edge,
                    cuota_actual: odds && !isNaN(odds) && odds > 1.0 ? odds : null,
                    justificacion: p.justificacion || p.justificacion_detallada || { estadistica: "N/A", tactica: "N/A" }
                };
            });
        }

        // ═══ ML POST-PROCESSING V3: Math-only calibration ═══
        // Gemini assigns raw probabilities freely. This layer applies mathematical
        // corrections based on VERIFIED historical performance data (prob_band dimension).
        // No "double dip" because the prompt no longer instructs Gemini to lower probs.
        // When ML tables are empty → NO-OP (picks pass through unchanged).
        const MIN_SAMPLES_FOR_CORRECTION = 20;
        if (analysisResult.pronosticos && analysisResult.pronosticos.length > 0) {
            const { adjustedPicks, adjustments } = await applyCalibrationPostProcessingV3(
                analysisResult.pronosticos, leagueName, supabase, MIN_SAMPLES_FOR_CORRECTION
            );
            analysisResult.pronosticos = adjustedPicks;
            if (adjustments.length > 0) {
                console.log(`[v3-ai-analyzer] ML V3 applied ${adjustments.length} calibration adjustments:`);
                for (const adj of adjustments) {
                    console.log(`  - ${adj.market}: ${adj.originalProb}% → ${adj.adjustedProb}% [${adj.factorsApplied.join(', ')}]`);
                }
            } else {
                console.log(`[v3-ai-analyzer] ML V3 post-processing: no adjustments needed (${analysisResult.pronosticos.length} picks unchanged)`);
            }
        }

        // SAVE RESULTS
        // ═══════════════════════════════════════════════════════════════
        // NOTE: reports_v2 save moved below after finalFixtureId resolution

        // Map to legacy format for frontend compatibility
        const betPicks = analysisResult.pronosticos || [];
        const tit = analysisResult.resumen_ejecutivo.titular; // Guaranteed to exist now

        const dashboardData = {
            header_partido: {
                titulo: `${homeTeam} vs ${awayTeam}`,
                subtitulo: `${leagueName} • ${match.date_time_utc ? new Date(match.date_time_utc).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }) : 'Próximamente'}`,
                bullets_clave: analysisResult.resumen_ejecutivo.picks_principales || []
            },
            // DEBUG INFO EXPOSED TO FRONTEND/CLIENT
            debug_info: {
                books_found: 1, // Normalized to single view
                best_bookie: 'SportMonks Aggregated',
                markets_count: (odds?.MAIN?.length || 0) + (odds?.GOALS?.length || 0) + (odds?.TEAMS?.length || 0) + (odds?.COMBOS?.length || 0)
            },
            veredicto_analista: {
                decision: analysisResult.resumen_ejecutivo.veredicto || 'OBSERVAR',
                nivel_confianza: analysisResult.resumen_ejecutivo.confianza_global || 'MEDIA',
                probabilidad: betPicks[0]?.probabilidad_calculada_porcentaje || 50,
                titulo_accion: analysisResult.resumen_ejecutivo.veredicto === 'APOSTAR' ? 'OPORTUNIDAD DETECTADA' : 'PARTIDO COMPLEJO',
                razon_principal: tit,
                riesgo_principal: analysisResult.factores_riesgo?.riesgo_principal || 'Sin riesgos críticos',
                seleccion_clave: betPicks[0]?.seleccion || 'N/A'
            },
            resumen_ejecutivo: {
                titular: tit,
                frase_principal: tit, // EXPLICIT for adapter
                puntos_clave: analysisResult.resumen_ejecutivo.picks_principales, // Adapter checks this too
                bullets: [
                    analysisResult.analisis_profundo?.contexto_competitivo,
                    analysisResult.analisis_profundo?.factor_psicologico
                ].filter(Boolean)
            },
            // V6: Expose dual scores for transparency
            scores_duales: analysisResult.scores_duales || null,
            predicciones_finales: {
                titulo: "Pronósticos del Motor IA V3",
                detalle: betPicks.map(normalizePrediction)
            },
            analisis_mercados_calculados: {
                resumen: {
                    goles_esperados: analysisResult.datos_modelo?.goles_esperados_partido || 2.5,
                    corners_esperados: analysisResult.datos_modelo?.corners_esperados || 9,
                    tarjetas_esperadas: 3.5,
                    btts_probabilidad: analysisResult.datos_modelo?.probabilidad_btts_porcentaje || 50
                },
                mercados_con_valor: analysisResult.mercados_evaluados?.con_valor_detectado || betPicks.length,
                top_oportunidades: betPicks.slice(0, 5).map(normalizeOpportunity)
            },
            analisis_detallado: analysisResult.analisis_profundo?.matchup_tactico ? {
                // Adapter logic in frontend looks for 'estilo_y_tactica' or 'analisis_tactico'
                // We map V5 fields to what adapter expects
                contexto_competitivo: analysisResult.analisis_profundo.contexto_competitivo,
                estilo_y_tactica: {
                    titulo: "Análisis Táctico",
                    bullets: [
                        analysisResult.analisis_profundo.matchup_tactico,
                        analysisResult.analisis_profundo.clave_del_partido
                    ].filter(Boolean)
                },
                factor_psicologico: analysisResult.analisis_profundo.factor_psicologico,
                analisis_escenarios: {
                    titulo: "Escenarios de Partido",
                    escenarios: [
                        {
                            nombre: "Escenario Optimista",
                            descripcion: analysisResult.escenarios_proyectados?.escenario_optimista || "Todo sale bien para el favorito.",
                            probabilidad_aproximada: "Media-Alta",
                            implicacion_apuestas: "Pick principal con máximo stake"
                        },
                        {
                            nombre: "Escenario Base",
                            descripcion: analysisResult.escenarios_proyectados?.escenario_base || "Escenario estándar previsto.",
                            probabilidad_aproximada: "Alta",
                            implicacion_apuestas: "Seguir picks principales"
                        },
                        {
                            nombre: "Escenario Alternativo",
                            descripcion: analysisResult.escenarios_proyectados?.escenario_alternativo || "Escenario de riesgo.",
                            probabilidad_aproximada: "Baja",
                            implicacion_apuestas: "Cubrir o reducir stake"
                        }
                    ]
                }
            } : null,
            // V8: New fields from enhanced analysis
            patrones_detectados: analysisResult.patrones_detectados || null,
            contexto_externo_resumen: analysisResult.contexto_externo_resumen || null,
            v3_source: true,
            job_id: job_id,
            generated_at: new Date().toISOString(),
            // payload removed — was causing OOM/502 on large ETL contexts
            payload_summary: {
                has_odds: !!odds,
                has_h2h: !!(datasets.h2h_matches?.length),
                teams: `${homeTeam} vs ${awayTeam}`
            }
        };

        // ═══════════════════════════════════════════════════════════════
        // V9 FIX: RESOLVE finalFixtureId BEFORE saving to ANY table
        // This ensures reports_v2, value_picks_v2, and analisis all use
        // the same fixture_id that matches daily_matches.api_fixture_id
        // ═══════════════════════════════════════════════════════════════

        let finalFixtureId = fixture_id;

        // Helper: Normalize for matching
        const normalizeTeam = (n: string) => n.toLowerCase().replace(/fc|cf|sc|sporting|club|athletic|atletico|real|inter|ac|as/g, '').replace(/[^a-z0-9]/g, '').trim();

        // 1. Try to resolve correct Daily Match ID
        const { data: directMatch } = await supabase
            .from('daily_matches')
            .select('api_fixture_id, id')
            .eq('api_fixture_id', fixture_id)
            .maybeSingle();

        if (directMatch) {
            finalFixtureId = directMatch.api_fixture_id;
        } else {
            console.log(`[V3-FIX] ID ${fixture_id} not found in daily_matches. Attempting fuzzy name match...`);
            const homeNorm = normalizeTeam(homeTeam);
            const awayNorm = normalizeTeam(awayTeam);

            const { data: candidates } = await supabase
                .from('daily_matches')
                .select('api_fixture_id, home_team, away_team, match_date')
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
                    console.log(`[V3-FIX] Resolved ${fixture_id} -> ${best.api_fixture_id} (${best.home_team} vs ${best.away_team})`);
                    finalFixtureId = best.api_fixture_id;
                } else {
                    console.warn(`[V3-FIX] Failed to resolve ID for ${homeTeam} vs ${awayTeam}. Using original.`);
                }
            }
        }

        console.log(`[V3-AI-ANALYZER] Using finalFixtureId=${finalFixtureId} (original=${fixture_id}) for ALL saves`);

        // Sync job fixture_id if it was resolved to a different ID
        if (finalFixtureId !== fixture_id) {
            await supabase
                .from('analysis_jobs_v2')
                .update({ fixture_id: finalFixtureId })
                .eq('id', job_id);
        }

        // Clean up OLD data for this fixture (by both original and resolved IDs)
        // This runs AFTER successful analysis, so old data is only removed when new data is ready
        const idsToClean = [finalFixtureId];
        if (fixture_id !== finalFixtureId) idsToClean.push(fixture_id);

        // Delete old STANDARD jobs (keep current, preserve parlay jobs).
        // V9 FIX: filter by created_at < current job's created_at to avoid deleting jobs
        // that were created AFTER this one (race condition when batch analyzes same
        // fixture twice in parallel).
        const { data: currentJobData, error: currentJobErr } = await supabase
            .from('analysis_jobs_v2')
            .select('created_at')
            .eq('id', job_id)
            .maybeSingle();

        if (currentJobErr || !currentJobData?.created_at) {
            // V9 SAFE: if we can't determine the cutoff, skip cleanup entirely.
            // Stale data in DB is less harmful than a race condition delete.
            console.warn(`[V3-AI-ANALYZER] Cannot determine current job created_at (err=${currentJobErr?.message}, data=${!!currentJobData}). Skipping cleanup.`);
        } else {
            const currentJobCreatedAt = currentJobData.created_at;

            for (const fid of idsToClean) {
                await supabase
                    .from('analysis_jobs_v2')
                    .delete()
                    .eq('fixture_id', fid)
                    .neq('id', job_id)
                    .lt('created_at', currentJobCreatedAt)
                    .or('analysis_type.eq.standard,analysis_type.is.null');
            }

            // Delete old reports: only those created before current job (avoid deleting a
            // concurrent analyzer's fresh report).
            await supabase
                .from('reports_v2')
                .delete()
                .in('fixture_id', idsToClean)
                .lt('created_at', currentJobCreatedAt);
            // Delete any stale reports from this exact job (if previous run wrote partial)
            await supabase.from('reports_v2').delete().eq('job_id', job_id);
        }

        const { error: reportError } = await supabase
            .from('reports_v2')
            .insert({
                job_id: job_id,
                fixture_id: finalFixtureId,
                report_packet: analysisResult,
                prompt_version: 'V3-PROMPT-1.0',
                engine_version: ENGINE_VERSION,  // V9 fix: persist actual engine used
                created_at: new Date().toISOString()
            });

        if (reportError) console.error('[V3-AI-ANALYZER] Error saving reports_v2:', reportError);

        // 2. Insert Picks to value_picks_v2
        if (betPicks.length > 0) {
            console.log(`[V3-FIX] Syncing ${betPicks.length} picks to value_picks_v2 for ID ${finalFixtureId}`);

            // Map confidence string to integer
            const mapConf = (str: string) => {
                if (!str) return 5;
                const s = str.toUpperCase();
                if (s.includes('MUY ALTA')) return 9;
                if (s.includes('ALTA')) return 8;
                if (s.includes('MEDIA')) return 6;
                return 5;
            };

            // Real odds coverage = the ETL successfully pulled odds from a SportMonks bookmaker.
            // This is the source of truth for odds_source — NOT whether the LLM put a number somewhere.
            const hasRealOddsCoverage = !!(payload?.odds?._meta?.bookmaker);
            if (!hasRealOddsCoverage) {
                console.warn(`[V3-FIX] No real odds coverage — all picks will be marked odds_source='unavailable'`);
            }

            const picksPayload = betPicks.map((p: any) => {
                // Aligned probability extraction (same 7 fallback fields as v2-generate-parlays)
                let prob = p.probabilidad_calculada_porcentaje
                    || p.probabilidad_estimado_porcentaje
                    || p.probabilidad_derbix
                    || p.probabilidad
                    || p.probability
                    || p.confidence_score
                    || p.confianza
                    || 50;
                if (typeof prob === 'string') prob = parseFloat(prob.replace('%', ''));
                if (prob > 1) prob = prob / 100;

                // Strict Enum Mapping
                let decision = 'AVOID';
                const d = (p.decision || '').toUpperCase();
                // Basic rules: High prob or explicit BET
                if (d === 'BET' || d === 'APOSTAR' || prob >= 0.70) {
                    decision = 'BET';
                }

                // Only cuota_actual is valid (no fallbacks to inventable fields).
                const rawPickOdds = p.cuota_actual ?? null;
                const pickOdds = rawPickOdds !== null
                    ? (typeof rawPickOdds === 'string' ? parseFloat(rawPickOdds) : rawPickOdds)
                    : null;
                const validPickOdds = typeof pickOdds === 'number' && !isNaN(pickOdds) && pickOdds > 1.0
                    ? pickOdds
                    : null;

                // odds_source: 'real' if ETL got SportMonks odds AND this pick has a numeric cuota_actual.
                // Otherwise 'unavailable' (pick will be discarded by v2-generate-parlays).
                const oddsSource = (hasRealOddsCoverage && validPickOdds !== null) ? 'real' : 'unavailable';

                return {
                    job_id: job_id,
                    fixture_id: finalFixtureId,
                    market: p.mercado || "Mercado General",
                    selection: p.seleccion || "Selección",
                    p_model: prob,
                    decision: decision,
                    confidence: mapConf(p.nivel_confianza || p.confianza),
                    engine_version: ENGINE_VERSION,
                    odds: validPickOdds,
                    odds_source: oddsSource,
                    created_at: new Date().toISOString()
                };
            });

            // Delete old picks for this fixture (both original and resolved IDs).
            // V9 FIX: only delete picks OLDER than current job to avoid deleting concurrent
            // analyzer output. If we could not determine the cutoff (currentJobData was null
            // above), skip deleting picks from other jobs — only delete picks we're about to
            // replace for this specific job_id.
            if (currentJobData?.created_at) {
                await supabase
                    .from('value_picks_v2')
                    .delete()
                    .in('fixture_id', idsToClean)
                    .lt('created_at', currentJobData.created_at);
            }
            // Always clean picks from this exact job (in case of partial previous save)
            await supabase.from('value_picks_v2').delete().eq('job_id', job_id);

            // Insert new
            const { error: pickErr } = await supabase.from('value_picks_v2').insert(picksPayload);
            if (pickErr) console.error(`[V3-FIX] Error inserting picks: ${pickErr.message}`);
            else console.log(`[V3-FIX] Successfully inserted picks.`);
        }

        // 3. Update Sync to 'analisis' using FINAL ID (clean both IDs)
        for (const fid of idsToClean) {
            await supabase.from('analisis').delete().eq('partido_id', fid);
        }

        await supabase
            .from('analisis')
            .insert({
                partido_id: finalFixtureId, // Use corrected ID
                resultado_analisis: { dashboardData }
            });


        // Update job to done
        await supabase
            .from('analysis_jobs_v2')
            .update({
                status: 'done',
                current_motor: 'V3-AI',
                execution_time_ms: Date.now() - startTime
            })
            .eq('id', job_id);

        const executionTime = Date.now() - startTime;
        console.log(`[V3-AI-ANALYZER] ✅ Analysis complete in ${executionTime}ms (${tokensUsed} tokens)`);

        // ═══ SEO PAGE PUBLICATION (awaited but non-blocking on failure) ═══
        try {
            const seoUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/seo-publish-page`;
            const seoRes = await fetch(seoUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
                },
                body: JSON.stringify({ fixture_id: finalFixtureId, job_id })
            });
            if (seoRes.ok) {
                console.log(`[V3-AI-ANALYZER] ✅ SEO page published for fixture ${finalFixtureId}`);
            } else {
                console.warn(`[V3-AI-ANALYZER] SEO publish returned ${seoRes.status}: ${await seoRes.text().catch(() => 'no body')}`);
            }
        } catch (_seoErr) {
            console.error('[V3-AI-ANALYZER] SEO publish failed (non-critical):', _seoErr);
        }

        // ═══ PARLAY ANALYSIS — MOVED TO FRONTEND ═══
        // Parlay analyzer is now triggered by the FRONTEND after confirming 'done' status,
        // with a delay to avoid Gemini API rate limiting. This prevents the parlay call
        // from competing with the next standard analysis in batch mode.

        // LIGHTWEIGHT RESPONSE — frontend reads full data from DB via polling
        // (analisis, reports_v2, value_picks_v2 tables)
        // Removed: analysis + dashboard objects that caused OOM/502 on large payloads
        return new Response(JSON.stringify({
            success: true,
            job_id,
            fixture_id: finalFixtureId,
            summary: {
                veredicto: analysisResult.resumen_ejecutivo.veredicto,
                picks: betPicks.length,
                titular: tit
            },
            tokens_used: tokensUsed,
            execution_time_ms: executionTime,
            engine_version: ENGINE_VERSION
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

    } catch (e: any) {
        console.error('[V3-AI-ANALYZER] Error:', e);

        // CRITICAL FIX: Update job status to 'failed' so it doesn't stay stuck at 'analyzing'
        try {
            const failedJobId = _jobId;
            if (failedJobId) {
                const sbUrl = Deno.env.get('SUPABASE_URL')!;
                const sbKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
                const sbClient = createClient(sbUrl, sbKey);
                await sbClient
                    .from('analysis_jobs_v2')
                    .update({ status: 'failed', error_message: e.message?.substring(0, 500) })
                    .eq('id', failedJobId);
                console.log(`[V3-AI-ANALYZER] Job ${failedJobId} marked as failed`);
            }
        } catch (updateErr) {
            console.error('[V3-AI-ANALYZER] Failed to update job status:', updateErr);
        }

        try {
            return new Response(JSON.stringify({
                success: false,
                error: (e.message || 'Unknown error').substring(0, 500),
                execution_time_ms: Date.now() - startTime
            }), {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        } catch (responseErr) {
            // Ultra-fallback if even JSON.stringify fails
            console.error('[V3-AI-ANALYZER] Error response construction failed:', responseErr);
            return new Response('{"success":false,"error":"Internal server error"}', {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }
    }
});
