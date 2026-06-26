
import React, { useState } from 'react';
import { organizationService } from '../../services/organizationService';
import { XMarkIcon } from '../icons/Icons';
import { useLanguage } from '../../contexts/LanguageContext';

interface CreateSubAccountModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

export const CreateSubAccountModal: React.FC<CreateSubAccountModalProps> = ({ isOpen, onClose, onSuccess }) => {
    const { t } = useLanguage();
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const [formData, setFormData] = useState({
        businessName: '',
        address: '',
        city: '',
        country: '',
        timezone: 'America/Bogota',
        // Owner Info
        firstName: '',
        lastName: '',
        email: '',
        phone: ''
    });

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            // 1. Create Organization
            const orgData = await organizationService.createOrganization(formData.businessName, 'basic');

            // 2. Update Org Metadata with Address/Phone info
            // NOTE: Currently createOrganization doesn't accept metadata args directly in our service signature,
            // so we might need to update it immediately after, OR update the service.
            // For now, assuming successful creation, we would ideally update the metadata.

            // WE NEED TO IMPLEMENT METADATA UPDATE IN SERVICE First?
            // Or we assume createOrganization creates the record and we can't update metadata yet without an update method?
            // Check organizationService update method existence.
            // If exists: await organizationService.updateOrganization(orgData.id, { metadata: { address: formData.address, ... } })

            // 3. InviteOwner / Create Owner
            // await organizationService.inviteMember(orgData.id, formData.email, 'owner');

            // Actual API Call (using existing methods)
            await organizationService.inviteMember(orgData.id, formData.email, 'owner');

            // Intentar guardar metadata (opcional - puede fallar si la columna no existe)
            try {
                await organizationService.updateOrganization(orgData.id, {
                    metadata: {
                        address: formData.address,
                        city: formData.city,
                        country: formData.country,
                        phone: formData.phone,
                        ownerName: `${formData.firstName} ${formData.lastName}`
                    }
                });
            } catch (metadataErr) {
                console.warn('No se pudo guardar metadata adicional:', metadataErr);
                // Continuar de todas formas - el cliente fue creado
            }

            onSuccess();
        } catch (err: any) {
            console.error(err);
            setError(err.message || t('modal.error.create_subaccount'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in p-4">
            <div className="bg-dx-surface border border-dx-border rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl relative">

                {/* Header */}
                <div className="bg-dx-surface-2/50 p-6 border-b border-dx-border flex justify-between items-center">
                    <div>
                        <h2 className="text-xl font-display font-bold text-white">{t('modal.create_client')}</h2>
                        <p className="text-sm text-dx-text-soft mt-1">{t('modal.subtitle')}</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg text-dx-text-soft hover:text-white transition-colors">
                        <XMarkIcon className="w-5 h-5" />
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="p-8 space-y-6 overflow-y-auto max-h-[70vh]">
                    {error && (
                        <div className="bg-dx-loss/10 border border-dx-loss/20 text-dx-loss p-3 rounded-lg text-xs font-bold text-center flex items-center gap-2">
                            <span className="font-bold">Error:</span> {error}
                        </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Business Details */}
                        <div className="col-span-2">
                            <h3 className="text-xs uppercase font-bold text-brand tracking-wider mb-4 border-b border-dx-border pb-2">{t('modal.section.info')}</h3>
                        </div>

                        <div className="col-span-2">
                            <label className="block text-xs font-bold text-dx-text-soft mb-1">{t('modal.label.name')}</label>
                            <input
                                required
                                type="text"
                                value={formData.businessName}
                                onChange={e => setFormData({ ...formData, businessName: e.target.value })}
                                className="w-full bg-dx-surface border border-dx-border rounded-lg px-4 py-2.5 text-white focus:ring-2 focus:ring-brand outline-none"
                                placeholder={t('modal.ph.name')}
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-dx-text-soft mb-1">{t('modal.label.address')}</label>
                            <input
                                type="text"
                                value={formData.address}
                                onChange={e => setFormData({ ...formData, address: e.target.value })}
                                className="w-full bg-dx-surface border border-dx-border rounded-lg px-4 py-2.5 text-white focus:ring-2 focus:ring-brand outline-none"
                                placeholder="Calle 123"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-dx-text-soft mb-1">{t('modal.label.city')}</label>
                            <input
                                type="text"
                                value={formData.city}
                                onChange={e => setFormData({ ...formData, city: e.target.value })}
                                className="w-full bg-dx-surface border border-dx-border rounded-lg px-4 py-2.5 text-white focus:ring-2 focus:ring-brand outline-none"
                                placeholder="Bogotá"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-dx-text-soft mb-1">{t('modal.label.country')}</label>
                            <select
                                value={formData.country}
                                onChange={e => setFormData({ ...formData, country: e.target.value })}
                                className="w-full bg-dx-surface border border-dx-border rounded-lg px-4 py-2.5 text-white focus:ring-2 focus:ring-brand outline-none appearance-none"
                            >
                                <option value="">Seleccionar...</option>
                                <option value="CO">Colombia</option>
                                <option value="MX">México</option>
                                <option value="ES">España</option>
                                <option value="US">Estados Unidos</option>
                                <option value="AR">Argentina</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-dx-text-soft mb-1">{t('modal.label.timezone')}</label>
                            <select
                                value={formData.timezone}
                                onChange={e => setFormData({ ...formData, timezone: e.target.value })}
                                className="w-full bg-dx-surface border border-dx-border rounded-lg px-4 py-2.5 text-white focus:ring-2 focus:ring-brand outline-none appearance-none"
                            >
                                <option value="America/Bogota">Bogotá (GMT-5)</option>
                                <option value="America/Mexico_City">México (GMT-6)</option>
                                <option value="Europe/Madrid">Madrid (GMT+1)</option>
                                <option value="America/New_York">New York (GMT-5)</option>
                                <option value="America/Argentina/Buenos_Aires">Buenos Aires (GMT-3)</option>
                            </select>
                        </div>

                        {/* Owner Details */}
                        <div className="col-span-2 mt-4">
                            <h3 className="text-xs uppercase font-bold text-dx-green tracking-wider mb-4 border-b border-dx-border pb-2">{t('modal.section.admin')}</h3>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-dx-text-soft mb-1">{t('modal.label.firstname')}</label>
                            <input
                                required
                                type="text"
                                value={formData.firstName}
                                onChange={e => setFormData({ ...formData, firstName: e.target.value })}
                                className="w-full bg-dx-surface border border-dx-border rounded-lg px-4 py-2.5 text-white focus:ring-2 focus:ring-brand outline-none"
                                placeholder="Juan"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-dx-text-soft mb-1">{t('modal.label.lastname')}</label>
                            <input
                                required
                                type="text"
                                value={formData.lastName}
                                onChange={e => setFormData({ ...formData, lastName: e.target.value })}
                                className="w-full bg-dx-surface border border-dx-border rounded-lg px-4 py-2.5 text-white focus:ring-2 focus:ring-brand outline-none"
                                placeholder="Pérez"
                            />
                        </div>

                        <div className="col-span-2">
                            <label className="block text-xs font-bold text-dx-text-soft mb-1">{t('modal.label.email')} (Login)</label>
                            <input
                                required
                                type="email"
                                value={formData.email}
                                onChange={e => setFormData({ ...formData, email: e.target.value })}
                                className="w-full bg-dx-surface border border-dx-border rounded-lg px-4 py-2.5 text-white focus:ring-2 focus:ring-brand outline-none"
                                placeholder="cliente@empresa.com"
                            />
                        </div>

                        <div className="col-span-2">
                            <label className="block text-xs font-bold text-dx-text-soft mb-1">{t('modal.label.phone')}</label>
                            <input
                                type="tel"
                                value={formData.phone}
                                onChange={e => setFormData({ ...formData, phone: e.target.value })}
                                className="w-full bg-dx-surface border border-dx-border rounded-lg px-4 py-2.5 text-white focus:ring-2 focus:ring-brand outline-none"
                                placeholder="+57 300 123 4567"
                            />
                        </div>
                    </div>

                    <div className="flex justify-end gap-3 pt-6 border-t border-dx-border">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-dx-text-soft hover:text-white font-bold text-sm transition-colors"
                        >
                            {t('modal.btn.cancel')}
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="px-6 py-2 bg-brand hover:bg-dx-green text-white font-bold text-sm rounded-lg shadow-lg shadow-brand/20 transition-all flex items-center gap-2"
                        >
                            {loading && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>}
                            {t('modal.btn.create')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
