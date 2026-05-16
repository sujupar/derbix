import React, { useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../services/supabaseService';
import { PlanSelector } from './PlanSelector';
import { ArrowRightIcon, ArrowLeftIcon, SparklesIcon } from '../icons/Icons';
import { openCheckoutOverlay, getVariantId } from '../../services/lemonSqueezyService';
import { SubscriptionPlan } from '../../services/subscriptionService';
// trackSignupWithAttribution se removió a propósito del flujo de signup —
// ver comentario dentro de handleCompleteSignUp. La función sigue exportada
// desde analyticsService por si la queremos restaurar más adelante.

/**
 * Poll the profiles table for `userId` until the row exists or the timeout
 * expires. The handle_new_user() trigger inserts the profile during the same
 * transaction as auth.signUp(), but client-side it's not guaranteed to be
 * visible immediately — so we wait briefly before firing analytics. Returns
 * true if the row appeared, false if the timeout elapsed.
 */
async function waitForProfile(userId: string, timeoutMs: number): Promise<boolean> {
    const intervalMs = 400;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const { data, error } = await supabase
            .from('profiles')
            .select('id')
            .eq('id', userId)
            .maybeSingle();
        if (data?.id) return true;
        if (error && error.code !== 'PGRST116') {
            // PGRST116 = no rows; anything else is a real error and we should
            // bail out early so the caller can decide.
            console.error('[waitForProfile] query error:', error);
            return false;
        }
        await new Promise(r => setTimeout(r, intervalMs));
    }
    return false;
}

/**
 * Read a cookie value by name. Used to grab Meta's `_fbp` (browser pixel id)
 * and `_fbc` (click id) for CAPI matching/dedup.
 */
function readCookie(name: string): string | undefined {
    if (typeof document === 'undefined') return undefined;
    const match = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.$?*|{}()[\]\\/+^]/g, '\\$&') + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : undefined;
}

interface SignUpData {
    fullName: string;
    email: string;
    password: string;
    confirmPassword: string;
    phoneNumber: string;
    phoneCountryCode: string;
    telegramUsername: string;
}

