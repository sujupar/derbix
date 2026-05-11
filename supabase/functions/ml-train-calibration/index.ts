// supabase/functions/ml-train-calibration/index.ts
// ML Calibration Engine V4: Platt Scaling Bidirectional + EMA + Rolling Window
//
// KEY CHANGES from V3:
// 1. Platt Scaling: bidirectional calibration (can INCREASE or DECREASE probabilities)
// 2. EMA blending: new parameters blend gradually (alpha=0.25), one bad day can't destroy calibration
// 3. Rolling window: uses all approved picks from last 60 days for global Platt fit
// 4. Symmetric corrections: per-dimension adjustments go BOTH directions equally
// 5. All dimensions usable: market, league, prob_band — all get real corrections

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from '../_shared/cors.ts'

// ── Configuration ───────────────────────────────────────────────────
const MIN_SAMPLE_SIZE = 10;       // Min picks per dimension to generate a factor
const ROLLING_WINDOW_DAYS = 60;   // Only use picks from last 60 days for Platt fit
const EMA_ALPHA = 0.25;           // How much new data influences (0.25=gradual, 0.5=responsive)
const MIN_PLATT_SAMPLES = 50;     // Min picks for reliable Platt fit
const MAX_CORRECTION_PTS = 8;     // Max ±8pts correction per dimension (was ±12/±15)

// ── Interfaces ──────────────────────────────────────────────────────

interface PickRow {
    id: string;
    fixture_id: number;
    market: string;
    selection: string;
    p_model: number;
    odds: number;
    result: string;
    confidence: number;
    engine_version: string;
}

interface MatchRow {
    api_fixture_id: number;
    league_name: string;
    match_date: string;
}

interface CalibrationFactor {
    dimension: string;
    dimension_key: string;
    sample_size: number;
    wins: number;
    losses: number;
    actual_wr: number;
    predicted_avg: number;
    calibration_factor: number;
    confidence_adjustment: number;
    roi: number;
    status: string;
}

// ── Helpers ─────────────────────────────────────────────────────────

function getOddsRange(odds: number): string {
    if (odds < 1.40) return '<1.40';
    if (odds < 1.70) return '1.40-1.69';
    if (odds < 2.00) return '1.70-1.99';
    if (odds < 2.50) return '2.00-2.49';
    return '2.50+';
}

function getProbBand(pModel: number): string {
    const pct = pModel > 1 ? pModel : pModel * 100;
    if (pct < 80) return '<80%';
    if (pct < 83) return '80-82%';
    if (pct < 86) return '83-85%';
    if (pct < 90) return '86-89%';
    return '90%+';
}

function calculateROI(won: number, lost: number, avgOdds: number): number {
    if (won + lost === 0) return 0;
    const stakePerPick = 4;
    const totalStaked = (won + lost) * stakePerPick;
    const totalProfit = (won * stakePerPick * (avgOdds - 1)) - (lost * stakePerPick);
    return totalStaked > 0 ? (totalProfit / totalStaked) * 100 : 0;
}

// ── Platt Scaling ───────────────────────────────────────────────────
// Standard ML technique for probability calibration (Platt 1999)
// Fits: p_calibrated = 1 / (1 + exp(A * logit(p_raw) + B))
// Bidirectional: can INCREASE or DECREASE probabilities depending on the data

