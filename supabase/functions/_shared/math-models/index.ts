// _shared/math-models/index.ts
// Unified entry point: orchestrates Dixon-Coles + Elo + Monte Carlo for a match.

export { dixonColes, buildTeamFormFromHistory } from './dixon-coles.ts';
export type { DixonColesInput, DixonColesResult, TeamForm } from './dixon-coles.ts';

export { computeTeamElo, eloMatchProbabilities, computeEloForMatch } from './elo.ts';
export type { EloComputation } from './elo.ts';

export { simulateMatch, detectValue } from './monte-carlo.ts';
export type { SimulationResult, ValueDetection } from './monte-carlo.ts';

import { dixonColes, buildTeamFormFromHistory, type DixonColesResult } from './dixon-coles.ts';
import { computeEloForMatch, type EloComputation } from './elo.ts';
import { simulateMatch, detectValue, type SimulationResult, type ValueDetection } from './monte-carlo.ts';

export interface MathModelsInput {
  homeTeamId: number;
  homeTeamName: string;
  awayTeamId: number;
  awayTeamName: string;
  homeHistory: any[];        // last 20+ matches for home
  awayHistory: any[];        // last 20+ matches for away
  leagueAvgGoalsHome?: number;
  leagueAvgGoalsAway?: number;
  marketOdds?: Record<string, number>;  // for value detection
}

export interface MathModelsOutput {
  dixon_coles: DixonColesResult;
  elo: EloComputation;
  monte_carlo: SimulationResult;
  value_opportunities: ValueDetection[];
  ensemble_probabilities: {
    // Weighted ensemble of DC + Elo + MC (MC weight=0.5, DC=0.3, Elo=0.2)
    home_win: number;
    draw: number;
    away_win: number;
    over_25: number;
    btts_yes: number;
  };
  diagnostics: {
    home_sample_size: number;
    away_sample_size: number;
    elo_confidence: 'LOW' | 'MEDIUM' | 'HIGH';
    model_consistency: number;  // 0-1, how much the models agree
  };
}

/**
 * Main orchestrator: runs all mathematical models and returns unified output.
 * Called BEFORE the multi-agent LLM pipeline to provide a mathematical baseline.
 */
export function runMathModels(input: MathModelsInput): MathModelsOutput {
  const {
    homeTeamId, homeTeamName, awayTeamId, awayTeamName,
    homeHistory, awayHistory,
    leagueAvgGoalsHome = 1.5,
    leagueAvgGoalsAway = 1.1,
    marketOdds = {},
  } = input;

  // 1. Dixon-Coles — analytical scoreline matrix
  const homeForm = buildTeamFormFromHistory(homeHistory, homeTeamId, homeTeamName);
  const awayForm = buildTeamFormFromHistory(awayHistory, awayTeamId, awayTeamName);

  const dcResult = dixonColes({
    home: homeForm,
    away: awayForm,
    leagueAvgGoalsHome,
    leagueAvgGoalsAway,
  });

  // 2. Elo — rating-based probabilities
  const eloResult = computeEloForMatch({
    homeTeamId,
    awayTeamId,
    homeHistory,
    awayHistory,
  });

  // 3. Monte Carlo — simulation using DC's λ values
  const mcResult = simulateMatch(dcResult.lambdaHome, dcResult.lambdaAway, 10000);

  // 4. Ensemble: weighted average (MC is most reliable for derivatives)
  const wMC = 0.5, wDC = 0.3, wElo = 0.2;
  const ensemble = {
    home_win: Math.round((
      mcResult.market_probabilities.home_win * wMC +
      dcResult.probabilities.home_win * wDC +
      eloResult.expected.home * wElo
    ) * 1000) / 1000,
    draw: Math.round((
      mcResult.market_probabilities.draw * wMC +
      dcResult.probabilities.draw * wDC +
      eloResult.expected.draw * wElo
    ) * 1000) / 1000,
    away_win: Math.round((
      mcResult.market_probabilities.away_win * wMC +
      dcResult.probabilities.away_win * wDC +
      eloResult.expected.away * wElo
    ) * 1000) / 1000,
    over_25: Math.round((
      mcResult.market_probabilities.over_25 * 0.6 +
      dcResult.probabilities.over_25 * 0.4
    ) * 1000) / 1000,
    btts_yes: Math.round((
      mcResult.market_probabilities.btts_yes * 0.6 +
      dcResult.probabilities.btts_yes * 0.4
    ) * 1000) / 1000,
  };

  // 5. Value detection from Monte Carlo vs odds
  const valueOpps = detectValue(mcResult.market_probabilities, marketOdds);

  // 6. Model consistency: how much DC, Elo, MC agree on home win probability
  const homeWinValues = [
    dcResult.probabilities.home_win,
    eloResult.expected.home,
    mcResult.market_probabilities.home_win,
  ];
  const avgHW = homeWinValues.reduce((s, v) => s + v, 0) / 3;
  const variance = homeWinValues.reduce((s, v) => s + Math.pow(v - avgHW, 2), 0) / 3;
  const stdDev = Math.sqrt(variance);
  const consistency = Math.max(0, 1 - stdDev * 4);  // 0.05 std → 0.8 consistency

  return {
    dixon_coles: dcResult,
    elo: eloResult,
    monte_carlo: mcResult,
    value_opportunities: valueOpps,
    ensemble_probabilities: ensemble,
    diagnostics: {
      home_sample_size: homeForm.matchesPlayed,
      away_sample_size: awayForm.matchesPlayed,
      elo_confidence: eloResult.confidence,
      model_consistency: Math.round(consistency * 100) / 100,
    },
  };
}
