import React from 'react';
import { View, Text, StyleSheet } from '@react-pdf/renderer';
import { tokens } from '../tokens';

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: tokens.colors.brandPrimary,
    padding: tokens.spacing.xl,
    borderRadius: tokens.radius.lg,
    flexDirection: 'column',
    alignItems: 'center',
    gap: tokens.spacing.sm,
  },
  headline: {
    fontFamily: tokens.fontFamily.display,
    fontSize: tokens.fontSize.h1,
    fontWeight: tokens.fontWeight.bold,
    color: tokens.colors.bg,
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  sub: {
    fontSize: tokens.fontSize.body,
    color: tokens.colors.bg,
    textAlign: 'center',
    opacity: 0.85,
  },
  url: {
    fontSize: tokens.fontSize.h2,
    fontWeight: tokens.fontWeight.semibold,
    color: tokens.colors.bg,
    marginTop: tokens.spacing.sm,
    letterSpacing: 0.5,
  },
});

export const CTAFooter: React.FC<{ headline: string; sub: string; url: string }> = ({ headline, sub, url }) => (
  <View style={styles.wrap}>
    <Text style={styles.headline}>{headline}</Text>
    <Text style={styles.sub}>{sub}</Text>
    <Text style={styles.url}>{url}</Text>
  </View>
);
