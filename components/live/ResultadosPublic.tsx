// components/live/ResultadosPublic.tsx
// Public results tab — accessible to all users.
// Admin: selector con 5 opciones (Global + 4 planes) para inspeccionar el rendimiento por plan.
// User no-premium: toggle "Mi Plan / Plan Máquina".
// User premium: vista única (su plan ya es el más alto).

import React, { useState, useEffect } from 'react';
import { getPublicResults, getResultsByPlan } from '../../services/resultsService';
import type { PublicResultsData, PickResult, PlanTier } from '../../types';
import { ChartBarIcon, ArrowPathIcon, TrophyIcon } from '../icons/Icons';
import { useSubscription } from '../../contexts/SubscriptionContext';
import { PLAN_DISPLAY_NAMES, PLAN_PREDICTIONS_PERCENTAGES, getRecommendedUpgradePlan } from '../../utils/planAccessUtils';
import { getCurrentDateInBogota } from '../../utils/dateUtils';

type PeriodKey = 'ayer' | 'hoy' | '7d' | '30d' | '90d' | 'all';
type PeriodOption = { key: PeriodKey; label: string };
type ViewMode = 'plan' | 'maquina';
type AdminInspectPlan = PlanTier | 'global';

const PERIODS: PeriodOption[] = [
    { key: 'ayer', label: 'Ayer' },
    { key: 'hoy', label: 'Hoy' },
    { key: '7d', label: '7 días' },
    { key: '30d', label: '30 días' },
    { key: '90d', label: '90 días' },
    { key: 'all', label: 'Todo' },
];

const PLAN_OPTIONS: { value: AdminInspectPlan; label: string }[] = [
    { value: 'global', label: 'Global' },
    { value: 'free', label: 'Explorador' },
    { value: 'starter', label: 'Ventaja' },
    { value: 'pro', label: 'Elite' },
    { value: 'premium', label: 'Máquina' },
];

const STAKING_LABEL = '2-4u por pronóstico';

function getDateRange(period: PeriodKey): { startDate: string; endDate: string } {
    const todayStr = getCurrentDateInBogota();
    const [y, m, d] = todayStr.split('-').map(Number);
    const bogotaToday = new Date(y, m - 1, d);
    const fmt = (date: Date) => {
        const yr = date.getFullYear();
        const mo = String(date.getMonth() + 1).padStart(2, '0');
        const dy = String(date.getDate()).padStart(2, '0');
        return `${yr}-${mo}-${dy}`;
    };

    switch (period) {
        case 'hoy':
            return { startDate: todayStr, endDate: todayStr };
        case 'ayer': {
            const ayer = new Date(bogotaToday);
            ayer.setDate(ayer.getDate() - 1);
            return { startDate: fmt(ayer), endDate: fmt(ayer) };
        }
        case '7d': {
            const start = new Date(bogotaToday);
            start.setDate(start.getDate() - 7);
            return { startDate: fmt(start), endDate: todayStr };
        }
        case '30d': {
            const start = new Date(bogotaToday);
            start.setDate(start.getDate() - 30);
            return { startDate: fmt(start), endDate: todayStr };
        }
        case '90d': {
            const start = new Date(bogotaToday);
            start.setDate(start.getDate() - 90);
            return { startDate: fmt(start), endDate: todayStr };
        }
        case 'all':
            return { startDate: '2026-02-17', endDate: todayStr };
    }
}

