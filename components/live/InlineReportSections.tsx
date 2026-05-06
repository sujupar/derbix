import React from 'react';
import { DashboardAnalysisJSON, TablaComparativaData, AnalisisSeccion, DetallePrediccion, GraficoSugerido } from '../../types';
import { TrophyIcon, LightBulbIcon, ExclamationTriangleIcon, SparklesIcon, ChartBarIcon } from '../icons/Icons';
import { OPPORTUNITIES_THRESHOLD_PERCENT } from '../../constants/opportunities';

// --- HEADER ---
export const InlineReportHeader: React.FC<{ data: DashboardAnalysisJSON['header_partido'] }> = ({ data }) => {
    if (!data) return null;
    return (
        <div className="bg-gradient-to-r from-slate-800 to-slate-900 border border-white/10 p-4 rounded-xl">
            <h3 className="text-lg font-bold text-white mb-0.5">{data.titulo}</h3>
            <p className="text-brand text-xs font-medium mb-2">{data.subtitulo}</p>
            <div className="flex flex-wrap gap-1.5">
                {data.bullets_clave?.map((b, i) => (
                    <span key={i} className="px-2 py-0.5 bg-slate-700/50 rounded-full text-[11px] sm:text-[10px] text-slate-300 border border-slate-600">
                        {b}
                    </span>
                ))}
            </div>
        </div>
    );
};

// --- VERDICT (with low-confidence override) ---
export const InlineVerdict: React.FC<{ data: NonNullable<DashboardAnalysisJSON['veredicto_analista']> }> = ({ data }) => {
    const probability = data.probabilidad || 50;
    const isLowConfidence = probability < 83;

    // Override: if prob < 83%, force OBSERVAR visual style instead of APOSTAR green
    const effectiveIsBet = data.decision === 'APOSTAR' && !isLowConfidence;
    const isAvoid = data.decision === 'EVITAR';

    const borderColor = effectiveIsBet ? 'border-emerald-500' : isAvoid ? 'border-red-500' : 'border-blue-400';
    const bgColor = effectiveIsBet ? 'bg-emerald-900/30' : isAvoid ? 'bg-red-900/20' : 'bg-blue-900/20';
    const accentColor = effectiveIsBet ? 'text-emerald-400' : isAvoid ? 'text-red-400' : 'text-blue-400';

    return (
        <div className={`${bgColor} border ${borderColor} rounded-xl p-4`}>
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    <span className={`text-xl font-black uppercase ${accentColor}`}>
                        {data.titulo_accion || data.decision}
                    </span>
                    {data.nivel_confianza && (
                        <span className={`text-[10px] sm:text-[9px] px-2 py-0.5 rounded border font-bold uppercase ${
                            effectiveIsBet ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300' : 'border-slate-600 bg-slate-800 text-slate-400'
                        }`}>
                            {data.nivel_confianza}
                        </span>
                    )}
                </div>
                <div className={`text-2xl font-black ${accentColor}`}>{probability}%</div>
            </div>

            {/* Low-confidence disclaimer */}
            {data.decision === 'APOSTAR' && isLowConfidence && (
                <div className="bg-amber-900/20 border border-amber-500/30 rounded-lg px-3 py-2 mb-2 flex items-center gap-2">
                    <ExclamationTriangleIcon className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span className="text-amber-200/80 text-[11px]">
                        Este pronóstico no cumple nuestro umbral de confianza del 83%. No representa una oportunidad validada.
                    </span>
                </div>
            )}

            {effectiveIsBet && data.seleccion_clave && (
                <div className="bg-emerald-500/10 px-4 py-2.5 rounded-lg border border-emerald-500/30 mb-2">
                    <span className="text-[10px] sm:text-[9px] text-emerald-500/70 uppercase font-bold tracking-widest block mb-0.5">Apuesta Recomendada</span>
                    <span className="text-lg font-black text-white">{data.seleccion_clave}</span>
                </div>
            )}

            <p className="text-sm text-slate-300 italic">"{data.razon_principal}"</p>

            {data.riesgo_principal && (
                <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-300 bg-amber-900/20 px-3 py-1.5 rounded">
                    <ExclamationTriangleIcon className="w-3.5 h-3.5" />
                    <span>{data.riesgo_principal}</span>
                </div>
            )}
        </div>
    );
};

