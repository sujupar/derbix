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
  paragraphPrimary: {
    fontSize: tokens.fontSize.body,
    color: tokens.colors.textPrimary,
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
  subTitle: {
    fontSize: tokens.fontSize.h3,
    fontWeight: tokens.fontWeight.semibold,
    color: tokens.colors.brandAccent,
    marginTop: tokens.spacing.lg,
    marginBottom: tokens.spacing.sm,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  glossaryItem: {
    flexDirection: 'row',
    gap: tokens.spacing.sm,
    marginBottom: tokens.spacing.sm,
  },
  glossaryTerm: {
    fontSize: tokens.fontSize.small,
    color: tokens.colors.brandAccent,
    fontWeight: tokens.fontWeight.semibold,
    width: 80,
  },
  glossaryDef: {
    fontSize: tokens.fontSize.small,
    color: tokens.colors.textSecondary,
    flex: 1,
    lineHeight: tokens.lineHeight.normal,
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
  homeXGA?: number;
  awayXGA?: number;
  daysRestHome?: number;
  daysRestAway?: number;
  homeForm: string[];
  awayForm: string[];
  weatherDesc?: string | null;
  refereeName?: string | null;
  homeKeyMissing?: string[];
  awayKeyMissing?: string[];
  explicacionDetallada?: string;
  matchupTactico?: string;
  contextoExterno?: string;
  factorPsicologico?: string;
  consejosApostador?: string[];
  puntosClave?: string[];
  marketIntensities: Array<{ category: string; intensity: 1 | 2 | 3 | 4 | 5 }>;
  generatedAt: string;
  matchUrl: string;
}

// Split a long string into paragraphs (by double newline or every ~400 chars)
function splitIntoParagraphs(text: string): string[] {
  if (!text) return [];
  const byNewlines = text.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  if (byNewlines.length > 1) return byNewlines;
  // Single paragraph — split by sentence boundaries every ~400 chars for readability
  if (text.length <= 500) return [text];
  const sentences = text.split(/(?<=[.!?])\s+/);
  const out: string[] = [];
  let current = '';
  for (const s of sentences) {
    if (current.length + s.length > 400 && current.length > 0) {
      out.push(current.trim());
      current = s;
    } else {
      current += (current ? ' ' : '') + s;
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

export const PromoMatchPDF: React.FC<PromoMatchPDFProps> = (p) => {
  ensureFontsRegistered();

  const explicacionParrafos = splitIntoParagraphs(p.explicacionDetallada || '');
  const matchupParrafos = splitIntoParagraphs(p.matchupTactico || '');
  const contextoParrafos = splitIntoParagraphs(p.contextoExterno || '');
  const factorParrafos = splitIntoParagraphs(p.factorPsicologico || '');

  return (
    <Document
      title={`Análisis ${p.homeTeam} vs ${p.awayTeam}`}
      author="Derbix"
      subject={`Análisis técnico del partido ${p.homeTeam} vs ${p.awayTeam}`}
    >
      {/* Cover */}
      <CoverPage
        preTitle="ANÁLISIS TÉCNICO"
        title={`${p.homeTeam} vs ${p.awayTeam}`}
        subline={`${p.league}${p.matchDate ? ' · ' + p.matchDate : ''}${p.matchTime && p.matchTime !== '—' ? ' · ' + p.matchTime : ''}`}
        seal={`${p.dataVolume.toLocaleString('es-CO')} datos analizados · 6 modelos especializados · Consenso alcanzado`}
        generatedAt={p.generatedAt}
      />

      {/* Page 2: Resumen Ejecutivo + KPIs */}
      <Page pageMeta="Resumen ejecutivo" pageNumber={2}>
        <SectionHeader eyebrow="Resumen" title="Lo que los datos están diciendo" />
        <View style={styles.kpiRow}>
          <KPICard label="Datos analizados" value={p.dataVolume.toLocaleString('es-CO')} />
          <KPICard label="Score estadístico" value={p.statisticalScore} hint="0-100" />
          <KPICard label="Score contextual" value={p.contextualScore} hint="0-100" />
        </View>

        {explicacionParrafos.length > 0 ? (
          explicacionParrafos.slice(0, 3).map((para, idx) => (
            <Text key={idx} style={idx === 0 ? styles.paragraphPrimary : styles.paragraph}>{para}</Text>
          ))
        ) : (
          <Text style={styles.paragraph}>
            Hemos analizado este partido con la cadena completa de modelos: razonamiento estadístico, choque táctico, contexto externo, lectura de mercado y validación crítica. El consenso de los modelos quedó plasmado en los puntos clave a continuación.
          </Text>
        )}

        {p.puntosClave && p.puntosClave.length > 0 && (
          <View style={styles.bullets}>
            {p.puntosClave.slice(0, 5).map((pt, i) => (
              <View key={i} style={styles.bulletRow}>
                <View style={styles.bulletDot} />
                <Text style={styles.bulletText}>{pt}</Text>
              </View>
            ))}
          </View>
        )}

        <Quote>El consenso es claro. El pronóstico exacto y la cuota recomendada están en derbix.co.</Quote>
      </Page>

      {/* Page 3: Local */}
      <Page pageMeta={p.homeTeam} pageNumber={3}>
        <SectionHeader eyebrow="Equipo local" title={p.homeTeam} />
        <View style={styles.kpiRow}>
          <KPICard label="Forma reciente" value={p.homeStreak} hint="Últimos 5 partidos" />
          <KPICard label="xG ofensivo" value={p.homeXG.toFixed(2)} hint="Goles esperados / partido" />
          <KPICard label="xG defensivo" value={(p.homeXGA ?? 1.2).toFixed(2)} hint="Goles permitidos esperados" />
        </View>
        <Text style={styles.paragraph}>
          La métrica xG (goles esperados) refleja la calidad y cantidad de oportunidades creadas. Un xG superior a 1.7 indica un ataque consistente; uno por debajo de 1.0, un ataque pobre. La forma reciente muestra resultado por resultado.
        </Text>
        {p.homeForm && p.homeForm.length > 0 && (
          <DataTable
            headers={['Partido', 'Resultado']}
            rows={p.homeForm.slice(0, 5).map((f, i) => [`#${i + 1}`, f])}
          />
        )}
        {p.homeKeyMissing && p.homeKeyMissing.length > 0 && (
          <>
            <Text style={styles.subTitle}>Bajas relevantes</Text>
            <View style={styles.bullets}>
              {p.homeKeyMissing.map((player, i) => (
                <View key={i} style={styles.bulletRow}>
                  <View style={styles.bulletDot} />
                  <Text style={styles.bulletText}>{player}</Text>
                </View>
              ))}
            </View>
          </>
        )}
      </Page>

      {/* Page 4: Visitante */}
      <Page pageMeta={p.awayTeam} pageNumber={4}>
        <SectionHeader eyebrow="Equipo visitante" title={p.awayTeam} />
        <View style={styles.kpiRow}>
          <KPICard label="Forma reciente" value={p.awayStreak} hint="Últimos 5 partidos" />
          <KPICard label="xG ofensivo" value={p.awayXG.toFixed(2)} hint="Goles esperados / partido" />
          <KPICard label="xG defensivo" value={(p.awayXGA ?? 1.3).toFixed(2)} hint="Goles permitidos esperados" />
        </View>
        <Text style={styles.paragraph}>
          Los equipos visitantes pierden en promedio un 8% de su rendimiento por la condición de visita. xG visitante superior a 1.5 sigue siendo notable. La forma reciente captura el momento del equipo en sus últimos 5 compromisos.
        </Text>
        {p.awayForm && p.awayForm.length > 0 && (
          <DataTable
            headers={['Partido', 'Resultado']}
            rows={p.awayForm.slice(0, 5).map((f, i) => [`#${i + 1}`, f])}
          />
        )}
        {p.awayKeyMissing && p.awayKeyMissing.length > 0 && (
          <>
            <Text style={styles.subTitle}>Bajas relevantes</Text>
            <View style={styles.bullets}>
              {p.awayKeyMissing.map((player, i) => (
                <View key={i} style={styles.bulletRow}>
                  <View style={styles.bulletDot} />
                  <Text style={styles.bulletText}>{player}</Text>
                </View>
              ))}
            </View>
          </>
        )}
      </Page>

      {/* Page 5: Análisis Táctico Profundo */}
      {(matchupParrafos.length > 0 || p.matchupTactico) && (
        <Page pageMeta="Análisis táctico" pageNumber={5}>
          <SectionHeader eyebrow="Táctica" title="Choque de estilos y modelos" />
          {matchupParrafos.length > 0 ? (
            matchupParrafos.map((para, idx) => (
              <Text key={idx} style={styles.paragraph}>{para}</Text>
            ))
          ) : (
            <Text style={styles.paragraph}>{p.matchupTactico}</Text>
          )}
          <View style={styles.kpiRow}>
            <KPICard label="Días descanso local" value={p.daysRestHome ?? 7} />
            <KPICard label="Días descanso visitante" value={p.daysRestAway ?? 7} />
          </View>
          <Text style={styles.paragraph}>
            El descanso entre partidos es un factor que muchos analistas pasan por alto. Menos de 4 días entre encuentros típicamente reduce la intensidad física y permite menos ajustes tácticos del cuerpo técnico.
          </Text>
        </Page>
      )}

      {/* Page 6: Contexto externo */}
      {(contextoParrafos.length > 0 || factorParrafos.length > 0 || p.weatherDesc || p.refereeName) && (
        <Page pageMeta="Contexto externo" pageNumber={6}>
          <SectionHeader eyebrow="Contexto" title="Lo que está fuera de los números" />
          {contextoParrafos.map((para, idx) => (
            <Text key={`c${idx}`} style={styles.paragraph}>{para}</Text>
          ))}
          {factorParrafos.length > 0 && (
            <>
              <Text style={styles.subTitle}>Factor psicológico</Text>
              {factorParrafos.map((para, idx) => (
                <Text key={`f${idx}`} style={styles.paragraph}>{para}</Text>
              ))}
            </>
          )}
          {(p.weatherDesc || p.refereeName) && (
            <View style={styles.bullets}>
              {p.weatherDesc && (
                <View style={styles.bulletRow}>
                  <View style={styles.bulletDot} />
                  <Text style={styles.bulletText}>Clima previsto: {p.weatherDesc}</Text>
                </View>
              )}
              {p.refereeName && (
                <View style={styles.bulletRow}>
                  <View style={styles.bulletDot} />
                  <Text style={styles.bulletText}>Árbitro asignado: {p.refereeName}</Text>
                </View>
              )}
            </View>
          )}
        </Page>
      )}

      {/* Page 7: Mercado */}
      <Page pageMeta="Lectura del mercado" pageNumber={7}>
        <SectionHeader eyebrow="Mercado" title="Categorías con valor detectado" />
        <Text style={styles.paragraph}>
          Sin revelar la selección específica: estas son las categorías de mercados donde nuestro modelo encuentra discrepancias entre la cuota actual y la probabilidad real. Más puntos verdes = más valor detectado en esa categoría.
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
        <Quote>Las categorías con mayor intensidad muestran cuota desalineada con la probabilidad real. La selección exacta y el razonamiento completo están en la plataforma.</Quote>
      </Page>

      {/* Page 8: Consejos del Analista (educativo) */}
      {p.consejosApostador && p.consejosApostador.length > 0 && (
        <Page pageMeta="Consejos del analista" pageNumber={8}>
          <SectionHeader eyebrow="Educativo" title="Cómo pensar este tipo de partidos" />
          <Text style={styles.paragraph}>
            Apostar con éxito a largo plazo no se trata de adivinar — se trata de tomar decisiones consistentes basadas en datos. Estos son los principios que aplicamos a este tipo de encuentros:
          </Text>
          <View style={styles.bullets}>
            {p.consejosApostador.slice(0, 5).map((tip, i) => (
              <View key={i} style={styles.bulletRow}>
                <View style={styles.bulletDot} />
                <Text style={styles.bulletText}>{tip}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.subTitle}>Glosario rápido</Text>
          <View style={styles.glossaryItem}>
            <Text style={styles.glossaryTerm}>xG:</Text>
            <Text style={styles.glossaryDef}>Goles esperados. Mide la calidad de las oportunidades creadas, no solo cuántos goles se anotaron.</Text>
          </View>
          <View style={styles.glossaryItem}>
            <Text style={styles.glossaryTerm}>Edge:</Text>
            <Text style={styles.glossaryDef}>Diferencia porcentual entre la probabilidad real estimada y la probabilidad implícita en la cuota. A mayor edge, mayor valor.</Text>
          </View>
          <View style={styles.glossaryItem}>
            <Text style={styles.glossaryTerm}>BTTS:</Text>
            <Text style={styles.glossaryDef}>Both Teams To Score. Apuesta a que ambos equipos anoten al menos un gol.</Text>
          </View>
          <View style={styles.glossaryItem}>
            <Text style={styles.glossaryTerm}>Over/Under:</Text>
            <Text style={styles.glossaryDef}>Apuesta sobre si el total de goles superará o quedará por debajo de un número (ej. Over 2.5 = más de 2 goles).</Text>
          </View>
        </Page>
      )}

      {/* Page 9: CTA */}
      <Page pageMeta="Acceso al pronóstico" pageNumber={9}>
        <View style={{ marginTop: tokens.spacing['2xl'], gap: tokens.spacing['2xl'] }}>
          <CTAFooter
            headline="El pronóstico exacto está esperándote"
            sub="Pronóstico, cuota recomendada, mercado óptimo y razonamiento completo. Solo en derbix.co."
            url={p.matchUrl}
          />
          <Quote>Sin estafas. Sin tipsters falsos. Sin pálpitos. Solo el dato que sobrevive al escrutinio.</Quote>
        </View>
      </Page>

      {/* Page 10: Sobre Derbix + Disclaimer */}
      <Page pageMeta="Sobre Derbix" pageNumber={10}>
        <SectionHeader eyebrow="Plataforma" title="Inteligencia deportiva, no opinión" />
        <Text style={styles.paragraph}>
          Derbix analiza miles de datos por partido a través de modelos matemáticos, contexto externo y razonamiento crítico. No tomamos decisiones por intuición ni por simpatía. Cada pronóstico se construye sobre evidencia que sobrevive a múltiples capas de validación.
        </Text>
        <Divider />
        <Text style={styles.paragraph}>
          El objetivo no es acertar todos los partidos. El objetivo es que tu cuenta de apuestas tenga consistencia matemática a lo largo del tiempo. La diferencia entre un apostador amateur y un profesional no es la cantidad de aciertos, sino la disciplina del proceso.
        </Text>
        <Text style={styles.disclaimer}>
          AVISO LEGAL: Las apuestas deportivas implican riesgo financiero. Apuesta solo lo que puedas permitirte perder. Derbix proporciona análisis estadístico — no garantiza resultados. Verifica las regulaciones de tu jurisdicción y juega con responsabilidad.
        </Text>
      </Page>
    </Document>
  );
};
