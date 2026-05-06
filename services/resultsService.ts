// services/resultsService.ts
// Frontend service for fetching verification results and analytics data

import { supabase } from './supabaseService';
import type { PublicResultsData, ParlayResultData, AdvancedAnalyticsData, AdvancedAnalyticsFilters, PickResult, PlanPerformanceSummary, PerPlanComparisonData } from '../types';
import type { PlanTier } from '../utils/planAccessUtils';
import { PLAN_TIERS, PLAN_DISPLAY_NAMES, PLAN_PREDICTIONS_PERCENTAGES, getAllowedPickCount } from '../utils/planAccessUtils';
import { DEFAULT_STAKING_CONFIG, getStakeUnits, getStakeAmount, getEffectiveOdds, calculateProfitLoss, calculateUnitProfit, calculateMaxDrawdown, normalizePModel, getFilterStakingLabel } from './stakingService';
import { OPPORTUNITIES_THRESHOLD } from '../constants/opportunities';

// Fecha de inicio del sistema de verificación
const SYSTEM_START_DATE = '2026-02-17';
// Fecha de inicio del sistema de parlays
const PARLAY_START_DATE = '2026-02-25';

/**
 * Get fixture IDs for a date range using daily_matches by match_date.
 * Single source of truth — no analysis_jobs_v2 fallback (removed due to timezone bugs).
 */
async function getFixtureIdsForDateRange(startDate: string, endDate: string): Promise<{
    fixtureIds: number[];
    matchMap: Map<number, any>;
}> {
    // 1. Daily matches by match_date
    const { data: dateMatches, error: matchError } = await supabase
        .from('daily_matches')
        .select('api_fixture_id, home_team, away_team, league_name, match_date')
        .gte('match_date', startDate)
        .lte('match_date', endDate);

    if (matchError) {
        console.error('[ResultsService] Error fetching daily_matches:', matchError);
        throw matchError;
    }

    const matchMap = new Map<number, any>();
    const fixtureIds: number[] = [];
    (dateMatches || []).forEach(m => {
        matchMap.set(m.api_fixture_id, m);
        fixtureIds.push(m.api_fixture_id);
    });

    // NOTE: analysis_jobs_v2 fallback was REMOVED.
    // It had timezone bugs (+05:00 instead of -05:00 for Bogotá) that caused
    // fixture IDs from other dates to contaminate results.
    // daily_matches.match_date is the single source of truth.

    return { fixtureIds, matchMap };
}

/**
 * Get public results data for the Resultados tab (accessible to all users)
 * Uses dual date source (daily_matches + analysis_jobs_v2) to match Oportunidades
 * @param filter - 'all' shows picks + parlays, 'picks' only picks, 'parlays' only parlays
 */
export async function getPublicResults(startDate: string, endDate: string, filter: 'all' | 'picks' | 'parlays' = 'all'): Promise<PublicResultsData> {
    // Step 1: Get fixture IDs using dual source (daily_matches + analysis_jobs_v2)
    const { fixtureIds: fixtureIdsInRange, matchMap } = await getFixtureIdsForDateRange(startDate, endDate);

    if (fixtureIdsInRange.length === 0) {
        // No matches in date range — still show cumulative bankroll
        const baseBankroll = await fetchBaseBankroll();
        const { totalProfit } = await calculateProfitFromPicks(baseBankroll, SYSTEM_START_DATE, new Date().toISOString().split('T')[0]);
        return emptyResults(baseBankroll, baseBankroll + totalProfit, totalProfit);
    }

    // Step 2: Get verified picks — ONLY persisted opportunities with real (or legacy NULL) odds
    const { data: picks, error } = await supabase
        .from('value_picks_v2')
        .select('id, fixture_id, market, selection, p_model, odds, result, verified_at, actual_score')
        .in('result', ['WON', 'LOST'])
        .eq('is_opportunity', true)
        .or('odds_source.eq.real,odds_source.is.null')
        .in('fixture_id', fixtureIdsInRange)
        .order('verified_at', { ascending: false });

    if (error) {
        console.error('[ResultsService] Error fetching results:', error);
        throw error;
    }

    // Step 2.5: Count PENDING picks — ONLY persisted opportunities with real (or legacy NULL) odds
    const { count: pendingCount } = await supabase
        .from('value_picks_v2')
        .select('id', { count: 'exact', head: true })
        .in('fixture_id', fixtureIdsInRange)
        .eq('is_opportunity', true)
        .or('odds_source.eq.real,odds_source.is.null')
        .eq('result', 'PENDING');

    const results = picks || [];
    const won = results.filter(p => p.result === 'WON');
    const lost = results.filter(p => p.result === 'LOST');

    // Last 7 days stats (always calculated globally, not just for the selected period)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysStr = sevenDaysAgo.toISOString().split('T')[0];
    const todayStr = new Date().toISOString().split('T')[0];

    const { fixtureIds: last7FixtureIds } = await getFixtureIdsForDateRange(sevenDaysStr, todayStr);
    const last7 = last7FixtureIds.length > 0
        ? results.filter(p => last7FixtureIds.includes(p.fixture_id))
        : [];
    const last7Wins = last7.filter(p => p.result === 'WON').length;
    const last7Losses = last7.filter(p => p.result === 'LOST').length;

    // Current streak (from all recent results, not just this period)
    let streakType: 'win' | 'loss' = 'win';
    let streakCount = 0;
    for (const pick of results) {
        if (streakCount === 0) {
            streakType = pick.result === 'WON' ? 'win' : 'loss';
            streakCount = 1;
        } else if ((pick.result === 'WON' && streakType === 'win') || (pick.result === 'LOST' && streakType === 'loss')) {
            streakCount++;
        } else {
            break;
        }
    }

    // Enrich with team names + match_date + profit/loss per pick (proportional staking)
    const baseBankroll = await fetchBaseBankroll();
    const config = DEFAULT_STAKING_CONFIG;

    const recentResults = results.map(p => {
        const match = matchMap.get(p.fixture_id);
        const units = getStakeUnits(config, 'single', p.p_model);
        const stake = getStakeAmount(baseBankroll, units, config);
        const effectiveOdds = getEffectiveOdds(p.odds, p.p_model);
        const profitLoss = calculateProfitLoss(p.result, stake, effectiveOdds);
        return {
            id: p.id,
            home_team: match?.home_team || 'Equipo A',
            away_team: match?.away_team || 'Equipo B',
            market: p.market,
            selection: p.selection,
            result: p.result as PickResult,
            odds: p.odds,
            p_model: p.p_model,
            actual_score: p.actual_score,
            verified_at: p.verified_at,
            league: match?.league_name,
            match_date: match?.match_date,
            profit_loss: profitLoss,
            units,
        };
    });

    const totalVerified = won.length + lost.length;

    // Bankroll — calculado desde value_picks_v2 (misma fuente de verdad que Analítica)
    // baseBankroll ya fue obtenido arriba para calcular stakeAmount
    const { totalProfit: cumulativeProfit, totalUnitsProfit: cumUnitsProfit, totalUnitsStaked: cumUnitsStaked } = await calculateProfitFromPicks(baseBankroll, SYSTEM_START_DATE, new Date().toISOString().split('T')[0]);
    const { totalProfit: periodProfit, totalStaked: periodStaked, totalUnitsProfit: periodUnitsProfit, totalUnitsStaked: periodUnitsStaked } = await calculateProfitFromPicks(baseBankroll, startDate, endDate);

    // Fetch parlay results if filter includes parlays
    let parlaysData: PublicResultsData['parlays'] = undefined;
    if (filter === 'all' || filter === 'parlays') {
        parlaysData = await getParlayResults(startDate, endDate, baseBankroll);
    }

    // Combined bankroll includes parlay profit when showing 'all'
    const parlaysCumulativeProfit = filter !== 'picks'
        ? (await getParlayProfit(baseBankroll, PARLAY_START_DATE, new Date().toISOString().split('T')[0]))
        : 0;
    const combinedCumulativeProfit = cumulativeProfit + parlaysCumulativeProfit;

    // Professional metrics: streaks, avg odds, max drawdown
    let bestStreak = 0;
    let worstStreak = 0;
    let currentRun = 0;
    let lastResult: string | null = null;
    let oddsSum = 0;
    let oddsCount = 0;
    const bankrollHistory: number[] = [baseBankroll];
    let runningBankroll = baseBankroll;

    // Process all results chronologically (reverse since they come desc)
    const chronological = [...results].reverse();
    for (const pick of chronological) {
        const pUnits = getStakeUnits(config, 'single', pick.p_model);
        const pStake = getStakeAmount(baseBankroll, pUnits, config);
        const pOdds = getEffectiveOdds(pick.odds, pick.p_model);
        const pPnl = calculateProfitLoss(pick.result, pStake, pOdds);
        runningBankroll += pPnl;
        bankrollHistory.push(runningBankroll);

        if (pick.odds && pick.odds > 1) { oddsSum += pick.odds; oddsCount++; }

        if (pick.result === lastResult) {
            currentRun++;
        } else {
            currentRun = 1;
            lastResult = pick.result;
        }
        if (pick.result === 'WON' && currentRun > bestStreak) bestStreak = currentRun;
        if (pick.result === 'LOST' && currentRun > worstStreak) worstStreak = currentRun;
    }

    const maxDrawdown = calculateMaxDrawdown(bankrollHistory);
    const avgOdds = oddsCount > 0 ? Math.round((oddsSum / oddsCount) * 100) / 100 : 0;

    return {
        winRate: totalVerified > 0 ? (won.length / totalVerified) * 100 : 0,
        totalVerified,
        totalPending: pendingCount || 0,
        won: won.length,
        lost: lost.length,
        last7Days: { wins: last7Wins, losses: last7Losses, total: last7.length },
        currentStreak: { type: streakType, count: streakCount },
        recentResults,
        bankroll: {
            base: baseBankroll,
            current: baseBankroll + combinedCumulativeProfit,
            profit: combinedCumulativeProfit,
            roi: baseBankroll > 0 ? (combinedCumulativeProfit / baseBankroll) * 100 : 0,
            periodProfit: periodProfit + (parlaysData?.periodProfit ?? 0),
            periodROI: baseBankroll > 0 ? ((periodProfit + (parlaysData?.periodProfit ?? 0)) / baseBankroll) * 100 : 0,
            periodStaked: periodStaked + (parlaysData?.periodStaked ?? 0),
        },
        units: {
            totalUnitsStaked: cumUnitsStaked,
            totalUnitsProfit: cumUnitsProfit,
            yield: cumUnitsStaked > 0 ? (cumUnitsProfit / cumUnitsStaked) * 100 : 0,
            periodUnitsStaked: periodUnitsStaked,
            periodUnitsProfit: periodUnitsProfit,
            periodYield: periodUnitsStaked > 0 ? (periodUnitsProfit / periodUnitsStaked) * 100 : 0,
        },
        maxDrawdown,
        bestStreak,
        worstStreak,
        avgOdds,
        parlays: parlaysData,
    };
}

