import React, { useState } from 'react';
import { CalendarDaysIcon, UsersIcon, ArrowLeftOnRectangleIcon, CreditCardIcon, TrophyIcon, PaperAirplaneIcon, XMarkIcon } from './icons/Icons';
import { useAuth } from '../hooks/useAuth';
import { OrganizationSwitcher } from './OrganizationSwitcher';
import { Page } from '../App';
import { CreateSubAccountModal } from './agency/CreateSubAccountModal';
import { isAgencyRole } from '../utils/roles';
import { useOrganization } from '../contexts/OrganizationContext';
import { useSubscription } from '../contexts/SubscriptionContext';
import { RecapBadge } from './recap/RecapBadge';
import { NotificationPreferences } from './settings/NotificationPreferences';
import { PremiumBadge, getAvatarRingClass, getPlanBadgeClass, getPlanNameColor } from './premium/PremiumBadge';
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

  // Roles: agency (full access) vs client (view only per plan)
  const isAgencySuperadmin = isAgencyRole(profile?.role);
  const isAccountAdmin = profile?.role === 'org_owner';
  const isUser = !isAgencySuperadmin && !isAccountAdmin;

  // Opciones del sidebar simplificadas
  const navItems = [
    // Opciones para TODOS los usuarios
    { id: 'live', label: 'Jornadas', icon: <CalendarDaysIcon className="w-5 h-5" />, forAgency: true, forAccount: true, forUser: true },
    { id: 'results', label: 'Resultados', icon: <TrophyIcon className="w-5 h-5" />, forAgency: true, forAccount: true, forUser: true },

    // Opciones SOLO para SUPERADMIN de AGENCIA (platform_owner, agency_admin)
    { id: 'admin', label: 'Admin', icon: <UsersIcon className="w-5 h-5" />, forAgency: true, forAccount: false, forUser: false },
  ];

  // Filtrar según el nivel del usuario
  const availableNavItems = navItems.filter(item => {
    if (isAgencySuperadmin) return item.forAgency;
    if (isAccountAdmin) return item.forAccount;
    if (isUser) return item.forUser;
    return item.forUser; // Por defecto, permisos básicos
  });

  return (
    <div className="flex h-screen overflow-hidden text-slate-200 font-sans selection:bg-brand selection:text-white bg-dx-bg">

      {/* --- DESKTOP SIDEBAR --- */}
      <aside className="hidden md:flex flex-col w-64 h-full bg-dx-surface backdrop-blur-xl border-r border-[color:var(--color-dx-border)] fixed left-0 top-0 z-30 transition-transform duration-300">
        <div className="p-5 flex items-center justify-center border-b border-white/5">
          <img src="/derbix-logo.png" alt="Derbix" className="h-12 object-contain" />
        </div>

        <div className="px-3 pt-4">
          <OrganizationSwitcher onCreateClick={() => setIsCreateModalOpen(true)} />
        </div>

        <nav className="flex-1 overflow-y-auto py-2 px-3 space-y-1">
          {availableNavItems.map((item) => {
            const isActive = currentPage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setCurrentPage(item.id as Page)}
                data-onboarding={item.id === 'results' ? 'results' : undefined}
                className={`w-full flex items-center px-4 py-3 rounded-xl transition-all duration-300 ease-out group active:scale-[0.98] ${isActive
                  ? 'bg-gradient-to-r from-brand/20 to-transparent text-brand border-l-2 border-brand shadow-[0_0_15px_rgba(29,231,130,0.15)]'
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-100 hover:pl-5 active:bg-white/10'
                  }`}
              >
                <div className={`mr-3 transition-transform duration-300 ${isActive ? 'scale-110' : 'group-hover:scale-110'}`}>
                  {item.icon}
                </div>
                <span className="font-medium tracking-wide text-sm">{item.label}</span>
                {isActive && (
                  <div className="ml-auto w-1.5 h-1.5 rounded-full bg-brand animate-pulse shadow-[0_0_8px_#1DE782]"></div>
                )}
              </button>
            );
          })}
        </nav>

        {recapBadge && (
          <RecapBadge
            hasData={recapBadge.hasData}
            hasUnseen={recapBadge.hasUnseen}
            onReopen={recapBadge.onReopen}
            variant="sidebar"
          />
        )}

        <div className="p-4 border-t border-white/5 bg-dx-surface-2/40">
          <div className="flex items-center space-x-3 mb-4 px-2">
            <div className={`w-8 h-8 rounded-full bg-gradient-to-tr from-brand to-dx-green-deep flex items-center justify-center text-xs font-bold text-white shadow-lg ${getAvatarRingClass(plan.plan_name)}`}>
              {profile?.full_name?.charAt(0) || 'U'}
            </div>
            <div className="flex-1 overflow-hidden">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-medium text-white truncate">{profile?.full_name || 'Usuario'}</p>
                <PremiumBadge planName={plan.plan_name} />
              </div>
              <p className="text-xs text-slate-400 truncate">
                {profile?.role === 'platform_owner' ? 'Owner' :
                 profile?.role === 'agency_admin' ? 'Agencia' :
                 profile?.role === 'org_owner' ? 'Admin' : 'Usuario'}
              </p>
            </div>
          </div>
          <button
            onClick={() => setCurrentPage('pricing')}
            data-onboarding="plan-badge"
            className={`w-full flex items-center justify-between p-2 rounded-lg text-slate-400 transition-all text-xs font-medium border mb-2 ${getPlanBadgeClass(plan.plan_name)}`}
          >
            <span className="flex items-center gap-1.5">
              <CreditCardIcon className="w-3.5 h-3.5" />
              Mi Plan
            </span>
            <span className={`font-bold ${getPlanNameColor(plan.plan_name)}`}>{plan.display_name || 'Free'}</span>
          </button>
          <button
            onClick={() => setIsNotifPrefsOpen(true)}
            className="w-full flex items-center justify-between p-2 rounded-lg text-slate-400 hover:bg-teal-500/10 hover:text-teal-400 transition-all text-xs font-medium border border-white/5 mb-2"
          >
            <span className="flex items-center gap-1.5">
              <PaperAirplaneIcon className="w-3.5 h-3.5" />
              WhatsApp
            </span>
            <span className={`font-bold ${profile?.phone_number ? 'text-teal-400' : 'text-slate-500'}`}>
              {profile?.phone_number ? 'Activo' : 'Configurar'}
            </span>
          </button>
          <button
            onClick={signOut}
            className="w-full flex items-center justify-center space-x-2 p-2 rounded-lg bg-slate-800 hover:bg-red-500/10 hover:text-red-400 text-slate-400 transition-colors text-xs font-medium border border-white/5"
          >
            <ArrowLeftOnRectangleIcon className="w-4 h-4" />
            <span>Cerrar Sesión</span>
          </button>
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
