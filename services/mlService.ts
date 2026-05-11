// services/mlService.ts
// Frontend service for the ML Strategic Insights system
// Handles: insight pool, strategic insights, training batches, and emergency reset

import { supabase } from './supabaseService';

// ── Types ────────────────────────────────────────────────────────────

export interface StrategicInsight {
    id: string;
    batch_id: string;
    insight_type: 'winning_pattern' | 'losing_pattern' | 'market_insight' | 'league_insight' | 'methodology_insight';
    insight_text: string;
    insight_context: string | null;
    based_on_picks: number;
    based_on_won: number;
    based_on_lost: number;
    confidence_score: number;
    active: boolean;
    created_at: string;
}

export interface TrainingBatch {
    id: string;
    batch_number: number;
    picks_analyzed: number;
    picks_won: number;
    picks_lost: number;
    insights_generated: number;
    status: 'completed' | 'deactivated';
    created_at: string;
}

export interface PoolPick {
    id: string;
    pick_id: string;
    fixture_id: number;
    market: string;
    selection: string;
    p_model: number;
    odds: number | null;
    result: 'WON' | 'LOST';
    league_name: string | null;
    home_team: string | null;
    away_team: string | null;
    match_date: string | null;
    processed_in_batch: string | null;
    created_at: string;
}

export interface StrategicTrainingResult {
    success: boolean;
    batch_number?: number;
    batch_id?: string;
    picks_analyzed?: number;
    picks_won?: number;
    picks_lost?: number;
    insights_generated?: number;
    insights?: { type: string; text: string }[];
    summary?: string;
    model_used?: string;
    elapsed_ms?: number;
    error?: string;
    pool_count?: number;
    min_required?: number;
}

// ── Legacy types (kept for backward compatibility) ───────────────────

export interface TrainingRun {
    id: string;
    training_date: string;
    triggered_by: string | null;
    status: 'completed' | 'rolled_back';
    picks_processed: number;
    picks_won: number;
    picks_lost: number;
    picks_void: number;
    calibration_snapshot: any;
    new_calibration: any;
    created_at: string;
}

export interface CalibrationFactor {
    id: string;
    dimension: string;
    dimension_key: string;
    sample_size: number;
    wins: number;
    losses: number;
    actual_wr: number;
    predicted_avg: number;
    calibration_factor: number;
    confidence_adjustment: number;
    roi: number | null;
    status: 'active' | 'disabled';
    last_updated: string;
}

export interface LearnedPattern {
    id: string;
    pattern_type: 'blacklist' | 'boost' | 'warning' | 'insight';
    scope: string;
    scope_key: string;
    rule_text: string;
    severity: 'critical' | 'warning' | 'info';
    based_on_sample: number;
    based_on_wr: number | null;
    auto_generated: boolean;
    active: boolean;
    created_at: string;
    training_run_id: string | null;
}


export interface DayAuditStatus {
    date: string;
    totalPicks: number;
    pendingPicks: number;
    wonPicks: number;
    lostPicks: number;
    voidPicks: number;
    isFullyVerified: boolean;
    isAlreadyTrained: boolean;
}

export interface PlattMetrics {
    A: number;
    B: number;
    samples: number;
    brier_before: number;
    brier_after: number;
    ece_before: number;
    ece_after: number;
}

export interface TrainingResult {
    success: boolean;
    daysProcessed: number;
    daysSkipped: number;
    totalPicksProcessed: number;
    factorsUpdated: number;
    patternsGenerated: number;
    summary: string;
    error?: string;
    platt?: PlattMetrics;
}

// ══════════════════════════════════════════════════════════════════════
// STRATEGIC INSIGHTS SYSTEM (New)
// ══════════════════════════════════════════════════════════════════════

// ── Insight Pool ────────────────────────────────────────────────────

/** Get count of unprocessed picks in the pool */
export async function getPoolCount(): Promise<{ total: number; won: number; lost: number }> {
    const { data, error } = await supabase
        .from('ml_insight_pick_pool')
        .select('result')
        .is('processed_in_batch', null);

    if (error) {
        console.error('[mlService] Error counting pool:', error);
        return { total: 0, won: 0, lost: 0 };
    }

    const picks = data || [];
    return {
        total: picks.length,
        won: picks.filter(p => p.result === 'WON').length,
        lost: picks.filter(p => p.result === 'LOST').length,
    };
}

