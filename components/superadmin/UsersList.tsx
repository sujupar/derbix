
import React, { useEffect, useState, useMemo } from 'react';
import { adminService, ListUsersOptions, UserDateFilter, UserOriginFilter } from '../../services/adminService';
import { AdminUserListItem } from '../../types';
import { UserGroupIcon, MagnifyingGlassIcon, ShieldCheckIcon, TrashIcon } from '../icons/Icons';
import { useAuth } from '../../hooks/useAuth';

// Pencil SVG inline — no equivalente exportado en components/icons/Icons.tsx
const PencilIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className={className}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
    </svg>
);

const PAGE_SIZE = 25;

const ROLE_OPTIONS: { value: string; label: string }[] = [
    { value: 'all', label: 'Todos los roles' },
    { value: 'platform_owner', label: 'Platform Owner' },
    { value: 'agency_admin', label: 'Agency Admin' },
    { value: 'org_owner', label: 'Org Owner' },
    { value: 'org_member', label: 'Org Member' },
    { value: 'user', label: 'User' },
];

const ORIGIN_OPTIONS: { value: UserOriginFilter; label: string }[] = [
    { value: 'all', label: 'Todos los orígenes' },
    { value: 'meta', label: 'Meta Ads' },
    { value: 'organic', label: 'Orgánico (sin UTM)' },
    { value: 'other', label: 'Otro UTM' },
];

const PERIOD_OPTIONS: { value: UserDateFilter; label: string }[] = [
    { value: 'all', label: 'Todos' },
    { value: 'today', label: 'Hoy' },
    { value: '7d', label: 'Últimos 7d' },
    { value: '30d', label: 'Últimos 30d' },
];

