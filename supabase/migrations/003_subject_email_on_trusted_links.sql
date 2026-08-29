-- Show the invitee who is asking.
--
-- trusted_links already stores guardian_email, so the subject always knows who
-- they invited. Nothing recorded the other direction, so the invitee saw
-- "Someone added you as their parent" — and a name is the entire basis for
-- deciding whether to accept. Nobody can judge an anonymous request to become
-- their parent.
--
-- A profile lookup cannot fix this. Reading the inviter's profile is gated on
-- an accepted link, so the name would only become visible after the decision it
-- was needed for. Denormalising the address onto the row mirrors what
-- guardian_email already does and needs no new visibility on profiles.

alter table public.trusted_links
  add column if not exists subject_email text;

comment on column public.trusted_links.subject_email is
  'Email of the user who proposed the link, recorded at insert. Lets the '
  'invitee see who is asking without widening read access to profiles.';

-- Backfill existing rows from the inviter's profile. Runs as the migration
-- role, so it is not subject to the policy that blocks the client.
update public.trusted_links l
   set subject_email = p.email
  from public.profiles p
 where p.id = l.subject_id
   and l.subject_email is null;
