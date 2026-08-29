/**
 * The ONNX Runtime seam.
 *
 * The classifier talks to this interface, never to `onnxruntime-react-native`
 * directly. Three reasons, in order of importance:
 *
 *   1. **The backend is reported, never assumed.** `createSession` returns the
 *      execution provider the runtime actually used, which is not always the one
 *      requested — asking for NNAPI on a device whose driver rejects the graph
 *      silently gives you CPU. Ruko must show what really ran.
 *   2. The whole classifier is testable in plain Node against a fake runtime.
 *   3. If ONNX Runtime is ever swapped for a vendor SDK, one file changes.
 */

import type { InferenceBackend } from '../../contracts/index.ts';

export interface OnnxTensorLike {
  readonly data: ArrayLike<number> | BigInt64Array;
  readonly dims: readonly number[];
}

export interface OnnxSession {
  run(feeds: Record<string, OnnxTensorLike>): Promise<Record<string, OnnxTensorLike>>;
  release(): Promise<void>;
  /** Execution providers the session reports as active, in priority order. */
  readonly activeProviders: string[];
}

export interface SessionHandle {
  session: OnnxSession;
  /** What actually ran, resolved from `activeProviders`. Never hardcoded. */
  backend: InferenceBackend;
}

export interface OnnxRuntimeAdapter {
  readonly name: string;
  /**
   * @param preferred execution providers in priority order. The adapter tries
   *        them in turn and reports which one the runtime accepted.
   */
  createSession(modelPath: string, preferred: InferenceBackend[]): Promise<SessionHandle>;
  int64Tensor(values: number[], dims: number[]): OnnxTensorLike;
  /** Load the vocabulary that ships beside the model. */
  readTextAsset(path: string): Promise<string>;
  /**
   * sha256 of a file, when the platform can do it cheaply. Returning null is
   * honest and expected — the classifier then reports the hash as unverified
   * rather than repeating the expected value as if it had checked.
   */
  sha256File?(path: string): Promise<string | null>;
}

/** Map a runtime provider string onto our reporting enum. */
export function backendFromProvider(provider: string | undefined): InferenceBackend {
  switch ((provider ?? '').toLowerCase()) {
    case 'nnapi': return 'NNAPI';
    case 'qnn': case 'qnnexecutionprovider': return 'QNN';
    case 'xnnpack': return 'XNNPACK';
    case 'cpu': case 'cpuexecutionprovider': return 'CPU';
    default: return 'CPU';
  }
}
