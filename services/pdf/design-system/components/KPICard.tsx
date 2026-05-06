import React from 'react';
import { View, Text, StyleSheet } from '@react-pdf/renderer';
import { tokens } from '../tokens';

const styles = StyleSheet.create({
  card: {
    flexDirection: 'column',
    gap: tokens.spacing.xs,
    padding: tokens.spacing.lg,
    backgroundColor: tokens.colors.bgCard,
    borderRadius: tokens.radius.lg,
    borderWidth: 0.5,
    borderColor: tokens.colors.borderLight,
    flex: 1,
  },
  label: {
    fontSize: tokens.fontSize.micro,
    color: tokens.colors.textMuted,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    fontWeight: tokens.fontWeight.medium,
  },
  value: {
    fontFamily: tokens.fontFamily.display,
    fontSize: tokens.fontSize.kpi,
    fontWeight: tokens.fontWeight.bold,
    color: tokens.colors.textPrimary,
    lineHeight: 1.0,
    marginTop: tokens.spacing.xs,
  },
  hint: {
    fontSize: tokens.fontSize.small,
    color: tokens.colors.textSecondary,
    marginTop: tokens.spacing.xs,
  },
});

export const KPICard: React.FC<{ label: string; value: string | number; hint?: string }> = ({ label, value, hint }) => (
  <View style={styles.card}>
    <Text style={styles.label}>{label}</Text>
    <Text style={styles.value}>{value}</Text>
    {hint && <Text style={styles.hint}>{hint}</Text>}
  </View>
);
