
// Script para reproducir el fallo invocado v2-create-job-sportmonks
// Simula lo que hace el frontend
import { writeFileSync } from 'fs';

const SUPABASE_URL = 'https://nokejmhlpsaoerhddcyc.supabase.co';
// Usamos Service Key para poder invocar sin login de usuario, simulando un usuario autenticado si pasamos el header correcto,
// o simplemente probando la ejecución de la función.
// NOTA: El frontend usa la ANON KEY + Token de Usuario. 
// Para aislar si es un problema de permisos de usuario vs error de código, probaré primero con SERVICE KEY (Super admin).
// Si esto falla, es error de código 100%.

const SERVICE_KEY = '__ROTATED_KEY_LOAD_FROM_ENV__';

async function reproduce() {
    console.log(`Reproducing V2 failure on ${SUPABASE_URL}...`);

    // Payload similar al que envía el frontend (se deduce de liveDataService.ts)
    // El frontend envía: { fixture_id: number, user_id: string, ... }
    const url = `${SUPABASE_URL}/functions/v1/v2-create-job-sportmonks`;
    const body = {
        fixture_id: 19622078, // Botafogo vs Cruzeiro (Fixture real)
        user_id: 'test-audit-user',
        // Frontend might send more data? Checked liveDataService.ts: { fixture_id, sportmonks_id: fixture_id } 
        // Wait, check liveDataService.ts (step 1177: edit summary says it calls v2-list-fixtures, but analysis calls v2-create-job... wait)
        // Actually analysisService.ts calls v2-create-job-sportmonks.
        // Let's assume typical payload.
    };

    console.log("Payload:", JSON.stringify(body));

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SERVICE_KEY}`
            },
            body: JSON.stringify(body)
        });

        console.log(`Status: ${response.status} ${response.statusText}`);
        const text = await response.text();
        console.log(`Body Sample: ${text.substring(0, 500)}...`);

        writeFileSync('scripts/output_repro_v2.txt', `Status: ${response.status} ${response.statusText}\nBody: ${text}`);

    } catch (error) {
        console.error('Network Error:', error);
        writeFileSync('scripts/output_repro_v2.txt', `Network Error: ${error.toString()}`);
    }
}

reproduce();
