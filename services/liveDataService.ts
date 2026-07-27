import { DashboardData, Game, AnalyzedGameDB, TopPickItem, League, Country, GameDetails } from '../types';
import { getCurrentDateInBogota, getLocalDayRange, utcToBogotaDate } from '../utils/dateUtils';
import { supabase } from './supabaseService';

// --- CONSTANTES ---
const IMPORTANT_LEAGUES_IDS = [
    2, 3, 39, 140, 135, 78, 61, 71, 128, 239, 13, 11
];

/**
 * Función genérica para llamar a la Edge Function 'football-data-proxy'.
 * Esta función ya no maneja claves API; la seguridad está en el servidor.
 */
const callProxy = async <T>(endpoint: string, params: any = {}): Promise<T> => {
    const { data, error } = await supabase.functions.invoke('football-data-proxy', {
        body: { endpoint, ...params }
    });

    if (error) {
        console.error(`Error invocando football-data-proxy para ${endpoint}:`, error);
        throw new Error(error.message || 'Error de conexión con el servidor de datos.');
    }

    return data as T;
};

// --- PROCESAMIENTO DE DATOS (Se mantiene igual para estructurar la UI) ---

const processFixturesResponse = (response: Game[]): DashboardData => {
    if (!response || response.length === 0) return { importantLeagues: [], countryLeagues: [] };

    const leaguesMap: { [id: number]: League } = {};
    for (const game of response) {
        if (!leaguesMap[game.league.id]) {
            leaguesMap[game.league.id] = { ...game.league, games: [] };
        }
        // Deduplicate games based on fixture ID
        const existingGame = leaguesMap[game.league.id].games.find(g => g.fixture.id === game.fixture.id);
        if (!existingGame) {
            leaguesMap[game.league.id].games.push(game);
        }
    }

    const allLeagues = Object.values(leaguesMap);
    const importantLeagues = allLeagues.filter(l => IMPORTANT_LEAGUES_IDS.includes(l.id));
    const otherLeagues = allLeagues.filter(l => !IMPORTANT_LEAGUES_IDS.includes(l.id));

    const countryMap: { [name: string]: Country } = {};
    otherLeagues.forEach(league => {
        const countryName = league.country || 'Internacional';
        if (!countryMap[countryName]) countryMap[countryName] = { name: countryName, flag: league.logo, leagues: [] };
        countryMap[countryName].leagues.push(league);
    });

    const countryLeagues = Object.values(countryMap).sort((a, b) => a.name.localeCompare(b.name));

    return { importantLeagues, countryLeagues };
};

// --- FUNCIONES EXPORTADAS ---

// --- FUNCIONES EXPORTADAS ---

// Convierte filas planas de `daily_matches` a la estructura anidada `Game` que
// espera la UI. Se usa como RESPALDO cuando el listado en vivo de SportMonks viene
// vacío (p. ej. la API key guardada en Supabase está degradada). Así los partidos
// que sí importamos a `daily_matches` siguen apareciendo en la pestaña Partidos.
const dailyMatchesToGames = (rows: any[]): Game[] => (rows || []).map(m => ({
    fixture: {
        id: m.api_fixture_id,
        date: m.match_time,
        status: { short: m.match_status || 'NS', long: '', elapsed: null },
        venue: { id: null, name: '', city: '' },
        referee: null,
        period: { first: null, second: null },
        timestamp: m.match_time ? new Date(m.match_time).getTime() / 1000 : 0,
        timezone: 'UTC'
    },
    league: {
        id: m.league_id ?? 0,
        name: m.league_name || 'Liga',
        country: '',
        logo: '',
        flag: '',
        season: new Date().getFullYear(),
        round: ''
    },
    teams: {
        home: { id: 0, name: m.home_team, logo: m.home_team_logo, winner: null },
        away: { id: 0, name: m.away_team, logo: m.away_team_logo, winner: null }
    },
    goals: { home: m.home_score ?? null, away: m.away_score ?? null },
    score: { halftime: { home: null, away: null }, fulltime: { home: null, away: null }, extratime: { home: null, away: null }, penalty: { home: null, away: null } }
})) as Game[];

// Respaldo desde `daily_matches` para una fecha concreta.
const fetchFixturesFromDailyMatches = async (date: string): Promise<DashboardData> => {
    const { data: rows, error } = await supabase
        .from('daily_matches')
        .select('*')
        .eq('match_date', date);
    if (error || !rows || rows.length === 0) {
        console.log(`[DEBUG] daily_matches fallback: 0 partidos para ${date}`);
        return { importantLeagues: [], countryLeagues: [] };
    }
    console.log(`[DEBUG] daily_matches fallback: usando ${rows.length} partidos locales para ${date}`);
    return processFixturesResponse(dailyMatchesToGames(rows));
};

