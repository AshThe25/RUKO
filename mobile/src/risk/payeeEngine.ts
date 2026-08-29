/**
 * Payee engine — what does the local history say about this recipient?
 *
 * Everything is keyed on a salted hash (see hash.ts), so the store knows "you
 * have paid this person 17 times" without ever knowing who they are.
 */

import type { PayeeEvidence, TransactionRecord } from '../contracts/index.ts';
import { median } from './anomaly.ts';

const DAY_MS = 86_400_000;

export interface PayeeRecord {
  payeeHash: string;
  transactionCount: number;
  averageAmountMinor: number;
  medianAmountMinor: number;
  maxAmountMinor: number;
  firstSeen: number;
  lastSeen: number;
  /** Set by the user, e.g. marking a landlord or a parent as trusted. */
  userTrusted: boolean;
}

/** Fold local transaction history into per-payee records. */
export function buildPayeeIndex(
  history: TransactionRecord[],
  trustedHashes: ReadonlySet<string> = new Set(),
): Map<string, PayeeRecord> {
  const byPayee = new Map<string, TransactionRecord[]>();
  for (const t of history) {
    const list = byPayee.get(t.payeeHash);
    if (list) list.push(t);
    else byPayee.set(t.payeeHash, [t]);
  }

  const index = new Map<string, PayeeRecord>();
  for (const [payeeHash, txns] of byPayee) {
    const amounts = txns.map((t) => t.amountMinor);
    index.set(payeeHash, {
      payeeHash,
      transactionCount: txns.length,
      averageAmountMinor: Math.round(amounts.reduce((a, b) => a + b, 0) / amounts.length),
      medianAmountMinor: median(amounts) ?? 0,
      maxAmountMinor: Math.max(...amounts),
      firstSeen: Math.min(...txns.map((t) => t.timestamp)),
      lastSeen: Math.max(...txns.map((t) => t.timestamp)),
      userTrusted: trustedHashes.has(payeeHash),
    });
  }
  return index;
}

/**
 * Look the current payee up.
 *
 * A null hash means the payment provider could not identify the recipient at
 * all. That is `available: false` — genuinely unknown — and is deliberately NOT
 * reported as "new payee", because "we could not read the screen" and "you have
 * never paid this person" are different facts and only one of them is evidence.
 */
export function evaluatePayee(
  index: Map<string, PayeeRecord>,
  payeeHash: string | null,
  now: number,
): PayeeEvidence {
  if (!payeeHash) {
    return {
      available: false,
      source: 'LOCAL_STORE',
      unavailableReason: 'payee identifier could not be read from the payment screen',
      known: false,
      previousTransactions: 0,
      averageAmountMinor: null,
      maxAmountMinor: null,
      firstSeen: null,
      lastSeen: null,
      ageDays: null,
      userTrusted: false,
    };
  }

  const record = index.get(payeeHash);
  if (!record) {
    return {
      available: true,
      source: 'LOCAL_STORE',
      known: false,
      previousTransactions: 0,
      averageAmountMinor: null,
      maxAmountMinor: null,
      firstSeen: null,
      lastSeen: null,
      ageDays: null,
      userTrusted: false,
    };
  }

  return {
    available: true,
    source: 'LOCAL_STORE',
    known: true,
    previousTransactions: record.transactionCount,
    averageAmountMinor: record.averageAmountMinor,
    maxAmountMinor: record.maxAmountMinor,
    firstSeen: record.firstSeen,
    lastSeen: record.lastSeen,
    ageDays: Math.max(0, Math.floor((now - record.firstSeen) / DAY_MS)),
    userTrusted: record.userTrusted,
  };
}
