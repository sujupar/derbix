// components/admin/AnaliticaAvanzada.tsx
// Advanced Analytics Dashboard for Superadmin (Agency Suite)
// Features: date filters, odds filters, market/league breakdown, bankroll evolution, PDF export

import React, { useState, useEffect } from 'react';
import { getAdvancedAnalytics, recalculateResults } from '../../services/resultsService';
import type { AdvancedAnalyticsData, AdvancedAnalyticsFilters } from '../../types';
import { ChartBarIcon, ArrowPathIcon, TrophyIcon } from '../icons/Icons';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const AnaliticaAvanzada: React.FC = () => {
    const [data, setData] = useState<AdvancedAnalyticsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Filter state
    const today = new Date().toISOString().split('T')[0];
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const [startDate, setStartDate] = useState(thirtyDaysAgo);
    const [endDate, setEndDate] = useState(today);
    const [marketFilter, setMarketFilter] = useState('all');
    const [bankroll, setBankroll] = useState(100);
    const [recalculating, setRecalculating] = useState(false);
    const [recalcMessage, setRecalcMessage] = useState<string | null>(null);

    const loadData = async () => {
        setLoading(true);
        setError(null);
        try {
            const filters: AdvancedAnalyticsFilters = {
                startDate,
                endDate,
                startingBankroll: bankroll,
                market: marketFilter !== 'all' ? marketFilter : undefined,
            };
            const result = await getAdvancedAnalytics(filters);
            setData(result);
        } catch (err: any) {
            console.error('[AnaliticaAvanzada] Error:', err);
            setError(err.message || 'Error al cargar analítica');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadData(); }, []);

    const handleApplyFilters = () => loadData();

    // ═══════════════════════════════════════════════════════════════
    // PDF EXPORT
    // ═══════════════════════════════════════════════════════════════
    const handleExportPDF = () => {
        if (!data) return;
        const s = data.summary;

        const doc = new jsPDF();
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        let yPos = 20;

        const checkPageBreak = (needed: number) => {
            if (yPos + needed > pageHeight - 20) {
                doc.addPage();
                yPos = 20;
            }
        };

        // COVER PAGE
        doc.setFillColor(15, 23, 42);
        doc.rect(0, 0, pageWidth, pageHeight, 'F');

        doc.setDrawColor(34, 197, 94);
        doc.setLineWidth(1);
        doc.line(20, 20, 20, 60);

        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(32);
        doc.text("Derbix", 30, 40);

        doc.setTextColor(34, 197, 94);
        doc.setFontSize(32);
        doc.text(".", 103, 40);

        const cx = pageWidth / 2;
        const cy = pageHeight / 2;

        doc.setTextColor(200, 200, 200);
        doc.setFontSize(14);
        doc.setFont('helvetica', 'normal');
        doc.text("INFORME DE RENDIMIENTO", cx, cy - 30, { align: 'center' });

        doc.setTextColor(255, 255, 255);
        doc.setFontSize(36);
        doc.setFont('helvetica', 'bold');
        doc.text("ANALITICA AVANZADA", cx, cy, { align: 'center' });

        doc.setTextColor(34, 197, 94);
        doc.setFontSize(16);
        doc.text(`${startDate}  —  ${endDate}`, cx, cy + 15, { align: 'center' });

        doc.setTextColor(150, 150, 150);
        doc.setFontSize(10);
        doc.text(`Capital inicial: $${bankroll} | Generado: ${new Date().toLocaleDateString('es-CO')}`, cx, pageHeight - 30, { align: 'center' });

        // DATA PAGE
        doc.addPage();
        doc.setFillColor(255, 255, 255);
        doc.rect(0, 0, pageWidth, pageHeight, 'F');
        yPos = 25;

        doc.setTextColor(15, 23, 42);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(18);
        doc.text('Resumen de Rendimiento', 20, yPos);
        yPos += 15;

        // KPI Table
        autoTable(doc, {
            startY: yPos,
            head: [['Metrica', 'Valor']],
            body: [
                ['Picks Totales', `${s.total_picks}`],
                ['Verificados', `${s.verified_picks}`],
                ['Ganados / Perdidos', `${s.won} / ${s.lost}`],
                ['Precisión', `${s.accuracy.toFixed(1)}%`],
                ['Rentabilidad', `${s.roi >= 0 ? '+' : ''}${s.roi.toFixed(1)}%`],
                ['Ganancia', `$${s.total_profit.toFixed(2)}`],
                ['Capital Actual', `$${s.current_bankroll.toFixed(2)}`],
                ['Total Apostado', `$${s.total_staked.toFixed(2)}`],
            ],
            theme: 'grid',
            headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255] },
            styles: { fontSize: 10 },
        });

        yPos = (doc as any).lastAutoTable.finalY + 15;

        // Market Breakdown
        const marketEntries = Object.entries(data.by_market).sort(([, a], [, b]) => b.profit - a.profit);
        if (marketEntries.length > 0) {
            checkPageBreak(40);
            doc.setFontSize(14);
            doc.setFont('helvetica', 'bold');
            doc.text('Desglose por Mercado', 20, yPos);
            yPos += 8;

            autoTable(doc, {
                startY: yPos,
                head: [['Mercado', 'W', 'L', 'Accuracy', 'P/L', 'ROI']],
                body: marketEntries.map(([market, d]) => [
                    market,
                    `${d.won}`,
                    `${d.lost}`,
                    `${d.accuracy.toFixed(0)}%`,
                    `$${d.profit.toFixed(2)}`,
                    `${d.staked > 0 ? ((d.profit / d.staked) * 100).toFixed(0) : 0}%`,
                ]),
                theme: 'grid',
                headStyles: { fillColor: [15, 23, 42] },
                styles: { fontSize: 9 },
            });
            yPos = (doc as any).lastAutoTable.finalY + 15;
        }

        // League Breakdown
        const leagueEntries = Object.entries(data.by_league).sort(([, a], [, b]) => b.accuracy - a.accuracy);
        if (leagueEntries.length > 0) {
            checkPageBreak(40);
            doc.setFontSize(14);
            doc.setFont('helvetica', 'bold');
            doc.text('Desglose por Liga', 20, yPos);
            yPos += 8;

            autoTable(doc, {
                startY: yPos,
                head: [['Liga', 'Ganadas', 'Perdidas', 'Accuracy']],
                body: leagueEntries.map(([league, d]) => [
                    league,
                    `${d.won}`,
                    `${d.lost}`,
                    `${d.accuracy.toFixed(0)}%`,
                ]),
                theme: 'grid',
                headStyles: { fillColor: [15, 23, 42] },
                styles: { fontSize: 9 },
            });
        }

        // Footer
        const totalPages = doc.getNumberOfPages();
        for (let i = 2; i <= totalPages; i++) {
            doc.setPage(i);
            doc.setFontSize(8);
            doc.setTextColor(150, 150, 150);
            doc.text(`Derbix - Informe de Rendimiento | Página ${i - 1} de ${totalPages - 1}`, cx, pageHeight - 10, { align: 'center' });
        }

        doc.save(`derbix-analitica-${startDate}-${endDate}.pdf`);
    };

    // ═══════════════════════════════════════════════════════════════
    // RENDER
    // ═══════════════════════════════════════════════════════════════
    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-20">
                <div className="w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                <p className="text-slate-300 font-medium">Cargando Analítica Avanzada...</p>
            </div>
        );
    }

    const s = data?.summary;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="p-3 bg-gradient-to-br from-amber-600 to-orange-600 rounded-xl shadow-lg shadow-amber-500/20">
                        <ChartBarIcon className="w-6 h-6 text-white" />
                    </div>
                    <div>
                        <h3 className="text-2xl font-bold text-white tracking-tight">Analítica Avanzada</h3>
                        <p className="text-sm text-slate-400">Rendimiento detallado del sistema de pronósticos</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={async () => {
                            setRecalculating(true);
                            setRecalcMessage(null);
                            setError(null);
                            try {
                                const result = await recalculateResults(startDate, endDate);
                                setRecalcMessage(result.message);
                                // Wait a bit for verifier to process, then reload
                                setTimeout(() => loadData(), 3000);
                            } catch (err: any) {
                                setError('Error al recalcular: ' + err.message);
                            } finally {
                                setRecalculating(false);
                            }
                        }}
                        disabled={recalculating}
                        className="px-4 py-2 bg-gradient-to-r from-amber-600 to-amber-700 text-white text-sm font-bold rounded-lg hover:from-amber-700 hover:to-amber-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {recalculating ? 'Recalculando...' : 'Recalcular'}
                    </button>
                    <button
                        onClick={handleExportPDF}
                        disabled={!data || !s}
                        className="px-4 py-2 bg-gradient-to-r from-red-600 to-red-700 text-white text-sm font-bold rounded-lg hover:from-red-700 hover:to-red-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Exportar PDF
                    </button>
                    <button onClick={loadData} className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors">
                        <ArrowPathIcon className="w-5 h-5" />
                    </button>
                </div>
            </div>

            {/* Filters Panel */}
            <div className="bg-slate-900 border border-white/10 rounded-xl p-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div>
                        <label className="text-[11px] sm:text-[10px] text-slate-500 uppercase block mb-1">Desde</label>
                        <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                            className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-lg px-3 py-2" />
                    </div>
                    <div>
                        <label className="text-[11px] sm:text-[10px] text-slate-500 uppercase block mb-1">Hasta</label>
                        <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                            className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-lg px-3 py-2" />
                    </div>
                    <div>
                        <label className="text-[11px] sm:text-[10px] text-slate-500 uppercase block mb-1">Capital ($)</label>
                        <input type="number" value={bankroll} onChange={e => setBankroll(Number(e.target.value))} placeholder="100"
                            className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-lg px-3 py-2" />
                    </div>
                </div>
                <div className="mt-3 flex justify-end">
                    <button onClick={handleApplyFilters} className="px-4 py-2 bg-amber-500/20 text-amber-300 text-sm font-bold rounded-lg border border-amber-500/50 hover:bg-amber-500/30 transition-all">
                        Aplicar Filtros
                    </button>
                </div>
            </div>

            {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                    <p className="text-red-400 text-sm">{error}</p>
                </div>
            )}

            {recalcMessage && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                    <p className="text-amber-400 text-sm">{recalcMessage}</p>
                </div>
            )}

            {s && (
                <>
                    {/* KPI Cards */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-slate-900 border border-white/10 rounded-xl p-4 text-center">
                            <span className={`text-2xl font-black ${s.accuracy >= 55 ? 'text-emerald-400' : s.accuracy >= 45 ? 'text-amber-400' : 'text-red-400'}`}>{s.accuracy.toFixed(1)}%</span>
                            <span className="block text-xs text-slate-400 uppercase mt-1">Aciertos</span>
                            <div className="flex items-center justify-center gap-2 mt-1.5">
                                <span className="text-emerald-400 font-bold text-sm">{s.won} ganadas</span>
                                <span className="text-slate-600">|</span>
                                <span className="text-red-400 font-bold text-sm">{s.lost} perdidas</span>
                            </div>
                        </div>
                        <StatCard label="Ganancia" value={`${s.total_profit >= 0 ? '+' : ''}$${s.total_profit.toFixed(2)}`} color={s.total_profit >= 0 ? 'text-emerald-400' : 'text-red-400'} sub={`Apostado: $${s.total_staked.toFixed(2)}`} />
                        <StatCard label="Rentabilidad" value={`${s.roi >= 0 ? '+' : ''}${s.roi.toFixed(1)}%`} color={s.roi >= 0 ? 'text-emerald-400' : 'text-red-400'} sub="Ganancia sobre lo invertido" />
                        <StatCard label="Capital Actual" value={`$${s.current_bankroll.toFixed(2)}`} color="text-white" sub={`${s.verified_picks} verificados, ${s.pending_picks} pendientes`} />
                    </div>

                    {/* Bankroll Evolution */}
                    {data && data.bankroll_history.length > 0 && (
                        <div className="bg-slate-900 border border-white/10 rounded-xl p-3 sm:p-5">
                            <h4 className="text-white font-bold mb-4">Evolución del Capital</h4>
                            <div className="flex items-end gap-1 h-40">
                                {data.bankroll_history.map((point, idx) => {
                                    const maxBr = Math.max(...data.bankroll_history.map(p => p.bankroll));
                                    const minBr = Math.min(...data.bankroll_history.map(p => p.bankroll));
                                    const range = maxBr - minBr || 1;
                                    const height = ((point.bankroll - minBr) / range) * 100;
                                    return (
                                        <div
                                            key={idx}
                                            className={`flex-1 rounded-t transition-all ${point.profit >= 0 ? 'bg-emerald-500/60' : 'bg-red-500/60'}`}
                                            style={{ height: `${Math.max(height, 5)}%` }}
                                            title={`${point.date}: $${point.bankroll.toFixed(2)} (${point.profit >= 0 ? '+' : ''}${point.profit.toFixed(2)})`}
                                        />
                                    );
                                })}
                            </div>
                            <div className="flex justify-between text-xs text-slate-500 mt-2">
                                <span>{data.bankroll_history[0]?.date}</span>
                                <span>{data.bankroll_history[data.bankroll_history.length - 1]?.date}</span>
                            </div>
                        </div>
                    )}

                    {/* Market Breakdown */}
                    {data && Object.keys(data.by_market).length > 0 && (
                        <div className="bg-slate-900 border border-white/10 rounded-xl p-3 sm:p-5">
                            <h4 className="text-white font-bold mb-4 flex items-center gap-2">
                                <TrophyIcon className="w-5 h-5 text-amber-400" />
                                Rendimiento por Mercado
                            </h4>
                            <div className="space-y-3">
                                {Object.entries(data.by_market)
                                    .sort(([, a], [, b]) => b.profit - a.profit)
                                    .map(([market, d]) => {
                                        const roi = d.staked > 0 ? (d.profit / d.staked) * 100 : 0;
                                        return (
                                            <div key={market} className="flex items-center justify-between bg-black/30 p-3 rounded-lg border border-white/5">
                                                <div>
                                                    <span className="text-white font-medium text-sm">{market}</span>
                                                    <span className="text-slate-500 text-xs ml-2">{d.won}G/{d.lost}P ({d.accuracy.toFixed(0)}%)</span>
                                                </div>
                                                <div className="flex items-center gap-4">
                                                    <span className={`font-bold text-sm ${d.profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                                        {d.profit >= 0 ? '+' : ''}${d.profit.toFixed(2)}
                                                    </span>
                                                    <span className={`text-xs px-2 py-1 rounded ${roi >= 0 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'}`}>
                                                        ROI: {roi >= 0 ? '+' : ''}{roi.toFixed(0)}%
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })}
                            </div>
                        </div>
                    )}

                    {/* League Breakdown */}
                    {data && Object.keys(data.by_league).length > 0 && (
                        <div className="bg-slate-900 border border-white/10 rounded-xl p-3 sm:p-5">
                            <h4 className="text-white font-bold mb-4">Rendimiento por Liga</h4>
                            <div className="space-y-3">
                                {Object.entries(data.by_league)
                                    .sort(([, a], [, b]) => b.accuracy - a.accuracy)
                                    .map(([league, d]) => {
                                        const total = d.won + d.lost;
                                        return (
                                            <div key={league} className="flex items-center justify-between bg-black/30 p-3 rounded-lg border border-white/5">
                                                <div>
                                                    <span className="text-white font-medium text-sm">{league}</span>
                                                    <span className="text-slate-500 text-xs ml-2">{total} picks</span>
                                                </div>
                                                <div className="flex items-center gap-4">
                                                    <span className="text-slate-400 text-xs">{d.won}G/{d.lost}P</span>
                                                    <span className={`text-xs px-2 py-1 rounded font-bold ${d.accuracy >= 55 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}`}>
                                                        {d.accuracy.toFixed(0)}%
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })}
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* Empty State */}
            {(!s || s.total_picks === 0) && !error && (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className="w-24 h-24 bg-slate-800/50 rounded-full flex items-center justify-center mb-6 border border-white/5">
                        <ChartBarIcon className="w-12 h-12 text-slate-600" />
                    </div>
                    <h3 className="text-xl font-bold text-white mb-2">Sin Datos de Analítica</h3>
                    <p className="text-slate-400 max-w-md leading-relaxed">
                        Los datos aparecen cuando se verifican resultados de pronósticos.
                    </p>
                </div>
            )}
        </div>
    );
};

const StatCard: React.FC<{ label: string; value: string; color: string; sub?: string }> = ({ label, value, color, sub }) => (
    <div className="bg-slate-900 border border-white/10 rounded-xl p-3 sm:p-4 text-center">
        <span className={`text-xl sm:text-2xl font-black ${color}`}>{value}</span>
        <span className="block text-xs text-slate-400 uppercase mt-1">{label}</span>
        {sub && <span className="block text-xs text-slate-500 mt-0.5">{sub}</span>}
    </div>
);

export default AnaliticaAvanzada;
