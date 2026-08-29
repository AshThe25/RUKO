'use client';

import type { User } from '@supabase/supabase-js';

import type { FeedStatus } from '@/lib/useAlerts';

const STATUS_TEXT: Record<FeedStatus, string> = {
  connecting: 'connecting',
  live: 'live',
  error: 'reconnecting',
};

const STATUS_DOT: Record<FeedStatus, string> = {
  connecting: 'dot dot-off',
  live: 'dot dot-live',
  error: 'dot dot-err',
};

export function Masthead({
  user,
  status,
  onSignOut,
}: {
  user: User | null;
  status: FeedStatus;
  onSignOut: () => void;
}) {
  return (
    <header className="masthead">
      <div>
        <div className="brand">
          Ruko <span>Guardian</span>
        </div>
        {/* The connection state is shown plainly: a console that has silently
            stopped receiving alerts is worse than one that admits it. */}
        <span className="live">
          <i className={STATUS_DOT[status]} aria-hidden="true" />
          {STATUS_TEXT[status]}
        </span>
      </div>

      {user ? (
        <div className="who">
          <span className="small">{user.email}</span>
          <button className="pill pill-ghost pill-sm" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      ) : null}
    </header>
  );
}
