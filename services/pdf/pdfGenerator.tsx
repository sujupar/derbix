// services/pdf/pdfGenerator.tsx
// Public API compatibility shim — delegates to React-PDF generators in services/pdf/generators/.
// Replaces the legacy jsPDF implementation (2026-05-05). For history see git log.

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
  fixture_id: number;
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
  generated_at?: string;
  // Legacy shape support
  partido?: { local?: string; visitante?: string; liga?: string; fecha?: string; hora?: string };
}

function pickName(field: string | undefined, fallback?: string): string {
  return field ?? fallback ?? '';
}

function buildPromoPropsFromAnalysisRun(run: AnalysisRunInput): PromoMatchPDFProps {
  const rp = run.report_packet || {};
  const df = rp.data_foundation || {};
  const synth = rp.synthesizer || {};

  const homeTeam = pickName(run.home_team, run.homeTeam || run.partido?.local || 'Local');
  const awayTeam = pickName(run.away_team, run.awayTeam || run.partido?.visitante || 'Visitante');
  const league = pickName(run.league, run.partido?.liga || 'Liga');
  const matchDate = pickName(run.match_date, run.matchDate || run.partido?.fecha || '');
  const matchTime = pickName(run.match_time, run.matchTime || run.partido?.hora || '—');

  return {
    homeTeam,
    awayTeam,
    league,
    matchDate,
    matchTime,
    dataVolume: synth.total_data_volume || df.data_volume_score || 1500,
    statisticalScore: Math.round(synth.overall_confidence ?? 70),
    contextualScore: Math.round((synth.overall_confidence ?? 70) * 0.95),
    homeStreak: df.streak_home || '—',
    awayStreak: df.streak_away || '—',
    homeXG: typeof df.xg_rolling?.home_for_10 === 'number' ? df.xg_rolling.home_for_10 : 1.5,
    awayXG: typeof df.xg_rolling?.away_for_10 === 'number' ? df.xg_rolling.away_for_10 : 1.3,
    homeForm: ['Reciente 1', 'Reciente 2', 'Reciente 3', 'Reciente 4', 'Reciente 5'],
    awayForm: ['Reciente 1', 'Reciente 2', 'Reciente 3', 'Reciente 4', 'Reciente 5'],
    weatherDesc: rp.weather?.description ?? null,
    refereeName: df.referee_stats?.name ?? null,
    marketIntensities: [
      { category: 'Resultado (1X2)', intensity: 3 },
      { category: 'Goles (Over/Under)', intensity: 4 },
      { category: 'Ambos anotan (BTTS)', intensity: 3 },
      { category: 'Tarjetas', intensity: 2 },
      { category: 'Córneres', intensity: 2 },
    ],
    generatedAt: new Date(run.generated_at || Date.now()).toLocaleString('es-CO', { timeZone: 'America/Bogota' }),
    matchUrl: `https://derbix.co/match/${run.fixture_id}`,
  };
}

function buildPremiumPropsFromAnalysisRun(run: AnalysisRunInput): PremiumMatchPDFProps {
  const rp = run.report_packet || {};
  const synth = rp.synthesizer || {};
  const skeptic = rp.skeptic || {};

  const homeTeam = pickName(run.home_team, run.homeTeam || run.partido?.local || 'Local');
  const awayTeam = pickName(run.away_team, run.awayTeam || run.partido?.visitante || 'Visitante');
  const league = pickName(run.league, run.partido?.liga || 'Liga');
  const matchDate = pickName(run.match_date, run.matchDate || run.partido?.fecha || '');
  const matchTime = pickName(run.match_time, run.matchTime || run.partido?.hora || '—');

  const picks: PremiumPick[] = (synth.picks || []).map((p: any) => ({
    market: p.market,
    selection: p.selection,
    probability: Math.round(p.probability),
    odds: p.odds,
    edge_percent: p.edge_percent ?? 0,
    confidence: p.confidence ?? 'MEDIA',
    reasoning: p.reasoning ?? '',
    survived_skeptic: !!p.survived_skeptic,
  }));

  const skepticAttacks: string[] = (skeptic.attacks || [])
    .filter((a: any) => a.verdict === 'DESCARTAR')
    .map((a: any) => `${a.target_pick_market} – ${a.target_pick_selection}: ${a.attack_argument}`);

  return {
    homeTeam,
    awayTeam,
    league,
    matchDate,
    matchTime,
    dataVolume: synth.total_data_volume || 1500,
    finalVerdict: synth.summary || `${synth.veredicto || 'OBSERVAR'} — ${picks.length} picks confirmados`,
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
