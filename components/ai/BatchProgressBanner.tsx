import React, { useEffect } from 'react';
import { Game } from '../../types';

interface BatchProgressBannerProps {
    total: number;
    completed: number;
    currentGame: Game | null;
    leagueName: string;
    isActive: boolean;
    results: Record<number, 'done' | 'failed'>;
    onCancel: () => void;
    onDismiss: () => void;
}

const BatchProgressBanner: React.FC<BatchProgressBannerProps> = ({
    total, completed, currentGame, leagueName, isActive, results, onCancel, onDismiss
}) => {
    const successCount = Object.values(results).filter(r => r === 'done').length;
    const failCount = Object.values(results).filter(r => r === 'failed').length;
    const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;
    const currentNum = completed + 1;
    const isFinished = !isActive && completed > 0 && completed >= total;

    // Auto-dismiss after 4 seconds when batch finishes
    useEffect(() => {
        if (isFinished) {
            const timer = setTimeout(onDismiss, 4000);
            return () => clearTimeout(timer);
        }
    }, [isFinished, onDismiss]);

    // Don't show if never started or already dismissed
    if (!isActive && !isFinished) return null;

    return (
        <div className={`mb-4 rounded-xl border backdrop-blur-sm overflow-hidden ${isFinished ? 'border-dx-green/30 bg-dx-green/60' : 'border-dx-green/30 bg-dx-green/60'}`}>
            {/* Progress bar */}
            <div className="h-1 bg-dx-surface/50">
                <div
                    className={`h-full transition-all duration-500 ease-out ${isFinished ? 'bg-gradient-to-r from-dx-green to-dx-cyan' : 'bg-gradient-to-r from-dx-green to-brand'}`}
                    style={{ width: `${progressPct}%` }}
                />
            </div>

            <div className="px-4 py-3 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                    {/* Spinner or check */}
                    {isFinished ? (
                        <span className="text-dx-green text-lg flex-shrink-0">&#10003;</span>
                    ) : (
                        <div className="w-5 h-5 border-2 border-dx-green border-t-transparent rounded-full animate-spin flex-shrink-0" />
                    )}

                    <div className="min-w-0">
                        <div className="text-sm font-bold text-white truncate">
                            {isFinished ? (
                                `Batch completado: ${leagueName}`
                            ) : currentGame ? (
                                `Analizando ${currentNum} de ${total}: ${currentGame.teams.home.name} vs ${currentGame.teams.away.name}`
                            ) : (
                                `Preparando análisis ${currentNum} de ${total}...`
                            )}
                        </div>
                        <div className="flex items-center gap-3 text-xs mt-0.5">
                            <span className={isFinished ? 'text-dx-green' : 'text-dx-green'}>{leagueName}</span>
                            {successCount > 0 && <span className="text-dx-green">{successCount} completados</span>}
                            {failCount > 0 && <span className="text-dx-loss">{failCount} fallidos</span>}
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3 flex-shrink-0">
                    <span className={`text-sm font-bold ${isFinished ? 'text-dx-green' : 'text-dx-green'}`}>{progressPct}%</span>
                    {!isFinished && (
                        <button
                            onClick={onCancel}
                            className="px-3 py-1 text-xs font-medium text-dx-loss hover:text-white hover:bg-dx-loss/20 rounded-lg transition-colors border border-dx-loss/30"
                        >
                            Cancelar
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default BatchProgressBanner;
