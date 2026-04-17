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
