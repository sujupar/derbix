import React from 'react';
import { Game, AnalysisJob } from '../../types';
import { SparklesIcon, LockClosedIcon } from '../icons/Icons';
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

// Iniciales del equipo cuando no hay logo
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
    //  - Con informe → abre el INFORME directamente (el gating por plan lo resuelve
    //    LiveFeed en handleViewReport / verifyReportAccess).
    //  - Sin informe → abre el detalle (donde el admin puede analizar).
    const handleCardClick = () => {
        if (hasReport) onViewReport(game.fixture.id);
        else onOpenDetail(game);
    };

    const handleReportClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        onViewReport(game.fixture.id);
    };

    const handleAnalyzeClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        onAnalyze(game);
    };

    const teamRow = (team: { name: string; logo?: string }, score: number | null) => (
        <div className="mx-tr">
            {team.logo
                ? <img className="mx-lg" src={team.logo} alt="" />
                : <span className="mx-cr">{crest(team.name)}</span>}
            <span className="mx-nm">{team.name}</span>
            {scoreAvailable && <span className="mx-sc">{score}</span>}
        </div>
    );

    return (
        <div className="dxj-mx" onClick={handleCardClick}>
            {/* Hora / estado */}
            <div className="mx-time">
                {isLive ? (
                    <span className="live">
                        {game.fixture.status.elapsed ? `${game.fixture.status.elapsed}'` : (game.fixture.status.short === 'HT' ? 'DT' : 'VIVO')}
                    </span>
                ) : isFinished ? (
                    <span className="fin">FIN</span>
                ) : (
                    <>
                        <span className="t">{kickoff}</span>
                        <span className="d">Hora</span>
                    </>
                )}
            </div>

            {/* Equipos apilados: logo + nombre (+ marcador si aplica) */}
            <div className="mx-teams">
                {teamRow(game.teams.home, game.goals.home)}
                {teamRow(game.teams.away, game.goals.away)}
            </div>

            {/* Acción a la derecha */}
            <div className="mx-action">
                {hasReport ? (
                    isReportLocked ? (
                        <span className="mx-lock"><LockClosedIcon className="w-3.5 h-3.5" /> Premium</span>
                    ) : (
                        <button className="mx-btn" onClick={handleReportClick}>Ver informe</button>
                    )
                ) : isProcessing ? (
                    <span className="mx-soft">Analizando…</span>
                ) : isAdmin ? (
                    <button className="mx-an" onClick={handleAnalyzeClick} title="Analizar">
                        <SparklesIcon className="w-4 h-4" />
                    </button>
                ) : (
                    <span className="mx-soft">Próximamente</span>
                )}
            </div>
        </div>
    );
};

export default FlashscoreMatchRow;
