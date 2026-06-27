
// components/ai/HighProbPicks.tsx
// Componente para mostrar Oportunidades (Picks Individuales >= OPPORTUNITIES_THRESHOLD_PERCENT con cuota real)
// Updated: Removed Smart Parlays logic as per user request.

import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../services/supabaseService';
import { manualOverridePick } from '../../services/resultsService';
import { OPPORTUNITIES_THRESHOLD, OPPORTUNITIES_THRESHOLD_PERCENT, MAX_OPPORTUNITIES_PER_DAY } from '../../constants/opportunities';
import { translatePick } from '../../services/marketTranslator';
import { useAuth } from '../../hooks/useAuth';
import { useSubscription } from '../../contexts/SubscriptionContext';
import { isHistoricalDate, getAllowedPickCount } from '../../utils/planAccessUtils';
import { cleanPlanLabel } from '../../utils/planDisplay';
import { getCurrentDateInBogota } from '../../utils/dateUtils';
import { TrophyIcon, ChartBarIcon, ArrowPathIcon, ArrowTopRightOnSquareIcon, LockClosedIcon, ChartUpIcon } from '../icons/Icons';
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
    match_time?: string;   // hora de inicio (daily_matches.match_time)
    match_status?: string; // estado (NS, 1H, 2H, HT, FT...) para detectar EN VIVO
}

interface HighProbPicksProps {
    date: string;
    onViewReport?: (jobId: string, fixtureId: number) => void;
    onPickOverridden?: () => void;
    onAccessibleFixturesChange?: (fixtureIds: Set<number>) => void;
    refreshSignal?: number;
    toolbar?: React.ReactNode; // toolrow (toggle + fecha + recargar) inyectado por LiveFeed
}

