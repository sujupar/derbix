
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'https://nokejmhlpsaoerhddcyc.supabase.co';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '__ROTATED_KEY_LOAD_FROM_ENV__';

async function reproduce() {
    const fixture_id = 19431963; // Fixture visible in screenshot
    const url = `${SUPABASE_URL}/functions/v1/v2-create-job-sportmonks`;

    console.log(`Testing ${url} for fixture ${fixture_id}...`);

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
        console.log("Body:", text);

    } catch (e) {
        console.error("Fetch failed:", e);
    }
}

reproduce();
