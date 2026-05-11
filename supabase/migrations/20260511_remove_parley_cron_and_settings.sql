-- Migración 2026-05-11: Remover cron de parleys + setting auto_parlay_enabled
-- Las tablas de parlays (parlays, parlay_combos_v2, parlay_picks_v2, daily_auto_parlays)
-- se mantienen para preservar histórico verificado. El código que las leía
-- fue removido del frontend, services y edge functions en este PR.

-- 1. Desactivar cron de parleys (idempotente)
DO $$ BEGIN
    PERFORM cron.unschedule('daily-parlay-generator');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 2. Eliminar setting auto_parlay_enabled (si existe)
DELETE FROM system_settings WHERE key = 'auto_parlay_enabled';
