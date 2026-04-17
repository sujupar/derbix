-- Migration: V9 Hybrid Engine — Manual ML Gate, CLV Tracking, RAG Embeddings
-- Created: 2026-04-16
-- Purpose: Support Derbix V9 architecture with manual learning gate,
--          closing line value tracking, and vector-based historical retrieval.

-- ═══════════════════════════════════════════════════════════════
-- 1. MANUAL ML VERIFICATION GATE
-- The verifier (hourly-results-verifier) fails ~5% of the time.
-- Admin must manually approve which picks are valid for learning.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ml_verified_picks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pick_id UUID NOT NULL UNIQUE REFERENCES value_picks_v2(id) ON DELETE CASCADE,
    fixture_id BIGINT,
    market TEXT,
    selection TEXT,
    predicted_probability NUMERIC(5,3),
    odds NUMERIC(6,2),

    -- System verification (from hourly-results-verifier)
    system_verdict TEXT CHECK (system_verdict IN ('WON', 'LOST', 'VOID', 'PUSH', 'PENDING')),
    system_verified_at TIMESTAMPTZ,

    -- Manual verification (admin)
    admin_verdict TEXT CHECK (admin_verdict IN ('WON', 'LOST', 'VOID', 'PUSH')),
    admin_verified_at TIMESTAMPTZ,
    admin_verified_by UUID REFERENCES auth.users(id),
    admin_notes TEXT,

    -- Learning gate
    approved_for_learning BOOLEAN DEFAULT FALSE,
    approved_at TIMESTAMPTZ,
    processed_for_learning BOOLEAN DEFAULT FALSE,
    processed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ml_verified_pending
    ON ml_verified_picks(approved_for_learning, processed_for_learning)
    WHERE approved_for_learning = FALSE OR processed_for_learning = FALSE;

CREATE INDEX IF NOT EXISTS idx_ml_verified_pick_id
    ON ml_verified_picks(pick_id);

CREATE INDEX IF NOT EXISTS idx_ml_verified_fixture
    ON ml_verified_picks(fixture_id);

-- RLS
ALTER TABLE ml_verified_picks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ml_verified_picks_admin_all" ON ml_verified_picks;
CREATE POLICY "ml_verified_picks_admin_all" ON ml_verified_picks
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role IN ('platform_owner', 'agency_admin', 'superadmin')
        )
    );

DROP POLICY IF EXISTS "ml_verified_picks_service_role" ON ml_verified_picks;
CREATE POLICY "ml_verified_picks_service_role" ON ml_verified_picks
    FOR ALL TO service_role
    USING (true);

COMMENT ON TABLE ml_verified_picks IS
    'Manual ML learning gate. Admin must approve each verified pick before it feeds the calibration.';

-- ═══════════════════════════════════════════════════════════════
-- 2. CLV TRACKING (Closing Line Value)
-- Captures the odds ~5 minutes before match start to compute CLV.
-- CLV is the #1 predictor of long-term betting success.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE value_picks_v2 ADD COLUMN IF NOT EXISTS opening_odds NUMERIC(6,2);
ALTER TABLE value_picks_v2 ADD COLUMN IF NOT EXISTS closing_odds NUMERIC(6,2);
ALTER TABLE value_picks_v2 ADD COLUMN IF NOT EXISTS clv_percentage NUMERIC(7,3);
ALTER TABLE value_picks_v2 ADD COLUMN IF NOT EXISTS closing_captured_at TIMESTAMPTZ;

COMMENT ON COLUMN value_picks_v2.opening_odds IS 'Odds at the time the pick was created';
COMMENT ON COLUMN value_picks_v2.closing_odds IS 'Odds captured ~5min before match (closing line)';
COMMENT ON COLUMN value_picks_v2.clv_percentage IS 'Closing Line Value: (odds_taken / closing_odds - 1) * 100';

