import React, { useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../services/supabaseService';
import { PlanSelector } from './PlanSelector';
import { ArrowRightIcon, ArrowLeftIcon, SparklesIcon } from '../icons/Icons';
import { openCheckoutOverlay, getVariantId } from '../../services/lemonSqueezyService';
import { SubscriptionPlan } from '../../services/subscriptionService';
import { trackSignupWithAttribution } from '../../services/analyticsService';

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

        if (signUpData.password.length < 6) {
            setError('La contraseña debe tener al menos 6 caracteres');
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

            // Track successful signup with UTM attribution
            trackSignupWithAttribution({ utmSource, utmMedium, utmCampaign, utmRef });

            // Save UTM attribution to profile (fire-and-forget)
            if (utmSource || utmMedium || utmCampaign || utmRef) {
                supabase
                    .from('profiles')
                    .update({
                        utm_source: utmSource || null,
                        utm_medium: utmMedium || null,
                        utm_campaign: utmCampaign || null,
                        utm_ref: utmRef || null,
                    })
                    .eq('id', authData.user.id)
                    .then(() => {})
                    .catch(() => {});
            }

            // Notificar admin del nuevo registro (fire-and-forget, no bloquea el flujo)
            supabase.functions.invoke('send-admin-notification', {
                body: {
                    type: 'new_registration',
                    data: {
                        name: signUpData.fullName,
                        email: signUpData.email,
                        created_at: new Date().toISOString()
                    }
                }
            }).catch(() => {}); // Silencioso — el registro no depende de esto

            // Guardar teléfono WhatsApp si fue proporcionado (fire-and-forget)
            if (signUpData.phoneNumber) {
                const fullPhone = `${signUpData.phoneCountryCode}${signUpData.phoneNumber}`;
                supabase
                    .from('profiles')
                    .update({
                        phone_number: fullPhone,
                        phone_country_code: signUpData.phoneCountryCode
                    })
                    .eq('id', authData.user.id)
                    .then(() => {})
                    .catch(() => {});
            }

            // Guardar telegram username si fue proporcionado (fire-and-forget)
            if (signUpData.telegramUsername.trim()) {
                const tgRaw = signUpData.telegramUsername.trim();
                const tgNormalized = tgRaw.startsWith('@') ? tgRaw : `@${tgRaw}`;
                supabase
                    .from('profiles')
                    .update({ telegram_username: tgNormalized })
                    .eq('id', authData.user.id)
                    .then(() => {})
                    .catch(() => {});
            }

            // Guardar userId para posible checkout posterior
            signUpResultRef.current = { userId: authData.user.id };

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
                        /* STEP 1: User Data */
                        <div className="max-w-md mx-auto">
                            {/* Context banner for ads traffic */}
                            <div className="mb-6">
                                <div className="bg-brand/5 border border-brand/20 rounded-2xl p-5 text-center">
                                    <h2 className="text-lg sm:text-xl font-bold text-white mb-3">
                                        ⚡ Estás a 30 segundos de tener tus pronósticos del día
                                    </h2>
                                    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-slate-300">
                                        <span className="flex items-center gap-1">
                                            <svg className="w-3.5 h-3.5 text-brand" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                                            </svg>
                                            Sin tarjeta de crédito
                                        </span>
                                        <span className="flex items-center gap-1">
                                            <svg className="w-3.5 h-3.5 text-brand" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                                            </svg>
                                            Plan gratis disponible
                                        </span>
                                        <span className="flex items-center gap-1">
                                            <svg className="w-3.5 h-3.5 text-brand" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                                            </svg>
                                            Resultados 100% verificables
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <div className="text-center mb-8">
                                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-brand/10 border border-brand/20 mb-4">
                                    <SparklesIcon className="w-4 h-4 text-brand" />
                                    <span className="text-xs font-bold uppercase tracking-wider text-brand">Únete Ahora</span>
                                </div>
                                <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white mb-2">Crea tu Cuenta</h1>
                                <p className="text-slate-400">Accede a oportunidades de alto valor en segundos</p>
                            </div>

                            <form onSubmit={handleStep1Submit} className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-2">
                                        Nombre Completo
                                    </label>
                                    <input
                                        type="text"
                                        value={signUpData.fullName}
                                        onChange={(e) => setSignUpData({ ...signUpData, fullName: e.target.value })}
                                        className="w-full px-4 py-3 bg-slate-800 border border-white/10 rounded-xl text-white focus:outline-none focus:border-brand transition-colors"
                                        placeholder="Juan Pérez"
                                        required
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-2">
                                        Email
                                    </label>
                                    <input
                                        type="email"
                                        value={signUpData.email}
                                        onChange={(e) => setSignUpData({ ...signUpData, email: e.target.value })}
                                        className="w-full px-4 py-3 bg-slate-800 border border-white/10 rounded-xl text-white focus:outline-none focus:border-brand transition-colors"
                                        placeholder="tu@email.com"
                                        required
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-2">
                                        Contraseña
                                    </label>
                                    <input
                                        type="password"
                                        value={signUpData.password}
                                        onChange={(e) => setSignUpData({ ...signUpData, password: e.target.value })}
                                        className="w-full px-4 py-3 bg-slate-800 border border-white/10 rounded-xl text-white focus:outline-none focus:border-brand transition-colors"
                                        placeholder="Mínimo 6 caracteres"
                                        required
                                        minLength={6}
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-2">
                                        Confirmar Contraseña
                                    </label>
                                    <input
                                        type="password"
                                        value={signUpData.confirmPassword}
                                        onChange={(e) => setSignUpData({ ...signUpData, confirmPassword: e.target.value })}
                                        className="w-full px-4 py-3 bg-slate-800 border border-white/10 rounded-xl text-white focus:outline-none focus:border-brand transition-colors"
                                        placeholder="Repite tu contraseña"
                                        required
                                        minLength={6}
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-2">
                                        WhatsApp <span className="text-slate-500 font-normal">(opcional)</span>
                                    </label>
                                    <div className="flex gap-2">
                                        <select
                                            value={signUpData.phoneCountryCode}
                                            onChange={(e) => setSignUpData({ ...signUpData, phoneCountryCode: e.target.value })}
                                            className="w-28 px-3 py-3 bg-slate-800 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-brand transition-colors"
                                        >
                                            <option value="+57">+57 CO</option>
                                            <option value="+52">+52 MX</option>
                                            <option value="+54">+54 AR</option>
                                            <option value="+56">+56 CL</option>
                                            <option value="+51">+51 PE</option>
                                            <option value="+593">+593 EC</option>
                                            <option value="+58">+58 VE</option>
                                            <option value="+34">+34 ES</option>
                                            <option value="+1">+1 US</option>
                                        </select>
                                        <input
                                            type="tel"
                                            value={signUpData.phoneNumber}
                                            onChange={(e) => setSignUpData({
                                                ...signUpData,
                                                phoneNumber: e.target.value.replace(/[^0-9]/g, '')
                                            })}
                                            className="flex-1 px-4 py-3 bg-slate-800 border border-white/10 rounded-xl text-white focus:outline-none focus:border-brand transition-colors"
                                            placeholder="300 123 4567"
                                        />
                                    </div>
                                    <p className="text-xs text-slate-500 mt-1">
                                        Recibe alertas de oportunidades y resultados por WhatsApp
                                    </p>
                                </div>

                                <div>
                                    <label className="block text-sm text-slate-300 mb-2">
                                        Tu usuario de Telegram <span className="text-slate-500">(opcional)</span>
                                    </label>
                                    <input
                                        type="text"
                                        value={signUpData.telegramUsername}
                                        onChange={(e) => setSignUpData({
                                            ...signUpData,
                                            telegramUsername: e.target.value.replace(/\s/g, '')
                                        })}
                                        className="w-full px-4 py-3 bg-slate-800 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-brand transition-colors"
                                        placeholder="@tu_usuario"
                                    />
                                    <p className="text-xs text-slate-500 mt-1">
                                        Si te suscribes al canal, te damos la bienvenida con tu @ al final del día.
                                    </p>
                                </div>

                                {error && (
                                    <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl">
                                        <p className="text-red-400 text-sm">{error}</p>
                                    </div>
                                )}

                                <button
                                    type="submit"
                                    className="w-full py-4 bg-gradient-to-r from-brand to-emerald-400 text-slate-900 font-bold rounded-xl hover:shadow-lg hover:shadow-brand/30 transition-all flex items-center justify-center gap-2"
                                >
                                    Continuar
                                    <ArrowRightIcon className="w-5 h-5" />
                                </button>

                                <p className="text-center text-sm text-slate-400 mt-4">
                                    ¿Ya tienes cuenta?{' '}
                                    <button
                                        type="button"
                                        onClick={() => navigate('/login')}
                                        className="text-brand hover:text-emerald-400 font-medium"
                                    >
                                        Inicia Sesión
                                    </button>
                                </p>
                            </form>
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
                            <span>75% accuracy</span>
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
