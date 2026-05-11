/**
 * Subscription Service
 * Fuente unica de verdad para suscripciones, limites y tracking de uso.
 * Consolida la logica de subscriptionCheckService.ts (eliminado).
 */

import { supabase } from './supabaseService';

// Types
export interface SubscriptionPlan {
    id: string;
    name: string;
    display_name: string;
    description: string | null;
    price_cents: number;
    currency: string;
    billing_period: string;
    predictions_percentage: number;
    monthly_analysis_limit: number | null;
    analysis_percentage: number;
    can_analyze_own_tickets: boolean;
    can_access_ml_dashboard: boolean;
    can_access_full_stats: boolean;
    has_priority_support: boolean;
    sort_order: number;
    // Lemon Squeezy fields
    ls_product_id?: string;
    ls_variant_id_monthly?: string;
    ls_variant_id_annual?: string;
    // Whop fields
    whop_plan_id?: string;
    whop_plan_id_annual?: string;
    annual_price_cents: number;
    annual_discount_percentage: number;
}

export interface UserSubscription {
    id: string;
    user_id: string;
    organization_id: string;
    plan_id: string;
    status: 'active' | 'cancelled' | 'expired' | 'past_due' | 'trialing' | 'paused' | 'on_trial';
    current_period_start: string;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
    billing_period: string;
    renews_at: string | null;
    ends_at: string | null;
    ls_subscription_id: string | null;
    ls_customer_id: string | null;
    whop_membership_id: string | null;
    whop_user_id: string | null;
    card_brand: string | null;
    card_last_four: string | null;
    customer_portal_url: string | null;
    plan?: SubscriptionPlan;
}

export interface UserPlan {
    plan_name: string;
    display_name: string;
    predictions_percentage: number;
    monthly_analysis_limit: number | null;
    analysis_percentage: number;
    can_analyze_own_tickets: boolean;
    can_access_ml_dashboard: boolean;
    can_access_full_stats: boolean;
    has_priority_support: boolean;
    subscription_status: string;
    period_end: string | null;
    billing_period: string;
    renews_at: string | null;
    ls_subscription_id: string | null;
    customer_portal_url: string | null;
}

export interface UsageStats {
    predictions_used: number;
    analyses_used: number;
    period_start: string;
    period_end: string;
}

export interface FeatureLimitResult {
    allowed: boolean;
    current: number;
    limit: number | null;
    message?: string;
}

// ==========================================
// ADMIN BYPASS (consolidado de subscriptionCheckService)
// ==========================================

const ADMIN_ROLES = ['platform_owner', 'agency_admin', 'admin', 'superadmin'];

/**
 * Verifica si el usuario tiene rol de administrador.
 * Admins obtienen acceso ilimitado a todo.
 */
export async function isAdminRole(userId: string): Promise<boolean> {
    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', userId)
            .single();

        if (error) throw error;
        return ADMIN_ROLES.includes(data?.role || '');
    } catch (error) {
        console.error('Error checking admin role:', error);
        return false;
    }
}

// ==========================================
// PLAN QUERIES
// ==========================================

/**
 * Obtiene todos los planes activos
 */
export const getActivePlans = async (): Promise<SubscriptionPlan[]> => {
    const { data, error } = await supabase
        .from('subscription_plans')
        .select('*')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });

    if (error) {
        console.error('Error fetching plans:', error);
        return [];
    }

    return data || [];
};

/**
 * Obtiene un plan por nombre
 */
export const getPlanByName = async (name: string): Promise<SubscriptionPlan | null> => {
    const { data, error } = await supabase
        .from('subscription_plans')
        .select('*')
        .eq('name', name)
        .single();

    if (error) {
        console.error('Error fetching plan:', error);
        return null;
    }

    return data;
};

// ==========================================
// USER SUBSCRIPTION
// ==========================================

/**
 * Obtiene el plan actual del usuario usando la funcion de base de datos.
 * El RPC get_user_plan ya incluye admin bypass en el lado de DB.
 */
export const getCurrentUserPlan = async (userId: string, orgId?: string): Promise<UserPlan | null> => {
    const { data, error } = await supabase
        .rpc('get_user_plan', {
            p_user_id: userId,
            p_org_id: orgId || null
        });

    if (error) {
        console.error('Error getting user plan:', error);
        return null;
    }

    return data?.[0] || null;
};

