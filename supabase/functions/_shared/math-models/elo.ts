// _shared/math-models/elo.ts
// Club Elo ratings adapted for football (based on ClubElo.com methodology).

export interface EloComputation {
  homeElo: number;
  awayElo: number;
  homeAdvantage: number;  // points added to home for match
  expected: {
    home: number;
    draw: number;
    away: number;
  };
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';  // based on sample size
}

/**
 * Standard Elo expected score formula.
 * Returns probability that team A wins given rating difference.
 */
function eloExpected(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/**
 * K-factor: how much ratings change after a match.
 * Higher K = more responsive but more noisy.
 */
function kFactor(competition: 'league' | 'cup' | 'champions_league' | 'final'): number {
  switch (competition) {
    case 'final': return 60;
    case 'champions_league': return 40;
    case 'cup': return 30;
    case 'league':
    default: return 20;
  }
}

/**
 * Goal difference multiplier (ClubElo style).
 * More lopsided wins → larger rating swings.
 */
function goalDiffMultiplier(gd: number): number {
  const absGd = Math.abs(gd);
  if (absGd <= 1) return 1;
  if (absGd === 2) return 1.5;
  return (11 + absGd) / 8;
}

/**
 * Compute current Elo rating for a team based on match history.
 * Uses a co-evolving rating system: team rating AND opponent ratings evolve together
 * from a shared pool. Matches are processed oldest → newest.
 *
 * history: matches in REVERSE chronological order (newest first, V9 convention).
 */
export function computeTeamElo(
  teamId: number,
  history: any[],
  baselineElo: number = 1500
): { rating: number; samples: number } {
  // Process oldest to newest so rating builds up over time
  const ordered = [...history].reverse();
  let rating = baselineElo;
  const opponentRatings: Record<string, number> = {}; // per-opponent rating, starts at baseline
  let samples = 0;

  const getOppRating = (key: string): number => {
    if (opponentRatings[key] === undefined) opponentRatings[key] = baselineElo;
    return opponentRatings[key];
  };
  const setOppRating = (key: string, v: number) => { opponentRatings[key] = v; };

  for (const m of ordered) {
    const isHome = m.was_home === true ||
      (m.participants && m.participants.find((p: any) => p.id === teamId)?.meta?.location === 'home');

    let myGoals = 0, oppGoals = 0;
    let oppKey: string | null = null;

    if (m.score_home !== undefined && m.score_away !== undefined) {
      myGoals = isHome ? m.score_home : m.score_away;
      oppGoals = isHome ? m.score_away : m.score_home;
      // Opponent key from normalized fields
      oppKey = (isHome ? m.away_team : m.home_team) || m.opponent_name || m.opponent_id?.toString() || null;
    } else if (m.scores) {
      const myScore = m.scores.find((s: any) =>
        s.description === 'CURRENT' &&
        ((isHome && s.score?.participant === 'home') || (!isHome && s.score?.participant === 'away'))
      );
      const oppScore = m.scores.find((s: any) =>
        s.description === 'CURRENT' &&
        ((isHome && s.score?.participant === 'away') || (!isHome && s.score?.participant === 'home'))
      );
      myGoals = myScore?.score?.goals ?? 0;
      oppGoals = oppScore?.score?.goals ?? 0;
      // Opponent key from raw format
      const oppParticipant = m.participants?.find((p: any) => p.id !== teamId);
      oppKey = oppParticipant?.id?.toString() || null;
    } else {
      continue;
    }

    const gd = myGoals - oppGoals;
    const actual = gd > 0 ? 1 : gd < 0 ? 0 : 0.5;

    const leagueName = (m.league?.name || '').toLowerCase();
    const competition =
      leagueName.includes('champions') || leagueName.includes('copa libertadores') ? 'champions_league' :
      leagueName.includes('cup') || leagueName.includes('copa') ? 'cup' :
      'league';

    const K = kFactor(competition as any);
    const multiplier = Math.min(2.75, goalDiffMultiplier(gd));  // cap at 2.75 (ClubElo std)
    const homeAdv = 65;

    const opponentRating = oppKey ? getOppRating(oppKey) : baselineElo;
    const effectiveMyRating = rating + (isHome ? homeAdv : 0);
    const effectiveOppRating = opponentRating + (isHome ? 0 : homeAdv);

    const expected = eloExpected(effectiveMyRating, effectiveOppRating);
    const change = K * multiplier * (actual - expected);

    rating += change;
    // Zero-sum: opponent rating changes inversely
    if (oppKey) setOppRating(oppKey, opponentRating - change);
    samples++;
  }

  return { rating: Math.round(rating), samples };
}

/**
 * Compute match probabilities from two team Elos.
 */
export function eloMatchProbabilities(
  homeElo: number,
  awayElo: number,
  homeAdvantage: number = 65,
  drawRate: number = 0.26  // empirical base draw rate
): EloComputation['expected'] {
  const effectiveHome = homeElo + homeAdvantage;
  const pHome = eloExpected(effectiveHome, awayElo);

  // Split pHome/pAway into win/draw using empirical draw distribution.
  // Draws are more likely in close matches (ratings within 50 points).
  const ratingDiff = Math.abs(effectiveHome - awayElo);
  const adjustedDrawRate = Math.max(0.15, drawRate * Math.exp(-ratingDiff / 400));

  const pWin = pHome;
  const pLoss = 1 - pHome;

  // Allocate draws proportionally
  const drawHome = adjustedDrawRate * pWin;
  const drawAway = adjustedDrawRate * pLoss;
  const draw = drawHome + drawAway;

  const home = pWin - drawHome;
  const away = pLoss - drawAway;

  // Normalize
  const total = home + draw + away;
  return {
    home: Math.round((home / total) * 1000) / 1000,
    draw: Math.round((draw / total) * 1000) / 1000,
    away: Math.round((away / total) * 1000) / 1000,
  };
}

/**
 * Main entry: compute full Elo analysis for a match.
 */
export function computeEloForMatch(input: {
  homeTeamId: number;
  awayTeamId: number;
  homeHistory: any[];
  awayHistory: any[];
  homeAdvantage?: number;
}): EloComputation {
  const { homeTeamId, awayTeamId, homeHistory, awayHistory, homeAdvantage = 65 } = input;

  const home = computeTeamElo(homeTeamId, homeHistory);
  const away = computeTeamElo(awayTeamId, awayHistory);

  const probs = eloMatchProbabilities(home.rating, away.rating, homeAdvantage);

  const confidence: 'LOW' | 'MEDIUM' | 'HIGH' =
    (home.samples >= 15 && away.samples >= 15) ? 'HIGH' :
    (home.samples >= 8 && away.samples >= 8) ? 'MEDIUM' : 'LOW';

  return {
    homeElo: home.rating,
    awayElo: away.rating,
    homeAdvantage,
    expected: probs,
    confidence,
  };
}