export const SignUpFlow: React.FC = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [checkoutLoading, setCheckoutLoading] = useState(false);

    const [signUpData, setSignUpData] = useState<SignUpData>({
        fullName: '',
        email: '',
        password: '',
        confirmPassword: '',
        phoneNumber: '',
        phoneCountryCode: '+57',
        telegramUsername: ''
    });

    const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlan | null>(null);
    const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annual'>(
        (searchParams.get('billing') as 'monthly' | 'annual') || 'monthly'
    );

    // Capture UTM parameters from URL for attribution tracking
    const utmSource = searchParams.get('utm_source') || undefined;
    const utmMedium = searchParams.get('utm_medium') || undefined;
    const utmCampaign = searchParams.get('utm_campaign') || undefined;
    const utmRef = searchParams.get('ref') || undefined;

    // Guardamos datos para el checkout de pago después de confirmar email
    const signUpResultRef = useRef<{ userId: string } | null>(null);

    // Step 1: User Data
    const handleStep1Submit = (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (!signUpData.fullName || !signUpData.email || !signUpData.password) {
            setError('Por favor completa todos los campos');
            return;
        }

        if (signUpData.password.length < 8) {
            setError('La contraseña debe tener al menos 8 caracteres');
            return;
        }

        // Require at least one letter and one digit. Keep the rule modest so
        // we don't add friction for users on mobile, but block the absolute
        // worst passwords ("12345678", "password").
        if (!/[A-Za-z]/.test(signUpData.password) || !/[0-9]/.test(signUpData.password)) {
            setError('La contraseña debe incluir al menos una letra y un número');
            return;
        }

        if (signUpData.password !== signUpData.confirmPassword) {
            setError('Las contraseñas no coinciden');
            return;
        }

        setStep(2);
    };

    // Step 2: Plan Selection + Registration
    const handleCompleteSignUp = async () => {
        if (!selectedPlan) {
            setError('Por favor selecciona un plan');
            return;
        }

        setLoading(true);
        setError('');

        try {
            // 1. Crear cuenta de usuario
            const { data: authData, error: authError } = await supabase.auth.signUp({
                email: signUpData.email,
                password: signUpData.password,
                options: {
                    emailRedirectTo: `${window.location.origin}/app`,
                    data: {
                        full_name: signUpData.fullName
                    }
                }
            });

            if (authError) throw authError;
            if (!authData.user) throw new Error('No se pudo crear el usuario');

            const userId = authData.user.id;

            // Wait for handle_new_user() trigger to insert the profile before
            // firing analytics. If we fire the pixel before the row exists and
            // the trigger fails (RLS, FK, etc.), Meta reports a registration
            // that has no real user in `profiles` — the "ghost registrations"
            // we saw on 2026-05-15 (Meta said 6, platform had 2). Polling up
            // to 5s is fast in practice (trigger usually fires in <500ms).
            const profileExists = await waitForProfile(userId, 5000);

            if (profileExists) {
                // DECISIÓN 2026-05-16: Meta reportaba 11 conversiones con 4
                // signups reales. La causa principal es el pixel browser
                // (cargado vía GTM) que dispara el evento sin event_id —
                // cada disparo cuenta como conversión separada, y Meta
                // suma multi-touch + view-through encima.
                //
                // El cliente no quiere tocar GTM. La solución limpia es
                // eliminar el `signup_free` push al dataLayer: GTM no
                // recibe el evento → el pixel browser no se dispara →
                // queda SOLO el CAPI server-side, que envía exactamente
                // 1 evento por signup real. Resultado: 1:1 garantizado.
                //
                // Si en el futuro queremos volver a tener tracking en GA4
                // o cualquier otro consumidor del dataLayer, basta con
                // restaurar `trackSignupWithAttribution(...)` y configurar
                // el tag de Meta Pixel en GTM para pasar `eventID` —
                // entonces Meta dedupe entre browser y server.
                const eventID = (typeof crypto !== 'undefined' && crypto.randomUUID)
                    ? crypto.randomUUID()
                    : `signup_${userId}_${Date.now()}`;

                // Server-side Conversions API es la ÚNICA fuente que dispara
                // ahora. fbp / fbc vienen de cookies para que Meta haga
                // matching del usuario contra el ad que vio (sin afectar
                // dedup, eventID basta).
                supabase.functions.invoke('meta-conversions-api', {
                    body: {
                        event_name: 'CompleteRegistration',
                        email: signUpData.email,
                        event_id: eventID,
                        source_url: typeof window !== 'undefined' ? window.location.href : undefined,
                        user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
                        fbp: readCookie('_fbp'),
                        fbc: readCookie('_fbc'),
                    },
                }).then(({ data: capiData, error: capiErr }) => {
                    if (capiErr) {
                        console.error('[signup] CAPI invoke failed:', capiErr);
                    } else if (capiData && capiData.success === false) {
                        console.error('[signup] CAPI returned success:false →', capiData);
                    } else {
                        console.log('[signup] CAPI sent (browser pixel disabled):', capiData);
                    }
                });
            } else {
                console.warn('[signup] profile row not visible after 5s — CAPI NOT fired to avoid ghost registration. User:', userId);
            }

            // Save UTM attribution to profile (fire-and-forget). Surface
            // failures in the console — silencing made the email bug
            // invisible for days.
            if (utmSource || utmMedium || utmCampaign || utmRef) {
                supabase
                    .from('profiles')
                    .update({
                        utm_source: utmSource || null,
                        utm_medium: utmMedium || null,
                        utm_campaign: utmCampaign || null,
                        utm_ref: utmRef || null,
                    })
                    .eq('id', userId)
                    .then(({ error: utmErr }) => {
                        if (utmErr) console.error('[signup] UTM update failed:', utmErr);
                    });
            }

            // Notificar admin del nuevo registro. Fire-and-forget pero con
            // logging visible: si los secrets RESEND_API_KEY o
            // ADMIN_NOTIFICATION_EMAILS faltan, el `success` viene false y
            // queremos enterarnos en la consola.
            supabase.functions.invoke('send-admin-notification', {
                body: {
                    type: 'new_registration',
                    data: {
                        name: signUpData.fullName,
                        email: signUpData.email,
                        created_at: new Date().toISOString(),
                    },
                },
            }).then(({ data: notifData, error: notifErr }) => {
                if (notifErr) {
                    console.error('[signup] admin notification failed:', notifErr);
                } else if (notifData && notifData.success === false) {
                    console.error('[signup] admin notification returned success:false →', notifData);
                } else {
                    console.log('[signup] admin notification sent:', notifData);
                }
            });

            // Guardar teléfono WhatsApp si fue proporcionado (fire-and-forget)
            if (signUpData.phoneNumber) {
                const fullPhone = `${signUpData.phoneCountryCode}${signUpData.phoneNumber}`;
                supabase
                    .from('profiles')
                    .update({
                        phone_number: fullPhone,
                        phone_country_code: signUpData.phoneCountryCode,
                    })
                    .eq('id', userId)
                    .then(({ error: phoneErr }) => {
                        if (phoneErr) console.error('[signup] phone update failed:', phoneErr);
                    });
            }

            // Guardar telegram username si fue proporcionado (fire-and-forget)
            if (signUpData.telegramUsername.trim()) {
                const tgRaw = signUpData.telegramUsername.trim();
                const tgNormalized = tgRaw.startsWith('@') ? tgRaw : `@${tgRaw}`;
                supabase
                    .from('profiles')
                    .update({ telegram_username: tgNormalized })
                    .eq('id', userId)
                    .then(({ error: tgErr }) => {
                        if (tgErr) console.error('[signup] telegram update failed:', tgErr);
                    });
            }

            // Guardar userId para posible checkout posterior
            signUpResultRef.current = { userId };

            // La suscripción free se crea automáticamente por el trigger handle_new_user()
            // Para planes de pago, el usuario irá al checkout después de confirmar email

            // Mostrar pantalla de confirmación (Step 3)
            setStep(3);
            setLoading(false);

        } catch (err: any) {
            console.error('Error en registro:', err);
            setError(err.message || 'Ocurrió un error al crear la cuenta');
            setLoading(false);
        }
    };

    // Redirigir a checkout de pago (para planes de pago, desde Step 3)
    const handleGoToCheckout = async () => {
        if (!selectedPlan || !signUpResultRef.current) return;

        setCheckoutLoading(true);
        setError('');

        try {
            const userId = signUpResultRef.current.userId;

            // Esperar a que el trigger handle_new_user() cree la org
            await new Promise(r => setTimeout(r, 2000));

            // Obtener orgId del usuario recién creado
            const { data: memberData } = await supabase
                .from('organization_members')
                .select('organization_id')
                .eq('user_id', userId)
                .limit(1)
                .maybeSingle();

            const orgId = memberData?.organization_id || userId;

            // Detectar gateway: Whop primero, luego LS
            const whopPlanId = billingPeriod === 'annual'
                ? (selectedPlan.whop_plan_id_annual || selectedPlan.whop_plan_id)
                : selectedPlan.whop_plan_id;

            if (whopPlanId) {
                const { data, error: checkoutError } = await supabase.functions.invoke('whop-create-checkout', {
                    body: {
                        whopPlanId,
                        planId: selectedPlan.id,
                        userId,
                        orgId,
                        billingPeriod,
                        email: signUpData.email,
                    }
                });

                if (checkoutError || !data?.purchase_url) {
                    throw new Error(data?.error || 'Error al crear sesión de pago. Intenta de nuevo.');
                }

                window.location.href = data.purchase_url;
            } else {
                // Fallback: Lemon Squeezy
                const variantId = getVariantId(selectedPlan, billingPeriod);
                if (!variantId) {
                    setError('Plan no disponible. Contacta soporte.');
                    setCheckoutLoading(false);
                    return;
                }

                await openCheckoutOverlay({
                    variantId,
                    userId,
                    userEmail: signUpData.email,
                    userName: signUpData.fullName,
                    orgId,
                    billingPeriod,
                });

                setTimeout(() => navigate('/app'), 2000);
            }
        } catch (err: any) {
            console.error('Error al ir al pago:', err);
            setError(err.message || 'Error al iniciar el pago');
            setCheckoutLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 flex items-center justify-center p-4">
            <div className="w-full max-w-6xl">
                {/* Progress Bar */}
                <div className="mb-8">
                    <div className="flex items-center justify-center gap-2 sm:gap-4 mb-4">
                        <div className={`flex items-center gap-2 ${step >= 1 ? 'text-brand' : 'text-slate-600'}`}>
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${step >= 1 ? 'border-brand bg-brand/20' : 'border-slate-600'}`}>
                                {step > 1 ? <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg> : '1'}
                            </div>
                            <span className="text-sm font-medium hidden sm:inline">Tus Datos</span>
                        </div>

                        <div className={`h-0.5 w-6 sm:w-12 ${step >= 2 ? 'bg-brand' : 'bg-slate-700'}`}></div>

                        <div className={`flex items-center gap-2 ${step >= 2 ? 'text-brand' : 'text-slate-600'}`}>
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${step >= 2 ? 'border-brand bg-brand/20' : 'border-slate-600'}`}>
                                {step > 2 ? <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg> : '2'}
                            </div>
                            <span className="text-sm font-medium hidden sm:inline">Elige tu Plan</span>
                        </div>

                        <div className={`h-0.5 w-6 sm:w-12 ${step >= 3 ? 'bg-brand' : 'bg-slate-700'}`}></div>

                        <div className={`flex items-center gap-2 ${step >= 3 ? 'text-brand' : 'text-slate-600'}`}>
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${step >= 3 ? 'border-brand bg-brand/20' : 'border-slate-600'}`}>
                                3
                            </div>
                            <span className="text-sm font-medium hidden sm:inline">Confirmar</span>
                        </div>
                    </div>
                </div>

                {/* Content */}
                <div className="bg-slate-900 rounded-3xl border border-white/10 p-4 sm:p-6 md:p-8 lg:p-12">
                    {step === 3 ? (
                        /* STEP 3: Email Confirmation */
                        <div className="max-w-lg mx-auto text-center py-8">
                            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-brand/20 border-2 border-brand flex items-center justify-center">
                                <svg className="w-10 h-10 text-brand" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                                </svg>
                            </div>

                            <h2 className="text-2xl sm:text-3xl font-black text-white mb-3">
                                Registro Exitoso
                            </h2>

                            <p className="text-slate-300 text-lg mb-2">
                                Te hemos enviado un correo de confirmacion a:
                            </p>
                            <p className="text-brand font-bold text-lg mb-6">
                                {signUpData.email}
                            </p>

                            <div className="bg-slate-800/50 border border-white/5 rounded-xl p-5 mb-8 text-left">
                                <h3 className="text-white font-bold text-sm mb-3 flex items-center gap-2">
                                    <svg className="w-4 h-4 text-brand" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                                    </svg>
                                    Pasos siguientes
                                </h3>
                                <ol className="space-y-2 text-sm text-slate-400">
                                    <li className="flex items-start gap-2">
                                        <span className="text-brand font-bold mt-0.5">1.</span>
                                        Abre tu bandeja de entrada y busca el correo de <strong className="text-slate-300">Derbix</strong>
                                    </li>
                                    <li className="flex items-start gap-2">
                                        <span className="text-brand font-bold mt-0.5">2.</span>
                                        Haz clic en el enlace de confirmacion del correo
                                    </li>
                                    <li className="flex items-start gap-2">
                                        <span className="text-brand font-bold mt-0.5">3.</span>
                                        {selectedPlan && selectedPlan.price_cents > 0
                                            ? 'Vuelve aqui para completar tu pago'
                                            : 'Inicia sesion y comienza a ver oportunidades'
                                        }
                                    </li>
                                </ol>
                            </div>

                            <p className="text-xs text-slate-500 mb-6">
                                Si no encuentras el correo, revisa tu carpeta de <strong className="text-slate-400">spam</strong> o <strong className="text-slate-400">correo no deseado</strong>.
                            </p>

                            {error && (
                                <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl">
                                    <p className="text-red-400 text-sm">{error}</p>
                                </div>
                            )}

                            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                                {selectedPlan && selectedPlan.price_cents > 0 ? (
                                    <button
                                        onClick={handleGoToCheckout}
                                        disabled={checkoutLoading}
                                        className="px-8 py-3 bg-gradient-to-r from-brand to-emerald-400 text-slate-900 font-bold rounded-xl hover:shadow-lg hover:shadow-brand/30 transition-all flex items-center gap-2 disabled:opacity-50"
                                    >
                                        {checkoutLoading ? (
                                            <>
                                                <div className="w-5 h-5 border-2 border-slate-900 border-t-transparent rounded-full animate-spin"></div>
                                                Preparando pago...
                                            </>
                                        ) : (
                                            <>
                                                Ir al Pago
                                                <ArrowRightIcon className="w-5 h-5" />
                                            </>
                                        )}
                                    </button>
                                ) : (
                                    <button
                                        onClick={() => navigate('/login')}
                                        className="px-8 py-3 bg-gradient-to-r from-brand to-emerald-400 text-slate-900 font-bold rounded-xl hover:shadow-lg hover:shadow-brand/30 transition-all flex items-center gap-2"
                                    >
                                        Ir al Login
                                        <ArrowRightIcon className="w-5 h-5" />
                                    </button>
                                )}
                            </div>
                        </div>
                    ) : step === 1 ? (
                        /* STEP 1: High-conversion long-form landing */
                        <div className="grid lg:grid-cols-5 gap-6 lg:gap-10 items-start">
                            {/* LEFT: Long-form landing content */}
                            <div className="lg:col-span-3 space-y-12">

                                {/* ====================================================== */}
                                {/* SECTION 1 — HOT ZONE (hero) */}
                                {/* ====================================================== */}
                                <section>
                                    {/* Urgency strip — connects with ad copy */}
                                    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand/10 border border-brand/30 mb-5">
                                        <span className="w-2 h-2 rounded-full bg-brand animate-pulse"></span>
                                        <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-brand">⚡ Pronósticos del día listos · IA · Colombia 🇨🇴</span>
                                    </div>

                                    {/* Titular */}
                                    <h1 className="text-3xl sm:text-4xl md:text-5xl font-black text-white mb-3 leading-[1.05]">
                                        El análisis <span className="text-brand">ya está hecho</span>.<br className="hidden sm:block" /> Tú solo aplica.
                                    </h1>

                                    {/* Subtitular */}
                                    <p className="text-base sm:text-lg text-slate-300 leading-relaxed mb-5">
                                        Cada día Derbix analiza con IA <strong className="text-white">+3.000 datos por partido</strong> y te entrega los pronósticos con mejor probabilidad. Sin tipsters. Sin humo. Solo datos en tu mano.
                                    </p>

                                    {/* Beneficios cortos (chips) */}
                                    <div className="flex flex-wrap gap-2 mb-5">
                                        {['IA + estadísticas', 'Datos en tiempo real', 'Plan gratis', 'Sin tarjeta'].map((b, i) => (
                                            <span key={i} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-800/60 border border-white/10 text-xs text-slate-200">
                                                <svg className="w-3 h-3 text-brand" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                                                </svg>
                                                {b}
                                            </span>
                                        ))}
                                    </div>

                                    {/* CTA primario — scroll to form on mobile */}
                                    <a href="#signup-form" className="lg:hidden inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-brand to-emerald-400 text-slate-900 font-black rounded-xl hover:shadow-lg hover:shadow-brand/30 transition-all">
                                        Crear cuenta gratis
                                        <ArrowRightIcon className="w-5 h-5" />
                                    </a>
                                    <p className="hidden lg:block text-sm text-slate-400">
                                        👉 Tu cuenta gratis está al lado derecho. 30 segundos y listo.
                                    </p>
                                </section>

                                {/* ====================================================== */}
                                {/* SECTION 2 — 3 BENEFITS */}
                                {/* ====================================================== */}
                                <section>
                                    <div className="text-center mb-6">
                                        <h2 className="text-2xl sm:text-3xl font-black text-white mb-2">Lo que hace Derbix distinto</h2>
                                        <p className="text-sm text-slate-400">Tres razones por las que +1.000 fanáticos del fútbol ya lo usan</p>
                                    </div>
                                    <div className="grid sm:grid-cols-3 gap-3">
                                        {[
                                            {
                                                icon: '🧠',
                                                title: 'IA real, no marketing',
                                                desc: 'Algoritmo que procesa +3.000 datos por partido: forma, xG, momentum, lesiones, clima.',
                                            },
                                            {
                                                icon: '📊',
                                                title: 'Historial 100% público',
                                                desc: 'Cada pronóstico queda registrado. Aciertos y fallas. Sin borrar lo que pierde.',
                                            },
                                            {
                                                icon: '🆓',
                                                title: 'Plan gratis sin tarjeta',
                                                desc: 'Empieza sin pagar. Sin trial de 7 días. Sin domiciliación. Cancela cuando quieras.',
                                            },
                                        ].map((b, i) => (
                                            <div key={i} className="bg-slate-800/50 border border-white/10 rounded-2xl p-5 hover:border-brand/30 transition-colors">
                                                <div className="text-3xl mb-3">{b.icon}</div>
                                                <h3 className="text-sm font-bold text-white mb-2">{b.title}</h3>
                                                <p className="text-xs text-slate-400 leading-relaxed">{b.desc}</p>
                                            </div>
                                        ))}
                                    </div>
                                </section>

                                {/* ====================================================== */}
                                {/* SECTION 3 — STORYTELLING */}
                                {/* ====================================================== */}
                                <section className="bg-gradient-to-br from-slate-800/40 to-slate-900/40 border border-white/10 rounded-3xl p-6 sm:p-8">
                                    <div className="text-center mb-6">
                                        <span className="inline-block px-3 py-1 rounded-full bg-brand/10 border border-brand/30 text-[10px] font-bold uppercase tracking-wider text-brand mb-3">Historia real</span>
                                        <h2 className="text-2xl sm:text-3xl font-black text-white">Antes del análisis vs. después</h2>
                                    </div>
                                    <div className="grid sm:grid-cols-2 gap-4">
                                        {/* Antes */}
                                        <div className="bg-red-500/5 border border-red-500/20 rounded-2xl p-5">
                                            <div className="text-xs font-bold uppercase tracking-wider text-red-400 mb-3">❌ Antes de Derbix</div>
                                            <ul className="space-y-2.5 text-sm text-slate-300">
                                                <li className="flex items-start gap-2">
                                                    <span className="text-red-400 mt-0.5">·</span>
                                                    <span>Veía un partido y apostaba a corazonada</span>
                                                </li>
                                                <li className="flex items-start gap-2">
                                                    <span className="text-red-400 mt-0.5">·</span>
                                                    <span>Pagaba a tipsters de Instagram que prometían el oro</span>
                                                </li>
                                                <li className="flex items-start gap-2">
                                                    <span className="text-red-400 mt-0.5">·</span>
                                                    <span>Cuando perdían, borraban el pick y desaparecían</span>
                                                </li>
                                                <li className="flex items-start gap-2">
                                                    <span className="text-red-400 mt-0.5">·</span>
                                                    <span>Sin manera de validar si tenían razón</span>
                                                </li>
                                            </ul>
                                        </div>
                                        {/* Después */}
                                        <div className="bg-brand/5 border border-brand/30 rounded-2xl p-5">
                                            <div className="text-xs font-bold uppercase tracking-wider text-brand mb-3">✅ Con Derbix</div>
                                            <ul className="space-y-2.5 text-sm text-slate-200">
                                                <li className="flex items-start gap-2">
                                                    <span className="text-brand mt-0.5">·</span>
                                                    <span>Reviso datos antes de cualquier movimiento</span>
                                                </li>
                                                <li className="flex items-start gap-2">
                                                    <span className="text-brand mt-0.5">·</span>
                                                    <span>El algoritmo me muestra solo lo más prometedor</span>
                                                </li>
                                                <li className="flex items-start gap-2">
                                                    <span className="text-brand mt-0.5">·</span>
                                                    <span>Historial público: aciertos y fallas, todo visible</span>
                                                </li>
                                                <li className="flex items-start gap-2">
                                                    <span className="text-brand mt-0.5">·</span>
                                                    <span>Plan gratis. Decido yo con cabeza, no corazón</span>
                                                </li>
                                            </ul>
                                        </div>
                                    </div>
                                </section>

                                {/* ====================================================== */}
                                {/* SECTION 4 — CTA MID */}
                                {/* ====================================================== */}
                                <section className="text-center">
                                    <h3 className="text-xl sm:text-2xl font-black text-white mb-3">¿Sigues apostando a corazonada?</h3>
                                    <p className="text-sm text-slate-400 mb-5">Únete y deja que la IA haga el análisis por ti.</p>
                                    <a href="#signup-form" className="inline-flex items-center gap-2 px-7 py-3.5 bg-gradient-to-r from-brand to-emerald-400 text-slate-900 font-black rounded-xl hover:shadow-lg hover:shadow-brand/30 transition-all">
                                        Empezar gratis ahora
                                        <ArrowRightIcon className="w-5 h-5" />
                                    </a>
                                </section>

                                {/* ====================================================== */}
                                {/* SECTION 5 — KEY BENEFITS */}
                                {/* ====================================================== */}
                                <section>
                                    <div className="mb-5">
                                        <span className="inline-block px-3 py-1 rounded-full bg-brand/10 border border-brand/30 text-[10px] font-bold uppercase tracking-wider text-brand mb-3">Lo más importante</span>
                                        <h2 className="text-2xl sm:text-3xl font-black text-white mb-2">Por qué importa</h2>
                                        <p className="text-sm text-slate-400">Datos verificables. Sin promesas vacías.</p>
                                    </div>
                                    <div className="grid sm:grid-cols-2 gap-3">
                                        {[
                                            {
                                                num: '+3.000',
                                                label: 'Datos por partido',
                                                desc: 'Estadísticas, forma reciente, xG, momentum, lesiones, clima, head-to-head.',
                                            },
                                            {
                                                num: '65%',
                                                label: 'Acierto verificado',
                                                desc: 'Win rate medido en pronósticos con probabilidad ≥ 83%, registrado públicamente.',
                                            },
                                            {
                                                num: '83%+',
                                                label: 'Probabilidad mín.',
                                                desc: 'Filtro estricto: solo recibes lo que el modelo evalúa como alta probabilidad.',
                                            },
                                            {
                                                num: '100%',
                                                label: 'Histórico público',
                                                desc: 'Cada pronóstico verificado en tiempo real. Cero borrado de picks perdedores.',
                                            },
                                        ].map((b, i) => (
                                            <div key={i} className="bg-slate-800/50 border border-brand/20 rounded-2xl p-5">
                                                <div className="text-3xl font-black text-brand mb-1">{b.num}</div>
                                                <div className="text-sm font-bold text-white mb-2">{b.label}</div>
                                                <p className="text-xs text-slate-400 leading-relaxed">{b.desc}</p>
                                            </div>
                                        ))}
                                    </div>
                                </section>

                                {/* ====================================================== */}
                                {/* SECTION 6 — FINAL CTA */}
                                {/* ====================================================== */}
                                <section className="text-center bg-gradient-to-br from-brand/10 via-slate-900 to-slate-900 border border-brand/30 rounded-3xl p-6 sm:p-10">
                                    <div className="text-4xl mb-3">⚡</div>
                                    <h3 className="text-2xl sm:text-3xl font-black text-white mb-3">Los pronósticos de hoy ya están listos</h3>
                                    <p className="text-base text-slate-300 mb-6 max-w-md mx-auto">
                                        No esperes mañana. Únete gratis ahora y revisa el análisis de los partidos del día.
                                    </p>
                                    <a href="#signup-form" className="inline-flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-brand to-emerald-400 text-slate-900 font-black rounded-xl hover:shadow-lg hover:shadow-brand/30 transition-all text-base">
                                        Crear cuenta gratis
                                        <ArrowRightIcon className="w-5 h-5" />
                                    </a>
                                    <p className="text-[11px] text-slate-500 mt-4">30 segundos · sin tarjeta · cancela cuando quieras</p>
                                </section>
                            </div>

                            {/* RIGHT: Form */}
                            <div id="signup-form" className="lg:col-span-2 lg:sticky lg:top-8 scroll-mt-8">
                                <div className="bg-slate-800/50 backdrop-blur border border-white/10 rounded-2xl p-5 sm:p-6">
                                    <div className="text-center mb-5">
                                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand/10 border border-brand/30 mb-3">
                                            <SparklesIcon className="w-3.5 h-3.5 text-brand" />
                                            <span className="text-[10px] font-bold uppercase tracking-wider text-brand">30 segundos</span>
                                        </div>
                                        <h2 className="text-xl sm:text-2xl font-black text-white mb-1">Crea tu cuenta gratis</h2>
                                        <p className="text-xs text-slate-400">Empieza a ver oportunidades hoy</p>
                                    </div>

                                    <form onSubmit={handleStep1Submit} className="space-y-3">
                                        <input
                                            type="text"
                                            value={signUpData.fullName}
                                            onChange={(e) => setSignUpData({ ...signUpData, fullName: e.target.value })}
                                            className="w-full px-4 py-3 bg-slate-900 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-brand transition-colors"
                                            placeholder="Nombre completo"
                                            required
                                        />
                                        <input
                                            type="email"
                                            value={signUpData.email}
                                            onChange={(e) => setSignUpData({ ...signUpData, email: e.target.value })}
                                            className="w-full px-4 py-3 bg-slate-900 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-brand transition-colors"
                                            placeholder="Tu email"
                                            required
                                        />
                                        <input
                                            type="password"
                                            value={signUpData.password}
                                            onChange={(e) => setSignUpData({ ...signUpData, password: e.target.value })}
                                            className="w-full px-4 py-3 bg-slate-900 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-brand transition-colors"
                                            placeholder="Contraseña (mín. 6)"
                                            required
                                            minLength={8}
                                        />
                                        <input
                                            type="password"
                                            value={signUpData.confirmPassword}
                                            onChange={(e) => setSignUpData({ ...signUpData, confirmPassword: e.target.value })}
                                            className="w-full px-4 py-3 bg-slate-900 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-brand transition-colors"
                                            placeholder="Repite la contraseña"
                                            required
                                            minLength={8}
                                        />

                                        {error && (
                                            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl">
                                                <p className="text-red-400 text-xs">{error}</p>
                                            </div>
                                        )}

                                        <button
                                            type="submit"
                                            className="w-full py-3.5 bg-gradient-to-r from-brand to-emerald-400 text-slate-900 font-black rounded-xl hover:shadow-lg hover:shadow-brand/30 transition-all flex items-center justify-center gap-2"
                                        >
                                            Empezar gratis
                                            <ArrowRightIcon className="w-5 h-5" />
                                        </button>

                                        <p className="text-[10px] text-slate-500 text-center leading-relaxed pt-1">
                                            Al registrarte aceptas nuestros{' '}
                                            <a href="/terms" className="text-slate-400 hover:text-brand underline">Términos</a> y{' '}
                                            <a href="/privacy" className="text-slate-400 hover:text-brand underline">Privacidad</a>
                                        </p>

                                        <div className="pt-3 border-t border-white/5 text-center">
                                            <p className="text-xs text-slate-400">
                                                ¿Ya tienes cuenta?{' '}
                                                <button
                                                    type="button"
                                                    onClick={() => navigate('/login')}
                                                    className="text-brand hover:text-emerald-400 font-bold"
                                                >
                                                    Inicia sesión
                                                </button>
                                            </p>
                                        </div>
                                    </form>
                                </div>

                                {/* Mini trust row */}
                                <div className="mt-4 flex items-center justify-center gap-4 text-[10px] sm:text-xs text-slate-500">
                                    <div className="flex items-center gap-1.5">
                                        <svg className="w-3.5 h-3.5 text-brand" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        Sin tarjeta
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <svg className="w-3.5 h-3.5 text-brand" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                                        </svg>
                                        Cancela cuando quieras
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        /* STEP 2: Plan Selection */
                        <div>
                            <PlanSelector
                                selectedPlan={selectedPlan}
                                onSelectPlan={setSelectedPlan}
                                billingPeriod={billingPeriod}
                                onBillingPeriodChange={setBillingPeriod}
                            />

                            {error && (
                                <div className="mt-6 p-4 bg-red-500/10 border border-red-500/30 rounded-xl max-w-2xl mx-auto">
                                    <p className="text-red-400 text-sm text-center">{error}</p>
                                </div>
                            )}

                            <div className="flex items-center justify-center gap-4 mt-8">
                                <button
                                    onClick={() => setStep(1)}
                                    disabled={loading}
                                    className="px-6 py-3 bg-slate-800 text-white font-medium rounded-xl hover:bg-slate-700 transition-colors flex items-center gap-2 disabled:opacity-50"
                                >
                                    <ArrowLeftIcon className="w-5 h-5" />
                                    Atrás
                                </button>

                                <button
                                    onClick={handleCompleteSignUp}
                                    disabled={!selectedPlan || loading}
                                    className="px-8 py-3 bg-gradient-to-r from-brand to-emerald-400 text-slate-900 font-bold rounded-xl hover:shadow-lg hover:shadow-brand/30 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {loading ? (
                                        <>
                                            <div className="w-5 h-5 border-2 border-slate-900 border-t-transparent rounded-full animate-spin"></div>
                                            Procesando...
                                        </>
                                    ) : (
                                        <>
                                            {selectedPlan?.price_cents === 0 ? 'Comenzar Gratis' : 'Continuar al Pago'}
                                            <ArrowRightIcon className="w-5 h-5" />
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Trust Indicators */}
                <div className="mt-8 text-center">
                    <div className="flex items-center justify-center gap-6 text-sm text-slate-500">
                        <div className="flex items-center gap-2">
                            <div className="w-4 h-4 rounded-full bg-green-500"></div>
                            <span>+1,250 usuarios</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-4 h-4 rounded-full bg-brand"></div>
                            <span>65% acierto verificado</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-4 h-4 rounded-full bg-blue-500"></div>
                            <span>Pago seguro</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
