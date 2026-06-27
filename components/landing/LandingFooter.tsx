import React from 'react';
import { Link } from 'react-router-dom';
import { ChartBarIcon } from '../icons/Icons';

export const LandingFooter: React.FC = () => {
  return (
    <footer className="border-t border-white/5 bg-black">
      {/* Main footer */}
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="flex flex-col md:flex-row justify-between items-center gap-8">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-brand to-emerald-600 flex items-center justify-center">
              <ChartBarIcon className="w-5 h-5 text-black" />
            </div>
            <span className="text-lg font-display font-bold text-white tracking-[-0.03em]">
              Der<span className="text-brand">bix</span>
            </span>
          </div>

          {/* Links */}
          <div className="flex flex-wrap justify-center gap-8">
            <Link to="/terms" className="text-sm text-slate-500 hover:text-white transition-colors">
              Terms of Service
            </Link>
            <Link to="/privacy" className="text-sm text-slate-500 hover:text-white transition-colors">
              Privacy Policy
            </Link>
            <Link to="/refund" className="text-sm text-slate-500 hover:text-white transition-colors">
              Refund Policy
            </Link>
            <a href="mailto:support@derbix.com" className="text-sm text-slate-500 hover:text-white transition-colors">
              Support
            </a>
          </div>

          {/* Copyright */}
          <p className="text-sm text-slate-600">
            &copy; {new Date().getFullYear()} Derbix
          </p>
        </div>
      </div>

      {/* Compliance section */}
      <div className="border-t border-white/5">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex flex-col gap-4 text-center">
            {/* Main statement */}
            <p className="text-sm text-slate-400 font-medium">
              Derbix: software de decisiones deportivas. No somos tipster, no somos casa de apuestas. Solo IA + probabilidad.
            </p>

            {/* Disclaimer */}
            <p className="text-xs text-slate-600 max-w-2xl mx-auto leading-relaxed">
              Las apuestas deportivas implican riesgo. Juega de forma responsable. Nunca apuestes más de lo que puedas perder. Si sientes que tienes un problema con el juego, busca ayuda profesional.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
};
