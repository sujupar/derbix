
// Script de Ingestión RAG Zero-Dependency (Fetch Nativo)
// Uso: export GEMINI_API_KEY="tu_key" && node ingest_rag_vectors.mjs

const SUPABASE_URL = 'https://nokejmhlpsaoerhddcyc.supabase.co';
// Anon Key pública del proyecto
const SUPABASE_KEY = '__ROTATED_KEY_LOAD_FROM_ENV__';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
    console.error("❌ ERROR: Falta variable de entorno GEMINI_API_KEY");
    console.error("Uso: export GEMINI_API_KEY='...' && node ingest_rag_vectors.mjs");
    process.exit(1);
}

// Configuración RAG
const MODEL_EMBEDDING = "models/text-embedding-004";
const CHUNK_SIZE = 1200; // Caracteres aprox por chunk

// Helper para llamadas fetch a Supabase
async function supabaseRequest(endpoint, method = 'GET', body = null) {
    const headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
    };

    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);

    const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, options);
    if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Supabase Error [${endpoint}]: ${txt}`);
    }

    if (method === 'GET') return await res.json();
    return null;
}

// Helper para Embedding Gemini
async function generateEmbedding(text) {
    const url = `https://generativelanguage.googleapis.com/v1beta/${MODEL_EMBEDDING}:embedContent?key=${GEMINI_API_KEY}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: MODEL_EMBEDDING,
            content: { parts: [{ text: text }] }
        })
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Gemini API Error: ${err}`);
    }

    const json = await res.json();
    return json.embedding.values;
}

function chunkText(text, maxChars) {
    const chunks = [];
    let current = "";
    const paragraphs = text.split(/\n+/);

    for (const p of paragraphs) {
        if ((current.length + p.length) > maxChars && current.length > 0) {
            chunks.push(current.trim());
            current = "";
        }
        current += p + "\n\n";
    }
    if (current.trim().length > 0) chunks.push(current.trim());
    return chunks;
}

async function main() {
    console.log("🚀 Iniciando Ingestión RAG (Vectorial)...");

    try {
        // 1. Obtener documentos activos
        console.log("📥 Descargando documentos de Knowledge Base...");
        const docs = await supabaseRequest('knowledge_base_v2?select=*&is_active=eq.true');
        console.log(`📚 ${docs.length} documentos encontrados.`);

        // 2. Limpiar chunks anteriores
        console.log("🧹 Limpiando vectores antiguos...");
        // FIX: Usar UUID nil valido para borrar todo (id != nil)
        await supabaseRequest('knowledge_base_chunks?id=neq.00000000-0000-0000-0000-000000000000', 'DELETE');

        // 3. Procesar
        let totalVectors = 0;

        for (const doc of docs) {
            console.log(`\n🔹 Procesando: "${doc.title}"...`);
            const chunks = chunkText(doc.content, CHUNK_SIZE);
            console.log(`   -> Generados ${chunks.length} fragmentos.`);

            for (const [i, chunk] of chunks.entries()) {
                process.stdout.write(`      Fragmento ${i + 1}/${chunks.length}: Generando embedding... `);

                try {
                    const vector = await generateEmbedding(chunk);

                    await supabaseRequest('knowledge_base_chunks', 'POST', {
                        doc_id: doc.id,
                        title: doc.title,
                        content: chunk,
                        embedding: vector
                    });

                    process.stdout.write("✅ Guardado.\n");
                    totalVectors++;

                    // Rate limit protection
                    await new Promise(r => setTimeout(r, 400));

                } catch (e) {
                    process.stdout.write(`❌ ERROR: ${e.message}\n`);
                    if (e.message.includes('429')) {
                        console.log("WAITING 5s for quota...");
                        await new Promise(r => setTimeout(r, 5000));
                    }
                }
            }
        }

        console.log(`\n✨ PROCESO COMPLETADO: ${totalVectors} vectores insertados en la base de conocimiento.`);
        console.log("✅ Ahora el Motor E puede realizar búsquedas semánticas eficientes.");

    } catch (err) {
        console.error("\n❌ Error Fatal:", err.message);
    }
}

main();
