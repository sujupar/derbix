'use client';

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckIcon, SparklesIcon } from '../icons/Icons';
import { getActivePlans, SubscriptionPlan } from '../../services/subscriptionService';
import { getPlanPrice } from '../../services/lemonSqueezyService';
import { useAuth } from '../../hooks/useAuth';
import { trackUpgradePremium } from '../../services/analyticsService';
import { useTRM } from '../../hooks/useTRM';
import { CopPriceBadge } from './CopPriceBadge';
import { TRMRate } from '../../services/trmService';

// --- Value Stack Data ---
const VALUE_STACK_ITEMS = [
    { icon: '🎯', label: 'Motor IA de Oportunidades', value: '$197/mes', desc: 'Analiza todos los partidos, filtra solo 83%+' },
    { icon: '⚡', label: 'Análisis Automático Diario', value: '$97/mes', desc: '+50 partidos procesados cada día' },
    { icon: '📊', label: 'Historial Verificable', value: '$97/mes', desc: 'Resultados públicos, sin editar' },
    { icon: '🛡️', label: 'Gestión de Riesgo', value: '$97/mes', desc: 'Recomendaciones de staking por pick' },
    { icon: '📈', label: 'Dashboard de ROI', value: '$47/mes', desc: 'Trackea tu rendimiento real' },
];

// --- Plan-specific "perceived value" for strikethrough ---
const PLAN_PERCEIVED_VALUES: Record<string, number> = {
    starter: 228,
    pro: 532,
    premium: 929,
};

// --- Plan-specific CTAs ---
const PLAN_CTAS: Record<string, string> = {
    free: 'Probar Gratis',
    starter: 'Obtener mi Ventaja',
    pro: 'Unirme al Elite',
    premium: 'Activar la Máquina',
};

// --- Plan bonuses ---
const PLAN_BONUSES: Record<string, { label: string; value: string }[]> = {
    pro: [
        { label: 'Guía "Los 7 Errores Fatales del Apostador"', value: '$47' },
    ],
    premium: [
        { label: 'Guía "Los 7 Errores Fatales del Apostador"', value: '$47' },
        { label: 'Checklist Pre-Apuesta', value: '$27' },
        { label: 'Acceso anticipado a nuevas features', value: '$97' },
    ],
};

// --- FAQ Data ---
const FAQ_ITEMS = [
    {
        q: '¿Cómo sé que no es otra estafa de tipsters?',
        a: 'Nuestro historial es 100% público y verificado automáticamente contra resultados reales. Cada pick queda registrado ANTES del partido. No editamos, no ocultamos, no borramos. Puedes auditar todo, incluso con el plan gratuito.',
    },
    {
        q: '¿Y si no gano en el primer mes?',
        a: 'Las apuestas deportivas requieren disciplina y un horizonte de tiempo razonable. Nuestro sistema tiene un win rate verificado de 65.1%, pero las rachas son parte del juego. Lo importante es la consistencia a largo plazo.',
    },
    {
        q: '¿Puedo cancelar cuando quiera?',
        a: 'Sí. Sin penalidad, sin preguntas, sin trucos. Cancelas desde tu portal de suscripción y mantienes acceso hasta el final del período pagado.',
    },
    {
        q: '¿Los precios van a subir?',
        a: 'Estos son precios de lanzamiento. A medida que el sistema mejore y crezca la base de datos de resultados verificados, los precios se ajustarán. Quienes se suscriban ahora mantienen su precio.',
    },
];

// --- Stat Bar Data ---
const STATS = [
    { value: '65.1%', label: 'Win Rate Verificado', sub: '63 picks auditados' },
    { value: '91.7%', label: 'WR Alta Confianza', sub: 'Banda 83-85%' },
    { value: '+29.3%', label: 'ROI Mejor Rango', sub: 'Odds 1.70-1.99' },
];

