// services/marketTranslator.ts
// VISUAL-ONLY translator: converts the (market, selection) pair from the analysis
// pipeline into a consistent Spanish display nomenclature.
// Backend stores raw values intact (e.g. "Over/Under" + "Under 2.5"); this module
// is the only consumer for what the user sees in the UI / PDF / Telegram.

export interface TranslatedPick {
  marketEs: string;       // Spanish market category name
  selectionEs: string;    // Spanish selection text
  shortLabel: string;     // Compact one-line label for cards: "Menos de 2.5 goles"
  longLabel: string;      // Verbose label: "Más / Menos Goles (2.5) — Menos de 2.5 goles"
  category: 'GOLES' | 'RESULTADO' | 'BTTS' | 'DOBLE_OP' | 'TARJETAS' | 'CORNERS' | 'HANDICAP' | 'COMBINADO' | 'MITAD' | 'OTRO';
}

const lower = (s: string | undefined | null): string => (s || '').toLowerCase().trim();

// Extract a numeric threshold from a selection string (e.g. "Under 2.5" → "2.5", "Más de 1.5 goles" → "1.5")
function extractThreshold(s: string): string | null {
  const m = (s || '').match(/(\d+(?:\.\d+)?)/);
  return m ? m[1] : null;
}

function isOverUnderMarket(m: string): boolean {
  const x = lower(m);
  return x.includes('over') || x.includes('under') || x.includes('mas de') || x.includes('menos de') ||
         x.includes('más de') || x.includes('menos de') || x.includes('total goles') || x.includes('goles');
}

function isCornersMarket(m: string, s: string): boolean {
  const x = lower(m) + ' ' + lower(s);
  return x.includes('corner') || x.includes('cornér') || x.includes('córner');
}

function isCardsMarket(m: string, s: string): boolean {
  const x = lower(m) + ' ' + lower(s);
  return x.includes('tarjeta') || x.includes('card') || x.includes('amarilla');
}

function isBTTSMarket(m: string, s: string): boolean {
  const x = lower(m) + ' ' + lower(s);
  return x.includes('btts') || x.includes('ambos anotan') || x.includes('both teams') || x.includes('ambos equipos anotan');
}

function isDobleOportunidadMarket(m: string): boolean {
  const x = lower(m);
  return x.includes('doble oportunidad') || x.includes('double chance') || x.includes('dc');
}

function is1X2Market(m: string): boolean {
  const x = lower(m);
  return x === '1x2' || x.includes('resultado 1x2') || x.includes('resultado') ||
         x.includes('match winner') || x === '1' || x === 'x' || x === '2';
}

function isHandicapMarket(m: string): boolean {
  const x = lower(m);
  return x.includes('handicap') || x.includes('handikap') || x.includes('asian');
}

// Draw No Bet (a.k.a. "Empate No Acción", "Match Winner (no draw)") is a 2-way
// market where the stake is refunded if the match ends in a draw. Detected via
// market OR selection text since the LLM occasionally encodes it in either.
function isDrawNoBetMarket(market: string, selection: string): boolean {
  const x = lower(market) + ' ' + lower(selection);
  return x.includes('draw no bet')
    || x.includes('no bet')
    || x.includes('empate no')
    || x.includes('match winner (no draw)')
    || x.includes('no draw');
}

function isHalvesMarket(m: string, s: string): boolean {
  const x = lower(m) + ' ' + lower(s);
  return x.includes('1er tiempo') || x.includes('2do tiempo') || x.includes('primer tiempo') ||
         x.includes('segundo tiempo') || x.includes('half time') || x.includes('ht/ft') || x.includes('media parte');
}

// Translate selection from English to Spanish (best effort, leaves unknown text untouched)
function translateSelection(s: string): string {
  let out = (s || '').trim();
  if (!out) return out;

  // Common direct replacements (case-insensitive, word boundary)
  const replacements: Array<[RegExp, string]> = [
    [/\bunder\b/gi, 'Menos de'],
    [/\bover\b/gi, 'Más de'],
    [/\bhome\b/gi, 'Local'],
    [/\baway\b/gi, 'Visitante'],
    [/\bdraw\b/gi, 'Empate'],
    [/\byes\b/gi, 'Sí'],
    [/\bno\b/gi, 'No'],
    [/\bboth teams to score\b/gi, 'Ambos equipos anotan'],
    [/\bbtts\b/gi, 'Ambos equipos anotan'],
    [/\bnot to score\b/gi, 'no anota'],
    [/\bto score\b/gi, 'anota'],
    [/\bor draw\b/gi, 'o Empate'],
    [/\bcorners\b/gi, 'córneres'],
    [/\bcards\b/gi, 'tarjetas'],
  ];
  for (const [re, rep] of replacements) {
    out = out.replace(re, rep);
  }
  return out;
}

