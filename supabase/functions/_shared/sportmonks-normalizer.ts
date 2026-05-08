// supabase/functions/_shared/sportmonks-normalizer.ts
// Normaliza datos de SportMonks al formato esperado por v3-ai-analyzer

import { selectOdds, type SelectedOdd, type OddsSelection } from './odds-selector.ts';

export interface NormalizedPayload {
    match: {
        fixture_id: number;
        date_time_utc: string;
        referee: string | null;
        venue: {
            name: string | null;
            city: string | null;
        };
        competition: {
            id: number;
            name: string;
            country: string;
            round: string | null;
            season_id: number;
        };
        teams: {
            home: { id: number; name: string; logo: string };
            away: { id: number; name: string; logo: string };
        };
        weather?: {
            type: string;
            temperature: number;
        };
    };
    datasets: {
        home_team_last40: { all: any[] };
        away_team_last40: { all: any[] };
        h2h: any[];
        standings: {
            table: any[];
            home_context: any;
            away_context: any;
        };
        injuries: {
            home: any[];
            away: any[];
        };
    };
    odds: any;
    predictions: any;
    value_bets: any[];
    xg: any;
    lineups: any;
}

/**
 * Normalize SportMonks fixture to internal format
 */
export function normalizeFixture(fixture: any): NormalizedPayload['match'] {
    const home = fixture.participants?.find((p: any) => p.meta?.location === 'home');
    const away = fixture.participants?.find((p: any) => p.meta?.location === 'away');

    return {
        fixture_id: fixture.id,
        date_time_utc: fixture.starting_at,
        referee: fixture.referees?.[0]?.common_name || null,
        venue: {
            name: fixture.venue?.name || null,
            city: fixture.venue?.city_name || null
        },
        competition: {
            id: fixture.league?.id || 0,
            name: fixture.league?.name || 'Unknown League',
            country: fixture.league?.country?.name || '',
            round: fixture.round?.name || null,
            season_id: fixture.season_id || 0
        },
        teams: {
            home: {
                id: home?.id || 0,
                name: home?.name || 'Home Team',
                logo: home?.image_path || ''
            },
            away: {
                id: away?.id || 0,
                name: away?.name || 'Away Team',
                logo: away?.image_path || ''
            }
        },
        weather: fixture.weatherReport ? {
            type: fixture.weatherReport.type?.code || 'unknown',
            temperature: fixture.weatherReport.temperature?.temp || 20
        } : undefined
    };
}

/**
 * Normalize match history (last N fixtures)
 * CRITICAL FIX: SportMonks scores array has SEPARATE entries for home/away with description='CURRENT'
 */
export function normalizeMatchHistory(fixtures: any[], teamId: number): any[] {
    return fixtures.map((f: any) => {
        const home = f.participants?.find((p: any) => p.meta?.location === 'home');
        const away = f.participants?.find((p: any) => p.meta?.location === 'away');

        // FIXED: Find CURRENT scores for EACH participant separately
        // SportMonks has TWO entries with description='CURRENT' - one for home, one for away
        const homeScoreEntry = f.scores?.find((s: any) =>
            s.description === 'CURRENT' && s.score?.participant === 'home'
        );
        const awayScoreEntry = f.scores?.find((s: any) =>
            s.description === 'CURRENT' && s.score?.participant === 'away'
        );

        // Get goals, fallback to 0 if not found
        const homeScore = homeScoreEntry?.score?.goals ?? 0;
        const awayScore = awayScoreEntry?.score?.goals ?? 0;

        return {
            fixture_id: f.id,
            date: f.starting_at || '',
            home_team: home?.name || 'Home',
            away_team: away?.name || 'Away',
            home_id: home?.id || 0,
            away_id: away?.id || 0,
            score_home: homeScore,
            score_away: awayScore,
            venue: f.venue?.name || null,
            league: f.league?.name || ''
        };
    });
}


/**
 * Normalize DEEP match history for V4 Mastermind Engine
 * Extracts detailed stats like possession, shots, corners, formations
 * V5 UPGRADE: Adds was_home, opponent_name, and opponent stats for correct venue identification
 */
