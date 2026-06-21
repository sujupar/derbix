// utils/planDisplay.ts
// Helpers de PRESENTACIÓN para nombres de plan.
// SOLO afectan cómo se muestra el texto en pantalla; NO tocan datos ni lógica.

/**
 * Limpia etiquetas internas del nombre de plan para mostrarlo al usuario.
 * - Elimina sufijos de rol entre paréntesis: "(agency_admin)", "(platform_owner)", etc.
 * - Normaliza espacios y separadores sobrantes.
 * Ej: "Acceso Total (agency_admin)" -> "Acceso Total"
 */
export const cleanPlanLabel = (raw?: string | null): string => {
  if (!raw) return 'Free';
  const cleaned = raw
    .replace(/\s*\([^)]*\)\s*/g, ' ') // quita "(agency_admin)" y similares
    .replace(/\s{2,}/g, ' ')
    .replace(/[·\-–|]\s*$/, '')
    .trim();
  return cleaned || 'Acceso total';
};
