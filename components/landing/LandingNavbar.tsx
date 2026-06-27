import React, { useState, useEffect } from 'react';
import { ChartBarIcon, ArrowRightIcon, XMarkIcon } from '../icons/Icons';

interface LandingNavbarProps {
  onGetStarted: () => void;
  onLoginClick: () => void;
}

export const LandingNavbar: React.FC<LandingNavbarProps> = ({ onGetStarted, onLoginClick }) => {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', handler, { passive: true });
    return () => window.removeEventListener('scroll', handler);
  }, []);

  return (
    <>
      <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
        scrolled
          ? 'bg-black/90 backdrop-blur-xl shadow-2xl shadow-black/40 border-b border-white/5'
          : 'bg-transparent'
      }`}>
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          {/* Logo */}
          <a href="/" className="flex items-center gap-2 animate-fade-in">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-brand to-emerald-600 flex items-center justify-center shadow-[0_0_20px_rgba(16,185,129,0.4)]">
              <ChartBarIcon className="w-7 h-7 text-black" />
            </div>
            <span className="text-xl font-display font-bold text-white tracking-[-0.03em]">
              Der<span className="text-brand">bix</span>
            </span>
          </a>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-8 animate-fade-in" style={{ animationDelay: '0.1s' }}>
            <a
              href="#como-funciona"
              onClick={(e) => {
                e.preventDefault();
                document.getElementById('como-funciona')?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="text-slate-400 hover:text-white font-medium text-sm transition-colors"
            >
              Cómo funciona
            </a>
            <a
              href="#planes"
              onClick={(e) => {
                e.preventDefault();
                document.getElementById('planes')?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="text-slate-400 hover:text-white font-medium text-sm transition-colors"
            >
              Planes
            </a>
            <a
              href="#faq"
              onClick={(e) => {
                e.preventDefault();
                document.getElementById('faq')?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="text-slate-400 hover:text-white font-medium text-sm transition-colors"
            >
              FAQ
            </a>
            <button
              onClick={onLoginClick}
              className="text-slate-400 hover:text-white font-medium text-sm transition-colors"
            >
              Iniciar Sesión
            </button>
            <button
              onClick={onGetStarted}
              className="px-6 py-2.5 bg-brand text-white font-bold rounded-full transition-all hover:bg-brand-hover hover:scale-105 active:scale-95 text-sm flex items-center gap-2 shadow-[0_0_20px_rgba(16,185,129,0.3)]"
            >
              <span>Comenzar Gratis</span>
              <ArrowRightIcon className="w-4 h-4" />
            </button>
          </div>

          {/* Mobile Hamburger */}
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="md:hidden w-10 h-10 flex flex-col items-center justify-center gap-1.5"
            aria-label="Menú"
          >
            <span className={`w-6 h-0.5 bg-white rounded-full transition-all duration-300 ${menuOpen ? 'rotate-45 translate-y-2' : ''}`} />
            <span className={`w-6 h-0.5 bg-white rounded-full transition-all duration-300 ${menuOpen ? 'opacity-0' : ''}`} />
            <span className={`w-6 h-0.5 bg-white rounded-full transition-all duration-300 ${menuOpen ? '-rotate-45 -translate-y-2' : ''}`} />
          </button>
        </div>
      </nav>

      {/* Mobile Menu */}
      <div className={`fixed inset-0 z-40 transition-all duration-300 md:hidden ${
        menuOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      }`}>
        <div className="absolute inset-0 bg-black/95 backdrop-blur-xl" onClick={() => setMenuOpen(false)} />
        <div className={`relative pt-24 px-6 flex flex-col gap-2 transition-all duration-500 ${
          menuOpen ? 'translate-y-0 opacity-100' : '-translate-y-8 opacity-0'
        }`}>
          <a
            href="#como-funciona"
            onClick={(e) => {
              e.preventDefault();
              setMenuOpen(false);
              document.getElementById('como-funciona')?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="py-4 text-lg text-slate-300 hover:text-white font-medium border-b border-white/5 transition-colors"
          >
            Cómo funciona
          </a>
          <a
            href="#planes"
            onClick={(e) => {
              e.preventDefault();
              setMenuOpen(false);
              document.getElementById('planes')?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="py-4 text-lg text-slate-300 hover:text-white font-medium border-b border-white/5 transition-colors"
          >
            Planes
          </a>
          <a
            href="#faq"
            onClick={(e) => {
              e.preventDefault();
              setMenuOpen(false);
              document.getElementById('faq')?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="py-4 text-lg text-slate-300 hover:text-white font-medium border-b border-white/5 transition-colors"
          >
            FAQ
          </a>
          <button
            onClick={() => { setMenuOpen(false); onLoginClick(); }}
            className="py-4 text-lg text-slate-300 hover:text-white font-medium border-b border-white/5 text-left transition-colors"
          >
            Iniciar Sesión
          </button>
          <button
            onClick={() => { setMenuOpen(false); onGetStarted(); }}
            className="mt-4 w-full py-4 bg-brand text-white font-bold rounded-2xl text-lg hover:bg-brand-hover transition-all"
          >
            Comenzar Gratis
          </button>
        </div>
      </div>
    </>
  );
};
