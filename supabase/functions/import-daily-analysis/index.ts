// supabase/functions/import-daily-analysis/index.ts
// Ingesta del archivo JSON diario generado por Claude Code (skill derbix-daily-analysis).
// Sube manualmente en el panel Admin. Mapea el archivo a daily_matches / analysis_jobs_v2 /
// reports_v2 / value_picks_v2 preservando la compatibilidad con hourly-results-verifier.
//
// Deploy: npx supabase functions deploy import-daily-analysis   (CON verify-jwt — solo admin)
//
// Contrato:  POST { payload: <archivo>, dryRun?: boolean, overwrite?: boolean }
// Respuesta: { ok, dryRun, counts, warnings, errors, preview }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { requirePlatformAdmin, authErrorResponse } from "../_shared/auth-guard.ts";
import { checkProbOddsCoherence } from "../_shared/odds-selector.ts";

const ENGINE_FALLBACK = "COWORK-V1";
// Modo "valor" (Opción B, 2026-07-22): la cuota publicable debe ser >= 1.40 (piso de
// display + ROI de la plataforma) y la probabilidad de oportunidad baja a 0.72, para
// que salgan picks que paguen más (ej. 72-80% @ cuota 1.40-1.85) en vez de favoritos
// de cuota < 1.40 que la plataforma oculta.
const MIN_ODDS = 1.40;
const MAX_ODDS = 4.50;
const OPP_THRESHOLD = 0.72;
const MAX_OPPORTUNITY_RANK = 20;

// Vocabulario EXACTO de mercados permitidos (sportmonks-normalizer MARKET_DICT).
const ALLOWED_MARKETS = new Set([
  // MAIN
  "Resultado 1X2", "Empate No Acción", "Doble Oportunidad",
  // GOALS
  "Más/Menos Goles", "Ambos Anotan",
  // TEAMS
  "Asian Handicap", "Total Goles Local", "Total Goles Equipo",
  // HALVES
  "Resultado al Descanso", "Resultado 1er Tiempo", "Resultado 2do Tiempo", "Más/Menos Goles 1T",
  // CORNERS
  "Más/Menos Esquinas", "Asian Handicap Esquinas",
  // COMBOS
  "Half Time / Full Time", "Resultado y Ambos Anotan", "Resultado y Total Goles", "Total Goles + BTTS",
  // OTHERS
  "Marcador Exacto", "Total Tarjetas",
]);

interface PickIn {
  market: string; selection: string;
  p_model: number; p_implied?: number; odds?: number; odds_source?: string;
  edge?: number; confidence: number; confidence_label?: string;
  decision?: string; is_opportunity?: boolean; is_primary_pick?: boolean;
  rank?: number; reasoning?: string; bookmaker?: string; kelly_stake_pct?: number;
}
interface MatchIn {
  fixture_id: number; league_id?: number | null; league_name?: string;
  match_date: string; scan_date?: string; kickoff_utc: string;
  home_team: string; away_team: string;
  home_team_logo?: string | null; away_team_logo?: string | null;
  home_team_id?: number; away_team_id?: number; season_id?: number;
  match_status?: string; research?: any; math_baseline?: any;
  picks: PickIn[];
}
interface FileIn {
  meta: {
    schema_version?: string; method_version?: string; engine_version?: string;
    prompt_version?: string; target_date: string; generated_at_utc?: string;
    leagues_included?: number[]; total_matches?: number; total_picks?: number;
  };
  matches: MatchIn[];
}

