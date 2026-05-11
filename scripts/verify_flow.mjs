// Simular fetchTopPicks para verificar que el flujo completo funciona
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    'https://nokejmhlpsaoerhddcyc.supabase.co',
    '__ROTATED_KEY_LOAD_FROM_ENV__'
);

const date = '2026-01-08';

console.log('=== SIMULACIÓN fetchTopPicks para', date, '===\n');

// 1. Consultar daily_matches
const { data: localMatches, count: dmCount } = await supabase
    .from('daily_matches')
    .select('api_fixture_id', { count: 'exact' })
    .gte('match_time', `${date}T00:00:00`)
    .lt('match_time', `${date}T23:59:59`);

console.log('1. daily_matches:', dmCount);

if (!localMatches || localMatches.length === 0) {
    console.log('   ❌ No hay daily_matches para esta fecha!');
    process.exit(1);
}

const fixtureIds = localMatches.map(m => m.api_fixture_id);
console.log('   Fixture IDs sample:', fixtureIds.slice(0, 3));

// 2. Buscar analysis_jobs
const { data: jobs, count: jobCount } = await supabase
    .from('analysis_jobs')
    .select('id, api_fixture_id', { count: 'exact' })
    .in('api_fixture_id', fixtureIds)
    .eq('status', 'done');

console.log('\n2. analysis_jobs (done) para esos fixtures:', jobCount);

if (!jobs || jobs.length === 0) {
    console.log('   ❌ No hay jobs done para estos fixtures!');
    process.exit(1);
}

const jobIds = jobs.map(j => j.id);

// 3. Buscar analysis_runs
const { data: runs, count: runCount } = await supabase
    .from('analysis_runs')
    .select('id', { count: 'exact' })
    .in('job_id', jobIds);

console.log('\n3. analysis_runs para esos jobs:', runCount);

if (!runs || runs.length === 0) {
    console.log('   ❌ No hay runs para estos jobs!');
    process.exit(1);
}

const runIds = runs.map(r => r.id);

// 4. Buscar predictions
const { data: preds, count: predCount } = await supabase
    .from('predictions')
    .select('*', { count: 'exact' })
    .in('analysis_run_id', runIds);

console.log('\n4. predictions para esos runs:', predCount);

if (!preds || preds.length === 0) {
    console.log('   ❌ No hay predictions para estos runs!');
} else {
    console.log('   ✅ Hay predictions! Sample:', preds[0]?.market, preds[0]?.selection);
}

console.log('\n=== RESULTADO FINAL ===');
console.log('El frontend debería poder mostrar', predCount, 'oportunidades para el', date);
