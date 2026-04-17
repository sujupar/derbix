// supabase/functions/capture-closing-odds/index.ts
// V9: Captures closing odds (~5 min before match) to compute CLV.
// CLV is the best long-term predictor of betting skill.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from '../_shared/cors.ts'
import { getOdds } from '../_shared/sportmonks-client.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const sbUrl = Deno.env.get('SUPABASE_URL')!;
    const sbKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(sbUrl, sbKey);

    // Find picks for matches starting in the next 15 minutes (capture window)
    const now = new Date();
    const in15min = new Date(now.getTime() + 15 * 60 * 1000);
    const nowIso = now.toISOString();
    const in15Iso = in15min.toISOString();

    const { data: matchesToCapture, error } = await supabase
      .from('daily_matches')
      .select('api_fixture_id, match_time, home_team, away_team')
      .gte('match_time', nowIso)
      .lte('match_time', in15Iso);

    if (error) throw error;
    if (!matchesToCapture || matchesToCapture.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'No matches in capture window', count: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`[capture-closing-odds] Found ${matchesToCapture.length} matches to capture`);

    let captured = 0;
    const errors: string[] = [];

    for (const m of matchesToCapture) {
      try {
        const odds = await getOdds(m.api_fixture_id);
        if (!odds || odds.length === 0) continue;

        // Extract standard 1X2 + over/under 2.5 + BTTS closing odds
        const findOdd = (marketName: string, label: string) => {
          const match = odds.find((o: any) =>
            (o.market?.name || '').toLowerCase().includes(marketName.toLowerCase()) &&
            (o.label || '').toLowerCase().includes(label.toLowerCase())
          );
          return match ? Number(match.value || match.odd) : null;
        };

        const closingMap: Record<string, number | null> = {
          'home_win': findOdd('fulltime result', '1') || findOdd('match winner', 'home'),
          'draw': findOdd('fulltime result', 'x') || findOdd('match winner', 'draw'),
          'away_win': findOdd('fulltime result', '2') || findOdd('match winner', 'away'),
          'over_25': findOdd('goals over', '2.5') || findOdd('over/under', 'over 2.5'),
          'under_25': findOdd('goals under', '2.5'),
          'btts_yes': findOdd('both teams', 'yes'),
          'btts_no': findOdd('both teams', 'no'),
        };

        // Fetch picks for this fixture that don't yet have closing odds
        const { data: picks } = await supabase
          .from('value_picks_v2')
          .select('id, market, selection, odds')
          .eq('fixture_id', m.api_fixture_id)
          .is('closing_odds', null);

        if (!picks) continue;

        for (const pick of picks) {
          const marketKey = pickToMarketKey(pick.market, pick.selection, m.home_team, m.away_team);
          const closingOdd = marketKey ? closingMap[marketKey] : null;

          if (closingOdd && closingOdd > 1.01) {
            const clv = ((pick.odds / closingOdd) - 1) * 100;
            await supabase
              .from('value_picks_v2')
              .update({
                opening_odds: pick.odds,
                closing_odds: closingOdd,
                clv_percentage: Math.round(clv * 1000) / 1000,
                closing_captured_at: new Date().toISOString(),
              })
              .eq('id', pick.id);
            captured++;
          }
        }
      } catch (e: any) {
        errors.push(`Fixture ${m.api_fixture_id}: ${e.message}`);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      matches_checked: matchesToCapture.length,
      picks_captured: captured,
      errors: errors.length,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err: any) {
    console.error('[capture-closing-odds] Error:', err);
    return new Response(JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

function pickToMarketKey(market: string, selection: string, homeTeam?: string, awayTeam?: string): string | null {
  const m = (market || '').toLowerCase();
  const s = (selection || '').toLowerCase();
  const home = (homeTeam || '').toLowerCase();
  const away = (awayTeam || '').toLowerCase();

  if (m.includes('resultado') || m.includes('1x2')) {
    if (s.includes('empate') || s === 'x' || s === 'draw') return 'draw';
    if (home && s.includes(home.split(' ')[0])) return 'home_win';
    if (away && s.includes(away.split(' ')[0])) return 'away_win';
    // Fallback: match by full team name
    if (home && s.includes(home)) return 'home_win';
    if (away && s.includes(away)) return 'away_win';
    return null;
  }
  if (m.includes('más de') && s.includes('2.5')) return 'over_25';
  if (m.includes('menos de') && s.includes('2.5')) return 'under_25';
  if (m.includes('ambos anotan') || m.includes('btts')) {
    return s.includes('sí') || s.includes('yes') ? 'btts_yes' : 'btts_no';
  }
  return null;
}