-- ═══════════════════════════════════════════════════════════════
-- 3. pgvector for RAG (similar past picks retrieval)
-- ═══════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS ml_pick_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pick_id UUID REFERENCES value_picks_v2(id) ON DELETE CASCADE,
    verified_pick_id UUID REFERENCES ml_verified_picks(id) ON DELETE CASCADE,

    -- 768-dim embedding (Gemini text-embedding-004)
    -- Using smaller dim fallback for OpenAI-compatible (1536)
    embedding VECTOR(768),

    -- Features for filtering
    features JSONB NOT NULL,
    outcome TEXT CHECK (outcome IN ('WON', 'LOST', 'VOID', 'PUSH')),
    league TEXT,
    market TEXT,
    probability_band TEXT, -- '70-75', '75-80', '80-85', '85-90', '90+'

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- IVFFlat index for fast approximate nearest neighbor search
CREATE INDEX IF NOT EXISTS idx_ml_pick_embeddings_vec
    ON ml_pick_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_ml_pick_embeddings_league
    ON ml_pick_embeddings(league);

CREATE INDEX IF NOT EXISTS idx_ml_pick_embeddings_market
    ON ml_pick_embeddings(market);

COMMENT ON TABLE ml_pick_embeddings IS
    'Vector embeddings of verified past picks for RAG-based similar-pick retrieval during analysis.';

-- Match function for RAG retrieval
CREATE OR REPLACE FUNCTION match_similar_picks(
    query_embedding VECTOR(768),
    match_threshold FLOAT DEFAULT 0.75,
    match_count INT DEFAULT 5,
    filter_league TEXT DEFAULT NULL,
    filter_market TEXT DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    pick_id UUID,
    features JSONB,
    outcome TEXT,
    league TEXT,
    market TEXT,
    similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        e.id,
        e.pick_id,
        e.features,
        e.outcome,
        e.league,
        e.market,
        1 - (e.embedding <=> query_embedding) AS similarity
    FROM ml_pick_embeddings e
    WHERE (filter_league IS NULL OR e.league = filter_league)
      AND (filter_market IS NULL OR e.market = filter_market)
      AND 1 - (e.embedding <=> query_embedding) > match_threshold
    ORDER BY e.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 4. Team xG Rolling Cache (avoid recomputing on every analysis)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS team_xg_rolling (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id BIGINT NOT NULL,
    team_name TEXT,
    window_size INT DEFAULT 10,  -- 5, 10, 20
    xg_for_avg NUMERIC(5,2),
    xga_avg NUMERIC(5,2),
    xg_diff NUMERIC(5,2),
    xg_overperformance NUMERIC(5,2),
    sample_size INT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(team_id, window_size)
);

CREATE INDEX IF NOT EXISTS idx_team_xg_rolling_team ON team_xg_rolling(team_id);

-- ═══════════════════════════════════════════════════════════════
-- 5. Referee Stats Database
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS referee_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    referee_id BIGINT UNIQUE,
    referee_name TEXT,
    matches_officiated INT DEFAULT 0,
    total_fouls NUMERIC(6,2),
    total_yellow_cards INT,
    total_red_cards INT,
    total_penalties INT,

    -- Derived stats
    fouls_per_game NUMERIC(5,2),
    yellow_per_game NUMERIC(5,2),
    red_per_10_games NUMERIC(5,2),
    penalty_rate NUMERIC(5,3),  -- penalties per match

    -- Tendency classification
    strictness_level TEXT CHECK (strictness_level IN ('LENIENT', 'BALANCED', 'STRICT', 'VERY_STRICT')),

    last_updated TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referee_stats_id ON referee_stats(referee_id);

COMMENT ON TABLE referee_stats IS
    'Referee historical tendencies for predicting cards/fouls in current match.';

-- ═══════════════════════════════════════════════════════════════
-- 6. V9 Analysis Metadata (tracks which engine produced each analysis)
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE reports_v2 ADD COLUMN IF NOT EXISTS engine_version TEXT DEFAULT 'V8.2-STRATEGIC';
ALTER TABLE reports_v2 ADD COLUMN IF NOT EXISTS math_models_used JSONB;
ALTER TABLE reports_v2 ADD COLUMN IF NOT EXISTS debate_metadata JSONB;

COMMENT ON COLUMN reports_v2.engine_version IS
    'Which analysis engine produced this report (V8.2-STRATEGIC or V9-HYBRID)';
COMMENT ON COLUMN reports_v2.math_models_used IS
    'Dixon-Coles + Elo + Monte Carlo outputs for this match';
COMMENT ON COLUMN reports_v2.debate_metadata IS
    'Which agents participated, their consensus, and final judge decision';
