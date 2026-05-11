// fix-rls — DEPRECATED & DEPLOYED-LOCKED
//
// This was a one-shot migration helper that exposed unauthenticated DDL on
// production AND re-applied a permissive `FOR ALL USING (true)` policy on
// public.predictions. Both behaviors are unsafe and have been disabled.
//
// If you genuinely need to re-apply RLS policies, do it via a checked-in
// `supabase/migrations/` file run with `npx supabase db push`. Never leave
// a public DDL endpoint deployed.
//
// To fully remove from the deployment, run:
//   npx supabase functions delete fix-rls

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "OPTIONS",
};

serve((req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }
    return new Response(
        JSON.stringify({
            error: "This endpoint is permanently disabled.",
            reason: "Unauthenticated DDL execution; replaced by versioned SQL migrations.",
        }),
        {
            status: 410,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
    );
});
