// _shared/agents/orchestrator.ts
// Runs the multi-agent debate sequentially (respecting Groq TPM limits).

import JSON5 from "https://esm.sh/json5@2.2.3";
import { callLLM, calcGroqDelay } from '../llm-client.ts';
import { AGENTS, DEBATE_AGENTS } from './configs.ts';
import type { MatchContext, AgentAnalysis, DebateResult, AgentConfig } from './types.ts';

/**
 * Build the user prompt for a specific agent using the match context.
 */
function buildAgentPrompt(agentKey: string, context: MatchContext): string {
  const m = context.math;

  const mathSummary = `
DATOS MATEMÁTICOS BASE (modelos Dixon-Coles + Elo + Monte Carlo):
- λ Local: ${m.dixon_coles.lambdaHome} goles esperados | λ Visitante: ${m.dixon_coles.lambdaAway}
- Elo: Local ${m.elo.homeElo} | Visitante ${m.elo.awayElo} (confianza ${m.elo.confidence})
- Probabilidades ensemble (modelos): 1=${(m.ensemble_probabilities.home_win*100).toFixed(1)}% | X=${(m.ensemble_probabilities.draw*100).toFixed(1)}% | 2=${(m.ensemble_probabilities.away_win*100).toFixed(1)}%
- Over 2.5: ${(m.ensemble_probabilities.over_25*100).toFixed(1)}% | BTTS Sí: ${(m.ensemble_probabilities.btts_yes*100).toFixed(1)}%
- Top scorelines Monte Carlo: ${m.monte_carlo.market_probabilities.top_scorelines.map(s => `${s.score} (${(s.probability*100).toFixed(0)}%)`).join(', ')}
- Consistencia modelos: ${m.diagnostics.model_consistency} (0-1)
`;

  const baseContext = `
PARTIDO: ${context.homeTeam} vs ${context.awayTeam}
COMPETICIÓN: ${context.league}
FECHA: ${context.date}

${mathSummary}
`;

  // Different agents need different data focus
  let specificContext = '';

  switch (agentKey) {
    case 'OFFENSIVE':
      specificContext = `
HISTORIAL OFENSIVO:
${context.homeHistory.substring(0, 2500)}
${context.awayHistory.substring(0, 2500)}

${context.xg ? `xG ROLLING últimos 10:
- ${context.homeTeam}: ${context.xg.home.for}xG, overperf ${context.xg.home.overperf >= 0 ? '+' : ''}${context.xg.home.overperf}
- ${context.awayTeam}: ${context.xg.away.for}xG, overperf ${context.xg.away.overperf >= 0 ? '+' : ''}${context.xg.away.overperf}
` : ''}

${context.key_players?.home_missing.length ? `AUSENCIAS OFENSIVAS (${context.homeTeam}): ${context.key_players.home_missing.join(', ')}` : ''}
${context.key_players?.away_missing.length ? `AUSENCIAS OFENSIVAS (${context.awayTeam}): ${context.key_players.away_missing.join(', ')}` : ''}
`;
      break;

    case 'DEFENSIVE':
      specificContext = `
HISTORIAL DEFENSIVO:
${context.homeHistory.substring(0, 2500)}
${context.awayHistory.substring(0, 2500)}

${context.xg ? `xGA ROLLING últimos 10:
- ${context.homeTeam}: ${context.xg.home.against} xGA
- ${context.awayTeam}: ${context.xg.away.against} xGA
` : ''}
`;
      break;

    case 'TACTICAL':
      specificContext = `
FORMACIONES Y ESTILO:
${context.lineups ? `
Alineaciones confirmadas:
- ${context.homeTeam} (${context.lineups.home.formation || '?'}): ${context.lineups.home.starters.slice(0,11).join(', ')}
- ${context.awayTeam} (${context.lineups.away.formation || '?'}): ${context.lineups.away.starters.slice(0,11).join(', ')}
` : 'Alineaciones no confirmadas, asume formaciones más comunes recientes.'}

${context.coaches ? `
Entrenadores:
- ${context.homeTeam}: ${context.coaches.home.name}${context.coaches.home.is_new ? ' (NUEVO DT — luna de miel)' : ''}
- ${context.awayTeam}: ${context.coaches.away.name}${context.coaches.away.is_new ? ' (NUEVO DT — luna de miel)' : ''}
` : ''}

HISTORIAL (últimos partidos para Mirror Analysis):
${context.homeHistory.substring(0, 2000)}
${context.awayHistory.substring(0, 2000)}

H2H:
${context.h2h.substring(0, 800)}
`;
      break;

    case 'CONTEXTUAL':
      specificContext = `
${context.fatigue ? `
FATIGA:
- ${context.homeTeam}: score ${context.fatigue.home}/100
- ${context.awayTeam}: score ${context.fatigue.away}/100
` : ''}

${context.weather ? `
CLIMA:
- ${context.weather.description}
- Impacto: ${context.weather.impact}
` : ''}

${context.key_players ? `
AUSENCIAS:
- ${context.homeTeam}: ${context.key_players.home_missing.join(', ') || 'Ninguna'}
- ${context.awayTeam}: ${context.key_players.away_missing.join(', ') || 'Ninguna'}
` : ''}

${context.external_context ? `
CONTEXTO EXTERNO (Perplexity):
${context.external_context.substring(0, 1500)}
` : ''}
`;
      break;

    case 'MARKET':
      specificContext = `
CUOTAS DISPONIBLES:
${context.odds.substring(0, 2500)}

VALUE BETS DETECTADOS POR EL MODELO MATEMÁTICO (calcular edge contra estos):
${m.value_opportunities.slice(0, 8).map(v =>
  `- ${v.market}: Prob modelo ${(v.modelProb*100).toFixed(1)}% vs cuota ${v.odds} (implícita ${(v.impliedProb*100).toFixed(1)}%) → edge ${(v.edge*100).toFixed(1)}% | ${v.recommendation}`
).join('\n')}
`;
      break;

    case 'SKEPTIC':
      specificContext = `
ANÁLISIS DISPONIBLE DEL PARTIDO:
Historial local: ${context.homeHistory.substring(0, 1500)}
Historial visitante: ${context.awayHistory.substring(0, 1500)}

VALUE OPPORTUNITIES IDENTIFICADAS:
${m.value_opportunities.slice(0, 5).map(v => `- ${v.market}: edge ${(v.edge*100).toFixed(1)}% @ cuota ${v.odds}`).join('\n')}

Tu trabajo: encontrar razones por las cuales ESTOS picks pueden fallar.
`;
      break;
  }

  const outputSchema = `
Responde ÚNICAMENTE con JSON válido siguiendo ESTA estructura:
{
  "agent_name": "${AGENTS[agentKey].name}",
  "agent_role": "${AGENTS[agentKey].role}",
  "key_findings": ["finding 1", "finding 2", "finding 3"],
  "recommended_picks": [
    {
      "market": "Resultado 1X2" | "Ambos Anotan" | "Más de 2.5 Goles" | etc,
      "selection": "nombre exacto",
      "probability_estimate": <0-100>,
      "reasoning": "razón específica y concreta",
      "risk_level": "LOW" | "MEDIUM" | "HIGH"
    }
  ],
  "confidence_overall": <0-100>,
  "key_risks": ["riesgo 1", "riesgo 2"]${agentKey === 'SKEPTIC' ? `,
  "devil_arguments": ["contraargumento 1", "contraargumento 2", "contraargumento 3"]` : ''}
}
`;

  return baseContext + specificContext + outputSchema;
}

