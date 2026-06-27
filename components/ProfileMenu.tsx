// components/ProfileMenu.tsx
// Perfil arriba-derecha (estilo red social): nombre + avatar → menú con el PLAN
// primero, luego editar perfil / configuración / cerrar sesión.
// El acento sigue el color del plan (clase .dx-planscope + data-plan).

import React, { useState, useRef, useEffect } from 'react';
import { UserIcon, CogIcon, ShieldCheckIcon, PowerIcon, ChevronDownIcon } from './icons/Icons';

interface ProfileMenuProps {
    fullName: string;
    initials: string;
    roleLabel: string;
    planName: string;
    planThemeAttr?: string;
    email?: string;
    dataOnboarding?: string;
    onSettings: () => void;
    onSignOut: () => void;
}

export const ProfileMenu: React.FC<ProfileMenuProps> = ({
    fullName, initials, roleLabel, planName, planThemeAttr, email, dataOnboarding, onSettings, onSignOut,
}) => {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const onDoc = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onDoc);
        return () => document.removeEventListener('mousedown', onDoc);
    }, []);

    return (
        <div className="dx-planscope relative" data-plan={planThemeAttr} ref={ref}>
            {/* Chip: nombre + avatar */}
            <button
                onClick={() => setOpen(o => !o)}
                data-onboarding={dataOnboarding}
                className="flex items-center gap-2.5 bg-dx-surface border border-dx-border rounded-xl pl-3.5 pr-2 py-1.5 hover:border-dx-border-active transition-colors"
                aria-label="Menú de perfil"
            >
                <span className="text-sm font-bold text-white max-w-[160px] truncate hidden sm:block">{fullName}</span>
                <span className="w-9 h-9 rounded-lg bg-gradient-to-br from-dx-green-bright to-dx-green flex items-center justify-center text-xs font-extrabold text-[#04140C] shrink-0">
                    {initials}
                </span>
                <ChevronDownIcon className={`w-4 h-4 text-dx-text-mute transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>

            {open && (
                <div className="absolute top-full right-0 mt-2 w-64 bg-dx-surface border border-dx-border rounded-2xl shadow-2xl overflow-hidden z-50 animate-scale-in origin-top-right">
                    {/* PLAN primero */}
                    <div
                        className="flex items-center gap-3 p-4 border-b"
                        style={{
                            background: 'color-mix(in srgb, var(--color-dx-green) 12%, transparent)',
                            borderColor: 'color-mix(in srgb, var(--color-dx-green) 26%, var(--color-dx-border))',
                        }}
                    >
                        <span className="w-10 h-10 rounded-xl bg-dx-green/15 border border-dx-green/30 flex items-center justify-center text-dx-green shrink-0">
                            <ShieldCheckIcon className="w-5 h-5" />
                        </span>
                        <div className="min-w-0">
                            <p className="text-[10px] uppercase tracking-wider text-dx-text-mute font-bold">Tu plan</p>
                            <p className="text-base font-display font-extrabold text-dx-green truncate">{planName}</p>
                        </div>
                    </div>

                    {/* Identidad */}
                    <div className="px-4 py-2.5 border-b border-dx-border">
                        <p className="text-sm font-semibold text-white truncate">{fullName}</p>
                        <p className="text-xs text-dx-text-mute truncate">{email || roleLabel}</p>
                    </div>

                    {/* Opciones */}
                    {/* TODO: enlazar ruta de perfil dedicada cuando exista (hoy va a Configuración) */}
                    <button
                        onClick={() => { setOpen(false); onSettings(); }}
                        className="w-full flex items-center gap-3 px-4 py-3 text-sm text-dx-text-soft hover:bg-dx-surface-2 hover:text-white transition-colors"
                    >
                        <UserIcon className="w-4 h-4" /> Editar perfil
                    </button>
                    <button
                        onClick={() => { setOpen(false); onSettings(); }}
                        className="w-full flex items-center gap-3 px-4 py-3 text-sm text-dx-text-soft hover:bg-dx-surface-2 hover:text-white transition-colors"
                    >
                        <CogIcon className="w-4 h-4" /> Configuración
                    </button>
                    <button
                        onClick={() => { setOpen(false); onSignOut(); }}
                        className="w-full flex items-center gap-3 px-4 py-3 text-sm text-dx-text-soft hover:bg-dx-loss/10 hover:text-dx-loss transition-colors border-t border-dx-border"
                    >
                        <PowerIcon className="w-4 h-4" /> Cerrar sesión
                    </button>
                </div>
            )}
        </div>
    );
};

export default ProfileMenu;
