// _shared/math-models/dixon-coles.ts
// Dixon-Coles (1997) model — academic benchmark for football match prediction.
// Corrects Poisson's underestimation of low-scoring outcomes (0-0, 1-0, 0-1, 1-1).

export interface TeamForm {
  teamId: number;
  teamName: string;
  matchesPlayed: number;
  goalsFor: number;
  goalsAgainst: number;
  homeGoalsFor: number;     // as home
  homeGoalsAgainst: number;
  awayGoalsFor: number;     // as away
  awayGoalsAgainst: number;
}

export interface DixonColesResult {
  lambdaHome: number;
  lambdaAway: number;
  rho: number;
  scorelineMatrix: number[][];  // P[homeGoals][awayGoals]
  probabilities: {
    home_win: number;
    draw: number;
    away_win: number;
    over_05: number; over_15: number; over_25: number; over_35: number; over_45: number;
    under_05: number; under_15: number; under_25: number; under_35: number; under_45: number;
    btts_yes: number; btts_no: number;
    home_over_05: number; home_over_15: number; home_over_25: number;
    away_over_05: number; away_over_15: number; away_over_25: number;
    // Double chance
    home_or_draw: number;     // 1X
    away_or_draw: number;     // X2
    home_or_away: number;     // 12
    // Most likely scorelines
    most_likely_scorelines: Array<{ score: string; probability: number }>;
  };
  expected_total_goals: number;
  sample_size: { home: number; away: number };
}

/**
 * Poisson PMF: P(X=k | λ) = λ^k * e^-λ / k!
 */
