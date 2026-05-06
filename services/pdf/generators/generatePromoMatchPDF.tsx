import { pdf } from '@react-pdf/renderer';
import React from 'react';
import { PromoMatchPDF, type PromoMatchPDFProps } from '../templates/PromoMatchPDF';

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function generatePromoMatchPDF(
  props: PromoMatchPDFProps,
  filename = `analisis-${props.homeTeam}-vs-${props.awayTeam}.pdf`,
): Promise<void> {
  const blob = await pdf(<PromoMatchPDF {...props} />).toBlob();
  triggerDownload(blob, filename);
}

export async function buildPromoMatchPDFBlob(props: PromoMatchPDFProps): Promise<Blob> {
  return await pdf(<PromoMatchPDF {...props} />).toBlob();
}
