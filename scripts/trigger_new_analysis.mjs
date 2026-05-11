/**
 * Direct call to v2-create-job-sportmonks with existing job
 * Bypass job creation to test the data flow
 */

const SUPABASE_URL = 'https://nokejmhlpsaoerhddcyc.supabase.co';
const SUPABASE_KEY = '__ROTATED_KEY_LOAD_FROM_ENV__';
const FIXTURE_ID = 19427701;

async function main() {
    console.log('═'.repeat(60));
    console.log('🚀 DIRECT FUNCTION CALL TEST');
    console.log('═'.repeat(60));

    // Step 1: Get existing job for this fixture
    console.log('\n📌 Step 1: Finding existing job...');
    const jobsRes = await fetch(
        `${SUPABASE_URL}/rest/v1/analysis_jobs_v2?fixture_id=eq.${FIXTURE_ID}&order=created_at.desc&limit=1`,
        {
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`
            }
        }
    );
    const jobs = await jobsRes.json();

    if (!jobs || jobs.length === 0) {
        console.log('No existing job found. Creating new one...');
        return;
    }

    const jobId = jobs[0].id;
    console.log(`   Found Job ID: ${jobId}`);
    console.log(`   Current Status: ${jobs[0].status}`);
    console.log(`   etl_context before: ${jobs[0].etl_context ? 'EXISTS' : 'NULL'}`);

    // First, reset the job to pending and clear etl_context
    console.log('\n📌 Step 2: Resetting job to pending...');
    await fetch(
        `${SUPABASE_URL}/rest/v1/analysis_jobs_v2?id=eq.${jobId}`,
        {
            method: 'PATCH',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status: 'pending', etl_context: null })
        }
    );
    console.log('   ✅ Job reset to pending');

    // Step 2: Call the function
    console.log('\n📌 Step 3: Calling v2-create-job-sportmonks...');
    const processUrl = `${SUPABASE_URL}/functions/v1/v2-create-job-sportmonks`;

    const startTime = Date.now();
    const processRes = await fetch(processUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_KEY}`
        },
        body: JSON.stringify({
            fixture_id: FIXTURE_ID,
            job_id: jobId
        })
    });
    const elapsed = Date.now() - startTime;

    const processText = await processRes.text();
    console.log(`   Response Status: ${processRes.status}`);
    console.log(`   Time: ${elapsed}ms`);
    console.log(`   Response: ${processText.substring(0, 800)}`);

    // Step 3: Check if etl_context was saved
    console.log('\n📌 Step 4: Verifying etl_context after processing...');

    // Wait for any async completion
    await new Promise(r => setTimeout(r, 3000));

    const verifyRes = await fetch(
        `${SUPABASE_URL}/rest/v1/analysis_jobs_v2?id=eq.${jobId}&select=id,status,etl_context`,
        {
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`
            }
        }
    );

    const verifyData = await verifyRes.json();
    const job = verifyData[0];

    if (job) {
        console.log(`   Final Status: ${job.status}`);
        console.log(`   etl_context exists: ${job.etl_context ? 'YES ✅' : 'NO ❌'}`);

        if (job.etl_context) {
            const ctx = job.etl_context;
            console.log(`   etl_context keys: ${Object.keys(ctx).join(', ')}`);

            if (ctx.datasets) {
                console.log(`   datasets keys: ${Object.keys(ctx.datasets).join(', ')}`);
                const homeHistory = ctx.datasets.home_team_last40?.all;
                const awayHistory = ctx.datasets.away_team_last40?.all;
                console.log(`   home_team_last40 count: ${homeHistory?.length || 0}`);
                console.log(`   away_team_last40 count: ${awayHistory?.length || 0}`);

                if (homeHistory && homeHistory.length > 0) {
                    console.log('\n   📊 SAMPLE HOME HISTORY:');
                    homeHistory.slice(0, 3).forEach((m, i) => {
                        console.log(`      [${i}] ${m.date} | ${m.home_team} ${m.score_home}-${m.score_away} ${m.away_team}`);
                    });
                }
            }

            if (ctx.odds) {
                console.log(`\n   📊 ODDS KEYS: ${Object.keys(ctx.odds).join(', ')}`);
                if (ctx.odds.MAIN) {
                    console.log(`   MAIN odds count: ${ctx.odds.MAIN.length}`);
                }
            }
        }
    }

    console.log('\n' + '═'.repeat(60));
    console.log('TEST COMPLETE');
    console.log('═'.repeat(60));
}

main().catch(console.error);
