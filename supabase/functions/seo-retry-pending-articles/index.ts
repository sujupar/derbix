import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const MAX_ATTEMPTS = 3;
const BATCH_SIZE = 5;
const BACKOFF_MINUTES = [5, 15, 60]; // 1st, 2nd, 3rd retry delay

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data: pending, error } = await supabase
    .from("seo_pages")
    .select("fixture_id, article_status, article_attempts, article_next_retry_at")
    .in("article_status", ["pending", "failed"])
    .lt("article_attempts", MAX_ATTEMPTS)
    .or(`article_next_retry_at.is.null,article_next_retry_at.lte.${new Date().toISOString()}`)
    .order("article_next_retry_at", { ascending: true, nullsFirst: true })
    .limit(BATCH_SIZE);

  if (error) {
    console.error(`[SEO-RETRY] query error: ${error.message}`);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: corsHeaders }
    );
  }

  if (!pending || pending.length === 0) {
    return new Response(
      JSON.stringify({ processed: 0, message: "no pending articles" }),
      { headers: corsHeaders }
    );
  }

  console.log(`[SEO-RETRY] processing ${pending.length} pending articles`);

  const results: Array<{ fixture_id: number; success: boolean; error?: string }> = [];

  for (const row of pending) {
    const attemptNum = (row.article_attempts ?? 0) + 1;

    await supabase
      .from("seo_pages")
      .update({ article_status: "generating", article_attempts: attemptNum })
      .eq("fixture_id", row.fixture_id);

    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/seo-generate-article`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({ fixture_id: row.fixture_id }),
      });

      if (res.ok) {
        await supabase
          .from("seo_pages")
          .update({
            article_status: "ready",
            article_last_error: null,
            article_next_retry_at: null,
          })
          .eq("fixture_id", row.fixture_id);
        results.push({ fixture_id: row.fixture_id, success: true });
      } else {
        const errText = (await res.text().catch(() => `HTTP ${res.status}`)).slice(0, 500);
        const nextMinutes = BACKOFF_MINUTES[Math.min(attemptNum - 1, BACKOFF_MINUTES.length - 1)];
        const nextRetry = attemptNum >= MAX_ATTEMPTS
          ? null
          : new Date(Date.now() + nextMinutes * 60_000).toISOString();

        await supabase
          .from("seo_pages")
          .update({
            article_status: "failed",
            article_last_error: errText,
            article_next_retry_at: nextRetry,
          })
          .eq("fixture_id", row.fixture_id);

        results.push({ fixture_id: row.fixture_id, success: false, error: errText });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const nextMinutes = BACKOFF_MINUTES[Math.min(attemptNum - 1, BACKOFF_MINUTES.length - 1)];
      const nextRetry = attemptNum >= MAX_ATTEMPTS
        ? null
        : new Date(Date.now() + nextMinutes * 60_000).toISOString();

      await supabase
        .from("seo_pages")
        .update({
          article_status: "failed",
          article_last_error: msg.slice(0, 500),
          article_next_retry_at: nextRetry,
        })
        .eq("fixture_id", row.fixture_id);

      results.push({ fixture_id: row.fixture_id, success: false, error: msg });
    }

    // Space out calls to respect Groq free tier (2s between each).
    await new Promise((r) => setTimeout(r, 2000));
  }

  return new Response(
    JSON.stringify({ processed: pending.length, results }),
    { headers: corsHeaders }
  );
});
