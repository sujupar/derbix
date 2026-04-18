-- 20260417: Odds trazabilidad + SEO article status
-- Parte A: añade odds_source a value_picks_v2 para distinguir odds reales de las descartadas.
-- Parte B: añade article_status a seo_pages para tracking del estado de generación SEO.

-- ─── PART A: ODDS SOURCE ─────────────────────────────────────────────────
ALTER TABLE value_picks_v2
  ADD COLUMN IF NOT EXISTS odds_source TEXT
    CHECK (odds_source IN ('real', 'unavailable') OR odds_source IS NULL);

COMMENT ON COLUMN value_picks_v2.odds_source IS
  'real = cuota de SportMonks / bookmaker; unavailable = sin cuota de mercado (pick descartado).';

-- Índice para filtrar rápido en resultsService
CREATE INDEX IF NOT EXISTS idx_value_picks_v2_odds_source
  ON value_picks_v2(odds_source)
  WHERE odds_source IS NOT NULL;

-- ─── PART B: SEO ARTICLE STATUS ──────────────────────────────────────────
ALTER TABLE seo_pages
  ADD COLUMN IF NOT EXISTS article_status TEXT
    DEFAULT 'pending'
    CHECK (article_status IN ('pending', 'generating', 'ready', 'failed'));

ALTER TABLE seo_pages
  ADD COLUMN IF NOT EXISTS article_attempts INTEGER DEFAULT 0;

ALTER TABLE seo_pages
  ADD COLUMN IF NOT EXISTS article_last_error TEXT;

ALTER TABLE seo_pages
  ADD COLUMN IF NOT EXISTS article_next_retry_at TIMESTAMPTZ;

-- Índice para el cron de reintento
CREATE INDEX IF NOT EXISTS idx_seo_pages_article_retry
  ON seo_pages(article_status, article_next_retry_at)
  WHERE article_status IN ('pending', 'failed');

-- Marcar como ready todas las páginas existentes que ya tengan artículo
UPDATE seo_pages
SET article_status = 'ready'
WHERE article_html IS NOT NULL AND article_status = 'pending';