const ResultadosPublic: React.FC<{ refreshTrigger?: number }> = ({ refreshTrigger }) => {
    const [data, setData] = useState<PublicResultsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedPeriod, setSelectedPeriod] = useState<PeriodKey>('7d');

    const { plan, isAdmin } = useSubscription();
    const planName = plan.plan_name as PlanTier;
    const isPremium = planName === 'premium';

    // Admin: selector entre Global + 4 planes. Default: global.
    const [adminInspectPlan, setAdminInspectPlan] = useState<AdminInspectPlan>('global');
    // User no-premium: toggle entre su plan y el plan Máquina.
    const [viewMode, setViewMode] = useState<ViewMode>('plan');

    // Plan efectivo a consultar:
    //  - Admin → adminInspectPlan ('global' o un PlanTier).
    //  - Premium → su propio plan (sin toggle visible).
    //  - Resto → 'plan' = su plan; 'maquina' = premium.
    const effectivePlanToQuery: AdminInspectPlan = (() => {
        if (isAdmin) return adminInspectPlan;
        if (isPremium) return 'premium';
        return viewMode === 'maquina' ? 'premium' : planName;
    })();

    const loadResults = async (retryCount = 0) => {
        setLoading(true);
        setError(null);

        const cacheKey = `results_${selectedPeriod}_${effectivePlanToQuery}`;
        const cached = sessionStorage.getItem(cacheKey);
        if (cached && retryCount === 0) {
            try {
                const { data: cachedData, ts } = JSON.parse(cached);
                if (Date.now() - ts < 5 * 60 * 1000) {
                    setData(cachedData);
                    setLoading(false);
                    return;
                }
            } catch { /* ignore corrupt cache */ }
        }

        try {
            const { startDate, endDate } = getDateRange(selectedPeriod);
            const results: PublicResultsData = effectivePlanToQuery === 'global'
                ? await getPublicResults(startDate, endDate)
                : await getResultsByPlan(startDate, endDate, effectivePlanToQuery);
            setData(results);
            try { sessionStorage.setItem(cacheKey, JSON.stringify({ data: results, ts: Date.now() })); } catch { /* quota exceeded */ }
        } catch (err: any) {
            console.error('[ResultadosPublic] Error:', err);
            if (retryCount === 0) {
                console.log('[ResultadosPublic] Retrying...');
                return loadResults(1);
            }
            setError(err.message || 'Error al cargar resultados');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadResults(); }, [selectedPeriod, refreshTrigger, effectivePlanToQuery]);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-20">
                <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                <p className="text-slate-300 font-medium">Cargando Resultados...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center py-16 text-center">
                <p className="text-red-400 mb-4 bg-red-900/20 px-4 py-2 rounded-lg border border-red-500/30">{error}</p>
                <button onClick={() => loadResults()} className="flex items-center gap-2 px-4 py-2 bg-slate-700 text-white font-bold rounded-xl hover:bg-slate-600 transition-all">
                    <ArrowPathIcon className="w-4 h-4" /> Reintentar
                </button>
            </div>
        );
    }

    const hasPickResults = data && data.totalVerified > 0;

    if (!hasPickResults) {
        return (
            <div className="space-y-6">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className="p-3 bg-gradient-to-br from-emerald-600 to-green-600 rounded-xl shadow-lg shadow-emerald-500/20">
                            <TrophyIcon className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h3 className="text-2xl font-bold text-white tracking-tight">Resultados</h3>
                            <p className="text-sm text-slate-400">Pronósticos verificados del sistema</p>
                        </div>
                    </div>
                    <PeriodFilters selectedPeriod={selectedPeriod} onSelect={setSelectedPeriod} onRefresh={() => loadResults()} />
                </div>
                {isAdmin ? (
                    <AdminPlanSelector selected={adminInspectPlan} onSelect={setAdminInspectPlan} />
                ) : !isPremium ? (
                    <UserPlanToggle
                        selected={viewMode}
                        onSelect={setViewMode}
                        myPlanDisplayName={PLAN_DISPLAY_NAMES[planName] || plan.display_name}
                    />
                ) : null}
                <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className="w-24 h-24 bg-slate-800/50 rounded-full flex items-center justify-center mb-6 border border-white/5">
                        <ChartBarIcon className="w-12 h-12 text-slate-600" />
                    </div>
                    <h3 className="text-xl font-bold text-white mb-2">Sin Resultados Verificados</h3>
                    <p className="text-slate-400 max-w-md leading-relaxed">
                        Los resultados aparecen cuando se verifican los pronósticos después de que los partidos terminan.
                    </p>
                </div>
            </div>
        );
    }

    const s = data!;
    const br = s.bankroll;

    const displayWon = s.won;
    const displayLost = s.lost;
    const displayTotal = displayWon + displayLost;
    const displayWinRate = displayTotal > 0 ? (displayWon / displayTotal) * 100 : 0;
    const displayPending = s.totalPending;

    // Plan que se está mostrando (para el banner del usuario)
    const previewPlan: PlanTier = isAdmin
        ? (adminInspectPlan === 'global' ? planName : (adminInspectPlan as PlanTier))
        : (effectivePlanToQuery === 'global' ? planName : (effectivePlanToQuery as PlanTier));

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="p-3 bg-gradient-to-br from-emerald-600 to-green-600 rounded-xl shadow-lg shadow-emerald-500/20">
                        <TrophyIcon className="w-6 h-6 text-white" />
                    </div>
                    <div>
                        <h3 className="text-2xl font-bold text-white tracking-tight">Resultados</h3>
                        <p className="text-sm text-slate-400">
                            {displayPending > 0
                                ? `${displayTotal} verificados de ${displayTotal + displayPending} pronósticos`
                                : 'Pronósticos verificados del sistema'}
                        </p>
                    </div>
                </div>
                <PeriodFilters selectedPeriod={selectedPeriod} onSelect={setSelectedPeriod} onRefresh={() => loadResults()} />
            </div>

            {/* Selector según rol */}
            {isAdmin ? (
                <AdminPlanSelector selected={adminInspectPlan} onSelect={setAdminInspectPlan} />
            ) : !isPremium ? (
                <UserPlanToggle
                    selected={viewMode}
                    onSelect={setViewMode}
                    myPlanDisplayName={PLAN_DISPLAY_NAMES[planName] || plan.display_name}
                />
            ) : null}

            {/* Banner contextual */}
            {isAdmin ? (
                <div className="px-4 py-2 rounded-lg bg-slate-800/50 border border-white/5 text-xs text-slate-400">
                    <span className="font-semibold text-emerald-400">Vista Admin</span> — inspeccionando{' '}
                    <span className="text-white font-bold">
                        {adminInspectPlan === 'global'
                            ? 'Global (todos los picks)'
                            : (PLAN_OPTIONS.find(p => p.value === adminInspectPlan)?.label || adminInspectPlan)}
                    </span>
                </div>
            ) : !isPremium ? (
                <PlanValueBanner
                    data={s}
                    planName={previewPlan}
                    planDisplayName={PLAN_DISPLAY_NAMES[previewPlan] || plan.display_name}
                    predictionsPercentage={PLAN_PREDICTIONS_PERCENTAGES[previewPlan] || plan.predictions_percentage}
                    isPreviewingMaquina={viewMode === 'maquina'}
                />
            ) : null}

            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-slate-900 border border-white/10 rounded-xl p-5 text-center">
                    <div className={`text-3xl font-black ${displayWinRate >= 55 ? 'text-emerald-400' : displayWinRate >= 45 ? 'text-amber-400' : 'text-red-400'}`}>
                        {displayWinRate.toFixed(1)}%
                    </div>
                    <span className="block text-xs text-slate-400 uppercase mt-1">Aciertos</span>
                    <div className="flex items-center justify-center gap-3 mt-2">
                        <span className="text-emerald-400 font-bold text-base">{displayWon} ganadas</span>
                        <span className="text-slate-600">|</span>
                        <span className="text-red-400 font-bold text-base">{displayLost} perdidas</span>
                    </div>
                    <span className="block text-xs text-slate-500 mt-1">de {displayTotal} verificadas</span>
                    {displayPending > 0 && (
                        <span className="block text-xs text-amber-400 mt-1">
                            {displayPending} pendiente{displayPending > 1 ? 's' : ''}
                        </span>
                    )}
                </div>

                {br && (
                    <div className="bg-slate-900 border border-white/10 rounded-xl p-5 text-center">
                        <div className={`text-3xl font-black ${(br.periodProfit ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {(br.periodProfit ?? 0) >= 0 ? '+' : ''}${(br.periodProfit ?? 0).toFixed(2)}
                        </div>
                        <span className="block text-xs text-slate-400 uppercase mt-1">Resultado</span>
                        <span className="block text-xs text-slate-500 mt-0.5">
                            ${(br.periodStaked ?? 0).toFixed(0)} apostado
                        </span>
                    </div>
                )}

                {br && (
                    <div className="bg-slate-900 border border-white/10 rounded-xl p-5 text-center">
                        <div className={`text-3xl font-black ${(br.periodROI ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {(br.periodROI ?? 0) >= 0 ? '+' : ''}{(br.periodROI ?? 0).toFixed(1)}%
                        </div>
                        <span className="block text-xs text-slate-400 uppercase mt-1">Rentabilidad</span>
                        <span className="block text-xs text-slate-500 mt-0.5">
                            Rendimiento del periodo
                        </span>
                    </div>
                )}

                {br && (
                    <div className="bg-slate-900 border border-white/10 rounded-xl p-5 text-center">
                        <div className="text-3xl font-black text-white">
                            ${br.current.toFixed(2)}
                        </div>
                        <span className="block text-xs text-slate-400 uppercase mt-1">Capital Actual</span>
                        <span className="block text-xs text-slate-500 mt-0.5">
                            {STAKING_LABEL}
                        </span>
                    </div>
                )}
            </div>

            {/* Professional Metrics Row */}
            {(s.units || s.maxDrawdown !== undefined || s.avgOdds) && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                    {s.units && (
                        <div className="bg-slate-800/50 border border-white/5 rounded-lg p-3 text-center">
                            <div className={`text-lg font-bold ${s.units.periodYield >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {s.units.periodYield >= 0 ? '+' : ''}{s.units.periodYield.toFixed(1)}%
                            </div>
                            <span className="text-[10px] text-slate-500 uppercase">Yield</span>
                        </div>
                    )}
                    {s.units && (
                        <div className="bg-slate-800/50 border border-white/5 rounded-lg p-3 text-center">
                            <div className={`text-lg font-bold ${s.units.periodUnitsProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {s.units.periodUnitsProfit >= 0 ? '+' : ''}{s.units.periodUnitsProfit.toFixed(1)}u
                            </div>
                            <span className="text-[10px] text-slate-500 uppercase">Profit (u)</span>
                        </div>
                    )}
                    {s.maxDrawdown !== undefined && (
                        <div className="bg-slate-800/50 border border-white/5 rounded-lg p-3 text-center">
                            <div className={`text-lg font-bold ${s.maxDrawdown > 10 ? 'text-red-400' : s.maxDrawdown > 5 ? 'text-amber-400' : 'text-emerald-400'}`}>
                                -{s.maxDrawdown.toFixed(1)}%
                            </div>
                            <span className="text-[10px] text-slate-500 uppercase">Max Drawdown</span>
                        </div>
                    )}
                    {(s.bestStreak || s.worstStreak) && (
                        <div className="bg-slate-800/50 border border-white/5 rounded-lg p-3 text-center">
                            <div className="flex items-center justify-center gap-2">
                                <span className="text-emerald-400 font-bold text-lg">{s.bestStreak || 0}</span>
                                <span className="text-slate-600">/</span>
                                <span className="text-red-400 font-bold text-lg">{s.worstStreak || 0}</span>
                            </div>
                            <span className="text-[10px] text-slate-500 uppercase">Rachas W/L</span>
                        </div>
                    )}
                    {s.avgOdds !== undefined && s.avgOdds > 0 && (
                        <div className="bg-slate-800/50 border border-white/5 rounded-lg p-3 text-center">
                            <div className="text-lg font-bold text-amber-400">
                                @{s.avgOdds.toFixed(2)}
                            </div>
                            <span className="text-[10px] text-slate-500 uppercase">Odds Prom</span>
                        </div>
                    )}
                </div>
            )}

            {/* Acumulado Banner */}
            {br && (
                <div className="bg-gradient-to-r from-slate-900 to-slate-800 border border-white/10 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-3 text-sm">
                        <span className="text-slate-500">Acumulado desde inicio:</span>
                        <span className={`font-bold ${br.profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {br.profit >= 0 ? '+' : ''}${br.profit.toFixed(2)} ({br.roi >= 0 ? '+' : ''}{br.roi.toFixed(1)}%)
                        </span>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                        <span className="text-slate-500">Capital: <span className="text-white font-bold">${br.base}</span></span>
                        <span className="text-slate-500">Stake: <span className="text-white font-bold">{STAKING_LABEL}</span></span>
                    </div>
                </div>
            )}

            {/* Recent Pick Results */}
            {s.recentResults.length > 0 && (
                <div className="bg-slate-900 border border-white/10 rounded-xl overflow-hidden">
                    <div className="p-4 border-b border-white/5">
                        <h4 className="text-white font-bold">Resultados Recientes — Pronósticos</h4>
                    </div>
                    <div className="divide-y divide-white/5">
                        {s.recentResults.map((pick) => (
                            <div key={pick.id} className={`p-4 flex items-center justify-between ${pick.result === 'LOST' ? 'opacity-60' : ''}`}>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                        <ResultIcon result={pick.result} />
                                        <span className="text-white font-medium text-sm truncate">
                                            {pick.home_team} vs {pick.away_team}
                                        </span>
                                        {pick.actual_score && (
                                            <span className="text-slate-500 text-xs">({pick.actual_score})</span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2 text-xs">
                                        <span className="text-slate-500">{translateMarket(pick.market)}</span>
                                        <span className="text-slate-400 font-medium">{pick.selection}</span>
                                        {pick.league && <span className="text-slate-600">{'•'} {pick.league}</span>}
                                        {pick.match_date && <span className="text-slate-600">{'•'} {pick.match_date}</span>}
                                    </div>
                                </div>
                                <div className="text-right ml-4 flex-shrink-0">
                                    <span className={`font-bold text-sm block ${pick.profit_loss >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                        {pick.profit_loss >= 0 ? '+' : ''}${pick.profit_loss.toFixed(0)}
                                    </span>
                                    <span className="text-slate-500 text-[10px]">
                                        {pick.units ? `${pick.units}u` : ''}{pick.odds ? ` @${pick.odds.toFixed(2)}` : ''}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

// ─── Selectores ──────────────────────────────────────────────

const AdminPlanSelector: React.FC<{
    selected: AdminInspectPlan;
    onSelect: (p: AdminInspectPlan) => void;
}> = ({ selected, onSelect }) => (
    <div className="flex items-center bg-slate-800 rounded-lg border border-white/10 p-0.5 flex-wrap">
        {PLAN_OPTIONS.map(opt => (
            <button
                key={opt.value}
                onClick={() => onSelect(opt.value)}
                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                    selected === opt.value
                        ? 'bg-emerald-500/20 text-emerald-300 shadow-sm'
                        : 'text-slate-400 hover:text-white'
                }`}
            >
                {opt.label}
            </button>
        ))}
    </div>
);

const UserPlanToggle: React.FC<{
    selected: ViewMode;
    onSelect: (m: ViewMode) => void;
    myPlanDisplayName: string;
}> = ({ selected, onSelect, myPlanDisplayName }) => (
    <div className="flex items-center bg-slate-800 rounded-lg border border-white/10 p-0.5">
        <button
            onClick={() => onSelect('plan')}
            className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${
                selected === 'plan'
                    ? 'bg-emerald-500/20 text-emerald-300 shadow-sm'
                    : 'text-slate-400 hover:text-white'
            }`}
        >
            Mi Plan ({myPlanDisplayName})
        </button>
        <button
            onClick={() => onSelect('maquina')}
            className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${
                selected === 'maquina'
                    ? 'bg-emerald-500/20 text-emerald-300 shadow-sm'
                    : 'text-slate-400 hover:text-white'
            }`}
        >
            Plan Máquina
        </button>
    </div>
);

const PlanValueBanner: React.FC<{
    data: PublicResultsData;
    planName: PlanTier;
    planDisplayName: string;
    predictionsPercentage: number;
    isPreviewingMaquina: boolean;
}> = ({ data, planName, planDisplayName, predictionsPercentage, isPreviewingMaquina }) => {
    const br = data.bankroll;
    const periodProfit = br?.periodProfit ?? 0;
    const isPositive = periodProfit >= 0;
    const upgradePlan = getRecommendedUpgradePlan(planName);
    const upgradeDisplayName = upgradePlan ? (PLAN_DISPLAY_NAMES[upgradePlan as PlanTier] || upgradePlan) : null;

    return (
        <div className={`rounded-xl border p-4 ${
            isPositive
                ? 'bg-emerald-500/5 border-emerald-500/20'
                : 'bg-red-500/5 border-red-500/20'
        }`}>
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${isPositive ? 'bg-emerald-500/20' : 'bg-red-500/20'}`}>
                        <ChartBarIcon className={`w-5 h-5 ${isPositive ? 'text-emerald-400' : 'text-red-400'}`} />
                    </div>
                    <div>
                        <h4 className="text-white font-bold text-sm">
                            {isPreviewingMaquina ? 'Vista previa: Plan Máquina' : `Tu Plan ${planDisplayName}`}
                            <span className="text-slate-500 font-normal ml-2 text-xs">
                                {predictionsPercentage >= 100 ? '100%' : predictionsPercentage <= 1 ? '1 pick/dia' : `${predictionsPercentage}%`} de los picks
                            </span>
                        </h4>
                        <div className="flex items-center gap-4 mt-1">
                            <span className={`font-bold text-lg ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                                {isPositive ? '+' : ''}${periodProfit.toFixed(2)}
                            </span>
                            <span className="text-slate-400 text-xs">
                                {data.winRate.toFixed(1)}% aciertos
                            </span>
                            <span className="text-slate-400 text-xs">
                                {data.totalVerified} picks
                            </span>
                        </div>
                    </div>
                </div>
                {!isPreviewingMaquina && upgradePlan && upgradeDisplayName && (
                    <a
                        href="/app/pricing"
                        className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors font-medium whitespace-nowrap"
                    >
                        Desbloquea más con {upgradeDisplayName} →
                    </a>
                )}
            </div>
        </div>
    );
};

// ─── Sub-components ──────────────────────────────────────────

const PeriodFilters: React.FC<{ selectedPeriod: PeriodKey; onSelect: (p: PeriodKey) => void; onRefresh: () => void }> = ({ selectedPeriod, onSelect, onRefresh }) => (
    <div className="flex items-center gap-2 flex-wrap">
        {PERIODS.map(p => (
            <button
                key={p.key}
                onClick={() => onSelect(p.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                    selectedPeriod === p.key
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                        : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
                }`}
            >
                {p.label}
            </button>
        ))}
        <button onClick={onRefresh} className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors">
            <ArrowPathIcon className="w-5 h-5" />
        </button>
    </div>
);

const ResultIcon: React.FC<{ result: PickResult }> = ({ result }) => {
    if (result === 'WON') {
        return (
            <span className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                <svg className="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
            </span>
        );
    }
    if (result === 'LOST') {
        return (
            <span className="w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
                <svg className="w-3 h-3 text-red-400" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
            </span>
        );
    }
    return (
        <span className="w-5 h-5 rounded-full bg-slate-500/20 flex items-center justify-center flex-shrink-0">
            <span className="w-2 h-0.5 bg-slate-400 rounded"></span>
        </span>
    );
};

const translateMarket = (market: string): string => {
    const translations: Record<string, string> = {
        'over_0.5_goals': '+0.5 Goles',
        'over_1.5_goals': '+1.5 Goles',
        'over_2.5_goals': '+2.5 Goles',
        'over_3.5_goals': '+3.5 Goles',
        'btts_yes': 'Ambos Anotan',
        'btts_no': 'Ambos No Anotan',
        'home_win': 'Gana Local',
        'away_win': 'Gana Visitante',
        'draw': 'Empate',
        'double_chance_1x': 'Local o Empate',
        'double_chance_x2': 'Empate o Visitante',
        'home_over_0.5': 'Local Anota',
        'away_over_0.5': 'Visita Anota',
    };
    return translations[market] || market.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
};

export default ResultadosPublic;
