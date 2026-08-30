/**
 * The bridge between the service layer and the UI.
 *
 * All orchestration lives here: starting a protected session, running the
 * investigation, pacing the live feed, escalating to a guardian, and recording
 * the audit trail. Screens call these functions; they never touch a provider.
 */
import {
  openNativeDemoPayment,
  showNativeIntervention,
  startPaymentWatch,
  type DetectedPayment,
} from '@/services/native/nativeProviders';
import {NATIVE_EVENTS, onNativeEvent} from '@/services/native/RukoNative';
import {useCallback, useEffect, useRef} from 'react';
import type {GuardianAlert, InvestigationTrigger} from '@contracts';
import {useDemo, useRuntime} from '@/services/ServicesContext';
import {prepareScenario} from '@/services/stubs/prepareScenario';
import type {ScenarioId} from '@/services/stubs/scenarios';
import {motion} from '@/theme';
import {formatMinor} from '@/utils/format';
import {useProtectionStore, type InterventionOutcome} from './protectionStore';

/** The phone stops waiting on the guardian after this and decides alone. */
const GUARDIAN_TIMEOUT_SEC = 45;

export function useProtectionController() {
  const runtime = useRuntime();
  const demo = useDemo();
  const revealTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const store = useProtectionStore;

  // Keep the guardian connection state in the store so every screen can show
  // it without subscribing to the channel itself.
  useEffect(() => {
    const unsub = demo.guardian.state.subscribe(state => {
      store.getState().setGuardianState(state);
    });
    return unsub;
  }, [demo.guardian, store]);

  useEffect(() => {
    return () => {
      if (revealTimer.current) {
        clearInterval(revealTimer.current);
      }
    };
  }, []);

  /**
   * Reveals the trace one line at a time. The work is already finished — this
   * paces the *presentation* so a person can follow what was checked. The
   * screen also prints the real compute time, so the pacing can never be
   * mistaken for the analysis taking that long.
   */
  const revealTrace = useCallback(
    (total: number, onComplete: () => void) => {
      if (revealTimer.current) {
        clearInterval(revealTimer.current);
      }
      let shown = 0;
      store.getState().setRevealed(0);
      revealTimer.current = setInterval(() => {
        shown += 1;
        store.getState().setRevealed(shown);
        if (shown >= total) {
          if (revealTimer.current) {
            clearInterval(revealTimer.current);
            revealTimer.current = null;
          }
          onComplete();
        }
      }, motion.investigationStep);
    },
    [store],
  );

  const escalate = useCallback(
    async (sessionId: string): Promise<InterventionOutcome> => {
      const state = store.getState();
      const result = state.result;
      if (!result) {
        return 'USER_STOPPED';
      }
      if (state.guardianState !== 'ONLINE') {
        return 'USER_STOPPED';
      }

      state.setMachineState('GUARDIAN_ESCALATION');
      const alert: GuardianAlert = {
        sessionId,
        deviceLabel: 'iQOO 15',
        timestamp: Date.now(),
        score: result.risk.score,
        level: result.risk.level,
        amountMinor: result.evidence.payment.amountMinor,
        currency: 'INR',
        payeeDisplayName: result.evidence.payment.payeeDisplayName,
        reasons: result.risk.reasons,
        expiresInSec: GUARDIAN_TIMEOUT_SEC,
      };
      store.getState().setGuardianAlert(alert);

      const decision = await runtime.services.guardian.sendAlert(alert);
      store.getState().setGuardianAlert(null);
      store.getState().setGuardianDecision(decision);

      if (!decision) {
        // Silence is not consent — the phone's own intervention stands.
        return 'GUARDIAN_TIMED_OUT';
      }
      return decision.decision === 'ALLOW' ? 'GUARDIAN_ALLOWED' : 'GUARDIAN_BLOCKED';
    },
    [runtime.services.guardian, store],
  );

  const runInvestigation = useCallback(
    async (trigger: InvestigationTrigger) => {
      const s = store.getState();
      s.resetInvestigation();
      s.setStatus('loading');
      s.setMachineState('INVESTIGATION');
      s.navigate('investigation');

      try {
        const result = await runtime.services.agent.investigate(trigger, entry => {
          store.getState().pushTrace(entry);
        });

        store.getState().setResult(result);
        store.getState().setStatus('ready');

        const interrupts =
          result.risk.policyAction === 'BLOCK_WARNING' ||
          result.risk.policyAction === 'STRONG_WARNING';

        store.getState().recordEvent({
          sessionId: result.sessionId,
          amountMinor: result.evidence.payment.amountMinor,
          payeeDisplayName: result.evidence.payment.payeeDisplayName,
          score: result.risk.score,
          level: result.risk.level,
          policyAction: result.risk.policyAction,
          reasons: result.risk.reasons,
          degraded: result.risk.degraded,
          outcome: interrupts ? 'USER_STOPPED' : 'NO_INTERRUPTION',
          modelVersion: result.risk.modelVersion,
          weightsVersion: result.risk.weightsVersion,
          policyVersion: result.risk.policyVersion,
          engineVersion: result.risk.engineVersion,
        });

        revealTrace(result.trace.length, () => {
          if (interrupts) {
            store.getState().setMachineState('INTERVENTION');
            store.getState().navigate('intervention');

            // During a real payment the user is looking at their UPI app, not
            // at Ruko. Setting the in-app screen alone would mean the warning
            // exists but nobody sees it, so the same verdict is also drawn as
            // an overlay on top of whatever is in front.
            showNativeIntervention({
              headline:
                result.risk.policyAction === 'BLOCK_WARNING'
                  ? 'Stop. This looks like a scam.'
                  : 'Wait — check this before you pay.',
              // The top reason is the one worth the user's attention; the rest are in
              // the app. A generic line only when the engine gave none.
              reason:
                result.risk.reasons[0]?.label ??
                'This payment matches a pattern seen in reported scams.',
              amountLabel: formatMinor(result.evidence.payment.amountMinor),
              payee: result.evidence.payment.payeeDisplayName ?? 'this recipient',
              requiresGuardian: result.risk.escalateToGuardian === true,
            }).then(shown => {
              if (!shown) {
                // The warning never reached the screen. Say so in the audit
                // trail rather than recording an interruption that did not
                // actually happen.
                store.getState().pushTrace({
                  timestamp: Date.now(),
                  seq: result.trace.length + 1,
                  kind: 'ERROR',
                  message:
                    'Could not show the warning over your payment app — ' +
                    '"Display over other apps" is off.',
                });
              }
            });
            if (result.risk.escalateToGuardian) {
              escalate(result.sessionId)
                .then(outcome => store.getState().updateOutcome(result.sessionId, outcome))
                // A guardian round-trip that fails leaves the phone's own
                // intervention standing, which is already on screen.
                .catch(() => store.getState().updateOutcome(result.sessionId, 'GUARDIAN_TIMED_OUT'));
            }
          } else {
            store.getState().setMachineState('RESOLVED');
          }
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        store.getState().setStatus('error', message);
        store.getState().setMachineState('MONITORING');
      }
    },
    [escalate, revealTrace, runtime.services.agent, store],
  );

  /**
   * Investigate a payment the user started themselves.
   *
   * This is the path that matters in production: the accessibility service
   * reads a payment screen in a UPI app and Ruko interrupts. Everything else —
   * the demo scenarios, the manual trigger — exists to exercise this one.
   */
  const onPaymentDetected = useCallback(
    async (payment: DetectedPayment) => {
      const state = store.getState();
      // A payment arriving while an investigation is already on screen is the
      // same payment being re-read, or one the user is already being warned
      // about. Either way, starting a second investigation would replace the
      // warning they are currently reading.
      if (state.machineState === 'INVESTIGATION' || state.machineState === 'INTERVENTION') {
        return;
      }
      demo.bus.openPayment(payment.amountMinor, payment.payeeDisplayName, payment.payeeHash);
      await runInvestigation('PAYMENT_SCREEN_DETECTED');
    },
    [demo.bus, runInvestigation, store],
  );

  // Watching for payments starts with the app and stays on. It costs nothing
  // but the accessibility service, and a protection feature the user has to
  // remember to switch on is one that is off when it matters.
  useEffect(() => {
    void startPaymentWatch().then(reason => {
      if (reason) {
        store.getState().setWatchUnavailable(reason);
      } else {
        store.getState().setWatchUnavailable(null);
      }
    });
  }, [store]);

  useEffect(() => {
    return onNativeEvent<DetectedPayment>(NATIVE_EVENTS.paymentDetected, payment => {
      void onPaymentDetected(payment);
    });
  }, [onPaymentDetected]);

  useEffect(() => {
    return onNativeEvent<{stopped: boolean}>(NATIVE_EVENTS.interventionResolved, ({stopped}) => {
      const result = store.getState().result;
      if (!result) return;
      // What the user did with the warning is the most valuable thing Ruko
      // learns, and the only honest record of whether it helped.
      store
        .getState()
        .updateOutcome(result.sessionId, stopped ? 'USER_STOPPED' : 'USER_CONTINUED');
      store.getState().setMachineState(stopped ? 'RESOLVED' : 'MONITORING');
    });
  }, [store]);

  /** Loads a scenario's context and starts the protected listening session. */
  const startScenario = useCallback(
    async (id: ScenarioId) => {
      const s = store.getState();
      s.resetInvestigation();

      const scenario = await prepareScenario(demo.bus, demo.behaviour, id);
      if (scenario.lines.length > 0) {
        await runtime.services.conversation.start(`demo_${id}`);
        s.setMachineState('MONITORING');
      } else {
        s.setMachineState('IDLE');
      }
      s.navigate('paydemo');
    },
    [demo.behaviour, demo.bus, runtime.services.conversation, store],
  );

  /** The user has pressed PAY in RukoPayDemo. */
  const confirmPayment = useCallback(async () => {
    const scenario = demo.bus.getScenario();
    if (!scenario) {
      return;
    }
    demo.bus.openPayment(
      scenario.payment.amountMinor,
      scenario.payment.payeeDisplayName,
      scenario.payment.payeeHash,
    );
    // In a native build the payment provider is the device's own, so writing to
    // the demo bus alone leaves it reading an empty screen. The native module
    // has a demo provider in the same chain for exactly this: it seeds the
    // input the real providers then read, rather than substituting an outcome.
    await openNativeDemoPayment(
      scenario.payment.amountMinor,
      scenario.payment.payeeDisplayName ?? 'Demo payee',
      scenario.payment.payeeHash ?? 'demo',
    );
    store.getState().setMachineState('PAYMENT_WATCH');
    await runInvestigation(scenario.trigger);
  }, [demo.bus, runInvestigation, store]);

  const endSession = useCallback(
    async (outcome: InterventionOutcome) => {
      const result = store.getState().result;
      if (result) {
        store.getState().updateOutcome(result.sessionId, outcome);
      }
      await runtime.services.conversation.stop();
      demo.bus.closePayment();
      demo.bus.reset();
      store.getState().setMachineState('IDLE');
      store.getState().resetInvestigation();
      store.getState().navigate('home');
    },
    [demo.bus, runtime.services.conversation, store],
  );

  return {runInvestigation, startScenario, confirmPayment, endSession, escalate, onPaymentDetected};
}
