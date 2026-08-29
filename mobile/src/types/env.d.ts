/**
 * react-native-dotenv exposes mobile/.env as a virtual module. Without this
 * declaration TypeScript cannot see it and every import of '@env' is an error.
 */
declare module '@env' {
  export const SUPABASE_URL: string | undefined;
  export const SUPABASE_PUBLISHABLE_KEY: string | undefined;
  export const RUKO_BACKEND_URL: string | undefined;
}
