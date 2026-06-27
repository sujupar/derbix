import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckIcon, SparklesIcon } from '../icons/Icons';
import { getActivePlans, SubscriptionPlan } from '../../services/subscriptionService';
import { getPlanPrice } from '../../services/lemonSqueezyService';
import { useScrollReveal } from './useScrollReveal';
import { useTRM } from '../../hooks/useTRM';
import { CopPriceBadge } from '../pricing/CopPriceBadge';

type BillingPeriod = 'monthly' | 'annual';

// --- Plan CTAs ---
const PLAN_CTAS: Record<string, string> = {
    free: 'Probar Gratis',
    starter: 'Obtener mi Ventaja',
    pro: 'Unirme al Elite',
    premium: 'Activar la Máquina',
};

// --- Plan perceived values ---
const PLAN_PERCEIVED_VALUES: Record<string, number> = {
    starter: 228,
    pro: 532,
    premium: 929,
};

// --- Plan bonuses ---
const PLAN_BONUSES: Record<string, string[]> = {
    pro: ['Guía "Los 7 Errores Fatales del Apostador"'],
    premium: ['Guía "Los 7 Errores Fatales"', 'Checklist Pre-Apuesta', 'Acceso anticipado'],
};

const getFeatures = (plan: SubscriptionPlan): string[] => {
    const features: string[] = [];

    if (plan.predictions_percentage >= 100) {
        features.push('Todas las oportunidades diarias');
    } else if (plan.predictions_percentage > 1) {
        features.push(`${plan.predictions_percentage}% de oportunidades diarias`);
    } else {
        features.push('1 oportunidad diaria de muestra');
    }

    if (plan.predictions_percentage >= 100) {
        features.push('Análisis completo de todos los partidos');
    } else if (plan.predictions_percentage >= 50) {
        features.push('Análisis de la mayoría de partidos');
    } else if (plan.predictions_percentage > 1) {
        features.push('Análisis de partidos seleccionados');
    }

    features.push(plan.can_access_full_stats ? 'Estadísticas avanzadas' : 'Estadísticas básicas');
    features.push('Historial verificable completo');
    features.push(plan.has_priority_support ? 'Soporte prioritario' : 'Soporte por email');

    return features;
};

// Fallback plans if DB doesn't load
const FALLBACK_PLANS = [
    { name: 'free', display_name: 'Explorador', price_cents: 0, annual_price_cents: 0, description: 'Explora el sistema con 1 oportunidad diaria' },
    { name: 'starter', display_name: 'Ventaja', price_cents: 1999, annual_price_cents: 19190, description: 'Tu ventaja competitiva con datos reales' },
    { name: 'pro', display_name: 'Elite', price_cents: 4999, annual_price_cents: 47990, description: 'Acceso mayoritario a la inteligencia deportiva' },
    { name: 'premium', display_name: 'Máquina', price_cents: 14999, annual_price_cents: 143990, description: 'El sistema completo. Sin límites.' },
];

// --- Color por plan (idéntico al interior de la plataforma) ---
//   Ventaja (starter) → verde · Élite (pro) → plateado · Máquina (premium) → oro
type PlanTheme = { base: string; bright: string; deep: string; ink: string; gradientText: boolean };
const PLAN_THEME: Record<string, PlanTheme> = {
    starter: { base: '#1DE782', bright: '#5BFFAC', deep: '#0BA35A', ink: '#04140C', gradientText: false },
    pro:     { base: '#C2CDD8', bright: '#E8EEF3', deep: '#8A97A4', ink: '#10151A', gradientText: true },
    premium: { base: '#E7B84F', bright: '#F6D27A', deep: '#B8902E', ink: '#1A1304', gradientText: true },
};
const DEFAULT_THEME: PlanTheme = PLAN_THEME.starter;

