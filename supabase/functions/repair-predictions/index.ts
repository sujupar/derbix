// repair-predictions — DEPRECATED (one-shot script with hardcoded date)
// Locked behind admin auth.
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
        JSON.stringify({ error: "Disabled. One-shot repair already executed." }),
        { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
});
