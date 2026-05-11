// Script de limpieza - FASE 3
// Elimina registros contaminados y resetea predicciones

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const supabaseUrl = 'https://nokejmhlpsaoerhddcyc.supabase.co';
const supabaseKey = '__ROTATED_KEY_LOAD_FROM_ENV__';

const supabase = createClient(supabaseUrl, supabaseKey);

async function cleanContaminatedData() {
    console.log('🧹 INICIANDO LIMPIEZA DE DATOS CONTAMINADOS\n');
    console.log('═══════════════════════════════════════════════════════════\n');

    // Leer lista de IDs
    const data = JSON.parse(readFileSync('scripts/prediction_ids_to_clean.json', 'utf-8'));
    console.log(`📊 Datos a limpiar:`);
    console.log(`   - Prediction IDs: ${data.prediction_ids.length}`);
    console.log(`   - Fecha X: ${data.fecha_x}`);
    console.log(`   - Fecha Fin: ${data.fecha_fin}\n`);

    // PASO 1: Contar registros ANTES de limpieza
    console.log('📋 PASO 1: Conteo ANTES de limpieza...\n');

    const { count: countApiFootball, error: e1 } = await supabase
        .from('predictions_results')
        .select('*', { count: 'exact', head: true })
        .eq('verification_source', 'API-Football');

    const { count: countAutomation, error: e2 } = await supabase
        .from('predictions_results')
        .select('*', { count: 'exact', head: true })
        .eq('verification_source', 'automation');

    if (e1 || e2) {
        console.error('❌ Error al contar:', e1 || e2);
        process.exit(1);
    }

    console.log(`   predictions_results (API-Football): ${countApiFootball}`);
    console.log(`   predictions_results (automation): ${countAutomation}\n`);

    // PASO 2: Eliminar registros de predictions_results
    console.log('🗑️  PASO 2: Eliminando registros de predictions_results...\n');

    const { error: deleteError, count: deletedCount } = await supabase
        .from('predictions_results')
        .delete({ count: 'exact' })
        .eq('verification_source', 'API-Football');

    if (deleteError) {
        console.error('❌ Error al eliminar:', deleteError);
        process.exit(1);
    }

    console.log(`✅ Eliminados ${deletedCount} registros de predictions_results\n`);

    // PASO 3: Resetear predictions
    console.log('🔄 PASO 3: Reseteando predicciones en tabla predictions...\n');

    // Dividir en lotes de 50 IDs (límite de Supabase)
    const batchSize = 50;
    let totalUpdated = 0;

    for (let i = 0; i < data.prediction_ids.length; i += batchSize) {
        const batch = data.prediction_ids.slice(i, i + batchSize);

        const { error: updateError, count } = await supabase
            .from('predictions')
            .update({
                is_won: null,
                result_verified_at: null,
                verification_status: null
            }, { count: 'exact' })
            .in('id', batch);

        if (updateError) {
            console.error(`❌ Error en lote ${i / batchSize + 1}:`, updateError);
            continue;
        }

        totalUpdated += (count || 0);
        console.log(`   Lote ${Math.floor(i / batchSize) + 1}: ${count} predicciones reseteadas`);
    }

    console.log(`\n✅ Total reseteadas: ${totalUpdated} predicciones\n`);

    // PASO 4: Validar limpieza
    console.log('✔️  PASO 4: Validando limpieza...\n');

    const { count: newCountApiFootball } = await supabase
        .from('predictions_results')
        .select('*', { count: 'exact', head: true })
        .eq('verification_source', 'API-Football');

    const { count: newCountAutomation } = await supabase
        .from('predictions_results')
        .select('*', { count: 'exact', head: true })
        .eq('verification_source', 'automation');

    console.log(`   predictions_results (API-Football): ${newCountApiFootball} (esperado: 0)`);
    console.log(`   predictions_results (automation): ${newCountAutomation} (esperado: ${countAutomation})\n`);

    const { count: pendingCount } = await supabase
        .from('predictions')
        .select('*', { count: 'exact', head: true })
        .is('is_won', null);

    console.log(`   Predicciones pendiente (is_won = null): ${pendingCount}\n`);

    // Resumen final
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📋 RESUMEN DE LIMPIEZA');
    console.log('═══════════════════════════════════════════════════════════');

    const success = newCountApiFootball === 0 && newCountAutomation === countAutomation;

    if (success) {
        console.log('✅ LIMPIEZA EXITOSA');
        console.log(`   - Eliminados: ${deletedCount} registros de predictions_results`);
        console.log(`   - Reseteadas: ${totalUpdated} predicciones`);
        console.log(`   - Preservados: ${newCountAutomation} registros de automation`);
        console.log(`   - Pendientes de re-verificación: ${pendingCount}`);
    } else {
        console.log('⚠️  LIMPIEZA PARCIAL');
        console.log(`   - API-Football restantes: ${newCountApiFootball} (debería ser 0)`);
        console.log(`   - Revisar manualmente`);
    }

    console.log('═══════════════════════════════════════════════════════════\n');

    return {
        success,
        deleted: deletedCount,
        updated: totalUpdated,
        pending: pendingCount
    };
}

cleanContaminatedData().then(result => {
    if (result.success) {
        console.log('🎯 PRÓXIMO PASO: Ejecutar daily-results-verifier para re-verificar');
        console.log('   Comando: node scripts/reverify_all.js');
    }
    process.exit(result.success ? 0 : 1);
}).catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
});
