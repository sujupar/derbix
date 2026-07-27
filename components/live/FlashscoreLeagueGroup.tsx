import React, { useState } from 'react';
import { League, Game, AnalysisJob } from '../../types';
import { ChevronDownIcon, ChevronUpIcon, SparklesIcon } from '../icons/Icons';
import { isAgencyRole } from '../../utils/roles';
import FlashscoreMatchRow from './FlashscoreMatchRow';

interface FlashscoreLeagueGroupProps {
    league: League;
    gameJobStatus: Record<number, AnalysisJob['status']>;
    reportsAvailable: Record<number, boolean>;
    accessibleReports?: Set<number>;
    userRole?: string;
    onOpenDetail: (game: Game) => void;
    onAnalyzeGame: (game: Game) => void;
    onAnalyzeLeague: () => void;
    onViewReport: (gameId: number) => void;
}

// Sigla de la liga cuando no hay logo (mismo criterio que Oportunidades)
const leagueCrest = (name?: string) => (name || '?').replace(/[^A-Za-z0-9 ]/g, '').slice(0, 2).toUpperCase();

const FlashscoreLeagueGroup: React.FC<FlashscoreLeagueGroupProps> = ({
    league, gameJobStatus, reportsAvailable, accessibleReports, userRole,
    onOpenDetail, onAnalyzeGame, onAnalyzeLeague, onViewReport
}) => {
    const [isExpanded, setIsExpanded] = useState(true);
    const isAdmin = isAgencyRole(userRole);

    return (
        <div className="dxj-mgroup">
            {/* Encabezado de liga — mismo lenguaje visual que Oportunidades (dxj-lghead) */}
            <div className="dxj-lghead">
                <button className="hbtn" onClick={() => setIsExpanded(!isExpanded)}>
                    <span className="fl">
                        {league.logo ? <img src={league.logo} alt="" /> : leagueCrest(league.name)}
                    </span>
                    <span className="nm">{league.name}</span>
                    {league.country && <span className="cy">{league.country}</span>}
                    <span className="ct dx-num">{league.games.length}</span>
                </button>
                <div className="hact">
                    {isAdmin && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onAnalyzeLeague(); }}
                            className="batch"
                            title="Analizar Liga Completa"
                        >
                            <SparklesIcon className="w-3 h-3" /> BATCH
                        </button>
                    )}
                    <button className="tog" onClick={() => setIsExpanded(!isExpanded)} title={isExpanded ? 'Contraer' : 'Expandir'}>
                        {isExpanded ? <ChevronUpIcon className="w-4 h-4" /> : <ChevronDownIcon className="w-4 h-4" />}
                    </button>
                </div>
            </div>

            {/* Tarjetas de partidos */}
            {isExpanded && (
                <div className="dxj-mlist">
                    {league.games.map((game) => {
                        const fid = game.fixture.id;
                        const hasReport = !!reportsAvailable[fid];
                        const isLocked = hasReport && accessibleReports ? !accessibleReports.has(fid) : false;
                        return (
                            <FlashscoreMatchRow
                                key={fid}
                                game={game}
                                hasReport={hasReport}
                                isReportLocked={isLocked}
                                jobStatus={gameJobStatus[fid]}
                                userRole={userRole}
                                onOpenDetail={onOpenDetail}
                                onAnalyze={onAnalyzeGame}
                                onViewReport={onViewReport}
                            />
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default FlashscoreLeagueGroup;
