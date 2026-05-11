// Diagnóstico rápido de datos del 8 de enero
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    'https://nokejmhlpsaoerhddcyc.supabase.co',
    '__ROTATED_KEY_LOAD_FROM_ENV__'
);

const targetDate = '2026-01-08'; // AYER

console.log('=== DIAGNÓSTICO RÁPIDO 8 ENERO ===\n');

// 1. daily_matches
const { count: dmCount } = await supabase
    .from('daily_matches')
    .select('*', { count: 'exact', head: true })
    .gte('match_time', `${targetDate}T00:00:00`)
    .lt('match_time', `${targetDate}T23:59:59`);

console.log(`1. daily_matches (match_time = ${targetDate}):`, dmCount || 0);

// 2. analysis_jobs
const { count: jobCount } = await supabase
    .from('analysis_jobs')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', `${targetDate}T00:00:00`)
    .lt('created_at', `${targetDate}T23:59:59`);

console.log(`2. analysis_jobs (created_at = ${targetDate}):`, jobCount || 0);

// 3. analysis_runs con match_date
const { count: runsByMatch } = await supabase
    .from('analysis_runs')
    .select('*', { count: 'exact', head: true })
    .eq('match_date', targetDate);

console.log(`3. analysis_runs (match_date = ${targetDate}):`, runsByMatch || 0);

// 4. analysis_runs con created_at
const { count: runsByCreated } = await supabase
    .from('analysis_runs')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', `${targetDate}T00:00:00`)
    .lt('created_at', `${targetDate}T23:59:59`);

console.log(`4. analysis_runs (created_at = ${targetDate}):`, runsByCreated || 0);

// 5. predictions con match_date
const { count: predsByMatch } = await supabase
    .from('predictions')
    .select('*', { count: 'exact', head: true })
    .eq('match_date', targetDate);

console.log(`5. predictions (match_date = ${targetDate}):`, predsByMatch || 0);

// 6. Muestra de un análisis para verificar fixture_id
const { data: sampleRun } = await supabase
    .from('analysis_runs')
    .select('id, fixture_id, job_id, match_date')
    .eq('match_date', targetDate)
    .limit(1);

if (sampleRun && sampleRun[0]) {
    console.log('\n6. Muestra de analysis_run:');
    console.log('   fixture_id:', sampleRun[0].fixture_id);
    console.log('   job_id:', sampleRun[0].job_id);
    console.log('   ¿fixture_id === job_id?:', sampleRun[0].fixture_id === sampleRun[0].job_id ? '❌ IGUAL (BUG)' : '✅ Diferente');
}

// 7. Verificar si predictions tiene fixture_id numérico
const { data: samplePred } = await supabase
    .from('predictions')
    .select('id, fixture_id, analysis_run_id')
    .eq('match_date', targetDate)
    .limit(1);

if (samplePred && samplePred[0]) {
    console.log('\n7. Muestra de prediction:');
    console.log('   fixture_id:', samplePred[0].fixture_id, typeof samplePred[0].fixture_id);
}

console.log('\n=== FIN DIAGNÓSTICO ===');
