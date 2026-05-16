-- 2026-05-15: track LLM tokens and inferred cost per analysis call.
-- Purpose: operational visibility — how much each analysis costs, which
-- provider/model served it, latency. Required after the deepseek incident
-- to have data when evaluating provider choices and budget.

CREATE TABLE IF NOT EXISTS public.llm_usage_log (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at  timestamptz NOT NULL DEFAULT now(),
    job_id      uuid REFERENCES public.analysis_jobs_v2(id) ON DELETE CASCADE,
    fixture_id  bigint,
    stage       text NOT NULL,             -- 'mega', 'verify-leg', 'seo-article', etc.
    provider    text NOT NULL,             -- 'deepseek-v4-flash', 'perplexity-sonar', etc.
    model       text,                      -- as returned by the API
    prompt_tokens     integer,
    completion_tokens integer,
    reasoning_tokens  integer,
    total_tokens      integer,
    elapsed_ms        integer NOT NULL,
    -- Inferred cost in USD (computed at insert time using a hardcoded price
    -- table; ok if prices drift, this is for relative comparison not billing).
    cost_usd          numeric(10, 6),
    finish_reason     text,                -- 'stop' | 'length' | etc.
    success           boolean NOT NULL,
    error_message     text,
    -- Provenance for debugging
    schema_retry_count integer DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_llm_usage_log_created_at ON public.llm_usage_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_usage_log_job_id ON public.llm_usage_log (job_id);
CREATE INDEX IF NOT EXISTS idx_llm_usage_log_provider ON public.llm_usage_log (provider, created_at DESC);

ALTER TABLE public.llm_usage_log ENABLE ROW LEVEL SECURITY;

-- Only service_role + platform admins can read this (it's operational data).
CREATE POLICY "service_role full access to llm_usage_log"
    ON public.llm_usage_log
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Platform admins can view llm_usage_log"
    ON public.llm_usage_log
    FOR SELECT
    USING (public.is_platform_admin());

COMMENT ON TABLE public.llm_usage_log IS
    'Per-call LLM usage. Inserted by llm-client.ts after every callLLM. Used for cost monitoring and provider comparison after the 2026-05-15 deepseek incident.';
