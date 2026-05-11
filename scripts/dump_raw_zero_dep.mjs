/**
 * ZERO-DEPENDENCY DIAGNOSTIC: Dump Raw AI Output
 * No external modules - uses native fetch and hardcoded values
 */

const SUPABASE_URL = 'https://nokejmhlpsaoerhddcyc.supabase.co';
const SUPABASE_KEY = '__ROTATED_KEY_LOAD_FROM_ENV__';

const JOB_ID = process.argv[2];

async function querySupabase(table, column, value) {
    const url = `${SUPABASE_URL}/rest/v1/${table}?${column}=eq.${value}&select=*`;
    const res = await fetch(url, {
        headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`
        }
    });
    return res.json();
}

async function getLatestJob() {
    const url = `${SUPABASE_URL}/rest/v1/analysis_jobs_v2?select=id,fixture_id,status,created_at&order=created_at.desc&limit=1`;
    const res = await fetch(url, {
        headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`
        }
    });
    const data = await res.json();
    return data[0];
}

async function main() {
    console.log('\n' + '═'.repeat(80));
    console.log('🔬 RAW AI OUTPUT DIAGNOSTIC');
    console.log('═'.repeat(80));

    let jobId = JOB_ID;

    if (!jobId) {
        console.log('\n📋 No Job ID provided, fetching LATEST...\n');
        const latest = await getLatestJob();
        if (!latest) {
            console.error('❌ No jobs found');
            return;
        }
        jobId = latest.id;
        console.log(`📌 Latest Job: ${jobId}`);
        console.log(`   Fixture: ${latest.fixture_id}`);
        console.log(`   Status: ${latest.status}`);
    }

    // Fetch from reports_v2
    console.log('\n' + '─'.repeat(80));
    console.log('📦 RAW AI OUTPUT from reports_v2.report_packet:');
    console.log('─'.repeat(80));

    const reports = await querySupabase('reports_v2', 'job_id', jobId);

    if (!reports || reports.length === 0) {
        console.log('❌ No reports_v2 record found for job:', jobId);
        return;
    }

    const packet = reports[0].report_packet;

    // Show structure
    console.log('\n📊 TOP-LEVEL KEYS:');
    Object.keys(packet).forEach(key => {
        const value = packet[key];
        const type = Array.isArray(value) ? `Array[${value.length}]` : typeof value;
        console.log(`   • ${key}: ${type}`);
    });

    // Check predictions
    console.log('\n🎯 PREDICTIONS CHECK:');
    if (packet.pronosticos?.length > 0) {
        console.log(`   ✅ pronosticos: ${packet.pronosticos.length} picks`);
        packet.pronosticos.forEach((p, i) => {
            console.log(`      [${i}] ${p.mercado}: ${p.seleccion} @ ${p.probabilidad_calculada_porcentaje}%`);
        });
    } else {
        console.log('   ❌ pronosticos: EMPTY or MISSING');
    }

    if (packet.probabilidades_derbix) {
        console.log('   ⚠️  probabilidades_derbix (AI used alternate format):');
        console.log('      ', JSON.stringify(packet.probabilidades_derbix));
    }

    if (packet.pronosticos_listado) {
        console.log('   ⚠️  pronosticos_listado (AI hallucinated key):');
        console.log(`      ${packet.pronosticos_listado.length} items`);
    }

    // Full JSON dump
    console.log('\n' + '─'.repeat(80));
    console.log('📄 COMPLETE RAW JSON (report_packet):');
    console.log('─'.repeat(80));
    console.log(JSON.stringify(packet, null, 2));

    console.log('\n' + '═'.repeat(80));
    console.log('✅ DIAGNOSTIC COMPLETE');
    console.log('═'.repeat(80) + '\n');
}

main().catch(console.error);
