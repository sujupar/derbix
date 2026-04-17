import React, { useState, useEffect, useCallback } from 'react';
import { DashboardData, League, Game, VisualAnalysisResult, Country, AnalysisJob } from '../types';
import { fetchFixturesByDate, fetchLiveFixtures } from '../services/liveDataService';
import { createAnalysisJob, getAnalysisJob, getAnalysisResult, getAnalysisResultByRunId, getAnalysisResultByFixtureId, markJobAsTimedOut } from '../services/analysisService';
import { useAnalysisCache } from '../hooks/useAnalysisCache';
import { BrainIcon, CalendarDaysIcon, CheckCircleIcon, ChevronDownIcon, ChevronUpIcon, SparklesIcon, ArrowPathIcon, ListBulletIcon, TrophyIcon, SignalIcon, ChartBarIcon } from './icons/Icons';
import { getCurrentDateInBogota } from '../utils/dateUtils';
import { AnalysisInProgressModal } from './ai/AnalysisInProgressModal';
import { AnalysisReportModal } from './ai/AnalysisReportModal';
import { GameCard as DetailsGameCard } from './live/GameCard';
import FlashscoreLeagueGroup from './live/FlashscoreLeagueGroup';
import MatchDetailModal from './live/MatchDetailModal';
import HighProbPicks from './ai/HighProbPicks';
import SmartParlays from './ai/SmartParlays';
import BatchProgressBanner from './ai/BatchProgressBanner';
// ResultadosPublic moved to standalone ResultadosPage (sidebar section)
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../services/supabaseService';
import { useSubscriptionLimits } from '../hooks/useSubscriptionLimits';
import { UpgradePlanModal } from './pricing/UpgradePlanModal';
import { incrementUsage } from '../services/subscriptionService';
import { useOrganization } from '../contexts/OrganizationContext';
import { isHistoricalDate } from '../utils/planAccessUtils';
import { usePresentationMode } from '../hooks/usePresentationMode';
import { isAgencyRole } from '../utils/roles';

// --- COMPONENTES AUXILIARES ---

const LoadingState: React.FC<{ text: string }> = ({ text }) => (
    <div className="flex flex-col items-center justify-center h-64 text-center">
        <div className="w-8 h-8 border-4 border-brand border-t-transparent rounded-full animate-spin"></div>
        <p className="mt-4 text-lg font-medium text-slate-300 animate-pulse">{text}</p>
    </div>
);

// Tarjeta de Partido Inteligente
const AnalysisGameCard: React.FC<{
    game: Game,
    onAnalyze: () => void;
    onViewReport: () => void;
    jobStatus?: 'queued' | 'ingesting' | 'data_ready' | 'analyzing' | 'done' | 'failed' | 'insufficient_data';
    hasReport: boolean;
    userRole?: string;
}> = ({ game, onAnalyze, onViewReport, jobStatus, hasReport, userRole }) => {
    const [isDetailsExpanded, setIsDetailsExpanded] = useState(false);
    const scoreAvailable = game.goals.home !== null && game.goals.away !== null;
    const isAdmin = isAgencyRole(userRole);

    // Determinar estado visual del botón
    const isProcessing = jobStatus && ['queued', 'ingesting', 'data_ready', 'analyzing'].includes(jobStatus);
    const isFailed = jobStatus === 'failed' || jobStatus === 'insufficient_data';

    return (
        <div className={`glass group rounded-xl overflow-hidden transition-all duration-300 hover:bg-slate-800/60 border border-white/5 ${hasReport ? 'ring-1 ring-brand/50' : ''}`}>
            <div className="p-4 flex flex-col md:flex-row items-center gap-4">

                {/* Match Info / Time */}
                <div className="flex flex-col items-center justify-center w-full md:w-20 shrink-0 text-center border-b md:border-b-0 md:border-r border-white/5 pb-2 md:pb-0 md:pr-4">
                    {game.fixture.status.short === 'FT' ? (
                        <span className="text-xs font-bold text-slate-400">FIN</span>
                    ) : game.fixture.status.elapsed ? (
                        <span className="text-xs font-bold text-red-500 animate-pulse flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
                            {game.fixture.status.elapsed}'
                        </span>
                    ) : (
                        <span className="text-sm font-mono text-slate-300">{new Date(game.fixture.timestamp * 1000).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</span>
                    )}
                    <span className="text-[10px] text-slate-500 mt-1 uppercase tracking-wide">{new Date(game.fixture.timestamp * 1000).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })}</span>
                </div>

                {/* Teams & Score */}
                <div className="flex-1 flex items-center justify-between w-full gap-2 md:gap-4 overflow-hidden">
                    <div className="flex items-center gap-2 md:gap-3 flex-1 justify-end text-right min-w-0">
                        <span className="text-white font-bold text-sm md:text-base leading-tight truncate">{game.teams.home.name}</span>
                        <img src={game.teams.home.logo} alt={game.teams.home.name} className="w-6 h-6 md:w-8 md:h-8 object-contain shrink-0" />
                    </div>

                    <div className="px-2 md:px-3 py-1 bg-slate-950/50 rounded-lg border border-white/5 min-w-[50px] md:min-w-[60px] text-center shrink-0">
                        {scoreAvailable ? (
                            <span className="text-lg md:text-xl font-display font-bold text-white tracking-widest">{game.goals.home}-{game.goals.away}</span>
                        ) : (
                            <span className="text-base md:text-lg font-display font-bold text-slate-600">VS</span>
                        )}
                    </div>

                    <div className="flex items-center gap-2 md:gap-3 flex-1 justify-start text-left min-w-0">
                        <img src={game.teams.away.logo} alt={game.teams.away.name} className="w-6 h-6 md:w-8 md:h-8 object-contain shrink-0" />
                        <span className="text-white font-bold text-sm md:text-base leading-tight truncate">{game.teams.away.name}</span>
                    </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 w-full md:w-auto mt-2 md:mt-0 justify-end md:justify-start border-t md:border-t-0 border-white/5 pt-2 md:pt-0 shrink-0">
                    <button
                        onClick={() => setIsDetailsExpanded(!isDetailsExpanded)}
                        className="p-2 rounded-lg text-slate-400 hover:bg-white/5 hover:text-white transition-colors shrink-0"
                        title="Ver detalles"
                    >
                        {isDetailsExpanded ? <ChevronUpIcon className="w-5 h-5" /> : <ChevronDownIcon className="w-5 h-5" />}
                    </button>

                    {isProcessing ? (
                        <button disabled className="bg-slate-700/50 text-slate-400 px-3 md:px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 cursor-wait border border-white/5 shrink-0">
                            <div className="w-3 h-3 border-2 border-brand border-t-transparent rounded-full animate-spin"></div>
                            <span className="hidden md:inline">analizando...</span>
                            <span className="md:hidden">...</span>
                        </button>
                    ) : hasReport ? (
                        <div className="flex items-center gap-2 shrink-0">
                            <button
                                onClick={onViewReport}
                                className="bg-brand/10 hover:bg-brand/20 text-brand border border-brand/50 px-3 md:px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition-all shadow-[0_0_10px_rgba(16,185,129,0.1)] hover:shadow-[0_0_15px_rgba(16,185,129,0.3)] shrink-0"
                            >
                                <CheckCircleIcon className="w-4 h-4" /> <span className="hidden sm:inline">INFORME</span><span className="sm:hidden">VER</span>
                            </button>
                            {isAdmin && (
                                <button onClick={(e) => { e.stopPropagation(); onAnalyze(); }} className="p-2 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors shrink-0" title="Regenerar Análisis">
                                    <ArrowPathIcon className="w-4 h-4" />
                                </button>
                            )}
                        </div>
                    ) : isFailed ? (
                        isAdmin && (
                            <button onClick={(e) => { e.stopPropagation(); onAnalyze(); }} className="bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/50 px-3 md:px-4 py-2 rounded-lg text-xs font-bold transition-colors shrink-0">
                                REINTENTAR
                            </button>
                        )
                    ) : (
                        isAdmin && (
                            <button
                                onClick={(e) => { e.stopPropagation(); onAnalyze(); }}
                                className="bg-blue-600 hover:bg-blue-500 text-white px-3 md:px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition-all shadow-lg shadow-blue-900/20 hover:shadow-blue-600/30 shrink-0"
                            >
                                <SparklesIcon className="w-4 h-4" /> <span className="hidden sm:inline">ANALIZAR</span><span className="sm:hidden">IA</span>
                            </button>
                        )
                    )}
                </div>
            </div>

            {/* Expanded Details */}
            {isDetailsExpanded && (
                <div className="border-t border-white/5 bg-slate-900/30 p-4 animate-slide-up">
                    <DetailsGameCard game={game} />
                </div>
            )}
        </div>
    );
};

