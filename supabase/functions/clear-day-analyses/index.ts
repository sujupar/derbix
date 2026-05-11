import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from '../_shared/cors.ts'
import { requirePlatformAdmin, authErrorResponse } from '../_shared/auth-guard.ts'

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    // SECURITY: This endpoint deletes production data. Restrict to platform admins.
    const auth = await requirePlatformAdmin(req);
    if (!auth.ok) return authErrorResponse(auth, corsHeaders);

    try {
        const { targetDate } = await req.json();

        if (!targetDate) {
            return new Response(JSON.stringify({ error: 'targetDate is required (YYYY-MM-DD)' }), {
                status: 400,
                headers: corsHeaders
            });
        }

        console.log(`[clear-day-analyses] Clearing all analyses for date: ${targetDate}`);

        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseKey);

        // 1. Get fixture IDs from daily_matches for the target date
        const { data: matches, error: matchError } = await supabase
            .from('daily_matches')
            .select('api_fixture_id')
            .eq('match_date', targetDate);

        if (matchError) {
            console.error(`[clear-day-analyses] Error fetching matches:`, matchError);
            return new Response(JSON.stringify({ error: 'Failed to fetch matches', details: matchError }), {
                status: 500,
                headers: corsHeaders
            });
        }

        if (!matches || matches.length === 0) {
            return new Response(JSON.stringify({
                message: `No matches found for ${targetDate}`,
                deleted: { analysis_jobs: 0, reports: 0, value_picks: 0, analisis: 0 }
            }), { headers: corsHeaders });
        }

        const fixtureIds = matches.map(m => m.api_fixture_id);
        console.log(`[clear-day-analyses] Found ${fixtureIds.length} fixtures for ${targetDate}`);

        // 2. Delete from analysis_jobs_v2
        const { data: deletedJobs, error: jobsError } = await supabase
            .from('analysis_jobs_v2')
            .delete()
            .in('fixture_id', fixtureIds)
            .select('id');

        if (jobsError) {
            console.error(`[clear-day-analyses] Error deleting jobs:`, jobsError);
        } else {
            console.log(`[clear-day-analyses] Deleted ${deletedJobs?.length || 0} analysis jobs`);
        }

        // 3. Delete from reports_v2
        const { data: deletedReports, error: reportsError } = await supabase
            .from('reports_v2')
            .delete()
            .in('fixture_id', fixtureIds)
            .select('id');

        if (reportsError) {
            console.error(`[clear-day-analyses] Error deleting reports:`, reportsError);
        } else {
            console.log(`[clear-day-analyses] Deleted ${deletedReports?.length || 0} reports`);
        }

        // 4. Delete from value_picks_v2
        const { data: deletedPicks, error: picksError } = await supabase
            .from('value_picks_v2')
            .delete()
            .in('fixture_id', fixtureIds)
            .select('id');

        if (picksError) {
            console.error(`[clear-day-analyses] Error deleting picks:`, picksError);
        } else {
            console.log(`[clear-day-analyses] Deleted ${deletedPicks?.length || 0} value picks`);
        }

        // 5. Delete from analisis
        const { data: deletedAnalisis, error: analisisError } = await supabase
            .from('analisis')
            .delete()
            .in('fixture_id', fixtureIds)
            .select('id');

        if (analisisError) {
            console.error(`[clear-day-analyses] Error deleting analisis:`, analisisError);
        } else {
            console.log(`[clear-day-analyses] Deleted ${deletedAnalisis?.length || 0} analisis entries`);
        }

        const summary = {
            message: `Successfully cleared all analyses for ${targetDate}`,
            fixtures_found: fixtureIds.length,
            deleted: {
                analysis_jobs: deletedJobs?.length || 0,
                reports: deletedReports?.length || 0,
                value_picks: deletedPicks?.length || 0,
                analisis: deletedAnalisis?.length || 0
            }
        };

        console.log(`[clear-day-analyses] Summary:`, JSON.stringify(summary));

        return new Response(JSON.stringify(summary), { headers: corsHeaders });

    } catch (err) {
        console.error(`[clear-day-analyses] Unexpected error:`, err);
        return new Response(JSON.stringify({ error: 'Unexpected error', details: String(err) }), {
            status: 500,
            headers: corsHeaders
        });
    }
});
