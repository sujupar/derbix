import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders } from '../_shared/cors.ts'
import { callLLM } from '../_shared/llm-client.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { prediction, market, result_context } = await req.json();

    if (!prediction || !market || !result_context) {
      return new Response(
        JSON.stringify({ error: 'prediction, market, and result_context are required' }),
        { status: 400, headers: corsHeaders }
      );
    }

    const prompt = `You are an impartial sports betting judge. Determine if this bet was WON or LOST based on the match result.

BET:
- Market: ${market}
- Prediction: ${prediction}

MATCH RESULT:
${result_context}

Answer ONLY with one word: WON, LOST, VOID, or PENDING.`;

    const result = await callLLM(prompt, {
      temperature: 0,
      maxTokens: 10,
      timeoutMs: 10000,
    });

    const verdict = result.text.trim().toUpperCase();
    console.log(`[verify-parlay-leg] ${result.provider}: "${verdict}" for ${market}`);

    return new Response(
      JSON.stringify({ verdict, provider: result.provider }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('[verify-parlay-leg] Error:', err.message);
    return new Response(
      JSON.stringify({ verdict: 'PENDING', error: err.message }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
