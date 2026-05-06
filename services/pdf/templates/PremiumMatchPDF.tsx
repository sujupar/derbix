import React from 'react';
import { Document, View, Text, StyleSheet } from '@react-pdf/renderer';
import {
  Page, CoverPage, SectionHeader, Quote,
} from '../design-system/components';
import { tokens } from '../design-system/tokens';
import { ensureFontsRegistered } from '../design-system/fonts';

const styles = StyleSheet.create({
  paragraph: { fontSize: tokens.fontSize.body, color: tokens.colors.textSecondary, lineHeight: tokens.lineHeight.normal, marginBottom: tokens.spacing.md },
  pickCard: {
    backgroundColor: tokens.colors.bgCard,
    borderRadius: tokens.radius.lg,
    padding: tokens.spacing.lg,
    borderLeftWidth: 3,
    borderLeftColor: tokens.colors.brandPrimary,
    marginBottom: tokens.spacing.md,
  },
  pickHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: tokens.spacing.sm },
  pickMarket: { fontSize: tokens.fontSize.h3, fontWeight: tokens.fontWeight.semibold, color: tokens.colors.textPrimary },
  pickConf: { fontSize: tokens.fontSize.small, color: tokens.colors.brandAccent, fontWeight: tokens.fontWeight.semibold, letterSpacing: 0.5 },
  pickSelection: { fontSize: tokens.fontSize.h2, color: tokens.colors.brandAccent, fontWeight: tokens.fontWeight.bold, marginVertical: tokens.spacing.sm },
  pickStats: { flexDirection: 'row', gap: tokens.spacing.lg, marginVertical: tokens.spacing.sm },
  statBlock: { flexDirection: 'column' },
  statLabel: { fontSize: tokens.fontSize.micro, color: tokens.colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  statValue: { fontSize: tokens.fontSize.h3, color: tokens.colors.textPrimary, fontWeight: tokens.fontWeight.bold, marginTop: 2 },
  pickReason: { fontSize: tokens.fontSize.small, color: tokens.colors.textSecondary, lineHeight: tokens.lineHeight.normal, marginTop: tokens.spacing.sm },
});

export interface PremiumPick {
  market: string;
  selection: string;
  probability: number;
  odds: number;
  edge_percent: number;
  confidence: 'ALTA' | 'MEDIA' | 'BAJA';
  reasoning: string;
  survived_skeptic: boolean;
}

export interface PremiumMatchPDFProps {
  homeTeam: string;
  awayTeam: string;
  league: string;
  matchDate: string;
  matchTime: string;
  dataVolume: number;
  finalVerdict: string;
  picks: PremiumPick[];
  skepticAttacks: string[];
  generatedAt: string;
}

export const PremiumMatchPDF: React.FC<PremiumMatchPDFProps> = (p) => {
  ensureFontsRegistered();
  return (
    <Document title={`Pronóstico Premium ${p.homeTeam} vs ${p.awayTeam}`} author="Derbix">
      <CoverPage
        preTitle="PRONÓSTICO PREMIUM"
        title={`${p.homeTeam} vs ${p.awayTeam}`}
        subline={`${p.league} · ${p.matchDate} · ${p.matchTime}`}
        seal={`${p.dataVolume.toLocaleString('es-CO')} datos · Pipeline V9 · ${p.picks.length} picks confirmados`}
        generatedAt={p.generatedAt}
      />

      <Page pageMeta="Veredicto" pageNumber={2}>
        <SectionHeader eyebrow="Veredicto final" title="Picks confirmados" />
        <Text style={styles.paragraph}>{p.finalVerdict}</Text>
        {p.picks.map((pick, i) => (
          <View key={i} style={styles.pickCard}>
            <View style={styles.pickHeader}>
              <Text style={styles.pickMarket}>{pick.market}</Text>
              <Text style={styles.pickConf}>CONFIANZA {pick.confidence}</Text>
            </View>
            <Text style={styles.pickSelection}>{pick.selection}</Text>
            <View style={styles.pickStats}>
              <View style={styles.statBlock}>
                <Text style={styles.statLabel}>Probabilidad</Text>
                <Text style={styles.statValue}>{pick.probability}%</Text>
              </View>
              <View style={styles.statBlock}>
                <Text style={styles.statLabel}>Cuota</Text>
                <Text style={styles.statValue}>{pick.odds.toFixed(2)}</Text>
              </View>
              <View style={styles.statBlock}>
                <Text style={styles.statLabel}>Edge</Text>
                <Text style={styles.statValue}>+{pick.edge_percent.toFixed(1)}%</Text>
              </View>
            </View>
            <Text style={styles.pickReason}>{pick.reasoning}</Text>
          </View>
        ))}
      </Page>

      {p.skepticAttacks.length > 0 && (
        <Page pageMeta="Skeptic" pageNumber={3}>
          <SectionHeader eyebrow="Validación crítica" title="Picks descartados por el Skeptic" />
          <Text style={styles.paragraph}>
            La transparencia incluye lo que descartamos. Estos picks fueron considerados en stages previos pero no sobrevivieron el ataque del análisis crítico.
          </Text>
          {p.skepticAttacks.map((a, i) => (
            <Quote key={i}>{a}</Quote>
          ))}
        </Page>
      )}
    </Document>
  );
};
