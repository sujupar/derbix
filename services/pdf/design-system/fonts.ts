// services/pdf/design-system/fonts.ts
import { Font } from '@react-pdf/renderer';

let registered = false;

export function ensureFontsRegistered(): void {
  if (registered) return;
  Font.register({
    family: 'Inter',
    fonts: [
      { src: '/fonts/Inter-Regular.woff', fontWeight: 400 },
      { src: '/fonts/Inter-Medium.woff', fontWeight: 500 },
      { src: '/fonts/Inter-SemiBold.woff', fontWeight: 600 },
      { src: '/fonts/Inter-Bold.woff', fontWeight: 700 },
    ],
  });
  Font.register({
    family: 'Outfit',
    fonts: [
      { src: '/fonts/Outfit-Regular.woff', fontWeight: 400 },
      { src: '/fonts/Outfit-SemiBold.woff', fontWeight: 600 },
      { src: '/fonts/Outfit-Bold.woff', fontWeight: 700 },
    ],
  });
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}