async function fetchBaseBankroll(): Promise<number> {
    const { data } = await supabase
        .from('system_settings')
        .select('value')
        .eq('key', 'display_bankroll')
        .maybeSingle();
    return data?.value || 100;
}

/**
 * Get parlay results for the Resultados tab
 * Queries parlay_combos_v2 directly (source of truth for parlays)
 */
async function getParlayResults(startDate: string, endDate: string, baseBankroll: number): Promise<{
    totalVerified: number;
    totalPending: number;
    won: number;
    lost: number;
    winRate: number;
    periodProfit: number;
    periodStaked: number;
    recentResults: ParlayResultData[];
}> {
    // Get verified parlays in date range
    const { data: verifiedParlays } = await supabase
        .from('parlay_combos_v2')
        .select('id, date, picks, combined_odds, combined_probability, risk_tier, status, verified_at')
        .gte('date', startDate)
        .lte('date', endDate)
        .in('status', ['won', 'lost'])
        .order('verified_at', { ascending: false });

    // Count pending
    const { count: pendingCount } = await supabase
        .from('parlay_combos_v2')
        .select('id', { count: 'exact', head: true })
        .gte('date', startDate)
        .lte('date', endDate)
        .eq('status', 'pending');

    const parlays = verifiedParlays || [];
    const wonParlays = parlays.filter(p => p.status === 'won');
    const lostParlays = parlays.filter(p => p.status === 'lost');

    // Financial calc: proportional staking by leg count
    const config = DEFAULT_STAKING_CONFIG;
    let periodProfit = 0;
    let periodStaked = 0;

    const recentResults: ParlayResultData[] = parlays.map(p => {
        const legCount = (p.picks as any[] || []).length;
        const units = getStakeUnits(config, 'parlay', undefined, legCount);
        const stakeAmount = getStakeAmount(baseBankroll, units, config);
        periodStaked += stakeAmount;
        const profitLoss = p.status === 'won'
            ? stakeAmount * ((p.combined_odds || 1) - 1)
            : -stakeAmount;
        periodProfit += profitLoss;

        return {
            id: p.id,
            date: p.date,
            picks: (p.picks as any[] || []).map((leg: any) => ({
                fixture_id: leg.fixture_id || 0,
                market: leg.market || '',
                selection: leg.selection || '',
                odds: leg.odds || 0,
                home_team: leg.home_team || '',
                away_team: leg.away_team || '',
                result: (leg.result || 'PENDING') as PickResult,
            })),
            combined_odds: p.combined_odds || 0,
            risk_tier: p.risk_tier || 'balanced',
            status: (p.status || 'PENDING').toUpperCase() as PickResult,
            profit_loss: profitLoss,
            verified_at: p.verified_at,
        };
    });

    const totalVerified = wonParlays.length + lostParlays.length;

    return {
        totalVerified,
        totalPending: pendingCount || 0,
        won: wonParlays.length,
        lost: lostParlays.length,
        winRate: totalVerified > 0 ? (wonParlays.length / totalVerified) * 100 : 0,
        periodProfit,
        periodStaked,
        recentResults,
    };
}

/**
 * Calculate cumulative parlay profit for bankroll tracking
 */
async function getParlayProfit(baseBankroll: number, startDate: string, endDate: string): Promise<number> {
    const { data: parlays } = await supabase
        .from('parlay_combos_v2')
        .select('combined_odds, status, picks')
        .gte('date', startDate)
        .lte('date', endDate)
        .in('status', ['won', 'lost']);

    const config = DEFAULT_STAKING_CONFIG;
    let totalProfit = 0;

    for (const p of (parlays || [])) {
        const legCount = (p.picks as any[] || []).length;
        const units = getStakeUnits(config, 'parlay', undefined, legCount);
        const stakeAmount = getStakeAmount(baseBankroll, units, config);
        totalProfit += p.status === 'won'
            ? stakeAmount * ((p.combined_odds || 1) - 1)
            : -stakeAmount;
    }

    return totalProfit;
}

/**
 * Calculate profit from value_picks_v2 using proportional staking.
 * This is the single source of truth for financial calculations,
 * used by BOTH Resultados and Analítica Avanzada.
 * Uses dual date source (daily_matches + analysis_jobs_v2) to match Oportunidades.
 */
