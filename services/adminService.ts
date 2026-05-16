
import { supabase } from './supabaseService';
import { UserProfile, AdminUserListItem } from '../types';

export type UserDateFilter = 'all' | 'today' | '7d' | '30d';
export type UserOriginFilter = 'all' | 'meta' | 'organic' | 'other';

export interface ListUsersOptions {
    search?: string;
    role?: string;          // 'all' or one of the role values
    origin?: UserOriginFilter;
    period?: UserDateFilter;
    page?: number;          // 1-indexed
    pageSize?: number;      // default 25
}

export interface ListUsersResult {
    users: AdminUserListItem[];
    total: number;
    page: number;
    pageSize: number;
}

// Active statuses that count as "subscribed" for the plan column. Match the
// statuses the rest of the app treats as paying or in-trial.
const ACTIVE_SUB_STATUSES = ['active', 'on_trial', 'trialing'];

function dateFromPeriod(period: UserDateFilter | undefined): string | null {
    if (!period || period === 'all') return null;
    const now = new Date();
    if (period === 'today') {
        // Today in Bogotá (UTC-5). Approximate by subtracting 5h before truncating.
        const bogota = new Date(now.getTime() - 5 * 3600 * 1000);
        bogota.setUTCHours(0, 0, 0, 0);
        return new Date(bogota.getTime() + 5 * 3600 * 1000).toISOString();
    }
    const days = period === '7d' ? 7 : 30;
    return new Date(now.getTime() - days * 86400 * 1000).toISOString();
}

export const adminService = {
    /**
     * List users with optional search, filters and pagination. Returns the
     * joined plan info (active subscription's plan display_name) for the
     * "Plan" column. Server-side filtering keeps memory bounded as the user
     * count grows.
     */
    async listAllUsers(options: ListUsersOptions = {}): Promise<ListUsersResult> {
        const page = Math.max(1, options.page || 1);
        const pageSize = Math.max(1, Math.min(100, options.pageSize || 25));
        const from = (page - 1) * pageSize;
        const to = from + pageSize - 1;

        let query = supabase
            .from('profiles')
            .select('id, email, full_name, avatar_url, role, organization_id, is_org_owner, phone_number, phone_country_code, telegram_username, utm_source, utm_medium, utm_campaign, utm_ref, updated_at', { count: 'exact' })
            .order('updated_at', { ascending: false });

        if (options.search) {
            // ilike on email or full_name
            const term = options.search.replace(/[,()]/g, ' ');
            query = query.or(`email.ilike.%${term}%,full_name.ilike.%${term}%`);
        }

        if (options.role && options.role !== 'all') {
            query = query.eq('role', options.role);
        }

        if (options.origin === 'meta') {
            query = query.eq('utm_source', 'meta');
        } else if (options.origin === 'organic') {
            query = query.is('utm_source', null);
        } else if (options.origin === 'other') {
            query = query.not('utm_source', 'is', null).neq('utm_source', 'meta');
        }

        const sinceIso = dateFromPeriod(options.period);
        if (sinceIso) {
            query = query.gte('updated_at', sinceIso);
        }

        const { data, error, count } = await query.range(from, to);

        if (error) {
            console.error('[adminService.listAllUsers] error:', error);
            throw error;
        }

        const profiles = (data || []) as UserProfile[];
        if (profiles.length === 0) {
            return { users: [], total: count || 0, page, pageSize };
        }

        // Pull active subscriptions for the returned page of users.
        const userIds = profiles.map(p => p.id);
        const { data: subs } = await supabase
            .from('user_subscriptions')
            .select('user_id, status, plan_id')
            .in('user_id', userIds)
            .in('status', ACTIVE_SUB_STATUSES);

        const planIds = Array.from(new Set((subs || []).map(s => s.plan_id))).filter(Boolean);
        let planLookup: Record<string, string> = {};
        if (planIds.length > 0) {
            const { data: plans } = await supabase
                .from('subscription_plans')
                .select('id, display_name, name')
                .in('id', planIds);
            for (const p of plans || []) {
                planLookup[p.id] = p.display_name || p.name || 'unknown';
            }
        }

        const subByUser: Record<string, { status: string; plan_id: string }> = {};
        for (const s of subs || []) {
            // If the user has multiple active subs, pick the first one we see;
            // the schema typically prevents that anyway.
            if (!subByUser[s.user_id]) subByUser[s.user_id] = { status: s.status, plan_id: s.plan_id };
        }

        const users: AdminUserListItem[] = profiles.map(p => {
            const sub = subByUser[p.id];
            return {
                ...p,
                active_plan: sub ? (planLookup[sub.plan_id] || 'unknown') : null,
                subscription_status: (sub?.status as AdminUserListItem['subscription_status']) || null,
            };
        });

        return { users, total: count || 0, page, pageSize };
    },

    /**
     * Update a user's global system role.
     * Only accessible by platform admins via RLS on profiles.
     */
    async updateUserRole(userId: string, newRole: string): Promise<void> {
        const { error } = await supabase
            .from('profiles')
            .update({ role: newRole })
            .eq('id', userId);

        if (error) {
            console.error('[adminService.updateUserRole] error:', error);
            throw error;
        }
    },

    /**
     * Hard-delete a user (auth.users → cascades to profiles, members,
     * subscriptions, etc.). Calls the `delete-user` edge function which
     * enforces platform-admin auth and prevents self-delete + cross-role
     * deletes (only platform_owner can delete platform_owner).
     */
    async deleteUser(userId: string, reason?: string): Promise<{ id: string; email?: string; full_name?: string }> {
        const { data, error } = await supabase.functions.invoke('delete-user', {
            body: { userId, reason },
        });
        if (error) {
            console.error('[adminService.deleteUser] invoke error:', error);
            throw new Error(error.message || 'Error al eliminar el usuario');
        }
        if (!data?.success) {
            throw new Error(data?.error || 'No se pudo eliminar el usuario');
        }
        return data.deletedUser;
    },

    /**
     * Get global stats for the dashboard.
     */
    async getSystemStats() {
        const { count: userCount, error: userError } = await supabase
            .from('profiles')
            .select('*', { count: 'exact', head: true });

        const { count: orgCount, error: orgError } = await supabase
            .from('organizations')
            .select('*', { count: 'exact', head: true });

        if (userError || orgError) {
            console.error('Error fetching stats', userError, orgError);
        }

        return {
            totalUsers: userCount || 0,
            totalOrgs: orgCount || 0,
        };
    },
};
