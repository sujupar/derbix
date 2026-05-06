// supabase/functions/v9-agent-runner/index.ts
// Runs ONE V9 debate agent and chains to the next on success or failure.
// Reads MatchContext from v9_debate_runs.context_json, executes its prompt,
// writes output to v9_agent_outputs, atomically increments the agent counter,
// and dispatches the next agent (or the judge if last).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { callLLM } from "../_shared/llm-client.ts";
import { AGENTS } from "../_shared/agents/configs.ts";
import { buildAgentPrompt, parseAgentResponse } from "../_shared/agents/orchestrator.ts";
import type { MatchContext, AgentAnalysis, AgentConfig } from "../_shared/agents/types.ts";

const VALID_AGENT_KEYS = ["OFFENSIVE", "DEFENSIVE", "TACTICAL", "CONTEXTUAL", "MARKET", "SKEPTIC"];
const AGENT_CHAIN = ["OFFENSIVE", "DEFENSIVE", "TACTICAL", "CONTEXTUAL", "MARKET", "SKEPTIC"];

function nextInChain(currentKey: string): string | null {
    const idx = AGENT_CHAIN.indexOf(currentKey);
    if (idx < 0 || idx >= AGENT_CHAIN.length - 1) return null;
    return AGENT_CHAIN[idx + 1];
}

/**
 * Dispatch the next stage in the chain.
 *
 * We AWAIT the fetch (with a short ack-timeout) so the request commits to
 * Supabase's routing layer before this worker exits. Pure fire-and-forget
 * (no await) gets cancelled when the worker tears down — that was the bug
 * causing the chain to stall after agent 1.
 *
 * Inter-agent delay: Groq's free-tier TPM (8K/min) gets exhausted when six
 * agents fire back-to-back (each ~1.5K tokens × 6 = 9K). We don't await this
 * delay (the parent worker is exiting); instead we use setTimeout in the
 * receiving function. So we just dispatch immediately and let the receiver
 * stagger itself.
 */
