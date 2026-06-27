import React from 'react';
import { CheckCircleIcon, XCircleIcon } from '../icons/Icons';
import { useScrollReveal } from './useScrollReveal';

type CellValue = 'yes' | 'no' | 'partial' | 'na' | string;

interface ComparisonRow {
  feature: string;
  derbix: CellValue;
  sofascore: CellValue;
  tipsters: CellValue;
  aiGeneric: CellValue;
}

const rows: ComparisonRow[] = [
  {
    feature: 'Recomendaciones claras',
    derbix: 'yes',
    sofascore: 'no',
    tipsters: 'no',
    aiGeneric: 'partial',
  },
  {
    feature: 'Historial 100% verificable',
    derbix: 'yes',
    sofascore: 'na',
    tipsters: 'no',
    aiGeneric: 'no',
  },
  {
    feature: 'Modelo propio de probabilidad',
    derbix: 'yes',
    sofascore: 'no',
    tipsters: 'no',
    aiGeneric: 'partial',
  },
  {
    feature: 'Explica cada decisión',
    derbix: 'yes',
    sofascore: 'Tú solo',
    tipsters: 'Mínimo',
    aiGeneric: 'Mínimo',
  },
  {
    feature: 'Gestión de riesgo',
    derbix: 'yes',
    sofascore: 'no',
    tipsters: 'no',
    aiGeneric: 'no',
  },
  {
    feature: 'Sin emociones humanas',
    derbix: 'yes',
    sofascore: 'na',
    tipsters: 'no',
    aiGeneric: 'yes',
  },
  {
    feature: 'Especializado en fútbol',
    derbix: 'yes',
    sofascore: 'yes',
    tipsters: 'partial',
    aiGeneric: 'no',
  },
  {
    feature: 'Precio desde',
    derbix: '$9.99/mes',
    sofascore: 'Gratis + ads',
    tipsters: '$50-300/mes',
    aiGeneric: '$20+/mes',
  },
];

const CellContent: React.FC<{ value: CellValue; highlight?: boolean }> = ({ value, highlight }) => {
  if (value === 'yes') {
    return (
      <div className={`flex items-center justify-center ${highlight ? '' : ''}`}>
        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${highlight ? 'bg-brand/20' : 'bg-brand/10'}`}>
          <CheckCircleIcon className="w-5 h-5 text-brand" />
        </div>
      </div>
    );
  }
  if (value === 'no') {
    return (
      <div className="flex items-center justify-center">
        <div className="w-8 h-8 rounded-full flex items-center justify-center bg-red-500/10">
          <XCircleIcon className="w-5 h-5 text-red-400/60" />
        </div>
      </div>
    );
  }
  if (value === 'na') {
    return <span className="text-slate-600 text-sm">N/A</span>;
  }
  if (value === 'partial') {
    return <span className="text-yellow-500/80 text-sm font-medium">Parcial</span>;
  }
  // String value (price or text)
  return (
    <span className={`text-sm font-medium ${highlight ? 'text-brand font-bold' : 'text-slate-400'}`}>
      {value}
    </span>
  );
};

export const ComparisonTable: React.FC = () => {
  const { ref, isVisible } = useScrollReveal();

  return (
    <section className="py-24 md:py-32 px-6 relative overflow-hidden">
      {/* Background accent */}
      <div className="absolute bottom-0 left-[30%] w-[600px] h-[400px] bg-brand/3 rounded-full blur-[120px] pointer-events-none" />

      <div className="max-w-6xl mx-auto" ref={ref}>
        {/* Header */}
        <div className={`text-center mb-16 md:mb-20 transition-all duration-700 ${
          isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
        }`}>
          <p className="text-sm font-bold uppercase tracking-widest text-brand/80 mb-4">La comparación</p>
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-display font-bold text-white mb-6">
            Derbix vs La Competencia
          </h2>
          <p className="text-lg md:text-xl text-slate-400 max-w-2xl mx-auto">
            La diferencia es obvia.
          </p>
        </div>

        {/* Table */}
        <div className={`overflow-x-auto rounded-2xl border border-white/5 bg-[#0C1310] backdrop-blur-sm transition-all duration-700 ${
          isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
        }`} style={{ transitionDelay: '200ms' }}>
          <table className="w-full min-w-[700px]">
            <thead>
              <tr>
                <th className="text-left text-sm font-medium text-slate-400 px-6 py-5 border-b border-white/5 w-[28%]">
                  Característica
                </th>
                <th className="text-center text-sm font-bold text-brand px-4 py-5 border-b border-brand/20 bg-brand/5 w-[18%] relative">
                  <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-brand/50 via-brand to-brand/50 rounded-t-sm" />
                  Derbix
                </th>
                <th className="text-center text-sm font-medium text-slate-500 px-4 py-5 border-b border-white/5 w-[18%]">
                  SofaScore / 365
                </th>
                <th className="text-center text-sm font-medium text-slate-500 px-4 py-5 border-b border-white/5 w-[18%]">
                  Tipsters
                </th>
                <th className="text-center text-sm font-medium text-slate-500 px-4 py-5 border-b border-white/5 w-[18%]">
                  IA Genérica
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={i}
                  className="group hover:bg-white/[0.02] transition-colors"
                >
                  <td className="px-6 py-5 border-b border-white/5">
                    <span className="font-semibold text-white text-sm">{row.feature}</span>
                  </td>
                  <td className="px-4 py-5 border-b border-brand/10 bg-brand/[0.03] text-center">
                    <CellContent value={row.derbix} highlight />
                  </td>
                  <td className="px-4 py-5 border-b border-white/5 text-center">
                    <CellContent value={row.sofascore} />
                  </td>
                  <td className="px-4 py-5 border-b border-white/5 text-center">
                    <CellContent value={row.tipsters} />
                  </td>
                  <td className="px-4 py-5 border-b border-white/5 text-center">
                    <CellContent value={row.aiGeneric} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Bottom emphasis */}
        <div className={`mt-8 text-center transition-all duration-700 ${
          isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        }`} style={{ transitionDelay: '400ms' }}>
          <p className="text-slate-500 text-sm">
            <span className="text-brand font-semibold">7 de 8 categorías</span> donde Derbix lidera. La decisión es tuya.
          </p>
        </div>
      </div>
    </section>
  );
};