// --- EXECUTIVE SUMMARY ---
export const InlineExecutiveSummary: React.FC<{ data: DashboardAnalysisJSON['resumen_ejecutivo'] }> = ({ data }) => {
    if (!data) return null;
    return (
        <div className="bg-slate-800/50 p-4 rounded-xl border border-white/5">
            <div className="flex items-center gap-2 mb-2">
                <LightBulbIcon className="w-4 h-4 text-yellow-400" />
                <h4 className="text-sm font-bold text-white">Resumen Ejecutivo</h4>
            </div>
            <p className="text-sm text-white font-medium italic mb-2">"{data.frase_principal}"</p>
            <ul className="space-y-1">
                {data.puntos_clave?.map((p, i) => (
                    <li key={i} className="flex items-start text-xs text-slate-300">
                        <span className="text-brand mr-1.5 mt-0.5 shrink-0">●</span>
                        {p}
                    </li>
                ))}
            </ul>
        </div>
    );
};

// --- TABLE ---
export const InlineTable: React.FC<{ data: TablaComparativaData }> = ({ data }) => (
    <div className="bg-slate-800/50 rounded-lg overflow-hidden border border-white/5">
        <div className="bg-slate-700/30 px-3 py-2 border-b border-white/5">
            <h5 className="text-xs font-bold text-white">{data.titulo}</h5>
        </div>
        <div className="overflow-x-auto">
            <table className="w-full text-xs">
                <thead className="bg-slate-700/20 text-slate-500 uppercase text-[11px] sm:text-[10px]">
                    <tr>
                        {data.columnas.map((col, i) => (
                            <th key={i} className="px-3 py-1.5 font-medium whitespace-nowrap text-left">{col}</th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/30">
                    {(data.filas || []).map((fila, fi) => (
                        <tr key={fi} className="hover:bg-white/5">
                            {(Array.isArray(fila) ? fila : []).map((celda, ci) => (
                                <td key={ci} className={`px-3 py-1.5 ${ci === 0 ? 'font-medium text-white' : 'text-slate-400'}`}>
                                    {celda}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    </div>
);

// --- ANALYSIS BLOCK ---
export const InlineAnalysisBlock: React.FC<{ section: AnalisisSeccion }> = ({ section }) => {
    if (!section) return null;
    return (
        <div>
            <h5 className="text-xs font-bold text-brand uppercase tracking-wider mb-1.5">{section.titulo}</h5>
            {section.bullets && (
                <ul className="space-y-1">
                    {section.bullets.map((b, i) => (
                        <li key={i} className="text-xs text-slate-300 pl-3 border-l-2 border-slate-600">
                            {b}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

// --- PREDICTION CARD (compact) ---
export const InlinePredictionCard: React.FC<{ pred: DetallePrediccion }> = ({ pred }) => {
    const prob = pred.probabilidad_estimado_porcentaje;
    const isHigh = prob >= OPPORTUNITIES_THRESHOLD_PERCENT;
    const borderColor = isHigh ? 'border-brand/30' : 'border-white/5';
    const justif = pred.justificacion_detallada;
    const edge = (pred as any).edge;

    return (
        <div className={`bg-slate-800/50 rounded-lg p-3 border ${borderColor}`}>
            <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-[11px] sm:text-[10px] text-slate-500 uppercase tracking-wider">{pred.mercado}</span>
                        {isHigh && (
                            <span className="text-[10px] sm:text-[9px] bg-brand/20 text-brand px-1.5 py-0.5 rounded font-bold">TOP</span>
                        )}
                        {edge && edge > 0 && (
                            <span className="text-[10px] sm:text-[9px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded font-bold">
                                +{edge}%
                            </span>
                        )}
                    </div>
                    <h4 className="text-white font-bold text-sm">{pred.seleccion}</h4>
                    {justif?.conclusion && (
                        <p className="text-slate-400 text-xs mt-0.5 line-clamp-2">{justif.conclusion}</p>
                    )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    {pred.odds && (
                        <div className="bg-blue-500/10 border border-blue-500/30 px-2 py-1 rounded-lg">
                            <span className="text-blue-300 font-black text-sm">@{pred.odds.toFixed(2)}</span>
                        </div>
                    )}
                    <div className={`w-11 h-11 rounded-lg flex flex-col items-center justify-center ${
                        isHigh ? 'bg-brand/10 border border-brand/30' : 'bg-slate-700/50'
                    }`}>
                        <span className={`text-base font-black ${isHigh ? 'text-brand' : 'text-white'}`}>{prob}%</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- WARNINGS ---
export const InlineWarnings: React.FC<{ data: NonNullable<DashboardAnalysisJSON['advertencias']> }> = ({ data }) => (
    <div className="bg-yellow-900/20 border border-yellow-700/50 p-3 rounded-lg flex items-start gap-2">
        <ExclamationTriangleIcon className="w-4 h-4 text-yellow-500 mt-0.5 shrink-0" />
        <div>
            <h5 className="font-bold text-yellow-500 text-xs mb-1">{data.titulo}</h5>
            <ul className="list-disc pl-3 text-yellow-200/80 text-[11px] space-y-0.5">
                {data.bullets.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
        </div>
    </div>
);

// --- SCENARIOS ---
export const InlineScenarios: React.FC<{ data: any }> = ({ data }) => {
    const scenarios = data?.escenarios || [];
    if (scenarios.length === 0) return null;

    return (
        <div className="bg-blue-900/15 border border-blue-500/20 rounded-xl p-4">
            <h4 className="text-xs font-bold text-blue-300 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <LightBulbIcon className="w-4 h-4" />
                {data.titulo || 'Escenarios de Partido'}
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {scenarios.map((esc: any, i: number) => (
                    <div key={i} className="bg-slate-800/60 p-3 rounded-lg border-l-2 border-blue-500">
                        <div className="flex justify-between items-start mb-1">
                            <h5 className="font-bold text-white text-xs">{esc.nombre}</h5>
                            <span className="text-[11px] sm:text-[10px] bg-blue-900/50 text-blue-200 px-1.5 py-0.5 rounded font-mono">{esc.probabilidad_aproximada}</span>
                        </div>
                        <p className="text-slate-400 text-[11px]">{esc.descripcion}</p>
                        {esc.implicacion_apuestas && (
                            <div className="bg-blue-500/10 px-2 py-1 rounded text-[11px] sm:text-[10px] text-blue-200 mt-1.5">
                                <strong className="text-blue-400">Apuesta:</strong> {esc.implicacion_apuestas}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

// --- POST-MATCH SECTION ---
const InlinePostMatch: React.FC<{ analysis: any }> = ({ analysis }) => {
    if (!analysis) return null;
    const isStructured = typeof analysis !== 'string';

    return (
        <div className="bg-gradient-to-r from-purple-900/20 to-blue-900/20 p-4 rounded-xl border border-purple-500/30">
            <h4 className="text-xs font-bold text-purple-300 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <TrophyIcon className="w-4 h-4" />
                Análisis Post-Partido
            </h4>
            {isStructured ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {analysis.tactical_analysis && (
                        <div className="bg-slate-800/50 p-3 rounded-lg border border-white/5">
                            <h5 className="text-[11px] sm:text-[10px] font-bold text-green-400 uppercase mb-1">Táctico</h5>
                            <p className="text-slate-300 text-xs">{analysis.tactical_analysis}</p>
                        </div>
                    )}
                    {analysis.statistical_breakdown && (
                        <div className="bg-slate-800/50 p-3 rounded-lg border border-white/5">
                            <h5 className="text-[11px] sm:text-[10px] font-bold text-blue-400 uppercase mb-1">Estadístico</h5>
                            <p className="text-slate-300 text-xs">{analysis.statistical_breakdown}</p>
                        </div>
                    )}
                    {analysis.key_moments && (
                        <div className="bg-slate-800/50 p-3 rounded-lg border border-white/5">
                            <h5 className="text-[11px] sm:text-[10px] font-bold text-purple-400 uppercase mb-1">Momentos Clave</h5>
                            <p className="text-slate-300 text-xs">{analysis.key_moments}</p>
                        </div>
                    )}
                    {analysis.learning_feedback && (
                        <div className="bg-slate-800/50 p-3 rounded-lg border border-white/5">
                            <h5 className="text-[11px] sm:text-[10px] font-bold text-yellow-400 uppercase mb-1">Feedback</h5>
                            <p className="text-slate-300 text-xs">{analysis.learning_feedback}</p>
                        </div>
                    )}
                    {analysis.performance_review && (
                        <div className="col-span-full bg-slate-800/50 p-3 rounded-lg border border-white/5">
                            <p className="text-slate-300 text-xs italic">"{analysis.performance_review}"</p>
                        </div>
                    )}
                </div>
            ) : (
                <p className="text-slate-300 text-xs whitespace-pre-wrap">{analysis}</p>
            )}
        </div>
    );
};

// --- CSS CHART (no recharts) ---
const InlineCSSChart: React.FC<{ data: GraficoSugerido }> = ({ data }) => {
    if (!data.series || data.series.length === 0) return null;

    const allValues = data.series.flatMap(s => Object.values(s.valores));
    const maxVal = Math.max(...allValues, 1);
    const keys = Object.keys(data.series[0].valores);
    const colors = ['bg-brand', 'bg-blue-500', 'bg-purple-500', 'bg-amber-500'];

    return (
        <div className="bg-slate-800/50 p-3 rounded-lg border border-white/5">
            <h5 className="text-[11px] font-bold text-white mb-0.5">{data.titulo}</h5>
            {data.descripcion && <p className="text-[11px] sm:text-[10px] text-slate-500 mb-2">{data.descripcion}</p>}
            <div className="space-y-2">
                {keys.map((key) => (
                    <div key={key}>
                        <div className="flex items-center justify-between mb-0.5">
                            <span className="text-[11px] sm:text-[10px] text-slate-400 truncate max-w-[120px]">{key}</span>
                            <div className="flex gap-2">
                                {data.series.map((serie, si) => (
                                    <span key={si} className="text-[11px] sm:text-[10px] text-slate-500">{serie.valores[key]}</span>
                                ))}
                            </div>
                        </div>
                        <div className="flex gap-1">
                            {data.series.map((serie, si) => (
                                <div key={si} className="flex-1 bg-slate-700/50 rounded-full h-2 overflow-hidden">
                                    <div
                                        className={`h-full rounded-full ${colors[si % colors.length]} transition-all`}
                                        style={{ width: `${(serie.valores[key] / maxVal) * 100}%` }}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
            {data.series.length > 1 && (
                <div className="flex gap-3 mt-2">
                    {data.series.map((serie, si) => (
                        <div key={si} className="flex items-center gap-1">
                            <div className={`w-2 h-2 rounded-full ${colors[si % colors.length]}`} />
                            <span className="text-[10px] sm:text-[9px] text-slate-500">{serie.nombre}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

// --- SCORES DUALES V8 ---
const InlineScoresDuales: React.FC<{ data: any }> = ({ data }) => {
    if (!data) return null;
    return (
        <div className="bg-slate-800/50 p-4 rounded-xl border border-white/5">
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <ChartBarIcon className="w-4 h-4 text-blue-400" />
                Scores Duales (50/50)
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="bg-black/30 p-3 rounded-lg text-center border border-blue-500/20">
                    <span className="text-xl font-black text-blue-400">{data.score_estadistico}</span>
                    <span className="block text-[10px] sm:text-[9px] text-slate-500 uppercase mt-0.5">Stats</span>
                </div>
                <div className="bg-black/30 p-3 rounded-lg text-center border border-purple-500/20">
                    <span className="text-xl font-black text-purple-400">{data.score_inteligencia_partido}</span>
                    <span className="block text-[10px] sm:text-[9px] text-slate-500 uppercase mt-0.5">Context</span>
                </div>
                <div className="bg-black/30 p-3 rounded-lg text-center border border-emerald-500/20">
                    <span className="text-xl font-black text-emerald-400">{data.confianza_final_calculada}%</span>
                    <span className="block text-[10px] sm:text-[9px] text-slate-500 uppercase mt-0.5">Confianza</span>
                </div>
            </div>
            {data.justificacion_balance && (
                <p className="text-slate-500 text-[11px] mt-2 italic border-l-2 border-slate-700 pl-2">
                    {data.justificacion_balance}
                </p>
            )}
        </div>
    );
};

// --- PATRONES DETECTADOS V8 ---
const InlinePatrones: React.FC<{ data: any }> = ({ data }) => {
    if (!data) return null;
    return (
        <div className="bg-amber-900/10 p-4 rounded-xl border border-amber-500/20">
            <h4 className="text-xs font-bold text-amber-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <SparklesIcon className="w-4 h-4" />
                Patrones Detectados
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {data.goles_por_tiempo && (
                    <div className="bg-black/20 p-3 rounded-lg border border-white/5">
                        <h5 className="text-[11px] sm:text-[10px] font-bold text-amber-400 uppercase mb-2">Goles/Tiempo</h5>
                        <div className="space-y-1 text-[11px]">
                            <div className="flex justify-between text-slate-300">
                                <span>Local 1T</span>
                                <span className="font-bold text-white">{data.goles_por_tiempo.home_1er_tiempo_pct}%</span>
                            </div>
                            <div className="flex justify-between text-slate-300">
                                <span>Local 2T</span>
                                <span className="font-bold text-white">{data.goles_por_tiempo.home_2do_tiempo_pct}%</span>
                            </div>
                            <div className="flex justify-between text-slate-300">
                                <span>Visita 1T</span>
                                <span className="font-bold text-white">{data.goles_por_tiempo.away_1er_tiempo_pct}%</span>
                            </div>
                            <div className="flex justify-between text-slate-300">
                                <span>Visita 2T</span>
                                <span className="font-bold text-white">{data.goles_por_tiempo.away_2do_tiempo_pct}%</span>
                            </div>
                        </div>
                        {data.goles_por_tiempo.insight && (
                            <p className="text-amber-300/70 text-[11px] sm:text-[10px] mt-1.5 italic">{data.goles_por_tiempo.insight}</p>
                        )}
                    </div>
                )}
                {data.formacion_rendimiento && (
                    <div className="bg-black/20 p-3 rounded-lg border border-white/5">
                        <h5 className="text-[11px] sm:text-[10px] font-bold text-blue-400 uppercase mb-2">Formaciones</h5>
                        <div className="space-y-1.5 text-[11px]">
                            <div>
                                <span className="text-slate-400 text-[11px] sm:text-[10px]">Local:</span>
                                <span className="text-white font-bold ml-1">{data.formacion_rendimiento.home_formacion_usual}</span>
                                <span className="text-emerald-400 text-[11px] sm:text-[10px] ml-1">({data.formacion_rendimiento.home_win_pct_con_formacion}%)</span>
                            </div>
                            <div>
                                <span className="text-slate-400 text-[11px] sm:text-[10px]">Visita:</span>
                                <span className="text-white font-bold ml-1">{data.formacion_rendimiento.away_formacion_usual}</span>
                                <span className="text-emerald-400 text-[11px] sm:text-[10px] ml-1">({data.formacion_rendimiento.away_win_pct_con_formacion}%)</span>
                            </div>
                        </div>
                        {data.formacion_rendimiento.insight && (
                            <p className="text-blue-300/70 text-[11px] sm:text-[10px] mt-1.5 italic">{data.formacion_rendimiento.insight}</p>
                        )}
                    </div>
                )}
                {data.disciplina && (
                    <div className="bg-black/20 p-3 rounded-lg border border-white/5">
                        <h5 className="text-[11px] sm:text-[10px] font-bold text-red-400 uppercase mb-2">Disciplina</h5>
                        <div className="space-y-1 text-[11px]">
                            <div className="flex justify-between text-slate-300">
                                <span>Local Tarj.</span>
                                <span className="font-bold text-white">{data.disciplina.home_avg_tarjetas}</span>
                            </div>
                            <div className="flex justify-between text-slate-300">
                                <span>Visita Tarj.</span>
                                <span className="font-bold text-white">{data.disciplina.away_avg_tarjetas}</span>
                            </div>
                        </div>
                        {data.disciplina.insight && (
                            <p className="text-red-300/70 text-[11px] sm:text-[10px] mt-1.5 italic">{data.disciplina.insight}</p>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

// --- ANÁLISIS 60+ MERCADOS ---
const InlineMercados60: React.FC<{ data: any }> = ({ data }) => {
    if (!data) return null;
    const topOps = (data.top_oportunidades || []).slice(0, 5);
    if (topOps.length === 0) return null;

    return (
        <div className="bg-purple-900/10 p-4 rounded-xl border border-purple-500/20">
            <h4 className="text-xs font-bold text-purple-300 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <ChartBarIcon className="w-4 h-4" />
                Top Oportunidades por Value
                {data.mercados_con_valor && (
                    <span className="text-[10px] sm:text-[9px] bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded font-bold ml-1">
                        {data.mercados_con_valor} detectadas
                    </span>
                )}
            </h4>
            <div className="space-y-2">
                {topOps.map((opp: any, idx: number) => (
                    <div key={idx} className={`flex items-center justify-between p-2.5 rounded-lg border-l-2 ${
                        opp.confianza === 'ALTA' ? 'border-emerald-500 bg-emerald-900/10' :
                        opp.confianza === 'MEDIA' ? 'border-amber-500 bg-amber-900/10' :
                        'border-slate-500 bg-slate-800/30'
                    }`}>
                        <div className="flex items-center gap-2 min-w-0">
                            <span className="text-sm font-black text-white">#{idx + 1}</span>
                            <div className="min-w-0">
                                <span className="font-bold text-white text-xs block truncate">{opp.mercado}</span>
                                <span className="text-[11px] sm:text-[10px] text-slate-500">{opp.categoria}</span>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <span className="text-sm font-bold text-emerald-400">{opp.probabilidad_calculada}%</span>
                            <span className={`text-[11px] sm:text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                opp.value_score > 10 ? 'bg-emerald-500/20 text-emerald-400' :
                                opp.value_score > 5 ? 'bg-amber-500/20 text-amber-400' :
                                'bg-slate-600/20 text-slate-400'
                            }`}>
                                +{opp.value_score}%
                            </span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

// --- FULL INLINE REPORT ---
export const InlineReport: React.FC<{ data: DashboardAnalysisJSON; analysisRun?: any }> = ({ data, analysisRun }) => {
    return (
        <div className="space-y-4 animate-fade-in">
            {/* Header */}
            {data.header_partido && <InlineReportHeader data={data.header_partido} />}

            {/* Post-Match (if exists) */}
            {analysisRun?.post_match_analysis && (
                <InlinePostMatch analysis={analysisRun.post_match_analysis} />
            )}

            {/* Verdict */}
            {data.veredicto_analista && <InlineVerdict data={data.veredicto_analista} />}

            {/* Executive Summary */}
            {data.resumen_ejecutivo && <InlineExecutiveSummary data={data.resumen_ejecutivo} />}

            {/* Scores Duales V8 */}
            {(data as any).scores_duales && <InlineScoresDuales data={(data as any).scores_duales} />}

            {/* Tables */}
            {data.tablas_comparativas && Object.keys(data.tablas_comparativas).length > 0 && (
                <div className="space-y-3">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                        <ChartBarIcon className="w-4 h-4 text-brand" />
                        Datos Clave
                    </h4>
                    {Object.values(data.tablas_comparativas).map((tabla, i) => (
                        <InlineTable key={i} data={tabla} />
                    ))}
                </div>
            )}

            {/* Charts (CSS pure, no recharts) */}
            {data.graficos_sugeridos && data.graficos_sugeridos.length > 0 && (
                <div className="space-y-3">
                    {data.graficos_sugeridos.map((grafico, i) => (
                        <InlineCSSChart key={i} data={grafico} />
                    ))}
                </div>
            )}

            {/* Analysis */}
            {data.analisis_detallado && (
                <div className="bg-slate-800/30 p-4 rounded-xl border border-white/5 space-y-4">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Análisis Profundo</h4>

                    {/* Central reasoning */}
                    {(data.analisis_detallado as any).razonamiento_central && (
                        <div className="bg-slate-800/80 p-3 rounded-lg border border-blue-500/20">
                            <h5 className="text-xs font-bold text-blue-300 mb-1 flex items-center gap-1">
                                <SparklesIcon className="w-3.5 h-3.5" />
                                Tesis de Inversión
                            </h5>
                            <p className="text-slate-300 text-xs leading-relaxed border-l-2 border-blue-500 pl-3">
                                {(data.analisis_detallado as any).razonamiento_central}
                            </p>
                        </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <InlineAnalysisBlock section={data.analisis_detallado.matchup_tactico || data.analisis_detallado.estilo_y_tactica} />
                        <InlineAnalysisBlock section={data.analisis_detallado.factor_psicologico as any} />
                        <InlineAnalysisBlock section={data.analisis_detallado.impacto_arbitro as any} />
                        <InlineAnalysisBlock section={data.analisis_detallado.factores_situacionales} />
                    </div>

                    {/* Scenarios */}
                    {(data.analisis_detallado.analisis_escenarios || data.analisis_detallado.escenarios_de_partido) && (
                        <InlineScenarios data={data.analisis_detallado.analisis_escenarios || data.analisis_detallado.escenarios_de_partido} />
                    )}
                </div>
            )}

            {/* Patrones V8 */}
            {(data as any).patrones_detectados && <InlinePatrones data={(data as any).patrones_detectados} />}

            {/* Contexto Externo */}
            {(data as any).contexto_externo_resumen && (
                <div className="bg-cyan-900/10 p-4 rounded-xl border border-cyan-500/20">
                    <h4 className="text-xs font-bold text-cyan-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                        </svg>
                        Contexto Externo
                    </h4>
                    <p className="text-slate-300 text-xs leading-relaxed">{(data as any).contexto_externo_resumen}</p>
                </div>
            )}

            {/* Predictions */}
            {data.predicciones_finales?.detalle && data.predicciones_finales.detalle.length > 0 && (
                <div className="space-y-2">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                        <TrophyIcon className="w-4 h-4 text-brand" />
                        Predicciones del Modelo
                    </h4>
                    {data.predicciones_finales.detalle.map((pred, i) => (
                        <InlinePredictionCard key={pred.id || i} pred={pred} />
                    ))}
                </div>
            )}

            {/* 60+ Markets */}
            {(data as any).analisis_mercados_calculados && (
                <InlineMercados60 data={(data as any).analisis_mercados_calculados} />
            )}

            {/* Warnings */}
            {data.advertencias?.bullets && data.advertencias.bullets.length > 0 && (
                <InlineWarnings data={data.advertencias} />
            )}
        </div>
    );
};
