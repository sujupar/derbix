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
