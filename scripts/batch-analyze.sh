#!/bin/bash
# Batch Analysis Script V2 for Feb 24, 2026
# NEW APPROACH: ETL first (saves etl_context), then call analyzer directly
# This avoids the fire-and-forget issue where the analyzer never receives the payload

SB_URL="https://nokejmhlpsaoerhddcyc.supabase.co"
ANON_KEY="__ROTATED_KEY_LOAD_FROM_ENV__"
SERVICE_KEY="__ROTATED_KEY_LOAD_FROM_ENV__"
TARGET_DATE="2026-02-24"
LOG_FILE="/Users/apple/Documents/Centro-de-Mando---Pron-sticos-1/scripts/batch-analyze.log"
MAX_WAIT=300  # 5 minutes max wait per analysis
POLL_INTERVAL=10  # Check every 10 seconds

# Counters
TOTAL=0
SUCCESS=0
FAILED=0
SKIPPED=0

log() {
    echo "[$(date '+%H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Clear log
> "$LOG_FILE"
log "═══════════════════════════════════════════════════════════"
log "BATCH ANALYSIS V2 - ${TARGET_DATE} - V8.1-MASTERMIND"
log "Strategy: ETL + Direct Analyzer Call (no fire-and-forget)"
log "═══════════════════════════════════════════════════════════"

# Get all fixture IDs for the target date
FIXTURES=$(curl -s "${SB_URL}/rest/v1/daily_matches?match_date=eq.${TARGET_DATE}&select=api_fixture_id,home_team,away_team,league_name&order=league_name,match_time" \
    -H "apikey: ${ANON_KEY}" \
    -H "Authorization: Bearer ${ANON_KEY}")

# Parse fixture IDs
FIXTURE_IDS=($(echo "$FIXTURES" | python3 -c "import json,sys; [print(m['api_fixture_id']) for m in json.load(sys.stdin)]"))

TOTAL_FIXTURES=${#FIXTURE_IDS[@]}
log "Found ${TOTAL_FIXTURES} fixtures to analyze"
log ""

for i in "${!FIXTURE_IDS[@]}"; do
    FIXTURE_ID=${FIXTURE_IDS[$i]}
    MATCH_INFO=$(echo "$FIXTURES" | python3 -c "
import json,sys
data = json.load(sys.stdin)
for m in data:
    if m['api_fixture_id'] == ${FIXTURE_ID}:
        print(f\"{m['home_team']} vs {m['away_team']} [{m['league_name']}]\")
        break
")

    TOTAL=$((TOTAL + 1))
    log "───────────────────────────────────────────────────────"
    log "[${TOTAL}/${TOTAL_FIXTURES}] ${MATCH_INFO} (ID: ${FIXTURE_ID})"

    # Check if already analyzed (skip if done)
    EXISTING=$(curl -s "${SB_URL}/rest/v1/analysis_jobs_v2?fixture_id=eq.${FIXTURE_ID}&status=eq.done&select=id&limit=1" \
        -H "apikey: ${ANON_KEY}" \
        -H "Authorization: Bearer ${ANON_KEY}")

    if echo "$EXISTING" | python3 -c "import json,sys; data=json.load(sys.stdin); exit(0 if len(data)>0 else 1)" 2>/dev/null; then
        log "  SKIP: Already analyzed"
        SKIPPED=$((SKIPPED + 1))
        continue
    fi

    # ═══ STEP 1: Run ETL (gets data from SportMonks, saves etl_context) ═══
    log "  [1/3] Running ETL..."
    ETL_RESPONSE=$(curl -s -X POST "${SB_URL}/functions/v1/v2-create-job-sportmonks" \
        -H "Authorization: Bearer ${ANON_KEY}" \
        -H "Content-Type: application/json" \
        -d "{\"fixture_id\": ${FIXTURE_ID}}")

    JOB_ID=$(echo "$ETL_RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('job_id',''))" 2>/dev/null)

    if [ -z "$JOB_ID" ] || [ "$JOB_ID" = "" ]; then
        ERROR_MSG=$(echo "$ETL_RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('error', str(d)))" 2>/dev/null)
        log "  ERROR: ETL failed — ${ERROR_MSG}"
        FAILED=$((FAILED + 1))
        sleep 3
        continue
    fi

    COVERAGE=$(echo "$ETL_RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('coverage_pct','?'))" 2>/dev/null)
    log "  [1/3] ETL OK: job=${JOB_ID}, coverage=${COVERAGE}%"

    # Wait a moment for ETL to save etl_context
    sleep 3

    # ═══ STEP 2: Check if analyzer already started (fire-and-forget may have worked) ═══
    STATUS_CHECK=$(curl -s "${SB_URL}/rest/v1/analysis_jobs_v2?id=eq.${JOB_ID}&select=status" \
        -H "apikey: ${ANON_KEY}" \
        -H "Authorization: Bearer ${ANON_KEY}")
    CURRENT_STATUS=$(echo "$STATUS_CHECK" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0]['status'] if d else 'unknown')" 2>/dev/null)

    if [ "$CURRENT_STATUS" = "done" ]; then
        log "  [2/3] Already done (fire-and-forget worked!)"
        SUCCESS=$((SUCCESS + 1))
        continue
    fi

    # ═══ STEP 2b: If stuck at 'interpret', call analyzer directly ═══
    if [ "$CURRENT_STATUS" = "interpret" ] || [ "$CURRENT_STATUS" = "etl" ]; then
        log "  [2/3] Calling analyzer directly (status=${CURRENT_STATUS})..."

        # Call v3-ai-analyzer with just job_id and fixture_id
        # The analyzer will read etl_context from the DB
        ANALYZER_RESPONSE=$(curl -s -m 280 -X POST "${SB_URL}/functions/v1/v3-ai-analyzer" \
            -H "Authorization: Bearer ${SERVICE_KEY}" \
            -H "Content-Type: application/json" \
            -d "{\"job_id\": \"${JOB_ID}\", \"fixture_id\": ${FIXTURE_ID}}")

        ANALYZER_STATUS=$(echo "$ANALYZER_RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('status','unknown'))" 2>/dev/null)
        log "  [2/3] Analyzer returned: ${ANALYZER_STATUS}"
    elif [ "$CURRENT_STATUS" = "analyzing" ]; then
        log "  [2/3] Analyzer already running (status=${CURRENT_STATUS}), waiting..."
    fi

    # ═══ STEP 3: Poll for completion ═══
    WAITED=0
    FINAL_STATUS="timeout"

    while [ $WAITED -lt $MAX_WAIT ]; do
        sleep $POLL_INTERVAL
        WAITED=$((WAITED + POLL_INTERVAL))

        STATUS_RESPONSE=$(curl -s "${SB_URL}/rest/v1/analysis_jobs_v2?id=eq.${JOB_ID}&select=status" \
            -H "apikey: ${ANON_KEY}" \
            -H "Authorization: Bearer ${ANON_KEY}")

        STATUS=$(echo "$STATUS_RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0]['status'] if d else 'unknown')" 2>/dev/null)

        if [ "$STATUS" = "done" ]; then
            FINAL_STATUS="done"
            break
        elif [ "$STATUS" = "failed" ]; then
            FINAL_STATUS="failed"
            break
        fi

        # Show progress every 30s
        if [ $((WAITED % 30)) -eq 0 ]; then
            log "  ... waiting (${WAITED}s, status: ${STATUS})"
        fi
    done

    if [ "$FINAL_STATUS" = "done" ]; then
        log "  ✅ DONE in ${WAITED}s"
        SUCCESS=$((SUCCESS + 1))
    elif [ "$FINAL_STATUS" = "failed" ]; then
        log "  ❌ FAILED after ${WAITED}s"
        FAILED=$((FAILED + 1))
    else
        log "  ⏰ TIMEOUT after ${WAITED}s (status: ${STATUS})"
        FAILED=$((FAILED + 1))
    fi

    # Pause between analyses
    sleep 2
done

log ""
log "═══════════════════════════════════════════════════════════"
log "BATCH COMPLETE"
log "  Total: ${TOTAL_FIXTURES}"
log "  Success: ${SUCCESS}"
log "  Failed: ${FAILED}"
log "  Skipped: ${SKIPPED}"
log "═══════════════════════════════════════════════════════════"
