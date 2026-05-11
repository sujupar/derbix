
// Script de reparación para Node.js
// Uso: node reverify_dec29.mjs

const URL = "https://nokejmhlpsaoerhddcyc.supabase.co/functions/v1/daily-results-verifier";
const ANON_KEY = "__ROTATED_KEY_LOAD_FROM_ENV__";

console.log("🚀 Iniciando reparación de datos para el 29 de Diciembre 2025...");

async function run() {
    try {
        const response = await fetch(URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${ANON_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                date: '2025-12-29'
            })
        });

        const data = await response.text();
        console.log("Status:", response.status);
        console.log("Respuesta:", data);

        if (response.ok) {
            console.log("✅ Reparación enviada con éxito.");
        } else {
            console.error("❌ Falló la reparación. Es probable que se necesite la SERVICE_ROLE_KEY.");
        }
    } catch (error) {
        console.error("❌ Error de red:", error.message);
    }
}

run();
