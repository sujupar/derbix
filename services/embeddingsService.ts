// embeddingsService — DEPRECATED & DISABLED
//
// This service previously called the Gemini API directly from the browser
// using `import.meta.env.VITE_GEMINI_API_KEY`, which would have inlined the
// key into the production bundle (visible to any visitor in DevTools).
//
// Per the Feb 2026 simplified MVP plan, all ML/embedding work moved to the
// edge function pipeline (`v3-ai-analyzer`, `ml-*` functions). Nothing in
// the active app references this module anymore.
//
// If you need similarity search again, build it as an edge function that
// reads the Gemini key from Deno env — never from the client.

const DEPRECATED = (name: string) => () => {
    throw new Error(
        `[embeddingsService.${name}] Disabled. ML/embeddings work happens in ` +
        `Supabase edge functions; calling from the browser would leak the API key.`
    );
};

export const generateEmbedding = DEPRECATED("generateEmbedding");
export const buildContextText = DEPRECATED("buildContextText");
export const saveEmbedding = DEPRECATED("saveEmbedding");
export const findSimilarPredictions = DEPRECATED("findSimilarPredictions");
export const calculateConfidenceAdjustment = DEPRECATED("calculateConfidenceAdjustment");
export const backfillEmbeddings = DEPRECATED("backfillEmbeddings");
