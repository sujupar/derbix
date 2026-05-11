// Script corregido para investigar
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://nokejmhlpsaoerhddcyc.supabase.co';
const supabaseKey = '__ROTATED_KEY_LOAD_FROM_ENV__';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkMigrationData() {
    console.log('🚨 INVESTIGACIÓN: "Migration from existing is_won"\n');
    console.log('═══════════════════════════════════════════════════════════\n');

    // El problema detectado: HAY 328 registros con source "Migration from existing is_won"
    // Estos SON los datos contaminados originales!

    const { data: migration } = await supabase
        .from('predictions_results')
        .select('*')
        .eq('verification_source', 'Migration from existing is_won')
        .order('verified_at', { ascending: true });

    console.log(`Total registros "Migration": ${migration?.length || 0}\n`);

    if (migration && migration.length > 0) {
        console.log('📊 BREAKDOWN:\n');

        const breakdown = {
            total: migration.length,
            correct: migration.filter(r => r.was_correct === true).length,
            incorrect: migration.filter(r => r.was_correct === false).length,
            accuracy: 0
        };

        breakdown.accuracy = ((breakdown.correct / breakdown.total) * 100).toFixed(1);

        console.log(JSON.stringify(breakdown, null, 2));
        console.log('');

        // Fechas
        const fechas = {
            primera: migration[0].verified_at,
            ultima: migration[migration.length - 1].verified_at
        };

        console.log('📅 Rango de fechas:');
        console.log(`   Primera: ${fechas.primera}`);
        console.log(`   Última: ${fechas.ultima}\n`);

        // Verificar si estos son los MISMOS datos contaminados
        console.log('🔍 ¿Son los mismos datos contaminados?\n');

        // Contar por mercado
        const byMarket = {};
        migration.forEach(r => {
            const m = r.predicted_market || 'Unknown';
            if (!byMarket[m]) byMarket[m] = 0;
            byMarket[m]++;
        });

        const sorted = Object.entries(byMarket).sort((a, b) => b[1] - a[1]).slice(0, 5);
        console.log('Top 5 mercados:');
        sorted.forEach(([market, count]) => {
            console.log(`   - ${market}: ${count}`);
        });
        console.log('');
    }

    // Verificar predictions que usan estos datos
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🧠 IMPACTO EN ML');
    console.log('═══════════════════════════════════════════════════════════\n');

    const { data: allPredictions } = await supabase
        .from('predictions')
        .select('is_won')
        .not('is_won', 'is', null);

    if (allPredictions) {
        const won = allPredictions.filter(p => p.is_won === true).length;
        const lost = allPredictions.filter(p => p.is_won === false).length;
        const total = won + lost;
        const accuracy = ((won / total) * 100).toFixed(1);

        console.log(`Total predicciones con resultado: ${total}`);
        console.log(`  Ganadas: ${won}`);
        console.log(`  Perdidas: ${lost}`);
        console.log(`  Accuracy general: ${accuracy}%\n`);
    }

    console.log('═══════════════════════════════════════════════════════════');
    console.log('📋 CONCLUSIÓN');
    console.log('═══════════════════════════════════════════════════════════\n');

    if (migration && migration.length > 0) {
        console.log('❌ PROBLEMA ENCONTRADO:\n');
        console.log(`   ${migration.length} registros con source "Migration from existing is_won"`);
        console.log('   Estos SON datos que existían ANTES de la verificación automatizada');
        console.log('   Accuracy: ' + ((migration.filter(r => r.was_correct === true).length / migration.length) * 100).toFixed(1) + '%');
        console.log('');
        console.log('🔴 ESTOS DATOS ESTÁN ALIMENTANDO EL ML');
        console.log('   Y pueden contener ERRORES HUMANOS o de verificación manual');
        console.log('');
        console.log('💡 SOLUCIÓN:');
        console.log('   - Opción A: ELIMINAR todos los registros "Migration"');
        console.log('   - Opción B: RE-VERIFICAR usando daily-results-verifier');
        console.log('   - Opción C: Excluir "Migration" del training de ML');
    }

    return { migration: migration?.length || 0 };
}

checkMigrationData().then(result => {
    console.log('\n✅ Investigación completada');
    console.log(`   Registros Migration encontrados: ${result.migration}`);
    process.exit(0);
}).catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
});
