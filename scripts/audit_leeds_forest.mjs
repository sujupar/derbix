#!/usr/bin/env node
/**
 * DEEP AUDIT: Verify historical data accuracy for Leeds vs Forest
 * This script checks what data we have stored and validates the AI's claims
 */

const SUPABASE_URL = 'https://nokejmhlpsaoerhddcyc.supabase.co';
const SUPABASE_KEY = '__ROTATED_KEY_LOAD_FROM_ENV__';

async function auditData() {
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('🔍 DEEP AUDIT: Leeds vs Nottingham Forest Data Accuracy');
    console.log('═══════════════════════════════════════════════════════════════════\n');

    // 1. Get the latest job with etl_context
    const jobRes = await fetch(`${SUPABASE_URL}/rest/v1/analysis_jobs_v2?fixture_id=eq.19427701&order=created_at.desc&limit=1&select=id,etl_context,created_at,status`, {
        headers: { 'apikey': SUPABASE_KEY }
    });
    const jobs = await jobRes.json();

    if (!jobs[0]) {
        console.log('❌ No job found for fixture 19427701');
        return;
    }

    const job = jobs[0];
    console.log(`📋 Job ID: ${job.id}`);
    console.log(`📅 Created: ${job.created_at}`);
    console.log(`📊 Status: ${job.status}`);
    console.log(`📦 Has etl_context: ${job.etl_context ? 'YES' : 'NO'}\n`);

    if (!job.etl_context) {
        console.log('❌ etl_context is missing! This is why the AI has no data.');
        return;
    }

    const ctx = job.etl_context;
    const datasets = ctx.datasets || {};

    // 2. Analyze HOME TEAM (Leeds) history
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('🏠 LEEDS UNITED - HOME MATCHES ANALYSIS');
    console.log('═══════════════════════════════════════════════════════════════════\n');

    const leedsHistory = datasets.home_team_last40?.all || [];
    const leedsHomeMatches = leedsHistory.filter(m => m.was_home === true);

    console.log(`Total matches in history: ${leedsHistory.length}`);
    console.log(`Matches as HOME: ${leedsHomeMatches.length}\n`);

    // Count results for Leeds AS HOME
    let leedsHomeWins = 0, leedsHomeDraws = 0, leedsHomeLosses = 0;
    let leedsHomeNoGoals = 0; // Matches where Leeds didn't score at home

    console.log('📊 Leeds HOME matches (most recent first):');
    console.log('─────────────────────────────────────────────────────────────────');

    leedsHomeMatches.slice(0, 10).forEach((m, i) => {
        const leedsGoals = m.score_home;
        const oppGoals = m.score_away;

        let result = '';
        if (leedsGoals > oppGoals) { result = '✅ WIN'; leedsHomeWins++; }
        else if (leedsGoals < oppGoals) { result = '❌ LOSS'; leedsHomeLosses++; }
        else { result = '🟡 DRAW'; leedsHomeDraws++; }

        if (leedsGoals === 0) leedsHomeNoGoals++;

        const totalGoals = leedsGoals + oppGoals;
        const under25 = totalGoals < 2.5 ? '⬇️ U2.5' : '⬆️ O2.5';

        console.log(`${i + 1}. ${m.date} | Leeds ${leedsGoals}-${oppGoals} ${m.opponent_name || m.away_team} | ${result} | ${under25}`);
    });

    console.log('\n📈 LEEDS HOME SUMMARY (last 10):');
    console.log(`   Wins: ${leedsHomeWins} | Draws: ${leedsHomeDraws} | Losses: ${leedsHomeLosses}`);
    console.log(`   Matches without scoring: ${leedsHomeNoGoals}`);
    console.log(`   AI CLAIM: "6 losses in 9 home games" → ${leedsHomeLosses >= 6 ? '✅ TRUE' : '❌ FALSE (actual: ' + leedsHomeLosses + ' losses)'}`);

    // 3. Analyze AWAY TEAM (Forest) history
    console.log('\n═══════════════════════════════════════════════════════════════════');
    console.log('✈️ NOTTINGHAM FOREST - AWAY MATCHES ANALYSIS');
    console.log('═══════════════════════════════════════════════════════════════════\n');

    const forestHistory = datasets.away_team_last40?.all || [];
    const forestAwayMatches = forestHistory.filter(m => m.was_home === false);

    console.log(`Total matches in history: ${forestHistory.length}`);
    console.log(`Matches as AWAY: ${forestAwayMatches.length}\n`);

    // Count Under 2.5 for Forest AWAY
    let forestAwayUnder25 = 0;
    let forestAwayWins = 0, forestAwayDraws = 0, forestAwayLosses = 0;

    console.log('📊 Forest AWAY matches (most recent first):');
    console.log('─────────────────────────────────────────────────────────────────');

    forestAwayMatches.slice(0, 10).forEach((m, i) => {
        const forestGoals = m.score_away;  // Forest is away
        const oppGoals = m.score_home;

        let result = '';
        if (forestGoals > oppGoals) { result = '✅ WIN'; forestAwayWins++; }
        else if (forestGoals < oppGoals) { result = '❌ LOSS'; forestAwayLosses++; }
        else { result = '🟡 DRAW'; forestAwayDraws++; }

        const totalGoals = forestGoals + oppGoals;
        const under25 = totalGoals < 2.5;
        if (under25) forestAwayUnder25++;

        console.log(`${i + 1}. ${m.date} | ${m.opponent_name || m.home_team} ${oppGoals}-${forestGoals} Forest | ${result} | ${under25 ? '⬇️ U2.5' : '⬆️ O2.5'}`);
    });

    console.log('\n📈 FOREST AWAY SUMMARY (last 10):');
    console.log(`   Wins: ${forestAwayWins} | Draws: ${forestAwayDraws} | Losses: ${forestAwayLosses}`);
    console.log(`   Under 2.5 matches: ${forestAwayUnder25}/10`);
    console.log(`   AI CLAIM: "Under 2.5 in 9 of 10 away games" → ${forestAwayUnder25 >= 9 ? '✅ TRUE' : '❌ FALSE (actual: ' + forestAwayUnder25 + '/10)'}`);

    // 4. Check what prompt data format looks like
    console.log('\n═══════════════════════════════════════════════════════════════════');
    console.log('📝 SAMPLE DATA STRUCTURE (First match from each team)');
    console.log('═══════════════════════════════════════════════════════════════════\n');

    if (leedsHomeMatches[0]) {
        console.log('🏠 Leeds first HOME match:');
        console.log(JSON.stringify(leedsHomeMatches[0], null, 2));
    }

    if (forestAwayMatches[0]) {
        console.log('\n✈️ Forest first AWAY match:');
        console.log(JSON.stringify(forestAwayMatches[0], null, 2));
    }

    // 5. Check H2H
    console.log('\n═══════════════════════════════════════════════════════════════════');
    console.log('🤝 HEAD TO HEAD (H2H)');
    console.log('═══════════════════════════════════════════════════════════════════\n');

    const h2h = datasets.h2h || [];
    console.log(`H2H records: ${h2h.length}`);
    h2h.slice(0, 5).forEach((m, i) => {
        console.log(`${i + 1}. ${m.date} | ${m.home_team} ${m.score_home}-${m.score_away} ${m.away_team}`);
    });

    console.log('\n═══════════════════════════════════════════════════════════════════');
    console.log('✅ AUDIT COMPLETE');
    console.log('═══════════════════════════════════════════════════════════════════\n');
}

auditData().catch(console.error);
