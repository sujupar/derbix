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

-- 1. ANALIZADOR AUTOMÁTICO - START - 12:30 AM Colombia (5:30 AM UTC)
-- Inicia el batch de análisis para los partidos de HOY
-- Popula daily_matches, filtra amistosos, procesa secuencialmente
SELECT cron.schedule(
    'daily-analysis-generator',
    '30 5 * * *',  -- 5:30 AM UTC = 12:30 AM Colombia
    $$
    SELECT
      net.http_post(
          url:='https://nokejmhlpsaoerhddcyc.supabase.co/functions/v1/daily-analysis-generator',
          headers:='{"Content-Type": "application/json", "Authorization": "Bearer __ROTATED_KEY_LOAD_FROM_ENV__"}'::jsonb,
          body:='{"action":"start","auto":true}'::jsonb
      ) as request_id;
    $$
);

-- 2. HEARTBEAT - Cada 5 minutos (24/7)
-- Detecta batches estancados (>10 min sin update) y reinicia la cadena
-- Si no hay batch activo, sale inmediatamente (< 1s de ejecución)
SELECT cron.schedule(
    'daily-analysis-heartbeat',
    '*/5 * * * *',  -- Cada 5 minutos
    $$
    SELECT
      net.http_post(
          url:='https://nokejmhlpsaoerhddcyc.supabase.co/functions/v1/daily-analysis-generator',
          headers:='{"Content-Type": "application/json", "Authorization": "Bearer __ROTATED_KEY_LOAD_FROM_ENV__"}'::jsonb,
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
-- 12:30 AM → daily-analysis-generator START: Popula daily_matches para hoy,
--            filtra amistosos, inicia batch secuencial (1 partido a la vez)
--            Cada partido: ETL → Analyzer → siguiente
-- ~2:30 AM → Batch típicamente completado (~30 partidos × 4 min/partido)
-- */5 min  → Heartbeat: detecta batches estancados y reinicia la cadena
-- Cada hora → hourly-results-verifier verifica resultados de partidos finalizados
-- =====================================================
-- NOTA: daily-match-scanner fue ELIMINADO — daily-analysis-generator
-- ahora invoca v2-list-fixtures-sportmonks directamente en el paso START
-- =====================================================
