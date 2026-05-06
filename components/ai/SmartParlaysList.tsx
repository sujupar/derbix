// components/ai/SmartParlaysList.tsx
// Componente de lista de Smart Parlays para la sección de Oportunidades
// Reemplaza la visualización de picks individuales

import React, { useState, useEffect } from 'react';
import { getSmartParlays, generateSmartParlays, SmartParlay, translateMarket, getConfidenceColor, getConfidenceLabel } from '../../services/smartParlayService';
import { TrophyIcon, SparklesIcon, DocumentArrowDownIcon } from '../icons/Icons';

interface SmartParlaysListProps {
    date: string;
}

const SmartParlaysList: React.FC<SmartParlaysListProps> = ({ date }) => {
    const [parlays, setParlays] = useState<SmartParlay[]>([]);
    const [loading, setLoading] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        loadParlays();
    }, [date]);

    const loadParlays = async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await getSmartParlays(date);
            setParlays(data);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const handleGenerate = async () => {
        setGenerating(true);
        setError(null);
        try {
            const result = await generateSmartParlays(date);
            if (result.success) {
                await loadParlays();
            } else {
                setError(result.error || result.message || 'Error al generar');
            }
        } catch (e: any) {
            setError(e.message);
        } finally {
            setGenerating(false);
        }
    };

    const handleDownloadPDF = (parlay: SmartParlay, index: number) => {
        import('../../services/pdf/pdfGenerator').then(({ generateParlayPDF }) => {
            generateParlayPDF(parlay, {
                fileName: `Smart_Parlay_${index + 1}_${date}.pdf`,
                titleOverride: `Smart Parlay #${index + 1}`
            }).catch((err: unknown) => {
                console.error('[PDF] Parlay download failed:', err);
                alert('No se pudo generar el PDF: ' + (err instanceof Error ? err.message : String(err)));
            });
        }).catch((err) => {
            console.error('[PDF] Failed to load pdfGenerator module:', err);
            alert('No se pudo cargar el módulo de PDF.');
        });
    };

    const formatProbability = (prob: number) => `${Math.round(prob * 100)}%`;

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center h-64">
                <div className="w-12 h-12 border-4 border-green-accent border-t-transparent rounded-full animate-spin"></div>
                <p className="mt-4 text-gray-400 animate-pulse">Cargando Smart Parlays...</p>
            </div>
        );
    }

    if (parlays.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-64 bg-gray-800/30 rounded-lg border-2 border-dashed border-gray-700">
                <SparklesIcon className="w-12 h-12 text-emerald-500 mb-4" />
                <h4 className="text-xl font-semibold text-white">¿Listo para Smart Parlays?</h4>
                <p className="text-sm text-gray-400 mt-2 max-w-md text-center">
                    Los Smart Parlays combinan 2-3 pronósticos de alta probabilidad de diferentes partidos para maximizar tus oportunidades.
                </p>
                <button
                    onClick={handleGenerate}
                    disabled={generating}
                    className={`mt-4 px-6 py-3 rounded-lg font-bold transition-all flex items-center gap-2 ${generating
                        ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                        : 'bg-gradient-to-r from-emerald-500 to-green-600 text-white hover:from-emerald-600 hover:to-green-700 shadow-lg hover:shadow-emerald-500/25'
                        }`}
                >
                    {generating ? (
                        <>
                            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                            Generando...
                        </>
                    ) : (
                        <>
                            <span className="text-xl">✨</span>
                            Generar Smart Parlays
                        </>
                    )}
                </button>
                {error && <p className="text-red-400 text-sm mt-3">❌ {error}</p>}
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Header con botón de regenerar */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <TrophyIcon className="w-6 h-6 text-emerald-500" />
                    <span className="text-white font-bold">{parlays.length} Smart Parlays Disponibles</span>
                </div>
                <button
                    onClick={handleGenerate}
                    disabled={generating}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${generating
                        ? 'bg-gray-700 text-gray-400'
                        : 'bg-gray-800 text-gray-300 hover:bg-gray-700 border border-gray-600'
                        }`}
                >
                    {generating ? 'Regenerando...' : '🔄 Regenerar'}
                </button>
            </div>

            {/* Lista de Parlays */}
            {parlays.map((parlay, index) => (
                <div
                    key={parlay.id || index}
                    className="bg-gray-800/80 border border-gray-700/50 rounded-xl overflow-hidden hover:border-emerald-500/30 transition-all"
                >
                    {/* Header del Parlay */}
                    <div className={`bg-gradient-to-r ${getConfidenceColor(parlay.confidence_tier)} p-4`}>
                        <div className="flex items-center justify-between">
                            <div>
                                <span className="text-white/80 text-xs font-medium uppercase tracking-wider">
                                    {getConfidenceLabel(parlay.confidence_tier)}
                                </span>
                                <h3 className="text-white font-bold text-lg mt-1">
                                    Smart Parlay #{index + 1}
                                </h3>
                            </div>
                            <div className="flex items-center gap-4">
                                <div className="text-right">
                                    <div className="text-white/80 text-xs uppercase tracking-wider">Cuota Total</div>
                                    <div className="text-emerald-400 font-bold text-3xl">
                                        x{parlay.implied_odds?.toFixed(2) || '---'}
                                    </div>
                                </div>
                                <div className="text-right border-l border-white/10 pl-4">
                                    <div className="text-white/80 text-xs uppercase tracking-wider">Probabilidad</div>
                                    <div className="text-white font-bold text-3xl">
                                        {formatProbability(parlay.combined_probability)}
                                    </div>
                                </div>
                                <button
                                    onClick={() => handleDownloadPDF(parlay, index)}
                                    className="p-2 bg-white/10 hover:bg-white/20 rounded-lg text-white transition-colors border border-white/10 shadow-lg"
                                    title="Descargar Reporte PDF"
                                >
                                    <DocumentArrowDownIcon className="w-5 h-5" />
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Picks del Parlay */}
                    <div className="p-4 space-y-3">
                        {parlay.picks.map((pick, pickIndex) => (
                            <div
                                key={pickIndex}
                                className="flex items-center justify-between p-3 bg-gray-900/60 rounded-lg border border-gray-700/30"
                            >
                                <div className="flex-1">
                                    <div className="text-gray-400 text-xs mb-1">{pick.league}</div>
                                    <div className="text-white font-medium text-sm">
                                        {pick.home_team} <span className="text-gray-500">vs</span> {pick.away_team}
                                    </div>
                                    <div className="text-emerald-400 text-sm mt-1 font-medium">
                                        ➤ {translateMarket(pick.market)}
                                    </div>
                                </div>
                                <div className="flex flex-col items-center justify-center w-14 h-14 rounded-full border-3 border-emerald-500 bg-gray-800">
                                    <span className="text-lg font-bold text-white">{formatProbability(pick.p_model)}</span>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Footer */}
                    <div className="px-4 pb-4">
                        <div className="flex items-center justify-center p-3 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                            <span className="text-emerald-400 text-sm font-medium">
                                💡 {parlay.pick_count} selecciones de diferentes partidos
                            </span>
                        </div>
                    </div>
                </div>
            ))}

            {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-center">
                    <p className="text-red-400 text-sm">❌ {error}</p>
                </div>
            )}
        </div>
    );
};

export default SmartParlaysList;
