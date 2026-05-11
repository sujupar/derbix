/**
 * send-whatsapp-notification
 * Envía notificaciones WhatsApp a usuarios vía WhatsApp Cloud API.
 *
 * Tipos de notificación:
 * - predictions_ready → Pronósticos del día listos (trigger: daily-analysis-generator)
 * - daily_results     → Resultados del día verificados (trigger: hourly-results-verifier)
 * - test              → Mensaje de prueba a un número específico (admin)
 *
 * Env vars requeridas:
 * - WHATSAPP_PHONE_NUMBER_ID
 * - WHATSAPP_ACCESS_TOKEN
 * - SHORT_IO_API_KEY (opcional)
 * - SHORT_IO_DOMAIN (opcional)
 * - FRONTEND_URL
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from '../_shared/cors.ts'
import { requireAdminOrService, authErrorResponse } from '../_shared/auth-guard.ts'

const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 1500;
const MAX_RETRIES = 2;
const PREFIX = '[WhatsAppNotif]';

// ================================================================
// WhatsApp Cloud API
// ================================================================

interface WhatsAppResult {
    messageId: string | null;
    error: string | null;
}

async function sendWhatsAppTemplate(
    phoneNumberId: string,
    accessToken: string,
    recipientPhone: string,
    templateName: string,
    templateParams: string[],
    buttonUrlSuffix?: string
): Promise<WhatsAppResult> {
    const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;

    const components: any[] = [];

    if (templateParams.length > 0) {
        components.push({
            type: 'body',
            parameters: templateParams.map(p => ({ type: 'text', text: p }))
        });
    }

    if (buttonUrlSuffix) {
        components.push({
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: buttonUrlSuffix }]
        });
    }

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    messaging_product: 'whatsapp',
                    to: recipientPhone,
                    type: 'template',
                    template: {
                        name: templateName,
                        language: { code: 'es' },
                        components
                    }
                })
            });

            const result = await res.json();

            if (result.messages?.[0]?.id) {
                return { messageId: result.messages[0].id, error: null };
            }

            const errCode = result.error?.code;
            const errMsg = result.error?.message || 'Unknown WhatsApp error';

            // Don't retry on 400-level client errors (invalid number, template not found, etc.)
            if (res.status >= 400 && res.status < 500 && errCode !== 429) {
                return { messageId: null, error: `${res.status}: ${errMsg}` };
            }

            // Rate limited (429) or server error — retry with backoff
            if (attempt < MAX_RETRIES) {
                await new Promise(r => setTimeout(r, (attempt + 1) * 2000));
                continue;
            }

            return { messageId: null, error: `${res.status}: ${errMsg} (after ${attempt + 1} attempts)` };
        } catch (fetchErr: any) {
            if (attempt < MAX_RETRIES) {
                await new Promise(r => setTimeout(r, (attempt + 1) * 2000));
                continue;
            }
            return { messageId: null, error: `Fetch error: ${fetchErr.message}` };
        }
    }

    return { messageId: null, error: 'Exhausted retries' };
}

// ================================================================
// Short.io URL Shortener
// ================================================================

async function shortenUrl(
    originalUrl: string,
    apiKey: string,
    domain: string,
    title?: string
): Promise<{ shortUrl: string; linkId: string } | null> {
    try {
        const res = await fetch('https://api.short.io/links', {
            method: 'POST',
            headers: {
                'Authorization': apiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                domain,
                originalURL: originalUrl,
                title: title || 'Derbix notification'
            })
        });

        if (!res.ok) return null;

        const data = await res.json();
        return { shortUrl: data.shortURL, linkId: String(data.id) };
    } catch {
        return null;
    }
}

// ================================================================
// Notification Content Builder
// ================================================================

interface NotificationContent {
    templateName: string;
    params: string[];
    urlPath: string;
    campaign: string;
}

function buildPredictionsReadyContent(
    userName: string,
    planName: string,
    data: any
): NotificationContent {
    const picksCount = String(data.picks_count || data.combos_count || '?');

    if (planName === 'free') {
        return {
            templateName: 'pronosticos_listos_free',
            params: [userName, picksCount],
            urlPath: '/app?tab=top-picks',
            campaign: 'predictions_ready_free'
        };
    }

    // Paid users get more detail
    const topPick = data.top_pick || 'Consulta la plataforma';

    return {
        templateName: 'pronosticos_listos_paid',
        // NOTE: WhatsApp template still expects 4 params; pass empty string for the
        // legacy parlay slot so the template accepts the payload until it can be
        // updated in Meta Business to a 3-param version.
        params: [userName, picksCount, '', topPick],
        urlPath: '/app?tab=top-picks',
        campaign: 'predictions_ready_paid'
    };
}

function buildDailyResultsContent(
    userName: string,
    planName: string,
    data: any
): NotificationContent {
    const totalVerified = String(data.picks_verified || '?');
    const accuracy = String(data.accuracy || '?');

    if (planName === 'free') {
        return {
            templateName: 'resultados_dia_free',
            params: [totalVerified, accuracy],
            urlPath: '/app?tab=roi',
            campaign: 'daily_results_free'
        };
    }

    const won = String(data.won || '0');
    const total = String(data.total || data.picks_verified || '?');
    const roi = String(data.roi || '?');
    const bestPick = data.best_pick || '';

    return {
        templateName: 'resultados_dia_paid',
        params: [userName, won, total, accuracy, roi, bestPick].filter(Boolean),
        urlPath: '/app?tab=roi',
        campaign: 'daily_results_paid'
    };
}

// ================================================================
// Data Fetchers — get stats for notification content
// ================================================================

async function fetchPredictionsStats(supabase: any, date: string) {
    const stats: any = { picks_count: 0, top_pick: '' };

    // Count high-probability picks for today
    const { count: picksCount } = await supabase
        .from('value_picks_v2')
        .select('id', { count: 'exact', head: true })
        .eq('match_date', date)
        .gte('p_model', 0.83);

    stats.picks_count = picksCount || 0;

    // Get top pick (highest probability)
    const { data: topPick } = await supabase
        .from('value_picks_v2')
        .select('home_team, away_team, market, selection, p_model')
        .eq('match_date', date)
        .gte('p_model', 0.83)
        .order('p_model', { ascending: false })
        .limit(1)
        .single();

    if (topPick) {
        const prob = Math.round((topPick.p_model || 0) * 100);
        stats.top_pick = `${topPick.home_team} vs ${topPick.away_team} - ${topPick.selection} (${prob}%)`;
    }

    return stats;
}

async function fetchResultsStats(supabase: any, date: string) {
    const stats: any = { picks_verified: 0, won: 0, lost: 0, accuracy: '0', roi: '0', best_pick: '' };

    const { data: picks } = await supabase
        .from('value_picks_v2')
        .select('result, odds, p_model, home_team, away_team, selection')
        .eq('match_date', date)
        .gte('p_model', 0.83)
        .in('result', ['WON', 'LOST']);

    if (!picks || picks.length === 0) return stats;

    const won = picks.filter((p: any) => p.result === 'WON').length;
    const lost = picks.filter((p: any) => p.result === 'LOST').length;
    const total = won + lost;
    const accuracy = total > 0 ? ((won / total) * 100).toFixed(1) : '0';

    // Simple flat-stake ROI
    let roiSum = 0;
    for (const p of picks) {
        if (p.result === 'WON') roiSum += (p.odds || 1.5) - 1;
        else roiSum -= 1;
    }
    const roi = total > 0 ? ((roiSum / total) * 100).toFixed(1) : '0';

    // Best pick
    const bestWon = picks
        .filter((p: any) => p.result === 'WON')
        .sort((a: any, b: any) => (b.odds || 0) - (a.odds || 0))[0];

    stats.picks_verified = total;
    stats.won = won;
    stats.lost = lost;
    stats.total = total;
    stats.accuracy = accuracy;
    stats.roi = roi;
    if (bestWon) {
        stats.best_pick = `${bestWon.home_team} vs ${bestWon.away_team} - ${bestWon.selection} @ ${bestWon.odds}`;
    }

    return stats;
}

// ================================================================
// MAIN HANDLER
// ================================================================

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    // SECURITY: This endpoint sends WhatsApp messages to real users (cost
    // money + reputation). Restrict to admins or internal cron callers.
    const auth = await requireAdminOrService(req);
    if (!auth.ok) return authErrorResponse(auth as any, corsHeaders);

    const logs: string[] = [];
    const log = (msg: string) => { console.log(msg); logs.push(msg); };

    try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const waPhoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
        const waAccessToken = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
        const shortIoApiKey = Deno.env.get('SHORT_IO_API_KEY');
        const shortIoDomain = Deno.env.get('SHORT_IO_DOMAIN');
        const frontendUrl = Deno.env.get('FRONTEND_URL') || 'https://derbix.co';

        if (!waPhoneNumberId || !waAccessToken) {
            log(`${PREFIX} Missing WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_ACCESS_TOKEN`);
            return new Response(JSON.stringify({ success: false, error: 'Missing WhatsApp config', logs }), {
                status: 200,
                headers: corsHeaders
            });
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // Check system toggle
        const { data: setting } = await supabase
            .from('system_settings')
            .select('value')
            .eq('key', 'whatsapp_notifications_enabled')
            .single();

        if (setting && setting.value === false) {
            log(`${PREFIX} WhatsApp notifications disabled by system_settings`);
            return new Response(JSON.stringify({ success: true, message: 'Disabled', logs }), {
                headers: corsHeaders
            });
        }

        const body = await req.json();
        const { notification_type, data: notifData } = body;

        log(`${PREFIX} Notification type: ${notification_type}`);

        // Handle test notification
        if (notification_type === 'test') {
            const testPhone = notifData?.phone;
            if (!testPhone) {
                return new Response(JSON.stringify({ success: false, error: 'Missing phone for test' }), {
                    headers: corsHeaders
                });
            }

            const result = await sendWhatsAppTemplate(
                waPhoneNumberId,
                waAccessToken,
                testPhone,
                'pronosticos_listos_free',
                ['Test', '5'],
            );

            log(`${PREFIX} Test sent to ${testPhone}: ${result.messageId || result.error}`);
            return new Response(JSON.stringify({ success: !!result.messageId, result, logs }), {
                headers: corsHeaders
            });
        }

        // Validate notification type
        if (!['predictions_ready', 'daily_results'].includes(notification_type)) {
            return new Response(JSON.stringify({ success: false, error: `Unknown type: ${notification_type}`, logs }), {
                headers: corsHeaders
            });
        }

        // Deduplication: check if we already sent this type today
        const today = new Date().toISOString().split('T')[0];
        const { count: alreadySent } = await supabase
            .from('notification_log')
            .select('id', { count: 'exact', head: true })
            .eq('notification_type', notification_type)
            .gte('created_at', `${today}T00:00:00Z`);

        if ((alreadySent || 0) > 0) {
            log(`${PREFIX} Already sent ${notification_type} today (${alreadySent} records). Skipping.`);
            return new Response(JSON.stringify({ success: true, message: 'Already sent today', logs }), {
                headers: corsHeaders
            });
        }

        // Fetch notification stats
        const targetDate = notifData?.date || today;
        let stats: any;

        if (notification_type === 'predictions_ready') {
            stats = await fetchPredictionsStats(supabase, targetDate);
            log(`${PREFIX} Stats: ${stats.picks_count} picks`);
        } else {
            stats = await fetchResultsStats(supabase, targetDate);
            log(`${PREFIX} Stats: ${stats.won}W/${stats.lost}L, accuracy=${stats.accuracy}%`);
        }

        // Query eligible users
        const { data: users, error: usersError } = await supabase
            .from('profiles')
            .select(`
                id,
                phone_number,
                phone_country_code,
                full_name
            `)
            .not('phone_number', 'is', null);

        if (usersError) {
            log(`${PREFIX} Error querying users: ${usersError.message}`);
            return new Response(JSON.stringify({ success: false, error: usersError.message, logs }), {
                status: 500,
                headers: corsHeaders
            });
        }

        if (!users || users.length === 0) {
            log(`${PREFIX} No users with phone numbers found`);
            return new Response(JSON.stringify({ success: true, message: 'No users with phones', sent: 0, logs }), {
                headers: corsHeaders
            });
        }

        log(`${PREFIX} Found ${users.length} users with phone numbers`);

        // Filter by notification preferences
        const { data: prefs } = await supabase
            .from('notification_preferences')
            .select('user_id, enabled')
            .eq('channel', 'whatsapp')
            .eq('notification_type', notification_type)
            .eq('enabled', true);

        const enabledUserIds = new Set((prefs || []).map((p: any) => p.user_id));

        // Get subscription info for all users
        const { data: subscriptions } = await supabase
            .from('user_subscriptions')
            .select('user_id, plan_id, subscription_plans(name)')
            .in('user_id', users.map((u: any) => u.id));

        const userPlanMap: Record<string, string> = {};
        for (const sub of (subscriptions || [])) {
            const planName = (sub as any).subscription_plans?.name || 'free';
            userPlanMap[sub.user_id] = planName;
        }

        // Filter users: has preferences enabled (or no preferences yet = default enabled for users with phone)
        const eligibleUsers = users.filter((u: any) => {
            // If user has explicit preferences, respect them
            if (prefs && prefs.some((p: any) => p.user_id === u.id)) {
                return enabledUserIds.has(u.id);
            }
            // No preference record yet = default enabled (they have a phone, so they opted in)
            return true;
        });

        log(`${PREFIX} Eligible users after preference filter: ${eligibleUsers.length}`);

        // Generate shortened URL (one per notification type, not per user)
        let notificationUrl = '';
        let shortUrlId = '';

        const baseUrlPath = notification_type === 'predictions_ready' ? '/app?tab=top-picks' : '/app?tab=roi';
        const fullUrl = `${frontendUrl}${baseUrlPath}&utm_source=whatsapp&utm_medium=notification&utm_campaign=${notification_type}&utm_content=${today}`;

        if (shortIoApiKey && shortIoDomain) {
            const shortened = await shortenUrl(fullUrl, shortIoApiKey, shortIoDomain, `Derbix ${notification_type} ${today}`);
            if (shortened) {
                notificationUrl = shortened.shortUrl;
                shortUrlId = shortened.linkId;
                log(`${PREFIX} Shortened URL: ${notificationUrl}`);
            } else {
                notificationUrl = fullUrl;
                log(`${PREFIX} Short.io failed, using full URL`);
            }
        } else {
            notificationUrl = fullUrl;
            log(`${PREFIX} No Short.io config, using full URL`);
        }

        // Send in batches
        let totalSent = 0;
        let totalFailed = 0;
        const logEntries: any[] = [];

        for (let i = 0; i < eligibleUsers.length; i += BATCH_SIZE) {
            const batch = eligibleUsers.slice(i, i + BATCH_SIZE);

            const results = await Promise.allSettled(
                batch.map(async (user: any) => {
                    const planName = userPlanMap[user.id] || 'free';
                    const userName = user.full_name?.split(' ')[0] || 'Usuario';
                    const mergedData = { ...stats, ...notifData };

                    let content: NotificationContent;
                    if (notification_type === 'predictions_ready') {
                        content = buildPredictionsReadyContent(userName, planName, mergedData);
                    } else {
                        content = buildDailyResultsContent(userName, planName, mergedData);
                    }

                    const waResult = await sendWhatsAppTemplate(
                        waPhoneNumberId,
                        waAccessToken,
                        user.phone_number,
                        content.templateName,
                        content.params,
                    );

                    // Log entry
                    logEntries.push({
                        user_id: user.id,
                        phone_number: user.phone_number,
                        notification_type,
                        channel: 'whatsapp',
                        template_name: content.templateName,
                        whatsapp_message_id: waResult.messageId,
                        status: waResult.messageId ? 'sent' : 'failed',
                        error_message: waResult.error,
                        short_url: notificationUrl,
                        short_url_id: shortUrlId,
                        metadata: { plan: planName, campaign: content.campaign, date: targetDate },
                        sent_at: waResult.messageId ? new Date().toISOString() : null,
                    });

                    if (waResult.messageId) {
                        totalSent++;
                    } else {
                        totalFailed++;

                        // Auto-disable if number is blocked (error 131049)
                        if (waResult.error?.includes('131049')) {
                            await supabase
                                .from('notification_preferences')
                                .update({ enabled: false, updated_at: new Date().toISOString() })
                                .eq('user_id', user.id)
                                .eq('channel', 'whatsapp')
                                .eq('notification_type', notification_type);
                            log(`${PREFIX} Auto-disabled ${notification_type} for user ${user.id} (blocked)`);
                        }
                    }
                })
            );

            // Delay between batches
            if (i + BATCH_SIZE < eligibleUsers.length) {
                await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
            }
        }

        // Bulk insert log entries
        if (logEntries.length > 0) {
            const { error: logError } = await supabase
                .from('notification_log')
                .insert(logEntries);

            if (logError) {
                log(`${PREFIX} Error inserting log entries: ${logError.message}`);
            }
        }

        log(`${PREFIX} Complete: ${totalSent} sent, ${totalFailed} failed out of ${eligibleUsers.length} eligible`);

        return new Response(JSON.stringify({
            success: true,
            sent: totalSent,
            failed: totalFailed,
            total_eligible: eligibleUsers.length,
            logs
        }), { headers: corsHeaders });

    } catch (error: any) {
        log(`${PREFIX} FATAL: ${error.message}`);
        return new Response(JSON.stringify({
            success: false,
            error: error.message,
            logs
        }), {
            status: 500,
            headers: corsHeaders
        });
    }
});
