import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../services/supabaseService';
import { ComputerDesktopIcon, BoltIcon, CheckCircleIcon, ChartBarIcon, EyeSlashIcon, BrainIcon, LightBulbIcon, PaperAirplaneIcon, CalendarDaysIcon } from '../icons/Icons';

interface BatchMatch {
    fixture_id: number;
    home: string;
    away: string;
    league: string;
    standard_done: boolean;
    standard_error: string | null;
}

interface BatchState {
    active: boolean;
    target_date: string;
    total_matches: number;
    processed_count: number;
    current_phase: string;
    current_match_name: string;
    current_match_index: number;
    matches: BatchMatch[];
    started_at: string;
    updated_at: string;
    triggered_by: string;
    errors: string[];
}

export const OperationsCenter: React.FC = () => {
    const [settings, setSettings] = useState<{ [key: string]: boolean }>({
        auto_analysis_enabled: true,
        auto_verification_enabled: true,
        ml_strategic_insights_enabled: false,
        presentation_mode: false,
        whatsapp_notifications_enabled: true,
    });
    const [loadingSettings, setLoadingSettings] = useState(true);
    const [displayBankroll, setDisplayBankroll] = useState<number>(100);
    const [bankrollInput, setBankrollInput] = useState<string>('100');
    const [bankrollSaved, setBankrollSaved] = useState(false);

    // Análisis por Fecha
    const [selectedDate, setSelectedDate] = useState<string>(() => {
        const now = new Date();
        const bogota = new Date(now.toLocaleString('en-US', { timeZone: 'America/Bogota' }));
        bogota.setDate(bogota.getDate() + 1);
        return bogota.toISOString().split('T')[0];
    });
    const [batchState, setBatchState] = useState<BatchState | null>(null);
    const [isTriggering, setIsTriggering] = useState(false);
    const [dateMatchCount, setDateMatchCount] = useState<number | null>(null);
    const [triggerError, setTriggerError] = useState<string | null>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        loadSettings();
    }, []);

    // Polling del batch state cada 5s
    useEffect(() => {
        const pollBatchState = async () => {
            try {
                const { data } = await supabase
                    .from('system_settings')
                    .select('value')
                    .eq('key', 'auto_analysis_state')
                    .single();

                setBatchState(data?.value || null);
            } catch {
                // Ignorar — key puede no existir todavía
            }
        };

        pollBatchState();
        pollRef.current = setInterval(pollBatchState, 5000);
        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, []);

    // Consultar partidos para la fecha seleccionada
    useEffect(() => {
        const checkDate = async () => {
            setDateMatchCount(null);
            const { count } = await supabase
                .from('daily_matches')
                .select('*', { count: 'exact', head: true })
                .eq('match_date', selectedDate);
            setDateMatchCount(count || 0);
        };
        checkDate();
    }, [selectedDate]);

    const loadSettings = async () => {
        try {
            const { data } = await supabase.from('system_settings').select('*');
            if (data) {
                const map = data.reduce((acc: any, curr: any) => ({ ...acc, [curr.key]: curr.value }), {});
                setSettings(prev => ({ ...prev, ...map }));
                if (map.display_bankroll !== undefined) {
                    setDisplayBankroll(map.display_bankroll);
                    setBankrollInput(String(map.display_bankroll));
                }
            }
        } catch (e) {
            console.error("Error loading settings:", e);
        } finally {
            setLoadingSettings(false);
        }
    };

    const saveBankroll = async () => {
        const val = parseFloat(bankrollInput);
        if (isNaN(val) || val <= 0) return;
        try {
            await supabase.from('system_settings')
                .update({ value: val, updated_at: new Date().toISOString() })
                .eq('key', 'display_bankroll');
            setDisplayBankroll(val);
            setBankrollSaved(true);
            setTimeout(() => setBankrollSaved(false), 2000);
        } catch (e) {
            console.error("Error saving bankroll:", e);
        }
    };

    const toggleSetting = async (key: string) => {
        const newValue = !settings[key];
        setSettings(prev => ({ ...prev, [key]: newValue }));

        try {
            const { error } = await supabase
                .from('system_settings')
                .update({ value: newValue })
                .eq('key', key);

            if (error) throw error;
        } catch (e) {
            console.error(`Error updating setting ${key}:`, e);
            setSettings(prev => ({ ...prev, [key]: !newValue }));
            alert("Error al actualizar la configuración.");
        }
    };

    const triggerAnalysis = async () => {
        setIsTriggering(true);
        setTriggerError(null);
        try {
            const { data, error } = await supabase.functions.invoke('daily-analysis-generator', {
                body: { action: 'start', target_date: selectedDate }
            });

            if (error) throw error;

            const responseData = typeof data === 'string' ? JSON.parse(data) : data;
            if (!responseData?.success) {
                throw new Error(responseData?.error || 'Error al iniciar batch');
            }
        } catch (e: any) {
            console.error('Error triggering analysis:', e);
            setTriggerError(e.message || 'Error desconocido');
        } finally {
            setIsTriggering(false);
        }
    };

    const cancelBatch = async () => {
        if (!batchState) return;
        try {
            await supabase
                .from('system_settings')
                .update({
                    value: { ...batchState, active: false, current_phase: 'cancelled' },
                    updated_at: new Date().toISOString()
                })
                .eq('key', 'auto_analysis_state');
        } catch (e) {
            console.error('Error cancelling batch:', e);
        }
    };

    const getElapsedMinutes = (): number => {
        if (!batchState?.started_at) return 0;
        return Math.round((Date.now() - new Date(batchState.started_at).getTime()) / 60000);
    };

    const getProgressPercent = (): number => {
        if (!batchState || batchState.total_matches === 0) return 0;
        return Math.round((batchState.processed_count / batchState.total_matches) * 100);
    };

    const getPhaseLabel = (phase: string): string => {
        switch (phase) {
            case 'starting': return 'Iniciando';
            case 'standard': return 'Analizando';
            case 'completed': return 'Completado';
            case 'cancelled': return 'Cancelado';
            case 'failed': return 'Error';
            default: return phase;
        }
    };

    return (
        <div className="space-y-8 animate-fade-in">
            <div className="glass p-4 sm:p-6 rounded-xl border border-white/5 shadow-2xl bg-gradient-to-br from-slate-900 to-slate-800">
                <h2 className="text-xl font-display font-bold text-white mb-6 flex items-center gap-3">
                    <ComputerDesktopIcon className="w-6 h-6 text-blue-400" />
                    Control de Automatización del Sistema
                </h2>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6">
                    {/* Switch 1: Auto Analysis */}
                    <div className={`p-4 rounded-xl border transition-all ${settings.auto_analysis_enabled ? 'bg-blue-900/20 border-blue-500/30' : 'bg-slate-800/50 border-slate-700'}`}>
                        <div className="flex justify-between items-start mb-2">
                            <div className="p-2 rounded-lg bg-blue-500/10">
                                <BoltIcon className={`w-6 h-6 ${settings.auto_analysis_enabled ? 'text-blue-400' : 'text-slate-500'}`} />
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="sr-only peer"
                                    checked={settings.auto_analysis_enabled}
                                    onChange={() => toggleSetting('auto_analysis_enabled')}
                                />
                                <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                            </label>
                        </div>
                        <h3 className="font-bold text-gray-200">Análisis Diario</h3>
                        <p className="text-xs text-gray-400 mt-1">Analiza automáticamente los partidos del día siguiente a las 12:30 AM.</p>
                    </div>

                    {/* Switch 3: ML Auto-Learning */}
                    <div className={`p-4 rounded-xl border transition-all ${settings.ml_auto_learning_enabled ? 'bg-cyan-900/20 border-cyan-500/30' : 'bg-slate-800/50 border-slate-700'}`}>
                        <div className="flex justify-between items-start mb-2">
                            <div className="p-2 rounded-lg bg-cyan-500/10">
                                <BrainIcon className={`w-6 h-6 ${settings.ml_auto_learning_enabled ? 'text-cyan-400' : 'text-slate-500'}`} />
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="sr-only peer"
                                    checked={settings.ml_auto_learning_enabled}
                                    onChange={() => toggleSetting('ml_auto_learning_enabled')}
                                />
                                <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-cyan-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-600"></div>
                            </label>
                        </div>
                        <h3 className="font-bold text-gray-200">ML Auto-Learning</h3>
                        <p className="text-xs text-gray-400 mt-1">Activa la inyeccion dinamica de calibracion ML en el motor de analisis.</p>
                    </div>

                    {/* Switch 4: Auto Verification */}
                    <div className={`p-4 rounded-xl border transition-all ${settings.auto_verification_enabled ? 'bg-amber-900/20 border-amber-500/30' : 'bg-slate-800/50 border-slate-700'}`}>
                        <div className="flex justify-between items-start mb-2">
                            <div className="p-2 rounded-lg bg-amber-500/10">
                                <CheckCircleIcon className={`w-6 h-6 ${settings.auto_verification_enabled ? 'text-amber-400' : 'text-slate-500'}`} />
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="sr-only peer"
                                    checked={settings.auto_verification_enabled}
                                    onChange={() => toggleSetting('auto_verification_enabled')}
                                />
                                <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-amber-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-600"></div>
                            </label>
                        </div>
                        <h3 className="font-bold text-gray-200">Verificador de Resultados</h3>
                        <p className="text-xs text-gray-400 mt-1">Verifica resultados cada hora vía SportMonks y actualiza picks WON/LOST.</p>
                    </div>

                    {/* Switch 5: WhatsApp Notifications */}
                    <div className={`p-4 rounded-xl border transition-all ${settings.whatsapp_notifications_enabled ? 'bg-teal-900/20 border-teal-500/30' : 'bg-slate-800/50 border-slate-700'}`}>
                        <div className="flex justify-between items-start mb-2">
                            <div className="p-2 rounded-lg bg-teal-500/10">
                                <PaperAirplaneIcon className={`w-6 h-6 ${settings.whatsapp_notifications_enabled ? 'text-teal-400' : 'text-slate-500'}`} />
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="sr-only peer"
                                    checked={settings.whatsapp_notifications_enabled}
                                    onChange={() => toggleSetting('whatsapp_notifications_enabled')}
                                />
                                <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-teal-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-teal-600"></div>
                            </label>
                        </div>
                        <h3 className="font-bold text-gray-200">Notificaciones WhatsApp</h3>
                        <p className="text-xs text-gray-400 mt-1">Envia alertas de pronósticos y resultados a usuarios con WhatsApp registrado.</p>
                        {settings.whatsapp_notifications_enabled && (
                            <p className="text-xs text-teal-400 mt-2 font-bold">ACTIVO — Notificaciones automáticas habilitadas.</p>
                        )}
                    </div>
                </div>
            </div>

            {/* Análisis por Fecha */}
            <div className="glass p-4 sm:p-6 rounded-xl border border-white/5 shadow-2xl bg-gradient-to-br from-slate-900 to-slate-800">
                <h2 className="text-xl font-display font-bold text-white mb-6 flex items-center gap-3">
                    <CalendarDaysIcon className="w-6 h-6 text-indigo-400" />
                    Análisis por Fecha
                </h2>

                <div className="flex flex-col sm:flex-row items-start sm:items-end gap-4 mb-4">
                    <div>
                        <label className="text-sm text-slate-400 mb-1 block">Fecha objetivo</label>
                        <input
                            type="date"
                            value={selectedDate}
                            onChange={e => setSelectedDate(e.target.value)}
                            className="bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                        />
                    </div>
                    {dateMatchCount !== null && (
                        <span className="text-sm text-slate-400 pb-2">
                            {dateMatchCount} partidos registrados
                        </span>
                    )}
                    <button
                        onClick={triggerAnalysis}
                        disabled={isTriggering || batchState?.active}
                        className="px-6 py-2.5 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
                    >
                        {isTriggering ? (
                            <>
                                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                                Iniciando...
                            </>
                        ) : (
                            <>
                                <BoltIcon className="w-4 h-4" />
                                Analizar Fecha
                            </>
                        )}
                    </button>
                </div>

                {triggerError && (
                    <div className="mb-4 p-3 rounded-lg bg-red-900/20 border border-red-500/30">
                        <span className="text-sm text-red-300">{triggerError}</span>
                    </div>
                )}

                {/* Progreso del batch activo */}
                {batchState?.active && (
                    <div className="p-4 rounded-xl bg-indigo-900/20 border border-indigo-500/30">
                        <div className="flex justify-between items-center mb-3">
                            <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
                                <span className="text-sm font-bold text-indigo-300">
                                    {getPhaseLabel(batchState.current_phase)}: {batchState.current_match_name || '...'}
                                </span>
                            </div>
                            <span className="text-sm text-slate-400 font-mono">
                                {batchState.processed_count}/{batchState.total_matches}
                            </span>
                        </div>

                        <div className="w-full bg-slate-700 rounded-full h-3 overflow-hidden">
                            <div
                                className="bg-indigo-500 h-3 rounded-full transition-all duration-700 ease-out"
                                style={{ width: `${getProgressPercent()}%` }}
                            />
                        </div>

                        <div className="flex justify-between mt-2">
                            <span className="text-xs text-slate-400">
                                {getProgressPercent()}% completado
                            </span>
                            <span className="text-xs text-slate-400">
                                {getElapsedMinutes()} min transcurridos
                            </span>
                        </div>

                        {batchState.errors.length > 0 && (
                            <div className="mt-3 p-2 rounded bg-red-900/20 border border-red-500/20">
                                <p className="text-xs text-red-400 font-bold mb-1">{batchState.errors.length} error(es):</p>
                                {batchState.errors.slice(-3).map((err, i) => (
                                    <p key={i} className="text-xs text-red-300/80 truncate">{err}</p>
                                ))}
                            </div>
                        )}

                        <div className="mt-3 flex items-center gap-3">
                            <button
                                onClick={cancelBatch}
                                className="text-sm text-red-400 hover:text-red-300 transition-colors"
                            >
                                Cancelar batch
                            </button>
                            <span className="text-xs text-slate-500">
                                Fecha: {batchState.target_date} | Via: {batchState.triggered_by}
                            </span>
                        </div>
                    </div>
                )}

                {/* Estado completado */}
                {!batchState?.active && batchState?.current_phase === 'completed' && (
                    <div className="p-3 rounded-lg bg-emerald-900/20 border border-emerald-500/30 flex items-center gap-2">
                        <CheckCircleIcon className="w-5 h-5 text-emerald-400" />
                        <span className="text-sm text-emerald-300">
                            Último batch: {batchState.processed_count}/{batchState.total_matches} partidos ({batchState.target_date})
                            {batchState.errors.length > 0 && ` — ${batchState.errors.length} errores`}
                        </span>
                    </div>
                )}

                {/* Estado cancelado */}
                {!batchState?.active && batchState?.current_phase === 'cancelled' && (
                    <div className="p-3 rounded-lg bg-amber-900/20 border border-amber-500/30">
                        <span className="text-sm text-amber-300">
                            Batch cancelado — {batchState.processed_count}/{batchState.total_matches} partidos procesados ({batchState.target_date})
                        </span>
                    </div>
                )}
            </div>

            {/* Modo Presentación */}
            <div className="glass p-4 sm:p-6 rounded-xl border border-white/5 shadow-2xl bg-gradient-to-br from-slate-900 to-slate-800">
                <div className={`p-4 rounded-xl border transition-all ${settings.presentation_mode ? 'bg-purple-900/20 border-purple-500/30' : 'bg-slate-800/50 border-slate-700'}`}>
                    <div className="flex justify-between items-start mb-2">
                        <div className="p-2 rounded-lg bg-purple-500/10">
                            <EyeSlashIcon className={`w-6 h-6 ${settings.presentation_mode ? 'text-purple-400' : 'text-slate-500'}`} />
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                className="sr-only peer"
                                checked={settings.presentation_mode}
                                onChange={() => toggleSetting('presentation_mode')}
                            />
                            <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-purple-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                        </label>
                    </div>
                    <h3 className="font-bold text-gray-200">Modo Presentación</h3>
                    <p className="text-xs text-gray-400 mt-1">Oculta resultados (GANADO/PERDIDO) y el tab de Resultados para demos y capturas de pantalla.</p>
                    {settings.presentation_mode && (
                        <p className="text-xs text-purple-400 mt-2 font-bold">ACTIVO — Los resultados están ocultos para todos los usuarios.</p>
                    )}
                </div>
            </div>

            {/* Aprendizajes Estratégicos */}
            <div className="glass p-4 sm:p-6 rounded-xl border border-white/5 shadow-2xl bg-gradient-to-br from-slate-900 to-slate-800">
                <div className={`p-4 rounded-xl border transition-all ${settings.ml_strategic_insights_enabled ? 'bg-violet-900/20 border-violet-500/30' : 'bg-slate-800/50 border-slate-700'}`}>
                    <div className="flex justify-between items-start mb-2">
                        <div className="p-2 rounded-lg bg-violet-500/10">
                            <LightBulbIcon className={`w-6 h-6 ${settings.ml_strategic_insights_enabled ? 'text-violet-400' : 'text-slate-500'}`} />
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                className="sr-only peer"
                                checked={settings.ml_strategic_insights_enabled}
                                onChange={() => toggleSetting('ml_strategic_insights_enabled')}
                            />
                            <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-violet-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-violet-600"></div>
                        </label>
                    </div>
                    <h3 className="font-bold text-gray-200">Aprendizajes Estratégicos</h3>
                    <p className="text-xs text-gray-400 mt-1">Inyecta insights cualitativos (basados en picks verificados) al prompt de Gemini. OFF = Gemini puro.</p>
                    {settings.ml_strategic_insights_enabled && (
                        <p className="text-xs text-violet-400 mt-2 font-bold">ACTIVO — Los aprendizajes se inyectan al final del prompt.</p>
                    )}
                </div>
            </div>

            {/* Bankroll Configuration */}
            <div className="glass p-4 sm:p-6 rounded-xl border border-white/5 shadow-2xl bg-gradient-to-br from-slate-900 to-slate-800">
                <h2 className="text-xl font-display font-bold text-white mb-4 flex items-center gap-3">
                    <ChartBarIcon className="w-6 h-6 text-emerald-400" />
                    Bankroll de Referencia
                </h2>
                <p className="text-sm text-slate-400 mb-4">
                    Este valor se usa como base para la proyección de rendimiento que ven todos los usuarios en la pestaña Resultados.
                </p>
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                        <span className="text-slate-400 text-sm">$</span>
                        <input
                            type="number"
                            value={bankrollInput}
                            onChange={e => setBankrollInput(e.target.value)}
                            className="w-32 bg-slate-800 border border-slate-700 text-white text-sm rounded-lg px-3 py-2 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                            min="1"
                        />
                    </div>
                    <button
                        onClick={saveBankroll}
                        className={`px-4 py-2 text-sm font-bold rounded-lg transition-all ${
                            bankrollSaved
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50'
                                : 'bg-emerald-600 text-white hover:bg-emerald-700'
                        }`}
                    >
                        {bankrollSaved ? 'Guardado' : 'Guardar'}
                    </button>
                    <span className="text-xs text-slate-500">Actual: ${displayBankroll}</span>
                </div>
            </div>
        </div>
    );
};
