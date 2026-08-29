/**
 * Money is carried through the contracts in paise (`amountMinor`) so that no
 * float rounding can ever change an amount the user is shown. Formatting back
 * to rupees happens here and nowhere else.
 */

/** Indian digit grouping: 48000 -> "48,000". */
export function groupIndian(value: number): string {
  const rounded = Math.round(value);
  const s = String(Math.abs(rounded));
  if (s.length <= 3) {
    return (rounded < 0 ? '-' : '') + s;
  }
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return (rounded < 0 ? '-' : '') + rest + ',' + last3;
}

/** paise -> "₹48,000". Whole rupees unless the amount has paise. */
export function formatMinor(amountMinor: number | null | undefined): string {
  if (amountMinor === null || amountMinor === undefined || !Number.isFinite(amountMinor)) {
    return '₹—';
  }
  const rupees = amountMinor / 100;
  if (Number.isInteger(rupees)) {
    return '₹' + groupIndian(rupees);
  }
  return '₹' + groupIndian(Math.floor(rupees)) + '.' + String(Math.round(amountMinor % 100)).padStart(2, '0');
}

export function rupeesToMinor(rupees: number): number {
  return Math.round(rupees * 100);
}

/** 4.234 -> "4.2×". Used for the amount ratio. */
export function formatRatio(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  return `${value.toFixed(1)}×`;
}

/** 0.94 -> "94%". */
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  return `${Math.round(value * 100)}%`;
}

export function formatClock(timestamp: number): string {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) {
    return '--:--:--';
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function formatRelative(timestamp: number, now: number = Date.now()): string {
  if (!Number.isFinite(timestamp)) {
    return '';
  }
  const mins = Math.floor(Math.max(0, now - timestamp) / 60000);
  if (mins < 1) {
    return 'just now';
  }
  if (mins < 60) {
    return `${mins}m ago`;
  }
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${Math.floor(hours / 24)}d ago`;
}

export function formatLatency(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) {
    return '—';
  }
  return `${Math.round(ms)} ms`;
}
