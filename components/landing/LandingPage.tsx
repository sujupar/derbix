import React, { useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { LandingNavbar } from './LandingNavbar';
import { LandingHero } from './LandingHero';
import { TrustSignals } from './TrustSignals';
import { ProblemSection } from './ProblemSection';
import { HowItWorks } from './HowItWorks';
import { EasySteps } from './EasySteps';
import { ComparisonTable } from './ComparisonTable';
import { LandingPricing } from './LandingPricing';
import { FAQSection } from './FAQSection';
import { FinalCTA } from './FinalCTA';
import { LandingFooter } from './LandingFooter';

interface LandingPageProps {
  onGetStarted: () => void;
  onLoginClick: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onGetStarted, onLoginClick }) => {
  const { session } = useAuth();

  useEffect(() => {
    if (session) {
      window.location.reload();
    }
  }, [session]);

  return (
    <div className="min-h-screen bg-black font-sans text-slate-200 selection:bg-brand selection:text-white overflow-x-hidden">
      <LandingNavbar onGetStarted={onGetStarted} onLoginClick={onLoginClick} />
      <LandingHero onGetStarted={onGetStarted} />
      <TrustSignals />
      <ProblemSection />
      <HowItWorks />
      <EasySteps />
      <ComparisonTable />
      <LandingPricing />
      <FAQSection />
      <FinalCTA onGetStarted={onGetStarted} />
      <LandingFooter />
    </div>
  );
};
