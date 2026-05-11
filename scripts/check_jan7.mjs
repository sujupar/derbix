
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://nokejmhlpsaoerhddcyc.supabase.co';
// ANON KEY
const supabaseKey = '__ROTATED_KEY_LOAD_FROM_ENV__';

const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false }
});

async function check() {
    console.log('--- DIAGNOSTICO JAN 7 (CLIENT SIMULATION) ---');
    const today = '2026-01-07';

    // 1. JOBS
    const { data: jobs, error: jErr } = await supabase
        .from('analysis_jobs')
        .select('*')
        .gte('created_at', today + 'T00:00:00')
        .limit(50);

    if (jErr) console.log('❌ Error Jobs:', jErr.message);
    else console.log(`✅ Jobs encontrados hoy: ${jobs?.length ?? 0}`);

    // 1.5 RUNS (Intermediario crítico)
    const { data: runs, error: rErr } = await supabase
        .from('analysis_runs')
        .select('*')
        .gte('created_at', today + 'T00:00:00')
        .limit(50);

    if (rErr) console.log('❌ Error Runs (RLS?):', rErr.message);
    else {
        console.log(`✅ Runs encontrados hoy: ${runs?.length ?? 0}`);
        if (runs && runs.length > 0) {
            const sampleRun = runs[0];
            console.log(`🔎 Verificando predicciones para Run ID: ${sampleRun.id}`);

            const { data: runPreds, error: rpErr } = await supabase
                .from('predictions')
                .select('*')
                .eq('analysis_run_id', sampleRun.id);

            if (rpErr) console.log('❌ Error fetching specific predictions:', rpErr.message);
            else console.log(`👉 Predicciones en TABLA para este Run: ${runPreds.length}`);

            // Chequear JSON
            if (sampleRun.report_pre_jsonb) {
                // A veces es string si no se parsea auto
                const report = typeof sampleRun.report_pre_jsonb === 'string'
                    ? JSON.parse(sampleRun.report_pre_jsonb)
                    : sampleRun.report_pre_jsonb;

                const tips = report.predicciones_finales?.detalle || [];
                console.log(`📄 JSON del Run contiene ${tips.length} predicciones potenciales (en structure 'detalle').`);
            } else {
                console.log('📄 JSON del Run es NULL o no accesible.');
            }
        }
    }

    // 2. DAILY MATCHES
    const { data: matches, error: mErr } = await supabase
        .from('daily_matches')
        .select('*')
        .gte('match_time', today + 'T00:00:00')
        .lt('match_time', '2026-01-08T00:00:00')
        .limit(50);

    if (mErr) console.log('❌ Error Matches (Probable RLS):', mErr.message);
    else console.log(`DAILY MATCHES VISIBLES (ANON): ${matches?.length ?? 0}`);

    if (matches && matches.length > 0) {
        console.log('Sample Match:', matches[0].home_team, matches[0].match_time);
    } else {
        console.log('⚠️ Si Jobs > 0 y DailyMatches = 0, y sabemos que reparamos los datos -> ES RLS.');
    }

    // 3. PREDICTIONS
    const { data: preds, error: pErr } = await supabase
        .from('predictions')
        .select('id')
        .gte('created_at', today + 'T00:00:00')
        .limit(50);

    if (pErr) console.log('Error Predictions:', pErr.message);
    else console.log(`✅ Predicciones Visibles: ${preds?.length ?? 0}`);
}

check();
