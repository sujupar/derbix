-- =====================================================
-- CRON JOBS COMPLETOS PARA AUTOMATIZACIÓN DIARIA V2
-- Sistema de análisis automático con self-chaining
-- Zona horaria: Colombia (UTC-5)
-- Última actualización: 2026-03-13
-- =====================================================

-- =====================================================
-- PASO 1: Eliminar cron jobs anteriores (si existen)
-- =====================================================
DO $$ BEGIN PERFORM cron.unschedule('daily-match-scanner'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('daily-analysis-generator'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('daily-analysis-heartbeat'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('daily-parlay-generator'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('daily-results-verifier'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('daily-results-verifier-cron'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('daily-results-verifier-schedule'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('hourly-results-verifier'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('seo-retry-pending-articles'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('analysis-retry-pending'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- =====================================================
-- PASO 1.5: Asegurar que auto_analysis_state existe
-- =====================================================
INSERT INTO system_settings (key, value, description)
VALUES ('auto_analysis_state', 'null'::jsonb, 'Estado del batch de análisis automático')
ON CONFLICT (key) DO NOTHING;

-- =====================================================
-- PASO 2: Configurar nuevos cron jobs
-- =====================================================

-- 1. ANALIZADOR AUTOMÁTICO - START - 5:00 AM Colombia (10:00 AM UTC)
-- Inicia el batch de análisis para los partidos del DÍA SIGUIENTE (getTomorrowBogota)
-- Popula daily_matches, filtra amistosos, procesa secuencialmente
-- IMPORTANTE: el header X-Internal-Secret es OBLIGATORIO desde el hardening de
-- seguridad (2026-05-11): daily-analysis-generator usa requireAdminOrService().
-- Sin este header el cron recibe 401 y el batch nunca arranca.
-- Reemplaza los dos placeholders con valores REALES (actuales) al ejecutar:
--   <Bearer>            → SUPABASE_ANON_KEY o SERVICE_ROLE_KEY vigente (pasa el gateway)
--   X-Internal-Secret   → valor de INTERNAL_FUNCTION_SECRET (pasa el guard interno)
SELECT cron.schedule(
    'daily-analysis-generator',
    '0 10 * * *',  -- 10:00 AM UTC = 5:00 AM Colombia
    $$
    SELECT
      net.http_post(
          url:='https://nokejmhlpsaoerhddcyc.supabase.co/functions/v1/daily-analysis-generator',
          headers:='{"Content-Type": "application/json", "Authorization": "Bearer __ROTATED_KEY_LOAD_FROM_ENV__", "X-Internal-Secret": "__INTERNAL_FUNCTION_SECRET_LOAD_FROM_ENV__"}'::jsonb,
          body:='{"action":"start","auto":true}'::jsonb
      ) as request_id;
    $$
);

-- 2. HEARTBEAT - Cada 5 minutos (24/7)
-- Detecta batches estancados (>10 min sin update) y reinicia la cadena
-- Si no hay batch activo, sale inmediatamente (< 1s de ejecución)
-- Mismo requisito de auth que el START: X-Internal-Secret OBLIGATORIO.
SELECT cron.schedule(
    'daily-analysis-heartbeat',
    '*/5 * * * *',  -- Cada 5 minutos
    $$
    SELECT
      net.http_post(
          url:='https://nokejmhlpsaoerhddcyc.supabase.co/functions/v1/daily-analysis-generator',
          headers:='{"Content-Type": "application/json", "Authorization": "Bearer __ROTATED_KEY_LOAD_FROM_ENV__", "X-Internal-Secret": "__INTERNAL_FUNCTION_SECRET_LOAD_FROM_ENV__"}'::jsonb,
          body:='{"action":"heartbeat"}'::jsonb
      ) as request_id;
    $$
);

-- 4. VERIFICADOR DE RESULTADOS - Cada hora (SportMonks API + Gemini fallback)
-- Reemplaza daily-results-verifier (legacy, API-Football) con hourly-results-verifier (V3)
-- Incluye: catch-up pass global, sync reports_v2→value_picks_v2, threshold 0.83
SELECT cron.schedule(
    'hourly-results-verifier',
    '0 * * * *',  -- Cada hora en punto
    $$
    SELECT
      net.http_post(
          url:='https://nokejmhlpsaoerhddcyc.supabase.co/functions/v1/hourly-results-verifier',
          headers:='{"Content-Type": "application/json", "Authorization": "Bearer __ROTATED_KEY_LOAD_FROM_ENV__"}'::jsonb,
          body:='{}'::jsonb
      ) as request_id;
    $$
);

-- 5. SEO RETRY - Cada 10 minutos
-- Reintenta generar artículos SEO con article_status='failed' o 'pending'
-- Procesa hasta 5 por invocación, espaciados 2s, respetando Groq free tier (8000 TPM)
SELECT cron.schedule(
    'seo-retry-pending-articles',
    '*/10 * * * *',  -- Cada 10 minutos
    $$
    SELECT
      net.http_post(
          url:='https://nokejmhlpsaoerhddcyc.supabase.co/functions/v1/seo-retry-pending-articles',
          headers:='{"Content-Type": "application/json", "Authorization": "Bearer __ROTATED_KEY_LOAD_FROM_ENV__"}'::jsonb,
          body:='{}'::jsonb
      ) as request_id;
    $$
);

-- 6. ANALYSIS RETRY - Cada 30 minutos
-- Reintenta jobs con status='failed', 'analyzing' stuck, o 'done' con picks vacíos.
-- Límite: 20 jobs por tick, 3 intentos máximos antes de permanent_failure=true.
-- Usa CAS lock (status='retrying') para evitar doble-disparo entre ticks concurrentes.
SELECT cron.schedule(
    'analysis-retry-pending',
    '*/30 * * * *',  -- Cada 30 minutos
    $$
    SELECT
      net.http_post(
          url:='https://nokejmhlpsaoerhddcyc.supabase.co/functions/v1/analysis-retry-pending',
          headers:='{"Content-Type": "application/json", "Authorization": "Bearer __ROTATED_KEY_LOAD_FROM_ENV__"}'::jsonb,
          body:='{}'::jsonb
      ) as request_id;
    $$
);

-- =====================================================
-- PASO 3: Verificar configuración
-- =====================================================
SELECT
    jobname,
    schedule,
    active,
    jobid
FROM cron.job
ORDER BY jobname;

-- =====================================================
-- RESUMEN DEL FLUJO DIARIO V2:
-- =====================================================
-- 5:00 AM  → daily-analysis-generator START: Popula daily_matches para el DÍA
--            SIGUIENTE (getTomorrowBogota), filtra amistosos, inicia batch
--            secuencial (1 partido a la vez). Cada partido: ETL → Analyzer → siguiente
-- ~7:00 AM → Batch típicamente completado (~30 partidos × 4 min/partido)
-- */5 min  → Heartbeat: detecta batches estancados y reinicia la cadena
-- Cada hora → hourly-results-verifier verifica resultados de partidos finalizados
-- =====================================================
-- NOTA: daily-match-scanner fue ELIMINADO — daily-analysis-generator
-- ahora invoca v2-list-fixtures-sportmonks directamente en el paso START
-- =====================================================