export function normalizeDetailedMatchHistory(fixtures: any[], teamId: number): any[] {
    return fixtures.map((f: any) => {
        // Basic Info
        const basic = normalizeMatchHistory([f], teamId)[0];

        // Determine if this team was HOME or AWAY in this specific match
        const home = f.participants?.find((p: any) => p.meta?.location === 'home');
        const away = f.participants?.find((p: any) => p.meta?.location === 'away');
        const homeId = home?.id || 0;
        const awayId = away?.id || 0;

        // CRITICAL: was_home indicates if the team we're analyzing was the HOST in this match
        const wasHome = teamId === homeId;
        const opponentId = wasHome ? awayId : homeId;
        const opponentName = wasHome ? (away?.name || 'Away Team') : (home?.name || 'Home Team');

        // Extract Formations
        const myFormation = f.formations?.find((lm: any) => lm.participant_id === teamId)?.formation || 'Unknown';
        const opponentFormation = f.formations?.find((lm: any) => lm.participant_id === opponentId)?.formation || 'Unknown';

        // Extract Stats (Possession, Shots, Corners, Fouls, Cards)
        const findStat = (typeId: number, team: number) => {
            const stat = f.statistics?.find((s: any) => s.participant_id === team && s.type_id === typeId);
            return stat?.data?.value || 0;
        };

        // Extract Events (Goal Timings)
        const getGoalTimings = (team: number) => {
            return f.events
                ?.filter((e: any) => e.participant_id === team && (e.type?.name === 'Goal' || e.type_id === 14)) // 14=Goal
                .map((e: any) => e.minute + (e.extra_minute ? `+${e.extra_minute}` : ''))
                .join(', ') || '';
        };

        // V8 UPGRADE: Extract ALL events with detail (minute, type, player, detail)
        const extractDetailedEvents = (team: number) => {
            if (!f.events || !Array.isArray(f.events)) return [];
            return f.events
                .filter((e: any) => e.participant_id === team)
                .map((e: any) => ({
                    minute: e.minute + (e.extra_minute ? `+${e.extra_minute}` : ''),
                    type: e.type?.name || (e.type_id === 14 ? 'Goal' : e.type_id === 18 ? 'Yellow Card' : e.type_id === 20 ? 'Red Card' : e.type_id === 19 ? 'Substitution' : 'Event'),
                    player: e.player_name || e.player?.common_name || 'Unknown',
                    detail: e.sub_type_name || e.result || '',
                    related_player: e.related_player_name || null
                }))
                .sort((a: any, b: any) => parseInt(a.minute) - parseInt(b.minute));
        };

        // V8: Half-time score extraction
        const htHomeEntry = f.scores?.find((s: any) => s.description === '1ST_HALF' && s.score?.participant === 'home');
        const htAwayEntry = f.scores?.find((s: any) => s.description === '1ST_HALF' && s.score?.participant === 'away');
        const htHome = htHomeEntry?.score?.goals ?? null;
        const htAway = htAwayEntry?.score?.goals ?? null;

        // Extract Referee
        const referee = f.referees?.[0]?.common_name || 'Unknown';

        // ═══════════════════════════════════════════════════════════════════════
        // SPORTMONKS v3 OFFICIAL TYPE IDs (from docs.sportmonks.com)
        // ═══════════════════════════════════════════════════════════════════════
        // 34 = Corners
        // 41 = Shots Off Target
        // 42 = Shots Total (on target + off target + blocked)
        // 43 = Attacks
        // 44 = Dangerous Attacks
        // 45 = Ball Possession (%)
        // 51 = Offsides
        // 52 = Goals
        // 55 = Free Kicks
        // 56 = Fouls
        // 57 = Saves (Goalkeeper)
        // 58 = Shots Blocked
        // 83 = Red Cards
        // 84 = Yellow Cards
        // 86 = Shots On Target (commonly used but check API)
        // ═══════════════════════════════════════════════════════════════════════

        return {
            ...basic,
            // NEW FIELDS for correct venue identification
            was_home: wasHome,
            opponent_name: opponentName,
            opponent_id: opponentId,
            details: {
                formation_used: myFormation,
                opponent_formation: opponentFormation,
                // FIXED: Correct type_ids from SportMonks v3 documentation
                possession: findStat(45, teamId),
                shots_total: findStat(42, teamId),
                shots_on_target: findStat(86, teamId),
                corners: findStat(34, teamId),
                saves: findStat(57, teamId),
                yellow_cards: findStat(84, teamId),
                red_cards: f.statistics?.find((s: any) => s.participant_id === teamId && s.type_id === 83)?.data?.value || 0,
                fouls: findStat(56, teamId),
                goal_timings: getGoalTimings(teamId),
                referee: referee,
                // Opponent stats for deeper analysis
                opponent_shots: findStat(42, opponentId),
                opponent_shots_on_target: findStat(86, opponentId),
                opponent_corners: findStat(34, opponentId),
                opponent_possession: findStat(45, opponentId),
                // V8 NEW: Expanded stats
                shots_blocked: findStat(58, teamId),
                offsides: findStat(51, teamId),
                free_kicks: findStat(55, teamId),
                opponent_fouls: findStat(56, opponentId),
                opponent_yellow_cards: findStat(84, opponentId),
                opponent_red_cards: f.statistics?.find((s: any) => s.participant_id === opponentId && s.type_id === 83)?.data?.value || 0,
                // V8 NEW: Detailed events (minute-by-minute)
                events: extractDetailedEvents(teamId),
                opponent_events: extractDetailedEvents(opponentId),
                // V8 NEW: Half-time score
                ht_score_team: wasHome ? htHome : htAway,
                ht_score_opponent: wasHome ? htAway : htHome
            }
        };
    });
}

/**
 * V8: Normalize SIMPLE match history (results + formation only, for general form)
 * Lightweight version for the 30-match general trend view
 */
