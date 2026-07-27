import React from 'react';
import { Game, AnalysisJob } from '../../types';
import { CheckCircleIcon, SparklesIcon, LockClosedIcon } from '../icons/Icons';
import { isAgencyRole } from '../../utils/roles';

interface FlashscoreMatchRowProps {
    game: Game;
    hasReport: boolean;
    isReportLocked?: boolean;
    jobStatus?: AnalysisJob['status'];
    userRole?: string;
    onOpenDetail: (game: Game) => void;
    onAnalyze: (game: Game) => void;
    onViewReport: (gameId: number) => void;
}

// Iniciales del equipo cuando no hay logo (mismo criterio que Oportunidades)
const crest = (name?: string) => (name || '?').replace(/[^A-Za-z0-9 ]/g, '').slice(0, 3).toUpperCase();

const FlashscoreMatchRow: React.FC<FlashscoreMatchRowProps> = ({
    game, hasReport, isReportLocked, jobStatus, userRole, onOpenDetail, onAnalyze, onViewReport
}) => {
    const isAdmin = isAgencyRole(userRole);
    const scoreAvailable = game.goals.home !== null && game.goals.away !== null;
    const LIVE_STATUSES = ['LIVE', '1H', 'HT', '2H', 'ET', 'BT', 'PEN_LIVE', 'BREAK', 'INT'];
    const isLive = LIVE_STATUSES.includes(game.fixture.status.short);
    const isFinished = ['FT', 'AET', 'PEN'].includes(game.fixture.status.short);
    const isProcessing = jobStatus && ['queued', 'ingesting', 'data_ready', 'analyzing'].includes(jobStatus);

    const kickoff = new Date(game.fixture.timestamp * 1000).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

    // Clic en la tarjeta del partido:
    //  - Con informe disponible → abre el INFORME directamente (el gating por plan lo
    //    resuelve LiveFeed en handleViewReport / verifyReportAccess).
    //  - Sin informe → abre el detalle del partido (donde el admin puede analizar).
    const handleCardClick = () => {
        if (hasReport) onViewReport(game.fixture.id);
        else onOpenDetail(game);
    };

    const handleAnalyzeClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        onAnalyze(game);
    };

    return (
        <div className="dxj-mcard" onClick={handleCardClick}>
            {/* Hora / estado + marcador */}
            <span className="min">
                {isLive ? (
                    <span className="live">
                        {game.fixture.status.elapsed ? `${game.fixture.status.elapsed}'` : (game.fixture.status.short === 'HT' ? 'DT' : 'EN VIVO')}
                    </span>
                ) : isFinished ? (
                    <span className="fin">FIN</span>
                ) : (
                    <span className="t dx-num">{kickoff}</span>
                )}
                {scoreAvailable && <span className="sc">{game.goals.home}-{game.goals.away}</span>}
            </span>

            {/* Escudos (superpuestos, igual que Oportunidades) */}
            <span className="dxj-crests">
                <b>{game.teams.home.logo ? <img src={game.teams.home.logo} alt="" /> : crest(game.teams.home.name)}</b>
                <b>{game.teams.away.logo ? <img src={game.teams.away.logo} alt="" /> : crest(game.teams.away.name)}</b>
            </span>

            {/* Equipos + subtítulo (estado del informe) */}
            <span className="info">
                <span className="tt">{game.teams.home.name} — {game.teams.away.name}</span>
                <span className="sub">
                    {hasReport
                        ? (isReportLocked ? <span className="lock">Informe premium</span> : <span className="rep">Ver informe</span>)
                        : (isProcessing ? 'Analizando…' : 'Sin informe todavía')}
                </span>
            </span>

            {/* Indicadores a la derecha */}
            <span className="meta">
                {isProcessing && (
                    <span className="w-4 h-4 border-2 border-dx-green border-t-transparent rounded-full animate-spin" />
                )}
                {hasReport && (
                    isReportLocked
                        ? <LockClosedIcon className="w-4 h-4 text-dx-gold/70" />
                        : <CheckCircleIcon className="w-4 h-4 text-dx-green" />
                )}
                {isAdmin && !hasReport && !isProcessing && (
                    <button onClick={handleAnalyzeClick} className="an" title="Analizar">
                        <SparklesIcon className="w-3.5 h-3.5" />
                    </button>
                )}
                {hasReport && <span className="go">›</span>}
            </span>
        </div>
    );
};

export default FlashscoreMatchRow;
