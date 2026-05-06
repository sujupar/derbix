// _shared/agents/orchestrator.ts
// V9 Hybrid Pipeline (V9-EXPRESS, deployed 2026-05-06)
// Stage 0 deterministic → Stage 2 parallel → Stage 3+4 combined → Stage 5 deterministic
// Stage 1 skipped — specialists work directly from data_foundation. Reduces from 4 LLM calls to 2 wall-clock units (Stage 2 parallel + Stage 3+4) to fit in 130s budget.

import { buildDataFoundation, type ETLRawData } from './stage0-data-foundation.ts';
import { runStage2 } from './stage2-specialists.ts';
import { runStage3and4 } from './stage3-skeptic.ts';
import { runStage5 } from './stage5-validation-gate.ts';
import type { MatchContext, PipelineRunResult, StatisticalFoundationOutput } from './types.ts';

export type { ETLRawData } from './stage0-data-foundation.ts';

export async function runPipeline(
  context: MatchContext,
  rawETL: ETLRawData,
): Promise<PipelineRunResult> {
  const t0 = Date.now();

  // Stage 0 — deterministic data foundation
  const stage0Start = Date.now();
  const data_foundation = buildDataFoundation(context, rawETL);
  const stage0_ms = Date.now() - stage0Start;
  console.log(`[orchestrator] Stage 0 done in ${stage0_ms}ms — data_volume_score=${data_foundation.data_volume_score}`);

  // Stage 1 — SKIPPED in V9-EXPRESS. Stub statistical_foundation derived deterministically from
  // data_foundation so downstream stages still see the expected shape.
  const stage1Start = Date.now();
  const statistical_foundation: StatisticalFoundationOutput = {
    thesis_baseline: `Análisis baseline de ${data_foundation.home_team} vs ${data_foundation.away_team}. Streak local ${data_foundation.streak_home}, visitante ${data_foundation.streak_away}. xG rolling local ${data_foundation.xg_rolling.home_for_10}/${data_foundation.xg_rolling.home_against_10}, visitante ${data_foundation.xg_rolling.away_for_10}/${data_foundation.xg_rolling.away_against_10}.`,
    probabilities_initial: data_foundation.sportmonks_predictions
      ? {
          home_win: data_foundation.sportmonks_predictions.home_win,
          draw: data_foundation.sportmonks_predictions.draw,
          away_win: data_foundation.sportmonks_predictions.away_win,
          over_25: data_foundation.sportmonks_predictions.over_25,
          btts: data_foundation.sportmonks_predictions.btts_yes,
          home_to_score: 65,
          away_to_score: 60,
        }
      : { home_win: 40, draw: 28, away_win: 32, over_25: 55, btts: 55, home_to_score: 65, away_to_score: 60 },
    key_anchors: [
      `xG diff: ${(data_foundation.xg_rolling.home_for_10 - data_foundation.xg_rolling.away_for_10).toFixed(2)}`,
      `Days rest: home ${data_foundation.days_rest_home}, away ${data_foundation.days_rest_away}`,
      `Streak: ${data_foundation.streak_home} vs ${data_foundation.streak_away}`,
    ],
    risks_flagged: [
      ...data_foundation.injuries_impact.home_key_missing.length > 0 ? [`Lesiones local: ${data_foundation.injuries_impact.home_key_missing.join(', ')}`] : [],
      ...data_foundation.injuries_impact.away_key_missing.length > 0 ? [`Lesiones visitante: ${data_foundation.injuries_impact.away_key_missing.join(', ')}`] : [],
      ...data_foundation.lineups_probable.confidence === 'UNAVAILABLE' ? ['Alineaciones no disponibles'] : [],
    ],
  };
  const stage1_ms = Date.now() - stage1Start;
  console.log(`[orchestrator] Stage 1 (deterministic stub) done in ${stage1_ms}ms`);

  // Stage 2 — 3 specialists in parallel (work from data_foundation directly)
  const stage2Start = Date.now();
  const specialists = await runStage2(data_foundation, statistical_foundation, context);
  const stage2_ms = Date.now() - stage2Start;
  console.log(`[orchestrator] Stage 2 done in ${stage2_ms}ms — TAC:${specialists.tactical.candidate_picks.length} CTX:${specialists.contextual.candidate_picks.length} MKT:${specialists.market.candidate_picks.length} picks`);

  // Stage 3+4 combined — Skeptic + Synthesizer in a single LLM call
  const stage34Start = Date.now();
  const combined = await runStage3and4(data_foundation, statistical_foundation, specialists);
  const skeptic = combined.skeptic;
  const synthesizer = combined.synthesizer;
  const stage34_ms = Date.now() - stage34Start;
  console.log(`[orchestrator] Stage 3+4 done in ${stage34_ms}ms — ${skeptic.attacks.length} attacks, verdict=${synthesizer.veredicto}, ${synthesizer.picks.length} picks`);

  // Stage 5 — deterministic validation gate
  const stage5Start = Date.now();
  const { validated_picks, rejected } = runStage5(data_foundation, statistical_foundation, specialists, synthesizer);
  const stage5_ms = Date.now() - stage5Start;
  console.log(`[orchestrator] Stage 5 done in ${stage5_ms}ms — ${validated_picks.length} validated, ${rejected.length} rejected`);
  for (const r of rejected) {
    console.log(`[orchestrator]   ✗ rejected: ${r.pick.market} ${r.pick.selection} — ${r.reason}`);
  }

  const total_ms = Date.now() - t0;
  console.log(`[orchestrator] Pipeline complete in ${total_ms}ms`);

  return {
    data_foundation,
    statistical_foundation,
    specialists,
    skeptic,
    synthesizer,
    validated_picks,
    timings: {
      stage0_ms,
      stage1_ms,
      stage2_ms,
      stage3_ms: Math.floor(stage34_ms / 2),
      stage4_ms: Math.ceil(stage34_ms / 2),
      stage5_ms,
      total_ms,
    },
    total_tokens: 0,
    pipeline_version: 'V9-HYBRID-2026-05-05',
  };
}

/**
 * @deprecated Removed in V9. Use runPipeline(context, rawETL) instead.
 */
export function runDebate(): never {
  throw new Error('[orchestrator] runDebate() is removed in V9. Use runPipeline(context, rawETL) instead.');
}

export function buildAgentPrompt(): string {
  throw new Error('[orchestrator] buildAgentPrompt is removed in V9. See stage1-5 files for stage-specific prompts.');
}