function bogotaToday(): string {
  return new Date().toLocaleString("en-CA", {
    timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit",
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // ── Auth: solo admin de plataforma ──────────────────────────────────────
  const auth = await requirePlatformAdmin(req);
  if (!auth.ok) return authErrorResponse(auth, corsHeaders);

  let body: { payload?: FileIn; dryRun?: boolean; overwrite?: boolean };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid json body" }, 400);
  }

  const file = body.payload;
  const dryRun = body.dryRun !== false; // SEGURO por defecto: solo escribe si dryRun===false explícito
  const overwrite = body.overwrite === true;

  if (!file?.meta || !Array.isArray(file.matches)) {
    return json({ ok: false, error: "payload debe tener { meta, matches[] }" }, 400);
  }

  const warnings: string[] = [];
  const errors: string[] = [];
  const engineVersion = file.meta.engine_version || file.meta.method_version || ENGINE_FALLBACK;
  const promptVersion = file.meta.prompt_version || engineVersion;
  const targetDate = file.meta.target_date;

  // ── Validación de meta ──────────────────────────────────────────────────
  if (!targetDate || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    return json({ ok: false, error: "meta.target_date inválido (YYYY-MM-DD)" }, 400);
  }
  if (!overwrite && targetDate < bogotaToday()) {
    return json({ ok: false, error: `target_date ${targetDate} ya pasó (hoy Bogotá ${bogotaToday()}). Usa overwrite:true para forzar.` }, 400);
  }

  // ── Validación + re-ejecución de gates (defensa en profundidad) ─────────
  const acceptedByFixture = new Map<number, { match: MatchIn; picks: PickIn[] }>();
  let rejectedPicks = 0;

  for (const m of file.matches) {
    const mErrors: string[] = [];
    if (typeof m.fixture_id !== "number") mErrors.push("fixture_id ausente/no numérico");
    if (!m.home_team || !m.away_team) mErrors.push("home_team/away_team ausente");
    if (!m.kickoff_utc) mErrors.push("kickoff_utc ausente");
    if (m.match_date !== targetDate) mErrors.push(`match_date ${m.match_date} != target_date ${targetDate}`);
    if (mErrors.length) {
      errors.push(`Partido ${m.home_team ?? "?"} vs ${m.away_team ?? "?"} (fixture ${m.fixture_id ?? "?"}): ${mErrors.join("; ")} — omitido`);
      continue;
    }

    const goodPicks: PickIn[] = [];
    for (const p of m.picks || []) {
      const tag = `${m.home_team} vs ${m.away_team} · ${p.market}/${p.selection}`;
      if (!ALLOWED_MARKETS.has((p.market || "").trim())) {
        warnings.push(`RECHAZADO ${tag}: mercado fuera del catálogo permitido`); rejectedPicks++; continue;
      }
      if (!p.selection || typeof p.p_model !== "number" || p.p_model <= 0 || p.p_model > 1) {
        warnings.push(`RECHAZADO ${tag}: selection/p_model inválido`); rejectedPicks++; continue;
      }
      const odds = typeof p.odds === "number" ? p.odds : NaN;
      if (!isFinite(odds) || odds < MIN_ODDS || odds > MAX_ODDS) {
        warnings.push(`RECHAZADO ${tag}: cuota ${p.odds} fuera de [${MIN_ODDS}, ${MAX_ODDS}]`); rejectedPicks++; continue;
      }
      if (p.odds_source && p.odds_source !== "real") {
        warnings.push(`RECHAZADO ${tag}: odds_source='${p.odds_source}' (solo 'real' para oportunidades)`); rejectedPicks++; continue;
      }
      const coh = checkProbOddsCoherence(p.p_model, odds);
      if (!coh.coherent) {
        warnings.push(`RECHAZADO ${tag}: incoherencia prob/cuota (${coh.reason})`); rejectedPicks++; continue;
      }
      goodPicks.push(p);
    }

    if (goodPicks.length > 0) acceptedByFixture.set(m.fixture_id, { match: m, picks: goodPicks });
    else warnings.push(`Partido ${m.home_team} vs ${m.away_team}: sin picks válidos tras gates`);
  }

  const acceptedPicks = [...acceptedByFixture.values()].reduce((n, x) => n + x.picks.length, 0);
  const preview = {
    target_date: targetDate,
    engine_version: engineVersion,
    matches_in_file: file.matches.length,
    matches_accepted: acceptedByFixture.size,
    picks_accepted: acceptedPicks,
    picks_rejected: rejectedPicks,
  };

  // ── Dry run: validar y devolver preview sin escribir ────────────────────
  if (dryRun) {
    return json({ ok: true, dryRun: true, counts: preview, warnings, errors, preview });
  }

  // ── Escritura ───────────────────────────────────────────────────────────
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let matchesWritten = 0, picksInserted = 0, fixturesSkipped = 0;

  for (const { match: m, picks } of acceptedByFixture.values()) {
    try {
      // 1) daily_matches — NO pisar marcador/estado si el verificador ya escribió.
      const { data: existing } = await supabase
        .from("daily_matches")
        .select("id, match_status, home_score, away_score")
        .eq("api_fixture_id", m.fixture_id)
        .eq("match_date", targetDate)
        .maybeSingle();

      const identity = {
        scan_date: m.scan_date || bogotaToday(),
        match_date: targetDate,
        api_fixture_id: m.fixture_id,
        league_id: null, // FK a allowed_leagues con IDs distintos → siempre NULL (ver CLAUDE.md)
        league_name: m.league_name ?? null,
        home_team: m.home_team,
        away_team: m.away_team,
        home_team_logo: m.home_team_logo ?? null,
        away_team_logo: m.away_team_logo ?? null,
        match_time: m.kickoff_utc,
        is_analyzed: true,
      };

      if (existing) {
        // Actualiza solo identidad/logos; preserva score/status del verificador.
        await supabase.from("daily_matches").update(identity).eq("id", existing.id);
      } else {
        await supabase.from("daily_matches").insert({ ...identity, match_status: "NS" });
      }
      matchesWritten++;

      // Si ya hay picks verificados y NO es overwrite, no re-importar este partido.
      if (!overwrite) {
        const { count: verifiedCount } = await supabase
          .from("value_picks_v2")
          .select("id", { count: "exact", head: true })
          .eq("fixture_id", m.fixture_id)
          .eq("engine_version", engineVersion)
          .neq("result", "PENDING");
        if ((verifiedCount ?? 0) > 0) {
          fixturesSkipped++;
          warnings.push(`Partido ${m.home_team} vs ${m.away_team}: ya tiene picks verificados; omitido (usa overwrite:true para reemplazar).`);
          continue;
        }
      }

      // 2) analysis_jobs_v2 — raíz FK
      const { data: job, error: jobErr } = await supabase
        .from("analysis_jobs_v2")
        .insert({ fixture_id: m.fixture_id, status: "done", engine_version: engineVersion })
        .select("id")
        .single();
      if (jobErr || !job) { errors.push(`fixture ${m.fixture_id}: job insert falló: ${jobErr?.message}`); continue; }
      const jobId = job.id;

      // 3) reports_v2 — delete-then-insert por (fixture_id, engine_version)
      const reportPacket = buildReportPacket(m, picks, engineVersion);
      await supabase.from("reports_v2").delete().eq("fixture_id", m.fixture_id).eq("engine_version", engineVersion);
      await supabase.from("reports_v2").insert({
        job_id: jobId, fixture_id: m.fixture_id,
        prompt_version: promptVersion, engine_version: engineVersion,
        report_packet: reportPacket, math_models_used: m.math_baseline ?? null,
      });

      // 4) value_picks_v2 — delete-then-insert por (fixture_id, engine_version)
      await supabase.from("value_picks_v2").delete().eq("fixture_id", m.fixture_id).eq("engine_version", engineVersion);
      const rows = picks.map((p, idx) => ({
        job_id: jobId,
        fixture_id: m.fixture_id,
        market: p.market.trim(),
        selection: p.selection,
        p_model: p.p_model,
        p_implied: typeof p.p_implied === "number" ? p.p_implied : Number((1 / Math.max(p.odds!, 1.01)).toFixed(4)),
        odds: p.odds,
        edge: typeof p.edge === "number" ? p.edge : Number(((p.p_model - 1 / Math.max(p.odds!, 1.01))).toFixed(4)),
        decision: "BET",
        confidence: clampInt(p.confidence, 0, 100),
        engine_version: engineVersion,
        risk_notes: p.reasoning ?? "",
        is_primary_pick: p.is_primary_pick ?? idx === 0,
        rank: p.rank ?? idx + 1,
        is_opportunity: p.p_model >= OPP_THRESHOLD,
        opportunity_date: targetDate,
        opportunity_rank: null, // asignado globalmente abajo
        odds_source: "real",
        result: "PENDING",
      }));
      const { error: vpErr, data: vpData } = await supabase.from("value_picks_v2").insert(rows).select("id");
      if (vpErr) errors.push(`fixture ${m.fixture_id}: value_picks insert falló: ${vpErr.message}`);
      else picksInserted += vpData?.length ?? 0;
    } catch (e) {
      errors.push(`fixture ${m.fixture_id}: ${(e as Error).message}`);
    }
  }

  // 5) opportunity_rank global (surgical, equivalente a v2-generate-parlays Step 5.5)
  let ranked = 0;
  try {
    const { data: opps } = await supabase
      .from("value_picks_v2")
      .select("id, p_model, edge")
      .eq("opportunity_date", targetDate)
      .eq("is_opportunity", true)
      .order("p_model", { ascending: false })
      .order("edge", { ascending: false })
      .limit(MAX_OPPORTUNITY_RANK);
    if (opps) {
      for (let i = 0; i < opps.length; i++) {
        await supabase.from("value_picks_v2").update({ opportunity_rank: i + 1 }).eq("id", opps[i].id);
      }
      ranked = opps.length;
    }
  } catch (e) {
    warnings.push(`Ranking global falló (no crítico): ${(e as Error).message}`);
  }

  return json({
    ok: errors.length === 0,
    dryRun: false,
    counts: {
      ...preview,
      matches_written: matchesWritten,
      picks_inserted: picksInserted,
      fixtures_skipped: fixturesSkipped,
      opportunities_ranked: ranked,
    },
    warnings,
    errors,
  });
});