async function fireNextStage(sbUrl: string, sbKey: string, currentKey: string, runId: string): Promise<void> {
    const next = nextInChain(currentKey);
    const url = next
        ? `${sbUrl}/functions/v1/v9-agent-runner`
        : `${sbUrl}/functions/v1/v9-judge-runner`;
    // Pass `delay_ms` so the receiving runner sleeps before calling the LLM.
    // 35s gives Groq's TPM window enough headroom to refill before next call.
    const body = next
        ? { run_id: runId, agent_key: next, delay_ms: 35000 }
        : { run_id: runId };
    const target = next || "JUDGE";

    console.log(`[v9-agent-runner] CHAIN: firing ${target}`);

    // 5s ack-timeout: enough for routing to accept the request, not so long
    // that we eat into the parent's 150s budget.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);

    try {
        const r = await fetch(url, {
            method: "POST",
            headers: { Authorization: `Bearer ${sbKey}`, "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: ctrl.signal,
        });
        console.log(`[v9-agent-runner] CHAIN: ${target} dispatched (HTTP ${r.status})`);
    } catch (e: any) {
        if (e?.name === "AbortError") {
            // Request was sent but receiver hasn't responded in 5s — that's fine,
            // it's processing. The TCP handshake is already through.
            console.log(`[v9-agent-runner] CHAIN: ${target} dispatch sent (ack-timeout, fire-forward)`);
        } else {
            console.error(`[v9-agent-runner] CHAIN dispatch ${target} failed: ${e.message}`);
        }
    } finally {
        clearTimeout(timer);
    }
}

serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    const startTime = Date.now();
    const sbUrl = Deno.env.get("SUPABASE_URL")!;
    const sbKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(sbUrl, sbKey);

    let runId: string | null = null;
    let agentKey: string | null = null;

    try {
        const body = await req.json();
        runId = body.run_id;
        agentKey = body.agent_key;
        const delayMs = Math.max(0, Math.min(60000, body.delay_ms || 0));

        if (!runId || !agentKey) {
            throw new Error("run_id and agent_key are required");
        }
        if (!VALID_AGENT_KEYS.includes(agentKey)) {
            throw new Error(`Invalid agent_key: ${agentKey}`);
        }

        // Inter-agent stagger to let Groq's TPM (8K/min) refill between calls.
        // We mark 'running' AFTER the delay so the monitor's stuck-detection clock
        // starts from the actual LLM call, not from dispatch.
        if (delayMs > 0) {
            console.log(`[v9-agent-runner] ${agentKey}: staggering ${delayMs}ms before LLM call (Groq TPM headroom)...`);
            await new Promise((r) => setTimeout(r, delayMs));
        }

        // Mark this agent as running
        await supabase
            .from("v9_agent_outputs")
            .update({ status: "running", started_at: new Date().toISOString() })
            .eq("run_id", runId)
            .eq("agent_key", agentKey);

        // Fetch context from the debate run
        const { data: run, error: runErr } = await supabase
            .from("v9_debate_runs")
            .select("context_json, fixture_id, job_id")
            .eq("id", runId)
            .single();

        if (runErr || !run?.context_json) {
            throw new Error(`Cannot read context for run ${runId}: ${runErr?.message || "no data"}`);
        }

        const context: MatchContext = run.context_json;
        const cfg: AgentConfig = AGENTS[agentKey];
        const prompt = buildAgentPrompt(agentKey, context);

        console.log(`[v9-agent-runner] ${agentKey}: calling LLM (preferred=${cfg.preferred_provider}, max=${cfg.max_tokens})...`);

        // Total LLM budget across the provider cascade. The llm-client gives 80% to
        // the first attempt and leftover to fallbacks. We cap at 90s (down from 115s)
        // so the 150s Supabase wall clock has ~60s of headroom for DB writes, the
        // counter RPC, the chain dispatch, AND the catch-block on failure. Without
        // that headroom an in-flight LLM cascade can blow past the wall clock and
        // leave the agent_output stuck at 'running' (the catch never executes).
        const res = await callLLM(prompt, {
            temperature: cfg.temperature,
            maxTokens: cfg.max_tokens,
            jsonMode: true,
            timeoutMs: 90000,
            preferredProvider: cfg.preferred_provider,
            systemPrompt: cfg.system_prompt,
        });

        const parsed = parseAgentResponse(res.text, agentKey);
        const analysis: AgentAnalysis = {
            agent_name: cfg.name,
            agent_role: cfg.role,
            key_findings: parsed.key_findings || [],
            recommended_picks: parsed.recommended_picks || [],
            confidence_overall: parsed.confidence_overall ?? 50,
            key_risks: parsed.key_risks || [],
            devil_arguments: parsed.devil_arguments,
            provider_used: res.provider,
            tokens_used: res.tokensUsed,
        };

        const elapsedMs = Date.now() - startTime;
        console.log(`[v9-agent-runner] ${agentKey} OK in ${elapsedMs}ms via ${res.provider} (${res.tokensUsed} tokens, ${analysis.recommended_picks.length} picks)`);

        // Save output
        await supabase
            .from("v9_agent_outputs")
            .update({
                status: "done",
                output_json: analysis,
                provider_used: res.provider,
                tokens_used: res.tokensUsed,
                completed_at: new Date().toISOString(),
            })
            .eq("run_id", runId)
            .eq("agent_key", agentKey);

        // Atomic counter increment. We inspect the response explicitly because
        // supabase-js returns errors in the result object (does not throw).
        const counterRes = await supabase
            .rpc("v9_increment_agent_counter", { p_run_id: runId, p_failed: false });
        if (counterRes.error) {
            console.error(`[v9-agent-runner] counter RPC error: ${counterRes.error.message}`);
        } else {
            console.log(`[v9-agent-runner] counter bumped: ${JSON.stringify(counterRes.data)}`);
        }

        // SERIAL CHAIN: fire next agent (or judge if this was the last). Awaited
        // with a 5s ack-timeout so the request commits before this worker exits.
        await fireNextStage(sbUrl, sbKey, agentKey, runId);

        return new Response(JSON.stringify({ success: true, agent: agentKey, elapsed_ms: elapsedMs, picks: analysis.recommended_picks.length }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    } catch (err: any) {
        console.error(`[v9-agent-runner] ${agentKey || "?"} FAILED: ${err.message}`);

        if (runId && agentKey) {
            await supabase
                .from("v9_agent_outputs")
                .update({
                    status: "failed",
                    error_message: err.message?.substring(0, 500),
                    completed_at: new Date().toISOString(),
                })
                .eq("run_id", runId)
                .eq("agent_key", agentKey)
                .catch(() => {});

            // Increment counter as a "failed" agent (explicit error inspection)
            const counterRes = await supabase
                .rpc("v9_increment_agent_counter", { p_run_id: runId, p_failed: true });
            if (counterRes.error) {
                console.error(`[v9-agent-runner] counter RPC error (fail path): ${counterRes.error.message}`);
            }

            // SERIAL CHAIN: even on failure, continue the chain so it doesn't stall.
            await fireNextStage(sbUrl, sbKey, agentKey, runId);
        }

        return new Response(JSON.stringify({ success: false, error: err.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
