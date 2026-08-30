/**
 * Demo-aware conversation provider.
 *
 * THE BUG THIS FIXES: in a native build, `services.conversation` is the
 * microphone-backed provider, and starting it opens the mic. Demo Mode's
 * scripted dialogue lives on the stub bus, which the native provider does not
 * read — so running a scenario played no lines, the transcript stayed empty,
 * and the investigation reported "nothing was heard" while every other part of
 * the pipeline worked. Demo Mode was built for the stub build and silently did
 * nothing on the one build worth demoing.
 *
 * WHAT THIS DOES: when a scenario with dialogue is loaded, this plays those
 * lines on their scripted timeline through the REAL classifier — the same
 * neural model the microphone path would use — and surfaces the resulting
 * ConversationEvidence as the current reading. With no scenario loaded it is
 * the microphone provider, unchanged. So Demo Mode scores scripted speech on
 * device with no network and no live audio, which is the reliable way to show
 * the conversation being understood; the live-mic path still exists for real
 * use and for anyone who wants to speak into it.
 *
 * It is still honest: the text is scripted, the scores are not. Edit a line in
 * scenarios.ts and the tactics that light up change with it.
 */

import type {
  ConversationEvidence,
  ConversationProvider,
  Unsubscribe,
} from '@contracts';

import type {StubDeviceBus} from '../stubs/deviceStubs';

const IDLE: ConversationEvidence = {
  available: false,
  source: 'ON_DEVICE_MODEL',
  unavailableReason: 'No speech has been analysed in this session yet.',
  scores: {
    authority: 0,
    coercion: 0,
    urgency: 0,
    financialInstruction: 0,
    secrecy: 0,
    credentialRequest: 0,
  },
  reliability: 0,
  windowMs: 0,
  transcriptChars: 0,
  modelVersion: 'idle',
  backend: 'HEURISTIC',
  timestamp: 0,
};

export function createDemoAwareConversationProvider(
  microphone: ConversationProvider,
  bus: StubDeviceBus,
  classify: (transcript: string) => Promise<ConversationEvidence>,
): ConversationProvider {
  let timers: ReturnType<typeof setTimeout>[] = [];
  let demoRunning = false;
  let latest: ConversationEvidence | null = null;
  const listeners = new Set<(value: ConversationEvidence) => void>();

  const hasScenario = () => (bus.getScenario()?.lines.length ?? 0) > 0;

  const emit = (value: ConversationEvidence) => {
    latest = value;
    for (const listener of listeners) listener(value);
  };

  const clearTimers = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };

  return {
    source: 'ON_DEVICE_MODEL',

    async start(sessionId: string) {
      // No demo loaded: this is the real microphone session.
      if (!hasScenario()) {
        await microphone.start(sessionId);
        return;
      }
      if (demoRunning) return;
      demoRunning = true;
      latest = null;

      const scenario = bus.getScenario();
      if (!scenario) return;

      const spoken: string[] = [];
      for (const line of scenario.lines) {
        timers.push(
          setTimeout(() => {
            spoken.push(line.text);
            // Drives "WHAT RUKO IS HEARING" on the pay screen.
            bus.transcript.emit([...spoken]);
            // Real text, really classified by the on-device model. The growing
            // transcript is what makes the tactics accumulate as the call goes
            // on, exactly as they would from live speech.
            void classify(spoken.join(' ')).then(emit);
          }, line.atMs),
        );
      }
    },

    async stop() {
      clearTimers();
      demoRunning = false;
      // The mic may also have been started in a non-demo session.
      await microphone.stop();
    },

    isRunning: () => demoRunning || microphone.isRunning(),

    // While a scenario is loaded the agent must read the scripted evidence, not
    // the silent microphone. Before any line has played, `latest` is null and
    // we report idle rather than a stale reading.
    read: async () => {
      if (hasScenario()) return latest ?? IDLE;
      return microphone.read();
    },

    subscribe(listener: (value: ConversationEvidence) => void): Unsubscribe {
      listeners.add(listener);
      const offMic = microphone.subscribe(listener);
      return () => {
        listeners.delete(listener);
        offMic();
      };
    },
  };
}
