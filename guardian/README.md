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
