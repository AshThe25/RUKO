/**
 * TEST-ONLY ONNX Runtime adapter, backed by `onnxruntime-node`.
 *
 * This is not shipped. It exists so the real `OnnxClassifier` can be executed
 * against the real exported `.onnx` file on a development machine, which is the
 * one thing the fake-runtime tests cannot cover: whether the classifier wires a
 * genuine session correctly — tensor dtypes, dimensions, int64 handling and
 * output-name lookup. Those are precisely the mistakes that survive every unit
 * test and then fail on the device.
 *
 * The shipped adapter is `../reactNativeRuntime.ts`, which implements the same
 * `OnnxRuntimeAdapter` interface against `onnxruntime-react-native`. Getting the
 * Node one working does not prove the React Native one works — different native
 * bindings — but it does prove the classifier's side of the contract is right,
 * which is most of the surface area.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

import { backendFromProvider } from '../runtime.ts';
import type { OnnxRuntimeAdapter, OnnxSession, SessionHandle } from '../runtime.ts';
import type { InferenceBackend } from '../../../contracts/index.ts';

/**
 * `onnxruntime-node` is an optional development dependency installed outside
 * the repository. Returns null when it is unavailable so the tests skip rather
 * than fail — nobody should need a native ONNX build to run the risk-engine
 * suite.
 */
export function loadOnnxRuntimeNode(searchPaths: string[]): any | null {
  for (const base of searchPaths) {
    try {
      const require = createRequire(`${base}/`);
      const ort = require('onnxruntime-node');
      // A partially-installed package resolves but has no InferenceSession --
      // onnxruntime-node downloads its native binaries in a postinstall step
      // that can fail silently. Treat that as absent rather than letting the
      // suite blow up on a broken optional dependency.
      if (!ort?.InferenceSession?.create) continue;
      return ort;
    } catch {
      // try the next location
    }
  }
  return null;
}

export function createNodeAdapter(ort: any): OnnxRuntimeAdapter {
  return {
    name: 'onnxruntime-node (test only)',

    async createSession(modelPath: string, _preferred: InferenceBackend[]): Promise<SessionHandle> {
      // Node only offers CPU here. Requesting the list honestly and reporting
      // what came back is the same discipline the device adapter uses.
      const raw = await ort.InferenceSession.create(modelPath, {
        executionProviders: ['cpu'],
      });
      const session: OnnxSession = {
        activeProviders: ['cpu'],
        async run(feeds) {
          return raw.run(feeds) as never;
        },
        async release() {
          await raw.release?.();
        },
      };
      return { session, backend: backendFromProvider('cpu') };
    },

    int64Tensor(values: number[], dims: number[]) {
      return new ort.Tensor('int64', BigInt64Array.from(values, (v: number) => BigInt(v)), dims);
    },

    async readTextAsset(path: string): Promise<string> {
      return readFile(path, 'utf8');
    },

    async sha256File(path: string): Promise<string | null> {
      try {
        return createHash('sha256').update(await readFile(path)).digest('hex');
      } catch {
        return null;
      }
    },
  };
}
