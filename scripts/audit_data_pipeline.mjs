/**
 * DEEP AUDIT: Examine what data is actually stored for a job
 * This will help identify why historical data appears "broken"
 */
const SUPABASE_URL = 'https://nokejmhlpsaoerhddcyc.supabase.co';
const SUPABASE_KEY = '__ROTATED_KEY_LOAD_FROM_ENV__';

// Leeds United vs Nottingham Forest (Fixture form user report)
const FIXTURE_ID = 19427701;

async function query(table, column, value, select = '*') {
    const url = `${SUPABASE_URL}/rest/v1/${table}?${column}=eq.${value}&select=${select}`;
    const res = await fetch(url, {
        headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`
        }
    });
    return res.json();
}

async function main() {
    console.log(`\n${'═'.repeat(80)}`);
    console.log('🔍 DEEP AUDIT: Historical Data Pipeline');
    console.log(`${'═'.repeat(80)}\n`);

    // 1. Get the job for this fixture
    console.log('1️⃣ CHECKING analysis_jobs_v2...');
    const jobs = await query('analysis_jobs_v2', 'fixture_id', FIXTURE_ID);
    if (!jobs || jobs.length === 0) {
        console.log('❌ No job found for fixture', FIXTURE_ID);
        return;
    }
    const job = jobs[jobs.length - 1]; // Latest job
    console.log(`   Job ID: ${job.id}`);
    console.log(`   Status: ${job.status}`);
    console.log(`   Motor: ${job.current_motor}`);
    console.log(`   Created: ${job.created_at}`);

    // 2. Check what's in the job payload
    console.log('\n2️⃣ CHECKING job payload (etl_context)...');
    if (job.etl_context) {
        const ctx = job.etl_context;
        console.log('   etl_context keys:', Object.keys(ctx).join(', '));

        // Check datasets
        if (ctx.datasets) {
            console.log('\n   📊 DATASETS FOUND:');
            Object.keys(ctx.datasets).forEach(k => {
                const v = ctx.datasets[k];
                if (Array.isArray(v)) {
                    console.log(`      • ${k}: Array[${v.length}]`);
                } else if (typeof v === 'object' && v !== null) {
                    console.log(`      • ${k}: Object with keys [${Object.keys(v).slice(0, 5).join(', ')}...]`);
                } else {
                    console.log(`      • ${k}: ${typeof v} = ${String(v).substring(0, 50)}`);
                }
            });

            // Check specific data quality
            if (ctx.datasets.home_deep_history) {
                console.log(`\n   🏠 HOME DEEP HISTORY: ${ctx.datasets.home_deep_history.length} matches`);
                if (ctx.datasets.home_deep_history.length > 0) {
                    const sample = ctx.datasets.home_deep_history[0];
                    console.log(`      Sample keys: ${Object.keys(sample).join(', ')}`);
                }
            } else {
                console.log('\n   ⚠️ HOME DEEP HISTORY: MISSING!');
            }

            if (ctx.datasets.away_deep_history) {
                console.log(`   🚌 AWAY DEEP HISTORY: ${ctx.datasets.away_deep_history.length} matches`);
            } else {
                console.log('   ⚠️ AWAY DEEP HISTORY: MISSING!');
            }

            if (ctx.datasets.h2h_history) {
                console.log(`   ⚔️ H2H HISTORY: ${ctx.datasets.h2h_history.length} matches`);
            } else {
                console.log('   ⚠️ H2H HISTORY: MISSING!');
            }

            if (ctx.datasets.standings) {
                console.log(`   📈 STANDINGS: ${Array.isArray(ctx.datasets.standings) ? ctx.datasets.standings.length + ' teams' : 'Object'}`);
            } else {
                console.log('   ⚠️ STANDINGS: MISSING!');
            }

        } else {
            console.log('   ⚠️ NO datasets key in etl_context!');
        }

        // Check odds
        if (ctx.odds) {
            console.log('\n   💰 ODDS DATA:');
            Object.keys(ctx.odds).forEach(k => {
                const v = ctx.odds[k];
                if (Array.isArray(v)) {
                    console.log(`      • ${k}: ${v.length} markets`);
                }
            });
        } else {
            console.log('   ⚠️ NO odds in etl_context!');
        }

    } else {
        console.log('   ❌ etl_context is NULL or undefined!');
    }

    // 3. Check reports_v2
    console.log('\n3️⃣ CHECKING reports_v2 (AI output)...');
    const reports = await query('reports_v2', 'job_id', job.id);
    if (reports && reports.length > 0) {
        const packet = reports[0].report_packet;
        console.log('   report_packet keys:', Object.keys(packet).join(', '));

        // Check if AI mentioned data issues
        if (packet.resumen_ejecutivo?.titular) {
            console.log(`\n   📝 AI TITULAR: "${packet.resumen_ejecutivo.titular}"`);
        }

        // Check pronosticos
        if (packet.pronosticos && packet.pronosticos.length > 0) {
            console.log(`\n   🎯 PRONOSTICOS: ${packet.pronosticos.length} picks`);
            packet.pronosticos.slice(0, 2).forEach((p, i) => {
                console.log(`      [${i}] ${p.mercado}: ${p.seleccion}`);
                console.log(`          Justificacion: ${JSON.stringify(p.justificacion || p.razonamiento || 'N/A').substring(0, 150)}`);
            });
        }

        // Check analisis_profundo
        if (packet.analisis_profundo) {
            console.log('\n   🧠 ANALISIS_PROFUNDO keys:', Object.keys(packet.analisis_profundo).join(', '));
        } else {
            console.log('\n   ⚠️ ANALISIS_PROFUNDO: MISSING!');
        }

        // Check datos_modelo
        if (packet.datos_modelo) {
            console.log('\n   🔬 DATOS_MODELO Inspection:');
            const dm = packet.datos_modelo;
            if (dm.last_40_home) {
                console.log(`      Home History Sample (first 3):`);
                dm.last_40_home.slice(0, 3).forEach((m, i) => {
                    console.log(`         [${i}] ${m.date || 'No Date'} - ${m.home_team} vs ${m.away_team} (${m.score_fulltime || '??'})`);
                });
            } else {
                console.log(`      ❌ last_40_home is missing in datos_modelo`);
            }
        } else {
            console.log(`   ⚠️ datos_modelo is missing in report_packet`);
        }

    } else {
        console.log('   ❌ No report found!');
    }

    // 4. Check analisis table (cached dashboard)
    console.log('\n4️⃣ CHECKING analisis table (cached dashboard)...');
    const analisis = await query('analisis', 'partido_id', FIXTURE_ID);
    if (analisis && analisis.length > 0) {
        const resultado = analisis[0].resultado_analisis;
        if (resultado?.dashboardData) {
            const dd = resultado.dashboardData;
            console.log('   dashboardData keys:', Object.keys(dd).join(', '));

            // Check analisis_detallado
            if (dd.analisis_detallado) {
                console.log('\n   📊 analisis_detallado keys:', Object.keys(dd.analisis_detallado).join(', '));

                // Check datos_clave
                if (dd.analisis_detallado.datos_clave) {
                    console.log('   ✅ datos_clave exists:', JSON.stringify(dd.analisis_detallado.datos_clave).substring(0, 200));
                } else {
                    console.log('   ⚠️ datos_clave: MISSING in analisis_detallado!');
                }
            }
        }
    } else {
        console.log('   ❌ No cached analysis found!');
    }

    console.log(`\n${'═'.repeat(80)}`);
    console.log('AUDIT COMPLETE');
    console.log(`${'═'.repeat(80)}\n`);
}

main().catch(console.error);
