// _shared/agents/math-reconciler.ts
// V10 upgrade (2026-07-22): reconcile the MEGA LLM's free-hand probabilities
// against the mathematical models (Dixon-Coles + Elo + Monte Carlo ensemble)
// that the pipeline already computes but historically discarded.
//
// Why this exists:
//   Before V10, runMathModels() produced Dixon-Coles scoreline matrices, Elo
//   ratings and a 10k-run Monte Carlo — and NONE of it reached the decision.
//   The MEGA stage invented probabilities with no statistical anchor, then the
//   worker only checked prob>=80, an odds range and prob↔odds coherence.
//   This module grounds every published probability in the math baseline:
//   for markets the models cover (1X2, doble oportunidad, over/under, BTTS,
//   goles por equipo) it BLENDS the LLM estimate with the model estimate and
//   flags/downgrades large disagreements. Markets the models don't cover
//   (córners, tarjetas, hándicap, mitades) are kept but capped in confidence.
//
// The blend is deliberately conservative and reduces (never inflates) implied
// edge, so it composes safely with the downstream prob↔odds sanity gate.

import type { MatchContext } from './types.ts';
import type { MegaOutput } from './stage-mega.ts';

type MathModels = MatchContext['math'];

export interface ReconcileResult {
  picks: MegaOutput['picks'];
  notes: string[];               // human-readable reconciliation notes (surfaced as risks)
  audit: Array<{
    market: string;
    selection: string;
    llm_prob: number;            // 0-100
    math_prob: number | null;    // 0-100, null when market not modeled
    blended_prob: number;        // 0-100 (final)
    divergence_pts: number | null;
    action: 'blended' | 'flagged' | 'uncapped_market' | 'no_math';
  }>;
}

function norm(s: string): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Map a (market, selection) pair — written by the LLM in Spanish — to the
 * corresponding model probability (0-1) from the math ensemble, or null when
 * the market is not modeled (córners, tarjetas, hándicap asiático, mitades).
 *
 * Preference order: Monte Carlo market_probabilities (richest + smoothest),
 * with the DC+Elo+MC ensemble overriding the five headline markets (it also
 * folds in Elo rating information).
 */
export function getMathBaselineProb(
  market: string,
  selection: string,
  math: MathModels,
): number | null {
  if (!math?.monte_carlo?.market_probabilities) return null;

  const mc = math.monte_carlo.market_probabilities;
  const dc = math.dixon_coles?.probabilities;
  const ens = math.ensemble_probabilities;

  const m = norm(market);
  const s = norm(selection);
  const blob = `${m} ${s}`;

  const isHomeSel = /\blocal\b|\bhome\b|\b1\b/.test(s) || s.includes('(local)');
  const isAwaySel = /\bvisitante\b|\baway\b|\b2\b/.test(s) || s.includes('(visitante)');
  const isDraw = /\bempate\b|\bdraw\b|\bx\b/.test(s);

  // ── Córners / Tarjetas / Hándicap / Mitades: NOT modeled ──────────────
  if (m.includes('corner') || m.includes('cordner') || m.includes('tarjeta') ||
      m.includes('card') || m.includes('handicap') || m.includes('asian') ||
      m.includes('tiempo') || m.includes('mitad') || m.includes('half')) {
    return null;
  }

  // ── Doble oportunidad (check BEFORE 1X2 since it also mentions teams) ──
  if (m.includes('doble oportunidad') || m.includes('double chance') || /\b1x\b|\bx2\b|\b12\b/.test(s)) {
    if (/\b12\b/.test(blob) || (isHomeSel && isAwaySel)) return mc.home_or_away ?? dc?.home_or_away ?? null;
    if (/\b1x\b/.test(blob) || (isHomeSel && isDraw)) return mc.home_or_draw ?? dc?.home_or_draw ?? null;
    if (/\bx2\b/.test(blob) || (isAwaySel && isDraw)) return mc.away_or_draw ?? dc?.away_or_draw ?? null;
    // "Local o Empate" / "Empate o Visitante" phrasing without explicit 1X/X2 token
    if (isHomeSel) return mc.home_or_draw ?? null;
    if (isAwaySel) return mc.away_or_draw ?? null;
    return null;
  }

  // ── BTTS / Ambos anotan ───────────────────────────────────────────────
  if (m.includes('ambos anotan') || m.includes('btts') || blob.includes('ambos marcan')) {
    if (/\bno\b/.test(s)) return mc.btts_no ?? dc?.btts_no ?? (1 - (ens?.btts_yes ?? mc.btts_yes));
    return ens?.btts_yes ?? mc.btts_yes ?? dc?.btts_yes ?? null;
  }

  // ── Goles por equipo (team totals) ────────────────────────────────────
  if (m.includes('goles del local') || m.includes('goles local') ||
      (m.includes('local') && (m.includes('mas de') || m.includes('menos de') || m.includes('over') || m.includes('under')))) {
    const th = extractThreshold(s);
    return teamTotalProb(mc, 'home', th, /menos|under/.test(s));
  }
  if (m.includes('goles del visitante') || m.includes('goles visitante') ||
      (m.includes('visitante') && (m.includes('mas de') || m.includes('menos de') || m.includes('over') || m.includes('under')))) {
    const th = extractThreshold(s);
    return teamTotalProb(mc, 'away', th, /menos|under/.test(s));
  }

  // ── Total de goles Over/Under ─────────────────────────────────────────
  if (m.includes('gol') || m.includes('over') || m.includes('under') ||
      m.includes('mas de') || m.includes('menos de') || m.includes('total')) {
    const th = extractThreshold(blob);
    if (th == null) return null;
    const isUnder = /menos|under/.test(blob);
    const overKey = thresholdToOverKey(th);
    if (!overKey) return null;
    const over = overKey === 'over_25' ? (ens?.over_25 ?? mc.over_25) : (mc as any)[overKey];
    if (over == null) return null;
    return isUnder ? 1 - over : over;
  }

  // ── Resultado 1X2 / Match winner ──────────────────────────────────────
  if (m.includes('1x2') || m.includes('resultado') || m.includes('match winner') || m.includes('ganador') || isHomeSel || isAwaySel || isDraw) {
    if (isDraw && !isHomeSel && !isAwaySel) return ens?.draw ?? mc.draw ?? dc?.draw ?? null;
    if (isHomeSel) return ens?.home_win ?? mc.home_win ?? dc?.home_win ?? null;
    if (isAwaySel) return ens?.away_win ?? mc.away_win ?? dc?.away_win ?? null;
  }

  return null;
}

