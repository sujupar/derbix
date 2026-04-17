// _shared/sportmonks-enrichers.ts
// V9 ENRICHMENT: Normalizers for lineups, coaches, weather, xG, player stats
// These data points are now fed into the analyzer pipeline (previously discarded).

// ═══════════════════════════════════════════════════════════════
// LINEUPS — Confirmed starting XI and substitutes
// ═══════════════════════════════════════════════════════════════

export interface NormalizedLineup {
  formation: string | null;
  starters: Array<{
    player_id: number;
    player_name: string;
    position: string | null;
    jersey_number: number | null;
    captain: boolean;
  }>;
  substitutes: Array<{
    player_id: number;
    player_name: string;
    position: string | null;
  }>;
  has_confirmed_lineup: boolean;
}

export function normalizeLineups(
  fixture: any,
  homeTeamId: number,
  awayTeamId: number
): { home: NormalizedLineup; away: NormalizedLineup } {
  const empty: NormalizedLineup = {
    formation: null, starters: [], substitutes: [], has_confirmed_lineup: false,
  };

  const lineups = fixture?.lineups || [];
  if (!Array.isArray(lineups) || lineups.length === 0) {
    return { home: { ...empty }, away: { ...empty } };
  }

  const extractTeamLineup = (teamId: number): NormalizedLineup => {
    const teamLineups = lineups.filter((l: any) => l.team_id === teamId);
    if (teamLineups.length === 0) return { ...empty };

    const starters = teamLineups
      .filter((l: any) => l.type_id === 11 || l.lineup_type === 'lineup')
      .map((l: any) => ({
        player_id: l.player_id,
        player_name: l.player_name || l.player?.name || 'Unknown',
        position: l.position?.name || l.position_id || null,
        jersey_number: l.jersey_number || null,
        captain: !!l.captain,
      }));

    const substitutes = teamLineups
      .filter((l: any) => l.type_id === 12 || l.lineup_type === 'bench')
      .map((l: any) => ({
        player_id: l.player_id,
        player_name: l.player_name || l.player?.name || 'Unknown',
        position: l.position?.name || l.position_id || null,
      }));

    const formation = fixture?.formations?.find((f: any) => f.team_id === teamId)?.formation || null;

    return {
      formation,
      starters,
      substitutes,
      has_confirmed_lineup: starters.length >= 10,
    };
  };

  return {
    home: extractTeamLineup(homeTeamId),
    away: extractTeamLineup(awayTeamId),
  };
}

// ═══════════════════════════════════════════════════════════════
// COACHES — Tactical philosophy and recent history
// ═══════════════════════════════════════════════════════════════

export interface NormalizedCoach {
  id: number | null;
  name: string;
  nationality: string | null;
  date_of_birth: string | null;
  team_since: string | null;  // when this coach took this team
  is_new_coach: boolean;      // < 60 days (luna de miel effect)
}

export function normalizeCoaches(
  fixture: any,
  homeTeamId: number,
  awayTeamId: number
): { home: NormalizedCoach | null; away: NormalizedCoach | null } {
  const coaches = fixture?.coaches || [];
  if (!Array.isArray(coaches) || coaches.length === 0) {
    return { home: null, away: null };
  }

  const extract = (teamId: number): NormalizedCoach | null => {
    const coach = coaches.find((c: any) => c.meta?.team_id === teamId || c.team_id === teamId);
    if (!coach) return null;

    const teamSince = coach.meta?.start_date || null;
    const isNew = teamSince
      ? (Date.now() - new Date(teamSince).getTime()) < (60 * 24 * 60 * 60 * 1000)
      : false;

    return {
      id: coach.id || null,
      name: coach.name || coach.display_name || 'Unknown',
      nationality: coach.nationality?.name || null,
      date_of_birth: coach.date_of_birth || null,
      team_since: teamSince,
      is_new_coach: isNew,
    };
  };

  return {
    home: extract(homeTeamId),
    away: extract(awayTeamId),
  };
}

// ═══════════════════════════════════════════════════════════════
// WEATHER — Impact on game style
// ═══════════════════════════════════════════════════════════════

export interface NormalizedWeather {
  description: string | null;
  temperature_celsius: number | null;
  wind_speed_kmh: number | null;
  humidity_pct: number | null;
  pressure_hpa: number | null;
  clouds_pct: number | null;
  rainfall_mm: number | null;
  impact_factors: {
    rain_heavy: boolean;        // -0.3 goles esperados
    wind_strong: boolean;       // +15% corners variance
    temp_extreme: boolean;      // -0.15 goles
    altitude_high: boolean;     // +0.4 home advantage
  };
}