/** Get all unprocessed picks in the pool */
export async function getInsightPool(): Promise<PoolPick[]> {
    const { data, error } = await supabase
        .from('ml_insight_pick_pool')
        .select('*')
        .is('processed_in_batch', null)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('[mlService] Error fetching pool:', error);
        return [];
    }
    return data || [];
}

// ── Strategic Insights ──────────────────────────────────────────────

/** Get all strategic insights (active first) */
export async function getStrategicInsights(): Promise<StrategicInsight[]> {
    const { data, error } = await supabase
        .from('ml_strategic_insights')
        .select('*')
        .order('active', { ascending: false })
        .order('confidence_score', { ascending: false });

    if (error) {
        console.error('[mlService] Error fetching insights:', error);
        return [];
    }
    return data || [];
}

/** Toggle individual insight active/inactive */
export async function toggleInsight(insightId: string, active: boolean): Promise<boolean> {
    const { error } = await supabase
        .from('ml_strategic_insights')
        .update({ active })
        .eq('id', insightId);

    if (error) {
        console.error('[mlService] Error toggling insight:', error);
        return false;
    }
    return true;
}

// ── Training Batches ────────────────────────────────────────────────

/** Get batch history */
export async function getBatchHistory(limit = 20): Promise<TrainingBatch[]> {
    const { data, error } = await supabase
        .from('ml_training_batches')
        .select('id, batch_number, picks_analyzed, picks_won, picks_lost, insights_generated, status, created_at')
        .order('batch_number', { ascending: false })
        .limit(limit);

    if (error) {
        console.error('[mlService] Error fetching batches:', error);
        return [];
    }
    return data || [];
}

/** Deactivate a batch (marks all its insights as inactive) */
export async function deactivateBatch(batchId: string): Promise<boolean> {
    // 1. Deactivate all insights from this batch
    const { error: insErr } = await supabase
        .from('ml_strategic_insights')
        .update({ active: false })
        .eq('batch_id', batchId);

    if (insErr) {
        console.error('[mlService] Error deactivating batch insights:', insErr);
        return false;
    }

    // 2. Mark batch as deactivated
    const { error: batchErr } = await supabase
        .from('ml_training_batches')
        .update({ status: 'deactivated' })
        .eq('id', batchId);

    if (batchErr) {
        console.error('[mlService] Error marking batch deactivated:', batchErr);
        return false;
    }
    return true;
}

/** Trigger strategic training (calls ml-strategic-trainer edge function) */
export async function triggerStrategicTraining(): Promise<StrategicTrainingResult> {
    try {
        const { data, error } = await supabase.functions.invoke('ml-strategic-trainer', {
            body: {}
        });

        if (error) {
            console.error('[mlService] Strategic training invocation error:', error);
            return { success: false, error: error.message || 'Error al invocar entrenamiento estratégico' };
        }

        return data as StrategicTrainingResult;
    } catch (err: any) {
        console.error('[mlService] Strategic training error:', err);
        return { success: false, error: err.message || 'Error inesperado' };
    }
}

// ── Emergency Reset ─────────────────────────────────────────────────

/** Reset to Pure Gemini: deactivate ALL insights + turn off toggle */
export async function emergencyReset(): Promise<{ success: boolean; error?: string }> {
    try {
        // 1. Deactivate all insights
        const { error: insErr } = await supabase
            .from('ml_strategic_insights')
            .update({ active: false })
            .neq('active', false); // Only update those that are active

        if (insErr) throw new Error(`Error deactivating insights: ${insErr.message}`);

        // 2. Deactivate all batches
        const { error: batchErr } = await supabase
            .from('ml_training_batches')
            .update({ status: 'deactivated' })
            .eq('status', 'completed');

        if (batchErr) throw new Error(`Error deactivating batches: ${batchErr.message}`);

        // 3. Turn off the toggle
        const { error: settErr } = await supabase
            .from('system_settings')
            .update({ value: false })
            .eq('key', 'ml_strategic_insights_enabled');

        if (settErr) throw new Error(`Error updating toggle: ${settErr.message}`);

        return { success: true };
    } catch (err: any) {
        console.error('[mlService] Emergency reset error:', err);
        return { success: false, error: err.message || 'Error al restablecer' };
    }
}

// ── Strategic System Status ─────────────────────────────────────────

