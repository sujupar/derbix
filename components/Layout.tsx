import React, { useState, useEffect } from 'react';
import { CalendarDaysIcon, ShieldCheckIcon, TrendingUpIcon, SignalIcon } from './icons/Icons';
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
  // Conteos para los badges del sidebar (oportunidades de hoy + partidos en vivo)
  const [oppCount, setOppCount] = useState(0);
  const [liveCount, setLiveCount] = useState(0);
  const [analyzedCount, setAnalyzedCount] = useState(0); // pronósticos/partidos del día

  useEffect(() => {
    let cancelled = false;
    const loadOpp = async () => {
      try {
        const today = getCurrentDateInBogota();
        // Oportunidades (picks de valor) + partidos del día (pronósticos)
        const [oppRes, matchRes] = await Promise.all([
          supabase.from('value_picks_v2').select('id', { count: 'exact', head: true })
            .eq('is_opportunity', true).eq('opportunity_date', today),
          supabase.from('daily_matches').select('api_fixture_id', { count: 'exact', head: true })
            .eq('match_date', today),
        ]);
        if (!cancelled) {
          setOppCount(oppRes.count || 0);
          setAnalyzedCount(matchRes.count || 0);
        }
      } catch { /* silencioso — el resumen es informativo */ }
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
  // Tema por plan REAL: premium → dorado, pro/élite → plata. Resto → verde (default).
  // Refleja también el plan del cliente cuando un admin usa "Ver como cliente" (impersonación).
  const planThemeAttr = plan.plan_name === 'premium' ? 'premium' : plan.plan_name === 'pro' ? 'elite' : undefined;
  const planScopeAttr = planThemeAttr;

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
    // Configuración se quitó del menú: ya vive en el menú de perfil (arriba-derecha).
    { id: 'admin', label: 'Admin', section: 'Gestión', icon: <ShieldCheckIcon className="w-5 h-5" />, forAgency: true, forAccount: false, forUser: false },
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

        {/* Pie del sidebar */}
        {isAgencySuperadmin ? (
          /* Admins: impersonación (clientes NO ven esto) */
          <div className="p-4 border-t border-white/5">
            <p className="dx-sidelabel mb-2">Ver como cliente</p>
            <OrganizationSwitcher onCreateClick={() => setIsCreateModalOpen(true)} openUpward />
          </div>
        ) : (
          /* Usuarios: resumen de hoy (en vivo) + mejorar plan */
          <div className="p-4 border-t border-white/5 space-y-3">
            <div className="rounded-xl border border-dx-border bg-dx-surface-2 p-3">
              <div className="flex items-center gap-1.5 mb-2.5">
                <span className="w-1.5 h-1.5 rounded-full bg-dx-green" style={{ animation: 'dxpulse 1.4s ease-in-out infinite' }} />
                <span className="text-[10px] uppercase tracking-wider font-bold text-dx-green">En vivo</span>
                <span className="text-[10px] uppercase tracking-wider font-bold text-dx-text-mute">· Hoy</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="text-center">
                  <div className="font-display font-extrabold text-2xl text-dx-green dx-num leading-none">{oppCount}</div>
                  <div className="text-[10px] text-dx-text-mute uppercase tracking-wide mt-1">Oportunidades</div>
                </div>
                <div className="text-center border-l border-dx-border">
                  <div className="font-display font-extrabold text-2xl text-dx-green dx-num leading-none">{analyzedCount}</div>
                  <div className="text-[10px] text-dx-text-mute uppercase tracking-wide mt-1">Pronósticos</div>
                </div>
              </div>
            </div>

            <button
              onClick={() => setCurrentPage('pricing')}
              className="flex items-center justify-center gap-1.5 w-full py-2.5 rounded-xl font-extrabold text-sm text-[#04140C] bg-gradient-to-r from-dx-green to-dx-cyan transition-all hover:brightness-110 hover:shadow-[0_10px_28px_-8px_rgba(34,229,192,0.55)] active:scale-[0.98]"
            >
              Mejorar plan
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </button>
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
