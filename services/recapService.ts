// services/recapService.ts
// Fetches yesterday's performance data for the Daily Recap modal.
// Thin wrapper over getPublicResults + getAdvancedAnalytics.

import { getPublicResults, getAdvancedAnalytics } from './resultsService';
import { getCurrentDateInBogota } from '../utils/dateUtils';
import type { DailyRecapData, RecapTier, RecapPeriodStats } from '../types';

function getYesterdayDate(): string {
    const today = getCurrentDateInBogota();
    const d = new Date(today + 'T12:00:00');
    d.setDate(d.getDate() - 1);
    return new Intl.DateTimeFormat('en-CA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        timeZone: 'America/Bogota',
    }).format(d);
}

function getDateNDaysAgo(n: number): string {
    const today = getCurrentDateInBogota();
    const d = new Date(today + 'T12:00:00');
    d.setDate(d.getDate() - n);
    return new Intl.DateTimeFormat('en-CA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        timeZone: 'America/Bogota',
    }).format(d);
}

async function fetchPeriodStats(startDate: string, endDate: string): Promise<RecapPeriodStats> {
    try {
        const data = await getPublicResults(startDate, endDate);
        return {
            winRate: data.winRate,
            roi: data.bankroll?.periodROI || 0,
            won: data.won,
            lost: data.lost,
            total: data.totalVerified,
        };
    } catch {
        return { winRate: 0, roi: 0, won: 0, lost: 0, total: 0 };
    }
}

export async function fetchDailyRecapData(tier: RecapTier): Promise<DailyRecapData> {
    const yesterday = getYesterdayDate();
    const today = getCurrentDateInBogota();

    // Core data — all tiers
    const publicResults = await getPublicResults(yesterday, yesterday);

    const totalVerified = publicResults.totalVerified;
    const totalPending = publicResults.totalPending;

    if (totalVerified === 0 && totalPending === 0) {
        return {
            date: yesterday,
            hasData: false,
            isBadDay: false,
            totalPicks: 0,
            winRate: 0,
            won: 0,
            lost: 0,
            totalPending: 0,
            roi: 0,
            profit: 0,
            bankrollChange: 0,
            currentStreak: { type: 'win', count: 0 },
            bestPick: null,
            winningPicks: [],
        };
    }

    // If only pending (no verified yet), return partial data
    if (totalVerified === 0 && totalPending > 0) {
        return {
            date: yesterday,
            hasData: true,
            isBadDay: false,
            totalPicks: 0,
            winRate: 0,
            won: 0,
            lost: 0,
            totalPending,
            roi: 0,
            profit: 0,
            bankrollChange: 0,
            currentStreak: { type: 'win', count: 0 },
            bestPick: null,
            winningPicks: [],
        };
    }

    const winRate = publicResults.winRate;
    const isBadDay = winRate < 50;

    const wonPicks = publicResults.recentResults.filter(p => p.result === 'WON');
    const bestPick = wonPicks.length > 0
        ? wonPicks.reduce((best, pick) => (pick.profit_loss > best.profit_loss ? pick : best), wonPicks[0])
        : null;

    const recapData: DailyRecapData = {
        date: yesterday,
        hasData: true,
        isBadDay,
        totalPicks: totalVerified,
        winRate,
        won: publicResults.won,
        lost: publicResults.lost,
        totalPending,
        roi: publicResults.bankroll?.periodROI || 0,
        profit: publicResults.bankroll?.periodProfit || 0,
        bankrollChange: publicResults.bankroll?.periodProfit || 0,
        currentStreak: publicResults.currentStreak,
        bestPick: bestPick ? {
            home_team: bestPick.home_team,
            away_team: bestPick.away_team,
            market: bestPick.market,
            selection: bestPick.selection,
            odds: bestPick.odds,
            p_model: bestPick.p_model,
            result: bestPick.result,
            profit_loss: bestPick.profit_loss,
            league: bestPick.league,
        } : null,
        winningPicks: wonPicks.map(p => ({
            home_team: p.home_team,
            away_team: p.away_team,
            market: p.market,
            selection: p.selection,
            odds: p.odds,
            result: p.result,
            profit_loss: p.profit_loss,
            league: p.league,
        })),
    };

    // Bad day: fetch multi-period stats for business perspective
    if (isBadDay) {
        const [days7, days15, days30] = await Promise.all([
            fetchPeriodStats(getDateNDaysAgo(7), today),
            fetchPeriodStats(getDateNDaysAgo(15), today),
            fetchPeriodStats(getDateNDaysAgo(30), today),
        ]);
        recapData.periodStats = { days7, days15, days30 };
    }

    // Pro+ data: market insights, league breakdown, calibration
    if (tier === 'pro' || tier === 'premium' || tier === 'admin') {
        try {
            const analytics = await getAdvancedAnalytics({
                startDate: yesterday,
                endDate: yesterday,
                startingBankroll: publicResults.bankroll?.base || 100,
            });

            // Best market
            const markets = Object.entries(analytics.by_market);
            if (markets.length > 0) {
                const best = markets.reduce((a, b) => a[1].accuracy > b[1].accuracy ? a : b);
                recapData.bestMarket = {
                    name: best[0],
                    accuracy: best[1].accuracy,
                    profit: best[1].profit,
                };
            }

            // Premium: league breakdown + best odds + calibration
            if (tier === 'premium' || tier === 'admin') {
                recapData.leagueBreakdown = analytics.by_league;

                // Best odds that hit
                const wonPicksSorted = analytics.picks
                    .filter(p => p.result === 'WON')
                    .sort((a, b) => b.odds - a.odds);
                if (wonPicksSorted.length > 0) {
                    const top = wonPicksSorted[0];
                    recapData.bestOddsHit = {
                        odds: top.odds,
                        match: `${top.home_team} vs ${top.away_team}`,
                        market: top.market,
                    };
                }

                // Calibration insight
                const highProbPicks = analytics.picks.filter(p => p.p_model >= 0.85);
                if (highProbPicks.length >= 3) {
                    const highProbWR = (highProbPicks.filter(p => p.result === 'WON').length / highProbPicks.length) * 100;
                    recapData.calibrationInsight = `Picks con 85%+ de probabilidad tuvieron ${highProbWR.toFixed(0)}% de acierto (${highProbPicks.length} picks)`;
                }
            }
        } catch (err) {
            console.warn('[RecapService] Error fetching advanced analytics:', err);
        }
    }

    return recapData;
}
