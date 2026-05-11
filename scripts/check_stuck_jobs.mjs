/**
 * DIAGNOSTIC: Query failed/stuck analysis jobs and their error logs
 */
const SUPABASE_URL = 'https://nokejmhlpsaoerhddcyc.supabase.co';
const SUPABASE_KEY = '__ROTATED_KEY_LOAD_FROM_ENV__';

async function main() {
    console.log('\n🔍 CHECKING STUCK/FAILED JOBS\n');

    // Query recent jobs
    const url = `${SUPABASE_URL}/rest/v1/analysis_jobs_v2?select=id,fixture_id,status,created_at,current_motor&order=created_at.desc&limit=10`;
    const res = await fetch(url, {
        headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`
        }
    });
    const jobs = await res.json();

    if (!Array.isArray(jobs)) {
        console.error('API Error:', jobs);
        return;
    }

    console.log('Recent Jobs:');
    console.log('─'.repeat(80));

    jobs.forEach((job, i) => {
        const statusIcon = job.status === 'done' ? '✅' : job.status === 'failed' ? '❌' : '⏳';
        console.log(`[${i}] ${statusIcon} ${job.status.toUpperCase().padEnd(10)} | Fixture: ${job.fixture_id} | Motor: ${job.current_motor || 'N/A'}`);
        if (job.error_log) {
            console.log(`    ⚠️  Error: ${job.error_log.substring(0, 100)}...`);
        }
    });

    // Check for jobs stuck in 'etl' or 'analyzing'
    const stuckJobs = jobs.filter(j => ['etl', 'analyzing'].includes(j.status));
    if (stuckJobs.length > 0) {
        console.log('\n⚠️  STUCK JOBS FOUND:');
        stuckJobs.forEach(j => {
            console.log(`  Job ${j.id} is stuck in '${j.status}' for fixture ${j.fixture_id}`);
        });
    }

    console.log('\n');
}

main().catch(console.error);
