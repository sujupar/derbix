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
import { cleanPlanLabel } from '../../utils/planDisplay';

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

// Presentación: limpia etiquetas internas del marcador verificado (§10). Solo texto.
const formatScore = (raw?: string | null): string => {
    if (!raw) return '';
    return raw
        .replace(/Manual:\s*WON/i, 'Verificado: GANADA')
        .replace(/Manual:\s*LOST/i, 'Verificado: PERDIDA')
        .replace(/Manual:\s*VOID/i, 'Verificado: NULA');
};

// Presentación: traduce nombres de liga en inglés conocidos (§10). Solo texto.
const LEAGUE_ES: Record<string, string> = { 'Friendly International': 'Amistoso Internacional' };
const formatLeague = (l?: string): string => (l ? (LEAGUE_ES[l] || l) : '');

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
    // SubscriptionContext puede emitir plan.plan_name vacío en el primer render.
    // Fallback a 'free' para que filterPicksByPlan no reciba undefined.
    const planName = (plan.plan_name as PlanTier) || 'free';
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
                <div className="w-12 h-12 border-4 border-dx-green border-t-transparent rounded-full animate-spin mb-4"></div>
                <p className="text-dx-text-soft font-medium">Cargando Resultados...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center py-16 text-center">
                <p className="text-dx-loss mb-4 bg-dx-loss/10 px-4 py-2 rounded-lg border border-dx-loss/30">{error}</p>
                <button onClick={() => loadResults()} className="flex items-center gap-2 px-4 py-2 bg-dx-surface-2 text-white font-bold rounded-xl border border-dx-border hover:border-dx-border-active transition-all">
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
                        <div className="w-14 h-14 shrink-0 flex items-center justify-center bg-gradient-to-br from-dx-green-deep to-dx-green rounded-2xl shadow-lg shadow-dx-green-glow">
                            <TrophyIcon className="w-8 h-8 text-[#04140C]" />
                        </div>
                        <div>
                            <h3 className="text-2xl font-display font-bold text-white tracking-tight">Resultados</h3>
                            <p className="text-sm text-dx-text-soft">Pronósticos verificados del sistema</p>
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
                        myPlanDisplayName={cleanPlanLabel(PLAN_DISPLAY_NAMES[planName] || plan.display_name)}
                    />
                ) : null}
                <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className="w-24 h-24 bg-dx-surface rounded-full flex items-center justify-center mb-6 border border-dx-border">
                        <ChartBarIcon className="w-12 h-12 text-dx-text-mute" />
                    </div>
                    <h3 className="text-xl font-bold text-white mb-2">Sin Resultados Verificados</h3>
                    <p className="text-dx-text-soft max-w-md leading-relaxed">
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
                    <div className="p-3 bg-gradient-to-br from-dx-green-deep to-dx-green rounded-xl shadow-lg shadow-dx-green-glow">
                        <TrophyIcon className="w-6 h-6 text-[#04140C]" />
                    </div>
                    <div>
                        <h3 className="text-2xl font-display font-bold text-white tracking-tight">Resultados</h3>
                        <p className="text-sm text-dx-text-soft">
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
                    myPlanDisplayName={cleanPlanLabel(PLAN_DISPLAY_NAMES[planName] || plan.display_name)}
                />
            ) : null}

            {/* Banner contextual */}
            {isAdmin ? (
                <div className="px-4 py-2 rounded-lg bg-dx-surface-2 border border-dx-border text-xs text-dx-text-soft">
                    <span className="font-semibold text-dx-green">Vista Admin</span> — inspeccionando{' '}
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
                    planDisplayName={cleanPlanLabel(PLAN_DISPLAY_NAMES[previewPlan] || plan.display_name)}
                    predictionsPercentage={PLAN_PREDICTIONS_PERCENTAGES[previewPlan] || plan.predictions_percentage}
                    isPreviewingMaquina={viewMode === 'maquina'}
                />
            ) : null}

            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-dx-surface border border-dx-border rounded-xl p-5 text-center">
                    <div className={`text-3xl font-display font-black dx-num ${displayWinRate >= 55 ? 'text-dx-green' : displayWinRate >= 45 ? 'text-dx-gold' : 'text-dx-loss'}`}>
                        {displayWinRate.toFixed(1)}%
                    </div>
                    <span className="block text-xs text-dx-text-soft uppercase mt-1">Aciertos</span>
                    <div className="flex items-center justify-center gap-3 mt-2">
                        <span className="text-dx-green font-bold text-base dx-num">{displayWon} ganadas</span>
                        <span className="text-dx-text-mute">|</span>
                        <span className="text-dx-loss font-bold text-base dx-num">{displayLost} perdidas</span>
                    </div>
                    <span className="block text-xs text-dx-text-mute mt-1 dx-num">de {displayTotal} verificadas</span>
                    {displayPending > 0 && (
                        <span className="block text-xs text-dx-gold mt-1 dx-num">
                            {displayPending} pendiente{displayPending > 1 ? 's' : ''}
                        </span>
                    )}
                </div>

                {br && (
                    <div className="bg-dx-surface border border-dx-border rounded-xl p-5 text-center">
                        <div className={`text-3xl font-display font-black dx-num ${(br.periodProfit ?? 0) >= 0 ? 'text-dx-green' : 'text-dx-loss'}`}>
                            {(br.periodProfit ?? 0) >= 0 ? '+' : ''}${(br.periodProfit ?? 0).toFixed(2)}
                        </div>
                        <span className="block text-xs text-dx-text-soft uppercase mt-1">Resultado</span>
                        <span className="block text-xs text-dx-text-mute mt-0.5 dx-num">
                            ${(br.periodStaked ?? 0).toFixed(0)} apostado
                        </span>
                    </div>
                )}

                {br && (
                    <div className="bg-dx-surface border border-dx-border rounded-xl p-5 text-center">
                        <div className={`text-3xl font-display font-black dx-num ${(br.periodROI ?? 0) >= 0 ? 'text-dx-green' : 'text-dx-loss'}`}>
                            {(br.periodROI ?? 0) >= 0 ? '+' : ''}{(br.periodROI ?? 0).toFixed(1)}%
                        </div>
                        <span className="block text-xs text-dx-text-soft uppercase mt-1">Rentabilidad</span>
                        <span className="block text-xs text-dx-text-mute mt-0.5">
                            Rendimiento del periodo
                        </span>
                    </div>
                )}

                {br && (
                    <div className="bg-dx-surface border border-dx-border rounded-xl p-5 text-center">
                        <div className="text-3xl font-display font-black text-white dx-num">
                            ${br.current.toFixed(2)}
                        </div>
                        <span className="block text-xs text-dx-text-soft uppercase mt-1">Capital Actual</span>
                        <span className="block text-xs text-dx-text-mute mt-0.5">
                            {STAKING_LABEL}
                        </span>
                    </div>
                )}
            </div>

            {/* Professional Metrics Row */}
            {(s.units || s.maxDrawdown !== undefined || s.avgOdds) && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                    {s.units && (
                        <div className="bg-dx-surface-2 border border-dx-border rounded-lg p-3 text-center">
                            <div className={`text-lg font-bold dx-num ${s.units.periodYield >= 0 ? 'text-dx-green' : 'text-dx-loss'}`}>
                                {s.units.periodYield >= 0 ? '+' : ''}{s.units.periodYield.toFixed(1)}%
                            </div>
                            <span className="text-[10px] text-dx-text-mute uppercase">Rendimiento</span>
                        </div>
                    )}
                    {s.units && (
                        <div className="bg-dx-surface-2 border border-dx-border rounded-lg p-3 text-center">
                            <div className={`text-lg font-bold dx-num ${s.units.periodUnitsProfit >= 0 ? 'text-dx-green' : 'text-dx-loss'}`}>
                                {s.units.periodUnitsProfit >= 0 ? '+' : ''}{s.units.periodUnitsProfit.toFixed(1)}u
                            </div>
                            <span className="text-[10px] text-dx-text-mute uppercase">Ganancia (u)</span>
                        </div>
                    )}
                    {s.maxDrawdown !== undefined && (
                        <div className="bg-dx-surface-2 border border-dx-border rounded-lg p-3 text-center">
                            <div className={`text-lg font-bold dx-num ${s.maxDrawdown > 10 ? 'text-dx-loss' : s.maxDrawdown > 5 ? 'text-dx-gold' : 'text-dx-green'}`}>
                                -{s.maxDrawdown.toFixed(1)}%
                            </div>
                            <span className="text-[10px] text-dx-text-mute uppercase">Caída máx.</span>
                        </div>
                    )}
                    {(s.bestStreak || s.worstStreak) && (
                        <div className="bg-dx-surface-2 border border-dx-border rounded-lg p-3 text-center">
                            <div className="flex items-center justify-center gap-2">
                                <span className="text-dx-green font-bold text-lg dx-num">{s.bestStreak || 0}</span>
                                <span className="text-dx-text-mute">/</span>
                                <span className="text-dx-loss font-bold text-lg dx-num">{s.worstStreak || 0}</span>
                            </div>
                            <span className="text-[10px] text-dx-text-mute uppercase">Rachas G/P</span>
                        </div>
                    )}
                    {s.avgOdds !== undefined && s.avgOdds > 0 && (
                        <div className="bg-dx-surface-2 border border-dx-border rounded-lg p-3 text-center">
                            <div className="text-lg font-bold text-dx-gold dx-num">
                                @{s.avgOdds.toFixed(2)}
                            </div>
                            <span className="text-[10px] text-dx-text-mute uppercase">Cuota prom.</span>
                        </div>
                    )}
                </div>
            )}

            {/* Acumulado Banner */}
            {br && (
                <div className="bg-dx-surface border border-dx-border rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-3 text-sm">
                        <span className="text-dx-text-mute">Acumulado desde inicio:</span>
                        <span className={`font-bold dx-num ${br.profit >= 0 ? 'text-dx-green' : 'text-dx-loss'}`}>
                            {br.profit >= 0 ? '+' : ''}${br.profit.toFixed(2)} ({br.roi >= 0 ? '+' : ''}{br.roi.toFixed(1)}%)
                        </span>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                        <span className="text-dx-text-mute">Capital: <span className="text-white font-bold dx-num">${br.base}</span></span>
                        <span className="text-dx-text-mute">Stake: <span className="text-white font-bold">{STAKING_LABEL}</span></span>
                    </div>
                </div>
            )}

            {/* Recent Pick Results */}
            {s.recentResults.length > 0 && (
                <div className="bg-dx-surface border border-dx-border rounded-xl overflow-hidden">
                    <div className="p-4 border-b border-dx-border">
                        <h4 className="text-white font-bold">Resultados Recientes — Pronósticos</h4>
                    </div>
                    <div className="divide-y divide-dx-border">
                        {s.recentResults.map((pick) => (
                            <div key={pick.id} className={`p-4 flex items-center justify-between ${pick.result === 'LOST' ? 'opacity-60' : ''}`}>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                        <ResultIcon result={pick.result} />
                                        <span className="text-white font-medium text-sm truncate">
                                            {pick.home_team} vs {pick.away_team}
                                        </span>
                                        {pick.actual_score && (
                                            <span className="text-dx-text-mute text-xs dx-num">({formatScore(pick.actual_score)})</span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2 text-xs">
                                        <span className="text-dx-text-mute">{translateMarket(pick.market)}</span>
                                        <span className="text-dx-text-soft font-medium">{pick.selection}</span>
                                        {pick.league && <span className="text-dx-text-mute">{'•'} {formatLeague(pick.league)}</span>}
                                        {pick.match_date && <span className="text-dx-text-mute dx-num">{'•'} {pick.match_date}</span>}
                                    </div>
                                </div>
                                <div className="text-right ml-4 flex-shrink-0">
                                    <span className={`font-bold text-sm block dx-num ${pick.profit_loss >= 0 ? 'text-dx-green' : 'text-dx-loss'}`}>
                                        {pick.profit_loss >= 0 ? '+' : ''}${pick.profit_loss.toFixed(0)}
                                    </span>
                                    <span className="text-dx-text-mute text-[10px] dx-num">
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
    <div className="inline-flex items-center bg-dx-surface rounded-xl border border-dx-border p-1 flex-wrap gap-1">
        {PLAN_OPTIONS.map(opt => (
            <button
                key={opt.value}
                onClick={() => onSelect(opt.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    selected === opt.value
                        ? 'bg-dx-green/15 text-dx-green'
                        : 'text-dx-text-soft hover:text-white'
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
    <div className="inline-flex items-center bg-dx-surface rounded-xl border border-dx-border p-1 gap-1">
        <button
            onClick={() => onSelect('plan')}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                selected === 'plan'
                    ? 'bg-dx-green/15 text-dx-green'
                    : 'text-dx-text-soft hover:text-white'
            }`}
        >
            Mi Plan ({myPlanDisplayName})
        </button>
        <button
            onClick={() => onSelect('maquina')}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                selected === 'maquina'
                    ? 'bg-dx-green/15 text-dx-green'
                    : 'text-dx-text-soft hover:text-white'
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
                ? 'bg-dx-green/5 border-dx-green/20'
                : 'bg-dx-loss/5 border-dx-loss/20'
        }`}>
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${isPositive ? 'bg-dx-green/20' : 'bg-dx-loss/20'}`}>
                        <ChartBarIcon className={`w-5 h-5 ${isPositive ? 'text-dx-green' : 'text-dx-loss'}`} />
                    </div>
                    <div>
                        <h4 className="text-white font-bold text-sm">
                            {isPreviewingMaquina ? 'Vista previa: Plan Máquina' : `Tu Plan ${planDisplayName}`}
                            <span className="text-dx-text-mute font-normal ml-2 text-xs">
                                {predictionsPercentage >= 100 ? '100%' : predictionsPercentage <= 1 ? '1 pick/dia' : `${predictionsPercentage}%`} de los picks
                            </span>
                        </h4>
                        <div className="flex items-center gap-4 mt-1">
                            <span className={`font-bold text-lg dx-num ${isPositive ? 'text-dx-green' : 'text-dx-loss'}`}>
                                {isPositive ? '+' : ''}${periodProfit.toFixed(2)}
                            </span>
                            <span className="text-dx-text-soft text-xs dx-num">
                                {data.winRate.toFixed(1)}% aciertos
                            </span>
                            <span className="text-dx-text-soft text-xs dx-num">
                                {data.totalVerified} picks
                            </span>
                        </div>
                    </div>
                </div>
                {!isPreviewingMaquina && upgradePlan && upgradeDisplayName && (
                    <a
                        href="/app/pricing"
                        className="text-xs text-dx-green hover:text-dx-green-bright transition-colors font-medium whitespace-nowrap"
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
                        ? 'bg-dx-green/15 text-dx-green border-dx-green/40'
                        : 'bg-dx-surface text-dx-text-soft border-dx-border hover:text-white'
                }`}
            >
                {p.label}
            </button>
        ))}
        <button onClick={onRefresh} className="p-2 text-dx-text-soft hover:text-dx-green hover:bg-white/5 rounded-lg transition-colors">
            <ArrowPathIcon className="w-5 h-5" />
        </button>
    </div>
);

const ResultIcon: React.FC<{ result: PickResult }> = ({ result }) => {
    if (result === 'WON') {
        return (
            <span className="w-5 h-5 rounded-full bg-dx-green/20 flex items-center justify-center flex-shrink-0">
                <svg className="w-3 h-3 text-dx-green" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
            </span>
        );
    }
    if (result === 'LOST') {
        return (
            <span className="w-5 h-5 rounded-full bg-dx-loss/20 flex items-center justify-center flex-shrink-0">
                <svg className="w-3 h-3 text-dx-loss" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
            </span>
        );
    }
    return (
        <span className="w-5 h-5 rounded-full bg-white/5 flex items-center justify-center flex-shrink-0">
            <span className="w-2 h-0.5 bg-dx-text-mute rounded"></span>
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
