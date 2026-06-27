import React, { useState } from 'react';
import { ChevronDownIcon } from '../icons/Icons';
import { useScrollReveal } from './useScrollReveal';

const faqs = [
  {
    question: '¿Por qué debería pagar por esto si puedo analizar yo mismo?',
    answer: 'Porque analizar un solo partido bien te toma 2-3 horas. Nosotros lo hacemos en segundos para más de 50 partidos al mismo tiempo. Además, nuestro modelo analiza más de 5,000 datos por partido: estadísticas, alineaciones, clima, historial... cosas que a mano es imposible procesar. Un solo pick con valor puede pagarte la suscripción del mes.',
  },
  {
    question: '¿Cómo sé que Derbix no es otra estafa más?',
    answer: 'Entendemos la desconfianza, y es exactamente por eso que existimos. Todo nuestro historial de predicciones es público y verificable: cada pick tiene fecha, hora, cuota y resultado real. No escondemos nada. Además, no somos un tipster que cobra por "secretos". Somos una empresa de software con un modelo de suscripción fija. Si pierdes dinero, nosotros no ganamos más. Cero conflictos de interés.',
  },
  {
    question: 'Si es tan bueno, ¿por qué no apuestan ustedes y se hacen ricos?',
    answer: 'Somos una empresa de software, no una casa de apuestas ni un fondo de inversión. Nuestro modelo de negocio es crear la mejor herramienta de análisis y cobrar una suscripción mensual. Eso es más predecible y escalable que apostar directamente. Además, las casas de apuestas limitan a los apostadores ganadores sistemáticos. A nosotros no nos pueden limitar.',
  },
  {
    question: '¿Cuál es la ganancia esperada?',
    answer: 'Depende de tu disciplina y gestión de capital. Nuestro modelo identifica oportunidades donde las probabilidades están a tu favor. A largo plazo, eso significa ventaja. Pero las apuestas deportivas siempre tienen riesgo. No prometemos rendimientos fijos ni resultados mágicos. Lo que sí prometemos es transparencia total: puedes verificar cada pick y su resultado real.',
  },
  {
    question: '¿Es complicado de usar?',
    answer: 'No. Ese es exactamente el punto. Abres Derbix, ves las recomendaciones del día, y decides. Sin configuración, sin dashboards complicados, sin terminología técnica. Está hecho para que lo entienda cualquiera. La complejidad está en nuestro motor de IA. Tu experiencia es simple.',
  },
  {
    question: '¿Qué pasa si el algoritmo se equivoca?',
    answer: 'Ningún modelo acierta siempre, y el nuestro no es la excepción. Trabajamos con probabilidades, no con certezas. Pero nuestro track record es público y lo puedes verificar en cualquier momento. Por eso incluimos gestión de riesgo en cada recomendación: para que una mala racha no te saque del juego.',
  },
  {
    question: '¿Y el juego responsable?',
    answer: 'Es algo que nos tomamos muy en serio. Derbix no te dice "apuesta más". De hecho, muchas veces te dice "mejor no apuestes este partido". Incluimos límites de riesgo, sugerencias de cuánto apostar según tu capital, y alertas si detectamos patrones de riesgo. Las apuestas deportivas implican riesgo real. Si sientes que necesitas ayuda, te recomendamos buscar apoyo profesional.',
  },
];

export const FAQSection: React.FC = () => {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const { ref, isVisible } = useScrollReveal();

  const toggle = (i: number) => {
    setOpenIndex(openIndex === i ? null : i);
  };

  return (
    <section id="faq" className="py-24 md:py-32 px-6 relative">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-slate-950 via-slate-900/20 to-slate-950 pointer-events-none" />

      <div className="max-w-3xl mx-auto relative z-10" ref={ref}>
        {/* Header */}
        <div className={`text-center mb-16 md:mb-20 transition-all duration-700 ${
          isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
        }`}>
          <p className="text-sm font-bold uppercase tracking-widest text-brand/80 mb-4">FAQ</p>
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-display font-bold text-white mb-6">
            Preguntas Incómodas
            <br />
            <span className="text-slate-500">(Respondidas)</span>
          </h2>
          <p className="text-lg text-slate-400 max-w-xl mx-auto">
            Las dudas que te pasan por la cabeza, respondidas con honestidad total.
          </p>
        </div>

        {/* Accordion */}
        <div className="space-y-3">
          {faqs.map((faq, i) => (
            <div
              key={i}
              className={`rounded-2xl border transition-all duration-500 ${
                openIndex === i
                  ? 'bg-[#121E18] border-brand/20'
                  : 'bg-[#0C1310] border-white/5 hover:border-white/10'
              } ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}
              style={{ transitionDelay: `${200 + i * 50}ms` }}
            >
              <button
                onClick={() => toggle(i)}
                className="w-full flex items-start justify-between gap-4 p-6 text-left"
              >
                <h3 className={`font-semibold transition-colors ${
                  openIndex === i ? 'text-white' : 'text-slate-300'
                }`}>
                  {faq.question}
                </h3>
                <ChevronDownIcon
                  className={`w-5 h-5 text-slate-500 flex-shrink-0 mt-0.5 transition-transform duration-300 ${
                    openIndex === i ? 'rotate-180 text-brand' : ''
                  }`}
                />
              </button>

              <div className={`overflow-hidden transition-all duration-300 ease-out ${
                openIndex === i ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
              }`}>
                <div className="px-6 pb-6">
                  <div className="pt-2 border-t border-white/5">
                    <p className="text-slate-400 leading-relaxed pt-4">{faq.answer}</p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
