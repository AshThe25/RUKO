import { describe, expect, test } from 'vitest';

import {
  bandRank,
  bandTone,
  formatMinor,
  formatScore,
  formatWhen,
  humaniseReason,
  normaliseReasons,
  sortAlerts,
  upsertAlert,
} from '../alerts';
import { ALERT_COLUMNS, assertNoTranscript, type Alert } from '../types';

const alert = (over: Partial<Alert> = {}): Alert => ({
  id: 'a1',
  subject_id: 's1',
  kind: 'payment',
  band: 'HIGH',
  score: 72,
  reasons: ['COERCION'],
  amount_minor: 4_800_000,
  payee_label: 'Ravi Verify',
  acknowledged_at: null,
  acknowledged_by: null,
  created_at: '2026-08-29T10:00:00.000Z',
  ...over,
});

describe('money', () => {
  test('formats paise as rupees', () => {
    // The pitch amount: 48,00,000 paise is ₹48,000, not ₹48,00,000.
    expect(formatMinor(4_800_000)).toBe('₹48,000');
    expect(formatMinor(50_000)).toBe('₹500');
  });

  test('groups in the Indian system at lakh scale', () => {
    expect(formatMinor(480_000_000)).toBe('₹48,00,000');
  });

  test('keeps paise when they are not zero', () => {
    expect(formatMinor(12_345)).toBe('₹123.45');
  });

  test('missing amount is an em dash, never zero', () => {
    expect(formatMinor(null)).toBe('—');
    expect(formatMinor(undefined)).toBe('—');
  });
});

describe('score', () => {
  test('rounds a real score and dashes a missing one', () => {
    expect(formatScore(72.4)).toBe('72');
    expect(formatScore(null)).toBe('—');
  });
});

describe('bands', () => {
  test('rank orders by urgency', () => {
    expect(bandRank('CRITICAL')).toBeGreaterThan(bandRank('HIGH'));
    expect(bandRank('HIGH')).toBeGreaterThan(bandRank('MEDIUM'));
    expect(bandRank('MEDIUM')).toBeGreaterThan(bandRank('LOW'));
  });

  test('only CRITICAL paints critical red', () => {
    expect(bandTone('CRITICAL')).toBe('critical');
    expect(bandTone('HIGH')).not.toBe('critical');
    expect(bandTone('LOW')).toBe('muted');
  });
});

describe('reasons (jsonb of unknown shape)', () => {
  test('accepts an array of codes', () => {
    expect(normaliseReasons(['COERCION', 'URGENCY'])).toEqual(['COERCION', 'URGENCY']);
  });

  test('accepts objects with code or label', () => {
    expect(normaliseReasons([{ code: 'NEW_PAYEE' }, { label: 'Amount anomaly' }])).toEqual([
      'NEW_PAYEE',
      'Amount anomaly',
    ]);
  });

  test('drops shapes it does not understand instead of rendering [object Object]', () => {
    expect(normaliseReasons([1, null, {}, 'OK'])).toEqual(['OK']);
    expect(normaliseReasons(null)).toEqual([]);
  });

  test('humanises engine codes', () => {
    expect(humaniseReason('AUTHORITY_IMPERSONATION')).toBe('Authority impersonation');
    expect(humaniseReason('Already readable')).toBe('Already readable');
  });
});

describe('feed ordering', () => {
  test('unacknowledged outranks acknowledged, even at a lower band', () => {
    const handledCritical = alert({ id: 'c', band: 'CRITICAL', acknowledged_at: '2026-08-29T10:05:00Z' });
    const liveMedium = alert({ id: 'm', band: 'MEDIUM' });
    expect(sortAlerts([handledCritical, liveMedium])[0]!.id).toBe('m');
  });

  test('within the same state, higher band comes first', () => {
    const high = alert({ id: 'h', band: 'HIGH' });
    const critical = alert({ id: 'c', band: 'CRITICAL' });
    expect(sortAlerts([high, critical])[0]!.id).toBe('c');
  });

  test('upsert replaces a row by id rather than duplicating it', () => {
    const list = [alert({ id: 'a1' })];
    const next = upsertAlert(list, alert({ id: 'a1', acknowledged_at: '2026-08-29T10:06:00Z' }));
    expect(next).toHaveLength(1);
    expect(next[0]!.acknowledged_at).not.toBeNull();
  });

  test('upsert adds a row it has not seen', () => {
    expect(upsertAlert([alert({ id: 'a1' })], alert({ id: 'a2' }))).toHaveLength(2);
  });
});

describe('time', () => {
  test('renders a relative age', () => {
    const now = new Date('2026-08-29T10:00:30.000Z');
    expect(formatWhen('2026-08-29T10:00:00.000Z', now)).toBe('30s ago');
  });

  test('survives a null or malformed timestamp', () => {
    expect(formatWhen(null)).toBe('');
    expect(formatWhen('not-a-date')).toBe('');
  });
});

describe('privacy contract', () => {
  test('the column list carries no conversation content', () => {
    for (const column of ALERT_COLUMNS) {
      expect(['transcript', 'text', 'body', 'content', 'audio']).not.toContain(column);
    }
  });

  test('a row carrying a transcript is rejected, loudly', () => {
    expect(() => assertNoTranscript({ ...alert(), transcript: 'he said...' })).toThrow(/transcript/i);
  });

  test('an ordinary row passes', () => {
    expect(() => assertNoTranscript({ ...alert() })).not.toThrow();
  });
});
