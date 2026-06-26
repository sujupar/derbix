import React, { useState, useEffect } from 'react';
import { getActivePlans, formatPrice, SubscriptionPlan, assignPlanToUser } from '../../services/subscriptionService';
import { openCheckoutOverlay, getVariantId, getPlanPrice } from '../../services/lemonSqueezyService';
import { supabase } from '../../services/supabaseService';
import { useSubscription } from '../../contexts/SubscriptionContext';
import { useAuth } from '../../hooks/useAuth';
import { useOrganization } from '../../contexts/OrganizationContext';
import { CheckCircleIcon, XCircleIcon, SparklesIcon, ArrowRightIcon } from '../icons/Icons';
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

// --- Plan-specific perceived values ---
const PLAN_PERCEIVED_VALUES: Record<string, number> = {
    starter: 228,
    pro: 532,
    premium: 929,
};

// --- Plan CTAs ---
const PLAN_CTAS: Record<string, string> = {
    free: 'Comenzar Gratis',
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

// --- Stats ---
const STATS = [
    { value: '65.1%', label: 'Win Rate Verificado', sub: '63 picks auditados' },
    { value: '91.7%', label: 'WR Alta Confianza', sub: 'Banda 83-85%' },
    { value: '+29.3%', label: 'ROI Mejor Rango', sub: 'Odds 1.70-1.99' },
];

// --- Features per plan ---
const getPlanFeatures = (plan: SubscriptionPlan): { label: string; included: boolean }[] => {
    const features: { label: string; included: boolean }[] = [];

    if (plan.predictions_percentage <= 1) {
        features.push({ label: '1 oportunidad diaria de muestra', included: true });
    } else if (plan.predictions_percentage >= 100) {
        features.push({ label: 'Todas las oportunidades diarias (100%)', included: true });
    } else {
        features.push({ label: `${plan.predictions_percentage}% de oportunidades diarias`, included: true });
    }

    if (plan.analysis_percentage > 0) {
        features.push({ label: plan.analysis_percentage >= 100 ? 'Análisis completo de todos los partidos' : 'Análisis de partidos seleccionados', included: true });
    } else {
        features.push({ label: 'Análisis de partidos', included: false });
    }

    features.push({ label: 'Estadísticas avanzadas', included: plan.can_access_full_stats });
    features.push({ label: 'Historial verificable completo', included: true });
    features.push({ label: 'Soporte prioritario', included: plan.has_priority_support });

    return features;
};

// --- Pricing Card ---
interface PricingCardProps {
    plan: SubscriptionPlan;
    isCurrentPlan: boolean;
    isPopular: boolean;
    isProcessing: boolean;
    billingPeriod: 'monthly' | 'annual';
    onSelect: (plan: SubscriptionPlan) => void;
    trm: TRMRate | null;
}

const PricingCard: React.FC<PricingCardProps> = ({ plan, isCurrentPlan, isPopular, isProcessing, billingPeriod, onSelect, trm }) => {
    const priceDisplay = getPlanPrice(plan.price_cents, plan.annual_price_cents, billingPeriod);
    const monthlyEquivalentUsd = billingPeriod === 'annual' && plan.annual_price_cents > 0
        ? plan.annual_price_cents / 12 / 100
        : plan.price_cents / 100;
    const perceivedValue = PLAN_PERCEIVED_VALUES[plan.name];
    const bonuses = PLAN_BONUSES[plan.name] || [];
    const cta = PLAN_CTAS[plan.name] || 'Seleccionar Plan';
    const features = getPlanFeatures(plan);
    const savingsPercent = perceivedValue ? Math.round((1 - (plan.price_cents / 100) / perceivedValue) * 100) : null;

    // Acento por plan: premium → dorado · recomendado (popular) → verde · resto → neutro
    const isPremium = plan.name === 'premium';

    return (
        <div className={`
            relative flex flex-col bg-dx-surface backdrop-blur-sm rounded-2xl border-2 transition-all duration-300
            ${isPremium ? 'border-dx-gold shadow-xl shadow-dx-gold/20'
                : isPopular ? 'border-dx-green shadow-xl shadow-dx-green-glow lg:scale-105'
                : 'border-dx-border hover:border-dx-border-active'}
            ${isCurrentPlan ? `ring-2 ${isPremium ? 'ring-dx-gold' : 'ring-dx-green'} ring-offset-2 ring-offset-dx-bg` : ''}
        `}>
            {isPopular && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                    <div className="bg-gradient-to-r from-dx-green to-dx-cyan text-[#04140C] text-xs font-black px-4 py-1 rounded-full uppercase tracking-wider flex items-center gap-1">
                        <SparklesIcon className="w-3 h-3" />
                        Más Popular
                    </div>
                </div>
            )}
            {isPremium && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                    <div className="bg-gradient-to-r from-dx-gold to-[#F6D27A] text-[#1A1305] text-xs font-black px-4 py-1 rounded-full uppercase tracking-wider flex items-center gap-1">
                        <SparklesIcon className="w-3 h-3" />
                        Máximo Acceso
                    </div>
                </div>
            )}

            <div className={`p-6 border-b border-dx-border ${isPremium ? 'bg-gradient-to-b from-dx-gold/10 to-transparent' : isPopular ? 'bg-gradient-to-b from-dx-green/10 to-transparent' : ''}`}>
                <h3 className="text-lg font-bold text-white">{plan.display_name}</h3>
                <p className="text-sm text-dx-text-soft mt-1">{plan.description}</p>

                <div className="mt-4">
                    {perceivedValue && (
                        <div className="text-sm text-dx-text-mute line-through mb-1 dx-num">
                            Valor: ${perceivedValue}/mes
                        </div>
                    )}
                    <div className="flex items-baseline gap-1">
                        <span className={`text-3xl sm:text-4xl font-display font-black dx-num ${isPremium ? 'text-dx-gold' : isPopular ? 'text-dx-green' : 'text-white'}`}>
                            {plan.price_cents === 0 ? 'Gratis' : priceDisplay.monthly.replace('/mes', '')}
                        </span>
                        {plan.price_cents > 0 && (
                            <span className="text-dx-text-mute">/mes</span>
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
                    {savingsPercent && (
                        <div className="mt-1 inline-flex items-center px-2 py-0.5 bg-dx-green/10 border border-dx-green/30 rounded text-dx-green text-xs font-bold dx-num">
                            Ahorras {savingsPercent}%
                        </div>
                    )}
                    {priceDisplay.savings && billingPeriod === 'annual' && (
                        <div className="mt-1 inline-flex items-center ml-2 px-2 py-0.5 bg-dx-green/10 border border-dx-green/30 rounded text-dx-green text-xs font-medium">
                            {priceDisplay.savings}
                        </div>
                    )}
                    {billingPeriod === 'annual' && plan.annual_price_cents > 0 && (
                        <p className="text-xs text-dx-text-mute mt-1">
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
                            <CheckCircleIcon className={`w-5 h-5 shrink-0 mt-0.5 ${isPremium ? 'text-dx-gold' : 'text-dx-green'}`} />
                        ) : (
                            <XCircleIcon className="w-5 h-5 text-dx-text-mute shrink-0 mt-0.5" />
                        )}
                        <span className={feature.included ? 'text-white' : 'text-dx-text-mute'}>
                            {feature.label}
                        </span>
                    </div>
                ))}

                {/* Bonuses */}
                {bonuses.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-dx-border">
                        <p className="text-xs font-bold uppercase tracking-wider text-dx-gold mb-3 flex items-center gap-1.5">
                            <span>🎁</span> Bonuses incluidos
                        </p>
                        {bonuses.map((bonus, idx) => (
                            <div key={idx} className="flex items-start gap-3 mb-2">
                                <CheckCircleIcon className="w-5 h-5 shrink-0 mt-0.5 text-dx-gold" />
                                <div>
                                    <span className="text-white text-sm">{bonus.label}</span>
                                    <span className="text-dx-gold text-xs font-bold ml-2">(valor: {bonus.value})</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* CTA */}
            <div className="p-6 border-t border-dx-border">
                {isCurrentPlan ? (
                    <button
                        disabled
                        className="w-full py-3 px-6 rounded-xl font-bold text-dx-text-mute bg-dx-surface-2 border border-dx-border cursor-not-allowed"
                    >
                        Plan Actual
                    </button>
                ) : (
                    <button
                        onClick={() => onSelect(plan)}
                        disabled={isProcessing}
                        className={`
                            w-full py-3 px-6 rounded-xl font-bold transition-all flex items-center justify-center gap-2
                            ${isPremium
                                ? 'bg-gradient-to-r from-dx-gold to-[#F6D27A] text-[#1A1305] hover:shadow-lg hover:shadow-dx-gold/30 hover:scale-[1.02]'
                                : isPopular
                                ? 'bg-gradient-to-r from-dx-green to-dx-cyan text-[#04140C] hover:shadow-lg hover:shadow-dx-green-glow hover:scale-[1.02]'
                                : 'bg-white/5 text-white hover:bg-white/10 border border-dx-border'
                            }
                            ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}
                        `}
                    >
                        {isProcessing ? (
                            <>
                                <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                Procesando...
                            </>
                        ) : (
                            <>
                                {cta}
                                <ArrowRightIcon className="w-4 h-4" />
                            </>
                        )}
                    </button>
                )}
            </div>
        </div>
    );
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================
export const PricingPage: React.FC = () => {
    const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState<string | null>(null);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
    const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annual'>('monthly');

    const { plan: currentPlan, refreshSubscription } = useSubscription();
    const { user, profile } = useAuth();
    const { currentOrg } = useOrganization();
    const { trm } = useTRM();

    useEffect(() => {
        const loadPlans = async () => {
            const data = await getActivePlans();
            setPlans(data);
            setLoading(false);
        };
        loadPlans();
    }, []);

    const getPaymentProvider = (plan: SubscriptionPlan, period: 'monthly' | 'annual'): 'whop' | 'lemon_squeezy' | null => {
        const whopId = period === 'annual' ? (plan.whop_plan_id_annual || plan.whop_plan_id) : plan.whop_plan_id;
        if (whopId) return 'whop';
        if (getVariantId(plan, period)) return 'lemon_squeezy';
        return null;
    };

    const handleSelectPlan = async (plan: SubscriptionPlan) => {
        if (!user || !currentOrg) {
            setMessage({ type: 'error', text: 'Debes iniciar sesión para seleccionar un plan.' });
            return;
        }

        setProcessing(plan.id);
        setMessage(null);

        try {
            if (plan.price_cents === 0) {
                const result = await assignPlanToUser(user.id, currentOrg.id, plan.id);
                if (result.success) {
                    setMessage({ type: 'success', text: 'Plan gratuito activado.' });
                    await refreshSubscription();
                } else {
                    setMessage({ type: 'error', text: result.error || 'Error al asignar plan' });
                }
            } else {
                const provider = getPaymentProvider(plan, billingPeriod);

                if (provider === 'whop') {
                    const whopPlanId = billingPeriod === 'annual'
                        ? (plan.whop_plan_id_annual || plan.whop_plan_id)
                        : plan.whop_plan_id;

                    const { data, error } = await supabase.functions.invoke('whop-create-checkout', {
                        body: {
                            whopPlanId,
                            planId: plan.id,
                            userId: user.id,
                            orgId: currentOrg.id,
                            billingPeriod,
                            email: profile?.email || user.email || '',
                        }
                    });

                    if (error || !data?.purchase_url) {
                        const msg = data?.error || error?.message || 'Error al crear checkout. Intenta de nuevo.';
                        throw new Error(msg);
                    }

                    window.location.href = data.purchase_url;
                } else if (provider === 'lemon_squeezy') {
                    const variantId = getVariantId(plan, billingPeriod)!;
                    await openCheckoutOverlay({
                        variantId,
                        userId: user.id,
                        userEmail: profile?.email || user.email || '',
                        userName: profile?.full_name || 'Usuario',
                        orgId: currentOrg.id,
                        billingPeriod,
                    });
                    setMessage({ type: 'success', text: 'Checkout abierto. Completa el pago para activar tu plan.' });
                } else {
                    setMessage({ type: 'error', text: 'Plan no disponible para este período. Contacta soporte.' });
                }
            }
        } catch (error: any) {
            console.error('Error selecting plan:', error);
            setMessage({ type: 'error', text: error.message || 'Ocurrió un error. Intenta de nuevo.' });
        }

        setProcessing(null);
    };

    const paidPlans = plans.filter(p => p.price_cents > 0);
    const freePlan = plans.find(p => p.price_cents === 0);

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center">
                <div className="w-10 h-10 border-4 border-dx-green border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <div className="min-h-full bg-dx-bg py-12 px-4">
            {/* ======================== HERO ======================== */}
            <div className="text-center max-w-3xl mx-auto mb-8">
                <h1 className="text-3xl sm:text-4xl md:text-5xl font-display font-black text-white mb-4 leading-tight">
                    Deja de Perder Dinero<br />
                    <span className="text-dx-green">con Corazonadas</span>
                </h1>
                <p className="text-lg md:text-xl text-dx-text-soft max-w-2xl mx-auto leading-relaxed">
                    Nuestro motor de IA analiza +50 partidos diarios y te entrega solo las oportunidades
                    con <span className="text-white font-semibold">83%+ de confianza</span>.
                </p>
            </div>

            {/* ======================== STATS BAR ======================== */}
            <div className="max-w-3xl mx-auto mb-10">
                <div className="grid grid-cols-3 gap-3">
                    {STATS.map((stat, i) => (
                        <div key={i} className="text-center p-3 bg-dx-surface backdrop-blur-sm rounded-xl border border-dx-border">
                            <div className="text-xl md:text-2xl font-display font-black text-dx-green dx-num">{stat.value}</div>
                            <div className="text-xs font-medium text-white mt-1">{stat.label}</div>
                            <div className="text-xs text-dx-text-mute">{stat.sub}</div>
                        </div>
                    ))}
                </div>
            </div>

            {/* ======================== VALUE STACK ======================== */}
            <div className="max-w-4xl mx-auto mb-10">
                <h2 className="text-xl md:text-2xl font-display font-black text-white text-center mb-6">
                    Lo que incluye <span className="text-dx-green">El Sistema Derbix</span>
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {VALUE_STACK_ITEMS.map((item, i) => (
                        <div key={i} className="flex items-start gap-3 p-3 bg-dx-surface backdrop-blur-sm rounded-xl border border-dx-border">
                            <span className="text-xl">{item.icon}</span>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-white font-medium text-sm">{item.label}</span>
                                    <span className="text-dx-green font-bold text-sm whitespace-nowrap dx-num">{item.value}</span>
                                </div>
                                <p className="text-dx-text-mute text-xs mt-0.5">{item.desc}</p>
                            </div>
                        </div>
                    ))}
                </div>
                <div className="text-center mt-4">
                    <p className="text-dx-text-soft text-sm">
                        Valor total: <span className="text-white font-bold line-through dx-num">$682/mes</span>
                        <span className="text-dx-green font-bold ml-2">— Elige tu nivel de acceso:</span>
                    </p>
                </div>
            </div>

            {/* ======================== TOGGLE ======================== */}
            <div className="flex items-center justify-center gap-3 mb-10">
                <span className={`text-sm font-medium ${billingPeriod === 'monthly' ? 'text-white' : 'text-dx-text-mute'}`}>
                    Mensual
                </span>
                <button
                    onClick={() => setBillingPeriod(bp => bp === 'monthly' ? 'annual' : 'monthly')}
                    className={`relative w-14 h-7 rounded-full transition-colors ${billingPeriod === 'annual' ? 'bg-dx-green' : 'bg-dx-surface-2 border border-dx-border'}`}
                >
                    <div className={`absolute top-0.5 w-6 h-6 rounded-full bg-white transition-transform ${billingPeriod === 'annual' ? 'translate-x-7' : 'translate-x-0.5'}`} />
                </button>
                <span className={`text-sm font-medium ${billingPeriod === 'annual' ? 'text-white' : 'text-dx-text-mute'}`}>
                    Anual
                </span>
                {billingPeriod === 'annual' && (
                    <span className="ml-1 px-2 py-0.5 bg-dx-green/10 border border-dx-green/30 rounded text-dx-green text-xs font-bold">
                        -20%
                    </span>
                )}
            </div>

            {/* ======================== MESSAGE ======================== */}
            {message && (
                <div className={`max-w-2xl mx-auto mb-8 p-4 rounded-xl border ${message.type === 'success'
                    ? 'bg-dx-green/10 border-dx-green/30 text-dx-green'
                    : 'bg-dx-loss/10 border-dx-loss/30 text-dx-loss'
                    }`}>
                    <p className="text-center font-medium">{message.text}</p>
                </div>
            )}

            {/* ======================== PLAN CARDS ======================== */}
            <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                {paidPlans.map((plan) => (
                    <PricingCard
                        key={plan.id}
                        plan={plan}
                        isCurrentPlan={currentPlan?.plan_name === plan.name}
                        isPopular={plan.name === 'pro'}
                        isProcessing={processing === plan.id}
                        billingPeriod={billingPeriod}
                        onSelect={handleSelectPlan}
                        trm={trm}
                    />
                ))}
            </div>

            {/* Free plan */}
            {freePlan && (
                <div className="text-center mb-10">
                    <p className="text-dx-text-mute text-sm">
                        {currentPlan?.plan_name === 'free' ? (
                            <span className="text-dx-green font-medium">Actualmente en plan Explorador (Gratis)</span>
                        ) : (
                            <>
                                ¿Solo quieres probar?{' '}
                                <button
                                    onClick={() => handleSelectPlan(freePlan)}
                                    disabled={processing === freePlan.id}
                                    className="text-dx-green hover:text-dx-green-bright font-semibold underline underline-offset-2 transition-colors"
                                >
                                    Empieza gratis
                                </button>
                                {' '}con 1 oportunidad diaria — sin tarjeta.
                            </>
                        )}
                    </p>
                </div>
            )}

            {/* ======================== GARANTIA ======================== */}
            <div className="max-w-2xl mx-auto mb-10">
                <div className="bg-dx-surface backdrop-blur-sm rounded-2xl border border-dx-border p-6 text-center">
                    <div className="w-12 h-12 bg-dx-green/10 rounded-full flex items-center justify-center mx-auto mb-3">
                        <svg className="w-6 h-6 text-dx-green" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                        </svg>
                    </div>
                    <h3 className="text-lg font-bold text-white mb-2">Garantía: Transparencia Total</h3>
                    <p className="text-dx-text-soft text-sm leading-relaxed">
                        Cada pick se verifica automáticamente contra resultados reales. Si encuentras que hemos ocultado
                        o manipulado un solo resultado, te devolvemos el 100% de tu último pago. Sin preguntas.
                    </p>
                </div>
            </div>

            {/* Manage subscription */}
            <ManageSubscriptionSection currentPlan={currentPlan} />

            <div className="max-w-3xl mx-auto mt-10 text-center">
                <p className="text-dx-text-mute text-sm">
                    Precios en USD. Equivalencia en COP referencial, calculada con la TRM oficial
                    actualizada diariamente. Puedes cancelar en cualquier momento desde el portal de
                    tu suscripción. Todos los planes incluyen acceso al historial completo de
                    resultados anteriores.
                </p>
            </div>
        </div>
    );
};

/**
 * Sección de gestión de suscripción (Lemon Squeezy / Whop portal).
 */
const ManageSubscriptionSection: React.FC<{
    currentPlan: any;
}> = ({ currentPlan }) => {
    const hasLSSub = !!currentPlan?.ls_subscription_id && !!currentPlan?.customer_portal_url;
    const hasWhopSub = !!currentPlan?.whop_membership_id;

    if (!hasLSSub && !hasWhopSub) return null;

    return (
        <div className="max-w-md mx-auto mt-10 text-center">
            {hasLSSub && (
                <a
                    href={currentPlan.customer_portal_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-6 py-3 bg-dx-surface-2 text-white rounded-xl hover:bg-dx-surface transition-colors border border-dx-border"
                >
                    Gestionar Suscripción
                    <ArrowRightIcon className="w-4 h-4" />
                </a>
            )}
            {hasWhopSub && !hasLSSub && (
                <a
                    href="https://whop.com/orders"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-6 py-3 bg-dx-surface-2 text-white rounded-xl hover:bg-dx-surface transition-colors border border-dx-border"
                >
                    Gestionar Suscripción
                    <ArrowRightIcon className="w-4 h-4" />
                </a>
            )}
            <p className="text-xs text-dx-text-mute mt-2">
                Cancelar, pausar o cambiar método de pago
            </p>
        </div>
    );
};

export default PricingPage;
