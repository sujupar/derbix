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
        <div className="dxj-fx" onClick={handleCardClick}>
            {/* Enfrentamiento: logo + nombre  VS  nombre + logo */}
            <div className="fx-teams">
                <div className="fx-side home">
                    {game.teams.home.logo
                        ? <img className="fx-lg" src={game.teams.home.logo} alt="" />
                        : <span className="fx-cr">{crest(game.teams.home.name)}</span>}
                    <span className="fx-nm">{game.teams.home.name}</span>
                </div>

                <div className={`fx-mid ${scoreAvailable ? 'sc' : ''} ${isLive ? 'live' : ''}`.trim()}>
                    {scoreAvailable ? `${game.goals.home}-${game.goals.away}` : 'VS'}
                </div>

                <div className="fx-side away">
                    <span className="fx-nm">{game.teams.away.name}</span>
                    {game.teams.away.logo
                        ? <img className="fx-lg" src={game.teams.away.logo} alt="" />
                        : <span className="fx-cr">{crest(game.teams.away.name)}</span>}
                </div>
            </div>

            {/* Hora / estado + acceso al informe */}
            <div className="fx-meta">
                {isLive ? (
                    <span className="live">
                        {game.fixture.status.elapsed ? `${game.fixture.status.elapsed}'` : (game.fixture.status.short === 'HT' ? 'DT' : 'EN VIVO')}
                    </span>
                ) : isFinished ? (
                    <span className="h">Finalizado</span>
                ) : (
                    <span className="h">{kickoff}</span>
                )}

                {hasReport && <span className="dot">·</span>}
                {hasReport && (isReportLocked
                    ? <span className="lock"><LockClosedIcon className="w-3.5 h-3.5" /> Informe premium</span>
                    : <span className="rep">Ver informe ›</span>)}

                {!hasReport && isProcessing && (
                    <>
                        <span className="dot">·</span>
                        <span>Analizando…</span>
                    </>
                )}
            </div>

            {/* Admin: analizar (solo si aún no hay informe) */}
            {isAdmin && !hasReport && !isProcessing && (
                <button className="fx-an" onClick={handleAnalyzeClick} title="Analizar">
                    <SparklesIcon className="w-4 h-4" />
                </button>
            )}
        </div>
    );
};

export default FlashscoreMatchRow;