async function calculateProfitFromPicks(baseBankroll: number, startDate: string, endDate: string) {
    // Get fixture IDs using dual source
    const { fixtureIds } = await getFixtureIdsForDateRange(startDate, endDate);
    if (fixtureIds.length === 0) return { totalProfit: 0, totalStaked: 0, totalUnitsProfit: 0, totalUnitsStaked: 0 };

    // Get verified Oportunidades — ONLY persisted opportunities with real (or legacy NULL) odds
    const { data: picks } = await supabase
        .from('value_picks_v2')
        .select('result, odds, p_model')
        .in('fixture_id', fixtureIds)
        .eq('is_opportunity', true)
        .or('odds_source.eq.real,odds_source.is.null')
        .in('result', ['WON', 'LOST']);

    const config = DEFAULT_STAKING_CONFIG;
    let totalProfit = 0;
    let totalStaked = 0;
    let totalUnitsProfit = 0;
    let totalUnitsStaked = 0;

    for (const pick of (picks || [])) {
        const units = getStakeUnits(config, 'single', pick.p_model);
        const stake = getStakeAmount(baseBankroll, units, config);
        const effectiveOdds = getEffectiveOdds(pick.odds, pick.p_model);
        totalStaked += stake;
        totalUnitsStaked += units;
        totalProfit += calculateProfitLoss(pick.result, stake, effectiveOdds);
        totalUnitsProfit += calculateUnitProfit(pick.result, units, effectiveOdds);
    }

    return { totalProfit, totalStaked, totalUnitsProfit, totalUnitsStaked };
}

function emptyResults(baseBankroll: number, current: number, profit: number): PublicResultsData {
    return {
        winRate: 0,
        totalVerified: 0,
        totalPending: 0,
        won: 0,
        lost: 0,
        last7Days: { wins: 0, losses: 0, total: 0 },
        currentStreak: { type: 'win', count: 0 },
        recentResults: [],
        bankroll: {
            base: baseBankroll,
            current,
            profit,
            roi: baseBankroll > 0 ? (profit / baseBankroll) * 100 : 0,
            periodProfit: 0,
            periodROI: 0,
            periodStaked: 0,
        },
    };
}

/**
 * Get/set display bankroll (admin only)
 */
export async function getDisplayBankroll(): Promise<number> {
    const { data } = await supabase
        .from('system_settings')
        .select('value')
        .eq('key', 'display_bankroll')
        .maybeSingle();
    return data?.value || 100;
}

export async function setDisplayBankroll(amount: number): Promise<void> {
    await supabase
        .from('system_settings')
        .update({ value: amount, updated_at: new Date().toISOString() })
        .eq('key', 'display_bankroll');
}

/**
 * Manual override: Admin sets a pick as WON or LOST
 *
 * The pickId from HighProbPicks can be:
 * - A real UUID from value_picks_v2
 * - A composite ID like "jobId_market_selection" (from reports_v2 source)
 * - A composite ID like "vp_jobId_market_selection" (from value_picks source)
 * - A composite ID like "analisis_fixtureId_market_selection" (from analisis source)
 *
 * This function resolves the pick regardless of ID format, creates it in
 * value_picks_v2 if it doesn't exist, and updates profitability_tracking.
 */
export async function manualOverridePick(
    pickId: string,
    newResult: 'WON' | 'LOST' | 'VOID',
    pickMeta?: { fixture_id: number; market: string; selection: string; p_model: number; odds: number | null; job_id?: string }
): Promise<void> {
    const now = new Date().toISOString();

    // Step 1: Try to find the pick in value_picks_v2
    let pick: any = null;

    // 1A: Try direct UUID lookup
    const { data: directPick } = await supabase
        .from('value_picks_v2')
        .select('id, fixture_id, market, selection, p_model, odds, result, job_id')
        .eq('id', pickId)
        .maybeSingle();

    if (directPick) {
        pick = directPick;
    }

    // 1B: If not found by UUID, try by fixture_id + market + selection from metadata
    if (!pick && pickMeta) {
        const { data: metaPick } = await supabase
            .from('value_picks_v2')
            .select('id, fixture_id, market, selection, p_model, odds, result, job_id')
            .eq('fixture_id', pickMeta.fixture_id)
            .eq('market', pickMeta.market)
            .eq('selection', pickMeta.selection)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (metaPick) {
            pick = metaPick;
        }
    }

    // 1C: If STILL not found, create the pick in value_picks_v2
    if (!pick && pickMeta) {
        const prob = pickMeta.p_model > 1 ? pickMeta.p_model / 100 : pickMeta.p_model;
        const insertPayload = {
            job_id: pickMeta.job_id || null,
            fixture_id: pickMeta.fixture_id,
            market: pickMeta.market,
            selection: pickMeta.selection,
            p_model: prob,
            odds: pickMeta.odds,
            decision: 'BET',
            confidence: 8,
            engine_version: 'MANUAL',
            result: newResult,
            verified_at: now,
            actual_score: `Manual: ${newResult}`,
            created_at: now,
        };

        const { data: newPick, error: insertErr } = await supabase
            .from('value_picks_v2')
            .insert(insertPayload)
            .select('id, fixture_id, market, selection, p_model, odds, result, job_id')
            .single();

        if (insertErr) throw new Error(`Error creando pick: ${insertErr.message}`);
        pick = newPick;
    }

    if (!pick) throw new Error('Pick no encontrado y no se proporcionaron datos suficientes para crearlo');

    // Step 2: Update value_picks_v2 (if pick already existed)
    if (pick.result !== newResult || !pick.result || pick.result === 'PENDING') {
        await supabase
            .from('value_picks_v2')
            .update({
                result: newResult,
                verified_at: now,
                actual_score: `Manual: ${newResult}`,
            })
            .eq('id', pick.id);
    }

    // Step 3: Update profitability_tracking (only for Oportunidades, skip VOID)
    if (newResult === 'VOID') return; // VOID = no profit/loss impact
    const prob = normalizePModel(pick.p_model);
    const isOportunidad = prob >= OPPORTUNITIES_THRESHOLD;
    if (!isOportunidad) return;

    const baseBankroll = await fetchBaseBankroll();
    const config = DEFAULT_STAKING_CONFIG;
    const units = getStakeUnits(config, 'single', prob);
    const stakePercent = units * config.unit_value_percent;
    const stakeAmount = getStakeAmount(baseBankroll, units, config);
    const effectiveOdds = getEffectiveOdds(pick.odds, prob);
    const profitLoss = calculateProfitLoss(newResult, stakeAmount, effectiveOdds);

    const { data: matchData } = await supabase
        .from('daily_matches')
        .select('match_date, home_team, away_team, league_name')
        .eq('api_fixture_id', pick.fixture_id)
        .maybeSingle();

    const matchDate = matchData?.match_date || new Date().toISOString().split('T')[0];

    // Check by fixture_id + market + selection (not by the composite pickId)
    const { data: existing } = await supabase
        .from('profitability_tracking')
        .select('id')
        .eq('fixture_id', pick.fixture_id)
        .eq('market', pick.market)
        .eq('selection', pick.selection)
        .maybeSingle();

    if (existing) {
        await supabase
            .from('profitability_tracking')
            .update({
                result: newResult.toLowerCase(),
                profit_loss: profitLoss,
                stake_amount: stakeAmount,
                verified_at: now,
            })
            .eq('id', existing.id);
    } else {
        await supabase
            .from('profitability_tracking')
            .insert({
                pick_id: pick.id,
                fixture_id: pick.fixture_id,
                market: pick.market,
                selection: pick.selection,
                odds: pick.odds,
                probability: Math.round(prob * 100),
                result: newResult.toLowerCase(),
                stake_percentage: stakePercent,
                stake_amount: stakeAmount,
                profit_loss: profitLoss,
                date: matchDate,
                pick_type: 'oportunidad',
                home_team: matchData?.home_team || '',
                away_team: matchData?.away_team || '',
                league_name: matchData?.league_name || '',
                verified_at: now,
            });
    }
}

