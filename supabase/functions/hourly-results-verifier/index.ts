// supabase/functions/hourly-results-verifier/index.ts
// Hourly Results Verification Engine V2
// CRON: Every hour (0 * * * *) — verifies picks using SportMonks API
// Falls back to Gemini for complex markets (corners, cards, handicaps, combined markets)
// V2: Fixed team abbreviation matching, combined market detection, Double Chance "o Empate",
//     null→PENDING (not VOID), MAX_GEMINI_CALLS raised to 40
// V3: Catch-up pass for ALL pending picks (any date), sync reports_v2→value_picks_v2,
//     profitability threshold aligned to OPPORTUNITIES_THRESHOLD (V9 = 0.80)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from '../_shared/cors.ts'
import { getFixtureComplete } from '../_shared/sportmonks-client.ts'
import { callLLM } from '../_shared/llm-client.ts'
import { OPPORTUNITIES_THRESHOLD } from '../_shared/constants.ts'

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════
interface VerificationResult {
    pickId: string;
    result: 'WON' | 'LOST' | 'VOID' | 'PUSH' | null;
    actualScore: string;
    method: 'rule-based' | 'gemini' | 'skip';
}

// ═══════════════════════════════════════════════════════════════
// STAKING MODEL — Flat percentages
// Oportunidades: 4% del bankroll
// ═══════════════════════════════════════════════════════════════
function calculateStake(_pickType: 'oportunidad'): { percentage: number; tier: string } {
    return { percentage: 4, tier: 'oportunidad-flat' };
}

// ═══════════════════════════════════════════════════════════════
// SCORE EXTRACTION FROM SPORTMONKS
// ═══════════════════════════════════════════════════════════════
function extractScores(fixture: any): { homeScore: number | null; awayScore: number | null; status: string } {
    const home = fixture.participants?.find((p: any) => p.meta?.location === 'home');
    const away = fixture.participants?.find((p: any) => p.meta?.location === 'away');

    // Extract CURRENT scores
    const homeScoreEntry = fixture.scores?.find((s: any) =>
        s.description === 'CURRENT' && s.score?.participant === 'home'
    );
    const awayScoreEntry = fixture.scores?.find((s: any) =>
        s.description === 'CURRENT' && s.score?.participant === 'away'
    );

    const homeScore = homeScoreEntry?.score?.goals ?? null;
    const awayScore = awayScoreEntry?.score?.goals ?? null;

    // Get match status from state
    const status = fixture.state?.short_name || 'NS';

    return { homeScore, awayScore, status };
}

// Extract stats from SportMonks fixture (type_ids from docs)
function extractStats(fixture: any): {
    homeCorners: number | null; awayCorners: number | null;
    homeYellowCards: number | null; awayYellowCards: number | null;
    homeRedCards: number | null; awayRedCards: number | null;
    homeShotsOnTarget: number | null; awayShotsOnTarget: number | null;
} {
    const home = fixture.participants?.find((p: any) => p.meta?.location === 'home');
    const away = fixture.participants?.find((p: any) => p.meta?.location === 'away');
    const homeId = home?.id;
    const awayId = away?.id;

    const findStat = (typeId: number, teamId: number): number | null => {
        const stat = fixture.statistics?.find((s: any) => s.participant_id === teamId && s.type_id === typeId);
        return stat?.data?.value ?? null;
    };

    return {
        homeCorners: findStat(34, homeId),       // Corners
        awayCorners: findStat(34, awayId),
        homeYellowCards: findStat(84, homeId),   // Yellow Cards
        awayYellowCards: findStat(84, awayId),
        homeRedCards: findStat(83, homeId),       // Red Cards
        awayRedCards: findStat(83, awayId),
        homeShotsOnTarget: findStat(86, homeId), // Shots On Target
        awayShotsOnTarget: findStat(86, awayId),
    };
}

// ═══════════════════════════════════════════════════════════════
// TEAM NAME MATCHING (handles abbreviations, partial names, etc.)
// ═══════════════════════════════════════════════════════════════
function teamsMatch(teamName: string, text: string): boolean {
    const clean = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    const ct = clean(teamName);
    const cp = clean(text);

    if (!ct || !cp) return false;

    // Direct substring (either direction)
    if (cp.includes(ct) || ct.includes(cp)) return true;

    // Abbreviation: "Paris Saint-Germain" → "psg"
    const words = ct.split(/[\s\-]+/).filter(w => w.length > 0);
    if (words.length >= 2) {
        const abbr = words.map(w => w[0]).join('');
        if (abbr.length >= 2 && cp.includes(abbr)) return true;
    }

    // Last word matching: "Aston Villa" → "villa", "Real Madrid" → "madrid"
    const lastWord = words[words.length - 1] || '';
    if (lastWord.length >= 4 && cp.includes(lastWord)) return true;

    // First significant word: "Barcelona SC" → "barcelona"
    const firstWord = words[0] || '';
    if (firstWord.length >= 5 && cp.includes(firstWord)) return true;

    return false;
}

