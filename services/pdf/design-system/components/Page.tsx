import React from 'react';
import { Page as RPage, View, Text, StyleSheet } from '@react-pdf/renderer';
import { tokens } from '../tokens';

const styles = StyleSheet.create({
  page: {
    backgroundColor: tokens.colors.bg,
    color: tokens.colors.textPrimary,
    fontFamily: tokens.fontFamily.body,
    fontSize: tokens.fontSize.body,
    paddingTop: tokens.pageMargin.top,
    paddingBottom: tokens.pageMargin.bottom,
    paddingLeft: tokens.pageMargin.left,
    paddingRight: tokens.pageMargin.right,
  },
  pageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: tokens.spacing['2xl'],
    paddingBottom: tokens.spacing.sm,
    borderBottomWidth: 0.5,
    borderBottomColor: tokens.colors.border,
  },
  brandText: {
    fontFamily: tokens.fontFamily.display,
    fontWeight: tokens.fontWeight.bold,
    fontSize: tokens.fontSize.body,
    color: tokens.colors.brandPrimary,
    letterSpacing: 0.5,
  },
  meta: {
    fontSize: tokens.fontSize.micro,
    color: tokens.colors.textMuted,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  pageFooter: {
    position: 'absolute',
    bottom: tokens.pageMargin.bottom / 2,
    left: tokens.pageMargin.left,
    right: tokens.pageMargin.right,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: tokens.fontSize.micro,
    color: tokens.colors.textDim,
  },
});

interface PageProps {
  children: React.ReactNode;
  pageMeta?: string;
  pageNumber?: number;
}

export const Page: React.FC<PageProps> = ({ children, pageMeta, pageNumber }) => (
  <RPage size="A4" style={styles.page}>
    <View style={styles.pageHeader}>
      <Text style={styles.brandText}>DERBIX</Text>
      {pageMeta && <Text style={styles.meta}>{pageMeta}</Text>}
    </View>
    {children}
    <View style={styles.pageFooter}>
      <Text>derbix.co</Text>
      <Text>{pageNumber !== undefined ? `· ${pageNumber} ·` : ''}</Text>
      <Text>Sin estafas. Sin tipsters. Solo datos.</Text>
    </View>
  </RPage>
);
