import React from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';

interface WelcomeScreenProps {
  userName: string;
  planName?: string;
  onStart: () => void;
  onSkip: () => void;
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ userName, planName, onStart, onSkip }) => {
  return createPortal(
    <motion.div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-dx-bg/95 backdrop-blur-xl"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
    >
      {/* Background glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-brand/5 blur-[120px]" />
        <div className="absolute top-1/3 left-1/3 w-[300px] h-[300px] rounded-full bg-dx-green/5 blur-[100px]" />
      </div>

      <div className="relative flex flex-col items-center text-center px-6 max-w-md">
        {/* Logo */}
        <motion.img
          src="/derbix-logo.svg"
          alt="Derbix"
          className="h-20 object-contain mb-8"
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 200, damping: 20, delay: 0.2 }}
        />

        {/* Welcome text */}
        <motion.h1
          className="text-3xl sm:text-4xl font-display font-bold text-white mb-3"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.5, duration: 0.5 }}
        >
          Bienvenido, {userName.split(' ')[0]}
        </motion.h1>

        <motion.p
          className="text-dx-text-soft text-lg mb-2"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.7, duration: 0.5 }}
        >
          Tu inteligencia deportiva comienza ahora
        </motion.p>

        {planName && planName !== 'free' && (
          <motion.div
            className="mt-2 mb-6 px-4 py-1.5 rounded-full bg-brand/10 border border-brand/30"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', delay: 0.9 }}
          >
            <span className="text-brand font-bold text-sm">Plan {planName} Activado</span>
          </motion.div>
        )}

        {/* CTA */}
        <motion.div
          className="flex flex-col items-center gap-3 mt-6"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 1.1, duration: 0.5 }}
        >
          <button
            onClick={onStart}
            className="px-8 py-3 rounded-xl bg-gradient-to-r from-brand to-dx-cyan text-white font-bold text-base shadow-lg shadow-brand/20 hover:shadow-brand/40 transition-all hover:scale-105 active:scale-95"
          >
            Conocer la plataforma
          </button>
          <button
            onClick={onSkip}
            className="text-dx-text-mute text-sm hover:text-dx-text-soft transition-colors"
          >
            Ya la conozco, saltar
          </button>
        </motion.div>
      </div>
    </motion.div>,
    document.body
  );
};