// --- LOGICA PRINCIPAL ---

export const FixturesFeed: React.FC = () => {
    const { profile } = useAuth();
    const { presentationMode } = usePresentationMode();
    const [data, setData] = useState<DashboardData>({ importantLeagues: [], countryLeagues: [] });
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    const [selectedDate, setSelectedDate] = useState(getCurrentDateInBogota());
    const [viewMode, setViewMode] = useState<'fixtures' | 'top-picks' | 'parlays'>('top-picks');
    const [resultsRefreshKey, setResultsRefreshKey] = useState(0);
    const handlePickOverridden = useCallback(() => setResultsRefreshKey(k => k + 1), []);
    const [showLiveOnly, setShowLiveOnly] = useState(false);
    const [detailGame, setDetailGame] = useState<Game | null>(null);
    const handleOpenDetail = useCallback((game: Game) => setDetailGame(game), []);

    // (Resultados tab moved to standalone page)

    // GESTIÓN DE JOBS
    const [activeJobs, setActiveJobs] = useState<Record<number, string>>({});
    const [gameJobStatus, setGameJobStatus] = useState<Record<number, AnalysisJob['status']>>({});
    const [reportsAvailable, setReportsAvailable] = useState<Record<number, boolean>>({});
    const [pickBasedAccessibleIds, setPickBasedAccessibleIds] = useState<Set<number>>(new Set());

    // ID MAPPING: SportMonks ID (frontend) ↔ legacy API-Football ID (historical data)
    // daily-match-scanner (API-Football) is now DISABLED. New data uses SportMonks IDs only.
    // This mapping exists as a safety net for historical analyses saved with API-Football IDs.
    const alternateIdsRef = React.useRef<Record<number, number>>({}); // frontendId → legacyDbId

    // GESTIÓN DE COLA (BATCH ANALYSIS)
    const [analysisQueue, setAnalysisQueue] = useState<Game[]>([]);
    const [activeBatchJobId, setActiveBatchJobId] = useState<string | null>(null);
    const [processingFixtureId, setProcessingFixtureId] = useState<number | null>(null);
    const isProcessingQueue = React.useRef(false); // Ref guard for sequential processing
    const pollErrorCount = React.useRef(0); // Consecutive poll errors before skipping
    const pollMissingCount = React.useRef(0); // Consecutive "job not found" before skipping (maybeSingle -> null)
    const processingFixtureIdRef = React.useRef<number | null>(null); // Ref backup for closure access
    const batchRetries = React.useRef<Set<number>>(new Set()); // Track retried fixtures (max 1 retry each)
    const [batchCooldown, setBatchCooldown] = useState(false); // 5s cooldown between batch analyses

    // BATCH PROGRESS TRACKING
    const [batchProgress, setBatchProgress] = useState<{
        total: number;
        completed: number;
        currentGame: Game | null;
        leagueName: string;
        isActive: boolean;
        results: Record<number, 'done' | 'failed'>;
    }>({ total: 0, completed: 0, currentGame: null, leagueName: '', isActive: false, results: {} });

    // UI MODALS
    const [currentJob, setCurrentJob] = useState<AnalysisJob | null>(null);
    const [isJobModalOpen, setIsJobModalOpen] = useState(false);
    const [viewingResult, setViewingResult] = useState<VisualAnalysisResult | null>(null);

    // ═══════════════════════════════════════════════════════════════
    // FIX: Persistencia de informe en URL (no desaparece al refrescar)
    // ═══════════════════════════════════════════════════════════════
    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const reportFixtureId = urlParams.get('report');

        if (reportFixtureId && !viewingResult) {
            console.log(`[LiveFeed] Cargando informe desde URL: fixture ${reportFixtureId}`);
            const loadReportFromUrl = async () => {
                const result = await getAnalysisResultByFixtureId(Number(reportFixtureId));
                if (result) {
                    setViewingResult(result);
                } else {
                    // Limpiar URL si no existe el informe
                    window.history.replaceState(null, '', window.location.pathname);
                }
            };
            loadReportFromUrl();
        }
    }, []);

    // 1. Cargar Partidos
    useEffect(() => {
        const loadFixtures = async () => {
            if (viewMode === 'top-picks') return;
            setIsLoading(true);
            try {
                // 1. Cargar Partidos
                console.log(`[DEBUG] LiveFeed: calling fetchFixturesByDate for ${selectedDate}`);
                const result = await fetchFixturesByDate(selectedDate);
                console.log(`[DEBUG] LiveFeed: received result`, result);
                setData(result);

                // 2. Cargar Estado de Análisis Existentes (Persistencia)
                const fixtureIds = [
                    ...result.importantLeagues.flatMap(l => l.games.map(g => g.fixture.id)),
                    ...result.countryLeagues.flatMap(c => c.leagues.flatMap(l => l.games.map(g => g.fixture.id)))
                ];

                if (fixtureIds.length > 0) {
                    const newReportsAvailable: Record<number, boolean> = {};
                    const newGameJobStatus: Record<number, AnalysisJob['status']> = {};
                    const newActiveJobs: Record<number, string> = {};

                    // ═══════════════════════════════════════════════════════════════
                    // ID CROSS-REFERENCE: SportMonks IDs ↔ API-Football IDs
                    // daily_matches may use API-Football IDs while frontend uses SportMonks IDs.
                    // Build a mapping so we can find analysis data regardless of which ID system was used.
                    // ═══════════════════════════════════════════════════════════════
                    const dbIdToFrontendId: Record<number, number> = {};
                    const frontendIdToDbId: Record<number, number> = {};

                    const { data: dailyMatches } = await supabase
                        .from('daily_matches')
                        .select('api_fixture_id, home_team, away_team')
                        .eq('match_date', selectedDate);

                    if (dailyMatches && dailyMatches.length > 0) {
                        const allGames = [
                            ...result.importantLeagues.flatMap(l => l.games),
                            ...result.countryLeagues.flatMap(c => c.leagues.flatMap(l => l.games))
                        ];

                        const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

                        for (const dm of dailyMatches) {
                            // If this daily_matches ID is already in our frontend list, no mapping needed
                            if (fixtureIds.includes(dm.api_fixture_id)) continue;

                            const dmHome = normalize(dm.home_team);
                            const dmAway = normalize(dm.away_team);

                            const game = allGames.find(g => {
                                const gHome = normalize(g.teams.home.name);
                                const gAway = normalize(g.teams.away.name);
                                return (gHome.includes(dmHome) || dmHome.includes(gHome)) &&
                                       (gAway.includes(dmAway) || dmAway.includes(gAway));
                            });

                            if (game) {
                                dbIdToFrontendId[dm.api_fixture_id] = game.fixture.id;
                                frontendIdToDbId[game.fixture.id] = dm.api_fixture_id;
                            }
                        }

                        // Store mapping for handleViewReport
                        alternateIdsRef.current = frontendIdToDbId;
                        console.log(`[LiveFeed] ID mapping: ${Object.keys(dbIdToFrontendId).length} alternate IDs (SportMonks↔API-Football)`);
                    }

                    // Combine SportMonks IDs + API-Football IDs for comprehensive queries
                    const altIds = Object.keys(dbIdToFrontendId).map(Number);
                    const allSearchIds = [...new Set([...fixtureIds, ...altIds])];

                    // Helper to resolve any ID back to frontend ID
                    const toFrontendId = (id: number) => dbIdToFrontendId[id] ?? id;

                    // ═══════════════════════════════════════════════════════════════
                    // Check analysis_jobs_v2 for done/in-progress jobs
                    // ═══════════════════════════════════════════════════════════════
                    const { data: v2Jobs, error: v2Error } = await supabase
                        .from('analysis_jobs_v2')
                        .select('fixture_id, status, id, created_at')
                        .in('fixture_id', allSearchIds)
                        .or('analysis_type.eq.standard,analysis_type.is.null');

                    if (!v2Error && v2Jobs) {
                        v2Jobs.forEach(job => {
                            const fid = toFrontendId(job.fixture_id);
                            if (job.status === 'done') {
                                newReportsAvailable[fid] = true;
                                newActiveJobs[fid] = job.id;
                            } else if (job.status === 'failed' || job.status === 'insufficient_data') {
                                // Don't block the game — let user retry
                                newGameJobStatus[fid] = job.status as any;
                            } else if (!newActiveJobs[fid]) {
                                // For non-terminal statuses (analyzing, etl, etc.), check if stale (>10 min)
                                const jobAge = Date.now() - new Date(job.created_at || 0).getTime();
                                const STALE_MS = 10 * 60 * 1000;
                                if (jobAge > STALE_MS) {
                                    console.warn(`[LiveFeed] Stale job ${job.id} (${job.status}, ${Math.round(jobAge/60000)}min old) — treating as failed`);
                                    newGameJobStatus[fid] = 'failed' as any;
                                } else {
                                    newGameJobStatus[fid] = job.status as any;
                                    newActiveJobs[fid] = job.id;
                                }
                            }
                        });
                        console.log(`[LiveFeed] V2 Jobs: ${v2Jobs.filter(j => j.status === 'done').length} done, ${v2Jobs.filter(j => j.status !== 'done' && j.status !== 'failed').length} in-progress`);
                    }

                    // Check 'analisis' table
                    const { data: analisisRows } = await supabase
                        .from('analisis')
                        .select('partido_id')
                        .in('partido_id', allSearchIds);

                    if (analisisRows) {
                        analisisRows.forEach(row => {
                            const fid = toFrontendId(row.partido_id);
                            if (!newReportsAvailable[fid]) {
                                newReportsAvailable[fid] = true;
                            }
                        });
                    }

                    // Check reports_v2 table
                    const { data: reportsRows } = await supabase
                        .from('reports_v2')
                        .select('fixture_id')
                        .in('fixture_id', allSearchIds);

                    if (reportsRows) {
                        reportsRows.forEach(row => {
                            const fid = toFrontendId(row.fixture_id);
                            if (!newReportsAvailable[fid]) {
                                newReportsAvailable[fid] = true;
                            }
                        });
                        console.log(`[LiveFeed] reports_v2 check: found ${reportsRows.length} reports`);
                    }

                    setReportsAvailable(prev => ({ ...prev, ...newReportsAvailable }));
                    setGameJobStatus(prev => ({ ...prev, ...newGameJobStatus }));
                    setActiveJobs(prev => ({ ...prev, ...newActiveJobs }));
                }

            } catch (err: any) {
                console.error(`[DEBUG] LiveFeed: error loading fixtures`, err);
                setError(err.message || 'Error al cargar partidos.');
            } finally {
                setIsLoading(false);
            }
        };
        loadFixtures();
    }, [selectedDate, viewMode]);

    // 2. Polling de Jobs Activos (MODAL)
    useEffect(() => {
        if (!isJobModalOpen || !currentJob) return;
        if (['done', 'failed', 'insufficient_data'].includes(currentJob.status)) return;

        const interval = setInterval(async () => {
            const updatedJob = await getAnalysisJob(currentJob.id);
            if (updatedJob) {
                setCurrentJob(updatedJob);
                setGameJobStatus(prev => ({ ...prev, [updatedJob.api_fixture_id]: updatedJob.status }));

                if (updatedJob.status === 'done') {
                    setReportsAvailable(prev => ({ ...prev, [updatedJob.api_fixture_id]: true }));
                    setTimeout(async () => {
                        setIsJobModalOpen(false);
                        await handleViewReport(updatedJob.id, updatedJob.api_fixture_id);
                    }, 1500);
                } else if (updatedJob.status === 'failed' || updatedJob.status === 'insufficient_data') {
                    setTimeout(() => setIsJobModalOpen(false), 8000);
                }
            }
        }, 2000);

        return () => clearInterval(interval);
    }, [currentJob, isJobModalOpen]);

    // 2.1 Polling de Batch Jobs (COLA)
    useEffect(() => {
        const processQueue = async () => {
            // Guard: If already processing, active job, empty queue, or cooling down -> STOP
            if (isProcessingQueue.current || activeBatchJobId || analysisQueue.length === 0 || batchCooldown) return;

            isProcessingQueue.current = true; // Lock
            const nextGame = analysisQueue[0];
            setProcessingFixtureId(nextGame.fixture.id);
            processingFixtureIdRef.current = nextGame.fixture.id; // Ref backup for closures
            setBatchProgress(prev => ({ ...prev, currentGame: nextGame }));

            try {
                console.log(`[Batch] Starting sequential analysis for: ${nextGame.teams.home.name} vs ${nextGame.teams.away.name}`);
                setGameJobStatus(prev => ({ ...prev, [nextGame.fixture.id]: 'queued' }));

                // CRITICAL: Await here ensures strict sequential creation
                const jobId = await createAnalysisJob(nextGame.fixture.id);

                setActiveJobs(prev => ({ ...prev, [nextGame.fixture.id]: jobId }));
                setActiveBatchJobId(jobId);

            } catch (error) {
                console.error("Error starting batch job:", error);
                setGameJobStatus(prev => ({ ...prev, [nextGame.fixture.id]: 'failed' }));

                // If failed to start, remove from queue immediately to unblock next
                setAnalysisQueue(prev => prev.slice(1));
                setProcessingFixtureId(null);
                processingFixtureIdRef.current = null;
            } finally {
                isProcessingQueue.current = false; // Unlock
            }
        };

        processQueue();
    }, [activeBatchJobId, analysisQueue, batchCooldown]);

    useEffect(() => {
        if (!activeBatchJobId) return;

        const startTime = Date.now();
        const MAX_WAIT_MS = 300000; // 5 minutes max per job

        const advanceBatch = (fixtureId: number, result: 'done' | 'failed') => {
            // 5s cooldown between batch analyses to avoid Gemini API overload
            setBatchCooldown(true);
            setActiveBatchJobId(null);
            setProcessingFixtureId(null);
            processingFixtureIdRef.current = null;
            setAnalysisQueue(prev => {
                const remaining = prev.slice(1);
                // Use queue length as source of truth: batch finishes when queue is empty
                setBatchProgress(bp => {
                    const newCompleted = bp.completed + 1;
                    const newResults = { ...bp.results, [fixtureId]: result };
                    const isDone = remaining.length === 0;
                    return { ...bp, completed: newCompleted, results: newResults, currentGame: null, isActive: !isDone };
                });
                return remaining;
            });
            console.log(`[Batch] 5s cooldown before next analysis...`);
            setTimeout(() => setBatchCooldown(false), 5000);
        };

        const interval = setInterval(async () => {
            try {
                const elapsed = Date.now() - startTime;

                if (elapsed > MAX_WAIT_MS) {
                    console.warn(`[Batch] Job ${activeBatchJobId} timed out after ${Math.round(elapsed/1000)}s. Skipping.`);
                    pollErrorCount.current = 0;
                    // Mark job as failed in DB to prevent "stuck in-progress" in Oportunidades
                    markJobAsTimedOut(activeBatchJobId).catch(() => {});
                    const fid = processingFixtureId || processingFixtureIdRef.current;
                    if (fid) {
                        setGameJobStatus(prev => ({ ...prev, [fid]: 'failed' }));
                        advanceBatch(fid, 'failed');
                    } else {
                        console.warn('[Batch] No fixtureId available for timeout cleanup. Force-advancing queue.');
                        setActiveBatchJobId(null);
                        setProcessingFixtureId(null);
                        processingFixtureIdRef.current = null;
                        setBatchProgress(bp => ({ ...bp, completed: bp.completed + 1, isActive: false }));
                        setAnalysisQueue(prev => prev.slice(1));
                    }
                    return;
                }

                const updatedJob = await getAnalysisJob(activeBatchJobId);
                pollErrorCount.current = 0;

                if (updatedJob) {
                    pollMissingCount.current = 0;
                    setGameJobStatus(prev => ({ ...prev, [updatedJob.api_fixture_id]: updatedJob.status }));

                    if (['done', 'failed', 'insufficient_data'].includes(updatedJob.status)) {
                        console.log(`[Batch] Job finished: ${updatedJob.id} (${updatedJob.status}).`);
                        if (updatedJob.status === 'done') {
                            setReportsAvailable(prev => ({ ...prev, [updatedJob.api_fixture_id]: true }));
                            advanceBatch(updatedJob.api_fixture_id, 'done');
                        } else {
                            // Failed — retry once before giving up
                            const fid = updatedJob.api_fixture_id;
                            if (!batchRetries.current.has(fid)) {
                                batchRetries.current.add(fid);
                                console.log(`[Batch] Retrying failed analysis for fixture ${fid} in 10s...`);
                                // Clear active job but DON'T dequeue — retry same fixture
                                setActiveBatchJobId(null);
                                setProcessingFixtureId(null);
                                processingFixtureIdRef.current = null;
                                setGameJobStatus(prev => ({ ...prev, [fid]: 'queued' }));
                                setBatchCooldown(true);
                                setTimeout(() => setBatchCooldown(false), 10000); // 10s cooldown for retry
                            } else {
                                // Already retried once — skip to next
                                advanceBatch(fid, 'failed');
                            }
                        }
                    }
                } else {
                    // Job not found (deleted by another analyzer OR INSERT delay).
                    // Grace period: tolerate up to 3 consecutive "missing" polls (9s) before skipping.
                    pollMissingCount.current++;
                    console.warn(`[Batch] Job ${activeBatchJobId} not found (missing #${pollMissingCount.current}).`);
                    if (pollMissingCount.current >= 3) {
                        console.warn(`[Batch] Job ${activeBatchJobId} confirmed missing. Skipping.`);
                        pollMissingCount.current = 0;
                        const fid = processingFixtureId || processingFixtureIdRef.current;
                        if (fid) advanceBatch(fid, 'failed');
                        else { setActiveBatchJobId(null); setProcessingFixtureId(null); processingFixtureIdRef.current = null; setAnalysisQueue(prev => prev.slice(1)); }
                    }
                }
            } catch (e) {
                pollErrorCount.current++;
                console.error(`[Batch] Poll error #${pollErrorCount.current} for job ${activeBatchJobId}:`, e);

                if (pollErrorCount.current >= 3) {
                    console.warn(`[Batch] ${pollErrorCount.current} consecutive poll errors. Skipping to next job.`);
                    pollErrorCount.current = 0;
                    const fid = processingFixtureId || processingFixtureIdRef.current;
                    if (fid) {
                        setGameJobStatus(prev => ({ ...prev, [fid]: 'failed' }));
                        advanceBatch(fid, 'failed');
                    } else {
                        console.warn('[Batch] No fixtureId available for error cleanup. Force-advancing queue.');
                        setActiveBatchJobId(null);
                        setProcessingFixtureId(null);
                        processingFixtureIdRef.current = null;
                        setBatchProgress(bp => ({ ...bp, completed: bp.completed + 1, isActive: false }));
                        setAnalysisQueue(prev => prev.slice(1));
                    }
                }
            }
        }, 3000);

        return () => clearInterval(interval);
    }, [activeBatchJobId]);

    // 3. Iniciar Análisis (Individual)
    // Hook de suscripciones
    const { subscription, checkAnalysisAccess, analysesRemaining, recommendedUpgrade } = useSubscriptionLimits();
    const { currentOrg, isImpersonating } = useOrganization();
    const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);
    const [upgradeReason, setUpgradeReason] = useState('');

    // 3. Iniciar Análisis de Partido Individual
    const handleAnalyzeGame = async (game: Game) => {
        // Verificar límite de análisis
        const accessCheck = await checkAnalysisAccess();

        if (!accessCheck.allowed) {
            setUpgradeReason(accessCheck.message || 'Actualiza tu plan para acceder a más análisis');
            setIsUpgradeModalOpen(true);
            return;
        }
        try {
            setGameJobStatus(prev => ({ ...prev, [game.fixture.id]: 'queued' }));
            const jobId = await createAnalysisJob(game.fixture.id);
            setActiveJobs(prev => ({ ...prev, [game.fixture.id]: jobId }));

            // Trackear uso despues de crear el job exitosamente
            if (profile?.id && currentOrg?.id) {
                await incrementUsage(profile.id, currentOrg.id, 'analyses');
            }

            const initialJobState: AnalysisJob = {
                id: jobId,
                api_fixture_id: game.fixture.id,
                fixture_id: '',
                status: 'queued',
                completeness_score: 0,
                estimated_calls: 0,
                actual_calls: 0,
                progress_jsonb: { step: 'Encolando petición...', completeness_score: 0, fetched_items: 0, total_items: 0 },
                created_at: new Date().toISOString()
            };
            setCurrentJob(initialJobState);
            setIsJobModalOpen(true);

        } catch (err: any) {
            console.error(err);
            setGameJobStatus(prev => ({ ...prev, [game.fixture.id]: 'failed' }));
            alert("Error al iniciar job: " + err.message);
        }
    };

    // 3.1 Iniciar Análisis de Liga (Batch)
    const handleAnalyzeLeague = (league: League) => {
        console.log(`[Batch] Queueing league ${league.name} with ${league.games.length} games`);

        // Filter valid candidates: exclude already-analyzed, in-progress, in-queue, and already-batched
        const candidates = league.games.filter(g => {
            const fid = g.fixture.id;
            const hasReport = !!reportsAvailable[fid];
            const status = gameJobStatus[fid] || '';
            const isProcessingOrDone = ['queued', 'ingesting', 'data_ready', 'analyzing', 'collecting_evidence', 'etl', 'interpret', 'features', 'done', 'processing'].includes(status);
            const isCurrent = fid === processingFixtureId;
            // Also exclude games already processed in current batch
            const alreadyBatched = !!batchProgress.results[fid];
            return !hasReport && !isProcessingOrDone && !isCurrent && !alreadyBatched;
        });

        if (candidates.length === 0) {
            alert("No hay partidos pendientes de análisis en esta liga o ya están en proceso.");
            return;
        }

        // Add to queue with deduplication based on CURRENT queue state (prev)
        setAnalysisQueue(prev => {
            const existingIds = new Set(prev.map(p => p.fixture.id));
            const newUniqueGames = candidates.filter(c => !existingIds.has(c.fixture.id));
            const addedCount = newUniqueGames.length;

            if (addedCount === 0) {
                console.log(`[Batch] All ${candidates.length} candidates already in queue. Skipping.`);
                return prev;
            }

            console.log(`[Batch] Adding ${addedCount} new games to queue (Length: ${prev.length} -> ${prev.length + addedCount})`);

            // Accumulate into existing batch if active, otherwise start fresh
            setBatchProgress(prev => {
                if (!prev.isActive) {
                    // Fresh batch — clear retry tracking
                    batchRetries.current.clear();
                    return {
                        total: addedCount,
                        completed: 0,
                        currentGame: null,
                        leagueName: league.name,
                        isActive: true,
                        results: {}
                    };
                }
                // Active batch — accumulate new games
                return {
                    ...prev,
                    total: prev.total + addedCount,
                    leagueName: `${prev.leagueName} + ${league.name}`,
                    isActive: true
                };
            });

            // APPEND to existing queue (don't replace)
            return [...prev, ...newUniqueGames];
        });
    };

    // Calcular Set de reportes accesibles segun plan
    // Fuente de verdad: los picks visibles en Oportunidades (pickBasedAccessibleIds)
    const accessibleReportsSet = React.useMemo<Set<number>>(() => {
        const allReportIds = Object.keys(reportsAvailable).filter(k => reportsAvailable[Number(k)]).map(Number);

        const isAgency = isAgencyRole(isImpersonating ? 'user' : profile?.role);
        if (isAgency) {
            return new Set(allReportIds);
        }

        if (isHistoricalDate(selectedDate)) {
            return new Set(allReportIds);
        }

        // Picks visibles = accesibles (sin intersectar con reportsAvailable,
        // porque reportsAvailable puede no haber cargado aún todos los fixtures).
        // El lock icon en Partidos usa hasReport && !accessible, asi que incluir
        // fixtures sin reporte aqui es inofensivo.
        const accessible = new Set<number>(pickBasedAccessibleIds);
        return accessible;
    }, [reportsAvailable, pickBasedAccessibleIds, profile?.role, selectedDate, isImpersonating]);

    // Gating Helper — Verifica acceso a un reporte especifico
    const verifyReportAccess = async (fixtureId?: number): Promise<boolean> => {
        if (isHistoricalDate(selectedDate)) return true;

        const isAgency = isAgencyRole(isImpersonating ? 'user' : profile?.role);
        if (isAgency) return true;

        // Si el fixture esta en el set de picks accesibles, permitir inmediatamente
        if (fixtureId && accessibleReportsSet.has(fixtureId)) {
            return true;
        }

        // Si tenemos fixtureId pero NO esta en el set accesible, bloquear
        if (fixtureId) {
            setUpgradeReason('Actualiza tu plan para acceder a este informe de análisis.');
            setIsUpgradeModalOpen(true);
            return false;
        }

        // Sin fixtureId: bloquear por defecto (no deberia ocurrir)
        setUpgradeReason('Actualiza tu plan para acceder a los análisis de IA.');
        setIsUpgradeModalOpen(true);
        return false;
    };

    // 4. Ver Reporte (con persistencia en URL)
    const handleViewReport = async (jobIdOrGameId: string | number, gameIdIfAvailable?: number) => {
        // Determinar fixtureId para gating
        const gatingFixtureId = gameIdIfAvailable || (typeof jobIdOrGameId === 'number' ? jobIdOrGameId : undefined);

        // Enforce Limits (con fixture-specific check)
        const allowed = await verifyReportAccess(gatingFixtureId);
        if (!allowed) return;

        let jobId = typeof jobIdOrGameId === 'string' ? jobIdOrGameId : activeJobs[jobIdOrGameId];
        if (!jobId && typeof jobIdOrGameId === 'string') jobId = jobIdOrGameId;

        const fixtureId = gameIdIfAvailable || (typeof jobIdOrGameId === 'number' ? jobIdOrGameId : null);

        let result = null;

        // Try by job ID first
        if (jobId) {
            result = await getAnalysisResult(jobId);
        }

        // Fallback: try by fixture ID directly (SportMonks ID)
        if (!result && fixtureId) {
            result = await getAnalysisResultByFixtureId(fixtureId);
        }

        // Fallback: try by alternate ID (API-Football ID from daily_matches)
        if (!result && fixtureId) {
            const altId = alternateIdsRef.current[fixtureId];
            if (altId) {
                console.log(`[LiveFeed] Trying alternate ID: ${fixtureId} → ${altId}`);
                result = await getAnalysisResultByFixtureId(altId);
            }
        }

        if (result) {
            if (fixtureId) {
                window.history.replaceState(null, '', `?report=${fixtureId}`);
            }
            setViewingResult(result);
        }
    };

    // Cerrar informe y limpiar URL
    const handleCloseReport = () => {
        window.history.replaceState(null, '', window.location.pathname);
        setViewingResult(null);
    };

    return (
        <div className="space-y-8 pb-24">
            <div className="flex flex-col space-y-6">
                {/* Header & Date Picker */}
                <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
                    <div>
                        <h2 className="text-2xl sm:text-3xl font-display font-bold text-white tracking-tight">Jornadas Deportivas</h2>
                        <p className="text-slate-400 mt-1">Explora los encuentros y potencia tus decisiones con IA.</p>
                    </div>

                    <div className="flex flex-col sm:flex-row items-center gap-3 w-full lg:w-auto">
                        <div className="relative w-full sm:w-auto">
                            <input
                                type="date"
                                value={selectedDate}
                                onChange={(e) => setSelectedDate(e.target.value)}
                                className="w-full bg-slate-800 border-none text-white text-sm rounded-xl px-4 py-3 focus:ring-2 focus:ring-brand shadow-lg outline-none"
                            />
                            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                                <CalendarDaysIcon className="w-5 h-5" />
                            </div>
                        </div>

                        <div className="bg-slate-800 p-1 rounded-xl flex gap-1 w-full sm:w-auto">
                            <button
                                onClick={() => setViewMode('top-picks')}
                                data-onboarding="tab-opportunities"
                                className={`flex-1 sm:flex-none flex items-center justify-center px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${viewMode === 'top-picks' ? 'bg-gradient-to-r from-brand to-emerald-600 text-white shadow-lg shadow-brand/20' : 'text-slate-400 hover:text-white'
                                    }`}
                            >
                                <TrophyIcon className="w-5 h-5 sm:mr-2" /> <span className="hidden sm:inline">Oportunidades</span>
                            </button>
                            <button
                                onClick={() => setViewMode('parlays')}
                                data-onboarding="tab-parlays"
                                className={`flex-1 sm:flex-none flex items-center justify-center px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${viewMode === 'parlays' ? 'bg-gradient-to-r from-purple-500 to-indigo-600 text-white shadow-lg shadow-purple-500/20' : 'text-slate-400 hover:text-white'
                                    }`}
                            >
                                <SparklesIcon className="w-5 h-5 sm:mr-2" /> <span className="hidden sm:inline">Parlays</span>
                            </button>
                            <button
                                onClick={() => setViewMode('fixtures')}
                                className={`flex-1 sm:flex-none flex items-center justify-center px-4 py-2 rounded-lg text-sm font-bold transition-all ${viewMode === 'fixtures' ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-400 hover:text-white'
                                    }`}
                            >
                                <ListBulletIcon className="w-5 h-5 sm:mr-2" /> <span className="hidden sm:inline">Partidos</span>
                            </button>
                            {viewMode === 'fixtures' && (
                                <button
                                    onClick={() => setShowLiveOnly(!showLiveOnly)}
                                    className={`flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all ${showLiveOnly ? 'bg-red-500/20 text-red-400 ring-1 ring-red-500/50' : 'text-slate-500 hover:text-red-400 hover:bg-red-500/10'}`}
                                >
                                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                                    EN VIVO
                                </button>
                            )}
                            {/* Resultados tab moved to standalone sidebar section */}
                        </div>
                    </div>
                </div>

                {viewMode === 'top-picks' ? (
                    <div className="glass rounded-2xl p-3 sm:p-4 md:p-6 min-h-[500px] animate-fade-in border border-white/5">
                        <HighProbPicks
                            date={selectedDate}
                            onViewReport={handleViewReport}
                            onPickOverridden={handlePickOverridden}
                            onAccessibleFixturesChange={setPickBasedAccessibleIds}
                        />
                    </div>
                ) : viewMode === 'parlays' ? (
                    <div className="animate-fade-in">
                        <SmartParlays date={selectedDate} />
                    </div>
                ) : (
                    <>
                        {isLoading && <LoadingState text="Sincronizando fixture..." />}
                        {!isLoading && (
                            <div className="space-y-8 animate-fade-in">
                                {/* Batch Progress Banner */}
                                <BatchProgressBanner
                                    {...batchProgress}
                                    onCancel={() => {
                                        console.log('[Batch] Cancelled by user');
                                        setAnalysisQueue([]);
                                        setActiveBatchJobId(null);
                                        setProcessingFixtureId(null);
                                        processingFixtureIdRef.current = null;
                                        isProcessingQueue.current = false;
                                        pollErrorCount.current = 0;
                                        setBatchProgress({ total: 0, completed: 0, currentGame: null, leagueName: '', isActive: false, results: {} });
                                    }}
                                    onDismiss={() => {
                                        setBatchProgress({ total: 0, completed: 0, currentGame: null, leagueName: '', isActive: false, results: {} });
                                    }}
                                />

                                {/* Flashscore-style league groups */}
                                {(() => {
                                    // Flatten all leagues into a single list
                                    const allLeagues = [
                                        ...data.importantLeagues,
                                        ...data.countryLeagues.flatMap(c => c.leagues)
                                    ];

                                    // Filter live only if toggle is active
                                    const LIVE_STATUSES = ['LIVE', '1H', 'HT', '2H', 'ET', 'BT', 'PEN_LIVE', 'BREAK', 'INT'];
                                    const filteredLeagues = showLiveOnly
                                        ? allLeagues
                                            .map(league => ({
                                                ...league,
                                                games: league.games.filter(g =>
                                                    LIVE_STATUSES.includes(g.fixture.status.short)
                                                )
                                            }))
                                            .filter(league => league.games.length > 0)
                                        : allLeagues;

                                    if (filteredLeagues.length === 0) {
                                        return (
                                            <div className="text-center py-16">
                                                <SignalIcon className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                                                <p className="text-slate-400 text-sm">
                                                    {showLiveOnly ? 'No hay partidos en vivo en este momento.' : 'No hay partidos disponibles para esta fecha.'}
                                                </p>
                                            </div>
                                        );
                                    }

                                    return (
                                        <div className="space-y-2">
                                            {filteredLeagues.map(league => (
                                                <FlashscoreLeagueGroup
                                                    key={league.id}
                                                    league={league}
                                                    gameJobStatus={gameJobStatus}
                                                    reportsAvailable={reportsAvailable}
                                                    accessibleReports={accessibleReportsSet}
                                                    userRole={isImpersonating ? 'user' : profile?.role}
                                                    onOpenDetail={handleOpenDetail}
                                                    onAnalyzeGame={handleAnalyzeGame}
                                                    onAnalyzeLeague={() => handleAnalyzeLeague(league)}
                                                    onViewReport={handleViewReport}
                                                />
                                            ))}
                                        </div>
                                    );
                                })()}
                            </div>
                        )}
                    </>
                )}
            </div>

            <AnalysisInProgressModal job={currentJob} isOpen={isJobModalOpen} />
            <AnalysisReportModal analysis={viewingResult} onClose={handleCloseReport} />

            {/* Match Detail Modal (Flashscore-style) */}
            {detailGame && (
                <MatchDetailModal
                    game={detailGame}
                    onClose={() => setDetailGame(null)}
                    hasReport={!!reportsAvailable[detailGame.fixture.id]}
                    isReportLocked={!!reportsAvailable[detailGame.fixture.id] && !accessibleReportsSet.has(detailGame.fixture.id)}
                    onViewReport={() => {
                        setDetailGame(null);
                        handleViewReport(detailGame.fixture.id);
                    }}
                    onAnalyze={() => {
                        handleAnalyzeGame(detailGame);
                    }}
                    userRole={isImpersonating ? 'user' : profile?.role}
                />
            )}

            {/* Modal de Upgrade */}
            <UpgradePlanModal
                isOpen={isUpgradeModalOpen}
                onClose={() => setIsUpgradeModalOpen(false)}
                currentPlan={{
                    name: subscription?.planName || 'free',
                    displayName: subscription?.displayName || 'Gratis'
                }}
                recommendedPlan={recommendedUpgrade}
                reason={upgradeReason}
            />
        </div>
    );
};

