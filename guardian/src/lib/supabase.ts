'use client';

import { createClient } from '@supabase/supabase-js';

/**
 * The browser Supabase client.
 *
 * Two things here are load-bearing and easy to get wrong:
 *
 *  - `db.schema` must be 'ruko'. Every Ruko table lives in that schema, not in
 *    `public`, so a default client returns PGRST106 on every query. Note that
 *    this option covers PostgREST calls only — Realtime subscriptions take the
 *    schema in their own filter, which is why `schema: 'ruko'` appears again in
 *    the channel config in useAlerts.
 *  - PKCE with `detectSessionInUrl` lets the OAuth redirect complete entirely in
 *    the browser, so the console needs no server route and no service-role key.
 *    The publishable key is safe in the client precisely because RLS, not the
 *    key, is what protects the rows.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const supabaseConfigured = Boolean(url && publishableKey);

function create() {
  return createClient(url!, publishableKey!, {
    db: { schema: 'ruko' },
    auth: {
      flowType: 'pkce',
      detectSessionInUrl: true,
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}

/**
 * Inferred rather than annotated: the client's type carries the schema as a
 * generic parameter, so writing `SupabaseClient` by hand pins it back to
 * 'public' and every query stops type-checking.
 */
export type RukoClient = ReturnType<typeof create>;

let client: RukoClient | null = null;

export function getSupabase(): RukoClient {
  if (!supabaseConfigured) {
    throw new Error(
      'Supabase is not configured. Copy guardian/.env.example to guardian/.env.local ' +
        'and set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.',
    );
  }
  const existing = client;
  if (existing) return existing;
  const created = create();
  client = created;
  return created;
}
