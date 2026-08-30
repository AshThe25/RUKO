/**
 * The single wiring point for the whole app.
 *
 * Every screen reads services from React context, so replacing a stand-in with
 * a real implementation happens here and nowhere else. Which half of each seam
 * is live is recorded in `origins` and shown in the app, so a build can never
 * quietly imply it has device access it does not have.
 *
 * Risk and agent are now the real implementations from Vedant's lane: the
 * deterministic engine decides, and the investigation agent gathers evidence
 * through the same providers the screens use. The classifier still runs the
 * lexicon -- the ONNX weights are not in the repo, and `createClassifier`
 * falls back to exactly this when they are absent, so the seam is unchanged.
 *
 * Still to swap:
 *   classifier -> ONNX model once the weights ship  (Vedant)
 *   guardian   -> WebSocket channel                 (Puneesh)
 * See mobile/INTEGRATION.md.
 */
import type {LocalRiskClassifier, RiskEngine, RukoServices} from '@contracts';
import {createDiagnosticsProvider} from './diagnostics';
import {bringUpClassifier} from './onnxSetup';
import {hasNativeModule} from './native/RukoNative';
import {
  createNativeCallProvider,
  createNativeConversationProvider,
  createNativeNotificationProvider,
  createNativePaymentProvider,
} from './native/nativeProviders';
import {createDemoAwareConversationProvider} from './native/demoConversation';
import {
  StubBehaviourStore,
  StubDeviceBus,
  createCallProvider,
  createConversationProvider,
  createNotificationProvider,
  createPaymentProvider,
} from './stubs/deviceStubs';
import {StubGuardianChannel} from './stubs/guardianStub';
import {cloudConfigured} from './cloud/supabase';
import {transcribeBase64Wav} from './cloud/transcription';
import {SupabaseGuardianChannel} from './cloud/supabaseGuardian';
import {
  ENGINE_VERSION,
  POLICY_VERSION,
  evaluateRisk,
  getRiskEngineConfig,
} from '../risk/index.ts';
import {RukoAgent} from '../agent/rukoAgent.ts';
import {providersFromRukoServices} from '../tools/fromRukoServices.ts';

/**
 * Handles the demo surfaces need to drive the *inputs* of the pipeline.
 * Nothing here can influence an outcome — it seeds history, plays a transcript
 * and opens a payment screen, exactly as a real device would.
 */
export interface DemoControls {
  bus: StubDeviceBus;
  behaviour: StubBehaviourStore;
  guardian: StubGuardianChannel;
}

export type ServiceOrigin = 'device' | 'stub';

/** Which half of each seam is actually live in this build. */
export interface ServiceOrigins {
  call: ServiceOrigin;
  payment: ServiceOrigin;
  notification: ServiceOrigin;
  conversation: ServiceOrigin;
  behaviour: ServiceOrigin;
  risk: ServiceOrigin;
  agent: ServiceOrigin;
  guardian: ServiceOrigin;
}

export interface RukoRuntime {
  services: RukoServices;
  demo: DemoControls;
  origins: ServiceOrigins;
  /** True while any part of the stack is a stand-in. Drives the honesty note. */
  usingStubs: boolean;
  /** Demo Mode can only drive the stub device layer. */
  demoAvailable: boolean;
}

export interface CreateServicesOptions {
  /** Called once the neural model has loaded and replaced the lexicon. */
  onModelReady?: () => void;
  /** Tests force the stub path regardless of what the build ships. */
  forceStubs?: boolean;
}