function fitPlattScaling(data: { prob: number; won: boolean }[]): { A: number; B: number; converged: boolean } {
    if (data.length < 10) return { A: 1, B: 0, converged: false };

    const epsilon = 1e-7;
    // Convert probabilities to logits
    const f = data.map(d => {
        const p = Math.max(epsilon, Math.min(1 - epsilon, d.prob));
        return Math.log(p / (1 - p));
    });

    const nPos = data.filter(d => d.won).length;
    const nNeg = data.length - nPos;
    if (nPos === 0 || nNeg === 0) return { A: 1, B: 0, converged: false };

    // Smoothed targets (Platt's recommendation to avoid overfitting)
    const tPos = (nPos + 1) / (nPos + 2);
    const tNeg = 1 / (nNeg + 2);
    const t = data.map(d => d.won ? tPos : tNeg);

    // Newton-Raphson optimization
    let A = 0;
    let B = Math.log((nNeg + 1) / (nPos + 1));
    let converged = false;

    for (let iter = 0; iter < 100; iter++) {
        let dA = 0, dB = 0;
        let d2A = 0, d2B = 0, d2AB = 0;

        for (let i = 0; i < data.length; i++) {
            const fApB = A * f[i] + B;
            // Numerical stability: clamp exponent
            const expVal = Math.exp(Math.max(-50, Math.min(50, fApB)));
            const p = 1 / (1 + expVal);
            const d = t[i] - p;
            const pq = p * (1 - p) + epsilon;

            dA += f[i] * d;
            dB += d;
            d2A += f[i] * f[i] * pq;
            d2B += pq;
            d2AB += f[i] * pq;
        }

        const det = d2A * d2B - d2AB * d2AB;
        if (Math.abs(det) < 1e-10) break;

        const deltaA = -(d2B * dA - d2AB * dB) / det;
        const deltaB = -(d2A * dB - d2AB * dA) / det;

        A += deltaA;
        B += deltaB;

        if (Math.abs(deltaA) < 1e-7 && Math.abs(deltaB) < 1e-7) {
            converged = true;
            break;
        }
    }

    // Safety caps: prevent extreme transformations
    A = Math.max(0.3, Math.min(3.0, A));
    B = Math.max(-3.0, Math.min(3.0, B));

    return { A, B, converged };
}

function applyPlattScale(probPct: number, A: number, B: number): number {
    const epsilon = 1e-7;
    const prob = Math.max(epsilon, Math.min(1 - epsilon, probPct / 100));
    const logit = Math.log(prob / (1 - prob));
    const expVal = Math.exp(Math.max(-50, Math.min(50, A * logit + B)));
    const calibrated = 1 / (1 + expVal);
    return Math.max(1, Math.min(99, calibrated * 100));
}

// ── Calibration Metrics ─────────────────────────────────────────────

function computeBrierScore(data: { prob: number; won: boolean }[]): number {
    if (data.length === 0) return 1;
    const sum = data.reduce((acc, d) => {
        const p = d.prob;
        const y = d.won ? 1 : 0;
        return acc + (p - y) ** 2;
    }, 0);
    return sum / data.length;
}

function computeECE(data: { prob: number; won: boolean }[], nBins: number = 5): number {
    if (data.length === 0) return 1;
    const bins: { probs: number[]; outcomes: number[] }[] = Array.from({ length: nBins }, () => ({ probs: [], outcomes: [] }));

    for (const d of data) {
        const binIdx = Math.min(nBins - 1, Math.floor(d.prob * nBins));
        bins[binIdx].probs.push(d.prob);
        bins[binIdx].outcomes.push(d.won ? 1 : 0);
    }

    let ece = 0;
    for (const bin of bins) {
        if (bin.probs.length === 0) continue;
        const avgProb = bin.probs.reduce((a, b) => a + b, 0) / bin.probs.length;
        const avgOutcome = bin.outcomes.reduce((a, b) => a + b, 0) / bin.outcomes.length;
        ece += (bin.probs.length / data.length) * Math.abs(avgOutcome - avgProb);
    }
    return ece;
}

// ── Pattern Generator ───────────────────────────────────────────────

interface GeneratedPattern {
    pattern_type: string;
    scope: string;
    scope_key: string;
    rule_text: string;
    severity: string;
    based_on_sample: number;
    based_on_wr: number;
}