// --- Features per plan (benefit-oriented copy) ---
const getPlanFeatures = (plan: SubscriptionPlan): { label: string; included: boolean }[] => {
    const features: { label: string; included: boolean }[] = [];

    // Oportunidades
    if (plan.predictions_percentage <= 1) {
        features.push({ label: '1 oportunidad diaria de muestra', included: true });
    } else if (plan.predictions_percentage >= 100) {
        features.push({ label: 'Todas las oportunidades diarias (100%)', included: true });
    } else {
        features.push({ label: `${plan.predictions_percentage}% de oportunidades diarias`, included: true });
    }

    // Análisis
    if (plan.analysis_percentage > 0) {
        features.push({ label: plan.analysis_percentage >= 100 ? 'Análisis completo de todos los partidos' : 'Análisis de partidos seleccionados', included: true });
    } else {
        features.push({ label: 'Análisis de partidos', included: false });
    }

    // Stats
    features.push({ label: 'Estadísticas avanzadas', included: plan.can_access_full_stats });

    // History (always)
    features.push({ label: 'Historial verificable completo', included: true });

    // Support
    features.push({ label: 'Soporte prioritario', included: plan.has_priority_support });

    return features;
};

// --- Pricing Card ---
interface PricingCardProps {
    plan: SubscriptionPlan;
    isPopular: boolean;
    billingPeriod: 'monthly' | 'annual';
    onSelect: (plan: SubscriptionPlan) => void;
    isProcessing: boolean;
    trm: TRMRate | null;
}

