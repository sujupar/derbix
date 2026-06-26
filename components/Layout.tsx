import React, { useState, useRef, useEffect } from 'react';
import { CalendarDaysIcon, ArrowLeftOnRectangleIcon, PaperAirplaneIcon, ShieldCheckIcon, EllipsisVerticalIcon, CogIcon, TrendingUpIcon, SignalIcon } from './icons/Icons';
import { cleanPlanLabel } from '../utils/planDisplay';
import { supabase } from '../services/supabaseService';
import { getCurrentDateInBogota } from '../utils/dateUtils';
import { fetchLiveFixtures } from '../services/liveDataService';
import { useAuth } from '../hooks/useAuth';
import { OrganizationSwitcher } from './OrganizationSwitcher';
import { Page } from '../App';
import { CreateSubAccountModal } from './agency/CreateSubAccountModal';
import { isAgencyRole } from '../utils/roles';
import { useOrganization } from '../contexts/OrganizationContext';
import { useSubscription } from '../contexts/SubscriptionContext';
import { RecapBadge } from './recap/RecapBadge';
import { NotificationPreferences } from './settings/NotificationPreferences';
import { getAvatarRingClass } from './premium/PremiumBadge';
import { SupportWidget } from './support/SupportWidget';

interface LayoutProps {
  children: React.ReactNode;
  currentPage: string;
  setCurrentPage: (page: Page) => void;
  recapBadge?: {
    hasData: boolean;
    hasUnseen: boolean;
    onReopen: () => void;
  };
}