/**
 * Manual override: Admin sets a SINGLE LEG of a parlay as WON, LOST or VOID.
 * After updating the leg, auto-determines the parlay status:
 *   - Any leg LOST → parlay LOST
 *   - All legs WON (or WON+VOID) → parlay WON
 *   - Otherwise → parlay stays PENDING
 * When parlay resolves, updates profitability_tracking with pick_type='parlay'.
 */
export async function manualOverrideParlayLeg(
    parlayId: string,
    legIndex: number,
    legResult: 'WON' | 'LOST' | 'VOID'
): Promise<{ parlayStatus: string }> {
    const now = new Date().toISOString();

    // Step 1: Get the parlay
    const { data: parlay, error: fetchErr } = await supabase
        .from('parlay_combos_v2')
        .select('id, date, picks, combined_odds, risk_tier, status')
        .eq('id', parlayId)
        .single();

    if (fetchErr || !parlay) throw new Error(`Parlay no encontrado: ${fetchErr?.message || parlayId}`);

    // Step 2: Update the specific leg in picks JSONB
    const picks = (parlay.picks as any[]) || [];
    if (legIndex < 0 || legIndex >= picks.length) throw new Error(`Leg index ${legIndex} fuera de rango`);

    picks[legIndex] = { ...picks[legIndex], result: legResult };

    // Step 3: Auto-determine parlay status from all legs
    const legResults = picks.map((l: any) => l.result || 'PENDING');
    const hasLost = legResults.some((r: string) => r === 'LOST');
    const allResolved = legResults.every((r: string) => r === 'WON' || r === 'LOST' || r === 'VOID');
    const wonOrVoid = legResults.every((r: string) => r === 'WON' || r === 'VOID');

    let parlayStatus: string;
    if (hasLost) {
        parlayStatus = 'lost';
    } else if (allResolved && wonOrVoid) {
        parlayStatus = 'won';
    } else {
        parlayStatus = 'pending';
    }

    // Step 4: Update parlay_combos_v2
    const updatePayload: any = {
        picks,
        status: parlayStatus,
    };
    if (parlayStatus !== 'pending') {
        updatePayload.verified_at = now;
    }

    const { error: updateErr } = await supabase
        .from('parlay_combos_v2')
        .update(updatePayload)
        .eq('id', parlayId);

    if (updateErr) {
        console.error('[ResultsService] Error updating parlay:', updateErr.message);
    }

    // Step 5: Update profitability_tracking when parlay resolves (WON or LOST)
    if (parlayStatus === 'won' || parlayStatus === 'lost') {
        const baseBankroll = await fetchBaseBankroll();
        const config = DEFAULT_STAKING_CONFIG;
        const legCount = picks.length;
        const units = getStakeUnits(config, 'parlay', undefined, legCount);
        const stakePercent = units * config.unit_value_percent;
        const stakeAmount = getStakeAmount(baseBankroll, units, config);
        const profitLoss = parlayStatus === 'won'
            ? stakeAmount * ((parlay.combined_odds || 1) - 1)
            : -stakeAmount;

        const firstLeg = picks[0] || {};
        const selectionSummary = picks.map((l: any) => l.selection || '?').join(' & ');

        const { data: existing } = await supabase
            .from('profitability_tracking')
            .select('id')
            .eq('pick_id', parlayId)
            .eq('pick_type', 'parlay')
            .maybeSingle();

        if (existing) {
            await supabase
                .from('profitability_tracking')
                .update({
                    result: parlayStatus,
                    profit_loss: profitLoss,
                    stake_amount: stakeAmount,
                    odds: parlay.combined_odds,
                    verified_at: now,
                })
                .eq('id', existing.id);
        } else {
            await supabase
                .from('profitability_tracking')
                .insert({
                    pick_id: parlayId,
                    fixture_id: firstLeg.fixture_id || 0,
                    market: 'parlay_combo',
                    selection: selectionSummary,
                    odds: parlay.combined_odds,
                    probability: 0,
                    result: parlayStatus,
                    stake_percentage: stakePercent,
                    stake_amount: stakeAmount,
                    profit_loss: profitLoss,
                    date: parlay.date,
                    pick_type: 'parlay',
                    home_team: firstLeg.home_team || '',
                    away_team: firstLeg.away_team || '',
                    league_name: firstLeg.league || '',
                    verified_at: now,
                });
        }
    } else if (parlayStatus === 'pending') {
        // If parlay went back to pending (e.g. admin changed a leg from LOST to VOID),
        // remove any existing profitability entry
        await supabase
            .from('profitability_tracking')
            .delete()
            .eq('pick_id', parlayId)
            .eq('pick_type', 'parlay');
    }

    return { parlayStatus };
}

/**
 * Recalculate results: Reset picks to PENDING, clear profitability_tracking,
 * then invoke hourly-results-verifier to re-process with corrected logic.
 */
export async function recalculateResults(startDate: string, endDate: string): Promise<{ message: string; resetCount: number }> {
    // 1. Get fixture IDs for the date range
    const { data: matches } = await supabase
        .from('daily_matches')
        .select('api_fixture_id')
        .gte('match_date', startDate)
        .lte('match_date', endDate);

    const fixtureIds = (matches || []).map(m => m.api_fixture_id);

    if (fixtureIds.length === 0) {
        return { message: 'No hay partidos en ese rango de fechas', resetCount: 0 };
    }

    // 2. Reset value_picks_v2 results to PENDING for those fixtures (only Oportunidades)
    const { data: resetPicks, error: resetErr } = await supabase
        .from('value_picks_v2')
        .update({ result: 'PENDING', verified_at: null, actual_score: null })
        .in('fixture_id', fixtureIds)
        .gte('p_model', OPPORTUNITIES_THRESHOLD)
        .or('odds.gte.1.40,odds.is.null')
        .in('result', ['WON', 'LOST', 'VOID'])
        .select('id');

    if (resetErr) throw new Error(`Error reseteando picks: ${resetErr.message}`);

    const resetCount = resetPicks?.length || 0;

    // 3. Delete profitability_tracking entries for those dates
    await supabase
        .from('profitability_tracking')
        .delete()
        .gte('date', startDate)
        .lte('date', endDate);

    // 4. Generate date array for the verifier
    const dates: string[] = [];
    const current = new Date(startDate);
    const end = new Date(endDate);
    while (current <= end) {
        dates.push(current.toISOString().split('T')[0]);
        current.setDate(current.getDate() + 1);
    }

    // 5. Invoke hourly-results-verifier with the date range
    const { error: invokeErr } = await supabase.functions.invoke('hourly-results-verifier', {
        body: { date: dates }
    });

    if (invokeErr) throw new Error(`Error invocando verificador: ${invokeErr.message}`);

    return { message: `${resetCount} picks reseteados y re-verificación lanzada para ${dates.join(', ')}`, resetCount };
}

/**
 * Get advanced analytics data for superadmin (AnaliticaAvanzada)
 * Uses value_picks_v2 as source of truth for Oportunidades,
 * profitability_tracking only for Parlays.
 */