export function normalizeSimpleForm(fixtures: any[], teamId: number): any[] {
    return fixtures.map((f: any) => {
        const home = f.participants?.find((p: any) => p.meta?.location === 'home');
        const away = f.participants?.find((p: any) => p.meta?.location === 'away');
        const homeId = home?.id || 0;
        const wasHome = teamId === homeId;
        const opponentName = wasHome ? (away?.name || 'Away') : (home?.name || 'Home');

        const homeScoreEntry = f.scores?.find((s: any) => s.description === 'CURRENT' && s.score?.participant === 'home');
        const awayScoreEntry = f.scores?.find((s: any) => s.description === 'CURRENT' && s.score?.participant === 'away');
        const homeScore = homeScoreEntry?.score?.goals ?? 0;
        const awayScore = awayScoreEntry?.score?.goals ?? 0;

        const teamGoals = wasHome ? homeScore : awayScore;
        const oppGoals = wasHome ? awayScore : homeScore;
        const result = teamGoals > oppGoals ? 'W' : teamGoals < oppGoals ? 'L' : 'D';

        const formation = f.formations?.find((fm: any) => fm.participant_id === teamId)?.formation || null;

        return {
            date: f.starting_at || '',
            opponent: opponentName,
            was_home: wasHome,
            score: `${teamGoals}-${oppGoals}`,
            result,
            formation,
            league: f.league?.name || ''
        };
    });
}

/**
 * Normalize H2H fixtures
 * V5 Upgrade: Now returns FULL detailed stats, same as history
 * V6 FIX: Correct score extraction and type_ids
 */
export function normalizeH2H(fixtures: any[]): any[] {
    // For H2H, we might want to see stats for BOTH teams, but normalizeDetailedMatchHistory focuses on ONE team.
    // So we map it differently. We want a neutral detailed view.

    return fixtures.map((f: any) => {
        const home = f.participants?.find((p: any) => p.meta?.location === 'home');
        const away = f.participants?.find((p: any) => p.meta?.location === 'away');
        const homeId = home?.id;
        const awayId = away?.id;

        // FIXED: Find CURRENT scores for EACH participant separately
        const homeScoreEntry = f.scores?.find((s: any) =>
            s.description === 'CURRENT' && s.score?.participant === 'home'
        );
        const awayScoreEntry = f.scores?.find((s: any) =>
            s.description === 'CURRENT' && s.score?.participant === 'away'
        );
        const homeScore = homeScoreEntry?.score?.goals ?? 0;
        const awayScore = awayScoreEntry?.score?.goals ?? 0;

        // Reuse the extraction logic for both sides
        const findStat = (typeId: number, team: number) => {
            const stat = f.statistics?.find((s: any) => s.participant_id === team && s.type_id === typeId);
            return stat?.data?.value || 0;
        };

        const getGoalTimings = (team: number) => {
            return f.events
                ?.filter((e: any) => e.participant_id === team && (e.type?.name === 'Goal' || e.type_id === 14))
                .map((e: any) => e.minute + (e.extra_minute ? `+${e.extra_minute}` : ''))
                .join(', ') || '';
        };

        return {
            fixture_id: f.id,
            date: f.starting_at || '',
            home_team: home?.name || 'Home',
            away_team: away?.name || 'Away',
            score_home: homeScore,
            score_away: awayScore,

            // Rich Stats for H2H - FIXED type_ids
            stats: {
                home: {
                    shots: findStat(42, homeId),
                    shots_ot: findStat(86, homeId),
                    corners: findStat(34, homeId),               // FIXED: Was 83
                    cards: findStat(84, homeId) + findStat(83, homeId), // Yellow(84) + Red(83)
                    goals_at: getGoalTimings(homeId)
                },
                away: {
                    shots: findStat(42, awayId),
                    shots_ot: findStat(86, awayId),
                    corners: findStat(34, awayId),               // FIXED: Was 83
                    cards: findStat(84, awayId) + findStat(83, awayId), // FIXED
                    goals_at: getGoalTimings(awayId)
                }
            },
            referee: f.referees?.[0]?.common_name || 'Unknown'
        };
    });
}

/**
 * Normalize standings
 */
export function normalizeStandings(standings: any[], homeTeamId: number, awayTeamId: number): {
    table: any[];
    home_context: any;
    away_context: any;
} {
    const table = standings.map((s: any) => ({
        position: s.position,
        team_id: s.participant?.id,
        team_name: s.participant?.name,
        points: s.points,
        played: s.details?.find((d: any) => d.type_id === 129)?.value || 0, // Games played
        win: s.details?.find((d: any) => d.type_id === 130)?.value || 0,    // Wins
        draw: s.details?.find((d: any) => d.type_id === 131)?.value || 0,   // Draws
        lose: s.details?.find((d: any) => d.type_id === 132)?.value || 0,   // Losses
        goals_for: s.details?.find((d: any) => d.type_id === 133)?.value || 0,
        goals_against: s.details?.find((d: any) => d.type_id === 134)?.value || 0,
        gd: s.details?.find((d: any) => d.type_id === 179)?.value || 0,     // Goal difference
        form: s.form || 'N/A'
    }));

    const homeContext = table.find(t => t.team_id === homeTeamId) || null;
    const awayContext = table.find(t => t.team_id === awayTeamId) || null;

    return {
        table: table.slice(0, 10),
        home_context: homeContext,
        away_context: awayContext
    };
}

/**
 * Normalize sidelined/injuries
 */
