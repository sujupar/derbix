// _shared/odds-selector.ts — Selecciona bookmaker prioritario de SportMonks

// Bookmaker IDs conocidos de SportMonks, ordenados por prioridad (confiabilidad + liquidez).
// Ver: https://docs.sportmonks.com/football/entities/bookmakers
const PREFERRED_BOOKMAKERS: number[] = [
    2,    // bet365
    6,    // Pinnacle
    5,    // Unibet
    25,   // 10bet
    27,   // 1xBet
    28,   // William Hill
    32,   // Betway
];

export interface SelectedOdd {
    market_id: number;
    bookmaker_id: number;
    bookmaker_name: string;
    label: string;         // e.g., "Over 2.5", "Yes", "Home"
    value: number;         // cuota decimal (e.g., 1.85)
    total?: string | null;          // SportMonks: threshold for over/under (e.g., "2.5")
    handicap?: string | null;       // SportMonks: handicap value (e.g., "-1.5")
    market_description?: string | null; // SportMonks: full market name (e.g., "Goals Over/Under")
    participants?: string | null;   // SportMonks: team disambiguation when label="1"/"2"
}

export interface OddsSelection {
    picks: SelectedOdd[];
    total_bookmakers: number;
    preferred_bookmaker_used: string | null;
    has_coverage: boolean;
}

/**
 * Selecciona odds del bookmaker prioritario disponible.
 * Retorna { has_coverage: false } si no hay odds utilizables.
 */
export function selectOdds(rawOdds: any[]): OddsSelection {
    if (!rawOdds || rawOdds.length === 0) {
        return { picks: [], total_bookmakers: 0, preferred_bookmaker_used: null, has_coverage: false };
    }

    // 1. Detectar el bookmaker prioritario más alto disponible
    const bookmakersPresent = new Set<number>(
        rawOdds.map((o) => o.bookmaker_id).filter(Boolean)
    );
    const chosenBookmakerId =
        PREFERRED_BOOKMAKERS.find((id) => bookmakersPresent.has(id))
        ?? rawOdds[0]?.bookmaker_id;

    if (!chosenBookmakerId) {
        return {
            picks: [],
            total_bookmakers: bookmakersPresent.size,
            preferred_bookmaker_used: null,
            has_coverage: false
        };
    }

    // 2. Construir lista de picks del bookmaker elegido
    const picks: SelectedOdd[] = [];
    let bookmakerName: string | null = null;
    for (const o of rawOdds) {
        if (o.bookmaker_id !== chosenBookmakerId) continue;
        const val = typeof o.value === 'string' ? parseFloat(o.value) : o.value;
        if (!val || isNaN(val) || val <= 1.0) continue;
        picks.push({
            market_id: o.market_id,
            bookmaker_id: chosenBookmakerId,
            bookmaker_name: o.bookmaker?.name || `bookmaker_${chosenBookmakerId}`,
            label: o.label || '',
            value: val,
            total: o.total ?? null,
            handicap: o.handicap ?? null,
            market_description: o.market_description || o.market?.name || o.market?.description || null,
            participants: o.participants ?? null,
        });
        bookmakerName = o.bookmaker?.name || bookmakerName;
    }

    return {
        picks,
        total_bookmakers: bookmakersPresent.size,
        preferred_bookmaker_used: bookmakerName,
        has_coverage: picks.length > 0,
    };
}

/**
 * Busca la cuota real para un mercado+selección dados.
 * Matching case-insensitive con coincidencia parcial.
 * Retorna null si no se encuentra.
 */
export function findOddForSelection(
    selection: OddsSelection,
    label: string,
): SelectedOdd | null {
    if (!selection.has_coverage) return null;
    const target = (label || '').toLowerCase().trim();
    if (!target) return null;

    // Match exacto por label
    const exact = selection.picks.find((p) => p.label.toLowerCase().trim() === target);
    if (exact) return exact;

    // Match por inclusión
    const partial = selection.picks.find((p) => {
        const plabel = p.label.toLowerCase();
        return plabel.includes(target) || target.includes(plabel);
    });
    return partial ?? null;
}

// ═══════════════════════════════════════════════════════════════
// CROSS-VALIDATION AGAINST ORGANIZED ODDS CATALOG
// Purpose: reject/correct LLM-invented odds by matching against the
// real bookmaker catalog produced by organizeOddsForAI().
// ═══════════════════════════════════════════════════════════════

export type OddsCategory = 'MAIN' | 'GOALS' | 'TEAMS' | 'HALVES' | 'CORNERS' | 'COMBOS' | 'OTHERS';

