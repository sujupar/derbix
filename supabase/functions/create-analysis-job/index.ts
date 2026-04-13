import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { GoogleGenerativeAI } from "https://esm.sh/@google/generative-ai"  // Kept for embeddings (text-embedding-004)
import JSON5 from "https://esm.sh/json5@2.2.3"
import { corsHeaders } from '../_shared/cors.ts'
import { callLLM } from '../_shared/llm-client.ts'
// import { calculateAllMarkets, PreCalculatedMarkets } from '../_shared/marketCalculator.ts'

// Import League Mapping
import { LEAGUE_MAPPING, BOOKMAKER_MAPPING } from '../_shared/league-mapping.ts'

const ODDS_API_KEY = "527a97a0d2316436a0bacf71c7b93eb5";

async function fetchRealOdds(leagueId: number, homeTeam: string, awayTeam: string) {
  const sportKey = LEAGUE_MAPPING[leagueId];
  if (!sportKey) return null;

  try {
    const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${ODDS_API_KEY}&regions=eu&markets=h2h,totals&oddsFormat=decimal`;
    console.log(`[ANALYSIS-ODDS] Fetching real odds for ${sportKey}...`);

    const res = await fetch(url);
    if (!res.ok) {
      console.error(`[ANALYSIS-ODDS] Error fetching: ${res.statusText}`);
      return null;
    }
    const data = await res.json();

    // Fuzzy Match / Find the game
    // Simple heuristic: specific part of team name match
    // Strategy: Check if odds home_team contains our home_name or vice versa
    // Normalize function (Robust)
    const norm = (str: string) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

    const hNorm = norm(homeTeam);
    const aNorm = norm(awayTeam);

    const match = data.find((ev: any) => {
      const evHome = norm(ev.home_team);
      const evAway = norm(ev.away_team);
      // Robust check: inclusion
      const homeMatch = evHome.includes(hNorm) || hNorm.includes(evHome);
      const awayMatch = evAway.includes(aNorm) || aNorm.includes(evAway);
      return homeMatch && awayMatch;
    });

    if (!match) {
      console.log(`[ANALYSIS-ODDS] Match NOT found for: ${homeTeam} (${hNorm}) vs ${awayTeam} (${aNorm})`);

      let available = "";
      if (Array.isArray(data)) {
        available = data.slice(0, 50).map((e: any) => `${e.home_team} vs ${e.away_team}`).join(' | ');
      }

      return {
        raw: null,
        summary: "No se encontraron cuotas (Nombre no coincide).",
        debug_candidates: available
      };
    }

    console.log(`[ANALYSIS-ODDS] Found match: ${match.home_team} vs ${match.away_team}`);

    // Process Best Odds
    // We want Average or Best available. Let's pick 'pinnacle' or first available as reference.
    const bookmakers = match.bookmakers || [];
    const pinnacle = bookmakers.find((b: any) => b.key === 'pinnacle') || bookmakers[0];

    if (!pinnacle) return { raw: match, summary: "Partido encontrado, sin bookmakers." };

    // Extract Lines
    let oddsSummary = `Casa: ${pinnacle.title}\n`;

    // 1X2
    const h2h = pinnacle.markets.find((m: any) => m.key === 'h2h');
    if (h2h) {
      const homeOdd = h2h.outcomes.find((o: any) => o.name === match.home_team)?.price;
      const awayOdd = h2h.outcomes.find((o: any) => o.name === match.away_team)?.price;
      const drawOdd = h2h.outcomes.find((o: any) => o.name === 'Draw')?.price;
      oddsSummary += `1X2: Local @${homeOdd} | Empate @${drawOdd} | Visitante @${awayOdd}\n`;
    }

    // Totals
    const totals = pinnacle.markets.find((m: any) => m.key === 'totals');
    if (totals) {
      const over = totals.outcomes.find((o: any) => o.name === 'Over')?.price;
      const under = totals.outcomes.find((o: any) => o.name === 'Under')?.price;
      const line = totals.outcomes[0]?.point;
      oddsSummary += `Goles: Over ${line} @${over} | Under ${line} @${under}\n`;
    }

    return { raw: match, summary: oddsSummary };

  } catch (e: any) {
    console.error(`[ANALYSIS-ODDS] Exception: ${e.message}`);
    return null;
  }
}

// ... existing code ...


// --- SETUP ---
const API_FOOTBALL_BASE = 'https://v3.football.api-sports.io';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  let supabase: any;
  let job: any;

  try {
    const { api_fixture_id } = await req.json();
    console.log(`[JOB-START] Elite Analysis for fixture: ${api_fixture_id}`);

    // CONFIG
    const sbUrl = Deno.env.get('SUPABASE_URL')!;
    const sbKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    supabase = createClient(sbUrl, sbKey);

    // JOB INIT
    const { data: jobCreated, error: jobError } = await supabase
      .from('analysis_jobs')
      .insert({
        api_fixture_id,
        status: 'collecting_evidence',
        progress_jsonb: { step: 'Iniciando recolección de datos...', completeness_score: 5 }
      })
      .select().single();

    job = jobCreated;
    if (jobError) throw jobError;

    // SECRETS
    const geminiKey = Deno.env.get('GEMINI_API_KEY');
    const footballKeys = Deno.env.get('API_FOOTBALL_KEYS');
    if (!geminiKey || !footballKeys) throw new Error("Missing API Secrets");

    // HELPER: FETCH
    const rawKeys = typeof footballKeys === 'string' ? footballKeys : '';
    const apiKeys = rawKeys.split(',').map((k: any) => k.trim()).filter((k: string) => k.length > 0);
    const fetchFootball = async (path: string) => {
      for (const key of apiKeys) {
        try {
          const res = await fetch(`${API_FOOTBALL_BASE}/${path}`, { headers: { 'x-apisports-key': key } });
          if (res.ok) {
            const json = await res.json();
            if (!json.errors || Object.keys(json.errors).length === 0) return json.response;
          }
        } catch (e) { console.error(e); }
      }
      return []; // Return empty on fail
    };

    // --- STAGE 1: CORE DATA FETCH ---
    const fixtureData = await fetchFootball(`fixtures?id=${api_fixture_id}`);
    if (!fixtureData || fixtureData.length === 0) throw new Error("Fixture not found");
    const game = fixtureData[0];
    const { home: homeTeam, away: awayTeam } = game.teams;
    const leagueId = game.league.id;

    // --- ODDS INTEGRATION ---
    const realOddsData = await fetchRealOdds(leagueId, homeTeam.name, awayTeam.name);
    if (realOddsData) {
      console.log(`[ETL] Odds found: ${realOddsData.summary.split('\n')[0]}...`);
    } else {
      console.log(`[ETL] No Odds found for this match.`);
    }

    // SEASON LOGIC (Robust)
    let season = game.league.season;
    try {
      // ... (Simplified logic for brevity, relying on fixture season if fetch fails)
      // Ideally we would double check with league endpoint but we can trust fixture season usually
    } catch (e) { }

    console.log(`[ETL] Fetching detailed data for ${homeTeam.name} vs ${awayTeam.name} (${season})...`);

    // PARALLEL FETCHING (Enhanced with tactical data)
    const [
      last40_H, last40_A,
      h2h,
      standingsData,
      injuriesData,
      predictionsData,
      statsHome,
      statsAway,
      oddsData,
      currentMatchLineups, // NEW: Lineups for this match
      refereeFixtures // NEW: Referee's recent matches
    ] = await Promise.all([
      fetchFootball(`fixtures?team=${homeTeam.id}&last=40&status=FT`),
      fetchFootball(`fixtures?team=${awayTeam.id}&last=40&status=FT`),
      fetchFootball(`fixtures/headtohead?h2h=${homeTeam.id}-${awayTeam.id}&last=20`),
      fetchFootball(`standings?league=${leagueId}&season=${season}`),
      fetchFootball(`injuries?fixture=${api_fixture_id}`),
      fetchFootball(`predictions?fixture=${api_fixture_id}`),
      fetchFootball(`teams/statistics?league=${leagueId}&season=${season}&team=${homeTeam.id}`),
      fetchFootball(`teams/statistics?league=${leagueId}&season=${season}&team=${awayTeam.id}`),
      fetchFootball(`odds?fixture=${api_fixture_id}`),
      fetchFootball(`fixtures/lineups?fixture=${api_fixture_id}`), // Get formations for this match
      game.fixture.referee ? fetchFootball(`fixtures?referee=${encodeURIComponent(game.fixture.referee)}&last=20&status=FT`) : Promise.resolve([]) // Referee stats
    ]);



    // --- STAGE 2: PROCESS & ENRICH COMPARABLES ---

    // Helper to format match objects for AI
    const createMatchObject = (f: any, stats: any = null) => ({
      date: f.fixture.date.split('T')[0],
      home_team: f.teams.home.name,
      away_team: f.teams.away.name,
      score: `${f.goals.home}-${f.goals.away}`,
      is_home_for_team: f.teams.home.id === homeTeam.id || f.teams.home.id === awayTeam.id ? 'YES' : 'NO', // Rough check
      stats: stats ? {
        shots: stats.reduce((acc: any, curr: any) => acc + (curr.statistics.find((s: any) => s.type === 'Total Shots')?.value || 0), 0),
        corners: stats.reduce((acc: any, curr: any) => acc + (curr.statistics.find((s: any) => s.type === 'Corner Kicks')?.value || 0), 0),
        // Simplification: api-football stats are per team. We need to parse correctly.
        // If we fetch stats/fixture, we get array of 2 teams.
        home_stats: stats.find((t: any) => t.team.id === f.teams.home.id)?.statistics?.reduce((acc: any, s: any) => ({ ...acc, [s.type]: s.value }), {}),
        away_stats: stats.find((t: any) => t.team.id === f.teams.away.id)?.statistics?.reduce((acc: any, s: any) => ({ ...acc, [s.type]: s.value }), {})
      } : null
    });

    // 2.1 Identify Comparables (Last 10 specific condition)
    // Home as Home
    const homeAsHome10 = (last40_H || []).filter((f: any) => f.teams.home.id === homeTeam.id).slice(0, 10);
    // Away as Away
    const awayAsAway10 = (last40_A || []).filter((f: any) => f.teams.away.id === awayTeam.id).slice(0, 10);

    // 2.2 Fetch Stats AND Lineups for these 20 matches (TACTICAL ENRICHMENT)
    const comparableIds = [...homeAsHome10, ...awayAsAway10].map((f: any) => f.fixture.id);
    const uniqueComparableIds = [...new Set(comparableIds)];

    const statsMap = new Map();
    const lineupsMap = new Map(); // NEW: Store formations
    console.log(`[ETL] Enriching ${uniqueComparableIds.length} comparables with stats + lineups...`);

    await Promise.all(uniqueComparableIds.map(async (fid) => {
      const [s, l] = await Promise.all([
        fetchFootball(`fixtures/statistics?fixture=${fid}`),
        fetchFootball(`fixtures/lineups?fixture=${fid}`)
      ]);
      if (s && s.length > 0) statsMap.set(fid, s);
      if (l && l.length > 0) lineupsMap.set(fid, l);
    }));

    const enrich = (list: any[]) => list.map(f => createMatchObject(f, statsMap.get(f.fixture.id)));

    // --- STAGE 2.5: TACTICAL DATA PROCESSING ---

    // Process lineups to extract formations and tactical patterns
    const processTacticalData = (fixtureIds: number[], teamId: number) => {
      const formations: any[] = [];
      const formationStats: Record<string, { count: number, wins: number, draws: number, losses: number, goalsFor: number, goalsAgainst: number }> = {};

      fixtureIds.forEach(fid => {
        const lineup = lineupsMap.get(fid);
        const fixtureData = [...(homeAsHome10 || []), ...(awayAsAway10 || [])].find(f => f.fixture.id === fid);
        if (!lineup || !fixtureData) return;

        const teamLineup = lineup.find((l: any) => l.team.id === teamId);
        if (!teamLineup) return;

        const isHome = fixtureData.teams.home.id === teamId;
        const goalsFor = isHome ? fixtureData.goals.home : fixtureData.goals.away;
        const goalsAgainst = isHome ? fixtureData.goals.away : fixtureData.goals.home;
        const result = goalsFor > goalsAgainst ? 'W' : (goalsFor < goalsAgainst ? 'L' : 'D');

        const formation = teamLineup.formation || 'Unknown';

        formations.push({
          fixture_id: fid,
          team_id: teamId, // For DB save
          date: fixtureData.fixture.date.split('T')[0],
          formation,
          starting_xi: teamLineup.startXI?.map((p: any) => ({
            name: p.player.name,
            number: p.player.number,
            position: p.player.pos,
            grid: p.player.grid
          })),
          substitutes: teamLineup.substitutes?.map((p: any) => ({
            name: p.player.name,
            number: p.player.number,
            position: p.player.pos
          })) || [],
          result,
          goals_for: goalsFor,
          goals_against: goalsAgainst
        });

        if (!formationStats[formation]) {
          formationStats[formation] = { count: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 };
        }
        formationStats[formation].count++;
        formationStats[formation][result === 'W' ? 'wins' : (result === 'D' ? 'draws' : 'losses')]++;
        formationStats[formation].goalsFor += goalsFor || 0;
        formationStats[formation].goalsAgainst += goalsAgainst || 0;
      });

      return { formations, formationStats };
    };

    const homeFormations = processTacticalData(homeAsHome10.map(f => f.fixture.id), homeTeam.id);
    const awayFormations = processTacticalData(awayAsAway10.map(f => f.fixture.id), awayTeam.id);


    // Process referee statistics
    const processRefereeStats = async (matches: any[]) => {
      if (!matches || matches.length === 0) return null;

      let totalYellow = 0;
      let totalRed = 0;
      let homeYellow = 0;
      let awayYellow = 0;
      let validGames = 0;

      // Fetch stats for referee's matches (limit to first 10 to avoid timeout)
      const refMatchesToAnalyze = matches.slice(0, 10);

      for (const m of refMatchesToAnalyze) {
        try {
          const stats = await fetchFootball(`fixtures/statistics?fixture=${m.fixture.id}`);
          if (!stats || stats.length < 2) continue;

          validGames++;
          const homeStats = stats[0]?.statistics || [];
          const awayStats = stats[1]?.statistics || [];

          const homeYC = homeStats.find((s: any) => s.type === 'Yellow Cards')?.value || 0;
          const awayYC = awayStats.find((s: any) => s.type === 'Yellow Cards')?.value || 0;
          const homeRC = homeStats.find((s: any) => s.type === 'Red Cards')?.value || 0;
          const awayRC = awayStats.find((s: any) => s.type === 'Red Cards')?.value || 0;

          totalYellow += (parseInt(homeYC) || 0) + (parseInt(awayYC) || 0);
          totalRed += (parseInt(homeRC) || 0) + (parseInt(awayRC) || 0);
          homeYellow += parseInt(homeYC) || 0;
          awayYellow += parseInt(awayYC) || 0;
        } catch (e) {
          console.error(`Error fetching referee match stats: ${m.fixture.id}`, e);
        }
      }

      return validGames > 0 ? {
        referee_name: game.fixture.referee,
        total_games: validGames,
        avg_yellow_cards: (totalYellow / validGames).toFixed(2),
        avg_red_cards: (totalRed / validGames).toFixed(2),
        home_yellow_avg: (homeYellow / validGames).toFixed(2),
        away_yellow_avg: (awayYellow / validGames).toFixed(2)
      } : null;
    };

    const refereeStats = game.fixture.referee ? await processRefereeStats(refereeFixtures) : null;


    // --- STAGE 3: BUILD "CONTRATO DE ENTRADA" JSON ---

    const allStandings = standingsData?.[0]?.league?.standings?.[0] || [];
    const getTeamContext = (tid: number) => {
      const s = allStandings.find((x: any) => x.team.id === tid);
      return s ? { position: s.rank, points: s.points, form: s.form, gd: s.goalsDiff } : null;
    };

    const inputPayload = {
      match: {
        match_id: `${api_fixture_id}`,
        date_time_utc: game.fixture.date,
        competition: {
          name: game.league.name,
          country: game.league.country,
          type: game.league.type, // League vs Cup
          round: game.league.round
        },
        venue: { stadium: game.fixture.venue.name, city: game.fixture.venue.city },
        teams: { home: { id: homeTeam.id, name: homeTeam.name }, away: { id: awayTeam.id, name: awayTeam.name } }
      },
      datasets: {
        home_team_last40: {
          overall: (last40_H || []).slice(0, 40).map((f: any) => createMatchObject(f)),
          as_home: (last40_H || []).filter((f: any) => f.teams.home.id === homeTeam.id).slice(0, 20).map((f: any) => createMatchObject(f)),
          as_away: (last40_H || []).filter((f: any) => f.teams.away.id === homeTeam.id).slice(0, 20).map((f: any) => createMatchObject(f))
        },
        away_team_last40: {
          overall: (last40_A || []).slice(0, 40).map((f: any) => createMatchObject(f)),
          as_home: (last40_A || []).filter((f: any) => f.teams.home.id === awayTeam.id).slice(0, 20).map((f: any) => createMatchObject(f)),
          as_away: (last40_A || []).filter((f: any) => f.teams.away.id === awayTeam.id).slice(0, 20).map((f: any) => createMatchObject(f))
        },
        comparables_last10: {
          home: {
            as_home: enrich(homeAsHome10) // ENRICHED WITH STATS
          },
          away: {
            as_away: enrich(awayAsAway10) // ENRICHED WITH STATS
          },
          notes: "Comparables specifically selected for Condition (Home vs Home, Away vs Away)"
        },
        h2h: { last_matches: (h2h || []).map((f: any) => createMatchObject(f)) },
        standings: {
          table_snapshot: allStandings.slice(0, 8), // Top 8 only to save tokens, usually relevant
          home_team_context: getTeamContext(homeTeam.id),
          away_team_context: getTeamContext(awayTeam.id)
        },
        availability: {
          home: { injuries: (injuriesData || []).filter((i: any) => i.team.id === homeTeam.id) },
          away: { injuries: (injuriesData || []).filter((i: any) => i.team.id === awayTeam.id) }
        },
        season_stats: {
          home: statsHome,
          away: statsAway
        },
        api_prediction: {
          provider: "API-Football",
          outputs: predictionsData?.[0]?.predictions || {}
        },
        odds: {
          book: oddsData?.[0]?.bookmakers?.[0]?.name || "Unknown",
          markets: oddsData?.[0]?.bookmakers?.[0]?.bets || []
        },
        tactical_analysis: {
          current_match_formations: {
            home: currentMatchLineups?.[0] || null,
            away: currentMatchLineups?.[1] || null
          },
          home_team_tactical_profile: {
            recent_formations: homeFormations.formations,
            formation_statistics: homeFormations.formationStats,
            most_used_formation: Object.entries(homeFormations.formationStats).sort((a: any, b: any) => b[1].count - a[1].count)[0]?.[0] || "Unknown",
            tactical_notes: `Based on last 10 home matches. Analyze formation patterns, key players, and tactical flexibility.`
          },
          away_team_tactical_profile: {
            recent_formations: awayFormations.formations,
            formation_statistics: awayFormations.formationStats,
            most_used_formation: Object.entries(awayFormations.formationStats).sort((a: any, b: any) => b[1].count - a[1].count)[0]?.[0] || "Unknown",
            tactical_notes: `Based on last 10 away matches. Analyze formation patterns, key players, and tactical flexibility.`
          },
          referee_analysis: refereeStats ? {
            ...refereeStats,
            tactical_impact: `Referee ${refereeStats.referee_name}: Avg ${refereeStats.avg_yellow_cards} yellow cards/game. Consider impact on card markets and playing style.`
          } : null
        }
      }
    };

    // ═══════════════════════════════════════════════════════════════
    // FASE 3: CONSULTA RAG (BASE DE CONOCIMIENTO TÁCTICO)
    // ═══════════════════════════════════════════════════════════════
    console.log('[V2-SUPER-PROMPT] Consultando RAG para contexto avanzado...');

    // Calcular formaciones más usadas para el query
    const getMostUsed = (stats: any) => Object.entries(stats).sort((a: any, b: any) => b[1].count - a[1].count)[0]?.[0] || "Unknown";
    const homeMostUsed = getMostUsed(homeFormations.formationStats);
    const awayMostUsed = getMostUsed(awayFormations.formationStats);

    // Generar embedding del contexto del partido
    // Usamos Gemini para generar vector del contexto
    let knowledgeContext = "No specific tactical documents found.";
    try {
      const ai = new GoogleGenerativeAI(geminiKey);
      const embedModel = ai.getGenerativeModel({ model: "text-embedding-004" });

      const embeddingQuery = `Analysis for ${homeTeam.name} vs ${awayTeam.name}. League: ${game.league.name}. Formations: ${homeMostUsed} vs ${awayMostUsed}`;

      const result = await embedModel.embedContent(embeddingQuery);
      const vector = result.embedding.values;

      // Consultar DB
      const { data: ragDocs, error: ragError } = await supabase.rpc('match_knowledge_base', {
        query_embedding: vector,
        match_threshold: 0.5, // Umbral de relevancia
        match_count: 3
      });

      if (ragDocs && ragDocs.length > 0) {
        knowledgeContext = ragDocs.map((d: any) => `[DOCUMENTO: ${d.title}]\n${d.content}`).join('\n\n');
        console.log(`[V2-SUPER-PROMPT] RAG encontró ${ragDocs.length} documentos relevantes.`);
      } else {
        console.log(`[V2-SUPER-PROMPT] RAG no encontró documentos específicos con umbral 0.5.`);
      }
    } catch (e) {
      console.error('[V2-SUPER-PROMPT] Error en RAG (continuando sin contexto extra):', e);
    }

    // ═══════════════════════════════════════════════════════════════
    // FASE 4: EL SUPER PROMPT (CADENA DE PENSAMIENTO)
    // ═══════════════════════════════════════════════════════════════

    // Preparamos el catálogo de mercados para que la IA elija
    let marketsCatalog: any[] = [];
    try {
      const { data: marketsData } = await supabase
        .from('betting_markets_catalog')
        .select('category, market_key, market_name_es, description, typical_odds_min, typical_odds_max')
        .eq('is_active', true)
        .order('category');
      marketsCatalog = marketsData || [];
    } catch (e) { console.error('Error fetching catalog:', e); }

    const marketsList = marketsCatalog.map(m => `- ${m.market_name_es} (${m.market_key})`).join('\n');

    const prompt = `
ERES EL ANALISTA DEPORTIVO PRINCIPAL DE "DERBIX".
TU OBJETIVO: INTERPRETAR LA REALIDAD, NO CALCULARLA.

Tienes acceso a datos profundos, contexto táctico y una base de conocimiento histórica.
Tu trabajo es encontrar la "VERDAD DEL PARTIDO" y traducirla en oportunidades de inversión (picks).

==================================================
CONTEXTO DEL PARTIDO (JSON DATOS CRUDOS):
==================================================
${JSON.stringify(inputPayload)}

==================================================
CONOCIMIENTO TÁCTICO RELEVANTE (RAG):
==================================================
${knowledgeContext}

==================================================
CONTEXTO DE MERCADO (ODDS API - REFERENCIA):
==================================================
${realOddsData ? realOddsData.summary : "No hay cuotas de referencia disponibles. Usa tu criterio puro."}

==================================================
CATÁLOGO DE MERCADOS DISPONIBLES:
==================================================
${marketsList}

==================================================
TU MISIÓN (CADENA DE PENSAMIENTO):
==================================================

PASO 1: ANÁLISIS DE ESCENARIOS (LA NARRATIVA TÁCTICA)
- NO busques "apuestas seguras". BUSCA LA VERDAD DEL JUEGO.
- Define el "ESCENARIO A" (El guion más probable, ~60-70% de veces).
  - Ej: "Local domina, Visitante se encierra -> Pocos goles, Gana Local".
- Define el "ESCENARIO B" (El plan alternativo / riesgo plausible).
  - Ej: "Visitante marca primero en contra y se rompe el partido -> Over de goles".

PASO 2: DUELO TÁCTICO & DESAJUSTES
- ¿Dónde está la ventaja injusta? (Ej: Extremo rápido vs Lateral lento y amonestado).
- ¿Hay valor en Goles (Over/Under) basado en el estilo de juego y no en la tabla?

PASO 3: VEREDICTO FINAL Y SELECCIÓN INTELIGENTE
- Selecciona oportunidades que encajen en el ESCENARIO A. 
- Si detectas un valor inmenso en el ESCENARIO B (riesgo alto pero recompensa enorme), inclúyelo también.

==================================================
FORMATO DE SALIDA (JSON STRICTO):
==================================================
{
  "veredicto_analista": {
    "decision": "APOSTAR" | "OBSERVAR" | "EVITAR",
    "titulo_accion": "Título corto (Ej: 'Asedio Local')",
    "probabilidad": 85, 
    "nivel_confianza": "ALTA" | "MEDIA" | "BAJA",
    "razon_principal": "Argumento táctico central.",
    "riesgo_principal": "El mayor peligro."
  },
  "header_partido": {
    "titulo": "Local vs Visitante",
    "subtitulo": "Estadio - Torneo",
    "bullets_clave": ["Dato 1", "Dato 2", "Dato 3"]
  },
  "resumen_ejecutivo": {
    "frase_principal": "Resumen narrativo del partido.",
    "puntos_clave": ["Clave 1", "Clave 2", "Clave 3", "Clave 4"]
  },
  "analisis_detallado": {
    "contexto_competitivo": { "titulo": "La Narrativa", "bullets": ["..."] },
    "analisis_tactico_formaciones": { "titulo": "La Batalla Táctica", "bullets": ["..."] },
    "impacto_arbitro": { "titulo": "El Juez", "bullets": ["..."] },
    "alineaciones_y_bajas": { "titulo": "Novedades", "bullets": ["..."] },
    "analisis_escenarios": {
      "titulo": "Guiones de Partido",
      "escenarios": [
        { "nombre": "ESCENARIO A (Probable)", "probabilidad_aproximada": "65%", "descripcion": "...", "implicacion_apuestas": "..." },
        { "nombre": "ESCENARIO B (Riesgo)", "probabilidad_aproximada": "35%", "descripcion": "...", "implicacion_apuestas": "..." }
      ]
    }
  },
  "predicciones_finales": {
    "detalle": [
      {
        "mercado": "Nombre Mercado (Ej: Over 2.5)",
        "seleccion": "Selección (Ej: Over 2.5)",
        "probabilidad_estimado_porcentaje": 75,
        "es_anchor": false, // Dejar en false, usaremos 'etiqueta_escenario'
        "etiqueta_escenario": "SCENARIO_A" | "SCENARIO_B" | "ANCHOR" | "VALUE", // IMPORTANTE: CLASIFICAR AQUÍ
        "justificacion_detallada": {
          "base_estadistica": ["..."],
          "contexto_competitivo": ["..."],
          "conclusion": "..."
        }
      }
    ]
  },
  "mercado_recomendado": {
    "descripcion": "Mejor Oportunidad",
    "market_key": "clave", 
    "market_name": "Nombre",
    "probabilidad_estimada": 80,
    "valor_detectado": "ALTO",
    "razonamiento": "..."
  },
  "analisis_mercados_completo": {
    "descripcion": "Otras opciones",
    "ranking_oportunidades": [
       { "posicion": 1, "market_name": "...", "confianza": "ALTA", "justificacion_tactica": "..." }
    ]
  }
}

PASO 5: "INTELIGENCIA DE PARLAY" (CRUCIAL - ETIQUETADO)
- Clasifica cada pick en 'predicciones_finales' usando el campo "etiqueta_escenario":
- "SCENARIO_A": Es la consecuencia lógica del guion principal. (Ej: Gana Favorito).
- "VALUE": Oportunidad táctica clara ignorada por las cuotas teóricas. (Ej: Ambos Marcan en partido abierto).
- "ANCHOR": Solo si es una certeza casi absoluta (>85%).
- "SCENARIO_B": Solo si es una cobertura inteligente.

REGLAS DE ORO:
1. IDIOMA: SIEMPRE ESPAÑOL.
2. NO SEAS CONSERVADOR: Si el análisis táctico dice "Goles", ve a por el Over 2.5 o BTTS, no te quedes en el Over 1.5 por miedo.
3. OLVIDA LAS CUOTAS: No las tienes. Usa tu cerebro táctico. ¿Es probable? ¿Tiene sentido? Apúestalo.
`;

    // ═══════════════════════════════════════════════════════════════
    // FASE 5: EJECUCIÓN (LLM multi-provider con fallback automático)
    // ═══════════════════════════════════════════════════════════════
    const llmResult = await callLLM(prompt, {
      temperature: 0.4,
      jsonMode: true,
      timeoutMs: 90000,
    });
    const responseText = llmResult.text;
    console.log(`[JOB] LLM responded via ${llmResult.provider}/${llmResult.model}`);

    let aiData;
    try {
      aiData = JSON5.parse(responseText);
    } catch (e) {
      // Fallback limpieza básica
      const cleaned = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
      aiData = JSON5.parse(cleaned);
    }

    // Si no hay datos pre-calculados (porque los borramos), la IA es la única fuente.
    // No inyectamos nada artificial.


    // --- STAGE 6: SAVE ---
    // Construct Enriched Output with Debug Metadata
    const finalOutput = {
      ...aiData, // Use the parsed AI data
      debug_metadata: {
        odds_found: !!realOddsData,
        odds_summary: realOddsData?.summary || "No odds found in API",
        api_search_term: `${homeTeam.name} vs ${awayTeam.name}`,
        league_id_used: leagueId,
        rag_enabled: !!(ragDocs && ragDocs.length > 0)
      }
    };

    // Save enriched evidence
    const { data: runData, error: runError } = await supabase.from('analysis_runs').insert({
      job_id: job.id,
      fixture_id: job.id, // REVERTED: DB column expects UUID. Using job.id as intended by schema.
      model_version: `${llmResult.provider}/${llmResult.model}`,
      summary_pre_text: aiData.resumen_ejecutivo?.frase_principal,
      report_pre_jsonb: finalOutput, // Use finalOutput with debug info
      match_date: game.fixture.date.split('T')[0] // YYYY-MM-DD del partido
    }).select().single();

    if (runError) {
      console.error('[SAVE] Error saving analysis_run:', runError);
      throw runError;
    }

    // --- STAGE 6.5: SAVE PREDICTIONS TO DEDICATED TABLE ---
    const predictions = aiData.predicciones_finales?.detalle || [];
    if (predictions.length > 0 && runData) {
      const modelVersion = 'v1-stable';

      // SCHEMA REAL: analysis_run_id, fixture_id, market, selection, probability, confidence, reasoning, model_version
      const predictionsToInsert = predictions.map((p: any) => ({
        analysis_run_id: runData.id,
        fixture_id: api_fixture_id,
        market: p.mercado || 'Mercado',
        selection: p.seleccion || 'Selección',
        probability: p.probabilidad_estimado_porcentaje || 50,
        // CRITICAL HACK: Store the STRATEGIC TAG (Scenario A, B, Anchor) in confidence column
        confidence: p.etiqueta_escenario || (p.es_anchor ? 'ANCHOR' : 'NORMAL'),
        reasoning: p.justificacion_detallada?.conclusion || '',
        model_version: modelVersion
      }));

      const { error: predError } = await supabase.from('predictions').insert(predictionsToInsert);
      if (predError) {
        console.error('[SAVE] Error saving predictions:', predError);
      } else {
        console.log(`[SAVE] Inserted ${predictionsToInsert.length} predictions (${modelVersion}) for fixture ${api_fixture_id}`);
      }
    }

    // --- STAGE 6.6: CACHE TACTICAL & REFEREE DATA ---

    // 1. Save Referee Stats (Upsert)
    if (refereeStats && game.fixture.referee) {
      // Use current league/season context for cache key
      const refPayload = {
        referee_name: game.fixture.referee,
        league_id: leagueId,
        season: season,
        total_games: refereeStats.total_games,
        avg_yellow_cards: parseFloat(refereeStats.avg_yellow_cards),
        avg_red_cards: parseFloat(refereeStats.avg_red_cards),
        avg_fouls: 0, // Not calculated yet
        home_yellow_avg: parseFloat(refereeStats.home_yellow_avg),
        away_yellow_avg: parseFloat(refereeStats.away_yellow_avg),
        last_updated: new Date().toISOString()
      };

      const { error: refError } = await supabase.from('referee_stats').upsert(refPayload, {
        onConflict: 'referee_name, league_id, season'
      });

      if (refError) console.error('[SAVE] Referee cache error:', refError);
      else console.log('[SAVE] Updated referee stats cache');
    }

    // 2. Save Tactical Data (Formations)
    // Combine home and away formations to save
    const allFormations = [...homeFormations.formations, ...awayFormations.formations];
    if (allFormations.length > 0) {
      const tacticalPayloads = allFormations.map((f: any) => ({
        fixture_id: f.fixture_id,
        team_id: f.team_id,
        team_name: f.team_id === homeTeam.id ? homeTeam.name : (f.team_id === awayTeam.id ? awayTeam.name : 'Unknown'),
        formation: f.formation,
        starting_eleven: f.starting_xi,
        substitutes: f.substitutes,
        match_date: f.date
      }));

      // Upsert to match_tactical_data
      const { error: tacError } = await supabase.from('match_tactical_data').upsert(tacticalPayloads, {
        onConflict: 'fixture_id, team_id'
      });

      if (tacError) console.error('[SAVE] Tactical data error:', tacError);
      else console.log(`[SAVE] Cached ${tacticalPayloads.length} tactical records`);
    }


    // Save Evidence Blocks (New Schema)
    // We can save the raw enriched blocks for debugging
    // ...

    // Update status
    await supabase.from('analysis_jobs').update({ status: 'done', completeness_score: 100 }).eq('id', job.id);
    await supabase.from('analisis').upsert({ partido_id: api_fixture_id, resultado_analisis: { dashboardData: aiData } });

    // CRITICAL FIX: Ensure match exists in daily_matches so fetchTopPicks can see it
    try {
      const dailyMatchPayload = {
        api_fixture_id: api_fixture_id,
        league_id: game.league.id,
        league_name: game.league.name,
        home_team: homeTeam.name,
        home_team_logo: homeTeam.logo,
        away_team: awayTeam.name,
        away_team_logo: awayTeam.logo,
        match_time: game.fixture.date,
        match_status: game.fixture.status.short,
        home_score: game.goals.home,
        away_score: game.goals.away,
        match_date: game.fixture.date.split('T')[0],
        scan_date: new Date().toISOString().split('T')[0]
      };
      // Upsert on fixture_id
      const { error: dmError } = await supabase.from('daily_matches').upsert(dailyMatchPayload, { onConflict: 'api_fixture_id' });
      if (dmError) console.error('[SAVE] Error updating daily_matches:', dmError);
      else console.log('[SAVE] Updated daily_matches visibility');
    } catch (e) {
      console.error('[SAVE] Failed to update daily_matches (Non-blocking):', e);
    }


    return new Response(JSON.stringify({ success: true, job_id: job.id }), { headers: corsHeaders });

  } catch (err: any) {
    if (job?.id) await supabase.from('analysis_jobs').update({ status: 'failed', last_error: err.message }).eq('id', job.id);
    return new Response(JSON.stringify({ error: err.message }), { headers: corsHeaders });
  }
});