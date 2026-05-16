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
import { corsHeaders } from '../_shared/cors.ts'
import { requireServiceCaller, requireAuthenticatedUser, authErrorResponse } from '../_shared/auth-guard.ts'

const META_API_VERSION = 'v19.0';

async function hashSHA256(value: string): Promise<string> {
    const data = new TextEncoder().encode(value.trim().toLowerCase());
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    // SECURITY: callable either by internal services (webhooks, cron) via
    // INTERNAL_FUNCTION_SECRET, or by an authenticated end user. End users
    // are further restricted to firing events for their OWN email — we
    // check this further down once we know `email` from the body.
    let callerEmail: string | null = null;
    const internalAuth = requireServiceCaller(req);
    if (!internalAuth.ok) {
        const userAuth = await requireAuthenticatedUser(req);
        if (!userAuth.ok) return authErrorResponse(userAuth, corsHeaders);
        callerEmail = userAuth.email;
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
        } = await req.json();

        if (!event_name) {
            return new Response(JSON.stringify({ error: 'event_name required' }), {
                status: 400,
                headers: corsHeaders
            });
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