export function createServices(options: CreateServicesOptions = {}): RukoRuntime {
  const native = !options.forceStubs && hasNativeModule();

  const bus = new StubDeviceBus();
  const behaviour = new StubBehaviourStore();
  // Real channel whenever the build has credentials; the stub otherwise, so a
  // dev build with no .env still runs the whole flow offline.
  const cloudGuardian = cloudConfigured ? new SupabaseGuardianChannel() : null;
  const guardian = new StubGuardianChannel();
  if (cloudGuardian) void cloudGuardian.attach();
  // Start on the lexicon so the first screen paints immediately, then swap in
  // the neural model once it has been unpacked and a session created. Copying
  // 22 MB out of the APK takes long enough that blocking start-up on it would
  // be felt, and the lexicon is a genuine classifier in the meantime -- not a
  // placeholder.
  let live: LocalRiskClassifier = bus.getClassifier();
  // Delegate every method, not a chosen few. An earlier version forwarded only
  // classify and loadModel and silenced the mismatch with a cast, so
  // getModelInfo() was undefined and the app died on its first render.
  const classifier: LocalRiskClassifier = {
    loadModel: () => live.loadModel(),
    classify: transcript => live.classify(transcript),
    getModelInfo: () => live.getModelInfo(),
    dispose: () => live.dispose(),
  };

  void bringUpClassifier().then(result => {
    if (!result.neural) return;
    live = result.classifier;
    // The screens read diagnostics once at first paint, while the lexicon is
    // deliberately answering. Without this the label stays on 'heuristic' even
    // though the model is running.
    options.onModelReady?.();
  });

  const call = native ? createNativeCallProvider() : createCallProvider(bus);
  const payment = native ? createNativePaymentProvider() : createPaymentProvider(bus);
  const notification = native
    ? createNativeNotificationProvider()
    : createNotificationProvider(bus);
  const conversation = native
    ? createDemoAwareConversationProvider(
        createNativeConversationProvider(
          transcript => classifier.classify(transcript),
          // Only reached when the user has switched cloud transcription on: the
          // native side withholds the audio otherwise, so this is never called
          // with anything to send.
          cloudConfigured ? wav => transcribeBase64Wav(wav) : undefined,
        ),
        bus,
        // Demo Mode scores scripted lines through the same on-device model the
        // microphone path uses. Without this, running a scenario on a native
        // build played no dialogue and the investigation heard nothing.
        transcript => classifier.classify(transcript),
      )
    : createConversationProvider(bus);

  // The versions are carried on the object because diagnostics reads them from
  // the engine it was handed and reports 'unknown' otherwise -- which is the
  // right default, but it was reporting unknown for an engine that does know
  // its own version.
  const risk: RiskEngine = Object.assign(
    {
      evaluate: evaluateRisk,
      getConfig: getRiskEngineConfig,
    },
    {engineVersion: ENGINE_VERSION, policyVersion: POLICY_VERSION},
  );

  // The agent reads evidence through the providers, never through the agent
  // slot, so building it from a services object that has no agent yet is safe
  // and avoids a circular construction.
  const evidence = {
    call,
    payment,
    notification,
    conversation,
    behaviour,
    risk,
    guardian: cloudGuardian ?? guardian,
  };

  const agent = new RukoAgent({providers: providersFromRukoServices(evidence)});

  const services: RukoServices = {
    ...evidence,
    agent,
    diagnostics: createDiagnosticsProvider({classifier, risk}),
  };

  const origins: ServiceOrigins = {
    call: native ? 'device' : 'stub',
    payment: native ? 'device' : 'stub',
    notification: native ? 'device' : 'stub',
    conversation: native ? 'device' : 'stub',
    behaviour: 'stub',
    risk: 'device',
    agent: 'device',
    guardian: cloudGuardian ? 'device' : 'stub',
  };

  return {
    services,
    demo: {bus, behaviour, guardian},
    origins,
    usingStubs: Object.values(origins).some(o => o === 'stub'),
    // Available in native builds too. The scenario runs through the real
    // providers, engine and model -- it seeds an input, it does not fake an
    // outcome -- and hiding it in the only build worth demoing meant there was
    // no way to show what the product does without a genuine scam call.
    demoAvailable: true,
  };
}

/** The seams that are still stand-ins, in words the UI can show. */
export function stubbedParts(origins: ServiceOrigins): string[] {
  const labels: Record<keyof ServiceOrigins, string> = {
    call: 'call state',
    payment: 'payment screen',
    notification: 'notifications',
    conversation: 'speech',
    behaviour: 'payment history',
    risk: 'risk engine',
    agent: 'investigation agent',
    guardian: 'guardian link',
  };
  return (Object.keys(origins) as Array<keyof ServiceOrigins>)
    .filter(k => origins[k] === 'stub')
    .map(k => labels[k]);
}
