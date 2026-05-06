import React from 'react';
import { View, Text, StyleSheet } from '@react-pdf/renderer';
import { tokens } from '../tokens';

const styles = StyleSheet.create({
  wrap: { marginBottom: tokens.spacing.lg },
  eyebrow: {
    fontSize: tokens.fontSize.micro,
    color: tokens.colors.brandAccent,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    fontWeight: tokens.fontWeight.semibold,
    marginBottom: tokens.spacing.xs,
  },
  title: {
    fontFamily: tokens.fontFamily.display,
    fontSize: tokens.fontSize.h1,
    fontWeight: tokens.fontWeight.semibold,
    color: tokens.colors.textPrimary,
    lineHeight: tokens.lineHeight.snug,
    letterSpacing: -0.3,
  },
  bar: {
    width: 36,
    height: 2,
    backgroundColor: tokens.colors.brandPrimary,
    marginTop: tokens.spacing.sm,
  },
});

export const SectionHeader: React.FC<{ eyebrow?: string; title: string }> = ({ eyebrow, title }) => (
  <View style={styles.wrap}>
    {eyebrow && <Text style={styles.eyebrow}>{eyebrow}</Text>}
    <Text style={styles.title}>{title}</Text>
    <View style={styles.bar} />
  </View>
);
