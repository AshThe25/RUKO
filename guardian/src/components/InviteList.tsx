'use client';

import type { Invite } from '@/lib/useInvites';

function subjectName(invite: Invite): string {
  return invite.subject?.display_name?.trim()
    || invite.subject?.email?.trim()
    || `Someone (${invite.subject_id.slice(0, 8)}…)`;
}

export function InviteList({
  invites,
  accepted,
  onAccept,
}: {
  invites: Invite[];
  accepted: Invite[];
  onAccept: (id: string) => void;
}) {
  if (invites.length === 0 && accepted.length === 0) return null;

  return (
    <>
      {invites.length > 0 ? (
        <section className="section">
          <div className="section-head">
            <h2>Pending invitations</h2>
            <span className="small">{invites.length} waiting</span>
          </div>

          <div className="rows">
            {invites.map((invite) => (
              <div className="row" key={invite.id}>
                <div>
                  {/* The subject creates the link; only the guardian may accept
                      it. So the direction of this sentence is a fact of the
                      schema, not a guess. */}
                  <div style={{ fontWeight: 600 }}>{subjectName(invite)}</div>
                  <div className="small">
                    wants you as their guardian
                    <span className="chip chip-cool" style={{ marginLeft: 8 }}>
                      {invite.relationship}
                    </span>
                  </div>
                </div>
                <button className="pill pill-solid pill-sm" onClick={() => onAccept(invite.id)}>
                  Accept
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {accepted.length > 0 ? (
        <section className="section">
          <div className="section-head">
            <h2>You are watching over</h2>
          </div>
          <div className="rows">
            {accepted.map((link) => (
              <div className="row" key={link.id}>
                <div>
                  <div style={{ fontWeight: 600 }}>{subjectName(link)}</div>
                  <div className="small">
                    <span className="chip chip-muted">{link.relationship}</span>
                  </div>
                </div>
                <span className="chip chip-safe">Accepted</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
