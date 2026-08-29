/**
 * Adapter: Aishwarya's `RukoServices` (contracts-v1.1) -> the provider shape my
 * tools consume.
 *
 * WHY THIS FILE EXISTS: the mobile app and the risk layer were built in
 * parallel against slightly different provider shapes, both reasonable. Hers is
 * subscription-oriented because the UI needs live updates; mine is one-shot
 * because a tool reads evidence once per investigation. Rather than ask either
 * side to rewrite, this maps one onto the other. It lives in `mobile/src/tools/`
 * because that is my directory — nothing in `mobile/src/services/` is touched.
 *
 * The result: swapping the stub agent and stub risk engine for the real ones in
 * `createServices.ts` is a genuine one-line change per seam, exactly as that
 * file was designed for.
 */

import type {
  BehaviourStore, RukoServices, TransactionRecord,
} from '../contracts/index.ts';
import type {
  CallProvider, ConversationProvider, HistoryStore,
  NotificationProvider, PaymentProvider, RukoProviders,
} from './providers.ts';
import { HeuristicClassifier } from '../risk/classifier/heuristicClassifier.ts';

/**
 * Her `BehaviourStore` has no way to say "the user marked this payee trusted",
 * so the adapter reports an empty trusted set.
 *
 * CONSEQUENCE, measured rather than assumed: the risk engine's amount-anomaly
 * damper also engages for any payee with 3+ prior payments
 * (ESTABLISHED_PAYEE_MIN_TXNS), so a real landlord paid monthly is still damped.
 * Only a *large first-or-second* payment to a payee the user has explicitly
 * trusted loses the damper. That is a narrow gap, and the fix is one method on
 * BehaviourStore in contracts-v1.2 — proposed, not unilaterally added, because
 * that file is Aishwarya's.
 */
const NO_TRUSTED_PAYEES: ReadonlySet<string> = new Set();

function toHistoryStore(behaviour: BehaviourStore): HistoryStore {
  return {
    async getTransactions(): Promise<TransactionRecord[]> {
      // Deliberately reads raw transactions and lets MY behaviour and payee
      // engines derive from them, rather than calling her getBehaviour() /
      // getPayee(). Those are the engines that are unit tested and that the
      // weights were tuned against; two implementations of the same statistics
      // would be two chances to disagree.
      return behaviour.listTransactions();
    },
    async getTrustedPayees(): Promise<ReadonlySet<string>> {
      return NO_TRUSTED_PAYEES;
    },
  };
}

/**
 * Her ConversationProvider already returns classified `ConversationEvidence` —
 * classification lives in the provider on her side, and in the tool on mine.
 * Hers is the better split for the UI (the live screen wants evidence, not a
 * transcript), so the adapter uses her result directly via `readEvidence` and
 * the classifier below is never actually invoked for this path.
 */
function toConversationProvider(services: RukoServices): ConversationProvider {
  return {
    // Never used on this path; present because the interface requires it, and
    // a real classifier rather than a null so nothing can NPE on it.
    classifier: new HeuristicClassifier(),
    async getRecentTranscript() {
      return null;
    },
    async readEvidence() {
      return services.conversation.read();
    },
  };
}

/**
 * Build my provider bundle from her service container.
 *
 * `now` is injected so the demo and the tests stay deterministic.
 */
export function providersFromRukoServices(
  services: RukoServices,
  now: () => number = () => Date.now(),
): RukoProviders {
  const payment: PaymentProvider = {
    getPaymentContext: () => services.payment.read(),
  };
  const call: CallProvider = {
    getCallContext: () => services.call.read(),
  };
  const notification: NotificationProvider = {
    getNotificationContext: () => services.notification.read(),
  };

  return {
    conversation: toConversationProvider(services),
    payment,
    call,
    notification,
    history: toHistoryStore(services.behaviour),
    now,
  };
}
