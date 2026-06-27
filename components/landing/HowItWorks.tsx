import React from 'react';
import {
  GlobeAmericasIcon,
  ChartBarIcon,
  SparklesIcon,
  ClipboardDocumentCheckIcon,
  PresentationChartLineIcon,
  ShieldCheckIcon,
} from '../icons/Icons';
import { useScrollReveal } from './useScrollReveal';

const steps = [
  {
    number: '01',
    icon: GlobeAmericasIcon,
    title: 'Recopilamos todo',
    description: 'Conectamos con las mejores fuentes de datos del mundo. Estadísticas, alineaciones, clima, forma reciente, historial cara a cara... todo en un solo lugar.',
    color: 'text-brand',
    bg: 'bg-brand/10',
    glow: 'group-hover:shadow-brand/10',
    gradientFrom: 'from-brand',
  },
  {
    number: '02',
    icon: ChartBarIcon,
    title: 'Calculamos probabilidades reales',
    description: 'Nuestro modelo de inteligencia artificial analiza cada partido y calcula la probabilidad real de cada resultado. No opiniones, no corazonadas: números.',
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    glow: 'group-hover:shadow-blue-500/10',
    gradientFrom: 'from-blue-500',
  },
  {
    number: '03',
    icon: SparklesIcon,
    title: 'Encontramos las oportunidades',
    description: 'Comparamos nuestras probabilidades con las cuotas del mercado. Cuando la diferencia es grande, hay una oportunidad real. Te la mostramos directo.',
    color: 'text-purple-400',
    bg: 'bg-purple-500/10',
    glow: 'group-hover:shadow-purple-500/10',
    gradientFrom: 'from-purple-500',
  },
  {
    number: '04',
    icon: ClipboardDocumentCheckIcon,
    title: 'Te explicamos por qué',
    description: 'Cada recomendación viene con un reporte completo: por qué es buena oportunidad, qué puede salir mal, y cuánto se sugiere arriesgar. No confíes a ciegas.',
    color: 'text-brand',
    bg: 'bg-brand/10',
    glow: 'group-hover:shadow-brand/10',
    gradientFrom: 'from-brand',
  },
  {
    number: '05',
    icon: PresentationChartLineIcon,
    title: 'Medimos cada resultado',
    description: 'Cada pick se verifica automáticamente contra los resultados reales. Nuestro track record es público, verificable y sin trampas. Así de simple.',
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    glow: 'group-hover:shadow-blue-500/10',
    gradientFrom: 'from-blue-500',
  },
  {
    number: '06',
    icon: ShieldCheckIcon,
    title: 'Gestión de riesgo incluida',
    description: 'Combinaciones inteligentes que distribuyen el riesgo. Sugerencias de cuánto apostar según tu capital. Nada de "apuesta todo al favorito".',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    glow: 'group-hover:shadow-emerald-500/10',
    gradientFrom: 'from-emerald-500',
  },
];

