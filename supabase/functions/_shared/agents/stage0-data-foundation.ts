// _shared/agents/stage0-data-foundation.ts
// Deterministic feature extraction. NO LLM. Takes raw ETL data, produces structured features.

import type { MatchContext, DataFoundationOutput } from './types.ts';

export interface ETLRawData {
  fixture_id: number;
  kickoff_at: string;
  home_recent_results: Array<{ result: 'W' | 'D' | 'L'; date: string; goals_for: number; goals_against: number }>;
  away_recent_results: Array<{ result: 'W' | 'D' | 'L'; date: string; goals_for: number; goals_against: number }>;
  referee_name: string | null;
  referee_aggregated_stats?: { yellows_per_match: number; reds_per_match: number; home_bias: number; matches: number } | null;
  sportmonks_predictions?: { home_win: number; draw: number; away_win: number; over_25: number; btts_yes: number } | null;
  closing_odds?: { home_win: number } | null;
  opening_odds?: { home_win: number } | null;
  standings?: { home_rank: number; away_rank: number; home_points_gap_safety: number; away_points_gap_safety: number; total_teams: number } | null;
  perplexity_lineup_text?: string | null;
}

function buildStreak(results: Array<{ result: 'W' | 'D' | 'L' }>, n = 5): string {
  return results.slice(0, n).map((r) => r.result).join('');
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2));
}