export function normalizeWeather(fixture: any, venueAltitude?: number): NormalizedWeather | null {
  const weather = fixture?.weatherReport || fixture?.weather_report;
  if (!weather) return null;

  const temp = weather.temperature?.celsius ?? weather.temperature_celsius ?? null;
  const wind = weather.wind?.speed ?? weather.wind_speed ?? null;
  const rain = weather.rain?.['1h'] ?? weather.rain_mm ?? 0;

  const impact = {
    rain_heavy: rain >= 5,  // >5mm/h = heavy rain
    wind_strong: wind !== null && wind >= 30,  // >30 km/h
    temp_extreme: temp !== null && (temp < 5 || temp > 30),
    altitude_high: (venueAltitude ?? 0) > 2500,
  };

  return {
    description: weather.description || weather.type || null,
    temperature_celsius: temp,
    wind_speed_kmh: wind,
    humidity_pct: weather.humidity ?? null,
    pressure_hpa: weather.pressure ?? null,
    clouds_pct: weather.clouds ?? null,
    rainfall_mm: rain,
    impact_factors: impact,
  };
}

// ═══════════════════════════════════════════════════════════════
// xG (Expected Goals) — The #1 KPI in modern football analytics
// ═══════════════════════════════════════════════════════════════

export interface TeamXGStats {
  xg_for_avg: number;      // xG average per match
  xga_avg: number;         // xG against average
  xg_diff: number;         // xG - xGA
  xg_overperformance: number;  // actual goals - xG (positive = lucky, negative = unlucky)
  sample_size: number;
}

/**
 * Compute rolling xG from match history (last N matches).
 * Works with BOTH raw SportMonks format and normalized V9 format.
 * Falls back to shots on target × 0.33 when xG is not available.
 */
export function computeTeamXGRolling(
  history: any[],
  teamId: number,
  window: number = 10
): TeamXGStats {
  const recent = history.slice(0, window);
  if (recent.length === 0) {
    return { xg_for_avg: 0, xga_avg: 0, xg_diff: 0, xg_overperformance: 0, sample_size: 0 };
  }

  let totalXGFor = 0, totalXGAgainst = 0, totalGoalsFor = 0;
  let count = 0;

  for (const match of recent) {
    // Detect format: normalized has was_home + details; raw has participants
    const isNormalized = match.was_home !== undefined && match.details !== undefined;

    let isHome: boolean;
    let myGoals = 0;
    let mySOT = 0, theirSOT = 0;
    let xgFor: number | null = null, xgAgainst: number | null = null;

    if (isNormalized) {
      // Normalized V9 format (from normalizeDetailedMatchHistory)
      isHome = match.was_home === true;
      myGoals = isHome ? (match.score_home ?? 0) : (match.score_away ?? 0);
      const d = match.details || {};
      mySOT = d.shots_on_target ?? 0;
      theirSOT = d.opponent_shots_on_target ?? 0;
      // xG rarely present in normalized form; use SOT fallback
    } else {
      // Raw SportMonks format
      const participants = match.participants || [];
      isHome = participants.find((p: any) => p.id === teamId)?.meta?.location === 'home';

      const xgData = match.xGFixture;
      if (xgData) {
        if (Array.isArray(xgData)) {
          const ourXG = xgData.find((x: any) => x.team_id === teamId);
          const theirXG = xgData.find((x: any) => x.team_id !== teamId);
          xgFor = ourXG?.xg ?? ourXG?.expected_goals ?? null;
          xgAgainst = theirXG?.xg ?? theirXG?.expected_goals ?? null;
        } else if (typeof xgData === 'object') {
          xgFor = isHome ? (xgData.home_xg ?? null) : (xgData.away_xg ?? null);
          xgAgainst = isHome ? (xgData.away_xg ?? null) : (xgData.home_xg ?? null);
        }
      }

      const stats = match.statistics || [];
      const ourStats = stats.filter((s: any) => s.participant_id === teamId || s.team_id === teamId);
      const theirStats = stats.filter((s: any) => s.participant_id !== teamId && s.team_id !== teamId);
      mySOT = ourStats.find((s: any) => s.type?.name === 'Shots On Target' || s.type_id === 86)?.data?.value ?? 0;
      theirSOT = theirStats.find((s: any) => s.type?.name === 'Shots On Target' || s.type_id === 86)?.data?.value ?? 0;

      const scores = match.scores || [];
      const ourGoalsEntry = scores.find((s: any) =>
        s.description === 'CURRENT' &&
        ((isHome && s.score?.participant === 'home') || (!isHome && s.score?.participant === 'away'))
      );
      myGoals = ourGoalsEntry?.score?.goals ?? 0;
    }

    if (xgFor === null) xgFor = mySOT * 0.33;
    if (xgAgainst === null) xgAgainst = theirSOT * 0.33;

    totalXGFor += xgFor;
    totalXGAgainst += xgAgainst;
    totalGoalsFor += myGoals;
    count++;
  }

  if (count === 0) {
    return { xg_for_avg: 0, xga_avg: 0, xg_diff: 0, xg_overperformance: 0, sample_size: 0 };
  }

  const xgForAvg = totalXGFor / count;
  const xgaAvg = totalXGAgainst / count;
  const actualGoalsAvg = totalGoalsFor / count;

  return {
    xg_for_avg: Math.round(xgForAvg * 100) / 100,
    xga_avg: Math.round(xgaAvg * 100) / 100,
    xg_diff: Math.round((xgForAvg - xgaAvg) * 100) / 100,
    xg_overperformance: Math.round((actualGoalsAvg - xgForAvg) * 100) / 100,
    sample_size: count,
  };
}

