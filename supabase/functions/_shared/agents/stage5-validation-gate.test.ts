import { runStage5 } from './stage5-validation-gate.ts';
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";

const baseDf: any = { fixture_id: 1, home_team: 'A', away_team: 'B' };
const baseS1: any = { probabilities_initial: { home_win: 60, draw: 25, away_win: 15, over_25: 60, btts: 55, home_to_score: 80, away_to_score: 65 } };
const supportedPick = { market: 'BTTS', selection: 'Sí', probability_estimate: 60, rationale: 'r', odds_reference: 1.80 };
const baseS2: any = {
  tactical: { agent_name: 'TACTICAL', thesis_supports_or_opposes: 'SUPPORTS', key_findings: [], candidate_picks: [supportedPick], notes: '', modifies_probabilities: {} },
  contextual: { agent_name: 'CONTEXTUAL', thesis_supports_or_opposes: 'SUPPORTS', key_findings: [], candidate_picks: [], notes: '', modifies_probabilities: {} },
  market: { agent_name: 'MARKET', thesis_supports_or_opposes: 'SUPPORTS', key_findings: [], candidate_picks: [], notes: '', modifies_probabilities: {} },
};

Deno.test('Stage 5: passes valid pick', () => {
  const out = runStage5(baseDf, baseS1, baseS2, {
    veredicto: 'APOSTAR',
    picks: [{ market: 'BTTS', selection: 'Sí', probability: 82, odds: 1.80, edge_percent: 5, confidence: 'ALTA', reasoning: 'x', survived_skeptic: true }],
    summary: '', overall_confidence: 80, total_data_volume: 1500,
  });
  assertEquals(out.validated_picks.length, 1);
  assertEquals(out.rejected.length, 0);
});

Deno.test('Stage 5: rejects below threshold', () => {
  const out = runStage5(baseDf, baseS1, baseS2, {
    veredicto: 'APOSTAR',
    picks: [{ market: 'BTTS', selection: 'Sí', probability: 75, odds: 1.80, edge_percent: 5, confidence: 'ALTA', reasoning: 'x', survived_skeptic: true }],
    summary: '', overall_confidence: 80, total_data_volume: 1500,
  });
  assertEquals(out.validated_picks.length, 0);
  assertEquals(out.rejected.length, 1);
});

Deno.test('Stage 5: rejects unsupported pick', () => {
  const out = runStage5(baseDf, baseS1, baseS2, {
    veredicto: 'APOSTAR',
    picks: [{ market: 'Corners', selection: 'Over 9.5', probability: 85, odds: 1.95, edge_percent: 8, confidence: 'ALTA', reasoning: 'x', survived_skeptic: true }],
    summary: '', overall_confidence: 80, total_data_volume: 1500,
  });
  assertEquals(out.validated_picks.length, 0);
  assertEquals(out.rejected.length, 1);
});

Deno.test('Stage 5: rejects out-of-range odds', () => {
  const out = runStage5(baseDf, baseS1, baseS2, {
    veredicto: 'APOSTAR',
    picks: [{ market: 'BTTS', selection: 'Sí', probability: 82, odds: 4.00, edge_percent: 5, confidence: 'ALTA', reasoning: 'x', survived_skeptic: true }],
    summary: '', overall_confidence: 80, total_data_volume: 1500,
  });
  assertEquals(out.validated_picks.length, 0);
  assertEquals(out.rejected.length, 1);
});