// ═══════════════════════════════════════════════════════════════
// SUB-CONDITION EVALUATOR (for combined/combo markets)
// ═══════════════════════════════════════════════════════════════
function evaluateSubCondition(
    part: string,
    homeScore: number,
    awayScore: number,
    homeWin: boolean,
    awayWin: boolean,
    draw: boolean,
    totalGoals: number,
    cleanHT: string,
    cleanAT: string,
    stats: ReturnType<typeof extractStats>
): boolean | null {
    const p = part.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

    // Over/Under check
    const ouMatch = p.match(/(mas|menos|over|under|más|\+|\-)\s*(de\s+)?(\d+(\.\d+)?)/i);
    if (ouMatch) {
        const type = ouMatch[1].toLowerCase();
        const line = parseFloat(ouMatch[3]);
        const isOver = ['mas', 'over', '+', 'más'].some(t => type.includes(t));
        return isOver ? totalGoals > line : totalGoals < line;
    }

    // BTTS
    if (p.includes('ambos') || p.includes('btts') || p.includes('both teams')) {
        const both = homeScore > 0 && awayScore > 0;
        if (p.includes('no')) return !both;
        return both;
    }

    // Draw / Empate
    if (p === 'empate' || p === 'draw' || p === 'x') return draw;

    // Double chance patterns (coded formats)
    if (p.includes('1x') || (p.includes('local') && p.includes('empate'))) return homeWin || draw;
    if (p.includes('x2') || (p.includes('visita') && p.includes('empate')) || (p.includes('visitante') && p.includes('empate'))) return awayWin || draw;

    // "Team o Empate" / "Team or Draw" = Double Chance (e.g., "Aston Villa o Empate")
    if (p.includes(' o empate') || p.includes(' or draw') || p.includes(' o draw')) {
        if (teamsMatch(cleanHT, p)) return homeWin || draw;
        if (teamsMatch(cleanAT, p)) return awayWin || draw;
        // Fallback: if no team matched but pattern detected, check if "local"/"visita" nearby
        if (p.includes('local') || p.includes('home')) return homeWin || draw;
        if (p.includes('visita') || p.includes('away')) return awayWin || draw;
    }

    // Team win (gana + team name) — uses teamsMatch for abbreviation support
    if (p.includes('gana') || p.includes('win') || p.includes('victoria')) {
        if (teamsMatch(cleanHT, p)) return homeWin;
        if (teamsMatch(cleanAT, p)) return awayWin;
        if (p.includes('local') || p.includes('home')) return homeWin;
        if (p.includes('visita') || p.includes('away') || p.includes('visitante')) return awayWin;
    }

    // Double Chance via "/" separator: "TeamA/Draw", "Home/Draw", "Local/Empate", etc.
    if (p.includes('/')) {
        const slashParts = p.split('/').map(sp => sp.trim());
        if (slashParts.length === 2) {
            const subResults: boolean[] = [];
            for (const sp of slashParts) {
                if (sp === 'empate' || sp === 'draw' || sp === 'x') {
                    subResults.push(draw);
                } else if (sp === 'local' || sp === 'home') {
                    subResults.push(homeWin);
                } else if (sp === 'visitante' || sp === 'visita' || sp === 'away') {
                    subResults.push(awayWin);
                } else if (teamsMatch(cleanHT, sp)) {
                    subResults.push(homeWin);
                } else if (teamsMatch(cleanAT, sp)) {
                    subResults.push(awayWin);
                } else {
                    return null; // Can't determine → Gemini fallback
                }
            }
            return subResults.some(r => r === true); // OR logic for double chance
        }
    }

    // Team name alone = team wins — uses teamsMatch
    if (teamsMatch(cleanHT, p)) return homeWin;
    if (teamsMatch(cleanAT, p)) return awayWin;

    // Portería a cero / Clean sheet
    if (p.includes('porteria a cero') || p.includes('clean sheet')) {
        if (p.includes('no') || p.includes('no marcara')) {
            if (teamsMatch(cleanHT, p)) return awayScore === 0;
            if (teamsMatch(cleanAT, p)) return homeScore === 0;
        }
        if (teamsMatch(cleanHT, p)) return awayScore === 0;
        if (teamsMatch(cleanAT, p)) return homeScore === 0;
    }

    // Can't determine
    return null;
}

