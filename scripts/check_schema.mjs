// Verificar schema de analysis_runs
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    'https://nokejmhlpsaoerhddcyc.supabase.co',
    '__ROTATED_KEY_LOAD_FROM_ENV__'
);

// Obtener un análisis con api_fixture_id para ver la relación
const { data: job } = await supabase
    .from('analysis_jobs')
    .select('id, api_fixture_id')
    .limit(1);

console.log('analysis_jobs sample:', job?.[0]);
console.log('  - id (UUID):', job?.[0]?.id);
console.log('  - api_fixture_id (número):', job?.[0]?.api_fixture_id, typeof job?.[0]?.api_fixture_id);

// Verificar que predictions tiene fixture_id numérico funcionando
const { data: pred } = await supabase
    .from('predictions')
    .select('fixture_id')
    .not('fixture_id', 'is', null)
    .limit(1);

console.log('\npredictions fixture_id:', pred?.[0]?.fixture_id, typeof pred?.[0]?.fixture_id);
