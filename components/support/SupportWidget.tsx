import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../../hooks/useAuth';
import { useSubscription } from '../../contexts/SubscriptionContext';
import { useOrganization } from '../../contexts/OrganizationContext';
import { supportService, type SupportTicket } from '../../services/supportService';
import { useToast } from '../../contexts/ToastContext';

type TicketType = SupportTicket['type'];
type Tab = 'help' | 'contact' | 'tickets';

const FAQ_ITEMS = [
  {
    q: '\u00BFQu\u00E9 son las Oportunidades?',
    a: 'Son picks de apuestas con valor positivo identificados por nuestra IA. Cada uno incluye probabilidad, cuota recomendada y mercado.',
  },
  {
    q: '\u00BFC\u00F3mo se verifican los resultados?',
    a: 'Nuestro sistema verifica autom\u00E1ticamente cada hora contra datos oficiales de SportMonks. Puedes ver el historial en la secci\u00F3n Resultados.',
  },
  {
    q: '\u00BFQu\u00E9 significa la probabilidad (p_model)?',
    a: 'Es la probabilidad estimada por nuestro modelo de IA de que el evento ocurra. Cuanto m\u00E1s alta, m\u00E1s confianza tiene el modelo.',
  },
  {
    q: '\u00BFC\u00F3mo cambio mi plan?',
    a: 'Ve a la secci\u00F3n "Planes" desde el sidebar. Puedes actualizar o gestionar tu suscripci\u00F3n en cualquier momento.',
  },
  {
    q: '\u00BFPuedo cancelar en cualquier momento?',
    a: 'S\u00ED. Puedes cancelar tu suscripci\u00F3n cuando quieras desde el portal de pagos. Tu acceso contin\u00FAa hasta el final del periodo pagado.',
  },
];

const TYPE_LABELS: Record<TicketType, string> = {
  bug: 'Reportar Bug',
  feature: 'Sugerencia',
  question: 'Pregunta',
  feedback: 'Comentario',
};

