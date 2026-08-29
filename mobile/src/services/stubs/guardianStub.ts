/**
 * STUB — guardian channel.
 *
 * Stands in for Puneesh's WebSocket relay to the Office Kit. The important
 * behaviour to preserve is the *failure* behaviour: when the guardian is
 * unpaired, offline or silent, `sendAlert` resolves to `null` and the phone
 * decides alone. The phone is never blocked waiting on a laptop.
 */
import type {
  GuardianAlert,
  GuardianChannel,
  GuardianConnectionState,
  GuardianDecision,
} from '@contracts';
import {Emitter} from './emitter';
import {now} from '@/utils/id';

export interface StubGuardianOptions {
  /** How long the phone waits before falling back to its own decision. */
  timeoutMs?: number;
}

export class StubGuardianChannel implements GuardianChannel {
  readonly state = new Emitter<GuardianConnectionState>('UNPAIRED');
  readonly inbox = new Emitter<GuardianAlert | null>(null);

  private pending: ((decision: GuardianDecision | null) => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private timeoutMs: number;
  private guardianLabel = 'Guardian';

  constructor(options: StubGuardianOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 45_000;
  }

  getState(): GuardianConnectionState {
    return this.state.value;
  }

  pair(label: string): void {
    this.guardianLabel = label;
    this.state.emit('ONLINE');
  }

  unpair(): void {
    this.state.emit('UNPAIRED');
  }

  /** Simulates the laptop dropping off — the phone must carry on regardless. */
  setState(state: GuardianConnectionState): void {
    this.state.emit(state);
  }

  async sendAlert(alert: GuardianAlert): Promise<GuardianDecision | null> {
    if (this.state.value !== 'ONLINE') {
      return null;
    }
    this.inbox.emit(alert);

    return new Promise<GuardianDecision | null>(resolve => {
      this.pending = resolve;
      this.timer = setTimeout(() => {
        // Silence is not consent. Timing out leaves the phone's own
        // intervention standing.
        this.resolvePending(null);
      }, Math.min(this.timeoutMs, alert.expiresInSec * 1000));
    });
  }

  /** Called by the demo's guardian screen, standing in for the Office Kit. */
  respond(sessionId: string, decision: GuardianDecision['decision'], note?: string): void {
    this.resolvePending({
      sessionId,
      decision,
      decidedAt: now(),
      guardianLabel: this.guardianLabel,
      ...(note ? {note} : {}),
    });
  }

  private resolvePending(decision: GuardianDecision | null): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const resolve = this.pending;
    this.pending = null;
    this.inbox.emit(null);
    resolve?.(decision);
  }
}
