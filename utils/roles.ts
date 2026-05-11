// utils/roles.ts — Single source of truth for role classification
// AGENCY = full access (analyze, manage accounts)
// CLIENT = view only (according to their subscription plan)

// Roles de plataforma (profiles.role en DB)
export const PLATFORM_ROLES = {
  PLATFORM_OWNER: 'platform_owner',
  AGENCY_ADMIN: 'agency_admin',
  ORG_OWNER: 'org_owner',
  ORG_MEMBER: 'org_member',
  USER: 'user',
} as const;

// Roles que tienen acceso completo a la agencia
export const AGENCY_ROLES = ['platform_owner', 'agency_admin'] as const;
export type AgencyRole = typeof AGENCY_ROLES[number];

// Todos los roles válidos de plataforma
export type PlatformRole = typeof PLATFORM_ROLES[keyof typeof PLATFORM_ROLES];

export function isAgencyRole(role?: string | null): boolean {
  return !!role && (AGENCY_ROLES as readonly string[]).includes(role);
}

export function isClientRole(role?: string | null): boolean {
  return !isAgencyRole(role);
}

// Normalizar roles legacy a los nombres modernos (safety net para datos antiguos)
export function normalizeRole(role?: string | null): PlatformRole {
  if (!role) return 'user';
  const map: Record<string, PlatformRole> = {
    superadmin: 'platform_owner',
    admin: 'user',
    usuario: 'user',
    platform_owner: 'platform_owner',
    agency_admin: 'agency_admin',
    org_owner: 'org_owner',
    org_member: 'org_member',
    user: 'user',
  };
  return map[role] || 'user';
}
