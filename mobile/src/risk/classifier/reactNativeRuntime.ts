/**
 * ONNX Runtime adapter for React Native.
 *
 * ------------------------------------------------------------------------
 * VERIFICATION STATUS: NOT YET RUN ON A DEVICE.
 * ------------------------------------------------------------------------
 * Everything else in the classifier is covered by tests that actually execute.
 * This file is the one piece that cannot be: it needs the
 * `onnxruntime-react-native` native module and a real Android runtime. It is
 * written against the documented API and is deliberately thin, so that when it
 * is first run on the iQOO 15 there is very little here that can be wrong.
 *
 * Until it has been run on hardware, do not claim NNAPI acceleration anywhere.
 * The classifier reports the backend the runtime hands back, so once this runs
 * on the device the engineering screen will show the truth by itself.
 *
 * SETUP (Puneesh / Aishwarya):
 *   1. npm install onnxruntime-react-native react-native-fs
 *   2. Bundle ml/models/ruko-manip-v1/onnx/model_int8.onnx (22.9 MB) and
 *      vocab.txt as Android assets.
 *   3. Copy them to a real filesystem path on first launch -- ONNX Runtime
 *      needs a path, not an asset URI.
 *   4. createRuntimeAdapter() and pass it to createClassifier().
 */

import type { InferenceBackend } from '../../contracts/index.ts';
import { backendFromProvider } from './runtime.ts';
import type { OnnxRuntimeAdapter, OnnxSession, SessionHandle } from './runtime.ts';

/** The bits of `onnxruntime-react-native` this adapter touches. */
interface OrtModule {
  InferenceSession: {
    create(path: string, options?: Record<string, unknown>): Promise<{
      run(feeds: Record<string, unknown>): Promise<Record<string, { data: ArrayLike<number>; dims: number[] }>>;
      release(): Promise<void>;
      inputNames?: string[];
    }>;
  };
  Tensor: new (type: string, data: unknown, dims: number[]) => unknown;
}

/** File-reading bits, satisfied by react-native-fs or any equivalent. */
export interface FileSystemLike {
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  hash?(path: string, algorithm: string): Promise<string>;
}

export interface ReactNativeAdapterOptions {
  ort: OrtModule;
  fs: FileSystemLike;
}

/**
 * Try each requested execution provider in order and report which one the
 * runtime actually accepted.
 *
 * This loop is the entire reason the adapter exists. ONNX Runtime will happily
 * create a session with `executionProviders: ['nnapi']` on a device whose NNAPI
 * driver then refuses individual operators, silently running them on CPU. By
 * requesting one provider at a time we learn which one genuinely initialised,
 * and Ruko reports that rather than what we hoped for.
 */
export function createReactNativeAdapter(
  options: ReactNativeAdapterOptions,
): OnnxRuntimeAdapter {
  const { ort, fs } = options;

  return {
    name: 'onnxruntime-react-native',

    async createSession(modelPath: string, preferred: InferenceBackend[]): Promise<SessionHandle> {
      const attempts: string[] = [];
      let lastError: unknown = null;

      for (const backend of preferred) {
        const provider = backend.toLowerCase();
        try {
          const raw = await ort.InferenceSession.create(modelPath, {
            executionProviders: [provider],
            graphOptimizationLevel: 'all',
          });
          const session: OnnxSession = {
            activeProviders: [provider],
            async run(feeds) {
              return raw.run(feeds) as never;
            },
            async release() {
              await raw.release();
            },
          };
          return { session, backend: backendFromProvider(provider) };
        } catch (err) {
          attempts.push(`${provider}: ${err instanceof Error ? err.message : String(err)}`);
          lastError = err;
        }
      }

      throw new Error(
        `no execution provider could be initialised. Tried:\n  ${attempts.join('\n  ')}\n` +
        `last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
      );
    },

    int64Tensor(values: number[], dims: number[]) {
      // ONNX int64 inputs need BigInt64Array in the JS binding.
      const data = BigInt64Array.from(values, (v) => BigInt(v));
      return ort.Tensor
        ? (new ort.Tensor('int64', data, dims) as never)
        : ({ data, dims } as never);
    },

    async readTextAsset(path: string): Promise<string> {
      return fs.readFile(path, 'utf8');
    },

    async sha256File(path: string): Promise<string | null> {
      // Honest null when the platform cannot hash: the classifier then reports
      // the hash as unverified instead of pretending it checked.
      if (!fs.hash) return null;
      try {
        return (await fs.hash(path, 'sha256')).toLowerCase();
      } catch {
        return null;
      }
    },
  };
}
