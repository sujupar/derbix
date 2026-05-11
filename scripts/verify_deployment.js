
const FIXTURE_ID = 19439462; // Espanyol vs Deportivo Alavés
const SUPABASE_URL = 'https://nokejmhlpsaoerhddcyc.supabase.co/functions/v1/v3-orchestrator';
const SUPABASE_KEY = '__ROTATED_KEY_LOAD_FROM_ENV__';

console.log(`Testing Deployment for Fixture: ${FIXTURE_ID}`);
console.log(`Target URL: ${SUPABASE_URL}`);

try {
    const response = await fetch(SUPABASE_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_KEY}`
        },
        body: JSON.stringify({ fixture_id: FIXTURE_ID })
    });

    console.log(`Status: ${response.status}`);
    const text = await response.text();

    try {
        const json = JSON.parse(text);

        if (json.success) {
            console.log('\n--- ✅ SUCCESS ---');
            console.log('Engine Version:', json.engine_version);
            console.log('Execution Time:', json.total_execution_time_ms + 'ms');

            if (json.report?.resumen_ejecutivo) {
                console.log('\n[AI Analysis]');
                console.log('Titular:', json.report.resumen_ejecutivo.titular);
                console.log('Veredicto:', json.report.resumen_ejecutivo.veredicto);
                console.log('Confianza:', json.report.resumen_ejecutivo.confianza_global);
            } else {
                console.error('\n⚠️ AI Report Missing');
            }

            if (json.motors?.A) {
                console.log('\n[Motor A - Data]');
                console.log('Coverage:', json.motors.A.coverage_score);
                console.log('Has Odds:', json.motors.A.has_odds);
            } else {
                console.error('\n⚠️ Motor A Missing');
            }

            // Dump data for review
            // console.log(JSON.stringify(json, null, 2));

        } else {
            console.error('\n❌ API Error:', json.error);
        }

    } catch (e) {
        console.error('\n❌ JSON Parse Error:', e);
        console.log('Raw Response:', text);
    }

} catch (e) {
    console.error('\n❌ Network/Fetch Error:', e);
}