const PricingCard: React.FC<PricingCardProps> = ({ plan, isPopular, billingPeriod, onSelect, isProcessing, trm }) => {
    const priceDisplay = getPlanPrice(plan.price_cents, plan.annual_price_cents, billingPeriod);
    const monthlyEquivalentUsd = billingPeriod === 'annual' && plan.annual_price_cents > 0
        ? plan.annual_price_cents / 12 / 100
        : plan.price_cents / 100;
    const perceivedValue = PLAN_PERCEIVED_VALUES[plan.name];
    const bonuses = PLAN_BONUSES[plan.name] || [];
    const cta = PLAN_CTAS[plan.name] || 'Seleccionar Plan';
    const features = getPlanFeatures(plan);
    const savingsPercent = perceivedValue ? Math.round((1 - (plan.price_cents / 100) / perceivedValue) * 100) : null;

    return (
        <div className={`
            relative flex flex-col bg-slate-900/80 backdrop-blur-sm rounded-2xl border-2 transition-all duration-300
            ${isPopular
                ? 'border-brand shadow-xl shadow-brand/20 scale-105 lg:scale-110'
                : 'border-white/10 hover:border-white/20'}
        `}>
            {isPopular && (
                <div className="absolute -top-5 left-1/2 -translate-x-1/2 z-10">
                    <div className="bg-gradient-to-r from-brand via-emerald-400 to-brand text-slate-900 text-xs font-black px-5 py-2 rounded-full uppercase tracking-wider flex items-center gap-2 shadow-lg shadow-brand/40">
                        <SparklesIcon className="w-4 h-4" />
                        Más Popular
                        <SparklesIcon className="w-4 h-4" />
                    </div>
                </div>
            )}

            <div className={`p-6 border-b border-white/5 ${isPopular ? 'bg-gradient-to-b from-brand/10 to-transparent' : ''}`}>
                <h3 className="text-lg font-bold text-white">{plan.display_name}</h3>
                <p className="text-sm text-gray-400 mt-1">{plan.description}</p>

                <div className="mt-4">
                    {/* Perceived value strikethrough */}
                    {perceivedValue && (
                        <div className="text-sm text-gray-500 line-through mb-1">
                            Valor: ${perceivedValue}/mes
                        </div>
                    )}
                    <div className="flex items-baseline gap-1">
                        <span className={`text-4xl font-black ${isPopular ? 'text-brand' : 'text-white'}`}>
                            {plan.price_cents === 0 ? 'Gratis' : priceDisplay.monthly.replace('/mes', '')}
                        </span>
                        {plan.price_cents > 0 && (
                            <span className="text-gray-500">/mes</span>
                        )}
                    </div>
                    {plan.price_cents > 0 && (
                        <CopPriceBadge
                            usdAmount={monthlyEquivalentUsd}
                            trm={trm}
                            suffix="/mes"
                            className="mt-1.5"
                        />
                    )}
                    {/* Savings badge */}
                    {savingsPercent && (
                        <div className="mt-1 inline-flex items-center px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/30 rounded text-emerald-400 text-xs font-bold">
                            Ahorras {savingsPercent}%
                        </div>
                    )}
                    {/* Annual billing note */}
                    {priceDisplay.savings && billingPeriod === 'annual' && (
                        <div className="mt-1 inline-flex items-center ml-2 px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/30 rounded text-emerald-400 text-xs font-medium">
                            {priceDisplay.savings}
                        </div>
                    )}
                    {billingPeriod === 'annual' && plan.annual_price_cents > 0 && (
                        <p className="text-xs text-gray-500 mt-1">
                            Facturado {priceDisplay.display}
                        </p>
                    )}
                </div>
            </div>

            {/* Features */}
            <div className="flex-grow p-6 space-y-3">
                {features.map((feature, idx) => (
                    <div key={idx} className="flex items-start gap-3">
                        {feature.included ? (
                            <CheckIcon className={`w-5 h-5 shrink-0 mt-0.5 ${isPopular ? 'text-brand' : 'text-emerald-500'}`} />
                        ) : (
                            <svg className="w-5 h-5 shrink-0 mt-0.5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        )}
                        <span className={feature.included ? 'text-white' : 'text-gray-500'}>
                            {feature.label}
                        </span>
                    </div>
                ))}

                {/* Bonuses section */}
                {bonuses.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-white/5">
                        <p className="text-xs font-bold uppercase tracking-wider text-amber-400 mb-3 flex items-center gap-1.5">
                            <span>🎁</span> Bonuses incluidos
                        </p>
                        {bonuses.map((bonus, idx) => (
                            <div key={idx} className="flex items-start gap-3 mb-2">
                                <CheckIcon className="w-5 h-5 shrink-0 mt-0.5 text-amber-400" />
                                <div>
                                    <span className="text-white text-sm">{bonus.label}</span>
                                    <span className="text-amber-400 text-xs font-bold ml-2">(valor: {bonus.value})</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* CTA */}
            <div className="p-6 border-t border-white/5">
                <button
                    onClick={() => onSelect(plan)}
                    disabled={isProcessing}
                    className={`
                        w-full py-3 px-6 rounded-xl font-bold transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed
                        ${isPopular
                            ? 'bg-gradient-to-r from-brand via-emerald-400 to-brand text-slate-900 hover:shadow-lg hover:shadow-brand/40 hover:scale-[1.02]'
                            : 'bg-white/5 text-white hover:bg-white/10 border border-white/10'
                        }
                    `}
                >
                    {cta}
                </button>
            </div>
        </div>
    );
};

// --- FAQ Accordion Item ---
const FAQItem: React.FC<{ q: string; a: string }> = ({ q, a }) => {
    const [open, setOpen] = useState(false);
    return (
        <div className="border-b border-white/5 last:border-0">
            <button
                onClick={() => setOpen(!open)}
                className="w-full flex items-center justify-between py-4 text-left group"
            >
                <span className="text-white font-medium group-hover:text-brand transition-colors">{q}</span>
                <svg
                    className={`w-5 h-5 text-gray-400 shrink-0 ml-4 transition-transform ${open ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>
            {open && (
                <p className="text-gray-400 text-sm pb-4 leading-relaxed">{a}</p>
            )}
        </div>
    );
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================
export const PublicPricingPage: React.FC = () => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annual'>('monthly');
    const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
    const [loading, setLoading] = useState(true);
    const { trm } = useTRM();

    useEffect(() => {
        const loadPlans = async () => {
            const data = await getActivePlans();
            setPlans(data);
            setLoading(false);
        };
        loadPlans();
    }, []);

    const handleSelectPlan = (plan: SubscriptionPlan) => {
        trackUpgradePremium(plan.name);
        if (!user) {
            navigate(`/signup?plan=${plan.name}&billing=${billingPeriod}`);
            return;
        }
        navigate('/app?page=pricing');
    };

    const paidPlans = plans.filter(p => p.price_cents > 0);

    if (loading) {
        return (
            <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 flex items-center justify-center">
                <div className="w-10 h-10 border-4 border-brand border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 py-12 px-4">
            {/* Back button */}
            <div className="text-center mb-6">
                <button
                    onClick={() => navigate('/')}
                    className="text-brand hover:text-emerald-400 text-sm font-medium inline-block"
                >
                    ← Volver al inicio
                </button>
            </div>

            {/* ======================== SECTION A: HERO EMOCIONAL ======================== */}
            <div className="text-center max-w-3xl mx-auto mb-8">
                <h1 className="text-4xl md:text-5xl lg:text-6xl font-black text-white mb-4 leading-tight">
                    Deja de Perder Dinero<br />
                    <span className="text-brand">con Corazonadas</span>
                </h1>
                <p className="text-lg md:text-xl text-gray-400 max-w-2xl mx-auto leading-relaxed">
                    Nuestro motor de IA analiza +50 partidos diarios y te entrega solo las oportunidades
                    con <span className="text-white font-semibold">83%+ de confianza</span>.
                    Historial 100% público. Sin tipsters. Sin humo.
                </p>
            </div>

            {/* ======================== SECTION B: STATS BAR ======================== */}
            <div className="max-w-3xl mx-auto mb-12">
                <div className="grid grid-cols-3 gap-4">
                    {STATS.map((stat, i) => (
                        <div
                            key={i}
                            className="text-center p-4 bg-slate-900/60 backdrop-blur-sm rounded-xl border border-white/5"
                        >
                            <div className="text-2xl md:text-3xl font-black text-brand">{stat.value}</div>
                            <div className="text-xs md:text-sm font-medium text-white mt-1">{stat.label}</div>
                            <div className="text-xs text-gray-500 mt-0.5">{stat.sub}</div>
                        </div>
                    ))}
                </div>
            </div>

            {/* ======================== SECTION C: VALUE STACK ======================== */}
            <div className="max-w-4xl mx-auto mb-12">
                <h2 className="text-2xl md:text-3xl font-black text-white text-center mb-8">
                    Lo que incluye <span className="text-brand">El Sistema Derbix</span>
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {VALUE_STACK_ITEMS.map((item, i) => (
                        <div
                            key={i}
                            className="flex items-start gap-3 p-4 bg-slate-900/60 backdrop-blur-sm rounded-xl border border-white/5"
                        >
                            <span className="text-2xl">{item.icon}</span>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-white font-medium text-sm">{item.label}</span>
                                    <span className="text-brand font-bold text-sm whitespace-nowrap">{item.value}</span>
                                </div>
                                <p className="text-gray-500 text-xs mt-0.5">{item.desc}</p>
                            </div>
                        </div>
                    ))}
                </div>
                <div className="text-center mt-6">
                    <p className="text-gray-400">
                        Valor total del sistema: <span className="text-white font-black text-xl line-through">$682/mes</span>
                    </p>
                    <p className="text-brand font-bold text-lg mt-1">Elige tu nivel de acceso:</p>
                </div>
            </div>

            {/* ======================== SECTION D: TOGGLE MENSUAL/ANUAL ======================== */}
            <div className="flex items-center justify-center gap-3 mb-10">
                <span className={`text-sm font-medium ${billingPeriod === 'monthly' ? 'text-white' : 'text-gray-500'}`}>
                    Mensual
                </span>
                <button
                    onClick={() => setBillingPeriod(bp => bp === 'monthly' ? 'annual' : 'monthly')}
                    className={`relative w-14 h-7 rounded-full transition-colors ${billingPeriod === 'annual' ? 'bg-brand' : 'bg-slate-700'}`}
                >
                    <div className={`absolute top-0.5 w-6 h-6 rounded-full bg-white transition-transform ${billingPeriod === 'annual' ? 'translate-x-7' : 'translate-x-0.5'}`} />
                </button>
                <span className={`text-sm font-medium ${billingPeriod === 'annual' ? 'text-white' : 'text-gray-500'}`}>
                    Anual
                </span>
                {billingPeriod === 'annual' && (
                    <span className="ml-1 px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/30 rounded text-emerald-400 text-xs font-bold">
                        -20%
                    </span>
                )}
            </div>

            {/* ======================== SECTION E: PLAN CARDS ======================== */}
            <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                {paidPlans.map((plan) => (
                    <PricingCard
                        key={plan.id}
                        plan={plan}
                        isPopular={plan.name === 'pro'}
                        billingPeriod={billingPeriod}
                        onSelect={handleSelectPlan}
                        isProcessing={false}
                        trm={trm}
                    />
                ))}
            </div>

            {/* Free plan link */}
            <div className="text-center mb-16">
                <p className="text-gray-500 text-sm">
                    ¿Solo quieres probar?{' '}
                    <button
                        onClick={() => handleSelectPlan(plans.find(p => p.price_cents === 0)!)}
                        className="text-brand hover:text-emerald-400 font-semibold underline underline-offset-2 transition-colors"
                    >
                        Empieza gratis
                    </button>
                    {' '}con 1 oportunidad diaria — sin tarjeta de crédito.
                </p>
            </div>

            {/* ======================== SECTION F: GARANTIA ======================== */}
            <div className="max-w-2xl mx-auto mb-16">
                <div className="bg-slate-900/60 backdrop-blur-sm rounded-2xl border border-white/5 p-8 text-center">
                    <div className="w-14 h-14 bg-brand/10 rounded-full flex items-center justify-center mx-auto mb-4">
                        <svg className="w-7 h-7 text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                        </svg>
                    </div>
                    <h3 className="text-xl font-bold text-white mb-3">
                        Nuestra Garantía: Transparencia Total
                    </h3>
                    <p className="text-gray-400 leading-relaxed mb-4">
                        No prometemos que vas a ganar cada apuesta — nadie serio lo haría.
                        Pero cada pick se verifica automáticamente contra resultados reales.
                        Nuestro historial es público, sin editar, accesible para todos.
                    </p>
                    <p className="text-white font-medium">
                        Si encuentras que hemos ocultado o manipulado un solo resultado,
                        te devolvemos el 100% de tu último pago. Sin preguntas.
                    </p>
                    <p className="text-brand text-sm font-semibold mt-3">
                        Esa es la diferencia entre un sistema y una estafa.
                    </p>
                </div>
            </div>

            {/* ======================== SECTION G: FAQ ======================== */}
            <div className="max-w-2xl mx-auto mb-12">
                <h3 className="text-xl font-bold text-white text-center mb-6">Preguntas Frecuentes</h3>
                <div className="bg-slate-900/60 backdrop-blur-sm rounded-2xl border border-white/5 p-6">
                    {FAQ_ITEMS.map((item, i) => (
                        <FAQItem key={i} q={item.q} a={item.a} />
                    ))}
                </div>
            </div>

            {/* Footer note */}
            <div className="max-w-3xl mx-auto text-center">
                <p className="text-gray-500 text-sm">
                    Precios en USD. Equivalencia en COP referencial, calculada con la TRM oficial
                    actualizada diariamente. Puedes cancelar en cualquier momento. Todos los planes
                    incluyen acceso al historial completo de resultados anteriores.
                </p>
            </div>
        </div>
    );
};