export async function getStrategicSystemStatus(): Promise<{
    insightsEnabled: boolean;
    poolCount: number;
    activeInsights: number;
    totalBatches: number;
    totalPicksTrained: number;
    lastBatchDate: string | null;
}> {
    const [poolResult, insightsResult, batchesResult, settingResult] = await Promise.all([
        supabase.from('ml_insight_pick_pool').select('id', { count: 'exact', head: true }).is('processed_in_batch', null),
        supabase.from('ml_strategic_insights').select('id', { count: 'exact', head: true }).eq('active', true),
        supabase.from('ml_training_batches').select('picks_analyzed, created_at').eq('status', 'completed').order('created_at', { ascending: false }),
        supabase.from('system_settings').select('value').eq('key', 'ml_strategic_insights_enabled').single(),
    ]);

    const batches = batchesResult.data || [];
    const totalPicksTrained = batches.reduce((s, b) => s + (b.picks_analyzed || 0), 0);

    return {
        insightsEnabled: settingResult.data?.value === true,
        poolCount: poolResult.count || 0,
        activeInsights: insightsResult.count || 0,
        totalBatches: batches.length,
        totalPicksTrained,
        lastBatchDate: batches[0]?.created_at || null,
    };
}

// ══════════════════════════════════════════════════════════════════════
// LEGACY ML SYSTEM (kept for backward compatibility)
// ══════════════════════════════════════════════════════════════════════

export async function getDateRangeAuditStatus(startDate: string, endDate: string): Promise<DayAuditStatus[]> {
    const { data: trainedDays } = await supabase
        .from('ml_training_runs')
        .select('training_date, status')
        .gte('training_date', startDate)
        .lte('training_date', endDate)
        .eq('status', 'completed');

    const trainedSet = new Set((trainedDays || []).map(d => d.training_date));

    const { data: matches } = await supabase
        .from('daily_matches')
        .select('api_fixture_id, match_date')
        .gte('match_date', startDate)
        .lte('match_date', endDate);

    const dateFixtures = new Map<string, number[]>();
    for (const m of (matches || [])) {
        if (!dateFixtures.has(m.match_date)) dateFixtures.set(m.match_date, []);
        dateFixtures.get(m.match_date)!.push(m.api_fixture_id);
    }

    const allFixtureIds = (matches || []).map(m => m.api_fixture_id);
    if (allFixtureIds.length === 0) return [];

    const { data: picks } = await supabase
        .from('value_picks_v2')
        .select('fixture_id, result')
        .in('fixture_id', allFixtureIds)
        .gte('p_model', 0.83);

    const fixtureToDate = new Map<number, string>();
    for (const m of (matches || [])) fixtureToDate.set(m.api_fixture_id, m.match_date);

    const dateStats = new Map<string, { total: number; pending: number; won: number; lost: number; void: number }>();
    for (const p of (picks || [])) {
        const date = fixtureToDate.get(p.fixture_id);
        if (!date) continue;
        if (!dateStats.has(date)) dateStats.set(date, { total: 0, pending: 0, won: 0, lost: 0, void: 0 });
        const s = dateStats.get(date)!;
        s.total++;
        if (p.result === 'PENDING') s.pending++;
        else if (p.result === 'WON') s.won++;
        else if (p.result === 'LOST') s.lost++;
        else if (p.result === 'VOID' || p.result === 'PUSH') s.void++;
    }

    const results: DayAuditStatus[] = [];
    for (const [date] of dateFixtures.entries()) {
        const stats = dateStats.get(date) || { total: 0, pending: 0, won: 0, lost: 0, void: 0 };
        results.push({
            date,
            totalPicks: stats.total,
            pendingPicks: stats.pending,
            wonPicks: stats.won,
            lostPicks: stats.lost,
            voidPicks: stats.void,
            isFullyVerified: stats.total > 0 && stats.pending === 0,
            isAlreadyTrained: trainedSet.has(date),
        });
    }

    results.sort((a, b) => a.date.localeCompare(b.date));
    return results;
}

export async function getCalibrationFactors(): Promise<CalibrationFactor[]> {
    const { data, error } = await supabase
        .from('ml_calibration_factors')
        .select('*')
        .eq('status', 'active')
        .order('dimension', { ascending: true })
        .order('sample_size', { ascending: false });
    if (error) return [];
    return data || [];
}

export async function toggleCalibrationFactor(factorId: string, newStatus: 'active' | 'disabled'): Promise<boolean> {
    const { error } = await supabase
        .from('ml_calibration_factors')
        .update({ status: newStatus, last_updated: new Date().toISOString() })
        .eq('id', factorId);
    return !error;
}