// ═══════════════════════════════════════════════════════════════
// RULE-BASED EVALUATION ENGINE
// ═══════════════════════════════════════════════════════════════
function evaluatePickResult(
    market: string,
    selection: string,
    homeScore: number,
    awayScore: number,
    homeTeam: string,
    awayTeam: string,
    stats: ReturnType<typeof extractStats>
): boolean | null {
    const m = (market || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const s = (selection || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const cleanHT = (homeTeam || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const cleanAT = (awayTeam || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    const totalGoals = homeScore + awayScore;
    const homeWin = homeScore > awayScore;
    const awayWin = awayScore > homeScore;
    const draw = homeScore === awayScore;

    // ═══ COMBINED/COMBO MARKETS (must be checked FIRST) ═══
    // Detect combined markets: "Team Win & Over X.5", "BTTS & Over X.5", "1X & Over X.5", etc.
    const combineSeparatorRegex = /\s*[&]\s*|\s+y\s+|\s+and\s+/i;
    const isCombined = m.includes('combinado') || m.includes('combo') || m.includes('combined') ||
        combineSeparatorRegex.test(m) ||  // Check & in market name too
        combineSeparatorRegex.test(s);     // Check & in selection

    if (isCombined) {
        // Try splitting selection first, then market if selection has no separator
        let parts = s.split(combineSeparatorRegex).map(p => p.trim()).filter(p => p.length > 0);
        if (parts.length < 2) {
            // Selection didn't split — try market name instead
            parts = m.split(combineSeparatorRegex).map(p => p.trim()).filter(p => p.length > 0);
        }
        if (parts.length >= 2) {
            const results: (boolean | null)[] = [];
            for (const part of parts) {
                // Evaluate each sub-condition independently
                const subResult = evaluateSubCondition(part, homeScore, awayScore, homeWin, awayWin, draw, totalGoals, cleanHT, cleanAT, stats);
                if (subResult === null) return null; // Can't evaluate → Gemini fallback
                results.push(subResult);
            }
            // Combined = ALL conditions must be true
            return results.every(r => r === true);
        }
        // Fallthrough if we couldn't split properly
    }

    // ═══ BTTS (Both Teams To Score) ═══
    if (m.includes('ambos') || m.includes('btts') || m.includes('marcan') || m.includes('both teams')) {
        const both = homeScore > 0 && awayScore > 0;
        if (s.includes('no') || s.includes('no')) return !both;
        return both;
    }

    // ═══ Over/Under Goals ═══
    const ouMatch = s.match(/(mas|menos|over|under|más|\+|\-)\s*(de\s+)?(\d+(\.\d+)?)/i);
    if (ouMatch) {
        const type = ouMatch[1].toLowerCase();
        const line = parseFloat(ouMatch[3]);

        // Check if it's about corners
        if (m.includes('corner') || m.includes('esquina')) {
            const totalCorners = (stats.homeCorners ?? 0) + (stats.awayCorners ?? 0);
            if (stats.homeCorners === null && stats.awayCorners === null) return null; // No data

            // Check team-specific corners
            if (m.includes('local') || m.includes('home') || teamsMatch(cleanHT, s) || teamsMatch(cleanHT, m)) {
                if (stats.homeCorners === null) return null;
                return ['mas', 'over', '+', 'más'].some(t => type.includes(t)) ? stats.homeCorners > line : stats.homeCorners < line;
            }
            if (m.includes('visita') || m.includes('away') || teamsMatch(cleanAT, s) || teamsMatch(cleanAT, m)) {
                if (stats.awayCorners === null) return null;
                return ['mas', 'over', '+', 'más'].some(t => type.includes(t)) ? stats.awayCorners > line : stats.awayCorners < line;
            }

            // Total corners
            if (['mas', 'over', '+', 'más'].some(t => type.includes(t))) return totalCorners > line;
            if (['menos', 'under', '-'].some(t => type.includes(t))) return totalCorners < line;
        }

        // Check if it's about cards
        if (m.includes('tarjeta') || m.includes('card')) {
            const totalCards = (stats.homeYellowCards ?? 0) + (stats.awayYellowCards ?? 0) +
                             (stats.homeRedCards ?? 0) + (stats.awayRedCards ?? 0);
            if (stats.homeYellowCards === null && stats.awayYellowCards === null) return null;

            if (['mas', 'over', '+', 'más'].some(t => type.includes(t))) return totalCards > line;
            if (['menos', 'under', '-'].some(t => type.includes(t))) return totalCards < line;
        }

        // Check if it's Team Total Goals
        const isTeamTotal = m.includes('equipo') || m.includes('team total') ||
            m.includes('goles del') || m.includes('totales del') ||
            m.includes('team goals') || m.includes('local anota') || m.includes('visita anota') ||
            m.includes('home over') || m.includes('away over');

        if (isTeamTotal) {
            const isHome = m.includes('local') || m.includes('home') || m.includes('casa') ||
                teamsMatch(cleanHT, m) || teamsMatch(cleanHT, s);
            const isAway = m.includes('visita') || m.includes('away') || m.includes('visitante') ||
                teamsMatch(cleanAT, m) || teamsMatch(cleanAT, s);

            const teamGoals = isHome ? homeScore : (isAway ? awayScore : null);
            if (teamGoals === null) return null;

            if (['mas', 'over', '+', 'más'].some(t => type.includes(t))) return teamGoals > line;
            if (['menos', 'under', '-'].some(t => type.includes(t))) return teamGoals < line;
        }

        // Standard total goals Over/Under
        if (['mas', 'over', '+', 'más'].some(t => type.includes(t))) return totalGoals > line;
        if (['menos', 'under', '-'].some(t => type.includes(t))) return totalGoals < line;
    }

    // ═══ Simple Over/Under by market name (e.g., "over_2.5_goals") ═══
    const marketOU = m.match(/(over|under)_(\d+(\.\d+)?)_(goals|goles)/);
    if (marketOU) {
        const overUnder = marketOU[1];
        const line = parseFloat(marketOU[2]);
        return overUnder === 'over' ? totalGoals > line : totalGoals < line;
    }

    // ═══ Home/Away Over 0.5 (Team Scores) ═══
    if (m === 'home_over_0.5' || m.includes('local anota')) return homeScore > 0;
    if (m === 'away_over_0.5' || m.includes('visita anota')) return awayScore > 0;

    // ═══ "Team o Empate" Double Chance (e.g., "Aston Villa o Empate") ═══
    if (s.includes(' o empate') || s.includes(' or draw') || s.includes(' o draw')) {
        if (teamsMatch(cleanHT, s)) return homeWin || draw;
        if (teamsMatch(cleanAT, s)) return awayWin || draw;
        if (s.includes('local') || s.includes('home')) return homeWin || draw;
        if (s.includes('visita') || s.includes('away')) return awayWin || draw;
    }

    // ═══ 1X2 / Double Chance ═══
    // Double chance first (more specific)
    if (m.includes('double_chance') || m.includes('doble oportunidad') || m.includes('doble chance')) {
        if (s.includes('1x') || (s.includes('local') && s.includes('empate'))) return homeWin || draw;
        if (s.includes('x2') || (s.includes('visita') && s.includes('empate')) || (s.includes('visitante') && s.includes('empate'))) return awayWin || draw;
        if (s.includes('12')) return homeWin || awayWin;
    }

    // 1X2 via selection
    if (s.includes('1x') || (s.includes('local') && s.includes('empate'))) return homeWin || draw;
    if (s.includes('x2') || (s.includes('visita') && s.includes('empate')) || (s.includes('visitante') && s.includes('empate'))) return awayWin || draw;
    if (s.includes('12') && !s.includes('1.2')) return homeWin || awayWin;

    // Simple 1X2
    if (m.includes('home_win') || m === '1x2') {
        if (s.includes('local') || s.includes('home') || s === '1' || s.includes('gana local')) return homeWin;
        if (s.includes('visita') || s.includes('away') || s === '2' || s.includes('gana visita')) return awayWin;
        if (s.includes('empate') || s.includes('draw') || s === 'x') return draw;
    }
    if (m === 'home_win') return homeWin;
    if (m === 'away_win') return awayWin;
    if (m === 'draw') return draw;

    // Generic 1X2 detection
    if (s === 'local' || s === 'home' || s === '1' || s.includes('gana local')) return homeWin;
    if (s === 'visitante' || s === 'visita' || s === 'away' || s === '2' || s.includes('gana visita')) return awayWin;
    if (s === 'empate' || s === 'draw' || s === 'x') return draw;

    // ═══ Draw No Bet ═══
    if (m.includes('draw no bet') || m.includes('empate no accion') || m.includes('empate no apuesta')) {
        if (draw) return null; // VOID — will be handled by caller
        if (teamsMatch(cleanHT, s)) return homeWin;
        if (teamsMatch(cleanAT, s)) return awayWin;
        if (s.includes('local') || s.includes('home')) return homeWin;
        if (s.includes('visita') || s.includes('away') || s.includes('visitante')) return awayWin;
    }

    // ═══ Clean Sheet / Portería a Cero ═══
    if (m.includes('porteria a cero') || m.includes('clean sheet') || m.includes('porteria')) {
        if (s.includes('no')) {
            if (teamsMatch(cleanHT, s)) return awayScore === 0;
            if (teamsMatch(cleanAT, s)) return homeScore === 0;
        }
        if (teamsMatch(cleanHT, s)) return awayScore === 0;
        if (teamsMatch(cleanAT, s)) return homeScore === 0;
    }

    // ═══ Ganador del Partido (1X2 with team name in market) ═══
    if (m.includes('ganador') || m.includes('1x2') || m.includes('winner') ||
        m.includes('resultado') || m.includes('match result')) {
        if (teamsMatch(cleanHT, s)) return homeWin;
        if (teamsMatch(cleanAT, s)) return awayWin;
        if (s.includes('empate') || s.includes('draw') || s === 'x') return draw;
    }

    // ═══ Team win via "gana" keyword (e.g., "PSG Gana") ═══
    if (s.includes('gana') || s.includes('win') || s.includes('victoria')) {
        if (teamsMatch(cleanHT, s)) return homeWin;
        if (teamsMatch(cleanAT, s)) return awayWin;
        if (s.includes('local') || s.includes('home')) return homeWin;
        if (s.includes('visita') || s.includes('away') || s.includes('visitante')) return awayWin;
    }

    // Team name matching for 1X2 (last resort for simple team picks)
    if (teamsMatch(cleanHT, s)) return homeWin;
    if (teamsMatch(cleanAT, s)) return awayWin;

    // ═══ Cannot determine → return null for Gemini fallback ═══
    return null;
}

// ═══════════════════════════════════════════════════════════════
// LLM FALLBACK FOR COMPLEX MARKETS (Multi-provider via llm-client)
// ═══════════════════════════════════════════════════════════════
async function evaluateWithGemini(
    market: string,
    selection: string,
    homeTeam: string,
    awayTeam: string,
    homeScore: number,
    awayScore: number,
    stats: ReturnType<typeof extractStats>
): Promise<boolean | null> {
    const prompt = `You are a sports betting verification system. Determine if the following prediction was WON or LOST based on the actual match result.

PREDICTION:
- Market: ${market}
- Selection: ${selection}
- Home Team: ${homeTeam}
- Away Team: ${awayTeam}

ACTUAL RESULT:
- Final Score: ${homeTeam} ${homeScore} - ${awayScore} ${awayTeam}
- Home Corners: ${stats.homeCorners ?? 'N/A'}
- Away Corners: ${stats.awayCorners ?? 'N/A'}
- Home Yellow Cards: ${stats.homeYellowCards ?? 'N/A'}
- Away Yellow Cards: ${stats.awayYellowCards ?? 'N/A'}
- Home Red Cards: ${stats.homeRedCards ?? 'N/A'}
- Away Red Cards: ${stats.awayRedCards ?? 'N/A'}

Answer ONLY with one word: WON, LOST, or VOID (if the bet is cancelled/pushed).`;

    try {
        const result = await callLLM(prompt, {
            temperature: 0,
            maxTokens: 10,
            timeoutMs: 10000,
        });

        const answer = result.text.trim().toUpperCase();
        console.log(`[Verifier] LLM (${result.provider}) answer: "${answer}"`);

        if (answer.includes('WON') || answer.includes('WIN')) return true;
        if (answer.includes('LOST') || answer.includes('LOSE')) return false;
        if (answer.includes('VOID') || answer.includes('PUSH')) return null;

        console.warn(`[Verifier] LLM unclear answer: "${answer}"`);
        return null;
    } catch (err: any) {
        console.error(`[Verifier] LLM fallback error: ${err.message}`);
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════
serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    const logs: string[] = [];
    const log = (msg: string) => { console.log(msg); logs.push(msg); };

    try {
        const sbUrl = Deno.env.get('SUPABASE_URL')!;
        const sbKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(sbUrl, sbKey);

        // Parse optional date from request body
        let reqBody: any = {};
        try { reqBody = await req.json().catch(() => ({})); } catch { /* ignore */ }

        const today = new Date().toISOString().split('T')[0];
        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
        const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().split('T')[0];
        // Accept both "date" and "dates" parameter names
        const rawDates = reqBody?.date || reqBody?.dates;
        const datesToCheck = rawDates
            ? (Array.isArray(rawDates) ? rawDates : [rawDates])
            : [today, yesterday, twoDaysAgo];

        log(`[Verifier] Starting verification for dates: ${datesToCheck.join(', ')}`);

        // Create verification run log
        const { data: runData } = await supabase
            .from('verification_runs')
            .insert({ run_date: today, status: 'running' })
            .select('id')
            .single();
        const runId = runData?.id;

        let totalFixturesChecked = 0;
        let totalPicksVerified = 0;
        let totalGeminiCalls = 0;
        const MAX_GEMINI_CALLS = 40;
        const processedFixtureIds = new Set<number>();

        for (const checkDate of datesToCheck) {
            log(`[Verifier] ═══ Processing date: ${checkDate} ═══`);

            // ───────────────────────────────────────────────────────────
            // STEP 1: Find pending value_picks_v2 for this date range
            // ───────────────────────────────────────────────────────────
            // Get fixture_ids from daily_matches for this date
            const { data: dailyMatches } = await supabase
                .from('daily_matches')
                .select('api_fixture_id, home_team, away_team, league_name, match_status, home_score, away_score, match_date')
                .eq('match_date', checkDate);

            if (!dailyMatches || dailyMatches.length === 0) {
                log(`[Verifier] No matches found for ${checkDate}`);
                continue;
            }

            const fixtureIds = dailyMatches.map(m => m.api_fixture_id);
            const matchMap = new Map<number, any>();
            dailyMatches.forEach(m => matchMap.set(m.api_fixture_id, m));
            log(`[Verifier] Found ${dailyMatches.length} matches for ${checkDate}, fixture IDs: ${fixtureIds.slice(0, 10).join(', ')}${fixtureIds.length > 10 ? '...' : ''}`);

            // Count existing picks BEFORE sync for diagnostics
            const { count: preCount } = await supabase
                .from('value_picks_v2')
                .select('id', { count: 'exact', head: true })
                .in('fixture_id', fixtureIds);
            log(`[Verifier] PRE-SYNC: ${preCount || 0} picks in value_picks_v2 for ${checkDate}`);

            // ───────────────────────────────────────────────────────────
            // STEP 1.5: SYNC picks from reports_v2 → value_picks_v2
            // Ensures picks that only exist in reports are available for verification
            // ───────────────────────────────────────────────────────────
            try {
                const { data: reportsForDate } = await supabase
                    .from('reports_v2')
                    .select('job_id, fixture_id, report_packet')
                    .in('fixture_id', fixtureIds);

                if (reportsForDate && reportsForDate.length > 0) {
                    const { data: existingVPs } = await supabase
                        .from('value_picks_v2')
                        .select('fixture_id, market, selection')
                        .in('fixture_id', fixtureIds);

                    const existingKeys = new Set<string>();
                    (existingVPs || []).forEach((vp: any) => {
                        existingKeys.add(`${vp.fixture_id}_${(vp.market || '').toLowerCase()}_${(vp.selection || '').toLowerCase()}`);
                    });

                    const toInsert: any[] = [];
                    for (const report of reportsForDate) {
                        let packet: any;
                        try {
                            packet = typeof report.report_packet === 'string'
                                ? JSON.parse(report.report_packet)
                                : report.report_packet;
                        } catch { continue; }
                        if (!packet) continue;

                        const pronosticos = packet.pronosticos
                            || packet.predicciones_finales?.detalle
                            || [];
                        if (!Array.isArray(pronosticos)) continue;

                        for (const p of pronosticos) {
                            // Extract probability
                            const probRaw = p.probabilidad_calculada_porcentaje
                                || p.probabilidad_estimado_porcentaje
                                || p.probabilidad_derbix
                                || p.probabilidad
                                || p.probability
                                || p.confidence_score
                                || p.confianza
                                || 0;
                            let prob = typeof probRaw === 'string'
                                ? parseFloat(probRaw.replace('%', '').replace('+', ''))
                                : probRaw;
                            if (prob > 0 && prob < 1) prob *= 100;
                            if (prob < 83) continue;

                            // Extract odds
                            const oddsRaw = p.cuota_actual || p.cuota || p.odds || p.odd || p.price || 0;
                            const odds = typeof oddsRaw === 'string' ? parseFloat(oddsRaw) : oddsRaw;
                            if (!odds || odds < 1.40) continue;

                            // Extract market & selection
                            const market = p.mercado || p.market || '';
                            const selection = p.seleccion || p.selection || '';
                            if (!market || !selection) continue;

                            const key = `${report.fixture_id}_${market.toLowerCase()}_${selection.toLowerCase()}`;
                            if (existingKeys.has(key)) continue;
                            existingKeys.add(key);

                            toInsert.push({
                                job_id: report.job_id,
                                fixture_id: report.fixture_id,
                                market,
                                selection,
                                p_model: prob / 100,
                                odds,
                                decision: 'BET',
                                confidence: 8,
                                engine_version: 'V8-SYNC-VERIFIER',
                                result: 'PENDING',
                                created_at: new Date().toISOString(),
                            });
                        }
                    }

                    if (toInsert.length > 0) {
                        const { error: syncErr } = await supabase
                            .from('value_picks_v2')
                            .insert(toInsert);
                        if (syncErr) {
                            log(`[Verifier] SYNC: Error inserting ${toInsert.length} picks: ${syncErr.message}`);
                        } else {
                            log(`[Verifier] SYNC: Inserted ${toInsert.length} missing picks from reports_v2 for ${checkDate}`);
                        }
                    }
                }
            } catch (syncError: any) {
                log(`[Verifier] SYNC reports_v2: Non-blocking error: ${syncError.message}`);
            }

            // STEP 1.6: SYNC from analisis table (legacy source C)
            // Covers cases where reports_v2 was cleaned up but analisis still has the data
            try {
                const { data: analisisRows } = await supabase
                    .from('analisis')
                    .select('partido_id, resultado_analisis')
                    .in('partido_id', fixtureIds);

                if (analisisRows && analisisRows.length > 0) {
                    // Re-fetch existing keys (may have been updated by STEP 1.5)
                    const { data: existingVPsC } = await supabase
                        .from('value_picks_v2')
                        .select('fixture_id, market, selection')
                        .in('fixture_id', fixtureIds);

                    const existingKeysC = new Set<string>();
                    (existingVPsC || []).forEach((vp: any) => {
                        existingKeysC.add(`${vp.fixture_id}_${(vp.market || '').toLowerCase()}_${(vp.selection || '').toLowerCase()}`);
                    });

                    const toInsertC: any[] = [];
                    for (const row of analisisRows) {
                        const result = row.resultado_analisis;
                        if (!result) continue;

                        const dashboard = result.dashboardData || result;
                        const preds = dashboard?.predicciones_finales?.detalle
                            || dashboard?.pronosticos
                            || [];
                        if (!Array.isArray(preds)) continue;

                        for (const p of preds) {
                            const probRaw = p.probabilidad_estimado_porcentaje
                                || p.probabilidad_calculada_porcentaje
                                || p.probabilidad_derbix
                                || p.probabilidad
                                || p.probability
                                || p.confidence_score
                                || p.confianza
                                || 0;
                            let prob = typeof probRaw === 'string'
                                ? parseFloat(probRaw.replace('%', '').replace('+', ''))
                                : probRaw;
                            if (prob > 0 && prob < 1) prob *= 100;
                            if (prob < 83) continue;

                            const oddsRaw = p.cuota_actual || p.cuota || p.odds || p.odd || p.price || 0;
                            const odds = typeof oddsRaw === 'string' ? parseFloat(oddsRaw) : oddsRaw;
                            if (!odds || odds < 1.40) continue;

                            const market = p.mercado || p.market || '';
                            const selection = p.seleccion || p.selection || '';
                            if (!market || !selection) continue;

                            const key = `${row.partido_id}_${market.toLowerCase()}_${selection.toLowerCase()}`;
                            if (existingKeysC.has(key)) continue;
                            existingKeysC.add(key);

                            toInsertC.push({
                                job_id: null,
                                fixture_id: row.partido_id,
                                market,
                                selection,
                                p_model: prob / 100,
                                odds,
                                decision: 'BET',
                                confidence: 8,
                                engine_version: 'V8-SYNC-ANALISIS',
                                result: 'PENDING',
                                created_at: new Date().toISOString(),
                            });
                        }
                    }

                    if (toInsertC.length > 0) {
                        const { error: syncErrC } = await supabase
                            .from('value_picks_v2')
                            .insert(toInsertC);
                        if (syncErrC) {
                            log(`[Verifier] SYNC analisis: Error inserting ${toInsertC.length} picks: ${syncErrC.message}`);
                        } else {
                            log(`[Verifier] SYNC analisis: Inserted ${toInsertC.length} missing picks for ${checkDate}`);
                        }
                    }
                }
            } catch (syncErrorC: any) {
                log(`[Verifier] SYNC analisis: Non-blocking error: ${syncErrorC.message}`);
            }

            // Count picks AFTER sync for diagnostics
            const { count: postCount } = await supabase
                .from('value_picks_v2')
                .select('id', { count: 'exact', head: true })
                .in('fixture_id', fixtureIds);
            log(`[Verifier] POST-SYNC: ${postCount || 0} picks in value_picks_v2 for ${checkDate} (was ${preCount || 0})`);

            // Get pending picks for these fixtures
            const { data: pendingPicks } = await supabase
                .from('value_picks_v2')
                .select('id, job_id, fixture_id, market, selection, p_model, odds, confidence')
                .in('fixture_id', fixtureIds)
                .eq('result', 'PENDING');

            if (!pendingPicks || pendingPicks.length === 0) {
                log(`[Verifier] No pending picks for ${checkDate} (${dailyMatches.length} matches, ${postCount || 0} total picks but none PENDING)`);
                continue;
            }

            log(`[Verifier] ${pendingPicks.length} pending picks across ${dailyMatches.length} matches`);

            // ───────────────────────────────────────────────────────────
            // STEP 2: Get unique fixture IDs that need score checking
            // ───────────────────────────────────────────────────────────
            const uniqueFixtureIds = [...new Set(pendingPicks.map(p => p.fixture_id))];
            const finishedStatuses = ['FT', 'AET', 'PEN', 'POSTP', 'POST', 'PST', 'CANC', 'ABD', 'AWD', 'WO'];

            // Get current bankroll ONCE before processing fixtures
            const { data: lastBankroll } = await supabase
                .from('profitability_tracking')
                .select('bankroll_after')
                .not('bankroll_after', 'is', null)
                .neq('result', 'pending')
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            let runningBankroll = lastBankroll?.bankroll_after || 100;

            for (const fixtureId of uniqueFixtureIds) {
                processedFixtureIds.add(fixtureId);
                const match = matchMap.get(fixtureId);
                if (!match) continue;

                let homeScore = match.home_score;
                let awayScore = match.away_score;
                let matchStatus = match.match_status;
                let fixtureData: any = null;

                // If match not yet finished in our DB, fetch from SportMonks
                if (!finishedStatuses.includes(matchStatus)) {
                    log(`[Verifier] Fetching fixture ${fixtureId} from SportMonks (status: ${matchStatus})`);
                    fixtureData = await getFixtureComplete(fixtureId);

                    if (!fixtureData) {
                        log(`[Verifier] Could not fetch fixture ${fixtureId}, skipping`);
                        continue;
                    }

                    const extracted = extractScores(fixtureData);
                    matchStatus = extracted.status;

                    // Update daily_matches with latest scores
                    if (extracted.homeScore !== null && extracted.awayScore !== null) {
                        homeScore = extracted.homeScore;
                        awayScore = extracted.awayScore;

                        await supabase
                            .from('daily_matches')
                            .update({
                                home_score: homeScore,
                                away_score: awayScore,
                                match_status: matchStatus
                            })
                            .eq('api_fixture_id', fixtureId)
                            .eq('match_date', checkDate);

                        log(`[Verifier] Updated daily_matches: ${match.home_team} ${homeScore}-${awayScore} ${match.away_team} (${matchStatus})`);
                    }

                    totalFixturesChecked++;

                    // Rate limit: 100ms between SportMonks calls
                    await new Promise(r => setTimeout(r, 100));
                }

                // VOID picks for postponed/cancelled/abandoned matches
                const voidStatuses = ['POSTP', 'POST', 'PST', 'CANC', 'ABD', 'AWD', 'WO'];
                if (voidStatuses.includes(matchStatus)) {
                    const voidPicks = pendingPicks.filter(p => p.fixture_id === fixtureId);
                    for (const pick of voidPicks) {
                        await supabase.from('value_picks_v2')
                            .update({ result: 'VOID', verified_at: new Date().toISOString(), actual_score: matchStatus })
                            .eq('id', pick.id);
                        await supabase.from('pick_results_v2')
                            .upsert({ pick_id: pick.id, fixture_id: fixtureId, result: 'VOID', actual_score: matchStatus,
                                league_name: match.league_name, home_team: match.home_team, away_team: match.away_team,
                                verified_at: new Date().toISOString() }, { onConflict: 'pick_id' });
                        totalPicksVerified++;
                        log(`[Verifier] VOID (${matchStatus}): ${match.home_team} vs ${match.away_team} | ${pick.market}`);
                    }
                    continue;
                }

                // Skip if match not finished yet (still playing or not started)
                if (!['FT', 'AET', 'PEN'].includes(matchStatus)) {
                    continue;
                }

                if (homeScore === null || awayScore === null) continue;

                // ───────────────────────────────────────────────────────────
                // STEP 3: Evaluate each pending pick for this fixture
                // ───────────────────────────────────────────────────────────
                const fixturePicks = pendingPicks.filter(p => p.fixture_id === fixtureId);
                const actualScore = `${homeScore}-${awayScore}`;

                // Extract stats if we fetched the fixture
                let matchStats = {
                    homeCorners: null as number | null, awayCorners: null as number | null,
                    homeYellowCards: null as number | null, awayYellowCards: null as number | null,
                    homeRedCards: null as number | null, awayRedCards: null as number | null,
                    homeShotsOnTarget: null as number | null, awayShotsOnTarget: null as number | null,
                };

                if (fixtureData) {
                    matchStats = extractStats(fixtureData);
                } else {
                    // If we didn't fetch (match already finished in DB), fetch now for stats
                    const fullData = await getFixtureComplete(fixtureId);
                    if (fullData) {
                        matchStats = extractStats(fullData);
                        totalFixturesChecked++;
                        await new Promise(r => setTimeout(r, 100));
                    }
                }

                for (const pick of fixturePicks) {
                    // Try rule-based evaluation first
                    let isWon = evaluatePickResult(
                        pick.market,
                        pick.selection,
                        homeScore,
                        awayScore,
                        match.home_team,
                        match.away_team,
                        matchStats
                    );

                    let method: 'rule-based' | 'gemini' | 'skip' = 'rule-based';

                    // Gemini fallback for complex markets
                    if (isWon === null && totalGeminiCalls < MAX_GEMINI_CALLS) {
                        log(`[Verifier] Gemini fallback for: ${pick.market} | ${pick.selection}`);
                        isWon = await evaluateWithGemini(
                            pick.market,
                            pick.selection,
                            match.home_team,
                            match.away_team,
                            homeScore,
                            awayScore,
                            matchStats
                        );
                        totalGeminiCalls++;
                        method = 'gemini';
                    }

                    if (isWon === null) {
                        log(`[Verifier] SKIP (pending): Cannot evaluate ${pick.market} | ${pick.selection} — will retry next run`);
                        // DON'T mark as VOID — leave as PENDING for next run
                        // VOID is only for postponed/cancelled matches (handled above)
                        continue;
                    }

                    const result = isWon ? 'WON' : 'LOST';

                    // Update value_picks_v2
                    await supabase
                        .from('value_picks_v2')
                        .update({
                            result,
                            verified_at: new Date().toISOString(),
                            actual_score: actualScore
                        })
                        .eq('id', pick.id);

                    // Insert/update pick_results_v2
                    await supabase
                        .from('pick_results_v2')
                        .upsert({
                            pick_id: pick.id,
                            fixture_id: fixtureId,
                            result,
                            actual_score: actualScore,
                            league_name: match.league_name,
                            home_team: match.home_team,
                            away_team: match.away_team,
                            verified_at: new Date().toISOString()
                        }, { onConflict: 'pick_id' });

                    // V9: Create/update entry in ml_verified_picks so admin can approve for learning.
                    // CRITICAL: on re-verification, do NOT overwrite admin fields (approved_for_learning,
                    // admin_verdict). Only update system_* fields via a two-step check.
                    const { data: existingVerified } = await supabase
                        .from('ml_verified_picks')
                        .select('id')
                        .eq('pick_id', pick.id)
                        .maybeSingle();

                    if (existingVerified) {
                        // Update only system fields; leave admin_* untouched
                        await supabase
                            .from('ml_verified_picks')
                            .update({
                                system_verdict: result,
                                system_verified_at: new Date().toISOString(),
                            })
                            .eq('pick_id', pick.id);
                    } else {
                        await supabase
                            .from('ml_verified_picks')
                            .insert({
                                pick_id: pick.id,
                                fixture_id: fixtureId,
                                market: pick.market,
                                selection: pick.selection,
                                predicted_probability: pick.p_model,
                                odds: pick.odds,
                                system_verdict: result,
                                system_verified_at: new Date().toISOString(),
                                approved_for_learning: false,
                                processed_for_learning: false,
                            });
                    }

                    // Update SEO page with results (best-effort, non-blocking)
                    try {
                        const scores = actualScore ? actualScore.split('-').map((s: string) => parseInt(s.trim())) : [];
                        await supabase
                            .from('seo_pages')
                            .update({
                                has_results: true,
                                home_score: scores[0] ?? null,
                                away_score: scores[1] ?? null,
                                result_correct: result === 'WON',
                            })
                            .eq('fixture_id', fixtureId);
                    } catch (_seoErr) {
                        // Non-critical — SEO page update failure doesn't block verification
                    }

                    // ───────────────────────────────────────────────────────
                    // STEP 4: Update profitability_tracking
                    // ONLY for Oportunidades: p_model >= OPPORTUNITIES_THRESHOLD AND odds >= 1.40
                    // ───────────────────────────────────────────────────────
                    try {
                        const pickProb = pick.p_model > 1 ? pick.p_model / 100 : pick.p_model;
                        const isOportunidad = pickProb >= OPPORTUNITIES_THRESHOLD && pick.odds && pick.odds >= 1.40;

                        if (isOportunidad) {
                            const pickIdentifier = `${pick.job_id}_${pick.market}_${pick.selection}`;

                            // Check if ALREADY exists in profitability_tracking (any result)
                            const { data: existingAny } = await supabase
                                .from('profitability_tracking')
                                .select('id, result, stake_amount, odds')
                                .eq('fixture_id', fixtureId)
                                .or(`pick_id.eq.${pickIdentifier},pick_id.eq.vp_${pickIdentifier}`)
                                .limit(1)
                                .maybeSingle();

                            if (existingAny) {
                                // Already tracked — update only if still pending
                                if (existingAny.result === 'pending') {
                                    const profitLoss = isWon
                                        ? existingAny.stake_amount * ((existingAny.odds || 1) - 1)
                                        : -existingAny.stake_amount;
                                    runningBankroll += profitLoss;

                                    await supabase
                                        .from('profitability_tracking')
                                        .update({
                                            result: result.toLowerCase(),
                                            profit_loss: profitLoss,
                                            bankroll_after: runningBankroll,
                                            verified_at: new Date().toISOString()
                                        })
                                        .eq('id', existingAny.id);
                                }
                                // If already verified (won/lost), skip entirely — prevents duplicates
                            } else {
                                // Register + verify in one shot with FLAT staking
                                const { percentage, tier } = calculateStake('oportunidad');
                                const stakeAmount = (runningBankroll * percentage) / 100;
                                const profitLoss = isWon ? stakeAmount * (pick.odds - 1) : -stakeAmount;
                                runningBankroll += profitLoss;

                                await supabase
                                    .from('profitability_tracking')
                                    .insert({
                                        date: checkDate,
                                        pick_id: pickIdentifier,
                                        job_id: pick.job_id,
                                        fixture_id: fixtureId,
                                        home_team: match.home_team,
                                        away_team: match.away_team,
                                        market: pick.market,
                                        selection: pick.selection,
                                        odds: pick.odds,
                                        probability: pickProb * 100,
                                        confidence_tier: tier,
                                        stake_percentage: percentage,
                                        stake_amount: stakeAmount,
                                        result: result.toLowerCase(),
                                        profit_loss: profitLoss,
                                        bankroll_after: runningBankroll,
                                        pick_type: 'oportunidad',
                                        verified_at: new Date().toISOString()
                                    });
                            }
                        }
                    } catch (profitErr: any) {
                        log(`[Verifier] Profitability update failed (non-blocking): ${profitErr.message}`);
                    }

                    totalPicksVerified++;
                    log(`[Verifier] ${result} (${method}): ${match.home_team} vs ${match.away_team} | ${pick.market} → ${pick.selection} | Score: ${actualScore}`);
                }
            }

        }

        // ───────────────────────────────────────────────────────────
        // STEP 6: CATCH-UP PASS — Verify ALL globally PENDING picks
        // Catches picks from dates beyond the normal 3-day window
        // ───────────────────────────────────────────────────────────
        try {
            log(`[Verifier] ═══ CATCH-UP: Scanning ALL pending picks globally ═══`);

            const { data: globalPending } = await supabase
                .from('value_picks_v2')
                .select('id, job_id, fixture_id, market, selection, p_model, odds, confidence')
                .eq('result', 'PENDING')
                .limit(500);

            // Filter out fixtures already processed in the main loop
            const catchupPicks = (globalPending || []).filter(
                (p: any) => !processedFixtureIds.has(p.fixture_id)
            );
            const catchupFixtureIds = [...new Set(catchupPicks.map((p: any) => p.fixture_id))];

            if (catchupFixtureIds.length > 0) {
                log(`[Verifier] CATCH-UP: ${catchupPicks.length} pending picks across ${catchupFixtureIds.length} unprocessed fixtures`);

                // Limit to 50 fixtures per run to avoid timeouts
                const fixturesToProcess = catchupFixtureIds.slice(0, 50);

                // Get daily_matches info (no date filter — any date)
                const { data: catchupMatches } = await supabase
                    .from('daily_matches')
                    .select('api_fixture_id, home_team, away_team, league_name, match_status, home_score, away_score, match_date')
                    .in('api_fixture_id', fixturesToProcess);

                if (catchupMatches && catchupMatches.length > 0) {
                    const catchupMatchMap = new Map<number, any>();
                    catchupMatches.forEach((m: any) => catchupMatchMap.set(m.api_fixture_id, m));

                    const finishedStatuses = ['FT', 'AET', 'PEN', 'POSTP', 'POST', 'PST', 'CANC', 'ABD', 'AWD', 'WO'];
                    const voidStatuses = ['POSTP', 'POST', 'PST', 'CANC', 'ABD', 'AWD', 'WO'];

                    // Get running bankroll for profitability tracking
                    const { data: latestBankroll } = await supabase
                        .from('profitability_tracking')
                        .select('bankroll_after')
                        .not('bankroll_after', 'is', null)
                        .neq('result', 'pending')
                        .order('created_at', { ascending: false })
                        .limit(1)
                        .maybeSingle();
                    let catchupBankroll = latestBankroll?.bankroll_after || 100;

                    for (const fixtureId of fixturesToProcess) {
                        const match = catchupMatchMap.get(fixtureId);
                        if (!match) continue;

                        let homeScore = match.home_score;
                        let awayScore = match.away_score;
                        let matchStatus = match.match_status;
                        let fixtureData: any = null;

                        // If match not finished in DB, fetch from SportMonks
                        if (!finishedStatuses.includes(matchStatus)) {
                            fixtureData = await getFixtureComplete(fixtureId);
                            if (!fixtureData) continue;

                            const extracted = extractScores(fixtureData);
                            matchStatus = extracted.status;

                            if (extracted.homeScore !== null && extracted.awayScore !== null) {
                                homeScore = extracted.homeScore;
                                awayScore = extracted.awayScore;
                                await supabase
                                    .from('daily_matches')
                                    .update({ home_score: homeScore, away_score: awayScore, match_status: matchStatus })
                                    .eq('api_fixture_id', fixtureId)
                                    .eq('match_date', match.match_date);
                            }
                            totalFixturesChecked++;
                            await new Promise(r => setTimeout(r, 100));
                        }

                        // VOID picks for postponed/cancelled matches
                        if (voidStatuses.includes(matchStatus)) {
                            const voidPicks = catchupPicks.filter((p: any) => p.fixture_id === fixtureId);
                            for (const pick of voidPicks) {
                                await supabase.from('value_picks_v2')
                                    .update({ result: 'VOID', verified_at: new Date().toISOString(), actual_score: matchStatus })
                                    .eq('id', pick.id);
                                await supabase.from('pick_results_v2')
                                    .upsert({ pick_id: pick.id, fixture_id: fixtureId, result: 'VOID', actual_score: matchStatus,
                                        league_name: match.league_name, home_team: match.home_team, away_team: match.away_team,
                                        verified_at: new Date().toISOString() }, { onConflict: 'pick_id' });
                                totalPicksVerified++;
                                log(`[Verifier] CATCH-UP VOID (${matchStatus}): ${match.home_team} vs ${match.away_team} | ${pick.market}`);
                            }
                            continue;
                        }

                        // Skip if not finished
                        if (!['FT', 'AET', 'PEN'].includes(matchStatus)) continue;
                        if (homeScore === null || awayScore === null) continue;

                        const fixturePicks = catchupPicks.filter((p: any) => p.fixture_id === fixtureId);
                        const actualScore = `${homeScore}-${awayScore}`;

                        // Get stats
                        let matchStats = {
                            homeCorners: null as number | null, awayCorners: null as number | null,
                            homeYellowCards: null as number | null, awayYellowCards: null as number | null,
                            homeRedCards: null as number | null, awayRedCards: null as number | null,
                            homeShotsOnTarget: null as number | null, awayShotsOnTarget: null as number | null,
                        };
                        if (fixtureData) {
                            matchStats = extractStats(fixtureData);
                        } else {
                            const fullData = await getFixtureComplete(fixtureId);
                            if (fullData) {
                                matchStats = extractStats(fullData);
                                totalFixturesChecked++;
                                await new Promise(r => setTimeout(r, 100));
                            }
                        }

                        for (const pick of fixturePicks) {
                            let isWon = evaluatePickResult(
                                pick.market, pick.selection,
                                homeScore, awayScore,
                                match.home_team, match.away_team,
                                matchStats
                            );

                            let method: 'rule-based' | 'gemini' = 'rule-based';

                            if (isWon === null && totalGeminiCalls < MAX_GEMINI_CALLS) {
                                isWon = await evaluateWithGemini(
                                    pick.market, pick.selection,
                                    match.home_team, match.away_team,
                                    homeScore, awayScore, matchStats
                                );
                                totalGeminiCalls++;
                                method = 'gemini';
                            }

                            if (isWon === null) {
                                log(`[Verifier] CATCH-UP SKIP: ${pick.market} | ${pick.selection}`);
                                continue;
                            }

                            const result = isWon ? 'WON' : 'LOST';

                            await supabase.from('value_picks_v2')
                                .update({ result, verified_at: new Date().toISOString(), actual_score: actualScore })
                                .eq('id', pick.id);

                            await supabase.from('pick_results_v2')
                                .upsert({
                                    pick_id: pick.id, fixture_id: fixtureId, result, actual_score: actualScore,
                                    league_name: match.league_name, home_team: match.home_team, away_team: match.away_team,
                                    verified_at: new Date().toISOString()
                                }, { onConflict: 'pick_id' });

                            // Profitability tracking (same logic as main loop)
                            try {
                                const pickProb = pick.p_model > 1 ? pick.p_model / 100 : pick.p_model;
                                const isOportunidad = pickProb >= OPPORTUNITIES_THRESHOLD && pick.odds && pick.odds >= 1.40;

                                if (isOportunidad) {
                                    const pickIdentifier = `${pick.job_id}_${pick.market}_${pick.selection}`;
                                    const { data: existingAny } = await supabase
                                        .from('profitability_tracking')
                                        .select('id, result, stake_amount, odds')
                                        .eq('fixture_id', fixtureId)
                                        .or(`pick_id.eq.${pickIdentifier},pick_id.eq.vp_${pickIdentifier}`)
                                        .limit(1)
                                        .maybeSingle();

                                    if (existingAny) {
                                        if (existingAny.result === 'pending') {
                                            const profitLoss = isWon
                                                ? existingAny.stake_amount * ((existingAny.odds || 1) - 1)
                                                : -existingAny.stake_amount;
                                            catchupBankroll += profitLoss;
                                            await supabase.from('profitability_tracking')
                                                .update({ result: result.toLowerCase(), profit_loss: profitLoss,
                                                    bankroll_after: catchupBankroll, verified_at: new Date().toISOString() })
                                                .eq('id', existingAny.id);
                                        }
                                    } else {
                                        const { percentage, tier } = calculateStake('oportunidad');
                                        const stakeAmount = (catchupBankroll * percentage) / 100;
                                        const profitLoss = isWon ? stakeAmount * (pick.odds - 1) : -stakeAmount;
                                        catchupBankroll += profitLoss;
                                        await supabase.from('profitability_tracking')
                                            .insert({
                                                date: match.match_date, pick_id: pickIdentifier, job_id: pick.job_id,
                                                fixture_id: fixtureId, home_team: match.home_team, away_team: match.away_team,
                                                market: pick.market, selection: pick.selection, odds: pick.odds,
                                                probability: pickProb * 100, confidence_tier: tier,
                                                stake_percentage: percentage, stake_amount: stakeAmount,
                                                result: result.toLowerCase(), profit_loss: profitLoss,
                                                bankroll_after: catchupBankroll, pick_type: 'oportunidad',
                                                verified_at: new Date().toISOString()
                                            });
                                    }
                                }
                            } catch (profitErr: any) {
                                log(`[Verifier] CATCH-UP profitability error (non-blocking): ${profitErr.message}`);
                            }

                            totalPicksVerified++;
                            log(`[Verifier] CATCH-UP ${result} (${method}): ${match.home_team} vs ${match.away_team} | ${pick.market} → ${pick.selection} | Score: ${actualScore}`);
                        }
                    }
                }
            } else {
                log(`[Verifier] CATCH-UP: No additional pending picks found`);
            }
        } catch (catchupErr: any) {
            log(`[Verifier] CATCH-UP error (non-blocking): ${catchupErr.message}`);
        }

        // ───────────────────────────────────────────────────────────
        // STEP 7: Update verification run log
        // ───────────────────────────────────────────────────────────
        const finalStatus = totalPicksVerified > 0 ? 'success' : 'partial';

        if (runId) {
            await supabase
                .from('verification_runs')
                .update({
                    completed_at: new Date().toISOString(),
                    fixtures_checked: totalFixturesChecked,
                    picks_verified: totalPicksVerified,
                    gemini_calls: totalGeminiCalls,
                    status: finalStatus,
                    details: { dates: datesToCheck, logs: logs.slice(-20) }
                })
                .eq('id', runId);
        }

        log(`[Verifier] ═══ DONE: ${totalFixturesChecked} fixtures checked, ${totalPicksVerified} picks verified, ${totalGeminiCalls} Gemini calls ═══`);

        // === TRIGGER WHATSAPP: Resultados del día ===
        if (finalStatus === 'success' && totalPicksVerified > 0) {
            try {
                const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
                const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
                log(`[Verifier] Triggering WhatsApp results notification...`);
                fetch(`${supabaseUrl}/functions/v1/send-whatsapp-notification`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${supabaseServiceKey}`,
                    },
                    body: JSON.stringify({
                        notification_type: 'daily_results',
                        data: {
                            date: today,
                            picks_verified: totalPicksVerified,
                        }
                    }),
                }).catch(() => {}); // Fire-and-forget
                log(`[Verifier] WhatsApp trigger sent`);
            } catch (waErr: any) {
                log(`[Verifier] WhatsApp trigger error (non-blocking): ${waErr.message}`);
            }
        }

        return new Response(JSON.stringify({
            success: true,
            fixtures_checked: totalFixturesChecked,
            picks_verified: totalPicksVerified,
            gemini_calls: totalGeminiCalls,
            dates: datesToCheck,
            debug_logs: logs
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    } catch (e: any) {
        log(`[Verifier] FATAL ERROR: ${e.message}`);
        return new Response(JSON.stringify({
            success: false,
            error: e.message,
            debug_logs: logs
        }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
});
