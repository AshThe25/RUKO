/**
 * Row shapes for the `ruko` schema.
 *
 * These mirror the database exactly and deliberately stop there. In particular
 * `Alert` has no transcript, no message body and no audio reference, because
 * the product promise is that what was said stays on the phone. The console can
 * only ever render a score, a band, the reason codes, an amount and a payee
 * label — enough for a trusted person to act, and nothing more.
 *
 * `assertNoTranscript` turns that promise into something a test can fail on,
 * rather than a sentence in a README.
 */

export type Relationship =
  | 'parent'
  | 'child'
  | 'spouse'
  | 'sibling'
  | 'friend'
  | 'caregiver'
  | 'other';

export type LinkStatus = 'pending' | 'accepted' | 'revoked';

export type AlertKind = 'payment' | 'call' | 'message' | 'sextortion';

export type Band = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface Profile {
  id: string;
  email: string | null;
  display_name: string | null;
  is_minor: boolean | null;
}

export interface TrustedLink {
  id: string;
  subject_id: string;
  guardian_id: string;
  relationship: Relationship;
  status: LinkStatus;
  created_at?: string | null;
}

export interface Alert {
  id: string;
  subject_id: string;
  kind: AlertKind;
  band: Band;
  score: number | null;
  /** Reason codes from the on-device engine. Never free text from a conversation. */
  reasons: unknown;
  amount_minor: number | null;
  payee_label: string | null;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  created_at?: string | null;
}

/**
 * The columns the console is allowed to read. Anything outside this list is a
 * change to the privacy contract and has to be argued for, not slipped in.
 */
export const ALERT_COLUMNS = [
  'id',
  'subject_id',
  'kind',
  'band',
  'score',
  'reasons',
  'amount_minor',
  'payee_label',
  'acknowledged_at',
  'acknowledged_by',
  'created_at',
] as const;

/** Keys that would mean conversation content leaked into an alert. */
const FORBIDDEN = [
  'transcript',
  'transcription',
  'message_body',
  'body',
  'text',
  'content',
  'utterance',
  'audio',
  'audio_url',
  'recording',
];

/**
 * Throws if an alert row carries conversation content. Called on every row that
 * arrives from the network, so a well-meaning migration that adds a transcript
 * column fails loudly here instead of quietly rendering someone's private call.
 */
export function assertNoTranscript(row: Record<string, unknown>): void {
  for (const key of Object.keys(row)) {
    if (FORBIDDEN.includes(key.toLowerCase())) {
      throw new Error(
        `alert row carries "${key}", which would put conversation content in the ` +
          'Guardian console. Alerts must only ever contain score, band, reasons, ' +
          'amount and payee label.',
      );
    }
  }
}
