import React from 'react';
import {
  ChartBarIcon,
  ExclamationTriangleIcon,
  EyeSlashIcon,
  CurrencyDollarIcon,
  ClockIcon,
  ShieldCheckIcon,
} from '../icons/Icons';
import { useScrollReveal } from './useScrollReveal';

const problems = [
  {
    icon: ChartBarIcon,
    title: 'Demasiados datos, cero claridad',
    description: 'Estadísticas por todos lados, pero nadie te dice qué hacer con ellas. Terminas más confundido que antes.',
    color: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'group-hover:border-red-500/20',
  },
  {
    icon: ExclamationTriangleIcon,
    title: 'Tipsters que no dan la cara',
    description: 'Prometen ganancias, esconden sus pérdidas y desaparecen cuando fallan. El negocio es venderte, no ayudarte.',
    color: 'text-orange-400',
    bg: 'bg-orange-500/10',
    border: 'group-hover:border-orange-500/20',
  },
  {
    icon: EyeSlashIcon,
    title: 'Todo es humo',
    description: 'No hay forma de verificar el historial real de nadie. Screenshots editados y récords inflados son la norma.',
    color: 'text-yellow-400',
    bg: 'bg-yellow-500/10',
    border: 'group-hover:border-yellow-500/20',
  },
  {
    icon: CurrencyDollarIcon,
    title: 'Intereses ocultos',
    description: 'El tipster cobra por referirte a la casa de apuestas, no por ayudarte a ganar. Si pierdes, él sigue ganando.',
    color: 'text-pink-400',
    bg: 'bg-pink-500/10',
    border: 'group-hover:border-pink-500/20',
  },
  {
    icon: ClockIcon,
    title: 'Análisis que tarda horas',
    description: 'Para cuando terminas de analizar un partido bien, ya empezó. Analizar 50 partidos es simplemente imposible.',
    color: 'text-sky-400',
    bg: 'bg-sky-500/10',
    border: 'group-hover:border-sky-500/20',
  },
  {
    icon: ShieldCheckIcon,
    title: 'Sin gestión de riesgo',
    description: 'Nadie te dice cuánto arriesgar, cómo distribuir tus apuestas, ni cuándo parar. Solo "dale a este pick".',
    color: 'text-violet-400',
    bg: 'bg-violet-500/10',
    border: 'group-hover:border-violet-500/20',
  },
];

export const ProblemSection: React.FC = () => {
  const { ref, isVisible } = useScrollReveal();

  return (
    <section className="py-24 md:py-32 px-6 bg-black relative overflow-hidden">
      {/* Subtle background accent */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-red-600/3 rounded-full blur-[120px] pointer-events-none" />

      <div className="max-w-7xl mx-auto" ref={ref}>
        {/* Header */}
        <div className={`text-center mb-16 md:mb-20 transition-all duration-700 ${
          isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
        }`}>
          <p className="text-sm font-bold uppercase tracking-widest text-red-400/80 mb-4">El problema</p>
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-display font-bold text-white mb-6">
            Las apuestas deportivas
            <br className="hidden md:block" />
            <span className="text-slate-500"> están rotas.</span>
          </h2>
          <p className="text-lg md:text-xl text-slate-400 max-w-2xl mx-auto">
            ¿Por qué los apostadores serios están hartos?
          </p>
        </div>

        {/* Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {problems.map((problem, i) => {
            const Icon = problem.icon;
            return (
              <div
                key={i}
                className={`group relative p-8 rounded-2xl bg-[#0C1310] border border-white/5 ${problem.border} transition-all duration-500 hover:bg-[#121E18] ${
                  isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
                }`}
                style={{ transitionDelay: `${200 + i * 100}ms` }}
              >
                {/* Subtle red indicator line */}
                <div className="absolute top-0 left-8 right-8 h-px bg-gradient-to-r from-transparent via-red-500/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

                <div className={`w-12 h-12 rounded-2xl ${problem.bg} flex items-center justify-center mb-5`}>
                  <Icon className={`w-6 h-6 ${problem.color}`} />
                </div>
                <h3 className="text-xl font-bold text-white mb-3">{problem.title}</h3>
                <p className="text-slate-400 leading-relaxed">{problem.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
