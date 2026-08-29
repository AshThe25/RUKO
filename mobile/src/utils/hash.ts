/**
 * Stable non-cryptographic hash used to key payee history locally.
 *
 * This is deliberately *not* presented as a privacy guarantee — it keeps raw
 * payee strings out of the risk-event log, nothing more. Anything leaving the
 * device is covered by the guardian contract, which carries no payee hash.
 */
export function payeeHash(input: string): string {
  const normalised = input.trim().toLowerCase();
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < normalised.length; i++) {
    const c = normalised.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return (h1.toString(16) + h2.toString(16)).padStart(16, '0');
}