const StepCard: React.FC<{
  step: typeof steps[0];
  index: number;
  isVisible: boolean;
}> = ({ step, index, isVisible }) => {
  const Icon = step.icon;
  const isEven = index % 2 === 0;

  return (
    <div className={`relative flex items-start gap-8 md:gap-12 transition-all duration-700 ${
      isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'
    }`} style={{ transitionDelay: `${index * 150}ms` }}>

      {/* Desktop: Alternating layout */}
      <div className={`hidden lg:flex w-full items-center gap-8 ${isEven ? '' : 'flex-row-reverse'}`}>
        {/* Content side */}
        <div className={`flex-1 ${isEven ? 'text-right' : 'text-left'}`}>
          <div className={`group inline-block p-8 rounded-3xl bg-[#0C1310] border border-white/5 hover:border-white/10 transition-all duration-500 hover:scale-[1.02] ${step.glow} hover:shadow-xl max-w-lg ${isEven ? 'ml-auto' : 'mr-auto'}`}>
            <div className={`flex items-center gap-4 mb-4 ${isEven ? 'justify-end' : ''}`}>
              <div className={`w-11 h-11 rounded-xl ${step.bg} flex items-center justify-center flex-shrink-0 ${isEven ? 'order-2' : ''}`}>
                <Icon className={`w-5 h-5 ${step.color}`} />
              </div>
              <h3 className="text-xl font-bold text-white">{step.title}</h3>
            </div>
            <p className={`text-slate-400 leading-relaxed ${isEven ? 'text-right' : 'text-left'}`}>{step.description}</p>
          </div>
        </div>

        {/* Center number + line */}
        <div className="relative flex flex-col items-center flex-shrink-0">
          <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${step.gradientFrom} to-black flex items-center justify-center border border-white/10 shadow-lg z-10`}>
            <span className="text-lg font-display font-bold text-white">{step.number}</span>
          </div>
          {index < steps.length - 1 && (
            <div className="w-px h-24 bg-gradient-to-b from-white/20 to-transparent mt-2" />
          )}
        </div>

        {/* Empty side for spacing */}
        <div className="flex-1" />
      </div>

      {/* Mobile/Tablet: Vertical layout */}
      <div className="lg:hidden flex gap-5 w-full">
        {/* Number + line */}
        <div className="relative flex flex-col items-center flex-shrink-0">
          <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${step.gradientFrom} to-black flex items-center justify-center border border-white/10 shadow-lg z-10`}>
            <span className="text-base font-display font-bold text-white">{step.number}</span>
          </div>
          {index < steps.length - 1 && (
            <div className="w-px flex-1 bg-gradient-to-b from-white/15 to-transparent mt-2 min-h-[2rem]" />
          )}
        </div>

        {/* Content */}
        <div className="group flex-1 p-6 rounded-2xl bg-[#0C1310] border border-white/5 hover:border-white/10 transition-all duration-500 mb-4">
          <div className="flex items-center gap-3 mb-3">
            <div className={`w-10 h-10 rounded-xl ${step.bg} flex items-center justify-center flex-shrink-0`}>
              <Icon className={`w-5 h-5 ${step.color}`} />
            </div>
            <h3 className="text-lg font-bold text-white">{step.title}</h3>
          </div>
          <p className="text-slate-400 leading-relaxed text-sm">{step.description}</p>
        </div>
      </div>
    </div>
  );
};

export const HowItWorks: React.FC = () => {
  const { ref, isVisible } = useScrollReveal();

  return (
    <section id="como-funciona" className="py-24 md:py-32 px-6 relative overflow-hidden">
      {/* Background effects */}
      <div className="absolute top-[30%] left-0 w-[600px] h-[600px] bg-brand/5 rounded-full blur-[150px] pointer-events-none" />
      <div className="absolute bottom-[20%] right-0 w-[500px] h-[500px] bg-blue-600/5 rounded-full blur-[120px] pointer-events-none" />

      <div className="max-w-6xl mx-auto" ref={ref}>
        {/* Header */}
        <div className={`text-center mb-20 md:mb-24 transition-all duration-700 ${
          isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
        }`}>
          <p className="text-sm font-bold uppercase tracking-widest text-brand/80 mb-4">La solución</p>
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-display font-bold text-white mb-6">
            Cómo funciona
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand to-emerald-400"> Derbix</span>
          </h2>
          <p className="text-lg md:text-xl text-slate-400 max-w-2xl mx-auto">
            De los datos a la decisión, en segundos. Así es como convertimos millones de datos en recomendaciones claras.
          </p>
        </div>

        {/* Timeline Steps */}
        <div className="space-y-2 lg:space-y-0">
          {steps.map((step, i) => (
            <StepCard key={i} step={step} index={i} isVisible={isVisible} />
          ))}
        </div>
      </div>
    </section>
  );
};
