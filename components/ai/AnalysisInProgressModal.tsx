
import React from 'react';
import { createPortal } from 'react-dom';
import { AnalysisJob } from '../../types';
import { BrainIcon, ChartBarIcon, SignalIcon, ExclamationTriangleIcon } from '../icons/Icons';

interface AnalysisInProgressModalProps {
    job: AnalysisJob | null;
    isOpen: boolean;
}

const statusLabels: Record<string, string> = {
    'queued': 'En cola',
    'ingesting': 'Recolectando datos',
    'data_ready': 'Datos listos',
    'analyzing': 'IA Generando pronóstico',
    'done': 'Completado',
    'insufficient_data': 'Datos insuficientes',
    'failed': 'Falló'
};

export const AnalysisInProgressModal: React.FC<AnalysisInProgressModalProps> = ({ job, isOpen }) => {
    if (!isOpen || !job) return null;

    const progress = job.progress_jsonb || { step: 'Iniciando...', completeness_score: 0, fetched_items: 0, total_items: 0 };
    const score = job.completeness_score || progress.completeness_score || 0;

    // Cálculo de color de riesgo basado en Completeness Score
    let riskColor = 'text-dx-loss';
    let riskLabel = 'CRÍTICO';
    let barColor = 'bg-dx-loss';

    if (score >= 80) {
        riskColor = 'text-green-accent';
        riskLabel = 'BAJO';
        barColor = 'bg-green-accent';
    } else if (score >= 60) {
        riskColor = 'text-dx-gold';
        riskLabel = 'MEDIO';
        barColor = 'bg-dx-gold';
    }

    return (
        <div className="fixed inset-0 bg-black/95 z-[100] flex items-center justify-center p-4 md:p-6 animate-fade-in backdrop-blur-md">
            <div className="bg-dx-surface rounded-2xl shadow-2xl w-full max-w-2xl border border-dx-border overflow-hidden">

                {/* Header */}
                <div className="p-6 text-center border-b border-dx-border bg-dx-bg/50">
                    <div className="relative inline-block">
                        <BrainIcon className={`w-16 h-16 mx-auto ${job.status === 'failed' ? 'text-dx-loss' : 'text-green-accent animate-pulse'}`} />
                        {job.status !== 'failed' && job.status !== 'done' && (
                            <div className="absolute -bottom-2 -right-2 bg-dx-surface-2 rounded-full p-1 border border-dx-border">
                                <div className="w-6 h-6 border-2 border-green-accent border-t-transparent rounded-full animate-spin"></div>
                            </div>
                        )}
                    </div>
                    <h2 className="text-2xl font-bold text-white mt-4">Motor de Análisis</h2>
                    <p className="text-dx-text-soft font-mono text-xs mt-1 uppercase tracking-widest">Job ID: {job.id.slice(0, 8)}</p>

                    <div className="mt-4 inline-flex items-center px-4 py-1.5 rounded-full bg-dx-surface-2 border border-dx-border">
                        <span className={`w-2.5 h-2.5 rounded-full mr-2 ${job.status === 'analyzing' ? 'bg-dx-green animate-ping' : 'bg-dx-surface-2'}`}></span>
                        <span className="text-xs font-bold text-white uppercase tracking-wider">{statusLabels[job.status] || job.status}</span>
                    </div>
                </div>

                <div className="p-8 space-y-8">

                    {/* Data Governance Section */}
                    <div>
                        <div className="flex justify-between items-end mb-2">
                            <span className="text-sm font-semibold text-dx-text-soft flex items-center">
                                <ChartBarIcon className="w-4 h-4 mr-2" /> Gobernanza de Datos
                            </span>
                            <div className="text-right">
                                <span className={`text-2xl font-black ${riskColor}`}>{score}%</span>
                                <span className="text-xs text-dx-text-mute block">Completitud</span>
                            </div>
                        </div>
                        <div className="w-full bg-dx-surface-2 rounded-full h-3 overflow-hidden">
                            <div
                                className={`h-full transition-all duration-700 ease-out ${barColor}`}
                                style={{ width: `${score}%` }}
                            ></div>
                        </div>
                        <div className="flex justify-between mt-2 items-center">
                            <span className="text-xs text-dx-text-mute">Threshold mínimo: 70%</span>
                            <span className={`text-xs font-bold px-2 py-0.5 rounded bg-dx-surface-2 ${riskColor}`}>RIESGO {riskLabel}</span>
                        </div>
                        {job.status === 'insufficient_data' && (
                            <div className="mt-3 p-3 bg-dx-surface/20 border border-dx-loss/50 rounded text-dx-loss text-xs flex items-start">
                                <ExclamationTriangleIcon className="w-4 h-4 mr-2 flex-shrink-0" />
                                <p>No se alcanzó el umbral de datos. El sistema abortó el análisis para proteger la integridad del pronóstico.</p>
                            </div>
                        )}
                        {job.status === 'failed' && (
                            <div className="mt-3 p-3 bg-dx-surface/20 border border-dx-loss/50 rounded text-dx-loss text-xs flex items-start">
                                <ExclamationTriangleIcon className="w-4 h-4 mr-2 flex-shrink-0" />
                                <div>
                                    <p className="font-bold">El análisis falló.</p>
                                    {job.error_message ? (
                                        <p className="mt-1 font-mono text-dx-loss/80 break-all">{job.error_message}</p>
                                    ) : (
                                        <p className="mt-1">Error desconocido. Revisa los logs del servidor.</p>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Backend Activity Log */}
                    <div className="bg-black/30 p-4 rounded-lg border border-dx-border font-mono text-sm">
                        <div className="flex items-center text-dx-text-soft mb-2 border-b border-dx-border pb-2">
                            <SignalIcon className="w-4 h-4 mr-2" />
                            <span className="text-xs uppercase font-semibold">Live Logs</span>
                        </div>
                        <div className="space-y-1">
                            <p className="text-green-accent/80">
                                {'>'} {progress.step || 'Inicializando...'}
                            </p>
                            {progress.total_items > 0 && (
                                <p className="text-dx-text-mute text-xs pl-4">
                                    Fetch: {progress.fetched_items} / {progress.total_items} items
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Credit Usage */}
                    <div className="flex justify-between items-center text-xs text-dx-text-mute border-t border-dx-border pt-4">
                        <span>Estimación de Costo: {job.estimated_calls || 0} llamadas</span>
                        <span>Uso Real: <span className="text-white font-mono font-bold">{job.actual_calls}</span></span>
                    </div>
                </div>
            </div>
        </div>
    );
};
