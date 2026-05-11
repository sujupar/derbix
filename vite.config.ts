import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// SECURITY: We deliberately do NOT inject any LLM API key into the client
// bundle. Vite `define` inlines values as string literals, which means anyone
// can read them from the production JS in DevTools.
//
// All LLM calls (Gemini, Groq, etc.) MUST go through Supabase Edge Functions
// where the secret lives as a Deno env variable.

export default defineConfig({
    server: {
        port: 3000,
        host: '0.0.0.0',
    },
    plugins: [react()],
    build: {
        // Explicitly disable source maps in production: shipping `.map` files
        // exposes the full TS source (variable names, internal API paths).
        sourcemap: false,
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, '.'),
        }
    }
});
