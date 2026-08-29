# Supabase migrations

Applied to project `pqsiubukwusapbgctqgk` (`ruko`, ap-south-1).

Tables live in `public`: Ruko owns this project outright, so there is no
separate schema to expose to PostgREST and no grants to forget. An earlier
setup put them in a `ruko` schema inside a shared project and cost two
debugging rounds — PGRST106 (schema not exposed), then 42501 (no grants).

1. `ruko_schema` — profiles, trusted_links, alerts; RLS with three policies per
   table; Realtime on alerts and trusted_links.
2. `hide_is_guardian_of_from_api` — moves `is_guardian_of` into a `private`
   schema. In `public` it was a SECURITY DEFINER function exposed at
   `/rest/v1/rpc/`, so any caller could ask whether one user guards another and
   learn a relationship the policies never disclose. Revoking EXECUTE would
   have broken every read, because policies call it as the querying role.

## Invariants worth keeping

- An unaccepted invite grants nothing. `is_guardian_of` requires
  `status = 'accepted'`, which is what makes it safe for the visibility policy
  to let an invitee see a row addressed to their email.
- Only the subject creates a link; only the named guardian can claim it.
- Alerts carry score, band, reasons, amount and payee label. There is no column
  for a transcript, so the privacy promise holds even if a caller forgets it.
