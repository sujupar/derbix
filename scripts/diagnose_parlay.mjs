// Diagnóstico completo del flujo de Parlays
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    'https://nokejmhlpsaoerhddcyc.supabase.co',
    '__ROTATED_KEY_LOAD_FROM_ENV__'
);

const today = '2026-01-07';

console.log('=== DIAGNÓSTICO PARLAY SYSTEM ===\n');

// 1. Check Analysis Runs
const { data: runs, error: runErr } = await supabase
    .from('analysis_runs')
    .select('id, fixture_id, report_pre_jsonb')
    .gte('created_at', today + 'T00:00:00')
    .limit(5);

console.log('1. Analysis Runs:', runs?.length || 0);
if (runs && runs[0]) {
    console.log('   Sample Run:', runs[0].id);
    console.log('   Has JSON:', !!runs[0].report_pre_jsonb);
    console.log('   Fixture ID:', runs[0].fixture_id);
}

// 2. Check Predictions with Join
const { data: predsWithRuns, error: predErr } = await supabase
    .from('predictions')
    .select('id, market, selection, probability, confidence, analysis_run_id, analysis_runs(id, report_pre_jsonb)')
    .gte('created_at', today + 'T00:00:00')
    .limit(5);

console.log('\n2. Predictions with Runs JOIN:', predsWithRuns?.length || 0);
if (predsWithRuns && predsWithRuns[0]) {
    console.log('   Sample Prediction:', predsWithRuns[0].id);
    console.log('   Market:', predsWithRuns[0].market);
    console.log('   Confidence:', predsWithRuns[0].confidence);
    console.log('   Has analysis_runs:', !!predsWithRuns[0].analysis_runs);
}

// 3. Simulate getAnalysesByDate query (approximation)
console.log('\n3. Simulating getAnalysesByDate...');
const { data: jobs } = await supabase
    .from('analysis_jobs')
    .select(`
    id,
    api_fixture_id,
    status,
    analysis_runs(
      id,
      report_pre_jsonb,
      predictions(id, market, selection, probability)
    )
  `)
    .gte('created_at', today + 'T00:00:00')
    .eq('status', 'done')
    .limit(5);

console.log('   Jobs with nested data:', jobs?.length || 0);
if (jobs && jobs[0]) {
    const job = jobs[0];
    console.log('   Sample Job:', job.id);
    console.log('   Has runs:', !!job.analysis_runs);
    console.log('   Runs count:', Array.isArray(job.analysis_runs) ? job.analysis_runs.length : 'single');

    if (job.analysis_runs) {
        const run = Array.isArray(job.analysis_runs) ? job.analysis_runs[0] : job.analysis_runs;
        console.log('   Run has JSON:', !!run?.report_pre_jsonb);
        console.log('   Run has predictions:', !!run?.predictions);
    }
}

console.log('\n=== FIN DIAGNÓSTICO ===');