export function normalizeSidelined(sidelined: any[], homeTeamId: number, awayTeamId: number): {
    home: any[];
    away: any[];
} {
    const home = sidelined
        .filter((s: any) => s.team_id === homeTeamId)
        .map((s: any) => ({
            player: {
                name: s.player?.display_name || s.player?.common_name || 'Unknown',
                reason: s.type?.name || 'Unavailable'
            }
        }));

    const away = sidelined
        .filter((s: any) => s.team_id === awayTeamId)
        .map((s: any) => ({
            player: {
                name: s.player?.display_name || s.player?.common_name || 'Unknown',
                reason: s.type?.name || 'Unavailable'
            }
        }));

    return { home, away };
}

/**
 * Normalize odds
 */
export function normalizeOdds(odds: any[]): any {
    if (!odds || odds.length === 0) return null;

    const bookmakers: any[] = [];
    const groupedByBookmaker = new Map<number, any>();

    for (const odd of odds) {
        const bkId = odd.bookmaker?.id;
        const bkName = odd.bookmaker?.name || 'Unknown';

        if (!groupedByBookmaker.has(bkId)) {
            groupedByBookmaker.set(bkId, {
                id: bkId,
                title: bkName,
                markets: []
            });
        }

        const bk = groupedByBookmaker.get(bkId);
        const existingMarket = bk.markets.find((m: any) => m.key === odd.market?.name);

        if (!existingMarket) {
            bk.markets.push({
                key: odd.market?.name || 'unknown',
                outcomes: [{
                    name: odd.label || odd.name,
                    price: odd.value,
                    point: odd.handicap || null
                }]
            });
        } else {
            existingMarket.outcomes.push({
                name: odd.label || odd.name,
                price: odd.value,
                point: odd.handicap || null
            });
        }
    }

    return {
        bookmakers: Array.from(groupedByBookmaker.values()).sort((a: any, b: any) => {
            const priority = ['Bet365', 'Pinnacle', '1xBet', 'Unibet', 'Bwin', 'William Hill'];
            const scoreA = priority.indexOf(a.title);
            const scoreB = priority.indexOf(b.title);

            // If both are priority, sort by index (lower is better)
            if (scoreA !== -1 && scoreB !== -1) return scoreA - scoreB;
            // If only A is priority, A comes first
            if (scoreA !== -1) return -1;
            // If only B is priority, B comes first
            if (scoreB !== -1) return 1;

            // Fallback: Sort by number of markets (more markets = better data usually)
            return b.markets.length - a.markets.length;
        })
    };
}

/**
 * Normalize predictions
 */
export function normalizePredictions(predictions: any): any {
    if (!predictions) return null;

    return {
        home_win: predictions.predictions?.home || null,
        draw: predictions.predictions?.draw || null,
        away_win: predictions.predictions?.away || null,
        over_2_5: predictions.predictions?.over_2_5 || null,
        under_2_5: predictions.predictions?.under_2_5 || null,
        btts_yes: predictions.predictions?.btts || null,
        btts_no: predictions.predictions?.btts_no || null,
        correct_score: predictions.predictions?.correct_score || null
    };
}

/**
 * Normalize xG data
 */
export function normalizeXG(xgData: any): any {
    if (!xgData) return null;

    return {
        home_xg: xgData.home || null,
        away_xg: xgData.away || null,
        total_xg: (xgData.home || 0) + (xgData.away || 0)
    };
}

/**
 * Normalize value bets
 */
export function normalizeValueBets(valueBets: any[]): any[] {
    if (!valueBets) return [];

    return valueBets.map((vb: any) => ({
        market: vb.market?.name || 'Unknown',
        selection: vb.label || vb.name,
        probability: vb.probability,
        odds: vb.value,
        fair_odds: vb.fair_odds,
        edge: vb.value_index || 0
    }));
}

/**
 * Build complete normalized payload for v3-ai-analyzer
 */
export function buildNormalizedPayload(
    fixture: any,
    homeHistory: any[],
    awayHistory: any[],
    h2h: any[],
    standings: any[],
    predictions: any,
    valueBets: any[],
    homeTeamId: number,
    awayTeamId: number
): NormalizedPayload {
    const match = normalizeFixture(fixture);

    return {
        match,
        datasets: {
            home_team_last40: { all: normalizeMatchHistory(homeHistory, homeTeamId) },
            away_team_last40: { all: normalizeMatchHistory(awayHistory, awayTeamId) },
            h2h: normalizeH2H(h2h),
            standings: normalizeStandings(standings, homeTeamId, awayTeamId),
            injuries: normalizeSidelined(fixture.sidelined || [], homeTeamId, awayTeamId)
        },
        odds: normalizeOdds(fixture.odds || []),
        predictions: normalizePredictions(predictions),
        value_bets: normalizeValueBets(valueBets),
        xg: normalizeXG(fixture.xGFixture),
        lineups: {
            home: fixture.lineups?.filter((l: any) => l.team_id === homeTeamId) || [],
            away: fixture.lineups?.filter((l: any) => l.team_id === awayTeamId) || []
        }
    };
}

/**
 * Normalize SportMonks fixture to Frontend Game interface
 * Used for listing fixtures in the dashboard
 */
