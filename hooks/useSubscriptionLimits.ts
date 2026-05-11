import { useState, useEffect } from 'react';
import { useAuth } from './useAuth';
import { useOrganization } from '../contexts/OrganizationContext';
import {
    getCurrentUserPlan,
    getCurrentUsage,
    checkFeatureLimit,
    getRecommendedUpgrade,
    FeatureLimitResult
} from '../services/subscriptionService';

interface Subscription {
    planName: string;
    displayName: string;
    predictionsPercentage: number;
    monthlyAnalysisLimit: number | null;
    analysisPercentage: number;
    canAccessMLDashboard: boolean;
    canAnalyzeOwnTickets: boolean;
    canAccessFullStats: boolean;
    hasPrioritySupport: boolean;
}

interface Usage {
    predictionsViewed: number;
    analysesRan: number;
}

export function useSubscriptionLimits() {
    const { user } = useAuth();
    const { currentOrg } = useOrganization();

    const [subscription, setSubscription] = useState<Subscription | null>(null);
    const [usage, setUsage] = useState<Usage | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user) {
            setLoading(false);
            return;
        }

        const loadData = async () => {
            const plan = await getCurrentUserPlan(user.id, currentOrg?.id);
            const stats = await getCurrentUsage(user.id, currentOrg?.id);

            if (plan) {
                setSubscription({
                    planName: plan.plan_name,
                    displayName: plan.display_name,
                    predictionsPercentage: plan.predictions_percentage,
                    monthlyAnalysisLimit: plan.monthly_analysis_limit,
                    analysisPercentage: plan.analysis_percentage ?? 0,
                    canAccessMLDashboard: plan.can_access_ml_dashboard,
                    canAnalyzeOwnTickets: plan.can_analyze_own_tickets,
                    canAccessFullStats: plan.can_access_full_stats ?? false,
                    hasPrioritySupport: plan.has_priority_support ?? false,
                });
            }

            if (stats) {
                setUsage({
                    predictionsViewed: stats.predictions_used,
                    analysesRan: stats.analyses_used,
                });
            }

            setLoading(false);
        };

        loadData();
    }, [user, currentOrg]);

    const checkAnalysisAccess = async (): Promise<FeatureLimitResult> => {
        if (!user || !currentOrg?.id) return { allowed: false, current: 0, limit: 0, message: 'No autenticado' };
        return await checkFeatureLimit(user.id, currentOrg.id, 'analyses');
    };

    const recommendedUpgrade = subscription
        ? getRecommendedUpgrade(subscription.planName)
        : null;

    const analysesRemaining = subscription && usage
        ? subscription.monthlyAnalysisLimit === null
            ? null
            : Math.max(0, subscription.monthlyAnalysisLimit - usage.analysesRan)
        : 0;

    return {
        subscription,
        usage,
        loading,

        checkAnalysisAccess,

        analysesRemaining,
        recommendedUpgrade,

        isPremium: subscription?.planName === 'premium',
        isPro: subscription?.planName === 'pro',
        isStarter: subscription?.planName === 'starter',
        isFree: subscription?.planName === 'free',
        isAdmin: subscription?.planName === 'premium',
    };
}
