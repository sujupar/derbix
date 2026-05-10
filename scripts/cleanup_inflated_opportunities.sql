-- ═══════════════════════════════════════════════════════════════════
-- cleanup_inflated_opportunities.sql
--
-- Run-once cleanup: unmark `is_opportunity` for picks whose claimed
-- probability is mathematically incoherent with the stored bookmaker
-- odds (e.g. "Under 4.5 @ 1.77" while claiming 90% probability).
--
-- Same sanity table as supabase/functions/_shared/odds-selector.ts:
--   prob >= 95% → odds must be <= 1.20
--   prob >= 90% → odds must be <= 1.40
--   prob >= 85% → odds must be <= 1.70
--   prob >= 83% → odds must be <= 2.20
--
-- value_picks_v2.p_model is stored as decimal (0..1).
--
-- Effects:
--   - Sets is_opportunity=false, opportunity_rank=NULL on offending picks
--   - Leaves the row otherwise intact (does not delete, does not change
--     odds_source) so verifier and analytics history stays consistent.
--   - Affects only PENDING picks. Already-verified picks (WON/LOST/VOID)
--     remain in stats history regardless — we never rewrite the past.
-- ═══════════════════════════════════════════════════════════════════

WITH offenders AS (
    SELECT id, fixture_id, market, selection, p_model, odds, opportunity_date
    FROM value_picks_v2
    WHERE is_opportunity = true
      AND result = 'PENDING'
      AND odds IS NOT NULL
      AND p_model IS NOT NULL
      AND (
            (p_model >= 0.95 AND odds > 1.20)
         OR (p_model >= 0.90 AND p_model < 0.95 AND odds > 1.40)
         OR (p_model >= 0.85 AND p_model < 0.90 AND odds > 1.70)
         OR (p_model >= 0.83 AND p_model < 0.85 AND odds > 2.20)
      )
)
UPDATE value_picks_v2 vp
SET is_opportunity = false,
    opportunity_rank = NULL
FROM offenders o
WHERE vp.id = o.id
RETURNING vp.id, vp.fixture_id, vp.market, vp.selection, vp.p_model, vp.odds, vp.opportunity_date;
