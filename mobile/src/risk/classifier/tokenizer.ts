/**
 * WordPiece tokenizer for the on-device BERT-family model.
 *
 * WHY HAND-WRITTEN: the exported ONNX graph takes token ids, so something has to
 * produce them on the phone. The JavaScript tokenizer libraries pull in WASM
 * binaries and a large dependency tree for what is, for a lowercased
 * uncased-BERT vocabulary, about 150 lines. Fewer moving parts in the offline
 * path is worth more than the generality.
 *
 * Correctness is not assumed: `__tests__/tokenizer.test.ts` checks this
 * implementation against reference token ids produced by the actual
 * HuggingFace tokenizer, over English, Hinglish, punctuation, digits, unknown
 * words and truncation boundaries.
 */

export interface TokenizerConfig {
  clsToken: string;
  sepToken: string;
  unkToken: string;
  padToken: string;
  maxLength: number;
  doLowerCase: boolean;
  maxCharsPerWord: number;
}

export const DEFAULT_TOKENIZER_CONFIG: TokenizerConfig = {
  clsToken: '[CLS]',
  sepToken: '[SEP]',
  unkToken: '[UNK]',
  padToken: '[PAD]',
  maxLength: 64,
  doLowerCase: true,
  maxCharsPerWord: 100,
};

export interface Encoding {
  inputIds: number[];
  attentionMask: number[];
  tokens: string[];
  /** True when the input was longer than maxLength and had to be cut. */
  truncated: boolean;
}

/**
 * Exactly BERT's `_is_punctuation`: the four ASCII punctuation ranges, plus any
 * character in a Unicode category beginning with P.
 *
 * Note what is NOT included: symbol categories (S*). The rupee sign is category
 * Sc, so BERT does not split it off and "₹48,000" tokenizes differently from
 * "₹ 48,000". Including \p{S} here made this tokenizer disagree with the Python
 * one on every transcript containing a currency symbol -- a silent wrong-answer
 * bug, caught by the reference tests rather than by anything crashing.
 */
function isPunctuation(ch: string): boolean {
  const cp = ch.codePointAt(0)!;
  if ((cp >= 33 && cp <= 47) || (cp >= 58 && cp <= 64) ||
      (cp >= 91 && cp <= 96) || (cp >= 123 && cp <= 126)) return true;
  return /\p{P}/u.test(ch);
}

function isControl(ch: string): boolean {
  if (ch === '\t' || ch === '\n' || ch === '\r') return false;
  return /\p{C}/u.test(ch);
}

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || /\p{Zs}/u.test(ch);
}

/**
 * CJK ideographs are split into individual characters by BERT. Irrelevant for
 * English and Hinglish, kept so the tokenizer matches the reference exactly if
 * such a character ever appears in a transcript.
 */
function isChineseChar(cp: number): boolean {
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x20000 && cp <= 0x2a6df) || (cp >= 0x2a700 && cp <= 0x2b73f) ||
    (cp >= 0x2b740 && cp <= 0x2b81f) || (cp >= 0x2b820 && cp <= 0x2ceaf) ||
    (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0x2f800 && cp <= 0x2fa1f)
  );
}

/** Strip combining marks, as `strip_accents` does for an uncased model. */
function stripAccents(text: string): string {
  return text.normalize('NFD').replace(/\p{Mn}/gu, '');
}

export class WordPieceTokenizer {
  private readonly vocab: Map<string, number>;
  private readonly config: TokenizerConfig;

  constructor(vocabLines: string[], config: Partial<TokenizerConfig> = {}) {
    this.config = { ...DEFAULT_TOKENIZER_CONFIG, ...config };
    this.vocab = new Map();
    vocabLines.forEach((token, index) => {
      const t = token.replace(/\r$/, '');
      if (t.length > 0 && !this.vocab.has(t)) this.vocab.set(t, index);
    });
    for (const required of [this.config.clsToken, this.config.sepToken,
      this.config.unkToken, this.config.padToken]) {
      if (!this.vocab.has(required)) {
        throw new Error(`tokenizer vocabulary is missing the ${required} token`);
      }
    }
  }

  /** Load from the contents of the vocab.txt produced by ml/export. */
  static fromVocabText(text: string, config: Partial<TokenizerConfig> = {}): WordPieceTokenizer {
    return new WordPieceTokenizer(text.split('\n'), config);
  }

  get vocabSize(): number {
    return this.vocab.size;
  }

  /** Whitespace/punctuation splitting, lowercasing and accent stripping. */
  private basicTokenize(text: string): string[] {
    const cleaned = [...text]
      .filter((ch) => {
        const cp = ch.codePointAt(0)!;
        return cp !== 0 && cp !== 0xfffd && !isControl(ch);
      })
      .map((ch) => (isWhitespace(ch) ? ' ' : ch))
      .map((ch) => (isChineseChar(ch.codePointAt(0)!) ? ` ${ch} ` : ch))
      .join('');

    const out: string[] = [];
    for (let word of cleaned.split(/\s+/)) {
      if (!word) continue;
      if (this.config.doLowerCase) word = stripAccents(word.toLowerCase());
      // Split off punctuation into its own tokens, as BERT does.
      let current = '';
      for (const ch of word) {
        if (isPunctuation(ch)) {
          if (current) { out.push(current); current = ''; }
          out.push(ch);
        } else {
          current += ch;
        }
      }
      if (current) out.push(current);
    }
    return out;
  }

  /** Greedy longest-match-first over the vocabulary, with ## continuations. */
  private wordpiece(word: string): string[] {
    if (word.length > this.config.maxCharsPerWord) return [this.config.unkToken];
    const chars = [...word];
    const pieces: string[] = [];
    let start = 0;

    while (start < chars.length) {
      let end = chars.length;
      let matched: string | null = null;
      while (start < end) {
        const candidate = (start > 0 ? '##' : '') + chars.slice(start, end).join('');
        if (this.vocab.has(candidate)) { matched = candidate; break; }
        end--;
      }
      if (matched === null) return [this.config.unkToken];
      pieces.push(matched);
      start = end;
    }
    return pieces;
  }

  tokenize(text: string): string[] {
    return this.basicTokenize(text).flatMap((word) => this.wordpiece(word));
  }

  /**
   * Encode to model inputs. Reserves two slots for [CLS] and [SEP], truncating
   * the content, exactly as `truncation=True, max_length=N` does in Python.
   */
  encode(text: string, padToMaxLength = false): Encoding {
    const { clsToken, sepToken, padToken, maxLength } = this.config;
    const content = this.tokenize(text);
    const room = maxLength - 2;
    const truncated = content.length > room;
    const tokens = [clsToken, ...content.slice(0, room), sepToken];

    const inputIds = tokens.map((t) => this.vocab.get(t) ?? this.vocab.get(this.config.unkToken)!);
    const attentionMask = new Array(tokens.length).fill(1);

    if (padToMaxLength) {
      const padId = this.vocab.get(padToken)!;
      while (inputIds.length < maxLength) {
        inputIds.push(padId);
        attentionMask.push(0);
        tokens.push(padToken);
      }
    }
    return { inputIds, attentionMask, tokens, truncated };
  }
}
