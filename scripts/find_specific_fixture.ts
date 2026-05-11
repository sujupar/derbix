
// scripts/find_specific_fixture.ts
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://nokejmhlpsaoerhddcyc.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '__ROTATED_KEY_LOAD_FROM_ENV__';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function run() {
    const date = '2026-02-01';
    console.log(`Searching fixtures for ${date}...`);

    // Use our v2-list proxy or just fetch via client wrapper if valid
    // For audit, using the Edge Function via invoke is easiest to mimic system behavior
    const { data: fixtures, error } = await supabase.functions.invoke('v2-list-fixtures-sportmonks', {
        body: { date }
    });

    if (error) {
        console.error('Error fetching list:', error);
        return;
    }

    // Filter for Fortuna Dusseldorf vs Paderborn
    const target = fixtures.find((f: any) => {
        const h = f.teams.home.name.toLowerCase();
        const a = f.teams.away.name.toLowerCase();
        return (h.includes('fortuna') || h.includes('dusseldorf')) && (a.includes('paderborn'));
    });

    if (target) {
        console.log(`FOUND FIXTURE:`);
        console.log(`ID: ${target.fixture.id}`);
        console.log(`${target.teams.home.name} vs ${target.teams.away.name}`);
        console.log(`Status: ${target.fixture.status.short}`);
    } else {
        console.log('Fixture not found in list.');
        // List a few to verify
        if (fixtures.length > 0) {
            console.log('Sample fixtures found:', fixtures.slice(0, 3).map((f: any) => `${f.teams.home.name} vs ${f.teams.away.name}`));
        }
    }
}

run();
