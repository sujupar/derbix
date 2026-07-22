// _shared/agents/orchestrator.ts
// V9-MEGA pipeline (deployed 2026-05-06)
// Stage 0 deterministic → Stage MEGA (single LLM call) → Stage 5 deterministic
// Multi-stage architecture proved unreliable with DeepSeek-V4-Flash (reasoning model
// adds 30-50s per call). MEGA collapses analysis into one ~30-50s call for reliability.

import { buildDataFoundation, type ETLRawData } from './stage0-data-foundation.ts';
import { runMegaStage, megaToV9Shape } from './stage-mega.ts';
import { runStage5 } from './stage5-validation-gate.ts';
import { reconcilePicksWithMath } from './math-reconciler.ts';
import type { MatchContext, PipelineRunResult } from './types.ts';

export type { ETLRawData } from './stage0-data-foundation.ts';

export async function runPipeline(
  context: MatchContext,
  rawETL: ETLRawData,
  organizedOdds?: any, // Optional: full bookmaker catalog passed to MEGA for market diversity
): Promise<PipelineRunResult> {
  const t0 = Date.now();

  // Stage 0 — deterministic data foundation
  const stage0Start = Date.now();
  const data_foundation = buildDataFoundation(context, rawETL);
  const stage0_ms = Date.now() - stage0Start;
  console.log(`[orchestrator] Stage 0 done in ${stage0_ms}ms — data_volume_score=${data_foundation.data_volume_score}`);

  // Stage MEGA — single LLM call for analysis + picks + verdict
  const megaStart = Date.now();
  const mega = await runMegaStage(data_foundation, context, organizedOdds);
  const mega_ms = Date.now() - megaStart;
  console.log(`[orchestrator] Stage MEGA done in ${mega_ms}ms — verdict=${mega.veredicto}, ${mega.picks.length} picks`);

  // Stage MEGA+ — reconcile LLM probabilities against the mathematical models
  // (Dixon-Coles + Elo + Monte Carlo). Blends covered-market probabilities with
  // the model baseline and downgrades/flags large disagreements. Markets the
  // models don't cover (córners, tarjetas, hándicap) keep the LLM estimate but
  // are capped in confidence. Env MATH_BLEND_WEIGHT (default 0.5) tunes trust.
  const blendWeight = Number(Deno.env.get('MATH_BLEND_WEIGHT') ?? '0.5');
  const reconciled = reconcilePicksWithMath(mega, context.math, isFinite(blendWeight) ? blendWeight : 0.5);
  if (reconciled.notes.length > 0) {
    console.log(`[orchestrator] Math reconcile: ${reconciled.notes.length} adjustment(s)`);
    for (const a of reconciled.audit) {
      if (a.action === 'flagged') {
        console.log(`[orchestrator]   ⚖ ${a.market}/${a.selection}: LLM ${a.llm_prob}% ↔ math ${a.math_prob}% → ${a.blended_prob}%`);
      }
    }
  }
  mega.picks = reconciled.picks;
  // Surface reconciliation notes as risks so the modal/PDF explain the adjustment.
  mega.riesgos_identificados = [...(mega.riesgos_identificados || []), ...reconciled.notes];

  // Adapt to V9 shape (so persistence layer doesn't change)
  const { statistical_foundation, specialists, skeptic, synthesizer } = megaToV9Shape(mega, data_foundation);

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
      stage1_ms: 0,
      stage2_ms: 0,
      stage3_ms: 0,
      stage4_ms: mega_ms,
      stage5_ms,
      total_ms,
    },
    total_tokens: 0,
    pipeline_version: 'V9-MEGA-2026-05-06',
  };
}

/** @deprecated Use runPipeline */
export function runDebate(): never {
  throw new Error('[orchestrator] runDebate() removed in V9. Use runPipeline(context, rawETL).');
}

/** @deprecated */
export function buildAgentPrompt(): string {
  throw new Error('[orchestrator] buildAgentPrompt removed in V9.');
}