function generatePatterns(
    dimension: string,
    key: string,
    wr: number,
    sample: number,
    predictedAvg: number
): GeneratedPattern[] {
    const patterns: GeneratedPattern[] = [];
    if (sample < MIN_SAMPLE_SIZE) return patterns;

    const scope = dimension === 'market_league' ? 'market_league' : dimension;
    const gap = predictedAvg - wr;

    // Blacklist: WR < 25% AND sample >= 15
    if (wr < 25 && sample >= 15) {
        patterns.push({
            pattern_type: 'blacklist',
            scope, scope_key: key,
            rule_text: `Rendimiento históricamente bajo en ${key}: ${wr.toFixed(1)}% WR en ${sample} picks.`,
            severity: 'critical', based_on_sample: sample, based_on_wr: wr,
        });
    }
    // Boost: WR > 75% AND sample >= 10
    else if (wr > 75 && sample >= 10) {
        patterns.push({
            pattern_type: 'boost',
            scope, scope_key: key,
            rule_text: `Buen historial en ${key}: ${wr.toFixed(1)}% WR en ${sample} picks.`,
            severity: 'info', based_on_sample: sample, based_on_wr: wr,
        });
    }
    // Warning: overconfidence gap > 25 points
    if (gap > 25 && sample >= 10) {
        patterns.push({
            pattern_type: 'warning',
            scope, scope_key: key,
            rule_text: `Calibración: predicho ${predictedAvg.toFixed(1)}% pero real ${wr.toFixed(1)}% (gap ${gap.toFixed(1)}pts, ${sample} picks).`,
            severity: 'warning', based_on_sample: sample, based_on_wr: wr,
        });
    }
    // NEW: Insight for underconfidence (model is BETTER than predicted)
    if (gap < -10 && sample >= 10) {
        patterns.push({
            pattern_type: 'insight',
            scope, scope_key: key,
            rule_text: `Subconfianza en ${key}: predicho ${predictedAvg.toFixed(1)}% pero real ${wr.toFixed(1)}% (+${Math.abs(gap).toFixed(1)}pts, ${sample} picks). El modelo es mejor de lo que cree.`,
            severity: 'info', based_on_sample: sample, based_on_wr: wr,
        });
    }

    return patterns;
}

