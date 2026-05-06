import React from 'react';
import { View, StyleSheet } from '@react-pdf/renderer';
import { tokens } from '../tokens';

const styles = StyleSheet.create({
  line: {
    height: 0.5,
    backgroundColor: tokens.colors.border,
    marginVertical: tokens.spacing.lg,
  },
});

export const Divider: React.FC = () => <View style={styles.line} />;