export function normalizeSportMonksToListGame(smFixture: any): any {
    const home = smFixture.participants?.find((p: any) => p.meta?.location === 'home');
    const away = smFixture.participants?.find((p: any) => p.meta?.location === 'away');

    let homeScore = null;
    let awayScore = null;

    if (smFixture.scores && Array.isArray(smFixture.scores)) {
        // Priority list for descriptions - try to find the most relevant score
        const priorities = ['CURRENT', '2ND_HALF', '1ST_HALF', 'ET', 'PEN', 'FT'];

        const homeId = home?.id;
        const awayId = away?.id;

        for (const desc of priorities) {
            // Find scores matching this description
            const scoresForDesc = smFixture.scores.filter((s: any) => s.description === desc);

            if (scoresForDesc.length > 0) {
                // Try to find home and away values
                const homeS = scoresForDesc.find((s: any) =>
                    (s.score?.participant === 'home') ||
                    (homeId && s.participant_id === homeId)
                );
                const awayS = scoresForDesc.find((s: any) =>
                    (s.score?.participant === 'away') ||
                    (awayId && s.participant_id === awayId)
                );

                if (homeS) homeScore = homeS.score?.goals;
                if (awayS) awayScore = awayS.score?.goals;

                if (homeScore !== null || awayScore !== null) break;
            }
        }
    }

    // Detect live matches and calculate elapsed minutes
    const LIVE_SHORT_NAMES = ['LIVE', '1H', 'HT', '2H', 'ET', 'BT', 'PEN_LIVE', 'BREAK', 'INT'];
    const stateShort = smFixture.state?.short_name || 'NS';
    const isLiveMatch = LIVE_SHORT_NAMES.includes(stateShort);

    let elapsed: number | null = null;
    if (isLiveMatch) {
        // Prefer direct data from SportMonks if available
        elapsed = smFixture.time?.minute
            ?? smFixture.periods?.current?.minutes
            ?? null;

        // Fallback: calculate from starting_at
        if (elapsed === null && smFixture.starting_at) {
            const startMs = new Date(smFixture.starting_at).getTime();
            const nowMs = Date.now();
            const diffMin = Math.floor((nowMs - startMs) / 60000);
            elapsed = Math.min(Math.max(diffMin, 1), 120);
        }
    }

    return {
        fixture: {
            id: smFixture.id,
            date: smFixture.starting_at,
            status: {
                short: stateShort,
                long: smFixture.state?.name || '',
                elapsed: elapsed
            },
            venue: {
                id: smFixture.venue_id,
                name: smFixture.venue?.name || '',
                city: smFixture.venue?.city_name || ''
            },
            referee: null,
            period: { first: null, second: null },
            timestamp: new Date(smFixture.starting_at).getTime() / 1000,
            timezone: 'UTC'
        },
        league: {
            id: smFixture.league?.id || 0,
            name: smFixture.league?.name || 'Unknown',
            country: smFixture.league?.country?.name || 'World',
            logo: smFixture.league?.image_path || '',
            flag: smFixture.league?.country?.image_path || '',
            season: smFixture.season_id,
            round: smFixture.round?.name || ''
        },
        teams: {
            home: {
                id: home?.id || 0,
                name: home?.name || 'Home',
                logo: home?.image_path || '',
                winner: null
            },
            away: {
                id: away?.id || 0,
                name: away?.name || 'Away',
                logo: away?.image_path || '',
                winner: null
            }
        },
        goals: { home: homeScore, away: awayScore },
        score: {
            halftime: { home: null, away: null },
            fulltime: { home: null, away: null },
            extratime: { home: null, away: null },
            penalty: { home: null, away: null }
        }
    };
}

// --- LEGACY NORMALIZERS (API-FOOTBALL FORMAT COMPATIBILITY) ---

/**
 * Normalize SportMonks stats to API-Football format
 * API-Football expects: { team: { id, name, logo }, statistics: [ { type: string, value: any } ] }
 */
export function normalizeLegacyStatistics(fixture: any, homeTeamId: number, awayTeamId: number): any[] | null {
    if (!fixture.statistics || fixture.statistics.length === 0) return null;

    const translateType = (typeId: number): string => {
        // SportMonks v3 Official Type IDs — comprehensive mapping
        const map: Record<number, string> = {
            34: 'Corner Kicks',
            41: 'Shots off Goal',
            42: 'Total Shots',
            43: 'Attacks',
            44: 'Dangerous Attacks',
            45: 'Ball Possession',
            51: 'Offsides',
            52: 'Goals',
            55: 'Free Kicks',
            56: 'Fouls',
            57: 'Goalkeeper Saves',
            58: 'Blocked Shots',
            64: 'Hit Woodwork',
            65: 'Throw-ins',
            80: 'Total passes',
            82: 'Passes accurate',
            83: 'Red Cards',
            84: 'Yellow Cards',
            86: 'Shots on Goal',
            87: 'Shots off Goal',
            98: 'Interceptions',
            99: 'Tackles',
            106: 'Passes %',
            107: 'Key Passes',
            117: 'Clearances',
            119: 'Aerial Duels Won',
            120: 'Aerial Duels Lost',
            321: 'Dribble Attempts',
            322: 'Successful Dribbles',
            580: 'expected_goals',
            1605: 'Accurate Crosses',
        };
        return map[typeId] || `Stat ${typeId}`;
    };

    // Helper to build stat array for a team
    const buildStats = (teamId: number) => {
        const teamStats = fixture.statistics.filter((s: any) => s.participant_id === teamId);
        if (teamStats.length === 0) return [];

        return teamStats.map((s: any) => ({
            type: s.type?.name || translateType(s.type_id),
            value: s.data?.value || 0
        }));
    };

    const home = fixture.participants?.find((p: any) => p.id === homeTeamId);
    const away = fixture.participants?.find((p: any) => p.id === awayTeamId);

    return [
        {
            team: { id: home?.id, name: home?.name, logo: home?.image_path },
            statistics: buildStats(homeTeamId)
        },
        {
            team: { id: away?.id, name: away?.name, logo: away?.image_path },
            statistics: buildStats(awayTeamId)
        }
    ];
}