export interface OrganizedOddItem {
    m_id: number;
    b_id: number;
    lbl: string;
    val: number;
}

export interface XValMatch {
    match: OrganizedOddItem | null;
    category: OddsCategory | null;
    searchedCategories: OddsCategory[];
    reason: 'exact' | 'partial' | 'not_found' | 'no_coverage';
    normalizedLabel: string;
}

export interface XValContext {
    homeTeam: string;
    awayTeam: string;
}

function normalizeText(s: string): string {
    return (s || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

function marketToCategories(market: string): OddsCategory[] {
    const m = normalizeText(market);
    if (!m) return ['MAIN', 'GOALS', 'TEAMS', 'HALVES', 'CORNERS', 'COMBOS', 'OTHERS'];

    if (m.includes('corner')) return ['CORNERS'];
    if (m.includes('1er tiempo') || m.includes('2do tiempo') || m.includes('primer tiempo') || m.includes('segundo tiempo') || m.includes('ht/ft') || m.includes('half')) return ['HALVES'];
    if (m.includes('resultado y total') || m.includes('dc y goles') || m.includes('& mas de') || m.includes('& menos de') || m.includes('ambos anotan y') || m.includes('combo')) return ['COMBOS'];
    if (m.includes('goles del local') || m.includes('goles del visitante') || m.includes('handicap') || m.includes('asian')) return ['TEAMS'];
    if (m.includes('ambos anotan') || m.includes('btts') || m.includes('mas de') || m.includes('menos de') || m.includes('over') || m.includes('under') || m.includes('total goles')) return ['GOALS'];
    if (m.includes('resultado 1x2') || m.includes('doble oportunidad') || m.includes('1x2') || m.includes('draw no bet') || m.includes('empate no')) return ['MAIN'];

    return ['MAIN', 'GOALS', 'TEAMS', 'HALVES', 'CORNERS', 'COMBOS', 'OTHERS'];
}

// Returns true when the pick (market+selection) refers to the Draw-No-Bet market —
// a 2-way "team wins or refund on draw" market that the catalog labels separately
// (m_id=6 in SportMonks). Detecting it explicitly prevents the matcher from
// confusing "Manchester City - Draw No Bet" with "Resultado 1X2: Empate" via
// the shared 'draw'/'empate' token.
function isDrawNoBetPick(market: string, selection: string): boolean {
    const m = normalizeText(market);
    const s = normalizeText(selection);
    const combined = `${m} ${s}`;
    return combined.includes('draw no bet')
        || combined.includes('empate no accion')
        || combined.includes('empate no acción')
        || combined.includes('match winner (no draw)')
        || combined.includes('no bet');
}

function buildSelectionTokens(selection: string, ctx: XValContext): string[] {
    const raw = normalizeText(selection);
    const home = normalizeText(ctx.homeTeam);
    const away = normalizeText(ctx.awayTeam);
    const tokens = new Set<string>();
    tokens.add(raw);

    if (home && raw.includes(home)) {
        tokens.add('home'); tokens.add('1'); tokens.add(home);
    }
    if (away && raw.includes(away)) {
        tokens.add('away'); tokens.add('2'); tokens.add(away);
    }

    // Skip 'draw'/'empate' tokens for Draw-No-Bet picks. The token 'empate' would
    // collide with the regular "Resultado 1X2: Empate" catalog entry (often 5x+
    // odds for heavy favorites) instead of the correct "Match Winner (no draw)"
    // entry for the picked team. isDrawNoBetPick covers both market and selection
    // strings since LLMs sometimes encode "Draw No Bet" in the selection alone.
    const looksLikeDnb = raw.includes('draw no bet') || raw.includes('no bet') || raw.includes('empate no');
    if (!looksLikeDnb && (raw.includes('empate') || raw === 'x' || raw.includes('draw'))) {
        tokens.add('draw'); tokens.add('x'); tokens.add('empate');
    }

    const overMatch = raw.match(/(?:mas de|over|\+)\s*(\d+(?:\.\d+)?)/);
    if (overMatch) {
        const n = overMatch[1];
        tokens.add(`over ${n}`); tokens.add(`mas de ${n}`); tokens.add(`+${n}`); tokens.add(n);
    }
    const underMatch = raw.match(/(?:menos de|under|-)\s*(\d+(?:\.\d+)?)/);
    if (underMatch) {
        const n = underMatch[1];
        tokens.add(`under ${n}`); tokens.add(`menos de ${n}`); tokens.add(`-${n}`); tokens.add(n);
    }

    if (/^si$/.test(raw) || raw.includes('ambos anotan: si') || raw === 'yes') {
        tokens.add('yes'); tokens.add('si');
    }
    if (/^no$/.test(raw) || raw.includes('ambos anotan: no')) {
        tokens.add('no');
    }

    if (raw.includes('doble oportunidad') || raw.includes('double chance')) {
        if (home && raw.includes(home)) { tokens.add('1x'); tokens.add('home/draw'); }
        if (away && raw.includes(away)) { tokens.add('x2'); tokens.add('draw/away'); }
        if (raw.includes(home) && raw.includes(away)) { tokens.add('12'); tokens.add('home/away'); }
    }

    tokens.delete('');
    return Array.from(tokens);
}

function matchLabel(itemLabel: string, tokens: string[]): { matched: boolean; reason: 'exact' | 'partial' | null } {
    const lbl = normalizeText(itemLabel);
    if (!lbl) return { matched: false, reason: null };

    for (const t of tokens) {
        if (!t) continue;
        if (lbl === t) return { matched: true, reason: 'exact' };
    }

    for (const t of tokens) {
        if (!t || t.length < 2) continue;
        if (lbl.includes(t) || t.includes(lbl)) return { matched: true, reason: 'partial' };
    }

    return { matched: false, reason: null };
}

/**
 * Cross-validate a market+selection pair against the organized odds catalog.
 * The catalog's `lbl` is now of the form "MercadoName: Selection" (e.g.
 * "Más/Menos Goles: Over 2.5"). We construct the same shape from the LLM's
 * (market, selection) pair and match by token overlap.
 *
 * Returns the real odd found (if any), category, and match reason.
 */
export function findOddInOrganized(
    organized: any,
    market: string,
    selection: string,
    ctx: XValContext
): XValMatch {
    const tokens = buildSelectionTokens(selection || '', ctx);
    const targetMarket = normalizeText(market || '');
    const targetSelection = normalizeText(selection || '');
    const normalizedLabel = `${targetMarket}: ${targetSelection}`;

    if (!organized || typeof organized !== 'object' || organized.info === 'No odds available' || !organized._meta?.bookmaker) {
        return { match: null, category: null, searchedCategories: [], reason: 'no_coverage', normalizedLabel };
    }

    // DRAW NO BET SHORT-CIRCUIT: route DNB picks directly to "Match Winner (no draw)"
    // / "Empate No Acción" entries in MAIN. The generic scorer can't distinguish
    // these from regular 1X2 entries — the catalog has both with identical team
    // names, and the regular Empate slot has odds 5x+ that fail downstream
    // [1.20, 4.50] filters even though the DNB selection's odds (~1.85) is valid.
    if (isDrawNoBetPick(market || '', selection || '')) {
        const mainItems: OrganizedOddItem[] = Array.isArray(organized.MAIN) ? organized.MAIN : [];
        const home = normalizeText(ctx.homeTeam);
        const away = normalizeText(ctx.awayTeam);
        const targetIsHome = !!home && targetSelection.includes(home);
        const targetIsAway = !!away && targetSelection.includes(away);
        for (const it of mainItems) {
            const lbl = normalizeText(it.lbl || '');
            const isDnbCatalogEntry = lbl.includes('match winner (no draw)')
                || lbl.includes('empate no accion')
                || lbl.includes('empate no acción')
                || lbl.includes('no draw');
            if (!isDnbCatalogEntry) continue;
            if (targetIsHome && home && lbl.includes(home)) {
                return { match: it, category: 'MAIN', searchedCategories: ['MAIN'], reason: 'exact', normalizedLabel };
            }
            if (targetIsAway && away && lbl.includes(away)) {
                return { match: it, category: 'MAIN', searchedCategories: ['MAIN'], reason: 'exact', normalizedLabel };
            }
        }
        return { match: null, category: null, searchedCategories: ['MAIN'], reason: 'not_found', normalizedLabel };
    }

    const categories = marketToCategories(market || '');
    const allCats: OddsCategory[] = ['MAIN', 'GOALS', 'TEAMS', 'HALVES', 'CORNERS', 'COMBOS', 'OTHERS'];

    // Threshold must match exactly when present in target. This prevents the bug where
    // "Menos de 2.5" was being matched against catalog entries with threshold 1.5/3.5/4.5
    // and accepting their odds (e.g. 4.50 odds for what is really "Under 4.5").
    const extractThreshold = (s: string): string | null => {
        const m = s.match(/(?:^|[\s:])(\d+(?:\.\d+)?)(?:\b|$)/);
        return m ? m[1] : null;
    };
    const targetThreshold = (() => {
        // Only enforce threshold matching for goals/corners/handicap markets
        const isThresholdMarket = /(over|under|mas de|menos de|\+|\-)\s*\d/.test(targetSelection)
            || /\b\d+(?:\.\d+)?\s*(?:goles|corners|tiros)?\b/.test(targetSelection);
        if (!isThresholdMarket) return null;
        return extractThreshold(targetSelection);
    })();

    // Score function: how well does an organized item match this LLM pick?
    const scoreItem = (it: OrganizedOddItem): { score: number; reason: 'exact' | 'partial' | 'not_found' } => {
        const lbl = normalizeText(it.lbl);
        if (!lbl) return { score: 0, reason: 'not_found' };

        // Split lbl into market_part : selection_part
        const sepIdx = lbl.indexOf(':');
        const lblMarket = sepIdx > -1 ? lbl.substring(0, sepIdx).trim() : lbl;
        const lblSelection = sepIdx > -1 ? lbl.substring(sepIdx + 1).trim() : lbl;

        // STRICT THRESHOLD MATCHING: if target has a number, lbl must have the SAME number.
        // This is the fix for "Menos de 2.5 @ 4.50" type errors where the catalog dedup
        // accepted a different threshold's odds.
        if (targetThreshold) {
            const lblThreshold = extractThreshold(lblSelection);
            if (lblThreshold !== targetThreshold) {
                return { score: 0, reason: 'not_found' };
            }
            // 2026-05-08 FIX: reject Asian split / composite thresholds.
            // SportMonks m_id=105 returns labels like "Under 2.5, 3.0" (Asian split where
            // the threshold is actually 2.75). The first number matches "Under 2.5" but
            // the market is DIFFERENT — its odds (e.g. 1.42) reflect a 2.75 threshold,
            // not a 2.5 threshold. Detect a second number after a comma and reject.
            const compositeMatch = lblSelection.match(/\b\d+(?:\.\d+)?\s*[,/]\s*\d+(?:\.\d+)?\b/);
            if (compositeMatch) {
                return { score: 0, reason: 'not_found' };
            }
        }

        // Market match score (0-2)
        let marketScore = 0;
        if (targetMarket && (lblMarket.includes(targetMarket) || targetMarket.includes(lblMarket))) marketScore = 2;
        else if (targetMarket.split(/\s+/).some(w => w.length > 3 && lblMarket.includes(w))) marketScore = 1;

        // Selection match: try tokens
        let selScore = 0;
        let exactSel = false;
        for (const t of tokens) {
            if (!t) continue;
            if (lblSelection === t) { exactSel = true; selScore = 3; break; }
            if (t.length >= 2 && (lblSelection.includes(t) || t.includes(lblSelection))) {
                selScore = Math.max(selScore, 2);
            }
        }
        // Also try direct selection-vs-selection
        if (!exactSel && targetSelection && lblSelection.includes(targetSelection)) {
            selScore = Math.max(selScore, 2);
            if (lblSelection === targetSelection) { exactSel = true; selScore = 3; }
        }

        const total = marketScore + selScore;
        if (total >= 5) return { score: total, reason: 'exact' };
        if (total >= 3) return { score: total, reason: 'partial' };
        return { score: total, reason: 'not_found' };
    };

    let bestMatch: { item: OrganizedOddItem; cat: OddsCategory; score: number; reason: 'exact' | 'partial' } | null = null;

    // 2026-05-08 FIX: when target is a "pure" goals/corners/cards market, NEVER fallback
    // to COMBOS (which mix 1X2 + Goals like "Resultado y Total Goles: Under 2.5 @ 4.50")
    // or OTHERS (which now hosts Asian splits and composite thresholds). Users see the
    // simple "Under 2.5 = 1.85" in their bookmaker, not the combo's price.
    const isPureGoalsCornersCards =
        categories.length === 1 &&
        (categories[0] === 'GOALS' || categories[0] === 'CORNERS');
    const fallbackCats: OddsCategory[] = isPureGoalsCornersCards
        ? [] // strict: only use the preferred category
        : allCats.filter(c => !categories.includes(c));
    const searchOrder = [...categories, ...fallbackCats];

    for (const cat of searchOrder) {
        const items: OrganizedOddItem[] = organized[cat] || [];
        if (!Array.isArray(items) || items.length === 0) continue;

        for (const it of items) {
            const r = scoreItem(it);
            if (r.reason === 'not_found') continue;
            if (!bestMatch || r.score > bestMatch.score) {
                bestMatch = { item: it, cat, score: r.score, reason: r.reason as 'exact' | 'partial' };
                if (r.reason === 'exact' && r.score === 5) return { match: it, category: cat, searchedCategories: categories, reason: 'exact', normalizedLabel };
            }
        }
    }

    if (bestMatch) {
        return { match: bestMatch.item, category: bestMatch.cat, searchedCategories: categories, reason: bestMatch.reason, normalizedLabel };
    }
    return { match: null, category: null, searchedCategories: categories, reason: 'not_found', normalizedLabel };
}

/**
 * Returns true if LLM-provided odds is within tolerance of the real market odds.
 * Tolerance defaults to 5% (conservative; 3% was too strict in initial tests).
 */
export function oddsWithinTolerance(llmOdds: number | null, realOdds: number, tolerance = 0.05): boolean {
    if (llmOdds === null || !isFinite(llmOdds) || llmOdds <= 1.0) return false;
    if (!isFinite(realOdds) || realOdds <= 1.0) return false;
    return Math.abs(llmOdds - realOdds) / realOdds <= tolerance;
}

// ═══════════════════════════════════════════════════════════════
// PROBABILITY ↔ ODDS COHERENCE SANITY CHECK
// A 90% probability claim with a 1.77 odds is mathematically incoherent:
// fair odds at 90% is 1.111, and bookmaker margin tops it at ~1.15. A 1.77
// odds implies an actual market probability of ~56%, so EITHER the LLM
// inflated the probability OR the odds belongs to a different market line.
// In both cases the pick is unreliable and must be rejected before display.
// ═══════════════════════════════════════════════════════════════

// Conservative ceiling on odds for a given probability band, allowing for
// bookmaker margin (~5-8%) + a 25-30% value-bet allowance.
// Format: [min_probability_inclusive, max_allowed_odds]
//
// 2026-05-15 — tightened after the inflated-odds incident: previous table
// allowed up to 83% implied edge for prob 0.83 (max odds 2.20). This let
// catalog-polluted picks (m_id=63 "Under 4.5 @ 2.02" with prob 88%) pass
// the sanity check. New table caps implied edge to ~25-30% across the board,
// and adds an 0.80 band so 80-82% picks are no longer unconstrained.
//
// Implied edge cap per band (where edge = (prob - 1/odds) / (1/odds)):
//   prob 0.95, odds 1.25 → edge 19%
//   prob 0.90, odds 1.35 → edge 22%
//   prob 0.85, odds 1.50 → edge 28%
//   prob 0.83, odds 1.55 → edge 29%
//   prob 0.80, odds 1.60 → edge 28%
// 2026-07-22 — bandas 0.72-0.78 añadidas para el modo "valor" (Opción B): picks de
// cuota >= 1.40 con probabilidad 72-80%. El cap de cuota por banda mantiene el edge
// implícito acotado (~33%) para rechazar prob/cuota infladas también en este rango.
const PROB_ODDS_SANITY_TABLE: Array<[number, number]> = [
    [0.95, 1.25],
    [0.90, 1.35],
    [0.85, 1.50],
    [0.83, 1.55],
    [0.80, 1.60],
    [0.78, 1.70],
    [0.75, 1.78],
    [0.72, 1.85],
];

export interface ProbOddsCoherenceResult {
    coherent: boolean;
    reason: string | null;
    probBand: number | null;
    maxAllowedOdds: number | null;
}

/**
 * Returns whether a (probability, odds) pair is mathematically coherent.
 * `prob` MUST be in [0, 1] (decimal). `odds` is the decimal bookmaker odds.
 * Returns coherent=true for picks below the lowest band (no constraint applied).
 */
export function checkProbOddsCoherence(prob: number, odds: number | null): ProbOddsCoherenceResult {
    if (odds === null || !isFinite(odds) || odds <= 1.0) {
        return { coherent: false, reason: 'invalid_odds', probBand: null, maxAllowedOdds: null };
    }
    if (!isFinite(prob) || prob <= 0 || prob > 1) {
        return { coherent: false, reason: 'invalid_prob', probBand: null, maxAllowedOdds: null };
    }
    for (const [minProb, maxOdds] of PROB_ODDS_SANITY_TABLE) {
        if (prob >= minProb) {
            const coherent = odds <= maxOdds;
            return {
                coherent,
                reason: coherent ? null : `prob_${Math.round(prob * 100)}%_vs_odds_${odds}_exceeds_max_${maxOdds}`,
                probBand: minProb,
                maxAllowedOdds: maxOdds,
            };
        }
    }
    // Below 80%: not in opportunities band — no constraint applied.
    return { coherent: true, reason: null, probBand: null, maxAllowedOdds: null };
}