/**
 * Obtiene la suscripcion del usuario con detalles del plan
 */
export const getUserSubscription = async (userId: string, orgId?: string): Promise<UserSubscription | null> => {
    let query = supabase
        .from('user_subscriptions')
        .select(`
      *,
      plan:subscription_plans(*)
    `)
        .eq('user_id', userId)
        .in('status', ['active', 'trialing', 'on_trial', 'paused']);

    if (orgId) {
        query = query.eq('organization_id', orgId);
    }

    const { data, error } = await query.single();

    if (error) {
        // No subscription found is not an error
        if (error.code === 'PGRST116') return null;
        console.error('Error fetching subscription:', error);
        return null;
    }

    return data;
};

/**
 * Asigna un plan a un usuario (para uso administrativo)
 */
export const assignPlanToUser = async (
    userId: string,
    orgId: string,
    planId: string,
    assignedBy?: string,
    notes?: string
): Promise<{ success: boolean; error?: string }> => {
    // Calcular periodo (1 mes desde ahora)
    const periodStart = new Date();
    const periodEnd = new Date();
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    const { error } = await supabase
        .from('user_subscriptions')
        .upsert({
            user_id: userId,
            organization_id: orgId,
            plan_id: planId,
            status: 'active',
            current_period_start: periodStart.toISOString(),
            current_period_end: periodEnd.toISOString(),
            assigned_by: assignedBy || null,
            notes: notes || null,
            billing_period: 'monthly'
        }, {
            onConflict: 'user_id,organization_id'
        });

    if (error) {
        console.error('Error assigning plan:', error);
        return { success: false, error: error.message };
    }

    return { success: true };
};

// ==========================================
// USAGE TRACKING
// ==========================================

/**
 * Obtiene el uso del periodo actual
 */
export const getCurrentUsage = async (userId: string, orgId?: string): Promise<UsageStats> => {
    const { data, error } = await supabase
        .rpc('get_current_usage', {
            p_user_id: userId,
            p_org_id: orgId || null
        });

    if (error || !data?.[0]) {
        // Retornar valores por defecto
        const now = new Date();
        const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

        return {
            predictions_used: 0,
            analyses_used: 0,
            period_start: periodStart.toISOString().split('T')[0],
            period_end: periodEnd.toISOString().split('T')[0]
        };
    }

    return data[0];
};

/**
 * Incrementa el contador de uso para un feature
 */
export const incrementUsage = async (
    userId: string,
    orgId: string,
    feature: 'predictions' | 'analyses'
): Promise<boolean> => {
    const { data, error } = await supabase
        .rpc('increment_usage', {
            p_user_id: userId,
            p_org_id: orgId,
            p_feature: feature
        });

    if (error) {
        console.error('Error incrementing usage:', error);
        return false;
    }

    return data === true;
};

// ==========================================
// LIMIT CHECKS
// ==========================================

/**
 * Verifica si el usuario puede usar un feature especifico
 */
export const checkFeatureLimit = async (
    userId: string,
    orgId: string,
    feature: 'predictions' | 'analyses'
): Promise<FeatureLimitResult> => {
    // 1. Obtener plan del usuario
    const plan = await getCurrentUserPlan(userId, orgId);

    if (!plan) {
        return {
            allowed: feature === 'predictions',
            current: 0,
            limit: feature === 'predictions' ? 1 : 0,
            message: 'Necesitas una suscripcion para acceder a esta funcion.'
        };
    }

    // 2. Obtener uso actual
    const usage = await getCurrentUsage(userId, orgId);

    // 3. Determinar limite segun feature y plan
    let limit: number | null = null;
    let current = 0;

    switch (feature) {
        case 'predictions':
            // El limite de predicciones es un porcentaje, no un numero fijo
            const hasAccess = plan.predictions_percentage > 0;
            return {
                allowed: hasAccess,
                current: usage.predictions_used,
                limit: null,
                message: hasAccess ? undefined : 'Tu plan no incluye pronosticos premium.'
            };

        case 'analyses':
            limit = plan.monthly_analysis_limit;
            current = usage.analyses_used;
            break;
    }

    // Si limit es null, es ilimitado
    if (limit === null) {
        return { allowed: true, current, limit: null };
    }

    const allowed = current < limit;

    return {
        allowed,
        current,
        limit,
        message: allowed
            ? undefined
            : `Has alcanzado el limite de ${limit} analisis este mes. Actualiza tu plan para continuar.`
    };
};