export function translatePick(market: string, selection: string): TranslatedPick {
  const m = market || '';
  const s = selection || '';
  const threshold = extractThreshold(s);

  // GOLES (Over/Under totals)
  if (isOverUnderMarket(m) && !isCornersMarket(m, s) && !isCardsMarket(m, s)) {
    const isMenos = lower(s).includes('under') || lower(s).includes('menos');
    const isMas = lower(s).includes('over') || lower(s).includes('más') || lower(s).includes('mas');
    const direction = isMenos ? 'Menos' : isMas ? 'Más' : '';
    const sel = threshold && direction ? `${direction} de ${threshold} goles` : translateSelection(s);
    return {
      marketEs: 'Más / Menos Goles',
      selectionEs: sel,
      shortLabel: sel,
      longLabel: `Más / Menos Goles${threshold ? ` (${threshold})` : ''} — ${sel}`,
      category: 'GOLES',
    };
  }

  // CORNERS
  if (isCornersMarket(m, s)) {
    const direction = lower(s).includes('under') || lower(s).includes('menos') ? 'Menos' :
                       lower(s).includes('over') || lower(s).includes('más') ? 'Más' : '';
    const sel = threshold && direction ? `${direction} de ${threshold} córneres` : translateSelection(s);
    return {
      marketEs: 'Córneres',
      selectionEs: sel,
      shortLabel: sel,
      longLabel: `Córneres${threshold ? ` (${threshold})` : ''} — ${sel}`,
      category: 'CORNERS',
    };
  }

  // TARJETAS
  if (isCardsMarket(m, s)) {
    const direction = lower(s).includes('under') || lower(s).includes('menos') ? 'Menos' :
                       lower(s).includes('over') || lower(s).includes('más') ? 'Más' : '';
    const sel = threshold && direction ? `${direction} de ${threshold} tarjetas` : translateSelection(s);
    return {
      marketEs: 'Tarjetas',
      selectionEs: sel,
      shortLabel: sel,
      longLabel: `Tarjetas${threshold ? ` (${threshold})` : ''} — ${sel}`,
      category: 'TARJETAS',
    };
  }

  // BTTS
  if (isBTTSMarket(m, s)) {
    const isYes = lower(s).includes('yes') || lower(s) === 'sí' || lower(s) === 'si' || lower(s).includes(' si');
    const isNo = lower(s).includes(' no') || lower(s) === 'no';
    const sel = isYes ? 'Sí' : isNo ? 'No' : translateSelection(s);
    return {
      marketEs: 'Ambos equipos anotan',
      selectionEs: sel,
      shortLabel: `Ambos anotan: ${sel}`,
      longLabel: `Ambos equipos anotan — ${sel}`,
      category: 'BTTS',
    };
  }

  // EMPATE NO ACCIÓN (Draw No Bet)
  // Check BEFORE Doble Oportunidad and 1X2 because the selection may also
  // contain team names that those checks would match. Strip the DNB markers
  // from the RAW selection first so translateSelection() doesn't rewrite
  // "Draw No Bet" → "Empate No Bet" (\bdraw\b → Empate is generic).
  if (isDrawNoBetMarket(m, s)) {
    const strippedSel = (s || '')
      .replace(/\s*[-—]?\s*draw\s+no\s+bet\s*/gi, '')
      .replace(/\s*[-—]?\s*no\s+bet\s*/gi, '')
      .replace(/\s*[-—]?\s*empate\s+no\s+acci[óo]n\s*/gi, '')
      .replace(/\s*[-—]?\s*no\s+draw\s*/gi, '')
      .replace(/\s*\(\s*no\s+draw\s*\)\s*/gi, '')
      .replace(/\s*\(\s*\)\s*/g, '')
      .trim();
    const cleanedSel = translateSelection(strippedSel || s);
    return {
      marketEs: 'Empate No Acción',
      selectionEs: cleanedSel,
      shortLabel: `${cleanedSel} (refund si empate)`,
      longLabel: `Empate No Acción — ${cleanedSel} (gana el partido o la apuesta se devuelve si empatan)`,
      category: 'RESULTADO',
    };
  }

  // DOBLE OPORTUNIDAD
  if (isDobleOportunidadMarket(m)) {
    return {
      marketEs: 'Doble Oportunidad',
      selectionEs: translateSelection(s),
      shortLabel: translateSelection(s),
      longLabel: `Doble Oportunidad — ${translateSelection(s)}`,
      category: 'DOBLE_OP',
    };
  }

  // HANDICAP
  if (isHandicapMarket(m)) {
    return {
      marketEs: 'Hándicap',
      selectionEs: translateSelection(s),
      shortLabel: translateSelection(s),
      longLabel: `Hándicap — ${translateSelection(s)}`,
      category: 'HANDICAP',
    };
  }

  // MITADES
  if (isHalvesMarket(m, s)) {
    return {
      marketEs: 'Resultado por mitad',
      selectionEs: translateSelection(s),
      shortLabel: translateSelection(s),
      longLabel: `Resultado por mitad — ${translateSelection(s)}`,
      category: 'MITAD',
    };
  }

  // 1X2 / Resultado
  if (is1X2Market(m)) {
    return {
      marketEs: 'Resultado (1X2)',
      selectionEs: translateSelection(s),
      shortLabel: `Gana ${translateSelection(s)}`,
      longLabel: `Resultado (1X2) — ${translateSelection(s)}`,
      category: 'RESULTADO',
    };
  }

  // Combinados / fallback
  return {
    marketEs: m || 'Mercado',
    selectionEs: translateSelection(s),
    shortLabel: translateSelection(s),
    longLabel: `${m || 'Mercado'} — ${translateSelection(s)}`,
    category: lower(m).includes('combo') ? 'COMBINADO' : 'OTRO',
  };
}

/** Quick helper: returns just the user-facing market label in Spanish. */
export function marketLabelEs(market: string, selection: string = ''): string {
  return translatePick(market, selection).marketEs;
}

/** Quick helper: returns just the user-facing selection label in Spanish. */
export function selectionLabelEs(market: string, selection: string): string {
  return translatePick(market, selection).selectionEs;
}
