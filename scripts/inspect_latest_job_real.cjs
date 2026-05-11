
// Script para inspeccionar el último trabajo de análisis y su reporte
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://nokejmhlpsaoerhddcyc.supabase.co';
const SERVICE_KEY = '__ROTATED_KEY_LOAD_FROM_ENV__';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function inspectLatestJob() {
    console.log('Fetching latest completed analysis job...');

    // 1. Get latest job
    const { data: jobs, error: jobError } = await supabase
        .from('analysis_jobs_v2')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1);

    if (jobError) {
        console.error('Error fetching jobs:', jobError);
        return;
    }

    if (!jobs || jobs.length === 0) {
        console.log('No jobs found.');
        return;
    }

    const job = jobs[0];
    console.log(`Latest Job ID: ${job.id}`);
    console.log(`Fixture ID: ${job.fixture_id}`);
    console.log(`Status: ${job.status}`);
    console.log(`Created At: ${job.created_at}`);

    // 2. Get report for this job
    const { data: reports, error: reportError } = await supabase
        .from('reports_v2')
        .select('*')
        .eq('job_id', job.id)
        .single();

    if (reportError) {
        console.error('Error fetching report:', reportError);
    } else if (reports) {
        console.log('--- REPORT FOUND ---');
        console.log('Prompt Version:', reports.prompt_version);

        const packet = reports.report_packet;
        console.log('\n--- EXECUTIVE SUMMARY ---');
        console.log(JSON.stringify(packet.resumen_ejecutivo, null, 2));

        console.log('\n--- PREDICTIONS (Pronósticos) ---');
        console.log(JSON.stringify(packet.pronosticos, null, 2));

        console.log('\n--- MARKETS EVALUATED ---');
        console.log(JSON.stringify(packet.mercados_evaluados, null, 2));

        console.log('\n--- RISK FACTORS ---');
        console.log(JSON.stringify(packet.factores_riesgo, null, 2));
    } else {
        console.log('No report found for this job.');
    }
}

inspectLatestJob();
