// Script para exportar predicciones contaminadas
// FASE 2: Análisis de Impacto

import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';

const supabaseUrl = 'https://nokejmhlpsaoerhddcyc.supabase.co';
const supabaseKey = '__ROTATED_KEY_LOAD_FROM_ENV__';

const supabase = createClient(supabaseUrl, supabaseKey);

async function exportContaminatedPredictions() {
    console.log('📦 Exportando predicciones contaminadas...\n');

    // Obtener TODAS las predicciones contaminadas
    const { data: contaminated, error } = await supabase
        .from('predictions_results')
        .select('*')
        .eq('verification_source', 'API-Football')
        .order('verified_at', { ascending: true });

    if (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }

    console.log(`✅ Obtenidas ${contaminated.length} predicciones contaminadas\n`);

    // Categorizar por mercado
    const byMarket = {};
    contaminated.forEach(p => {
        const market = p.predicted_market || 'Unknown';
        if (!byMarket[market]) {
            byMarket[market] = { total: 0, perdidas: 0, ganadas: 0, ids: [] };
        }
        byMarket[market].total++;
        if (p.was_correct === false) byMarket[market].perdidas++;
        if (p.was_correct === true) byMarket[market].ganadas++;
        byMarket[market].ids.push(p.prediction_id);
    });

    // Mostrar breakdown
    console.log('📊 BREAKDOWN POR MERCADO:\n');
    console.log('═══════════════════════════════════════════════════════════');

    const sorted = Object.entries(byMarket)
        .sort((a, b) => b[1].perdidas - a[1].perdidas);

    sorted.forEach(([market, stats]) => {
        const pctPerdidas = ((stats.perdidas / stats.total) * 100).toFixed(1);
        const status = pctPerdidas === '100.0' ? '🚨' : pctPerdidas > 60 ? '⚠️' : '📊';
        console.log(`${status} ${market}`);
        console.log(`   Total: ${stats.total} | Perdidas: ${stats.perdidas} (${pctPerdidas}%) | Ganadas: ${stats.ganadas}`);
        console.log('');
    });

    console.log('═══════════════════════════════════════════════════════════\n');

    // Exportar lista de prediction_ids únicos
    const uniquePredictionIds = [...new Set(contaminated.map(p => p.prediction_id))];

    console.log(`📝 Total de prediction_ids únicos: ${uniquePredictionIds.length}\n`);

    // Crear CSV con todos los datos
    const csv = [
        'prediction_id,fixture_id,predicted_market,predicted_outcome,was_correct,verified_at,actual_score'
    ];

    contaminated.forEach(p => {
        csv.push([
            p.prediction_id,
            p.fixture_id,
            p.predicted_market,
            p.predicted_outcome,
            p.was_correct,
            p.verified_at,
            p.actual_score
        ].join(','));
    });

    // Guardar CSV
    const csvPath = 'scripts/contaminated_predictions.csv';
    writeFileSync(csvPath, csv.join('\n'));
    console.log(`✅ CSV exportado: ${csvPath}\n`);

    // Guardar lista de IDs para limpieza
    const idsPath = 'scripts/prediction_ids_to_clean.json';
    writeFileSync(idsPath, JSON.stringify({
        total: uniquePredictionIds.length,
        fecha_export: new Date().toISOString(),
        fecha_x: '2025-12-27T06:31:31.394+00:00',
        fecha_fin: '2026-01-02T03:00:22.847+00:00',
        prediction_ids: uniquePredictionIds,
        breakdown_por_mercado: byMarket
    }, null, 2));
    console.log(`✅ Lista de IDs guardada: ${idsPath}\n`);

    // Resumen final
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📋 RESUMEN PARA LIMPIEZA');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Total registros a eliminar de predictions_results: ${contaminated.length}`);
    console.log(`Total predicciones a resetear en predictions: ${uniquePredictionIds.length}`);
    console.log('');
    console.log('🚨 MERCADOS CRÍTICOS (100% perdidas):');
    sorted
        .filter(([_, stats]) => (stats.perdidas / stats.total) === 1)
        .forEach(([market, stats]) => {
            console.log(`   - ${market}: ${stats.total} predicciones`);
        });
    console.log('═══════════════════════════════════════════════════════════\n');

    return {
        totalRecords: contaminated.length,
        uniquePredictions: uniquePredictionIds.length,
        breakdown: byMarket
    };
}

exportContaminatedPredictions().then(result => {
    console.log('✅ Exportación completada');
    console.log('📁 Archivos generados:');
    console.log('   - scripts/contaminated_predictions.csv');
    console.log('   - scripts/prediction_ids_to_clean.json');
    console.log('');
    console.log('🎯 PRÓXIMO PASO: Ejecutar script de limpieza');
    process.exit(0);
}).catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
});