/**
 * Parse JSON response from agent, with fallback.
 */
function parseAgentResponse(text: string, agentKey: string): Partial<AgentAnalysis> {
  let cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
  const si = cleaned.indexOf('{');
  const ei = cleaned.lastIndexOf('}');
  if (si !== -1 && ei > si) cleaned = cleaned.substring(si, ei + 1);

  try { return JSON5.parse(cleaned); } catch {}
  try { return JSON.parse(cleaned); } catch {}

  console.warn(`[agent-${agentKey}] JSON parse failed for response: ${cleaned.slice(0, 200)}`);
  return {
    agent_name: AGENTS[agentKey].name,
    agent_role: AGENTS[agentKey].role,
    key_findings: [],
    recommended_picks: [],
    confidence_overall: 0,
    key_risks: ['JSON parse failed'],
    error: 'parse_failed',
  };
}

/**
 * Run a single agent with Groq rate-limit respect.
 */
async function runAgent(
  agentKey: string,
  context: MatchContext,
  timeoutMs: number
): Promise<AgentAnalysis> {
  const cfg: AgentConfig = AGENTS[agentKey];
  const prompt = buildAgentPrompt(agentKey, context);

  // Wait for Groq TPM if needed
  const estimatedTokens = Math.ceil(prompt.length / 3) + cfg.max_tokens;
  const delaySec = calcGroqDelay(estimatedTokens);
  if (delaySec > 0) {
    console.log(`[agent-${agentKey}] Waiting ${delaySec}s for Groq TPM...`);
    await new Promise((r) => setTimeout(r, delaySec * 1000));
  }

  try {
    const res = await callLLM(prompt, {
      temperature: cfg.temperature,
      maxTokens: cfg.max_tokens,
      jsonMode: true,
      timeoutMs,
      preferredProvider: cfg.preferred_provider,
      systemPrompt: cfg.system_prompt,
    });

    const parsed = parseAgentResponse(res.text, agentKey);

    return {
      agent_name: cfg.name,
      agent_role: cfg.role,
      key_findings: parsed.key_findings || [],
      recommended_picks: parsed.recommended_picks || [],
      confidence_overall: parsed.confidence_overall ?? 50,
      key_risks: parsed.key_risks || [],
      devil_arguments: parsed.devil_arguments,
      provider_used: res.provider,
      tokens_used: res.tokensUsed,
    };
  } catch (err: any) {
    console.error(`[agent-${agentKey}] Failed: ${err.message}`);
    return {
      agent_name: cfg.name,
      agent_role: cfg.role,
      key_findings: [],
      recommended_picks: [],
      confidence_overall: 0,
      key_risks: [`Agent failed: ${err.message}`],
      error: err.message,
    };
  }
}

