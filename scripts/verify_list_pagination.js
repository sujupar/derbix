
// Script para verificar que el endpoint v2-list-fixtures devuelve MÁS de 25 resultados
import { writeFileSync } from 'fs';

const SUPABASE_URL = 'https://nokejmhlpsaoerhddcyc.supabase.co';
const SERVICE_KEY = '__ROTATED_KEY_LOAD_FROM_ENV__';
const DATE = '2026-01-30'; // Fecha con muchos partidos

async function verifyList() {
    console.log(`Verifying list-fixtures pagination for ${DATE}...`);

    const url = `${SUPABASE_URL}/functions/v1/v2-list-fixtures-sportmonks`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SERVICE_KEY}`
            },
            body: JSON.stringify({ date: DATE })
        });

        if (!response.ok) {
            console.error(`Error: ${response.status} ${response.statusText}`);
            console.log(await response.text());
            return;
        }

        const data = await response.json();
        console.log(`Received ${data.length} fixtures`);

        if (data.length > 25) {
            console.log('✅ SUCCESS: Pagination working (Count > 25)');
            console.log('Sample IDs:', data.slice(0, 3).map(f => f.id));
        } else {
            console.warn('⚠️ WARNING: Count <= 25. Pagination might not be working or day has few matches.');
        }

    } catch (e) {
        console.error('Network Error:', e);
    }
}

verifyList();
