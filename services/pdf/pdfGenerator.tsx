// services/pdf/pdfGenerator.tsx
// Public API compatibility shim — delegates to React-PDF generators in services/pdf/generators/.
// Replaces the legacy jsPDF implementation (2026-05-05). For history see git log.
//
// Two input shapes are supported:
//   1. V9 shape:   { fixture_id, home_team, away_team, league, match_date, report_packet }
//   2. Legacy shape (report_pre_jsonb): { report_pre_jsonb: { header_partido, resumen_ejecutivo, pronosticos, ... } }

import { generatePromoMatchPDF } from './generators/generatePromoMatchPDF';
import type { PromoMatchPDFProps } from './templates/PromoMatchPDF';
import { generatePremiumMatchPDF } from './generators/generatePremiumMatchPDF';
import type { PremiumMatchPDFProps, PremiumPick } from './templates/PremiumMatchPDF';
import { generateParlayPDFNew } from './generators/generateParlayPDF';
import type { ParlayPDFProps, ParlayLeg } from './templates/ParlayPDF';

interface ReportOptions {
  fileName?: string;
  titleOverride?: string;
  isPromo?: boolean;
  onlyOpportunities?: boolean;
}

interface AnalysisRunInput {
  fixture_id?: number;
  home_team?: string;
  away_team?: string;
  homeTeam?: string;
  awayTeam?: string;
  league?: string;
  match_date?: string;
  match_time?: string;
  matchTime?: string;
  matchDate?: string;
  report_packet?: any;
  report_pre_jsonb?: any;
  generated_at?: string;
  partido?: { local?: string; visitante?: string; liga?: string; fecha?: string; hora?: string };
}

