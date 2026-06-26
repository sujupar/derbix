import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Page } from '../App';

interface Action {
  id: string;
  label: string;
  icon: string;
  keywords: string;
  action: () => void;
}

interface CommandPaletteProps {
  setCurrentPage: (page: Page) => void;
  onSignOut: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ setCurrentPage, onSignOut }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const actions: Action[] = [
    { id: 'opportunities', label: 'Ir a Oportunidades', icon: '\uD83C\uDFC6', keywords: 'oportunidades picks top predictions', action: () => { setCurrentPage('live'); setIsOpen(false); } },
    { id: 'results', label: 'Ir a Resultados', icon: '\uD83D\uDCCA', keywords: 'resultados verificacion historial', action: () => { setCurrentPage('results'); setIsOpen(false); } },
    { id: 'pricing', label: 'Ver Planes', icon: '\uD83D\uDCB3', keywords: 'planes precios suscripcion pricing upgrade', action: () => { setCurrentPage('pricing'); setIsOpen(false); } },
    { id: 'admin', label: 'Panel Admin', icon: '\u2699\uFE0F', keywords: 'admin configuracion equipo agency', action: () => { setCurrentPage('admin'); setIsOpen(false); } },
    { id: 'support', label: 'Abrir Soporte', icon: '\uD83D\uDCAC', keywords: 'soporte ayuda help support contacto', action: () => { document.querySelector<HTMLButtonElement>('[data-support-widget]')?.click(); setIsOpen(false); } },
    { id: 'logout', label: 'Cerrar Sesi\u00F3n', icon: '\uD83D\uDEAA', keywords: 'salir cerrar logout', action: () => { onSignOut(); setIsOpen(false); } },
  ];

  const filtered = query.trim()
    ? actions.filter(a =>
        a.label.toLowerCase().includes(query.toLowerCase()) ||
        a.keywords.toLowerCase().includes(query.toLowerCase())
      )
    : actions;

  // Global shortcut listener
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen(prev => !prev);
      }
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && filtered[selectedIndex]) {
      filtered[selectedIndex].action();
    }
  }, [filtered, selectedIndex]);

  // Reset selection when filter changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  if (!isOpen) return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[80] flex items-start justify-center pt-[20vh]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={() => setIsOpen(false)}
      >
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

        {/* Panel */}
        <motion.div
          className="relative w-full max-w-lg mx-4"
          initial={{ opacity: 0, y: -20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -20, scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          onClick={e => e.stopPropagation()}
        >
          <div className="bg-dx-surface/95 backdrop-blur-2xl border border-dx-border rounded-2xl shadow-2xl overflow-hidden">
            {/* Search input */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-dx-border">
              <svg className="w-5 h-5 text-dx-text-mute shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
              <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Buscar acciones..."
                className="flex-1 bg-transparent text-white text-sm placeholder-dx-text-mute outline-none"
              />
              <kbd className="hidden sm:inline text-[10px] text-dx-text-mute bg-dx-surface-2 px-1.5 py-0.5 rounded border border-dx-border font-mono">
                ESC
              </kbd>
            </div>

            {/* Results */}
            <div className="max-h-64 overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-dx-text-mute">
                  No se encontraron acciones
                </div>
              ) : (
                filtered.map((action, i) => (
                  <button
                    key={action.id}
                    onClick={action.action}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                      i === selectedIndex ? 'bg-brand/10 text-white' : 'text-dx-text-soft hover:bg-white/5'
                    }`}
                  >
                    <span className="text-lg">{action.icon}</span>
                    <span className="text-sm font-medium">{action.label}</span>
                  </button>
                ))
              )}
            </div>

            {/* Footer hint */}
            <div className="px-4 py-2 border-t border-dx-border flex items-center gap-4 text-[10px] text-dx-text-mute">
              <span><kbd className="font-mono bg-dx-surface-2 px-1 rounded">↑↓</kbd> navegar</span>
              <span><kbd className="font-mono bg-dx-surface-2 px-1 rounded">↵</kbd> seleccionar</span>
              <span><kbd className="font-mono bg-dx-surface-2 px-1 rounded">esc</kbd> cerrar</span>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
};