function poisson(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = k * Math.log(lambda) - lambda;
  for (let i = 2; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

/**
 * Dixon-Coles tau function — corrects low-score dependence.
 * ρ typically in [-0.15, -0.05] for football.
 */
function dixonColesTau(x: number, y: number, lambdaH: number, lambdaA: number, rho: number): number {
  if (x === 0 && y === 0) return 1 - lambdaH * lambdaA * rho;
  if (x === 0 && y === 1) return 1 + lambdaH * rho;
  if (x === 1 && y === 0) return 1 + lambdaA * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}

/**
 * Estimate team's attack/defense strength using simple rate-based approach.
 * For production use, should use MLE with time decay. This is a good approximation.
 */
function estimateStrength(form: TeamForm, leagueAvgGoalsHome: number, leagueAvgGoalsAway: number): {
  attack_home: number;
  attack_away: number;
  defense_home: number;
  defense_away: number;
} {
  if (form.matchesPlayed === 0) {
    return { attack_home: 1, attack_away: 1, defense_home: 1, defense_away: 1 };
  }

  // Split matches to approximate ~half home, half away
  const homeMatches = Math.max(1, Math.floor(form.matchesPlayed / 2));
  const awayMatches = Math.max(1, form.matchesPlayed - homeMatches);

  const avgHomeGoalsFor = form.homeGoalsFor / homeMatches;
  const avgHomeGoalsAgainst = form.homeGoalsAgainst / homeMatches;
  const avgAwayGoalsFor = form.awayGoalsFor / awayMatches;
  const avgAwayGoalsAgainst = form.awayGoalsAgainst / awayMatches;

  return {
    attack_home: avgHomeGoalsFor / Math.max(leagueAvgGoalsHome, 0.1),
    attack_away: avgAwayGoalsFor / Math.max(leagueAvgGoalsAway, 0.1),
    defense_home: avgHomeGoalsAgainst / Math.max(leagueAvgGoalsAway, 0.1),
    defense_away: avgAwayGoalsAgainst / Math.max(leagueAvgGoalsHome, 0.1),
  };
}

export interface DixonColesInput {
  home: TeamForm;
  away: TeamForm;
  leagueAvgGoalsHome?: number;  // default 1.5
  leagueAvgGoalsAway?: number;  // default 1.1
  rho?: number;                  // default -0.08
  maxGoals?: number;             // matrix size, default 7
}

export function dixonColes(input: DixonColesInput): DixonColesResult {
  const {
    home, away,
    leagueAvgGoalsHome = 1.5,
    leagueAvgGoalsAway = 1.1,
    rho = -0.08,
    maxGoals = 7,
  } = input;

  const homeStr = estimateStrength(home, leagueAvgGoalsHome, leagueAvgGoalsAway);
  const awayStr = estimateStrength(away, leagueAvgGoalsHome, leagueAvgGoalsAway);

  // λ_home = AttackHome × DefenseAway × AvgHomeGoals
  // λ_away = AttackAway × DefenseHome × AvgAwayGoals
  const lambdaHome = Math.max(0.1, homeStr.attack_home * awayStr.defense_away * leagueAvgGoalsHome);
  const lambdaAway = Math.max(0.1, awayStr.attack_away * homeStr.defense_home * leagueAvgGoalsAway);

  // Build scoreline matrix with Dixon-Coles correction
  const N = maxGoals + 1;
  const matrix: number[][] = Array.from({ length: N }, () => Array(N).fill(0));
  let totalProb = 0;

  for (let h = 0; h < N; h++) {
    for (let a = 0; a < N; a++) {
      const pH = poisson(h, lambdaHome);
      const pA = poisson(a, lambdaAway);
      const tau = dixonColesTau(h, a, lambdaHome, lambdaAway, rho);
      const prob = pH * pA * tau;
      matrix[h][a] = prob;
      totalProb += prob;
    }
  }

  // Normalize (sum should be ~1, small corrections from DC are lost in tail)
  if (totalProb > 0) {
    for (let h = 0; h < N; h++) {
      for (let a = 0; a < N; a++) {
        matrix[h][a] /= totalProb;
      }
    }
  }

  // Compute market probabilities
  let homeWin = 0, draw = 0, awayWin = 0;
  let btts = 0;
  const overUnder: Record<number, number> = {};
  let homeGoals0 = 0, homeGoals1 = 0, homeGoals2 = 0;
  let awayGoals0 = 0, awayGoals1 = 0, awayGoals2 = 0;

  const scorelineList: Array<{ score: string; probability: number }> = [];

  for (let h = 0; h < N; h++) {
    for (let a = 0; a < N; a++) {
      const p = matrix[h][a];
      const total = h + a;

      if (h > a) homeWin += p;
      else if (h < a) awayWin += p;
      else draw += p;

      if (h > 0 && a > 0) btts += p;

      for (const line of [0, 1, 2, 3, 4]) {
        overUnder[line] = (overUnder[line] || 0) + (total > line + 0.5 ? p : 0);
      }

      if (h >= 1) homeGoals0 += p;
      if (h >= 2) homeGoals1 += p;
      if (h >= 3) homeGoals2 += p;
      if (a >= 1) awayGoals0 += p;
      if (a >= 2) awayGoals1 += p;
      if (a >= 3) awayGoals2 += p;

      scorelineList.push({ score: `${h}-${a}`, probability: p });
    }
  }

  const topScorelines = scorelineList
    .sort((x, y) => y.probability - x.probability)
    .slice(0, 5)
    .map((s) => ({ score: s.score, probability: Math.round(s.probability * 1000) / 1000 }));

  const expectedTotal = lambdaHome + lambdaAway;

  return {
    lambdaHome: Math.round(lambdaHome * 100) / 100,
    lambdaAway: Math.round(lambdaAway * 100) / 100,
    rho,
    scorelineMatrix: matrix,
    probabilities: {
      home_win: Math.round(homeWin * 1000) / 1000,
      draw: Math.round(draw * 1000) / 1000,
      away_win: Math.round(awayWin * 1000) / 1000,
      over_05: Math.round(overUnder[0] * 1000) / 1000,
      over_15: Math.round(overUnder[1] * 1000) / 1000,
      over_25: Math.round(overUnder[2] * 1000) / 1000,
      over_35: Math.round(overUnder[3] * 1000) / 1000,
      over_45: Math.round(overUnder[4] * 1000) / 1000,
      under_05: Math.round((1 - overUnder[0]) * 1000) / 1000,
      under_15: Math.round((1 - overUnder[1]) * 1000) / 1000,
      under_25: Math.round((1 - overUnder[2]) * 1000) / 1000,
      under_35: Math.round((1 - overUnder[3]) * 1000) / 1000,
      under_45: Math.round((1 - overUnder[4]) * 1000) / 1000,
      btts_yes: Math.round(btts * 1000) / 1000,
      btts_no: Math.round((1 - btts) * 1000) / 1000,
      home_over_05: Math.round(homeGoals0 * 1000) / 1000,
      home_over_15: Math.round(homeGoals1 * 1000) / 1000,
      home_over_25: Math.round(homeGoals2 * 1000) / 1000,
      away_over_05: Math.round(awayGoals0 * 1000) / 1000,
      away_over_15: Math.round(awayGoals1 * 1000) / 1000,
      away_over_25: Math.round(awayGoals2 * 1000) / 1000,
      home_or_draw: Math.round((homeWin + draw) * 1000) / 1000,
      away_or_draw: Math.round((awayWin + draw) * 1000) / 1000,
      home_or_away: Math.round((homeWin + awayWin) * 1000) / 1000,
      most_likely_scorelines: topScorelines,
    },
    expected_total_goals: Math.round(expectedTotal * 100) / 100,
    sample_size: { home: home.matchesPlayed, away: away.matchesPlayed },
  };
}

/**
 * Helper to build TeamForm from history array (V9 ETL structure).
 */
export function buildTeamFormFromHistory(history: any[], teamId: number, teamName: string): TeamForm {
  let matchesPlayed = 0;
  let goalsFor = 0, goalsAgainst = 0;
  let homeGoalsFor = 0, homeGoalsAgainst = 0;
  let awayGoalsFor = 0, awayGoalsAgainst = 0;

  for (const m of history) {
    // Handle both raw SportMonks format and normalized format
    const isHome = m.was_home === true ||
      (m.participants && m.participants.find((p: any) => p.id === teamId)?.meta?.location === 'home');

    let myGoals = 0, oppGoals = 0;

    if (m.score_home !== undefined && m.score_away !== undefined) {
      // Normalized format
      myGoals = isHome ? m.score_home : m.score_away;
      oppGoals = isHome ? m.score_away : m.score_home;
    } else if (m.scores) {
      // Raw SportMonks format
      const curScores = m.scores.filter((s: any) => s.description === 'CURRENT');
      const myScore = curScores.find((s: any) =>
        (isHome && s.score?.participant === 'home') || (!isHome && s.score?.participant === 'away')
      );
      const oppScore = curScores.find((s: any) =>
        (isHome && s.score?.participant === 'away') || (!isHome && s.score?.participant === 'home')
      );
      myGoals = myScore?.score?.goals ?? 0;
      oppGoals = oppScore?.score?.goals ?? 0;
    } else {
      continue;
    }

    matchesPlayed++;
    goalsFor += myGoals;
    goalsAgainst += oppGoals;

    if (isHome) {
      homeGoalsFor += myGoals;
      homeGoalsAgainst += oppGoals;
    } else {
      awayGoalsFor += myGoals;
      awayGoalsAgainst += oppGoals;
    }
  }

  return {
    teamId,
    teamName,
    matchesPlayed,
    goalsFor,
    goalsAgainst,
    homeGoalsFor,
    homeGoalsAgainst,
    awayGoalsFor,
    awayGoalsAgainst,
  };
}
