import React from "react";
import { formatCOPFromUSD, TRMRate } from "../../services/trmService";

interface CopPriceBadgeProps {
    /** Monto en USD (no en centavos) que se mostrará convertido a COP. */
    usdAmount: number;
    /** TRM cargada via `useTRM()`. Si es null, el badge no se renderiza. */
    trm: TRMRate | null;
    /** Sufijo opcional: "/mes", "/año", etc. */
    suffix?: string;
    className?: string;
}

/**
 * Pequeño badge que muestra el equivalente del precio en pesos
 * colombianos junto a la banderita de Colombia. Se renderiza
 * debajo del precio en USD en landing y página de planes.
 *
 * Si la TRM aún no se cargó o no existe en DB, se oculta para
 * evitar mostrar un placeholder roto.
 */
export const CopPriceBadge: React.FC<CopPriceBadgeProps> = ({
    usdAmount,
    trm,
    suffix = "/mes",
    className = "",
}) => {
    if (!trm || usdAmount <= 0) return null;

    const cop = formatCOPFromUSD(usdAmount, trm.usd_to_cop);

    return (
        <div
            className={`flex items-center gap-1.5 text-sm text-slate-400 ${className}`}
            title={`TRM ${new Intl.NumberFormat("es-CO").format(trm.usd_to_cop)} COP/USD — actualizada ${trm.rate_date}`}
        >
            <ColombianFlag />
            <span className="font-medium">
                ≈ {cop}
                <span className="text-slate-500">{suffix}</span>
            </span>
        </div>
    );
};

const ColombianFlag: React.FC = () => (
    <span
        className="inline-flex flex-col rounded-sm overflow-hidden border border-white/10 shadow-sm"
        style={{ width: "16px", height: "11px" }}
        aria-label="Colombia"
        role="img"
    >
        <span style={{ background: "#FCD116", height: "50%" }} />
        <span style={{ background: "#003893", height: "25%" }} />
        <span style={{ background: "#CE1126", height: "25%" }} />
    </span>
);

export default CopPriceBadge;
