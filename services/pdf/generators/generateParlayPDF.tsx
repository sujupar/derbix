import { pdf } from '@react-pdf/renderer';
import React from 'react';
import { ParlayPDF, type ParlayPDFProps } from '../templates/ParlayPDF';

export async function generateParlayPDFNew(
  props: ParlayPDFProps,
  filename = `parlay-${props.riskLevel.toLowerCase()}.pdf`,
): Promise<void> {
  const blob = await pdf(<ParlayPDF {...props} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