export async function getAdvancedAnalytics(filters: AdvancedAnalyticsFilters): Promise<AdvancedAnalyticsData> {
    if (filters.pickType === 'parlay') {
        return getAdvancedAnalyticsForParlays(filters);
    }

    // ═══ OPORTUNIDADES: value_picks_v2 is the source of truth ═══

    // Step 1: Get fixture IDs from daily_matches for the date range
    const { data: dateMatches, error: matchError } = await supabase
        .from('daily_matches')
        .select('api_fixture_id, home_team, away_team, league_name, match_date')
        .gte('match_date', filters.startDate)
        .lte('match_date', filters.endDate);

    if (matchError) throw matchError;

    const matchMap = new Map<number, any>();
    const fixtureIds: number[] = [];
    (dateMatches || []).forEach(m => {
        matchMap.set(m.api_fixture_id, m);
        fixtureIds.push(m.api_fixture_id);
    });

    if (fixtureIds.length === 0) {
        return emptyAnalytics(filters.startingBankroll);
    }

    // Step 2: Get verified picks (Oportunidades: p_model >= OPPORTUNITIES_THRESHOLD, odds >= 1.40, odds_source real/legacy)
    let query = supabase
        .from('value_picks_v2')
        .select('id, fixture_id, market, selection, p_model, odds, result, verified_at, actual_score, created_at')
        .in('fixture_id', fixtureIds)
        .gte('p_model', OPPORTUNITIES_THRESHOLD)
        .or('odds.gte.1.40,odds.is.null')
        .or('odds_source.eq.real,odds_source.is.null')
        .in('result', ['WON', 'LOST', 'VOID'])
        .order('verified_at', { ascending: true });

    if (filters.market && filters.market !== 'all') {
        query = query.eq('market', filters.market);
    }

    const { data: verifiedPicks, error: picksErr } = await query;
    if (picksErr) throw picksErr;

    // Pending count
    const { count: pendingCount } = await supabase
        .from('value_picks_v2')
        .select('id', { count: 'exact', head: true })
        .in('fixture_id', fixtureIds)
        .gte('p_model', OPPORTUNITIES_THRESHOLD)
        .or('odds.gte.1.40,odds.is.null')
        .or('odds_source.eq.real,odds_source.is.null')
        .eq('result', 'PENDING');

    const verified = verifiedPicks || [];
    const won = verified.filter(p => p.result === 'WON');
    const lost = verified.filter(p => p.result === 'LOST');
    const voided = verified.filter(p => p.result === 'VOID');

    // Financial simulation (proportional staking by confidence)
    const baseBankroll = filters.startingBankroll;
    const config = DEFAULT_STAKING_CONFIG;

    let bankroll = baseBankroll;
    const bankrollHistory: Array<{ date: string; bankroll: number; profit: number }> = [];
    let totalStaked = 0;
    let totalProfit = 0;
    let totalUnitsStaked = 0;
    let totalUnitsProfit = 0;
    let maxWinStreak = 0, maxLossStreak = 0, currentWinStreak = 0, currentLossStreak = 0;

    for (const pick of verified) {
        if (pick.result === 'VOID') continue;

        const units = getStakeUnits(config, 'single', pick.p_model);
        const stakeAmount = getStakeAmount(baseBankroll, units, config);
        const effectiveOdds = getEffectiveOdds(pick.odds, pick.p_model);
        const profitLoss = calculateProfitLoss(pick.result, stakeAmount, effectiveOdds);

        totalStaked += stakeAmount;
        totalUnitsStaked += units;
        totalProfit += profitLoss;
        totalUnitsProfit += calculateUnitProfit(pick.result, units, effectiveOdds);
        bankroll += profitLoss;

        const match = matchMap.get(pick.fixture_id);
        bankrollHistory.push({
            date: match?.match_date || pick.verified_at?.split('T')[0] || '',
            bankroll,
            profit: profitLoss,
        });

        if (pick.result === 'WON') {
            currentWinStreak++;
            currentLossStreak = 0;
            if (currentWinStreak > maxWinStreak) maxWinStreak = currentWinStreak;
        } else {
            currentLossStreak++;
            currentWinStreak = 0;
            if (currentLossStreak > maxLossStreak) maxLossStreak = currentLossStreak;
        }
    }

    // By market
    const byMarket: Record<string, { won: number; lost: number; profit: number; staked: number; accuracy: number }> = {};
    for (const pick of verified) {
        if (pick.result === 'VOID') continue;
        const market = pick.market || 'unknown';
        if (!byMarket[market]) byMarket[market] = { won: 0, lost: 0, profit: 0, staked: 0, accuracy: 0 };

        const mUnits = getStakeUnits(config, 'single', pick.p_model);
        const mStake = getStakeAmount(baseBankroll, mUnits, config);
        const mOdds = getEffectiveOdds(pick.odds, pick.p_model);
        const profitLoss = calculateProfitLoss(pick.result, mStake, mOdds);

        byMarket[market].staked += mStake;
        byMarket[market].profit += profitLoss;
        if (pick.result === 'WON') byMarket[market].won++;
        if (pick.result === 'LOST') byMarket[market].lost++;
    }
    for (const key of Object.keys(byMarket)) {
        const total = byMarket[key].won + byMarket[key].lost;
        byMarket[key].accuracy = total > 0 ? (byMarket[key].won / total) * 100 : 0;
    }

    // By league
    const byLeague: Record<string, { won: number; lost: number; accuracy: number }> = {};
    for (const pick of verified) {
        if (pick.result === 'VOID') continue;
        const match = matchMap.get(pick.fixture_id);
        const league = match?.league_name || 'Desconocida';
        if (!byLeague[league]) byLeague[league] = { won: 0, lost: 0, accuracy: 0 };
        if (pick.result === 'WON') byLeague[league].won++;
        if (pick.result === 'LOST') byLeague[league].lost++;
    }
    for (const key of Object.keys(byLeague)) {
        const total = byLeague[key].won + byLeague[key].lost;
        byLeague[key].accuracy = total > 0 ? (byLeague[key].won / total) * 100 : 0;
    }

    const currentStreak = currentWinStreak > 0
        ? { type: 'win' as const, count: currentWinStreak }
        : { type: 'loss' as const, count: currentLossStreak };

    // ROI = profit / capital inicial (misma fórmula que Resultados)
    const roi = baseBankroll > 0 ? (totalProfit / baseBankroll) * 100 : 0;
    const maxDrawdown = calculateMaxDrawdown(bankrollHistory.map(h => h.bankroll));

    // Average odds
    const oddsSum = verified.filter(p => p.result !== 'VOID').reduce((s, p) => s + getEffectiveOdds(p.odds, p.p_model), 0);
    const avgOdds = (won.length + lost.length) > 0 ? oddsSum / (won.length + lost.length) : 0;

    return {
        summary: {
            total_picks: verified.length + (pendingCount || 0),
            verified_picks: verified.length,
            pending_picks: pendingCount || 0,
            won: won.length,
            lost: lost.length,
            voided: voided.length,
            accuracy: (won.length + lost.length) > 0 ? (won.length / (won.length + lost.length)) * 100 : 0,
            total_staked: totalStaked,
            total_profit: totalProfit,
            roi,
            yield: totalStaked > 0 ? (totalProfit / totalStaked) * 100 : 0,
            current_bankroll: bankroll,
            max_drawdown: maxDrawdown,
            max_win_streak: maxWinStreak,
            max_loss_streak: maxLossStreak,
            current_streak: currentStreak,
            units_staked: totalUnitsStaked,
            units_profit: totalUnitsProfit,
            avg_odds: Math.round(avgOdds * 100) / 100,
        },
        by_market: byMarket,
        by_league: byLeague,
        bankroll_history: bankrollHistory,
        picks: verified.map(p => {
            const match = matchMap.get(p.fixture_id);
            const pUnits = getStakeUnits(config, 'single', p.p_model);
            const pStake = getStakeAmount(baseBankroll, pUnits, config);
            const pOdds = getEffectiveOdds(p.odds, p.p_model);
            const profitLoss = p.result === 'VOID' ? 0 : calculateProfitLoss(p.result, pStake, pOdds);
            return {
                id: p.id,
                home_team: match?.home_team || '',
                away_team: match?.away_team || '',
                market: p.market || '',
                selection: p.selection || '',
                result: p.result as PickResult,
                odds: p.odds || 0,
                p_model: p.p_model,
                actual_score: p.actual_score,
                verified_at: p.verified_at || p.created_at,
                profit_loss: profitLoss,
                league: match?.league_name,
            };
        }),
    };
}

