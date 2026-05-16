// _shared/llm-client.ts — DeepSeek-only (no fallbacks).
// V9 pipeline (2026-05-05): originally no fallback.
// 2026-05-11: migrated from deepseek-v4-flash to deepseek-v4-pro.
// 2026-05-15 evening: direct API tests showed deepseek-v4-pro AND v4-flash both
//   respond in <1s with valid JSON. The >145s production timeouts were caused
//   by something inside the V9 pipeline (likely callWithSchemaRetry doubling
//   the LLM time on schema-validation retries with the larger v4-pro outputs).
//   Reverted to deepseek-v4-flash (the model running fine before 2026-05-11).
//   No fallbacks — single provider per user requirement.

export interface LLMConfig {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  timeoutMs?: number;
  preferredProvider?: string;
  systemPrompt?: string;
  // Provenance for llm_usage_log — caller should pass these so cost/latency
  // can be attributed to the right stage and analysis run.
  stage?: string;        // 'mega', 'verify-leg', 'seo-article', etc.
  job_id?: string;
  fixture_id?: number;
}

export interface LLMResponse {
  text: string;
  provider: string;
  model: string;
  tokensUsed?: number;
  finishReason?: string;
  promptTokens?: number;
  completionTokens?: number;
  reasoningTokens?: number;
  elapsedMs?: number;
}

// Approximate per-million-token prices in USD. Update when providers change pricing.
// These exist for cost ESTIMATION (llm_usage_log.cost_usd), not billing.
const PROVIDER_PRICING: Record<string, { input: number; output: number }> = {
  'deepseek-v4-flash': { input: 0.27, output: 1.10 },
  'deepseek-v4-pro':   { input: 0.27, output: 1.10 },
  'deepseek-chat':     { input: 0.27, output: 1.10 },
  'perplexity-sonar':  { input: 1.00, output: 1.00 },
  'gemini-2.5-flash':  { input: 0.10, output: 0.40 },
};
function estimateCostUsd(provider: string, promptTokens?: number, completionTokens?: number): number | null {
  const p = PROVIDER_PRICING[provider];
  if (!p || promptTokens == null || completionTokens == null) return null;
  return Number(((promptTokens / 1_000_000) * p.input + (completionTokens / 1_000_000) * p.output).toFixed(6));
}

// Best-effort insert into llm_usage_log. Failures are swallowed silently —
// the table may not exist yet (migration pending) and we never want logging
// failure to break an analysis. Service role is required to bypass RLS.
async function logUsage(row: Record<string, unknown>): Promise<void> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceKey) return;
    await fetch(`${supabaseUrl}/rest/v1/llm_usage_log`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(row),
    });
  } catch {
    // intentionally swallowed
  }
}

interface ProviderDef {
  name: string;
  type: 'openai';
  endpoint: string;
  model: string;
  envKey: string;
}

