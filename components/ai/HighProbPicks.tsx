
// components/ai/HighProbPicks.tsx
// Componente para mostrar Oportunidades (Picks Individuales >= OPPORTUNITIES_THRESHOLD_PERCENT con cuota real)
// Updated: Removed Smart Parlays logic as per user request.

import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../services/supabaseService';
import { manualOverridePick } from '../../services/resultsService';
import { OPPORTUNITIES_THRESHOLD, OPPORTUNITIES_THRESHOLD_PERCENT } from '../../constants/opportunities';
import { translatePick } from '../../services/marketTranslator';
import { useAuth } from '../../hooks/useAuth';
import { useSubscription } from '../../contexts/SubscriptionContext';
import { isHistoricalDate, getAllowedPickCount } from '../../utils/planAccessUtils';
import { TrophyIcon, ChartBarIcon, ArrowPathIcon, ArrowTopRightOnSquareIcon, LockClosedIcon } from '../icons/Icons';
import { usePresentationMode } from '../../hooks/usePresentationMode';
import { isAgencyRole } from '../../utils/roles';
import { useOrganization } from '../../contexts/OrganizationContext';
import { getStakeUnits, getStakePercent, DEFAULT_STAKING_CONFIG } from '../../services/stakingService';

interface HighProbPick {
    id: string;
    job_id: string;
    fixture_id: number;
    market: string;
    selection: string;
    p_model: number;
    decision: string;
    home_team: string;
    away_team: string;
    league: string;
    odds: number;
    logo_home?: string;
    logo_away?: string;
    result?: string;
    verified_at?: string;
    actual_score?: string;
}

interface HighProbPicksProps {
    date: string;
    onViewReport?: (jobId: string, fixtureId: number) => void;
    onPickOverridden?: () => void;
    onAccessibleFixturesChange?: (fixtureIds: Set<number>) => void;
}