/**
 * Normalize SportMonks events to API-Football format
 */
export function normalizeLegacyEvents(fixture: any): any[] | null {
    if (!fixture.events || fixture.events.length === 0) return null;

    return fixture.events.map((e: any) => ({
        time: {
            elapsed: e.minute,
            extra: e.extra_minute || null
        },
        team: {
            id: e.participant_id,
            name: '', // We might catch this from participants lookup if critical
            logo: ''
        },
        player: {
            id: e.player_id,
            name: e.player_name || 'Player'
        },
        assist: {
            id: e.related_player_id,
            name: e.related_player_name || null
        },
        type: e.type?.name || 'Goal', // Simplified mapping needed?
        detail: e.sub_type_name || e.type?.name || '',
        comments: null
    })).sort((a: any, b: any) => (a.time.elapsed + (a.time.extra || 0)) - (b.time.elapsed + (b.time.extra || 0)));
}

/**
 * Normalize SportMonks lineups to API-Football format
 */
export function normalizeLegacyLineups(fixture: any, homeTeamId: number, awayTeamId: number): any[] | null {
    if (!fixture.lineups || fixture.lineups.length === 0) return null;

    const buildLineup = (teamId: number) => {
        const teamLineup = fixture.lineups.filter((l: any) => l.team_id === teamId);
        const formation = fixture.formations?.find((f: any) => f.participant_id === teamId)?.formation || 'Unknown';

        // Separate starting XI and subs
        const startXI = teamLineup.filter((l: any) => l.type_id === 11 || l.type?.code === 'starting-xi' || !l.type_id) // Assuming start if no type? Warning.
            .map((l: any) => ({
                player: {
                    id: l.player_id,
                    name: l.player_name || l.player?.common_name || 'Unknown',
                    number: l.jersey_number,
                    pos: l.position?.code || 'P',
                    grid: null
                }
            }));

        const substitutes = teamLineup.filter((l: any) => l.type_id === 12 || l.type?.code === 'bench')
            .map((l: any) => ({
                player: {
                    id: l.player_id,
                    name: l.player_name || l.player?.common_name || 'Unknown',
                    number: l.jersey_number,
                    pos: l.position?.code || 'S',
                    grid: null
                }
            }));

        const team = fixture.participants?.find((p: any) => p.id === teamId);

        return {
            team: {
                id: team?.id,
                name: team?.name,
                logo: team?.image_path,
                colors: null
            },
            coach: { id: 0, name: 'Unknown', photo: null }, // SportMonks puts coaches elsewhere usually
            formation: formation,
            startXI: startXI,
            substitutes: substitutes
        };
    };

    return [buildLineup(homeTeamId), buildLineup(awayTeamId)];
}

// ... existing exports ...

/**
 * Get Canonical Market ID for semantic unification
 * Maps semantically identical markets to a single ID
 */
function getCanonicalMarketId(marketId: number, label: string): string {
    const l = label.toLowerCase();

    // 1x2
    if (marketId === 1) return `1x2_${l}`;

    // Double Chance (usually market 10 or similar, but let's rely on label if ID varies)
    if (l.includes('double chance') || l.includes('doble oportunidad')) return `dc_${l.replace(/\s/g, '_')}`;

    // Goals Over/Under (Market 12 usually)
    // "Over 2.5" -> "goals_over_2.5"
    if (marketId === 12 || l.includes('over ') || l.includes('under ')) {
        const type = l.includes('over') ? 'over' : 'under';
        const val = l.match(/[\d\.]+/)?.[0];
        if (val) return `goals_${type}_${val}`;
    }

    // BTTS (Market 13 usually)
    if (l.includes('both teams to score')) {
        return l.includes('yes') ? 'btts_yes' : 'btts_no';
    }

    // Exact Score
    if (marketId === 3) return `exact_score_${l.replace(/\s|:/g, '-')}`;

    // TEAM PROPS (The critical part for deduplication)
    // "Away Team Score" vs "Away Over 0.5"
    if (l.includes('team to score') || l.includes('anota')) {
        const team = l.includes('home') || l.includes('local') ? 'home' : 'away';
        return `${team}_team_score_yes`; // Canonical "Team Valid Goal"
    }

    // Handle specific mappings for known duplicates
    // If market is "Away Team Total" and line is 0.5, it maps to team_score_yes

    return `market_${marketId}_${l.replace(/[^a-z0-9]/g, '_')}`;
}

