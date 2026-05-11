/**
 * Subscription Context
 * Provee estado global de suscripcion del usuario con soporte Lemon Squeezy
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useOrganization } from './OrganizationContext';
import {
    getSubscriptionSummary,
    checkFeatureLimit,
    incrementUsage,
    FeatureLimitResult
} from '../services/subscriptionService';

interface PlanState {
    plan_name: string;
    display_name: string;
    predictions_percentage: number;
    monthly_parlay_limit: number;
    monthly_analysis_limit: number | null;
    analysis_percentage: number;
    can_analyze_own_tickets: boolean;
    can_access_ml_dashboard: boolean;
    can_access_full_stats: boolean;
    has_priority_support: boolean;
    billing_period: string;
    renews_at: string | null;
    ls_subscription_id: string | null;
    whop_membership_id: string | null;
    customer_portal_url: string | null;
}

interface SubscriptionState {
    plan: PlanState;
    usage: {
        predictions_used: number;
        parlays_used: number;
        analyses_used: number;
    };
    limits: {
        parlays: { used: number; limit: number; percentage: number };
        analyses: { used: number; limit: number | null; percentage: number };
    };
    isLoading: boolean;
    isPremium: boolean;
    isPro: boolean;
    isStarter: boolean;
    isFree: boolean;
    isAdmin: boolean;
}

interface SubscriptionContextType extends SubscriptionState {
    checkLimit: (feature: 'predictions' | 'parlays' | 'analyses') => Promise<FeatureLimitResult>;
    trackUsage: (feature: 'predictions' | 'parlays' | 'analyses') => Promise<boolean>;
    refreshSubscription: () => Promise<void>;
    canUseParlays: () => Promise<FeatureLimitResult>;
    canUseAnalysis: () => Promise<FeatureLimitResult>;
}

const defaultPlan: PlanState = {
    plan_name: 'free',
    display_name: 'Gratis',
    predictions_percentage: 1,
    monthly_parlay_limit: 0,
    monthly_analysis_limit: 0,
    analysis_percentage: 0,
    can_analyze_own_tickets: false,
    can_access_ml_dashboard: false,
    can_access_full_stats: false,
    has_priority_support: false,
    billing_period: 'monthly',
    renews_at: null,
    ls_subscription_id: null,
    whop_membership_id: null,
    customer_portal_url: null,
};

const defaultState: SubscriptionState = {
    plan: defaultPlan,
    usage: {
        predictions_used: 0,
        parlays_used: 0,
        analyses_used: 0,
    },
    limits: {
        parlays: { used: 0, limit: 0, percentage: 0 },
        analyses: { used: 0, limit: 0, percentage: 0 },
    },
    isLoading: true,
    isPremium: false,
    isPro: false,
    isStarter: false,
    isFree: true,
    isAdmin: false,
};

const SubscriptionContext = createContext<SubscriptionContextType | undefined>(undefined);

export const SubscriptionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { user } = useAuth();
    const { currentOrg, isImpersonating, impersonatedUserId } = useOrganization();
    const [state, setState] = useState<SubscriptionState>(defaultState);

    // Cuando impersonamos, usar el userId del owner del org impersonado
    // para que get_user_plan retorne el plan REAL del cliente (no admin bypass)
    const effectiveUserId = isImpersonating && impersonatedUserId ? impersonatedUserId : user?.id;

    const refreshSubscription = useCallback(async () => {
        if (!effectiveUserId || !currentOrg?.id) {
            setState(defaultState);
            return;
        }

        setState(prev => ({ ...prev, isLoading: true }));

        try {
            const summary = await getSubscriptionSummary(effectiveUserId, currentOrg.id);

            const planName = summary.plan.plan_name;
            setState({
                plan: {
                    plan_name: planName,
                    display_name: summary.plan.display_name,
                    predictions_percentage: summary.plan.predictions_percentage,
                    monthly_parlay_limit: summary.plan.monthly_parlay_limit,
                    monthly_analysis_limit: summary.plan.monthly_analysis_limit,
                    analysis_percentage: summary.plan.analysis_percentage ?? 0,
                    can_analyze_own_tickets: summary.plan.can_analyze_own_tickets,
                    can_access_ml_dashboard: summary.plan.can_access_ml_dashboard,
                    can_access_full_stats: summary.plan.can_access_full_stats ?? false,
                    has_priority_support: summary.plan.has_priority_support ?? false,
                    billing_period: summary.plan.billing_period ?? 'monthly',
                    renews_at: summary.plan.renews_at ?? null,
                    ls_subscription_id: summary.plan.ls_subscription_id ?? null,
                    whop_membership_id: summary.plan.whop_membership_id ?? null,
                    customer_portal_url: summary.plan.customer_portal_url ?? null,
                },
                usage: summary.usage,
                limits: summary.limits,
                isLoading: false,
                isPremium: planName === 'premium',
                isPro: planName === 'pro',
                isStarter: planName === 'starter',
                isFree: planName === 'free',
                isAdmin: planName === 'premium',
            });
        } catch (error) {
            console.error('Error loading subscription:', error);
            setState(prev => ({ ...prev, isLoading: false }));
        }
    }, [effectiveUserId, currentOrg?.id]);

    useEffect(() => {
        refreshSubscription();
    }, [refreshSubscription]);

    const checkLimit = useCallback(async (feature: 'predictions' | 'parlays' | 'analyses') => {
        if (!effectiveUserId || !currentOrg?.id) {
            return { allowed: false, current: 0, limit: 0, message: 'Usuario no autenticado' };
        }
        return checkFeatureLimit(effectiveUserId, currentOrg.id, feature);
    }, [effectiveUserId, currentOrg?.id]);

    const trackUsage = useCallback(async (feature: 'predictions' | 'parlays' | 'analyses') => {
        if (!effectiveUserId || !currentOrg?.id) return false;
        const result = await incrementUsage(effectiveUserId, currentOrg.id, feature);
        if (result) {
            await refreshSubscription();
        }
        return result;
    }, [effectiveUserId, currentOrg?.id, refreshSubscription]);

    const canUseParlays = useCallback(() => checkLimit('parlays'), [checkLimit]);
    const canUseAnalysis = useCallback(() => checkLimit('analyses'), [checkLimit]);

    const value: SubscriptionContextType = {
        ...state,
        checkLimit,
        trackUsage,
        refreshSubscription,
        canUseParlays,
        canUseAnalysis,
    };

    return (
        <SubscriptionContext.Provider value={value}>
            {children}
        </SubscriptionContext.Provider>
    );
};

export const useSubscription = (): SubscriptionContextType => {
    const context = useContext(SubscriptionContext);
    if (!context) {
        throw new Error('useSubscription must be used within a SubscriptionProvider');
    }
    return context;
};

export default SubscriptionContext;
