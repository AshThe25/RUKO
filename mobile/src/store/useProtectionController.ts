/**
 * The bridge between the service layer and the UI.
 *
 * All orchestration lives here: starting a protected session, running the
 * investigation, pacing the live feed, escalating to a guardian, and recording
 * the audit trail. Screens call these functions; they never touch a provider.
 */
import {useCallback, useEffect, useRef} from 'react';
import type {GuardianAlert, InvestigationTrigger} from '@contracts';
import {useDemo, useRuntime} from '@/services/ServicesContext';
import {prepareScenario} from '@/services/stubs/prepareScenario';
import type {ScenarioId} from '@/services/stubs/scenarios';
import {motion} from '@/theme';
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
            if (result.risk.escalateToGuardian) {
              void escalate(result.sessionId).then(outcome => {
                store.getState().updateOutcome(result.sessionId, outcome);
              });
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

  return {runInvestigation, startScenario, confirmPayment, endSession, escalate};
}
