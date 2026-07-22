import React, { useState, useRef } from 'react';
import { supabase } from '../../services/supabaseService';
import { CheckCircleIcon } from '../icons/Icons';

// Subida manual del archivo JSON diario generado por Claude Code (skill derbix-daily-analysis).
// Llama a la edge function import-daily-analysis (verify-jwt, solo platform admin):
//   1) "Validar" -> dryRun:true (valida y muestra preview sin escribir)
//   2) "Confirmar importación" -> dryRun:false (escribe en la DB)

interface ImportCounts {
    target_date?: string;
    matches_in_file?: number;
    matches_accepted?: number;
    picks_accepted?: number;
    picks_rejected?: number;
    matches_written?: number;
    picks_inserted?: number;
    fixtures_skipped?: number;
    opportunities_ranked?: number;
}
interface ImportResponse {
    ok: boolean;
    dryRun: boolean;
    counts?: ImportCounts;
    warnings?: string[];
    errors?: string[];
    error?: string;
}

type Phase = 'idle' | 'parsing' | 'parsed' | 'validating' | 'validated' | 'importing' | 'done' | 'error';

export const DailyAnalysisImport: React.FC = () => {
    const [fileName, setFileName] = useState<string | null>(null);
    const [parsed, setParsed] = useState<any | null>(null);
    const [phase, setPhase] = useState<Phase>('idle');
    const [message, setMessage] = useState<string | null>(null);
    const [validation, setValidation] = useState<ImportResponse | null>(null);
    const [result, setResult] = useState<ImportResponse | null>(null);
    const [overwrite, setOverwrite] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const inputRef = useRef<HTMLInputElement | null>(null);

    const reset = () => {
        setFileName(null); setParsed(null); setPhase('idle');
        setMessage(null); setValidation(null); setResult(null); setOverwrite(false);
        if (inputRef.current) inputRef.current.value = '';
    };

    const handleFile = async (file: File) => {
        setPhase('parsing'); setMessage(null); setValidation(null); setResult(null);
        setFileName(file.name);
        try {
            const text = await file.text();
            const json = JSON.parse(text);
            if (!json?.meta || !Array.isArray(json?.matches)) {
                throw new Error('El archivo no tiene la estructura { meta, matches[] }.');
            }
            setParsed(json);
            setPhase('parsed');
        } catch (e: any) {
            setParsed(null);
            setPhase('error');
            setMessage(`No se pudo leer el archivo: ${e.message}`);
        }
    };

    const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        if (f) handleFile(f);
    };
    const onDrop = (e: React.DragEvent) => {
        e.preventDefault(); setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) handleFile(f);
    };

    const invokeImport = async (dryRun: boolean): Promise<ImportResponse> => {
        const { data, error } = await supabase.functions.invoke('import-daily-analysis', {
            body: { payload: parsed, dryRun, overwrite },
        });
        if (error) throw new Error(error.message || 'Error en la función de importación');
        const res: ImportResponse = typeof data === 'string' ? JSON.parse(data) : data;
        return res;
    };

    const handleValidate = async () => {
        setPhase('validating'); setMessage(null); setValidation(null); setResult(null);
        try {
            const res = await invokeImport(true);
            setValidation(res);
            setPhase('validated');
        } catch (e: any) {
            setPhase('error'); setMessage(e.message);
        }
    };

    const handleImport = async () => {
        setPhase('importing'); setMessage(null); setResult(null);
        try {
            const res = await invokeImport(false);
            setResult(res);
            setPhase(res.ok ? 'done' : 'error');
            if (!res.ok && !res.errors?.length) setMessage(res.error || 'La importación reportó errores.');
        } catch (e: any) {
            setPhase('error'); setMessage(e.message);
        }
    };

    const meta = parsed?.meta || {};
    const leagues = Array.isArray(meta.leagues_included) ? meta.leagues_included.join(', ') : '—';
    const busy = phase === 'validating' || phase === 'importing' || phase === 'parsing';

    return (
        <div className="glass p-4 sm:p-6 rounded-xl border border-white/5 shadow-2xl bg-gradient-to-br from-slate-900 to-slate-800">
            <h2 className="text-xl font-display font-bold text-white mb-2 flex items-center gap-3">
                <svg className="w-6 h-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 7.5L12 3m0 0L7.5 7.5M12 3v13.5" />
                </svg>
                Importar Análisis del Día
            </h2>
            <p className="text-sm text-slate-400 mb-5">
                Sube el archivo <code className="text-emerald-300">derbix-analysis-&lt;fecha&gt;.json</code> generado por Claude Code.
                Primero <strong>Validar</strong> (revisa sin escribir), luego <strong>Confirmar importación</strong>.
            </p>

            {/* Dropzone */}
            <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                onClick={() => inputRef.current?.click()}
                className={`cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition-all ${
                    dragOver ? 'border-emerald-500 bg-emerald-900/10' : 'border-slate-700 hover:border-slate-600 bg-slate-800/40'
                }`}
            >
                <input ref={inputRef} type="file" accept="application/json,.json" className="hidden" onChange={onInputChange} />
                <p className="text-sm text-slate-300">
                    {fileName ? <>Archivo: <span className="text-emerald-300 font-mono">{fileName}</span></> : 'Arrastra el archivo JSON aquí o haz clic para seleccionarlo'}
                </p>
                {fileName && (
                    <button onClick={(e) => { e.stopPropagation(); reset(); }} className="text-xs text-slate-500 hover:text-slate-300 mt-2">
                        Quitar archivo
                    </button>
                )}
            </div>

            {/* Preview del archivo */}
            {parsed && (
                <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <PreviewStat label="Fecha objetivo" value={meta.target_date || '—'} />
                    <PreviewStat label="Partidos" value={String(meta.total_matches ?? parsed.matches.length)} />
                    <PreviewStat label="Picks" value={String(meta.total_picks ?? parsed.matches.reduce((n: number, m: any) => n + (m.picks?.length || 0), 0))} />
                    <PreviewStat label="Motor" value={meta.engine_version || '—'} />
                    <div className="col-span-2 sm:col-span-4 text-xs text-slate-500">Ligas incluidas (IDs): {leagues}</div>
                </div>
            )}

            {/* Overwrite */}
            {parsed && (
                <label className="mt-4 flex items-center gap-2 text-sm text-slate-400 cursor-pointer select-none">
                    <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} className="accent-emerald-500" />
                    Reemplazar partidos ya importados (incluye picks ya verificados). Úsalo solo para re-subir el mismo día.
                </label>
            )}

            {/* Acciones */}
            {parsed && (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                    <button
                        onClick={handleValidate}
                        disabled={busy}
                        className="px-5 py-2.5 bg-slate-700 text-white font-bold rounded-lg hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
                    >
                        {phase === 'validating' ? <Spinner /> : null}
                        Validar
                    </button>
                    <button
                        onClick={handleImport}
                        disabled={busy || phase !== 'validated' || !validation?.ok}
                        title={phase !== 'validated' ? 'Primero valida el archivo' : ''}
                        className="px-5 py-2.5 bg-emerald-600 text-white font-bold rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
                    >
                        {phase === 'importing' ? <Spinner /> : null}
                        Confirmar importación
                    </button>
                </div>
            )}

            {/* Mensaje de error genérico */}
            {message && (
                <div className="mt-4 p-3 rounded-lg bg-red-900/20 border border-red-500/30">
                    <span className="text-sm text-red-300">{message}</span>
                </div>
            )}

            {/* Resultado de validación */}
            {validation && phase === 'validated' && (
                <ResultBlock title="Validación (sin escribir)" res={validation} tone={validation.ok ? 'ok' : 'warn'} />
            )}

            {/* Resultado de importación */}
            {result && (
                <ResultBlock title={result.ok ? 'Importación completada' : 'Importación con errores'} res={result} tone={result.ok ? 'done' : 'warn'} />
            )}
        </div>
    );
};

