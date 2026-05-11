const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://nokejmhlpsaoerhddcyc.supabase.co';
const SERVICE_KEY = '__ROTATED_KEY_LOAD_FROM_ENV__';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function checkFailedBatchJobs() {
    console.log("Checking for jobs created today...");

    const today = new Date().toISOString().split('T')[0];

    // Fetch jobs
    const { data: jobs, error } = await supabase
        .from('analysis_jobs_v2')
        .select('*')
        .gte('created_at', today)
        .order('created_at', { ascending: false })
        .limit(20);

    if (error) {
        console.error("Error fetching jobs:", error);
        return;
    }

    console.log(`Found ${jobs.length} jobs from today.`);

    let firstJobId = null;

    jobs.forEach((job, index) => {
        if (index < 3) { // Only log details for first 3
            console.log(`\n--- Job ${index + 1} ---`);
            console.log(`ID: ${job.id}`);
            console.log(`Fixture: ${job.fixture_id}`);
            console.log(`Status: ${job.status}`);
            console.log(`Coverage %:`, job.coverage_pct);
            console.log(`Data Coverage:`, JSON.stringify(job.data_coverage));
        }
        if (index === 0) firstJobId = job.id;
    });

    if (firstJobId) {
        console.log(`\n[DEEP DIVE] Checking RESULT in reports_v2 for Job ${firstJobId}...`);
        const { data: result, error: resError } = await supabase
            .from('reports_v2')
            .select('*')
            .eq('job_id', firstJobId)
            .single();

        if (resError) {
            console.error("Error fetching report:", resError);
        } else if (result) {
            console.log("Report Found!");
            const packet = result.report_packet;

            if (packet) {
                console.log("\n--- REPORT PACKET SAMPLE ---");
                // Check Executive Summary
                if (packet.resumen_ejecutivo) {
                    console.log("Veredicto:", packet.resumen_ejecutivo.veredicto);
                    console.log("Confianza:", packet.resumen_ejecutivo.confianza_global);
                }

                // Check Predictions
                if (packet.pronosticos && packet.pronosticos.length > 0) {
                    console.log("\nPronosticos found:", packet.pronosticos.length);
                    packet.pronosticos.forEach((p, i) => {
                        console.log(`\nPick #${i + 1}:`);
                        console.log(`  Seleccion: ${p.seleccion}`);
                        console.log(`  Prob Calculada: ${p.probabilidad_calculada_porcentaje}%`);
                        console.log(`  Justificacion: ${p.justificacion?.tactica || 'N/A'}`);

                        if (p.probabilidad_calculada_porcentaje === 50 || p.probabilidad_calculada_porcentaje === "50") {
                            console.log("  🚨 FLAG: 50% Probability Detected");
                        }
                    });
                } else {
                    console.log("⚠️ No pronosticos array in packet.");
                }
            } else {
                console.log("⚠️ report_packet is empty/null");
            }
        } else {
            console.log("No report found in reports_v2 for this job.");
        }
    }
}

checkFailedBatchJobs();
