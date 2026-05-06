// _shared/agents/types.ts
// Shared types for multi-agent debate system.

import type { MathModelsOutput } from '../math-models/index.ts';

export interface MatchContext {
  homeTeam: string;
  awayTeam: string;
  league: string;
  date: string;

  // Mathematical baseline (MUST be provided to every agent)
  math: MathModelsOutput;

  // Raw data for deep analysis
  homeHistory: string;        // formatted last 10 matches
  awayHistory: string;
  h2h: string;
  odds: string;               // formatted odds text
  lineups?: {
    home: { formation: string | null; starters: string[]; missing: string[] };
    away: { formation: string | null; starters: string[]; missing: string[] };
  };
  weather?: {
    description: string;
    impact: string;
  } | null;
  coaches?: {
    home: { name: string; is_new: boolean };
    away: { name: string; is_new: boolean };
  };
  xg?: {
    home: { for: number; against: number; overperf: number };
    away: { for: number; against: number; overperf: number };
  };
  fatigue?: {
    home: number;  // 0-100
    away: number;
  };
  key_players?: {
    home_missing: string[];
    away_missing: string[];
  };
  external_context?: string;  // Perplexity news

  // Historical context (RAG)
  similar_past_picks?: Array<{
    summary: string;
    outcome: 'WON' | 'LOST' | 'VOID';
    features: Record<string, any>;
  }>;
}

export interface AgentAnalysis {
  agent_name: string;
  agent_role: string;
  key_findings: string[];      // 3-5 bullet points
  recommended_picks: Array<{
    market: string;
    selection: string;
    probability_estimate: number;  // 0-100
    reasoning: string;
    risk_level: 'LOW' | 'MEDIUM' | 'HIGH';
  }>;
  confidence_overall: number;   // 0-100
  key_risks: string[];
  devil_arguments?: string[];   // for skeptic agent only
  provider_used?: string;       // which LLM actually responded
  tokens_used?: number;
  error?: string;
}

export interface DebateResult {
  agents: AgentAnalysis[];
  consensus: {
    strong_picks: Array<{
      market: string;
      selection: string;
      agreed_by: number;        // how many agents agreed
      avg_probability: number;
      confidence: 'ALTA' | 'MEDIA' | 'BAJA';
    }>;
    divergent_picks: Array<{
      market: string;
      selection: string;
      agreed_by: number;
      note: string;
    }>;
  };
  final_verdict: {
    veredicto: 'APOSTAR' | 'OBSERVAR' | 'NO_BET';
    picks: AgentAnalysis['recommended_picks'];
    summary: string;
    overall_confidence: number;
  };
  total_tokens: number;
  total_time_ms: number;
}

export interface AgentConfig {
  name: string;
  role: string;
  system_prompt: string;
  preferred_provider?: string;  // e.g. 'groq-kimi-k2'
  temperature: number;
  max_tokens: number;
}

// ═══════════════════════════════════════════════════════════════════
// V9 STAGE-BASED PIPELINE TYPES (added 2026-05-05)
// ═══════════════════════════════════════════════════════════════════

export interface DataFoundationOutput {
  // Computed deterministically from raw ETL data — no LLM
  fixture_id: number;
  home_team: string;
  away_team: string;
  league: string;
  date: string;
  kickoff_at: string;

  streak_home: string;             // e.g. "WWDLW"
  streak_away: string;
  days_rest_home: number;
  days_rest_away: number;

  xg_rolling: {
    home_for_5: number; home_against_5: number;
    home_for_10: number; home_against_10: number;
    away_for_5: number; away_against_5: number;
    away_for_10: number; away_against_10: number;
  };

  goals_avg: {
    home_at_home_last5: number;
    away_away_last5: number;
    home_overall_last10: number;
    away_overall_last10: number;
  };

  referee_stats: {
    name: string | null;
    yellows_per_match: number | null;
    reds_per_match: number | null;
    home_bias: number | null;
    matches_in_dataset: number;
  } | null;

  sportmonks_predictions: {
    home_win: number; draw: number; away_win: number;
    over_25: number; btts_yes: number;
  } | null;

  injuries_impact: {
    home_xg_loss_estimate: number;
    away_xg_loss_estimate: number;
    home_key_missing: string[];
    away_key_missing: string[];
  };

  competition_context: {
    is_derby: boolean;
    is_relegation_battle: boolean;
    is_title_race: boolean;
    home_table_rank: number | null;
    away_table_rank: number | null;
    points_gap_to_safety_home: number | null;
    points_gap_to_safety_away: number | null;
  };

  lineups_probable: {
    home_xi: string[] | null;
    away_xi: string[] | null;
    confidence: 'CONFIRMED' | 'PROBABLE_FROM_PERPLEXITY' | 'UNAVAILABLE';
  };

  clv_signal: number | null;        // closing line value % vs opening line, if available

  data_volume_score: number;        // counts non-null fields (used for PDF "N datos analizados")
}

export interface StatisticalFoundationOutput {
  thesis_baseline: string;
  probabilities_initial: {
    home_win: number; draw: number; away_win: number;
    over_25: number; btts: number;
    home_to_score: number; away_to_score: number;
  };
  key_anchors: string[];
  risks_flagged: string[];
}

export interface SpecialistOutput {
  agent_name: 'TACTICAL' | 'CONTEXTUAL' | 'MARKET';
  thesis_supports_or_opposes: 'SUPPORTS' | 'OPPOSES' | 'MIXED';
  key_findings: string[];
  modifies_probabilities: Record<string, number>;
  candidate_picks: Array<{
    market: string;
    selection: string;
    rationale: string;
    probability_estimate: number;
    odds_reference: number | null;
  }>;
  notes: string;
}

export interface SkepticOutput {
  attacks: Array<{
    target_pick_market: string;
    target_pick_selection: string;
    attack_argument: string;
    verdict: 'DESCARTAR' | 'DEBILITAR_CONFIANZA' | 'MANTENER';
  }>;
  picks_that_survive: Array<{
    market: string;
    selection: string;
    why_it_holds: string;
  }>;
  global_observations: string[];
}

export interface SynthesizerOutput {
  veredicto: 'APOSTAR' | 'OBSERVAR' | 'NO_BET';
  picks: Array<{
    market: string;
    selection: string;
    probability: number;
    odds: number;
    edge_percent: number;
    confidence: 'ALTA' | 'MEDIA' | 'BAJA';
    reasoning: string;
    survived_skeptic: boolean;
  }>;
  summary: string;
  overall_confidence: number;
  total_data_volume: number;
}

export interface StageTimings {
  stage0_ms: number;
  stage1_ms: number;
  stage2_ms: number;
  stage3_ms: number;
  stage4_ms: number;
  stage5_ms: number;
  total_ms: number;
}

export interface PipelineRunResult {
  data_foundation: DataFoundationOutput;
  statistical_foundation: StatisticalFoundationOutput;
  specialists: {
    tactical: SpecialistOutput;
    contextual: SpecialistOutput;
    market: SpecialistOutput;
  };
  skeptic: SkepticOutput;
  synthesizer: SynthesizerOutput;
  validated_picks: SynthesizerOutput['picks'];
  timings: StageTimings;
  total_tokens: number;
  pipeline_version: 'V9-HYBRID-2026-05-05' | 'V9-MEGA-2026-05-06';
}