function emptyAnalytics(startingBankroll: number): AdvancedAnalyticsData {
    return {
        summary: {
            total_picks: 0, verified_picks: 0, pending_picks: 0,
            won: 0, lost: 0, voided: 0, accuracy: 0,
            total_staked: 0, total_profit: 0, roi: 0, yield: 0,
            current_bankroll: startingBankroll, max_drawdown: 0,
            max_win_streak: 0, max_loss_streak: 0,
            current_streak: { type: 'win', count: 0 },
        },
        by_market: {},
        by_league: {},
        bankroll_history: [],
        picks: [],
    };
}

/**
 * Parlays analytics — uses profitability_tracking since parlay data lives there
 */
async function getAdvancedAnalyticsForParlays(filters: AdvancedAnalyticsFilters): Promise<AdvancedAnalyticsData> {
    let query = supabase
        .from('profitability_tracking')
        .select('*')
        .gte('date', filters.startDate)
        .lte('date', filters.endDate)
        .eq('pick_type', 'parlay')
        .order('created_at', { ascending: true });

    if (filters.market && filters.market !== 'all') query = query.eq('market', filters.market);

    const { data: entries, error } = await query;
    if (error) throw error;

    const all = entries || [];
    const verified = all.filter(e => e.result !== 'pending');
    const won = verified.filter(e => e.result === 'won');
    const lost = verified.filter(e => e.result === 'lost');
    const voided = verified.filter(e => e.result === 'void' || e.result === 'push');
    const pending = all.filter(e => e.result === 'pending');

    const totalStaked = verified.reduce((sum, e) => sum + (e.stake_amount || 0), 0);
    const totalProfit = verified.reduce((sum, e) => sum + (e.profit_loss || 0), 0);
    const roi = totalStaked > 0 ? (totalProfit / totalStaked) * 100 : 0;

    let bankroll = filters.startingBankroll;
    const bankrollHistory: Array<{ date: string; bankroll: number; profit: number }> = [];
    let maxWinStreak = 0, maxLossStreak = 0, currentWinStreak = 0, currentLossStreak = 0;

    for (const e of verified) {
        bankroll += e.profit_loss || 0;
        bankrollHistory.push({ date: e.date, bankroll, profit: e.profit_loss || 0 });

        if (e.result === 'won') {
            currentWinStreak++; currentLossStreak = 0;
            if (currentWinStreak > maxWinStreak) maxWinStreak = currentWinStreak;
        } else if (e.result === 'lost') {
            currentLossStreak++; currentWinStreak = 0;
            if (currentLossStreak > maxLossStreak) maxLossStreak = currentLossStreak;
        }
    }

    const byMarket: Record<string, { won: number; lost: number; profit: number; staked: number; accuracy: number }> = {};
    for (const e of verified) {
        const market = e.market || 'parlay';
        if (!byMarket[market]) byMarket[market] = { won: 0, lost: 0, profit: 0, staked: 0, accuracy: 0 };
        byMarket[market].staked += e.stake_amount || 0;
        byMarket[market].profit += e.profit_loss || 0;
        if (e.result === 'won') byMarket[market].won++;
        if (e.result === 'lost') byMarket[market].lost++;
    }
    for (const key of Object.keys(byMarket)) {
        const total = byMarket[key].won + byMarket[key].lost;
        byMarket[key].accuracy = total > 0 ? (byMarket[key].won / total) * 100 : 0;
    }

    const currentStreak = currentWinStreak > 0
        ? { type: 'win' as const, count: currentWinStreak }
        : { type: 'loss' as const, count: currentLossStreak };

    return {
        summary: {
            total_picks: all.length, verified_picks: verified.length, pending_picks: pending.length,
            won: won.length, lost: lost.length, voided: voided.length,
            accuracy: (won.length + lost.length) > 0 ? (won.length / (won.length + lost.length)) * 100 : 0,
            total_staked: totalStaked, total_profit: totalProfit, roi, yield: roi,
            current_bankroll: bankroll, max_drawdown: 0,
            max_win_streak: maxWinStreak, max_loss_streak: maxLossStreak,
            current_streak: currentStreak,
        },
        by_market: byMarket,
        by_league: {},
        bankroll_history: bankrollHistory,
        picks: verified.map(e => ({
            id: e.id, home_team: e.home_team || '', away_team: e.away_team || '',
            market: e.market || '', selection: e.selection || '',
            result: (e.result || 'PENDING').toUpperCase() as PickResult,
            odds: e.odds || 0, p_model: (e.probability || 0) / 100,
            actual_score: null, verified_at: e.verified_at || e.created_at,
            profit_loss: e.profit_loss || 0,
        })),
    };
}

// ═══════════════════════════════════════════════════════
// PER-PLAN PERFORMANCE TRACKING
// ═══════════════════════════════════════════════════════

interface PickWithMatchDate {
    id: string;
    fixture_id: number;
    market: string;
    selection: string;
    p_model: number;
    odds: number | null;
    result: string;
    verified_at: string | null;
    actual_score: string | null;
    match_date: string;
    home_team: string;
    away_team: string;
    league_name?: string;
}

/**
 * Fetch all verified Oportunidades picks enriched with match_date for a date range.
 * This is the shared data source for both getResultsByPlan and getPerPlanComparison.
 */
async function fetchPicksWithMatchDate(startDate: string, endDate: string): Promise<{
    picks: PickWithMatchDate[];
    matchMap: Map<number, { home_team: string; away_team: string; league_name: string; match_date: string }>;
    baseBankroll: number;
}> {
    const { data: dateMatches } = await supabase
        .from('daily_matches')
        .select('api_fixture_id, home_team, away_team, league_name, match_date')
        .gte('match_date', startDate)
        .lte('match_date', endDate);

    const matchMap = new Map<number, any>();
    const fixtureIds: number[] = [];
    (dateMatches || []).forEach(m => {
        matchMap.set(m.api_fixture_id, m);
        fixtureIds.push(m.api_fixture_id);
    });

    if (fixtureIds.length === 0) {
        const baseBankroll = await fetchBaseBankroll();
        return { picks: [], matchMap, baseBankroll };
    }

    // Get ALL verified + pending picks — ONLY persisted opportunities
    const { data: allPicks } = await supabase
        .from('value_picks_v2')
        .select('id, fixture_id, market, selection, p_model, odds, result, verified_at, actual_score, created_at')
        .in('fixture_id', fixtureIds)
        .eq('is_opportunity', true);

    const baseBankroll = await fetchBaseBankroll();

    const picks: PickWithMatchDate[] = (allPicks || []).map(p => {
        const match = matchMap.get(p.fixture_id);
        return {
            id: p.id,
            fixture_id: p.fixture_id,
            market: p.market,
            selection: p.selection,
            p_model: p.p_model,
            odds: p.odds,
            result: p.result,
            verified_at: p.verified_at,
            actual_score: p.actual_score,
            match_date: match?.match_date || '',
            home_team: match?.home_team || 'Equipo A',
            away_team: match?.away_team || 'Equipo B',
            league_name: match?.league_name,
        };
    });

    return { picks, matchMap, baseBankroll };
}