// ── Main Handler ────────────────────────────────────────────────────

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const { dates } = await req.json();

        if (!Array.isArray(dates) || dates.length === 0) {
            throw new Error('dates is required: array of YYYY-MM-DD strings');
        }

        const sbUrl = Deno.env.get('SUPABASE_URL')!;
        const sbKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(sbUrl, sbKey);

        console.log(`[ml-train-calibration] V4 Processing ${dates.length} date(s): ${dates.join(', ')}`);

        // ═══ STEP 1: Filter out already-trained dates ═══
        const { data: existingRuns } = await supabase
            .from('ml_training_runs')
            .select('training_date')
            .in('training_date', dates)
            .eq('status', 'completed');

        const trainedDates = new Set((existingRuns || []).map(r => r.training_date));
        const newDates = dates.filter(d => !trainedDates.has(d));

        console.log(`[ml-train-calibration] ${trainedDates.size} already trained, ${newDates.length} to process`);

        if (newDates.length === 0) {
            return new Response(JSON.stringify({
                success: true, daysProcessed: 0, daysSkipped: dates.length,
                totalPicksProcessed: 0, factorsUpdated: 0, patternsGenerated: 0,
                summary: 'Todos los dias seleccionados ya fueron entrenados previamente.',
            }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // ═══ STEP 2: Get fixtures for selected dates ═══
        const { data: matches } = await supabase
            .from('daily_matches')
            .select('api_fixture_id, league_name, match_date')
            .in('match_date', newDates);

        const matchMap = new Map<number, MatchRow>();
        const dateFixtures = new Map<string, number[]>();
        for (const m of (matches || [])) {
            matchMap.set(m.api_fixture_id, m);
            if (!dateFixtures.has(m.match_date)) dateFixtures.set(m.match_date, []);
            dateFixtures.get(m.match_date)!.push(m.api_fixture_id);
        }

        const allFixtureIds = Array.from(matchMap.keys());
        if (allFixtureIds.length === 0) {
            return new Response(JSON.stringify({
                success: true, daysProcessed: 0, daysSkipped: dates.length,
                totalPicksProcessed: 0, factorsUpdated: 0, patternsGenerated: 0,
                summary: 'No se encontraron partidos en las fechas seleccionadas.',
            }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // ═══ STEP 3: Get ALL picks for these fixtures ═══
        const { data: picks } = await supabase
            .from('value_picks_v2')
            .select('id, fixture_id, market, selection, p_model, odds, result, confidence, engine_version')
            .in('fixture_id', allFixtureIds);

        // ═══ STEP 4: Validate — every date must have 0 PENDING picks ═══
        const validDates: string[] = [];
        const skippedDates: string[] = [];

        for (const date of newDates) {
            const fixtureIdsForDate = dateFixtures.get(date) || [];
            if (fixtureIdsForDate.length === 0) { skippedDates.push(date); continue; }

            const picksForDate = (picks || []).filter(p => fixtureIdsForDate.includes(p.fixture_id));
            const pendingCount = picksForDate.filter(p => p.result === 'PENDING' && p.p_model != null && p.p_model >= 0.83).length;

            if (pendingCount > 0) {
                console.log(`[ml-train-calibration] SKIPPING ${date}: ${pendingCount} PENDING picks`);
                skippedDates.push(date);
                continue;
            }

            if (picksForDate.length === 0) { skippedDates.push(date); continue; }
            validDates.push(date);
        }

        console.log(`[ml-train-calibration] Valid dates: ${validDates.length}, Skipped: ${skippedDates.length}`);

        if (validDates.length === 0) {
            return new Response(JSON.stringify({
                success: false, daysProcessed: 0, daysSkipped: dates.length,
                totalPicksProcessed: 0, factorsUpdated: 0, patternsGenerated: 0,
                summary: 'Ninguna fecha tiene todos los picks verificados.',
                error: 'Hay picks PENDING sin verificar en las fechas seleccionadas.',
            }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // ═══ STEP 5: Collect valid picks for PER-DIMENSION training ═══
        const validFixtureIds = new Set<number>();
        for (const date of validDates) {
            for (const fid of (dateFixtures.get(date) || [])) validFixtureIds.add(fid);
        }

        const trainingPicks = (picks || []).filter(p =>
            validFixtureIds.has(p.fixture_id) &&
            (p.result === 'WON' || p.result === 'LOST') &&
            p.p_model != null && p.p_model >= 0.83 && p.odds != null
        ) as PickRow[];

        console.log(`[ml-train-calibration] Per-dimension training: ${trainingPicks.length} picks (≥83%)`);

        // ═══ STEP 5.5 NEW: Rolling window for PLATT SCALING ═══
        // Get all admin-approved dates from the last 60 days
        const windowStart = new Date();
        windowStart.setDate(windowStart.getDate() - ROLLING_WINDOW_DAYS);
        const windowStartStr = windowStart.toISOString().split('T')[0];

        const { data: trainedInWindow } = await supabase
            .from('ml_training_runs')
            .select('training_date')
            .gte('training_date', windowStartStr)
            .eq('status', 'completed');

        const allWindowDates = new Set([
            ...(trainedInWindow || []).map((r: any) => r.training_date),
            ...validDates
        ]);

        // Get fixtures for entire rolling window
        const { data: windowMatches } = await supabase
            .from('daily_matches')
            .select('api_fixture_id, league_name, match_date')
            .in('match_date', Array.from(allWindowDates));

        const windowFixtureIds = (windowMatches || []).map((m: any) => m.api_fixture_id);

        // Get ALL verified picks in rolling window (including < 83% for Platt)
        let plattPicks: { prob: number; won: boolean }[] = [];

        if (windowFixtureIds.length > 0) {
            const { data: windowPicks } = await supabase
                .from('value_picks_v2')
                .select('p_model, result')
                .in('fixture_id', windowFixtureIds)
                .in('result', ['WON', 'LOST'])
                .not('p_model', 'is', null);

            plattPicks = (windowPicks || []).filter((p: any) => {
                const prob = p.p_model > 1 ? p.p_model / 100 : p.p_model;
                return prob >= 0.50 && prob <= 0.99;
            }).map((p: any) => ({
                prob: p.p_model > 1 ? p.p_model / 100 : p.p_model,
                won: p.result === 'WON',
            }));
        }

        console.log(`[ml-train-calibration] Rolling window: ${allWindowDates.size} dates, ${plattPicks.length} picks for Platt`);

        // ═══ STEP 6: Snapshot existing calibration factors ═══
        const { data: existingFactors } = await supabase
            .from('ml_calibration_factors')
            .select('*');

        const existingMap = new Map<string, any>();
        for (const f of (existingFactors || [])) {
            existingMap.set(`${f.dimension}|${f.dimension_key}`, f);
        }

        const calibrationSnapshot = existingFactors || [];

        // ═══ STEP 7: Aggregate by dimensions (current batch) ═══
        interface DimStats { wins: number; losses: number; totalPredicted: number; totalOdds: number; }
        const dimensionAggs = new Map<string, DimStats>();

        function addToDim(dimKey: string, pick: PickRow) {
            if (!dimensionAggs.has(dimKey)) dimensionAggs.set(dimKey, { wins: 0, losses: 0, totalPredicted: 0, totalOdds: 0 });
            const d = dimensionAggs.get(dimKey)!;
            if (pick.result === 'WON') d.wins++; else d.losses++;
            d.totalPredicted += (pick.p_model > 1 ? pick.p_model : pick.p_model * 100);
            d.totalOdds += pick.odds;
        }

        for (const p of trainingPicks) {
            const match = matchMap.get(p.fixture_id);
            const league = match?.league_name || 'Desconocida';
            const market = p.market || 'unknown';
            addToDim(`market|${market}`, p);
            addToDim(`league|${league}`, p);
            addToDim(`odds_range|${getOddsRange(p.odds)}`, p);
            addToDim(`prob_band|${getProbBand(p.p_model)}`, p);
            addToDim(`market_league|${market}|${league}`, p);
        }

        // ═══ STEP 8: Compute calibration factors with EMA + SYMMETRIC corrections ═══
        const newFactors: CalibrationFactor[] = [];
        const allPatterns: GeneratedPattern[] = [];

        for (const [dimKey, stats] of dimensionAggs.entries()) {
            const [dimension, ...keyParts] = dimKey.split('|');
            const dimensionKey = keyParts.join('|');
            const total = stats.wins + stats.losses;

            if (total < MIN_SAMPLE_SIZE) continue;

            const batchWR = (stats.wins / total) * 100;
            const batchPredAvg = stats.totalPredicted / total;
            const batchAvgOdds = stats.totalOdds / total;

            // Check existing factor for EMA blending
            const existingKey = `${dimension}|${dimensionKey}`;
            const existing = existingMap.get(existingKey);

            let finalWR: number;
            let finalPredAvg: number;
            let finalSample: number;
            let finalWins: number;
            let finalLosses: number;

            if (existing && existing.sample_size > 0) {
                // EMA blending: new data gets 25% weight, old data 75%
                finalWR = EMA_ALPHA * batchWR + (1 - EMA_ALPHA) * existing.actual_wr;
                finalPredAvg = EMA_ALPHA * batchPredAvg + (1 - EMA_ALPHA) * existing.predicted_avg;
                finalSample = existing.sample_size + total;
                finalWins = existing.wins + stats.wins;
                finalLosses = existing.losses + stats.losses;
            } else {
                finalWR = batchWR;
                finalPredAvg = batchPredAvg;
                finalSample = total;
                finalWins = stats.wins;
                finalLosses = stats.losses;
            }

            // Calibration factor: WR / predicted (bidirectional, can be >1 or <1)
            let calibFactor = finalPredAvg > 0 ? finalWR / finalPredAvg : 1.0;
            calibFactor = Math.max(0.5, Math.min(1.5, calibFactor));

            // SYMMETRIC confidence adjustment (V4: same formula in BOTH directions)
            const gap = finalPredAvg - finalWR; // positive = overconfident, negative = underconfident
            let confAdj = 0;
            const absGap = Math.abs(gap);
            if (absGap > 5) {
                const sign = gap > 0 ? -1 : 1; // overconfident → reduce, underconfident → INCREASE
                if (absGap > 20) confAdj = sign * Math.min(MAX_CORRECTION_PTS, Math.round(absGap * 0.4));
                else if (absGap > 10) confAdj = sign * Math.min(MAX_CORRECTION_PTS, Math.round(absGap * 0.35));
                else confAdj = sign * Math.round(absGap * 0.3);

                // Apply EMA to confidence_adjustment too
                if (existing && existing.confidence_adjustment !== undefined) {
                    confAdj = Math.round(EMA_ALPHA * confAdj + (1 - EMA_ALPHA) * existing.confidence_adjustment);
                }
            }

            const finalROI = calculateROI(finalWins, finalLosses, batchAvgOdds);

            newFactors.push({
                dimension, dimension_key: dimensionKey,
                sample_size: finalSample, wins: finalWins, losses: finalLosses,
                actual_wr: Math.round(finalWR * 100) / 100,
                predicted_avg: Math.round(finalPredAvg * 100) / 100,
                calibration_factor: Math.round(calibFactor * 10000) / 10000,
                confidence_adjustment: confAdj,
                roi: Math.round(finalROI * 100) / 100,
                status: 'active',
            });

            const patterns = generatePatterns(dimension, dimensionKey, finalWR, finalSample, finalPredAvg);
            allPatterns.push(...patterns);
        }

        // ═══ STEP 8.5 NEW: Fit global Platt Scaling ═══
        let plattA = 1.0, plattB = 0.0;
        let plattConverged = false;
        let brierBefore = -1, brierAfter = -1;
        let eceBefore = -1, eceAfter = -1;

        if (plattPicks.length >= MIN_PLATT_SAMPLES) {
            // Compute metrics BEFORE calibration
            brierBefore = computeBrierScore(plattPicks);
            eceBefore = computeECE(plattPicks);

            // Fit Platt Scaling
            const plattResult = fitPlattScaling(plattPicks);
            plattA = plattResult.A;
            plattB = plattResult.B;
            plattConverged = plattResult.converged;

            // Compute metrics AFTER calibration (simulated)
            const calibratedPicks = plattPicks.map(p => ({
                prob: applyPlattScale(p.prob * 100, plattA, plattB) / 100,
                won: p.won,
            }));
            brierAfter = computeBrierScore(calibratedPicks);
            eceAfter = computeECE(calibratedPicks);

            // Example transformations for logging
            const examples = [70, 75, 80, 83, 85, 88, 90].map(p => ({
                raw: p,
                calibrated: Math.round(applyPlattScale(p, plattA, plattB) * 10) / 10,
            }));

            console.log(`[ml-train-calibration] Platt Scaling: A=${plattA.toFixed(4)}, B=${plattB.toFixed(4)}, converged=${plattConverged}`);
            console.log(`[ml-train-calibration] Metrics: Brier ${brierBefore.toFixed(4)} → ${brierAfter.toFixed(4)}, ECE ${eceBefore.toFixed(4)} → ${eceAfter.toFixed(4)}`);
            console.log(`[ml-train-calibration] Transformations: ${examples.map(e => `${e.raw}%→${e.calibrated}%`).join(', ')}`);

            // EMA blend with existing Platt parameters
            const existingPlatt = existingMap.get('platt|global');
            if (existingPlatt && existingPlatt.sample_size > 0) {
                const oldA = existingPlatt.calibration_factor;
                const oldB = existingPlatt.confidence_adjustment / 1000;
                plattA = EMA_ALPHA * plattA + (1 - EMA_ALPHA) * oldA;
                plattB = EMA_ALPHA * plattB + (1 - EMA_ALPHA) * oldB;
                console.log(`[ml-train-calibration] Platt EMA blend: A=${plattA.toFixed(4)}, B=${plattB.toFixed(4)}`);
            }

            // Store Platt parameters as a special dimension row
            // calibration_factor = A, confidence_adjustment = B × 1000 (to fit INTEGER column)
            newFactors.push({
                dimension: 'platt',
                dimension_key: 'global',
                sample_size: plattPicks.length,
                wins: plattPicks.filter(p => p.won).length,
                losses: plattPicks.filter(p => !p.won).length,
                actual_wr: Math.round((plattPicks.filter(p => p.won).length / plattPicks.length) * 10000) / 100,
                predicted_avg: Math.round((plattPicks.reduce((s, p) => s + p.prob, 0) / plattPicks.length) * 10000) / 100,
                calibration_factor: Math.round(plattA * 10000) / 10000,
                confidence_adjustment: Math.round(plattB * 1000), // B stored as integer × 1000
                roi: 0,
                status: 'active',
            });
        } else {
            console.log(`[ml-train-calibration] Platt: Insufficient data (${plattPicks.length}/${MIN_PLATT_SAMPLES} needed). NO-OP.`);
        }

        // ═══ STEP 9: Upsert calibration factors ═══
        let factorsUpdated = 0;
        for (const f of newFactors) {
            const { error } = await supabase
                .from('ml_calibration_factors')
                .upsert({
                    dimension: f.dimension,
                    dimension_key: f.dimension_key,
                    sample_size: f.sample_size,
                    wins: f.wins,
                    losses: f.losses,
                    actual_wr: f.actual_wr,
                    predicted_avg: f.predicted_avg,
                    calibration_factor: f.calibration_factor,
                    confidence_adjustment: f.confidence_adjustment,
                    roi: f.roi,
                    status: f.status,
                    last_updated: new Date().toISOString(),
                }, { onConflict: 'dimension,dimension_key' });

            if (!error) factorsUpdated++;
            else console.error(`[ml-train-calibration] Error upserting ${f.dimension}|${f.dimension_key}:`, error);
        }

        // ═══ STEP 11: Save training runs ═══
        const totalWon = trainingPicks.filter(p => p.result === 'WON').length;
        const totalLost = trainingPicks.filter(p => p.result === 'LOST').length;
        const voidPicks = (picks || []).filter(p =>
            validFixtureIds.has(p.fixture_id) && (p.result === 'VOID' || p.result === 'PUSH')
        ).length;

        for (const date of validDates) {
            const fixtureIdsForDate = new Set(dateFixtures.get(date) || []);
            const dayPicks = trainingPicks.filter(p => fixtureIdsForDate.has(p.fixture_id));
            const dayVoid = (picks || []).filter(p =>
                fixtureIdsForDate.has(p.fixture_id) && (p.result === 'VOID' || p.result === 'PUSH')
            ).length;

            await supabase.from('ml_training_runs').insert({
                training_date: date,
                picks_processed: dayPicks.length,
                picks_won: dayPicks.filter(p => p.result === 'WON').length,
                picks_lost: dayPicks.filter(p => p.result === 'LOST').length,
                picks_void: dayVoid,
                calibration_snapshot: calibrationSnapshot,
                new_calibration: newFactors,
            });
        }

        // ═══ STEP 12: Save learned patterns ═══
        let patternsGenerated = 0;
        const { data: latestRun } = await supabase
            .from('ml_training_runs')
            .select('id')
            .in('training_date', validDates)
            .order('created_at', { ascending: false })
            .limit(1);

        const trainingRunId = latestRun?.[0]?.id || null;

        for (const pattern of allPatterns) {
            const { data: existing } = await supabase
                .from('ml_learned_patterns')
                .select('id')
                .eq('scope', pattern.scope)
                .eq('scope_key', pattern.scope_key)
                .eq('pattern_type', pattern.pattern_type)
                .limit(1);

            if (existing && existing.length > 0) {
                await supabase.from('ml_learned_patterns').update({
                    rule_text: pattern.rule_text, severity: pattern.severity,
                    based_on_sample: pattern.based_on_sample, based_on_wr: pattern.based_on_wr,
                    training_run_id: trainingRunId,
                }).eq('id', existing[0].id);
            } else {
                await supabase.from('ml_learned_patterns').insert({
                    ...pattern, auto_generated: true, active: true, training_run_id: trainingRunId,
                });
            }
            patternsGenerated++;
        }

        // ═══ Summary ═══
        const plattInfo = plattPicks.length >= MIN_PLATT_SAMPLES
            ? `Platt Scaling: A=${plattA.toFixed(3)}, B=${plattB.toFixed(3)} (${plattPicks.length} picks, Brier ${brierBefore.toFixed(3)}→${brierAfter.toFixed(3)}).`
            : `Platt Scaling: datos insuficientes (${plattPicks.length}/${MIN_PLATT_SAMPLES}).`;

        const summary = [
            `V4 Entrenamiento: ${validDates.length} dia(s) procesado(s).`,
            `${trainingPicks.length} picks analizados (${totalWon}W / ${totalLost}L / ${voidPicks}V).`,
            `${factorsUpdated} factores actualizados (EMA α=${EMA_ALPHA}).`,
            `${patternsGenerated} patrones.`,
            plattInfo,
            skippedDates.length > 0 ? `${skippedDates.length} dia(s) omitido(s).` : '',
        ].filter(Boolean).join(' ');

        console.log(`[ml-train-calibration] ${summary}`);

        return new Response(JSON.stringify({
            success: true,
            daysProcessed: validDates.length,
            daysSkipped: skippedDates.length,
            totalPicksProcessed: trainingPicks.length,
            factorsUpdated,
            patternsGenerated,
            platt: {
                A: Math.round(plattA * 10000) / 10000,
                B: Math.round(plattB * 10000) / 10000,
                samples: plattPicks.length,
                converged: plattConverged,
                brier_before: Math.round(brierBefore * 10000) / 10000,
                brier_after: Math.round(brierAfter * 10000) / 10000,
                ece_before: Math.round(eceBefore * 10000) / 10000,
                ece_after: Math.round(eceAfter * 10000) / 10000,
            },
            summary,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    } catch (error: any) {
        console.error('[ml-train-calibration] Error:', error);
        return new Response(JSON.stringify({
            success: false, daysProcessed: 0, daysSkipped: 0,
            totalPicksProcessed: 0, factorsUpdated: 0, patternsGenerated: 0,
            summary: '', error: error.message,
        }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
});
