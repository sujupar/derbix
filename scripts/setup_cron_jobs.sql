-- =====================================================
-- CONFIGURAR CRON JOBS PARA AUTOMATIZACIÓN DIARIA
-- =====================================================
-- Zona horaria: Colombia (UTC-5)
-- Horarios:
--   1:00 AM - Scanner de partidos
--   2:00 AM - Generador de análisis
--   3:00 AM - Generador de parlays
--   11:00 PM - Verificador de resultados

-- =====================================================
-- 1. DAILY MATCH SCANNER - 1:00 AM Colombia (6:00 AM UTC)
-- =====================================================
SELECT cron.schedule(
    'daily-match-scanner',
    '0 6 * * *',  -- 6:00 AM UTC = 1:00 AM Colombia
    $$
    SELECT
      net.http_post(
          url:='https://nokejmhlpsaoerhddcyc.supabase.co/functions/v1/daily-match-scanner',
          headers:='{"Content-Type": "application/json", "Authorization": "Bearer __ROTATED_KEY_LOAD_FROM_ENV__"}'::jsonb,
          body:='{}'::jsonb
      ) as request_id;
    $$
);

-- =====================================================
-- 2. DAILY ANALYSIS GENERATOR - 2:00 AM Colombia (7:00 AM UTC)
-- =====================================================
SELECT cron.schedule(
    'daily-analysis-generator',
    '0 7 * * *',  -- 7:00 AM UTC = 2:00 AM Colombia
    $$
    SELECT
      net.http_post(
          url:='https://nokejmhlpsaoerhddcyc.supabase.co/functions/v1/daily-analysis-generator',
          headers:='{"Content-Type": "application/json", "Authorization": "Bearer __ROTATED_KEY_LOAD_FROM_ENV__"}'::jsonb,
          body:='{}'::jsonb
      ) as request_id;
    $$
);

-- =====================================================
-- 3. DAILY PARLAY GENERATOR - 3:00 AM Colombia (8:00 AM UTC)
-- =====================================================
SELECT cron.schedule(
    'daily-parlay-generator',
    '0 8 * * *',  -- 8:00 AM UTC = 3:00 AM Colombia
    $$
    SELECT
      net.http_post(
          url:='https://nokejmhlpsaoerhddcyc.supabase.co/functions/v1/daily-parlay-generator',
          headers:='{"Content-Type": "application/json", "Authorization": "Bearer __ROTATED_KEY_LOAD_FROM_ENV__"}'::jsonb,
          body:='{}'::jsonb
      ) as request_id;
    $$
);

-- =====================================================
-- 4. DAILY RESULTS VERIFIER - 11:00 PM Colombia (4:00 AM UTC del día siguiente)
-- =====================================================
SELECT cron.schedule(
    'daily-results-verifier',
    '0 4 * * *',  -- 4:00 AM UTC = 11:00 PM Colombia del día anterior
    $$
    SELECT
      net.http_post(
          url:='https://nokejmhlpsaoerhddcyc.supabase.co/functions/v1/daily-results-verifier',
          headers:='{"Content-Type": "application/json", "Authorization": "Bearer __ROTATED_KEY_LOAD_FROM_ENV__"}'::jsonb,
          body:='{}'::jsonb
      ) as request_id;
    $$
);

-- =====================================================
-- VERIFICAR CRON JOBS CONFIGURADOS
-- =====================================================
SELECT * FROM cron.job ORDER BY jobname;
