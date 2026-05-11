/**
 * whop-webhook
 * Webhook handler para Whop.
 * Procesa eventos del ciclo de vida de membresías y pagos.
 *
 * Eventos manejados:
 * - membership.went_valid   → Activar suscripción
 * - membership.went_invalid → Desactivar suscripción
 * - payment.succeeded       → Registrar pago exitoso
 * - payment.failed          → Registrar pago fallido
 *
 * Whop implementa Standard Webhooks specification para verificación HMAC.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, webhook-id, webhook-timestamp, webhook-signature',
    'Content-Type': 'application/json'
};

// ==========================================
// Standard Webhooks HMAC Verification
// ==========================================

// Constant-time string comparison to prevent timing attacks
function safeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) {
        result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
}

async function verifyWebhookSignature(
    rawBody: string,
    webhookId: string,
    webhookTimestamp: string,
    webhookSignature: string,
    secret: string
): Promise<boolean> {
    try {
        // Standard Webhooks: message = "{webhook_id}.{webhook_timestamp}.{body}"
        const message = `${webhookId}.${webhookTimestamp}.${rawBody}`;

        // El secreto viene con prefijo "whsec_" y codificado en base64
        const secretBytes = secret.startsWith('whsec_') ? secret.slice(6) : secret;

        // Decodificar base64
        const keyBytes = Uint8Array.from(atob(secretBytes), c => c.charCodeAt(0));

        const key = await crypto.subtle.importKey(
            'raw',
            keyBytes,
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );

        const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
        const computedSig = btoa(String.fromCharCode(...new Uint8Array(sig)));

        // webhookSignature puede tener múltiples firmas: "v1,{sig1} v1,{sig2}"
        const signatures = webhookSignature.split(' ');
        for (const sigEntry of signatures) {
            const parts = sigEntry.split(',');
            if (parts.length >= 2 && safeEqual(parts[1], computedSig)) {
                return true;
            }
        }
        return false;
    } catch (e) {
        console.error('[whop-webhook] Signature verification error:', e);
        return false;
    }
}

// Standard Webhooks: reject events with timestamps outside ±5min to prevent replay
const WEBHOOK_TIMESTAMP_TOLERANCE_SEC = 300;

function isTimestampFresh(webhookTimestamp: string): boolean {
    const ts = parseInt(webhookTimestamp, 10);
    if (!Number.isFinite(ts)) return false;
    const nowSec = Math.floor(Date.now() / 1000);
    return Math.abs(nowSec - ts) <= WEBHOOK_TIMESTAMP_TOLERANCE_SEC;
}

// ==========================================
// Helper: Resolver plan_id desde whop_plan_id
// ==========================================

async function resolvePlanFromWhop(supabase: any, whopPlanId: string): Promise<string | null> {
    const { data } = await supabase
        .from('subscription_plans')
        .select('id')
        .or(`whop_plan_id.eq.${whopPlanId},whop_plan_id_annual.eq.${whopPlanId}`)
        .limit(1)
        .single();

    return data?.id || null;
}

// ==========================================
// Helper: Resolver plan desde metadata.planId (UUID directo)
// ==========================================

async function resolvePlanDirect(supabase: any, planId: string): Promise<string | null> {
    const { data } = await supabase
        .from('subscription_plans')
        .select('id')
        .eq('id', planId)
        .single();

    return data?.id || null;
}

// ==========================================
// Helper: Asignar plan free
// ==========================================

async function assignFreePlan(supabase: any, userId: string, orgId: string) {
    const { data: freePlan } = await supabase
        .from('subscription_plans')
        .select('id')
        .eq('name', 'free')
        .single();

    if (!freePlan) return;

    await supabase.from('user_subscriptions').upsert({
        user_id: userId,
        organization_id: orgId,
        plan_id: freePlan.id,
        status: 'active',
        current_period_start: new Date().toISOString(),
        billing_period: 'monthly',
        whop_membership_id: null,
        whop_user_id: null,
        ls_subscription_id: null,
        ls_customer_id: null,
        customer_portal_url: null
    }, { onConflict: 'user_id,organization_id' });
}

// ==========================================
// Helper: Send Meta Conversions API event (fire-and-forget)
// ==========================================

function sendMetaConversion(sbUrl: string, sbKey: string, eventData: {
    event_name: string;
    email?: string;
    value?: number;
    currency?: string;
    event_id?: string;
}) {
    const url = `${sbUrl}/functions/v1/meta-conversions-api`;
    const internalSecret = Deno.env.get('INTERNAL_FUNCTION_SECRET') || '';
    fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${sbKey}`,
            'X-Internal-Secret': internalSecret
        },
        body: JSON.stringify(eventData)
    }).catch(err => {
        console.error('[whop-webhook] Meta CAPI error (non-blocking):', err);
    });
}

// ==========================================
// Helper: Notificar al equipo admin (fire-and-forget)
// ==========================================

function notifyAdmin(sbUrl: string, sbKey: string, type: string, notifData: any) {
    const url = `${sbUrl}/functions/v1/send-admin-notification`;
    const internalSecret = Deno.env.get('INTERNAL_FUNCTION_SECRET') || '';
    fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${sbKey}`,
            'X-Internal-Secret': internalSecret
        },
        body: JSON.stringify({ type, data: notifData })
    }).catch(err => {
        console.error('[whop-webhook] Admin notification error (non-blocking):', err);
    });
}

// ==========================================
// Event: membership.went_valid
// ==========================================

async function handleMembershipValid(supabase: any, data: any) {
    const metadata = data.metadata || {};
    const userId = metadata.userId;
    const orgId = metadata.orgId;
    const billingPeriod = metadata.billingPeriod || 'monthly';
    const membershipId = data.id;
    const whopUserId = data.user_id || data.user?.id;
    const whopPlanId = data.plan_id;
    const userEmail = data.user?.email;

    if (!userId) {
        console.error(`[whop-webhook] membership.went_valid: No userId in metadata. membership=${membershipId}, whop_user=${whopUserId}`);
        // Intentar buscar por email si lo tenemos
        if (userEmail) {
            console.log(`[whop-webhook] Attempting email lookup: ${userEmail}`);
        }
        return;
    }

    // Resolver plan: primero por whop_plan_id, luego por metadata.planId
    let planId = whopPlanId ? await resolvePlanFromWhop(supabase, whopPlanId) : null;
    if (!planId && metadata.planId) {
        planId = await resolvePlanDirect(supabase, metadata.planId);
    }

    if (!planId) {
        console.error(`[whop-webhook] membership.went_valid: No plan found. whop_plan=${whopPlanId}, meta_plan=${metadata.planId}`);
        return;
    }

    // Resolver orgId si no viene en metadata
    let resolvedOrgId = orgId;
    if (!resolvedOrgId) {
        const { data: memberData } = await supabase
            .from('organization_members')
            .select('organization_id')
            .eq('user_id', userId)
            .limit(1)
            .single();
        resolvedOrgId = memberData?.organization_id;
    }

    if (!resolvedOrgId) {
        console.error(`[whop-webhook] membership.went_valid: No org found for user=${userId}`);
        return;
    }

    const manageUrl = data.manage_url || 'https://whop.com/orders';

    const upsertData: any = {
        user_id: userId,
        organization_id: resolvedOrgId,
        plan_id: planId,
        status: 'active',
        current_period_start: data.renewal_period_start || data.created_at || new Date().toISOString(),
        current_period_end: data.renewal_period_end || null,
        renews_at: data.renewal_period_end || null,
        ends_at: data.cancel_at_period_end ? data.renewal_period_end : null,
        billing_period: billingPeriod,
        whop_membership_id: membershipId,
        whop_user_id: whopUserId || null,
        customer_portal_url: manageUrl,
        cancel_at_period_end: data.cancel_at_period_end || false,
    };

    const { error } = await supabase
        .from('user_subscriptions')
        .upsert(upsertData, { onConflict: 'user_id,organization_id' });

    if (error) {
        console.error('[whop-webhook] Error upserting subscription:', error);
    } else {
        console.log(`[whop-webhook] Membership activated: user=${userId}, plan=${planId}, membership=${membershipId}`);

        // Notificar al equipo admin (fire-and-forget, no bloquea)
        try {
            const sbUrl = Deno.env.get('SUPABASE_URL')!;
            const sbKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

            // Obtener nombre del plan
            const { data: planData } = await supabase
                .from('subscription_plans')
                .select('display_name, name')
                .eq('id', planId)
                .single();

            // Obtener perfil del usuario
            const { data: profile } = await supabase
                .from('profiles')
                .select('full_name, email')
                .eq('id', userId)
                .single();

            notifyAdmin(sbUrl, sbKey, 'new_subscription', {
                name: profile?.full_name || userEmail || 'Sin nombre',
                email: profile?.email || userEmail || 'Sin email',
                plan: planData?.display_name || planData?.name || 'Desconocido',
                amount: data.amount ? Math.round(data.amount * 100) : null,
                billingPeriod,
                processor: 'Whop'
            });
        } catch (notifErr) {
            console.error('[whop-webhook] Notification prep error (non-blocking):', notifErr);
        }
    }
}

// ==========================================
// Event: membership.went_invalid
// ==========================================

async function handleMembershipInvalid(supabase: any, data: any) {
    const membershipId = data.id;

    // Buscar suscripción por whop_membership_id
    const { data: sub } = await supabase
        .from('user_subscriptions')
        .select('user_id, organization_id')
        .eq('whop_membership_id', membershipId)
        .single();

    if (!sub) {
        console.log(`[whop-webhook] membership.went_invalid: No subscription found for membership=${membershipId}`);
        return;
    }

    // Marcar como expirada y asignar plan free
    const { error } = await supabase
        .from('user_subscriptions')
        .update({
            status: 'expired',
            ends_at: new Date().toISOString(),
        })
        .eq('whop_membership_id', membershipId);

    if (error) {
        console.error('[whop-webhook] Error invalidating membership:', error);
    }

    // Asignar plan free
    await assignFreePlan(supabase, sub.user_id, sub.organization_id);
    console.log(`[whop-webhook] Membership invalidated, assigned free plan: membership=${membershipId}`);
}

// ==========================================
// Event: payment.succeeded
// ==========================================

async function handlePaymentSucceeded(supabase: any, data: any) {
    const membershipId = data.membership_id;
    const paymentId = data.id;

    if (!membershipId) {
        console.log(`[whop-webhook] payment.succeeded: No membership_id, payment=${paymentId}`);
        return;
    }

    // Actualizar suscripción a activa
    await supabase
        .from('user_subscriptions')
        .update({ status: 'active' })
        .eq('whop_membership_id', membershipId);

    // Registrar en payment_history
    const { data: sub } = await supabase
        .from('user_subscriptions')
        .select('id, user_id')
        .eq('whop_membership_id', membershipId)
        .single();

    if (sub) {
        await supabase.from('payment_history').insert({
            user_id: sub.user_id,
            subscription_id: sub.id,
            amount_cents: data.amount ? Math.round(data.amount * 100) : 0,
            currency: data.currency || 'USD',
            status: 'paid',
            whop_payment_id: paymentId,
            billing_reason: data.created_at === data.membership?.created_at ? 'initial' : 'renewal',
            raw_response: data,
            description: 'Pago procesado via Whop'
        });

        // Send Purchase event to Meta Conversions API (fire-and-forget)
        try {
            const sbUrl = Deno.env.get('SUPABASE_URL')!;
            const sbKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

            const { data: profile } = await supabase
                .from('profiles')
                .select('email')
                .eq('id', sub.user_id)
                .single();

            if (profile?.email) {
                sendMetaConversion(sbUrl, sbKey, {
                    event_name: 'Purchase',
                    email: profile.email,
                    value: data.amount || 0,
                    currency: (data.currency || 'USD').toUpperCase(),
                    event_id: `whop_payment_${paymentId}`,
                });
            }
        } catch (metaErr) {
            console.error('[whop-webhook] Meta CAPI prep error (non-blocking):', metaErr);
        }
    }

    console.log(`[whop-webhook] Payment succeeded: payment=${paymentId}, membership=${membershipId}`);
}

// ==========================================
// Event: payment.failed
// ==========================================

async function handlePaymentFailed(supabase: any, data: any) {
    const membershipId = data.membership_id;
    const paymentId = data.id;

    if (membershipId) {
        await supabase
            .from('user_subscriptions')
            .update({ status: 'past_due' })
            .eq('whop_membership_id', membershipId);
    }

    // Registrar en payment_history
    const { data: sub } = await supabase
        .from('user_subscriptions')
        .select('id, user_id')
        .eq('whop_membership_id', membershipId)
        .single();

    if (sub) {
        await supabase.from('payment_history').insert({
            user_id: sub.user_id,
            subscription_id: sub.id,
            amount_cents: 0,
            currency: 'USD',
            status: 'declined',
            whop_payment_id: paymentId,
            billing_reason: 'renewal',
            error_message: 'Payment failed',
            raw_response: data,
            description: 'Pago fallido via Whop'
        });
    }

    console.log(`[whop-webhook] Payment failed: payment=${paymentId}, membership=${membershipId}`);
}

// ==========================================
// MAIN HANDLER
// ==========================================

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    const sbUrl = Deno.env.get('SUPABASE_URL')!;
    const sbKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const webhookSecret = Deno.env.get('WHOP_WEBHOOK_SECRET');
    const supabase = createClient(sbUrl, sbKey);

    try {
        // 1. Leer body crudo para verificación
        const rawBody = await req.text();

        // 2. Verificar firma (Standard Webhooks) — fail-closed
        const webhookId = req.headers.get('webhook-id');
        const webhookTimestamp = req.headers.get('webhook-timestamp');
        const webhookSignature = req.headers.get('webhook-signature');

        if (!webhookSecret) {
            console.error('[whop-webhook] WHOP_WEBHOOK_SECRET not configured');
            return new Response(JSON.stringify({ error: 'Server misconfiguration' }), {
                status: 500,
                headers: corsHeaders
            });
        }

        if (!webhookId || !webhookTimestamp || !webhookSignature) {
            console.error('[whop-webhook] Missing required signature headers');
            return new Response(JSON.stringify({ error: 'Missing signature headers' }), {
                status: 401,
                headers: corsHeaders
            });
        }

        // Replay protection: reject stale webhooks (>5 min)
        if (!isTimestampFresh(webhookTimestamp)) {
            console.error(`[whop-webhook] Stale webhook timestamp: ${webhookTimestamp}`);
            return new Response(JSON.stringify({ error: 'Webhook timestamp out of tolerance' }), {
                status: 401,
                headers: corsHeaders
            });
        }

        const isValid = await verifyWebhookSignature(
            rawBody, webhookId, webhookTimestamp, webhookSignature, webhookSecret
        );
        if (!isValid) {
            console.error('[whop-webhook] Invalid webhook signature');
            return new Response(JSON.stringify({ error: 'Invalid signature' }), {
                status: 401,
                headers: corsHeaders
            });
        }

        // 3. Parse payload
        const body = JSON.parse(rawBody);
        const action = body.action;
        const data = body.data || {};

        console.log(`[whop-webhook] Event: ${action}, ID: ${data.id || 'unknown'}`);

        // 4. Idempotency check
        const eventId = data.id ? `${action}_${data.id}` : null;
        if (eventId) {
            const { data: existing } = await supabase
                .from('whop_webhook_events')
                .select('id')
                .eq('whop_event_id', eventId)
                .single();

            if (existing) {
                console.log(`[whop-webhook] Duplicate event, skipping: ${eventId}`);
                return new Response(JSON.stringify({ success: true, duplicate: true }), {
                    headers: corsHeaders
                });
            }
        }

        // 5. Guardar evento
        await supabase.from('whop_webhook_events').insert({
            event_type: action,
            whop_event_id: eventId,
            payload: body
        });

        // 6. Procesar según tipo de evento
        // Whop UI muestra eventos con guiones bajos (membership_activated)
        // pero el payload puede usar puntos (membership.went_valid)
        // Manejamos ambos formatos por seguridad
        switch (action) {
            case 'membership.went_valid':
            case 'membership_activated':
                await handleMembershipValid(supabase, data);
                break;
            case 'membership.went_invalid':
            case 'membership_deactivated':
                await handleMembershipInvalid(supabase, data);
                break;
            case 'payment.succeeded':
            case 'invoice_paid':
                await handlePaymentSucceeded(supabase, data);
                break;
            case 'payment.failed':
            case 'invoice_past_due':
                await handlePaymentFailed(supabase, data);
                break;
            default:
                console.log(`[whop-webhook] Unhandled event: ${action}`);
        }

        // 7. Marcar como procesado
        if (eventId) {
            await supabase.from('whop_webhook_events')
                .update({ processed: true, processed_at: new Date().toISOString() })
                .eq('whop_event_id', eventId);
        }

        return new Response(JSON.stringify({ success: true }), {
            headers: corsHeaders
        });

    } catch (error) {
        console.error('[whop-webhook] Unhandled error:', error);

        // Retornar 200 incluso en error para evitar retries infinitos
        return new Response(JSON.stringify({ success: true, error: 'Internal error logged' }), {
            status: 200,
            headers: corsHeaders
        });
    }
});
