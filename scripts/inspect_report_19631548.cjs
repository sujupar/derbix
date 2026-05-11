
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://nokejmhlpsaoerhddcyc.supabase.co';
const SERVICE_KEY = '__ROTATED_KEY_LOAD_FROM_ENV__';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const FIXTURE_ID = 19631548;

async function inspectReport() {
    console.log(`Inspecting reports_v2 for Fixture ${FIXTURE_ID}...`);

    const { data: reports, error } = await supabase
        .from('reports_v2')
        .select('*')
        .eq('fixture_id', FIXTURE_ID)
        .order('created_at', { ascending: false })
        .limit(1);

    if (error) {
        console.error("Error:", error);
        return;
    }

    if (!reports || reports.length === 0) {
        console.log("❌ No report found for this fixture.");
        return;
    }

    const report = reports[0];
    console.log(`Report Found! ID: ${report.id}`);
    console.log(`Created At: ${report.created_at}`);

    const packet = report.report_packet;
    console.log("\n--- PACKET SAMPLE ---");
    console.log(JSON.stringify(packet, null, 2).substring(0, 2000)); // Log first 2000 chars
    console.log("Pronosticos Count:", packet.pronosticos?.length);
    if (packet.pronosticos && packet.pronosticos[0]) {
        console.log("First Pick:", JSON.stringify(packet.pronosticos[0], null, 2));
    }
}

inspectReport();