const PreviewStat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
    <div className="p-3 rounded-lg bg-slate-800/60 border border-slate-700">
        <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
        <p className="text-sm font-bold text-slate-200 truncate">{value}</p>
    </div>
);

const Spinner: React.FC = () => (
    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
);

const ResultBlock: React.FC<{ title: string; res: ImportResponse; tone: 'ok' | 'warn' | 'done' }> = ({ title, res, tone }) => {
    const c = res.counts || {};
    const border = tone === 'done' ? 'border-emerald-500/30 bg-emerald-900/15'
        : tone === 'ok' ? 'border-blue-500/30 bg-blue-900/15'
        : 'border-amber-500/30 bg-amber-900/15';
    return (
        <div className={`mt-4 p-4 rounded-xl border ${border}`}>
            <div className="flex items-center gap-2 mb-3">
                {tone === 'done' && <CheckCircleIcon className="w-5 h-5 text-emerald-400" />}
                <span className="text-sm font-bold text-slate-200">{title}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-slate-300 mb-2">
                {c.matches_accepted !== undefined && <Stat k="Partidos OK" v={c.matches_accepted} />}
                {c.picks_accepted !== undefined && <Stat k="Picks OK" v={c.picks_accepted} />}
                {c.picks_rejected !== undefined && <Stat k="Picks rechazados" v={c.picks_rejected} />}
                {c.picks_inserted !== undefined && <Stat k="Picks insertados" v={c.picks_inserted} />}
                {c.matches_written !== undefined && <Stat k="Partidos escritos" v={c.matches_written} />}
                {c.fixtures_skipped !== undefined && <Stat k="Partidos omitidos" v={c.fixtures_skipped} />}
                {c.opportunities_ranked !== undefined && <Stat k="Oportunidades" v={c.opportunities_ranked} />}
            </div>
            {res.warnings && res.warnings.length > 0 && (
                <details className="mt-2">
                    <summary className="text-xs text-amber-400 cursor-pointer">{res.warnings.length} advertencia(s)</summary>
                    <ul className="mt-1 space-y-0.5 max-h-40 overflow-auto">
                        {res.warnings.map((w, i) => <li key={i} className="text-xs text-amber-300/80">• {w}</li>)}
                    </ul>
                </details>
            )}
            {res.errors && res.errors.length > 0 && (
                <details className="mt-2" open>
                    <summary className="text-xs text-red-400 cursor-pointer">{res.errors.length} error(es)</summary>
                    <ul className="mt-1 space-y-0.5 max-h-40 overflow-auto">
                        {res.errors.map((e, i) => <li key={i} className="text-xs text-red-300/80">• {e}</li>)}
                    </ul>
                </details>
            )}
        </div>
    );
};

const Stat: React.FC<{ k: string; v: number | string }> = ({ k, v }) => (
    <div className="p-2 rounded bg-slate-800/60 border border-slate-700">
        <p className="text-[10px] uppercase tracking-wide text-slate-500">{k}</p>
        <p className="text-sm font-bold text-slate-200">{v}</p>
    </div>
);