export const fetchFixturesByDate = async (date: string): Promise<DashboardData> => {
    console.log(`[DEBUG] fetchFixturesByDate (SportMonks) called for: ${date}`);
    try {
        // Llamada directa a la nueva función de listado SportMonks
        const { data, error } = await supabase.functions.invoke('v2-list-fixtures-sportmonks', {
            body: { date }
        });

        if (error) {
            console.error('[DEBUG] Error invocando v2-list-fixtures-sportmonks:', error);
            // No abortamos: intentamos el respaldo local antes de fallar.
            const fallback = await fetchFixturesFromDailyMatches(date);
            if (fallback.importantLeagues.length || fallback.countryLeagues.length) return fallback;
            throw new Error(error.message || 'Error fetching fixtures from SportMonks');
        }

        console.log(`[DEBUG] SportMonks returned ${data?.length} fixtures for ${date}`);

        // Safety net: filter fixtures to match the requested Bogotá date
        // The edge function already does this, but we double-check in case of edge cases
        const filteredData = (data || []).filter((g: any) => {
            if (!g.fixture?.date) return true;
            try {
                return utcToBogotaDate(g.fixture.date) === date;
            } catch {
                return true; // keep if date parsing fails
            }
        });

        if (filteredData.length !== (data || []).length) {
            console.warn(`[DEBUG] Frontend Bogotá filter removed ${(data || []).length - filteredData.length} fixtures from wrong date`);
        }

        // Si SportMonks no devuelve nada (key degradada / sin cobertura), usamos el
        // respaldo local de daily_matches para no dejar la pestaña Partidos vacía.
        if (filteredData.length === 0) {
            console.warn('[DEBUG] SportMonks devolvió 0 partidos — usando respaldo daily_matches');
            return await fetchFixturesFromDailyMatches(date);
        }

        const processed = processFixturesResponse(filteredData);
        console.log(`[DEBUG] Processed data:`, processed);
        return processed;

    } catch (e) {
        console.error(`[DEBUG] Error in fetchFixturesByDate:`, e);
        // Último intento: respaldo local antes de propagar el error a la UI.
        try {
            const fallback = await fetchFixturesFromDailyMatches(date);
            if (fallback.importantLeagues.length || fallback.countryLeagues.length) return fallback;
        } catch { /* ignora */ }
        throw e;
    }
};

export const fetchFixturesByRange = async (from: string, to: string): Promise<DashboardData> => {
    // TODO: Implementar rango en SportMonks si es necesario. Por ahora un loop simple.
    // OJO: SportMonks API es rápida, pero loops pueden ser lentos.
    try {
        console.log(`[DEBUG] fetchFixturesByRange (SportMonks) called for: ${from} to ${to}`);
        // Iterar días (solución temporal rápida)
        const start = new Date(from);
        const end = new Date(to);
        const allGames: Game[] = [];

        for (let d = start; d <= end; d.setDate(d.getDate() + 1)) {
            const dateStr = d.toISOString().split('T')[0];
            const { data } = await supabase.functions.invoke('v2-list-fixtures-sportmonks', {
                body: { date: dateStr }
            });
            if (data) allGames.push(...data);
        }

        return processFixturesResponse(allGames);
    } catch (e) {
        console.error(`[DEBUG] Error in fetchFixturesByRange:`, e);
        throw e;
    }
};

export const fetchLiveFixtures = async (): Promise<DashboardData> => {
    const data = await callProxy<Game[]>('fixtures', { live: 'all' });
    return processFixturesResponse(data);
};

export const fetchFixturesList = async (ids: number[]): Promise<Game[]> => {
    if (ids.length === 0) return [];
    // API-Sports supports max 20 IDs usually, but reducing to 10 to avoid Edge Function timeouts.
    const chunks = [];
    for (let i = 0; i < ids.length; i += 10) {
        chunks.push(ids.slice(i, i + 10));
    }

    const results: Game[] = [];
    for (const chunk of chunks) {
        const idsStr = chunk.join('-');
        try {
            const data = await callProxy<Game[]>('fixtures', { ids: idsStr });
            if (data && Array.isArray(data)) {
                results.push(...data);
            }
        } catch (e) {
            console.error(`Error fetching chunk ${idsStr}:`, e);
        }
    }
    return results;
};

