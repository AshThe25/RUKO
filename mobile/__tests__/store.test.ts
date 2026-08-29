import {useProtectionStore} from '@/store/protectionStore';

const reset = () =>
  useProtectionStore.setState({
    route: 'onboarding',
    stack: ['onboarding'],
    history: [],
    result: null,
    trace: [],
    revealed: 0,
    status: 'idle',
    error: null,
  });

describe('protection store', () => {
  beforeEach(reset);

  it('keeps a navigation stack that can go back', () => {
    const {navigate, back} = useProtectionStore.getState();
    navigate('home');
    navigate('engineering');
    expect(useProtectionStore.getState().route).toBe('engineering');
    back();
    expect(useProtectionStore.getState().route).toBe('home');
  });

  it('will not pop past the first screen', () => {
    useProtectionStore.getState().back();
    expect(useProtectionStore.getState().route).toBe('onboarding');
  });

  it('records a risk event with the versions needed to audit it', () => {
    useProtectionStore.getState().recordEvent({
      sessionId: 's1',
      amountMinor: 4_800_000,
      payeeDisplayName: 'Ravi Verify',
      score: 91,
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
    const [event] = useProtectionStore.getState().history;
    expect(event!.sessionId).toBe('s1');
    expect(event!.id).toBeTruthy();
    expect(event!.timestamp).toBeGreaterThan(0);
  });

  it('updates the outcome when the user or guardian decides', () => {
    const s = useProtectionStore.getState();
    s.recordEvent({
      sessionId: 's2',
      amountMinor: 100,
      payeeDisplayName: null,
      score: 10,
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
    useProtectionStore.getState().updateOutcome('s2', 'GUARDIAN_BLOCKED');
    expect(useProtectionStore.getState().history[0]!.outcome).toBe('GUARDIAN_BLOCKED');
  });

  it('clears investigation state between sessions', () => {
    useProtectionStore.setState({revealed: 4, status: 'ready', error: 'x'});
    useProtectionStore.getState().resetInvestigation();
    const state = useProtectionStore.getState();
    expect(state.revealed).toBe(0);
    expect(state.status).toBe('idle');
    expect(state.error).toBeNull();
    expect(state.result).toBeNull();
  });
});