export async function getLearnedPatterns(): Promise<LearnedPattern[]> {
    const { data, error } = await supabase
        .from('ml_learned_patterns')
        .select('*')
        .order('created_at', { ascending: false });
    if (error) return [];
    return data || [];
}

export async function togglePattern(patternId: string, active: boolean): Promise<boolean> {
    const { error } = await supabase
        .from('ml_learned_patterns')
        .update({ active })
        .eq('id', patternId);
    return !error;
}

export async function getTrainingHistory(limit = 20): Promise<TrainingRun[]> {
    const { data, error } = await supabase
        .from('ml_training_runs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
    if (error) return [];
    return data || [];
}

export async function triggerTraining(dates: string[]): Promise<TrainingResult> {
    try {
        const { data, error } = await supabase.functions.invoke('ml-train-calibration', {
            body: { dates }
        });
        if (error) return { success: false, daysProcessed: 0, daysSkipped: 0, totalPicksProcessed: 0, factorsUpdated: 0, patternsGenerated: 0, summary: '', error: error.message || 'Error' };
        return data as TrainingResult;
    } catch (err: any) {
        return { success: false, daysProcessed: 0, daysSkipped: 0, totalPicksProcessed: 0, factorsUpdated: 0, patternsGenerated: 0, summary: '', error: err.message || 'Error' };
    }
}

export async function rollbackTraining(trainingRunId: string): Promise<{ success: boolean; error?: string }> {
    try {
        const { data: run, error: fetchErr } = await supabase.from('ml_training_runs').select('*').eq('id', trainingRunId).single();
        if (fetchErr || !run) return { success: false, error: 'Training run no encontrado' };
        if (run.status === 'rolled_back') return { success: false, error: 'Ya fue revertido' };
        const snapshot = run.calibration_snapshot as CalibrationFactor[];
        if (Array.isArray(snapshot) && snapshot.length > 0) {
            for (const factor of snapshot) {
                await supabase.from('ml_calibration_factors').upsert({
                    dimension: factor.dimension, dimension_key: factor.dimension_key,
                    sample_size: factor.sample_size, wins: factor.wins, losses: factor.losses,
                    actual_wr: factor.actual_wr, predicted_avg: factor.predicted_avg,
                    calibration_factor: factor.calibration_factor, confidence_adjustment: factor.confidence_adjustment,
                    roi: factor.roi, status: factor.status, last_updated: new Date().toISOString(),
                }, { onConflict: 'dimension,dimension_key' });
            }
        }
        await supabase.from('ml_learned_patterns').update({ active: false }).eq('training_run_id', trainingRunId);
        await supabase.from('ml_training_runs').update({ status: 'rolled_back' }).eq('id', trainingRunId);
        return { success: true };
    } catch (err: any) {
        return { success: false, error: err.message || 'Error al revertir' };
    }
}

export async function getPlattParameters(): Promise<{ hasPlatt: boolean; A: number; B: number; sampleSize: number } | null> {
    const { data, error } = await supabase.from('ml_calibration_factors')
        .select('calibration_factor, confidence_adjustment, sample_size')
        .eq('dimension', 'platt').eq('dimension_key', 'global').eq('status', 'active').single();
    if (error || !data) return null;
    return { hasPlatt: true, A: data.calibration_factor, B: (data.confidence_adjustment || 0) / 1000, sampleSize: data.sample_size || 0 };
}

export async function getMLSystemStatus(): Promise<{
    isEnabled: boolean;
    totalTrainingRuns: number;
    activeFactors: number;
    activePatterns: number;
    lastTrainingDate: string | null;
    totalPicksTrained: number;
}> {
    const { data: settingData } = await supabase.from('system_settings').select('value').eq('key', 'ml_auto_learning_enabled').single();
    const isEnabled = settingData?.value === true;
    const { count: activeFactors } = await supabase.from('ml_calibration_factors').select('id', { count: 'exact', head: true }).eq('status', 'active');
    const { count: activePatterns } = await supabase.from('ml_learned_patterns').select('id', { count: 'exact', head: true }).eq('active', true);
    const { data: runs } = await supabase.from('ml_training_runs').select('training_date, picks_processed').eq('status', 'completed').order('training_date', { ascending: false });
    return {
        isEnabled,
        totalTrainingRuns: runs?.length || 0,
        activeFactors: activeFactors || 0,
        activePatterns: activePatterns || 0,
        lastTrainingDate: runs?.[0]?.training_date || null,
        totalPicksTrained: (runs || []).reduce((sum, r) => sum + (r.picks_processed || 0), 0),
    };
}
