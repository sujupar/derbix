// Script para investigar Fecha X de contaminación
// Ejecutar con: node scripts/investigate_fecha_x.js

import { createClient } from '@supabase/supabase-js';

// Credenciales de Supabase (del proyecto)
const supabaseUrl = 'https://nokejmhlpsaoerhddcyc.supabase.co';
const supabaseKey = '__ROTATED_KEY_LOAD_FROM_ENV__';

const supabase = createClient(supabaseUrl, supabaseKey);

console.log('🔍 Iniciando investigación de Fecha X...\n');

async function investigateFechaX() {
    try {
        // PASO 1: Primera verificación de sync-results
        console.log('📅 PASO 1: Buscando primera verificación de sync-results...');
        const { data: primera, error: error1 } = await supabase
            .from('predictions_results')
            .select('verified_at, prediction_id, fixture_id, predicted_market, predicted_outcome, was_correct, verification_source')
            .eq('verification_source', 'API-Football')
            .order('verified_at', { ascending: true })
            .limit(1);

        if (error1) {
            console.error('❌ Error en PASO 1:', error1);
        } else if (!primera || primera.length === 0) {
            console.log('✅ NO SE ENCONTRARON REGISTROS de sync-results');
            console.log('   → sync-results NUNCA se ejecutó o no dejó rastros');
            console.log('   → NO HAY CONTAMINACIÓN en la base de datos\n');
            return { contaminacion: false };
        } else {
            console.log('🚨 PRIMERA VERIFICACIÓN ENCONTRADA:');
            console.log('   Fecha X:', primera[0].verified_at);
            console.log('   Prediction ID:', primera[0].prediction_id);
            console.log('   Fixture ID:', primera[0].fixture_id);
            console.log('   Market:', primera[0].predicted_market);
            console.log('   Outcome:', primera[0].predicted_outcome);
            console.log('   Was Correct:', primera[0].was_correct);
            console.log('');
        }

        // PASO 2: Última verificación
        console.log('📅 PASO 2: Buscando última verificación de sync-results...');
        const { data: ultima, error: error2 } = await supabase
            .from('predictions_results')
            .select('verified_at, prediction_id, was_correct')
            .eq('verification_source', 'API-Football')
            .order('verified_at', { ascending: false })
            .limit(1);

        if (!error2 && ultima && ultima.length > 0) {
            console.log('📍 ÚLTIMA VERIFICACIÓN:');
            console.log('   Fecha:', ultima[0].verified_at);
            console.log('   Prediction ID:', ultima[0].prediction_id);
            console.log('   Was Correct:', ultima[0].was_correct);
            console.log('');
        }

        // PASO 3: Conteo total
        console.log('📊 PASO 3: Contando registros contaminados...');
        const { data: counts, error: error3 } = await supabase
            .from('predictions_results')
            .select('was_correct')
            .eq('verification_source', 'API-Football');

        if (!error3 && counts) {
            const total = counts.length;
            const perdidas = counts.filter(r => r.was_correct === false).length;
            const ganadas = counts.filter(r => r.was_correct === true).length;

            console.log('   Total registros:', total);
            console.log('   Marcados como PERDIDAS:', perdidas);
            console.log('   Marcados como GANADAS:', ganadas);
            console.log('   Accuracy de sync-results:', ((ganadas / total) * 100).toFixed(2) + '%');
            console.log('');
        }

        // PASO 4: Accuracy de daily-results-verifier (comparación)
        console.log('📊 PASO 4: Comparando con daily-results-verifier...');
        const { data: automation, error: error4 } = await supabase
            .from('predictions_results')
            .select('was_correct')
            .eq('verification_source', 'automation');

        if (!error4 && automation && automation.length > 0) {
            const total_auto = automation.length;
            const ganadas_auto = automation.filter(r => r.was_correct === true).length;
            const accuracy_auto = ((ganadas_auto / total_auto) * 100).toFixed(2);

            console.log('   Total de daily-results-verifier:', total_auto);
            console.log('   Accuracy de daily-results-verifier:', accuracy_auto + '%');
            console.log('');

            // Comparación
            const accuracy_sync = counts ? ((counts.filter(r => r.was_correct === true).length / counts.length) * 100).toFixed(2) : 0;
            const diferencia = (parseFloat(accuracy_auto) - parseFloat(accuracy_sync)).toFixed(2);
            console.log('🔍 COMPARACIÓN:');
            console.log('   Diferencia de accuracy:', diferencia + '%');
            if (parseFloat(diferencia) > 10) {
                console.log('   ⚠️  EVIDENCIA DE PROBLEMA (diferencia >10%)');
            }
            console.log('');
        }

        // PASO 5: Predicciones con conflicto
        console.log('🔍 PASO 5: Buscando predicciones con conflicto...');
        const { data: allResults, error: error5 } = await supabase
            .from('predictions_results')
            .select('prediction_id, verification_source, was_correct')
            .order('prediction_id');

        if (!error5 && allResults) {
            const grouped = {};
            allResults.forEach(r => {
                if (!grouped[r.prediction_id]) grouped[r.prediction_id] = [];
                grouped[r.prediction_id].push(r);
            });

            const conflictos = Object.entries(grouped)
                .filter(([id, records]) => {
                    const sources = new Set(records.map(r => r.verification_source));
                    const results = new Set(records.map(r => r.was_correct));
                    return sources.size > 1 && results.size > 1;
                });

            console.log('   Predicciones con CONFLICTO:', conflictos.length);
            if (conflictos.length > 0) {
                console.log('   🚨 EVIDENCIA DIRECTA de error en sync-results');
                console.log('   Muestra de conflictos:');
                conflictos.slice(0, 3).forEach(([id, records]) => {
                    console.log('     -', id, '→', records.map(r => `${r.verification_source}:${r.was_correct}`).join(', '));
                });
            }
            console.log('');
        }

        // PASO 6: Mercados problemáticos
        console.log('📊 PASO 6: Analizando mercados problemáticos...');
        const { data: markets, error: error6 } = await supabase
            .from('predictions_results')
            .select('predicted_market, was_correct')
            .eq('verification_source', 'API-Football');

        if (!error6 && markets) {
            const marketStats = {};
            markets.forEach(r => {
                if (!marketStats[r.predicted_market]) {
                    marketStats[r.predicted_market] = { total: 0, perdidas: 0 };
                }
                marketStats[r.predicted_market].total++;
                if (r.was_correct === false) marketStats[r.predicted_market].perdidas++;
            });

            const sorted = Object.entries(marketStats)
                .sort((a, b) => b[1].perdidas - a[1].perdidas)
                .slice(0, 5);

            console.log('   Top 5 mercados con más "perdidas":');
            sorted.forEach(([market, stats]) => {
                const pct = ((stats.perdidas / stats.total) * 100).toFixed(1);
                console.log(`     - ${market}: ${stats.perdidas}/${stats.total} (${pct}%)`);
            });
            console.log('');
        }

        // Resumen final
        console.log('═══════════════════════════════════════════');
        console.log('📋 RESUMEN DE INVESTIGACIÓN');
        console.log('═══════════════════════════════════════════');
        if (primera && primera.length > 0) {
            console.log('🚨 CONTAMINACIÓN CONFIRMADA');
            console.log('   Fecha X:', primera[0].verified_at);
            if (ultima && ultima.length > 0) {
                console.log('   Última ejecución:', ultima[0].verified_at);
            }
            if (counts) {
                console.log('   Total registros afectados:', counts.length);
            }
        }
        console.log('═══════════════════════════════════════════\n');

        return {
            contaminacion: true,
            fechaX: primera[0]?.verified_at,
            ultimaFecha: ultima[0]?.verified_at,
            totalRegistros: counts?.length || 0
        };

    } catch (err) {
        console.error('❌ ERROR GENERAL:', err);
        process.exit(1);
    }
}

// Ejecutar
investigateFechaX().then(resultado => {
    console.log('✅ Investigación completada');
    console.log('Resultados:', JSON.stringify(resultado, null, 2));
    process.exit(0);
});
