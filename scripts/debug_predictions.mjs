// Script para verificar estructura de tabla predictions y probar insert
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://nokejmhlpsaoerhddcyc.supabase.co';
// Usando service key para bypass RLS
const supabaseServiceKey = '__ROTATED_KEY_LOAD_FROM_ENV__';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function testPredictions() {
    console.log('🔍 VERIFICANDO TABLA PREDICTIONS\n');

    // 1. Intentar insert simple
    console.log('1. Probando INSERT...');

    const testPrediction = {
        fixture_id: 999999,
        match_date: '2025-12-29',
        home_team: 'Test Home',
        away_team: 'Test Away',
        league_name: 'Test League',
        prediction_type: 'result',
        predicted_outcome: 'Home Win',
        confidence: 75,
        reasoning: 'Test reasoning'
    };

    const { data: insertData, error: insertError } = await supabase
        .from('predictions')
        .insert(testPrediction)
        .select();

    if (insertError) {
        console.log('❌ Error INSERT:', insertError.message);
        console.log('   Código:', insertError.code);
        console.log('   Detalles:', insertError.details);
        console.log('   Hint:', insertError.hint);
    } else {
        console.log('✅ INSERT exitoso:', insertData);

        // Limpiar el test
        await supabase.from('predictions').delete().eq('fixture_id', 999999);
        console.log('   (Test eliminado)');
    }

    // 2. Ver estructura de la tabla
    console.log('\n2. Consultando datos existentes...');
    const { data: existing, error: selectError } = await supabase
        .from('predictions')
        .select('*')
        .limit(3);

    if (selectError) {
        console.log('❌ Error SELECT:', selectError.message);
    } else {
        console.log('✅ Predictions existentes:', existing?.length || 0);
        if (existing && existing.length > 0) {
            console.log('   Columnas:', Object.keys(existing[0]));
        }
    }

    // 3. Ver daily_matches pendientes
    console.log('\n3. Daily matches pendientes...');
    const { data: pending, error: pendingError } = await supabase
        .from('daily_matches')
        .select('id, home_team, away_team, is_analyzed')
        .eq('is_analyzed', false)
        .limit(5);

    if (pendingError) {
        console.log('❌ Error:', pendingError.message);
    } else {
        console.log('✅ Pendientes:', pending?.length || 0);
        pending?.forEach(m => console.log(`   - ${m.home_team} vs ${m.away_team}`));
    }
}

testPredictions().catch(console.error);
