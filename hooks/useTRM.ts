import { useEffect, useState } from "react";
import { getLatestTRM, TRMRate } from "../services/trmService";

/**
 * Carga la TRM oficial USD→COP una sola vez por sesión.
 * Si no hay datos en `trm_rates`, retorna `null` y los componentes
 * deben caer al display normal en USD.
 */
export const useTRM = () => {
    const [trm, setTrm] = useState<TRMRate | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        getLatestTRM().then((data) => {
            if (!cancelled) {
                setTrm(data);
                setLoading(false);
            }
        });
        return () => {
            cancelled = true;
        };
    }, []);

    return { trm, loading };
};