/**
 * Normalize SportMonks standings to API-Football format
 */
export function normalizeLegacyStandings(standings: any[]): any[][] | null {
    if (!standings || standings.length === 0) return null;

    const normalized = standings.map((s: any) => ({
        rank: s.position,
        team: {
            id: s.participant_id,
            name: s.participant?.name || 'Unknown',
            logo: s.participant?.image_path || ''
        },
        points: s.points,
        goalsDiff: s.details?.find((d: any) => d.type_id === 179)?.value || 0,
        group: s.group_name || 'League',
        form: s.form || '',
        status: '',
        description: s.result || '',
        all: {
            played: s.details?.find((d: any) => d.type_id === 129)?.value || 0,
            win: s.details?.find((d: any) => d.type_id === 130)?.value || 0,
            draw: s.details?.find((d: any) => d.type_id === 131)?.value || 0,
            lose: s.details?.find((d: any) => d.type_id === 132)?.value || 0,
            goals: {
                for: s.details?.find((d: any) => d.type_id === 133)?.value || 0,
                against: s.details?.find((d: any) => d.type_id === 134)?.value || 0
            }
        },
        home: { played: 0, win: 0, draw: 0, lose: 0, goals: { for: 0, against: 0 } },
        away: { played: 0, win: 0, draw: 0, lose: 0, goals: { for: 0, against: 0 } },
        update: new Date().toISOString()
    }));

    return [normalized];
}

// SportMonks market_id → { name (human), category }. Verified against bet365 catalog.
// Items not in this dict fall through to OTHERS with a generic label.
// 2026-05-08 FIX: m_id=80 (Goals Over/Under, the Bet365 standard) was missing — it
// fell into OTHERS with English label and the resolver picked m_id=37/105/107
// (combo / Asian split / variant) returning wrong odds (e.g. 4.50 for Under 2.5
// when the real Bet365 price was 1.85). m_ids 105/107/69 produce odds with
// composite thresholds ("Under 2.5, 3.0") and Asian goal lines that look identical
// to "Under 2.5" but are different markets — moved to OTHERS so they don't
// pollute GOALS matching.
const MARKET_DICT: Record<number, { name: string; cat: 'MAIN' | 'GOALS' | 'TEAMS' | 'HALVES' | 'CORNERS' | 'COMBOS' | 'OTHERS' }> = {
    1:   { name: 'Resultado 1X2',                cat: 'MAIN' },
    2:   { name: 'Asian Handicap',               cat: 'TEAMS' },
    5:   { name: 'Half Time / Full Time',        cat: 'COMBOS' },
    6:   { name: 'Match Winner (no draw)',       cat: 'MAIN' },
    7:   { name: 'Más/Menos Goles',              cat: 'GOALS' },  // Goal Line (alternativa estándar)
    10:  { name: 'Doble Oportunidad',            cat: 'MAIN' },
    12:  { name: 'Más/Menos Goles',              cat: 'GOALS' },
    13:  { name: 'Resultado y Ambos Anotan',     cat: 'COMBOS' },
    14:  { name: 'Resultado al Descanso',        cat: 'HALVES' },
    16:  { name: 'Ambos Anotan',                 cat: 'GOALS' },
    18:  { name: 'Asian Handicap',               cat: 'TEAMS' },
    19:  { name: 'Asian Handicap',               cat: 'TEAMS' },
    27:  { name: 'Marcador Exacto',              cat: 'OTHERS' },
    28:  { name: 'Más/Menos Goles',              cat: 'GOALS' },
    37:  { name: 'Resultado y Total Goles',      cat: 'COMBOS' },  // combo 1X2+goals — NOT goals only
    38:  { name: 'Total Goles Local',            cat: 'TEAMS' },
    47:  { name: 'Doble Oportunidad y Goles',    cat: 'COMBOS' },
    53:  { name: 'Más/Menos Goles',              cat: 'GOALS' },
    63:  { name: 'Más/Menos Goles',              cat: 'GOALS' },
    67:  { name: 'Asian Handicap Esquinas',      cat: 'CORNERS' },
    69:  { name: 'Asian Goal Lines',             cat: 'OTHERS' },  // moved out of GOALS — has integer thresholds (Under 5/6/7) that look like normal Under but are different market
    70:  { name: 'Más/Menos Goles',              cat: 'GOALS' },
    79:  { name: 'Half Time / Full Time',        cat: 'COMBOS' },
    80:  { name: 'Más/Menos Goles',              cat: 'GOALS' },  // ← THE bookmaker-standard Over/Under Total Goals (the one Stake/Bet365 show as "Más/Menos 2.5")
    81:  { name: 'Total Goles Local',            cat: 'TEAMS' },
    82:  { name: 'Total Goles + BTTS',           cat: 'COMBOS' },
    86:  { name: 'Resultado 1er Tiempo',         cat: 'HALVES' },
    87:  { name: 'Resultado 2do Tiempo',         cat: 'HALVES' },
    92:  { name: 'Último Goleador',              cat: 'OTHERS' },
    94:  { name: 'Total Tarjetas',               cat: 'OTHERS' },
    97:  { name: 'Resultado y Total Goles',      cat: 'COMBOS' },
    98:  { name: 'Ambos Anotan',                 cat: 'GOALS' },
    100: { name: 'Total Goles Equipo',           cat: 'TEAMS' },
    101: { name: 'Más/Menos Goles 1T',           cat: 'HALVES' },
    105: { name: 'Goles Asian Split',            cat: 'OTHERS' },  // composite thresholds ("Under 2.5, 3.0") — NOT same as Under 2.5
    107: { name: 'Total Goles Match',            cat: 'OTHERS' },  // variant with different threshold semantics
    120: { name: 'Estadísticas 1er Tiempo',      cat: 'HALVES' },
    121: { name: 'Estadísticas 2do Tiempo',      cat: 'HALVES' },
    334: { name: 'Más/Menos Esquinas',           cat: 'CORNERS' },
    336: { name: 'Más/Menos Esquinas',           cat: 'CORNERS' },
};

