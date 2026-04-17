// _shared/math-models/monte-carlo.ts
// Monte Carlo simulation to derive ALL market probabilities consistently from λ.
// This prevents the LLM from inventing inconsistent probabilities across markets.

export interface SimulationResult {
  runs: number;
  scoreline_distribution: Map<string, number>;  // "2-1" -> count
  market_probabilities: {
    // 1X2
    home_win: number;
    draw: number;
    away_win: number;
    // Double chance
    home_or_draw: number;
    away_or_draw: number;
    home_or_away: number;
    // Totals
    over_05: number; over_15: number; over_25: number; over_35: number; over_45: number;
    under_05: number; under_15: number; under_25: number; under_35: number; under_45: number;
    // BTTS
    btts_yes: number; btts_no: number;
    // Team totals
    home_over_05: number; home_over_15: number; home_over_25: number;
    away_over_05: number; away_over_15: number; away_over_25: number;
    // Combined markets (high value)
    home_win_and_over_25: number;
    home_win_and_btts: number;
    away_win_and_over_25: number;
    away_win_and_btts: number;
    draw_and_over_25: number;
    // Exact scores (top 5)
    top_scorelines: Array<{ score: string; probability: number }>;
  };
  stats: {
    avg_home_goals: number;
    avg_away_goals: number;
    avg_total_goals: number;
    median_scoreline: string;
  };
}

/**
 * Sample from Poisson distribution (Knuth's algorithm).
 * Efficient for small λ (< 30). Football λ is typically 0.5 - 4.
 */
function samplePoisson(lambda: number): number {
  if (lambda <= 0) return 0;
  if (lambda > 30) {
    // Normal approximation for large λ (rare in football)
    return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * (Math.random() * 2 - 1) * 2));
  }

  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= Math.random();
  } while (p > L);
  return k - 1;
}

/**
 * Simulate matches using independent Poisson for home/away goals.
 * For more accuracy, could use Bivariate Poisson but independent is 95% as accurate.
 */
export function simulateMatch(
  lambdaHome: number,
  lambdaAway: number,
  runs: number = 10000
): SimulationResult {
  const scorelineCount = new Map<string, number>();
  const market = {
    home_win: 0, draw: 0, away_win: 0,
    home_or_draw: 0, away_or_draw: 0, home_or_away: 0,
    over_05: 0, over_15: 0, over_25: 0, over_35: 0, over_45: 0,
    under_05: 0, under_15: 0, under_25: 0, under_35: 0, under_45: 0,
    btts_yes: 0, btts_no: 0,
    home_over_05: 0, home_over_15: 0, home_over_25: 0,
    away_over_05: 0, away_over_15: 0, away_over_25: 0,
    home_win_and_over_25: 0, home_win_and_btts: 0,
    away_win_and_over_25: 0, away_win_and_btts: 0,
    draw_and_over_25: 0,
  };

  let totalHome = 0, totalAway = 0;

  for (let i = 0; i < runs; i++) {
    const h = samplePoisson(lambdaHome);
    const a = samplePoisson(lambdaAway);
    const total = h + a;
    const btts = h > 0 && a > 0;

    totalHome += h;
    totalAway += a;

    const key = `${h}-${a}`;
    scorelineCount.set(key, (scorelineCount.get(key) || 0) + 1);

    // 1X2
    if (h > a) market.home_win++;
    else if (h < a) market.away_win++;
    else market.draw++;

    // Double chance
    if (h >= a) market.home_or_draw++;
    if (a >= h) market.away_or_draw++;
    if (h !== a) market.home_or_away++;

    // Totals
    if (total >= 1) market.over_05++;
    if (total >= 2) market.over_15++;
    if (total >= 3) market.over_25++;
    if (total >= 4) market.over_35++;
    if (total >= 5) market.over_45++;
    market.under_05 = runs - market.over_05;
    market.under_15 = runs - market.over_15;
    market.under_25 = runs - market.over_25;
    market.under_35 = runs - market.over_35;
    market.under_45 = runs - market.over_45;

    // BTTS
    if (btts) market.btts_yes++;
    else market.btts_no++;

    // Team totals
    if (h >= 1) market.home_over_05++;
    if (h >= 2) market.home_over_15++;
    if (h >= 3) market.home_over_25++;
    if (a >= 1) market.away_over_05++;
    if (a >= 2) market.away_over_15++;
    if (a >= 3) market.away_over_25++;

    // Combined
    if (h > a && total >= 3) market.home_win_and_over_25++;
    if (h > a && btts) market.home_win_and_btts++;
    if (a > h && total >= 3) market.away_win_and_over_25++;
    if (a > h && btts) market.away_win_and_btts++;
    if (h === a && total >= 3) market.draw_and_over_25++;
  }

  // Convert counts to probabilities
  const prob = (count: number) => Math.round((count / runs) * 1000) / 1000;

  const scorelineProbsArr = Array.from(scorelineCount.entries())
    .map(([score, count]) => ({ score, probability: prob(count) }))
    .sort((a, b) => b.probability - a.probability);

  const topScorelines = scorelineProbsArr.slice(0, 5);
  const mostLikely = scorelineProbsArr[0]?.score || '1-1';

  return {
    runs,
    scoreline_distribution: scorelineCount,
    market_probabilities: {
      home_win: prob(market.home_win),
      draw: prob(market.draw),
      away_win: prob(market.away_win),
      home_or_draw: prob(market.home_or_draw),
      away_or_draw: prob(market.away_or_draw),
      home_or_away: prob(market.home_or_away),
      over_05: prob(market.over_05), over_15: prob(market.over_15),
      over_25: prob(market.over_25), over_35: prob(market.over_35), over_45: prob(market.over_45),
      under_05: prob(market.under_05), under_15: prob(market.under_15),
      under_25: prob(market.under_25), under_35: prob(market.under_35), under_45: prob(market.under_45),
      btts_yes: prob(market.btts_yes),
      btts_no: prob(market.btts_no),
      home_over_05: prob(market.home_over_05), home_over_15: prob(market.home_over_15),
      home_over_25: prob(market.home_over_25),
      away_over_05: prob(market.away_over_05), away_over_15: prob(market.away_over_15),
      away_over_25: prob(market.away_over_25),
      home_win_and_over_25: prob(market.home_win_and_over_25),
      home_win_and_btts: prob(market.home_win_and_btts),
      away_win_and_over_25: prob(market.away_win_and_over_25),
      away_win_and_btts: prob(market.away_win_and_btts),
      draw_and_over_25: prob(market.draw_and_over_25),
      top_scorelines: topScorelines,
    },
    stats: {
      avg_home_goals: Math.round((totalHome / runs) * 100) / 100,
      avg_away_goals: Math.round((totalAway / runs) * 100) / 100,
      avg_total_goals: Math.round(((totalHome + totalAway) / runs) * 100) / 100,
      median_scoreline: mostLikely,
    },
  };
}

