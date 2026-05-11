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

            <div className="relative bg-slate-900 rounded-2xl border border-white/10 max-w-md w-full mx-4 overflow-hidden shadow-2xl">
                <div className="bg-gradient-to-br from-red-500/20 to-orange-500/20 p-6 border-b border-white/5">
                    <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                        <LockClosedIcon className="w-8 h-8 text-red-400" />
                    </div>
                    <h2 className="text-xl font-bold text-white text-center">
                        Límite Alcanzado
                    </h2>
                </div>

                <div className="p-6 space-y-4">
                    <p className="text-gray-300 text-center">
                        Has alcanzado el límite de <span className="text-white font-semibold">{featureNames[feature] || feature}</span> en tu plan <span className="text-brand font-semibold">{planName}</span>.
                    </p>
                    <p className="text-emerald-400 text-center text-sm font-medium mt-2">
                        Desbloquea hasta $682/mes en herramientas de inteligencia deportiva.
                    </p>

                    {currentUsage !== undefined && limit !== undefined && (
                        <div className="bg-slate-800 rounded-xl p-4">
                            <div className="flex justify-between text-sm mb-2">
                                <span className="text-gray-400">Uso del mes</span>
                                <span className="text-white font-mono">{currentUsage} / {limit}</span>
                            </div>
                            <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-red-500 to-orange-500 rounded-full transition-all"
                                    style={{ width: '100%' }}
                                />
                            </div>
                        </div>
                    )}

                    <div className="bg-gradient-to-br from-brand/10 to-emerald-500/10 rounded-xl p-4 border border-brand/20">
                        <div className="flex items-start gap-3">
                            <SparklesIcon className="w-5 h-5 text-brand shrink-0 mt-0.5" />
                            <div>
                                <p className="text-white font-medium">
                                    {upgradePlanName ? `Actualiza a ${upgradePlanName}` : 'Actualiza tu plan'}
                                </p>
                                <p className="text-sm text-gray-400 mt-1">
                                    {upgradeDescription || 'Obtén acceso a más funcionalidades y límites más amplios.'}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="p-6 border-t border-white/5 flex gap-3">
                    <button
                        onClick={onClose}
                        className="flex-1 py-3 px-4 rounded-xl font-medium text-gray-400 bg-slate-800 hover:bg-slate-700 transition-colors"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={onUpgrade}
                        className="flex-1 py-3 px-4 rounded-xl font-bold bg-gradient-to-r from-brand to-emerald-400 text-slate-900 hover:shadow-lg hover:shadow-brand/30 transition-all flex items-center justify-center gap-2"
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
