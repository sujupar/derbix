
// scripts/audit_fixture_odds.ts
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://nokejmhlpsaoerhddcyc.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '__ROTATED_KEY_LOAD_FROM_ENV__';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function run() {
    const fixtureId = 19434116; // Fortuna vs Paderborn
    console.log(`Auditing Odds for Fixture ${fixtureId}...`);

    console.log('Fetching PRE-MATCH odds from SportMonks (via v2-get-fixture-details-sportmonks debug mode)');

    const { data: rawFixture, error } = await supabase.functions.invoke('v2-get-fixture-details-sportmonks', {
        body: { fixtureId, debug: true }
    });

    if (error) {
        console.error('Error fetching details:', error);
        return;
    }

    if (!rawFixture || !rawFixture.odds) {
        console.error('No odds found in RAW debug response.');
        if (rawFixture) console.log('Keys available:', Object.keys(rawFixture));
    } else {
        const rawOdds = rawFixture.odds;
        console.log(`RAW Odds Count: ${rawOdds.length}`);

        // Search for 1.53
        const suspicious153 = rawOdds.filter((o: any) => Math.abs(parseFloat(o.value) - 1.53) < 0.01);
        console.log(`\n--- Likely 1.53 Candidates (${suspicious153.length}) ---`);
        suspicious153.forEach((o: any) => {
            console.log(` - Market: ${o.market_id} | Label: ${o.label} | Bookie: ${o.bookmaker_id} | Val: ${o.value}`);
        });

        // Search for 1.28
        const likelyReal128 = rawOdds.filter((o: any) => Math.abs(parseFloat(o.value) - 1.28) < 0.01);
        console.log(`\n--- Likely 1.28 Candidates (${likelyReal128.length}) ---`);
        likelyReal128.forEach((o: any) => {
            console.log(` - Market: ${o.market_id} | Label: ${o.label} | Bookie: ${o.bookmaker_id} | Val: ${o.value}`);
        });
    }
}

run();