// ── Helpers ────────────────────────────────────────────────────────────────

function clampInt(n: number, lo: number, hi: number): number {
  const v = Math.round(Number(n));
  return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : lo;
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Construye un report_packet que AnalysisReportModal (adaptV3ToFrontend) sabe leer.
function buildReportPacket(m: MatchIn, picks: PickIn[], engineVersion: string): any {
  const topPick = picks[0];
  return {
    engine_version: engineVersion,
    meta: { engine: engineVersion, fixture_id: `${m.home_team} vs ${m.away_team}` },
    header_partido: {
      titulo: `${m.home_team} vs ${m.away_team}`,
      subtitulo: `${m.league_name ?? ""} · ${m.match_date}`,
      fecha: m.match_date,
      liga: m.league_name ?? "",
    },
    resumen_ejecutivo: {
      titular: `${m.home_team} vs ${m.away_team}`,
      frase_principal: topPick?.reasoning || `Análisis de ${m.home_team} vs ${m.away_team}.`,
      confianza: topPick && topPick.confidence >= 80 ? "ALTA" : topPick && topPick.confidence >= 65 ? "MEDIA" : "BAJA",
    },
    research: m.research ?? null,
    math_models_used: m.math_baseline ?? null,
    pronosticos: picks.map((p) => ({
      mercado: p.market,
      seleccion: p.selection,
      probabilidad_calculada_porcentaje: Math.round(p.p_model * 100),
      cuota_actual: p.odds,
      edge_porcentaje: typeof p.edge === "number" ? Math.round(p.edge * 100) : undefined,
      nivel_confianza: p.confidence_label || (p.confidence >= 80 ? "ALTA" : p.confidence >= 65 ? "MEDIA" : "BAJA"),
      decision: "BET",
      razonamiento: p.reasoning,
    })),
    predicciones_finales: {
      detalle: picks.map((p) => ({
        mercado: p.market,
        seleccion: p.selection,
        probabilidad_estimado_porcentaje: Math.round(p.p_model * 100),
        cuota_actual: p.odds,
        decision: "BET",
        nivel_confianza: p.confidence_label || "MEDIA",
        justificacion_detallada: p.reasoning,
      })),
    },
  };
}
