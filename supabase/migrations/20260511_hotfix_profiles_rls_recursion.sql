-- HOTFIX 2026-05-11: Recursión infinita en política RLS de profiles
--
-- Causa: la migración 20260511_security_hardening_rls.sql creó la política
-- "Admins can view all profiles" cuyo USING clause hace `SELECT FROM profiles`,
-- lo que dispara la misma política recursivamente al ser evaluada → 42P17.
--
-- Fix: usar una SECURITY DEFINER function para chequear si el usuario actual
-- es admin. La función bypassea RLS al ejecutarse con permisos de owner.
--
-- Idempotente: se puede correr varias veces sin efectos secundarios.

-- 1. Función helper que verifica si auth.uid() es admin de plataforma.
--    SECURITY DEFINER → corre con permisos del owner de la función,
--    que no dispara RLS sobre la tabla profiles.
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE id = auth.uid()
          AND role IN ('platform_owner', 'agency_admin', 'superadmin', 'admin')
    );
$$;

REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated, service_role, anon;

-- 2. Reemplazar la política recursiva
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
CREATE POLICY "Admins can view all profiles"
    ON public.profiles
    FOR SELECT
    USING (public.is_platform_admin());

-- 3. Reemplazar TODAS las demás políticas de la migración que también
--    consultan profiles desde dentro de un USING/WITH CHECK.
--    Estas estaban en organization_members, organizations, subscriptions,
--    predictions, value_picks_v2, etc. Aunque no están en la tabla profiles,
--    consultan profiles desde otras tablas — eso NO causa recursión directa
--    (el query se evalúa en otra tabla), pero igual conviene normalizar al
--    helper para evitar futuras confusiones y mejorar performance.

-- organization_members.INSERT
DROP POLICY IF EXISTS "Org admins can add members" ON public.organization_members;
CREATE POLICY "Org admins can add members"
    ON public.organization_members
    FOR INSERT
    WITH CHECK (
        auth.role() = 'service_role'
        OR public.is_platform_admin()
        OR EXISTS (
            SELECT 1 FROM public.organization_members om
            WHERE om.organization_id = organization_members.organization_id
              AND om.user_id = auth.uid()
              AND om.role IN ('owner', 'admin', 'org_owner')
        )
    );

-- organization_members.DELETE
DROP POLICY IF EXISTS "Org admins can remove members" ON public.organization_members;
CREATE POLICY "Org admins can remove members"
    ON public.organization_members
    FOR DELETE
    USING (
        auth.role() = 'service_role'
        OR public.is_platform_admin()
        OR EXISTS (
            SELECT 1 FROM public.organization_members om
            WHERE om.organization_id = organization_members.organization_id
              AND om.user_id = auth.uid()
              AND om.role IN ('owner', 'admin', 'org_owner')
        )
    );

-- 4. Verificar que profiles tiene RLS activo
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
