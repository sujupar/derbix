// supabase/functions/deepseek-ping/index.ts
// Diagnostic: pings DeepSeek with a tiny request, reports HTTP status + elapsed time.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const apiKey = Deno.env.get('DEEPSEEK_API_KEY');
  if (!apiKey) {
    return new Response(JSON.stringify({ ok: false, error: 'DEEPSEEK_API_KEY not set' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        messages: [{ role: 'user', content: 'Reply with JSON: {"ok":true}' }],
        max_tokens: 20,
        temperature: 0,
        response_format: { type: 'json_object' },
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const elapsed_ms = Date.now() - t0;
    const status = res.status;
    const text = await res.text();
    return new Response(JSON.stringify({
      ok: res.ok,
      http_status: status,
      elapsed_ms,
      body_preview: text.slice(0, 400),
      key_prefix: apiKey.slice(0, 8) + '...' + apiKey.slice(-4),
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    const elapsed_ms = Date.now() - t0;
    return new Response(JSON.stringify({
      ok: false,
      error: (err as Error).message,
      err_name: (err as any).name,
      elapsed_ms,
      key_prefix: apiKey.slice(0, 8) + '...' + apiKey.slice(-4),
    }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
