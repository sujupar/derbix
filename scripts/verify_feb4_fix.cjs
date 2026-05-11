
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://nokejmhlpsaoerhddcyc.supabase.co';
const SERVICE_KEY = '__ROTATED_KEY_LOAD_FROM_ENV__';

const fixture_id = 19631548; // Man City vs Newcastle (Feb 4th)

async function verifyFix() {
    console.log(`Triggering Re-Analysis for Fixture ${fixture_id}...`);
    const url = `${SUPABASE_URL}/functions/v1/v2-create-job-sportmonks`;

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SERVICE_KEY}`
            },
            body: JSON.stringify({ fixture_id })
        });

        console.log(`Status: ${res.status} ${res.statusText}`);
        const text = await res.text();
        console.log("Response:", text.substring(0, 500));

        if (res.status === 200) {
            console.log("✅ Analysis Triggered Successfully!");
        } else {
            console.log("❌ Failed to trigger analysis.");
        }

    } catch (e) {
        console.error("Fetch failed:", e);
    }
}

verifyFix();
