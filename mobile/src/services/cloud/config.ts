/**
 * Build-time cloud configuration.
 *
 * These are read from mobile/.env, which is gitignored. The publishable key is
 * safe to ship in a client — row-level security in Postgres, not secrecy of
 * this string, is what protects the data. A service-role key must never appear
 * here or anywhere else in the app.
 */
import {SUPABASE_PUBLISHABLE_KEY as KEY, SUPABASE_URL as URL} from '@env';

export const SUPABASE_URL = URL ?? '';
export const SUPABASE_PUBLISHABLE_KEY = KEY ?? '';
