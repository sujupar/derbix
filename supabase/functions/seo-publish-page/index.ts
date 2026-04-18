import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  slugifyTeam,
  slugifyLeague,
  buildMatchSlug,
  buildFullPath,
  buildMetaTitle,
  buildMetaDescription,
} from "../_shared/seo-slugs.ts";

const SITE_URL = "https://derbix.co";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { fixture_id, job_id } = await req.json();

    if (!fixture_id) {
      return new Response(
        JSON.stringify({ error: "fixture_id required" }),
        { status: 400, headers: corsHeaders }
      );
    }

    console.log(`[SEO-PUBLISH-PAGE] Publishing page for fixture ${fixture_id} (job: ${job_id})`);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 0. Verify report exists before creating SEO page
    const { data: reportCheck } = await supabase
      .from("reports_v2")
      .select("id")
      .eq("fixture_id", fixture_id)
      .limit(1)
      .single();

    if (!reportCheck) {
      console.warn(`[SEO-PUBLISH-PAGE] No report for fixture ${fixture_id}, skipping page creation`);
      return new Response(
        JSON.stringify({ success: false, reason: "No report data available" }),
        { status: 200, headers: corsHeaders }
      );
    }

    // 1. Get match data from daily_matches
    const { data: match, error: matchErr } = await supabase
      .from("daily_matches")
      .select("*")
      .eq("api_fixture_id", fixture_id)
      .order("match_date", { ascending: false })
      .limit(1)
      .single();

    if (matchErr || !match) {
      console.error(`[SEO-PUBLISH-PAGE] Match not found for fixture ${fixture_id}:`, matchErr);
      return new Response(
        JSON.stringify({ error: "Match not found", fixture_id }),
        { status: 404, headers: corsHeaders }
      );
    }

    // 2. Get league slug from allowed_leagues
    let leagueSlug: string | null = null;
    if (match.league_id) {
      const { data: league } = await supabase
        .from("allowed_leagues")
        .select("slug, name")
        .eq("api_league_id", match.league_id)
        .single();

      if (league?.slug) {
        leagueSlug = league.slug;
      }
    }

    // Fallback: generate slug from league_name
    if (!leagueSlug && match.league_name) {
      leagueSlug = slugifyLeague(match.league_name);
    }

    // Last resort fallback
    if (!leagueSlug) {
      leagueSlug = "otro";
    }

    // 3. Generate slugs and paths
    const homeTeam = match.home_team || "Local";
    const awayTeam = match.away_team || "Visitante";
    const matchDate = match.match_date; // YYYY-MM-DD
    const homeTeamSlug = slugifyTeam(homeTeam);
    const awayTeamSlug = slugifyTeam(awayTeam);
    const matchSlug = buildMatchSlug(homeTeam, awayTeam, matchDate);
    const fullPath = buildFullPath(leagueSlug, matchSlug);
    const metaTitle = buildMetaTitle(homeTeam, awayTeam, match.league_name || "Fútbol", matchDate);
    const metaDescription = buildMetaDescription(homeTeam, awayTeam, match.league_name || "Fútbol");

    console.log(`[SEO-PUBLISH-PAGE] Path: ${fullPath}`);

    // 4a. Check if the page already exists — preserve article_status if already 'ready'
    const { data: existingPage } = await supabase
      .from("seo_pages")
      .select("article_status, article_html, article_attempts")
      .eq("full_path", fullPath)
      .maybeSingle();

    const shouldInitArticleState =
      !existingPage || (existingPage.article_status == null && existingPage.article_html == null);

    const upsertPayload: Record<string, unknown> = {
      fixture_id,
      league_slug: leagueSlug,
      match_slug: matchSlug,
      home_team_slug: homeTeamSlug,
      away_team_slug: awayTeamSlug,
      full_path: fullPath,
      home_team: homeTeam,
      away_team: awayTeam,
      league_name: match.league_name || "Fútbol",
      match_date: matchDate,
      match_time: match.match_time || null,
      home_logo: match.home_team_logo || null,
      away_logo: match.away_team_logo || null,
      meta_title: metaTitle,
      meta_description: metaDescription,
      has_analysis: true,
      published_at: new Date().toISOString(),
    };

    if (shouldInitArticleState) {
      upsertPayload.article_status = "pending";
      upsertPayload.article_attempts = 0;
    }

    // 4b. Upsert into seo_pages
    const { error: upsertErr } = await supabase
      .from("seo_pages")
      .upsert(upsertPayload, { onConflict: "full_path" });

    if (upsertErr) {
      console.error(`[SEO-PUBLISH-PAGE] Upsert failed:`, upsertErr);
      return new Response(
        JSON.stringify({ error: "Failed to publish SEO page", details: upsertErr.message }),
        { status: 500, headers: corsHeaders }
      );
    }

    // 5. Generate editorial article (state-tracked, non-critical)
    const attemptNum = (existingPage?.article_attempts ?? 0) + 1;
    await supabase
      .from("seo_pages")
      .update({ article_status: "generating", article_attempts: attemptNum })
      .eq("fixture_id", fixture_id);

    try {
      const articleUrl = `${supabaseUrl}/functions/v1/seo-generate-article`;
      const articleRes = await fetch(articleUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({ fixture_id }),
      });

      if (articleRes.ok) {
        const artData = await articleRes.json();
        console.log(`[SEO-PUBLISH-PAGE] Article generated (${artData.article_length} chars)`);
        await supabase
          .from("seo_pages")
          .update({ article_status: "ready", article_last_error: null, article_next_retry_at: null })
          .eq("fixture_id", fixture_id);
      } else {
        const errText = (await articleRes.text().catch(() => `HTTP ${articleRes.status}`)).slice(0, 500);
        console.warn(`[SEO-PUBLISH-PAGE] Article generation failed: ${articleRes.status}`);
        await supabase
          .from("seo_pages")
          .update({
            article_status: "failed",
            article_last_error: errText,
            article_next_retry_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          })
          .eq("fixture_id", fixture_id);
      }
    } catch (artErr) {
      const msg = artErr instanceof Error ? artErr.message : String(artErr);
      console.warn("[SEO-PUBLISH-PAGE] Article generation failed (non-critical):", msg);
      await supabase
        .from("seo_pages")
        .update({
          article_status: "failed",
          article_last_error: msg.slice(0, 500),
          article_next_retry_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        })
        .eq("fixture_id", fixture_id);
    }

    // 6. Ping Google Indexing API (non-blocking, best-effort)
    const pageUrl = `${SITE_URL}${fullPath}`;
    try {
      await pingGoogleIndexingApi(pageUrl);
      console.log(`[SEO-PUBLISH-PAGE] Google Indexing API pinged for ${pageUrl}`);
    } catch (indexErr) {
      // Non-critical — log and continue
      console.warn(`[SEO-PUBLISH-PAGE] Google Indexing API failed (non-critical):`, indexErr);
    }

    // 6. Ping sitemap (non-blocking)
    try {
      await fetch(`https://www.google.com/ping?sitemap=${SITE_URL}/sitemap.xml`);
    } catch (_) {
      // Ignore
    }

    console.log(`[SEO-PUBLISH-PAGE] ✅ Published: ${fullPath}`);

    return new Response(
      JSON.stringify({
        success: true,
        full_path: fullPath,
        url: pageUrl,
      }),
      { headers: corsHeaders }
    );
  } catch (e: any) {
    console.error("[SEO-PUBLISH-PAGE] Error:", e);
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: corsHeaders }
    );
  }
});

