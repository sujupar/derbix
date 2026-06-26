
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useOrganization } from '../contexts/OrganizationContext';
import { useAuth } from '../hooks/useAuth';
import { ChevronDownIcon, CheckIcon, PlusIcon, MagnifyingGlassIcon } from './icons/Icons';
import { isAgencyRole } from '../utils/roles';
import { organizationService } from '../services/organizationService';
import { Organization } from '../types';

interface OrganizationSwitcherProps {
    onCreateClick?: () => void;
}

export const OrganizationSwitcher: React.FC<OrganizationSwitcherProps> = ({ onCreateClick }) => {
    const { currentOrg, userOrganizations, switchOrganization, impersonateOrganization, stopImpersonation, isImpersonating, isLoading } = useOrganization();
    const { profile } = useAuth();
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [allOrgs, setAllOrgs] = useState<Organization[]>([]);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    const isAgency = isAgencyRole(profile?.role);

    // Cargar todas las orgs si es agencia
    useEffect(() => {
        if (isAgency) {
            organizationService.getAllOrganizations().then(setAllOrgs).catch(console.error);
        }
    }, [isAgency]);

    // Focus en el buscador al abrir
    useEffect(() => {
        if (isOpen && isAgency && searchInputRef.current) {
            setTimeout(() => searchInputRef.current?.focus(), 100);
        }
        if (!isOpen) setSearchTerm('');
    }, [isOpen, isAgency]);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    // La org propia del admin (primera de userOrganizations)
    const myOrg = userOrganizations[0]?.org;

    // Filtrar orgs de clientes (excluyendo la del admin) por búsqueda
    const filteredClientOrgs = useMemo(() => {
        if (!isAgency) return [];
        const clientOrgs = allOrgs.filter(o => o.id !== myOrg?.id);
        if (!searchTerm.trim()) return clientOrgs;
        const term = searchTerm.toLowerCase();
        return clientOrgs.filter(o => o.name.toLowerCase().includes(term));
    }, [isAgency, allOrgs, myOrg?.id, searchTerm]);

    const handleSelectClientOrg = async (orgId: string) => {
        await impersonateOrganization(orgId);
        setIsOpen(false);
    };

    const handleSelectMyOrg = async () => {
        if (isImpersonating) {
            await stopImpersonation();
        }
        setIsOpen(false);
    };

    if (isLoading) {
        return <div className="h-10 w-full animate-pulse bg-white/10 rounded-lg"></div>;
    }

    if (!currentOrg) {
        return null;
    }

    // --- Vista para agencia ---
    if (isAgency) {
        return (
            <div className="relative mb-6" ref={dropdownRef}>
                <button
                    onClick={() => setIsOpen(!isOpen)}
                    className="w-full flex items-center justify-between p-3 rounded-xl bg-dx-surface border border-dx-border hover:border-dx-border-active transition-all duration-300 group"
                >
                    <div className="flex items-center gap-3 overflow-hidden">
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-sm font-extrabold border ${isImpersonating ? 'bg-dx-gold/15 text-dx-gold border-dx-gold/30' : 'bg-dx-surface-2 text-dx-green border-dx-border-active'}`}>
                            {currentOrg.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="text-left truncate">
                            <div className={`text-sm font-bold truncate transition-colors ${isImpersonating ? 'text-amber-400 group-hover:text-amber-300' : 'text-white group-hover:text-brand'}`}>
                                {currentOrg.name}
                            </div>
                            <div className="text-xs text-slate-400">
                                {isImpersonating ? 'Viendo como cliente' : 'Mi cuenta'}
                            </div>
                        </div>
                    </div>
                    <ChevronDownIcon className={`w-4 h-4 text-slate-400 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
                </button>

                {isOpen && (
                    <div className="absolute top-full left-0 right-0 mt-2 bg-dx-surface border border-dx-border rounded-xl shadow-2xl z-50 overflow-hidden backdrop-blur-xl animate-scale-in origin-top">
                        {/* Buscador */}
                        <div className="p-2 border-b border-dx-border">
                            <div className="relative rounded-lg border border-dx-border focus-within:border-dx-green focus-within:shadow-[0_0_0_3px_rgba(29,231,130,0.14)] transition-all">
                                <MagnifyingGlassIcon className="w-3.5 h-3.5 text-dx-text-mute absolute left-2.5 top-1/2 -translate-y-1/2" />
                                <input
                                    ref={searchInputRef}
                                    type="text"
                                    placeholder="Buscar cuenta..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="w-full bg-dx-surface-2 border-none rounded-lg py-2 pl-8 pr-3 text-white text-xs placeholder-dx-text-mute outline-none"
                                />
                            </div>
                        </div>

                        <div className="max-h-64 overflow-y-auto">
                            {/* Mi cuenta (la del admin) */}
                            {myOrg && (
                                <div className="p-2 space-y-1">
                                    <div className="px-3 py-1 text-[10px] font-semibold text-dx-text-mute uppercase tracking-wider">
                                        Mi cuenta
                                    </div>
                                    <button
                                        onClick={handleSelectMyOrg}
                                        className={`w-full flex items-center justify-between px-3 py-2 rounded-lg transition-colors text-sm ${!isImpersonating
                                            ? 'bg-dx-green/10 text-dx-green border border-dx-border-active'
                                            : 'text-dx-text-soft hover:bg-dx-surface-2 hover:text-white'
                                        }`}
                                    >
                                        <span className="truncate">{myOrg.name}</span>
                                        {!isImpersonating && <CheckIcon className="w-4 h-4 shrink-0" />}
                                    </button>
                                </div>
                            )}

                            {/* Cuentas de clientes */}
                            <div className="p-2 space-y-1 border-t border-dx-border">
                                <div className="px-3 py-1 text-[10px] font-semibold text-dx-text-mute uppercase tracking-wider">
                                    Cuentas ({filteredClientOrgs.length})
                                </div>
                                {filteredClientOrgs.map((org) => (
                                    <button
                                        key={org.id}
                                        onClick={() => handleSelectClientOrg(org.id)}
                                        className={`w-full flex items-center justify-between px-3 py-2 rounded-lg transition-colors text-sm ${isImpersonating && currentOrg.id === org.id
                                            ? 'bg-dx-green/10 text-dx-green border border-dx-border-active'
                                            : 'text-dx-text-soft hover:bg-dx-surface-2 hover:text-white'
                                        }`}
                                    >
                                        <div className="flex items-center gap-2 truncate">
                                            <span className="w-6 h-6 rounded-md bg-dx-surface-2 flex items-center justify-center text-[10px] font-bold text-dx-text-soft shrink-0">
                                                {org.name.charAt(0).toUpperCase()}
                                            </span>
                                            <span className="truncate">{org.name}</span>
                                        </div>
                                        {isImpersonating && currentOrg.id === org.id && (
                                            <CheckIcon className="w-4 h-4 shrink-0" />
                                        )}
                                    </button>
                                ))}
                                {filteredClientOrgs.length === 0 && (
                                    <div className="px-3 py-4 text-center text-xs text-dx-text-mute">
                                        {searchTerm ? 'Sin resultados' : 'No hay cuentas'}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Crear nueva cuenta */}
                        <div className="p-2 border-t border-dx-border">
                            <button
                                onClick={() => {
                                    if (onCreateClick) onCreateClick();
                                    else alert("Crear organización: Próximamente");
                                    setIsOpen(false);
                                }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-dx-green hover:bg-dx-surface-2 rounded-lg transition-colors font-medium"
                            >
                                <PlusIcon className="w-4 h-4" />
                                <span>Nueva cuenta</span>
                            </button>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // --- Vista para usuarios normales (sin cambios) ---
    return (
        <div className="relative mb-6" ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between p-3 rounded-xl bg-dx-surface border border-dx-border hover:border-dx-border-active transition-all duration-300 group"
            >
                <div className="flex items-center gap-3 overflow-hidden">
                    <div className="w-9 h-9 rounded-lg bg-dx-surface-2 border border-dx-border-active flex items-center justify-center text-dx-green text-sm font-extrabold shrink-0">
                        {currentOrg.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="text-left truncate">
                        <div className="text-sm font-bold text-white truncate group-hover:text-brand transition-colors">
                            {currentOrg.name}
                        </div>
                        <div className="text-xs text-slate-400 capitalize">
                            {userOrganizations.find(o => o.org.id === currentOrg.id)?.role || 'Miembro'}
                        </div>
                    </div>
                </div>
                {userOrganizations.length > 1 && (
                    <ChevronDownIcon className={`w-4 h-4 text-slate-400 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
                )}
            </button>

            {isOpen && userOrganizations.length > 1 && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-dx-surface border border-dx-border rounded-xl shadow-2xl z-50 overflow-hidden backdrop-blur-xl animate-scale-in origin-top">
                    <div className="p-2 space-y-1">
                        {userOrganizations.map((item) => (
                            <button
                                key={item.org.id}
                                onClick={() => {
                                    switchOrganization(item.org.id);
                                    setIsOpen(false);
                                }}
                                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg transition-colors text-sm ${currentOrg.id === item.org.id
                                    ? 'bg-dx-green/10 text-dx-green border border-dx-border-active'
                                    : 'text-dx-text-soft hover:bg-dx-surface-2 hover:text-white'
                                }`}
                            >
                                <span className="truncate">{item.org.name}</span>
                                {currentOrg.id === item.org.id && (
                                    <CheckIcon className="w-4 h-4 shrink-0" />
                                )}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
