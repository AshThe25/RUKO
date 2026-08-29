/**
 * Bringing the neural classifier up on the device.
 *
 * ONNX Runtime needs a filesystem path, and an Android asset is not one — it
 * lives inside the APK. So on first launch the model and vocabulary are copied
 * out to the app's private directory, and every launch after that reuses them.
 *
 * Every failure here is caught by `createClassifier`, which falls back to the
 * lexicon. That is deliberate: a demo that hard-fails because a 22 MB file did
 * not unpack is a demo that does not happen. The engineering screen reports
 * which one is actually running, so a build can never quietly imply it is
 * using the model when it is not.
 */
import {Platform} from 'react-native';
import type {LocalRiskClassifier} from '@contracts';
import {createClassifier} from '@/risk/classifier';
import {createReactNativeAdapter} from '@/risk/classifier/reactNativeRuntime';

const MODEL_ASSET = 'model_int8.onnx';
const VOCAB_ASSET = 'vocab.txt';

export interface ClassifierBringUp {
  classifier: LocalRiskClassifier;
  neural: boolean;
  fallbackReason?: string;
}

/**
 * Copy an asset out of the APK once. Returns the destination path.
 * Existing files are left alone — the copy is the slow part of a cold start.
 */
async function materialise(fs: any, name: string, destDir: string): Promise<string> {
  const dest = `${destDir}/${name}`;
  if (await fs.exists(dest)) return dest;
  await fs.copyFileAssets(name, dest);
  return dest;
}

export async function bringUpClassifier(): Promise<ClassifierBringUp> {
  // Only Android ships the assets today; anywhere else goes straight to the
  // lexicon rather than failing on a missing module.
  if (Platform.OS !== 'android') {
    return await createClassifier();
  }

  try {
    // Required lazily so a build without the native modules still starts and
    // simply runs the lexicon.
    const ort = require('onnxruntime-react-native');
    const RNFS = require('react-native-fs');

    const dir = RNFS.DocumentDirectoryPath;
    const modelPath = await materialise(RNFS, MODEL_ASSET, dir);
    const vocabPath = await materialise(RNFS, VOCAB_ASSET, dir);

    const adapter = createReactNativeAdapter({
      ort,
      fs: {
        readFile: (p: string, enc: 'utf8') => RNFS.readFile(p, enc),
        hash: (p: string, algorithm: string) => RNFS.hash(p, algorithm),
      },
    });

    return await createClassifier({adapter, modelPath, vocabPath});
  } catch (err) {
    const classifier = (await createClassifier()).classifier;
    return {
      classifier,
      neural: false,
      fallbackReason: err instanceof Error ? err.message : String(err),
    };
  }
}
