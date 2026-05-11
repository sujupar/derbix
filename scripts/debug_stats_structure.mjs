#!/usr/bin/env node
/**
 * DEBUG: Fetch raw SportMonks fixture to see ACTUAL statistics structure
 */

// Since we can't access SportMonks directly, let's check what SportMonks really returns
// by looking at any cached/stored raw data

const SUPABASE_URL = 'https://nokejmhlpsaoerhddcyc.supabase.co';
const SUPABASE_KEY = '__ROTATED_KEY_LOAD_FROM_ENV__';

async function checkRawStats() {
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('🔍 DEBUG: Checking raw statistics structure');
    console.log('═══════════════════════════════════════════════════════════════════\n');

    // Check if there's any raw API response stored
    const res = await fetch(`${SUPABASE_URL}/rest/v1/analysis_jobs_v2?fixture_id=eq.19429897&order=created_at.desc&limit=1&select=etl_context`, {
        headers: { 'apikey': SUPABASE_KEY }
    });
    const jobs = await res.json();

    if (!jobs[0]?.etl_context) {
        console.log('No etl_context found');
        return;
    }

    const ctx = jobs[0].etl_context;

    // Check if there's any raw_data or debug_context
    console.log('Keys in etl_context:', Object.keys(ctx));

    // Check the structure of a match with stats
    const matches = ctx.datasets?.home_team_last40?.all || [];
    const matchWithStats = matches.find(m => m.details?.possession > 0);

    if (matchWithStats) {
        console.log('\nMatch with possession data:', matchWithStats.date);
        console.log('Details object:', JSON.stringify(matchWithStats.details, null, 2));
    }

    // The problem is we only store NORMALIZED data, not raw
    // Need to verify by checking what the code does with statistics

    console.log('\n═══════════════════════════════════════════════════════════════════');
    console.log('📌 ANALYSIS:');
    console.log('═══════════════════════════════════════════════════════════════════\n');

    console.log('The issue is likely in how we extract stat values.');
    console.log('Current code uses: stat?.data?.value');
    console.log('But SportMonks v3 might use a different structure like:');
    console.log('  - stat.value');
    console.log('  - stat.data.value');
    console.log('  - stat.score');
    console.log('');
    console.log('Possession (45) and Saves (34) work, but:');
    console.log('  - Shots (42) = 0');
    console.log('  - Corners (83) = 0');
    console.log('  - Cards (57) = 0');
    console.log('  - Fouls (56) = 0');
    console.log('');
    console.log('This could mean:');
    console.log('  1. Type IDs are wrong');
    console.log('  2. Data structure is different for some stat types');
    console.log('  3. Statistics not included for some match types');
}

checkRawStats().catch(console.error);
