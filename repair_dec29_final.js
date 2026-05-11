
// Script de reparación final 29 de Dic
const URL = "https://nokejmhlpsaoerhddcyc.supabase.co/rest/v1";
const KEY = "__ROTATED_KEY_LOAD_FROM_ENV__";

function evaluatePrediction(market, selection, homeScore, awayScore) {
    const cleanOutcome = selection.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    const totalGoals = homeScore + awayScore;

    if (/(gana\s+)?(local|home)|(^1$)/i.test(cleanOutcome)) return homeScore > awayScore;
    if (/(gana\s+)?(visita|visitante|away)|(^2$)/i.test(cleanOutcome)) return awayScore > homeScore;
    if (/empate|draw|^x$/i.test(cleanOutcome)) return homeScore === awayScore;

    const ouMatch = cleanOutcome.match(/(mas|menos|over|under|\+|\-)\s*(de)?\s*(\d+(\.\d+)?)/i);
    if (ouMatch) {
        const type = ouMatch[1];
        const value = parseFloat(ouMatch[3]);
        const isOver = ['mas', 'over', '+', 'más'].some(t => type.includes(t));
        const isUnder = ['menos', 'under', '-'].some(t => type.includes(t));
        if (isOver) return totalGoals > value;
        if (isUnder) return totalGoals < value;
    }

    if (/ambos\s*anotan|btts|both\s*teams/i.test(cleanOutcome)) {
        const bothScored = homeScore > 0 && awayScore > 0;
        if (/\bno\b/i.test(cleanOutcome)) return !bothScored;
        return bothScored;
    }
    return null;
}

async function run() {
    console.log("🛠️  Iniciando corrección manual de datos (29 Dic)...");

    try {
        // 1. Obtener partidos con sus scores
        const matchesRes = await fetch(`${URL}/daily_matches?match_date=eq.2025-12-29&select=api_fixture_id,home_score,away_score`, {
            headers: { 'apikey': KEY, 'Authorization': `Bearer ${KEY}` }
        });
        const matches = await matchesRes.json();
        console.log(`✅ Partidos encontrados: ${matches.length}`);

        const scoreMap = {};
        matches.forEach(m => {
            if (m.home_score !== null) scoreMap[m.api_fixture_id] = { h: m.home_score, a: m.away_score };
        });

        // 2. Obtener predicciones para esos partidos
        const fixtureIds = Object.keys(scoreMap).join(",");
        const predRes = await fetch(`${URL}/predictions?fixture_id=in.(${fixtureIds})&select=*`, {
            headers: { 'apikey': KEY, 'Authorization': `Bearer ${KEY}` }
        });
        const predictions = await predRes.json();
        console.log(`✅ Predicciones encontradas: ${predictions.length}`);

        let corrected = 0;
        let errors = 0;

        for (const p of predictions) {
            const score = scoreMap[p.fixture_id];
            if (!score) continue;

            const isWonActual = p.is_won;
            const isWonCorrected = evaluatePrediction(p.market, p.selection, score.h, score.a);

            if (isWonCorrected !== null && isWonActual !== isWonCorrected) {
                console.log(`🔄 Corrigiendo ${p.selection}: ${isWonActual} -> ${isWonCorrected} (${score.h}-${score.a})`);

                const updateRes = await fetch(`${URL}/predictions?id=eq.${p.id}`, {
                    method: 'PATCH',
                    headers: {
                        'apikey': KEY,
                        'Authorization': `Bearer ${KEY}`,
                        'Content-Type': 'application/json',
                        'Prefer': 'return=representation'
                    },
                    body: JSON.stringify({ is_won: isWonCorrected, verified_at: new Date().toISOString() })
                });

                if (updateRes.ok) {
                    corrected++;
                } else {
                    const err = await updateRes.text();
                    console.error(`❌ Error al actualizar ${p.id}: ${err}`);
                    errors++;
                }
            }
        }

        console.log(`\n🎉 Resumen: ${corrected} corregidas, ${errors} fallidas.`);
    } catch (e) {
        console.error("❌ Fallo crítico:", e.message);
    }
}

run();