/**
 * Verifica acceso a un feature booleano
 */
export const hasFeatureAccess = async (
    userId: string,
    orgId: string,
    feature: 'ml_dashboard' | 'own_tickets' | 'full_stats' | 'priority_support'
): Promise<boolean> => {
    const plan = await getCurrentUserPlan(userId, orgId);

    if (!plan) return false;

    switch (feature) {
        case 'ml_dashboard':
            return plan.can_access_ml_dashboard;
        case 'own_tickets':
            return plan.can_analyze_own_tickets;
        case 'full_stats':
            return plan.can_access_full_stats;
        case 'priority_support':
            return plan.has_priority_support;
        default:
            return false;
    }
};

// ==========================================
// HELPERS
// ==========================================

/**
 * Formatea el precio de centavos a dolares
 */
export const formatPrice = (cents: number, currency: string = 'USD'): string => {
    const dollars = cents / 100;
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency
    }).format(dollars);
};

/**
 * Calcula el porcentaje de uso
 */
export const calculateUsagePercentage = (current: number, limit: number | null): number => {
    if (limit === null || limit === 0) return 0;
    if (limit === -1) return 0; // Ilimitado
    return Math.min(100, Math.round((current / limit) * 100));
};

/**
 * Obtiene un resumen completo del estado de suscripcion del usuario
 */
export const getSubscriptionSummary = async (userId: string, orgId: string) => {
    const [plan, usage, subscription] = await Promise.all([
        getCurrentUserPlan(userId, orgId),
        getCurrentUsage(userId, orgId),
        getUserSubscription(userId, orgId)
    ]);

    return {
        plan: plan || {
            plan_name: 'free',
            display_name: 'Gratis',
            predictions_percentage: 1, // Free: 1 diaria
            monthly_analysis_limit: 0,
            analysis_percentage: 0,
            can_analyze_own_tickets: false,
            can_access_ml_dashboard: false,
            can_access_full_stats: false,
            has_priority_support: false,
            subscription_status: 'active',
            period_end: null,
            billing_period: 'monthly',
            renews_at: null,
            ls_subscription_id: null,
            customer_portal_url: null
        },
        usage,
        subscription,
        limits: {
            analyses: {
                used: usage.analyses_used,
                limit: plan?.monthly_analysis_limit,
                percentage: plan?.monthly_analysis_limit
                    ? calculateUsagePercentage(usage.analyses_used, plan.monthly_analysis_limit)
                    : 0
            }
        }
    };
};

/**
 * Obtiene el plan recomendado para upgrade
 */
export function getRecommendedUpgrade(currentPlanName: string): {
    planName: string;
    displayName: string;
    benefits: string[];
} {
    const upgrades: Record<string, { planName: string; displayName: string; benefits: string[] }> = {
        free: {
            planName: 'starter',
            displayName: 'Ventaja',
            benefits: [
                '35% de oportunidades diarias con 83%+ de confianza',
                'Análisis de partidos seleccionados',
                'Historial verificable completo',
                'Recomendaciones de staking'
            ]
        },
        starter: {
            planName: 'pro',
            displayName: 'Elite',
            benefits: [
                '70% de oportunidades diarias',
                'Análisis ilimitado de partidos',
                'Dashboard de ROI personal',
                'BONUS: Guía "Los 7 Errores Fatales del Apostador"'
            ]
        },
        pro: {
            planName: 'premium',
            displayName: 'Máquina',
            benefits: [
                '100% de oportunidades diarias',
                'Estadísticas avanzadas completas',
                'Soporte prioritario',
                'BONUS: Guía + Checklist + Acceso anticipado'
            ]
        }
    };

    return upgrades[currentPlanName] || upgrades.free;
}
