// components/recap/DailyRecapModal.tsx
// Daily Performance Recap modal — shows yesterday's results, tiered by subscription plan.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
    XMarkIcon,
    TrophyIcon,
    ChartBarIcon,
    CheckCircleIcon,
    XCircleIcon,
    LockClosedIcon,
    ArrowRightIcon,
    TrendingUpIcon,
    BoltIcon,
} from '../icons/Icons';
import type { DailyRecapData, RecapTier } from '../../types';

interface DailyRecapModalProps {
    data: DailyRecapData;
    tier: RecapTier;
    onDismiss: () => void;
    onUpgrade: () => void;
    onViewResults?: () => void;
}

// --- Animated Counter ---
const AnimatedCounter: React.FC<{ value: number; suffix?: string; decimals?: number }> = ({ value, suffix = '', decimals = 0 }) => {
    const [display, setDisplay] = useState(0);

    useEffect(() => {
        const duration = 1200;
        const steps = 40;
        const increment = value / steps;
        let current = 0;
        let step = 0;

        const timer = setInterval(() => {
            step++;
            current += increment;
            if (step >= steps) {
                setDisplay(value);
                clearInterval(timer);
            } else {
                setDisplay(current);
            }
        }, duration / steps);

        return () => clearInterval(timer);
    }, [value]);

    return <>{decimals > 0 ? display.toFixed(decimals) : Math.round(display)}{suffix}</>;
};

// --- Format market name for display ---
function formatMarketName(market: string): string {
    const map: Record<string, string> = {
        'match_result': 'Resultado',
        'over_under': 'Over/Under',
        'btts': 'BTTS',
        'double_chance': 'Doble Chance',
        'over_2.5_goals': 'Over 2.5',
        'under_2.5_goals': 'Under 2.5',
        'btts_yes': 'Ambos Anotan',
        'btts_no': 'No Ambos Anotan',
        'result_btts': 'Resultado + BTTS',
        'result_total': 'Resultado + Total',
    };
    return map[market] || market.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// --- Format date for header ---
function formatRecapDate(dateStr: string): string {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
}

// --- Stat Card ---
const StatCard: React.FC<{
    label: string;
    value: number;
    suffix?: string;
    decimals?: number;
    color: string;
    icon: React.ReactNode;
    delay: number;
}> = ({ label, value, suffix, decimals, color, icon, delay }) => (
    <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.9 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ delay, type: 'spring', stiffness: 300, damping: 25 }}
        className={`flex flex-col items-center p-3 rounded-xl border ${color} backdrop-blur-sm`}
    >
        <div className="mb-1 opacity-70">{icon}</div>
        <div className="text-xl font-bold font-display">
            <AnimatedCounter value={value} suffix={suffix} decimals={decimals} />
        </div>
        <div className="text-[11px] text-dx-text-soft mt-0.5">{label}</div>
    </motion.div>
);

