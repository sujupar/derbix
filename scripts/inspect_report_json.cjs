const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const SUPABASE_URL = 'https://nokejmhlpsaoerhddcyc.supabase.co';
const SERVICE_KEY = '__ROTATED_KEY_LOAD_FROM_ENV__';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function inspect(fixtureId) {
    console.log(`Inspecting report for fixture ${fixtureId}...`);
    const { data: reports } = await supabase
        .from('reports_v2')
        .select('*')
        .eq('fixture_id', fixtureId)
        .order('created_at', { ascending: false })
        .limit(1);

    if (!reports || reports.length === 0) {
        console.log("No report found.");
        return;
    }

    const report = reports[0];
    fs.writeFileSync('debug_report_dump.json', JSON.stringify(report.report_packet, null, 2));
    console.log("Dumped to debug_report_dump.json");
}

const id = process.argv[2];
inspect(id);
