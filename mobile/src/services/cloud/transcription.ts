/**
 * Cloud transcription, used only when the user asks for it.
 *
 * Ruko's detection runs on the device and needs no network. This exists for the
 * case the on-device path cannot cover -- Hindi and other Indian languages,
 * where Sarvam's ASR is far stronger than anything that fits on a phone.
 *
 * It is deliberately opt-in. The moment audio leaves the device, "nothing
 * leaves the phone" stops being true, and that is a promise the product is
 * built on rather than a marketing line. So the caller must pass `enabled`,
 * the user must have turned it on, and the default is off.
 *
 * The API key is never here. The phone sends its Supabase session token to
 * Ruko's own backend, which holds the Sarvam key server-side -- a key shipped
 * in an APK can be read with apktool in about a minute.
 */
import {supabase} from './supabase';
import {BACKEND_URL} from './config';

export type TranscribeLanguage = 'en-IN' | 'hi-IN';

export interface TranscriptionResult {
  transcript: string;
  languageCode: string | null;
  error: string | null;
}

const EMPTY: TranscriptionResult = {transcript: '', languageCode: null, error: null};

/**
 * Send one audio window for transcription. Returns an empty transcript rather
 * than throwing: a transcription failure must degrade the quality of a check,
 * never interrupt protection that is already running on the device.
 */
/**
 * Transcribe one base64 WAV window. Returns '' on any failure, so a caller can
 * treat "could not hear it" and "heard nothing" the same way -- neither should
 * interrupt a protection session.
 */
export async function transcribeBase64Wav(
  wavBase64: string,
  language: TranscribeLanguage = 'en-IN',
): Promise<string> {
  const res = await transcribeWindow(
    {uri: `data:audio/wav;base64,${wavBase64}`, type: 'audio/wav', name: 'window.wav'},
    language,
    true,
  );
  return res.transcript;
}

export async function transcribeWindow(
  audio: Blob | {uri: string; type: string; name: string},
  language: TranscribeLanguage,
  enabled: boolean,
): Promise<TranscriptionResult> {
  if (!enabled || !BACKEND_URL) return EMPTY;

  const {data} = await supabase.auth.getSession();
  const token = data.session?.access_token;
  // The proxy refuses anonymous callers, so there is nothing to send.
  if (!token) return {...EMPTY, error: 'not signed in'};

  const form = new FormData();
  form.append('audio', audio as never);
  form.append('languageCode', language);

  try {
    const res = await fetch(`${BACKEND_URL}/transcribe`, {
      method: 'POST',
      headers: {Authorization: `Bearer ${token}`},
      body: form,
    });
    if (!res.ok) {
      return {...EMPTY, error: `transcription failed (${res.status})`};
    }
    const body = (await res.json()) as {transcript?: string; language_code?: string};
    return {
      transcript: body.transcript ?? '',
      languageCode: body.language_code ?? null,
      error: null,
    };
  } catch (err) {
    return {...EMPTY, error: err instanceof Error ? err.message : String(err)};
  }
}
