// ============================================================================
// lib/supabase.ts
// ============================================================================
// Browser-side Supabase client. Returns null when env vars are not set so
// callers (lib/cases-server.ts, etc.) can fall back to the static lib/cases
// dataset for SSG builds before Supabase is wired.
//
// IMPORTANT: this module is safe to import at build time. Importing it does
// NOT instantiate a client if env vars are missing — `getSupabase()` is the
// only call that actually constructs one (lazy).
//
// Env contract:
//   NEXT_PUBLIC_SUPABASE_URL         — https://<ref>.supabase.co
//   NEXT_PUBLIC_SUPABASE_ANON_KEY    — anon publishable key
//
// See .env.local.example.
// ============================================================================

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export type Supabase = SupabaseClient<Database>;

let _client: Supabase | null = null;

/**
 * Returns the Supabase browser client, or `null` if env vars are not set.
 * Caller MUST handle the null case and fall back to static data.
 */
export function getSupabase(): Supabase | null {
  if (!url || !anonKey) return null;
  if (_client) return _client;
  _client = createClient<Database>(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return _client;
}

/** True when both env vars are present and a client can be constructed. */
export function isSupabaseConfigured(): boolean {
  return Boolean(url && anonKey);
}
