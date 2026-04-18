import { getSupabaseClient } from "./_shared/supabase-client.ts";
import {
  renderPage,
  renderNav,
  renderBreadcrumbs,
  renderFooter,
  renderCTA,
  escapeHtml,
  type PageMeta,
} from "./_shared/html-template.ts";
import {
  generateSportsEventSchema,
  generateFAQSchema,
  generateBreadcrumbSchema,
} from "./_shared/schema-org.ts";
import {
  bulletsToNarrative,
  estimateReadingTime,
  timeAgo,
  renderAdSlot,
} from "./_shared/content-formatter.ts";

const SITE_URL = "https://derbix.co";

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);

  if (pathParts.length < 3 || pathParts[0] !== "predicciones") {
    return new Response("Not Found", { status: 404 });
  }

  const leagueSlug = pathParts[1];
  const matchSlug = pathParts[2];

  try {
    const supabase = getSupabaseClient();

    const { data: page, error: pageErr } = await supabase
      .from("seo_pages")
      .select("*")
      .eq("league_slug", leagueSlug)
      .eq("match_slug", matchSlug)
      .single();

    if (pageErr || !page) {
      return render404(leagueSlug);
    }

    const { data: report } = await supabase
      .from("reports_v2")
      .select("report_packet, created_at")
      .eq("fixture_id", page.fixture_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    const { data: picks } = await supabase
      .from("value_picks_v2")
      .select("market, selection, p_model, odds, edge, decision, confidence, result, is_opportunity")
      .eq("fixture_id", page.fixture_id)
      .order("p_model", { ascending: false });

    const { data: relatedLeague } = await supabase
      .from("seo_pages")
      .select("full_path, home_team, away_team, match_date, has_results, result_correct")
      .eq("league_slug", leagueSlug)
      .neq("fixture_id", page.fixture_id)
      .order("match_date", { ascending: false })
      .limit(6);

    const { data: relatedTeam } = await supabase
      .from("seo_pages")
      .select("full_path, home_team, away_team, match_date, league_name, has_results, result_correct")
      .or(`home_team_slug.eq.${page.home_team_slug},away_team_slug.eq.${page.home_team_slug}`)
      .neq("fixture_id", page.fixture_id)
      .order("match_date", { ascending: false })
      .limit(6);

    const rp = report?.report_packet;

    const bodyHtml = buildArticle(page, {
      resumen: rp?.resumen_ejecutivo,
      detallado: rp?.analisis_detallado,
      veredicto: rp?.veredicto_analista,
      predicciones: rp?.predicciones_finales?.detalle || [],
      advertencias: rp?.advertencias,
      picks: picks || [],
      relatedLeague: relatedLeague || [],
      relatedTeam: relatedTeam || [],
      reportCreatedAt: report?.created_at,
    });

    const sportsEventSchema = generateSportsEventSchema({
      homeTeam: page.home_team,
      awayTeam: page.away_team,
      leagueName: page.league_name,
      matchDate: page.match_date,
      matchTime: page.match_time,
      homeLogo: page.home_logo,
      awayLogo: page.away_logo,
      homeScore: page.home_score,
      awayScore: page.away_score,
      hasResults: page.has_results,
      url: `${SITE_URL}${page.full_path}`,
    });

    const faqSchema = generateFAQSchema(page.home_team, page.away_team, page.league_name, !!report);
    const breadcrumbSchema = generateBreadcrumbSchema([
      { name: "Inicio", url: SITE_URL },
      { name: "Predicciones", url: `${SITE_URL}/predicciones` },
      { name: page.league_name, url: `${SITE_URL}/predicciones/${leagueSlug}` },
      { name: `${page.home_team} vs ${page.away_team}`, url: `${SITE_URL}${page.full_path}` },
    ]);

    const meta: PageMeta = {
      title: page.meta_title,
      description: page.meta_description,
      canonicalUrl: `${SITE_URL}${page.full_path}`,
      schemas: [sportsEventSchema, faqSchema, breadcrumbSchema],
    };

    return new Response(renderPage(meta, bodyHtml), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch (err) {
    console.error("[seo-prediccion] Error:", err);
    return new Response("Internal Server Error", { status: 500 });
  }
}

// ─── Editorial Article Builder ───

interface ArticleData {
  resumen: any;
  detallado: any;
  veredicto: any;
  predicciones: any[];
  advertencias: any;
  picks: any[];
  relatedLeague: any[];
  relatedTeam: any[];
  reportCreatedAt?: string;
}

function buildArticle(page: any, data: ArticleData): string {
  const { resumen, detallado, veredicto, predicciones, advertencias, picks, relatedLeague, relatedTeam, reportCreatedAt } = data;

  const [year, month, day] = (page.match_date || "").split("-");
  const formattedDate = day && month && year ? `${day}/${month}/${year}` : page.match_date;

  // Estimate reading time from all text content
  const allText = [
    resumen?.frase_principal,
    ...(resumen?.puntos_clave || []),
    ...(detallado?.contexto_competitivo?.bullets || []),
    ...(detallado?.estilo_y_tactica?.bullets || []),
    ...(detallado?.factores_situacionales?.bullets || []),
  ].filter(Boolean).join(" ");
  const readTime = estimateReadingTime(allText);
  const updatedAgo = reportCreatedAt ? timeAgo(reportCreatedAt) : "";

  let html = renderNav();

  // ─── Article container ───
  html += `<div class="article">`;

  // Breadcrumbs
  html += renderBreadcrumbs([
    { label: "Inicio", href: "/" },
    { label: "Predicciones", href: "/predicciones" },
    { label: page.league_name, href: `/predicciones/${page.league_slug}` },
    { label: `${page.home_team} vs ${page.away_team}` },
  ]);

  // Category badges
  html += `
  <div class="category-bar">
    <span class="cat-badge cat-analysis">Analisis</span>
    <span class="cat-badge cat-league">${escapeHtml(page.league_name)}</span>
    <span class="cat-date">${formattedDate}</span>
  </div>`;

  // H1 — Editorial serif title
  html += `<h1 class="article-title">${escapeHtml(page.home_team)} vs ${escapeHtml(page.away_team)}: Analisis Completo y Pronostico</h1>`;

  // Byline
  html += `
  <div class="byline">
    <span>Por <strong>Derbix AI Engine</strong></span>
    ${updatedAgo ? `<span class="byline-dot"></span><span>Actualizado ${updatedAgo}</span>` : ""}
    <span class="byline-dot"></span>
    <span>${readTime} min lectura</span>
  </div>`;

  // Hero match card
  html += `
  <div class="hero-match">
    <div class="hero-teams">
      <div class="hero-team">
        ${page.home_logo ? `<img src="${page.home_logo}" alt="${escapeHtml(page.home_team)}">` : ""}
        <span class="hero-team-name">${escapeHtml(page.home_team)}</span>
      </div>
      <span class="hero-vs">vs</span>
      <div class="hero-team">
        ${page.away_logo ? `<img src="${page.away_logo}" alt="${escapeHtml(page.away_team)}">` : ""}
        <span class="hero-team-name">${escapeHtml(page.away_team)}</span>
      </div>
    </div>
    <div class="hero-info">
      <span class="hero-badge">${escapeHtml(page.league_name)}</span>
      <span class="hero-badge">${formattedDate}</span>
      ${page.match_time ? `<span class="hero-badge">${page.match_time.split(" ")[1]?.substring(0, 5) || page.match_time}</span>` : ""}
      ${veredicto?.nivel_confianza ? `<span class="hero-badge hero-confidence">${escapeHtml(veredicto.nivel_confianza)} confianza</span>` : ""}
    </div>
  </div>`;

  // Result banner (if match finished)
  if (page.has_results && page.home_score != null && page.away_score != null) {
    const cls = page.result_correct ? "result-won" : "result-lost";
    const tagCls = page.result_correct ? "result-tag-won" : "result-tag-lost";
    const tagText = page.result_correct ? "&#10003; Prediccion Acertada" : "&#10007; Prediccion Fallada";
    html += `
    <div class="result-banner ${cls}">
      <div>
        <span class="result-score">${page.home_score} - ${page.away_score}</span>
        <span class="result-label">Resultado Final</span>
      </div>
      <span class="result-tag ${tagCls}">${tagText}</span>
    </div>`;
  }

  // ─── ARTICLE CONTENT ───
  if (page.article_html) {
    // LLM-generated editorial article — render directly
    html += page.article_html;
    html += renderAdSlot(1);
  } else if (page.article_status === "generating" || page.article_status === "pending") {
    // Article is queued / currently being generated by the retry cron.
    // We still fall through to the structured-data fallback so the page is not empty.
    html += `<p class="article-pending">Nuestro análisis editorial se está generando en este momento. Vuelve en unos minutos para leer el artículo completo. Mientras tanto, puedes consultar los datos del partido más abajo.</p>`;
  }

  if (!page.article_html) {
    // Fallback: bullet-to-narrative formatter (for pages without article_html)
    if (resumen) {
      html += `<h2 class="section-title">Resumen del Partido</h2>`;
      if (resumen.frase_principal) {
        html += `<p><strong>${escapeHtml(resumen.frase_principal)}</strong></p>`;
      }
      if (resumen.puntos_clave?.length) {
        html += bulletsToNarrative(resumen.puntos_clave);
      }
    }
    html += renderAdSlot(1);
    if (detallado?.contexto_competitivo?.bullets?.length) {
      html += `<h2 class="section-title">Contexto de la Temporada</h2>`;
      html += bulletsToNarrative(detallado.contexto_competitivo.bullets);
    }
    if (detallado?.estilo_y_tactica?.bullets?.length) {
      html += `<h2 class="section-title">Analisis Tactico</h2>`;
      html += bulletsToNarrative(detallado.estilo_y_tactica.bullets);
    }
    if (detallado?.alineaciones_y_bajas?.bullets?.length) {
      html += `<h2 class="section-title">Alineaciones y Bajas</h2>`;
      html += bulletsToNarrative(detallado.alineaciones_y_bajas.bullets);
    }
    html += renderAdSlot(2);
    const hasFactors = detallado?.factores_situacionales?.bullets?.length ||
                       detallado?.escenarios_de_partido?.bullets?.length ||
                       advertencias?.bullets?.length;
    if (hasFactors) {
      html += `<h2 class="section-title">Factores Decisivos</h2>`;
      if (detallado?.factores_situacionales?.bullets?.length) html += bulletsToNarrative(detallado.factores_situacionales.bullets);
      if (detallado?.escenarios_de_partido?.bullets?.length) html += bulletsToNarrative(detallado.escenarios_de_partido.bullets);
      if (advertencias?.bullets?.length) {
        html += `<ul class="key-points">${advertencias.bullets.map((b: string) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>`;
      }
    }
  }

  // ─── Section: Prediccion (PREMIUM — blurred) ───
  html += `<h2 class="section-title">Prediccion y Apuestas Recomendadas</h2>`;
  html += `
  <div class="premium-section">
    <div class="premium-blur" aria-hidden="true">`;

  if (veredicto) {
    html += `<div style="padding:1rem;background:#f8fafc;border-radius:0.5rem;margin-bottom:1rem;">
      <p style="font-size:1.25rem;font-weight:800;">${escapeHtml(veredicto.decision || "APOSTAR")}</p>
      <p>${escapeHtml(veredicto.seleccion_clave || "Ver prediccion completa")}</p>
      <p style="font-size:0.875rem;color:#6b7280;">Probabilidad: ${veredicto.probabilidad || 0}%</p>
    </div>`;
  }
  if (predicciones.length) {
    html += `<table style="width:100%;"><tbody>`;
    for (const pred of predicciones.slice(0, 4)) {
      html += `<tr><td style="padding:0.5rem;">${escapeHtml(pred.mercado || "")}</td><td>${escapeHtml(pred.seleccion || "")}</td><td>${pred.probabilidad_estimado_porcentaje || 0}%</td><td>${pred.odds ? `@${pred.odds}` : ""}</td></tr>`;
    }
    html += `</tbody></table>`;
  }

  html += `</div>
    <div class="premium-overlay">
      <div class="premium-lock">&#128274;</div>
      <div class="premium-title">Desbloquea la Prediccion Completa</div>
      <p class="premium-sub">Accede a probabilidades exactas, picks de valor y el analisis profundo completo. 1 pronostico gratis al dia, para siempre.</p>
      <a href="/signup" class="premium-btn">Crear Cuenta Gratis</a>
      <p class="premium-login">Ya tienes cuenta? <a href="/login">Inicia sesion</a></p>
    </div>
  </div>`;

  // ═══ ADSENSE #3 ═══
  html += renderAdSlot(3);

  // CTA
  html += renderCTA(
    "Pronosticos con IA para 40+ Ligas",
    "Nuestro algoritmo analiza mas de 5,000 variables por partido. Track record 100% verificable.",
    "Ver Planes",
    "/pricing"
  );

  // ─── Related Content ───
  if (relatedLeague?.length) {
    html += `<div class="related-section">
      <div class="related-title">Otros Partidos de ${escapeHtml(page.league_name)}</div>
      <div class="related-grid">`;
    for (const r of relatedLeague) {
      const badge = r.has_results
        ? r.result_correct ? `<span class="related-won">&#10003;</span>` : `<span class="related-lost">&#10007;</span>`
        : "";
      html += `<a href="${r.full_path}" class="related-card">
        <span>${escapeHtml(r.home_team)} vs ${escapeHtml(r.away_team)}</span>
        <span class="related-meta"><span>${r.match_date}</span>${badge}</span>
      </a>`;
    }
    html += `</div></div>`;
  }

  if (relatedTeam?.length) {
    html += `<div class="related-section">
      <div class="related-title">Ultimos Pronosticos de ${escapeHtml(page.home_team)}</div>
      <div class="related-grid">`;
    for (const r of relatedTeam) {
      const badge = r.has_results
        ? r.result_correct ? `<span class="related-won">&#10003;</span>` : `<span class="related-lost">&#10007;</span>`
        : "";
      html += `<a href="${r.full_path}" class="related-card">
        <span>${escapeHtml(r.home_team)} vs ${escapeHtml(r.away_team)}</span>
        <span class="related-meta"><span>${escapeHtml(r.league_name || "")}</span>${badge}</span>
      </a>`;
    }
    html += `</div></div>`;
  }

  html += `</div>`; // close .article
  html += renderFooter();

  return html;
}

// ─── 404 ───

function render404(leagueSlug: string): Response {
  const meta: PageMeta = {
    title: "Pronostico no encontrado — Derbix",
    description: "La pagina de pronostico que buscas no existe o aun no ha sido generada.",
    canonicalUrl: `${SITE_URL}/predicciones`,
  };

  const body = `
  ${renderNav()}
  <div class="article" style="padding-top:4rem;padding-bottom:4rem;text-align:center;">
    <h1 class="article-title">Pronostico No Encontrado</h1>
    <p style="color:#6b7280;margin-bottom:2rem;">Este pronostico aun no ha sido generado o la URL es incorrecta.</p>
    <div style="display:flex;gap:0.75rem;justify-content:center;">
      <a href="/predicciones/${leagueSlug}" class="premium-btn" style="background:#6b7280;">Ver liga</a>
      <a href="/predicciones" class="premium-btn">Ver todos los pronosticos</a>
    </div>
  </div>
  ${renderFooter()}`;

  return new Response(renderPage(meta, body), {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export const config = { path: "/predicciones/*/*" };