/**
 * Detect value bets: compare model probability vs implied probability from odds.
 */
export interface ValueDetection {
  market: string;
  modelProb: number;
  impliedProb: number;    // 1/odds
  edge: number;           // modelProb - impliedProb
  odds: number;
  kelly_fraction: number; // Kelly criterion (fractional 0.25)
  recommendation: 'STRONG_VALUE' | 'VALUE' | 'NEUTRAL' | 'AVOID';
}

export function detectValue(
  modelProbs: SimulationResult['market_probabilities'],
  marketOdds: Record<string, number>
): ValueDetection[] {
  const results: ValueDetection[] = [];

  const marketMap: Array<{ key: string; probKey: keyof typeof modelProbs }> = [
    { key: 'home_win', probKey: 'home_win' },
    { key: 'draw', probKey: 'draw' },
    { key: 'away_win', probKey: 'away_win' },
    { key: 'over_25', probKey: 'over_25' },
    { key: 'under_25', probKey: 'under_25' },
    { key: 'btts_yes', probKey: 'btts_yes' },
    { key: 'btts_no', probKey: 'btts_no' },
    { key: 'home_or_draw', probKey: 'home_or_draw' },
    { key: 'away_or_draw', probKey: 'away_or_draw' },
  ];

  for (const m of marketMap) {
    const odds = marketOdds[m.key];
    if (!odds || odds < 1.01) continue;

    const modelProb = modelProbs[m.probKey] as number;
    const impliedProb = 1 / odds;
    const edge = modelProb - impliedProb;

    // Kelly: f = (p*odds - 1) / (odds - 1), fractional 25%
    const b = odds - 1;
    const fullKelly = (modelProb * b - (1 - modelProb)) / b;
    const kelly = Math.max(0, fullKelly * 0.25);

    let rec: ValueDetection['recommendation'];
    if (edge >= 0.08 && modelProb >= 0.55) rec = 'STRONG_VALUE';
    else if (edge >= 0.04) rec = 'VALUE';
    else if (edge >= 0) rec = 'NEUTRAL';
    else rec = 'AVOID';

    results.push({
      market: m.key,
      modelProb: Math.round(modelProb * 1000) / 1000,
      impliedProb: Math.round(impliedProb * 1000) / 1000,
      edge: Math.round(edge * 1000) / 1000,
      odds,
      kelly_fraction: Math.round(kelly * 10000) / 10000,
      recommendation: rec,
    });
  }

  return results.sort((a, b) => b.edge - a.edge);
}
