// Verificar análisis creados
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://nokejmhlpsaoerhddcyc.supabase.co';
const supabaseKey = '__ROTATED_KEY_LOAD_FROM_ENV__';

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    console.log('📊 VERIFICANDO ANÁLISIS GENERADOS\n');

    // Análisis jobs
    const { data: jobs, error: jobsError } = await supabase
        .from('analysis_jobs')
        .select('id, api_fixture_id, status, created_at')
        .order('created_at', { ascending: false })
        .limit(10);

    if (jobsError) {
        console.log('Error jobs:', jobsError.message);
    } else {
        console.log(`✅ Analysis Jobs: ${jobs?.length || 0}`);
        jobs?.forEach(j => {
            console.log(`   - Fixture ${j.api_fixture_id}: ${j.status} (${new Date(j.created_at).toLocaleString()})`);
        });
    }

    // Daily matches
    console.log('\n');
    const { data: matches } = await supabase
        .from('daily_matches')
        .select('home_team, away_team, is_analyzed, match_date')
        .eq('match_date', '2025-12-29')
        .limit(10);

    console.log(`⚽ Partidos del 29 dic:`);
    matches?.forEach(m => {
        const status = m.is_analyzed ? '✅' : '⏳';
        console.log(`   ${status} ${m.home_team} vs ${m.away_team}`);
    });
}

check();
