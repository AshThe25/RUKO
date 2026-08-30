/**
 * A real `@env` for the Node test runner.
 *
 * `@env` is a virtual module: react-native-dotenv synthesises it from
 * mobile/.env at build time, so it exists under Babel and Metro and nowhere
 * else. That is fine for the app and fatal for `node --test`, which resolves
 * modules for real and cannot find it — `spendHold.test.ts` died on
 * MODULE_NOT_FOUND before a single assertion ran.
 *
 * Only `tsconfig.node-tests.json` maps `@env` here, so the app build and the
 * ambient declaration in `env.d.ts` are untouched.
 *
 * Everything is undefined on purpose. `cloudConfigured` is then false, which is
 * the configuration the tests want anyway: a phone with no credentials,
 * protecting on its own.
 */
export const SUPABASE_URL: string | undefined = undefined;
export const SUPABASE_PUBLISHABLE_KEY: string | undefined = undefined;
export const RUKO_BACKEND_URL: string | undefined = undefined;
