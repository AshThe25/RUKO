import type { Alert, Band } from './types';

/** Highest urgency first. Used to sort the feed and to colour a row. */
const BAND_RANK: Record<Band, number> = { CRITICAL: 3, HIGH: 2, MEDIUM: 1, LOW: 0 };

export function bandRank(band: Band): number {
  return BAND_RANK[band] ?? 0;
}

/**
 * Which palette token a band paints with. Only CRITICAL and HIGH earn the
 * critical red; MEDIUM is warm and LOW is deliberately quiet, so the one colour
 * that means "act now" keeps its meaning.
 */
export function bandTone(band: Band): 'critical' | 'warm' | 'cool' | 'muted' {
  switch (band) {
    case 'CRITICAL':
      return 'critical';
    case 'HIGH':
      return 'warm';
    case 'MEDIUM':
      return 'cool';
    default:
      return 'muted';
  }
}

/** Integer paise to rupees. Money is never a float anywhere in Ruko. */
export function formatMinor(amountMinor: number | null | undefined): string {
  if (amountMinor === null || amountMinor === undefined || !Number.isFinite(amountMinor)) {
    return '—';
  }
  const rupees = Math.trunc(Math.abs(amountMinor) / 100);
  const paise = Math.abs(amountMinor) % 100;
  const grouped = new Intl.NumberFormat('en-IN').format(rupees);
  const sign = amountMinor < 0 ? '-' : '';
  return paise === 0
    ? `${sign}₹${grouped}`
    : `${sign}₹${grouped}.${String(paise).padStart(2, '0')}`;
}

/** A 0–100 engine score, or an em dash when the engine did not supply one. */
export function formatScore(score: number | null | undefined): string {
  if (score === null || score === undefined || !Number.isFinite(score)) return '—';
  return String(Math.round(score));
}

/**
 * `reasons` is jsonb, so it arrives in whatever shape the engine wrote. Accept
 * an array of codes, an array of `{code|label|reason}` objects, or a single
 * object, and always return display strings. Anything unrecognised is dropped
 * rather than stringified into `[object Object]`.
 */
export function normaliseReasons(reasons: unknown): string[] {
  const out: string[] = [];

  const pushOne = (value: unknown): void => {
    if (typeof value === 'string') {
      const t = value.trim();
      if (t) out.push(t);
      return;
    }
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      const candidate = record.label ?? record.code ?? record.reason ?? record.name;
      if (typeof candidate === 'string' && candidate.trim()) out.push(candidate.trim());
    }
  };

  if (Array.isArray(reasons)) reasons.forEach(pushOne);
  else if (reasons) pushOne(reasons);

  return out;
}

/** Turns AUTHORITY_IMPERSONATION into "Authority impersonation" for display. */
export function humaniseReason(code: string): string {
  if (!/^[A-Z0-9_]+$/.test(code)) return code;
  const words = code.toLowerCase().split('_').filter(Boolean);
  if (words.length === 0) return code;
  return words.join(' ').replace(/^./, (c) => c.toUpperCase());
}

export function isAcknowledged(alert: Pick<Alert, 'acknowledged_at'>): boolean {
  return Boolean(alert.acknowledged_at);
}

/**
 * Feed order: anything still unacknowledged sits above anything handled, then
 * by band, then newest first. A CRITICAL someone already dealt with must not
 * push a live MEDIUM off the top of the screen.
 */
export function sortAlerts(alerts: Alert[]): Alert[] {
  return [...alerts].sort((a, b) => {
    const ack = Number(isAcknowledged(a)) - Number(isAcknowledged(b));
    if (ack !== 0) return ack;
    const band = bandRank(b.band) - bandRank(a.band);
    if (band !== 0) return band;
    return String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''));
  });
}

/** Merge a realtime row into the feed, replacing any existing row with that id. */
export function upsertAlert(list: Alert[], incoming: Alert): Alert[] {
  const index = list.findIndex((a) => a.id === incoming.id);
  if (index === -1) return sortAlerts([incoming, ...list]);
  const next = [...list];
  next[index] = { ...next[index], ...incoming } as Alert;
  return sortAlerts(next);
}

export function formatWhen(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const seconds = Math.round((now.getTime() - then.getTime()) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return then.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export const KIND_LABEL: Record<Alert['kind'], string> = {
  payment: 'Payment',
  call: 'Call',
  message: 'Message',
  sextortion: 'Sextortion',
};
