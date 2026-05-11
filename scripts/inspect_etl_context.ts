
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
    'https://nokejmhlpsaoerhddcyc.supabase.co',
    '__ROTATED_KEY_LOAD_FROM_ENV__'
);

async function inspectEtlContext() {
    console.log("Fetching latest analysis job...");

    const { data: jobs, error } = await supabase
        .from('analysis_jobs_v2')
        .select('id, created_at, etl_context')
        .order('created_at', { ascending: false })
        .limit(1);

    if (error) {
        console.error("Error fetching job:", error);
        return;
    }

    if (!jobs || jobs.length === 0) {
        console.log("No jobs found.");
        return;
    }

    const job = jobs[0];
    console.log(`Job ID: ${job.id} | Created: ${job.created_at}`);

    const context = job.etl_context;
    const json = JSON.stringify(context, null, 2);
    console.log(`Context Size: ${json.length} chars`);

    // Print a snippet
    console.log("--- CONTEXT SNIPPET ---");
    console.log(json.substring(0, 2000));
    console.log("...");
}

inspectEtlContext();
