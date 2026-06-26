import React from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckIcon, ArrowRightIcon, SparklesIcon } from '../icons/Icons';

interface UpgradePlanModalProps {
    isOpen: boolean;
    onClose: () => void;
    currentPlan: {
        name: string;
        displayName: string;
    };
    recommendedPlan?: {
        planName: string;
        displayName: string;
        benefits: string[];
    };
    reason?: string;
}

export const UpgradePlanModal: React.FC<UpgradePlanModalProps> = ({
    isOpen,
    onClose,
    currentPlan,
    recommendedPlan,
    reason
}) => {
    const navigate = useNavigate();

    if (!isOpen) return null;

    const handleUpgrade = () => {
        navigate('/app?page=pricing');
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
            <div className="bg-dx-surface rounded-3xl border border-dx-border max-w-2xl w-full p-8 relative animate-fade-in-up shadow-2xl">
                <button
                    onClick={onClose}
                    className="absolute top-6 right-6 text-dx-text-soft hover:text-white transition-colors"
                >
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>

                <div className="text-center mb-8">
                    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-dx-gold/10 border border-dx-gold/20 mb-4">
                        <SparklesIcon className="w-4 h-4 text-dx-gold" />
                        <span className="text-xs font-bold uppercase tracking-wider text-dx-gold">Límite Alcanzado</span>
                    </div>

                    <h2 className="text-3xl font-black text-white mb-2">
                        Actualiza tu Plan
                    </h2>

                    {reason && (
                        <p className="text-dx-text-soft text-lg">{reason}</p>
                    )}
                </div>

                <div className="grid grid-cols-2 gap-4 mb-8">
                    <div className="p-6 rounded-xl bg-dx-surface-2/50 border border-dx-border">
                        <p className="text-sm text-dx-text-mute mb-2">Plan Actual</p>
                        <h3 className="text-xl font-bold text-white">{currentPlan.displayName}</h3>
                    </div>

                    {recommendedPlan && (
                        <div className="p-6 rounded-xl bg-gradient-to-br from-brand/20 to-dx-cyan/20 border-2 border-brand relative overflow-hidden">
                            <div className="absolute top-0 right-0 w-24 h-24 bg-brand/20 rounded-bl-full"></div>
                            <p className="text-sm text-dx-green mb-2 font-medium">Recomendado</p>
                            <h3 className="text-xl font-bold text-white">{recommendedPlan.displayName}</h3>
                        </div>
                    )}
                </div>

                {recommendedPlan && (
                    <div className="mb-8">
                        <h4 className="text-sm font-bold text-white mb-4 uppercase tracking-wide">
                            Lo que obtendrás:
                        </h4>
                        <div className="space-y-3">
                            {recommendedPlan.benefits.map((benefit, idx) => (
                                <div key={idx} className="flex items-start gap-3">
                                    <div className="w-5 h-5 rounded-full bg-brand/20 flex items-center justify-center shrink-0 mt-0.5">
                                        <CheckIcon className="w-3 h-3 text-brand" />
                                    </div>
                                    <span className="text-dx-text-soft">{benefit}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <div className="flex items-center gap-4">
                    <button
                        onClick={onClose}
                        className="flex-1 py-3 px-6 rounded-xl bg-dx-surface-2 text-white font-medium hover:bg-dx-surface-2 transition-colors"
                    >
                        Tal vez después
                    </button>

                    <button
                        onClick={handleUpgrade}
                        className="flex-1 py-3 px-6 rounded-xl bg-gradient-to-r from-brand to-dx-cyan text-[#04140C] font-bold hover:shadow-lg hover:shadow-brand/30 transition-all flex items-center justify-center gap-2"
                    >
                        Ver Planes
                        <ArrowRightIcon className="w-5 h-5" />
                    </button>
                </div>

                <p className="text-xs text-dx-text-mute text-center mt-6">
                    Puedes cancelar en cualquier momento
                </p>
            </div>
        </div>
    );
};
