import React from 'react';
import { View, Text, StyleSheet } from '@react-pdf/renderer';
import { tokens } from '../tokens';

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    backgroundColor: tokens.colors.bgElevated,
    borderRadius: tokens.radius.md,
    padding: tokens.spacing.lg,
    borderLeftWidth: 3,
    borderLeftColor: tokens.colors.brandPrimary,
    marginVertical: tokens.spacing.md,
  },
  text: {
    fontSize: tokens.fontSize.body,
    color: tokens.colors.textPrimary,
    lineHeight: tokens.lineHeight.normal,
    fontStyle: 'italic',
    flex: 1,
  },
});

export const Quote: React.FC<{ children: string }> = ({ children }) => (
  <View style={styles.wrap}>
    <Text style={styles.text}>{children}</Text>
  </View>
);
