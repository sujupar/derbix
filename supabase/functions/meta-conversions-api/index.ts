/**
 * meta-conversions-api
 * Sends server-side conversion events to Meta (Facebook) Conversions API.
 * Called from whop-webhook on payment.succeeded and from signup flow for Lead events.
 *
 * Env vars required:
 * - META_PIXEL_ID: Facebook Pixel ID
 * - META_CONVERSIONS_TOKEN: Conversions API access token
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from '../_shared/cors.ts'
import { requireServiceCaller, requireAuthenticatedUser, authErrorResponse } from '../_shared/auth-guard.ts'

const META_API_VERSION = 'v19.0';

// How fresh must a just-created auth user be to allow an unauthenticated
// signup-tracking call. 5 minutes covers the time between auth.signUp() and
// the email confirmation step, while preventing replay attacks well after.
const SIGNUP_TRACK_WINDOW_MS = 5 * 60 * 1000;

async function hashSHA256(value: string): Promise<string> {
    const data = new TextEncoder().encode(value.trim().toLowerCase());
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Verify a just-created user via service_role: must exist, email must match
 * and creation timestamp must be within SIGNUP_TRACK_WINDOW_MS. Used to let
 * the frontend fire CompleteRegistration BEFORE the user has confirmed email
 * (and therefore before there's a real session JWT).
 */