export const Layout: React.FC<LayoutProps> = ({ children, currentPage, setCurrentPage, recapBadge }) => {
  const { profile, signOut } = useAuth();
  const { isImpersonating, stopImpersonation, currentOrg } = useOrganization();
  const { plan } = useSubscription();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isNotifPrefsOpen, setIsNotifPrefsOpen] = useState(false);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  // Conteos para los badges del sidebar (oportunidades de hoy + partidos en vivo)
  const [oppCount, setOppCount] = useState(0);
  const [liveCount, setLiveCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const loadOpp = async () => {
      try {
        const today = getCurrentDateInBogota();
        const { count } = await supabase
          .from('value_picks_v2')
          .select('id', { count: 'exact', head: true })
          .eq('is_opportunity', true)
          .eq('opportunity_date', today);
        if (!cancelled) setOppCount(count || 0);
      } catch { /* silencioso — el badge es informativo */ }
    };
    loadOpp();
    const t = setInterval(loadOpp, 120000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadLive = async () => {
      try {
        const data = await fetchLiveFixtures();
        const n = [...data.importantLeagues, ...data.countryLeagues.flatMap(c => c.leagues)]
          .reduce((acc, l) => acc + l.games.length, 0);
        if (!cancelled) setLiveCount(n);
      } catch { /* silencioso */ }
    };
    loadLive();
    const t = setInterval(loadLive, 90000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  // Cerrar el menú de cuenta (⋮) al hacer clic fuera
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(e.target as Node)) {
        setIsAccountMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Presentación del plan en el pie (sin etiquetas internas)
  const planTitle = isAgencyRole(profile?.role) ? 'Plan Agencia' : `Plan ${cleanPlanLabel(plan.display_name)}`;
  const planSubtitle = isAgencyRole(profile?.role)
    ? 'Acceso total'
    : plan.plan_name === 'free' ? 'Mejora tu plan' : 'Plan activo';
  const accountInitials = (profile?.full_name || 'U')
    .split(' ').map(w => w.charAt(0)).slice(0, 2).join('').toUpperCase();
  // Tema por plan (§11): premium → dorado, pro/élite → plata. Resto → verde (default).
  const planThemeAttr = plan.plan_name === 'premium' ? 'premium' : plan.plan_name === 'pro' ? 'elite' : undefined;

  // Roles: agency (full access) vs client (view only per plan)
  const isAgencySuperadmin = isAgencyRole(profile?.role);
  const isAccountAdmin = profile?.role === 'org_owner';
  const isUser = !isAgencySuperadmin && !isAccountAdmin;

  // Opciones del sidebar simplificadas (agrupadas por sección — Composición 1)
  const navItems = [
    // Opciones para TODOS los usuarios
    { id: 'live', label: 'Jornadas', section: 'Menú', icon: <CalendarDaysIcon className="w-5 h-5" />, forAgency: true, forAccount: true, forUser: true },
    { id: 'results', label: 'Resultados', section: 'Menú', icon: <TrendingUpIcon className="w-5 h-5" />, forAgency: true, forAccount: true, forUser: true },
    { id: 'live-now', label: 'En vivo', section: 'Menú', icon: <SignalIcon className="w-5 h-5" />, live: true, forAgency: true, forAccount: true, forUser: true },

    // Opciones SOLO para SUPERADMIN de AGENCIA (platform_owner, agency_admin)
    { id: 'admin', label: 'Admin', section: 'Gestión', icon: <ShieldCheckIcon className="w-5 h-5" />, forAgency: true, forAccount: false, forUser: false },
    { id: 'settings', label: 'Configuración', section: 'Gestión', icon: <CogIcon className="w-5 h-5" />, forAgency: true, forAccount: true, forUser: true },
  ];

  // Filtrar según el nivel del usuario
  const availableNavItems = navItems.filter(item => {
    if (isAgencySuperadmin) return item.forAgency;
    if (isAccountAdmin) return item.forAccount;
    if (isUser) return item.forUser;
    return item.forUser; // Por defecto, permisos básicos
  });

  // Agrupar los ítems visibles por sección, conservando el orden de aparición
  const navSections = availableNavItems.reduce<{ label: string; items: typeof availableNavItems }[]>((acc, item) => {
    const group = acc.find(g => g.label === item.section);
    if (group) group.items.push(item);
    else acc.push({ label: item.section, items: [item] });
    return acc;
  }, []);

  return (
    <div className="flex h-screen overflow-hidden text-slate-200 font-sans selection:bg-brand selection:text-white bg-dx-bg">

      {/* --- DESKTOP SIDEBAR --- */}
      <aside data-plan={planThemeAttr} className="dx-sidebar hidden md:flex flex-col w-64 h-full bg-dx-surface backdrop-blur-xl border-r border-[color:var(--color-dx-border)] fixed left-0 top-0 z-30 transition-transform duration-300">
        <div className="p-5 flex items-center justify-center border-b border-white/5">
          <img src="/derbix-logo.png" alt="Derbix" className="h-12 object-contain" />
        </div>

        <div className="px-3 pt-4">
          <OrganizationSwitcher onCreateClick={() => setIsCreateModalOpen(true)} />
        </div>

        <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-5">
          {navSections.map((group) => (
            <div key={group.label} className="space-y-1">
              <p className="dx-sidelabel mb-2">{group.label}</p>
              {group.items.map((item) => {
                const isActive = currentPage === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setCurrentPage(item.id as Page)}
                    data-onboarding={item.id === 'results' ? 'results' : undefined}
                    className={`dx-nav-item group active:scale-[0.98] ${(item as any).live ? 'live' : ''} ${isActive ? 'on' : ''}`}
                  >
                    <span className={`transition-transform duration-300 ${isActive ? 'scale-110' : 'group-hover:scale-110'}`}>
                      {item.icon}
                    </span>
                    <span className="tracking-wide">{item.label}</span>
                    {(item as any).live ? (
                      <span className="ml-auto flex items-center gap-1.5 text-[11px] font-bold text-dx-live dx-num">
                        <span className="w-1.5 h-1.5 rounded-full bg-dx-live" style={{ animation: 'dxpulse 1.3s ease-in-out infinite' }} />
                        {liveCount > 0 ? liveCount : ''}
                      </span>
                    ) : item.id === 'live' && oppCount > 0 ? (
                      <span className="ml-auto text-[11px] font-display font-bold text-dx-green bg-dx-green/15 rounded-md px-2 py-0.5 dx-num">{oppCount}</span>
                    ) : isActive ? (
                      <span className="ml-auto w-1.5 h-1.5 rounded-full bg-dx-green animate-pulse shadow-[0_0_8px_#1DE782]"></span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {recapBadge && (
          <RecapBadge
            hasData={recapBadge.hasData}
            hasUnseen={recapBadge.hasUnseen}
            onReopen={recapBadge.onReopen}
            variant="sidebar"
          />
        )}

        <div className="p-4 border-t border-white/5 space-y-3">
          {/* Tarjeta de plan — escudo dorado + nombre limpio (sin etiquetas internas) */}
          <button
            onClick={() => setCurrentPage('pricing')}
            data-onboarding="plan-badge"
            className="dx-plan w-full flex items-center gap-3 p-3 transition-all hover:border-dx-green/50 text-left"
          >
            <span className="w-9 h-9 rounded-lg bg-dx-green/10 border border-dx-green/30 flex items-center justify-center shrink-0">
              <ShieldCheckIcon className="w-4 h-4 text-dx-green" />
            </span>
            <span className="leading-tight overflow-hidden">
              <span className="block text-sm font-bold text-white truncate">{planTitle}</span>
              <span className="block text-xs text-dx-green truncate">{planSubtitle}</span>
            </span>
          </button>

          {/* Fila de cuenta + menú (⋮) con acciones (WhatsApp / Cerrar sesión) */}
          <div className="relative flex items-center gap-3 px-1" ref={accountMenuRef}>
            <div className={`w-9 h-9 rounded-full bg-gradient-to-tr from-dx-green-bright to-dx-green flex items-center justify-center text-xs font-extrabold text-[#04140C] shadow-lg shrink-0 ${getAvatarRingClass(plan.plan_name)}`}>
              {accountInitials}
            </div>
            <div className="flex-1 overflow-hidden">
              <p className="text-sm font-bold text-dx-green truncate">{profile?.full_name || 'Usuario'}</p>
              <p className="text-xs text-dx-text-mute truncate">
                {profile?.role === 'platform_owner' ? 'Owner' :
                 profile?.role === 'agency_admin' ? 'Agencia' :
                 profile?.role === 'org_owner' ? 'Admin' : 'Usuario'}
              </p>
            </div>
            <button
              onClick={() => setIsAccountMenuOpen(o => !o)}
              className="p-1.5 rounded-lg text-dx-text-mute hover:text-dx-text hover:bg-dx-surface-2 transition-colors shrink-0"
              aria-label="Opciones de cuenta"
            >
              <EllipsisVerticalIcon className="w-5 h-5" />
            </button>

            {isAccountMenuOpen && (
              <div className="absolute bottom-full right-0 mb-2 w-56 bg-dx-surface border border-dx-border rounded-xl shadow-2xl overflow-hidden z-50 animate-scale-in origin-bottom-right">
                <button
                  onClick={() => { setIsNotifPrefsOpen(true); setIsAccountMenuOpen(false); }}
                  className="w-full flex items-center justify-between px-4 py-3 text-sm text-dx-text-soft hover:bg-dx-surface-2 hover:text-dx-green transition-colors"
                >
                  <span className="flex items-center gap-2.5">
                    <PaperAirplaneIcon className="w-4 h-4" />
                    WhatsApp
                  </span>
                  <span className={`text-xs font-bold ${profile?.phone_number ? 'text-dx-green' : 'text-dx-text-mute'}`}>
                    {profile?.phone_number ? 'Activo' : 'Configurar'}
                  </span>
                </button>
                <button
                  onClick={() => { setIsAccountMenuOpen(false); signOut(); }}
                  className="w-full flex items-center gap-2.5 px-4 py-3 text-sm text-dx-text-soft hover:bg-dx-loss/10 hover:text-dx-loss transition-colors border-t border-dx-border"
                >
                  <ArrowLeftOnRectangleIcon className="w-4 h-4" />
                  Cerrar Sesión
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* --- MAIN CONTENT AREA --- */}
      <div className="flex-1 flex flex-col relative h-full overflow-hidden md:ml-64 transition-all duration-300">
        {/* Impersonation Banner */}
        {isImpersonating && (
          <div className="bg-amber-500/90 text-black px-4 py-2 flex items-center justify-between text-sm font-medium z-50 shrink-0">
            <span>Viendo como: <strong>{currentOrg?.name || 'Usuario'}</strong></span>
            <button
              onClick={stopImpersonation}
              className="bg-black/20 hover:bg-black/30 px-3 py-1 rounded text-xs font-bold transition-colors"
            >
              Salir
            </button>
          </div>
        )}

        {/* Mobile Header */}
        <header className="md:hidden h-16 glass flex items-center justify-between px-4 sm:px-6 sticky top-0 z-30 backdrop-blur-xl border-b border-white/5 shadow-lg">
          <img src="/derbix-logo.png" alt="Derbix" className="h-10 object-contain" />
          <div className="flex items-center gap-3">
            {recapBadge && (
              <RecapBadge
                hasData={recapBadge.hasData}
                hasUnseen={recapBadge.hasUnseen}
                onReopen={recapBadge.onReopen}
                variant="mobile"
              />
            )}
            <button onClick={signOut} className="text-slate-400 hover:text-white">
              <ArrowLeftOnRectangleIcon className="w-6 h-6" />
            </button>
          </div>
        </header>

        {/* Scrollable Content */}
        <main className="flex-1 overflow-y-auto px-3 py-4 sm:px-4 sm:py-6 md:px-8 md:py-8 scroll-smooth relative z-10 overscroll-behavior-contain">
          <div className="max-w-[1800px] mx-auto animate-fade-in pb-24 md:pb-8">
            {children}
          </div>
        </main>

        {/* --- MOBILE BOTTOM TAB BAR --- */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 h-20 glass border-t border-white/5 z-40 px-6 pb-safe flex justify-between items-center backdrop-blur-2xl bg-slate-900/95">
          {availableNavItems.slice(0, 5).map((item) => { // Limit to 5 items for mobile spacing
            const isActive = currentPage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setCurrentPage(item.id as Page)}
                className={`flex flex-col items-center justify-center flex-1 max-w-[72px] h-full transition-all duration-300 ease-out active:scale-95 ${isActive ? 'text-brand -translate-y-2' : 'text-slate-500 active:text-slate-200'}`}
              >
                <div className={`p-2 rounded-full transition-all duration-300 ease-out ${isActive ? 'bg-brand/10 shadow-[0_0_10px_rgba(16,185,129,0.2)] scale-110' : 'active:bg-white/5'}`}>
                  {item.icon}
                </div>
                {isActive && <span className="text-[11px] font-bold mt-1">{item.label}</span>}
              </button>
            );
          })}
          {/* Mobile Menu 'More' button logic could go here if >5 items needed, skipping for now per simplicity */}
        </nav>
      </div>

      <CreateSubAccountModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={() => setIsCreateModalOpen(false)}
      />

      <SupportWidget currentPage={currentPage} />

      {/* WhatsApp Notification Preferences Modal */}
      {isNotifPrefsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setIsNotifPrefsOpen(false)}>
          <div className="w-full max-w-md bg-slate-900 border border-white/10 rounded-2xl p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <NotificationPreferences onClose={() => setIsNotifPrefsOpen(false)} />
          </div>
        </div>
      )}

    </div>
  );
};
