// components/settings/SettingsPage.tsx
// Pantalla de Configuración (Composición 1). Reúne datos de cuenta, plan y
// las preferencias de notificación de WhatsApp (componente existente).
// Estética dx + reutiliza lógica/handlers existentes.

import React from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useSubscription } from '../../contexts/SubscriptionContext';
import { NotificationPreferences } from './NotificationPreferences';
import { cleanPlanLabel } from '../../utils/planDisplay';
import { ShieldCheckIcon } from '../icons/Icons';
import type { Page } from '../../App';

const InfoRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
    <div className="flex items-center justify-between gap-4 py-2.5 border-b border-dx-border last:border-0">
        <span className="text-sm text-dx-text-soft">{label}</span>
        <span className="text-sm font-medium text-white truncate">{value}</span>
    </div>
);

export const SettingsPage: React.FC<{ onNavigate?: (page: Page) => void }> = ({ onNavigate }) => {
    const { profile } = useAuth();
    const { plan } = useSubscription();

    const roleLabel = profile?.role === 'platform_owner' ? 'Owner'
        : profile?.role === 'agency_admin' ? 'Agencia'
        : profile?.role === 'org_owner' ? 'Admin' : 'Usuario';

    return (
        <div className="space-y-8 pb-24 max-w-3xl">
            <div>
                <h2 className="text-2xl sm:text-3xl font-display font-bold text-white tracking-tight">Configuración</h2>
                <p className="text-dx-text-soft mt-1">Gestiona tu cuenta y tus notificaciones.</p>
            </div>

            {/* Cuenta */}
            <section className="dx-card p-5 sm:p-6">
                <h3 className="text-lg font-display font-bold text-white mb-3">Cuenta</h3>
                <div>
                    <InfoRow label="Nombre" value={profile?.full_name || '—'} />
                    <InfoRow label="Correo" value={profile?.email || '—'} />
                    <InfoRow label="Rol" value={roleLabel} />
                </div>
            </section>

            {/* Plan */}
            <section className="dx-card p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <span className="w-10 h-10 rounded-lg bg-dx-gold/10 border border-dx-gold/30 flex items-center justify-center shrink-0">
                        <ShieldCheckIcon className="w-5 h-5 text-dx-gold" />
                    </span>
                    <div>
                        <p className="text-sm text-dx-text-soft">Tu plan</p>
                        <p className="text-white font-bold">{cleanPlanLabel(plan.display_name)}</p>
                    </div>
                </div>
                <button onClick={() => onNavigate?.('pricing')} className="dx-btn px-5 py-3 text-sm whitespace-nowrap">
                    Ver planes
                </button>
            </section>

            {/* Notificaciones WhatsApp (componente existente, lógica intacta) */}
            <section className="dx-card p-5 sm:p-6">
                <NotificationPreferences />
            </section>
        </div>
    );
};

export default SettingsPage;
