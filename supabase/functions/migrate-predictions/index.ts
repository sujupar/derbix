// migrate-predictions — DEPRECATED (one-shot migration script)
// Locked behind admin auth to prevent unauthenticated re-runs that would
// duplicate predictions across the entire history.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requirePlatformAdmin, authErrorResponse } from "../_shared/auth-guard.ts";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    const auth = await requirePlatformAdmin(req);
    if (!auth.ok) return authErrorResponse(auth, corsHeaders);
    return new Response(
        JSON.stringify({
            error: "This one-shot migration is permanently disabled.",
            reason: "Re-running it would duplicate predictions across the entire history.",
        }),
        { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
});
