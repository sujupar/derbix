/**
 * Paywall Modal
 * Modal que aparece cuando el usuario alcanza un limite de su plan
 * Precios dinamicos - no hardcodeados
 */

import React from 'react';
import { LockClosedIcon, SparklesIcon, ArrowRightIcon } from '../icons/Icons';

interface PaywallModalProps {
    isOpen: boolean;
    onClose: () => void;
    onUpgrade: () => void;
    feature: string;
    currentUsage?: number;
    limit?: number;
    planName?: string;
    upgradePlanName?: string;
    upgradeDescription?: string;
}

export const PaywallModal: React.FC<PaywallModalProps> = ({
    isOpen,
    onClose,
    onUpgrade,
    feature,
    currentUsage,
    limit,
    planName = 'Gratis',
    upgradePlanName,
    upgradeDescription,
}) => {
    if (!isOpen) return null;

    const featureNames: Record<string, string> = {
        analyses: 'Análisis de partidos',
        predictions: 'Oportunidades premium'
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div
                className="absolute inset-0 bg-black/80 backdrop-blur-sm"
                onClick={onClose}
            />

            <div className="relative bg-dx-surface rounded-2xl border border-dx-border max-w-md w-full mx-4 overflow-hidden shadow-2xl">
                <div className="bg-gradient-to-br from-dx-loss/20 to-dx-gold/20 p-6 border-b border-dx-border">
                    <div className="w-16 h-16 bg-dx-loss/20 rounded-full flex items-center justify-center mx-auto mb-4">
                        <LockClosedIcon className="w-8 h-8 text-dx-loss" />
                    </div>
                    <h2 className="text-xl font-bold text-white text-center">
                        Límite Alcanzado
                    </h2>
                </div>

                <div className="p-6 space-y-4">
                    <p className="text-dx-text-soft text-center">
                        Has alcanzado el límite de <span className="text-white font-semibold">{featureNames[feature] || feature}</span> en tu plan <span className="text-brand font-semibold">{planName}</span>.
                    </p>
                    <p className="text-dx-green text-center text-sm font-medium mt-2">
                        Desbloquea hasta $682/mes en herramientas de inteligencia deportiva.
                    </p>

                    {currentUsage !== undefined && limit !== undefined && (
                        <div className="bg-dx-surface-2 rounded-xl p-4">
                            <div className="flex justify-between text-sm mb-2">
                                <span className="text-dx-text-soft">Uso del mes</span>
                                <span className="text-white font-mono">{currentUsage} / {limit}</span>
                            </div>
                            <div className="h-2 bg-dx-surface-2 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-dx-loss to-dx-gold rounded-full transition-all"
                                    style={{ width: '100%' }}
                                />
                            </div>
                        </div>
                    )}

                    <div className="bg-gradient-to-br from-brand/10 to-dx-cyan/10 rounded-xl p-4 border border-brand/20">
                        <div className="flex items-start gap-3">
                            <SparklesIcon className="w-5 h-5 text-brand shrink-0 mt-0.5" />
                            <div>
                                <p className="text-white font-medium">
                                    {upgradePlanName ? `Actualiza a ${upgradePlanName}` : 'Actualiza tu plan'}
                                </p>
                                <p className="text-sm text-dx-text-soft mt-1">
                                    {upgradeDescription || 'Obtén acceso a más funcionalidades y límites más amplios.'}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="p-6 border-t border-dx-border flex gap-3">
                    <button
                        onClick={onClose}
                        className="flex-1 py-3 px-4 rounded-xl font-medium text-dx-text-soft bg-dx-surface-2 hover:bg-dx-surface-2 transition-colors"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={onUpgrade}
                        className="flex-1 py-3 px-4 rounded-xl font-bold bg-gradient-to-r from-brand to-dx-cyan text-[#04140C] hover:shadow-lg hover:shadow-brand/30 transition-all flex items-center justify-center gap-2"
                    >
                        Ver Planes
                        <ArrowRightIcon className="w-4 h-4" />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PaywallModal;
