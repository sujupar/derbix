const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://nokejmhlpsaoerhddcyc.supabase.co';
const SERVICE_KEY = '__ROTATED_KEY_LOAD_FROM_ENV__';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function cleanupBadReports() {
    console.log("Starting cleanup for 2026-02-03...");
    const targetDate = '2026-02-03';

    // 1. Identify Jobs
    const { data: jobs, error: jobsError } = await supabase
        .from('analysis_jobs_v2')
        .select('id, fixture_id')
        .gte('created_at', targetDate);

    if (jobsError) {
        console.error("Error fetching jobs:", jobsError);
        return;
    }

    if (!jobs || jobs.length === 0) {
        console.log("No jobs found for today.");
        return;
    }

    console.log(`Found ${jobs.length} jobs to clean up.`);
    const jobIds = jobs.map(j => j.id);
    const fixtureIds = jobs.map(j => j.fixture_id);

    // 2. Delete from reports_v2
    const { error: reportsError } = await supabase
        .from('reports_v2')
        .delete()
        .in('job_id', jobIds);

    if (reportsError) console.error("Error deleting reports_v2:", reportsError);
    else console.log("✅ Deleted records from reports_v2");

    // 3. Delete from analisis (Legacy Cache)
    const { error: legacyError } = await supabase
        .from('analisis')
        .delete()
        .in('partido_id', fixtureIds);

    if (legacyError) console.error("Error deleting from analisis:", legacyError);
    else console.log("✅ Deleted records from analisis (Legacy Cache)");

    // 4. Delete jobs from analysis_jobs_v2
    const { error: deleteJobsError } = await supabase
        .from('analysis_jobs_v2')
        .delete()
        .in('id', jobIds);

    if (deleteJobsError) console.error("Error deleting jobs:", deleteJobsError);
    else console.log("✅ Deleted records from analysis_jobs_v2");

    console.log("Cleanup complete. User can now re-analyze these fixtures.");
}

cleanupBadReports();
