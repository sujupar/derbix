
import { supabase } from './supabaseService';
import { ParlayAnalysisResult } from '../types';

// --- Parlay Leg Verification via Edge Function (Groq/LLM) ---
async function verifyParlayLeg(predictionText: string, marketReceived: string, matchResultContext: string): Promise<'won' | 'lost' | 'void' | 'pending'> {
  try {
    const { data, error } = await supabase.functions.invoke('verify-parlay-leg', {
      body: { prediction: predictionText, market: marketReceived, result_context: matchResultContext }
    });

    if (error) {
      console.error("Error calling verify-parlay-leg:", error);
      return 'pending';
    }

    const verdict = (data?.verdict || '').toUpperCase();
    if (verdict.includes('WON')) return 'won';
    if (verdict.includes('LOST')) return 'lost';
    if (verdict.includes('VOID')) return 'void';
    return 'pending';
  } catch (e) {
    console.error("Error verifying leg:", e);
    return 'pending';
  }
}

export interface ParlayDB {
    id: string;
    organization_id: string;
    date: string;
    title: string;
    total_odds: number;
    legs: any[];
    justification?: string;
    strategy?: string;
    win_probability?: number;
    status: 'pending' | 'won' | 'lost' | 'void';
    created_at: string;
}

export const getParlaysByDate = async (date: string, organizationId: string): Promise<ParlayDB[]> => {
    const { data, error } = await supabase
        .from('parlays')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('date', date)
        .order('created_at', { ascending: false });

    if (error) {
        console.error("Error fetching parlays:", error);
        return [];
    }


    return data as ParlayDB[];
};

export const deleteParlaysForDate = async (date: string, organizationId: string): Promise<void> => {
    const { error } = await supabase
        .from('parlays')
        .delete()
        .eq('organization_id', organizationId)
        .eq('date', date);

    if (error) {
        console.error("Error deleting parlays:", error);
        throw error;
    }
};

export const saveParlays = async (
    date: string,
    organizationId: string,
    parlays: ParlayAnalysisResult[]
): Promise<ParlayDB[]> => {
    // 1. Clean up potential old generated parlays for this date to avoid dupes/stale data
    // (User requested explicit regeneration capability)
    const { error: deleteError } = await supabase
        .from('parlays')
        .delete()
        .eq('organization_id', organizationId)
        .eq('date', date);

    if (deleteError) {
        console.error("Error cleaning old parlays:", deleteError);
        // Continue anyway, maybe it's just empty
    }

    // 2. Map AI result to DB schema
    const rows = parlays.map(p => ({
        organization_id: organizationId,
        date: date,
        title: p.parlayTitle,
        total_odds: p.finalOdds,
        legs: p.legs,
        strategy: p.overallStrategy,
        justification: p.overallStrategy, // Redundant but keeping for schema compat if needed
        win_probability: p.winProbability
    }));

    const { data, error } = await supabase
        .from('parlays')
        .insert(rows)
        .select();

    if (error) {
        console.error("Error saving parlays:", error);
        throw error;
    }

    return data as ParlayDB[];
};

import { verifyPendingPredictions } from './analysisService';

export const verifyParlays = async (organizationId: string): Promise<{ checked: number, updated: number }> => {
    // 1. Fetch pending parlays
    const { data: parlays, error } = await supabase
        .from('parlays')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('status', 'pending');

    if (error || !parlays || parlays.length === 0) return { checked: 0, updated: 0 };

    if (error || !parlays || parlays.length === 0) return { checked: 0, updated: 0 };

    // --- STEP 0: Trigger Live Check for all Fixtures ---
    const allFixtureIds = new Set<number>();
    parlays.forEach(p => {
        p.legs?.forEach(l => {
            if (l.fixtureId && (!l.status || l.status === 'pending')) {
                allFixtureIds.add(l.fixtureId);
            }
        });
    });

    if (allFixtureIds.size > 0) {
        console.log(`Triggering live check for ${allFixtureIds.size} fixtures...`);
        // This invokes the Edge Function to fetch API data and update DB
        await verifyPendingPredictions(Array.from(allFixtureIds));
    }

    let updatedCount = 0;

    for (const parlay of parlays) {
        let legs = parlay.legs || [];
        let isUpdated = false;
        let allWon = true;
        let anyLost = false;
        let pendingLegs = false;

        for (let i = 0; i < legs.length; i++) {
            const leg = legs[i];

            // Skip already verified legs
            if (leg.status === 'won' || leg.status === 'lost') {
                if (leg.status === 'lost') anyLost = true;
                continue;
            }

            if (!leg.fixtureId) {
                pendingLegs = true;
                continue; // Cannot verify without ID
            }

            // 2. Check if we have a result for this fixture
            const { data: analysis } = await supabase
                .from('analysis_runs')
                .select('actual_outcome, post_match_analysis')
                .eq('fixture_id', leg.fixtureId)
                .single();

            // If we have an outcome (JSON) or a text analysis that implies completion
            if (analysis && (analysis.actual_outcome || analysis.post_match_analysis)) {
                // Construct context for the judge
                let resultContext = "";
                if (analysis.actual_outcome) {
                    resultContext = JSON.stringify(analysis.actual_outcome);
                } else {
                    resultContext = analysis.post_match_analysis;
                }

                // 3. JUDGE THE LEG
                const verdict = await verifyParlayLeg(leg.prediction, leg.market, resultContext);

                if (verdict !== 'pending') {
                    leg.status = verdict;
                    isUpdated = true;
                }
            }

            // Update flags based on new status
            if (leg.status === 'lost') anyLost = true;
            if (leg.status !== 'won') allWon = false;
            if (!leg.status || leg.status === 'pending') pendingLegs = true;
        }

        // 4. Update Parlay Status
        if (isUpdated) {
            let newStatus = parlay.status;
            if (anyLost) newStatus = 'lost';
            else if (allWon && !pendingLegs) newStatus = 'won';

            // Only update DB if something changed
            const { error: updateError } = await supabase
                .from('parlays')
                .update({
                    legs: legs,
                    status: newStatus
                })
                .eq('id', parlay.id);

            if (!updateError) updatedCount++;
        }
    }

    return { checked: parlays.length, updated: updatedCount };
};
