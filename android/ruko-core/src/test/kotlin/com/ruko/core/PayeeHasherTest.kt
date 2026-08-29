package com.ruko.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class PayeeHasherTest {

    private val salt = ByteArray(32) { it.toByte() }
    private val otherSalt = ByteArray(32) { (it + 1).toByte() }

    @Test
    fun `is stable for the same payee and salt`() {
        assertEquals(
            PayeeHasher.hash("ravi.verify@okaxis", salt),
            PayeeHasher.hash("ravi.verify@okaxis", salt),
        )
    }

    @Test
    fun `normalises case and whitespace so the same payee matches`() {
        assertEquals(
            PayeeHasher.hash("ravi.verify@okaxis", salt),
            PayeeHasher.hash("  Ravi.Verify@OKAXIS ", salt),
        )
    }

    @Test
    fun `different payees hash differently`() {
        assertNotEquals(
            PayeeHasher.hash("ravi.verify@okaxis", salt),
            PayeeHasher.hash("meera.landlord@okhdfc", salt),
        )
    }

    @Test
    fun `the salt makes hashes useless on another device`() {
        assertNotEquals(
            PayeeHasher.hash("ravi.verify@okaxis", salt),
            PayeeHasher.hash("ravi.verify@okaxis", otherSalt),
        )
    }

    @Test
    fun `produces a full-length hex sha256`() {
        val hash = PayeeHasher.hash("ravi.verify@okaxis", salt)
        assertEquals(64, hash.length)
        assertTrue(hash.all { it in "0123456789abcdef" })
    }

    @Test
    fun `refuses a weak salt`() {
        assertFailsWith<IllegalArgumentException> { PayeeHasher.hash("ravi@okaxis", ByteArray(4)) }
    }

    @Test
    fun `refuses a blank payee`() {
        assertFailsWith<IllegalArgumentException> { PayeeHasher.hash("   ", salt) }
    }
}
