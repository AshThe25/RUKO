/**
 * What survives a restart. The audit trail has to; the session does not.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {STORAGE_KEY, useProtectionStore} from '@/store/protectionStore';

const flush = () => new Promise<void>(resolve => setTimeout(() => resolve(), 0));

async function storedState(): Promise<Record<string, unknown>> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw).state : {};
}

describe('persistence', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    useProtectionStore.setState({
      onboarded: false,
      history: [],
      result: null,
      trace: [],
      revealed: 0,
      route: 'home',
      stack: ['home'],
    });
    await flush();
  });

  it('keeps the audit trail across restarts', async () => {
    useProtectionStore.getState().recordEvent({
      sessionId: 's1',
      amountMinor: 4_800_000,
      payeeDisplayName: 'Ravi Verify',
      score: 82,
      level: 'CRITICAL',
      policyAction: 'BLOCK_WARNING',
      reasons: [],
      degraded: false,
      outcome: 'USER_STOPPED',
      modelVersion: 'm',
      weightsVersion: 'w',
      policyVersion: 'p',
      engineVersion: 'e',
    });
    await flush();

    const state = await storedState();
    expect(Array.isArray(state.history)).toBe(true);
    expect((state.history as unknown[]).length).toBe(1);
  });

  it('remembers that onboarding is done', async () => {
    useProtectionStore.getState().setOnboarded(true);
    await flush();
    expect((await storedState()).onboarded).toBe(true);
  });

  it('does not persist the current investigation', async () => {
    useProtectionStore.setState({
      status: 'ready',
      revealed: 6,
      trace: [{id: 'x', sessionId: 's', at: 0, type: 'START', summary: 'x'} as never],
    });
    await flush();

    const state = await storedState();
    expect(state).not.toHaveProperty('trace');
    expect(state).not.toHaveProperty('result');
    expect(state).not.toHaveProperty('revealed');
    expect(state).not.toHaveProperty('guardianAlert');
  });

  it('never writes a route into storage', async () => {
    useProtectionStore.getState().navigate('engineering');
    await flush();
    expect(await storedState()).not.toHaveProperty('route');
  });

  it('lets the user delete their own history', async () => {
    useProtectionStore.getState().recordEvent({
      sessionId: 's2',
      amountMinor: 100,
      payeeDisplayName: null,
      score: 5,
      level: 'LOW',
      policyAction: 'NONE',
      reasons: [],
      degraded: false,
      outcome: 'NO_INTERRUPTION',
      modelVersion: 'm',
      weightsVersion: 'w',
      policyVersion: 'p',
      engineVersion: 'e',
    });
    await flush();

    useProtectionStore.getState().clearHistory();
    await flush();

    expect(useProtectionStore.getState().history).toEqual([]);
    expect((await storedState()).history).toEqual([]);
  });
});
