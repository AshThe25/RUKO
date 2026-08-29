/**
 * Enough WebCrypto for PKCE S256 -- digest only, in pure JS.
 *
 * react-native-get-random-values was tried here and removed: it never got
 * autolinked into the native build, so `crypto.getRandomValues` threw
 * 'RNGetRandomValues could not be found' the moment sign-in started, and the
 * whole flow died before opening a browser. A polyfill that breaks the feature
 * it was meant to harden is worse than the weakness it fixes.
 *
 * supabase-js falls back to a `plain` code challenge if it cannot produce an
 * S256 one. That is weaker than S256 and worth fixing properly later by
 * getting a real CSPRNG into the build -- but it is over TLS to Google and
 * Supabase, and a working sign-in beats a broken one.
 *
 * React Native ships no WebCrypto, so supabase-js silently downgrades the PKCE
 * code challenge from S256 to `plain` -- which sends the verifier in the clear
 * and removes the protection PKCE exists to provide. A phone app cannot hold a
 * client secret, so PKCE is the only thing standing between an intercepted
 * authorisation code and someone else's session.
 *
 * Only `getRandomValues` and `subtle.digest('SHA-256')` are provided, because
 * those are the two things the flow actually uses. Anything else is left
 * undefined rather than stubbed, so a future caller fails loudly instead of
 * getting a fake answer from a hand-rolled crypto shim.
 */
import {sha256} from 'js-sha256';

type SubtleHost = {subtle?: unknown; getRandomValues?: unknown};
type G = typeof globalThis & {crypto?: SubtleHost};
const g = globalThis as G;

if (g.crypto && !g.crypto.subtle) {
  Object.defineProperty(g.crypto, 'subtle', {
    value: {
      async digest(algorithm: string | {name: string}, data: ArrayBuffer | ArrayBufferView) {
        const name = typeof algorithm === 'string' ? algorithm : algorithm.name;
        if (name.toUpperCase() !== 'SHA-256') {
          throw new Error(`crypto.subtle.digest: ${name} is not implemented`);
        }
        const bytes =
          data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(
            (data as ArrayBufferView).buffer,
            (data as ArrayBufferView).byteOffset,
            (data as ArrayBufferView).byteLength,
          );
        return new Uint8Array(sha256.arrayBuffer(bytes)).buffer;
      },
    },
    configurable: true,
  });
}
