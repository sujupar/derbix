// Shared auth guards for edge functions. Use these instead of rolling
// your own role checks to keep the security model consistent.
//
// IMPORTANT: All admin/internal functions must call requirePlatformAdmin()
// or requireServiceCaller() at the top of the handler before doing any work.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PLATFORM_ADMIN_ROLES = new Set(["platform_owner", "agency_admin", "superadmin"]);

export type AuthGuardError = {
    ok: false;
    status: number;
    body: { error: string };
};

export type AuthGuardSuccess = {
    ok: true;
    userId: string;
    role: string;
    email: string | null;
};

export type AuthGuardResult = AuthGuardError | AuthGuardSuccess;

/**
 * Verifies the request carries a valid Supabase JWT and returns the caller.
 * Returns AuthGuardError on failure (caller returns the response directly).
 */
export async function requireAuthenticatedUser(req: Request): Promise<AuthGuardResult> {
    const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return { ok: false, status: 401, body: { error: "Missing Authorization header" } };
    }
    const jwt = authHeader.slice(7);

    const sbUrl = Deno.env.get("SUPABASE_URL");
    const sbAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!sbUrl || !sbAnonKey) {
        console.error("[auth-guard] SUPABASE_URL or SUPABASE_ANON_KEY not configured");
        return { ok: false, status: 500, body: { error: "Server misconfiguration" } };
    }

    const client = createClient(sbUrl, sbAnonKey, {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
    });

    const { data: userData, error: userErr } = await client.auth.getUser(jwt);
    if (userErr || !userData?.user?.id) {
        return { ok: false, status: 401, body: { error: "Invalid or expired token" } };
    }

    // Read role using the SERVICE-ROLE client so we never depend on profiles RLS
    // for the role check (defense in depth).
    const sbServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!sbServiceKey) {
        console.error("[auth-guard] SUPABASE_SERVICE_ROLE_KEY not configured");
        return { ok: false, status: 500, body: { error: "Server misconfiguration" } };
    }
    const admin = createClient(sbUrl, sbServiceKey);
    const { data: profile, error: profileErr } = await admin
        .from("profiles")
        .select("role, email")
        .eq("id", userData.user.id)
        .single();

    if (profileErr || !profile) {
        return { ok: false, status: 403, body: { error: "Profile not found" } };
    }

    return {
        ok: true,
        userId: userData.user.id,
        role: profile.role || "user",
        email: profile.email || userData.user.email || null,
    };
}

/**
 * Same as requireAuthenticatedUser, but additionally enforces a platform
 * admin role (platform_owner, agency_admin). Returns 403 otherwise.
 */
export async function requirePlatformAdmin(req: Request): Promise<AuthGuardResult> {
    const result = await requireAuthenticatedUser(req);
    if (!result.ok) return result;
    if (!PLATFORM_ADMIN_ROLES.has(result.role)) {
        return { ok: false, status: 403, body: { error: "Forbidden: platform admin required" } };
    }
    return result;
}

/**
 * Verifies a fixed shared secret in the X-Internal-Secret header. Use this
 * for service-to-service edge function calls (cron jobs, internal pipelines)
 * where there is no end-user JWT to verify.
 *
 * Configure with: `npx supabase secrets set INTERNAL_FUNCTION_SECRET=<random>`
 */
export function requireServiceCaller(req: Request): { ok: true } | AuthGuardError {
    const provided = req.headers.get("X-Internal-Secret") || req.headers.get("x-internal-secret");
    const expected = Deno.env.get("INTERNAL_FUNCTION_SECRET");
    if (!expected) {
        console.error("[auth-guard] INTERNAL_FUNCTION_SECRET not configured");
        return { ok: false, status: 500, body: { error: "Server misconfiguration" } };
    }
    if (!provided) {
        return { ok: false, status: 401, body: { error: "Missing internal secret" } };
    }
    // Constant-time comparison
    if (provided.length !== expected.length) {
        return { ok: false, status: 401, body: { error: "Forbidden" } };
    }
    let mismatch = 0;
    for (let i = 0; i < provided.length; i++) {
        mismatch |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
    }
    if (mismatch !== 0) {
        return { ok: false, status: 401, body: { error: "Forbidden" } };
    }
    return { ok: true };
}

/**
 * Accepts EITHER a platform admin JWT OR a valid X-Internal-Secret header.
 * Use for endpoints that are called both by humans and by cron/pipelines.
 */
export async function requireAdminOrService(req: Request): Promise<AuthGuardResult | { ok: true; service: true }> {
    const internal = requireServiceCaller(req);
    if (internal.ok) return { ok: true, service: true };
    return await requirePlatformAdmin(req);
}

/**
 * Helper to convert an AuthGuardError into a Response with CORS headers.
 */
export function authErrorResponse(err: AuthGuardError, corsHeaders: Record<string, string>): Response {
    return new Response(JSON.stringify(err.body), {
        status: err.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}
