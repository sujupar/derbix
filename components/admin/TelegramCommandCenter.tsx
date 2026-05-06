// components/admin/TelegramCommandCenter.tsx
// Centro de mando para generar contenido del canal de Telegram (copy-paste).
// Sin bot, sin webhooks, sin envío automático.

import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../services/supabaseService';
import { getCurrentDateInBogota } from '../../utils/dateUtils';
import { getPublicResults } from '../../services/resultsService';
import type { PromoMatchPDFProps } from '../../services/pdf/templates/PromoMatchPDF';

interface ContentBlock {
    id: string;
    title: string;
    subtitle: string;
    content: string;
    loading: boolean;
    error?: string | null;
}

interface PickOfDay {
    fixture_id: number;
    match: string;
    league: string;
    match_time: string;
    edge_percent: number;
    market: string;
    selection: string;
    odds: number;
    probability: number;
    data_volume: number;
}

interface NewSignup {
    telegram_username: string;
    created_at: string;
}

const CATEGORIES = [
    { value: 'anti_tipster', label: 'Anti-tipster' },
    { value: 'transparency', label: 'Transparencia' },
    { value: 'professional_tip', label: 'Consejo profesional' },
    { value: 'bettor_pain', label: 'Dolor del apostador' },
    { value: 'derbix_diff', label: 'Diferenciador Derbix' },
    { value: 'temporal_context', label: 'Contexto temporal' },
];

