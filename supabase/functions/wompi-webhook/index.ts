/**
 * Wompi Webhook Handler
 * Procesa eventos de pago de Wompi y activa/cancela suscripciones
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-event-checksum',
}

serve(async (req) => {
    // CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const sbUrl = Deno.env.get('SUPABASE_URL')!
        const sbKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        const eventSecret = Deno.env.get('WOMPI_EVENT_SECRET')!

        const supabase = createClient(sbUrl, sbKey)

        // Parse body
        const body = await req.json()
        console.log('[WOMPI-WEBHOOK] Received event:', body.event)

        // Verify signature
        const checksumHeader = req.headers.get('x-event-checksum') || body.signature?.checksum
        if (!checksumHeader) {
            console.error('[WOMPI-WEBHOOK] No checksum provided')
            return new Response(JSON.stringify({ error: 'Missing checksum' }), {
                status: 401,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            })
        }

        // Build checksum string from FIXED server-side property list per Wompi spec.
        // SECURITY: Never trust body.signature.properties — an attacker could omit
        // properties to make the checksum trivially forgeable.
        const EXPECTED_PROPERTIES = ['transaction.id', 'transaction.status', 'transaction.amount_in_cents']
        let checksumString = ''

        for (const prop of EXPECTED_PROPERTIES) {
            const parts = prop.split('.')
            let value: any = body.data
            for (const part of parts) {
                value = value?.[part]
            }
            if (value === undefined || value === null) {
                console.error('[WOMPI-WEBHOOK] Missing required property for checksum:', prop)
                return new Response(JSON.stringify({ error: 'Invalid payload structure' }), {
                    status: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                })
            }
            checksumString += String(value)
        }

        checksumString += body.timestamp
        checksumString += eventSecret

        // Calculate SHA256
        const encoder = new TextEncoder()
        const data = encoder.encode(checksumString)
        const hashBuffer = await crypto.subtle.digest('SHA-256', data)
        const hashArray = Array.from(new Uint8Array(hashBuffer))
        const calculatedChecksum = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase()

        // Constant-time comparison
        const headerUpper = checksumHeader.toUpperCase()
        let mismatch = calculatedChecksum.length !== headerUpper.length ? 1 : 0
        for (let i = 0; i < calculatedChecksum.length && i < headerUpper.length; i++) {
            mismatch |= calculatedChecksum.charCodeAt(i) ^ headerUpper.charCodeAt(i)
        }
        if (mismatch !== 0) {
            console.error('[WOMPI-WEBHOOK] Invalid checksum')
            return new Response(JSON.stringify({ error: 'Invalid checksum' }), {
                status: 401,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            })
        }

        console.log('[WOMPI-WEBHOOK] Checksum verified ✓')

        // Process based on event type
        const event = body.event
        const transaction = body.data?.transaction

        if (!transaction) {
            console.log('[WOMPI-WEBHOOK] No transaction data, ignoring')
            return new Response(JSON.stringify({ success: true }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            })
        }

        // Extract reference (should contain user_id and plan_id)
        // Format: "sub_USERID_PLANID_TIMESTAMP"
        const reference = transaction.reference || ''
        const refParts = reference.split('_')

        if (refParts.length < 3 || refParts[0] !== 'sub') {
            console.log('[WOMPI-WEBHOOK] Not a subscription payment, ignoring. Ref:', reference)
            return new Response(JSON.stringify({ success: true }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            })
        }

        const userId = refParts[1]
        const planId = refParts[2]

        console.log('[WOMPI-WEBHOOK] Processing subscription payment:', { userId, planId, status: transaction.status })

        // Log payment in history
        await supabase.from('payment_history').insert({
            user_id: userId,
            amount_cents: transaction.amount_in_cents,
            currency: transaction.currency,
            status: transaction.status.toLowerCase(),
            wompi_transaction_id: transaction.id,
            wompi_reference: reference,
            payment_method: transaction.payment_method_type,
            raw_response: transaction
        })

        // Handle based on status
        if (event === 'transaction.updated' && transaction.status === 'APPROVED') {
            console.log('[WOMPI-WEBHOOK] Payment APPROVED, activating subscription')

            // Get user's organization
            const { data: orgMember } = await supabase
                .from('organization_members')
                .select('organization_id')
                .eq('user_id', userId)
                .limit(1)
                .single()

            const orgId = orgMember?.organization_id

            if (!orgId) {
                console.error('[WOMPI-WEBHOOK] User has no organization')
                return new Response(JSON.stringify({ error: 'No organization' }), {
                    status: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                })
            }

            // Calculate period
            const periodStart = new Date()
            const periodEnd = new Date()
            periodEnd.setMonth(periodEnd.getMonth() + 1)

            // Create/update subscription
            const { error: subError } = await supabase
                .from('user_subscriptions')
                .upsert({
                    user_id: userId,
                    organization_id: orgId,
                    plan_id: planId,
                    status: 'active',
                    current_period_start: periodStart.toISOString(),
                    current_period_end: periodEnd.toISOString(),
                    wompi_transaction_id: transaction.id
                }, {
                    onConflict: 'user_id,organization_id'
                })

            if (subError) {
                console.error('[WOMPI-WEBHOOK] Error creating subscription:', subError)
                return new Response(JSON.stringify({ error: subError.message }), {
                    status: 500,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                })
            }

            console.log('[WOMPI-WEBHOOK] Subscription activated successfully!')

        } else if (transaction.status === 'DECLINED' || transaction.status === 'ERROR') {
            console.log('[WOMPI-WEBHOOK] Payment failed:', transaction.status)
            // Update subscription to past_due if exists
            await supabase
                .from('user_subscriptions')
                .update({ status: 'past_due' })
                .eq('user_id', userId)
                .eq('status', 'active')
        }

        return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })

    } catch (error) {
        console.error('[WOMPI-WEBHOOK] Error:', error)
        // Return 200 to prevent Wompi from retrying & creating duplicate writes.
        // The error is logged server-side; expose nothing to caller.
        return new Response(JSON.stringify({ success: true, error: 'Internal error logged' }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
    }
})
