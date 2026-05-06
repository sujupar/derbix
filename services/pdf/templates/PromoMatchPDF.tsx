import React from 'react';
import { Document, View, Text, StyleSheet } from '@react-pdf/renderer';
import {
  Page, CoverPage, SectionHeader, KPICard, Quote, CTAFooter, DataTable, Divider,
} from '../design-system/components';
import { tokens } from '../design-system/tokens';
import { ensureFontsRegistered } from '../design-system/fonts';

const styles = StyleSheet.create({
  paragraph: {
    fontSize: tokens.fontSize.body,
    color: tokens.colors.textSecondary,
    lineHeight: tokens.lineHeight.normal,
    marginBottom: tokens.spacing.md,
  },
  bullets: { flexDirection: 'column', gap: tokens.spacing.sm, marginVertical: tokens.spacing.lg },
  bulletRow: { flexDirection: 'row', gap: tokens.spacing.md, alignItems: 'flex-start' },
  bulletDot: {
    width: 4, height: 4, borderRadius: 2,
    backgroundColor: tokens.colors.brandPrimary,
    marginTop: 6,
  },
  bulletText: {
    flex: 1,
    fontSize: tokens.fontSize.body,
    color: tokens.colors.textPrimary,
    lineHeight: tokens.lineHeight.normal,
  },
  kpiRow: { flexDirection: 'row', gap: tokens.spacing.md, marginVertical: tokens.spacing.lg },
  marketGrid: { flexDirection: 'column', gap: tokens.spacing.sm, marginTop: tokens.spacing.md },
  marketRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: tokens.spacing.sm,
    borderBottomWidth: 0.5,
    borderBottomColor: tokens.colors.border,
  },
  marketLabel: { fontSize: tokens.fontSize.body, color: tokens.colors.textPrimary, fontWeight: tokens.fontWeight.medium },
  marketDots: { flexDirection: 'row', gap: 4 },
  dotFilled: { width: 8, height: 8, borderRadius: 4, backgroundColor: tokens.colors.brandPrimary },
  dotEmpty: { width: 8, height: 8, borderRadius: 4, backgroundColor: tokens.colors.border },
  disclaimer: {
    fontSize: tokens.fontSize.small,
    color: tokens.colors.textMuted,
    lineHeight: tokens.lineHeight.normal,
    marginTop: tokens.spacing.lg,
  },
});

export interface PromoMatchPDFProps {
  homeTeam: string;
  awayTeam: string;
  league: string;
  matchDate: string;
  matchTime: string;
  dataVolume: number;
  statisticalScore: number;
  contextualScore: number;
  homeStreak: string;
  awayStreak: string;
  homeXG: number;
  awayXG: number;
  homeForm: string[];
  awayForm: string[];
  weatherDesc?: string | null;
  refereeName?: string | null;
  marketIntensities: Array<{ category: string; intensity: 1 | 2 | 3 | 4 | 5 }>;
  generatedAt: string;
  matchUrl: string;
}

