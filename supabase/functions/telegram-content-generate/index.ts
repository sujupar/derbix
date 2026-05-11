// supabase/functions/telegram-content-generate/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const DEEPSEEK_API_KEY = Deno.env.get('DEEPSEEK_API_KEY')!;
const DEEPSEEK_MODEL = 'deepseek-v4-pro';
const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions';

interface RequestBody {
  category: string;
  context_data?: Record<string, any>;
}

async function callDeepSeek(systemPrompt: string, userPrompt: string): Promise<string> {
  const res = await fetch(DEEPSEEK_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7, // some variation between regenerations
      max_tokens: 600,
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`DeepSeek error ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body: RequestBody = await req.json();
    if (!body.category) {
      return new Response(JSON.stringify({ error: 'category required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: tpl, error: tplErr } = await supabase
      .from('telegram_content_templates')
      .select('system_prompt, display_name, use_count')
      .eq('category', body.category)
      .eq('is_active', true)
      .single();

    if (tplErr || !tpl) {
      return new Response(JSON.stringify({ error: 'category not found or inactive' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userPrompt = `Genera un mensaje variado y profesional. Contexto adicional: ${JSON.stringify(body.context_data || {})}.\n\nFecha: ${new Date().toLocaleDateString('es-CO', { timeZone: 'America/Bogota' })}.`;

    const text = await callDeepSeek(tpl.system_prompt, userPrompt);

    await supabase
      .from('telegram_content_templates')
      .update({ use_count: ((tpl as any).use_count || 0) + 1, last_used_at: new Date().toISOString() })
      .eq('category', body.category);

    return new Response(
      JSON.stringify({ text, generated_at: new Date().toISOString(), category: body.category }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[telegram-content-generate]', err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
