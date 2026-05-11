// Verificar parlays generados
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://nokejmhlpsaoerhddcyc.supabase.co';
const supabaseKey = '__ROTATED_KEY_LOAD_FROM_ENV__';

const supabase = createClient(supabaseUrl, supabaseKey);

async function verifyParlays() {
    console.log('🎰 VERIFICANDO PARLAYS GENERADOS\n');

    const { data: parlays, error } = await supabase
        .from('daily_auto_parlays')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log(`Total parlays encontrados: ${parlays?.length || 0}\n`);

    parlays?.forEach((p, i) => {
        console.log(`${i + 1}. ${p.title}`);
        console.log(`   Fecha: ${p.parlay_date}`);
        console.log(`   Pronósticos: ${p.legs?.length || 0}`);
        console.log(`   Cuota total: ${p.total_odds}`);
        console.log(`   Probabilidad: ${p.win_probability}%`);
        console.log(`   Estado: ${p.status}`);
        console.log(`   Featured: ${p.is_featured ? '⭐' : '○'}`);
        console.log(`   Creado: ${new Date(p.created_at).toLocaleString()}`);
        console.log('');
    });
}

verifyParlays().catch(console.error);