const HighProbPicks: React.FC<HighProbPicksProps> = ({ date, onViewReport, onPickOverridden, onAccessibleFixturesChange, refreshSignal, toolbar }) => {
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
    const [statusFilter, setStatusFilter] = useState<'all' | 'finished'>('all'); // chips Todos / Finalizados
    const [matchScores, setMatchScores] = useState<Record<number, string>>({});
    const [analysisHealth, setAnalysisHealth] = useState<{ permanentFailed: number; pendingRetry: number }>({ permanentFailed: 0, pendingRetry: 0 });
    // Rail "Próximos": partidos próximos ya analizados (fechas futuras)
    const [proximos, setProximos] = useState<{ id: string; job_id: string; fixture_id: number; home_team: string; away_team: string; p_model: number; match_time?: string }[]>([]);

    // Transparencia historica: fechas anteriores = todo visible
    const isHistorical = isHistoricalDate(date);

    const loadPicks = async (forceRegenerate = false) => {
        setIsLoading(true);
        setError(null);
        setInfoMessage(null);

        try {
            // FAST PATH: Read persisted opportunities directly from DB (stable on every refresh)
            // With STALENESS CHECK: if persisted < cap and more eligible picks exist, regenerate
            if (!forceRegenerate) {
                console.log(`[HighProbPicks] Trying persisted opportunities for ${date}...`);
                // 2026-05-15 FIX: secondary order by p_model DESC. v9-pipeline-worker
                // leaves opportunity_rank=null until v2-generate-parlays assigns a
                // global rank. Without the secondary order, free users (who see only
                // pick #1) would get a non-deterministic pick — different each refresh.
                const { data: persisted } = await supabase
                    .from('value_picks_v2')
                    .select('id, job_id, fixture_id, market, selection, p_model, odds, result, verified_at, actual_score, opportunity_rank')
                    .eq('is_opportunity', true)
                    .eq('opportunity_date', date)
                    .order('opportunity_rank', { ascending: true, nullsFirst: false })
                    .order('p_model', { ascending: false });

                if (persisted && persisted.length > 0) {
                    let usePersistedData = true;

                    // STALENESS CHECK: only consider "unmarked" picks as evidence that
                    // staleness exists. Picks already marked is_opportunity=false were
                    // EXPLICITLY rejected (by sanity gate or admin cleanup) — they should
                    // not trigger regeneration. Picks with is_opportunity IS NULL are the
                    // ones that haven't been assessed yet by v2-generate-parlays.
                    //
                    // 2026-05-15 FIX: previous logic counted ALL picks >= threshold which
                    // included rejected ones, causing staleness to trigger constantly and
                    // wiping valid v9-validated picks via the v2-generate-parlays reset.
                    if (persisted.length < MAX_OPPORTUNITIES_PER_DAY) {
                        const { data: todayMatches } = await supabase
                            .from('daily_matches')
                            .select('api_fixture_id')
                            .eq('match_date', date);
                        const todayFixtureIds = (todayMatches || []).map((m: any) => m.api_fixture_id);

                        if (todayFixtureIds.length > 0) {
                            const { count: unmarkedCount } = await supabase
                                .from('value_picks_v2')
                                .select('id', { count: 'exact', head: true })
                                .in('fixture_id', todayFixtureIds)
                                .gte('p_model', OPPORTUNITIES_THRESHOLD)
                                .is('is_opportunity', null);

                            if ((unmarkedCount || 0) > 0) {
                                console.log(`[HighProbPicks] Stale: ${persisted.length} persisted, ${unmarkedCount} unmarked eligible → regenerating`);
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
                            .select('api_fixture_id, home_team, away_team, league_name, home_team_logo, away_team_logo, match_time, match_status')
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
                                match_time: m?.match_time,
                                match_status: m?.match_status,
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

            // v2-generate-parlays también marca is_opportunity=true en value_picks_v2
            // (Step 5.5) — es el motor que produce las Oportunidades visibles. NO eliminar
            // esta función edge aunque los parleys ya no existan en la plataforma.
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

    // Refresco manual desde la barra de controles (mismo handler, reubicado)
    useEffect(() => {
        if (refreshSignal) loadPicks(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refreshSignal]);

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

    // Rail "Próximos": partidos próximos YA analizados (fechas futuras). Read-only.
    // TODO: usar is_opportunity para próximos cuando el motor marque fechas futuras.
    useEffect(() => {
        let cancelled = false;
        const loadProximos = async () => {
            try {
                const today = getCurrentDateInBogota();
                const to = new Date(today + 'T12:00:00');
                to.setDate(to.getDate() + 3);
                const toStr = to.toISOString().slice(0, 10);

                const { data: futureMatches } = await supabase
                    .from('daily_matches')
                    .select('api_fixture_id, home_team, away_team, match_time')
                    .gt('match_date', today)
                    .lte('match_date', toStr)
                    .order('match_time', { ascending: true })
                    .limit(50);

                const fids = [...new Set((futureMatches || []).map((m: any) => m.api_fixture_id))];
                if (fids.length === 0) { if (!cancelled) setProximos([]); return; }
                const mmap = new Map<number, any>();
                (futureMatches || []).forEach((m: any) => mmap.set(m.api_fixture_id, m));

                const { data: futurePicks } = await supabase
                    .from('value_picks_v2')
                    .select('id, job_id, fixture_id, p_model')
                    .in('fixture_id', fids)
                    .gte('p_model', OPPORTUNITIES_THRESHOLD); // catches 0–1 (>=0.8) y 0–100 (todas >= 0.8)

                // Normalizar p_model y quedarse con el mejor pick por fixture
                const byFixture = new Map<number, { id: string; job_id: string; fixture_id: number; p_model: number }>();
                (futurePicks || []).forEach((p: any) => {
                    const prob = p.p_model > 1 ? p.p_model / 100 : p.p_model;
                    if (prob < OPPORTUNITIES_THRESHOLD) return;
                    const cur = byFixture.get(p.fixture_id);
                    if (!cur || prob > cur.p_model) byFixture.set(p.fixture_id, { id: p.id, job_id: p.job_id || '', fixture_id: p.fixture_id, p_model: prob });
                });

                const list = [...byFixture.values()]
                    .map(p => {
                        const m = mmap.get(p.fixture_id);
                        return { ...p, home_team: m?.home_team || 'Equipo', away_team: m?.away_team || 'Equipo', match_time: m?.match_time };
                    })
                    .sort((a, b) => (a.match_time || '').localeCompare(b.match_time || ''))
                    .slice(0, 4);

                if (!cancelled) setProximos(list);
            } catch (err) {
                console.warn('[HighProbPicks] próximos load failed:', err);
            }
        };
        loadProximos();
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

    // --- Datos derivados para el layout de 2 columnas ---
    const overridePick = async (pick: HighProbPick, result: 'WON' | 'LOST' | 'VOID') => {
        try {
            await manualOverridePick(pick.id, result, {
                fixture_id: pick.fixture_id, market: pick.market, selection: pick.selection,
                p_model: pick.p_model, odds: pick.odds, job_id: pick.job_id,
            });
            setSingles(prev => prev.map(p => p.id === pick.id
                ? { ...p, result, actual_score: `Manual: ${result}`, verified_at: new Date().toISOString() } : p));
            onPickOverridden?.();
        } catch (err: any) {
            console.error('[HighProbPicks] Override error:', err);
            alert(`Error: ${err.message}`);
        }
    };
    const isFinishedPick = (p: HighProbPick) => !!p.result && p.result !== 'PENDING';
    const displayPicks = statusFilter === 'finished' ? visiblePicks.filter(isFinishedPick) : visiblePicks;
    const leagueGroups: { league: string; picks: HighProbPick[] }[] = [];
    displayPicks.forEach((p) => {
        const lg = p.league || 'Otras ligas';
        let g = leagueGroups.find(x => x.league === lg);
        if (!g) { g = { league: lg, picks: [] }; leagueGroups.push(g); }
        g.picks.push(p);
    });
    const featured = [...visiblePicks].sort((a, b) => b.p_model - a.p_model)[0];
    const railLeagues = leagueGroups.map(g => ({ league: g.league, count: g.picks.length }));
    const crest = (name?: string) => (name || '?').replace(/[^A-Za-z0-9 ]/g, '').slice(0, 3).toUpperCase();
    const probOf = (p: { p_model: number }) => Math.round(p.p_model * 100);
    const oddOf = (p: HighProbPick) => (p.odds && p.odds >= 1.01 ? `@${p.odds.toFixed(2)}` : '—');
    const betOf = (p: HighProbPick) => translatePick(p.market || '', p.selection || '').selectionEs;
    const LIVE_STATUSES = ['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE', 'INT'];
    const isLive = (p: { match_status?: string }) => LIVE_STATUSES.includes(p.match_status || '');
    const kickoffOf = (p: { match_time?: string }): string => {
        if (!p.match_time) return '';
        try {
            return new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit' }).format(new Date(p.match_time));
        } catch { return ''; }
    };
    const hasPicks = visiblePicks.length > 0 || hasLockedPicks;

    return (
        <div className="dxj-body">
            {/* ===== COLUMNA IZQUIERDA ===== */}
            <div className="dxj-colmain">
                {toolbar}

                <div className="dxj-chips">
                    <button className={`dxj-chip ${statusFilter === 'all' ? 'on' : ''}`} onClick={() => setStatusFilter('all')}>Todos</button>
                    <button className={`dxj-chip ${statusFilter === 'finished' ? 'on' : ''}`} onClick={() => setStatusFilter('finished')}>Finalizados</button>
                    <div className="ml-auto flex items-center gap-2.5">
                        {mainPicks.length > 0 && <span className="text-xs text-dx-text-mute dx-num">{mainPicks.length} hoy</span>}
                        <button onClick={() => loadPicks(true)} title="Actualizar oportunidades" className="dxj-chip-refresh">
                            <ArrowPathIcon className="w-[17px] h-[17px]" />
                        </button>
                    </div>
                </div>

                {(analysisHealth.pendingRetry > 0 || analysisHealth.permanentFailed > 0) && (
                    <div className="space-y-2 mt-4">
                        {analysisHealth.pendingRetry > 0 && (
                            <div className="flex items-center gap-3 bg-dx-surface-2 border border-dx-border rounded-lg px-4 py-3">
                                <div className="w-5 h-5 border-2 border-dx-green border-t-transparent rounded-full animate-spin flex-shrink-0"></div>
                                <p className="text-sm text-dx-text-soft"><span className="font-bold text-white">{analysisHealth.pendingRetry} partidos</span> en análisis. Las oportunidades aparecerán cuando terminen.</p>
                            </div>
                        )}
                        {analysisHealth.permanentFailed > 0 && (
                            <div className="flex items-center gap-3 bg-dx-gold/10 border border-dx-gold/30 rounded-lg px-4 py-3">
                                <span className="text-dx-gold text-lg flex-shrink-0">⚠</span>
                                <p className="text-sm text-dx-text-soft"><span className="font-bold text-dx-gold">{analysisHealth.permanentFailed} partidos</span> no pudieron analizarse (datos incompletos).</p>
                            </div>
                        )}
                    </div>
                )}

                {/* Destacado del día — versión móvil (el rail está oculto < 1100px) */}
                {hasPicks && featured && (
                    <div className="dxj-mfeat-wrap">
                        <div className="dxj-rc dxj-feat">
                            <div className="dxj-rc-t"><TrophyIcon /> Destacado del día</div>
                            <div className="fteams">
                                <b>{featured.logo_home ? <img src={featured.logo_home} alt="" /> : crest(featured.home_team)}</b>
                                <b>{featured.logo_away ? <img src={featured.logo_away} alt="" /> : crest(featured.away_team)}</b>
                            </div>
                            <div className="fmt">{featured.home_team} — {featured.away_team}</div>
                            <div className="fmk">{betOf(featured)}</div>
                            <div className="frow">
                                <div className="fprob">{probOf(featured)}%<small>PROBABILIDAD</small></div>
                                {oddOf(featured) !== '—' && <div className="fodd">{oddOf(featured)}</div>}
                            </div>
                            <button className="fbtn" onClick={() => onViewReport?.(featured.job_id, featured.fixture_id)}>Ver análisis completo</button>
                        </div>
                    </div>
                )}

                {hasPicks ? (
                    <div className="mt-5">
                        {leagueGroups.map((g) => (
                            <div key={g.league}>
                                <div className="dxj-lghead">
                                    <span className="fl">{crest(g.league).slice(0, 2)}</span>
                                    <span className="nm">{g.league}</span>
                                    <span className="ct dx-num">{g.picks.length} {g.picks.length === 1 ? 'oportunidad' : 'oportunidades'}</span>
                                </div>
                                {g.picks.map((pick) => {
                                    const lost = !presentationMode && pick.result === 'LOST';
                                    // Mercado + estado/hora: se muestra inline en PC y full-width abajo en móvil
                                    const mkContent = (
                                        <>
                                            {betOf(pick)}
                                            {isLive(pick)
                                                ? <> · <span className="lv">EN VIVO</span></>
                                                : kickoffOf(pick) ? ` · ${kickoffOf(pick)}` : ''}
                                        </>
                                    );
                                    return (
                                        <div key={pick.id}>
                                            <button className="dxj-pick" style={lost ? { opacity: 0.6 } : undefined} onClick={() => onViewReport?.(pick.job_id, pick.fixture_id)}>
                                                <span className="dxj-crests">
                                                    <b>{pick.logo_home ? <img src={pick.logo_home} alt="" /> : crest(pick.home_team)}</b>
                                                    <b>{pick.logo_away ? <img src={pick.logo_away} alt="" /> : crest(pick.away_team)}</b>
                                                </span>
                                                <span className="dxj-pinfo">
                                                    <span className="mt">{pick.home_team} — {pick.away_team}</span>
                                                    <span className="mk mk-inline">{mkContent}</span>
                                                </span>
                                                <span className="dxj-pmeta">
                                                    <span className="prob" style={lost ? { color: 'var(--dx-live)' } : undefined}>{probOf(pick)}%<small>PROB</small></span>
                                                    {oddOf(pick) !== '—' && <span className="odd">{oddOf(pick)}</span>}
                                                    <span className="go">›</span>
                                                </span>
                                                <span className="dxj-pmk">{mkContent}</span>
                                            </button>
                                            {isAdmin && (
                                                <div className="flex items-center gap-1.5 mb-2 -mt-1 pl-1 flex-wrap">
                                                    {matchScores[pick.fixture_id] && (!pick.result || pick.result === 'PENDING') && (
                                                        <span className="text-[10px] text-dx-text-mute dx-num mr-1">Score {matchScores[pick.fixture_id]}</span>
                                                    )}
                                                    <button onClick={() => overridePick(pick, 'WON')} className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-dx-green/15 text-dx-green border border-dx-green/30 hover:bg-dx-green/25">GANADA</button>
                                                    <button onClick={() => overridePick(pick, 'LOST')} className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-dx-loss/15 text-dx-loss border border-dx-loss/30 hover:bg-dx-loss/25">PERDIDA</button>
                                                    <button onClick={() => overridePick(pick, 'VOID')} className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-white/5 text-dx-text-soft border border-dx-border hover:bg-white/10">NULA</button>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        ))}

                        {hasLockedPicks && (
                            <button onClick={() => setShowUpgradePrompt(true)} className="dxj-pick justify-center" style={{ borderStyle: 'dashed', marginTop: '4px' }}>
                                <span className="text-sm font-bold text-dx-gold flex items-center gap-2">
                                    <LockClosedIcon className="w-4 h-4" /> {lockedPicks.length} oportunidades premium — Desbloquear
                                </span>
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="mt-5"><EmptyState onRetry={() => loadPicks(true)} message={infoMessage} inProgress={inProgress} /></div>
                )}

                {/* Próximos — versión móvil (deslizar con el dedo, sin flecha) */}
                {proximos.length > 0 && (
                    <div className="dxj-mprox-wrap">
                        <div className="dxj-mprox-h">Próximos</div>
                        <div className="dxj-mprox">
                            {proximos.map((p) => (
                                <button key={p.id} type="button" className="pc" onClick={() => onViewReport?.(p.job_id || '', p.fixture_id)}>
                                    <div className="pt">{p.home_team} — {p.away_team}</div>
                                    <div className="pr">
                                        <span className="ph">{kickoffOf(p) || ''}</span>
                                        <span className="pp dx-num">{probOf(p)}%</span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* ===== COLUMNA DERECHA (rail) ===== */}
            {hasPicks && featured && (
                <aside className="dxj-rail">
                    <div className="dxj-rc dxj-feat">
                        <div className="dxj-rc-t"><TrophyIcon /> Destacado del día</div>
                        <div className="fteams">
                            <b>{featured.logo_home ? <img src={featured.logo_home} alt="" /> : crest(featured.home_team)}</b>
                            <b>{featured.logo_away ? <img src={featured.logo_away} alt="" /> : crest(featured.away_team)}</b>
                        </div>
                        <div className="fmt">{featured.home_team} — {featured.away_team}</div>
                        <div className="fmk">{betOf(featured)}</div>
                        <div className="frow">
                            <div className="fprob">{probOf(featured)}%<small>PROBABILIDAD</small></div>
                            <div className="fodd">{oddOf(featured)}</div>
                        </div>
                        <button className="fbtn" onClick={() => onViewReport?.(featured.job_id, featured.fixture_id)}>Ver análisis completo</button>
                    </div>

                    {railLeagues.length > 0 && (
                        <div className="dxj-rc">
                            <div className="dxj-rc-t"><ChartBarIcon /> Ligas</div>
                            {railLeagues.map((l) => (
                                <button key={l.league} className="dxj-lrow" onClick={() => setStatusFilter('all')}>
                                    <span className="lf">{crest(l.league).slice(0, 2)}</span>
                                    <span className="truncate">{l.league}</span>
                                    <span className="lc dx-num">{l.count}</span>
                                </button>
                            ))}
                        </div>
                    )}

                    {proximos.length > 0 && (
                        <div className="dxj-rc">
                            <div className="dxj-rc-t"><ChartBarIcon /> Próximos</div>
                            {proximos.map((p) => (
                                <button key={p.id} type="button" className="dxj-nrow" style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', borderBottom: '1px solid var(--dx-border)', cursor: 'pointer' }} onClick={() => onViewReport?.(p.job_id || '', p.fixture_id)}>
                                    <span className="truncate" style={{ fontSize: '12.5px' }}>{p.home_team} — {p.away_team}</span>
                                    {kickoffOf(p) && <span className="dx-num" style={{ fontSize: '11px', color: 'var(--dx-text-mute)' }}>{kickoffOf(p)}</span>}
                                    <span className="nt dx-num">{probOf(p)}%</span>
                                </button>
                            ))}
                        </div>
                    )}
                </aside>
            )}

            {/* Upgrade prompt modal */}
            {showUpgradePrompt && (
                <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowUpgradePrompt(false)}>
                    <div className="bg-dx-surface border border-dx-border rounded-2xl p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
                        <h3 className="text-xl font-display font-bold text-white mb-2">Desbloquea Todas las Oportunidades</h3>
                        <p className="text-dx-text-soft text-sm mb-4">
                            Tienes {lockedPicks.length} oportunidades adicionales disponibles. Actualiza tu plan para acceder al {plan.predictions_percentage < 35 ? '35%' : plan.predictions_percentage < 80 ? '80%' : '100%'} o mas de los pronosticos.
                        </p>
                        <div className="flex gap-3">
                            <button
                                onClick={() => { setShowUpgradePrompt(false); window.location.href = '/app/pricing'; }}
                                className="flex-1 py-2.5 bg-gradient-to-r from-dx-green to-dx-cyan text-[#04140C] font-bold rounded-xl hover:shadow-lg hover:shadow-dx-green-glow transition-all"
                            >
                                Ver Planes
                            </button>
                            <button
                                onClick={() => setShowUpgradePrompt(false)}
                                className="px-4 py-2.5 bg-dx-surface-2 text-dx-text-soft font-bold rounded-xl border border-dx-border hover:text-white transition-all"
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
        <p className="text-dx-text-soft max-w-md mb-6 leading-relaxed">
            {message || (
                <>
                    No encontramos picks con <span className="text-amber-400 font-bold">Probabilidad {'\u2265'} {OPPORTUNITIES_THRESHOLD_PERCENT}%</span> y cuota real del mercado para esta fecha.
                    <span className="block mt-2 text-xs text-dx-text-mute">
                        Las oportunidades se publican solo cuando los bookmakers han emitido cuotas — si aún no están disponibles, vuelve en unos minutos.
                    </span>
                </>
            )}
        </p>
        <button onClick={onRetry} className="inline-flex items-center justify-center px-6 py-2.5 rounded-xl font-bold text-[#04140C] bg-gradient-to-r from-dx-green to-dx-cyan shadow-[0_8px_22px_-10px_rgba(29,231,130,0.6)] hover:shadow-[0_10px_28px_-8px_rgba(34,229,192,0.6)] hover:brightness-110 hover:-translate-y-0.5 transition-all">
            {inProgress && inProgress > 0 ? 'Verificar de Nuevo' : 'Actualizar'}
        </button>
    </div>
);

// Chevron derecho (mockup Composición 1)
const ChevronRight: React.FC<{ className?: string }> = ({ className }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="m9 18 6-6-6-6" /></svg>
);

// Pill de resultado en línea (verde/rojo/neutro) con tokens dx
const ResultBadge: React.FC<{ result?: string; actualScore?: string; hidden?: boolean }> = ({ result, actualScore, hidden }) => {
    if (!result || result === 'PENDING' || hidden) return null;

    const config: Record<string, { bg: string; text: string; label: string; border: string }> = {
        WON: { bg: 'bg-dx-green/15', text: 'text-dx-green', label: 'GANADA', border: 'border-dx-green/40' },
        LOST: { bg: 'bg-dx-loss/15', text: 'text-dx-loss', label: 'PERDIDA', border: 'border-dx-loss/40' },
        VOID: { bg: 'bg-white/5', text: 'text-dx-text-mute', label: 'NULA', border: 'border-dx-border' },
        PUSH: { bg: 'bg-white/5', text: 'text-dx-text-mute', label: 'PUSH', border: 'border-dx-border' },
    };

    const c = config[result] || config.VOID;

    return (
        <span className={`inline-flex items-center gap-1 ${c.bg} border ${c.border} rounded-md px-2 py-0.5`}>
            <span className={`${c.text} font-black text-[10px] tracking-wider`}>{c.label}</span>
            {actualScore && <span className={`${c.text} text-[9px] opacity-70 dx-num`}>({actualScore})</span>}
        </span>
    );
};

const LockedPickCard: React.FC<{
    pick: HighProbPick;
    translateMarket: (m: string) => string;
    onUpgrade: () => void;
}> = ({ pick, onUpgrade }) => (
    <div
        onClick={onUpgrade}
        className="flex items-center gap-3 sm:gap-4 py-4 px-1 border-b border-dx-border last:border-0 cursor-pointer group"
    >
        {/* Probabilidad oculta */}
        <div className="w-14 sm:w-20 shrink-0 text-center select-none">
            <p className="font-display font-extrabold text-xl sm:text-2xl text-dx-text-mute leading-none">••%</p>
            <p className="text-[9px] tracking-[0.15em] text-dx-text-mute font-bold mt-0.5">PROB</p>
        </div>

        {/* Equipos visibles + tease */}
        <div className="flex-1 min-w-0">
            <h4 className="text-white/80 font-bold text-sm sm:text-base leading-tight truncate">
                {pick.home_team} <span className="text-dx-text-mute font-medium">vs</span> {pick.away_team}
            </h4>
            <div className="flex items-center gap-2 mt-1.5">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-dx-gold bg-dx-gold/10 border border-dx-gold/30 rounded-md px-2 py-0.5">
                    <LockClosedIcon className="w-3 h-3" /> Oportunidad Premium
                </span>
            </div>
        </div>

        {/* Desbloquear */}
        <div className="shrink-0 flex items-center gap-2">
            <span className="text-xs font-bold text-dx-gold group-hover:underline">Desbloquear</span>
            <ChevronRight className="w-4 h-4 text-dx-text-mute group-hover:text-dx-gold transition-colors" />
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
}> = ({ pick, onView, isAdmin, presentationMode, matchScore, onOverride }) => {
    const [overriding, setOverriding] = useState(false);
    const isVerified = pick.result && pick.result !== 'PENDING';
    const isLost = !presentationMode && pick.result === 'LOST';
    const canOverride = isAdmin; // Admin siempre puede corregir resultados

    // Stake / risk management
    const stakeUnits = getStakeUnits(DEFAULT_STAKING_CONFIG, 'single', pick.p_model);
    const stakePercent = getStakePercent(stakeUnits, DEFAULT_STAKING_CONFIG);
    const potentialProfit = pick.odds ? (stakePercent * (pick.odds - 1)).toFixed(1) : null;

    const tr = translatePick(pick.market || '', pick.selection || '');
    const probPct = Math.round(pick.p_model * 100);
    const validOdds = pick.odds != null && pick.odds >= 1.01 && pick.odds <= 15.0;

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
        <div className={`border-b border-dx-border last:border-0 ${isLost ? 'opacity-60' : ''}`}>
            {/* Fila principal — Composición 1: prob | equipos+mercado | cuota+chevron */}
            <div
                onClick={onView}
                className="flex items-center gap-3 sm:gap-4 py-4 px-1 cursor-pointer hover:bg-white/[0.02] transition-colors group rounded-lg"
            >
                {/* Probabilidad + barra de confianza */}
                <div className="w-14 sm:w-20 shrink-0 text-center">
                    <p className={`font-display font-extrabold text-xl sm:text-2xl dx-num leading-none ${isLost ? 'text-dx-loss' : 'text-dx-green'}`}>{probPct}%</p>
                    <p className="text-[9px] tracking-[0.15em] text-dx-text-mute font-bold mt-0.5">PROB</p>
                    <div className="mt-1.5 h-1 rounded-full bg-dx-surface-2 overflow-hidden">
                        <div className="h-full rounded-full bg-gradient-to-r from-dx-green to-dx-cyan" style={{ width: `${Math.min(100, probPct)}%` }} />
                    </div>
                </div>

                {/* Equipos + chip de mercado + liga */}
                <div className="flex-1 min-w-0">
                    <h4 className="text-white font-bold text-sm sm:text-base leading-tight truncate">
                        {pick.home_team} <span className="text-dx-text-mute font-medium">vs</span> {pick.away_team}
                    </h4>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <span className="text-[11px] font-medium text-dx-green bg-dx-green/10 border border-dx-border-active rounded-md px-2 py-0.5">{tr.selectionEs}</span>
                        {pick.league && <span className="text-xs text-dx-text-mute truncate">{pick.league}</span>}
                    </div>
                </div>

                {/* Marcador (ayuda de verificación admin) */}
                {isAdmin && matchScore && (!pick.result || pick.result === 'PENDING') && (
                    <div className="hidden md:block shrink-0 bg-dx-surface-2 border border-dx-border rounded-lg px-2.5 py-1 text-center">
                        <span className="text-[9px] uppercase text-dx-text-mute block leading-none mb-0.5">Score</span>
                        <span className="text-white font-black text-sm dx-num">{matchScore}</span>
                    </div>
                )}

                {/* Cuota (dorada) + resultado + chevron */}
                <div className="shrink-0 flex items-center gap-2 sm:gap-3">
                    {isVerified && !presentationMode && <ResultBadge result={pick.result} actualScore={pick.actual_score} />}
                    <span className={`font-display font-extrabold text-base sm:text-xl dx-num ${validOdds ? 'text-dx-gold' : 'text-dx-text-mute'}`}>
                        {validOdds ? `@${pick.odds!.toFixed(2)}` : 'Sin cuota'}
                    </span>
                    <ChevronRight className="w-4 h-4 text-dx-text-mute group-hover:text-dx-green transition-colors" />
                </div>
            </div>

            {/* Sub-fila admin: stake + override + SEO (conserva toda la funcionalidad) */}
            {canOverride && (
                <div className="flex flex-wrap items-center gap-2 pb-3 px-1 sm:pl-24">
                    <span className="text-[10px] text-dx-text-mute mr-1">
                        Stake <b className="text-dx-green dx-num">{stakePercent}%</b> <span className="opacity-70">({stakeUnits}u)</span>
                        {potentialProfit && <> · <span className="text-dx-gold">+{potentialProfit}%</span></>}
                    </span>
                    <div className="flex items-center gap-1.5 ml-auto">
                        <button
                            onClick={(e) => handleOverride(e, 'WON')}
                            disabled={overriding}
                            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-dx-green/15 text-dx-green border border-dx-green/30 hover:bg-dx-green/25 transition-all disabled:opacity-50"
                        >
                            {overriding ? '...' : 'GANADA'}
                        </button>
                        <button
                            onClick={(e) => handleOverride(e, 'LOST')}
                            disabled={overriding}
                            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-dx-loss/15 text-dx-loss border border-dx-loss/30 hover:bg-dx-loss/25 transition-all disabled:opacity-50"
                        >
                            {overriding ? '...' : 'PERDIDA'}
                        </button>
                        <button
                            onClick={(e) => handleOverride(e, 'VOID')}
                            disabled={overriding}
                            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white/5 text-dx-text-soft border border-dx-border hover:bg-white/10 transition-all disabled:opacity-50"
                        >
                            {overriding ? '...' : 'NULA'}
                        </button>
                    </div>
                    <div className="w-full"><SeoPageLink fixtureId={pick.fixture_id} /></div>
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
