import React, { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import {
    getNotificationPreferences,
    updateNotificationPreference,
    updatePhoneNumber,
    sendTestNotification,
} from '../../services/notificationService';
import { PaperAirplaneIcon, CheckCircleIcon, XCircleIcon } from '../icons/Icons';
import type { NotificationPreference } from '../../types';

const COUNTRY_CODES = [
    { code: '+57', label: '+57 CO' },
    { code: '+52', label: '+52 MX' },
    { code: '+54', label: '+54 AR' },
    { code: '+56', label: '+56 CL' },
    { code: '+51', label: '+51 PE' },
    { code: '+593', label: '+593 EC' },
    { code: '+58', label: '+58 VE' },
    { code: '+34', label: '+34 ES' },
    { code: '+1', label: '+1 US' },
];

interface Props {
    onClose?: () => void;
}

export const NotificationPreferences: React.FC<Props> = ({ onClose }) => {
    const { user, profile } = useAuth();
    const [preferences, setPreferences] = useState<NotificationPreference[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testSending, setTestSending] = useState(false);
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

    // Phone state
    const [phoneNumber, setPhoneNumber] = useState('');
    const [countryCode, setCountryCode] = useState('+57');
    const [phoneSaved, setPhoneSaved] = useState(false);

    useEffect(() => {
        if (user) loadPreferences();
    }, [user]);

    useEffect(() => {
        if (profile?.phone_number) {
            // Extract country code and number from full phone
            const found = COUNTRY_CODES.find(c => profile.phone_number?.startsWith(c.code));
            if (found) {
                setCountryCode(found.code);
                setPhoneNumber(profile.phone_number.slice(found.code.length));
            } else {
                setPhoneNumber(profile.phone_number);
            }
        }
    }, [profile]);

    const loadPreferences = async () => {
        if (!user) return;
        setLoading(true);
        const prefs = await getNotificationPreferences(user.id);
        setPreferences(prefs);
        setLoading(false);
    };

    const isEnabled = (type: string): boolean => {
        const pref = preferences.find(p => p.channel === 'whatsapp' && p.notification_type === type);
        return pref ? pref.enabled : true; // Default enabled
    };

    const handleToggle = async (type: string) => {
        if (!user) return;
        setSaving(true);
        const newValue = !isEnabled(type);
        const success = await updateNotificationPreference(user.id, 'whatsapp', type, newValue);
        if (success) {
            setPreferences(prev => {
                const existing = prev.find(p => p.channel === 'whatsapp' && p.notification_type === type);
                if (existing) {
                    return prev.map(p =>
                        p.channel === 'whatsapp' && p.notification_type === type
                            ? { ...p, enabled: newValue }
                            : p
                    );
                }
                return [...prev, {
                    id: crypto.randomUUID(),
                    user_id: user.id,
                    channel: 'whatsapp' as const,
                    notification_type: type as any,
                    enabled: newValue,
                }];
            });
        }
        setSaving(false);
    };

    const handleSavePhone = async () => {
        if (!user) return;
        setSaving(true);
        const success = await updatePhoneNumber(user.id, phoneNumber, countryCode);
        if (success) {
            setPhoneSaved(true);
            setTimeout(() => setPhoneSaved(false), 2000);
        }
        setSaving(false);
    };

    const handleSendTest = async () => {
        if (!phoneNumber) return;
        setTestSending(true);
        setTestResult(null);
        const fullPhone = `${countryCode}${phoneNumber}`;
        const result = await sendTestNotification(fullPhone);
        setTestResult({
            success: result.success,
            message: result.success ? 'Mensaje de prueba enviado' : (result.error || 'Error al enviar'),
        });
        setTestSending(false);
        setTimeout(() => setTestResult(null), 5000);
    };

    if (loading) {
        return (
            <div className="p-6 flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-dx-green border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-dx-green/10">
                        <PaperAirplaneIcon className="w-6 h-6 text-dx-green" />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-white">Notificaciones WhatsApp</h3>
                        <p className="text-sm text-dx-text-soft">Recibe alertas directamente en tu WhatsApp</p>
                    </div>
                </div>
                {onClose && (
                    <button onClick={onClose} className="text-dx-text-soft hover:text-white transition-colors">
                        <XCircleIcon className="w-6 h-6" />
                    </button>
                )}
            </div>

            {/* Phone number */}
            <div className="p-4 rounded-xl bg-dx-surface-2/50 border border-dx-border">
                <label className="block text-sm font-medium text-dx-text-soft mb-2">
                    Numero de WhatsApp
                </label>
                <div className="flex gap-2">
                    <select
                        value={countryCode}
                        onChange={(e) => setCountryCode(e.target.value)}
                        className="w-28 px-3 py-2.5 bg-dx-surface border border-dx-border rounded-lg text-white text-sm focus:outline-none focus:border-dx-green transition-colors"
                    >
                        {COUNTRY_CODES.map(c => (
                            <option key={c.code} value={c.code}>{c.label}</option>
                        ))}
                    </select>
                    <input
                        type="tel"
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value.replace(/[^0-9]/g, ''))}
                        className="flex-1 px-4 py-2.5 bg-dx-surface border border-dx-border rounded-lg text-white focus:outline-none focus:border-dx-green transition-colors"
                        placeholder="300 123 4567"
                    />
                    <button
                        onClick={handleSavePhone}
                        disabled={saving || !phoneNumber}
                        className={`px-4 py-2.5 text-sm font-bold rounded-lg transition-all ${
                            phoneSaved
                                ? 'bg-dx-green/20 text-dx-green border border-dx-green/50'
                                : 'bg-dx-green text-white hover:bg-dx-green disabled:opacity-50'
                        }`}
                    >
                        {phoneSaved ? 'Guardado' : 'Guardar'}
                    </button>
                </div>
            </div>

            {/* Notification toggles */}
            <div className="space-y-3">
                {/* Predictions ready */}
                <div className="p-4 rounded-xl bg-dx-surface-2/50 border border-dx-border flex items-center justify-between">
                    <div>
                        <h4 className="font-medium text-white">Pronosticos listos</h4>
                        <p className="text-xs text-dx-text-soft mt-0.5">Recibe una alerta cuando los analisis del dia estan disponibles (~4:00 AM)</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input
                            type="checkbox"
                            className="sr-only peer"
                            checked={isEnabled('predictions_ready')}
                            onChange={() => handleToggle('predictions_ready')}
                            disabled={saving}
                        />
                        <div className="w-11 h-6 bg-dx-surface-2 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-dx-green rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-dx-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-dx-green"></div>
                    </label>
                </div>

                {/* Daily results */}
                <div className="p-4 rounded-xl bg-dx-surface-2/50 border border-dx-border flex items-center justify-between">
                    <div>
                        <h4 className="font-medium text-white">Resultados del dia</h4>
                        <p className="text-xs text-dx-text-soft mt-0.5">Recibe un resumen del rendimiento cuando se verifican los resultados</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input
                            type="checkbox"
                            className="sr-only peer"
                            checked={isEnabled('daily_results')}
                            onChange={() => handleToggle('daily_results')}
                            disabled={saving}
                        />
                        <div className="w-11 h-6 bg-dx-surface-2 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-dx-green rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-dx-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-dx-green"></div>
                    </label>
                </div>
            </div>

            {/* Test notification */}
            {phoneNumber && (
                <div className="p-4 rounded-xl bg-dx-surface-2/50 border border-dx-border">
                    <div className="flex items-center justify-between">
                        <div>
                            <h4 className="font-medium text-white text-sm">Enviar mensaje de prueba</h4>
                            <p className="text-xs text-dx-text-soft">Verifica que tu WhatsApp recibe notificaciones</p>
                        </div>
                        <button
                            onClick={handleSendTest}
                            disabled={testSending}
                            className="px-4 py-2 text-sm font-bold bg-dx-surface-2 text-white rounded-lg hover:bg-dx-surface-2 transition-colors disabled:opacity-50 flex items-center gap-2"
                        >
                            {testSending ? (
                                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            ) : (
                                <PaperAirplaneIcon className="w-4 h-4" />
                            )}
                            {testSending ? 'Enviando...' : 'Enviar'}
                        </button>
                    </div>
                    {testResult && (
                        <div className={`mt-3 p-2 rounded-lg text-sm flex items-center gap-2 ${
                            testResult.success
                                ? 'bg-dx-green/10 text-dx-green border border-dx-green/30'
                                : 'bg-dx-loss/10 text-dx-loss border border-dx-loss/30'
                        }`}>
                            {testResult.success ? (
                                <CheckCircleIcon className="w-4 h-4" />
                            ) : (
                                <XCircleIcon className="w-4 h-4" />
                            )}
                            {testResult.message}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
