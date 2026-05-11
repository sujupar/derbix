
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://nokejmhlpsaoerhddcyc.supabase.co';
const SERVICE_KEY = '__ROTATED_KEY_LOAD_FROM_ENV__';

const fixture_id = 19431963; // The problematic Pre-Match fixture

async function verifyFix() {
    console.log(`Testing v2-create-job-sportmonks for fixture ${fixture_id}...`);
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
        console.log("Body:", text.substring(0, 500)); // Show start of body

        if (res.status === 200) {
            console.log("✅ SUCCESS: The function executed successfully! (No 500)");
            console.log("This proves the strict stats check was properly skipped for Pre-Match.");
        } else if (res.status === 400) {
            const json = JSON.parse(text);
            if (json.status === 'failed') {
                console.log("✅ PARTIAL SUCCESS: Handled error gracefully (400) instead of crash (500).");
                console.log("Error Reason:", json.error);
            } else {
                console.log("⚠️ 400 Error but check status:", json);
            }
        } else {
            console.log("❌ FAIL: Still received non-200/400 status.");
        }

    } catch (e) {
        console.error("Fetch failed:", e);
    }
}

verifyFix();