const STATUS_STYLES: Record<string, { label: string; class: string }> = {
  open: { label: 'Abierto', class: 'bg-blue-500/10 text-blue-400 border-blue-500/30' },
  in_progress: { label: 'En Progreso', class: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
  resolved: { label: 'Resuelto', class: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' },
  closed: { label: 'Cerrado', class: 'bg-slate-500/10 text-slate-400 border-slate-500/30' },
};

export const SupportWidget: React.FC<{ currentPage: string }> = ({ currentPage }) => {
  const { user } = useAuth();
  const { plan } = useSubscription();
  const { currentOrg } = useOrganization();
  const { showToast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('help');
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(false);

  // Contact form state
  const [ticketType, setTicketType] = useState<TicketType>('question');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  // FAQ expand state
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);

  const isPaidUser = plan.plan_name !== 'free';

  const loadTickets = useCallback(async () => {
    if (!user?.id) return;
    setLoadingTickets(true);
    const data = await supportService.getUserTickets(user.id);
    setTickets(data);
    setLoadingTickets(false);
  }, [user?.id]);

  useEffect(() => {
    if (isOpen && activeTab === 'tickets') {
      loadTickets();
    }
  }, [isOpen, activeTab, loadTickets]);

  const handleSubmit = async () => {
    if (!message.trim() || !user?.id) return;
    setSending(true);
    const ticket = await supportService.createTicket({
      userId: user.id,
      organizationId: currentOrg?.id,
      type: ticketType,
      message: message.trim(),
      planName: plan.plan_name,
      pageContext: currentPage,
      isPaidUser,
    });
    setSending(false);
    if (ticket) {
      showToast('Mensaje enviado. Te responderemos pronto.', 'success');
      setMessage('');
      setActiveTab('tickets');
      loadTickets();
    } else {
      showToast('Error al enviar. Intenta de nuevo.', 'error');
    }
  };

  const unreadCount = tickets.filter(t => t.status === 'resolved' && t.admin_response).length;

  return createPortal(
    <>
      {/* Floating button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`fixed z-[60] bottom-6 right-6 md:bottom-6 md:right-6 bottom-24 w-12 h-12 rounded-full bg-gradient-to-r from-brand to-emerald-600 text-white shadow-lg shadow-brand/30 hover:shadow-brand/50 transition-all hover:scale-110 active:scale-95 flex items-center justify-center ${isOpen ? 'rotate-45' : ''}`}
      >
        {isOpen ? (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
          </svg>
        )}
        {unreadCount > 0 && !isOpen && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-[10px] font-bold flex items-center justify-center">
            {unreadCount}
          </span>
        )}
      </button>

      {/* Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            className="fixed z-[59] bottom-20 md:bottom-20 right-4 md:right-6 w-[calc(100vw-2rem)] max-w-sm"
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          >
            <div className="bg-slate-900/95 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden max-h-[500px] flex flex-col">
              {/* Header */}
              <div className="p-4 border-b border-white/5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-white font-bold text-base">Soporte Derbix</h3>
                  {isPaidUser && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-brand/10 text-brand border border-brand/30 font-bold">
                      Prioritario
                    </span>
                  )}
                </div>
                {/* Tabs */}
                <div className="flex gap-1 bg-slate-800/50 rounded-lg p-0.5">
                  {(['help', 'contact', 'tickets'] as Tab[]).map(tab => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${
                        activeTab === tab
                          ? 'bg-slate-700 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {tab === 'help' ? 'Ayuda' : tab === 'contact' ? 'Contacto' : 'Mis Tickets'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-4">
                {activeTab === 'help' && (
                  <div className="space-y-2">
                    {FAQ_ITEMS.map((item, i) => (
                      <div key={i} className="border border-white/5 rounded-xl overflow-hidden">
                        <button
                          onClick={() => setExpandedFaq(expandedFaq === i ? null : i)}
                          className="w-full flex items-center justify-between p-3 text-left text-sm font-medium text-slate-200 hover:bg-white/5 transition-colors"
                        >
                          <span>{item.q}</span>
                          <svg
                            className={`w-4 h-4 text-slate-500 transition-transform ${expandedFaq === i ? 'rotate-180' : ''}`}
                            fill="none" viewBox="0 0 24 24" stroke="currentColor"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        {expandedFaq === i && (
                          <div className="px-3 pb-3 text-xs text-slate-400 leading-relaxed">
                            {item.a}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {activeTab === 'contact' && (
                  <div className="space-y-4">
                    {/* Type selector */}
                    <div>
                      <label className="text-xs text-slate-400 font-medium mb-1.5 block">Tipo</label>
                      <div className="grid grid-cols-2 gap-1.5">
                        {(Object.entries(TYPE_LABELS) as [TicketType, string][]).map(([key, label]) => (
                          <button
                            key={key}
                            onClick={() => setTicketType(key)}
                            className={`py-1.5 px-2 rounded-lg text-xs font-medium transition-all border ${
                              ticketType === key
                                ? 'bg-brand/10 border-brand/30 text-brand'
                                : 'border-white/5 text-slate-400 hover:border-white/10'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Message */}
                    <div>
                      <label className="text-xs text-slate-400 font-medium mb-1.5 block">Mensaje</label>
                      <textarea
                        value={message}
                        onChange={e => setMessage(e.target.value)}
                        maxLength={1000}
                        rows={4}
                        placeholder="Describe tu pregunta, sugerencia o problema..."
                        className="w-full bg-slate-800/50 border border-white/5 rounded-xl p-3 text-sm text-white placeholder-slate-500 resize-none focus:outline-none focus:border-brand/30 transition-colors"
                      />
                      <p className="text-right text-[10px] text-slate-600 mt-1">{message.length}/1000</p>
                    </div>

                    {/* Submit */}
                    <button
                      onClick={handleSubmit}
                      disabled={!message.trim() || sending}
                      className="w-full py-2.5 rounded-xl bg-gradient-to-r from-brand to-emerald-600 text-white font-bold text-sm shadow-lg shadow-brand/20 disabled:opacity-40 disabled:cursor-not-allowed hover:shadow-brand/40 transition-all active:scale-[0.98]"
                    >
                      {sending ? 'Enviando...' : 'Enviar'}
                    </button>
                  </div>
                )}

                {activeTab === 'tickets' && (
                  <div className="space-y-2">
                    {loadingTickets ? (
                      <div className="flex items-center justify-center py-8">
                        <div className="w-5 h-5 border-2 border-brand border-t-transparent rounded-full animate-spin" />
                      </div>
                    ) : tickets.length === 0 ? (
                      <div className="text-center py-8">
                        <p className="text-slate-500 text-sm">No tienes tickets a\u00FAn</p>
                        <button
                          onClick={() => setActiveTab('contact')}
                          className="text-brand text-xs font-medium mt-2 hover:underline"
                        >
                          Enviar tu primer mensaje
                        </button>
                      </div>
                    ) : (
                      tickets.map(ticket => {
                        const status = STATUS_STYLES[ticket.status] || STATUS_STYLES.open;
                        return (
                          <div key={ticket.id} className="border border-white/5 rounded-xl p-3 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-slate-500">
                                {TYPE_LABELS[ticket.type]} &middot; {new Date(ticket.created_at).toLocaleDateString('es')}
                              </span>
                              <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${status.class}`}>
                                {status.label}
                              </span>
                            </div>
                            <p className="text-sm text-slate-300 leading-relaxed">{ticket.message}</p>
                            {ticket.admin_response && (
                              <div className="bg-brand/5 border border-brand/10 rounded-lg p-2.5 mt-2">
                                <p className="text-[10px] text-brand font-bold mb-1">Respuesta del equipo</p>
                                <p className="text-xs text-slate-300 leading-relaxed">{ticket.admin_response}</p>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>,
    document.body
  );
};