function daysBetween(a: string, b: string): number {
  const ms = new Date(a).getTime() - new Date(b).getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

function extractProbableLineup(perplexityText: string | null | undefined): { home: string[] | null; away: string[] | null } {
  if (!perplexityText) return { home: null, away: null };
  const homeMatch = perplexityText.match(/(?:local|home).*?(?:alineaci[oó]n|XI|lineup)[\s\S]{0,500}?([A-ZÁÉÍÓÚÑ][a-záéíóúñ\s]+(?:,\s*[A-ZÁÉÍÓÚÑ][a-záéíóúñ\s]+){10})/i);
  const awayMatch = perplexityText.match(/(?:visitante|away).*?(?:alineaci[oó]n|XI|lineup)[\s\S]{0,500}?([A-ZÁÉÍÓÚÑ][a-záéíóúñ\s]+(?:,\s*[A-ZÁÉÍÓÚÑ][a-záéíóúñ\s]+){10})/i);
  return {
    home: homeMatch ? homeMatch[1].split(',').map((s) => s.trim()).slice(0, 11) : null,
    away: awayMatch ? awayMatch[1].split(',').map((s) => s.trim()).slice(0, 11) : null,
  };
}

function estimateInjuryXGLoss(missing: string[]): number {
  return Math.min(0.6, missing.length * 0.15);
}

export function buildDataFoundation(
  context: MatchContext,
  raw: ETLRawData,
): DataFoundationOutput {
  const homeRecent = raw.home_recent_results || [];
  const awayRecent = raw.away_recent_results || [];

  const streak_home = buildStreak(homeRecent, 5);
  const streak_away = buildStreak(awayRecent, 5);

  const days_rest_home = homeRecent[0] ? daysBetween(raw.kickoff_at, homeRecent[0].date) : 7;
  const days_rest_away = awayRecent[0] ? daysBetween(raw.kickoff_at, awayRecent[0].date) : 7;

  const home_for_5 = avg(homeRecent.slice(0, 5).map((r) => r.goals_for));
  const home_against_5 = avg(homeRecent.slice(0, 5).map((r) => r.goals_against));
  const home_for_10 = avg(homeRecent.slice(0, 10).map((r) => r.goals_for));
  const home_against_10 = avg(homeRecent.slice(0, 10).map((r) => r.goals_against));
  const away_for_5 = avg(awayRecent.slice(0, 5).map((r) => r.goals_for));
  const away_against_5 = avg(awayRecent.slice(0, 5).map((r) => r.goals_against));
  const away_for_10 = avg(awayRecent.slice(0, 10).map((r) => r.goals_for));
  const away_against_10 = avg(awayRecent.slice(0, 10).map((r) => r.goals_against));

  const xg_rolling = {
    home_for_5: context.xg?.home.for ?? home_for_5,
    home_against_5: context.xg?.home.against ?? home_against_5,
    home_for_10: context.xg?.home.for ?? home_for_10,
    home_against_10: context.xg?.home.against ?? home_against_10,
    away_for_5: context.xg?.away.for ?? away_for_5,
    away_against_5: context.xg?.away.against ?? away_against_5,
    away_for_10: context.xg?.away.for ?? away_for_10,
    away_against_10: context.xg?.away.against ?? away_against_10,
  };

  const goals_avg = {
    home_at_home_last5: home_for_5,
    away_away_last5: away_for_5,
    home_overall_last10: home_for_10,
    away_overall_last10: away_for_10,
  };

  const referee_stats = raw.referee_aggregated_stats
    ? {
        name: raw.referee_name,
        yellows_per_match: raw.referee_aggregated_stats.yellows_per_match,
        reds_per_match: raw.referee_aggregated_stats.reds_per_match,
        home_bias: raw.referee_aggregated_stats.home_bias,
        matches_in_dataset: raw.referee_aggregated_stats.matches,
      }
    : null;

  const home_missing = context.key_players?.home_missing ?? [];
  const away_missing = context.key_players?.away_missing ?? [];

  const injuries_impact = {
    home_xg_loss_estimate: estimateInjuryXGLoss(home_missing),
    away_xg_loss_estimate: estimateInjuryXGLoss(away_missing),
    home_key_missing: home_missing,
    away_key_missing: away_missing,
  };

  const standings = raw.standings;
  const competition_context = {
    is_derby: false,
    is_relegation_battle: standings ? standings.home_points_gap_safety < 5 || standings.away_points_gap_safety < 5 : false,
    is_title_race: standings ? (standings.home_rank <= 3 || standings.away_rank <= 3) : false,
    home_table_rank: standings?.home_rank ?? null,
    away_table_rank: standings?.away_rank ?? null,
    points_gap_to_safety_home: standings?.home_points_gap_safety ?? null,
    points_gap_to_safety_away: standings?.away_points_gap_safety ?? null,
  };

  const lineupConfirmed = !!context.lineups?.home.starters.length;
  const probable = lineupConfirmed
    ? { home: context.lineups!.home.starters, away: context.lineups!.away.starters }
    : extractProbableLineup(raw.perplexity_lineup_text);

  const lineups_probable: DataFoundationOutput['lineups_probable'] = {
    home_xi: probable.home,
    away_xi: probable.away,
    confidence: lineupConfirmed
      ? 'CONFIRMED'
      : (probable.home && probable.away ? 'PROBABLE_FROM_PERPLEXITY' : 'UNAVAILABLE'),
  };

  let clv_signal: number | null = null;
  if (raw.opening_odds && raw.closing_odds) {
    const open = raw.opening_odds.home_win;
    const close = raw.closing_odds.home_win;
    if (open > 1 && close > 1) {
      clv_signal = Number((((open - close) / open) * 100).toFixed(2));
    }
  }

  const fields = [
    homeRecent.length, awayRecent.length, raw.referee_name, raw.sportmonks_predictions,
    context.lineups, context.weather, context.xg, context.fatigue, context.coaches,
    context.external_context, raw.standings, raw.opening_odds, raw.closing_odds,
    home_missing.length, away_missing.length,
  ];
  const data_volume_score = 1000 + fields.filter((f) => f !== null && f !== undefined && f !== 0 && f !== '').length * 150;

  return {
    fixture_id: raw.fixture_id,
    home_team: context.homeTeam,
    away_team: context.awayTeam,
    league: context.league,
    date: context.date,
    kickoff_at: raw.kickoff_at,
    streak_home,
    streak_away,
    days_rest_home,
    days_rest_away,
    xg_rolling,
    goals_avg,
    referee_stats,
    sportmonks_predictions: raw.sportmonks_predictions ?? null,
    injuries_impact,
    competition_context,
    lineups_probable,
    clv_signal,
    data_volume_score,
  };
}