async function verifyFreshSignup(userId: string, email: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    const sbUrl = Deno.env.get('SUPABASE_URL');
    const sbServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!sbUrl || !sbServiceKey) return { ok: false, reason: 'Server misconfiguration' };

    const admin = createClient(sbUrl, sbServiceKey);
    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (error || !data?.user) return { ok: false, reason: 'User not found' };

    const u = data.user;
    if (!u.email || u.email.toLowerCase() !== email.toLowerCase()) {
        return { ok: false, reason: 'Email mismatch' };
    }
    const created = u.created_at ? Date.parse(u.created_at) : 0;
    if (!created || Date.now() - created > SIGNUP_TRACK_WINDOW_MS) {
        return { ok: false, reason: 'User not fresh' };
    }
    return { ok: true };
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    // SECURITY: three ways in, in order of preference:
    //   1. INTERNAL_FUNCTION_SECRET header → other edge functions and cron.
    //   2. Authenticated user JWT → existing logged-in user firing their
    //      own events.
    //   3. Anonymous + body carries `user_id` of a JUST-CREATED user
    //      (created < 5 min ago) whose email matches the payload email.
    //      This is the only way the signup flow can call us before the
    //      email-confirmation step (when no session exists yet).
    let callerEmail: string | null = null;
    let isFreshSignupCall = false;
    const internalAuth = requireServiceCaller(req);
    if (!internalAuth.ok) {
        const userAuth = await requireAuthenticatedUser(req);
        if (userAuth.ok) {
            callerEmail = userAuth.email;
        } else {
            // Fall through to mode 3: defer rejection until we read the body
            // and can attempt the fresh-signup verification.
            isFreshSignupCall = true;
        }
    }

    const pixelId = Deno.env.get('META_PIXEL_ID');
    const accessToken = Deno.env.get('META_CONVERSIONS_TOKEN');

    if (!pixelId || !accessToken) {
        console.error('[meta-conversions-api] Missing META_PIXEL_ID or META_CONVERSIONS_TOKEN');
        return new Response(JSON.stringify({ error: 'Meta CAPI not configured' }), {
            status: 200, // Return 200 to not block callers
            headers: corsHeaders
        });
    }

    try {
        const {
            event_name,
            email,
            value,
            currency,
            event_id,
            user_agent,
            source_url,
            fbp,
            fbc,
            client_ip_address,
            user_id,
        } = await req.json();

        if (!event_name) {
            return new Response(JSON.stringify({ error: 'event_name required' }), {
                status: 400,
                headers: corsHeaders
            });
        }

        // Mode 3 (anonymous + fresh signup): require user_id + email and verify
        // server-side that the auth.users row is real, recent, and that the
        // email matches. Anyone forging this needs (a) a real Supabase user id
        // they just created and (b) the matching email — at which point they
        // could already sign up themselves; spoofing buys nothing.
        if (isFreshSignupCall) {
            if (!user_id || !email) {
                return new Response(JSON.stringify({ success: false, error: 'user_id and email required for unauthenticated calls' }), {
                    status: 401,
                    headers: corsHeaders
                });
            }
            const check = await verifyFreshSignup(user_id, email);
            if (!check.ok) {
                console.warn(`[meta-conversions-api] fresh-signup verification failed for user_id=${user_id}: ${check.reason}`);
                return new Response(JSON.stringify({ success: false, error: check.reason }), {
                    status: 401,
                    headers: corsHeaders
                });
            }
            // Verified — proceed as if we knew the caller's email.
            callerEmail = email;
        }

        // If the call came from an end user (not an internal service), make sure
        // they can only fire events for their own email — prevents anyone from
        // polluting the Meta Pixel with someone else's identity.
        if (callerEmail && email && email.toLowerCase() !== callerEmail.toLowerCase()) {
            console.warn(`[meta-conversions-api] auth user ${callerEmail} tried to fire event for ${email} — blocked`);
            return new Response(JSON.stringify({ success: false, error: 'Email mismatch' }), {
                status: 403,
                headers: corsHeaders
            });
        }

        // Hash email for privacy (Meta requires SHA256 hashed PII)
        const hashedEmail = email ? await hashSHA256(email) : undefined;

        // Pull client IP from the request if the caller didn't pass it.
        const xff = req.headers.get('x-forwarded-for');
        const inferredIp = xff ? xff.split(',')[0].trim() : null;

        const userData: Record<string, unknown> = {};
        if (hashedEmail) userData.em = [hashedEmail];
        if (fbp) userData.fbp = fbp;
        if (fbc) userData.fbc = fbc;
        const clientIp = client_ip_address || inferredIp;
        if (clientIp) userData.client_ip_address = clientIp;
        if (user_agent) userData.client_user_agent = user_agent;

        const eventData: Record<string, unknown> = {
            event_name,
            event_time: Math.floor(Date.now() / 1000),
            action_source: 'website',
            user_data: userData,
        };

        // Add event_id for deduplication with the browser Pixel — when both
        // sides send the same id, Meta keeps only one.
        if (event_id) {
            eventData.event_id = event_id;
        }

        // Add custom data for Purchase events
        if (value && currency) {
            eventData.custom_data = {
                value: parseFloat(value),
                currency: currency.toUpperCase(),
            };
        }

        // Add source URL if provided
        if (source_url) {
            eventData.event_source_url = source_url;
        }

        const payload = {
            data: [eventData],
        };

        console.log(`[meta-conversions-api] Sending ${event_name} event to Meta CAPI`);

        const metaUrl = `https://graph.facebook.com/${META_API_VERSION}/${pixelId}/events?access_token=${accessToken}`;

        const response = await fetch(metaUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        const result = await response.json();

        if (!response.ok) {
            console.error('[meta-conversions-api] Meta API error:', JSON.stringify(result));
            return new Response(JSON.stringify({ error: 'Meta API error', details: result }), {
                status: 200, // Don't fail callers
                headers: corsHeaders
            });
        }

        console.log(`[meta-conversions-api] Success: ${event_name}, events_received=${result.events_received}`);

        return new Response(JSON.stringify({ success: true, events_received: result.events_received }), {
            headers: corsHeaders
        });

    } catch (error) {
        console.error('[meta-conversions-api] Error:', error);
        return new Response(JSON.stringify({ error: 'Internal error' }), {
            status: 200, // Don't fail callers
            headers: corsHeaders
        });
    }
});