// --- MAIN MODAL ---
export const DailyRecapModal: React.FC<DailyRecapModalProps> = ({
    data,
    tier,
    onDismiss,
    onUpgrade,
    onViewResults,
}) => {
    const isAtLeast = (min: RecapTier) => {
        const order: RecapTier[] = ['free', 'starter', 'pro', 'premium', 'admin'];
        return order.indexOf(tier) >= order.indexOf(min);
    };

    // Pending-only state
    if (data.totalPicks === 0 && data.totalPending > 0) {
        return createPortal(
            <AnimatePresence>
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 bg-black/90 z-[100] flex items-center justify-center p-4 backdrop-blur-md"
                    onClick={onDismiss}
                >
                    <motion.div
                        initial={{ opacity: 0, y: 40 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 20 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                        className="bg-dx-surface rounded-2xl border border-dx-border max-w-md w-full shadow-2xl overflow-hidden"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="p-6 text-center">
                            <div className="w-12 h-12 rounded-full bg-dx-gold/20 flex items-center justify-center mx-auto mb-4">
                                <ChartBarIcon className="w-6 h-6 text-dx-gold" />
                            </div>
                            <h3 className="text-lg font-bold text-white mb-2">Resultados en Verificación</h3>
                            <p className="text-dx-text-soft text-sm">
                                Ayer tuvimos <span className="text-white font-semibold">{data.totalPending} pronósticos</span> que están siendo verificados. Los resultados estarán disponibles pronto.
                            </p>
                            <button
                                onClick={onDismiss}
                                className="mt-6 px-6 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-dx-text-soft text-sm font-medium transition-colors"
                            >
                                Entendido
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            </AnimatePresence>,
            document.body
        );
    }

    // --- BAD DAY MODE ---
    if (data.isBadDay) {
        return createPortal(
            <AnimatePresence>
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 bg-black/90 z-[100] flex items-center justify-center p-4 backdrop-blur-md"
                    onClick={onDismiss}
                >
                    <motion.div
                        initial={{ opacity: 0, y: 40 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 20 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                        className="bg-dx-surface rounded-2xl border border-dx-border max-w-md w-full shadow-2xl overflow-hidden"
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="px-6 pt-6 pb-4 border-b border-dx-border">
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                    <ChartBarIcon className="w-5 h-5 text-dx-text-soft" />
                                    <span className="text-xs text-dx-text-mute font-medium uppercase tracking-wider">Recap</span>
                                </div>
                                <button onClick={onDismiss} className="text-dx-text-mute hover:text-white transition-colors">
                                    <XMarkIcon className="w-5 h-5" />
                                </button>
                            </div>
                            <p className="text-dx-text-soft text-sm">
                                Ayer: <span className="text-white font-semibold">{data.won} de {data.totalPicks}</span> picks ({data.winRate.toFixed(0)}% WR)
                            </p>
                        </div>

                        {/* Business Perspective */}
                        {data.periodStats && (
                            <div className="px-6 py-5">
                                <div className="flex items-center gap-2 mb-4">
                                    <TrendingUpIcon className="w-4 h-4 text-dx-green" />
                                    <h4 className="text-sm font-semibold text-white">Perspectiva de Negocio</h4>
                                </div>

                                <div className="space-y-2.5">
                                    {[
                                        { label: 'Últimos 7 días', stats: data.periodStats.days7 },
                                        { label: 'Últimos 15 días', stats: data.periodStats.days15 },
                                        { label: 'Último mes', stats: data.periodStats.days30 },
                                    ].map(({ label, stats }) => (
                                        <motion.div
                                            key={label}
                                            initial={{ opacity: 0, x: -10 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            transition={{ delay: 0.3 }}
                                            className="flex items-center justify-between px-4 py-3 rounded-xl bg-white/[0.03] border border-dx-border"
                                        >
                                            <span className="text-xs text-dx-text-soft">{label}</span>
                                            <div className="flex items-center gap-4">
                                                <span className={`text-sm font-semibold ${stats.winRate >= 60 ? 'text-dx-green' : stats.winRate >= 50 ? 'text-dx-gold' : 'text-dx-text-soft'}`}>
                                                    {stats.total > 0 ? `${stats.winRate.toFixed(0)}% WR` : 'Sin datos'}
                                                </span>
                                                {stats.total > 0 && (
                                                    <span className={`text-sm font-semibold ${stats.roi >= 0 ? 'text-dx-green' : 'text-dx-loss'}`}>
                                                        {stats.roi >= 0 ? '+' : ''}{stats.roi.toFixed(1)}% ROI
                                                    </span>
                                                )}
                                            </div>
                                        </motion.div>
                                    ))}
                                </div>

                                <motion.p
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    transition={{ delay: 0.6 }}
                                    className="mt-5 text-xs text-dx-text-mute italic leading-relaxed text-center"
                                >
                                    "Los días difíciles son parte del negocio. La rentabilidad se mide en bloques, no en jornadas aisladas."
                                </motion.p>
                            </div>
                        )}

                        {/* Actions */}
                        <div className="px-6 pb-6 flex gap-3">
                            {onViewResults && (
                                <button
                                    onClick={() => { onDismiss(); onViewResults(); }}
                                    className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-dx-text-soft text-sm font-medium transition-colors"
                                >
                                    Ver Resultados
                                </button>
                            )}
                            <button
                                onClick={onDismiss}
                                className="flex-1 px-4 py-2.5 rounded-xl bg-dx-green/10 hover:bg-dx-green/20 text-dx-green text-sm font-medium transition-colors border border-dx-green/20"
                            >
                                Cerrar
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            </AnimatePresence>,
            document.body
        );
    }

    // --- NORMAL MODE (Good Day) ---
    // Determine how many picks to show based on tier
    const maxPicks = tier === 'free' ? 0 : tier === 'starter' ? 3 : data.winningPicks.length;
    const visiblePicks = data.winningPicks.slice(0, maxPicks);
    const hiddenCount = data.winningPicks.length - visiblePicks.length;

    return createPortal(
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/90 z-[100] flex items-center justify-center p-4 backdrop-blur-md"
                onClick={onDismiss}
            >
                <motion.div
                    initial={{ opacity: 0, y: 40 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 20 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                    className="bg-dx-surface rounded-2xl border border-dx-border max-w-lg w-full max-h-[85vh] overflow-y-auto shadow-2xl"
                    onClick={e => e.stopPropagation()}
                >
                    {/* --- HEADER --- */}
                    <div className="relative px-6 pt-6 pb-5 border-b border-dx-border overflow-hidden">
                        <div className="absolute inset-0 bg-gradient-to-br from-dx-green/10 via-transparent to-dx-cyan/5" />
                        <div className="relative">
                            <div className="flex items-center justify-between mb-1">
                                <div className="flex items-center gap-2">
                                    <TrophyIcon className="w-5 h-5 text-dx-green" />
                                    <span className="text-xs text-dx-green/80 font-semibold uppercase tracking-wider">Recap del Día</span>
                                </div>
                                <button onClick={onDismiss} className="text-dx-text-mute hover:text-white transition-colors">
                                    <XMarkIcon className="w-5 h-5" />
                                </button>
                            </div>
                            <h2 className="text-lg font-bold text-white font-display">{formatRecapDate(data.date)}</h2>
                        </div>
                    </div>

                    {/* --- STATS GRID --- */}
                    <div className="px-6 pt-5 pb-4">
                        <div className="grid grid-cols-4 gap-2.5">
                            <StatCard
                                label="Picks"
                                value={data.totalPicks}
                                color="bg-dx-surface-2/60 border-dx-border"
                                icon={<ChartBarIcon className="w-4 h-4 text-dx-text-soft" />}
                                delay={0.15}
                            />
                            <StatCard
                                label="Win Rate"
                                value={data.winRate}
                                suffix="%"
                                decimals={0}
                                color="bg-dx-green/40 border-dx-green/10"
                                icon={<BoltIcon className="w-4 h-4 text-dx-green" />}
                                delay={0.25}
                            />
                            <StatCard
                                label="Ganados"
                                value={data.won}
                                color="bg-dx-green/40 border-dx-green/10"
                                icon={<CheckCircleIcon className="w-4 h-4 text-dx-green" />}
                                delay={0.35}
                            />
                            <StatCard
                                label="Perdidos"
                                value={data.lost}
                                color="bg-dx-loss/30 border-dx-loss/10"
                                icon={<XCircleIcon className="w-4 h-4 text-dx-loss" />}
                                delay={0.45}
                            />
                        </div>
                    </div>

                    {/* --- BANKROLL (starter+) --- */}
                    {isAtLeast('starter') && data.profit !== undefined && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 0.5 }}
                            className="mx-6 mb-4 px-4 py-3 rounded-xl bg-white/[0.03] border border-dx-border"
                        >
                            <div className="flex items-center justify-between">
                                <span className="text-xs text-dx-text-soft">Rendimiento del día</span>
                                <div className="flex items-center gap-3">
                                    <span className={`text-sm font-bold ${data.profit >= 0 ? 'text-dx-green' : 'text-dx-loss'}`}>
                                        {data.profit >= 0 ? '+' : ''}{data.profit.toFixed(2)}u
                                    </span>
                                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${data.roi >= 0 ? 'bg-dx-green/10 text-dx-green' : 'bg-dx-loss/10 text-dx-loss'}`}>
                                        {data.roi >= 0 ? '+' : ''}{data.roi.toFixed(1)}% ROI
                                    </span>
                                </div>
                            </div>
                            {/* Profit bar */}
                            <div className="mt-2 h-1.5 rounded-full bg-dx-surface-2 overflow-hidden">
                                <motion.div
                                    initial={{ width: 0 }}
                                    animate={{ width: `${Math.min(Math.abs(data.roi), 100)}%` }}
                                    transition={{ delay: 0.7, duration: 0.8, ease: 'easeOut' }}
                                    className={`h-full rounded-full ${data.profit >= 0 ? 'bg-dx-green' : 'bg-dx-loss'}`}
                                />
                            </div>
                        </motion.div>
                    )}

                    {/* --- ROI HINT (free only) --- */}
                    {tier === 'free' && data.roi > 0 && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 0.5 }}
                            className="mx-6 mb-4 px-4 py-3 rounded-xl bg-dx-green/30 border border-dx-green/10"
                        >
                            <p className="text-xs text-dx-green/80">
                                Nuestros usuarios Pro ganaron <span className="font-bold text-dx-green">+{data.roi.toFixed(1)}% ROI</span> ayer
                            </p>
                        </motion.div>
                    )}

                    {/* --- BEST PICK (all tiers) --- */}
                    {data.bestPick && (
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.55 }}
                            className="mx-6 mb-4"
                        >
                            <h4 className="text-xs text-dx-text-mute font-semibold uppercase tracking-wider mb-2">Mejor Pick del Día</h4>
                            <div className="relative px-4 py-3 rounded-xl bg-white/[0.03] border border-dx-border overflow-hidden">
                                <div className="flex items-center justify-between">
                                    <div className="flex-1">
                                        <p className="text-sm font-semibold text-white">
                                            {data.bestPick.home_team} vs {data.bestPick.away_team}
                                        </p>
                                        <div className={`flex items-center gap-2 mt-1 ${tier === 'free' ? 'blur-sm select-none' : ''}`}>
                                            <span className="text-xs text-dx-text-soft">{formatMarketName(data.bestPick.market)}</span>
                                            <span className="text-xs text-dx-text-mute">|</span>
                                            <span className="text-xs text-dx-text-soft">{data.bestPick.selection}</span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {data.bestPick.odds && (
                                            <span className="text-sm font-bold text-dx-gold">@{data.bestPick.odds.toFixed(2)}</span>
                                        )}
                                        <span className="text-xs font-bold text-dx-green bg-dx-green/10 px-2 py-0.5 rounded-full">
                                            +{data.bestPick.profit_loss.toFixed(2)}u
                                        </span>
                                    </div>
                                </div>
                                {/* Lock overlay for free */}
                                {tier === 'free' && (
                                    <div className="absolute inset-0 flex items-center justify-center bg-dx-surface/40 backdrop-blur-[1px] rounded-xl">
                                        <div className="flex items-center gap-1.5 text-dx-text-soft">
                                            <LockClosedIcon className="w-4 h-4" />
                                            <span className="text-xs font-medium">Actualiza tu plan</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    )}

                    {/* --- STREAK (starter+) --- */}
                    {isAtLeast('starter') && data.currentStreak.count > 1 && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 0.6 }}
                            className="mx-6 mb-4 flex items-center gap-2"
                        >
                            <BoltIcon className={`w-4 h-4 ${data.currentStreak.type === 'win' ? 'text-dx-green' : 'text-dx-loss'}`} />
                            <span className="text-xs text-dx-text-soft">
                                Racha actual: <span className={`font-bold ${data.currentStreak.type === 'win' ? 'text-dx-green' : 'text-dx-loss'}`}>
                                    {data.currentStreak.count}{data.currentStreak.type === 'win' ? 'W' : 'L'}
                                </span>
                            </span>
                        </motion.div>
                    )}

                    {/* --- WINNING PICKS (starter+) --- */}
                    {visiblePicks.length > 0 && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 0.65 }}
                            className="mx-6 mb-4"
                        >
                            <h4 className="text-xs text-dx-text-mute font-semibold uppercase tracking-wider mb-2">
                                Picks Ganadores ({data.won})
                            </h4>
                            <div className="space-y-1.5">
                                {visiblePicks.map((pick, i) => (
                                    <motion.div
                                        key={i}
                                        initial={{ opacity: 0, x: -10 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ delay: 0.7 + i * 0.08 }}
                                        className="flex items-center justify-between px-3 py-2 rounded-lg bg-white/[0.02] border border-dx-border"
                                    >
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs font-medium text-white truncate">
                                                {pick.home_team} vs {pick.away_team}
                                            </p>
                                            <p className="text-[11px] text-dx-text-mute truncate">
                                                {formatMarketName(pick.market)} — {pick.selection}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-2 ml-2 shrink-0">
                                            {pick.odds && <span className="text-xs text-dx-text-soft">@{pick.odds.toFixed(2)}</span>}
                                            <span className="text-xs font-semibold text-dx-green">+{pick.profit_loss.toFixed(2)}u</span>
                                        </div>
                                    </motion.div>
                                ))}
                            </div>
                            {hiddenCount > 0 && tier === 'starter' && (
                                <p className="mt-2 text-xs text-dx-text-mute text-center">
                                    +{hiddenCount} picks más disponibles en <button onClick={() => { onDismiss(); onUpgrade(); }} className="text-dx-green hover:underline font-medium">Pro</button>
                                </p>
                            )}
                        </motion.div>
                    )}

                    {/* --- MARKET INSIGHT (pro+) --- */}
                    {isAtLeast('pro') && data.bestMarket && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 0.8 }}
                            className="mx-6 mb-4 px-4 py-3 rounded-xl bg-dx-green/20 border border-dx-green/10"
                        >
                            <h4 className="text-xs text-dx-green/80 font-semibold uppercase tracking-wider mb-1">Mejor Mercado</h4>
                            <p className="text-sm text-white">
                                <span className="font-semibold">{formatMarketName(data.bestMarket.name)}</span>
                                <span className="text-dx-text-soft ml-2">
                                    {data.bestMarket.accuracy.toFixed(0)}% acierto
                                    {data.bestMarket.profit > 0 && (
                                        <span className="text-dx-green ml-2">+{data.bestMarket.profit.toFixed(2)}u</span>
                                    )}
                                </span>
                            </p>
                        </motion.div>
                    )}

                    {/* --- LEAGUE BREAKDOWN (premium) --- */}
                    {isAtLeast('premium') && data.leagueBreakdown && Object.keys(data.leagueBreakdown).length > 0 && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 0.85 }}
                            className="mx-6 mb-4"
                        >
                            <h4 className="text-xs text-dx-text-mute font-semibold uppercase tracking-wider mb-2">Por Liga</h4>
                            <div className="space-y-1">
                                {Object.entries(data.leagueBreakdown)
                                    .sort((a, b) => (b[1].won + b[1].lost) - (a[1].won + a[1].lost))
                                    .slice(0, 5)
                                    .map(([league, stats]) => (
                                        <div key={league} className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-white/[0.02]">
                                            <span className="text-xs text-dx-text-soft truncate flex-1">{league}</span>
                                            <span className={`text-xs font-semibold ml-2 ${stats.accuracy >= 60 ? 'text-dx-green' : stats.accuracy >= 50 ? 'text-dx-gold' : 'text-dx-loss'}`}>
                                                {stats.won}W/{stats.lost}L ({stats.accuracy.toFixed(0)}%)
                                            </span>
                                        </div>
                                    ))}
                            </div>
                        </motion.div>
                    )}

                    {/* --- BEST ODDS HIT (premium) --- */}
                    {isAtLeast('premium') && data.bestOddsHit && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 0.9 }}
                            className="mx-6 mb-4 px-4 py-3 rounded-xl bg-dx-gold/20 border border-dx-gold/10"
                        >
                            <h4 className="text-xs text-dx-gold/80 font-semibold uppercase tracking-wider mb-1">Mayor Cuota Acertada</h4>
                            <p className="text-sm text-white">
                                <span className="text-dx-gold font-bold">@{data.bestOddsHit.odds.toFixed(2)}</span>
                                <span className="text-dx-text-soft ml-2">{data.bestOddsHit.match}</span>
                            </p>
                            <p className="text-xs text-dx-text-mute mt-0.5">{formatMarketName(data.bestOddsHit.market)}</p>
                        </motion.div>
                    )}

                    {/* --- CALIBRATION (premium) --- */}
                    {isAtLeast('premium') && data.calibrationInsight && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 0.95 }}
                            className="mx-6 mb-4 px-4 py-2.5 rounded-xl bg-dx-green/20 border border-dx-green/10"
                        >
                            <p className="text-xs text-dx-green/80">{data.calibrationInsight}</p>
                        </motion.div>
                    )}

                    {/* --- UPGRADE CTA (free/starter) --- */}
                    {(tier === 'free' || tier === 'starter') && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 1.0 }}
                            className="mx-6 mb-4"
                        >
                            <button
                                onClick={() => { onDismiss(); onUpgrade(); }}
                                className="w-full px-4 py-3 rounded-xl bg-gradient-to-r from-dx-green/10 to-dx-cyan/10 border border-dx-green/20 hover:border-dx-green/40 transition-all group"
                            >
                                <div className="flex items-center justify-center gap-2">
                                    <span className="text-sm font-medium text-dx-green group-hover:text-dx-green">
                                        {tier === 'free'
                                            ? 'Desbloquea todos los picks y análisis'
                                            : `Ve los ${hiddenCount} picks restantes con Pro`}
                                    </span>
                                    <ArrowRightIcon className="w-4 h-4 text-dx-green group-hover:translate-x-0.5 transition-transform" />
                                </div>
                            </button>
                        </motion.div>
                    )}

                    {/* --- FOOTER --- */}
                    <div className="px-6 pb-6 pt-2">
                        <button
                            onClick={onDismiss}
                            className="w-full px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-dx-text-soft hover:text-white text-sm font-medium transition-colors"
                        >
                            Cerrar
                        </button>
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>,
        document.body
    );
};
