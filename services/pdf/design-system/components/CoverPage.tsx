import React from 'react';
import { Page as RPage, View, Text, StyleSheet } from '@react-pdf/renderer';
import { tokens } from '../tokens';

const styles = StyleSheet.create({
  page: {
    backgroundColor: tokens.colors.bg,
    color: tokens.colors.textPrimary,
    fontFamily: tokens.fontFamily.body,
    paddingHorizontal: tokens.pageMargin.left,
    paddingVertical: tokens.pageMargin.top,
    flexDirection: 'column',
    justifyContent: 'space-between',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.spacing.sm,
  },
  brandText: {
    fontFamily: tokens.fontFamily.display,
    fontWeight: tokens.fontWeight.bold,
    fontSize: 18,
    color: tokens.colors.brandPrimary,
    letterSpacing: 1,
  },
  brandDot: {
    width: 8, height: 8,
    backgroundColor: tokens.colors.brandPrimary,
    borderRadius: 4,
  },
  hero: {
    flexDirection: 'column',
    gap: tokens.spacing.lg,
  },
  preTitle: {
    fontSize: tokens.fontSize.micro,
    color: tokens.colors.brandAccent,
    letterSpacing: 2,
    textTransform: 'uppercase',
    fontWeight: tokens.fontWeight.semibold,
  },
  title: {
    fontFamily: tokens.fontFamily.display,
    fontWeight: tokens.fontWeight.bold,
    fontSize: tokens.fontSize.display,
    lineHeight: tokens.lineHeight.tight,
    color: tokens.colors.textPrimary,
    letterSpacing: -0.5,
  },
  subline: {
    fontSize: tokens.fontSize.body,
    color: tokens.colors.textSecondary,
  },
  divider: {
    height: 2,
    backgroundColor: tokens.colors.brandPrimary,
    width: 60,
    marginVertical: tokens.spacing.md,
  },
  seal: {
    fontSize: tokens.fontSize.small,
    color: tokens.colors.textSecondary,
    lineHeight: tokens.lineHeight.normal,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: tokens.fontSize.micro,
    color: tokens.colors.textMuted,
    letterSpacing: 0.5,
  },
});

interface CoverPageProps {
  preTitle: string;
  title: string;
  subline: string;
  seal: string;
  generatedAt: string;
}

export const CoverPage: React.FC<CoverPageProps> = ({ preTitle, title, subline, seal, generatedAt }) => (
  <RPage size="A4" style={styles.page}>
    <View style={styles.brandRow}>
      <View style={styles.brandDot} />
      <Text style={styles.brandText}>DERBIX</Text>
    </View>
    <View style={styles.hero}>
      <Text style={styles.preTitle}>{preTitle}</Text>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.divider} />
      <Text style={styles.subline}>{subline}</Text>
      <Text style={styles.seal}>{seal}</Text>
    </View>
    <View style={styles.footer}>
      <Text>derbix.co</Text>
      <Text>{generatedAt}</Text>
    </View>
  </RPage>
);