function extractThreshold(s: string): number | null {
  const m = s.match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

function thresholdToOverKey(th: number): string | null {
  const map: Record<string, string> = {
    '0.5': 'over_05', '1.5': 'over_15', '2.5': 'over_25', '3.5': 'over_35', '4.5': 'over_45',
  };
  return map[String(th)] ?? null;
}

function teamTotalProb(
  mc: NonNullable<MathModels>['monte_carlo']['market_probabilities'],
  side: 'home' | 'away',
  th: number | null,
  isUnder: boolean,
): number | null {
  if (th == null) return null;
  const key = `${side}_over_${String(th).replace('.', '')}` as keyof typeof mc; // e.g. home_over_05
  const over = (mc as any)[key];
  if (over == null) return null;
  return isUnder ? 1 - over : over;
}

/**
 * Decide how much to trust the math baseline vs the LLM, based on sample size
 * and model agreement. Returns a weight in [0.2, 0.7] applied to the MATH prob.
 */
function mathWeight(math: MathModels, base: number): number {
  let w = base;
  const d = math?.diagnostics;
  if (d) {
    const minSample = Math.min(d.home_sample_size ?? 0, d.away_sample_size ?? 0);
    if (minSample < 4) w -= 0.25;
    else if (minSample < 7) w -= 0.12;
    if (d.elo_confidence === 'LOW') w -= 0.10;
    if (typeof d.model_consistency === 'number' && d.model_consistency < 0.4) w -= 0.08;
  }
  return Math.max(0.2, Math.min(0.7, w));
}

/**
 * Reconcile the MEGA picks with the math ensemble. Pure function — returns a
 * new picks array (does not mutate the input) plus notes/audit for surfacing.
 *
 * @param baseWeight default weight on the math baseline (env MATH_BLEND_WEIGHT overrides in caller)
 */
export function reconcilePicksWithMath(
  mega: MegaOutput,
  math: MathModels,
  baseWeight = 0.5,
): ReconcileResult {
  const notes: string[] = [];
  const audit: ReconcileResult['audit'] = [];

  // No math available → passthrough (defensive; V9 analyzer always provides it).
  if (!math?.monte_carlo?.market_probabilities) {
    return {
      picks: mega.picks,
      notes: [],
      audit: mega.picks.map((p) => ({
        market: p.market, selection: p.selection, llm_prob: p.probability,
        math_prob: null, blended_prob: p.probability, divergence_pts: null, action: 'no_math',
      })),
    };
  }

  const w = mathWeight(math, baseWeight);

  const picks = mega.picks.map((p) => {
    const mathProbRaw = getMathBaselineProb(p.market, p.selection, math); // 0-1 or null
    const llmProb = clampPct(p.probability);

    if (mathProbRaw == null) {
      // Market not modeled — keep LLM estimate but cap confidence at MEDIA and note it.
      const capped: MegaOutput['picks'][number] = {
        ...p,
        confidence: p.confidence === 'ALTA' ? 'MEDIA' : p.confidence,
      };
      audit.push({
        market: p.market, selection: p.selection, llm_prob: llmProb,
        math_prob: null, blended_prob: capped.probability, divergence_pts: null, action: 'uncapped_market',
      });
      return capped;
    }

    const mathPct = clampPct(mathProbRaw * 100);
    const blended = Math.round(w * mathPct + (1 - w) * llmProb);
    const divergence = Math.round(llmProb - mathPct);
    const absDiv = Math.abs(divergence);

    let confidence = p.confidence;
    let action: ReconcileResult['audit'][number]['action'] = 'blended';
    if (absDiv >= 25) {
      confidence = 'BAJA';
      action = 'flagged';
      notes.push(
        `${p.market} — ${p.selection}: el analista estimó ${llmProb}% pero los modelos (Dixon-Coles/Elo/Monte Carlo) estiman ${mathPct}%. Probabilidad ajustada a ${blended}% y confianza reducida por la discrepancia.`,
      );
    } else if (absDiv >= 15) {
      confidence = confidence === 'ALTA' ? 'MEDIA' : confidence;
      action = 'flagged';
      notes.push(
        `${p.market} — ${p.selection}: discrepancia moderada (LLM ${llmProb}% vs modelo ${mathPct}%). Probabilidad ajustada a ${blended}%.`,
      );
    }

    audit.push({
      market: p.market, selection: p.selection, llm_prob: llmProb,
      math_prob: mathPct, blended_prob: blended, divergence_pts: divergence, action,
    });

    return { ...p, probability: blended, confidence };
  });

  return { picks, notes, audit };
}

function clampPct(n: number): number {
  if (!isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