// Single provider — no fallbacks. v4-flash is the ONLY model that fits in
// the Supabase Edge 150s wall-clock budget for the MEGA pipeline.
//
// 2026-05-15 EMPIRICAL EVIDENCE (logged in llm_usage_log):
//   - deepseek-v4-flash: 47.4s elapsed, 8806 tokens, SUCCESS
//   - deepseek-v4-pro:   >130s elapsed (timed out twice — 110s and 130s)
//
// v4-pro is the better-reasoning model but its reasoning-tokens output
// consistently exceeds the wall-clock budget. To use v4-pro the worker
// would need to run outside Edge (VPS / Cloud Run / Lambda with longer
// wall-clock). For now v4-flash is the production model.
const PROVIDERS: ProviderDef[] = [
  {
    name: 'deepseek-v4-flash',
    type: 'openai',
    endpoint: 'https://api.deepseek.com/chat/completions',
    model: 'deepseek-v4-flash',
    envKey: 'DEEPSEEK_API_KEY',
  },
];

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const SKIP_PROVIDER_STATUS = new Set([401, 402, 403]);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callOpenAICompatible(
  provider: ProviderDef,
  apiKey: string,
  prompt: string,
  config: LLMConfig
): Promise<LLMResponse> {
  const startTime = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs || 60000);

  const messages: Array<{ role: string; content: string }> = [];

  if (config.systemPrompt) {
    messages.push({ role: 'system', content: config.systemPrompt });
  } else if (config.jsonMode) {
    messages.push({ role: 'system', content: 'Respond in valid JSON format.' });
  }

  messages.push({ role: 'user', content: prompt });

  const body: Record<string, unknown> = {
    model: provider.model,
    messages,
    temperature: config.temperature ?? 0,
    max_tokens: config.maxTokens ?? 4096,
  };

  if (config.jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  // reasoning_effort only applies to reasoning-capable models. deepseek-chat
  // (the public non-reasoning model) doesn't support this param and may error
  // if sent. Only set it on the legacy/reasoning model names.
  if (provider.name.includes('reasoner') || provider.name.includes('-v4-')) {
    body.reasoning_effort = 'low';
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };

  try {
    const res = await fetch(provider.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const err = new Error(`[${provider.name}] HTTP ${res.status}: ${errText.slice(0, 200)}`);
      (err as any).status = res.status;
      // Log failure too so we can track which providers/models fail and how often
      await logUsage({
        stage: config.stage || 'unknown',
        job_id: config.job_id || null,
        fixture_id: config.fixture_id || null,
        provider: provider.name,
        model: provider.model,
        elapsed_ms: Date.now() - startTime,
        success: false,
        error_message: `HTTP ${res.status}: ${errText.slice(0, 150)}`,
      });
      throw err;
    }

    const data = await res.json();
    const choice = data.choices?.[0];
    let text = choice?.message?.content || '';

    if (text.includes('<think>')) {
      text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    }

    // DeepSeek-V4-Flash is a reasoning model: when finish_reason='length' the actual JSON
    // may be split between content (empty) and reasoning_content (full thinking). Extract
    // the first JSON object from reasoning_content as best-effort recovery.
    if (!text || text.trim().length === 0) {
      const reasoning = choice?.message?.reasoning_content || '';
      if (reasoning) {
        // Look for the first complete JSON object inside the reasoning trace
        const jsonMatch = reasoning.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          text = jsonMatch[0];
        }
      }
    }

    const promptTokens = data.usage?.prompt_tokens;
    const completionTokens = data.usage?.completion_tokens;
    const reasoningTokens = data.usage?.completion_tokens_details?.reasoning_tokens;
    const elapsedMs = Date.now() - startTime;

    // Awaited usage log — fire-and-forget would be killed by Deno when the
    // Edge handler returns. Costs ~50-100ms extra per call but guarantees data.
    await logUsage({
      stage: config.stage || 'unknown',
      job_id: config.job_id || null,
      fixture_id: config.fixture_id || null,
      provider: provider.name,
      model: data.model || provider.model,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      reasoning_tokens: reasoningTokens,
      total_tokens: data.usage?.total_tokens,
      elapsed_ms: elapsedMs,
      cost_usd: estimateCostUsd(provider.name, promptTokens, completionTokens),
      finish_reason: choice?.finish_reason,
      success: true,
    });

    return {
      text,
      provider: provider.name,
      model: data.model || provider.model,
      tokensUsed: data.usage?.total_tokens,
      finishReason: choice?.finish_reason,
      promptTokens,
      completionTokens,
      reasoningTokens,
      elapsedMs,
    };
  } catch (err) {
    // Catch AbortError (timeout) and network errors — log as failure
    const isAbort = (err as Error).name === 'AbortError';
    await logUsage({
      stage: config.stage || 'unknown',
      job_id: config.job_id || null,
      fixture_id: config.fixture_id || null,
      provider: provider.name,
      model: provider.model,
      elapsed_ms: Date.now() - startTime,
      success: false,
      error_message: isAbort ? `TIMEOUT after ${config.timeoutMs || 60000}ms` : (err as Error).message.slice(0, 200),
    });
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function tryProvider(
  provider: ProviderDef,
  prompt: string,
  config: LLMConfig,
): Promise<LLMResponse> {
  const apiKey = Deno.env.get(provider.envKey);
  if (!apiKey) {
    throw new Error(`[llm-client] ${provider.envKey} missing — cannot call ${provider.name}`);
  }

  // Per-provider policy:
  //   - On AbortError (timeout): fail fast — don't retry, let the outer loop
  //     switch providers immediately. Retrying a slow provider eats the wall
  //     clock budget that the fallback would need.
  //   - On 429/5xx: short backoff retry (up to 2 attempts) — transient.
  //   - On 4xx (other): surface immediately.
  const backoffMs = [0, 1500];
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < backoffMs.length; attempt++) {
    if (backoffMs[attempt] > 0) {
      console.log(`[llm-client] ${provider.name} retry ${attempt} after ${backoffMs[attempt]}ms`);
      await delay(backoffMs[attempt]);
    }
    try {
      const result = await callOpenAICompatible(provider, apiKey, prompt, config);
      if (attempt > 0) console.log(`[llm-client] ${provider.name} ✓ succeeded on retry ${attempt}`);
      return result;
    } catch (err) {
      lastError = err as Error;
      const status = (err as any).status;
      const isAbort = (err as any).name === 'AbortError';

      if (status && SKIP_PROVIDER_STATUS.has(status)) {
        console.error(`[llm-client] ${provider.name} permanent failure status=${status}: ${(err as Error).message}`);
        throw err;
      }

      if (isAbort) {
        // Timeout: don't retry inside this provider. Bubble to outer loop so
        // fallback gets a shot at the remaining wall clock budget.
        console.warn(`[llm-client] ${provider.name} timed out — bailing to outer fallback`);
        throw err;
      }

      if (status && !RETRYABLE_STATUS.has(status)) {
        console.error(`[llm-client] ${provider.name} non-retryable status=${status}: ${(err as Error).message}`);
        throw err;
      }

      console.warn(`[llm-client] ${provider.name} attempt ${attempt + 1}/${backoffMs.length} failed: ${(err as Error).message.slice(0, 150)}`);
    }
  }
  throw lastError ?? new Error(`[llm-client] ${provider.name} failed all retries`);
}

