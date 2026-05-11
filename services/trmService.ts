// ═══════════════════════════════════════════════════════════════
// trmService — TRM USD→COP, 100% client-side
// ───────────────────────────────────────────────────────────────
// Funciona sin infraestructura de backend: cada cliente consulta
// la TRM oficial colombiana directamente y la cachea en
// localStorage por fecha (Bogotá). Solo se hace una llamada de
// red por dispositivo por día — al cambiar de día, refresca.
//
// Fuentes (en orden de preferencia):
//   1. Datos Abiertos Colombia (TRM oficial, Superfinanciera)
//      https://www.datos.gov.co/resource/mcec-87by.json
//   2. open.er-api.com (sin API key, USD→COP en vivo)
// ═══════════════════════════════════════════════════════════════

export interface TRMRate {
    rate_date: string;
    usd_to_cop: number;
    source: string;
}

const STORAGE_KEY_PREFIX = "derbix:trm:";

// Fecha "hoy" en Bogotá (YYYY-MM-DD)
function todayBogota(): string {
    const now = new Date();
    const bogota = new Date(now.getTime() - 5 * 60 * 60 * 1000);
    return bogota.toISOString().slice(0, 10);
}

// Limpia entradas viejas y guarda la TRM del día.
function persist(rate: TRMRate): void {
    if (typeof window === "undefined") return;
    try {
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith(STORAGE_KEY_PREFIX) && k !== STORAGE_KEY_PREFIX + rate.rate_date) {
                keysToRemove.push(k);
            }
        }
        keysToRemove.forEach((k) => localStorage.removeItem(k));
        localStorage.setItem(STORAGE_KEY_PREFIX + rate.rate_date, JSON.stringify(rate));
    } catch {
        // localStorage lleno o deshabilitado — ignorar.
    }
}

async function fetchFromDatosGov(today: string): Promise<TRMRate | null> {
    try {
        const url =
            "https://www.datos.gov.co/resource/mcec-87by.json?$order=vigenciadesde%20DESC&$limit=5";
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok) return null;
        const rows = (await res.json()) as Array<{
            valor: string;
            vigenciadesde: string;
            vigenciahasta: string;
        }>;
        if (!Array.isArray(rows) || rows.length === 0) return null;

        const todayDate = new Date(today + "T12:00:00-05:00");
        let best: { valor: string } | null = null;
        for (const row of rows) {
            const desde = new Date(row.vigenciadesde);
            const hasta = new Date(row.vigenciahasta);
            if (todayDate >= desde && todayDate <= hasta) {
                best = row;
                break;
            }
        }
        if (!best) best = rows[0];

        const rate = parseFloat(best.valor);
        if (!isFinite(rate) || rate <= 0) return null;

        return {
            rate_date: today,
            usd_to_cop: rate,
            source: "datos.gov.co",
        };
    } catch {
        return null;
    }
}

async function fetchFromOpenER(today: string): Promise<TRMRate | null> {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const res = await fetch("https://open.er-api.com/v6/latest/USD", {
            signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!res.ok) return null;
        const data = await res.json();
        const rate = data?.rates?.COP;
        if (typeof rate !== "number" || rate <= 0) return null;
        return {
            rate_date: today,
            usd_to_cop: rate,
            source: "open.er-api.com",
        };
    } catch {
        return null;
    }
}

// Dedup de llamadas concurrentes (varios componentes montan a la vez).
let inFlight: Promise<TRMRate | null> | null = null;

export const getLatestTRM = async (): Promise<TRMRate | null> => {
    const today = todayBogota();

    if (typeof window !== "undefined") {
        try {
            const cached = localStorage.getItem(STORAGE_KEY_PREFIX + today);
            if (cached) {
                return JSON.parse(cached) as TRMRate;
            }
        } catch {
            // JSON corrupto — ignorar y refetch.
        }
    }

    if (inFlight) return inFlight;

    inFlight = (async () => {
        const fromOfficial = await fetchFromDatosGov(today);
        if (fromOfficial) {
            persist(fromOfficial);
            return fromOfficial;
        }
        const fromOpenER = await fetchFromOpenER(today);
        if (fromOpenER) {
            persist(fromOpenER);
            return fromOpenER;
        }
        return null;
    })();

    try {
        return await inFlight;
    } finally {
        inFlight = null;
    }
};

/**
 * Convierte un monto en USD a COP redondeado al múltiplo más cercano
 * (default: 100 COP) y formateado al estilo colombiano (es-CO):
 *   19.99 USD @ 4123 COP/USD → "$ 82.400"
 */
export const formatCOPFromUSD = (
    usdAmount: number,
    trm: number,
    roundTo = 100,
): string => {
    const cop = Math.round((usdAmount * trm) / roundTo) * roundTo;
    return new Intl.NumberFormat("es-CO", {
        style: "currency",
        currency: "COP",
        maximumFractionDigits: 0,
        minimumFractionDigits: 0,
    }).format(cop);
};
