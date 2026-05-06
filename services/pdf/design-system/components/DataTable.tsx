import React from 'react';
import { View, Text, StyleSheet } from '@react-pdf/renderer';
import { tokens } from '../tokens';

const styles = StyleSheet.create({
  wrap: {
    borderWidth: 0.5,
    borderColor: tokens.colors.border,
    borderRadius: tokens.radius.md,
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    backgroundColor: tokens.colors.bgElevated,
    paddingVertical: tokens.spacing.sm,
    paddingHorizontal: tokens.spacing.md,
  },
  bodyRow: {
    flexDirection: 'row',
    paddingVertical: tokens.spacing.sm,
    paddingHorizontal: tokens.spacing.md,
    borderTopWidth: 0.5,
    borderTopColor: tokens.colors.border,
  },
  zebraRow: {
    backgroundColor: tokens.colors.bgCard,
  },
  cell: {
    flex: 1,
    fontSize: tokens.fontSize.small,
    color: tokens.colors.textPrimary,
  },
  headerCell: {
    flex: 1,
    fontSize: tokens.fontSize.micro,
    color: tokens.colors.textMuted,
    fontWeight: tokens.fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});

interface DataTableProps {
  headers: string[];
  rows: string[][];
}

export const DataTable: React.FC<DataTableProps> = ({ headers, rows }) => (
  <View style={styles.wrap}>
    <View style={styles.headerRow}>
      {headers.map((h, i) => <Text key={i} style={styles.headerCell}>{h}</Text>)}
    </View>
    {rows.map((row, r) => (
      <View key={r} style={[styles.bodyRow, r % 2 === 1 ? styles.zebraRow : {}]}>
        {row.map((cell, c) => <Text key={c} style={styles.cell}>{cell}</Text>)}
      </View>
    ))}
  </View>
);
