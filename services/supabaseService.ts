import { createClient } from '@supabase/supabase-js';

// SECURITY:
// - The anon key is designed to be public, but we still read it from
//   environment variables so the project ref isn't pinned in source and so
//   you can swap projects without touching code.
// - The SERVICE_ROLE key MUST NEVER appear here. Service-role only belongs in
//   Supabase Edge Functions (Deno env vars). If you ever see eyJ...service_role
//   in client code, treat it as a P0 incident.
//
// Netlify env vars expected:
//   VITE_SUPABASE_URL=https://<project>.supabase.co
//   VITE_SUPABASE_ANON_KEY=eyJ...anon...
// (Vite requires the `VITE_` prefix to expose vars to the browser.)

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    // Fail loud — surface the misconfiguration immediately rather than
    // silently fall back to a hard-coded value.
    throw new Error(
        'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. ' +
        'Set them in Netlify → Site settings → Environment variables.'
    );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