const HighProbPicks: React.FC<HighProbPicksProps> = ({ date, onViewReport, onPickOverridden, onAccessibleFixturesChange }) => {
    const { profile } = useAuth();
    const { plan, isAdmin: isSubAdmin, trackUsage } = useSubscription();
    const { presentationMode } = usePresentationMode();
    const { isImpersonating } = useOrganization();
    const isAdmin = (isSubAdmin || isAgencyRole(profile?.role)) && !isImpersonating;
    const [singles, setSingles] = useState<HighProbPick[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showLowOdds, setShowLowOdds] = useState(false);
    const [infoMessage, setInfoMessage] = useState<string | null>(null);
    const [inProgress, setInProgress] = useState(0);
    const [showUpgradePrompt, setShowUpgradePrompt] = useState(false);
    const [verificationFilter, setVerificationFilter] = useState<'all' | 'pending' | 'verified'>('all');
    const [matchScores, setMatchScores] = useState<Record<number, string>>({});
    const [analysisHealth, setAnalysisHealth] = useState<{ permanentFailed: number; pendingRetry: number }>({ permanentFailed: 0, pendingRetry: 0 });

    // Transparencia historica: fechas anteriores = todo visible
    const isHistorical = isHistoricalDate(date);

    const loadPicks = async (forceRegenerate = false) => {
        setIsLoading(true);
        setError(null);
        setInfoMessage(null);

        try {
            // FAST PATH: Read persisted opportunities directly from DB (stable on every refresh)
            // With STALENESS CHECK: if persisted < 20 and more eligible picks exist, regenerate
            if (!forceRegenerate) {
                console.log(`[HighProbPicks] Trying persisted opportunities for ${date}...`);
                const { data: persisted } = await supabase
                    .from('value_picks_v2')
                    .select('id, job_id, fixture_id, market, selection, p_model, odds, result, verified_at, actual_score, opportunity_rank')
                    .eq('is_opportunity', true)
                    .eq('opportunity_date', date)
                    .order('opportunity_rank', { ascending: true });

                if (persisted && persisted.length > 0) {
                    let usePersistedData = true;

                    // STALENESS CHECK: If we have fewer than 20, check if more picks are available
                    if (persisted.length < 20) {
                        const { data: todayMatches } = await supabase
                            .from('daily_matches')
                            .select('api_fixture_id')
                            .eq('match_date', date);
                        const todayFixtureIds = (todayMatches || []).map((m: any) => m.api_fixture_id);

                        if (todayFixtureIds.length > 0) {
                            const { count: eligibleCount } = await supabase
                                .from('value_picks_v2')
                                .select('id', { count: 'exact', head: true })
                                .in('fixture_id', todayFixtureIds)
                                .gte('p_model', OPPORTUNITIES_THRESHOLD);

                            if ((eligibleCount || 0) > persisted.length) {
                                console.log(`[HighProbPicks] Stale: ${persisted.length} persisted but ${eligibleCount} eligible → regenerating`);
                                usePersistedData = false; // Fall through to slow path
                            }
                        }
                    }

                    if (usePersistedData) {
                        console.log(`[HighProbPicks] Using ${persisted.length} persisted opportunities (fresh)`);
                        // Enrich with team names from daily_matches
                        const fids = [...new Set(persisted.map(p => p.fixture_id))];
                        const { data: matches } = await supabase
                            .from('daily_matches')
                            .select('api_fixture_id, home_team, away_team, league_name, home_team_logo, away_team_logo')
                            .in('api_fixture_id', fids);
                        const mmap = new Map<number, any>();
                        (matches || []).forEach((m: any) => mmap.set(m.api_fixture_id, m));

                        const picks: HighProbPick[] = persisted.map((p: any) => {
                            const m = mmap.get(p.fixture_id);
                            return {
                                id: p.id,
                                job_id: p.job_id || '',
                                fixture_id: p.fixture_id,
                                market: p.market,
                                selection: p.selection,
                                p_model: p.p_model > 1 ? p.p_model / 100 : p.p_model,
                                decision: 'ALTA',
                                odds: p.odds && p.odds > 1 ? p.odds : 0,
                                home_team: m?.home_team || 'Equipo',
                                away_team: m?.away_team || 'Equipo',
                                league: m?.league_name || '',
                                logo_home: m?.home_team_logo,
                                logo_away: m?.away_team_logo,
                                result: p.result || 'PENDING',
                                verified_at: p.verified_at,
                                actual_score: p.actual_score,
                            };
                        });
                        setSingles(picks);
                        setInProgress(0);
                        loadMatchScores(picks);
                        return; // Done — persisted data is fresh
                    }
                }
                if (!persisted || persisted.length === 0) {
                    console.log(`[HighProbPicks] No persisted opportunities, falling back to edge function`);
                }
            }

            // SLOW PATH: Generate via edge function (first time or force refresh)
            console.log(`[HighProbPicks] Requesting picks for date: ${date} (Force: ${forceRegenerate})`);

            const { data, error: fnError } = await supabase.functions.invoke('v2-generate-parlays', {
                body: { date, force_regenerate: forceRegenerate }
            });

            if (fnError) throw fnError;
            if (!data.success) {
                const backendError = data.error || 'Error fetching picks';
                throw new Error(backendError);
            }

            console.log('[HighProbPicks] Response:', data.stats);
            const newSingles = data.singles || [];
            setSingles(newSingles);
            setInProgress(data.stats?.in_progress || 0);
            loadMatchScores(newSingles);

            // Show info message if no picks but analysis exists or is in progress
            if ((!data.singles || data.singles.length === 0) && data.message) {
                setInfoMessage(data.message);
            }

        } catch (err: any) {
            console.error('[HighProbPicks] Error:', err);
            setError(typeof err === 'string' ? err : err.message || JSON.stringify(err));
        } finally {
            setIsLoading(false);
        }
    };

    // Load match scores from daily_matches for PENDING picks (admin verification aid)
    const loadMatchScores = async (picks: HighProbPick[]) => {
        if (!isAdmin) return;
        const pendingFixtureIds = [...new Set(picks.filter(p => !p.result || p.result === 'PENDING').map(p => p.fixture_id))];
        if (pendingFixtureIds.length === 0) return;

        try {
            const { data: matches } = await supabase
                .from('daily_matches')
                .select('api_fixture_id, home_score, away_score, match_status')
                .in('api_fixture_id', pendingFixtureIds);

            if (matches) {
                const scores: Record<number, string> = {};
                for (const m of matches) {
                    const finished = ['FT', 'AET', 'PEN'].includes(m.match_status || '');
                    if (finished && m.home_score !== null && m.away_score !== null) {
                        scores[m.api_fixture_id] = `${m.home_score}-${m.away_score}`;
                    }
                }
                setMatchScores(scores);
            }
        } catch (err) {
            console.error('[HighProbPicks] Error loading match scores:', err);
        }
    };

    useEffect(() => {
        loadPicks(false);
    }, [date]);

    // Load analysis health stats for the date (permanent failures + pending retries)
    useEffect(() => {
        let cancelled = false;
        const loadHealth = async () => {
            try {
                const { data: matches } = await supabase
                    .from('daily_matches')
                    .select('api_fixture_id')
                    .eq('match_date', date);
                const fixtureIds = (matches || []).map((m: any) => m.api_fixture_id);
                if (fixtureIds.length === 0) {
                    if (!cancelled) setAnalysisHealth({ permanentFailed: 0, pendingRetry: 0 });
                    return;
                }
                const [{ count: permCount }, { count: pendingCount }] = await Promise.all([
                    supabase.from('analysis_jobs_v2').select('id', { count: 'exact', head: true })
                        .in('fixture_id', fixtureIds).eq('permanent_failure', true),
                    supabase.from('analysis_jobs_v2').select('id', { count: 'exact', head: true })
                        .in('fixture_id', fixtureIds)
                        .in('status', ['etl', 'interpret', 'analyzing', 'retrying'])
                        .eq('permanent_failure', false)
                ]);
                if (!cancelled) {
                    setAnalysisHealth({ permanentFailed: permCount || 0, pendingRetry: pendingCount || 0 });
                }
            } catch (err) {
                console.warn('[HighProbPicks] health check failed:', err);
            }
        };
        loadHealth();
        return () => { cancelled = true; };
    }, [date]);

    // Filtering Logic: picks with odds >= 1.40 are "main", odds < 1.40 OR no odds are "low/complementary"
    const allMainPicks = singles.filter(p => p.odds && p.odds >= 1.40);
    const lowOddsPicks = singles.filter(p => !p.odds || p.odds < 1.40);

    // Verification filter (admin only)
    const pendingCount = allMainPicks.filter(p => !p.result || p.result === 'PENDING').length;
    const verifiedCount = allMainPicks.filter(p => p.result && p.result !== 'PENDING').length;

    const mainPicks = isAdmin && verificationFilter !== 'all'
        ? allMainPicks.filter(p => {
            const isPending = !p.result || p.result === 'PENDING';
            return verificationFilter === 'pending' ? isPending : !isPending;
        })
        : allMainPicks;

    // SUBSCRIPTION GATING: Calcular cuantos picks puede ver el usuario
    const allowedCount = useMemo(() => {
        if (isAdmin) return mainPicks.length; // Admins ven todo
        return getAllowedPickCount(mainPicks.length, plan.predictions_percentage, isHistorical);
    }, [mainPicks.length, plan.predictions_percentage, isHistorical, isAdmin]);

    const visiblePicks = mainPicks.slice(0, allowedCount);
    const lockedPicks = mainPicks.slice(allowedCount);
    const hasLockedPicks = lockedPicks.length > 0 && !isHistorical;

    // Report accessible fixture IDs to parent (LiveFeed) for unified gating
    useEffect(() => {
        if (!onAccessibleFixturesChange) return;
        const ids = new Set(visiblePicks.map(p => p.fixture_id));
        onAccessibleFixturesChange(ids);
    }, [visiblePicks.length, allowedCount, onAccessibleFixturesChange]);

    // Helpers UI — uses centralized marketTranslator (services/marketTranslator.ts).
    // Falls back to legacy snake_case keys for old picks; for V9 picks the translator
    // handles "Over/Under" + "Under 2.5" → "Más / Menos Goles" + "Menos de 2.5 goles".
    const translateMarket = (market: string, selection: string = ''): string => {
        const legacy: Record<string, string> = {
            'over_0.5_goals': 'Más de 0.5 Goles', 'over_1.5_goals': 'Más de 1.5 Goles',
            'over_2.5_goals': 'Más de 2.5 Goles', 'over_3.5_goals': 'Más de 3.5 Goles',
            'btts_yes': 'Ambos Anotan: Sí', 'btts_no': 'Ambos Anotan: No',
            'home_win': 'Gana Local', 'away_win': 'Gana Visitante', 'draw': 'Empate',
            'double_chance_1x': 'Local o Empate', 'double_chance_x2': 'Empate o Visitante',
            'home_over_0.5': 'Local Anota', 'away_over_0.5': 'Visita Anota',
        };
        if (legacy[market]) return legacy[market];
        return translatePick(market, selection).marketEs;
    };

    if (isLoading) return <LoadingState />;
    if (error) return <ErrorState error={error} onRetry={() => loadPicks(true)} />;

    return (
        <div className="space-y-8">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="p-3 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl shadow-lg shadow-blue-500/20">
                        <ChartBarIcon className="w-6 h-6 text-white" />
                    </div>
                    <div>
                        <h3 className="text-xl sm:text-2xl font-bold text-white tracking-tight">Oportunidades de Valor</h3>
                        <p className="text-sm text-slate-400">Picks Individuales (Prob {'\u2265'} {OPPORTUNITIES_THRESHOLD_PERCENT}%)</p>
                    </div>
                </div>
                
                <div className="flex items-center gap-2">
                    {/* Admin verification filter */}
                    {isAdmin && allMainPicks.length > 0 && (
                        <div className="flex items-center bg-slate-800/50 rounded-lg border border-white/5 p-0.5">
                            <button
                                onClick={() => setVerificationFilter('all')}
                                className={`px-3 py-2 sm:px-2.5 sm:py-1.5 rounded-md text-xs min-h-[44px] sm:min-h-0 font-bold transition-all ${
                                    verificationFilter === 'all' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
                                }`}
                            >
                                Todos ({allMainPicks.length})
                            </button>
                            <button
                                onClick={() => setVerificationFilter('pending')}
                                className={`px-3 py-2 sm:px-2.5 sm:py-1.5 rounded-md text-xs min-h-[44px] sm:min-h-0 font-bold transition-all ${
                                    verificationFilter === 'pending' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'text-slate-400 hover:text-white'
                                }`}
                            >
                                Pendientes ({pendingCount})
                            </button>
                            <button
                                onClick={() => setVerificationFilter('verified')}
                                className={`px-3 py-2 sm:px-2.5 sm:py-1.5 rounded-md text-xs min-h-[44px] sm:min-h-0 font-bold transition-all ${
                                    verificationFilter === 'verified' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'text-slate-400 hover:text-white'
                                }`}
                            >
                                Verificados ({verifiedCount})
                            </button>
                        </div>
                    )}

                    <button onClick={() => loadPicks(true)} className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors" title="Actualizar Oportunidades">
                        <ArrowPathIcon className="w-5 h-5" />
                    </button>
                </div>
            </div>

            {/* Analysis health banners (visible to all users for transparency) */}
            {(analysisHealth.pendingRetry > 0 || analysisHealth.permanentFailed > 0) && (
                <div className="space-y-2">
                    {analysisHealth.pendingRetry > 0 && (
                        <div className="flex items-center gap-3 bg-blue-900/20 border border-blue-500/30 rounded-lg px-4 py-3">
                            <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin flex-shrink-0"></div>
                            <p className="text-sm text-blue-200">
                                <span className="font-bold">{analysisHealth.pendingRetry} partidos</span> en análisis o reintento automático. Las oportunidades aparecerán cuando terminen.
                            </p>
                        </div>
                    )}
                    {analysisHealth.permanentFailed > 0 && (
                        <div className="flex items-center gap-3 bg-amber-900/20 border border-amber-500/30 rounded-lg px-4 py-3">
                            <span className="text-amber-400 text-lg flex-shrink-0">⚠</span>
                            <p className="text-sm text-amber-200">
                                <span className="font-bold">{analysisHealth.permanentFailed} partidos</span> no pudieron analizarse tras múltiples intentos (datos incompletos o fallo técnico).
                            </p>
                        </div>
                    )}
                </div>
            )}

            {/* Plan info banner for non-historical dates */}
            {!isHistorical && !isAdmin && mainPicks.length > 0 && (
                <div className="flex items-center justify-between bg-slate-800/50 rounded-lg px-4 py-2 border border-white/5">
                    <span className="text-sm text-slate-400">
                        Mostrando <span className="text-white font-bold">{visiblePicks.length}</span> de <span className="text-white font-bold">{mainPicks.length}</span> oportunidades
                        {plan.plan_name !== 'free' && (
                            <span className="text-slate-500"> ({plan.predictions_percentage}% de tu plan {plan.display_name})</span>
                        )}
                    </span>
                    {hasLockedPicks && (
                        <button
                            onClick={() => setShowUpgradePrompt(true)}
                            className="text-xs text-brand hover:text-brand/80 font-bold transition-colors"
                        >
                            Desbloquear todas
                        </button>
                    )}
                </div>
            )}

            {visiblePicks.length > 0 || hasLockedPicks ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {/* Picks visibles */}
                    {visiblePicks.map((pick) => (
                        <SinglePickCard
                            key={pick.id}
                            pick={pick}
                            translateMarket={translateMarket}
                            onView={() => onViewReport?.(pick.job_id, pick.fixture_id)}
                            isAdmin={!!isAdmin}
                            presentationMode={presentationMode}
                            matchScore={matchScores[pick.fixture_id]}
                            onOverride={async (result) => {
                                try {
                                    await manualOverridePick(pick.id, result, {
                                        fixture_id: pick.fixture_id,
                                        market: pick.market,
                                        selection: pick.selection,
                                        p_model: pick.p_model,
                                        odds: pick.odds,
                                        job_id: pick.job_id,
                                    });
                                    setSingles(prev => prev.map(p =>
                                        p.id === pick.id ? { ...p, result, actual_score: `Manual: ${result}`, verified_at: new Date().toISOString() } : p
                                    ));
                                    onPickOverridden?.();
                                } catch (err: any) {
                                    console.error('[HighProbPicks] Override error:', err);
                                    alert(`Error: ${err.message}`);
                                }
                            }}
                        />
                    ))}

                    {/* Picks bloqueados (con blur) */}
                    {lockedPicks.map((pick) => (
                        <LockedPickCard
                            key={pick.id}
                            pick={pick}
                            translateMarket={translateMarket}
                            onUpgrade={() => setShowUpgradePrompt(true)}
                        />
                    ))}
                </div>
            ) : (
                <EmptyState onRetry={() => loadPicks(true)} message={infoMessage} inProgress={inProgress} />
            )}

            {/* Upgrade prompt modal */}
            {showUpgradePrompt && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowUpgradePrompt(false)}>
                    <div className="bg-slate-900 border border-white/10 rounded-2xl p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
                        <h3 className="text-xl font-bold text-white mb-2">Desbloquea Todas las Oportunidades</h3>
                        <p className="text-slate-400 text-sm mb-4">
                            Tienes {lockedPicks.length} oportunidades adicionales disponibles. Actualiza tu plan para acceder al {plan.predictions_percentage < 35 ? '35%' : plan.predictions_percentage < 80 ? '80%' : '100%'} o mas de los pronosticos.
                        </p>
                        <div className="flex gap-3">
                            <button
                                onClick={() => { setShowUpgradePrompt(false); window.location.href = '/app/pricing'; }}
                                className="flex-1 py-2.5 bg-brand text-white font-bold rounded-xl hover:bg-brand/80 transition-all"
                            >
                                Ver Planes
                            </button>
                            <button
                                onClick={() => setShowUpgradePrompt(false)}
                                className="px-4 py-2.5 bg-slate-800 text-slate-300 font-bold rounded-xl hover:bg-slate-700 transition-all"
                            >
                                Cerrar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// --- SUB-COMPONENTS ---

const LoadingState = () => (
    <div className="flex flex-col items-center justify-center py-20">
        <div className="w-12 h-12 border-4 border-brand border-t-transparent rounded-full animate-spin mb-4 shadow-[0_0_20px_rgba(16,185,129,0.2)]"></div>
        <p className="text-slate-300 font-medium animate-pulse">Buscando Oportunidades...</p>
        <p className="text-slate-500 text-sm mt-1">Filtrando mejores probabilidades</p>
    </div>
);

const ErrorState: React.FC<{ error: string, onRetry: () => void }> = ({ error, onRetry }) => (
    <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-red-400 mb-4 bg-red-900/20 px-4 py-2 rounded-lg border border-red-500/30">{error}</p>
        <button onClick={onRetry} className="flex items-center gap-2 px-4 py-2 bg-slate-700 text-white font-bold rounded-xl hover:bg-slate-600 transition-all">
            <ArrowPathIcon className="w-4 h-4" /> Reintentar
        </button>
    </div>
);

const EmptyState: React.FC<{ onRetry: () => void; message?: string | null; inProgress?: number }> = ({ onRetry, message, inProgress }) => (
    <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-24 h-24 bg-slate-800/50 rounded-full flex items-center justify-center mb-6 border border-white/5">
            {inProgress && inProgress > 0 ? (
                <div className="w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
            ) : (
                <TrophyIcon className="w-12 h-12 text-slate-600" />
            )}
        </div>
        <h3 className="text-xl font-bold text-white mb-2">
            {inProgress && inProgress > 0 ? 'Análisis en Progreso...' : 'Sin Oportunidades Claras'}
        </h3>
        <p className="text-slate-400 max-w-md mb-6 leading-relaxed">
            {message || (
                <>
                    No encontramos picks con <span className="text-amber-400 font-bold">Probabilidad {'\u2265'} {OPPORTUNITIES_THRESHOLD_PERCENT}%</span> y cuota real del mercado para esta fecha.
                    <span className="block mt-2 text-xs text-slate-500">
                        Las oportunidades se publican solo cuando los bookmakers han emitido cuotas — si aún no están disponibles, vuelve en unos minutos.
                    </span>
                </>
            )}
        </p>
        <button onClick={onRetry} className="flex items-center gap-2 px-5 py-2.5 bg-brand text-white font-bold rounded-xl hover:bg-brand/80 transition-all shadow-lg hover:shadow-brand/20">
            <ArrowPathIcon className="w-4 h-4" /> {inProgress && inProgress > 0 ? 'Verificar de Nuevo' : 'Actualizar'}
        </button>
    </div>
);

const ResultBadge: React.FC<{ result?: string; actualScore?: string; hidden?: boolean }> = ({ result, actualScore, hidden }) => {
    if (!result || result === 'PENDING' || hidden) return null;

    const config: Record<string, { bg: string; text: string; label: string; border: string }> = {
        WON: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', label: 'GANADA', border: 'border-emerald-500/50' },
        LOST: { bg: 'bg-red-500/20', text: 'text-red-400', label: 'PERDIDA', border: 'border-red-500/50' },
        VOID: { bg: 'bg-slate-500/20', text: 'text-slate-400', label: 'NULA', border: 'border-slate-500/50' },
        PUSH: { bg: 'bg-slate-500/20', text: 'text-slate-400', label: 'PUSH', border: 'border-slate-500/50' },
    };

    const c = config[result] || config.VOID;

    return (
        <div className={`absolute top-0 left-0 p-1.5 px-2.5 ${c.bg} rounded-br-xl border-b border-r ${c.border} z-10`}>
            <span className={`${c.text} font-black text-[10px] tracking-wider`}>{c.label}</span>
            {actualScore && <span className={`${c.text} text-[9px] ml-1 opacity-70`}>({actualScore})</span>}
        </div>
    );
};

const LockedPickCard: React.FC<{
    pick: HighProbPick;
    translateMarket: (m: string) => string;
    onUpgrade: () => void;
}> = ({ pick, translateMarket, onUpgrade }) => (
    <div
        className="bg-slate-900/60 border border-white/5 rounded-xl p-4 relative overflow-hidden cursor-pointer group"
        onClick={onUpgrade}
    >
        {/* Blur overlay */}
        <div className="absolute inset-0 backdrop-blur-md bg-slate-900/40 z-10 flex flex-col items-center justify-center">
            <div className="p-3 bg-slate-800/80 rounded-full mb-2 border border-white/10">
                <LockClosedIcon className="w-5 h-5 text-slate-400" />
            </div>
            <p className="text-white font-bold text-sm">Oportunidad Premium</p>
            <p className="text-brand text-xs font-bold mt-1 group-hover:underline">Desbloquear</p>
        </div>

        {/* Contenido difuminado (parcialmente visible para generar interes) */}
        <div className="opacity-30">
            <div className="flex items-center gap-3 mb-4">
                <div className="flex -space-x-2">
                    <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700" />
                    <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700" />
                </div>
                <div>
                    <h4 className="text-white font-bold text-sm">{pick.home_team}</h4>
                    <span className="text-xs text-slate-400">vs {pick.away_team}</span>
                </div>
            </div>
            <div className="bg-black/40 rounded-lg p-3 border border-white/5">
                <p className="text-[10px] uppercase text-slate-500">{translateMarket(pick.market)}</p>
                <p className="text-white font-bold text-sm">***</p>
            </div>
        </div>
    </div>
);

const SinglePickCard: React.FC<{
    pick: HighProbPick;
    translateMarket: (m: string) => string;
    onView: () => void;
    isAdmin: boolean;
    presentationMode?: boolean;
    matchScore?: string;
    onOverride: (result: 'WON' | 'LOST' | 'VOID') => Promise<void>;
}> = ({ pick, translateMarket, onView, isAdmin, presentationMode, matchScore, onOverride }) => {
    const [overriding, setOverriding] = useState(false);
    const isVerified = pick.result && pick.result !== 'PENDING';
    const isLost = !presentationMode && pick.result === 'LOST';
    const isWon = !presentationMode && pick.result === 'WON';
    const canOverride = isAdmin; // Admin siempre puede corregir resultados

    // Stake / risk management
    const stakeUnits = getStakeUnits(DEFAULT_STAKING_CONFIG, 'single', pick.p_model);
    const stakePercent = getStakePercent(stakeUnits, DEFAULT_STAKING_CONFIG);
    const potentialProfit = pick.odds ? (stakePercent * (pick.odds - 1)).toFixed(1) : null;

    const handleOverride = async (e: React.MouseEvent, result: 'WON' | 'LOST' | 'VOID') => {
        e.stopPropagation();
        if (overriding) return;
        setOverriding(true);
        try {
            await onOverride(result);
        } finally {
            setOverriding(false);
        }
    };

    return (
        <div
            className={`bg-slate-900 border rounded-xl p-4 hover:bg-slate-800 transition-all cursor-pointer group relative overflow-hidden ${
                isWon ? 'border-emerald-500/30 shadow-lg shadow-emerald-500/5' :
                isLost ? 'border-red-500/20 opacity-60' :
                'border-white/10'
            }`}
            onClick={onView}
        >
            <ResultBadge result={pick.result} actualScore={pick.actual_score} hidden={presentationMode} />

            <div className="absolute top-0 right-0 p-2 bg-blue-600/20 rounded-bl-xl border-b border-l border-blue-500/20">
                <span className="text-blue-400 font-bold text-xs">{Math.round(pick.p_model * 100)}% Prob</span>
            </div>

            <div className={`flex items-center gap-3 mb-4 ${isVerified ? 'mt-2' : ''}`}>
                <div className="flex -space-x-2">
                    <img src={pick.logo_home || ''} className="w-9 h-9 sm:w-8 sm:h-8 rounded-full bg-slate-800 border border-slate-700 object-contain p-1" />
                    <img src={pick.logo_away || ''} className="w-9 h-9 sm:w-8 sm:h-8 rounded-full bg-slate-800 border border-slate-700 object-contain p-1" />
                </div>
                <div className="flex-1">
                    <h4 className="text-white font-bold text-sm leading-tight">{pick.home_team}</h4>
                    <span className="text-xs text-slate-400">vs {pick.away_team}</span>
                </div>
                {/* Show match score for admin verification (PENDING picks with finished match) */}
                {isAdmin && matchScore && (!pick.result || pick.result === 'PENDING') && (
                    <div className="flex-shrink-0 bg-slate-800 border border-white/10 rounded-lg px-2.5 py-1.5 text-center">
                        <span className="text-[9px] uppercase text-slate-500 block leading-none mb-0.5">Score</span>
                        <span className="text-white font-black text-sm">{matchScore}</span>
                    </div>
                )}
            </div>

            <div className="bg-black/40 rounded-lg p-3 border border-white/5 flex justify-between items-center mb-3">
                <div>
                    {(() => {
                        const tr = translatePick(pick.market || '', pick.selection || '');
                        return (
                            <>
                                <p className="text-[11px] sm:text-[10px] uppercase text-slate-500">{tr.marketEs}</p>
                                <p className="text-white font-bold text-sm">{tr.selectionEs}</p>
                            </>
                        );
                    })()}
                </div>
                <div className="text-right">
                    {(() => {
                        const validOdds = pick.odds != null && pick.odds >= 1.01 && pick.odds <= 15.0;
                        return (
                            <>
                                <span className={`block text-lg sm:text-xl font-black ${validOdds ? 'text-amber-400' : 'text-slate-500'}`}>
                                    {validOdds ? `@${pick.odds!.toFixed(2)}` : 'Sin cuota'}
                                </span>
                                <span className="text-[10px] text-slate-500 uppercase">{validOdds ? 'Cuota' : 'Sin datos'}</span>
                            </>
                        );
                    })()}
                </div>
            </div>

            {/* Stake / Risk Management Badge */}
            <div className="flex items-center justify-between px-3 py-2 bg-emerald-500/10 rounded-lg border border-emerald-500/20 mb-3">
                <div>
                    <span className="text-[9px] uppercase text-emerald-500/60 font-bold block">Stake Sugerido</span>
                    <span className="text-emerald-400 font-black text-lg">{stakePercent}%</span>
                    <span className="text-emerald-500/50 text-[10px] ml-1">({stakeUnits}u)</span>
                </div>
                {potentialProfit && (
                    <div className="text-right">
                        <span className="text-[9px] uppercase text-slate-500 block">Ganancia Potencial</span>
                        <span className="text-amber-400 font-bold text-sm">+{potentialProfit}%</span>
                    </div>
                )}
            </div>

            {canOverride ? (
                <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                        <button
                            onClick={(e) => handleOverride(e, 'WON')}
                            disabled={overriding}
                            className="flex-1 py-2.5 sm:py-1.5 rounded-lg text-sm sm:text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 transition-all disabled:opacity-50"
                        >
                            {overriding ? '...' : 'GANADA'}
                        </button>
                        <button
                            onClick={(e) => handleOverride(e, 'LOST')}
                            disabled={overriding}
                            className="flex-1 py-2.5 sm:py-1.5 rounded-lg text-sm sm:text-xs font-bold bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-all disabled:opacity-50"
                        >
                            {overriding ? '...' : 'PERDIDA'}
                        </button>
                        <button
                            onClick={(e) => handleOverride(e, 'VOID')}
                            disabled={overriding}
                            className="py-2.5 sm:py-1.5 px-3 rounded-lg text-sm sm:text-xs font-bold bg-slate-500/20 text-slate-400 border border-slate-500/30 hover:bg-slate-500/30 transition-all disabled:opacity-50"
                        >
                            {overriding ? '...' : 'NULA'}
                        </button>
                    </div>
                    <SeoPageLink fixtureId={pick.fixture_id} />
                </div>
            ) : (
                <div className="w-full py-1.5 flex items-center justify-center gap-2 text-xs font-bold text-slate-500 group-hover:text-white transition-colors">
                    <ArrowTopRightOnSquareIcon className="w-3 h-3" />
                    Ver Análisis Completo
                </div>
            )}
        </div>
    );
};

// Mini component: link to SEO page (admin only)
const SeoPageLink: React.FC<{ fixtureId: number }> = ({ fixtureId }) => {
    const [page, setPage] = useState<{ path: string; status: string | null } | null>(null);
    useEffect(() => {
        supabase.from('seo_pages').select('full_path, article_status').eq('fixture_id', fixtureId).maybeSingle()
            .then(({ data }) => {
                if (data?.full_path) setPage({ path: data.full_path, status: data.article_status ?? null });
            });
    }, [fixtureId]);
    if (!page) return null;
    const label = page.status === 'ready' || page.status === null ? 'Ver Página SEO' : 'Vista previa';
    return (
        <a
            href={`https://derbix.co${page.path}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="w-full py-1.5 flex items-center justify-center gap-1.5 text-[10px] font-medium text-blue-400/70 hover:text-blue-300 border border-blue-500/10 rounded-lg hover:border-blue-500/30 transition-all"
        >
            <ArrowTopRightOnSquareIcon className="w-3 h-3" />
            {label}
        </a>
    );
};

export default HighProbPicks;