export const UsersList: React.FC = () => {
    const { profile: currentProfile } = useAuth();
    const [users, setUsers] = useState<AdminUserListItem[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Filters
    const [searchTerm, setSearchTerm] = useState('');
    const [roleFilter, setRoleFilter] = useState('all');
    const [originFilter, setOriginFilter] = useState<UserOriginFilter>('all');
    const [periodFilter, setPeriodFilter] = useState<UserDateFilter>('all');
    const [page, setPage] = useState(1);

    // Modals
    const [editingUser, setEditingUser] = useState<AdminUserListItem | null>(null);
    const [pendingRole, setPendingRole] = useState<string | null>(null);
    const [deletingUser, setDeletingUser] = useState<AdminUserListItem | null>(null);
    const [deleteConfirmText, setDeleteConfirmText] = useState('');
    const [deleting, setDeleting] = useState(false);

    const filters: ListUsersOptions = useMemo(() => ({
        search: searchTerm.trim() || undefined,
        role: roleFilter,
        origin: originFilter,
        period: periodFilter,
        page,
        pageSize: PAGE_SIZE,
    }), [searchTerm, roleFilter, originFilter, periodFilter, page]);

    useEffect(() => {
        const timer = setTimeout(() => {
            loadUsers();
        }, 300);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filters]);

    const loadUsers = async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await adminService.listAllUsers(filters);
            setUsers(result.users);
            setTotal(result.total);
        } catch (e: any) {
            console.error(e);
            setError(e?.message || 'Error al cargar usuarios');
            setUsers([]);
            setTotal(0);
        } finally {
            setLoading(false);
        }
    };

    // Reset to page 1 when filters change (except page itself)
    useEffect(() => {
        setPage(1);
    }, [searchTerm, roleFilter, originFilter, periodFilter]);

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    const handleRoleConfirm = async () => {
        if (!editingUser || !pendingRole) return;
        try {
            await adminService.updateUserRole(editingUser.id, pendingRole);
            setEditingUser(null);
            setPendingRole(null);
            loadUsers();
        } catch (e: any) {
            setError(e?.message || 'Error al actualizar rol');
        }
    };

    const handleDelete = async () => {
        if (!deletingUser || deleteConfirmText !== 'ELIMINAR') return;
        setDeleting(true);
        try {
            await adminService.deleteUser(deletingUser.id, 'Eliminado desde panel admin');
            setDeletingUser(null);
            setDeleteConfirmText('');
            loadUsers();
        } catch (e: any) {
            setError(e?.message || 'Error al eliminar usuario');
        } finally {
            setDeleting(false);
        }
    };

    return (
        <div className="glass p-6 rounded-xl border border-white/5 shadow-2xl animate-fade-in relative">
            <header className="flex items-start justify-between flex-wrap gap-3 mb-6">
                <div>
                    <h2 className="text-xl font-display font-bold text-white flex items-center gap-3">
                        <UserGroupIcon className="w-6 h-6 text-purple-400" />
                        Gestión Global de Usuarios
                    </h2>
                    <p className="text-xs text-slate-400 mt-1">
                        {total} {total === 1 ? 'usuario' : 'usuarios'} en total
                        {total > 0 && (
                            <span> · página {page} de {totalPages}</span>
                        )}
                    </p>
                </div>
            </header>

            {/* Filters */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-5">
                <div className="relative col-span-1 sm:col-span-2 lg:col-span-1">
                    <MagnifyingGlassIcon className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                        type="text"
                        placeholder="Buscar por email o nombre"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full bg-slate-900/60 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500/50"
                    />
                </div>
                <select
                    value={roleFilter}
                    onChange={(e) => setRoleFilter(e.target.value)}
                    className="bg-slate-900/60 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500/50"
                >
                    {ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <select
                    value={originFilter}
                    onChange={(e) => setOriginFilter(e.target.value as UserOriginFilter)}
                    className="bg-slate-900/60 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500/50"
                >
                    {ORIGIN_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <select
                    value={periodFilter}
                    onChange={(e) => setPeriodFilter(e.target.value as UserDateFilter)}
                    className="bg-slate-900/60 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500/50"
                >
                    {PERIOD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
            </div>

            {error && (
                <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                    {error}
                </div>
            )}

            {/* Table */}
            <div className="overflow-x-auto min-h-[400px] rounded-lg border border-white/5">
                <table className="w-full text-sm text-left">
                    <thead className="bg-slate-900/70 text-[11px] uppercase tracking-wider text-slate-400 font-bold">
                        <tr>
                            <th className="px-4 py-3">Usuario</th>
                            <th className="px-4 py-3 hidden md:table-cell">Email</th>
                            <th className="px-4 py-3 hidden lg:table-cell">Registro</th>
                            <th className="px-4 py-3">Plan</th>
                            <th className="px-4 py-3 hidden lg:table-cell">Origen</th>
                            <th className="px-4 py-3">Rol</th>
                            <th className="px-4 py-3 text-right">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                        {loading ? (
                            <tr><td colSpan={7} className="text-center py-12 text-slate-500">Cargando…</td></tr>
                        ) : users.length === 0 ? (
                            <tr><td colSpan={7} className="text-center py-12 text-slate-500">No hay usuarios para estos filtros.</td></tr>
                        ) : users.map(user => {
                            const isSelf = currentProfile?.id === user.id;
                            return (
                                <tr key={user.id} className="hover:bg-white/5 transition-colors">
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-3">
                                            <div className="w-9 h-9 rounded-full bg-purple-500/15 flex items-center justify-center text-purple-300 font-bold border border-purple-500/25 shrink-0">
                                                {(user.full_name?.[0] || user.email?.[0] || '?').toUpperCase()}
                                            </div>
                                            <div className="min-w-0">
                                                <p className="font-semibold text-white truncate">{user.full_name || 'Sin nombre'}</p>
                                                <p className="text-[10px] text-slate-500 font-mono truncate md:hidden">{user.email}</p>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-slate-300 hidden md:table-cell">
                                        <span className="font-mono text-xs">{user.email}</span>
                                    </td>
                                    <td className="px-4 py-3 text-slate-400 text-xs hidden lg:table-cell whitespace-nowrap">
                                        {formatRelative(user.updated_at)}
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold border ${planBadge(user.active_plan)}`}>
                                            {user.active_plan || 'free'}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 hidden lg:table-cell">
                                        <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium ${originBadge(user.utm_source)}`}>
                                            {originLabel(user.utm_source)}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold border ${roleBadge(user.role)}`}>
                                            {user.role}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-right whitespace-nowrap">
                                        <button
                                            onClick={() => { setEditingUser(user); setPendingRole(null); }}
                                            className="text-slate-400 hover:text-white transition-colors p-2 hover:bg-white/10 rounded-lg"
                                            title="Editar rol"
                                        >
                                            <PencilIcon className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={() => { setDeletingUser(user); setDeleteConfirmText(''); }}
                                            disabled={isSelf}
                                            className="text-slate-400 hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors p-2 hover:bg-red-500/10 rounded-lg ml-1"
                                            title={isSelf ? 'No puedes eliminarte a ti mismo' : 'Eliminar usuario'}
                                        >
                                            <TrashIcon className="w-4 h-4" />
                                        </button>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4 text-xs text-slate-400">
                    <span>Mostrando {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} de {total}</span>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                            disabled={page === 1 || loading}
                            className="px-3 py-1.5 rounded-lg bg-slate-800/60 border border-white/10 hover:bg-slate-700/70 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                            ← Anterior
                        </button>
                        <button
                            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                            disabled={page >= totalPages || loading}
                            className="px-3 py-1.5 rounded-lg bg-slate-800/60 border border-white/10 hover:bg-slate-700/70 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                            Siguiente →
                        </button>
                    </div>
                </div>
            )}

            {/* Edit Role Modal */}
            {editingUser && (
                <div className="absolute inset-0 bg-slate-900/90 backdrop-blur-sm flex items-center justify-center z-50 rounded-xl p-4">
                    <div className="bg-slate-800 border border-white/10 p-6 rounded-xl w-full max-w-md shadow-2xl">
                        <h3 className="text-lg font-bold text-white mb-1">Editar rol</h3>
                        <p className="text-xs text-slate-400 mb-4 truncate">{editingUser.email}</p>

                        <div className="space-y-2">
                            {ROLE_OPTIONS.filter(r => r.value !== 'all').map(({ value, label }) => {
                                const isCurrent = editingUser.role === value;
                                const isPending = pendingRole === value;
                                return (
                                    <button
                                        key={value}
                                        onClick={() => setPendingRole(value)}
                                        className={`w-full flex items-center justify-between p-3 rounded-lg border transition-all text-sm ${
                                            isPending ? 'bg-purple-600/30 border-purple-400 text-white'
                                            : isCurrent ? 'bg-purple-600/15 border-purple-500/50 text-white'
                                            : 'bg-slate-700/40 border-white/5 text-slate-400 hover:bg-slate-700 hover:text-white'
                                        }`}
                                    >
                                        <div className="flex items-center gap-2">
                                            <ShieldCheckIcon className={`w-4 h-4 ${isPending ? 'text-purple-300' : isCurrent ? 'text-purple-400' : 'text-slate-500'}`} />
                                            <span className="font-semibold">{label}</span>
                                        </div>
                                        {isCurrent && <span className="text-[10px] text-purple-300 font-bold uppercase">actual</span>}
                                        {isPending && !isCurrent && <span className="text-[10px] text-purple-200 font-bold uppercase">nuevo</span>}
                                    </button>
                                );
                            })}
                        </div>

                        <div className="grid grid-cols-2 gap-2 mt-6">
                            <button
                                onClick={() => { setEditingUser(null); setPendingRole(null); }}
                                className="py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg font-semibold transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleRoleConfirm}
                                disabled={!pendingRole || pendingRole === editingUser.role}
                                className="py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm rounded-lg font-bold transition-colors"
                            >
                                Confirmar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {deletingUser && (
                <div className="absolute inset-0 bg-slate-900/90 backdrop-blur-sm flex items-center justify-center z-50 rounded-xl p-4">
                    <div className="bg-slate-800 border border-red-500/30 p-6 rounded-xl w-full max-w-md shadow-2xl">
                        <div className="flex items-start gap-3 mb-4">
                            <div className="w-10 h-10 rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center shrink-0">
                                <TrashIcon className="w-5 h-5 text-red-400" />
                            </div>
                            <div className="min-w-0">
                                <h3 className="text-lg font-bold text-white">Eliminar usuario</h3>
                                <p className="text-xs text-slate-400 truncate">{deletingUser.email}</p>
                            </div>
                        </div>

                        <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-3 mb-4 text-xs text-slate-300 leading-relaxed">
                            <p className="font-bold text-red-300 mb-1">Esta acción es irreversible.</p>
                            <p>
                                Se eliminará la cuenta de autenticación, el perfil, suscripciones,
                                relaciones de organización y todo el historial asociado a {' '}
                                <span className="text-white font-semibold">{deletingUser.full_name || deletingUser.email}</span>.
                            </p>
                        </div>

                        <label className="text-xs text-slate-400 block mb-1">
                            Escribe <span className="text-red-400 font-mono font-bold">ELIMINAR</span> para confirmar:
                        </label>
                        <input
                            type="text"
                            value={deleteConfirmText}
                            onChange={(e) => setDeleteConfirmText(e.target.value)}
                            className="w-full bg-slate-900/80 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-red-500/50"
                            placeholder="ELIMINAR"
                            autoFocus
                        />

                        <div className="grid grid-cols-2 gap-2 mt-6">
                            <button
                                onClick={() => { setDeletingUser(null); setDeleteConfirmText(''); }}
                                disabled={deleting}
                                className="py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-sm rounded-lg font-semibold transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleDelete}
                                disabled={deleteConfirmText !== 'ELIMINAR' || deleting}
                                className="py-2 bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm rounded-lg font-bold transition-colors"
                            >
                                {deleting ? 'Eliminando…' : 'Eliminar definitivamente'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// ─── Badge helpers ───────────────────────────────────────────────────────────

function roleBadge(role?: string): string {
    switch (role) {
        case 'platform_owner': return 'bg-pink-500/15 text-pink-300 border-pink-500/30';
        case 'agency_admin': return 'bg-blue-500/15 text-blue-300 border-blue-500/30';
        case 'org_owner': return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
        case 'org_member': return 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30';
        default: return 'bg-slate-700/50 text-slate-300 border-slate-600/30';
    }
}

function planBadge(plan?: string | null): string {
    if (!plan || plan.toLowerCase() === 'free') return 'bg-slate-700/40 text-slate-400 border-slate-600/30';
    const p = plan.toLowerCase();
    if (p.includes('premium')) return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
    if (p.includes('pro')) return 'bg-violet-500/15 text-violet-300 border-violet-500/30';
    if (p.includes('starter')) return 'bg-sky-500/15 text-sky-300 border-sky-500/30';
    return 'bg-brand/15 text-brand border-brand/30';
}

function originBadge(utmSource?: string | null): string {
    if (!utmSource) return 'bg-slate-700/40 text-slate-400';
    if (utmSource === 'meta') return 'bg-blue-500/15 text-blue-300';
    return 'bg-amber-500/15 text-amber-300';
}

function originLabel(utmSource?: string | null): string {
    if (!utmSource) return 'orgánico';
    return utmSource;
}

function formatRelative(iso?: string): string {
    if (!iso) return '—';
    const t = new Date(iso).getTime();
    if (isNaN(t)) return '—';
    const diff = Date.now() - t;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'hace segundos';
    if (mins < 60) return `hace ${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `hace ${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `hace ${days}d`;
    return new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
}