// ─── Google Indexing API ───

async function pingGoogleIndexingApi(url: string): Promise<void> {
  const serviceAccountJson = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_KEY");
  if (!serviceAccountJson) {
    console.warn("[SEO-PUBLISH-PAGE] GOOGLE_SERVICE_ACCOUNT_KEY not set, skipping Indexing API");
    return;
  }

  const sa = JSON.parse(serviceAccountJson);

  // Create JWT for Google API authentication
  const jwt = await createGoogleJwt(sa);

  const response = await fetch(
    "https://indexing.googleapis.com/v3/urlNotifications:publish",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url, type: "URL_UPDATED" }),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Indexing API ${response.status}: ${body}`);
  }
}

async function createGoogleJwt(serviceAccount: {
  client_email: string;
  private_key: string;
}): Promise<string> {
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/indexing",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  // Import the private key and sign
  const pemKey = serviceAccount.private_key;
  const binaryKey = pemToBinary(pemKey);
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  const encodedSignature = base64UrlEncode(
    String.fromCharCode(...new Uint8Array(signature))
  );
  const jwt = `${signingInput}.${encodedSignature}`;

  // Exchange JWT for access token
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    throw new Error(`Token exchange failed ${tokenRes.status}: ${body}`);
  }

  const { access_token } = await tokenRes.json();
  return access_token;
}

function base64UrlEncode(str: string): string {
  const b64 = btoa(str);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToBinary(pem: string): ArrayBuffer {
  const lines = pem.split("\n");
  const encoded = lines
    .filter((l) => !l.startsWith("-----"))
    .join("");
  const binaryStr = atob(encoded);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return bytes.buffer;
}
