import { pdf } from '@react-pdf/renderer';
import React from 'react';
import { PremiumMatchPDF, type PremiumMatchPDFProps } from '../templates/PremiumMatchPDF';

export async function generatePremiumMatchPDF(
  props: PremiumMatchPDFProps,
  filename = `pronostico-${props.homeTeam}-vs-${props.awayTeam}.pdf`,
): Promise<void> {
  const blob = await pdf(<PremiumMatchPDF {...props} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
