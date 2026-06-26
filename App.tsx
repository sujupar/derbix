import React from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { FixturesFeed } from './components/LiveFeed';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { LanguageProvider } from './contexts/LanguageContext';
import { OrganizationProvider } from './contexts/OrganizationContext';
import { SubscriptionProvider } from './contexts/SubscriptionContext';
import { AuthPage } from './components/Auth';
import { LandingPage } from './components/landing/LandingPage';
import { AdminPage } from './components/Admin';
import { PricingPage } from './components/pricing/PricingPage';
import { PublicPricingPage } from './components/pricing/PublicPricingPage';
import ResultadosPage from './components/ResultadosPage';
import { SettingsPage } from './components/settings/SettingsPage';
import { SignUpFlow } from './components/auth/SignUpFlow';
import { ResetPassword } from './components/auth/ResetPassword';
import { TermsOfService } from './components/legal/TermsOfService';
import { PrivacyPolicy } from './components/legal/PrivacyPolicy';
import { RefundPolicy } from './components/legal/RefundPolicy';
import { isAgencyRole } from './utils/roles';
import { useSubscription } from './contexts/SubscriptionContext';
import { useOrganization } from './contexts/OrganizationContext';
import { PrediccionPage } from './components/seo/PrediccionPage';
import { PrediccionesIndex } from './components/seo/PrediccionesIndex';
import { TeamPredictionsPage } from './components/seo/TeamPredictionsPage';
import { EstadisticasPage } from './components/seo/EstadisticasPage';
import { useDailyRecap } from './hooks/useDailyRecap';
import { DailyRecapModal } from './components/recap/DailyRecapModal';
import { ToastProvider, useToast } from './contexts/ToastContext';
import { useOnboarding } from './hooks/useOnboarding';
import { WelcomeScreen } from './components/onboarding/WelcomeScreen';
import { OnboardingOverlay } from './components/onboarding/OnboardingOverlay';
import { CelebrationOverlay } from './components/celebrations/CelebrationOverlay';
import { CommandPalette } from './components/CommandPalette';
import { MilestoneBanner } from './components/premium/MilestoneBanner';
import { useMilestones } from './hooks/useMilestones';

export type Page = 'live' | 'live-now' | 'results' | 'admin' | 'pricing' | 'settings';