export async function callLLM(prompt: string, config: LLMConfig = {}): Promise<LLMResponse> {
  let lastError: Error | null = null;

  for (let i = 0; i < PROVIDERS.length; i++) {
    const provider = PROVIDERS[i];
    const isFallback = i > 0;
    try {
      if (isFallback) console.log(`[llm-client] primary failed, trying fallback ${provider.name}`);
      const result = await tryProvider(provider, prompt, config);
      if (isFallback) console.log(`[llm-client] ✓ fallback ${provider.name} succeeded`);
      return result;
    } catch (err) {
      lastError = err as Error;
      const status = (err as any).status;
      // Don't try fallback for clearly-permanent errors (bad request, auth).
      // Retryable failures and timeouts will fall through to the next provider.
      if (status && SKIP_PROVIDER_STATUS.has(status)) {
        // 401/402/403 on primary — try fallback (could be missing/expired key only on primary).
        console.warn(`[llm-client] ${provider.name} auth failure (${status}) — will try fallback if available`);
        continue;
      }
      if (status === 400 && !isFallback) {
        // 400 from primary likely means the prompt is malformed for that model.
        // Fallback may interpret it. Don't bail.
        console.warn(`[llm-client] ${provider.name} 400 bad request — trying fallback before giving up`);
        continue;
      }
      // Other errors (5xx, timeout, network) — try next provider
      console.warn(`[llm-client] ${provider.name} exhausted: ${(err as Error).message.slice(0, 150)}`);
    }
  }
  throw lastError ?? new Error('[llm-client] all providers failed');
}

/**
 * @deprecated Removed with V9 pipeline. Always returns 0. Will be deleted once
 * orchestrator.ts and v3-ai-analyzer/index.ts are refactored to use runPipeline().
 */
export function calcGroqDelay(_estimatedTokens: number): number {
  return 0;
}

// Deploy marker: 2026-05-15-1440 perplexity-primary
