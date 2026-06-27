import React, { useState, useEffect } from 'react';
import { CalendarDaysIcon, ShieldCheckIcon, CogIcon, TrendingUpIcon, SignalIcon } from './icons/Icons';
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
import { SupportWidget } from './support/SupportWidget';
import { ProfileMenu } from './ProfileMenu';

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
  // Vista previa del tema por plan (SOLO visual; no cambia el plan real del usuario)
  const [planPreview, setPlanPreview] = useState<'base' | 'premium' | 'elite' | null>(null);
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

  const accountInitials = (profile?.full_name || 'U')
    .split(' ').map(w => w.charAt(0)).slice(0, 2).join('').toUpperCase();
  // Tema por plan: premium → dorado, pro/élite → plata. Resto → verde (default).
  const planThemeAttr = plan.plan_name === 'premium' ? 'premium' : plan.plan_name === 'pro' ? 'elite' : undefined;
  // Si hay vista previa activa, ésta manda (sidebar + perfil). 'base' = verde (sin atributo).
  const planScopeAttr = planPreview ? (planPreview === 'base' ? undefined : planPreview) : planThemeAttr;

  // Roles: agency (full access) vs client (view only per plan)
  const isAgencySuperadmin = isAgencyRole(profile?.role);
  const isAccountAdmin = profile?.role === 'org_owner';
  const isUser = !isAgencySuperadmin && !isAccountAdmin;

  const roleLabel = profile?.role === 'platform_owner' ? 'Owner'
    : profile?.role === 'agency_admin' ? 'Agencia'
    : profile?.role === 'org_owner' ? 'Admin' : 'Usuario';
  // Nombre del plan para el menú de perfil (sin etiquetas internas)
  const menuPlanName = isAgencySuperadmin ? 'Acceso total' : cleanPlanLabel(plan.display_name);
  // Título de la barra superior (solo Jornadas lo usa; el resto mantiene su propio header)
  const pageTitle = (currentPage === 'live' || currentPage === 'live-now') ? 'Jornadas Deportivas' : '';

  // Opciones del sidebar (agrupadas por sección — Composición 1)
  const navItems = [
    { id: 'live', label: 'Jornadas', section: 'Menú', icon: <CalendarDaysIcon className="w-5 h-5" />, forAgency: true, forAccount: true, forUser: true },
    { id: 'results', label: 'Resultados', section: 'Menú', icon: <TrendingUpIcon className="w-5 h-5" />, forAgency: true, forAccount: true, forUser: true },
    { id: 'live-now', label: 'En vivo', section: 'Menú', icon: <SignalIcon className="w-5 h-5" />, live: true, forAgency: true, forAccount: true, forUser: true },

    // Solo SUPERADMIN de AGENCIA (platform_owner, agency_admin)
    { id: 'admin', label: 'Admin', section: 'Gestión', icon: <ShieldCheckIcon className="w-5 h-5" />, forAgency: true, forAccount: false, forUser: false },
    { id: 'settings', label: 'Configuración', section: 'Gestión', icon: <CogIcon className="w-5 h-5" />, forAgency: true, forAccount: true, forUser: true },
  ];

  const availableNavItems = navItems.filter(item => {
    if (isAgencySuperadmin) return item.forAgency;
    if (isAccountAdmin) return item.forAccount;
    if (isUser) return item.forUser;
    return item.forUser;
  });

  const navSections = availableNavItems.reduce<{ label: string; items: typeof availableNavItems }[]>((acc, item) => {
    const group = acc.find(g => g.label === item.section);
    if (group) group.items.push(item);
    else acc.push({ label: item.section, items: [item] });
    return acc;
  }, []);

  return (
    <div data-plan={planScopeAttr} className="flex h-screen overflow-hidden text-slate-200 font-sans selection:bg-brand selection:text-white bg-dx-bg">

      {/* --- DESKTOP SIDEBAR --- */}
      <aside data-plan={planScopeAttr} className="dx-sidebar dx-planscope hidden md:flex flex-col w-64 h-full bg-dx-surface backdrop-blur-xl border-r border-[color:var(--color-dx-border)] fixed left-0 top-0 z-30 transition-transform duration-300">
        <div className="p-5 flex items-center justify-center border-b border-white/5">
          <img src="/derbix-logo.png" alt="Derbix" className="h-12 object-contain" />
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-5">
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

        {/* Pie del sidebar — SOLO admins (clientes no ven nada aquí) */}
        {isAgencySuperadmin && (
          <div className="p-4 border-t border-white/5 space-y-3">
            {/* Vista previa de tema por plan (no cambia el plan real) */}
            <div className="rounded-xl border border-dx-border p-2.5">
              <p className="text-[10px] uppercase tracking-wider text-dx-text-mute mb-2 px-0.5">Vista previa de plan</p>
              <div className="grid grid-cols-3 gap-1.5">
                {([
                  { k: 'base', label: 'Base', c: '#1DE782' },
                  { k: 'premium', label: 'Premium', c: '#E7B84F' },
                  { k: 'elite', label: 'Élite', c: '#C2CDD8' },
                ] as const).map((opt) => {
                  const active = planPreview === opt.k;
                  return (
                    <button
                      key={opt.k}
                      onClick={() => setPlanPreview(active ? null : opt.k)}
                      className="flex flex-col items-center gap-1 py-1.5 rounded-lg border transition-all"
                      style={{
                        borderColor: active ? opt.c : 'rgba(255,255,255,0.07)',
                        background: active ? opt.c + '1f' : 'transparent',
                      }}
                    >
                      <span className="w-3.5 h-3.5 rounded-full" style={{ background: opt.c }} />
                      <span className="text-[10px] font-bold" style={{ color: active ? opt.c : 'rgba(255,255,255,0.58)' }}>{opt.label}</span>
                    </button>
                  );
                })}
              </div>
              {planPreview && (
                <p className="text-[9px] text-dx-text-mute mt-1.5 px-0.5">Solo vista previa · tu plan real no cambia</p>
              )}
            </div>

            {/* Ver como cliente (selector de cuenta — abre hacia arriba) */}
            <div>
              <p className="dx-sidelabel mb-2">Ver como cliente</p>
              <OrganizationSwitcher onCreateClick={() => setIsCreateModalOpen(true)} openUpward />
            </div>
          </div>
        )}
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
              Volver a mi vista
            </button>
          </div>
        )}

        {/* Desktop Top Bar — título + perfil arriba-derecha + línea animada (color por plan) */}
        <header className="hidden md:block px-8 pt-5 shrink-0">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            {pageTitle ? <h1 className="dxj-h1">{pageTitle}</h1> : <div />}
            <ProfileMenu
              fullName={profile?.full_name || 'Usuario'}
              initials={accountInitials}
              roleLabel={roleLabel}
              planName={menuPlanName}
              planThemeAttr={planScopeAttr}
              email={profile?.email}
              dataOnboarding="plan-badge"
              onSettings={() => setCurrentPage('settings')}
              onSignOut={signOut}
            />
          </div>
          <div className="dxj-divider" />
        </header>

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
            <ProfileMenu
              fullName={profile?.full_name || 'Usuario'}
              initials={accountInitials}
              roleLabel={roleLabel}
              planName={menuPlanName}
              planThemeAttr={planScopeAttr}
              email={profile?.email}
              onSettings={() => setCurrentPage('settings')}
              onSignOut={signOut}
            />
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
          {availableNavItems.slice(0, 5).map((item) => {
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
        </nav>
      </div>

      <CreateSubAccountModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={() => setIsCreateModalOpen(false)}
      />

      <SupportWidget currentPage={currentPage} />
    </div>
  );
};
