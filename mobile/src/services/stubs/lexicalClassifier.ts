/**
 * STUB — a transparent phrase-lexicon manipulation scorer.
 *
 * NOT a trained model. It reports `backend: 'HEURISTIC'` and
 * `modelVersion: 'stub-lexicon-v0'`, which the engineering screen shows
 * verbatim, so no demo can imply neural inference that did not happen.
 *
 * It exists because the alternative — hardcoding scores — would make every
 * screen downstream a lie. Real text goes in, real multi-label scores come
 * out; they are simply produced by regexes instead of by a transformer.
 *
 * Replaced by the ONNX classifier behind `LocalRiskClassifier`. No screen
 * changes when that happens.
 */
import {
  clamp01,
  type ConversationEvidence,
  type ConversationSpan,
  type LocalRiskClassifier,
  type ManipulationLabel,
  type ManipulationScores,
  type ModelInfo,
} from '@contracts';

export const STUB_MODEL_VERSION = 'stub-lexicon-v0';

interface LexEntry {
  re: RegExp;
  label: ManipulationLabel;
  weight: number;
}

const LEXICON: LexEntry[] = [
  // authority impersonation
  {re: /\b(calling|speaking) from (your |the )?(bank|hdfc|sbi|icici|axis)\b/gi, label: 'authority', weight: 0.55},
  {re: /\b(bank|rbi|reserve bank) (official|officer|department|security team)\b/gi, label: 'authority', weight: 0.5},
  {re: /\b(police|cyber ?crime|cbi|income tax|customs department)\b/gi, label: 'authority', weight: 0.5},
  {re: /\b(officer|inspector|sub ?inspector) [a-z]+\b/gi, label: 'authority', weight: 0.3},
  {re: /\b(kyc|know your customer) (update|verification|is pending|expired)\b/gi, label: 'authority', weight: 0.3},

  // coercion / threat of loss
  {re: /\b(account|card|sim) (will be|is being|has been) (frozen|blocked|suspended|deactivated)\b/gi, label: 'coercion', weight: 0.55},
  {re: /\b(legal action|arrest|warrant|fir|case will be (filed|registered))\b/gi, label: 'coercion', weight: 0.6},
  {re: /\b(do not|don'?t) (disconnect|hang up|cut the call)\b/gi, label: 'coercion', weight: 0.5},
  {re: /\byou will (lose|be held responsible|face)\b/gi, label: 'coercion', weight: 0.35},
  {re: /\bstay on the (line|call)\b/gi, label: 'coercion', weight: 0.3},

  // urgency
  {re: /\b(immediately|right now|at once)\b/gi, label: 'urgency', weight: 0.45},
  {re: /\bwithin (the next )?(\d+|a few|ten|five) (minutes?|hours?)\b/gi, label: 'urgency', weight: 0.45},
  {re: /\b(urgent|emergency|last chance|final (warning|notice))\b/gi, label: 'urgency', weight: 0.4},
  {re: /\b(quickly|hurry|there is no time)\b/gi, label: 'urgency', weight: 0.25},
  {re: /\bbefore (the )?(deadline|midnight|end of day)\b/gi, label: 'urgency', weight: 0.3},

  // financial instruction
  {re: /\b(transfer|send|pay|deposit) (₹|rs\.?|rupees )?[\d,]+/gi, label: 'financialInstruction', weight: 0.5},
  {re: /\b(transfer|send|move) (the |this )?(money|amount|funds|balance)\b/gi, label: 'financialInstruction', weight: 0.45},
  {re: /\b(safe|secure|verification|government) account\b/gi, label: 'financialInstruction', weight: 0.45},
  {re: /\b(scan|open) (this |the )?(qr|upi|link)\b/gi, label: 'financialInstruction', weight: 0.4},
  {re: /\bcomplete the (payment|transaction|transfer)\b/gi, label: 'financialInstruction', weight: 0.3},

  // secrecy
  {re: /\b(do not|don'?t) (tell|inform|discuss (this )?with) (anyone|anybody|your (family|wife|husband|son|daughter))\b/gi, label: 'secrecy', weight: 0.6},
  {re: /\b(strictly confidential|between us|keep this (private|secret|to yourself))\b/gi, label: 'secrecy', weight: 0.45},

  // credential request
  {re: /\b(otp|one[- ]time password|pin|cvv|password)\b/gi, label: 'credentialRequest', weight: 0.55},
  {re: /\b(card|account|aadhaar) (number|details)\b/gi, label: 'credentialRequest', weight: 0.4},
  {re: /\b(share|tell me|read out) the (code|number|otp)\b/gi, label: 'credentialRequest', weight: 0.45},
];

/**
 * Phrases that pull a score back down. Without these, "send ₹500 for dinner"
 * trips `financialInstruction` and Ruko cries wolf — which is the failure that
 * gets a safety app switched off, and switched-off software protects nobody.
 */
const MITIGATORS: LexEntry[] = [
  {re: /\b(dinner|lunch|movie|petrol|auto|cab|split|the bill|chai)\b/gi, label: 'financialInstruction', weight: 0.35},
  {re: /\b(rent|landlord|maintenance|society|school fees|salary)\b/gi, label: 'financialInstruction', weight: 0.3},
  {re: /\b(whenever|no rush|no hurry|take your time|when you can)\b/gi, label: 'urgency', weight: 0.4},
];

const EMPTY_SCORES = (): ManipulationScores => ({
  authority: 0,
  coercion: 0,
  urgency: 0,
  financialInstruction: 0,
  secrecy: 0,
  credentialRequest: 0,
});

const SATURATION = 0.97;

export function scoreTranscript(transcript: string): {
  scores: ManipulationScores;
  spans: ConversationSpan[];
} {
  const scores = EMPTY_SCORES();
  const spans: ConversationSpan[] = [];

  for (const entry of LEXICON) {
    const matches = transcript.match(entry.re);
    if (!matches) {
      continue;
    }
    matches.forEach((match, i) => {
      // Each repeat of the same tactic adds less than the last.
      const decayed = entry.weight * Math.pow(0.6, i);
      scores[entry.label] = scores[entry.label] + (1 - scores[entry.label]) * decayed;
      if (i === 0) {
        spans.push({label: entry.label, text: match.trim(), score: clamp01(decayed)});
      }
    });
  }

  for (const m of MITIGATORS) {
    if (m.re.test(transcript)) {
      scores[m.label] = Math.max(0, scores[m.label] - m.weight);
    }
    m.re.lastIndex = 0;
  }

  (Object.keys(scores) as ManipulationLabel[]).forEach(k => {
    scores[k] = Math.min(SATURATION, Number(scores[k].toFixed(4)));
  });

  spans.sort((a, b) => b.score - a.score);
  return {scores, spans: spans.slice(0, 4)};
}

/**
 * Reliability is a function of how much speech we actually heard. Two words is
 * not enough to accuse anyone of anything, and the engine down-weights
 * conversation evidence accordingly.
 */
export function transcriptReliability(transcript: string): number {
  const chars = transcript.trim().length;
  if (chars === 0) {
    return 0;
  }
  return clamp01(Math.min(0.9, 0.15 + chars / 400));
}

export class LexicalClassifier implements LocalRiskClassifier {
  private info: ModelInfo = {
    modelVersion: STUB_MODEL_VERSION,
    modelHash: 'none-heuristic',
    backend: 'HEURISTIC',
    requestedBackend: 'CPU',
    loaded: false,
    quantization: 'none',
  };

  async loadModel(): Promise<ModelInfo> {
    // Nothing to load — that is the honest answer, and the eng screen says so.
    this.info = {...this.info, loaded: true};
    return this.info;
  }

  getModelInfo(): ModelInfo {
    return this.info;
  }

  async classify(transcript: string): Promise<ConversationEvidence> {
    const startedAt = Date.now();
    const trimmed = transcript.trim();

    if (!trimmed) {
      return {
        available: false,
        source: 'ON_DEVICE_HEURISTIC',
        unavailableReason: 'No speech has been analysed in this session yet.',
        scores: EMPTY_SCORES(),
        reliability: 0,
        windowMs: 0,
        transcriptChars: 0,
        modelVersion: STUB_MODEL_VERSION,
        backend: 'HEURISTIC',
        latencyMs: Date.now() - startedAt,
        detectedLanguage: 'unknown',
        timestamp: Date.now(),
      };
    }

    const {scores, spans} = scoreTranscript(trimmed);
    const latencyMs = Date.now() - startedAt;
    this.info = {
      ...this.info,
      measuredLatencyMsP50: latencyMs,
    };

    return {
      available: true,
      source: 'ON_DEVICE_HEURISTIC',
      scores,
      reliability: transcriptReliability(trimmed),
      windowMs: estimateSpeechMs(trimmed),
      transcriptChars: trimmed.length,
      evidenceSpans: spans,
      modelVersion: STUB_MODEL_VERSION,
      backend: 'HEURISTIC',
      latencyMs,
      detectedLanguage: detectLanguage(trimmed),
      timestamp: Date.now(),
    };
  }

  async dispose(): Promise<void> {
    this.info = {...this.info, loaded: false};
  }
}

/** ~150 spoken words per minute. Used only to fill `windowMs` honestly-ish. */
function estimateSpeechMs(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.round((words / 150) * 60_000);
}

const HINGLISH = /\b(sir|ji|nahi|hai|kar|aap|abhi|paisa|paise|bhai|karo|kijiye)\b/i;

function detectLanguage(text: string): ConversationEvidence['detectedLanguage'] {
  if (/[ऀ-ॿ]/.test(text)) {
    return 'hi';
  }
  if (HINGLISH.test(text)) {
    return 'hinglish';
  }
  return 'en';
}
