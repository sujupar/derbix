/**
 * whop-create-checkout
 * Crea una sesión de checkout en Whop y retorna la purchase_url.
 * El frontend redirige al usuario a esta URL para completar el pago.
 *
 * Metadata se propaga automáticamente de checkout → memberships → webhooks,
 * permitiendo vincular la compra al usuario de Derbix.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { requireAuthenticatedUser, authErrorResponse } from "../_shared/auth-guard.ts"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Content-Type': 'application/json'
};

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    // SECURITY: Resolve userId from the verified JWT, NOT from the request body.
    // Otherwise an attacker could create a checkout that activates a subscription
    // for a different user.
    const auth = await requireAuthenticatedUser(req);
    if (!auth.ok) return authErrorResponse(auth, corsHeaders);

    const whopApiKey = Deno.env.get('WHOP_API_KEY');
    if (!whopApiKey) {
        console.error('[whop-create-checkout] Missing WHOP_API_KEY');
        return new Response(JSON.stringify({ error: 'Whop no está configurado' }), {
            status: 500,
            headers: corsHeaders
        });
    }

    try {
        const { whopPlanId, planId, orgId, billingPeriod } = await req.json();
        const userId = auth.userId;
        const email = auth.email || '';

        if (!whopPlanId) {
            return new Response(JSON.stringify({ error: 'Faltan parámetros requeridos' }), {
                status: 400,
                headers: corsHeaders
            });
        }

        console.log(`[whop-create-checkout] Creating checkout: plan=${whopPlanId}, user=${userId}, org=${orgId}, period=${billingPeriod}`);

        const frontendUrl = Deno.env.get('FRONTEND_URL') || 'https://derbix.co';

        // SECURITY: do NOT include orgId from client metadata. The webhook will
        // resolve orgId from organization_members for the verified userId,
        // preventing cross-tenant subscription activation.
        const requestBody = {
            plan_id: whopPlanId,
            mode: "payment" as const,
            redirect_url: `${frontendUrl}/app?payment=success`,
            source_url: `${frontendUrl}/pricing`,
            metadata: {
                userId,
                planId: planId || '',
                billingPeriod: billingPeriod || 'monthly',
                email,
            },
        };

        console.log(`[whop-create-checkout] Request body:`, JSON.stringify(requestBody));

        // Crear checkout configuration en Whop
        const response = await fetch('https://api.whop.com/api/v1/checkout_configurations', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${whopApiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[whop-create-checkout] Whop API error ${response.status}: ${errorText}`);
            console.error(`[whop-create-checkout] API Key prefix: ${whopApiKey.substring(0, 10)}...`);
            return new Response(JSON.stringify({
                error: `Error al crear sesión de pago (${response.status}). Intenta de nuevo.`
            }), {
                status: 422,
                headers: corsHeaders
            });
        }

        const checkoutData = await response.json();
        const purchaseUrl = checkoutData.purchase_url;

        if (!purchaseUrl) {
            console.error('[whop-create-checkout] No purchase_url in response:', JSON.stringify(checkoutData));
            return new Response(JSON.stringify({
                error: 'No se pudo generar el enlace de pago'
            }), {
                status: 500,
                headers: corsHeaders
            });
        }

        console.log(`[whop-create-checkout] Checkout created: ${purchaseUrl}`);

        return new Response(JSON.stringify({
            success: true,
            purchase_url: purchaseUrl
        }), {
            headers: corsHeaders
        });

    } catch (error) {
        console.error('[whop-create-checkout] Error:', error);
        return new Response(JSON.stringify({
            error: 'Error interno. Intenta de nuevo.'
        }), {
            status: 500,
            headers: corsHeaders
        });
    }
});
