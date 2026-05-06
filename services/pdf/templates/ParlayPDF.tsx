import React from 'react';
import { Document, View, Text, StyleSheet } from '@react-pdf/renderer';
import { Page, CoverPage, SectionHeader, KPICard, Quote, DataTable } from '../design-system/components';
import { tokens } from '../design-system/tokens';
import { ensureFontsRegistered } from '../design-system/fonts';

const styles = StyleSheet.create({
  paragraph: { fontSize: tokens.fontSize.body, color: tokens.colors.textSecondary, lineHeight: tokens.lineHeight.normal, marginBottom: tokens.spacing.md },
  kpiRow: { flexDirection: 'row', gap: tokens.spacing.md, marginVertical: tokens.spacing.lg },
});

export interface ParlayLeg {
  match: string;
  market: string;
  selection: string;
  odds: number;
  probability: number;
  reasoning: string;
}

export interface ParlayPDFProps {
  riskLevel: 'CONSERVADOR' | 'EQUILIBRADO' | 'AGRESIVO';
  legs: ParlayLeg[];
  totalOdds: number;
  combinedProbability: number;
  generatedAt: string;
  isPromo: boolean;
}

export const ParlayPDF: React.FC<ParlayPDFProps> = (p) => {
  ensureFontsRegistered();
  return (
    <Document title={`Parlay ${p.riskLevel}`} author="Derbix">
      <CoverPage
        preTitle="PARLAY DEL DÍA"
        title={`Parlay ${p.riskLevel.toLowerCase()}`}
        subline={`${p.legs.length} selecciones · Cuota total ${p.totalOdds.toFixed(2)}`}
        seal={`Probabilidad combinada ${(p.combinedProbability * 100).toFixed(1)}% · Análisis Pipeline V9`}
        generatedAt={p.generatedAt}
      />

      <Page pageMeta="Resumen estratégico" pageNumber={2}>
        <SectionHeader eyebrow="Estrategia" title={`Parlay ${p.riskLevel.toLowerCase()}`} />
        <View style={styles.kpiRow}>
          <KPICard label="Selecciones" value={p.legs.length} />
          <KPICard label="Cuota total" value={p.totalOdds.toFixed(2)} />
          <KPICard label="Probabilidad" value={`${(p.combinedProbability * 100).toFixed(1)}%`} />
        </View>
        <Text style={styles.paragraph}>
          Cada selección de este parlay sobrevivió al pipeline completo de validación. La combinación está balanceada para el perfil {p.riskLevel.toLowerCase()}.
        </Text>
        {!p.isPromo && (
          <DataTable
            headers={['Partido', 'Mercado', 'Selección', 'Cuota', 'Prob.']}
            rows={p.legs.map((l) => [l.match, l.market, l.selection, l.odds.toFixed(2), `${l.probability}%`])}
          />
        )}
        {p.isPromo && (
          <Quote>El detalle completo de cada selección y su razonamiento está en derbix.co.</Quote>
        )}
      </Page>

      {!p.isPromo && (
        <Page pageMeta="Análisis profundo" pageNumber={3}>
          <SectionHeader eyebrow="Justificación" title="Por qué este parlay funciona" />
          {p.legs.map((leg, i) => (
            <View key={i} style={{ marginBottom: tokens.spacing.lg }}>
              <Text style={{ fontSize: tokens.fontSize.h3, fontWeight: tokens.fontWeight.semibold, color: tokens.colors.brandAccent, marginBottom: 4 }}>
                {leg.match} — {leg.market}: {leg.selection}
              </Text>
              <Text style={styles.paragraph}>{leg.reasoning}</Text>
            </View>
          ))}
        </Page>
      )}
    </Document>
  );
};