export const fetchGameDetails = async (game: Game): Promise<GameDetails> => {
    const fixtureId = game.fixture.id;
    const isFinished = ['FT', 'AET', 'PEN'].includes(game.fixture.status.short);

    // 1. Intentar caché local primero si el partido terminó
    if (isFinished) {
        const { data: cachedData } = await supabase
            .from('partido_detalles_cache')
            .select('dossier')
            .eq('fixture_id', fixtureId)
            .single();

        if (cachedData) return cachedData.dossier as GameDetails;
    }

    // 2. Pedir al Proxy (Ahora actualizado a endpoint v2-get-fixture-details-sportmonks)
    // Usamos la nueva Edge Function específica que normaliza IDs de SportMonks al formato legado
    try {
        const { data, error } = await supabase.functions.invoke('v2-get-fixture-details-sportmonks', {
            body: { fixtureId }
        });

        if (error) {
            console.error('[fetchGameDetails] Error invocation:', error);
            throw new Error(error.message || 'Error fetching details from SportMonks');
        }

        const dossier = data as GameDetails;

        // 3. Guardar en caché si terminó
        if (isFinished && dossier) {
            await supabase.from('partido_detalles_cache').upsert({
                fixture_id: fixtureId,
                dossier: dossier as any,
                last_updated: new Date().toISOString(),
            }, { onConflict: 'fixture_id' });
        }

        return dossier;
    } catch (e: any) {
        console.error('[fetchGameDetails] Fallback failed:', e);
        // Retornar objeto vacío o lanzar error - mejor lanzar para que UI muestre error
        throw e;
    }
};

