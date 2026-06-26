import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';

export interface ToastItem {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
  duration: number;
}

const typeStyles: Record<ToastItem['type'], { border: string; icon: string; text: string }> = {
  success: {
    border: 'border-dx-green/40',
    icon: '✓',
    text: 'text-dx-green',
  },
  error: {
    border: 'border-dx-loss/40',
    icon: '✕',
    text: 'text-dx-loss',
  },
  warning: {
    border: 'border-dx-gold/40',
    icon: '⚠',
    text: 'text-dx-gold',
  },
  info: {
    border: 'border-dx-border-active',
    icon: 'ℹ',
    text: 'text-dx-text-soft',
  },
};

const SingleToast: React.FC<{ toast: ToastItem; onRemove: (id: number) => void }> = ({ toast, onRemove }) => {
  useEffect(() => {
    const timer = setTimeout(() => onRemove(toast.id), toast.duration);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, onRemove]);

  const style = typeStyles[toast.type];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 80, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 80, scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className={`flex items-center gap-3 px-4 py-3 rounded-xl backdrop-blur-xl bg-dx-surface/90 border ${style.border} shadow-2xl max-w-sm cursor-pointer`}
      onClick={() => onRemove(toast.id)}
    >
      <span className={`text-lg font-bold ${style.text} shrink-0`}>{style.icon}</span>
      <p className="text-sm text-dx-text font-medium leading-snug">{toast.message}</p>
    </motion.div>
  );
};

export const Toast: React.FC<{ toasts: ToastItem[]; onRemove: (id: number) => void }> = ({ toasts, onRemove }) => {
  return createPortal(
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      <AnimatePresence mode="popLayout">
        {toasts.map(toast => (
          <div key={toast.id} className="pointer-events-auto">
            <SingleToast toast={toast} onRemove={onRemove} />
          </div>
        ))}
      </AnimatePresence>
    </div>,
    document.body
  );
};
