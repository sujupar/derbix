import React from 'react';
import {
  ComputerDesktopIcon,
  SparklesIcon,
  CheckCircleIcon,
  TrophyIcon,
} from '../icons/Icons';
import { useScrollReveal } from './useScrollReveal';

const steps = [
  {
    number: 1,
    icon: ComputerDesktopIcon,
    title: 'Abre Derbix',
    description: 'Entra a la plataforma desde cualquier dispositivo. Sin descargas, sin complicaciones.',
  },
  {
    number: 2,
    icon: SparklesIcon,
    title: 'Mira las recomendaciones',
    description: 'Te mostramos las mejores oportunidades del día, claras y directas. Sin ruido.',
  },
  {
    number: 3,
    icon: CheckCircleIcon,
    title: 'Elige tus apuestas',
    description: 'Aplica las que quieras en tu casa de apuestas favorita. Tú decides.',
  },
  {
    number: 4,
    icon: TrophyIcon,
    title: 'Gana con confianza',
    description: 'Sigue tu historial y ve los resultados reales. Sin secretos.',
  },
];

export const EasySteps: React.FC = () => {
  const { ref, isVisible } = useScrollReveal();

  return (
    <section className="py-24 md:py-32 px-6 relative overflow-hidden">
      {/* Subtle gradient background */}
      <div className="absolute inset-0 bg-gradient-to-b from-slate-950 via-slate-900/30 to-slate-950 pointer-events-none" />

      <div className="max-w-6xl mx-auto relative z-10" ref={ref}>
        {/* Header */}
        <div className={`text-center mb-16 md:mb-20 transition-all duration-700 ${
          isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
        }`}>
          <p className="text-sm font-bold uppercase tracking-widest text-brand/80 mb-4">Así de simple</p>
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-display font-bold text-white">
            Es tan fácil como...
          </h2>
        </div>

        {/* Steps Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 relative">
          {/* Connecting line (desktop only) */}
          <div className="hidden lg:block absolute top-[3.5rem] left-[12%] right-[12%] h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

          {steps.map((step, i) => {
            const Icon = step.icon;
            return (
              <div
                key={i}
                className={`relative text-center transition-all duration-700 ${
                  isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
                }`}
                style={{ transitionDelay: `${200 + i * 150}ms` }}
              >
                {/* Number circle */}
                <div className="relative inline-flex items-center justify-center w-[4.5rem] h-[4.5rem] mb-6">
                  <div className="absolute inset-0 rounded-full bg-gradient-to-br from-brand to-emerald-600 opacity-20 blur-lg" />
                  <div className="relative w-full h-full rounded-full bg-gradient-to-br from-brand to-emerald-600 flex items-center justify-center border border-brand/30 shadow-[0_0_20px_rgba(16,185,129,0.2)]">
                    <span className="text-2xl font-display font-bold text-white">{step.number}</span>
                  </div>
                </div>

                {/* Icon + Content */}
                <div className="group p-6 rounded-2xl bg-[#0C1310] border border-white/5 hover:border-brand/20 hover:bg-[#121E18] transition-all duration-500">
                  <div className="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center mx-auto mb-4">
                    <Icon className="w-5 h-5 text-brand" />
                  </div>
                  <h3 className="text-lg font-bold text-white mb-2">{step.title}</h3>
                  <p className="text-slate-400 text-sm leading-relaxed">{step.description}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
