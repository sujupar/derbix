// setup-tactical-tables — DEPRECATED & DEPLOYED-LOCKED
//
// One-shot migration that ran CREATE TABLE / ALTER TABLE / CREATE POLICY
// against production with no caller authentication. Locked down to prevent
// abuse. Move any future schema changes to versioned `supabase/migrations/`.
//
// To fully remove from the deployment, run:
//   npx supabase functions delete setup-tactical-tables

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
