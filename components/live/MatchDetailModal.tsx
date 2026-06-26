import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Game, GameDetails, VisualAnalysisResult } from '../../types';
import { fetchGameDetails } from '../../services/liveDataService';
import { getAnalysisResultByFixtureId } from '../../services/analysisService';
import { XMarkIcon, ArrowPathIcon, ChartBarIcon, ClockIcon, UsersGroupIcon, UsersIcon, ListBulletIcon, TrophyIcon, SparklesIcon, CheckCircleIcon, LockClosedIcon } from '../icons/Icons';
import { StatisticsTab } from './StatisticsTab';
import { EventsTab } from './EventsTab';
import { LineupsTab } from './LineupsTab';
import { H2HTab } from './H2HTab';
import { StandingsTab } from './StandingsTab';
import MatchSummaryTab from './MatchSummaryTab';
import MatchPredictionsTab from './MatchPredictionsTab';
import { InlineReport } from './InlineReportSections';
import { isAgencyRole } from '../../utils/roles';

type DetailTab = 'summary' | 'stats' | 'lineups' | 'h2h' | 'standings' | 'predictions' | 'report';

interface MatchDetailModalProps {
    game: Game;
    onClose: () => void;
    hasReport: boolean;
    isReportLocked?: boolean;
    onViewReport: () => void;
    onAnalyze: () => void;
    userRole?: string;
}

