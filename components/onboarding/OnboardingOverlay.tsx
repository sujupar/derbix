import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';

interface Step {
  target: string;
  title: string;
  subtitle: string;
  icon: string;
}

const STEPS: Step[] = [
  {
    target: '[data-onboarding="tab-opportunities"]',
    title: 'Tus Oportunidades',
    subtitle: 'Picks con mejor valor, listos para apostar',
    icon: '\uD83C\uDFC6',
  },
  {
    target: '[data-onboarding="results"]',
    title: 'Resultados Reales',
    subtitle: 'Track record p\u00FAblico y verificable',
    icon: '\uD83D\uDCCA',
  },
  {
    target: '[data-onboarding="plan-badge"]',
    title: 'Tu Plan',
    subtitle: 'Actualiza cuando quieras',
    icon: '\uD83D\uDE80',
  },
];

interface OnboardingOverlayProps {
  currentStep: number;
  totalSteps: number;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
  onComplete: () => void;
}

export const OnboardingOverlay: React.FC<OnboardingOverlayProps> = ({
  currentStep,
  totalSteps,
  onNext,
  onPrev,
  onSkip,
  onComplete,
}) => {
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const step = STEPS[currentStep];
  const isLastStep = currentStep === totalSteps - 1;

  const updateTargetRect = useCallback(() => {
    if (!step) return;
    const el = document.querySelector(step.target);
    if (el) {
      const rect = el.getBoundingClientRect();
      setTargetRect(rect);
    }
  }, [step]);

  useEffect(() => {
    // Small delay to ensure DOM is ready
    const timer = setTimeout(updateTargetRect, 100);
    window.addEventListener('resize', updateTargetRect);
    window.addEventListener('scroll', updateTargetRect, true);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updateTargetRect);
      window.removeEventListener('scroll', updateTargetRect, true);
    };
  }, [updateTargetRect]);

  // Spotlight clip-path: creates a "hole" around the target element
  const getClipPath = () => {
    if (!targetRect) return 'none';
    const pad = 8;
    const x = targetRect.left - pad;
    const y = targetRect.top - pad;
    const w = targetRect.width + pad * 2;
    const h = targetRect.height + pad * 2;
    const r = 12;

    // Outer rectangle (full screen) + inner rounded rectangle (hole)
    return `
      M 0 0
      H ${window.innerWidth}
      V ${window.innerHeight}
      H 0
      Z
      M ${x + r} ${y}
      H ${x + w - r}
      Q ${x + w} ${y} ${x + w} ${y + r}
      V ${y + h - r}
      Q ${x + w} ${y + h} ${x + w - r} ${y + h}
      H ${x + r}
      Q ${x} ${y + h} ${x} ${y + h - r}
      V ${y + r}
      Q ${x} ${y} ${x + r} ${y}
      Z
    `;
  };

  // Position the tooltip card relative to the target
  const getTooltipStyle = (): React.CSSProperties => {
    if (!targetRect) {
      return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
    }

    const tooltipWidth = 320;
    const tooltipHeight = 200;
    const gap = 16;

    // Prefer bottom placement, fallback to top if not enough space
    let top = targetRect.bottom + gap;
    let left = targetRect.left + targetRect.width / 2 - tooltipWidth / 2;

    // If tooltip goes below viewport, place above
    if (top + tooltipHeight > window.innerHeight - 20) {
      top = targetRect.top - tooltipHeight - gap;
    }

    // Clamp horizontally
    left = Math.max(16, Math.min(left, window.innerWidth - tooltipWidth - 16));
    top = Math.max(16, top);

    return { top, left, width: tooltipWidth };
  };

  return createPortal(
    <div className="fixed inset-0 z-[95]">
      {/* Dark overlay with spotlight hole */}
      <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: 'auto' }}>
        <path
          d={getClipPath()}
          fill="rgba(0, 0, 0, 0.80)"
          fillRule="evenodd"
          onClick={onSkip}
          style={{ cursor: 'pointer' }}
        />
      </svg>

      {/* Spotlight ring around target */}
      {targetRect && (
        <div
          className="absolute rounded-xl ring-2 ring-brand/60 shadow-[0_0_20px_rgba(16,185,129,0.3)] pointer-events-none transition-all duration-300"
          style={{
            top: targetRect.top - 8,
            left: targetRect.left - 8,
            width: targetRect.width + 16,
            height: targetRect.height + 16,
          }}
        />
      )}

      {/* Tooltip card */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentStep}
          className="absolute pointer-events-auto"
          style={getTooltipStyle()}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.25 }}
        >
          <div className="bg-dx-surface/95 backdrop-blur-xl border border-dx-border rounded-2xl p-5 shadow-2xl">
            {/* Icon + Title */}
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">{step?.icon}</span>
              <h3 className="text-white font-bold text-lg">{step?.title}</h3>
            </div>

            {/* Subtitle */}
            <p className="text-dx-text-soft text-sm mb-5 pl-10">{step?.subtitle}</p>

            {/* Navigation */}
            <div className="flex items-center justify-between">
              {/* Dots */}
              <div className="flex gap-1.5">
                {Array.from({ length: totalSteps }).map((_, i) => (
                  <div
                    key={i}
                    className={`w-2 h-2 rounded-full transition-all duration-300 ${
                      i === currentStep
                        ? 'bg-brand w-5'
                        : i < currentStep
                        ? 'bg-brand/40'
                        : 'bg-dx-surface-2'
                    }`}
                  />
                ))}
              </div>

              {/* Buttons */}
              <div className="flex items-center gap-2">
                {currentStep > 0 && (
                  <button
                    onClick={onPrev}
                    className="px-3 py-1.5 text-sm text-dx-text-soft hover:text-white transition-colors"
                  >
                    Atr\u00E1s
                  </button>
                )}
                {isLastStep ? (
                  <button
                    onClick={onComplete}
                    className="px-5 py-2 rounded-lg bg-gradient-to-r from-brand to-dx-cyan text-white text-sm font-bold shadow-lg shadow-brand/20 hover:shadow-brand/40 transition-all hover:scale-105 active:scale-95"
                  >
                    \u00A1Empezar!
                  </button>
                ) : (
                  <button
                    onClick={onNext}
                    className="px-4 py-1.5 rounded-lg bg-brand/10 text-brand text-sm font-bold hover:bg-brand/20 transition-colors"
                  >
                    Siguiente
                  </button>
                )}
              </div>
            </div>

            {/* Skip link */}
            <div className="text-center mt-3">
              <button
                onClick={onSkip}
                className="text-dx-text-mute text-xs hover:text-dx-text-soft transition-colors"
              >
                Saltar gu\u00EDa
              </button>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>,
    document.body
  );
};
