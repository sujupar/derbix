/**
 * DEEP AUDIT: Trace the ENTIRE data flow from API to Prompt
 * This script will show EXACTLY what data is being fetched and what Gemini receives
 */

const API_KEY = 'RhgNCasAS67wuJtawFoMrkokCP51r89L7dMKQIpXoGVv67BKfnWOcKHcjEG5';
const FIXTURE_ID = 19427701; // Leeds vs Nottingham Forest

const SUPABASE_URL = 'https://nokejmhlpsaoerhddcyc.supabase.co';
const SUPABASE_KEY = '__ROTATED_KEY_LOAD_FROM_ENV__';

async function fetchSM(endpoint, includes = []) {
    const url = new URL(`https://api.sportmonks.com/v3/football${endpoint}`);
    url.searchParams.set('api_token', API_KEY);
    if (includes.length) url.searchParams.set('include', includes.join(';'));
    const res = await fetch(url.toString());
    const json = await res.json();
    return json.data;
}

async function querySupabase(table, column, value) {
    const url = `${SUPABASE_URL}/rest/v1/${table}?${column}=eq.${value}&select=*`;
    const res = await fetch(url, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    return res.json();
}

async function main() {
    console.log('═'.repeat(80));
    console.log('🔬 DEEP DATA FLOW AUDIT');
    console.log('═'.repeat(80));

    // STEP 1: Get Fixture Details
    console.log('\n📌 STEP 1: Fetching Fixture Details from SportMonks...');
    const fixture = await fetchSM(`/fixtures/${FIXTURE_ID}`, ['participants', 'league', 'odds.market', 'odds.bookmaker']);

    if (!fixture) {
        console.error('❌ Fixture not found!');
        return;
    }

    const home = fixture.participants.find(p => p.meta.location === 'home');
    const away = fixture.participants.find(p => p.meta.location === 'away');

    console.log(`   Match: ${home.name} (ID: ${home.id}) vs ${away.name} (ID: ${away.id})`);
    console.log(`   League: ${fixture.league?.name || 'Unknown'}`);
    console.log(`   Odds Available: ${fixture.odds?.length || 0} markets`);

    // STEP 2: Check what data the DEPLOYED function should fetch
    console.log('\n📌 STEP 2: Simulating getTeamFixtures() with CORRECTED endpoint...');
    const end = new Date();
    const start = new Date();
    start.setFullYear(start.getFullYear() - 2);
    const startStr = start.toISOString().split('T')[0];
    const endStr = end.toISOString().split('T')[0];

    const endpoint = `/fixtures/between/${startStr}/${endStr}/${home.id}`;
    console.log(`   Calling: ${endpoint}`);

    const homeHistory = await fetchSM(endpoint, ['participants', 'scores', 'statistics']);
    console.log(`   ${home.name} History Returned: ${homeHistory?.length || 0} matches`);

    if (homeHistory && homeHistory.length > 0) {
        console.log('\n   📊 SAMPLE OF HOME HISTORY (First 5 Matches):');
        homeHistory.slice(0, 5).forEach((m, i) => {
            const scores = m.scores || [];
            const ftScore = scores.find(s => s.description === 'CURRENT');
            const homeScore = ftScore?.score?.goals ?? '?';
            const awayScore = scores.find(s => s.description === 'CURRENT' && s.participant_id !== m.participants?.[0]?.id)?.score?.goals ?? '?';

            // Get team names from participants
            const homeTeam = m.participants?.find(p => p.meta?.location === 'home')?.name || 'Home';
            const awayTeam = m.participants?.find(p => p.meta?.location === 'away')?.name || 'Away';

            console.log(`      [${i}] ${m.starting_at?.split(' ')[0]} | ${homeTeam} vs ${awayTeam} | Stats Available: ${m.statistics?.length || 0}`);
        });
    } else {
        console.log('   ❌ NO HISTORY RETURNED! This is the problem.');
    }

    // STEP 3: Check what's actually in the Database
    console.log('\n📌 STEP 3: Checking Database for saved data (analysis_jobs_v2)...');
    const jobs = await querySupabase('analysis_jobs_v2', 'fixture_id', FIXTURE_ID);
    const latestJob = jobs[jobs.length - 1];

    if (latestJob) {
        console.log(`   Job ID: ${latestJob.id}`);
        console.log(`   Status: ${latestJob.status}`);
        console.log(`   etl_context exists: ${latestJob.etl_context ? 'YES' : 'NO'}`);

        if (latestJob.etl_context) {
            const ctx = latestJob.etl_context;
            console.log(`   etl_context.datasets keys: ${Object.keys(ctx.datasets || {}).join(', ')}`);

            if (ctx.datasets?.home_deep_history) {
                console.log(`   home_deep_history count: ${ctx.datasets.home_deep_history.length}`);
                console.log(`   SAMPLE HOME DATA FROM DB:`);
                ctx.datasets.home_deep_history.slice(0, 3).forEach((m, i) => {
                    console.log(`      [${i}] ${m.date} | ${m.home_team} vs ${m.away_team} | ${m.score_home}-${m.score_away}`);
                });
            } else {
                console.log('   ❌ home_deep_history MISSING');
            }
        }
    } else {
        console.log('   ❌ No job found for this fixture!');
    }

    // STEP 4: Check reports_v2 for what Gemini actually output
    console.log('\n📌 STEP 4: Checking reports_v2 for AI output...');
    const reports = await querySupabase('reports_v2', 'fixture_id', FIXTURE_ID);
    const latestReport = reports[reports.length - 1];

    if (latestReport) {
        const packet = latestReport.report_packet;
        console.log(`   Report Keys: ${Object.keys(packet).join(', ')}`);
        console.log(`   Titular: "${packet.resumen_ejecutivo?.titular}"`);
        console.log(`   Pronosticos Count: ${packet.pronosticos?.length || 0}`);

        if (packet.pronosticos) {
            console.log('\n   📊 PRONOSTICOS DETAILS:');
            packet.pronosticos.forEach((p, i) => {
                console.log(`      [${i}] ${p.mercado}: ${p.seleccion}`);
                console.log(`          Prob: ${p.probabilidad_calculada_porcentaje}%`);
                console.log(`          Justificacion: ${JSON.stringify(p.justificacion || p.razonamiento).substring(0, 200)}`);
            });
        }

        // Check analisis_profundo
        if (packet.analisis_profundo) {
            console.log('\n   📊 ANALISIS_PROFUNDO:');
            console.log(`      matchup_tactico: ${(packet.analisis_profundo.matchup_tactico || 'MISSING').substring(0, 200)}`);
            console.log(`      factor_psicologico: ${(packet.analisis_profundo.factor_psicologico || 'MISSING').substring(0, 200)}`);
        }
    }

    // STEP 5: Check ODDS from database
    console.log('\n📌 STEP 5: Checking ODDS in etl_context...');
    if (latestJob?.etl_context?.odds) {
        const odds = latestJob.etl_context.odds;
        console.log(`   Odds Keys: ${Object.keys(odds).join(', ')}`);
        if (odds.MAIN) {
            console.log(`   MAIN Odds Sample: ${JSON.stringify(odds.MAIN.slice(0, 3))}`);
        }
    } else {
        console.log('   ❌ NO ODDS in etl_context! Checking raw...');
        if (fixture.odds) {
            console.log(`   Odds from API available: ${fixture.odds.length} markets`);
            console.log(`   Sample: ${JSON.stringify(fixture.odds.slice(0, 2)).substring(0, 300)}`);
        }
    }

    console.log('\n' + '═'.repeat(80));
    console.log('AUDIT COMPLETE - Review above to identify the breakage point.');
    console.log('═'.repeat(80));
}

main().catch(console.error);