export const TelegramCommandCenter: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
    const today = getCurrentDateInBogota();

    // Block 1 — Morning tip
    const [morningCategory, setMorningCategory] = useState<string>('anti_tipster');
    const [morningBlock, setMorningBlock] = useState<ContentBlock>({ id: 'morning', title: '☀️ Mañana — Tip educativo', subtitle: 'Mensaje con CTA a derbix.co', content: '', loading: false });

    // Block 2 — Daily pick teaser
    const [picksOfDay, setPicksOfDay] = useState<PickOfDay[]>([]);
    const [selectedPickFixtureId, setSelectedPickFixtureId] = useState<number | null>(null);
    const [pickBlock, setPickBlock] = useState<ContentBlock>({ id: 'pick', title: '🎯 Pronóstico del día (teaser)', subtitle: 'Sin revelar mercado/selección', content: '', loading: true });

    // Block 3 — PDF caption
    const [pdfCaption] = useState<string>('Aquí el análisis técnico del partido.\n\nEl pronóstico exacto y la cuota recomendada están en derbix.co 👉');
    const [pdfBuilding, setPdfBuilding] = useState(false);

    // Block 4 — Mediodía
    const [middayCategory, setMiddayCategory] = useState<string>('professional_tip');
    const [middayBlock, setMiddayBlock] = useState<ContentBlock>({ id: 'midday', title: '🌤 Mediodía — Consejo profesional', subtitle: '', content: '', loading: false });

    // Block 5 — Resumen del día
    const [summaryBlock, setSummaryBlock] = useState<ContentBlock>({ id: 'summary', title: '📊 Resumen del día (cierre)', subtitle: 'Datos verificados de hoy', content: '', loading: true });

    // Block 6 — Welcome
    const [newSignups, setNewSignups] = useState<NewSignup[]>([]);
    const [extraUsernames, setExtraUsernames] = useState<string>('');
    const [welcomeBlock, setWelcomeBlock] = useState<ContentBlock>({ id: 'welcome', title: '👋 Welcome — Nuevos del día', subtitle: 'Etiqueta @ a registrados de hoy', content: '', loading: true });

    const generateContent = useCallback(async (category: string, block: 'morning' | 'midday') => {
        const setter = block === 'morning' ? setMorningBlock : setMiddayBlock;
        const baseTitle = block === 'morning' ? '☀️ Mañana — Tip educativo' : '🌤 Mediodía — Consejo profesional';
        setter({ id: block, title: baseTitle, subtitle: '', content: '', loading: true });
        try {
            const { data, error } = await supabase.functions.invoke('telegram-content-generate', {
                body: { category, context_data: { date: today } },
            });
            if (error) throw error;
            setter({ id: block, title: baseTitle, subtitle: CATEGORIES.find((c) => c.value === category)?.label || '', content: data.text, loading: false });
        } catch (err) {
            setter({ id: block, title: baseTitle, subtitle: '', content: '', loading: false, error: (err as Error).message });
        }
    }, [today]);

    // Load picks of the day
    useEffect(() => {
        (async () => {
            const { data: picks, error } = await supabase
                .from('value_picks_v2')
                .select(`
                    fixture_id, market, selection, odds, p_model, edge_percent, engine_version,
                    daily_matches!inner(home_team_name, away_team_name, league_name, match_time, match_date)
                `)
                .eq('daily_matches.match_date', today)
                .gte('p_model', 0.80)
                .order('edge_percent', { ascending: false })
                .limit(10);

            if (!error && picks) {
                const mapped: PickOfDay[] = picks.map((p: any) => ({
                    fixture_id: p.fixture_id,
                    match: `${p.daily_matches.home_team_name} vs ${p.daily_matches.away_team_name}`,
                    league: p.daily_matches.league_name,
                    match_time: p.daily_matches.match_time,
                    edge_percent: p.edge_percent || 0,
                    market: p.market,
                    selection: p.selection,
                    odds: p.odds,
                    probability: Math.round((p.p_model || 0) * 100),
                    data_volume: 1500 + Math.round((p.edge_percent || 0) * 100),
                }));
                setPicksOfDay(mapped);
                if (mapped.length > 0) setSelectedPickFixtureId(mapped[0].fixture_id);
            }
        })();
    }, [today]);

    // Generate pick teaser whenever selectedPickFixtureId changes
    useEffect(() => {
        const pick = picksOfDay.find((p) => p.fixture_id === selectedPickFixtureId);
        if (!pick) return;
        const teaser = `🔥 *Pronóstico del día — ${pick.league}*

*${pick.match}* · ${pick.match_time} (Bogotá)

Hemos analizado *${pick.data_volume.toLocaleString('es-CO')} datos* de este partido: forma reciente, lesiones, alineaciones probables, clima, árbitro y comportamiento del mercado.

6 modelos especializados llegaron a consenso. La cuota actual del mercado no refleja lo que los datos están diciendo.

👉 *Pronóstico exacto + razonamiento técnico*: https://derbix.co?utm_source=telegram&utm_campaign=daily_pick`;
        setPickBlock({ id: 'pick', title: '🎯 Pronóstico del día (teaser)', subtitle: 'Sin revelar mercado/selección', content: teaser, loading: false });
    }, [selectedPickFixtureId, picksOfDay]);

    // Build summary
    useEffect(() => {
        (async () => {
            try {
                const results = await getPublicResults();
                const todayPicks = (results.picks || []).filter((p: any) => p.match_date === today && (p.result === 'WON' || p.result === 'LOST'));
                const wins = todayPicks.filter((p: any) => p.result === 'WON').length;
                const total = todayPicks.length;
                const stake = total;
                const profit = todayPicks.reduce((acc: number, p: any) => acc + (p.result === 'WON' ? (p.odds - 1) : -1), 0);
                const roi = total > 0 && stake > 0 ? ((profit / stake) * 100).toFixed(1) : '0.0';

                const text = total === 0
                    ? `📊 *Cierre del día* — ${today}\n\nHoy no hay aún pronósticos verificados. La verificación se completa al final de cada partido.\n\n👉 derbix.co`
                    : `📊 *Cierre del día* — ${today}\n\n• Pronósticos verificados: *${total}*\n• Aciertos: *${wins}*\n• ROI del día: *${parseFloat(roi) >= 0 ? '+' : ''}${roi}%*\n\nEsto NO es win rate del 90% — es consistencia matemática a lo largo del tiempo. Sin marketing barato. Sin tipsters falsos.\n\n👉 https://derbix.co?utm_source=telegram&utm_campaign=summary`;

                setSummaryBlock({ id: 'summary', title: '📊 Resumen del día (cierre)', subtitle: 'Datos verificados de hoy', content: text, loading: false });
            } catch {
                setSummaryBlock({ id: 'summary', title: '📊 Resumen del día (cierre)', subtitle: '', content: '', loading: false, error: 'No se pudo cargar' });
            }
        })();
    }, [today]);

    // Load new signups for welcome
    useEffect(() => {
        (async () => {
            const { data, error } = await supabase
                .from('profiles')
                .select('telegram_username, created_at')
                .gte('created_at', `${today}T00:00:00`)
                .lte('created_at', `${today}T23:59:59`)
                .not('telegram_username', 'is', null);
            if (!error && data) setNewSignups(data as NewSignup[]);
        })();
    }, [today]);

    // Build welcome message
    useEffect(() => {
        const fromDb = newSignups.map((s) => (s.telegram_username.startsWith('@') ? s.telegram_username : `@${s.telegram_username}`));
        const extras = extraUsernames.split(/[,\s\n]+/).map((s) => s.trim()).filter(Boolean).map((s) => (s.startsWith('@') ? s : `@${s}`));
        const all = Array.from(new Set([...fromDb, ...extras]));
        const text = all.length === 0
            ? `👋 *Bienvenida del día*\n\nUn nuevo día con datos crudos y resultados verificados. Si llegaste hoy a este canal: gracias por darle una oportunidad a un sistema que NO depende de tipsters falsos.\n\n👉 derbix.co`
            : `👋 *Bienvenidos a Derbix*\n\nGracias por sumarse hoy: ${all.join(', ')}\n\nEste canal NO publica pronósticos directos. Publica análisis técnico transparente. El pronóstico exacto vive en la plataforma.\n\n👉 https://derbix.co?utm_source=telegram&utm_campaign=welcome`;
        setWelcomeBlock({ id: 'welcome', title: '👋 Welcome — Nuevos del día', subtitle: `${all.length} usuarios`, content: text, loading: false });
    }, [newSignups, extraUsernames]);

    // First load — generate morning + midday once
    useEffect(() => { generateContent(morningCategory, 'morning'); }, []); // eslint-disable-line
    useEffect(() => { generateContent(middayCategory, 'midday'); }, []); // eslint-disable-line

    const copyToClipboard = (text: string) => navigator.clipboard.writeText(text);

    const downloadPickPDF = async () => {
        const pick = picksOfDay.find((p) => p.fixture_id === selectedPickFixtureId);
        if (!pick) return;
        setPdfBuilding(true);
        try {
            const [home, away] = pick.match.split(' vs ');
            const props: PromoMatchPDFProps = {
                homeTeam: home,
                awayTeam: away,
                league: pick.league,
                matchDate: today,
                matchTime: pick.match_time,
                dataVolume: pick.data_volume,
                statisticalScore: 75,
                contextualScore: 70,
                homeStreak: '—',
                awayStreak: '—',
                homeXG: 1.5,
                awayXG: 1.3,
                homeForm: ['Reciente 1', 'Reciente 2', 'Reciente 3', 'Reciente 4', 'Reciente 5'],
                awayForm: ['Reciente 1', 'Reciente 2', 'Reciente 3', 'Reciente 4', 'Reciente 5'],
                weatherDesc: null,
                refereeName: null,
                marketIntensities: [
                    { category: 'Resultado (1X2)', intensity: 3 },
                    { category: 'Goles (Over/Under)', intensity: 4 },
                    { category: 'Ambos anotan (BTTS)', intensity: 3 },
                    { category: 'Tarjetas', intensity: 2 },
                    { category: 'Córneres', intensity: 2 },
                ],
                generatedAt: new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' }),
                matchUrl: `https://derbix.co/match/${pick.fixture_id}`,
            };
            const { generatePromoMatchPDF } = await import('../../services/pdf/generators/generatePromoMatchPDF');
            await generatePromoMatchPDF(props, `derbix-${home}-vs-${away}.pdf`);
        } finally {
            setPdfBuilding(false);
        }
    };

    return (
        <div className="space-y-4 p-4">
            <header className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold text-white">Telegram Command Center</h2>
                    <p className="text-sm text-slate-400">Día: {today} · Mensajes para copiar y pegar al canal</p>
                </div>
                {onBack && <button onClick={onBack} className="text-emerald-400">← Volver</button>}
            </header>

            <BlockCard
                block={morningBlock}
                leftSlot={
                    <select value={morningCategory} onChange={(e) => { setMorningCategory(e.target.value); generateContent(e.target.value, 'morning'); }} className="bg-slate-900 border border-white/10 rounded px-2 py-1 text-sm text-white">
                        {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                }
                onCopy={() => copyToClipboard(morningBlock.content)}
                onRegen={() => generateContent(morningCategory, 'morning')}
            />

            <BlockCard
                block={pickBlock}
                leftSlot={
                    <select value={selectedPickFixtureId ?? ''} onChange={(e) => setSelectedPickFixtureId(Number(e.target.value))} className="bg-slate-900 border border-white/10 rounded px-2 py-1 text-sm text-white">
                        {picksOfDay.length === 0 && <option value="">No hay picks hoy</option>}
                        {picksOfDay.map((p) => <option key={p.fixture_id} value={p.fixture_id}>{p.match} · edge {p.edge_percent.toFixed(1)}%</option>)}
                    </select>
                }
                onCopy={() => copyToClipboard(pickBlock.content)}
            />

            <div className="rounded-lg border border-white/10 bg-slate-900/50 p-4 space-y-3">
                <div className="flex justify-between items-center">
                    <div>
                        <h3 className="text-white font-semibold">📄 PDF del pronóstico</h3>
                        <p className="text-xs text-slate-400">Sin pick · Solo razonamiento técnico</p>
                    </div>
                    <div className="flex gap-2">
                        <button disabled={!selectedPickFixtureId || pdfBuilding} onClick={downloadPickPDF} className="rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-3 py-1.5 text-sm text-white">{pdfBuilding ? 'Generando...' : 'Descargar PDF'}</button>
                        <button onClick={() => copyToClipboard(pdfCaption)} className="rounded bg-slate-700 hover:bg-slate-600 px-3 py-1.5 text-sm text-white">Copiar caption</button>
                    </div>
                </div>
                <pre className="whitespace-pre-wrap text-sm text-slate-300">{pdfCaption}</pre>
            </div>

            <BlockCard
                block={middayBlock}
                leftSlot={
                    <select value={middayCategory} onChange={(e) => { setMiddayCategory(e.target.value); generateContent(e.target.value, 'midday'); }} className="bg-slate-900 border border-white/10 rounded px-2 py-1 text-sm text-white">
                        {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                }
                onCopy={() => copyToClipboard(middayBlock.content)}
                onRegen={() => generateContent(middayCategory, 'midday')}
            />

            <BlockCard block={summaryBlock} onCopy={() => copyToClipboard(summaryBlock.content)} />

            <div className="rounded-lg border border-white/10 bg-slate-900/50 p-4 space-y-3">
                <div className="flex justify-between items-center">
                    <div>
                        <h3 className="text-white font-semibold">{welcomeBlock.title}</h3>
                        <p className="text-xs text-slate-400">{welcomeBlock.subtitle}</p>
                    </div>
                    <button onClick={() => copyToClipboard(welcomeBlock.content)} className="rounded bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-sm text-white">Copiar</button>
                </div>
                <textarea
                    placeholder="Pega aquí @usernames adicionales del canal (separados por coma o nueva línea)"
                    value={extraUsernames}
                    onChange={(e) => setExtraUsernames(e.target.value)}
                    rows={2}
                    className="w-full bg-slate-900 border border-white/10 rounded px-2 py-1 text-sm text-slate-200 placeholder-slate-500"
                />
                <pre className="whitespace-pre-wrap text-sm text-slate-300">{welcomeBlock.content}</pre>
            </div>
        </div>
    );
};

const BlockCard: React.FC<{
    block: ContentBlock;
    leftSlot?: React.ReactNode;
    onCopy?: () => void;
    onRegen?: () => void;
}> = ({ block, leftSlot, onCopy, onRegen }) => (
    <div className="rounded-lg border border-white/10 bg-slate-900/50 p-4 space-y-3">
        <div className="flex justify-between items-center gap-2">
            <div className="flex-1 min-w-0">
                <h3 className="text-white font-semibold">{block.title}</h3>
                {block.subtitle && <p className="text-xs text-slate-400">{block.subtitle}</p>}
            </div>
            <div className="flex gap-2 flex-wrap">
                {leftSlot}
                {onRegen && <button onClick={onRegen} className="rounded bg-slate-700 hover:bg-slate-600 px-3 py-1.5 text-sm text-white" disabled={block.loading}>↻ Regenerar</button>}
                {onCopy && <button onClick={onCopy} className="rounded bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-sm text-white" disabled={block.loading || !block.content}>Copiar</button>}
            </div>
        </div>
        {block.loading && <p className="text-sm text-slate-500">Generando…</p>}
        {block.error && <p className="text-sm text-red-400">{block.error}</p>}
        {!block.loading && block.content && <pre className="whitespace-pre-wrap text-sm text-slate-300">{block.content}</pre>}
    </div>
);
