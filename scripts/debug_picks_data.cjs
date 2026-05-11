
// Script para simular la lógica de HighProbPicks y ver los datos crudos
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://nokejmhlpsaoerhddcyc.supabase.co';
const SERVICE_KEY = '__ROTATED_KEY_LOAD_FROM_ENV__';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function debugPicks() {
    const date = '2026-01-31';
    console.log(`DEBUG: Loading picks for date: ${date}`);

    try {
        // 1. Obtener jobs
        const { data: jobs, error: jobsError } = await supabase
            .from('analysis_jobs_v2')
            .select('id, fixture_id, created_at')
            .gte('created_at', `${date}T00:00:00`)
            .lt('created_at', `${date}T23:59:59`)
            .eq('status', 'done');

        if (jobsError) { console.error(jobsError); return; }
        console.log(`Found ${jobs ? jobs.length : 0} total jobs`);

        if (!jobs || jobs.length === 0) return;

        // Filter latest
        const latestJobByFixture = new Map();
        for (const job of jobs) {
            const existing = latestJobByFixture.get(job.fixture_id);
            if (!existing || new Date(job.created_at) > new Date(existing.created_at)) {
                latestJobByFixture.set(job.fixture_id, job);
            }
        }
        const latestJobs = Array.from(latestJobByFixture.values());
        console.log(`Unique fixtures: ${latestJobs.length}`);

        // 2. Lookup matches
        const fixtureIds = latestJobs.map(j => j.fixture_id);
        const { data: matches } = await supabase
            .from('daily_matches')
            .select('api_fixture_id, home_team, away_team')
            .in('api_fixture_id', fixtureIds);

        console.log(`Matches found in daily_matches: ${matches ? matches.length : 0}`);
        const matchMap = new Map();
        (matches || []).forEach(m => matchMap.set(m.api_fixture_id, m));

        // 3. Get Reports
        const { data: reports } = await supabase
            .from('reports_v2')
            .select('job_id, fixture_id, report_packet')
            .in('job_id', latestJobs.map(j => j.id));

        console.log('\n--- ANALYSIS OF PICKS ---');
        let issuesFound = 0;

        (reports || []).forEach(r => {
            const fixtureId = r.fixture_id;
            const matchDb = matchMap.get(fixtureId);
            const packet = r.report_packet;
            const title = packet?.header_partido?.titulo || 'N/A';
            const picks = packet?.pronosticos || []; // Use 'pronosticos' as usually stored

            // Check for generic names or missing DB entry
            const usesFallback = !matchDb;
            const isGenericTitle = title.includes('Local') || title.includes('Visitante');

            // Also check for picks > 80% without odds
            const highProbPicks = picks.filter(p => {
                const prob = p.probabilidad_calculada_porcentaje || p.probabilidad || 0;
                return prob >= 80;
            });

            const checksFailed = usesFallback || isGenericTitle || highProbPicks.some(p => !p.cuota_actual && !p.cuota);

            if (checksFailed) {
                issuesFound++;
                console.log(`\n⚠️ ISSUE DETECTED - Fixture ${fixtureId}`);
                console.log(`   In daily_matches? ${!!matchDb ? 'YES' : 'NO'}`);
                if (!matchDb) console.log(`   --> CAUSE: Fixture NOT in monthly/daily cache table.`);

                console.log(`   Report Title: "${title}"`);
                if (isGenericTitle) console.log(`   --> CAUSE: AI generated generic title.`);

                if (matchDb) {
                    console.log(`   DB Names: ${matchDb.home_team} vs ${matchDb.away_team}`);
                }

                if (highProbPicks.length > 0) {
                    console.log(`   High Prob Picks (${highProbPicks.length}):`);
                    highProbPicks.forEach((p, i) => {
                        const odds = p.cuota_actual || p.cuota;
                        console.log(`     #${i + 1} [${p.mercado}] -> Odds: ${odds} (${odds ? 'OK' : 'MISSING'})`);
                    });
                }
            }
        });

        if (issuesFound === 0) {
            console.log("No obvious data anomalies found. All high prob picks have names and odds in DB.");
            console.log("If UI is still broken, it might be a Frontend Rendering issue.");
        }

    } catch (e) {
        console.error("Runtime Error:", e);
    }
}

debugPicks();
