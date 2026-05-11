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
import { requireServiceCaller, authErrorResponse } from '../_shared/auth-guard.ts'

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

    // SECURITY: Only callable by other edge functions / cron via INTERNAL_FUNCTION_SECRET.
    // Without this anyone could pollute the Meta Pixel with forged conversions.
    const internalAuth = requireServiceCaller(req);
    if (!internalAuth.ok) return authErrorResponse(internalAuth, corsHeaders);

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
            source_url
        } = await req.json();

        if (!event_name) {
            return new Response(JSON.stringify({ error: 'event_name required' }), {
                status: 400,
                headers: corsHeaders
            });
        }

        // Hash email for privacy (Meta requires SHA256 hashed PII)
        const hashedEmail = email ? await hashSHA256(email) : undefined;

        const eventData: Record<string, unknown> = {
            event_name,
            event_time: Math.floor(Date.now() / 1000),
            action_source: 'website',
            user_data: {
                em: hashedEmail ? [hashedEmail] : undefined,
            },
        };

        // Add event_id for deduplication with browser Pixel
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