/**
 * Group picks by match_date, sort each day's picks by p_model DESC (with created_at tiebreaker),
 * then filter to only the picks visible for the given plan.
 */
function filterPicksByPlan(picks: PickWithMatchDate[], planName: PlanTier): PickWithMatchDate[] {
    // Group by match_date
    const byDate = new Map<string, PickWithMatchDate[]>();
    for (const pick of picks) {
        const date = pick.match_date;
        if (!byDate.has(date)) byDate.set(date, []);
        byDate.get(date)!.push(pick);
    }

    const filtered: PickWithMatchDate[] = [];
    const percentage = PLAN_PREDICTIONS_PERCENTAGES[planName];

    for (const [, dayPicks] of byDate) {
        // Sort by p_model DESC (highest probability first) — consistent with v2-generate-parlays
        dayPicks.sort((a, b) => b.p_model - a.p_model);

        const allowedCount = getAllowedPickCount(dayPicks.length, percentage, false);
        filtered.push(...dayPicks.slice(0, allowedCount));
    }

    return filtered;
}

/**
 * Calculate performance metrics for a subset of picks.
 */
function calculatePlanMetrics(
    picks: PickWithMatchDate[],
    baseBankroll: number,
    planName: PlanTier,
): Omit<PlanPerformanceSummary, 'exclusivePicks' | 'exclusiveWon' | 'exclusiveLost' | 'exclusiveWinRate' | 'exclusiveROI'> {
    const verified = picks.filter(p => p.result === 'WON' || p.result === 'LOST');
    const pending = picks.filter(p => p.result === 'PENDING');
    const won = verified.filter(p => p.result === 'WON');
    const lost = verified.filter(p => p.result === 'LOST');

    const config = DEFAULT_STAKING_CONFIG;
    let totalStaked = 0;
    let totalProfit = 0;
    let unitsStaked = 0;
    let unitsProfit = 0;

    for (const pick of verified) {
        const units = getStakeUnits(config, 'single', pick.p_model);
        const stake = getStakeAmount(baseBankroll, units, config);
        const effectiveOdds = getEffectiveOdds(pick.odds, pick.p_model);
        totalStaked += stake;
        totalProfit += calculateProfitLoss(pick.result, stake, effectiveOdds);
        unitsStaked += units;
        unitsProfit += calculateUnitProfit(pick.result, units, effectiveOdds);
    }

    // Average odds
    const oddsSum = verified.reduce((sum, p) => sum + getEffectiveOdds(p.odds, p.p_model), 0);
    const avgOdds = verified.length > 0 ? oddsSum / verified.length : 0;

    // Current streak (most recent first by verified_at)
    const sorted = [...verified].sort((a, b) =>
        (b.verified_at || '').localeCompare(a.verified_at || '')
    );
    let streakType: 'win' | 'loss' = 'win';
    let streakCount = 0;
    for (const pick of sorted) {
        if (streakCount === 0) {
            streakType = pick.result === 'WON' ? 'win' : 'loss';
            streakCount = 1;
        } else if ((pick.result === 'WON' && streakType === 'win') || (pick.result === 'LOST' && streakType === 'loss')) {
            streakCount++;
        } else {
            break;
        }
    }

    return {
        planName,
        displayName: PLAN_DISPLAY_NAMES[planName],
        predictionsPercentage: PLAN_PREDICTIONS_PERCENTAGES[planName],
        picksCount: verified.length,
        won: won.length,
        lost: lost.length,
        pending: pending.length,
        winRate: verified.length > 0 ? (won.length / verified.length) * 100 : 0,
        totalStaked,
        totalProfit,
        roi: baseBankroll > 0 ? (totalProfit / baseBankroll) * 100 : 0,
        avgOdds: Math.round(avgOdds * 100) / 100,
        currentStreak: { type: streakType, count: streakCount },
        unitsStaked,
        unitsProfit,
        yield: unitsStaked > 0 ? (unitsProfit / unitsStaked) * 100 : 0,
    };
}

/**
 * Get results filtered by a specific plan tier.
 * Returns the same PublicResultsData format but only for picks visible to that plan.
 */