export const LandingPricing: React.FC = () => {
    const navigate = useNavigate();
    const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
    const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>('monthly');
    const [loading, setLoading] = useState(true);
    const { ref, isVisible } = useScrollReveal();
    const { trm } = useTRM();

    useEffect(() => {
        const load = async () => {
            const data = await getActivePlans();
            setPlans(data);
            setLoading(false);
        };
        load();
    }, []);

    const handleSelect = (planName: string) => {
        navigate(`/signup?plan=${planName}&billing=${billingPeriod}`);
    };

    const paidPlans = plans.filter((p) => p.price_cents > 0);
    const displayPlans = paidPlans.length > 0 ? paidPlans : [];

    return (
        <section id="planes" className="py-24 md:py-32 px-6 relative overflow-hidden">
            {/* Background */}
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/5 to-transparent" />
            <div className="absolute top-[20%] right-0 w-[500px] h-[500px] bg-brand/3 rounded-full blur-[120px] pointer-events-none" />

            <div className="max-w-7xl mx-auto" ref={ref}>
                {/* Header */}
                <div className={`text-center mb-8 transition-all duration-700 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
                    }`}>
                    <p className="text-sm font-bold uppercase tracking-widest text-brand/80 mb-4">El Sistema Derbix</p>
                    <h2 className="text-4xl md:text-5xl lg:text-6xl font-display font-bold text-white mb-6">
                        Deja de Perder Dinero<br />
                        <span className="text-brand">con Corazonadas</span>
                    </h2>
                    <p className="text-lg md:text-xl text-slate-400 max-w-2xl mx-auto">
                        Motor de IA con <span className="text-white font-semibold">83%+ de confianza</span>.
                        Historial 100% público. Sin tipsters. Sin humo.
                    </p>
                </div>

                {/* Stats bar */}
                <div className={`max-w-2xl mx-auto mb-12 transition-all duration-700 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
                    }`} style={{ transitionDelay: '50ms' }}>
                    <div className="grid grid-cols-3 gap-3">
                        <div className="text-center p-3 bg-[#0C1310] backdrop-blur-sm rounded-xl border border-white/5">
                            <div className="text-xl md:text-2xl font-black text-brand">65.1%</div>
                            <div className="text-xs text-white font-medium mt-0.5">Win Rate</div>
                        </div>
                        <div className="text-center p-3 bg-[#0C1310] backdrop-blur-sm rounded-xl border border-white/5">
                            <div className="text-xl md:text-2xl font-black text-brand">91.7%</div>
                            <div className="text-xs text-white font-medium mt-0.5">Alta Confianza</div>
                        </div>
                        <div className="text-center p-3 bg-[#0C1310] backdrop-blur-sm rounded-xl border border-white/5">
                            <div className="text-xl md:text-2xl font-black text-brand">+29.3%</div>
                            <div className="text-xs text-white font-medium mt-0.5">ROI</div>
                        </div>
                    </div>
                </div>

                {/* Billing Toggle */}
                <div className={`flex items-center justify-center gap-4 mb-12 transition-all duration-700 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
                    }`} style={{ transitionDelay: '100ms' }}>
                    <button
                        onClick={() => setBillingPeriod('monthly')}
                        className={`px-5 py-2.5 rounded-full text-sm font-semibold transition-all ${billingPeriod === 'monthly'
                            ? 'bg-white text-slate-950'
                            : 'bg-white/5 text-slate-400 hover:text-white hover:bg-white/10'
                            }`}
                    >
                        Mensual
                    </button>
                    <button
                        onClick={() => setBillingPeriod('annual')}
                        className={`px-5 py-2.5 rounded-full text-sm font-semibold transition-all flex items-center gap-2 ${billingPeriod === 'annual'
                            ? 'bg-white text-slate-950'
                            : 'bg-white/5 text-slate-400 hover:text-white hover:bg-white/10'
                            }`}
                    >
                        Anual
                        <span className="px-2 py-0.5 rounded-full bg-brand/20 text-brand text-xs font-bold">
                            -20%
                        </span>
                    </button>
                </div>

                {/* Loading state */}
                {loading && (
                    <div className="flex items-center justify-center py-20">
                        <div className="w-8 h-8 border-2 border-brand/20 border-t-brand rounded-full animate-spin" />
                    </div>
                )}

                {/* Plan Cards */}
                {!loading && (
                    <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-${displayPlans.length > 0 ? displayPlans.length : 3} gap-6 max-w-5xl mx-auto transition-all duration-700 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
                        }`} style={{ transitionDelay: '200ms' }}>
                        {(displayPlans.length > 0 ? displayPlans : FALLBACK_PLANS.filter(p => p.price_cents > 0)).map((plan) => {
                            const isPro = plan.name === 'pro';
                            const annualCents = (plan as any).annual_price_cents ?? Math.round(plan.price_cents * 12 * 0.8);
                            const price = getPlanPrice(plan.price_cents, annualCents, billingPeriod);
                            const perceivedValue = PLAN_PERCEIVED_VALUES[plan.name];
                            const cta = PLAN_CTAS[plan.name] || 'Seleccionar Plan';
                            const bonuses = PLAN_BONUSES[plan.name] || [];
                            const savingsPercent = perceivedValue ? Math.round((1 - (plan.price_cents / 100) / perceivedValue) * 100) : null;

                            // Color por plan: Ventaja→verde, Élite→plateado, Máquina→oro
                            const theme = PLAN_THEME[plan.name] || DEFAULT_THEME;
                            const featured = isPro; // Élite (plateado) es el plan destacado
                            const accentStyle: React.CSSProperties = theme.gradientText
                                ? { background: `linear-gradient(90deg, ${theme.bright}, ${theme.base})`, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }
                                : { color: theme.base };
                            const cardStyle = {
                                ['--pc']: theme.base,
                                ['--pci']: theme.ink,
                                ['--pc-tint']: `color-mix(in srgb, ${theme.base} 12%, transparent)`,
                                ['--pc-bd']: `color-mix(in srgb, ${theme.base} 35%, transparent)`,
                                background: featured
                                    ? `linear-gradient(180deg, color-mix(in srgb, ${theme.base} 7%, #0C1310), #0C1310)`
                                    : '#0C1310',
                                borderColor: featured
                                    ? `color-mix(in srgb, ${theme.base} 42%, transparent)`
                                    : `color-mix(in srgb, ${theme.base} 20%, rgba(255,255,255,0.06))`,
                                boxShadow: featured ? `0 0 50px -10px color-mix(in srgb, ${theme.base} 34%, transparent)` : undefined,
                            } as React.CSSProperties;

                            return (
                                <div
                                    key={plan.name}
                                    style={cardStyle}
                                    className={`relative rounded-3xl border transition-all duration-500 hover:-translate-y-1 ${featured ? 'scale-[1.02] lg:scale-105' : 'hover:shadow-[0_24px_60px_-28px_var(--pc)]'}`}
                                >
                                    {/* Popular badge */}
                                    {featured && (
                                        <div
                                            className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1.5 text-xs font-bold rounded-full uppercase tracking-wider flex items-center gap-1.5"
                                            style={{ background: `linear-gradient(90deg, ${theme.bright}, ${theme.deep})`, color: theme.ink }}
                                        >
                                            <SparklesIcon className="w-3.5 h-3.5" />
                                            Más Popular
                                        </div>
                                    )}

                                    <div className="p-8">
                                        {/* Plan name */}
                                        <h3 className="text-xl font-display font-bold mb-1" style={accentStyle}>{plan.display_name}</h3>
                                        <p className="text-sm text-slate-400 mb-6">{plan.description || ''}</p>

                                        {/* Price */}
                                        <div className="mb-6">
                                            {perceivedValue && (
                                                <div className="text-sm text-slate-500 line-through mb-1">
                                                    Valor: ${perceivedValue}/mes
                                                </div>
                                            )}
                                            <div className="flex items-baseline gap-1">
                                                <span className="text-4xl font-display font-bold" style={accentStyle}>
                                                    {billingPeriod === 'annual' && annualCents > 0
                                                        ? `$${(annualCents / 12 / 100).toFixed(2)}`
                                                        : `$${(plan.price_cents / 100).toFixed(2)}`}
                                                </span>
                                                <span className="text-slate-500 text-sm">/mes</span>
                                            </div>
                                            <CopPriceBadge
                                                usdAmount={
                                                    billingPeriod === 'annual' && annualCents > 0
                                                        ? annualCents / 12 / 100
                                                        : plan.price_cents / 100
                                                }
                                                trm={trm}
                                                suffix="/mes"
                                                className="mt-1"
                                            />
                                            <div className="flex flex-wrap gap-2 mt-1">
                                                {savingsPercent && (
                                                    <span className="inline-flex items-center px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/30 rounded text-emerald-400 text-xs font-bold">
                                                        Ahorras {savingsPercent}%
                                                    </span>
                                                )}
                                                {billingPeriod === 'annual' && annualCents > 0 && (
                                                    <span className="text-xs text-brand/80">
                                                        {price.savings} — Facturado anualmente
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Features */}
                                        {'predictions_percentage' in plan ? (
                                            <ul className="space-y-3 mb-6">
                                                {getFeatures(plan as SubscriptionPlan).map((feat, fi) => (
                                                    <li key={fi} className="flex items-start gap-3">
                                                        <CheckIcon className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: theme.base }} />
                                                        <span className="text-sm text-slate-300">{feat}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : (
                                            <div className="h-48" />
                                        )}

                                        {/* Bonuses */}
                                        {bonuses.length > 0 && (
                                            <div className="mb-6 pt-4 border-t border-white/5">
                                                <p className="text-xs font-bold uppercase tracking-wider text-amber-400 mb-2 flex items-center gap-1.5">
                                                    <span>🎁</span> Bonuses
                                                </p>
                                                {bonuses.map((b, bi) => (
                                                    <div key={bi} className="flex items-start gap-2 mb-1.5">
                                                        <CheckIcon className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                                                        <span className="text-xs text-slate-300">{b}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {/* CTA */}
                                        {featured ? (
                                            <button
                                                onClick={() => handleSelect(plan.name)}
                                                className="w-full py-3.5 rounded-xl font-bold text-sm transition-all hover:brightness-110"
                                                style={{ background: `linear-gradient(90deg, ${theme.bright}, ${theme.base})`, color: theme.ink, boxShadow: `0 0 24px -2px color-mix(in srgb, ${theme.base} 45%, transparent)` }}
                                            >
                                                {cta}
                                            </button>
                                        ) : (
                                            <button
                                                onClick={() => handleSelect(plan.name)}
                                                className="w-full py-3.5 rounded-xl font-bold text-sm transition-all border bg-[var(--pc-tint)] text-[var(--pc)] border-[var(--pc-bd)] hover:bg-[var(--pc)] hover:text-[var(--pci)]"
                                            >
                                                {cta}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Free plan note */}
                {!loading && (
                    <div className={`mt-10 text-center transition-all duration-700 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
                        }`} style={{ transitionDelay: '400ms' }}>
                        <p className="text-slate-500 text-sm">
                            ¿Solo quieres probar? {' '}
                            <button
                                onClick={() => handleSelect('free')}
                                className="text-brand hover:text-brand-hover font-semibold underline underline-offset-2 transition-colors"
                            >
                                Empieza gratis
                            </button>
                            {' '} — sin tarjeta de crédito.
                        </p>
                    </div>
                )}

                {/* Garantía */}
                {!loading && (
                    <div className={`max-w-xl mx-auto mt-10 text-center transition-all duration-700 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
                        }`} style={{ transitionDelay: '500ms' }}>
                        <p className="text-slate-500 text-xs leading-relaxed">
                            <span className="text-white font-medium">Garantía de Transparencia:</span>{' '}
                            Cada pick se verifica automáticamente. Si ocultamos un solo resultado,
                            te devolvemos tu pago. Sin preguntas.
                        </p>
                    </div>
                )}
            </div>
        </section>
    );
};
