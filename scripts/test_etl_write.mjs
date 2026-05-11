/**
 * Test: Can we write etl_context to the database?
 * This will test if the column is writable and identify size limits
 */

const SUPABASE_URL = 'https://nokejmhlpsaoerhddcyc.supabase.co';
const SUPABASE_KEY = '__ROTATED_KEY_LOAD_FROM_ENV__';
const FIXTURE_ID = 19427701;

async function querySupabase(table, selectCols = '*', filter = {}) {
    let url = `${SUPABASE_URL}/rest/v1/${table}?select=${selectCols}`;
    Object.entries(filter).forEach(([col, val]) => {
        url += `&${col}=eq.${val}`;
    });
    const res = await fetch(url, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    return res.json();
}

async function updateSupabase(table, filter, data) {
    let url = `${SUPABASE_URL}/rest/v1/${table}`;
    Object.entries(filter).forEach(([col, val], i) => {
        url += (i === 0 ? '?' : '&') + `${col}=eq.${val}`;
    });

    console.log(`Updating ${table} at ${url}`);
    console.log(`Payload size: ${JSON.stringify(data).length} bytes`);

    const res = await fetch(url, {
        method: 'PATCH',
        headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        },
        body: JSON.stringify(data)
    });

    const text = await res.text();
    console.log(`Response Status: ${res.status}`);
    console.log(`Response Body: ${text.substring(0, 500)}`);
    return { status: res.status, body: text };
}

async function main() {
    console.log('═'.repeat(60));
    console.log('TEST: etl_context Write Capability');
    console.log('═'.repeat(60));

    // 1. Find the job
    const jobs = await querySupabase('analysis_jobs_v2', '*', { fixture_id: FIXTURE_ID });
    const job = jobs[jobs.length - 1];

    if (!job) {
        console.log('❌ No job found');
        return;
    }

    console.log(`\n📌 Found Job: ${job.id}`);
    console.log(`   Current etl_context: ${job.etl_context ? 'HAS DATA' : 'NULL'}`);

    // 2. Try to write a small test etl_context
    console.log('\n📌 TEST 1: Writing small test data...');
    const smallTest = { test: true, timestamp: new Date().toISOString() };
    const result1 = await updateSupabase('analysis_jobs_v2', { id: job.id }, { etl_context: smallTest });

    if (result1.status !== 200) {
        console.log('❌ FAILED to write small test data! Check column permissions.');
        return;
    }

    // 3. Verify it was written
    const jobs2 = await querySupabase('analysis_jobs_v2', '*', { id: job.id });
    const updated = jobs2[0];
    console.log(`   Verification: etl_context.test = ${updated?.etl_context?.test}`);

    if (updated?.etl_context?.test !== true) {
        console.log('❌ Write succeeded but data not persisted!');
        return;
    }

    console.log('✅ Small write OK');

    // 4. Try to write a LARGE payload (simulating real data)
    console.log('\n📌 TEST 2: Writing large payload (simulating deep history)...');

    // Create a fake large payload similar to what the function builds
    const fakeLargePayload = {
        match: { fixture_id: FIXTURE_ID, teams: { home: 'Leeds', away: 'Forest' } },
        datasets: {
            home_team_last40: {
                all: Array(40).fill({
                    date: '2024-01-01',
                    home_team: 'Team A',
                    away_team: 'Team B',
                    score_home: 2,
                    score_away: 1,
                    details: { possession: 55, shots_total: 15, corners: 6, saves: 4 }
                })
            },
            away_team_last40: {
                all: Array(40).fill({
                    date: '2024-01-01',
                    home_team: 'Team C',
                    away_team: 'Team D',
                    score_home: 0,
                    score_away: 1,
                    details: { possession: 45, shots_total: 10, corners: 4, saves: 7 }
                })
            },
            h2h: Array(10).fill({ date: '2023-05-01', home_team: 'Leeds', away_team: 'Forest', score_home: 1, score_away: 1 })
        },
        odds: {
            MAIN: [{ lbl: 'Home Win', val: '2.10' }, { lbl: 'Draw', val: '3.30' }],
            GOALS: [{ lbl: 'Over 2.5', val: '1.95' }]
        }
    };

    console.log(`   Fake payload size: ${JSON.stringify(fakeLargePayload).length} chars`);

    const result2 = await updateSupabase('analysis_jobs_v2', { id: job.id }, { etl_context: fakeLargePayload });

    if (result2.status !== 200) {
        console.log('❌ FAILED to write large payload! May be size limit issue.');
    } else {
        // Verify
        const jobs3 = await querySupabase('analysis_jobs_v2', 'id,etl_context', { id: job.id });
        const final = jobs3[0];
        console.log(`   Verification: etl_context.datasets exists = ${!!final?.etl_context?.datasets}`);
        console.log(`   home_team_last40 count: ${final?.etl_context?.datasets?.home_team_last40?.all?.length}`);
        console.log('✅ Large write OK!');
    }

    console.log('\n' + '═'.repeat(60));
    console.log('TEST COMPLETE');
    console.log('═'.repeat(60));
}

main().catch(console.error);
