
import React from 'react';
import { createPortal } from 'react-dom';
import { VisualAnalysisResult, DashboardAnalysisJSON, TablaComparativaData, AnalisisSeccion, DetallePrediccion, GraficoSugerido, PredictionDB } from '../../types';
import { OPPORTUNITIES_THRESHOLD_PERCENT } from '../../constants/opportunities';
import { XMarkIcon, TrophyIcon, ChartBarIcon, ListBulletIcon, LightBulbIcon, ExclamationTriangleIcon, LinkIcon, EyeIcon, SparklesIcon, LockClosedIcon } from '../icons/Icons';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { supabase } from '../../services/supabaseService';
import { mapLeagueToSportKey, fastBatchOddsCheck, findPriceInEvent } from '../../services/oddsService';
import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { trackPDFDownload } from '../../services/analyticsService';
import { useSubscription } from '../../contexts/SubscriptionContext';
import { isAgencyRole } from '../../utils/roles';
import { filterPicksForPlan, PLAN_PREDICTIONS_PERCENTAGES, PlanTier, PLAN_DISPLAY_NAMES } from '../../utils/planAccessUtils';

// --- COMPONENTES AUXILIARES DEL DASHBOARD ---

const HeaderSection: React.FC<{ data: DashboardAnalysisJSON['header_partido'] }> = ({ data }) => {
    if (!data) return null;
    return (
        <div className="bg-gradient-to-r from-gray-800 to-gray-900 border-b border-green-accent p-6 rounded-t-xl">
            <h2 className="text-2xl md:text-3xl font-bold text-white mb-1">{data.titulo}</h2>
            <p className="text-green-accent font-medium mb-4">{data.subtitulo}</p>
            <div className="flex flex-wrap gap-2">
                {data.bullets_clave?.map((bullet, idx) => (
                    <span key={idx} className="px-3 py-1 bg-gray-700/50 rounded-full text-xs text-gray-300 border border-gray-600">
                        {bullet}
                    </span>
                ))}
            </div>
        </div>
    );
};


import { PostMatchAnalysis, MatchOutcome } from '../../types';
import { ArrowDownTrayIcon, ClipboardDocumentCheckIcon } from '../icons/Icons';

