
// scripts/audit_picks_for_date.ts
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://nokejmhlpsaoerhddcyc.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '__ROTATED_KEY_LOAD_FROM_ENV__'; // Fallback to known key from previous steps for quick check

if (!SERVICE_ROLE_KEY) {
    console.error('SERVICE_ROLE_KEY is required');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const targetDate = '2026-02-02'; // YYYY-MM-DD

async function run() {
    console.log(`Auditing picks for ${targetDate}...`);

    // 1. Get Latest Jobs (Debug Dates)
    console.log('Fetching latest 10 jobs...');
    const { data: jobs, error: jobsError } = await supabase
        .from('analysis_jobs_v2')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);

    if (jobsError) {
        console.error('Error fetching jobs:', jobsError);
        return;
    }

    console.log(`Found ${jobs?.length || 0} jobs.`);

    if (!jobs || jobs.length === 0) return;

    const jobIds = jobs.map(j => j.id);

    // 2. Get Reports
    const { data: reports, error: reportsError } = await supabase
        .from('reports_v2')
        .select('job_id, report_packet')
        .in('job_id', jobIds);

    if (reportsError) {
        console.error('Error fetching reports:', reportsError);
        return;
    }

    console.log(`Found ${reports?.length || 0} reports.`);

    // 3. Extract Picks
    const picks: any[] = [];
    reports?.forEach(r => {
        const job = jobs?.find(j => j.id === r.job_id);
        const createdAt = job?.created_at;

        const p = r.report_packet;
        if (p?.pronosticos) {
            p.pronosticos.forEach((pron: any) => {
                const prob = pron.probabilidad_calculada_porcentaje || pron.probabilidad || 0;
                const probDec = prob > 1 ? prob / 100 : prob;

                picks.push({
                    selection: pron.seleccion,
                    market: pron.mercado,
                    prob: probDec,
                    odds: pron.cuota_actual || pron.cuota || 0,
                    job_id: r.job_id,
                    created_at: createdAt
                });
            });
        }
    });

    console.log(`Total Picks found: ${picks.length}`);
    if (picks.length > 0) {
        console.log(`Job Created timestamps:`, picks.slice(0, 5).map(p => p.created_at));
    }

    // 4. Analyze Constraints
    const highProb = picks.filter(p => p.prob >= 0.80);
    console.log(`High Prob (>= 80%): ${highProb.length}`);

    const anchors = highProb.filter(p => p.odds >= 1.40);
    console.log(`Anchors (Odds >= 1.40): ${anchors.length}`);

    const complements = highProb.filter(p => p.odds < 1.40);
    console.log(`Complements (Odds < 1.40): ${complements.length}`);

    console.log('\n--- DETAILED ANCHORS ---');
    anchors.forEach(p => console.log(`[${p.prob.toFixed(2)}] @${p.odds} - ${p.selection}`));

    console.log('\n--- DETAILED COMPLEMENTS ---');
    complements.forEach(p => console.log(`[${p.prob.toFixed(2)}] @${p.odds} - ${p.selection}`));
}

run();