/**
 * Build judge prompt using all 6 agent analyses.
 */
function buildJudgePrompt(context: MatchContext, analyses: AgentAnalysis[]): string {
  const m = context.math;

  const agentSummaries = analyses.map((a) => `
═══ ${a.agent_name} (confianza: ${a.confidence_overall}%) ═══
Hallazgos clave: ${a.key_findings.join(' | ')}
Picks recomendados:
${a.recommended_picks.slice(0, 3).map(p =>
  `  • ${p.market}: ${p.selection} (${p.probability_estimate}%, riesgo ${p.risk_level}) — ${p.reasoning.substring(0, 150)}`
).join('\n')}
Riesgos: ${a.key_risks.join(' | ')}
${a.devil_arguments ? `CONTRAARGUMENTOS: ${a.devil_arguments.join(' | ')}` : ''}
`).join('\n');

  return `
PARTIDO: ${context.homeTeam} vs ${context.awayTeam} (${context.league})

MODELO MATEMÁTICO (baseline):
- 1X2: ${(m.ensemble_probabilities.home_win*100).toFixed(1)}% / ${(m.ensemble_probabilities.draw*100).toFixed(1)}% / ${(m.ensemble_probabilities.away_win*100).toFixed(1)}%
- Over 2.5: ${(m.ensemble_probabilities.over_25*100).toFixed(1)}%
- BTTS: ${(m.ensemble_probabilities.btts_yes*100).toFixed(1)}%
- Consistencia: ${m.diagnostics.model_consistency} (modelos acuerdan)

${agentSummaries}

═══ TU TAREA ═══
Sintetiza estos 6 análisis. Aplica las reglas:
1) Consenso fuerte (≥4/6) → ALTA
2) Consenso moderado (3/6) → MEDIA
3) Divergencia (<3) → descartar
4) Veto Escéptico si riesgo CRÍTICO
5) No contradecir modelos matemáticos por >±10 puntos sin razón

Responde JSON estricto:
{
  "resumen_ejecutivo": {
    "titular": "Titular de alto impacto",
    "veredicto": "APOSTAR" | "OBSERVAR" | "NO_BET",
    "confianza_global": "ALTA" | "MEDIA" | "BAJA",
    "picks_principales": ["pick resumido 1", "pick resumido 2"]
  },
  "analisis_profundo": {
    "razonamiento_central": "Texto detallado (200+ palabras) integrando estadístico + contexto",
    "matchup_tactico": "Análisis del choque de sistemas",
    "factor_psicologico": "Análisis motivación/presión",
    "contexto_competitivo": "Qué se juegan"
  },
  "pronosticos": [
    {
      "mercado": "formato exacto",
      "seleccion": "selección exacta",
      "probabilidad_calculada_porcentaje": <0-100>,
      "probabilidad_implicita_porcentaje": <0-100>,
      "edge_porcentaje": <number>,
      "cuota_actual": <number>,
      "confianza": "ALTA" | "MEDIA" | "BAJA",
      "tipo_pick": "combo" | "valor" | "standard" | "banker",
      "justificacion": {
        "estadistica": "dato clave",
        "contexto_partido": "factor contextual",
        "tactica": "razón táctica",
        "mercado": "ineficiencia"
      }
    }
  ],
  "factores_riesgo": {
    "riesgo_principal": "...",
    "nivel_incertidumbre": "BAJO" | "MEDIO" | "ALTO",
    "factores_que_podrian_romper_la_estadistica": "..."
  },
  "scores_duales": {
    "score_estadistico": <0-100>,
    "score_inteligencia_partido": <0-100>,
    "confianza_final_calculada": <0-100>,
    "justificacion_balance": "..."
  },
  "mercados_evaluados": {
    "con_valor_detectado": <number>,
    "total_analizados": <number>
  }
}
`;
}

