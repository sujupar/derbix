// _shared/llm-client.ts — Multi-provider LLM abstraction with automatic fallback chain
// Primary: Groq (Llama 3.3 70B) — 6,000 TPM limit on free tier
// Fallback: Gemini Free → OpenRouter → Mistral

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

// ═══ GROQ RATE LIMIT TRACKER ═══
// Groq free tier: 6,000 tokens per minute (TPM)
// We track usage within a rolling 60s window to calculate smart delays
const GROQ_TPM_LIMIT = 6000;
const GROQ_WINDOW_MS = 60000;

interface TokenUsageEntry {
  timestamp: number;
  tokens: number;
}

const groqUsageLog: TokenUsageEntry[] = [];

function recordGroqUsage(tokens: number): void {
  groqUsageLog.push({ timestamp: Date.now(), tokens });
  // Prune entries older than the window
  const cutoff = Date.now() - GROQ_WINDOW_MS;
  while (groqUsageLog.length > 0 && groqUsageLog[0].timestamp < cutoff) {
    groqUsageLog.shift();
  }
}

function getGroqTokensUsedInWindow(): number {
  const cutoff = Date.now() - GROQ_WINDOW_MS;
  return groqUsageLog
    .filter(e => e.timestamp >= cutoff)
    .reduce((sum, e) => sum + e.tokens, 0);
}

/** Calculate how many seconds to wait before sending `estimatedTokens` to Groq */
export function calcGroqDelay(estimatedTokens: number): number {
  const usedInWindow = getGroqTokensUsedInWindow();
  const available = GROQ_TPM_LIMIT - usedInWindow;

  if (estimatedTokens <= available) return 0;

  // Need to wait for oldest entries to expire
  const cutoff = Date.now() - GROQ_WINDOW_MS;
  let tokensToFree = estimatedTokens - available;
  let waitUntil = 0;

  for (const entry of groqUsageLog) {
    if (entry.timestamp < cutoff) continue;
    tokensToFree -= entry.tokens;
    waitUntil = entry.timestamp + GROQ_WINDOW_MS;
    if (tokensToFree <= 0) break;
  }

  const delayMs = Math.max(0, waitUntil - Date.now());
  return Math.ceil(delayMs / 1000);
}

interface ProviderDef {
  name: string;
  type: 'openai' | 'gemini';
  endpoint: string;
  model: string;
  envKey: string;
}

const PROVIDERS: ProviderDef[] = [
  {
    name: 'groq',
    type: 'openai',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'llama-3.3-70b-versatile',
    envKey: 'GROQ_API_KEY',
  },
  {
    name: 'gemini',
    type: 'gemini',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
    model: 'gemini-2.0-flash',
    envKey: 'GEMINI_API_KEY',
  },
  {
    name: 'openrouter',
    type: 'openai',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    envKey: 'OPENROUTER_API_KEY',
  },
  {
    name: 'mistral',
    type: 'openai',
    endpoint: 'https://api.mistral.ai/v1/chat/completions',
    model: 'mistral-large-latest',
    envKey: 'MISTRAL_API_KEY',
  },
];

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const SKIP_PROVIDER_STATUS = new Set([401, 403]);

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
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs || 30000);

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
    temperature: config.temperature ?? 0.3,
    max_tokens: config.maxTokens ?? 4096,
  };

  if (config.jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };

  if (provider.name === 'openrouter') {
    headers['HTTP-Referer'] = 'https://derbix.com';
    headers['X-Title'] = 'Derbix Sports Intelligence';
  }

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

    return {
      text: choice?.message?.content || '',
      provider: provider.name,
      model: data.model || provider.model,
      tokensUsed: data.usage?.total_tokens,
      finishReason: choice?.finish_reason,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function callGeminiREST(
  provider: ProviderDef,
  apiKey: string,
  prompt: string,
  config: LLMConfig
): Promise<LLMResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs || 30000);

  const url = `${provider.endpoint}/${provider.model}:generateContent?key=${apiKey}`;

  const generationConfig: Record<string, unknown> = {
    temperature: config.temperature ?? 0.3,
    maxOutputTokens: config.maxTokens ?? 4096,
  };

  if (config.jsonMode) {
    generationConfig.responseMimeType = 'application/json';
  }

  const contents: Array<{ parts: Array<{ text: string }> }> = [];

  if (config.systemPrompt) {
    contents.push({ parts: [{ text: config.systemPrompt }] });
  }
  contents.push({ parts: [{ text: prompt }] });

  const body = {
    contents,
    generationConfig,
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const err = new Error(`[gemini] HTTP ${res.status}: ${errText.slice(0, 200)}`);
      (err as any).status = res.status;
      throw err;
    }

    const data = await res.json();
    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text || '';

    return {
      text,
      provider: 'gemini',
      model: provider.model,
      tokensUsed: data.usageMetadata?.totalTokenCount,
      finishReason: candidate?.finishReason,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function callLLM(
  prompt: string,
  config: LLMConfig = {}
): Promise<LLMResponse> {
  const disabledStr = Deno.env.get('DISABLED_PROVIDERS') || '';
  const disabled = new Set(disabledStr.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));

  let providers = PROVIDERS.filter((p) => !disabled.has(p.name));

  if (config.preferredProvider) {
    const preferred = config.preferredProvider.toLowerCase();
    const idx = providers.findIndex((p) => p.name === preferred);
    if (idx > 0) {
      const [p] = providers.splice(idx, 1);
      providers.unshift(p);
    }
  }

  const errors: string[] = [];

  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    const apiKey = Deno.env.get(provider.envKey);

    if (!apiKey) {
      errors.push(`[${provider.name}] No API key (${provider.envKey})`);
      continue;
    }

    try {
      console.log(`[llm-client] Trying ${provider.name} (${provider.model})...`);

      const result =
        provider.type === 'openai'
          ? await callOpenAICompatible(provider, apiKey, prompt, config)
          : await callGeminiREST(provider, apiKey, prompt, config);

      // Track Groq token usage for rate limiting
      if (provider.name === 'groq' && result.tokensUsed) {
        recordGroqUsage(result.tokensUsed);
      }

      console.log(
        `[llm-client] ✓ ${provider.name} responded (${result.tokensUsed || '?'} tokens, finish: ${result.finishReason || '?'})`
      );

      return result;
    } catch (err: any) {
      const status = err?.status;
      const isAbort = err?.name === 'AbortError';
      const reason = isAbort ? 'TIMEOUT' : `HTTP ${status || 'unknown'}`;

      console.warn(`[llm-client] ✗ ${provider.name} failed: ${reason} — ${err.message?.slice(0, 150)}`);
      errors.push(`[${provider.name}] ${reason}`);

      if (status && SKIP_PROVIDER_STATUS.has(status)) {
        continue;
      }

      if (i < providers.length - 1) {
        await delay(1000);
      }
    }
  }

  throw new Error(
    `[llm-client] All providers failed.\n${errors.join('\n')}`
  );
}
