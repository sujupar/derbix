import React from 'react';
import { View, Text, StyleSheet } from '@react-pdf/renderer';
import { tokens } from '../tokens';

const styles = StyleSheet.create({
  wrap: { flexDirection: 'column', gap: tokens.spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.md },
  label: { width: 120, fontSize: tokens.fontSize.small, color: tokens.colors.textSecondary },
  trackOuter: {
    flex: 1,
    height: 12,
    backgroundColor: tokens.colors.bgElevated,
    borderRadius: tokens.radius.sm,
    overflow: 'hidden',
  },
  fill: { height: '100%', backgroundColor: tokens.colors.brandPrimary, borderRadius: tokens.radius.sm },
  value: { width: 50, fontSize: tokens.fontSize.small, color: tokens.colors.textPrimary, textAlign: 'right', fontWeight: tokens.fontWeight.semibold },
});

interface BarChartItem { label: string; value: number; max: number; suffix?: string; }

export const BarChart: React.FC<{ items: BarChartItem[] }> = ({ items }) => (
  <View style={styles.wrap}>
    {items.map((it, i) => {
      const pct = Math.max(2, Math.min(100, (it.value / it.max) * 100));
      return (
        <View key={i} style={styles.row}>
          <Text style={styles.label}>{it.label}</Text>
          <View style={styles.trackOuter}>
            <View style={[styles.fill, { width: `${pct}%` }]} />
          </View>
          <Text style={styles.value}>{it.value}{it.suffix || ''}</Text>
        </View>
      );
    })}
  </View>
);