/**
 * Main orchestrator: runs 6 agents sequentially + judge.
 * Total budget: ~120s (within Supabase 150s limit).
 */
export async function runDebate(context: MatchContext): Promise<DebateResult> {
  const startTime = Date.now();
  const analyses: AgentAnalysis[] = [];
  let totalTokens = 0;

  console.log(`[orchestrator] Starting multi-agent debate for ${context.homeTeam} vs ${context.awayTeam}...`);

  // Run 6 debate agents sequentially (Groq TPM doesn't allow parallel)
  for (const agentKey of DEBATE_AGENTS) {
    const agentTimeout = 20000;  // 20s per agent
    console.log(`[orchestrator] Running agent: ${agentKey}...`);
    const analysis = await runAgent(agentKey, context, agentTimeout);
    analyses.push(analysis);
    totalTokens += analysis.tokens_used || 0;
    console.log(`[orchestrator] ${agentKey} done (${analysis.recommended_picks.length} picks, provider ${analysis.provider_used || 'FAILED'})`);
  }

  // Aggregate consensus picks
  const pickMap = new Map<string, { count: number; probabilities: number[]; markets: any[] }>();
  for (const a of analyses) {
    if (a.agent_role === 'skeptic') continue; // skeptic doesn't add picks, only vetoes
    for (const pick of a.recommended_picks) {
      const key = `${pick.market}|${pick.selection}`;
      if (!pickMap.has(key)) {
        pickMap.set(key, { count: 0, probabilities: [], markets: [] });
      }
      const entry = pickMap.get(key)!;
      entry.count++;
      entry.probabilities.push(pick.probability_estimate);
      entry.markets.push(pick);
    }
  }

  const strongPicks = Array.from(pickMap.entries())
    .filter(([_, v]) => v.count >= 3)
    .map(([key, v]) => {
      const [market, selection] = key.split('|');
      const avgProb = v.probabilities.reduce((s, p) => s + p, 0) / v.probabilities.length;
      const confidence: 'ALTA' | 'MEDIA' | 'BAJA' = v.count >= 4 ? 'ALTA' : v.count === 3 ? 'MEDIA' : 'BAJA';
      return { market, selection, agreed_by: v.count, avg_probability: Math.round(avgProb), confidence };
    })
    .sort((a, b) => b.agreed_by - a.agreed_by);

  const divergentPicks = Array.from(pickMap.entries())
    .filter(([_, v]) => v.count >= 1 && v.count < 3)
    .map(([key, v]) => {
      const [market, selection] = key.split('|');
      return {
        market,
        selection,
        agreed_by: v.count,
        note: `Solo ${v.count} agente(s) lo recomendaron`,
      };
    });

  // Run judge
  console.log('[orchestrator] Running judge...');
  const judgeCfg = AGENTS.JUDGE;
  const judgePrompt = buildJudgePrompt(context, analyses);

  // Wait for Groq if needed
  const judgeEstTokens = Math.ceil(judgePrompt.length / 3) + judgeCfg.max_tokens;
  const delaySec = calcGroqDelay(judgeEstTokens);
  if (delaySec > 0) {
    console.log(`[orchestrator] Judge waiting ${delaySec}s for TPM...`);
    await new Promise((r) => setTimeout(r, delaySec * 1000));
  }

  let judgeVerdict: any = null;
  try {
    const judgeRes = await callLLM(judgePrompt, {
      temperature: judgeCfg.temperature,
      maxTokens: judgeCfg.max_tokens,
      jsonMode: true,
      timeoutMs: 30000,
      preferredProvider: judgeCfg.preferred_provider,
      systemPrompt: judgeCfg.system_prompt,
    });
    totalTokens += judgeRes.tokensUsed || 0;

    let cleaned = judgeRes.text.replace(/```json/g, '').replace(/```/g, '').trim();
    const si = cleaned.indexOf('{');
    const ei = cleaned.lastIndexOf('}');
    if (si !== -1 && ei > si) cleaned = cleaned.substring(si, ei + 1);

    try { judgeVerdict = JSON5.parse(cleaned); } catch {
      try { judgeVerdict = JSON.parse(cleaned); } catch { judgeVerdict = null; }
    }
    console.log(`[orchestrator] Judge done (${judgeRes.provider}, ${judgeRes.tokensUsed} tokens)`);
  } catch (err: any) {
    console.error(`[orchestrator] Judge failed: ${err.message}`);
  }

  const finalPicks = judgeVerdict?.pronosticos || [];
  const totalTimeMs = Date.now() - startTime;

  return {
    agents: analyses,
    consensus: {
      strong_picks: strongPicks,
      divergent_picks: divergentPicks,
    },
    final_verdict: {
      veredicto: judgeVerdict?.resumen_ejecutivo?.veredicto || 'OBSERVAR',
      picks: finalPicks,
      summary: judgeVerdict?.resumen_ejecutivo?.titular || 'Análisis completado',
      overall_confidence: judgeVerdict?.scores_duales?.confianza_final_calculada || 50,
    },
    total_tokens: totalTokens,
    total_time_ms: totalTimeMs,
    // @ts-expect-error Expose raw judge output for the v3-ai-analyzer to use directly
    _judgeOutput: judgeVerdict,
  };
}