// --- PLATFORM (PROTECTED APP) ---
const Platform: React.FC = () => {
  const { profile } = useAuth();
  const { plan, isAdmin, refreshSubscription } = useSubscription();
  const { isImpersonating } = useOrganization();
  const { showToast } = useToast();
  const { signOut } = useAuth();
  const onboarding = useOnboarding(!!profile);
  const isPaidUser = plan.plan_name !== 'free';
  const milestones = useMilestones(isPaidUser);
  const [currentPage, setCurrentPage] = React.useState<Page>('live');
  const [showCelebration, setShowCelebration] = React.useState(false);

  // Handler: ?payment=success después de pagar en Whop
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('payment') === 'success') {
      setShowCelebration(true);
      refreshSubscription();
      window.history.replaceState({}, '', window.location.pathname);
      showToast(`¡Plan ${plan.display_name || ''} activado exitosamente!`, 'success', 6000);
    }
  }, []);

  const recap = useDailyRecap(
    plan.plan_name,
    isAdmin || isAgencyRole(profile?.role),
    !!profile,
    isImpersonating
  );

  // Error safety for profile loading
  if (!profile) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-dx-bg text-white p-4">
        <h2 className="text-2xl font-display font-bold mb-4 text-center">Cargando Perfil...</h2>
        <div className="w-8 h-8 border-4 border-dx-green border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  const renderContent = () => {
    switch (currentPage) {
      case 'live':
        return <FixturesFeed key="live" />;
      case 'live-now':
        return <FixturesFeed key="live-now" initialLive />;
      case 'results':
        return <ResultadosPage />;
      case 'settings':
        return <SettingsPage onNavigate={setCurrentPage} />;
      case 'admin':
        if (isAgencyRole(profile.role)) {
          return <AdminPage />;
        }
        setCurrentPage('live');
        return <FixturesFeed key="live" />;
      case 'pricing':
        return <PricingPage />;
      default:
        return <FixturesFeed key="live" />;
    }
  };

  return (
    <Layout
      currentPage={currentPage}
      setCurrentPage={setCurrentPage}
      recapBadge={{
        hasData: recap.hasData,
        hasUnseen: recap.hasUnseen,
        onReopen: recap.reopen,
      }}
    >
      {renderContent()}
      {recap.isVisible && recap.data && (
        <DailyRecapModal
          data={recap.data}
          tier={recap.tier}
          onDismiss={recap.dismiss}
          onUpgrade={() => setCurrentPage('pricing')}
          onViewResults={() => setCurrentPage('results')}
        />
      )}
      {showCelebration && (
        <CelebrationOverlay
          planName={plan.display_name || 'Máquina'}
          predictionsPercentage={plan.predictions_percentage}
          onDismiss={() => setShowCelebration(false)}
        />
      )}
      {onboarding.shouldShow && onboarding.showWelcome && (
        <WelcomeScreen
          userName={profile.full_name || 'Usuario'}
          planName={plan.display_name}
          onStart={onboarding.startTour}
          onSkip={onboarding.skip}
        />
      )}
      {onboarding.shouldShow && !onboarding.showWelcome && (
        <OnboardingOverlay
          currentStep={onboarding.currentStep}
          totalSteps={onboarding.totalSteps}
          onNext={onboarding.nextStep}
          onPrev={onboarding.prevStep}
          onSkip={onboarding.skip}
          onComplete={onboarding.complete}
        />
      )}
      <CommandPalette setCurrentPage={setCurrentPage} onSignOut={signOut} />
      <MilestoneBanner milestone={milestones.pendingMilestone} onDismiss={milestones.dismissMilestone} />
    </Layout>
  );
};

// --- ROUTE WRAPPERS ---

const LandingRoute = () => {
  const { session } = useAuth();
  const navigate = useNavigate();

  if (session) {
    return <Navigate to="/app" replace />;
  }

  return (
    <LandingPage
      onGetStarted={() => navigate('/signup')}
      onLoginClick={() => navigate('/login')}
    />
  );
};

const LoginRoute = () => {
  const { session } = useAuth();

  if (session) {
    return <Navigate to="/app" replace />;
  }

  return <AuthPage />;
};

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { session, loading } = useAuth();

  if (loading) return null;
  if (!session) return <Navigate to="/login" replace />;

  return <>{children}</>;
};

// --- MAIN APP ---

const AppContent: React.FC = () => {
  return (
    <Routes>
      <Route path="/" element={<LandingRoute />} />
      <Route path="/pricing" element={<PublicPricingPage />} />
      <Route path="/terms" element={<TermsOfService />} />
      <Route path="/privacy" element={<PrivacyPolicy />} />
      <Route path="/refund" element={<RefundPolicy />} />
      <Route path="/predicciones" element={<PrediccionesIndex />} />
      <Route path="/predicciones/equipo/:teamSlug" element={<TeamPredictionsPage />} />
      <Route path="/predicciones/:leagueSlug" element={<PrediccionesIndex />} />
      <Route path="/predicciones/:leagueSlug/:matchSlug" element={<PrediccionPage />} />
      <Route path="/estadisticas" element={<EstadisticasPage />} />
      <Route path="/signup" element={<SignUpFlow />} />
      <Route path="/login" element={<LoginRoute />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route
        path="/app/*"
        element={
          <ProtectedRoute>
            <Platform />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

const App: React.FC = () => {
  return (
    <AuthProvider>
      <OrganizationProvider>
        <SubscriptionProvider>
          <LanguageProvider>
            <ToastProvider>
              <AppContent />
            </ToastProvider>
          </LanguageProvider>
        </SubscriptionProvider>
      </OrganizationProvider>
    </AuthProvider>
  );
};

export default App;
