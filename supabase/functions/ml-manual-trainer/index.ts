// supabase/functions/ml-manual-trainer/index.ts
// V9: Manual ML trainer. Only processes picks approved via admin gate.
// Updates ml_calibration_factors (Platt scaling) and ml_learned_patterns.
// MUST be triggered manually from admin UI — never via cron.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from '../_shared/cors.ts'

interface CalibrationUpdate {
  dimension: 'prob_band' | 'market' | 'league' | 'odds_range';
  key: string;
  sample_size: number;
  actual_wr: number;
  predicted_avg: number;
  calibration_factor: number;
  confidence_adjustment: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const sbUrl = Deno.env.get('SUPABASE_URL')!;
    const sbKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(sbUrl, sbKey);

    const body = await req.json().catch(() => ({}));
    const { trigger_reason, admin_user_id } = body;

    console.log(`[ml-manual-trainer] Triggered by admin ${admin_user_id || 'unknown'} — reason: ${trigger_reason || 'manual'}`);

    // Step 1: Fetch approved-but-not-yet-processed picks
    const { data: approvedPicks, error: fetchErr } = await supabase
      .from('ml_verified_picks')
      .select('*, value_picks_v2!pick_id(*)')
      .eq('approved_for_learning', true)
      .eq('processed_for_learning', false)
      .limit(500);

    if (fetchErr) throw fetchErr;

    if (!approvedPicks || approvedPicks.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No new approved picks to process',
        picks_processed: 0,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`[ml-manual-trainer] Processing ${approvedPicks.length} approved picks...`);

    // Step 2: Aggregate by dimension
    const dimensions = new Map<string, { wins: number; total: number; predictedSum: number; key: string; type: string }>();

    const bumpDimension = (type: string, key: string, won: boolean, predicted: number) => {
      const fullKey = `${type}|${key}`;
      const entry = dimensions.get(fullKey) || { wins: 0, total: 0, predictedSum: 0, key, type };
      entry.total += 1;
      entry.predictedSum += predicted;
      if (won) entry.wins += 1;
      dimensions.set(fullKey, entry);
    };

    const probBand = (prob: number): string => {
      if (prob >= 0.90) return '90+';
      if (prob >= 0.85) return '85-90';
      if (prob >= 0.80) return '80-85';
      if (prob >= 0.75) return '75-80';
      if (prob >= 0.70) return '70-75';
      return '65-70';
    };

    const oddsRange = (odds: number): string => {
      if (odds < 1.40) return '1.00-1.39';
      if (odds < 1.70) return '1.40-1.69';
      if (odds < 2.00) return '1.70-1.99';
      if (odds < 2.50) return '2.00-2.49';
      return '2.50+';
    };

    let skippedNoVerdict = 0;
    for (const row of approvedPicks) {
      const pick = row.value_picks_v2 || row;
      // V9 MANUAL GATE: admin_verdict MUST be explicitly set (cannot fall back to system).
      // This prevents "blind approval" where admin clicks approve without verifying the result.
      const adminVerdict = row.admin_verdict;
      if (!adminVerdict || adminVerdict === 'PENDING' || adminVerdict === 'VOID') {
        skippedNoVerdict++;
        continue;
      }

      const won = adminVerdict === 'WON';
      const predicted = Number(row.predicted_probability || pick.p_model || 0);
      const odds = Number(row.odds || pick.odds || 0);
      const market = row.market || pick.market || 'unknown';
      const league = pick.league_name || 'unknown';

      bumpDimension('prob_band', probBand(predicted), won, predicted);
      bumpDimension('market', market, won, predicted);
      bumpDimension('league', league, won, predicted);
      if (odds > 0) bumpDimension('odds_range', oddsRange(odds), won, predicted);
    }

    // Step 3: Compute calibration updates
    const updates: CalibrationUpdate[] = [];
    for (const [fullKey, data] of dimensions.entries()) {
      if (data.total < 5) continue; // Need at least 5 samples

      const actualWR = data.wins / data.total;
      const predictedAvg = data.predictedSum / data.total;
      const gap = predictedAvg - actualWR; // positive = overconfident

      // Calibration factor: how much to multiply predicted by to align with actual
      const calibrationFactor = actualWR > 0 ? actualWR / predictedAvg : 1;

      // Confidence adjustment (points to add/subtract, capped at ±10)
      const confidenceAdj = Math.max(-10, Math.min(10, -gap * 100));

      updates.push({
        dimension: data.type as any,
        key: data.key,
        sample_size: data.total,
        actual_wr: Math.round(actualWR * 1000) / 1000,
        predicted_avg: Math.round(predictedAvg * 1000) / 1000,
        calibration_factor: Math.round(calibrationFactor * 1000) / 1000,
        confidence_adjustment: Math.round(confidenceAdj * 10) / 10,
      });
    }

    // Step 4: Upsert into ml_calibration_factors
    for (const u of updates) {
      const { error: upsertErr } = await supabase
        .from('ml_calibration_factors')
        .upsert({
          dimension_type: u.dimension,
          dimension_key: u.key,
          sample_size: u.sample_size,
          actual_wr: u.actual_wr,
          predicted_avg: u.predicted_avg,
          calibration_factor: u.calibration_factor,
          confidence_adjustment: u.confidence_adjustment,
          status: 'active',
          last_updated: new Date().toISOString(),
        }, { onConflict: 'dimension_type,dimension_key' });

      if (upsertErr) console.warn(`[ml-manual-trainer] Failed to upsert ${u.dimension}/${u.key}:`, upsertErr.message);
    }

    // Step 5: Mark picks as processed
    const pickIds = approvedPicks.map((p: any) => p.id);
    const { error: markErr } = await supabase
      .from('ml_verified_picks')
      .update({ processed_for_learning: true, processed_at: new Date().toISOString() })
      .in('id', pickIds);

    if (markErr) console.warn(`[ml-manual-trainer] Failed to mark picks as processed:`, markErr.message);

    // Step 6: Log training run
    const { error: logErr } = await supabase
      .from('ml_training_runs')
      .insert({
        run_type: 'manual',
        triggered_by: admin_user_id || 'admin',
        picks_processed: approvedPicks.length,
        dimensions_updated: updates.length,
        metadata: { reason: trigger_reason, updates: updates.slice(0, 20) },
        created_at: new Date().toISOString(),
      });

    // non-fatal if ml_training_runs doesn't exist
    if (logErr) console.warn(`[ml-manual-trainer] Could not log run (non-fatal):`, logErr.message);

    return new Response(JSON.stringify({
      success: true,
      picks_processed: approvedPicks.length - skippedNoVerdict,
      skipped_no_verdict: skippedNoVerdict,
      dimensions_updated: updates.length,
      updates: updates.slice(0, 30),
      note: skippedNoVerdict > 0 ? `${skippedNoVerdict} picks aprobados pero sin admin_verdict explícito fueron saltados. El admin debe marcar WON/LOST/VOID.` : undefined,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err: any) {
    console.error('[ml-manual-trainer] Error:', err);
    return new Response(JSON.stringify({
      success: false,
      error: err.message,
    }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