const PostMatchSection: React.FC<{ analysis: PostMatchAnalysis | string; outcome?: MatchOutcome; headerData: any; showPdfButton?: boolean }> = ({ analysis, outcome, headerData, showPdfButton = false }) => {
    if (!analysis) return null;

    const handleDownloadFinalPDF = () => {
        if (!analysis || typeof analysis === 'string') return;

        // Usar el servicio centralizado Premium
        import('../../services/pdf/pdfGenerator').then(({ generateMatchAnalysisPDF }) => {
            const pdfData = {
                report_pre_jsonb: {
                    // Simulamos la estructura que espera el generador basada en lo que tenemos visualmente
                    header_partido: headerData,
                    // @ts-ignore
                    resumen_ejecutivo: analysis.resumen_ejecutivo || { frase_principal: "Análisis Post-Partido" },
                    // @ts-ignore
                    analisis_mercados_calculados: analysis.analisis_mercados_calculados || {
                        // Si analysis es PostMatchAnalysis puro, quizás no tenga mercados calculados aquí si venía de DB
                        // Pero intentamos pasarlo si existe.
                    },
                    // Pasamos el análisis de texto estructurado también
                    analisis_tactico: (analysis as PostMatchAnalysis).tactical_analysis,
                    contexto_competitivo: {
                        situacion_local: headerData.titulo
                    }
                }
            };

            // En realidad, PostMatchSection suele recibir el objeto PostMatchAnalysis YA procesado.
            // Para el generador de PDF, lo ideal es pasarle TODO el dashboardData.
            // Pero aquí solo tenemos un fragmento.
            // HACK: Reconstruimos un objeto "fake" analysisRun suficiente para que el PDF renderice algo util.

            // Mejor opción: headerData viene de arriba, outcome viene de arriba.

            generateMatchAnalysisPDF({
                report_pre_jsonb: {
                    header_partido: headerData,
                    resumen_ejecutivo: { titular: headerData.titulo },
                    // @ts-ignore
                    analisis_tactico: analysis,
                    // @ts-ignore
                    contexto_competitivo: { situacion_local: headerData.titulo }
                }
            }, {
                fileName: `Derbix_PostMatch_${headerData.titulo.replace(/[^a-z0-9]/gi, '_')}.pdf`
            }).catch((err: unknown) => {
                console.error('[PDF] PostMatch download failed:', err);
                alert('No se pudo generar el PDF: ' + (err instanceof Error ? err.message : String(err)));
            });
        }).catch((err) => {
            console.error('[PDF] Failed to load pdfGenerator module:', err);
            alert('No se pudo cargar el módulo de PDF.');
        });
    };

    const isStructured = typeof analysis !== 'string';

    return (
        <div className="bg-gradient-to-br from-blue-900/50 to-slate-900 border border-blue-500/30 p-6 rounded-xl shadow-lg mb-6 animate-pulse-fade-in relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-10">
                <ClipboardDocumentCheckIcon className="w-32 h-32 text-blue-400" />
            </div>

            <div className="flex justify-between items-start relative z-10 mb-6">
                <div className="flex items-center">
                    <div className="bg-blue-500/20 p-3 rounded-lg mr-4">
                        <TrophyIcon className="w-8 h-8 text-blue-400" />
                    </div>
                    <div>
                        <h3 className="text-2xl font-bold text-white">Análisis Post-Partido</h3>
                        <p className="text-blue-300 text-sm">Evaluación final y feedback del sistema</p>
                    </div>
                </div>
                {showPdfButton && (
                    <button
                        onClick={handleDownloadFinalPDF}
                        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg font-bold transition-all shadow-lg hover:shadow-blue-500/20"
                    >
                        <ArrowDownTrayIcon className="w-5 h-5" />
                        Descargar Informe Final
                    </button>
                )}
            </div>

            {outcome && (
                <div className="flex items-center justify-center py-6 bg-black/30 rounded-lg mb-6 border border-white/5 relative z-10">
                    <div className="text-center">
                        <span className="block text-gray-400 text-sm uppercase tracking-widest mb-2">Resultado Final</span>
                        <div className="text-5xl font-black text-white tracking-tight flex items-center justify-center gap-4">
                            <span>{outcome.score?.home ?? '-'}</span>
                            <span className="text-gray-600">-</span>
                            <span>{outcome.score?.away ?? '-'}</span>
                        </div>
                        <div className="mt-2 inline-block px-3 py-1 bg-white/10 rounded-full text-sm font-medium text-blue-200">
                            {outcome.winner === 'Home' ? 'Ganador Local' : outcome.winner === 'Away' ? 'Ganador Visitante' : 'Empate'} {outcome.status}
                        </div>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative z-10">
                {!isStructured ? (
                    <div className="prose prose-invert prose-sm max-w-none col-span-2">
                        <p className="text-gray-200 leading-relaxed whitespace-pre-wrap">{analysis as string}</p>
                    </div>
                ) : (
                    <>
                        <div className="bg-gray-800/50 p-5 rounded-lg border border-gray-700/50">
                            <h4 className="text-green-400 font-bold mb-3 uppercase text-xs tracking-wider">Análisis Táctico</h4>
                            <p className="text-gray-300 text-sm leading-relaxed">{(analysis as PostMatchAnalysis).tactical_analysis}</p>
                        </div>
                        <div className="bg-gray-800/50 p-5 rounded-lg border border-gray-700/50">
                            <h4 className="text-blue-400 font-bold mb-3 uppercase text-xs tracking-wider">Desglose Estadístico</h4>
                            <p className="text-gray-300 text-sm leading-relaxed">{(analysis as PostMatchAnalysis).statistical_breakdown}</p>
                        </div>
                        <div className="bg-gray-800/50 p-5 rounded-lg border border-gray-700/50">
                            <h4 className="text-purple-400 font-bold mb-3 uppercase text-xs tracking-wider">Momentos Clave</h4>
                            <p className="text-gray-300 text-sm leading-relaxed">{(analysis as PostMatchAnalysis).key_moments}</p>
                        </div>
                        <div className="bg-gray-800/50 p-5 rounded-lg border border-gray-700/50">
                            <h4 className="text-yellow-400 font-bold mb-3 uppercase text-xs tracking-wider">Feedback del Sistema</h4>
                            <p className="text-gray-300 text-sm leading-relaxed">{(analysis as PostMatchAnalysis).learning_feedback}</p>
                        </div>
                        <div className="col-span-1 md:col-span-2 bg-gradient-to-r from-gray-800 to-gray-700 p-5 rounded-lg border border-gray-600">
                            <h4 className="text-white font-bold mb-2">Revisión de Rendimiento</h4>
                            <p className="text-gray-200 italic">"{(analysis as PostMatchAnalysis).performance_review}"</p>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

const ExecutiveSummary: React.FC<{ data: DashboardAnalysisJSON['resumen_ejecutivo'] }> = ({ data }) => {
    if (!data) return null;
    return (
        <div className="bg-gray-800 p-5 rounded-xl border border-gray-700 shadow-lg">
            <div className="flex items-center mb-3">
                <LightBulbIcon className="w-6 h-6 text-yellow-400 mr-2" />
                <h3 className="text-lg font-bold text-white">Resumen Ejecutivo</h3>
            </div>
            <p className="text-lg text-white font-medium mb-4 italic">"{data.frase_principal}"</p>
            <ul className="space-y-2">
                {data.puntos_clave?.map((point, idx) => (
                    <li key={idx} className="flex items-start text-gray-300 text-sm">
                        <span className="text-green-accent mr-2 mt-1">●</span>
                        {point}
                    </li>
                ))}
            </ul>
        </div>
    );
};

const DynamicTable: React.FC<{ data: TablaComparativaData }> = ({ data }) => (
    <div className="bg-gray-900/50 rounded-lg overflow-hidden border border-gray-700">
        <div className="bg-gray-800/80 p-3 border-b border-gray-700">
            <h4 className="font-semibold text-white text-sm">{data.titulo}</h4>
        </div>
        <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
                <thead className="bg-gray-700/50 text-gray-400 uppercase text-xs">
                    <tr>
                        {data.columnas.map((col, idx) => (
                            <th key={idx} className="px-4 py-2 font-medium whitespace-nowrap">{col}</th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                    {(data.filas || []).map((fila, fIdx) => (
                        <tr key={fIdx} className="hover:bg-gray-800/30 transition-colors">
                            {(Array.isArray(fila) ? fila : []).map((celda, cIdx) => (
                                <td key={cIdx} className={`px-4 py-3 text-gray-300 ${cIdx === 0 ? 'font-medium text-white' : ''}`}>
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

const AnalysisBlock: React.FC<{ section: AnalisisSeccion; icon?: React.ReactNode }> = ({ section, icon }) => {
    if (!section) return null;
    return (
        <div className="mb-6">
            <h4 className="text-md font-bold text-green-accent mb-3 flex items-center uppercase tracking-wider">
                {icon} {section.titulo}
            </h4>
            {section.bullets && (
                <ul className="space-y-2 mb-4">
                    {section.bullets.map((bullet, idx) => (
                        <li key={idx} className="text-gray-300 text-sm pl-4 border-l-2 border-gray-600 hover:border-green-accent transition-colors">
                            {bullet}
                        </li>
                    ))}
                </ul>
            )}

        </div>
    );
};

const VisualChart: React.FC<{ data: GraficoSugerido }> = ({ data }) => {
    // Transformar datos para Recharts
    const chartData = Object.keys(data.series[0].valores).map(key => {
        const item: any = { name: key };
        data.series.forEach(serie => {
            item[serie.nombre] = serie.valores[key];
        });
        return item;
    });

    const colors = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444'];

    return (
        <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
            <h4 className="text-sm font-bold text-white mb-1">{data.titulo}</h4>
            <p className="text-xs text-gray-400 mb-4">{data.descripcion}</p>
            <div className="h-64 w-full min-h-[256px]">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 30, left: 40, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" horizontal={true} vertical={false} />
                        <XAxis type="number" stroke="#9ca3af" fontSize={10} />
                        <YAxis dataKey="name" type="category" stroke="#9ca3af" fontSize={10} width={80} />
                        <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', color: '#fff' }} />
                        <Legend wrapperStyle={{ fontSize: '10px' }} />
                        {data.series.map((serie, idx) => (
                            <Bar key={idx} dataKey={serie.nombre} fill={colors[idx % colors.length]} radius={[0, 4, 4, 0]} barSize={20} />
                        ))}
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};

const OPPORTUNITY_THRESHOLD = OPPORTUNITIES_THRESHOLD_PERCENT;

const PredictionCard: React.FC<{ pred: DetallePrediccion }> = ({ pred }) => {
    const prob = pred.probabilidad_estimado_porcentaje;
    const isOpportunity = prob >= OPPORTUNITY_THRESHOLD;
    const color = prob >= 70 ? 'text-green-accent' : prob >= 55 ? 'text-yellow-400' : 'text-gray-300';
    const border = isOpportunity ? 'border-emerald-500' : prob >= 70 ? 'border-green-accent' : 'border-gray-600';

    const justif = pred.justificacion_detallada;
    const edge = (pred as any).edge;

    const baseStats = justif?.base_estadistica || ['Análisis cuantitativo aplicado'];
    const context = justif?.contexto_competitivo?.[0] || (edge ? `Ventaja de +${edge}% sobre las cuotas` : 'Factor táctico evaluado');
    const conclusion = justif?.conclusion || 'Recomendación basada en el modelo de análisis';

    return (
        <div className={`bg-gray-800 rounded-xl overflow-hidden border-l-4 ${border} shadow-lg mb-6 ${isOpportunity ? 'ring-1 ring-emerald-500/30 shadow-[0_0_20px_rgba(16,185,129,0.1)]' : ''}`}>
            {isOpportunity && (
                <div className="bg-gradient-to-r from-emerald-600/20 to-emerald-500/10 px-5 py-2 flex items-center gap-2 border-b border-emerald-500/20">
                    <span className="text-emerald-400 text-sm">⚡</span>
                    <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Oportunidad de Valor</span>
                </div>
            )}
            <div className="p-5 border-b border-gray-700 flex justify-between items-center bg-gray-700/20">
                <div>
                    <span className="text-xs uppercase font-bold text-gray-400 tracking-wider">{pred.mercado}</span>
                    <h3 className="text-xl font-bold text-white mt-1">{pred.seleccion}</h3>
                </div>
                <div className="flex flex-col items-center justify-center bg-gray-900 rounded-lg p-2 min-w-[80px]">
                    <span className={`text-2xl font-bold ${color}`}>{prob}%</span>
                    <span className="text-[10px] text-gray-500 uppercase">Prob.</span>
                    {pred.odds && (
                        <div className="mt-2 bg-gradient-to-r from-blue-600 to-blue-500 text-white px-3 py-1 rounded-md text-sm font-black shadow-[0_0_10px_rgba(59,130,246,0.5)] animate-pulse-slow border border-blue-400">
                            @{pred.odds.toFixed(2)}
                        </div>
                    )}
                    {edge && edge > 0 && (
                        <div className="mt-2 bg-gradient-to-r from-emerald-600 to-emerald-500 text-white px-3 py-1 rounded-md text-xs font-bold">
                            Ventaja: +{edge}%
                        </div>
                    )}
                </div>
            </div>
            <div className="p-5">
                <h4 className="text-sm font-bold text-white mb-3 flex items-center">
                    <ListBulletIcon className="w-4 h-4 mr-2 text-blue-400" /> Justificación del Analista
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm mb-4">
                    <div>
                        <strong className="text-gray-400 block mb-1">Base Estadística:</strong>
                        <ul className="list-disc pl-4 text-gray-300 space-y-1">
                            {(Array.isArray(baseStats) ? baseStats : [baseStats]).map((t, i) => <li key={i}>{t}</li>)}
                        </ul>
                    </div>
                    <div>
                        <strong className="text-gray-400 block mb-1">Factor Clave:</strong>
                        <p className="text-gray-300">{context}</p>
                    </div>
                </div>
                <div className="bg-blue-900/20 p-3 rounded text-sm text-blue-200 border border-blue-900/50">
                    <strong className="block mb-1 text-blue-400">Conclusión:</strong>
                    {conclusion}
                </div>
            </div>
        </div>
    );
};

// --- LOCKED SECTION COMPONENT (Plan-based content gating) ---
const LockedSection: React.FC<{
    title: string;
    planRequired: string;
    children?: React.ReactNode;
}> = ({ title, planRequired, children }) => (
    <div className="relative rounded-xl overflow-hidden">
        {children && (
            <div className="filter blur-sm pointer-events-none select-none" aria-hidden="true">
                {children}
            </div>
        )}
        <div className={`${children ? 'absolute inset-0' : ''} backdrop-blur-md bg-slate-900/70 z-10 flex flex-col items-center justify-center py-12 px-6 rounded-xl border border-white/10`}>
            <LockClosedIcon className="w-10 h-10 text-slate-400 mb-3" />
            <p className="text-white font-bold text-lg mb-1">{title}</p>
            <p className="text-slate-400 text-sm mb-4">Disponible desde el plan <span className="text-emerald-400 font-bold">{planRequired}</span></p>
            <a
                href="/pricing"
                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition-colors shadow-lg shadow-emerald-500/20"
            >
                Ver Planes
            </a>
        </div>
    </div>
);

// --- DUAL SCORES COMPONENT ---
const DualScoresSection: React.FC<{ scores: any }> = ({ scores }) => {
    const [showExplanation, setShowExplanation] = useState(false);
    return (
        <div className="bg-gradient-to-r from-slate-800 to-slate-900 p-6 rounded-xl border border-white/10 mb-2">
            <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
                <ChartBarIcon className="w-5 h-5 text-blue-400" />
                Transparencia del Modelo
            </h3>
            <p className="text-gray-400 text-sm mb-4">Cómo nuestro sistema evalúa este partido desde dos ángulos independientes.</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-black/30 p-4 rounded-lg text-center border border-blue-500/20">
                    <span className="text-2xl sm:text-3xl font-black text-blue-400">{scores.score_estadistico}</span>
                    <span className="block text-xs text-blue-300 font-bold uppercase mt-1">Score Estadístico</span>
                    <span className="block text-[10px] text-gray-500 mt-1 leading-tight">Datos puros: forma, xG, goles, corners</span>
                </div>
                <div className="bg-black/30 p-4 rounded-lg text-center border border-purple-500/20">
                    <span className="text-2xl sm:text-3xl font-black text-purple-400">{scores.score_inteligencia_partido}</span>
                    <span className="block text-xs text-purple-300 font-bold uppercase mt-1">Score de Contexto</span>
                    <span className="block text-[10px] text-gray-500 mt-1 leading-tight">Contexto: presión, psicología, noticias</span>
                </div>
                <div className="bg-black/30 p-5 rounded-lg text-center border-2 border-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.1)]">
                    <span className="text-3xl sm:text-4xl font-black text-emerald-400">{scores.confianza_final_calculada}%</span>
                    <span className="block text-xs text-emerald-300 font-bold uppercase mt-1">Confianza Final</span>
                    <span className="block text-[10px] text-gray-500 mt-1 leading-tight">Combinación ponderada 50/50</span>
                </div>
            </div>
            {scores.justificacion_balance && (
                <p className="text-gray-400 text-sm mt-3 italic border-l-2 border-emerald-500/50 pl-3">
                    {scores.justificacion_balance}
                </p>
            )}
            <button
                onClick={() => setShowExplanation(!showExplanation)}
                className="mt-3 text-xs text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1"
            >
                <svg className={`w-3 h-3 transition-transform ${showExplanation ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                ¿Cómo se calculan estos scores?
            </button>
            {showExplanation && (
                <div className="mt-2 bg-black/20 p-4 rounded-lg text-sm text-gray-400 leading-relaxed border border-white/5 animate-fade-in">
                    <p className="mb-2"><strong className="text-blue-400">Score Estadístico</strong> analiza datos cuantitativos: forma reciente de ambos equipos, goles esperados (xG), corners, posesión, rendimiento local/visitante y tendencias históricas.</p>
                    <p className="mb-2"><strong className="text-purple-400">Score de Contexto</strong> evalúa factores cualitativos: presión competitiva (necesidad de puntos), bajas y lesiones, factor cancha, historial directo y situación psicológica.</p>
                    <p><strong className="text-emerald-400">Confianza Final</strong> es una combinación ponderada 50/50 de ambos scores, representando la seguridad global del modelo en su análisis.</p>
                </div>
            )}
        </div>
    );
};

// --- VERDICT SUMMARY COMPONENT (REPLACES TRAFFIC LIGHT) ---

import { VeredictoAnalista } from '../../types';

// Helper for Probability Ring
const ProbabilityRing: React.FC<{ percentage: number; colorClass: string }> = ({ percentage, colorClass }) => {
    const radius = 30;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference - (percentage / 100) * circumference;

    return (
        <div className="relative flex items-center justify-center w-20 h-20 sm:w-24 sm:h-24 mb-6">
            <svg className="transform -rotate-90 w-full h-full" viewBox="0 0 80 80">
                <circle cx="40" cy="40" r={radius} fill="transparent" stroke="rgba(255,255,255,0.1)" strokeWidth="6" />
                <circle
                    cx="40"
                    cy="40"
                    r={radius}
                    fill="transparent"
                    stroke="currentColor"
                    strokeWidth="6"
                    strokeDasharray={circumference}
                    strokeDashoffset={strokeDashoffset}
                    strokeLinecap="round"
                    className={`${colorClass} transition-all duration-1000 ease-out`}
                />
            </svg>
            <div className="absolute flex flex-col items-center">
                <span className={`text-2xl font-black text-white`}>{percentage}%</span>
                <span className="text-[9px] uppercase tracking-widest text-gray-400">Prob.</span>
            </div>
        </div>
    );
};

const VerdictSummary: React.FC<{
    data: VeredictoAnalista;
    onViewFull: () => void;
    headerData?: any;
}> = ({ data, onViewFull, headerData }) => {

    // Determine visual style based on decision
    const isBet = data.decision === 'APOSTAR';
    const isAvoid = data.decision === 'EVITAR';
    const isWatch = data.decision === 'OBSERVAR';

    // Theme Config
    let theme = {
        bg: "bg-slate-900",
        border: "border-gray-600",
        accent: "text-gray-400",
        iconBg: "bg-gray-700",
        mainText: "text-gray-200",
        button: "bg-gray-700 hover:bg-gray-600",
        glow: "",
        progressColor: "text-gray-500"
    };

    if (isBet) {
        theme = {
            bg: "bg-gradient-to-br from-emerald-900/80 via-slate-900 to-slate-900",
            border: "border-emerald-500",
            accent: "text-emerald-400",
            iconBg: "bg-emerald-500/20 shadow-[0_0_30px_rgba(16,185,129,0.2)]",
            mainText: "text-white",
            button: "bg-emerald-600 hover:bg-emerald-500 shadow-lg shadow-emerald-500/20",
            glow: "shadow-[0_0_50px_rgba(16,185,129,0.1)]",
            progressColor: "text-emerald-500"
        };
    } else if (isAvoid) {
        theme = {
            bg: "bg-gradient-to-br from-red-900/30 via-slate-900 to-slate-900",
            border: "border-red-500",
            accent: "text-red-400",
            iconBg: "bg-red-500/10",
            mainText: "text-gray-300",
            button: "bg-slate-700 hover:bg-slate-600 border border-slate-600",
            glow: "",
            progressColor: "text-red-500"
        };
    } else if (isWatch) {
        theme = {
            bg: "bg-gradient-to-br from-blue-900/40 via-slate-900 to-slate-900",
            border: "border-blue-400",
            accent: "text-blue-400",
            iconBg: "bg-blue-500/20",
            mainText: "text-blue-100",
            button: "bg-blue-600 hover:bg-blue-500",
            glow: "",
            progressColor: "text-blue-400"
        };
    }

    // Default probability if missing (backwards compatibility)
    const probability = data.probabilidad || (isBet ? 75 : 40);
    const confidence = data.nivel_confianza || (isBet ? "ALTA" : "BAJA");

    return (
        <div className={`flex flex-col min-h-full ${theme.bg} text-white p-4 sm:p-6 md:p-12 animate-fade-in relative overflow-hidden`}>
            {/* Background Glow */}
            <div className={`absolute top-0 left-1/2 -translate-x-1/2 w-full h-1/2 ${theme.glow} pointer-events-none fixed-glow`} />

            {/* Header Mini */}
            <div className="mb-4 text-center relative z-10 opacity-80 hover:opacity-100 transition-opacity">
                <span className="text-blue-400 text-xs font-bold uppercase tracking-widest mb-1 block">Derbix Intelligence</span>
                <h2 className="text-lg md:text-xl font-bold text-gray-300 truncate">{headerData?.titulo}</h2>
                <p className="text-gray-500 text-xs">{headerData?.subtitulo}</p>
            </div>

            {/* MAIN DECISION CARD */}
            <div className={`flex-grow flex flex-col justify-center items-center text-center relative z-10 max-w-3xl mx-auto w-full border-t-2 ${theme.border} bg-black/40 rounded-3xl p-4 sm:p-6 md:p-8 lg:p-10 mb-8 backdrop-blur-md shadow-2xl`}>

                <div className="flex flex-row items-center gap-8 mb-6">
                    {/* Icon / Indicator or Progress Ring */}
                    {isBet ? (
                        <ProbabilityRing percentage={probability} colorClass={theme.progressColor} />
                    ) : (
                        <div className={`w-20 h-20 rounded-full ${theme.iconBg} flex items-center justify-center mb-6`}>
                            {isAvoid && <ExclamationTriangleIcon className="w-10 h-10 text-red-500" />}
                            {isWatch && <EyeIcon className="w-10 h-10 text-blue-400" />}
                        </div>
                    )}

                    {/* Confidence Label (Right of ring) */}
                    {confidence && (
                        <div className="flex flex-col items-start hidden md:flex">
                            <span className="text-xs text-gray-400 uppercase tracking-wider mb-1">Nivel de Confianza</span>
                            <span className={`px-3 py-1 rounded text-xs font-black uppercase tracking-widest border ${isBet ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300' : 'border-gray-600 bg-gray-800 text-gray-400'}`}>
                                {confidence}
                            </span>
                        </div>
                    )}
                </div>


                {/* Main Action Title */}
                <h1 className={`text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-black uppercase mb-4 tracking-tight ${theme.accent} drop-shadow-lg`}>
                    {data.titulo_accion || (isBet ? "OPORTUNIDAD CLARA" : "NO APOSTAR")}
                </h1>

                {/* Selection (Only if Bet) */}
                {isBet && data.seleccion_clave && (
                    <div className="mb-6 bg-emerald-500/10 px-8 py-5 rounded-xl border border-emerald-500/30 w-full max-w-xl shadow-[0_0_15px_rgba(16,185,129,0.1)]">
                        <span className="block text-emerald-500/70 text-[10px] font-bold uppercase mb-2 tracking-widest">Apuesta Recomendada</span>
                        <span className="text-xl sm:text-2xl md:text-3xl lg:text-4xl font-black text-white block leading-none">{data.seleccion_clave}</span>
                    </div>
                )}

                {/* Reasoning */}
                <p className={`text-lg font-medium leading-relaxed max-w-xl mx-auto ${theme.mainText} italic opacity-90`}>
                    "{data.razon_principal}"
                </p>

                {/* Risk Warning (If Avoid or Low Prob) */}
                {(isAvoid || (isBet && probability < 80)) && (
                    <div className={`mt-6 text-xs px-4 py-2 rounded flex items-center gap-2 ${isAvoid ? 'text-red-300 bg-red-900/20' : 'text-yellow-200 bg-yellow-900/20'}`}>
                        <ExclamationTriangleIcon className="w-4 h-4" />
                        <span><span className="font-bold">Riesgo:</span> {data.riesgo_principal || "Volatilidad detectada."}</span>
                    </div>
                )}
            </div>

            {/* ACTION BUTTON */}
            {/* ACTION BUTTON - Sticky Bottom for Mobile */}
            <div className={`text-center relative z-20 pb-6 pt-4 mt-auto md:mt-8 sticky bottom-0 -mx-6 md:mx-0 px-6 md:px-0 bg-gradient-to-t from-slate-900 via-slate-900/95 to-transparent`}>
                <p className="text-gray-500 text-xs mb-3 uppercase tracking-widest opacity-60">
                    {isBet ? "Ver análisis detallado" : "Explorar datos"}
                </p>
                <button
                    onClick={onViewFull}
                    className={`group relative inline-flex items-center justify-center px-12 py-4 font-bold text-white transition-all duration-200 ${theme.button} font-pj rounded-xl focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-600 w-full md:w-auto text-lg shadow-xl`}
                >
                    {isBet ? "VER INFORME COMPLETO" : "VER ANÁLISIS"}
                    {isBet && <div className="absolute -inset-3 rounded-xl bg-emerald-400 opacity-20 group-hover:opacity-40 blur-lg transition-opacity duration-200" />}
                </button>
            </div>
        </div>
    );
};

// --- MARKET ODDS COMPONENT ---
const OddsOverviewSection: React.FC<{ odds: any }> = ({ odds }) => {
    if (!odds) return null;

    const bookmaker = odds.bookmakers?.[0]?.title || 'Casa de Apuestas';

    // Extract main markets
    const h2h = odds.bookmakers?.[0]?.markets?.find((m: any) => m.key === 'h2h');
    const totals = odds.bookmakers?.[0]?.markets?.find((m: any) => m.key === 'totals'); // Assuming standard 2.5 usually first or check all
    const btts = odds.bookmakers?.[0]?.markets?.find((m: any) => m.key === 'btts'); // btts

    // Helper to get price
    const getPrice = (market: any, name: string) => market?.outcomes?.find((o: any) => o.name === name)?.price?.toFixed(2) || '-';

    return (
        <div className="bg-gradient-to-r from-slate-800 to-slate-900 border border-blue-500/20 rounded-xl p-5 mb-6 shadow-lg animate-fade-in relative overflow-hidden">
            <div className="absolute top-0 right-0 p-2 opacity-10">
                <span className="text-4xl">📊</span>
            </div>

            <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-white flex items-center">
                    <span className="bg-blue-500/20 text-blue-400 p-1.5 rounded mr-2 text-xs">LIVE</span>
                    Cuotas en Tiempo Real
                </h3>
                <span className="text-xs text-gray-400 bg-black/30 px-2 py-1 rounded border border-white/5">
                    Fuente: <span className="text-blue-300 font-bold">{bookmaker}</span>
                </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* 1X2 */}
                <div className="bg-black/20 rounded-lg p-3 border border-white/5">
                    <div className="text-xs text-gray-400 uppercase tracking-wider mb-2 text-center">Resultado Final (1X2)</div>
                    <div className="flex justify-between items-center text-sm font-bold">
                        <div className="flex flex-col items-center w-1/3">
                            <span className="text-white">{getPrice(h2h, odds.home_team)}</span>
                            <span className="text-[10px] text-gray-500 font-normal">Local</span>
                        </div>
                        <div className="flex flex-col items-center w-1/3 border-x border-white/5">
                            <span className="text-white">{getPrice(h2h, 'Draw')}</span>
                            <span className="text-[10px] text-gray-500 font-normal">Empate</span>
                        </div>
                        <div className="flex flex-col items-center w-1/3">
                            <span className="text-white">{getPrice(h2h, odds.away_team)}</span>
                            <span className="text-[10px] text-gray-500 font-normal">Visita</span>
                        </div>
                    </div>
                </div>

                {/* Totals */}
                <div className="bg-black/20 rounded-lg p-3 border border-white/5">
                    <div className="text-xs text-gray-400 uppercase tracking-wider mb-2 text-center">
                        Goles {totals?.outcomes?.[0]?.point ? `(${totals.outcomes[0].point})` : ''}
                    </div>
                    <div className="flex justify-around items-center text-sm font-bold">
                        <div className="flex flex-col items-center">
                            <span className="text-green-400">{getPrice(totals, 'Over')}</span>
                            <span className="text-[10px] text-gray-500 font-normal">Over</span>
                        </div>
                        <div className="flex flex-col items-center">
                            <span className="text-red-400">{getPrice(totals, 'Under')}</span>
                            <span className="text-[10px] text-gray-500 font-normal">Under</span>
                        </div>
                    </div>
                </div>

                {/* BTTS */}
                <div className="bg-black/20 rounded-lg p-3 border border-white/5">
                    <div className="text-xs text-gray-400 uppercase tracking-wider mb-2 text-center">Ambos Anotan</div>
                    <div className="flex justify-around items-center text-sm font-bold">
                        <div className="flex flex-col items-center">
                            <span className="text-blue-300">{getPrice(btts, 'Yes') || getPrice(btts, 'Sí')}</span>
                            <span className="text-[10px] text-gray-500 font-normal">Sí</span>
                        </div>
                        <div className="flex flex-col items-center">
                            <span className="text-gray-300">{getPrice(btts, 'No')}</span>
                            <span className="text-[10px] text-gray-500 font-normal">No</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- SEO PAGE LINK (admin only) ---
const SeoPageLinkModal: React.FC<{ fixtureId?: string | number }> = ({ fixtureId }) => {
    const [path, setPath] = useState<string | null>(null);
    useEffect(() => {
        if (!fixtureId) return;
        const fid = typeof fixtureId === 'string' ? parseInt(fixtureId) : fixtureId;
        if (isNaN(fid)) return;
        supabase.from('seo_pages').select('full_path').eq('fixture_id', fid).maybeSingle()
            .then(({ data }) => { if (data?.full_path) setPath(data.full_path); });
    }, [fixtureId]);
    if (!path) return null;
    return (
        <a
            href={`https://derbix.co${path}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 px-4 py-2 rounded-lg text-sm font-medium transition-all border border-blue-500/20 hover:border-blue-500/40"
            title="Ver página SEO pública"
        >
            <LinkIcon className="w-4 h-4" />
            <span className="hidden md:inline">Página SEO</span>
        </a>
    );
};

// --- COMPONENTE PRINCIPAL ---

export const AnalysisReportModal: React.FC<{ analysis: VisualAnalysisResult | null; onClose: () => void }> = ({ analysis, onClose }) => {
    const [currentAnalysis, setCurrentAnalysis] = useState<VisualAnalysisResult | null>(analysis);
    const { profile } = useAuth();
    const { plan, isAdmin: isSubAdmin } = useSubscription();
    const isAgency = isAgencyRole(profile?.role);
    const hasFullAccess = isAgency || isSubAdmin;
    const userPlan = (plan.plan_name || 'free') as PlanTier;

    useEffect(() => {
        setCurrentAnalysis(analysis);
    }, [analysis]);
    const [showFullReport, setShowFullReport] = useState(false);
    const [showPdfDialog, setShowPdfDialog] = useState(false);
    const [realOdds, setRealOdds] = useState<any | null>(null);
    const [showDebug, setShowDebug] = useState(false);
    const [debugTab, setDebugTab] = useState<'ai' | 'payload'>('ai');

    // EFFECT: Fetch Real Odds for High Confidence Predictions
    useEffect(() => {
        const fetchOdds = async () => {
            if (!currentAnalysis || !currentAnalysis.analysisRun || !currentAnalysis.dashboardData) return;

            const run = currentAnalysis.analysisRun;
            // Get predictions from the dashboard data (which drives the UI) or the run persistence
            // We need to map UI predictions back to DB predictions to update them
            const uiPredictions = currentAnalysis.dashboardData.predicciones_finales?.detalle || [];

            // Check if we already have odds in the DB run (persisted)
            // Or if we need to fetch them.
            // Simplified logic: If UI prediction doesn't have odds, try to fetch.

            // Note: DetallePrediccion interface doesn't have 'odds' yet in types.ts? 
            // We should check if we updated DetallePrediccion.
            // Actually, we updated PredictionDB, but DashboardAnalysisJSON uses DetallePrediccion.
            // Let's cast for now or update types. 
            // Just in case, we'll store odds in the 'pred' object in the local state.

            // MODIFIED: Force fetch regardless of predictions state to show the main Odds Table
            // const usefulPredictions = uiPredictions.filter((p: any) => !p.odds && p.probabilidad_estimado_porcentaje >= 60);

            // if (usefulPredictions.length === 0) return;

            console.log(`[Odds] Starting odds fetch process for visual table...`);

            // Context for API
            const leaguePart = run.league_name || currentAnalysis.dashboardData?.header_partido?.titulo || 'Unknown';
            const homeTeam = currentAnalysis.dashboardData?.tablas_comparativas?.forma?.filas?.[0]?.[0] as string || 'Home';
            const awayTeam = currentAnalysis.dashboardData?.tablas_comparativas?.forma?.filas?.[1]?.[0] as string || 'Away';

            // Note: We need the DATE. We can get it from header or run created_at (approx) or context
            // Ideally we iterate the 'AnalysisRun' object which has fixture_id.
            // BUT we don't have the fixture DATE easily available in VisualAnalysisResult unless we dig into dash data or fetch fixture.
            // WORKAROUND: Use 'created_at' of the run as proxy for "upcoming" if it's recent, OR try to find date in header subtitles.
            // Better: We have `analysisRun.fixture_id`. We can rely on `fastBatchOddsCheck` which usually requires date, BUT we can try without date if we trust the league/team match? No, date is needed for accurate matching.

            // Let's assume the run is for an UPCOMING match or RECENT match.
            // We can try to extract date from the header "Fecha: ..." usually found in context bullets?
            // Or just use today/tomorrow if it's a new analysis.
            // START FIX: Obtener fecha REAL del partido para el matching de cuotas
            // Si usamos new Date(), falla para partidos futuros con filtro > 30h
            let matchDate = (run as any).match_date || (run as any).date;

            if (!matchDate) {
                // Intentar extraer del subtítulo "Sabado 31 Enero" etc
                // O usar fecha de creación si es muy reciente (pero cuidado con análisis adelantados)
                matchDate = new Date().toISOString();
                console.log("[Odds] Warning: Using current date for odds matching (feature incomplete in run data)");
            } else {
                console.log(`[Odds] Using match date from Run: ${matchDate}`);
            }
            // END FIX

            const sportKey = mapLeagueToSportKey(leaguePart);

            const checkItem = {
                fixtureId: parseInt(run.fixture_id),
                sportKey: sportKey,
                home: homeTeam,
                away: awayTeam,
                date: matchDate
            };

            try {
                // We just pass one item to the batch function
                const realOddsMap = await fastBatchOddsCheck([checkItem]);

                if (realOddsMap.size > 0) {
                    const event = realOddsMap.get(checkItem.fixtureId);
                    if (event) {
                        let updates = 0;
                        const updatedData = { ...currentAnalysis.dashboardData };

                        // Update UI Predictions
                        updatedData.predicciones_finales.detalle = updatedData.predicciones_finales.detalle.map((pred: any) => {
                            if (!pred.odds) {
                                const price = findPriceInEvent(event, pred.mercado, pred.seleccion);
                                if (price) {
                                    updates++;
                                    // Persist to DB!
                                    // We need the Prediction ID from the DB. 
                                    // The UI 'pred' might not have the DB ID if it came purely from JSON.
                                    // However, typical flow saves predictions to DB and THEN returns.
                                    // Let's assume we can match by selection text if ID is missing or match by run_id + selection.

                                    if (run.id && run.id !== 'temporary') {
                                        supabase
                                            .from('predictions')
                                            .update({ odds: price })
                                            .eq('analysis_run_id', run.id)
                                            .eq('selection', pred.seleccion)
                                            .then(({ error }) => {
                                                if (error) console.error("Failed to persist odds:", error);
                                            });
                                    }
                                    return { ...pred, odds: price };
                                }
                            }
                            return pred;
                        });

                        // STORE FULL ODDS DATA FOR DISPLAY
                        setRealOdds(event);

                        if (updates > 0) {
                            console.log(`[Odds] Updated ${updates} predictions with real odds.`);
                            setCurrentAnalysis({ ...currentAnalysis, dashboardData: updatedData });
                        }
                    }
                }

            } catch (e) {
                console.error("[Odds] Error fetching single match odds:", e);
            }
        };

        fetchOdds();
    }, [analysis?.analysisRun?.id]); // Only run when the Analysis Run ID changes (load)

    if (!currentAnalysis) return null;

    const data = currentAnalysis.dashboardData;

    console.log("[DEBUG] Report Data Received:", data);
    if (!data) console.error("[DEBUG] No dashboardData found in analysis object");

    // Fallback por si la IA devolvió texto plano en lugar del JSON (caso raro con Gemini 2.5 Pro y prompt estricto)
    if (!data) {
        return (
            <div className="fixed inset-0 bg-black/95 z-[100] flex items-center justify-center p-4 md:p-6 animate-fade-in backdrop-blur-md" onClick={(e) => e.target === e.currentTarget && onClose()}>
                <div className="bg-slate-900 rounded-2xl shadow-2xl w-full max-w-4xl h-[85vh] flex flex-col border border-white/10" onClick={(e) => e.stopPropagation()}>
                    <div className="p-6 border-b border-gray-800 flex justify-between">
                        <h2 className="text-xl font-bold text-red-400">Error de Formato Visual</h2>
                        <button onClick={onClose}><XMarkIcon className="w-6 h-6 text-gray-400" /></button>
                    </div>
                    <div className="p-6 overflow-y-auto">
                        <p className="text-gray-300 mb-4">La IA generó el análisis pero no siguió el formato visual estricto. Aquí está el texto crudo:</p>
                        <pre className="whitespace-pre-wrap text-sm text-gray-400 font-mono bg-gray-800 p-4 rounded">{currentAnalysis.analysisText}</pre>
                    </div>
                </div>
            </div>
        );
    }

    const isStructured = typeof analysis !== 'string';
    // --- UPDATED LOGIC FOR VERDICT VIEW ---
    const hasVerdict = !!data.veredicto_analista;
    const showVerdictView = isStructured && hasVerdict && !showFullReport;

    // Descarga PDF con opciones del diálogo
    const handleDownloadReport = (pdfOptions?: { isPromo: boolean; onlyOpportunities: boolean }) => {
        trackPDFDownload(data?.header_partido?.titulo || 'Reporte');
        import('../../services/pdf/pdfGenerator').then(({ generateMatchAnalysisPDF }) => {
            // Pass BOTH the V9 report_packet (rich xG/recent_5/prosa) and the legacy
            // report_pre_jsonb (header/picks). The adapter prefers report_packet but falls
            // back to report_pre_jsonb so legacy modal data still renders.
            const pdfData = {
                report_packet: analysis?.reportPacket || null,
                report_pre_jsonb: {
                    ...data,
                    header_partido: data.header_partido || { titulo: "Informe de Análisis", subtitulo: new Date().toLocaleDateString() }
                }
            };

            generateMatchAnalysisPDF(pdfData, {
                fileName: `Derbix_Analisis_${(data.header_partido?.titulo || 'Reporte').replace(/[^a-z0-9]/gi, '_')}.pdf`,
                isPromo: pdfOptions?.isPromo || false,
                onlyOpportunities: pdfOptions?.onlyOpportunities || false,
            }).catch((err: unknown) => {
                console.error('[PDF] Analysis download failed:', err);
                alert('No se pudo generar el PDF: ' + (err instanceof Error ? err.message : String(err)));
            });
        }).catch((err) => {
            console.error('[PDF] Failed to load pdfGenerator module:', err);
            alert('No se pudo cargar el módulo de PDF.');
        });
        setShowPdfDialog(false);
    };

    return createPortal(
        <div className="fixed inset-0 bg-black/95 z-[100] flex items-center justify-center p-0 md:p-6 animate-fade-in backdrop-blur-md" onClick={(e) => e.target === e.currentTarget && onClose()}>
            <div className="bg-slate-900 w-full h-full md:h-[90vh] md:max-w-6xl md:rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-white/10" onClick={(e) => e.stopPropagation()}>

                {/* ═══════════════════════════════════════════════════════════════
                            DEBUG MODE: SPLIT VIEW (PAYLOAD vs AI RESPONSE)
                           ═══════════════════════════════════════════════════════════════ */}
                {showDebug ? (
                    <div className="p-6 bg-slate-950 h-full overflow-hidden flex flex-col">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-xl font-bold text-white flex items-center gap-2">
                                <span className="text-blue-400">⚡</span> Inspector de Datos V3
                            </h3>
                            <div className="flex bg-slate-800 rounded-lg p-1">
                                <button
                                    onClick={() => setDebugTab('payload')}
                                    className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${debugTab === 'payload' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
                                >
                                    Input (API Payload)
                                </button>
                                <button
                                    onClick={() => setDebugTab('ai')}
                                    className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${debugTab === 'ai' ? 'bg-purple-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
                                >
                                    Output (IA Response)
                                </button>
                            </div>
                            <button onClick={() => setShowDebug(false)} className="text-slate-400 hover:text-white">
                                <XMarkIcon className="w-6 h-6" />
                            </button>
                        </div>

                        <div className="flex-grow overflow-auto border border-white/10 rounded-xl bg-slate-900 custom-scrollbar">
                            {debugTab === 'payload' ? (
                                <pre className="p-4 text-xs font-mono text-blue-300 leading-relaxed whitespace-pre-wrap">
                                    {analysis.payload ? JSON.stringify(analysis.payload, null, 2) : "// No raw payload available for this analysis run."}
                                </pre>
                            ) : (
                                <pre className="p-4 text-xs font-mono text-purple-300 leading-relaxed whitespace-pre-wrap">
                                    {JSON.stringify(data, null, 2)}
                                </pre>
                            )}
                        </div>
                        <div className="mt-2 text-xs text-slate-500 text-center">
                            {debugTab === 'payload' ? "Datos crudos enviados al motor Gemini (SportMonks V3)" : "Estructura JSON generada por el motor Gemini"}
                        </div>
                    </div>
                ) : showVerdictView ? (
                    <div className="relative h-full flex flex-col overflow-y-auto custom-scrollbar bg-slate-900">
                        <div className="absolute top-4 right-4 z-50 flex gap-2">
                            <button onClick={onClose} className="p-2 bg-black/40 hover:bg-black/60 rounded-full text-white transition-colors backdrop-blur-sm">
                                <XMarkIcon className="w-6 h-6" />
                            </button>
                        </div>
                        <VerdictSummary
                            data={data.veredicto_analista!}
                            onViewFull={() => setShowFullReport(true)}
                            headerData={data.header_partido}
                        />
                    </div>
                ) : (
                    <div className="flex flex-col h-full">
                        {/* Persistent Toolbar Header */}
                        <div className="flex items-center justify-between px-3 py-3 sm:px-4 md:px-6 md:py-4 bg-slate-800 border-b border-white/5 z-20 shadow-md">
                            <div className="flex items-center gap-3">
                                <div className="bg-brand/10 p-2 rounded-lg">
                                    <ChartBarIcon className="w-5 h-5 text-brand" />
                                </div>
                                <div>
                                    <h2 className="text-white font-bold text-sm md:text-base leading-tight">
                                        {data.header_partido?.titulo || "Informe de Análisis"}
                                    </h2>
                                    <p className="text-slate-400 text-xs hidden md:block">
                                        {data.header_partido?.subtitulo || "Inteligencia Artificial aplicada"}
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => setShowDebug(!showDebug)}
                                    className={`p-1.5 rounded transition-colors ${showDebug ? 'bg-red-500/20 text-red-400' : 'bg-white/5 text-slate-400 hover:text-white'}`}
                                    title="Modo Inspector de Datos"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                                    </svg>
                                </button>
                                {isAgency && (
                                <>
                                <SeoPageLinkModal fixtureId={currentAnalysis?.analysisRun?.fixture_id} />
                                <button
                                    onClick={() => setShowPdfDialog(true)}
                                    className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all group border border-white/10 hover:border-brand/50"
                                    title="Descargar PDF Premium"
                                >
                                    <ArrowDownTrayIcon className="w-4 h-4 text-slate-400 group-hover:text-brand transition-colors" />
                                    <span className="hidden md:inline">Descargar PDF</span>
                                </button>
                                </>
                                )}
                                <div className="h-6 w-px bg-white/10 mx-1"></div>
                                <button
                                    onClick={onClose}
                                    className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                                    title="Cerrar"
                                >
                                    <XMarkIcon className="w-5 h-5" />
                                </button>
                            </div>
                        </div>

                        <div className="flex-grow overflow-y-auto custom-scrollbar relative">

                            {/* Header Section (Banner) */}
                            {data.header_partido && <HeaderSection data={data.header_partido} />}

                            {/* ODDS SECTION - LIVE */}
                            <div className="px-4 md:px-8 pt-4">
                                <OddsOverviewSection odds={realOdds} />
                            </div>

                            <div className="p-4 md:p-8 space-y-8">

                                {/* 0. Post-Match Analysis (Si existe) */}
                                <PostMatchSection
                                    analysis={currentAnalysis.analysisRun?.post_match_analysis as any}
                                    outcome={currentAnalysis.analysisRun?.actual_outcome as any}
                                    headerData={data.header_partido}
                                    showPdfButton={isAgency}
                                />

                                {/* 1. Resumen Ejecutivo */}
                                {data.resumen_ejecutivo && <ExecutiveSummary data={data.resumen_ejecutivo} />}

                                {/* 2. Grid de Tablas y Visuales */}
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                    <div className="space-y-6">
                                        <div>
                                            <h3 className="text-xl font-bold text-white flex items-center"><ChartBarIcon className="w-5 h-5 mr-2 text-green-accent" /> Datos Clave</h3>
                                            <p className="text-gray-500 text-xs mt-1">Estadísticas comparativas entre ambos equipos basadas en los últimos partidos.</p>
                                        </div>
                                        {data.tablas_comparativas && Object.values(data.tablas_comparativas).map((tabla, idx) => (
                                            <DynamicTable key={idx} data={tabla} />
                                        ))}
                                    </div>
                                    <div className="space-y-6">
                                        <h3 className="text-xl font-bold text-white flex items-center"><TrophyIcon className="w-5 h-5 mr-2 text-blue-400" /> Visualización</h3>
                                        {data.graficos_sugeridos && data.graficos_sugeridos.map((grafico, idx) => (
                                            <VisualChart key={idx} data={grafico} />
                                        ))}
                                    </div>
                                </div>

                                {/* 3. Análisis Táctico y Escenarios */}
                                {data.analisis_detallado && (
                                    <div className="bg-gray-800/50 p-6 rounded-xl border border-gray-700">
                                        <h3 className="text-2xl font-bold text-white mb-2 border-b border-gray-700 pb-2">Análisis Profundo</h3>
                                        <p className="text-gray-500 text-sm mb-6">Factores tácticos, psicológicos y contextuales que influyen en el resultado.</p>

                                        {/* 1. Razonamiento Central (Tesis de Inversión) - NUEVO */}
                                        {(data.analisis_detallado as any).razonamiento_central && (
                                            <div className="bg-slate-800/80 p-6 rounded-xl border border-blue-500/30 mb-8 shadow-inner">
                                                <h4 className="text-lg font-bold text-blue-300 mb-4 flex items-center">
                                                    <span className="bg-blue-500/20 p-1.5 rounded-lg mr-3">
                                                        <SparklesIcon className="w-5 h-5 text-blue-400" />
                                                    </span>
                                                    Tesis de Inversión
                                                </h4>
                                                <p className="text-gray-200 leading-relaxed text-sm md:text-base whitespace-pre-line border-l-4 border-blue-500 pl-4">
                                                    {(data.analisis_detallado as any).razonamiento_central}
                                                </p>
                                            </div>
                                        )}

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
                                            {/* Eliminado: Contexto Competitivo (Redundante) */}
                                            {/* Eliminado: Alineaciones/Jugadores Clave (No disponible en API) */}

                                            <AnalysisBlock section={data.analisis_detallado.matchup_tactico || data.analisis_detallado.estilo_y_tactica} />
                                            <AnalysisBlock section={data.analisis_detallado.factor_psicologico} icon={<LightBulbIcon className="w-4 h-4 mr-2 text-purple-400" />} />
                                            <AnalysisBlock section={data.analisis_detallado.impacto_arbitro} icon={<ExclamationTriangleIcon className="w-4 h-4 mr-2 text-yellow-500" />} />
                                        </div>

                                        {/* NUEVA SECCIÓN: ESCENARIOS DETALLADOS */}
                                        {(data.analisis_detallado.analisis_escenarios || data.analisis_detallado.escenarios_de_partido) && (
                                            <div className="bg-gradient-to-r from-blue-900/20 to-purple-900/20 p-6 rounded-lg border border-blue-500/30">
                                                <h4 className="text-lg font-bold text-blue-300 mb-4 flex items-center">
                                                    <LightBulbIcon className="w-5 h-5 mr-2" />
                                                    {data.analisis_detallado.analisis_escenarios?.titulo || "Escenarios de Partido"}
                                                </h4>
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                    {(data.analisis_detallado.analisis_escenarios?.escenarios || data.analisis_detallado.escenarios_de_partido?.escenarios || []).map((esc, idx) => (
                                                        <div key={idx} className="bg-slate-800 p-4 rounded-lg border-l-4 border-blue-500 shadow-md">
                                                            <div className="flex justify-between items-start mb-2">
                                                                <h5 className="font-bold text-white text-sm uppercase tracking-wide">{esc.nombre}</h5>
                                                                <span className="text-xs bg-blue-900 text-blue-200 px-2 py-1 rounded font-mono">{esc.probabilidad_aproximada}</span>
                                                            </div>
                                                            <p className="text-gray-300 text-sm mb-3">{esc.descripcion}</p>
                                                            {esc.implicacion_apuestas && (
                                                                <div className="bg-blue-500/10 p-2 rounded text-xs text-blue-200 mt-2">
                                                                    <strong className="text-blue-400">Apuesta:</strong> {esc.implicacion_apuestas}
                                                                </div>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* V8: Scores Duales — Transparencia del Modelo */}
                                {(data as any).scores_duales && (
                                    <DualScoresSection scores={(data as any).scores_duales} />
                                )}

                                {/* V8: Patrones Detectados */}
                                {(data as any).patrones_detectados && (
                                    <div className="bg-gradient-to-r from-amber-900/20 to-orange-900/20 p-6 rounded-xl border border-amber-500/30">
                                        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                                            <SparklesIcon className="w-5 h-5 text-amber-400" />
                                            Patrones Detectados (V8)
                                        </h3>
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                            {(data as any).patrones_detectados.goles_por_tiempo && (
                                                <div className="bg-black/30 p-4 rounded-lg border border-white/5">
                                                    <h4 className="text-amber-400 text-xs font-bold uppercase mb-2">Goles por Tiempo</h4>
                                                    <div className="space-y-1 text-sm">
                                                        <div className="flex justify-between text-gray-300">
                                                            <span>Local 1T</span>
                                                            <span className="font-bold text-white">{(data as any).patrones_detectados.goles_por_tiempo.home_1er_tiempo_pct}%</span>
                                                        </div>
                                                        <div className="flex justify-between text-gray-300">
                                                            <span>Local 2T</span>
                                                            <span className="font-bold text-white">{(data as any).patrones_detectados.goles_por_tiempo.home_2do_tiempo_pct}%</span>
                                                        </div>
                                                        <div className="flex justify-between text-gray-300">
                                                            <span>Visita 1T</span>
                                                            <span className="font-bold text-white">{(data as any).patrones_detectados.goles_por_tiempo.away_1er_tiempo_pct}%</span>
                                                        </div>
                                                        <div className="flex justify-between text-gray-300">
                                                            <span>Visita 2T</span>
                                                            <span className="font-bold text-white">{(data as any).patrones_detectados.goles_por_tiempo.away_2do_tiempo_pct}%</span>
                                                        </div>
                                                    </div>
                                                    {(data as any).patrones_detectados.goles_por_tiempo.insight && (
                                                        <p className="text-amber-300 text-xs mt-2 italic">{(data as any).patrones_detectados.goles_por_tiempo.insight}</p>
                                                    )}
                                                </div>
                                            )}
                                            {(data as any).patrones_detectados.formacion_rendimiento && (
                                                <div className="bg-black/30 p-4 rounded-lg border border-white/5">
                                                    <h4 className="text-blue-400 text-xs font-bold uppercase mb-2">Formaciones</h4>
                                                    <div className="space-y-2 text-sm">
                                                        <div>
                                                            <span className="text-gray-400 text-xs">Local:</span>
                                                            <span className="text-white font-bold ml-1">{(data as any).patrones_detectados.formacion_rendimiento.home_formacion_usual}</span>
                                                            <span className="text-emerald-400 text-xs ml-1">({(data as any).patrones_detectados.formacion_rendimiento.home_win_pct_con_formacion}% win)</span>
                                                        </div>
                                                        <div>
                                                            <span className="text-gray-400 text-xs">Visita:</span>
                                                            <span className="text-white font-bold ml-1">{(data as any).patrones_detectados.formacion_rendimiento.away_formacion_usual}</span>
                                                            <span className="text-emerald-400 text-xs ml-1">({(data as any).patrones_detectados.formacion_rendimiento.away_win_pct_con_formacion}% win)</span>
                                                        </div>
                                                    </div>
                                                    {(data as any).patrones_detectados.formacion_rendimiento.insight && (
                                                        <p className="text-blue-300 text-xs mt-2 italic">{(data as any).patrones_detectados.formacion_rendimiento.insight}</p>
                                                    )}
                                                </div>
                                            )}
                                            {(data as any).patrones_detectados.disciplina && (
                                                <div className="bg-black/30 p-4 rounded-lg border border-white/5">
                                                    <h4 className="text-red-400 text-xs font-bold uppercase mb-2">Disciplina</h4>
                                                    <div className="space-y-1 text-sm">
                                                        <div className="flex justify-between text-gray-300">
                                                            <span>Prom. Tarjetas Local</span>
                                                            <span className="font-bold text-white">{(data as any).patrones_detectados.disciplina.home_avg_tarjetas}</span>
                                                        </div>
                                                        <div className="flex justify-between text-gray-300">
                                                            <span>Prom. Tarjetas Visitante</span>
                                                            <span className="font-bold text-white">{(data as any).patrones_detectados.disciplina.away_avg_tarjetas}</span>
                                                        </div>
                                                    </div>
                                                    {(data as any).patrones_detectados.disciplina.insight && (
                                                        <p className="text-red-300 text-xs mt-2 italic">{(data as any).patrones_detectados.disciplina.insight}</p>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* V8: Contexto Externo Resumen */}
                                {(data as any).contexto_externo_resumen && (
                                    <div className="bg-gradient-to-r from-cyan-900/20 to-teal-900/20 p-5 rounded-xl border border-cyan-500/30">
                                        <h4 className="text-sm font-bold text-cyan-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" /></svg>
                                            Contexto Externo (Noticias)
                                        </h4>
                                        <p className="text-gray-300 text-sm leading-relaxed">{(data as any).contexto_externo_resumen}</p>
                                    </div>
                                )}

                                {/* 4. Predicciones Finales — Gating por plan */}
                                {data.predicciones_finales && data.predicciones_finales.detalle && (() => {
                                    const allPreds = data.predicciones_finales.detalle;

                                    if (allPreds.length === 0) {
                                        return (
                                            <div className="bg-slate-800/40 border border-amber-500/20 rounded-xl p-6 text-center">
                                                <TrophyIcon className="w-10 h-10 text-amber-500/60 mx-auto mb-3" />
                                                <h3 className="text-lg font-bold text-white mb-1">Sin predicciones con edge suficiente</h3>
                                                <p className="text-sm text-slate-400 max-w-md mx-auto">
                                                    El análisis se completó pero no encontramos picks con probabilidad y cuota que justifiquen apostar. Esto es común en partidos muy parejos o con cuotas infladas.
                                                </p>
                                            </div>
                                        );
                                    }

                                    const canSeePredictions = hasFullAccess || userPlan !== 'free';
                                    const visiblePreds = hasFullAccess
                                        ? allPreds
                                        : filterPicksForPlan(allPreds, userPlan);
                                    const lockedCount = allPreds.length - visiblePreds.length;

                                    if (!canSeePredictions) {
                                        return (
                                            <LockedSection title="Predicciones del Modelo" planRequired={PLAN_DISPLAY_NAMES.starter}>
                                                <div>
                                                    <h3 className="text-2xl font-bold text-white mb-2 flex items-center">
                                                        <TrophyIcon className="w-8 h-8 text-green-accent mr-3" />
                                                        Predicciones del Modelo
                                                    </h3>
                                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                                        {allPreds.slice(0, 4).map((pred, idx) => (
                                                            <PredictionCard key={pred.id || idx} pred={pred} />
                                                        ))}
                                                    </div>
                                                </div>
                                            </LockedSection>
                                        );
                                    }

                                    return (
                                        <div>
                                            <h3 className="text-2xl font-bold text-white mb-2 flex items-center">
                                                <TrophyIcon className="w-8 h-8 text-green-accent mr-3" />
                                                Predicciones del Modelo
                                            </h3>
                                            <p className="text-gray-500 text-sm mb-6">Pronósticos generados por IA. Las predicciones con {'>'}= {OPPORTUNITIES_THRESHOLD_PERCENT}% de probabilidad son oportunidades de valor confirmadas.</p>
                                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                                {visiblePreds.map((pred, idx) => (
                                                    <PredictionCard key={pred.id || idx} pred={pred} />
                                                ))}
                                            </div>
                                            {lockedCount > 0 && (
                                                <div className="mt-4 text-center py-4 bg-slate-800/50 rounded-xl border border-white/5">
                                                    <p className="text-slate-400 text-sm">
                                                        <LockClosedIcon className="w-4 h-4 inline mr-1" />
                                                        {lockedCount} predicción{lockedCount > 1 ? 'es' : ''} adicional{lockedCount > 1 ? 'es' : ''} disponible{lockedCount > 1 ? 's' : ''} en planes superiores
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })()}

                                {/* 4.5: Análisis de Mercados Calculados (60+) — Gating: pro+ */}
                                {(data as any).analisis_mercados_calculados && (() => {
                                    const canSeeMarkets = hasFullAccess || userPlan === 'pro' || userPlan === 'premium';
                                    const marketsContent = (
                                    <div className="bg-gradient-to-r from-purple-900/30 to-blue-900/30 p-6 rounded-xl border border-purple-500/30">
                                        <h3 className="text-2xl font-bold text-white mb-2 flex items-center">
                                            <ChartBarIcon className="w-8 h-8 text-purple-400 mr-3" />
                                            Análisis de 60+ Mercados
                                            <span className="ml-3 bg-purple-500/20 text-purple-300 px-3 py-1 rounded-full text-xs font-bold">
                                                {(data as any).analisis_mercados_calculados.mercados_con_valor} oportunidades detectadas
                                            </span>
                                        </h3>
                                        <p className="text-gray-500 text-sm mb-4">Ranking de mercados donde el modelo detecta mayor discrepancia entre probabilidad real y cuotas.</p>
                                        <h4 className="text-lg font-bold text-purple-300 mb-3">Top Oportunidades por Valor</h4>
                                        <div className="space-y-3">
                                            {((data as any).analisis_mercados_calculados.top_oportunidades || []).slice(0, 5).map((opp: any, idx: number) => (
                                                <div key={idx} className={`flex items-center justify-between p-4 rounded-lg border-l-4 ${opp.confianza === 'ALTA' ? 'border-green-500 bg-green-900/20' :
                                                    opp.confianza === 'MEDIA' ? 'border-yellow-500 bg-yellow-900/20' :
                                                        'border-gray-500 bg-gray-800/50'
                                                    }`}>
                                                    <div className="flex items-center gap-4">
                                                        <span className="text-2xl font-black text-white">#{idx + 1}</span>
                                                        <div>
                                                            <span className="font-bold text-white block">{opp.mercado}</span>
                                                            <span className="text-xs text-gray-400">{opp.categoria}</span>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-4">
                                                        <div className="text-center">
                                                            <span className="text-xl font-bold text-green-400">{opp.probabilidad_calculada}%</span>
                                                            <span className="block text-[10px] text-gray-500">Calculada</span>
                                                        </div>
                                                        <div className="text-center">
                                                            <span className="text-xl font-bold text-gray-400">{opp.probabilidad_tipica}%</span>
                                                            <span className="block text-[10px] text-gray-500">Típica</span>
                                                        </div>
                                                        <div className={`px-3 py-1 rounded-full font-bold text-sm ${opp.value_score > 10 ? 'bg-green-500 text-white' :
                                                            opp.value_score > 5 ? 'bg-yellow-500 text-black' :
                                                                'bg-gray-600 text-white'
                                                            }`}>
                                                            +{opp.value_score}%
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    );
                                    if (!canSeeMarkets) {
                                        return (
                                            <LockedSection title="Análisis de 60+ Mercados" planRequired={PLAN_DISPLAY_NAMES.pro}>
                                                {marketsContent}
                                            </LockedSection>
                                        );
                                    }
                                    return marketsContent;
                                })()}

                                {/* 5. Advertencias */}
                                {data.advertencias && data.advertencias.bullets && data.advertencias.bullets.length > 0 && (
                                    <div className="bg-yellow-900/20 border border-yellow-700/50 p-4 rounded-lg flex items-start">
                                        <ExclamationTriangleIcon className="w-6 h-6 text-yellow-500 mr-3 flex-shrink-0" />
                                        <div>
                                            <h4 className="font-bold text-yellow-500 mb-1">{data.advertencias.titulo}</h4>
                                            <ul className="list-disc pl-4 text-yellow-200/80 text-sm">
                                                {data.advertencias.bullets.map((w, i) => <li key={i}>{w}</li>)}
                                            </ul>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Footer Actions */}
                        <div className="p-4 border-t border-gray-800 bg-gray-900 flex justify-end">
                            <button
                                onClick={onClose}
                                className="bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 px-6 rounded-lg transition-colors"
                            >
                                Cerrar Informe
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* PDF Download Dialog */}
            {showPdfDialog && (
                <PdfDownloadDialog
                    onClose={() => setShowPdfDialog(false)}
                    onGenerate={(opts) => handleDownloadReport(opts)}
                    matchTitle={data?.header_partido?.titulo || 'Reporte'}
                />
            )}
        </div>,
        document.body
    );
};

// --- PDF DOWNLOAD DIALOG ---
const PdfDownloadDialog: React.FC<{
    onClose: () => void;
    onGenerate: (options: { isPromo: boolean; onlyOpportunities: boolean }) => void;
    matchTitle: string;
}> = ({ onClose, onGenerate, matchTitle }) => {
    const [isPromo, setIsPromo] = useState(false);
    const [onlyOpportunities, setOnlyOpportunities] = useState(false);

    return (
        <div className="fixed inset-0 bg-black/80 z-[200] flex items-center justify-center p-4 animate-fade-in" onClick={(e) => e.target === e.currentTarget && onClose()}>
            <div className="bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md border border-white/10 p-6" onClick={(e) => e.stopPropagation()}>
                <h3 className="text-lg font-bold text-white mb-1">Configurar Descarga PDF</h3>
                <p className="text-slate-400 text-sm mb-6">{matchTitle}</p>

                {/* Toggle: Pronóstico Gratuito */}
                <label className="flex items-start gap-3 p-4 bg-slate-900/50 rounded-xl border border-white/5 mb-3 cursor-pointer hover:border-white/10 transition-colors">
                    <input
                        type="checkbox"
                        checked={isPromo}
                        onChange={(e) => setIsPromo(e.target.checked)}
                        className="mt-0.5 w-5 h-5 rounded border-slate-600 bg-slate-700 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-0"
                    />
                    <div>
                        <span className="text-white font-semibold block text-sm">Pronóstico Gratuito (Telegram)</span>
                        <span className="text-slate-400 text-xs">Oculta la selección/pronóstico del informe. Muestra mercado y cuota pero no la predicción. Agrega CTAs a Derbix.</span>
                    </div>
                </label>

                {/* Toggle: Solo Oportunidades */}
                <label className="flex items-start gap-3 p-4 bg-slate-900/50 rounded-xl border border-white/5 mb-6 cursor-pointer hover:border-white/10 transition-colors">
                    <input
                        type="checkbox"
                        checked={onlyOpportunities}
                        onChange={(e) => setOnlyOpportunities(e.target.checked)}
                        className="mt-0.5 w-5 h-5 rounded border-slate-600 bg-slate-700 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-0"
                    />
                    <div>
                        <span className="text-white font-semibold block text-sm">Solo Oportunidades de Valor</span>
                        <span className="text-slate-400 text-xs">Incluye únicamente predicciones con {'>'}= {OPPORTUNITIES_THRESHOLD_PERCENT}% de probabilidad.</span>
                    </div>
                </label>

                {/* Actions */}
                <div className="flex gap-3 justify-end">
                    <button
                        onClick={onClose}
                        className="px-5 py-2.5 text-slate-400 hover:text-white bg-slate-700 hover:bg-slate-600 rounded-xl text-sm font-medium transition-colors"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={() => onGenerate({ isPromo, onlyOpportunities })}
                        className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-sm transition-colors shadow-lg shadow-emerald-500/20"
                    >
                        Generar PDF
                    </button>
                </div>
            </div>
        </div>
    );
};
