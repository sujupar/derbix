import React, { useState, useEffect } from 'react';
import { CheckIcon, SparklesIcon } from '../icons/Icons';
import { getActivePlans, SubscriptionPlan } from '../../services/subscriptionService';
import { getPlanPrice } from '../../services/lemonSqueezyService';

interface PlanSelectorProps {
    selectedPlan: SubscriptionPlan | null;
    onSelectPlan: (plan: SubscriptionPlan) => void;
    billingPeriod: 'monthly' | 'annual';
    onBillingPeriodChange: (period: 'monthly' | 'annual') => void;
}

export const PlanSelector: React.FC<PlanSelectorProps> = ({
    selectedPlan,
    onSelectPlan,
    billingPeriod,
    onBillingPeriodChange,
}) => {
    const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadPlans = async () => {
            const data = await getActivePlans();
            setPlans(data);
            setLoading(false);
        };
        loadPlans();
    }, []);

    const features = (plan: SubscriptionPlan) => {
        return [
            {
                label: 'Oportunidades',
                value: plan.predictions_percentage <= 1 ? '1 diario' : `${plan.predictions_percentage}%`,
                included: true
            },
            {
                label: 'Análisis de partidos',
                value: plan.analysis_percentage === 0 ? 'No incluido' :
                    plan.analysis_percentage >= 100 ? 'Todos' : `${plan.analysis_percentage}%`,
                included: plan.analysis_percentage > 0
            },
            {
                label: 'Soporte prioritario',
                included: plan.has_priority_support
            }
        ];
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="w-8 h-8 border-4 border-brand border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="text-center mb-8">
                <h2 className="text-3xl font-black text-white mb-2">Elige tu Plan</h2>
                <p className="text-slate-400">Selecciona el plan que mejor se adapte a tus necesidades</p>
            </div>

            {/* Toggle mensual/anual */}
            <div className="flex items-center justify-center gap-3 mb-6">
                <span className={`text-sm font-medium ${billingPeriod === 'monthly' ? 'text-white' : 'text-gray-500'}`}>
                    Mensual
                </span>
                <button
                    onClick={() => onBillingPeriodChange(billingPeriod === 'monthly' ? 'annual' : 'monthly')}
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

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {plans.map((plan) => {
                    const isSelected = selectedPlan?.id === plan.id;
                    const isPopular = plan.name === 'pro';
                    const priceDisplay = getPlanPrice(plan.price_cents, plan.annual_price_cents, billingPeriod);

                    return (
                        <button
                            key={plan.id}
                            onClick={() => onSelectPlan(plan)}
                            className={`
                relative flex flex-col p-6 rounded-2xl border-2 transition-all text-left
                ${isSelected
                                    ? 'border-brand bg-brand/10 scale-105'
                                    : 'border-white/10 hover:border-white/20 bg-slate-900'
                                }
                ${isPopular && !isSelected ? 'ring-2 ring-brand/50' : ''}
              `}
                        >
                            {isPopular && (
                                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                                    <div className="bg-gradient-to-r from-brand to-emerald-400 text-slate-900 text-xs font-black px-3 py-1 rounded-full flex items-center gap-1">
                                        <SparklesIcon className="w-3 h-3" />
                                        Popular
                                    </div>
                                </div>
                            )}

                            {isSelected && (
                                <div className="absolute top-4 right-4">
                                    <div className="w-6 h-6 rounded-full bg-brand flex items-center justify-center">
                                        <CheckIcon className="w-4 h-4 text-white" />
                                    </div>
                                </div>
                            )}

                            <div className="mb-4">
                                <h3 className="text-xl font-bold text-white mb-1">{plan.display_name}</h3>
                                <p className="text-sm text-slate-400">{plan.description}</p>
                            </div>

                            <div className="mb-4">
                                <div className="flex items-baseline gap-1">
                                    <span className={`text-3xl font-black ${isSelected ? 'text-brand' : 'text-white'}`}>
                                        {plan.price_cents === 0 ? 'Gratis' : priceDisplay.monthly.replace('/mes', '')}
                                    </span>
                                    {plan.price_cents > 0 && (
                                        <span className="text-slate-500">/mes</span>
                                    )}
                                </div>
                                {priceDisplay.savings && (
                                    <p className="text-xs text-emerald-400 mt-1">{priceDisplay.savings}</p>
                                )}
                            </div>

                            <div className="space-y-2 flex-grow">
                                {features(plan).map((feature, idx) => (
                                    <div key={idx} className="flex items-start gap-2 text-sm">
                                        <CheckIcon className={`w-4 h-4 shrink-0 mt-0.5 ${feature.included ? 'text-brand' : 'text-slate-600'}`} />
                                        <span className={feature.included ? 'text-white' : 'text-slate-500'}>
                                            {feature.label}
                                            {feature.value && (
                                                <span className={`ml-1 font-semibold ${feature.included ? 'text-brand' : 'text-slate-600'}`}>
                                                    {feature.value}
                                                </span>
                                            )}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};
