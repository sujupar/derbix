// supabase/functions/compute-referee-stats/index.ts
// V9: Computes referee tendencies from recent matches.
// Builds referee_stats table so the analyzer can inject arbitro profile.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from '../_shared/cors.ts'
import { fetchSportMonks } from '../_shared/sportmonks-client.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const sbUrl = Deno.env.get('SUPABASE_URL')!;
    const sbKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(sbUrl, sbKey);

    const body = await req.json().catch(() => ({}));
    const refereeIds: number[] | undefined = body.referee_ids;
    const daysBack = body.days_back || 90;

    // If no specific referees given, find referees used in recent matches
    let targets: number[] = [];
    if (refereeIds && Array.isArray(refereeIds)) {
      targets = refereeIds;
    } else {
      const { data: recentMatches } = await supabase
        .from('daily_matches')
        .select('api_fixture_id, referee_id')
        .gte('match_date', new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
        .not('referee_id', 'is', null)
        .limit(500);

      const seen = new Set<number>();
      for (const m of recentMatches || []) {
        if (m.referee_id && !seen.has(m.referee_id)) {
          seen.add(m.referee_id);
          targets.push(m.referee_id);
        }
      }
    }

    let updated = 0;
    const errors: string[] = [];

    for (const refereeId of targets) {
      try {
        // Fetch referee profile with historical stats
        const refereeData: any = await fetchSportMonks<any>(
          `/referees/${refereeId}`,
          ['statistics'],
          {}
        );
        if (!refereeData) continue;

        const stats = refereeData.statistics || [];
        let totalMatches = 0, totalFouls = 0, totalYellow = 0, totalRed = 0, totalPens = 0;

        for (const s of stats) {
          const detail = s.details || {};
          totalMatches += detail.appearences || s.count || 0;
          totalFouls += detail.fouls || 0;
          totalYellow += detail.yellowcards || 0;
          totalRed += detail.redcards || 0;
          totalPens += detail.penalties || 0;
        }

        if (totalMatches === 0) continue;

        const foulsPerGame = totalFouls / totalMatches;
        const yellowPerGame = totalYellow / totalMatches;
        const redPer10 = (totalRed / totalMatches) * 10;
        const penaltyRate = totalPens / totalMatches;

        // Classify strictness
        let strictness: 'LENIENT' | 'BALANCED' | 'STRICT' | 'VERY_STRICT';
        if (yellowPerGame < 3) strictness = 'LENIENT';
        else if (yellowPerGame < 4) strictness = 'BALANCED';
        else if (yellowPerGame < 5) strictness = 'STRICT';
        else strictness = 'VERY_STRICT';

        await supabase
          .from('referee_stats')
          .upsert({
            referee_id: refereeId,
            referee_name: refereeData.common_name || refereeData.name || null,
            matches_officiated: totalMatches,
            total_fouls: totalFouls,
            total_yellow_cards: totalYellow,
            total_red_cards: totalRed,
            total_penalties: totalPens,
            fouls_per_game: Math.round(foulsPerGame * 100) / 100,
            yellow_per_game: Math.round(yellowPerGame * 100) / 100,
            red_per_10_games: Math.round(redPer10 * 100) / 100,
            penalty_rate: Math.round(penaltyRate * 1000) / 1000,
            strictness_level: strictness,
            last_updated: new Date().toISOString(),
          }, { onConflict: 'referee_id' });

        updated++;
      } catch (e: any) {
        errors.push(`Referee ${refereeId}: ${e.message}`);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      targets: targets.length,
      updated,
      errors: errors.slice(0, 5),
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err: any) {
    console.error('[compute-referee-stats] Error:', err);
    return new Response(JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
