-- ═══════════════════════════════════════════════════════════════
-- One-shot backfill: reset stuck/failed/empty jobs from the last 14
-- days so that the `analysis-retry-pending` CRON will pick them up.
--
-- IMPORTANT: this script is TWO STEPS.
--   1. Run PASO 1 (SELECT) first and inspect the output.
--   2. If the count looks reasonable (< 500), run PASO 2 (UPDATE).
--   3. The retry CRON (every 30 min, 20 jobs/tick) will pick them up.
-- ═══════════════════════════════════════════════════════════════

-- ═══ PASO 1: DRY-RUN — revisa el impacto antes de ejecutar el UPDATE ═══
SELECT
    COUNT(*)                                  AS affected_jobs,
    array_agg(DISTINCT status)                AS statuses,
    MIN(aj.created_at)                        AS oldest,
    MAX(aj.created_at)                        AS newest
FROM public.analysis_jobs_v2 aj
LEFT JOIN public.reports_v2 r ON r.job_id = aj.id
WHERE aj.created_at > (now() - interval '14 days')
  AND (
      aj.status = 'failed'
      OR (aj.status IN ('analyzing', 'interpret') AND aj.updated_at < (now() - interval '1 hour'))
      OR (
          aj.status = 'done'
          AND (
              r.id IS NULL
              OR jsonb_array_length(COALESCE(r.report_packet -> 'pronosticos', '[]'::jsonb)) = 0
          )
      )
  )
  AND aj.permanent_failure = FALSE;

-- Para ver el detalle de jobs afectados (opcional):
-- SELECT aj.id, aj.fixture_id, aj.status, aj.retry_count, aj.updated_at,
--        (r.report_packet -> 'resumen_ejecutivo' ->> 'confianza_global') AS conf
-- FROM public.analysis_jobs_v2 aj
-- LEFT JOIN public.reports_v2 r ON r.job_id = aj.id
-- WHERE aj.created_at > (now() - interval '14 days')
--   AND aj.permanent_failure = FALSE
--   AND (
--       aj.status = 'failed'
--       OR (aj.status IN ('analyzing', 'interpret') AND aj.updated_at < (now() - interval '1 hour'))
--       OR (aj.status = 'done' AND (r.id IS NULL OR jsonb_array_length(COALESCE(r.report_packet -> 'pronosticos', '[]'::jsonb)) = 0))
--   )
-- ORDER BY aj.created_at DESC
-- LIMIT 100;

-- ═══ PASO 2: UPDATE — ejecutar solo después de revisar PASO 1 ═══
-- Reset a 'interpret' para que el CRON los procese; retry_count=0 les da 3 intentos limpios.
-- Límite 200 por batch para no saturar APIs (Groq TPM, SportMonks rate limit).
-- Si hay más de 200 candidatos, ejecutar el UPDATE varias veces (el CRON los irá consumiendo).

/*
UPDATE public.analysis_jobs_v2 aj
SET status           = 'interpret',
    retry_count      = 0,
    permanent_failure = FALSE,
    last_retry_at    = NULL,
    error_message    = 'backfill reset ' || to_char(now(), 'YYYY-MM-DD HH24:MI')
WHERE aj.id IN (
    SELECT aj2.id
    FROM public.analysis_jobs_v2 aj2
    LEFT JOIN public.reports_v2 r ON r.job_id = aj2.id
    WHERE aj2.created_at > (now() - interval '14 days')
      AND aj2.permanent_failure = FALSE
      AND (
          aj2.status = 'failed'
          OR (aj2.status IN ('analyzing', 'interpret') AND aj2.updated_at < (now() - interval '1 hour'))
          OR (aj2.status = 'done' AND (r.id IS NULL OR jsonb_array_length(COALESCE(r.report_packet -> 'pronosticos', '[]'::jsonb)) = 0))
      )
    ORDER BY aj2.created_at DESC
    LIMIT 200
);
*/