// ═══════════════════════════════════════════════════════════════
// PLAYER STATS — Key player availability and impact
// ═══════════════════════════════════════════════════════════════

export interface KeyPlayerImpact {
  team_id: number;
  top_scorer: { name: string; goals: number } | null;
  top_assister: { name: string; assists: number } | null;
  key_defender: { name: string; clean_sheets: number } | null;
  missing_key_players: Array<{ name: string; role: string; reason: string }>;
  impact_score: number;  // 0-100, lower = more impact from absences
}

/**
 * Computes key player availability from sidelined list + recent history scorers.
 */
export function computeKeyPlayerImpact(
  teamId: number,
  history: any[],
  sidelined: any[],
  lineup: NormalizedLineup
): KeyPlayerImpact {
  // Extract top scorers from recent events
  const scorerCounts: Record<string, { name: string; goals: number }> = {};
  const assisterCounts: Record<string, { name: string; assists: number }> = {};

  for (const match of history.slice(0, 10)) {
    // Events can be in two shapes:
    //  - Normalized V9: match.details.events = [{ minute, type, player, related_player }]
    //  - Raw SportMonks: match.events = [{ type_id, participant_id, player_name, ... }]
    const normalizedEvents = match.details?.events;
    const rawEvents = match.events;
    const events = Array.isArray(normalizedEvents) ? normalizedEvents : (Array.isArray(rawEvents) ? rawEvents : []);

    for (const e of events) {
      const typeStr = String(e.type || e.type?.name || '').toLowerCase();
      const isGoal = typeStr.includes('goal') || e.type_id === 14;
      if (!isGoal) continue;

      // Normalized format has player as string; raw has participant_id + player_name
      const isOurGoal = rawEvents ? e.participant_id === teamId : true;  // normalized is already filtered
      if (!isOurGoal) continue;

      const name = e.player || e.player_name || e.player?.name || 'Unknown';
      if (!name || name === 'Unknown') continue;
      const pid = String(name).toLowerCase();
      scorerCounts[pid] = scorerCounts[pid] || { name, goals: 0 };
      scorerCounts[pid].goals++;

      const assistName = e.related_player || e.related_player_name;
      if (assistName) {
        const apid = String(assistName).toLowerCase();
        assisterCounts[apid] = assisterCounts[apid] || { name: assistName, assists: 0 };
        assisterCounts[apid].assists++;
      }
    }
  }

  const topScorer = Object.values(scorerCounts).sort((a, b) => b.goals - a.goals)[0] || null;
  const topAssister = Object.values(assisterCounts).sort((a, b) => b.assists - a.assists)[0] || null;

  // Check if top scorer is missing
  const starterNames = new Set(lineup.starters.map((s) => s.player_name.toLowerCase()));
  const sidelinedNames = sidelined.map((s: any) => (s.player?.name || s.player_name || '').toLowerCase());

  const missing: Array<{ name: string; role: string; reason: string }> = [];

  if (topScorer && !starterNames.has(topScorer.name.toLowerCase())) {
    const reason = sidelinedNames.includes(topScorer.name.toLowerCase())
      ? sidelined.find((s: any) => (s.player?.name || '').toLowerCase() === topScorer.name.toLowerCase())?.reason || 'Injury'
      : 'Not in starting lineup';
    missing.push({ name: topScorer.name, role: `Top Scorer (${topScorer.goals}g last 10)`, reason });
  }

  if (topAssister && !starterNames.has(topAssister.name.toLowerCase())) {
    const reason = sidelinedNames.includes(topAssister.name.toLowerCase()) ? 'Injury' : 'Not starting';
    missing.push({ name: topAssister.name, role: `Top Assister`, reason });
  }

  // Add all sidelined to missing list
  for (const s of sidelined) {
    const name = s.player?.name || s.player_name;
    if (name && !missing.find((m) => m.name === name)) {
      missing.push({
        name,
        role: s.player?.position?.name || 'Player',
        reason: s.reason || s.description || 'Sidelined',
      });
    }
  }

  // Impact score: 100 = no impact, drops by 15-30 per missing key player
  let impactScore = 100;
  for (const m of missing) {
    if (m.role.includes('Top Scorer')) impactScore -= 30;
    else if (m.role.includes('Top Assister')) impactScore -= 20;
    else impactScore -= 8;
  }
  impactScore = Math.max(0, impactScore);

  return {
    team_id: teamId,
    top_scorer: topScorer,
    top_assister: topAssister,
    key_defender: null,  // TODO: compute from clean sheets in lineup
    missing_key_players: missing,
    impact_score: impactScore,
  };
}