// --- SUB-COMPONENTES UI MEJORADOS ---

const CountrySection: React.FC<{
    country: Country;
    onAnalyzeGame: (game: Game) => void;
    onAnalyzeLeague: (league: League) => void;
    onViewReport: (gameId: number) => void;
    gameJobStatus: Record<number, AnalysisJob['status']>;
    reportsAvailable: Record<number, boolean>;
    userRole?: string;
}> = ({ country, onAnalyzeGame, onAnalyzeLeague, onViewReport, gameJobStatus, reportsAvailable, userRole }) => {
    const [isExpanded, setIsExpanded] = useState(true);

    return (
        <div className="glass rounded-xl overflow-hidden border border-white/5 transition-all duration-300">
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full flex justify-between items-center p-4 hover:bg-white/5 transition-colors"
            >
                <div className="flex items-center gap-4">
                    {country.flag ? (
                        <img src={country.flag} alt={country.name} className="w-8 h-8 rounded-full object-cover shadow-sm ring-2 ring-white/10" />
                    ) : (
                        <div className="w-8 h-8 bg-slate-700 rounded-full flex items-center justify-center text-xs font-bold text-slate-300">?</div>
                    )}
                    <div className="text-left">
                        <h2 className="text-lg font-bold text-white">{country.name}</h2>
                        <p className="text-xs text-slate-500">{country.leagues.length} competiciones disponibles</p>
                    </div>
                </div>
                {isExpanded ? <ChevronUpIcon className="w-5 h-5 text-slate-400" /> : <ChevronDownIcon className="w-5 h-5 text-slate-400" />}
            </button>

            {isExpanded && (
                <div className="p-4 bg-slate-900/40 space-y-6 border-t border-white/5">
                    {country.leagues.map(league => (
                        <LeagueSection
                            key={league.id}
                            league={league}
                            onAnalyzeGame={onAnalyzeGame}
                            onAnalyzeLeague={() => onAnalyzeLeague(league)}
                            onViewReport={onViewReport}
                            gameJobStatus={gameJobStatus}
                            reportsAvailable={reportsAvailable}
                            userRole={userRole}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

const LeagueSection: React.FC<{
    league: League;
    onAnalyzeGame: (game: Game) => void;
    onAnalyzeLeague?: () => void;
    onViewReport: (gameId: number) => void;
    gameJobStatus: Record<number, AnalysisJob['status']>;
    reportsAvailable: Record<number, boolean>;
    userRole?: string;
}> = ({ league, onAnalyzeGame, onAnalyzeLeague, onViewReport, gameJobStatus, reportsAvailable, userRole }) => {
    const [isExpanded, setIsExpanded] = useState(true);
    const isAdmin = isAgencyRole(userRole);

    return (
        <div className="mb-6 last:mb-0 shadow-lg shadow-black/20 rounded-xl overflow-hidden">
            <div className={`w-full flex justify-between items-center p-4 bg-gradient-to-r from-slate-800 to-slate-900 border-l-4 border-brand`}>
                <div className="flex items-center flex-grow min-w-0 cursor-pointer gap-4" onClick={() => setIsExpanded(!isExpanded)}>
                    {league.logo && <img src={league.logo} alt={league.name} className="w-10 h-10 object-contain drop-shadow-md" />}
                    <div>
                        <h3 className="text-lg font-display font-bold text-white truncate">{league.name}</h3>
                        <p className="text-xs text-slate-500 font-mono">{league.games.length} PARTIDOS</p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    {onAnalyzeLeague && isAdmin && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onAnalyzeLeague(); }}
                            className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-all shadow-lg hover:shadow-blue-500/20"
                            title="Analizar Liga Completa"
                        >
                            <SparklesIcon className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">BATCH</span>
                        </button>
                    )}
                    <button onClick={() => setIsExpanded(!isExpanded)} className="p-2 text-slate-400 hover:text-white transition-colors">
                        {isExpanded ? <ChevronUpIcon className="w-5 h-5" /> : <ChevronDownIcon className="w-5 h-5" />}
                    </button>
                </div>
            </div>
            {isExpanded && (
                <div className="bg-slate-900/50 p-4 grid grid-cols-1 xl:grid-cols-2 gap-4 border-t border-white/5">
                    {league.games.map((game) => (
                        <AnalysisGameCard
                            key={game.fixture.id}
                            game={game}
                            onAnalyze={() => onAnalyzeGame(game)}
                            onViewReport={() => onViewReport(game.fixture.id)}
                            jobStatus={gameJobStatus[game.fixture.id]}
                            hasReport={!!reportsAvailable[game.fixture.id]}
                            userRole={userRole}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};