export async function getResultsByPlan(
    startDate: string,
    endDate: string,
    planName: PlanTier,
    filter: 'all' | 'picks' | 'parlays' = 'all'
): Promise<PublicResultsData> {
    const { picks: allPicks, baseBankroll } = await fetchPicksWithMatchDate(startDate, endDate);

    if (allPicks.length === 0) {
        const { totalProfit } = await calculateProfitFromPicks(baseBankroll, SYSTEM_START_DATE, new Date().toISOString().split('T')[0]);
        return emptyResults(baseBankroll, baseBankroll + totalProfit, totalProfit);
    }

    // Filter picks for this plan
    const planPicks = filterPicksByPlan(allPicks, planName);
    const verified = planPicks.filter(p => p.result === 'WON' || p.result === 'LOST');
    const pending = planPicks.filter(p => p.result === 'PENDING');
    const won = verified.filter(p => p.result === 'WON');
    const lost = verified.filter(p => p.result === 'LOST');

    const config = DEFAULT_STAKING_CONFIG;

    // Enrich with profit/loss (proportional staking)
    const recentResults = verified
        .sort((a, b) => (b.verified_at || '').localeCompare(a.verified_at || ''))
        .map(p => {
            const units = getStakeUnits(config, 'single', p.p_model);
            const stake = getStakeAmount(baseBankroll, units, config);
            const effectiveOdds = getEffectiveOdds(p.odds, p.p_model);
            return {
                id: p.id,
                home_team: p.home_team,
                away_team: p.away_team,
                market: p.market,
                selection: p.selection,
                result: p.result as PickResult,
                odds: p.odds,
                p_model: p.p_model,
                actual_score: p.actual_score,
                verified_at: p.verified_at || '',
                league: p.league_name,
                match_date: p.match_date,
                profit_loss: calculateProfitLoss(p.result, stake, effectiveOdds),
                units,
            };
        });

    // Period profit for this plan's picks
    let periodProfit = 0;
    let periodStaked = 0;
    let periodUnitsStaked = 0;
    let periodUnitsProfit = 0;
    for (const pick of verified) {
        const units = getStakeUnits(config, 'single', pick.p_model);
        const stake = getStakeAmount(baseBankroll, units, config);
        const effectiveOdds = getEffectiveOdds(pick.odds, pick.p_model);
        periodStaked += stake;
        periodProfit += calculateProfitLoss(pick.result, stake, effectiveOdds);
        periodUnitsStaked += units;
        periodUnitsProfit += calculateUnitProfit(pick.result, units, effectiveOdds);
    }

    // Cumulative profit for this plan (from system start)
    const { picks: allTimePicks } = await fetchPicksWithMatchDate(SYSTEM_START_DATE, new Date().toISOString().split('T')[0]);
    const allTimePlanPicks = filterPicksByPlan(allTimePicks, planName)
        .filter(p => p.result === 'WON' || p.result === 'LOST');
    let cumulativeProfit = 0;
    let cumUnitsStaked = 0;
    let cumUnitsProfit = 0;
    for (const pick of allTimePlanPicks) {
        const units = getStakeUnits(config, 'single', pick.p_model);
        const stake = getStakeAmount(baseBankroll, units, config);
        const effectiveOdds = getEffectiveOdds(pick.odds, pick.p_model);
        cumulativeProfit += calculateProfitLoss(pick.result, stake, effectiveOdds);
        cumUnitsStaked += units;
        cumUnitsProfit += calculateUnitProfit(pick.result, units, effectiveOdds);
    }

    // Last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysStr = sevenDaysAgo.toISOString().split('T')[0];
    const last7 = verified.filter(p => p.match_date >= sevenDaysStr);
    const last7Wins = last7.filter(p => p.result === 'WON').length;
    const last7Losses = last7.filter(p => p.result === 'LOST').length;

    // Current streak
    let streakType: 'win' | 'loss' = 'win';
    let streakCount = 0;
    for (const pick of recentResults) {
        if (streakCount === 0) {
            streakType = pick.result === 'WON' ? 'win' : 'loss';
            streakCount = 1;
        } else if ((pick.result === 'WON' && streakType === 'win') || (pick.result === 'LOST' && streakType === 'loss')) {
            streakCount++;
        } else {
            break;
        }
    }

    // Professional metrics: streaks, avg odds, max drawdown
    let bestStreak = 0;
    let worstStreak = 0;
    let currentRun = 0;
    let lastResult: string | null = null;
    let oddsSum = 0;
    let oddsCount = 0;
    const bankrollHistory: number[] = [baseBankroll];
    let runningBankroll = baseBankroll;

    const chronological = [...recentResults].reverse();
    for (const pick of chronological) {
        const pUnits = getStakeUnits(config, 'single', pick.p_model);
        const pStake = getStakeAmount(baseBankroll, pUnits, config);
        const pOdds = getEffectiveOdds(pick.odds, pick.p_model);
        const pPnl = calculateProfitLoss(pick.result, pStake, pOdds);
        runningBankroll += pPnl;
        bankrollHistory.push(runningBankroll);

        if (pick.odds && pick.odds > 1) { oddsSum += pick.odds; oddsCount++; }

        if (pick.result === lastResult) {
            currentRun++;
        } else {
            currentRun = 1;
            lastResult = pick.result;
        }
        if (pick.result === 'WON' && currentRun > bestStreak) bestStreak = currentRun;
        if (pick.result === 'LOST' && currentRun > worstStreak) worstStreak = currentRun;
    }

    const maxDrawdown = calculateMaxDrawdown(bankrollHistory);
    const avgOdds = oddsCount > 0 ? Math.round((oddsSum / oddsCount) * 100) / 100 : 0;

    // Parlays (included as-is, no plan filtering for now — plan filtering for parlays is Phase 6)
    let parlaysData: PublicResultsData['parlays'] = undefined;
    if (filter === 'all' || filter === 'parlays') {
        parlaysData = await getParlayResults(startDate, endDate, baseBankroll);
    }
    const parlaysCumulativeProfit = filter !== 'picks'
        ? (await getParlayProfit(baseBankroll, PARLAY_START_DATE, new Date().toISOString().split('T')[0]))
        : 0;
    const combinedCumulativeProfit = cumulativeProfit + parlaysCumulativeProfit;

    return {
        winRate: verified.length > 0 ? (won.length / verified.length) * 100 : 0,
        totalVerified: verified.length,
        totalPending: pending.length,
        won: won.length,
        lost: lost.length,
        last7Days: { wins: last7Wins, losses: last7Losses, total: last7.length },
        currentStreak: { type: streakType, count: streakCount },
        recentResults,
        bankroll: {
            base: baseBankroll,
            current: baseBankroll + combinedCumulativeProfit,
            profit: combinedCumulativeProfit,
            roi: baseBankroll > 0 ? (combinedCumulativeProfit / baseBankroll) * 100 : 0,
            periodProfit: periodProfit + (parlaysData?.periodProfit ?? 0),
            periodROI: baseBankroll > 0 ? ((periodProfit + (parlaysData?.periodProfit ?? 0)) / baseBankroll) * 100 : 0,
            periodStaked: periodStaked + (parlaysData?.periodStaked ?? 0),
        },
        units: {
            totalUnitsStaked: cumUnitsStaked,
            totalUnitsProfit: cumUnitsProfit,
            yield: cumUnitsStaked > 0 ? (cumUnitsProfit / cumUnitsStaked) * 100 : 0,
            periodUnitsStaked,
            periodUnitsProfit,
            periodYield: periodUnitsStaked > 0 ? (periodUnitsProfit / periodUnitsStaked) * 100 : 0,
        },
        maxDrawdown,
        bestStreak,
        worstStreak,
        avgOdds,
        parlays: parlaysData,
    };
}

/**
 * Get performance comparison across all plan tiers (admin only).
 * Single data fetch, then slice per plan in memory.
 */
export async function getPerPlanComparison(startDate: string, endDate: string): Promise<PerPlanComparisonData> {
    const { picks: allPicks, baseBankroll } = await fetchPicksWithMatchDate(startDate, endDate);

    const plans: Record<string, PlanPerformanceSummary> = {};

    for (const tier of PLAN_TIERS) {
        const planPicks = filterPicksByPlan(allPicks, tier);
        const metrics = calculatePlanMetrics(planPicks, baseBankroll, tier);

        // Calculate exclusive metrics (picks ONLY available at this tier and above)
        const tierIndex = PLAN_TIERS.indexOf(tier);
        let exclusivePicks: PickWithMatchDate[];

        if (tierIndex === 0) {
            // Free: its exclusive picks = same as its inclusive picks (just the #1 pick per day)
            exclusivePicks = planPicks;
        } else {
            // Get picks from previous tier to compute the delta
            const prevTier = PLAN_TIERS[tierIndex - 1];
            const prevPlanPicks = filterPicksByPlan(allPicks, prevTier);
            const prevIds = new Set(prevPlanPicks.map(p => p.id));
            exclusivePicks = planPicks.filter(p => !prevIds.has(p.id));
        }

        const exclusiveVerified = exclusivePicks.filter(p => p.result === 'WON' || p.result === 'LOST');
        const exclusiveWon = exclusiveVerified.filter(p => p.result === 'WON');
        const exclusiveLost = exclusiveVerified.filter(p => p.result === 'LOST');

        const excConfig = DEFAULT_STAKING_CONFIG;
        let exclusiveProfit = 0;
        let exclusiveStaked = 0;
        for (const pick of exclusiveVerified) {
            const excUnits = getStakeUnits(excConfig, 'single', pick.p_model);
            const excStake = getStakeAmount(baseBankroll, excUnits, excConfig);
            const excOdds = getEffectiveOdds(pick.odds, pick.p_model);
            exclusiveStaked += excStake;
            exclusiveProfit += calculateProfitLoss(pick.result, excStake, excOdds);
        }

        plans[tier] = {
            ...metrics,
            exclusivePicks: exclusiveVerified.length,
            exclusiveWon: exclusiveWon.length,
            exclusiveLost: exclusiveLost.length,
            exclusiveWinRate: exclusiveVerified.length > 0
                ? (exclusiveWon.length / exclusiveVerified.length) * 100
                : 0,
            exclusiveROI: exclusiveStaked > 0
                ? (exclusiveProfit / exclusiveStaked) * 100
                : 0,
        };
    }

    return {
        dateRange: { start: startDate, end: endDate },
        plans: plans as Record<PlanTier, PlanPerformanceSummary>,
        baseBankroll,
    };
}
