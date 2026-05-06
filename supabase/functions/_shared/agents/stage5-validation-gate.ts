// _shared/agents/stage5-validation-gate.ts
// Deterministic validation. NO LLM. Filters picks against hard rules.

import { OPPORTUNITIES_THRESHOLD_PERCENT } from '../constants.ts';
import type {
  DataFoundationOutput,
  StatisticalFoundationOutput,
  SpecialistOutput,
  SynthesizerOutput,
} from './types.ts';

const MIN_ODDS = 1.50;
const MAX_ODDS = 3.50;
const MAX_PROB_GAP = 5; // percentage points difference allowed vs Stage 1 baseline

export interface ValidationOutput {
  validated_picks: SynthesizerOutput['picks'];
  rejected: Array<{ pick: SynthesizerOutput['picks'][0]; reason: string }>;
}

export function runStage5(
  _df: DataFoundationOutput,
  s1: StatisticalFoundationOutput,
  s2: { tactical: SpecialistOutput; contextual: SpecialistOutput; market: SpecialistOutput },
  s4: SynthesizerOutput,
): ValidationOutput {
  const validated: SynthesizerOutput['picks'] = [];
  const rejected: ValidationOutput['rejected'] = [];

  // Build a set of "supported" market+selection from Stage 2 specialists
  const supportedKeys = new Set<string>();
  for (const sp of [s2.tactical, s2.contextual, s2.market]) {
    for (const cp of sp.candidate_picks) {
      supportedKeys.add(`${cp.market}::${cp.selection}`);
    }
  }

  for (const pick of s4.picks) {
    if (pick.probability < OPPORTUNITIES_THRESHOLD_PERCENT) {
      rejected.push({ pick, reason: `probability ${pick.probability} < ${OPPORTUNITIES_THRESHOLD_PERCENT}` });
      continue;
    }
    if (pick.odds < MIN_ODDS || pick.odds > MAX_ODDS) {
      rejected.push({ pick, reason: `odds ${pick.odds} out of [${MIN_ODDS}, ${MAX_ODDS}]` });
      continue;
    }
    const key = `${pick.market}::${pick.selection}`;
    if (!supportedKeys.has(key)) {
      rejected.push({ pick, reason: `not referenced by any Stage 2 specialist` });
      continue;
    }
    const baselineProb = mapPickToBaselineProb(pick, s1);
    if (baselineProb !== null && Math.abs(pick.probability - baselineProb) > MAX_PROB_GAP) {
      rejected.push({ pick, reason: `probability gap ${Math.abs(pick.probability - baselineProb).toFixed(1)}pp vs Stage 1 baseline (${baselineProb})` });
      continue;
    }
    validated.push(pick);
  }

  return { validated_picks: validated, rejected };
}

function mapPickToBaselineProb(
  pick: SynthesizerOutput['picks'][0],
  s1: StatisticalFoundationOutput,
): number | null {
  const market = pick.market.toLowerCase();
  const selection = pick.selection.toLowerCase();
  const p = s1.probabilities_initial;
  if (market.includes('1x2') || market === 'resultado' || market === 'match winner') {
    if (selection.includes('local') || selection.includes('home') || selection === '1') return p.home_win;
    if (selection.includes('empate') || selection.includes('draw') || selection === 'x') return p.draw;
    if (selection.includes('visitante') || selection.includes('away') || selection === '2') return p.away_win;
  }
  if (market.includes('over') && selection.includes('2.5')) return p.over_25;
  if (market.includes('under') && selection.includes('2.5')) return 100 - p.over_25;
  if (market.includes('btts') || market.includes('ambos')) {
    return selection.includes('si') || selection.includes('yes') ? p.btts : 100 - p.btts;
  }
  return null;
}