export const PromoMatchPDF: React.FC<PromoMatchPDFProps> = (p) => {
  ensureFontsRegistered();
  return (
    <Document
      title={`Análisis ${p.homeTeam} vs ${p.awayTeam}`}
      author="Derbix"
      subject={`Análisis técnico del partido ${p.homeTeam} vs ${p.awayTeam}`}
    >
      <CoverPage
        preTitle="ANÁLISIS TÉCNICO"
        title={`${p.homeTeam} vs ${p.awayTeam}`}
        subline={`${p.league} · ${p.matchDate} · ${p.matchTime}`}
        seal={`${p.dataVolume.toLocaleString('es-CO')} datos analizados · 6 modelos especializados · Consenso alcanzado`}
        generatedAt={p.generatedAt}
      />

      <Page pageMeta="Resumen ejecutivo" pageNumber={2}>
        <SectionHeader eyebrow="Resumen" title="Lo que los datos están diciendo" />
        <View style={styles.kpiRow}>
          <KPICard label="Datos analizados" value={p.dataVolume.toLocaleString('es-CO')} />
          <KPICard label="Score estadístico" value={p.statisticalScore} hint="0-100" />
          <KPICard label="Score contextual" value={p.contextualScore} hint="0-100" />
        </View>
        <Text style={styles.paragraph}>
          Hemos pasado este partido por nuestra cadena completa de análisis: razonamiento estadístico, choque táctico, contexto externo, lectura de mercado y validación crítica. El resultado del consenso es inequívoco.
        </Text>
        <View style={styles.bullets}>
          <View style={styles.bulletRow}>
            <View style={styles.bulletDot} />
            <Text style={styles.bulletText}>Diferencia significativa de xG en los últimos 10 partidos entre ambos equipos.</Text>
          </View>
          <View style={styles.bulletRow}>
            <View style={styles.bulletDot} />
            <Text style={styles.bulletText}>Cambios relevantes en alineaciones probables impactan el balance del partido.</Text>
          </View>
          <View style={styles.bulletRow}>
            <View style={styles.bulletDot} />
            <Text style={styles.bulletText}>La cuota actual del mercado no refleja completamente lo que los datos están mostrando.</Text>
          </View>
        </View>
        <Quote>El consenso es claro. El pronóstico exacto y la cuota recomendada están en derbix.co.</Quote>
      </Page>

      <Page pageMeta={p.homeTeam} pageNumber={3}>
        <SectionHeader eyebrow="Equipo local" title={p.homeTeam} />
        <View style={styles.kpiRow}>
          <KPICard label="Forma reciente" value={p.homeStreak} hint="Últimos 5 partidos" />
          <KPICard label="xG por partido" value={p.homeXG.toFixed(2)} hint="Últimos 10" />
        </View>
        <Text style={styles.paragraph}>
          Análisis del rendimiento ofensivo y defensivo reciente del equipo local. Los números cuentan una historia consistente.
        </Text>
        <DataTable
          headers={['Partido', 'Resultado']}
          rows={p.homeForm.map((f, i) => [`#${i + 1}`, f])}
        />
      </Page>

      <Page pageMeta={p.awayTeam} pageNumber={4}>
        <SectionHeader eyebrow="Equipo visitante" title={p.awayTeam} />
        <View style={styles.kpiRow}>
          <KPICard label="Forma reciente" value={p.awayStreak} hint="Últimos 5 partidos" />
          <KPICard label="xG por partido" value={p.awayXG.toFixed(2)} hint="Últimos 10" />
        </View>
        <Text style={styles.paragraph}>
          Análisis del rendimiento ofensivo y defensivo reciente del equipo visitante. Los números cuentan una historia consistente.
        </Text>
        <DataTable
          headers={['Partido', 'Resultado']}
          rows={p.awayForm.map((f, i) => [`#${i + 1}`, f])}
        />
      </Page>

      <Page pageMeta="Factores contextuales" pageNumber={5}>
        <SectionHeader eyebrow="Contexto" title="Factores no estadísticos" />
        <Text style={styles.paragraph}>
          Más allá de los números crudos, hay condiciones que el modelo integra para refinar la lectura del partido.
        </Text>
        <View style={styles.bullets}>
          {p.weatherDesc && (
            <View style={styles.bulletRow}>
              <View style={styles.bulletDot} />
              <Text style={styles.bulletText}>Clima: {p.weatherDesc}</Text>
            </View>
          )}
          {p.refereeName && (
            <View style={styles.bulletRow}>
              <View style={styles.bulletDot} />
              <Text style={styles.bulletText}>Árbitro asignado: {p.refereeName}</Text>
            </View>
          )}
          <View style={styles.bulletRow}>
            <View style={styles.bulletDot} />
            <Text style={styles.bulletText}>Análisis de fatiga acumulada de jornadas previas y descanso entre partidos.</Text>
          </View>
          <View style={styles.bulletRow}>
            <View style={styles.bulletDot} />
            <Text style={styles.bulletText}>Identificación de lesiones / ausencias clave y su impacto cualitativo.</Text>
          </View>
        </View>
      </Page>

      <Page pageMeta="Lectura del mercado" pageNumber={6}>
        <SectionHeader eyebrow="Mercado" title="Categorías con valor detectado" />
        <Text style={styles.paragraph}>
          Sin revelar selecciones específicas: estas son las categorías de mercados donde nuestro modelo encuentra discrepancias con la cuota actual. La intensidad es relativa.
        </Text>
        <View style={styles.marketGrid}>
          {p.marketIntensities.map((m, i) => (
            <View key={i} style={styles.marketRow}>
              <Text style={styles.marketLabel}>{m.category}</Text>
              <View style={styles.marketDots}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <View key={n} style={n <= m.intensity ? styles.dotFilled : styles.dotEmpty} />
                ))}
              </View>
            </View>
          ))}
        </View>
        <Quote>Las categorías con mayor intensidad son las que muestran cuota desalineada con la probabilidad real. La selección exacta y la justificación están en la plataforma.</Quote>
      </Page>

      <Page pageMeta="Acceso al pronóstico" pageNumber={7}>
        <View style={{ marginTop: tokens.spacing['2xl'], gap: tokens.spacing['2xl'] }}>
          <CTAFooter
            headline="El pronóstico exacto está esperándote"
            sub="Pronóstico, cuota recomendada, mercado óptimo y razonamiento completo. Solo en derbix.co."
            url={p.matchUrl}
          />
          <Quote>Sin estafas. Sin tipsters falsos. Sin pálpitos. Solo el dato que sobrevive al escrutinio.</Quote>
        </View>
      </Page>

      <Page pageMeta="Sobre Derbix" pageNumber={8}>
        <SectionHeader eyebrow="Plataforma" title="Inteligencia deportiva, no opinión" />
        <Text style={styles.paragraph}>
          Derbix analiza miles de datos por partido a través de modelos matemáticos, contexto externo y razonamiento crítico. No tomamos decisiones por intuición ni por simpatía. Cada pronóstico se construye sobre evidencia que sobrevive a múltiples capas de validación.
        </Text>
        <Divider />
        <Text style={styles.paragraph}>
          El objetivo no es acertar todos los partidos. El objetivo es que tu cuenta de apuestas tenga consistencia matemática a lo largo del tiempo.
        </Text>
        <Text style={styles.disclaimer}>
          AVISO LEGAL: Las apuestas deportivas implican riesgo financiero. Apuesta solo lo que puedas permitirte perder. Derbix proporciona análisis estadístico — no garantiza resultados. Verifica las regulaciones de tu jurisdicción y juega con responsabilidad.
        </Text>
      </Page>
    </Document>
  );
};
