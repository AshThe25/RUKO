/**
 * One payment must start one investigation.
 *
 * On a real device the demo hung: the feed stopped on "Looking at this
 * payment." with two steps spinning at once, which a strictly sequential agent
 * cannot produce on its own.
 *
 * The cause was here. `useProtectionController` is mounted by the Router — so
 * payment watching outlives any screen — and again by whichever screen is
 * visible, for its callbacks. Each copy installed its own `paymentDetected`
 * listener, so one native event started as many investigations as there were
 * mounted copies. They interleaved in the store's single trace, each pacing its
 * own reveal counter through it, and the screen only calls itself finished when
 * `revealed >= trace.length` — which two counters never agree on.
 *
 * Jest has no native module, so the real `onNativeEvent` is a no-op and the
 * fault is invisible to every other test in this suite. This file supplies an
 * emitter so the listeners are real.
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

const mockListeners = new Map<string, Array<(payload: unknown) => void>>();

jest.mock('@/services/native/RukoNative', () => ({
  ...jest.requireActual('@/services/native/RukoNative'),
  onNativeEvent: (name: string, listener: (payload: unknown) => void) => {
    const forName = mockListeners.get(name) ?? [];
    forName.push(listener);
    mockListeners.set(name, forName);
    return () => {
      const rest = (mockListeners.get(name) ?? []).filter(l => l !== listener);
      mockListeners.set(name, rest);
    };
  },
}));

import {ServicesProvider} from '@/services/ServicesContext';
import {createServices} from '@/services/createServices';
import {Router} from '@/navigation/Router';
import {useProtectionStore} from '@/store/protectionStore';
import {NATIVE_EVENTS} from '@/services/native/RukoNative';

describe('the payment watcher', () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  afterEach(() => {
    ReactTestRenderer.act(() => tree?.unmount());
    tree = undefined;
    mockListeners.clear();
    useProtectionStore.setState({
      route: 'home', stack: ['home'], result: null, trace: [], revealed: 0,
      status: 'idle', error: null, hydrated: true,
    });
  });

  // The investigation screen is one of the three that call the controller for
  // their own callbacks; the Router calls it too. That pairing is the fault.
  const render = () => {
    useProtectionStore.setState({route: 'investigation', stack: ['investigation'], hydrated: true});
    const runtime = createServices({forceStubs: true});
    ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(
        <ServicesProvider runtime={runtime}>
          <Router />
        </ServicesProvider>,
      );
    });
  };

  it('is installed once, not once per mounted screen', () => {
    render();
    // The Router and the screen it renders both call into the controller.
    expect(mockListeners.get(NATIVE_EVENTS.paymentDetected)?.length ?? 0).toBe(1);
    expect(mockListeners.get(NATIVE_EVENTS.interventionResolved)?.length ?? 0).toBe(1);
  });

  it('runs one investigation for one detected payment', async () => {
    render();

    await ReactTestRenderer.act(async () => {
      for (const l of mockListeners.get(NATIVE_EVENTS.paymentDetected) ?? []) {
        l({amountMinor: 250000, payeeDisplayName: 'Unknown recipient', payeeHash: 'p1'});
      }
      await new Promise(r => setTimeout(r, 50));
    });

    const {trace} = useProtectionStore.getState();
    const starts = trace.filter(e => e.kind === 'TOOL_START').map(e => e.tool);
    // A second concurrent run shows up here as the same tool starting twice.
    expect(starts.length).toBeGreaterThan(0);
    expect(new Set(starts).size).toBe(starts.length);
  }, 20000);
});
