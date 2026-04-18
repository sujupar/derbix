import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { callLLM } from "../_shared/llm-client.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { fixture_id } = await req.json();
    if (!fixture_id) {
      return new Response(JSON.stringify({ error: "fixture_id required" }), { status: 400, headers: corsHeaders });
    }

    console.log(`[SEO-GENERATE-ARTICLE] Generating article for fixture ${fixture_id}`);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Fetch report_packet
    const { data: report, error: reportErr } = await supabase
      .from("reports_v2")
      .select("report_packet, created_at")
      .eq("fixture_id", fixture_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (reportErr || !report?.report_packet) {
      console.error(`[SEO-GENERATE-ARTICLE] No report for fixture ${fixture_id}`);
      return new Response(
        JSON.stringify({ success: false, error: "No report data" }),
        { status: 404, headers: corsHeaders }
      );
    }

    // 2. Fetch match metadata
    const { data: match } = await supabase
      .from("daily_matches")
      .select("home_team, away_team, league_name, match_date, match_time")
      .eq("api_fixture_id", fixture_id)
      .order("match_date", { ascending: false })
      .limit(1)
      .single();

    // 3. Fetch seo_page for context
    const { data: seoPage } = await supabase
      .from("seo_pages")
      .select("home_team, away_team, league_name, match_date")
      .eq("fixture_id", fixture_id)
      .single();

    const homeTeam = match?.home_team || seoPage?.home_team || "Local";
    const awayTeam = match?.away_team || seoPage?.away_team || "Visitante";
    const leagueName = match?.league_name || seoPage?.league_name || "Liga";
    const matchDate = match?.match_date || seoPage?.match_date || "";

    const rp = report.report_packet;

    // 4. Build the prompt with ALL report data
    const prompt = buildPrompt(homeTeam, awayTeam, leagueName, matchDate, rp);

    // 5. Call LLM (multi-provider)
    const articleHtml = await generateArticle(prompt);

    if (!articleHtml || articleHtml.length < 3000) {
      console.error(`[SEO-GENERATE-ARTICLE] Article too short (${articleHtml?.length || 0} chars)`);
      return new Response(
        JSON.stringify({ success: false, error: "Article generation failed - too short" }),
        { status: 500, headers: corsHeaders }
      );
    }

    // 6. Store in seo_pages — also flip status to 'ready' so the function is
    // idempotent when invoked directly (not only from seo-publish-page or seo-retry).
    const { error: updateErr } = await supabase
      .from("seo_pages")
      .update({
        article_html: articleHtml,
        article_generated_at: new Date().toISOString(),
        article_status: "ready",
        article_last_error: null,
        article_next_retry_at: null,
      })
      .eq("fixture_id", fixture_id);

    if (updateErr) {
      console.error(`[SEO-GENERATE-ARTICLE] Failed to store article:`, updateErr);
      return new Response(
        JSON.stringify({ success: false, error: updateErr.message }),
        { status: 500, headers: corsHeaders }
      );
    }

    console.log(`[SEO-GENERATE-ARTICLE] ✅ Article generated (${articleHtml.length} chars) for ${homeTeam} vs ${awayTeam}`);

    return new Response(
      JSON.stringify({ success: true, article_length: articleHtml.length }),
      { headers: corsHeaders }
    );

  } catch (e: any) {
    console.error("[SEO-GENERATE-ARTICLE] Error:", e);
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: corsHeaders }
    );
  }
});

// ─── Prompt Builder ───

