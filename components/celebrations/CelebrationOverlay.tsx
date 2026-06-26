import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import confetti from 'canvas-confetti';

interface CelebrationOverlayProps {
  planName: string;
  predictionsPercentage?: number;
  onDismiss: () => void;
}

export const CelebrationOverlay: React.FC<CelebrationOverlayProps> = ({
  planName,
  predictionsPercentage,
  onDismiss,
}) => {
  const hasFired = useRef(false);

  useEffect(() => {
    if (hasFired.current) return;
    hasFired.current = true;

    // Fireworks sequence
    const duration = 3000;
    const end = Date.now() + duration;

    const frame = () => {
      confetti({
        particleCount: 3,
        angle: 60,
        spread: 55,
        origin: { x: 0, y: 0.7 },
        colors: ['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b'],
      });
      confetti({
        particleCount: 3,
        angle: 120,
        spread: 55,
        origin: { x: 1, y: 0.7 },
        colors: ['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b'],
      });

      if (Date.now() < end) {
        requestAnimationFrame(frame);
      }
    };
    frame();

    // Center burst
    setTimeout(() => {
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.5 },
        colors: ['#10b981', '#059669', '#34d399'],
      });
    }, 500);

    // Auto-dismiss
    const timer = setTimeout(onDismiss, 8000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return createPortal(
    <motion.div
      className="fixed inset-0 z-[85] flex items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onDismiss}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" />

      {/* Content */}
      <div className="relative flex flex-col items-center text-center px-6" onClick={e => e.stopPropagation()}>
        {/* Glow */}
        <div className="absolute -inset-32 rounded-full bg-brand/10 blur-[100px] pointer-events-none" />

        {/* Logo */}
        <motion.img
          src="/derbix-logo.png"
          alt="Derbix"
          className="h-16 object-contain mb-6 relative"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.3 }}
          style={{ filter: 'drop-shadow(0 0 30px rgba(16, 185, 129, 0.4))' }}
        />

        {/* Title */}
        <motion.h2
          className="text-3xl sm:text-4xl font-display font-bold text-white mb-2 relative"
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', delay: 0.5 }}
        >
          Plan {planName} Activado
        </motion.h2>

        <motion.p
          className="text-slate-400 text-lg mb-6 relative"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.8 }}
        >
          Tu experiencia premium comienza ahora
        </motion.p>

        {/* Percentage unlocked */}
        {predictionsPercentage != null && predictionsPercentage > 1 && (
          <motion.div
            className="mb-8 relative"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', delay: 1.0 }}
          >
            <div className="px-6 py-3 rounded-2xl bg-brand/10 border border-brand/30">
              <span className="text-brand font-bold text-2xl">{predictionsPercentage}%</span>
              <span className="text-slate-400 text-sm ml-2">de oportunidades desbloqueadas</span>
            </div>
          </motion.div>
        )}

        {/* CTA */}
        <motion.button
          onClick={onDismiss}
          className="px-8 py-3 rounded-xl bg-gradient-to-r from-brand to-emerald-600 text-white font-bold shadow-lg shadow-brand/20 hover:shadow-brand/40 transition-all hover:scale-105 active:scale-95 relative"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 1.2 }}
        >
          Ver Oportunidades
        </motion.button>
      </div>
    </motion.div>,
    document.body
  );
};