// ═══════════════════════════════════════════════════════════════
// FATIGUE — Match congestion index
// ═══════════════════════════════════════════════════════════════

export interface FatigueIndex {
  matches_last_7_days: number;
  matches_last_14_days: number;
  days_since_last_match: number;
  has_european_midweek: boolean;   // played Tue/Wed in Champions/Europa
  travel_km_last_7_days: number;   // approximate, 0 if not computable
  fatigue_score: number;           // 0-100, higher = more fatigued
}

export function computeFatigueIndex(history: any[], upcomingDate: string): FatigueIndex {
  const upcoming = new Date(upcomingDate);
  let matchesIn7 = 0;
  let matchesIn14 = 0;
  let lastMatchDate: Date | null = null;
  let europeanMidweek = false;

  for (const m of history) {
    const matchDate = new Date(m.starting_at || m.date || m.date_time_utc);
    if (isNaN(matchDate.getTime())) continue;

    const daysBefore = (upcoming.getTime() - matchDate.getTime()) / (24 * 60 * 60 * 1000);
    if (daysBefore > 0 && daysBefore <= 7) matchesIn7++;
    if (daysBefore > 0 && daysBefore <= 14) matchesIn14++;

    if (!lastMatchDate || matchDate > lastMatchDate) {
      if (matchDate <= upcoming) lastMatchDate = matchDate;
    }

    // European midweek: Champions/Europa on Tue/Wed within 7 days
    if (daysBefore > 0 && daysBefore <= 7) {
      const leagueName = (m.league?.name || '').toLowerCase();
      const day = matchDate.getDay();  // 2=Tue, 3=Wed
      if ((leagueName.includes('champions') || leagueName.includes('europa')) && (day === 2 || day === 3)) {
        europeanMidweek = true;
      }
    }
  }

  const daysSince = lastMatchDate
    ? Math.floor((upcoming.getTime() - lastMatchDate.getTime()) / (24 * 60 * 60 * 1000))
    : 999;

  // Fatigue score: 0 = rested, 100 = overloaded
  let score = 0;
  if (matchesIn7 >= 3) score += 40;
  else if (matchesIn7 === 2) score += 20;
  if (matchesIn14 >= 5) score += 25;
  if (daysSince < 3) score += 25;
  else if (daysSince < 4) score += 10;
  if (europeanMidweek) score += 15;
  score = Math.min(100, score);

  return {
    matches_last_7_days: matchesIn7,
    matches_last_14_days: matchesIn14,
    days_since_last_match: daysSince,
    has_european_midweek: europeanMidweek,
    travel_km_last_7_days: 0,  // requires venue coords, skip for now
    fatigue_score: score,
  };
}
