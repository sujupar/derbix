// _shared/agents/orchestrator.ts
// V9 Hybrid Sequential-Parallel Pipeline (deployed 2026-05-05)
// Stage 0 deterministic → Stage 1 → Stage 2 parallel → Stage 3 → Stage 4 → Stage 5 deterministic

import { buildDataFoundation, type ETLRawData } from './stage0-data-foundation.ts';
import { runStage1 } from './stage1-statistical-foundation.ts';
import { runStage2 } from './stage2-specialists.ts';
import { runStage3 } from './stage3-skeptic.ts';
import { runStage4 } from './stage4-synthesizer.ts';
import { runStage5 } from './stage5-validation-gate.ts';
import type { MatchContext, PipelineRunResult } from './types.ts';

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

  // Stage 1 — statistical foundation (1 LLM call)
  const stage1Start = Date.now();
  const statistical_foundation = await runStage1(data_foundation);
  const stage1_ms = Date.now() - stage1Start;
  console.log(`[orchestrator] Stage 1 done in ${stage1_ms}ms`);

  // Stage 2 — 3 specialists in parallel
  const stage2Start = Date.now();
  const specialists = await runStage2(data_foundation, statistical_foundation, context);
  const stage2_ms = Date.now() - stage2Start;
  console.log(`[orchestrator] Stage 2 done in ${stage2_ms}ms — TAC:${specialists.tactical.candidate_picks.length} CTX:${specialists.contextual.candidate_picks.length} MKT:${specialists.market.candidate_picks.length} picks`);

  // Stage 3 — skeptic
  const stage3Start = Date.now();
  const skeptic = await runStage3(data_foundation, statistical_foundation, specialists);
  const stage3_ms = Date.now() - stage3Start;
  console.log(`[orchestrator] Stage 3 done in ${stage3_ms}ms — ${skeptic.attacks.length} attacks, ${skeptic.picks_that_survive.length} survived`);

  // Stage 4 — synthesizer
  const stage4Start = Date.now();
  const synthesizer = await runStage4(data_foundation, statistical_foundation, specialists, skeptic);
  const stage4_ms = Date.now() - stage4Start;
  console.log(`[orchestrator] Stage 4 done in ${stage4_ms}ms — verdict=${synthesizer.veredicto}, ${synthesizer.picks.length} picks`);

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
    timings: { stage0_ms, stage1_ms, stage2_ms, stage3_ms, stage4_ms, stage5_ms, total_ms },
    total_tokens: 0,
    pipeline_version: 'V9-HYBRID-2026-05-05',
  };
}

/**
 * @deprecated Removed in V9. Use runPipeline(context, rawETL) instead.
 * Kept as a throwing stub so callers fail loudly during migration.
 */
export function runDebate(): never {
  throw new Error('[orchestrator] runDebate() is removed in V9. Use runPipeline(context, rawETL) instead.');
}

/**
 * @deprecated buildAgentPrompt was used by the V8 multi-agent debate. V9 uses stage-specific
 * prompts inline within each stage file. Kept as a stub so static imports compile until callers migrate.
 */
export function buildAgentPrompt(): string {
  throw new Error('[orchestrator] buildAgentPrompt is removed in V9. See stage1-5 files for stage-specific prompts.');
}
