package com.ruko.core

import java.text.Normalizer

/**
 * WordPiece tokenizer for the on-device MiniLM model — the Kotlin twin of
 * mobile/src/risk/classifier/tokenizer.ts.
 *
 * The exported ONNX graph consumes token ids, so something on the device has to
 * produce them. This is a hand port of the same uncased-BERT tokenization the
 * model was trained with, kept deliberately dependency-free. It is not trusted
 * on faith: WordPieceTokenizerTest checks it against the very same
 * tokenizer_reference.json that the TypeScript tokenizer is checked against —
 * reference ids from the real HuggingFace tokenizer — so JS and Kotlin agree
 * token for token, and both agree with Python.
 *
 * The subtle points that a naive port gets wrong, all covered by the reference:
 *  - `_is_punctuation` includes Unicode P* but NOT symbol categories, so the
 *    rupee sign (Sc) is not split off — "₹48,000" must tokenize as one run.
 *  - accents are stripped via NFD + dropping non-spacing marks (uncased model).
 *  - iteration is over code points, so emoji and other astral characters do not
 *    get chopped through a surrogate pair.
 */
class WordPieceTokenizer(
    vocabLines: List<String>,
    val config: Config = Config(),
) {
    data class Config(
        val clsToken: String = "[CLS]",
        val sepToken: String = "[SEP]",
        val unkToken: String = "[UNK]",
        val padToken: String = "[PAD]",
        val maxLength: Int = 64,
        val doLowerCase: Boolean = true,
        val maxCharsPerWord: Int = 100,
    )

    data class Encoding(
        val inputIds: List<Int>,
        val attentionMask: List<Int>,
        val tokens: List<String>,
        /** True when the input was longer than maxLength and had to be cut. */
        val truncated: Boolean,
    )

    private val vocab: Map<String, Int> = buildMap {
        vocabLines.forEachIndexed { index, raw ->
            val t = raw.removeSuffix("\r")
            if (t.isNotEmpty() && !containsKey(t)) put(t, index)
        }
    }

    init {
        for (required in listOf(config.clsToken, config.sepToken, config.unkToken, config.padToken)) {
            require(vocab.containsKey(required)) {
                "tokenizer vocabulary is missing the $required token"
            }
        }
    }

    val vocabSize: Int get() = vocab.size

    fun tokenize(text: String): List<String> =
        basicTokenize(text).flatMap { wordpiece(it) }

    /**
     * Encode to model inputs. Reserves two slots for [CLS] and [SEP],
     * truncating the content exactly as `truncation=True, max_length=N` does.
     */
    fun encode(text: String, padToMaxLength: Boolean = false): Encoding {
        val content = tokenize(text)
        val room = config.maxLength - 2
        val truncated = content.size > room
        val tokens = ArrayList<String>(config.maxLength)
        tokens.add(config.clsToken)
        tokens.addAll(content.take(room))
        tokens.add(config.sepToken)

        val unkId = vocab.getValue(config.unkToken)
        val inputIds = ArrayList<Int>(tokens.size)
        tokens.forEach { inputIds.add(vocab[it] ?: unkId) }
        val attentionMask = ArrayList<Int>(tokens.size).apply { repeat(tokens.size) { add(1) } }

        if (padToMaxLength) {
            val padId = vocab.getValue(config.padToken)
            while (inputIds.size < config.maxLength) {
                inputIds.add(padId)
                attentionMask.add(0)
                tokens.add(config.padToken)
            }
        }
        return Encoding(inputIds, attentionMask, tokens, truncated)
    }

    // -- basic tokenization --------------------------------------------------

    private fun basicTokenize(text: String): List<String> {
        val cleaned = StringBuilder()
        var i = 0
        while (i < text.length) {
            val cp = text.codePointAt(i)
            i += Character.charCount(cp)
            if (cp == 0 || cp == 0xFFFD || isControl(cp)) continue
            when {
                isWhitespace(cp) -> cleaned.append(' ')
                isChineseChar(cp) -> {
                    cleaned.append(' ')
                    cleaned.appendCodePoint(cp)
                    cleaned.append(' ')
                }
                else -> cleaned.appendCodePoint(cp)
            }
        }

        val out = ArrayList<String>()
        for (rawWord in cleaned.toString().split(WHITESPACE)) {
            if (rawWord.isEmpty()) continue
            val word = if (config.doLowerCase) stripAccents(rawWord.lowercase()) else rawWord

            val current = StringBuilder()
            var j = 0
            while (j < word.length) {
                val cp = word.codePointAt(j)
                j += Character.charCount(cp)
                if (isPunctuation(cp)) {
                    if (current.isNotEmpty()) { out.add(current.toString()); current.setLength(0) }
                    out.add(String(Character.toChars(cp)))
                } else {
                    current.appendCodePoint(cp)
                }
            }
            if (current.isNotEmpty()) out.add(current.toString())
        }
        return out
    }

    /** Greedy longest-match-first over the vocabulary, with ## continuations. */
    private fun wordpiece(word: String): List<String> {
        val chars = word.codePoints().toArray()
        if (chars.size > config.maxCharsPerWord) return listOf(config.unkToken)

        val pieces = ArrayList<String>()
        var start = 0
        while (start < chars.size) {
            var end = chars.size
            var matched: String? = null
            while (start < end) {
                val sub = String(chars, start, end - start)
                val candidate = if (start > 0) "##$sub" else sub
                if (vocab.containsKey(candidate)) { matched = candidate; break }
                end--
            }
            if (matched == null) return listOf(config.unkToken)
            pieces.add(matched)
            start = end
        }
        return pieces
    }

    // -- character predicates: exact BERT semantics --------------------------

    private fun isPunctuation(cp: Int): Boolean {
        if (cp in 33..47 || cp in 58..64 || cp in 91..96 || cp in 123..126) return true
        return when (Character.getType(cp)) {
            Character.CONNECTOR_PUNCTUATION.toInt(),
            Character.DASH_PUNCTUATION.toInt(),
            Character.START_PUNCTUATION.toInt(),
            Character.END_PUNCTUATION.toInt(),
            Character.INITIAL_QUOTE_PUNCTUATION.toInt(),
            Character.FINAL_QUOTE_PUNCTUATION.toInt(),
            Character.OTHER_PUNCTUATION.toInt() -> true
            else -> false
        }
    }

    private fun isControl(cp: Int): Boolean {
        if (cp == '\t'.code || cp == '\n'.code || cp == '\r'.code) return false
        return when (Character.getType(cp)) {
            Character.CONTROL.toInt(),
            Character.FORMAT.toInt(),
            Character.PRIVATE_USE.toInt(),
            Character.SURROGATE.toInt(),
            Character.UNASSIGNED.toInt() -> true
            else -> false
        }
    }

    private fun isWhitespace(cp: Int): Boolean {
        if (cp == ' '.code || cp == '\t'.code || cp == '\n'.code || cp == '\r'.code) return true
        return Character.getType(cp) == Character.SPACE_SEPARATOR.toInt()
    }

    private fun isChineseChar(cp: Int): Boolean =
        (cp in 0x4E00..0x9FFF) || (cp in 0x3400..0x4DBF) ||
            (cp in 0x20000..0x2A6DF) || (cp in 0x2A700..0x2B73F) ||
            (cp in 0x2B740..0x2B81F) || (cp in 0x2B820..0x2CEAF) ||
            (cp in 0xF900..0xFAFF) || (cp in 0x2F800..0x2FA1F)

    /** Strip combining marks, as strip_accents does for an uncased model. */
    private fun stripAccents(text: String): String {
        val nfd = Normalizer.normalize(text, Normalizer.Form.NFD)
        val sb = StringBuilder(nfd.length)
        var i = 0
        while (i < nfd.length) {
            val cp = nfd.codePointAt(i)
            i += Character.charCount(cp)
            if (Character.getType(cp) != Character.NON_SPACING_MARK.toInt()) sb.appendCodePoint(cp)
        }
        return sb.toString()
    }

    companion object {
        private val WHITESPACE = Regex("\\s+")

        /** Load from the contents of the vocab.txt produced by ml/export. */
        fun fromVocabText(text: String, config: Config = Config()): WordPieceTokenizer =
            WordPieceTokenizer(text.split("\n"), config)
    }
}
