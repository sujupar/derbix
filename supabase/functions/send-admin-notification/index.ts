/**
 * send-admin-notification
 * Envía notificaciones internas al equipo admin via Resend API.
 *
 * Eventos soportados:
 * - new_registration  → Nuevo usuario registrado
 * - new_subscription  → Nueva suscripción de pago activada
 *
 * Llamado desde:
 * - DB trigger on profiles INSERT (via pg_net)
 * - whop-webhook (via fetch fire-and-forget)
 * - ls-webhook (via fetch fire-and-forget)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { requireServiceCaller, requireAuthenticatedUser, authErrorResponse } from "../_shared/auth-guard.ts"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-secret',
    'Content-Type': 'application/json'
};

// HTML-escape user-provided values before interpolating into email templates.
function escapeHtml(s: unknown): string {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ==========================================
// Timezone helper: UTC → Bogotá (UTC-5)
// ==========================================

function toBogotaTime(date: Date): string {
    return date.toLocaleString('es-CO', {
        timeZone: 'America/Bogota',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });
}

// ==========================================
// HTML Email Templates
// ==========================================

function buildEmailHtml(title: string, subtitle: string, rows: Array<{ label: string; value: string }>, accentColor: string): string {
    const dataRows = rows.map(r => `
        <tr>
            <td style="padding: 12px 16px; font-size: 13px; color: #94a3b8; border-bottom: 1px solid rgba(255,255,255,0.04); width: 140px; vertical-align: top;">
                ${r.label}
            </td>
            <td style="padding: 12px 16px; font-size: 14px; color: #ffffff; font-weight: 600; border-bottom: 1px solid rgba(255,255,255,0.04);">
                ${r.value}
            </td>
        </tr>
    `).join('');

    return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} — Derbix</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #0f172a;">
        <tr>
            <td align="center" style="padding: 40px 16px;">

                <!-- Container -->
                <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; width: 100%; background-color: #1e293b; border-radius: 16px; border: 1px solid rgba(255,255,255,0.08); overflow: hidden;">

                    <!-- Header -->
                    <tr>
                        <td align="center" style="padding: 36px 24px; background: linear-gradient(135deg, ${accentColor} 0%, #34d399 100%);">
                            <img src="https://derbix.co/email/logo-white.png" alt="Derbix" width="150" style="max-width: 150px; height: auto; display: block;">
                        </td>
                    </tr>

                    <!-- Body -->
                    <tr>
                        <td style="padding: 40px 32px;">

                            <h1 style="margin: 0 0 8px 0; font-size: 24px; font-weight: 800; color: #ffffff; line-height: 1.3;">
                                ${title}
                            </h1>

                            <p style="margin: 0 0 28px 0; font-size: 15px; color: #94a3b8; line-height: 1.6;">
                                ${subtitle}
                            </p>

                            <!-- Data Card -->
                            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #0f172a; border-radius: 12px; border: 1px solid rgba(255,255,255,0.06); overflow: hidden;">
                                ${dataRows}
                            </table>

                            <!-- Timestamp -->
                            <p style="margin: 24px 0 0 0; font-size: 12px; color: #475569; text-align: right;">
                                Notificación automática del sistema
                            </p>

                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="padding: 24px 32px; background-color: #0f172a; border-top: 1px solid rgba(255,255,255,0.06);">
                            <p style="margin: 0 0 6px 0; font-size: 13px; color: #475569; text-align: center;">
                                &copy; 2026 Derbix &mdash; Plataforma de An&aacute;lisis Deportivo
                            </p>
                            <p style="margin: 0; font-size: 12px; color: #334155; text-align: center;">
                                <a href="https://derbix.co/terms" style="color: #10b981; text-decoration: none;">T&eacute;rminos</a>
                                &nbsp;&middot;&nbsp;
                                <a href="https://derbix.co/privacy" style="color: #10b981; text-decoration: none;">Privacidad</a>
                            </p>
                        </td>
                    </tr>

                </table>

            </td>
        </tr>
    </table>
</body>
</html>`;
}

function buildRegistrationEmail(data: any): { subject: string; html: string } {
    const name = escapeHtml(data.name || data.full_name || 'Sin nombre');
    const email = escapeHtml(data.email || 'Sin email');
    const date = escapeHtml(toBogotaTime(new Date(data.created_at || Date.now())));

    return {
        subject: `Nuevo registro: ${name}`,
        html: buildEmailHtml(
            'Nuevo Usuario Registrado',
            'Un nuevo usuario se ha registrado en la plataforma Derbix.',
            [
                { label: 'Nombre', value: name },
                { label: 'Email', value: email },
                { label: 'Fecha', value: date },
            ],
            '#10b981'
        )
    };
}

function buildSubscriptionEmail(data: any): { subject: string; html: string } {
    const name = escapeHtml(data.name || 'Sin nombre');
    const email = escapeHtml(data.email || 'Sin email');
    const plan = escapeHtml(data.plan || 'Desconocido');
    const amount = escapeHtml(data.amount ? `$${(data.amount / 100).toFixed(2)} USD` : 'N/A');
    const period = escapeHtml(data.billingPeriod === 'annual' ? 'Anual' : 'Mensual');
    const processor = escapeHtml(data.processor || 'Desconocido');
    const date = escapeHtml(toBogotaTime(new Date()));

    return {
        subject: `Nueva suscripci\u00f3n: ${name} \u2192 ${plan}`,
        html: buildEmailHtml(
            'Nueva Suscripci\u00f3n Activada',
            `${name} ha adquirido el plan ${plan}. A continuaci\u00f3n los detalles.`,
            [
                { label: 'Nombre', value: name },
                { label: 'Email', value: email },
                { label: 'Plan', value: `<span style="color: #10b981; font-weight: 700;">${plan}</span>` },
                { label: 'Monto', value: amount },
                { label: 'Per\u00edodo', value: period },
                { label: 'Procesador', value: processor },
                { label: 'Fecha', value: date },
            ],
            '#0ea5e9' // Blue accent for subscriptions
        )
    };
}

// ==========================================
// Send via Resend API
// ==========================================

async function sendViaResend(apiKey: string, from: string, to: string[], subject: string, html: string): Promise<boolean> {
    try {
        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ from, to, subject, html })
        });

        if (!res.ok) {
            const errBody = await res.text();
            console.error(`[send-admin-notification] Resend API error ${res.status}: ${errBody}`);
            return false;
        }

        const result = await res.json();
        console.log(`[send-admin-notification] Email sent: ${result.id}`);
        return true;
    } catch (err) {
        console.error('[send-admin-notification] Resend fetch error:', err);
        return false;
    }
}

// ==========================================
// MAIN HANDLER
// ==========================================

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    // SECURITY: callable by (a) other edge functions / cron via the shared
    // INTERNAL_FUNCTION_SECRET (webhook → admin email), or (b) any
    // authenticated user — the frontend signup flow uses this path. We
    // reject anonymous callers to prevent unauthenticated email spam.
    const internalAuth = requireServiceCaller(req);
    if (!internalAuth.ok) {
        const userAuth = await requireAuthenticatedUser(req);
        if (!userAuth.ok) return authErrorResponse(userAuth, corsHeaders);
    }

    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    const adminEmails = Deno.env.get('ADMIN_NOTIFICATION_EMAILS');

    if (!resendApiKey || !adminEmails) {
        console.error('[send-admin-notification] Missing RESEND_API_KEY or ADMIN_NOTIFICATION_EMAILS');
        return new Response(JSON.stringify({ success: false, error: 'Missing config' }), {
            status: 200, // No retry
            headers: corsHeaders
        });
    }

    try {
        const body = await req.json();
        const { type, data } = body;

        console.log(`[send-admin-notification] Event: ${type}`);

        let email: { subject: string; html: string };

        switch (type) {
            case 'new_registration':
                email = buildRegistrationEmail(data || {});
                break;
            case 'new_subscription':
                email = buildSubscriptionEmail(data || {});
                break;
            default:
                console.log(`[send-admin-notification] Unknown event type: ${type}`);
                return new Response(JSON.stringify({ success: false, error: 'Unknown type' }), {
                    status: 200,
                    headers: corsHeaders
                });
        }

        const recipients = adminEmails.split(',').map(e => e.trim()).filter(Boolean);
        const from = 'Derbix <no-reply@derbix.co>';

        const sent = await sendViaResend(resendApiKey, from, recipients, email.subject, email.html);

        return new Response(JSON.stringify({ success: sent }), {
            headers: corsHeaders
        });

    } catch (error) {
        console.error('[send-admin-notification] Error:', error);
        return new Response(JSON.stringify({ success: false, error: 'Internal error' }), {
            status: 200,
            headers: corsHeaders
        });
    }
});
