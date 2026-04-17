import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../services/supabaseService';

interface VerifiedPick {
    id: string;
    pick_id: string;
    fixture_id: number | null;
    market: string | null;
    selection: string | null;
    predicted_probability: number | null;
    odds: number | null;
    system_verdict: string | null;
    admin_verdict: string | null;
    approved_for_learning: boolean;
    processed_for_learning: boolean;
    admin_notes: string | null;
    created_at: string;
    system_verified_at: string | null;
    // Added via JOIN
    actual_score?: string | null;
    home_team?: string | null;
    away_team?: string | null;
    league_name?: string | null;
}

type Filter = 'pending' | 'approved' | 'processed' | 'all';

export const MLLearningGate: React.FC = () => {
    const [picks, setPicks] = useState<VerifiedPick[]>([]);
    const [loading, setLoading] = useState(false);
    const [filter, setFilter] = useState<Filter>('pending');
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [triggering, setTriggering] = useState(false);
    const [result, setResult] = useState<string | null>(null);

    const loadPicks = useCallback(async () => {
        setLoading(true);
        try {
            let query = supabase
                .from('ml_verified_picks')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(100);

            if (filter === 'pending') {
                query = query.eq('approved_for_learning', false).eq('processed_for_learning', false);
            } else if (filter === 'approved') {
                query = query.eq('approved_for_learning', true).eq('processed_for_learning', false);
            } else if (filter === 'processed') {
                query = query.eq('processed_for_learning', true);
            }

            const { data, error } = await query;
            if (error) throw error;

            // Enrich with actual_score + team names from pick_results_v2
            const rows = data || [];
            const pickIds = rows.map((r) => r.pick_id).filter(Boolean);
            if (pickIds.length > 0) {
                const { data: results } = await supabase
                    .from('pick_results_v2')
                    .select('pick_id, actual_score, home_team, away_team, league_name')
                    .in('pick_id', pickIds);
                const byPickId = new Map<string, any>();
                (results || []).forEach((r) => byPickId.set(r.pick_id, r));
                rows.forEach((p: any) => {
                    const r = byPickId.get(p.pick_id);
                    if (r) {
                        p.actual_score = r.actual_score;
                        p.home_team = r.home_team;
                        p.away_team = r.away_team;
                        p.league_name = r.league_name;
                    }
                });
            }

            setPicks(rows);
            setSelectedIds(new Set());
        } catch (e) {
            console.error('Failed to load verified picks:', e);
        } finally {
            setLoading(false);
        }
    }, [filter]);

    useEffect(() => { loadPicks(); }, [loadPicks]);

    const toggleSelect = (id: string) => {
        setSelectedIds((s) => {
            const n = new Set(s);
            if (n.has(id)) n.delete(id);
            else n.add(id);
            return n;
        });
    };

    const selectAll = () => {
        setSelectedIds(new Set(picks.map((p) => p.id)));
    };

    const approveSelected = async (verdict: 'WON' | 'LOST' | 'VOID') => {
        // V9 Manual Gate: admin MUST specify verdict explicitly.
        // "Aprobar sin verdict" would be blind approval — forbidden.
        if (selectedIds.size === 0) return;
        const ids = Array.from(selectedIds);
        const update = {
            approved_for_learning: true,
            approved_at: new Date().toISOString(),
            admin_verified_at: new Date().toISOString(),
            admin_verdict: verdict,
        };
        const { error } = await supabase.from('ml_verified_picks').update(update).in('id', ids);
        if (error) { alert(`Error: ${error.message}`); return; }
        await loadPicks();
    };

    const rejectSelected = async () => {
        if (selectedIds.size === 0) return;
        const ids = Array.from(selectedIds);
        // "Rejected" = approved=false + set verdict to null so it doesn't feed learning
        const { error } = await supabase
            .from('ml_verified_picks')
            .update({ approved_for_learning: false, admin_notes: 'Rejected by admin' })
            .in('id', ids);
        if (error) { alert(`Error: ${error.message}`); return; }
        await loadPicks();
    };

    const triggerTraining = async () => {
        setTriggering(true);
        setResult(null);
        try {
            const { data, error } = await supabase.functions.invoke('ml-manual-trainer', {
                body: { trigger_reason: 'manual_admin', admin_user_id: (await supabase.auth.getUser()).data.user?.id },
            });
            if (error) throw error;
            setResult(`✅ Entrenamiento completado: ${data.picks_processed} picks procesados, ${data.dimensions_updated} dimensiones actualizadas`);
            await loadPicks();
        } catch (e: any) {
            setResult(`❌ Error: ${e.message}`);
        } finally {
            setTriggering(false);
        }
    };

    const indexEmbeddings = async () => {
        try {
            const { data, error } = await supabase.functions.invoke('ml-index-picks', {
                body: { limit: 100 },
            });
            if (error) throw error;
            setResult(`✅ Indexados: ${data.indexed} picks nuevos, ${data.skipped} ya existían`);
        } catch (e: any) {
            setResult(`❌ Error indexando: ${e.message}`);
        }
    };

    return (
        <div className="p-6 bg-slate-900 min-h-screen text-white">
            <h1 className="text-2xl font-bold mb-4">ML Learning Gate</h1>
            <p className="text-sm text-slate-400 mb-6">
                Gate manual de aprendizaje. Tú apruebas qué picks alimentan al sistema.
                El verificador automático falla ~5% del tiempo — tu criterio protege la calidad del modelo.
            </p>

            {/* Controls */}
            <div className="flex flex-wrap gap-2 mb-4 items-center">
                <div className="flex gap-1 bg-slate-800 rounded-lg p-1">
                    {(['pending', 'approved', 'processed', 'all'] as Filter[]).map((f) => (
                        <button
                            key={f}
                            onClick={() => setFilter(f)}
                            className={`px-3 py-1 rounded ${filter === f ? 'bg-emerald-500 text-white' : 'text-slate-400'}`}
                        >
                            {f === 'pending' ? 'Pendientes' : f === 'approved' ? 'Aprobados' : f === 'processed' ? 'Procesados' : 'Todos'}
                        </button>
                    ))}
                </div>

                <button onClick={loadPicks} className="px-3 py-1 bg-slate-700 rounded">
                    Recargar
                </button>

                <div className="ml-auto flex gap-2">
                    <button
                        onClick={triggerTraining}
                        disabled={triggering}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded font-semibold"
                    >
                        {triggering ? '⏳ Entrenando...' : '🚀 Disparar Entrenamiento'}
                    </button>
                    <button
                        onClick={indexEmbeddings}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded"
                    >
                        📚 Indexar RAG
                    </button>
                </div>
            </div>

            {result && (
                <div className="mb-4 p-3 bg-slate-800 rounded border border-slate-700">
                    {result}
                </div>
            )}

            {/* Batch actions */}
            {selectedIds.size > 0 && (
                <div className="mb-4 p-3 bg-slate-800 rounded flex gap-2 items-center">
                    <span>{selectedIds.size} seleccionado(s)</span>
                    <span className="text-xs text-slate-400">Veredicto obligatorio →</span>
                    <button
                        onClick={() => approveSelected('WON')}
                        className="px-3 py-1 bg-green-700 rounded"
                    >
                        ✓ WON
                    </button>
                    <button
                        onClick={() => approveSelected('LOST')}
                        className="px-3 py-1 bg-red-700 rounded"
                    >
                        ✗ LOST
                    </button>
                    <button
                        onClick={() => approveSelected('VOID')}
                        className="px-3 py-1 bg-yellow-700 rounded"
                    >
                        VOID
                    </button>
                    <button
                        onClick={rejectSelected}
                        className="px-3 py-1 bg-slate-600 rounded"
                    >
                        🗑 Rechazar (no entrenar)
                    </button>
                </div>
            )}

            {/* Table */}
            <div className="bg-slate-800 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                    <thead className="bg-slate-900">
                        <tr>
                            <th className="p-2 text-left">
                                <input
                                    type="checkbox"
                                    checked={picks.length > 0 && selectedIds.size === picks.length}
                                    onChange={selectAll}
                                />
                            </th>
                            <th className="p-2 text-left">Partido</th>
                            <th className="p-2 text-left">Liga</th>
                            <th className="p-2 text-left">Mercado</th>
                            <th className="p-2 text-left">Selección</th>
                            <th className="p-2 text-right">Prob.</th>
                            <th className="p-2 text-right">Cuota</th>
                            <th className="p-2 text-center">Resultado</th>
                            <th className="p-2 text-center">Sistema</th>
                            <th className="p-2 text-center">Admin</th>
                            <th className="p-2 text-center">Estado</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && (
                            <tr><td colSpan={11} className="p-4 text-center text-slate-500">Cargando...</td></tr>
                        )}
                        {!loading && picks.length === 0 && (
                            <tr><td colSpan={11} className="p-4 text-center text-slate-500">No hay picks en esta vista.</td></tr>
                        )}
                        {picks.map((p) => (
                            <tr key={p.id} className="border-t border-slate-700 hover:bg-slate-750">
                                <td className="p-2">
                                    <input
                                        type="checkbox"
                                        checked={selectedIds.has(p.id)}
                                        onChange={() => toggleSelect(p.id)}
                                    />
                                </td>
                                <td className="p-2 text-xs">
                                    {p.home_team && p.away_team ? `${p.home_team} vs ${p.away_team}` : p.fixture_id || '—'}
                                </td>
                                <td className="p-2 text-xs text-slate-400">{p.league_name || '—'}</td>
                                <td className="p-2">{p.market || '—'}</td>
                                <td className="p-2">{p.selection || '—'}</td>
                                <td className="p-2 text-right">{p.predicted_probability ? `${(p.predicted_probability * 100).toFixed(0)}%` : '—'}</td>
                                <td className="p-2 text-right">{p.odds?.toFixed(2) || '—'}</td>
                                <td className="p-2 text-center font-mono text-emerald-300">{p.actual_score || '—'}</td>
                                <td className="p-2 text-center">
                                    <VerdictBadge verdict={p.system_verdict} />
                                </td>
                                <td className="p-2 text-center">
                                    <VerdictBadge verdict={p.admin_verdict} />
                                </td>
                                <td className="p-2 text-center text-xs">
                                    {p.processed_for_learning ? (
                                        <span className="text-slate-400">✓ Procesado</span>
                                    ) : p.approved_for_learning ? (
                                        <span className="text-emerald-400">✓ Aprobado</span>
                                    ) : (
                                        <span className="text-amber-400">⏳ Pendiente</span>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const VerdictBadge: React.FC<{ verdict: string | null }> = ({ verdict }) => {
    if (!verdict) return <span className="text-slate-600">—</span>;
    const classes =
        verdict === 'WON' ? 'bg-green-700 text-green-100' :
        verdict === 'LOST' ? 'bg-red-700 text-red-100' :
        verdict === 'VOID' ? 'bg-yellow-700 text-yellow-100' :
        'bg-slate-700 text-slate-400';
    return <span className={`px-2 py-0.5 rounded text-xs ${classes}`}>{verdict}</span>;
};

export default MLLearningGate;