const FormDot: React.FC<{ result: 'W' | 'D' | 'L' }> = ({ result }) => (
    <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-black ${
        result === 'W' ? 'bg-dx-green text-white' :
        result === 'L' ? 'bg-dx-loss text-white' :
        'bg-dx-surface-2 text-white'
    }`}>
        {result}
    </span>
);

const getTeamForm = (matches: Game[] | null, teamId: number): ('W' | 'D' | 'L')[] => {
    if (!matches) return [];
    return matches.slice(0, 5).map(m => {
        const isHome = m.teams.home.id === teamId;
        const goalsFor = isHome ? m.goals.home : m.goals.away;
        const goalsAgainst = isHome ? m.goals.away : m.goals.home;
        if (goalsFor === null || goalsAgainst === null) return 'D';
        return goalsFor > goalsAgainst ? 'W' : goalsFor < goalsAgainst ? 'L' : 'D';
    });
};

const MatchDetailModal: React.FC<MatchDetailModalProps> = ({
    game, onClose, hasReport, isReportLocked, onViewReport, onAnalyze, userRole
}) => {
    const [details, setDetails] = useState<GameDetails | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefetching, setIsRefetching] = useState(false);
    const [activeTab, setActiveTab] = useState<DetailTab>('summary');
    const [error, setError] = useState('');
    const [reportData, setReportData] = useState<VisualAnalysisResult | null>(null);
    const [reportLoading, setReportLoading] = useState(false);
    const isAdmin = isAgencyRole(userRole);

    const scoreAvailable = game.goals.home !== null && game.goals.away !== null;
    const isLive = game.fixture.status.elapsed !== null && game.fixture.status.short !== 'FT' && game.fixture.status.short !== 'AET' && game.fixture.status.short !== 'PEN';
    const isFinished = game.fixture.status.short === 'FT' || game.fixture.status.short === 'AET' || game.fixture.status.short === 'PEN';

    const loadDetails = useCallback(async (refresh = false) => {
        if (refresh) setIsRefetching(true);
        else setIsLoading(true);
        setError('');

        try {
            const d = await fetchGameDetails(game);
            setDetails(d);
        } catch (err) {
            setError('No se pudieron cargar los detalles.');
            console.error(err);
        } finally {
            setIsLoading(false);
            setIsRefetching(false);
        }
    }, [game]);

    useEffect(() => {
        loadDetails(false);
    }, [loadDetails]);

    // Auto-refresh for live matches
    useEffect(() => {
        if (!isLive) return;
        const interval = setInterval(() => loadDetails(true), 30000);
        return () => clearInterval(interval);
    }, [isLive, loadDetails]);

    // Lazy-load report when tab is selected
    useEffect(() => {
        if (activeTab !== 'report' || !hasReport || reportData) return;

        const loadReport = async () => {
            setReportLoading(true);
            try {
                const result = await getAnalysisResultByFixtureId(game.fixture.id);
                setReportData(result);
            } catch (err) {
                console.error('[MatchDetailModal] Error loading report:', err);
            } finally {
                setReportLoading(false);
            }
        };
        loadReport();
    }, [activeTab, hasReport, game.fixture.id, reportData]);

    const tabs: { id: DetailTab; label: string; icon: React.ReactNode }[] = [
        { id: 'summary', label: 'Resumen', icon: <ClockIcon className="w-4 h-4" /> },
        { id: 'stats', label: 'Estadísticas', icon: <ChartBarIcon className="w-4 h-4" /> },
        { id: 'lineups', label: 'Alineaciones', icon: <UsersGroupIcon className="w-4 h-4" /> },
        { id: 'h2h', label: 'H2H', icon: <UsersIcon className="w-4 h-4" /> },
        { id: 'standings', label: 'Clasificación', icon: <ListBulletIcon className="w-4 h-4" /> },
        { id: 'predictions', label: 'Pronósticos', icon: <SparklesIcon className="w-4 h-4" /> },
        { id: 'report', label: 'Informe', icon: <TrophyIcon className="w-4 h-4" /> },
    ];

    const homeForm = details ? getTeamForm(details.lastMatches?.home, game.teams.home.id) : [];
    const awayForm = details ? getTeamForm(details.lastMatches?.away, game.teams.away.id) : [];

    const renderTabContent = () => {
        if (isLoading) {
            return (
                <div className="flex flex-col items-center justify-center py-16">
                    <div className="w-8 h-8 border-3 border-brand border-t-transparent rounded-full animate-spin" />
                    <p className="text-dx-text-soft text-sm mt-3">Cargando datos del partido...</p>
                </div>
            );
        }

        if (error) {
            return (
                <div className="text-center py-16">
                    <p className="text-dx-loss text-sm">{error}</p>
                    <button onClick={() => loadDetails(false)} className="mt-3 text-brand text-sm hover:underline">Reintentar</button>
                </div>
            );
        }

        if (!details) return null;

        switch (activeTab) {
            case 'summary':
                return <MatchSummaryTab details={details} />;
            case 'stats':
                return <StatisticsTab stats={details.statistics} />;
            case 'lineups':
                return <LineupsTab lineups={details.lineups} />;
            case 'h2h':
                return <H2HTab h2h={details.h2h} />;
            case 'standings':
                return (
                    <StandingsTab
                        standings={details.standings?.[0] || null}
                        homeTeamId={game.teams.home.id}
                        awayTeamId={game.teams.away.id}
                    />
                );
            case 'predictions':
                return (
                    <MatchPredictionsTab
                        fixtureId={game.fixture.id}
                        hasReport={hasReport}
                        onGoToReport={onViewReport}
                        onAnalyze={onAnalyze}
                        isAdmin={isAdmin}
                    />
                );
            case 'report':
                if (!hasReport) {
                    return (
                        <div className="text-center py-12">
                            <SparklesIcon className="w-16 h-16 text-dx-text-mute mx-auto mb-4" />
                            <p className="text-dx-text-soft text-sm mb-1">No hay informe disponible para este partido.</p>
                            {isAdmin && (
                                <button
                                    onClick={onAnalyze}
                                    className="mt-4 bg-dx-green hover:bg-dx-green text-white px-6 py-2.5 rounded-lg text-sm font-bold transition-all"
                                >
                                    Generar Análisis
                                </button>
                            )}
                        </div>
                    );
                }
                if (isReportLocked) {
                    return (
                        <div className="flex flex-col items-center justify-center py-16 px-6">
                            <LockClosedIcon className="w-14 h-14 text-dx-text-mute mb-4" />
                            <p className="text-white font-bold text-lg mb-1">Informe Bloqueado</p>
                            <p className="text-dx-text-soft text-sm text-center mb-6 max-w-xs">
                                Tu plan actual no incluye acceso a este informe. Actualiza para desbloquear todos los análisis.
                            </p>
                            <a
                                href="/pricing"
                                className="px-8 py-3 bg-dx-green hover:bg-dx-green text-white font-bold rounded-xl transition-colors shadow-lg shadow-dx-green-glow"
                            >
                                Ver Planes
                            </a>
                        </div>
                    );
                }
                if (reportLoading) {
                    return (
                        <div className="flex flex-col items-center justify-center py-16">
                            <div className="w-8 h-8 border-3 border-brand border-t-transparent rounded-full animate-spin" />
                            <p className="text-dx-text-soft text-sm mt-3">Cargando informe...</p>
                        </div>
                    );
                }
                if (!reportData?.dashboardData) {
                    return (
                        <div className="text-center py-12">
                            <CheckCircleIcon className="w-16 h-16 text-brand mx-auto mb-4" />
                            <p className="text-white font-bold text-lg mb-2">Informe de Análisis Disponible</p>
                            <p className="text-dx-text-soft text-sm mb-6">No se pudo cargar el contenido inline.</p>
                            <button
                                onClick={onViewReport}
                                className="bg-brand hover:bg-dx-green text-white px-8 py-3 rounded-xl text-sm font-bold transition-all shadow-lg shadow-brand/20"
                            >
                                Abrir Informe Completo
                            </button>
                        </div>
                    );
                }
                return <InlineReport data={reportData.dashboardData} analysisRun={reportData.analysisRun} />;
            default:
                return null;
        }
    };

    return createPortal(
        <div
            className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[90] flex items-center justify-center p-0 md:p-4 animate-fade-in"
            onClick={(e) => e.target === e.currentTarget && onClose()}
        >
            <div
                className="bg-dx-surface w-full h-full md:h-[90vh] md:max-w-3xl md:rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-dx-border"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="bg-gradient-to-b from-dx-surface-2 to-dx-bg border-b border-dx-border px-4 pt-4 pb-0">
                    {/* Top bar: league + close */}
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2 min-w-0">
                            {game.league.logo && (
                                <img src={game.league.logo} alt="" className="w-5 h-5 object-contain shrink-0" />
                            )}
                            <span className="text-dx-text-soft text-xs truncate">
                                {game.league.name}
                                {game.league.round && <span className="text-dx-text-mute"> - {game.league.round}</span>}
                            </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            {isAdmin && (
                                <button
                                    onClick={() => { onAnalyze(); onClose(); }}
                                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold text-dx-green hover:text-white bg-dx-green/10 hover:bg-dx-green/20 border border-dx-green/30 rounded-lg transition-all"
                                >
                                    <ArrowPathIcon className="w-3.5 h-3.5" />
                                    <span className="hidden sm:inline">Regenerar</span>
                                </button>
                            )}
                            <button
                                onClick={() => loadDetails(true)}
                                disabled={isRefetching}
                                className="p-1.5 text-dx-text-mute hover:text-white hover:bg-white/5 rounded-lg transition-colors disabled:opacity-50"
                                title="Refrescar datos"
                            >
                                <ArrowPathIcon className={`w-4 h-4 ${isRefetching ? 'animate-spin' : ''}`} />
                            </button>
                            <button
                                onClick={onClose}
                                className="p-1.5 text-dx-text-mute hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                            >
                                <XMarkIcon className="w-5 h-5" />
                            </button>
                        </div>
                    </div>

                    {/* Match info */}
                    <div className="flex items-center justify-center gap-3 sm:gap-6 mb-3">
                        {/* Home */}
                        <div className="flex flex-col items-center gap-1.5 flex-1 min-w-0">
                            <img src={game.teams.home.logo} alt="" className="w-10 h-10 sm:w-12 sm:h-12 object-contain" />
                            <span className="text-white font-bold text-sm text-center leading-tight truncate w-full">{game.teams.home.name}</span>
                            {homeForm.length > 0 && (
                                <div className="flex gap-0.5">
                                    {homeForm.map((r, i) => <FormDot key={i} result={r} />)}
                                </div>
                            )}
                        </div>

                        {/* Score */}
                        <div className="flex flex-col items-center shrink-0">
                            {isLive && (
                                <span className="text-dx-loss text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 mb-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-dx-loss animate-pulse" />
                                    {game.fixture.status.elapsed}'
                                </span>
                            )}
                            {isFinished && (
                                <span className="text-dx-text-mute text-[10px] font-bold uppercase tracking-wider mb-1">Finalizado</span>
                            )}
                            {!isLive && !isFinished && (
                                <span className="text-dx-text-soft text-xs font-mono mb-1">
                                    {new Date(game.fixture.timestamp * 1000).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                                </span>
                            )}

                            {scoreAvailable ? (
                                <span className={`text-3xl sm:text-4xl font-black tracking-widest ${isLive ? 'text-dx-loss' : 'text-white'}`}>
                                    {game.goals.home} - {game.goals.away}
                                </span>
                            ) : (
                                <span className="text-2xl sm:text-3xl font-black text-dx-text-mute">VS</span>
                            )}

                            {game.fixture.venue?.name && (
                                <span className="text-[10px] text-dx-text-mute mt-1">{game.fixture.venue.name}</span>
                            )}
                        </div>

                        {/* Away */}
                        <div className="flex flex-col items-center gap-1.5 flex-1 min-w-0">
                            <img src={game.teams.away.logo} alt="" className="w-10 h-10 sm:w-12 sm:h-12 object-contain" />
                            <span className="text-white font-bold text-sm text-center leading-tight truncate w-full">{game.teams.away.name}</span>
                            {awayForm.length > 0 && (
                                <div className="flex gap-0.5">
                                    {awayForm.map((r, i) => <FormDot key={i} result={r} />)}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Tabs */}
                    <div className="flex overflow-x-auto -mx-4 px-4 gap-0 scrollbar-hide border-b border-dx-border">
                        {tabs.map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex items-center justify-center gap-1.5 flex-1 sm:flex-none px-3 py-3 sm:py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                                    activeTab === tab.id
                                        ? 'border-brand text-brand'
                                        : 'border-transparent text-dx-text-mute hover:text-white'
                                }`}
                            >
                                {tab.icon}
                                <span className="hidden sm:inline">{tab.label}</span>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-4">
                    {isRefetching && (
                        <div className="flex items-center justify-center gap-2 py-1 mb-3 bg-brand/5 rounded-lg border border-brand/10">
                            <div className="w-3 h-3 border-2 border-brand border-t-transparent rounded-full animate-spin" />
                            <span className="text-brand text-[11px]">Actualizando...</span>
                        </div>
                    )}
                    {renderTabContent()}
                </div>
            </div>
        </div>,
        document.body
    );
};

export default MatchDetailModal;
