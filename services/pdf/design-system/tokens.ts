// services/pdf/design-system/tokens.ts
export const tokens = {
  colors: {
    bg: '#0a0a0f',
    bgElevated: '#13131a',
    bgCard: '#181822',
    border: '#1f1f2a',
    borderLight: '#2a2a36',
    brandPrimary: '#10b981',
    brandAccent: '#34d399',
    brandDeep: '#047857',
    textPrimary: '#fafafa',
    textSecondary: '#a1a1aa',
    textMuted: '#71717a',
    textDim: '#52525b',
    success: '#10b981',
    warning: '#f59e0b',
    danger: '#ef4444',
    info: '#3b82f6',
    barGradientStart: '#10b981',
    barGradientEnd: '#3b82f6',
  },
  spacing: {
    xs: 4, sm: 8, md: 12, lg: 16, xl: 24,
    '2xl': 32, '3xl': 48, '4xl': 64, '5xl': 80,
  },
  radius: { sm: 4, md: 8, lg: 12, xl: 16, full: 9999 },
  pageMargin: { top: 48, bottom: 48, left: 40, right: 40 },
  fontFamily: { display: 'Outfit', body: 'Inter' },
  fontSize: {
    display: 32, h1: 22, h2: 16, h3: 13,
    body: 10.5, small: 9, micro: 7.5, kpi: 28,
  },
  fontWeight: { regular: 400, medium: 500, semibold: 600, bold: 700 },
  lineHeight: { tight: 1.1, snug: 1.3, normal: 1.55, relaxed: 1.7 },
} as const;

export type DesignTokens = typeof tokens;
