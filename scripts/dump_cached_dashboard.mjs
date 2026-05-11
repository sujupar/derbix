/**
 * DIAGNOSTIC: Dump cached dashboardData from analisis table
 */
const SUPABASE_URL = 'https://nokejmhlpsaoerhddcyc.supabase.co';
const SUPABASE_KEY = '__ROTATED_KEY_LOAD_FROM_ENV__';

// Sporting vs AVS fixture
const FIXTURE_ID = 19618597;

async function main() {
    console.log(`\n🔍 CHECKING CACHED DASHBOARDDATA for fixture ${FIXTURE_ID}\n`);

    const url = `${SUPABASE_URL}/rest/v1/analisis?partido_id=eq.${FIXTURE_ID}&select=resultado_analisis`;
    const res = await fetch(url, {
        headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`
        }
    });
    const data = await res.json();

    if (!data || data.length === 0) {
        console.log('❌ No cached data found');
        return;
    }

    const resultado = data[0].resultado_analisis;
    console.log('📊 resultado_analisis TOP-LEVEL KEYS:');
    Object.keys(resultado).forEach(k => console.log(`   • ${k}`));

    if (resultado.dashboardData) {
        console.log('\n📊 dashboardData TOP-LEVEL KEYS:');
        Object.keys(resultado.dashboardData).forEach(k => console.log(`   • ${k}`));

        const preds = resultado.dashboardData.predicciones_finales?.detalle;
        if (preds && preds.length > 0) {
            console.log(`\n🎯 PREDICTIONS in dashboardData (${preds.length}):`);
            preds.forEach((p, i) => {
                console.log(`[${i}] ${p.mercado}: ${p.seleccion}`);
                console.log(`    probabilidad_estimado_porcentaje: ${p.probabilidad_estimado_porcentaje}`);
                console.log(`    probabilidad_derbix: ${p.probabilidad_derbix}`);
                console.log(`    edge: ${p.edge}`);
                console.log(`    odds: ${p.odds}`);
                console.log(`    Full object:`, JSON.stringify(p, null, 2).substring(0, 500));
            });
        } else {
            console.log('\n⚠️ predicciones_finales.detalle is EMPTY');
        }

        // Check if pronosticos exists at dashboardData level
        if (resultado.dashboardData.pronosticos) {
            console.log('\n⚠️ dashboardData.pronosticos EXISTS (alternative location):');
            console.log(JSON.stringify(resultado.dashboardData.pronosticos.slice(0, 2), null, 2));
        }
    }

    // Also check if pronosticos is at root level
    if (resultado.pronosticos) {
        console.log('\n⚠️ resultado_analisis.pronosticos EXISTS (root level):');
        console.log(JSON.stringify(resultado.pronosticos.slice(0, 2), null, 2));
    }
}

main().catch(console.error);
