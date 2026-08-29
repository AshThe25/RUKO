import type {Unsubscribe} from '@contracts';

/** Minimal synchronous event emitter. No dependency, no surprises. */
export class Emitter<T> {
  private listeners = new Set<(value: T) => void>();
  private last: T;

  constructor(initial: T) {
    this.last = initial;
  }

  get value(): T {
    return this.last;
  }

  emit(value: T): void {
    this.last = value;
    this.listeners.forEach(l => l(value));
  }

  subscribe(listener: (value: T) => void): Unsubscribe {
    this.listeners.add(listener);
    // Replay the current value so a subscriber is never blind on mount.
    listener(this.last);
    return () => {
      this.listeners.delete(listener);
    };
  }

  clear(): void {
    this.listeners.clear();
  }
}
