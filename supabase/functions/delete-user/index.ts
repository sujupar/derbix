/**
 * delete-user
 *
 * Permanently deletes a user from auth.users. The cascade FKs in public
 * tables (profiles, organization_members, subscriptions, etc.) clean up
 * the rest automatically.
 *
 * SECURITY:
 * - Requires a platform admin JWT (platform_owner or agency_admin).
 * - Cannot delete yourself.
 * - Cannot delete another platform_owner unless the caller is also
 *   platform_owner (agency_admin can manage users but not their peers).
 *
 * BODY:
 *   { userId: string, reason?: string }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { requirePlatformAdmin, authErrorResponse } from "../_shared/auth-guard.ts";

serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    const auth = await requirePlatformAdmin(req);
    if (!auth.ok) return authErrorResponse(auth, corsHeaders);

    const sbUrl = Deno.env.get("SUPABASE_URL");
    const sbServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!sbUrl || !sbServiceKey) {
        return new Response(JSON.stringify({ success: false, error: "Server misconfiguration" }), {
            status: 500, headers: corsHeaders,
        });
    }

    let body: { userId?: string; reason?: string };
    try {
        body = await req.json();
    } catch {
        return new Response(JSON.stringify({ success: false, error: "Invalid JSON body" }), {
            status: 400, headers: corsHeaders,
        });
    }

    const { userId, reason } = body;
    if (!userId || typeof userId !== "string") {
        return new Response(JSON.stringify({ success: false, error: "userId required" }), {
            status: 400, headers: corsHeaders,
        });
    }

    if (userId === auth.userId) {
        return new Response(JSON.stringify({ success: false, error: "No puedes eliminarte a ti mismo" }), {
            status: 400, headers: corsHeaders,
        });
    }

    const admin = createClient(sbUrl, sbServiceKey);

    // Pull target's profile to validate the role-vs-role rule.
    const { data: target, error: targetErr } = await admin
        .from("profiles")
        .select("id, email, full_name, role")
        .eq("id", userId)
        .single();

    if (targetErr || !target) {
        return new Response(JSON.stringify({ success: false, error: "Target user not found" }), {
            status: 404, headers: corsHeaders,
        });
    }

    if (target.role === "platform_owner" && auth.role !== "platform_owner") {
        return new Response(JSON.stringify({ success: false, error: "Solo otro platform_owner puede eliminar un platform_owner" }), {
            status: 403, headers: corsHeaders,
        });
    }

    // Hard delete from auth.users. Cascade FKs clean up profiles, members,
    // subscriptions, predictions, etc. (verified in migrations).
    const { error: delErr } = await admin.auth.admin.deleteUser(userId);
    if (delErr) {
        console.error("[delete-user] auth.admin.deleteUser failed:", delErr);
        return new Response(JSON.stringify({ success: false, error: delErr.message || "Delete failed" }), {
            status: 500, headers: corsHeaders,
        });
    }

    // Audit trail in function logs (no dedicated table yet). Includes who did
    // it, who was deleted, and why — visible in Supabase function logs.
    console.log(`[delete-user] AUDIT: actor=${auth.userId} (${auth.email}) deleted=${userId} (${target.email}, role=${target.role}) reason=${reason || "(none)"}`);

    return new Response(JSON.stringify({
        success: true,
        deletedUser: {
            id: target.id,
            email: target.email,
            full_name: target.full_name,
        },
    }), { headers: corsHeaders });
});
