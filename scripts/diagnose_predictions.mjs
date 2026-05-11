// Diagnóstico profundo de predictions
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    'https://nokejmhlpsaoerhddcyc.supabase.co',
    '__ROTATED_KEY_LOAD_FROM_ENV__'
);

const targetDate = '2026-01-08';

// 1. Predictions por created_at
const { count: predsByCreated, data: predSamples } = await supabase
    .from('predictions')
    .select('*', { count: 'exact' })
    .gte('created_at', `${targetDate}T00:00:00`)
    .lt('created_at', `${targetDate}T23:59:59`)
    .limit(3);

console.log(`Predictions created_at = ${targetDate}:`, predsByCreated);
if (predSamples?.length) {
    console.log('Sample:', predSamples[0]);
}

// 2. Total de predictions en BD
const { count: totalPreds } = await supabase
    .from('predictions')
    .select('*', { count: 'exact', head: true });

console.log('\nTotal predictions en BD:', totalPreds);

// 3. Predictions más recientes
const { data: recentPreds } = await supabase
    .from('predictions')
    .select('id, fixture_id, match_date, created_at')
    .order('created_at', { ascending: false })
    .limit(5);

console.log('\nPredictions más recientes:');
recentPreds?.forEach((p, i) => {
    console.log(`  ${i + 1}. fixture_id: ${p.fixture_id}, match_date: ${p.match_date}, created: ${p.created_at}`);
});

// 4. Verificar analysis_runs del 8 enero para ver si tienen report_pre_jsonb con predicciones
const { data: runsJan8 } = await supabase
    .from('analysis_runs')
    .select('id, report_pre_jsonb')
    .gte('created_at', `${targetDate}T00:00:00`)
    .lt('created_at', `${targetDate}T23:59:59`)
    .limit(1);

if (runsJan8?.[0]?.report_pre_jsonb) {
    const preds = runsJan8[0].report_pre_jsonb.predicciones_finales?.detalle;
    console.log('\n¿Tiene predicciones en JSON?:', preds?.length || 0);
    if (preds?.length) {
        console.log('Ejemplo:', preds[0]);
    }
}
