/**
 * Test: Simulate exact update that v2-create-job-sportmonks does
 * This will help identify if the issue is payload size or field type
 */

const SUPABASE_URL = 'https://nokejmhlpsaoerhddcyc.supabase.co';
const SUPABASE_KEY = '__ROTATED_KEY_LOAD_FROM_ENV__';

async function main() {
    // Get latest job
    const jobRes = await fetch(
        `${SUPABASE_URL}/rest/v1/analysis_jobs_v2?fixture_id=eq.19427701&order=created_at.desc&limit=1`,
        { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    const jobs = await jobRes.json();
    const jobId = jobs[0].id;

    console.log(`Testing update on job: ${jobId}`);

    // Create a realistic payload similar to what the function builds
    const testPayload = {
        match: {
            fixture_id: 19427701,
            stats: [],
            venue: { name: 'Elland Road', city: 'Leeds' },
            league_id: 8,
            season_id: 23614,
            date_time_utc: '2026-02-06T20:00:00Z',
            teams: {
                home: { id: 71, name: 'Leeds United', image: 'https://example.com/leeds.png' },
                away: { id: 63, name: 'Nottingham Forest', image: 'https://example.com/forest.png' }
            }
        },
        datasets: {
            home_team_last40: {
                all: Array(20).fill(null).map((_, i) => ({
                    date: `2024-01-${String(i + 1).padStart(2, '0')}`,
                    home_team: 'Leeds United',
                    away_team: 'Test Opponent',
                    score_home: 1,
                    score_away: 0,
                    was_home: true,
                    result: 'W',
                    details: {
                        possession: 55,
                        shots_total: 12,
                        shots_on_target: 5,
                        corners: 6,
                        saves: 3,
                        yellow_cards: 2,
                        red_cards: 0,
                        fouls: 10,
                        formation_used: '4-3-3'
                    }
                }))
            },
            away_team_last40: {
                all: Array(20).fill(null).map((_, i) => ({
                    date: `2024-01-${String(i + 1).padStart(2, '0')}`,
                    home_team: 'Nottingham Forest',
                    away_team: 'Test Opponent',
                    score_home: 0,
                    score_away: 1,
                    was_home: true,
                    result: 'L',
                    details: {
                        possession: 45,
                        shots_total: 8,
                        corners: 4,
                        saves: 5
                    }
                }))
            },
            h2h: [
                { date: '2023-12-01', home_team: 'Leeds', away_team: 'Forest', score_home: 1, score_away: 1 }
            ]
        },
        odds: {
            bookmakers: [{
                id: 2,
                title: 'bet365',
                markets: [
                    { key: 'FULLTIME_RESULT', values: [{ lbl: 'Home', val: '2.40' }, { lbl: 'Draw', val: '3.30' }] },
                    { key: 'OVER_UNDER_25', values: [{ lbl: 'Over 2.5', val: '1.95' }, { lbl: 'Under 2.5', val: '1.85' }] }
                ]
            }]
        }
    };

    console.log(`Payload size: ${JSON.stringify(testPayload).length} bytes`);

    // Try the update
    const updateRes = await fetch(
        `${SUPABASE_URL}/rest/v1/analysis_jobs_v2?id=eq.${jobId}`,
        {
            method: 'PATCH',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=representation'
            },
            body: JSON.stringify({
                status: 'analyzing',
                data_coverage_score: 75,
                etl_context: testPayload
            })
        }
    );

    console.log(`Update Status: ${updateRes.status}`);
    const updateBody = await updateRes.text();
    console.log(`Update Response: ${updateBody.substring(0, 500)}`);

    // Verify
    const verifyRes = await fetch(
        `${SUPABASE_URL}/rest/v1/analysis_jobs_v2?id=eq.${jobId}&select=id,etl_context`,
        { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    const verified = await verifyRes.json();

    console.log(`\nVerification: etl_context exists = ${!!verified[0]?.etl_context}`);
    if (verified[0]?.etl_context) {
        console.log(`etl_context.match.teams.home.name = ${verified[0].etl_context.match?.teams?.home?.name}`);
        console.log(`etl_context.datasets.home_team_last40.all.length = ${verified[0].etl_context.datasets?.home_team_last40?.all?.length}`);
    }
}

main().catch(console.error);
