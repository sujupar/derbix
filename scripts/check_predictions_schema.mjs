// Verificar schema REAL de predictions
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    'https://nokejmhlpsaoerhddcyc.supabase.co',
    '__ROTATED_KEY_LOAD_FROM_ENV__'
);

// Obtener una prediction existente para ver qué columnas tiene
const { data, error } = await supabase
    .from('predictions')
    .select('*')
    .limit(1);

if (error) {
    console.error('Error:', error);
} else if (data && data[0]) {
    console.log('Columnas existentes en predictions:');
    console.log(Object.keys(data[0]).sort().join('\n'));
} else {
    console.log('No hay predictions en la tabla');
}
