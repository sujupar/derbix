-- V9 Cron Jobs: capture-closing-odds + compute-referee-stats
-- Run this in Supabase SQL editor to register the cron jobs.

-- Capture closing odds every 5 minutes (scans for matches within 15min window)
SELECT cron.schedule(
    'v9-capture-closing-odds',
    '*/5 * * * *',
    $$
    SELECT net.http_post(
        url := 'https://nokejmhlpsaoerhddcyc.supabase.co/functions/v1/capture-closing-odds',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)),
        body := '{}'::jsonb
    ) AS request_id;
    $$
);

-- Compute referee stats daily at 3 AM Bogota (8 AM UTC)
SELECT cron.schedule(
    'v9-compute-referee-stats',
    '0 8 * * *',
    $$
    SELECT net.http_post(
        url := 'https://nokejmhlpsaoerhddcyc.supabase.co/functions/v1/compute-referee-stats',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)),
        body := '{"days_back": 90}'::jsonb
    ) AS request_id;
    $$
);

-- Auto-cleanup stuck jobs every 10 minutes (jobs >30min in etl/analyzing → 'failed')
-- Protects against Deno WORKER_LIMIT (150s) kills that leave rows stuck.
-- 30min margin allows Groq rate-limit recovery and retries without false positives.
SELECT cron.schedule(
    'v9-auto-cleanup-stuck-jobs',
    '*/10 * * * *',
    $$
    UPDATE analysis_jobs_v2
    SET status = 'failed',
        error_message = 'Auto-cleanup: stuck >30min in etl/analyzing'
    WHERE status IN ('etl', 'analyzing')
      AND created_at < NOW() - INTERVAL '30 minutes';
    $$
);

-- Verify
SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'v9-%';