export const fetchTopPicks = async (date: string) => {
    try {
        console.log(`[TopPicks] Fetching for date: ${date}`);
        const { supabase } = await import('./supabaseService');

        let games: Game[] = [];

        // 1. ESTRATEGIA DB-FIRST: Consultar daily_matches (Nuestra Fuente de Verdad)
        // FIX: Usar match_date (DATE) en vez de match_time (TIMESTAMPTZ) para evitar timezone mismatch
        const { data: localMatches, error: localError } = await supabase
            .from('daily_matches')
            .select('*')
            .eq('match_date', date);

        if (localMatches && localMatches.length > 0) {
            console.log(`[TopPicks] ✅ Usando ${localMatches.length} partidos de daily_matches (DB Local)`);

            // Convertir formato plano de daily_matches a estructura anidada Game
            games = localMatches.map(m => ({
                fixture: {
                    id: m.api_fixture_id,
                    date: m.match_time,
                    status: { short: m.match_status || 'NS', long: '', elapsed: null },
                    venue: { id: null, name: '', city: '' }, // id: null agregado para cumplir interfaz
                    referee: null,
                    period: { first: null, second: null },
                    timestamp: new Date(m.match_time).getTime() / 1000,
                    timezone: 'UTC'
                },
                league: {
                    id: m.league_id,
                    name: m.league_name,
                    country: '',
                    logo: '',
                    flag: '',
                    season: new Date().getFullYear(),
                    round: ''
                },
                teams: {
                    home: { id: 0, name: m.home_team, logo: m.home_team_logo, winner: null },
                    away: { id: 0, name: m.away_team, logo: m.away_team_logo, winner: null }
                },
                goals: { home: m.home_score, away: m.away_score },
                score: { halftime: { home: null, away: null }, fulltime: { home: null, away: null }, extratime: { home: null, away: null }, penalty: { home: null, away: null } }
            }));

        } else {
            console.log('[TopPicks] ⚠️ No hay datos locales, intentando API externa (Fallback)...');
            // 2. Fallback: API Externa (comportamiento original)
            const allFixtures = await fetchFixturesByDate(date);
            games = [
                ...allFixtures.importantLeagues.flatMap(l => l.games),
                ...allFixtures.countryLeagues.flatMap(c => c.leagues.flatMap(l => l.games))
            ];
        }

        const fixtureIds = games.map(g => g.fixture.id);
        console.log(`[TopPicks] Found ${games.length} games to check. IDs sample:`, fixtureIds.slice(0, 5));

        if (fixtureIds.length === 0) return [];

        // ═══════════════════════════════════════════════════════════════
        // ESTRATEGIA V2 PRIMERO: Buscar en analysis_jobs_v2 + value_picks_v2
        // ═══════════════════════════════════════════════════════════════
        const { data: v2Jobs } = await supabase
            .from('analysis_jobs_v2')
            .select('id, fixture_id, created_at')
            .in('fixture_id', fixtureIds)
            .eq('status', 'done')
            .or('analysis_type.eq.standard,analysis_type.is.null');

        if (v2Jobs && v2Jobs.length > 0) {
            console.log(`[TopPicks] ✅ V2: Encontrados ${v2Jobs.length} jobs V2`);

            // ═══════════════════════════════════════════════════════════════
            // FIX: Solo el job MÁS RECIENTE por fixture (evita duplicados)
            // ═══════════════════════════════════════════════════════════════
            const latestJobByFixture = new Map<number, any>();
            for (const job of v2Jobs) {
                const existing = latestJobByFixture.get(job.fixture_id);
                if (!existing || new Date(job.created_at) > new Date(existing.created_at)) {
                    latestJobByFixture.set(job.fixture_id, job);
                }
            }
            const latestJobIds = Array.from(latestJobByFixture.values()).map((j: any) => j.id);
            console.log(`[TopPicks] V2: Filtrado a ${latestJobIds.length} jobs (más recientes por fixture)`);

            // Obtener value_picks_v2 con BET o WATCH con alta probabilidad
            const { data: v2Picks } = await supabase
                .from('value_picks_v2')
                .select('*')
                .in('job_id', latestJobIds)
                .in('decision', ['BET', 'WATCH'])
                .gte('p_model', 0.50)  // Solo picks con >50% probabilidad
                .order('p_model', { ascending: false });

            if (v2Picks && v2Picks.length > 0) {
                console.log(`[TopPicks] ✅ V2: Encontrados ${v2Picks.length} picks con >50% prob`);

                // Mapear v2JobId -> fixtureId
                const jobToFixture = new Map<string, number>();
                v2Jobs.forEach((j: any) => jobToFixture.set(j.id, j.fixture_id));

                // ═══════════════════════════════════════════════════════════════
                // DICCIONARIO DE TRADUCCIÓN DE MERCADOS (del inglés al español)
                // ═══════════════════════════════════════════════════════════════
                const MARKET_TRANSLATIONS: Record<string, string> = {
                    // BTTS
                    'btts_yes': 'Ambos Equipos Anotan: Sí',
                    'btts_no': 'Ambos Equipos Anotan: No',
                    'btts yes': 'Ambos Equipos Anotan: Sí',
                    'btts no': 'Ambos Equipos Anotan: No',
                    // Goles Over/Under
                    'over_0.5_goals': 'Más de 0.5 Goles',
                    'over_1.5_goals': 'Más de 1.5 Goles',
                    'over_2.5_goals': 'Más de 2.5 Goles',
                    'over_3.5_goals': 'Más de 3.5 Goles',
                    'over_4.5_goals': 'Más de 4.5 Goles',
                    'over_5.5_goals': 'Más de 5.5 Goles',
                    'under_0.5_goals': 'Menos de 0.5 Goles',
                    'under_1.5_goals': 'Menos de 1.5 Goles',
                    'under_2.5_goals': 'Menos de 2.5 Goles',
                    'under_3.5_goals': 'Menos de 3.5 Goles',
                    // 1X2
                    'home_win': 'Victoria Local',
                    'away_win': 'Victoria Visitante',
                    'draw': 'Empate',
                    '1x2_home': 'Victoria Local',
                    '1x2_away': 'Victoria Visitante',
                    '1x2_draw': 'Empate',
                    // Doble Oportunidad
                    'double_chance_1x': 'Doble Oportunidad 1X',
                    'double_chance_x2': 'Doble Oportunidad X2',
                    'double_chance_12': 'Doble Oportunidad 12',
                    // Goles por Equipo
                    'home_over_0.5': 'Local Anota +0.5',
                    'home_over_1.5': 'Local Anota +1.5',
                    'away_over_0.5': 'Visitante Anota +0.5',
                    'away_over_1.5': 'Visitante Anota +1.5',
                    // Handicaps
                    'handicap_home_-0.5': 'Handicap Local -0.5',
                    'handicap_home_-1.5': 'Handicap Local -1.5',
                    'handicap_away_+0.5': 'Handicap Visitante +0.5',
                    'handicap_away_+1.5': 'Handicap Visitante +1.5',
                    // Corners
                    'corners_over_8.5': 'Más de 8.5 Corners',
                    'corners_over_10.5': 'Más de 10.5 Corners',
                    'corners_over_12.5': 'Más de 12.5 Corners',
                    // Tarjetas
                    'cards_over_3.5': 'Más de 3.5 Tarjetas',
                    'cards_over_4.5': 'Más de 4.5 Tarjetas',
                    'cards_over_5.5': 'Más de 5.5 Tarjetas',
                    // Marcador Exacto
                    'correct_score_0_0': 'Marcador Exacto 0-0',
                    // FASE 1: Primer Tiempo (1T)
                    '1t_over_0.5': '1T Más de 0.5 Goles',
                    '1t_over_1.5': '1T Más de 1.5 Goles',
                    // FASE 1: Segundo Tiempo (2T)
                    '2t_over_0.5': '2T Más de 0.5 Goles',
                    '2t_over_1.5': '2T Más de 1.5 Goles',
                };

                const translateMarket = (market: string): string => {
                    const key = market.toLowerCase().replace(/\s+/g, '_').replace(/\./g, '.');
                    if (MARKET_TRANSLATIONS[key]) return MARKET_TRANSLATIONS[key];
                    // Fallback: normalizar el market
                    return market
                        .replace(/_/g, ' ')
                        .replace('over', 'Más de')
                        .replace('under', 'Menos de')
                        .replace('goals', 'Goles')
                        .replace('btts', 'Ambos Anotan')
                        .replace('yes', 'Sí')
                        .replace('no', 'No');
                };

                // ═══════════════════════════════════════════════════════════════
                // TRADUCCIÓN CON NOMBRES DE EQUIPOS (para mostrar en UI)
                // ═══════════════════════════════════════════════════════════════
                const translateMarketWithTeams = (market: string, selection: string, homeTeam: string, awayTeam: string): { market: string, selection: string } => {
                    const m = market.toLowerCase();

                    // ═══════════════════════════════════════════════════════════════
                    // GOLES TOTALES (over_X.X_goals) - COMPLETO EN ESPAÑOL
                    // ═══════════════════════════════════════════════════════════════
                    if (m.includes('over_') && m.includes('_goals')) {
                        const match = m.match(/over_(\d+\.?\d*)_goals/);
                        if (match) {
                            return {
                                market: 'Goles Totales',
                                selection: `Más de ${match[1]} Goles`
                            };
                        }
                    }
                    if (m.includes('under_') && m.includes('_goals')) {
                        const match = m.match(/under_(\d+\.?\d*)_goals/);
                        if (match) {
                            return {
                                market: 'Goles Totales',
                                selection: `Menos de ${match[1]} Goles`
                            };
                        }
                    }

                    // ═══════════════════════════════════════════════════════════════
                    // PRIMER TIEMPO (1T) - COMPLETO EN ESPAÑOL
                    // ═══════════════════════════════════════════════════════════════
                    if (m.includes('1t_over_')) {
                        const match = m.match(/1t_over_(\d+\.?\d*)/);
                        if (match) {
                            return {
                                market: 'Goles 1er Tiempo',
                                selection: `Más de ${match[1]} Goles`
                            };
                        }
                    }

                    // ═══════════════════════════════════════════════════════════════
                    // SEGUNDO TIEMPO (2T) - COMPLETO EN ESPAÑOL
                    // ═══════════════════════════════════════════════════════════════
                    if (m.includes('2t_over_')) {
                        const match = m.match(/2t_over_(\d+\.?\d*)/);
                        if (match) {
                            return {
                                market: 'Goles 2do Tiempo',
                                selection: `Más de ${match[1]} Goles`
                            };
                        }
                    }

                    // ═══════════════════════════════════════════════════════════════
                    // BTTS - AMBOS EQUIPOS ANOTAN
                    // ═══════════════════════════════════════════════════════════════
                    if (m === 'btts_yes' || m === 'btts yes') {
                        return {
                            market: 'Ambos Equipos Anotan',
                            selection: 'Sí'
                        };
                    }
                    if (m === 'btts_no' || m === 'btts no') {
                        return {
                            market: 'Ambos Equipos Anotan',
                            selection: 'No'
                        };
                    }

                    // ═══════════════════════════════════════════════════════════════
                    // 1X2 con nombres de equipos
                    // ═══════════════════════════════════════════════════════════════
                    if (m === '1x2_home' || m === 'home_win') {
                        return {
                            market: 'Resultado Final',
                            selection: `Gana ${homeTeam}`
                        };
                    }
                    if (m === '1x2_away' || m === 'away_win') {
                        return {
                            market: 'Resultado Final',
                            selection: `Gana ${awayTeam}`
                        };
                    }
                    if (m === '1x2_draw' || m === 'draw') {
                        return {
                            market: 'Resultado Final',
                            selection: 'Empate'
                        };
                    }

                    // ═══════════════════════════════════════════════════════════════
                    // Doble Oportunidad con nombres
                    // ═══════════════════════════════════════════════════════════════
                    if (m === 'double_chance_1x') {
                        return {
                            market: 'Doble Oportunidad',
                            selection: `${homeTeam} o Empate`
                        };
                    }
                    if (m === 'double_chance_x2') {
                        return {
                            market: 'Doble Oportunidad',
                            selection: `${awayTeam} o Empate`
                        };
                    }
                    if (m === 'double_chance_12') {
                        return {
                            market: 'Doble Oportunidad',
                            selection: `${homeTeam} o ${awayTeam}`
                        };
                    }

                    // ═══════════════════════════════════════════════════════════════
                    // Goles por equipo con nombres
                    // ═══════════════════════════════════════════════════════════════
                    if (m.startsWith('home_over_')) {
                        const match = m.match(/home_over_(\d+\.?\d*)/);
                        if (match) {
                            return {
                                market: `Goles ${homeTeam}`,
                                selection: `Más de ${match[1]}`
                            };
                        }
                    }
                    if (m.startsWith('away_over_')) {
                        const match = m.match(/away_over_(\d+\.?\d*)/);
                        if (match) {
                            return {
                                market: `Goles ${awayTeam}`,
                                selection: `Más de ${match[1]}`
                            };
                        }
                    }

                    // ═══════════════════════════════════════════════════════════════
                    // Handicaps con nombres
                    // ═══════════════════════════════════════════════════════════════
                    if (m.includes('handicap_home')) {
                        const handicap = m.replace('handicap_home_', '');
                        return {
                            market: 'Handicap',
                            selection: `${homeTeam} (${handicap})`
                        };
                    }
                    if (m.includes('handicap_away')) {
                        const handicap = m.replace('handicap_away_', '');
                        return {
                            market: 'Handicap',
                            selection: `${awayTeam} (${handicap})`
                        };
                    }

                    // ═══════════════════════════════════════════════════════════════
                    // Corners - EN ESPAÑOL
                    // ═══════════════════════════════════════════════════════════════
                    if (m.includes('corners_over_')) {
                        const match = m.match(/corners_over_(\d+\.?\d*)/);
                        if (match) {
                            return {
                                market: 'Corners',
                                selection: `Más de ${match[1]}`
                            };
                        }
                    }

                    // ═══════════════════════════════════════════════════════════════
                    // Tarjetas - EN ESPAÑOL
                    // ═══════════════════════════════════════════════════════════════
                    if (m.includes('cards_over_')) {
                        const match = m.match(/cards_over_(\d+\.?\d*)/);
                        if (match) {
                            return {
                                market: 'Tarjetas',
                                selection: `Más de ${match[1]}`
                            };
                        }
                    }

                    // ═══════════════════════════════════════════════════════════════
                    // Mercados combinados (ya tienen formato legible)
                    // ═══════════════════════════════════════════════════════════════
                    if (m.startsWith('combined_')) {
                        // El selection ya viene formateado como "Local o Empate + Más de 1.5 Goles"
                        // Reemplazar "Local" y "Visitante" con nombres reales
                        let readableSelection = selection
                            .replace('Local', homeTeam)
                            .replace('Visitante', awayTeam)
                            .replace('Victoria Local', `Gana ${homeTeam}`)
                            .replace('Victoria Visitante', `Gana ${awayTeam}`);
                        return {
                            market: 'Combinado',
                            selection: readableSelection
                        };
                    }

                    // ═══════════════════════════════════════════════════════════════
                    // Default: usar traducción estándar
                    // ═══════════════════════════════════════════════════════════════
                    return {
                        market: translateMarket(market),
                        selection: translateSelection(selection)
                    };
                };

                const translateSelection = (selection: string): string => {
                    const lower = selection.toLowerCase();
                    if (lower === 'yes' || lower === 'sí') return 'Sí';
                    if (lower === 'no') return 'No';
                    if (lower === 'over') return 'Más';
                    if (lower === 'under') return 'Menos';
                    if (lower === '1' || lower === 'home') return 'Local';
                    if (lower === '2' || lower === 'away') return 'Visitante';
                    if (lower === 'x' || lower === 'draw') return 'Empate';
                    return selection;
                };

                // ═══════════════════════════════════════════════════════════════
                // FASE 1: Agrupar picks por fixture para encontrar alternativas
                // ═══════════════════════════════════════════════════════════════
                const picksByFixture = new Map<number, any[]>();
                for (const pick of v2Picks) {
                    const fixtureId = jobToFixture.get(pick.job_id);
                    if (!fixtureId) continue;
                    if (!picksByFixture.has(fixtureId)) {
                        picksByFixture.set(fixtureId, []);
                    }
                    picksByFixture.get(fixtureId)!.push(pick);
                }

                const topPicks: TopPickItem[] = [];

                // ═══════════════════════════════════════════════════════════════
                // FASE 2: Procesar cada fixture
                // ═══════════════════════════════════════════════════════════════
                for (const [fixtureId, fixturePicks] of picksByFixture.entries()) {
                    const game = games.find(g => g.fixture.id === fixtureId);
                    if (!game) continue;

                    // Clasificar picks por tipo de mercado para encontrar alternativas
                    const goalLines = fixturePicks.filter(p =>
                        p.market?.includes('over_') && p.market?.includes('goals')
                    ).sort((a, b) => b.p_model - a.p_model);

                    for (const pick of fixturePicks) {
                        const prob = pick.p_model * 100;

                        // Ignorar prob < 60% (muy baja)
                        if (prob < 60) continue;

                        // ═══════════════════════════════════════════════════════════════
                        // SINCRONIZACIÓN: Solo mostrar picks con decision='BET'
                        // Esto asegura que Oportunidades muestre lo mismo que el Informe
                        // ═══════════════════════════════════════════════════════════════
                        if (pick.decision !== 'BET') continue;

                        // Determinar confidence
                        const confidence: 'Alta' | 'Media' | 'Baja' = prob >= 80 ? 'Alta' : prob >= 60 ? 'Media' : 'Baja';

                        // Buscar alternativa si es línea de goles y hay una opción más segura
                        let alternative: { market: string; probability: number } | undefined = undefined;
                        if (pick.market?.includes('goals')) {
                            const saferLine = goalLines.find(p =>
                                p.p_model > pick.p_model && p.p_model <= 0.92 && p.market !== pick.market
                            );
                            if (saferLine) {
                                alternative = {
                                    market: translateMarket(saferLine.market),
                                    probability: Math.round(saferLine.p_model * 100)
                                };
                            }
                        }

                        topPicks.push({
                            gameId: fixtureId,
                            analysisRunId: pick.job_id,
                            matchup: `${game.teams.home.name} vs ${game.teams.away.name}`,
                            date: game.fixture.date,
                            league: game.league.name,
                            teams: {
                                home: { name: game.teams.home.name, logo: game.teams.home.logo },
                                away: { name: game.teams.away.name, logo: game.teams.away.logo }
                            },
                            bestRecommendation: (() => {
                                // Usar traducción con nombres de equipos
                                const translated = translateMarketWithTeams(
                                    pick.market || '',
                                    pick.selection || '',
                                    game.teams.home.name,
                                    game.teams.away.name
                                );
                                return {
                                    market: translated.market,
                                    prediction: translated.selection,
                                    probability: Math.round(prob),
                                    confidence: confidence,
                                    reasoning: pick.rationale || `Probabilidad: ${Math.round(prob)}%`
                                };
                            })(),
                            result: 'Pending',
                            odds: undefined,
                            alternative: alternative
                        });
                    }
                }

                console.log(`[TopPicks] V2: Total picks 60-92%: ${topPicks.length}`);

                // Si encontramos picks V2, retornarlos ordenados por probabilidad
                if (topPicks.length > 0) {
                    return topPicks.sort((a, b) =>
                        (b.bestRecommendation.probability || 0) - (a.bestRecommendation.probability || 0)
                    );
                }
            }
        }

        console.log('[TopPicks] ⚠️ Sin picks V2 válidos, buscando en V1...');

        // ═══════════════════════════════════════════════════════════════
        // FALLBACK V1: Estrategia Jobs -> Runs -> Predictions
        // ═══════════════════════════════════════════════════════════════

        // A) Obtener Jobs exitosos recientes para estos partidos
        let { data: jobs, error: jobError } = await supabase
            .from('analysis_jobs')
            .select('id, api_fixture_id, created_at')
            .in('api_fixture_id', fixtureIds)
            .eq('status', 'done')
            .order('created_at', { ascending: false });

        if (jobError) throw jobError;

        // FALLBACK ROBUSTO: Si no encontramos jobs por fixture IDs de daily_matches,
        // buscar jobs creados HOY que estén 'done' (para cubrir desincronización)
        if (!jobs || jobs.length < 3) {
            console.log('[TopPicks] ⚠️ Pocos jobs por fixture IDs, buscando por fecha de creación...');

            // FIX: Use timezone-aware UTC range for Bogotá day
            // Bogotá 00:00 = UTC 05:00, Bogotá 23:59 = next day UTC 04:59
            const nextDay = new Date(date + 'T12:00:00Z');
            nextDay.setUTCDate(nextDay.getUTCDate() + 1);
            const nextDayStr = nextDay.toISOString().split('T')[0];

            const { data: jobsByDate } = await supabase
                .from('analysis_jobs')
                .select('id, api_fixture_id, created_at')
                .eq('status', 'done')
                .gte('created_at', `${date}T05:00:00+00:00`)
                .lt('created_at', `${nextDayStr}T05:00:00+00:00`)
                .order('created_at', { ascending: false });

            if (jobsByDate && jobsByDate.length > (jobs?.length || 0)) {
                console.log(`[TopPicks] ✅ Encontrados ${jobsByDate.length} jobs por created_at (fallback)`);
                jobs = jobsByDate;

                // Re-construir games a partir de los jobs encontrados (datos mínimos)
                const additionalFixtureIds = jobsByDate
                    .map(j => j.api_fixture_id)
                    .filter(fid => !fixtureIds.includes(fid));

                if (additionalFixtureIds.length > 0) {
                    console.log(`[TopPicks] Agregando ${additionalFixtureIds.length} fixtures adicionales al pool`);
                    fixtureIds.push(...additionalFixtureIds);
                }
            }
        }

        // B) Filtrar para quedarse solo con el ÚLTIMO Job ID por fixture
        const latestJobIdByFixture = new Map<number, string>();
        jobs?.forEach((job: any) => {
            const fid = Number(job.api_fixture_id);
            if (!latestJobIdByFixture.has(fid)) {
                latestJobIdByFixture.set(fid, job.id);
            }
        });

        const validJobIds = Array.from(latestJobIdByFixture.values());

        if (validJobIds.length === 0) {
            console.log('[TopPicks] 0 Jobs encontrados para estos partidos.');
            return [];
        }

        // C) Obtener los Run IDs asociados a esos Jobs únicos
        const { data: runs, error: runError } = await supabase
            .from('analysis_runs')
            .select('id, job_id')
            .in('job_id', validJobIds);

        if (runError) throw runError;

        const validRunIds = runs?.map((r: any) => r.id) || [];

        if (validRunIds.length === 0) {
            console.log('[TopPicks] 0 Runs encontrados para estos Jobs.');
            return [];
        }

        console.log(`[TopPicks] Found ${validJobIds.length} unique jobs -> ${validRunIds.length} valid runs.`);

        // 4. Obtener Predicciones de esos Runs UNICOS
        const { data: predictions, error } = await supabase
            .from('predictions')
            .select('*')
            .in('analysis_run_id', validRunIds)
            .order('probability', { ascending: false });

        if (error) throw error;

        console.log(`[TopPicks] Predictions found: ${predictions?.length || 0}`);

        // 5. Cruzar datos (Join en memoria)
        const topPicks: TopPickItem[] = [];

        predictions?.forEach((pred: any) => {
            const game = games.find(g => g.fixture.id === pred.fixture_id);
            if (!game) return;

            topPicks.push({
                gameId: pred.fixture_id,
                analysisRunId: pred.analysis_run_id,
                matchup: `${game.teams.home.name} vs ${game.teams.away.name}`,
                date: game.fixture.date,
                league: game.league.name,
                teams: {
                    home: { name: game.teams.home.name, logo: game.teams.home.logo },
                    away: { name: game.teams.away.name, logo: game.teams.away.logo }
                },
                bestRecommendation: {
                    market: pred.market,
                    prediction: pred.selection,
                    probability: pred.probability,
                    confidence: pred.confidence,
                    reasoning: pred.reasoning
                },
                result: pred.is_won === true ? 'Won' : (pred.is_won === false ? 'Lost' : 'Pending'),
                odds: pred.odds // Mapped from DB
            });
        });

        // Ordenar por probabilidad descendente
        return topPicks.sort((a: any, b: any) => (b.bestRecommendation.probability || 0) - (a.bestRecommendation.probability || 0));

    } catch (error: any) {
        console.error('Error al obtener Top Picks:', error.message);
        return [];
    }
};
