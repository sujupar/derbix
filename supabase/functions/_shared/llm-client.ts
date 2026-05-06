// _shared/llm-client.ts — DeepSeek-only client with retry on retryable failures.
// V9 pipeline (2026-05-05): no fallback to Gemini/Groq/OpenRouter/Mistral.
// If DeepSeek fails permanently, the caller's job fails and goes to retry queue.

export interface LLMConfig {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  timeoutMs?: number;
  preferredProvider?: string;
  systemPrompt?: string;
}

export interface LLMResponse {
  text: string;
  provider: string;
  model: string;
  tokensUsed?: number;
  finishReason?: string;
}

interface ProviderDef {
  name: string;
  type: 'openai';
  endpoint: string;
  model: string;
  envKey: string;
}

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

    return {
      text,
      provider: provider.name,
      model: data.model || provider.model,
      tokensUsed: data.usage?.total_tokens,
      finishReason: choice?.finish_reason,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function callLLM(prompt: string, config: LLMConfig = {}): Promise<LLMResponse> {
  const provider = PROVIDERS[0]; // deepseek-v4-flash only
  const apiKey = Deno.env.get(provider.envKey);
  if (!apiKey) {
    throw new Error(`[llm-client] DEEPSEEK_API_KEY missing — pipeline cannot proceed without it`);
  }

  const backoffMs = [0, 2000, 4000, 8000];
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < backoffMs.length; attempt++) {
    if (backoffMs[attempt] > 0) {
      console.log(`[llm-client] retry ${attempt} after ${backoffMs[attempt]}ms`);
      await delay(backoffMs[attempt]);
    }
    try {
      const result = await callOpenAICompatible(provider, apiKey, prompt, config);
      if (attempt > 0) console.log(`[llm-client] ✓ succeeded on retry ${attempt}`);
      return result;
    } catch (err) {
      lastError = err as Error;
      const status = (err as any).status;
      const isAbort = (err as any).name === 'AbortError';

      if (status && SKIP_PROVIDER_STATUS.has(status)) {
        // 401/402/403 — permanent (bad key, no balance, forbidden). No retry.
        console.error(`[llm-client] permanent failure status=${status}: ${(err as Error).message}`);
        throw err;
      }

      if (status && !RETRYABLE_STATUS.has(status) && !isAbort) {
        // Non-retryable error (e.g. 400 bad request) — surface immediately
        console.error(`[llm-client] non-retryable error status=${status}: ${(err as Error).message}`);
        throw err;
      }

      console.warn(`[llm-client] attempt ${attempt + 1}/${backoffMs.length} failed: ${(err as Error).message.slice(0, 150)}`);
    }
  }
  throw lastError ?? new Error('[llm-client] DeepSeek failed all retries');
}

/**
 * @deprecated Removed with V9 pipeline. Always returns 0. Will be deleted once
 * orchestrator.ts and v3-ai-analyzer/index.ts are refactored to use runPipeline().
 */
export function calcGroqDelay(_estimatedTokens: number): number {
  return 0;
}

