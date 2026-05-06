import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../services/supabaseService';
import { Breadcrumbs } from './Breadcrumbs';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface StatsData {
  overall: { total_picks: number; won: number; lost: number; win_rate: number };
  byLeague: Array<{ league: string; total: number; won: number; win_rate: number }>;
  byMarket: Array<{ market: string; total: number; won: number; win_rate: number }>;
  byPeriod: Record<string, { total: number; won: number; win_rate: number }>;
  trend: Array<{ date: string; total: number; won: number; win_rate: number }>;
  totalPages: number;
  totalLeagues: number;
}

export const EstadisticasPage: React.FC = () => {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  async function loadStats() {
    try {
      const { data, error } = await supabase.functions.invoke('seo-public-stats');
      if (!error && data) {
        setStats(data);
      }
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
    setLoading(false);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const overall = stats?.overall || { total_picks: 0, won: 0, lost: 0, win_rate: 0 };
  const p7d = stats?.byPeriod?.['7d'] || { total: 0, won: 0, win_rate: 0 };
  const p30d = stats?.byPeriod?.['30d'] || { total: 0, won: 0, win_rate: 0 };

  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* Nav */}
      <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between border-b border-gray-200">
        <Link to="/" className="text-emerald-500 font-display font-extrabold text-xl">Derbix</Link>
        <div className="flex items-center gap-4 text-sm">
          <Link to="/predicciones" className="text-gray-600 hover:text-gray-900">Predicciones</Link>
          <Link to="/estadisticas" className="text-gray-900 font-medium">Estadísticas</Link>
          <Link to="/signup" className="bg-emerald-500 text-white px-4 py-2 rounded-lg font-semibold text-sm">
            Registrarse
          </Link>
        </div>
      </div>

      <main className="max-w-4xl mx-auto px-4 py-8">
        <Breadcrumbs items={[
          { label: 'Inicio', href: '/' },
          { label: 'Estadísticas' },
        ]} />

        {/* Hero */}
        <header className="text-center mb-12">
          <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4 font-display">Track Record Verificado</h1>
          <p className="text-gray-500 text-lg mb-8 max-w-2xl mx-auto">
            Resultados 100% públicos. Sin editar. Sin esconder. Cada pronóstico es verificado automáticamente contra resultados reales.
          </p>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-3xl mx-auto">
            <div className="bg-white border border-gray-200 rounded-2xl p-5">
              <div className="text-3xl font-bold text-emerald-400">{overall.win_rate}%</div>
              <div className="text-gray-400 text-sm mt-1">Efectividad Total</div>
            </div>
            <div className="bg-white border border-gray-200 rounded-2xl p-5">
              <div className="text-3xl font-bold text-gray-900">{overall.total_picks}+</div>
              <div className="text-gray-400 text-sm mt-1">Verificados</div>
            </div>
            <div className="bg-white border border-gray-200 rounded-2xl p-5">
              <div className="text-3xl font-bold text-emerald-400">{p7d.win_rate}%</div>
              <div className="text-gray-400 text-sm mt-1">Últimos 7 Días</div>
            </div>
            <div className="bg-white border border-gray-200 rounded-2xl p-5">
              <div className="text-3xl font-bold text-gray-900">{stats?.totalLeagues || 0}+</div>
              <div className="text-gray-400 text-sm mt-1">Ligas</div>
            </div>
          </div>
        </header>

        {/* Period comparison */}
        <section className="bg-white border border-gray-200 rounded-2xl p-6 mb-8">
          <h2 className="text-xl font-bold text-gray-900 mb-4 font-display">Efectividad por Período</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 text-xs uppercase border-b border-gray-200">
                  <th className="pb-3 pr-4">Período</th>
                  <th className="pb-3 pr-4">Pronósticos</th>
                  <th className="pb-3 pr-4">Acertados</th>
                  <th className="pb-3">Efectividad</th>
                </tr>
              </thead>
              <tbody className="text-gray-600">
                <tr className="border-b border-gray-200">
                  <td className="py-3 pr-4">Últimos 7 días</td>
                  <td className="py-3 pr-4">{p7d.total}</td>
                  <td className="py-3 pr-4">{p7d.won}</td>
                  <td className="py-3"><span className={`font-bold ${p7d.win_rate >= 60 ? 'text-emerald-400' : 'text-gray-900'}`}>{p7d.win_rate}%</span></td>
                </tr>
                <tr className="border-b border-gray-200">
                  <td className="py-3 pr-4">Últimos 30 días</td>
                  <td className="py-3 pr-4">{p30d.total}</td>
                  <td className="py-3 pr-4">{p30d.won}</td>
                  <td className="py-3"><span className={`font-bold ${p30d.win_rate >= 60 ? 'text-emerald-400' : 'text-gray-900'}`}>{p30d.win_rate}%</span></td>
                </tr>
                <tr>
                  <td className="py-3 pr-4">Histórico Total</td>
                  <td className="py-3 pr-4">{overall.total_picks}</td>
                  <td className="py-3 pr-4">{overall.won}</td>
                  <td className="py-3"><span className={`font-bold ${overall.win_rate >= 60 ? 'text-emerald-400' : 'text-gray-900'}`}>{overall.win_rate}%</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Trend chart */}
        {stats?.trend && stats.trend.length > 0 && (
          <section className="bg-white border border-gray-200 rounded-2xl p-6 mb-8">
            <h2 className="text-xl font-bold text-gray-900 mb-4 font-display">Tendencia de Efectividad (30 Días)</h2>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={stats.trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" />
                <XAxis dataKey="date" stroke="#9ca3af" fontSize={11} tickFormatter={(d) => d.slice(5)} />
                <YAxis stroke="#9ca3af" fontSize={11} domain={[0, 100]} />
                <Tooltip
                  contentStyle={{ background: '#ffffff', border: '1px solid rgba(0,0,0,0.1)', borderRadius: '8px' }}
                  labelStyle={{ color: '#6b7280' }}
                />
                <Bar dataKey="win_rate" name="Efectividad %" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </section>
        )}

        {/* CTA */}
        <div className="bg-white border border-gray-200 rounded-2xl p-8 mb-8 text-center">
          <h3 className="text-xl font-bold text-gray-900 mb-2">Accede a Pronósticos con Esta Efectividad</h3>
          <p className="text-gray-500 mb-4">1 pronóstico gratis al día, para siempre. Sin tarjeta de crédito.</p>
          <Link to="/signup" className="bg-emerald-500 text-white px-6 py-3 rounded-xl font-semibold inline-block hover:bg-emerald-600 transition">
            Crear Cuenta Gratis
          </Link>
        </div>

        {/* By market */}
        {stats?.byMarket && stats.byMarket.length > 0 && (
          <section className="bg-white border border-gray-200 rounded-2xl p-6 mb-8">
            <h2 className="text-xl font-bold text-gray-900 mb-4 font-display">Efectividad por Tipo de Mercado</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-400 text-xs uppercase border-b border-gray-200">
                    <th className="pb-3 pr-4">Mercado</th>
                    <th className="pb-3 pr-4">Pronósticos</th>
                    <th className="pb-3 pr-4">Acertados</th>
                    <th className="pb-3">Efectividad</th>
                  </tr>
                </thead>
                <tbody className="text-gray-600">
                  {stats.byMarket.map((m) => (
                    <tr key={m.market} className="border-b border-gray-200">
                      <td className="py-3 pr-4">{m.market}</td>
                      <td className="py-3 pr-4">{m.total}</td>
                      <td className="py-3 pr-4">{m.won}</td>
                      <td className="py-3">
                        <span className={`font-bold ${m.win_rate >= 60 ? 'text-emerald-400' : m.win_rate >= 50 ? 'text-gray-900' : 'text-red-400'}`}>
                          {m.win_rate}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* By league */}
        {stats?.byLeague && stats.byLeague.length > 0 && (
          <section className="bg-white border border-gray-200 rounded-2xl p-6 mb-8">
            <h2 className="text-xl font-bold text-gray-900 mb-4 font-display">Efectividad por Liga</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-400 text-xs uppercase border-b border-gray-200">
                    <th className="pb-3 pr-4">Liga</th>
                    <th className="pb-3 pr-4">Pronósticos</th>
                    <th className="pb-3 pr-4">Acertados</th>
                    <th className="pb-3">Efectividad</th>
                  </tr>
                </thead>
                <tbody className="text-gray-600">
                  {stats.byLeague.map((l) => (
                    <tr key={l.league} className="border-b border-gray-200">
                      <td className="py-3 pr-4">{l.league}</td>
                      <td className="py-3 pr-4">{l.total}</td>
                      <td className="py-3 pr-4">{l.won}</td>
                      <td className="py-3">
                        <span className={`font-bold ${l.win_rate >= 60 ? 'text-emerald-400' : l.win_rate >= 50 ? 'text-gray-900' : 'text-red-400'}`}>
                          {l.win_rate}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Methodology */}
        <section className="bg-white border border-gray-200 rounded-2xl p-6 mb-8">
          <h2 className="text-xl font-bold text-gray-900 mb-4 font-display">Metodología</h2>
          <ul className="space-y-3">
            {[
              'Cada pronóstico es generado por nuestro motor de IA que analiza más de 5,000 variables por partido usando datos de SportMonks API.',
              'Solo mostramos oportunidades con probabilidad calculada >= 80% y cuotas >= 1.20.',
              'Los resultados se verifican automáticamente cada hora contra los resultados reales de los partidos.',
              'Ningún resultado es editado o eliminado. El historial es 100% público y transparente.',
            ].map((text, i) => (
              <li key={i} className="flex items-start gap-2 text-gray-600">
                <span className="text-emerald-500 mt-1">•</span>
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="border-t border-gray-200 py-8 mt-8">
        <div className="max-w-4xl mx-auto px-4 text-center text-sm text-gray-400">
          © {new Date().getFullYear()} Derbix. Todos los derechos reservados.
        </div>
      </footer>
    </div>
  );
};
