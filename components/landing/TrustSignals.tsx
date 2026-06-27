import React, { useEffect, useState } from 'react';
import { GlobeAmericasIcon, ShieldCheckIcon, ChartBarIcon, SparklesIcon } from '../icons/Icons';
import { useScrollReveal } from './useScrollReveal';

const AnimatedCounter: React.FC<{
  end: number;
  suffix?: string;
  prefix?: string;
  duration?: number;
  isVisible: boolean;
}> = ({ end, suffix = '', prefix = '', duration = 1500, isVisible }) => {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!isVisible) return;
    let start = 0;
    const increment = end / (duration / 16);
    const timer = setInterval(() => {
      start += increment;
      if (start >= end) {
        setCount(end);
        clearInterval(timer);
      } else {
        setCount(Math.floor(start));
      }
    }, 16);
    return () => clearInterval(timer);
  }, [isVisible, end, duration]);

  return (
    <span className="tabular-nums">
      {prefix}{count.toLocaleString()}{suffix}
    </span>
  );
};

const signals = [
  {
    icon: GlobeAmericasIcon,
    end: 40,
    suffix: '+',
    label: 'Ligas analizadas',
    color: 'text-brand',
    bg: 'bg-brand/10',
  },
  {
    icon: ShieldCheckIcon,
    end: 100,
    suffix: '%',
    label: 'Track record transparente',
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
  },
  {
    icon: ChartBarIcon,
    end: 5000,
    suffix: '+',
    label: 'Picks auditables por mes',
    color: 'text-purple-400',
    bg: 'bg-purple-500/10',
  },
  {
    icon: SparklesIcon,
    end: 0,
    suffix: '',
    label: 'Tipsters humanos (solo IA)',
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
  },
];

export const TrustSignals: React.FC = () => {
  const { ref, isVisible } = useScrollReveal();

  return (
    <section
      ref={ref}
      className="relative py-8 md:py-10 border-y border-white/5 bg-[#0C1310] backdrop-blur-sm"
    >
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-4">
          {signals.map((signal, i) => {
            const Icon = signal.icon;
            return (
              <div
                key={i}
                className={`flex flex-col items-center text-center gap-3 transition-all duration-700 ${
                  isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
                }`}
                style={{ transitionDelay: `${i * 100}ms` }}
              >
                <div className={`w-10 h-10 rounded-xl ${signal.bg} flex items-center justify-center`}>
                  <Icon className={`w-5 h-5 ${signal.color}`} />
                </div>
                <div>
                  <div className={`text-3xl md:text-4xl font-display font-bold text-white`}>
                    <AnimatedCounter
                      end={signal.end}
                      suffix={signal.suffix}
                      isVisible={isVisible}
                      duration={signal.end > 100 ? 2000 : 1200}
                    />
                  </div>
                  <p className="text-sm text-slate-400 mt-1">{signal.label}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
