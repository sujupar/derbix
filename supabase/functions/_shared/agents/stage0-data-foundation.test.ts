import { buildDataFoundation } from './stage0-data-foundation.ts';
import { assertEquals, assert } from "https://deno.land/std@0.168.0/testing/asserts.ts";

const fakeContext = {
  homeTeam: 'Real Madrid', awayTeam: 'Barcelona', league: 'La Liga', date: '2026-05-10',
  math: {} as any,
  homeHistory: '', awayHistory: '', h2h: '', odds: '',
  xg: { home: { for: 2.1, against: 0.9, overperf: 0.2 }, away: { for: 1.8, against: 1.0, overperf: -0.1 } },
  key_players: { home_missing: ['Bellingham'], away_missing: [] },
} as any;

const fakeRaw = {
  fixture_id: 12345,
  kickoff_at: '2026-05-10T20:00:00Z',
  home_recent_results: [
    { result: 'W' as const, date: '2026-05-06T20:00:00Z', goals_for: 3, goals_against: 1 },
    { result: 'W' as const, date: '2026-05-02T20:00:00Z', goals_for: 2, goals_against: 0 },
    { result: 'D' as const, date: '2026-04-28T20:00:00Z', goals_for: 1, goals_against: 1 },
    { result: 'L' as const, date: '2026-04-24T20:00:00Z', goals_for: 0, goals_against: 2 },
    { result: 'W' as const, date: '2026-04-20T20:00:00Z', goals_for: 4, goals_against: 1 },
  ],
  away_recent_results: [
    { result: 'L' as const, date: '2026-05-04T20:00:00Z', goals_for: 0, goals_against: 1 },
    { result: 'W' as const, date: '2026-04-30T20:00:00Z', goals_for: 2, goals_against: 1 },
    { result: 'D' as const, date: '2026-04-26T20:00:00Z', goals_for: 1, goals_against: 1 },
    { result: 'W' as const, date: '2026-04-22T20:00:00Z', goals_for: 3, goals_against: 0 },
    { result: 'W' as const, date: '2026-04-18T20:00:00Z', goals_for: 2, goals_against: 1 },
  ],
  referee_name: 'Mateu Lahoz',
  referee_aggregated_stats: { yellows_per_match: 4.2, reds_per_match: 0.3, home_bias: 0.1, matches: 50 },
  sportmonks_predictions: { home_win: 55, draw: 25, away_win: 20, over_25: 60, btts_yes: 58 },
  closing_odds: { home_win: 1.95 },
  opening_odds: { home_win: 2.10 },
  standings: { home_rank: 1, away_rank: 2, home_points_gap_safety: 40, away_points_gap_safety: 38, total_teams: 20 },
  perplexity_lineup_text: null,
};

Deno.test('buildDataFoundation: streak computed correctly', () => {
  const out = buildDataFoundation(fakeContext, fakeRaw);
  assertEquals(out.streak_home, 'WWDLW');
  assertEquals(out.streak_away, 'LWDWW');
});

Deno.test('buildDataFoundation: CLV computed when both odds present', () => {
  const out = buildDataFoundation(fakeContext, fakeRaw);
  assert(out.clv_signal !== null && out.clv_signal > 7 && out.clv_signal < 7.5, `Got CLV: ${out.clv_signal}`);
});

Deno.test('buildDataFoundation: injury impact reflects missing players', () => {
  const out = buildDataFoundation(fakeContext, fakeRaw);
  assertEquals(out.injuries_impact.home_xg_loss_estimate, 0.15);
  assertEquals(out.injuries_impact.away_xg_loss_estimate, 0);
});

Deno.test('buildDataFoundation: data_volume_score increases with non-null fields', () => {
  const out = buildDataFoundation(fakeContext, fakeRaw);
  assert(out.data_volume_score >= 1000, `Expected score >= 1000, got ${out.data_volume_score}`);
});
