/**
 * The single wiring point for the whole app.
 *
 * Every screen reads services from React context, so replacing a stub with a
 * real implementation is a change here and nowhere else:
 *
 *   risk:  stubRiskEngine        ->  import from 'mobile/src/risk'    (Vedant)
 *   agent: createStubAgent(...)  ->  import from 'mobile/src/agent'   (Vedant)
 *   call/payment/notification    ->  native providers                 (Puneesh)
 *   guardian                     ->  WebSocket channel                (Puneesh)
 */
import type {RukoServices} from '@contracts';
import {
  StubBehaviourStore,
  StubDeviceBus,
  createCallProvider,
  createConversationProvider,
  createDiagnosticsProvider,
  createNotificationProvider,
  createPaymentProvider,
} from './stubs/deviceStubs';
import {StubGuardianChannel} from './stubs/guardianStub';
import {createStubAgent} from './stubs/stubAgent';
import {stubRiskEngine} from './stubs/stubRiskEngine';

/**
 * Handles the demo surfaces need in order to drive the *inputs* of the
 * pipeline. Nothing here can influence an outcome — it seeds history, plays a
 * transcript and opens a payment screen, exactly as a real device would.
 */
export interface DemoControls {
  bus: StubDeviceBus;
  behaviour: StubBehaviourStore;
  guardian: StubGuardianChannel;
}

export interface RukoRuntime {
  services: RukoServices;
  demo: DemoControls;
  /** True while any part of the stack is a stub. Drives the honesty banner. */
  usingStubs: boolean;
}

export function createServices(): RukoRuntime {
  const bus = new StubDeviceBus();
  const behaviour = new StubBehaviourStore();
  const guardian = new StubGuardianChannel();

  const call = createCallProvider(bus);
  const payment = createPaymentProvider(bus);
  const notification = createNotificationProvider(bus);
  const conversation = createConversationProvider(bus);

  const agent = createStubAgent({
    call,
    payment,
    notification,
    conversation,
    behaviour,
    risk: stubRiskEngine,
  });

  const services: RukoServices = {
    call,
    payment,
    notification,
    conversation,
    behaviour,
    risk: stubRiskEngine,
    agent,
    guardian,
    diagnostics: createDiagnosticsProvider(bus),
  };

  return {services, demo: {bus, behaviour, guardian}, usingStubs: true};
}