function s(...vals: Array<string | undefined | null>): string {
  for (const v of vals) {
    if (v && typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function n(...vals: Array<number | undefined | null>): number | null {
  for (const v of vals) {
    if (typeof v === 'number' && !isNaN(v)) return v;
  }
  return null;
}

interface ExtractedHeader {
  homeTeam: string;
  awayTeam: string;
  league: string;
  matchDate: string;
  matchTime: string;
  fixtureId: number;
}

function extractHeader(run: AnalysisRunInput): ExtractedHeader {
  const rp = run.report_packet || {};
  const rpre = run.report_pre_jsonb || {};
  const hp = rpre.header_partido || {};
  const df = rp.data_foundation || {};

  // Header titulo can be like "Real Madrid vs Barcelona"
  let titleHome = '';
  let titleAway = '';
  if (typeof hp.titulo === 'string' && hp.titulo.includes(' vs ')) {
    const parts = hp.titulo.split(' vs ');
    titleHome = parts[0].trim();
    titleAway = parts[1].trim();
  }

  return {
    homeTeam: s(run.home_team, run.homeTeam, df.home_team, run.partido?.local, hp.local, titleHome) || 'Local',
    awayTeam: s(run.away_team, run.awayTeam, df.away_team, run.partido?.visitante, hp.visitante, titleAway) || 'Visitante',
    league: s(run.league, df.league, run.partido?.liga, hp.liga, hp.subtitulo) || 'Liga',
    matchDate: s(run.match_date, run.matchDate, df.date, run.partido?.fecha, hp.fecha),
    matchTime: s(run.match_time, run.matchTime, df.kickoff_at, run.partido?.hora, hp.hora) || '—',
    fixtureId: n(run.fixture_id, rp.fixture_id, df.fixture_id, hp.fixture_id) || 0,
  };
}

function buildPromoPropsFromAnalysisRun(run: AnalysisRunInput): PromoMatchPDFProps {
  const rp = run.report_packet || {};
  const rpre = run.report_pre_jsonb || {};
  const df = rp.data_foundation || {};
  const synth = rp.synthesizer || {};
  const header = extractHeader(run);

  // Try V9 first, then legacy structures
  const dataVolume = n(synth.total_data_volume, df.data_volume_score, rpre.data_volume) || 1500;
  const overallConf = n(synth.overall_confidence, rpre.confianza_global, rpre.resumen_ejecutivo?.confianza) || 70;

  return {
    homeTeam: header.homeTeam,
    awayTeam: header.awayTeam,
    league: header.league,
    matchDate: header.matchDate,
    matchTime: header.matchTime,
    dataVolume,
    statisticalScore: Math.round(overallConf),
    contextualScore: Math.round(overallConf * 0.95),
    homeStreak: s(df.streak_home, rpre.forma_local) || '—',
    awayStreak: s(df.streak_away, rpre.forma_visitante) || '—',
    homeXG: n(df.xg_rolling?.home_for_10) ?? 1.5,
    awayXG: n(df.xg_rolling?.away_for_10) ?? 1.3,
    homeForm: ['Reciente 1', 'Reciente 2', 'Reciente 3', 'Reciente 4', 'Reciente 5'],
    awayForm: ['Reciente 1', 'Reciente 2', 'Reciente 3', 'Reciente 4', 'Reciente 5'],
    weatherDesc: s(rp.weather?.description, rpre.weather?.description) || null,
    refereeName: s(df.referee_stats?.name, rpre.referee?.name) || null,
    marketIntensities: [
      { category: 'Resultado (1X2)', intensity: 3 },
      { category: 'Goles (Over/Under)', intensity: 4 },
      { category: 'Ambos anotan (BTTS)', intensity: 3 },
      { category: 'Tarjetas', intensity: 2 },
      { category: 'Córneres', intensity: 2 },
    ],
    generatedAt: new Date(run.generated_at || Date.now()).toLocaleString('es-CO', { timeZone: 'America/Bogota' }),
    matchUrl: `https://derbix.co/match/${header.fixtureId || ''}`.replace(/\/$/, ''),
  };
}

function buildPremiumPropsFromAnalysisRun(run: AnalysisRunInput): PremiumMatchPDFProps {
  const rp = run.report_packet || {};
  const rpre = run.report_pre_jsonb || {};
  const synth = rp.synthesizer || {};
  const skeptic = rp.skeptic || {};
  const header = extractHeader(run);

  // V9 shape: synth.picks
  // Legacy shape: rpre.pronosticos = [{ mercado, seleccion, cuota_actual, probabilidad_calculada_porcentaje, ... }]
  let picks: PremiumPick[] = [];

  if (Array.isArray(synth.picks) && synth.picks.length > 0) {
    picks = synth.picks.map((p: any) => ({
      market: s(p.market, p.mercado) || 'Mercado',
      selection: s(p.selection, p.seleccion) || 'Selección',
      probability: Math.round(n(p.probability, p.probabilidad_calculada_porcentaje, p.probabilidad) || 0),
      odds: n(p.odds, p.cuota_actual, p.cuota) || 0,
      edge_percent: n(p.edge_percent, p.ventaja_percent, p.edge) || 0,
      confidence: (p.confidence || p.nivel_confianza || 'MEDIA') as 'ALTA' | 'MEDIA' | 'BAJA',
      reasoning: s(p.reasoning, p.justificacion, p.razonamiento) || '',
      survived_skeptic: !!p.survived_skeptic,
    }));
  } else if (Array.isArray(rpre.pronosticos) && rpre.pronosticos.length > 0) {
    picks = rpre.pronosticos.map((p: any) => ({
      market: s(p.mercado, p.market) || 'Mercado',
      selection: s(p.seleccion, p.selection) || 'Selección',
      probability: Math.round(n(p.probabilidad_calculada_porcentaje, p.probabilidad, p.probability) || 0),
      odds: n(p.cuota_actual, p.cuota, p.odds) || 0,
      edge_percent: n(p.ventaja_percent, p.edge_percent, p.edge) || 0,
      confidence: (p.nivel_confianza || p.confidence || 'MEDIA') as 'ALTA' | 'MEDIA' | 'BAJA',
      reasoning: s(p.justificacion, p.razonamiento, p.reasoning) || '',
      survived_skeptic: !!p.survived_skeptic,
    }));
  }

  // Skeptic attacks (V9) or factores_riesgo (legacy)
  let skepticAttacks: string[] = [];
  if (Array.isArray(skeptic.attacks) && skeptic.attacks.length > 0) {
    skepticAttacks = skeptic.attacks
      .filter((a: any) => a.verdict === 'DESCARTAR')
      .map((a: any) => `${a.target_pick_market} – ${a.target_pick_selection}: ${a.attack_argument}`);
  } else if (Array.isArray(rpre.factores_riesgo)) {
    skepticAttacks = rpre.factores_riesgo
      .map((r: any) => typeof r === 'string' ? r : (r?.factor || r?.descripcion || ''))
      .filter(Boolean)
      .slice(0, 6);
  }

  const dataVolume = n(synth.total_data_volume, rpre.data_volume) || 1500;
  const finalVerdict = s(
    synth.summary,
    rpre.veredicto_analista?.razonamiento,
    rpre.resumen_ejecutivo?.frase_principal,
    rpre.resumen_ejecutivo?.titular,
  ) || `${synth.veredicto || 'OBSERVAR'} — ${picks.length} picks confirmados`;

  return {
    homeTeam: header.homeTeam,
    awayTeam: header.awayTeam,
    league: header.league,
    matchDate: header.matchDate,
    matchTime: header.matchTime,
    dataVolume,
    finalVerdict,
    picks,
    skepticAttacks,
    generatedAt: new Date(run.generated_at || Date.now()).toLocaleString('es-CO', { timeZone: 'America/Bogota' }),
  };
}

export async function generateMatchAnalysisPDF(
  analysisRun: AnalysisRunInput,
  options: ReportOptions = {},
): Promise<void> {
  if (options.isPromo) {
    const props = buildPromoPropsFromAnalysisRun(analysisRun);
    await generatePromoMatchPDF(props, options.fileName);
  } else {
    const props = buildPremiumPropsFromAnalysisRun(analysisRun);
    await generatePremiumMatchPDF(props, options.fileName);
  }
}

interface ParlayInput {
  riskLevel?: 'CONSERVADOR' | 'EQUILIBRADO' | 'AGRESIVO';
  risk_level?: string;
  legs?: ParlayLeg[];
  picks?: any[];
  totalOdds?: number;
  total_odds?: number;
  combinedProbability?: number;
  combined_probability?: number;
}

function normalizeParlay(parlay: ParlayInput): ParlayPDFProps {
  const riskRaw = (parlay.riskLevel || parlay.risk_level || 'EQUILIBRADO').toUpperCase();
  const risk: ParlayPDFProps['riskLevel'] =
    riskRaw === 'CONSERVADOR' ? 'CONSERVADOR' :
    riskRaw === 'AGRESIVO' ? 'AGRESIVO' : 'EQUILIBRADO';

  const legs: ParlayLeg[] = parlay.legs ?? (parlay.picks || []).map((p: any) => ({
    match: p.match || `${p.home_team || ''} vs ${p.away_team || ''}`.trim() || '—',
    market: p.market || p.mercado || '',
    selection: p.selection || p.seleccion || '',
    odds: p.odds ?? 0,
    probability: Math.round((p.probability ?? p.p_model ?? 0) * (p.p_model && p.p_model < 1 ? 100 : 1)),
    reasoning: p.reasoning ?? p.justificacion ?? '',
  }));

  return {
    riskLevel: risk,
    legs,
    totalOdds: parlay.totalOdds ?? parlay.total_odds ?? legs.reduce((a, l) => a * (l.odds || 1), 1),
    combinedProbability: parlay.combinedProbability ?? parlay.combined_probability ?? 0,
    isPromo: false,
    generatedAt: new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' }),
  };
}

export async function generateParlayPDF(parlay: ParlayInput, options: ReportOptions = {}): Promise<void> {
  const base = normalizeParlay(parlay);
  const props: ParlayPDFProps = {
    ...base,
    isPromo: !!options.isPromo,
  };
  await generateParlayPDFNew(props, options.fileName);
}
