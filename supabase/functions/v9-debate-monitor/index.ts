// supabase/functions/v9-debate-monitor/index.ts
// Failsafe for the V9 chain. Scheduled every 2 minutes via pg_cron.
//
// Recovers stuck runs in two scenarios:
//   1. agents_done state but judge never fired (last-agent dispatch lost)
//      → re-fire v9-judge-runner
//   2. agents_running for >7 minutes (some runners crashed silently)
//      → bump agents_completed counter for stuck pending agents and fire judge
//      → marks individual agent_outputs as 'failed' with timeout reason

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

// In SERIAL CHAIN mode each agent has a 90s LLM budget + ~30s for chain dispatch + DB
// writes. Total max per agent ≈ 130s, capped at the 150s Supabase wall clock. We treat
// a chain as stuck if the currently-running agent has not progressed in >3 min (the
// worker must have died before the catch block could mark it failed).
const STUCK_AGENTS_THRESHOLD_MIN = 3;
const AGENT_CHAIN = ["OFFENSIVE", "DEFENSIVE", "TACTICAL", "CONTEXTUAL", "MARKET", "SKEPTIC"];

function nextInChain(currentKey: string): string | null {
    const idx = AGENT_CHAIN.indexOf(currentKey);
    if (idx < 0 || idx >= AGENT_CHAIN.length - 1) return null;
    return AGENT_CHAIN[idx + 1];
}

serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    const sbUrl = Deno.env.get("SUPABASE_URL")!;
    const sbKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(sbUrl, sbKey);

    const stats = { rescued_judge: 0, timed_out_agents: 0, errors: [] as string[] };

    try {
        // Pool 1: agents_done but judge never completed
        const { data: judgePending } = await supabase
            .from("v9_debate_runs")
            .select("id, job_id, agents_completed, agents_total")
            .eq("status", "agents_done")
            .eq("judge_completed", false)
            .lt("updated_at", new Date(Date.now() - 60 * 1000).toISOString())
            .limit(20);

        for (const run of judgePending || []) {
            console.log(`[v9-debate-monitor] re-firing judge for run ${run.id}`);
            fetch(`${sbUrl}/functions/v1/v9-judge-runner`, {
                method: "POST",
                headers: { "Authorization": `Bearer ${sbKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({ run_id: run.id }),
            }).catch((e) => stats.errors.push(`judge-refire ${run.id}: ${e.message}`));
            stats.rescued_judge++;
        }

        // Pool 2: serial chain stuck — find AGENTS still 'running' whose started_at is
        // older than the threshold. We query agent_outputs directly (not run.updated_at)
        // because run.updated_at is bumped on each successful agent completion, which
        // would mask a later agent that died silently after earlier agents succeeded.
        const stuckCutoff = new Date(Date.now() - STUCK_AGENTS_THRESHOLD_MIN * 60 * 1000).toISOString();
        const { data: stuckAgentRows } = await supabase
            .from("v9_agent_outputs")
            .select("run_id, agent_key, started_at")
            .eq("status", "running")
            .lt("started_at", stuckCutoff)
            .limit(40);

        // Group by run_id; one stuck-recovery per run per cycle.
        const stuckByRun = new Map<string, { agent_key: string; started_at: string }>();
        for (const a of stuckAgentRows || []) {
            if (!stuckByRun.has(a.run_id)) {
                stuckByRun.set(a.run_id, { agent_key: a.agent_key, started_at: a.started_at });
            }
        }

        for (const [runIdStuck, stuckAgent] of stuckByRun) {
            // Verify the run is still active (not failed / completed by something else)
            const { data: runRow } = await supabase
                .from("v9_debate_runs")
                .select("id, status")
                .eq("id", runIdStuck)
                .single();
            if (!runRow || !["agents_running", "initialized"].includes(runRow.status)) continue;

            const run = { id: runIdStuck, job_id: "", status: runRow.status };
            await supabase
                .from("v9_agent_outputs")
                .update({
                    status: "failed",
                    error_message: `monitor: chain stuck — agent did not finish in ${STUCK_AGENTS_THRESHOLD_MIN}min`,
                    completed_at: new Date().toISOString(),
                })
                .eq("run_id", run.id)
                .eq("agent_key", stuckAgent.agent_key);

            // Increment failed counter (PostgREST errors live in result.error, not throws)
            const cRes = await supabase
                .rpc("v9_increment_agent_counter", { p_run_id: run.id, p_failed: true });
            if (cRes.error) {
                console.error(`[v9-debate-monitor] counter RPC error: ${cRes.error.message}`);
            }

            // Resume the chain: fire next agent (or judge if this was the last)
            const next = nextInChain(stuckAgent.agent_key);
            const nextUrl = next
                ? `${sbUrl}/functions/v1/v9-agent-runner`
                : `${sbUrl}/functions/v1/v9-judge-runner`;
            const nextBody = next
                ? { run_id: run.id, agent_key: next }
                : { run_id: run.id };
            console.log(`[v9-debate-monitor] run=${run.id} stuck on ${stuckAgent.agent_key} → resuming chain with ${next || "JUDGE"}`);
            fetch(nextUrl, {
                method: "POST",
                headers: { "Authorization": `Bearer ${sbKey}`, "Content-Type": "application/json" },
                body: JSON.stringify(nextBody),
            }).catch((e) => stats.errors.push(`stuck-recover ${run.id}: ${e.message}`));

            stats.timed_out_agents++;
            stats.rescued_judge++;
        }

        return new Response(JSON.stringify({ success: true, ...stats }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    } catch (err: any) {
        console.error(`[v9-debate-monitor] FATAL: ${err.message}`);
        return new Response(JSON.stringify({ success: false, error: err.message, ...stats }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
