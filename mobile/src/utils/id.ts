let counter = 0;

/** Short, collision-resistant enough for a session-local id. No dependency. */
export function newId(prefix = 'id'): string {
  counter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}

/** Contracts carry epoch milliseconds, never ISO strings. */
export function now(): number {
  return Date.now();
}
