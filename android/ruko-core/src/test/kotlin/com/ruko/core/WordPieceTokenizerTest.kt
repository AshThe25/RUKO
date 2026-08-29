package com.ruko.core

import java.util.Base64
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/**
 * The Kotlin tokenizer must agree, token for token, with the reference ids the
 * real HuggingFace tokenizer produced — the same tokenizer_reference.json the
 * TypeScript tokenizer is checked against. If JS, Kotlin and Python do not all
 * agree, the model is quietly wrong on device and nothing crashes to tell us.
 */
class WordPieceTokenizerTest {

    private fun resource(path: String): String =
        checkNotNull(javaClass.getResourceAsStream(path)) { "missing test resource $path" }
            .bufferedReader().readText()

    private val tokenizer by lazy {
        WordPieceTokenizer.fromVocabText(resource("/ruko/vocab.txt"))
    }

    @Test
    fun `loads the exported vocabulary`() {
        assertEquals(30522, tokenizer.vocabSize)
    }

    @Test
    fun `matches HuggingFace reference ids token for token`() {
        val rows = resource("/ruko/tokenizer_reference.txt").trim().lines()
        assertEquals(14, rows.size)
        for (row in rows) {
            val (b64, idsCsv, toks) = row.split("|", limit = 3)
            val text = String(Base64.getDecoder().decode(b64), Charsets.UTF_8)
            val expectedIds = if (idsCsv.isEmpty()) emptyList()
                else idsCsv.split(",").map { it.toInt() }
            val expectedTokens = if (toks.isEmpty()) emptyList() else toks.split(" ")

            val enc = tokenizer.encode(text)
            val label = text.trim().ifEmpty { "(empty/whitespace)" }.take(46)
            assertEquals(expectedTokens, enc.tokens, "token mismatch for: $label")
            assertEquals(expectedIds, enc.inputIds, "id mismatch for: $label")
        }
    }

    @Test
    fun `padding fills to max length and masks the padding`() {
        val enc = tokenizer.encode("hello sir", padToMaxLength = true)
        assertEquals(64, enc.inputIds.size)
        assertEquals(64, enc.attentionMask.size)
        assertEquals(enc.tokens.count { it != "[PAD]" }, enc.attentionMask.sum())
    }

    @Test
    fun `truncation reserves room for the special tokens`() {
        val enc = tokenizer.encode(List(200) { "word" }.joinToString(" "))
        assertTrue(enc.truncated)
        assertEquals(64, enc.inputIds.size)
        assertEquals("[CLS]", enc.tokens.first())
        assertEquals("[SEP]", enc.tokens.last())
    }

    @Test
    fun `an absurdly long single word is UNK, not a hang`() {
        val enc = tokenizer.encode("a".repeat(500))
        assertTrue(enc.tokens.contains("[UNK]"))
    }

    @Test
    fun `rejects a vocabulary missing its special tokens`() {
        assertFailsWith<IllegalArgumentException> {
            WordPieceTokenizer(listOf("hello", "world"))
        }
    }
}
