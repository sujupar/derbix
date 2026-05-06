import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/supabaseService';
import { SparklesIcon, TrophyIcon, ExclamationTriangleIcon } from '../icons/Icons';
import { OPPORTUNITIES_THRESHOLD_PERCENT } from '../../constants/opportunities';

interface ValuePick {
    id: string;
    fixture_id: number;
    market: string;
    selection: string;
    p_model: number;
    odds: number | null;
    confidence: string;
    reasoning: string;
    result: string | null;
}

interface MatchPredictionsTabProps {
    fixtureId: number;
    hasReport: boolean;
    onGoToReport: () => void;
    onAnalyze: () => void;
    isAdmin: boolean;
}

const PickCard: React.FC<{ pick: ValuePick; isLowProb?: boolean }> = ({ pick, isLowProb }) => {
    const prob = Math.round(pick.p_model * 100);
    const isHighProb = prob >= OPPORTUNITIES_THRESHOLD_PERCENT;

    return (
        <div className={`bg-slate-800/50 rounded-lg p-4 border ${
            isHighProb ? 'border-brand/30' : 'border-white/5'
        } ${isLowProb ? 'opacity-60' : ''}`}>
            <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] text-slate-500 uppercase tracking-wider">{pick.market}</span>
                        {isHighProb && (
                            <span className="text-[9px] bg-brand/20 text-brand px-1.5 py-0.5 rounded font-bold">TOP</span>
                        )}
                        {!isHighProb && isLowProb && (
                            <span className="text-[9px] bg-slate-600/30 text-slate-400 px-1.5 py-0.5 rounded font-bold">COMPLEMENTARIO</span>
                        )}
                        {pick.result && (
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                                pick.result === 'WON' ? 'bg-emerald-500/20 text-emerald-400' :
                                pick.result === 'LOST' ? 'bg-red-500/20 text-red-400' :
                                'bg-slate-600/20 text-slate-400'
                            }`}>
                                {pick.result}
                            </span>
                        )}
                    </div>
                    <h4 className="text-white font-bold text-sm">{pick.selection}</h4>
                    {pick.reasoning && (
                        <p className="text-slate-400 text-xs mt-1 line-clamp-2">{pick.reasoning}</p>
                    )}
                </div>

                <div className="flex items-center gap-3 shrink-0">
                    {pick.odds && (
                        <div className="bg-blue-500/10 border border-blue-500/30 px-2.5 py-1 rounded-lg text-center">
                            <span className="text-blue-300 font-black text-sm">@{pick.odds.toFixed(2)}</span>
                        </div>
                    )}
                    <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-lg flex flex-col items-center justify-center ${
                        isHighProb ? 'bg-brand/10 border border-brand/30' : 'bg-slate-700/50'
                    }`}>
                        <span className={`text-base sm:text-lg font-black ${isHighProb ? 'text-brand' : 'text-white'}`}>{prob}%</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

const MatchPredictionsTab: React.FC<MatchPredictionsTabProps> = ({
    fixtureId, hasReport, onGoToReport, onAnalyze, isAdmin
}) => {
    const [picks, setPicks] = useState<ValuePick[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchPicks = async () => {
            setLoading(true);

            // Source 1: value_picks_v2 (individual picks)
            const { data: vpData, error: vpError } = await supabase
                .from('value_picks_v2')
                .select('id, fixture_id, market, selection, p_model, odds, confidence, decision, result')
                .eq('fixture_id', fixtureId)
                .order('p_model', { ascending: false });

            if (!vpError && vpData && vpData.length > 0) {
                setPicks(vpData as ValuePick[]);
                setLoading(false);
                return;
            }

            // Source 2: analisis table → report_pre_jsonb has embedded predictions
            try {
                const { data: analisisData } = await supabase
                    .from('analisis')
                    .select('resultado_analisis')
                    .eq('partido_id', fixtureId)
                    .maybeSingle();

                if (analisisData?.resultado_analisis) {
                    const result = analisisData.resultado_analisis as any;
                    const dashData = result.dashboardData || result;
                    const detalle = dashData?.predicciones_finales?.detalle;

                    if (detalle && Array.isArray(detalle) && detalle.length > 0) {
                        const mapped: ValuePick[] = detalle.map((p: any) => ({
                            id: p.id || crypto.randomUUID(),
                            fixture_id: fixtureId,
                            market: p.mercado || p.market || 'General',
                            selection: p.seleccion || p.selection || '',
                            p_model: (p.probabilidad_estimado_porcentaje || p.p_model || 50) / (p.probabilidad_estimado_porcentaje ? 100 : 1),
                            odds: p.odds || null,
                            confidence: (p.probabilidad_estimado_porcentaje || 0) >= OPPORTUNITIES_THRESHOLD_PERCENT ? 'HIGH' : 'MEDIUM',
                            reasoning: p.justificacion_detallada?.conclusion || p.reasoning || '',
                            result: null
                        }));
                        mapped.sort((a, b) => b.p_model - a.p_model);
                        setPicks(mapped);
                        setLoading(false);
                        return;
                    }
                }
            } catch (err) {
                console.error('[MatchPredictionsTab] Error fetching analisis fallback:', err);
            }

            setPicks([]);
            setLoading(false);
        };

        fetchPicks();
    }, [fixtureId]);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="w-6 h-6 border-2 border-brand border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    if (picks.length === 0) {
        return (
            <div className="text-center py-12">
                <SparklesIcon className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                <p className="text-slate-400 text-sm mb-1">Este partido no tiene pronósticos aún.</p>
                {isAdmin && (
                    <button
                        onClick={onAnalyze}
                        className="mt-4 bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg text-sm font-bold transition-all"
                    >
                        Analizar Partido
                    </button>
                )}
                {hasReport && (
                    <button
                        onClick={onGoToReport}
                        className="mt-4 ml-2 bg-brand/10 hover:bg-brand/20 text-brand border border-brand/50 px-6 py-2 rounded-lg text-sm font-bold transition-all"
                    >
                        Ver Informe
                    </button>
                )}
            </div>
        );
    }

    const highProbPicks = picks.filter(p => Math.round(p.p_model * 100) >= OPPORTUNITIES_THRESHOLD_PERCENT);
    const lowProbPicks = picks.filter(p => Math.round(p.p_model * 100) < OPPORTUNITIES_THRESHOLD_PERCENT);

    return (
        <div className="space-y-4">
            {/* Disclaimer: NO hay picks validados (todos < 83%) */}
            {highProbPicks.length === 0 && lowProbPicks.length > 0 && (
                <div className="bg-amber-900/20 border border-amber-500/30 rounded-xl p-4">
                    <div className="flex items-start gap-3">
                        <ExclamationTriangleIcon className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
                        <div>
                            <h4 className="text-amber-300 font-bold text-sm mb-1">Sin pronósticos validados</h4>
                            <p className="text-amber-200/70 text-xs leading-relaxed">
                                Este partido no tiene pronósticos que cumplan nuestro umbral de confianza (83%).
                                Los siguientes son análisis complementarios y no representan una oportunidad validada por nuestro sistema.
                                Apuestas bajo su responsabilidad.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* High probability picks */}
            {highProbPicks.length > 0 && (
                <div className="space-y-3">
                    <h4 className="text-xs font-bold text-brand uppercase tracking-wider flex items-center gap-1.5">
                        <TrophyIcon className="w-4 h-4" />
                        Pronósticos Recomendados
                    </h4>
                    {highProbPicks.map(pick => <PickCard key={pick.id} pick={pick} />)}
                </div>
            )}

            {/* Separador visual entre TOP y COMPLEMENTARIOS */}
            {highProbPicks.length > 0 && lowProbPicks.length > 0 && (
                <div className="py-1"><div className="border-t border-amber-500/20" /></div>
            )}

            {/* Low probability disclaimer + picks */}
            {lowProbPicks.length > 0 && (
                <div className="space-y-3">
                    {highProbPicks.length > 0 && (
                        <div className="bg-amber-900/20 border border-amber-500/30 rounded-lg p-3 flex items-start gap-2">
                            <ExclamationTriangleIcon className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                            <p className="text-amber-200/80 text-xs">
                                Los siguientes pronósticos tienen una probabilidad inferior al 83%.
                                No son recomendados por nuestro modelo. Apuestas bajo su responsabilidad.
                            </p>
                        </div>
                    )}
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                        {highProbPicks.length > 0 ? 'Complementarios' : 'Análisis Complementarios'}
                    </h4>
                    {lowProbPicks.map(pick => <PickCard key={pick.id} pick={pick} isLowProb />)}
                </div>
            )}

            {hasReport && (
                <div className="pt-3 border-t border-white/5">
                    <button
                        onClick={onGoToReport}
                        className="w-full flex items-center justify-center gap-2 bg-brand/10 hover:bg-brand/20 text-brand border border-brand/50 px-4 py-3 rounded-lg text-sm font-bold transition-all"
                    >
                        <TrophyIcon className="w-4 h-4" />
                        Ver Informe Completo
                    </button>
                </div>
            )}
        </div>
    );
};

export default MatchPredictionsTab;
