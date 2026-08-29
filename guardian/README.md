# Ruko Guardian (`guardian/`)

The console a trusted person opens. It shows, live, when Ruko judged that
someone they care about was being manipulated into a payment or a call — and
lets them acknowledge that they have seen it.

Built directly on Supabase: Google sign-in, Postgres with RLS, and Realtime.
There is no server of ours in the path.

## The privacy line

An alert carries **score, band, reason codes, amount and payee label**. It does
not carry the transcript, the message body, or any audio — that stays on the
phone and never reaches this database.

This is enforced, not just promised: `src/lib/types.ts` defines the exact column
list the console reads, and `assertNoTranscript()` runs over every row that
arrives (initial query *and* realtime). A migration that adds a transcript column
makes the console throw a visible error instead of quietly rendering a private
conversation. `npm test` covers it.

## Setup

```bash
cp .env.example .env.local     # already points at the project
npm install
npm run dev                    # http://localhost:3000
```

### Two settings that must be on in the Supabase dashboard

Both are project configuration, not code. Until they are set, the console will
render but cannot sign in or read anything — and it says so on screen.

1. **Expose the `ruko` schema.** Project Settings → API → Exposed schemas → add
   `ruko`. Without it every query returns `PGRST106: Invalid schema: ruko`,
   because the tables are not in `public`.
2. **Enable Google.** Authentication → Providers → Google → enable, and add the
   OAuth client id/secret from Google Cloud. Add
   `https://<project>.supabase.co/auth/v1/callback` as an authorised redirect
   URI there, and `http://localhost:3000` under URL Configuration here.

## How it works

| Piece | File |
| --- | --- |
| Client, pinned to the `ruko` schema | `src/lib/supabase.ts` |
| Google PKCE sign-in | `src/lib/useAuth.ts` |
| Pending invitations, accept | `src/lib/useInvites.ts` |
| Live feed + acknowledge | `src/lib/useAlerts.ts` |
| Pure display logic (tested) | `src/lib/alerts.ts` |

`db: { schema: 'ruko' }` covers PostgREST only. Realtime takes the schema in its
own filter, which is why `schema: 'ruko'` appears a second time in the channel
config — a subscription that omits it listens to `public` and silently never
fires.

Row-level security decides what is visible; the console never filters by user id
for security, only for display. Accepting an invitation is a plain
`update status='accepted'` — the database enforces that only the guardian may do
it.

## Tests

```bash
npm test          # vitest: money, bands, reason shapes, ordering, privacy guard
npm run lint      # tsc --noEmit
```

## Deploying to Vercel

The console is a static-rendered Next.js app that talks to Supabase from the
browser, so there is nothing server-side to configure and no secret to hold.

1. **Import the repo** in Vercel and set **Root Directory to `guardian`** — the
   repo root is not a Next.js project, and this is the step that is easy to miss.
2. **Environment variables** (Production + Preview):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

   Both are `NEXT_PUBLIC_`, so they are compiled into the client bundle. That is
   correct here: the publishable key is designed to be public, and RLS is what
   protects the rows. Never put the service-role key in this project.
3. **Allow the new origin to complete sign-in.** OAuth will fail until both are
   updated:
   - Supabase → Authentication → URL Configuration → Redirect URLs:
     add `https://<deployment>.vercel.app/**`
   - Google Cloud → the Web client's authorised redirect URIs already point at
     `https://<project>.supabase.co/auth/v1/callback`, which does not change per
     deployment — so this usually needs **no** edit. Only the Supabase redirect
     allow-list is per-origin.
4. Vercel gives every deployment its own preview URL. Each one you intend to sign
   in from needs to be in the Supabase allow-list; the wildcard above covers them.

While the Google app is in **Testing** mode, only the listed test users can sign
in — everyone else gets `403: access_denied`, on the deployed origin exactly as
on localhost.