function buildEnrichedLabel(o: SelectedOdd, marketName: string, homeTeam?: string, awayTeam?: string): string {
    const baseLabel = (o.label || '').trim();
    const total = o.total ? ` ${o.total}` : '';
    const handicap = o.handicap ? ` ${o.handicap}` : '';

    // For 1X2 / Match Winner where label is "1"/"2"/"X", expand to team name
    let lbl = baseLabel;
    if (lbl === '1' && homeTeam) lbl = `${homeTeam} (Local)`;
    else if (lbl === '2' && awayTeam) lbl = `${awayTeam} (Visitante)`;
    else if (lbl === 'X' || lbl.toLowerCase() === 'draw') lbl = 'Empate';
    else if (lbl.toLowerCase() === 'home' && homeTeam) lbl = `${homeTeam} (Local)`;
    else if (lbl.toLowerCase() === 'away' && awayTeam) lbl = `${awayTeam} (Visitante)`;

    // For over/under: append the threshold (Over → Over 2.5)
    if ((lbl.toLowerCase() === 'over' || lbl.toLowerCase() === 'under') && (total || handicap)) {
        lbl = `${lbl}${total || handicap}`;
    }

    return `${marketName}: ${lbl}`;
}

/**
 * Organize Odds for AI Processing
 * Groups markets into categories using a market_id dictionary AND enriches
 * labels with thresholds + team names so the LLM and cross-validation can
 * unambiguously identify each pick.
 */
export function organizeOddsForAI(odds: any[], homeTeam?: string, awayTeam?: string): any {
    if (!odds || odds.length === 0) return { info: "No odds available" };

    const selection: OddsSelection = selectOdds(odds);
    if (!selection.has_coverage) return { info: "No odds available" };

    const structured: any = {
        MAIN: [] as any[],
        GOALS: [] as any[],
        TEAMS: [] as any[],
        HALVES: [] as any[],
        CORNERS: [] as any[],
        COMBOS: [] as any[],
        OTHERS: [] as any[],
        _meta: {
            bookmaker: selection.preferred_bookmaker_used,
            total_bookmakers: selection.total_bookmakers,
        },
    };

    // Group by (cat, enriched_lbl). When SportMonks returns multiple rows for the same logical
    // outcome across sub-markets (different m_ids), they may include outliers (e.g. Over 2.5
    // showing 7.0 because m_id=105 maps to a different threshold despite "2.5" in the total).
    // We pick the MEDIAN value per group and discard items that deviate >40% from the median —
    // safer than max (favored bettor but inflated) or min (too conservative).
    const groups = new Map<string, { mid_first: number; b_id: number; lbl: string; cat: string; values: number[] }>();

    for (const o of selection.picks) {
        const mid = o.market_id;
        const dictEntry = MARKET_DICT[mid];
        const marketName = dictEntry?.name || (o.market_description ? o.market_description : `Mercado ${mid}`);
        const cat = dictEntry?.cat || 'OTHERS';
        const enrichedLbl = buildEnrichedLabel(o, marketName, homeTeam, awayTeam);
        const key = `${cat}::${enrichedLbl}`;

        const g = groups.get(key);
        if (g) {
            g.values.push(o.value);
        } else {
            groups.set(key, { mid_first: mid, b_id: o.bookmaker_id, lbl: enrichedLbl, cat, values: [o.value] });
        }
    }

    const median = (arr: number[]): number => {
        const sorted = [...arr].sort((a, b) => a - b);
        const n = sorted.length;
        return n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)];
    };

    for (const g of groups.values()) {
        // If only 1 value, keep it. If multiple, take the median (drops outliers naturally).
        const med = median(g.values);
        // Sanity: discard if median is below 1.01 or absurdly high (>50) — likely categorization error.
        if (med < 1.01 || med > 50) continue;
        structured[g.cat].push({ m_id: g.mid_first, b_id: g.b_id, lbl: g.lbl, val: Math.round(med * 100) / 100 });
    }

    return structured;
}