function buildPrompt(homeTeam: string, awayTeam: string, leagueName: string, matchDate: string, rp: any): string {
  // Extract all available data from report_packet
  const ap = rp.analisis_profundo || {};
  const escenarios = rp.escenarios_proyectados || {};
  const riesgos = rp.factores_riesgo || {};
  const patrones = rp.patrones_detectados || {};
  const datosModelo = rp.datos_modelo || {};
  const pronosticos = rp.pronosticos || [];
  const contextoExterno = rp.contexto_externo_resumen || "";
  const mercados = rp.mercados_evaluados || {};

  // Also check for V3 report format (resumen_ejecutivo, analisis_detallado, etc.)
  const resumen = rp.resumen_ejecutivo || {};
  const detallado = rp.analisis_detallado || {};
  const veredicto = rp.veredicto_analista || {};
  const prediccionesV3 = rp.predicciones_finales?.detalle || [];
  const advertencias = rp.advertencias || {};

  // Build data sections for the prompt
  let dataBlock = "";

  // V8.2 format (analisis_profundo)
  if (ap.razonamiento_central) {
    dataBlock += `\n## RAZONAMIENTO CENTRAL DEL ANALISIS\n${ap.razonamiento_central}\n`;
  }
  if (ap.contexto_competitivo) {
    dataBlock += `\n## CONTEXTO COMPETITIVO\n${ap.contexto_competitivo}\n`;
  }
  if (ap.matchup_tactico) {
    dataBlock += `\n## MATCHUP TACTICO\n${ap.matchup_tactico}\n`;
  }
  if (ap.factor_psicologico) {
    dataBlock += `\n## FACTOR PSICOLOGICO\n${ap.factor_psicologico}\n`;
  }

  // V3 format (resumen_ejecutivo, analisis_detallado)
  if (resumen.frase_principal) {
    dataBlock += `\n## RESUMEN EJECUTIVO\n${resumen.frase_principal}\n`;
    if (resumen.puntos_clave?.length) {
      dataBlock += resumen.puntos_clave.map((p: string) => `- ${p}`).join("\n") + "\n";
    }
  }
  if (detallado.contexto_competitivo?.bullets?.length) {
    dataBlock += `\n## CONTEXTO COMPETITIVO\n${detallado.contexto_competitivo.bullets.join("\n")}\n`;
  }
  if (detallado.estilo_y_tactica?.bullets?.length) {
    dataBlock += `\n## ESTILO Y TACTICA\n${detallado.estilo_y_tactica.bullets.join("\n")}\n`;
  }
  if (detallado.alineaciones_y_bajas?.bullets?.length) {
    dataBlock += `\n## ALINEACIONES Y BAJAS\n${detallado.alineaciones_y_bajas.bullets.join("\n")}\n`;
  }
  if (detallado.factores_situacionales?.bullets?.length) {
    dataBlock += `\n## FACTORES SITUACIONALES\n${detallado.factores_situacionales.bullets.join("\n")}\n`;
  }
  if (detallado.escenarios_de_partido?.bullets?.length) {
    dataBlock += `\n## ESCENARIOS DE PARTIDO\n${detallado.escenarios_de_partido.bullets.join("\n")}\n`;
  }
  if (detallado.analisis_tactico_formaciones?.bullets?.length) {
    dataBlock += `\n## ANALISIS TACTICO FORMACIONES\n${detallado.analisis_tactico_formaciones.bullets.join("\n")}\n`;
  }
  if (detallado.factor_psicologico) {
    dataBlock += `\n## FACTOR PSICOLOGICO\n${typeof detallado.factor_psicologico === 'string' ? detallado.factor_psicologico : JSON.stringify(detallado.factor_psicologico)}\n`;
  }

  // Scenarios
  if (escenarios.escenario_base || escenarios.escenario_optimista || escenarios.escenario_alternativo) {
    dataBlock += `\n## ESCENARIOS PROYECTADOS\n`;
    if (escenarios.escenario_base) dataBlock += `- Base: ${escenarios.escenario_base}\n`;
    if (escenarios.escenario_optimista) dataBlock += `- Optimista: ${escenarios.escenario_optimista}\n`;
    if (escenarios.escenario_alternativo) dataBlock += `- Alternativo: ${escenarios.escenario_alternativo}\n`;
  }

  // Risk factors
  if (riesgos.riesgo_principal || riesgos.nivel_incertidumbre) {
    dataBlock += `\n## FACTORES DE RIESGO\n`;
    if (riesgos.riesgo_principal) dataBlock += `- Riesgo principal: ${riesgos.riesgo_principal}\n`;
    if (riesgos.nivel_incertidumbre) dataBlock += `- Nivel incertidumbre: ${riesgos.nivel_incertidumbre}\n`;
    if (riesgos.factores_que_podrian_romper_la_estadistica) dataBlock += `- Factor disruptivo: ${riesgos.factores_que_podrian_romper_la_estadistica}\n`;
  }

  // Patterns
  if (Object.keys(patrones).length) {
    dataBlock += `\n## PATRONES ESTADISTICOS DETECTADOS\n`;
    for (const [key, val] of Object.entries(patrones)) {
      const p = val as any;
      if (p.insight) dataBlock += `- ${key}: ${p.insight}\n`;
      // Include numerical data
      for (const [k, v] of Object.entries(p)) {
        if (k !== 'insight' && typeof v !== 'object') dataBlock += `  ${k}: ${v}\n`;
      }
    }
  }

  // Model data
  if (datosModelo.goles_esperados_partido || datosModelo.corners_esperados) {
    dataBlock += `\n## DATOS DEL MODELO ESTADISTICO\n`;
    if (datosModelo.goles_esperados_partido) dataBlock += `- Goles esperados: ${datosModelo.goles_esperados_partido}\n`;
    if (datosModelo.corners_esperados) dataBlock += `- Corners esperados: ${datosModelo.corners_esperados}\n`;
    if (datosModelo.probabilidad_btts_porcentaje) dataBlock += `- Probabilidad BTTS: ${datosModelo.probabilidad_btts_porcentaje}%\n`;
  }

  // Predictions justifications (NOT the actual picks)
  const allPreds = pronosticos.length ? pronosticos : prediccionesV3;
  if (allPreds.length) {
    dataBlock += `\n## JUSTIFICACIONES DE LOS MERCADOS ANALIZADOS (${mercados.total_analizados || allPreds.length} mercados evaluados, ${mercados.con_valor_detectado || allPreds.length} con valor)\n`;
    for (const pred of allPreds) {
      const just = pred.justificacion || {};
      dataBlock += `\nMercado: ${pred.mercado || pred.market || "N/A"}\n`;
      if (just.estadistica) dataBlock += `- Base estadistica: ${just.estadistica}\n`;
      if (just.tactica) dataBlock += `- Base tactica: ${just.tactica}\n`;
      if (just.contexto_partido) dataBlock += `- Contexto: ${just.contexto_partido}\n`;
      if (just.mercado) dataBlock += `- Logica de mercado: ${just.mercado}\n`;
      if (pred.justificacion_detallada) {
        const jd = pred.justificacion_detallada;
        if (jd.base_estadistica?.length) dataBlock += `- Base estadistica: ${jd.base_estadistica.join("; ")}\n`;
        if (jd.contexto_competitivo?.length) dataBlock += `- Contexto: ${jd.contexto_competitivo.join("; ")}\n`;
        if (jd.conclusion) dataBlock += `- Conclusion: ${jd.conclusion}\n`;
      }
    }
  }

  // Warnings
  if (advertencias.bullets?.length) {
    dataBlock += `\n## ADVERTENCIAS\n${advertencias.bullets.join("\n")}\n`;
  }

  // External context
  if (contextoExterno) {
    dataBlock += `\n## CONTEXTO EXTERNO\n${contextoExterno}\n`;
  }

  // Veredicto (without revealing the actual pick)
  if (veredicto.razon_principal) {
    dataBlock += `\n## VEREDICTO DEL ANALISTA\n`;
    dataBlock += `- Razon principal: ${veredicto.razon_principal}\n`;
    if (veredicto.riesgo_principal) dataBlock += `- Riesgo principal: ${veredicto.riesgo_principal}\n`;
  }

  return `Eres el editor senior de la seccion de futbol de un diario deportivo de prestigio internacional, como Marca, AS o ESPN. Tu especialidad es el analisis previo de partidos: escribes articulos que los aficionados leen con avidez porque combinas datos duros con narrativa atrapante.

PARTIDO: ${homeTeam} vs ${awayTeam}
COMPETICION: ${leagueName}
FECHA: ${matchDate}

A continuacion tienes TODOS los datos del analisis realizado por nuestro motor de inteligencia artificial. Tu trabajo es transformar estos datos en un articulo periodistico profesional.

=== DATOS DEL ANALISIS ===${dataBlock}
=== FIN DE LOS DATOS ===

INSTRUCCIONES PARA EL ARTICULO:

1. ESTRUCTURA: Escribe el articulo usando estas secciones con etiquetas HTML exactas:
   - <h2 class="section-title">Titulo de seccion</h2> para cada seccion
   - <p> para parrafos
   - <ul class="key-points"><li> para listas de puntos clave
   - <table class="stats-table"><thead><tr><th>...</th></tr></thead><tbody><tr><td>...</td></tr></tbody></table> para datos numericos

2. SECCIONES OBLIGATORIAS (en este orden):
   a) APERTURA GANCHO (1 parrafo potente, sin titulo h2)
   b) "El Contexto: Lo Que Se Juegan" — situacion en la tabla, momento de temporada
   c) "Cara a Cara: El Duelo Tactico" — formaciones, estilo, matchups clave
   d) "Los Numeros No Mienten" — tabla HTML con estadisticas clave
   e) "Factores de Riesgo" — ausencias, variables impredecibles
   f) "El Veredicto" — parrafo de cierre que resume sin revelar la prediccion. Termina con "Para conocer nuestra prediccion exacta, registrate gratis en Derbix."

3. TONO Y ESTILO:
   - Tercera persona, periodismo neutral pero con personalidad
   - MINIMO 1000 palabras, MAXIMO 1500 palabras
   - Cada parrafo debe tener minimo 3 oraciones
   - Usa datos especificos del analisis (porcentajes, goles, rachas) tejidos en la narrativa
   - NO uses listas de bullets excepto donde el formato lo requiera (estadisticas)
   - Preguntas retoricas para generar tension: "Podra San Lorenzo reponerse de la goleada recibida?"
   - Transiciones suaves entre secciones
   - CERO emojis, CERO lenguaje coloquial excesivo

4. PROHIBIDO:
   - NO reveles la prediccion exacta (mercado, seleccion, probabilidad, cuota)
   - NO menciones "nuestro algoritmo dice X" — los datos deben parecer analisis periodistico
   - NO incluyas tags <html>, <head>, <body> — solo el contenido del articulo
   - NO incluyas imagenes ni tags <img>
   - NO inventes datos que no esten en el analisis

5. OBLIGATORIO:
   - USA todos los datos proporcionados — no dejes informacion fuera
   - Los datos numericos deben presentarse en tablas HTML con clase "stats-table"
   - Cada seccion debe fluir naturalmente hacia la siguiente
   - El articulo debe ser tan completo que el lector sienta que entiende profundamente el partido

Escribe SOLO el HTML del articulo. Nada mas.`;
}

// ─── LLM API Call (Multi-provider) ───

async function generateArticle(prompt: string): Promise<string> {
  const result = await callLLM(prompt, {
    temperature: 0.7,
    maxTokens: 4000, // Groq free tier: 8000 TPM total (input+output). 4000 leaves room for prompt.
    timeoutMs: 60000, // 60s fits comfortably within Supabase's 150s Edge Function limit.
  });

  console.log(`[SEO-GENERATE-ARTICLE] LLM provider: ${result.provider}`);

  let html = result.text
    .replace(/^```html\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  if (html.length < 3000) {
    throw new Error(`Article too short (${html.length} chars) from ${result.provider}`);
  }

  console.log(`[SEO-GENERATE-ARTICLE] ✅ ${result.provider} returned ${html.length} chars`);
  return html;
}
