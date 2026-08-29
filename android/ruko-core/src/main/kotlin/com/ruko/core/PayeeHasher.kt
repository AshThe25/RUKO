package com.ruko.core

import java.security.MessageDigest

/**
 * Turns a payee identifier into a stable local pseudonym.
 *
 * Ruko needs to answer "have I paid this person before?" without ever holding
 * or transmitting the raw VPA. A per-install random salt makes the hashes
 * useless outside this device — the UPI handle space is small enough that an
 * unsalted SHA-256 of `ravi.verify@okaxis` would be trivially reversible by
 * dictionary attack.
 *
 * The salt lives in the app's private storage and never leaves the device.
 */
object PayeeHasher {

    /** Normalises before hashing so `Ravi@OKAXIS` and `ravi@okaxis` match. */
    fun hash(payeeId: String, salt: ByteArray): String {
        require(salt.size >= MIN_SALT_BYTES) {
            "salt must be at least $MIN_SALT_BYTES bytes, was ${salt.size}"
        }
        val normalised = normalise(payeeId)
        require(normalised.isNotEmpty()) { "payeeId must not be blank" }

        val digest = MessageDigest.getInstance("SHA-256")
        digest.update(salt)
        digest.update(normalised.toByteArray(Charsets.UTF_8))
        return digest.digest().toHex()
    }

    fun normalise(payeeId: String): String =
        payeeId.trim().lowercase().replace(Regex("""\s+"""), "")

    const val MIN_SALT_BYTES = 16

    private fun ByteArray.toHex(): String {
        val out = StringBuilder(size * 2)
        for (byte in this) {
            val value = byte.toInt() and 0xFF
            out.append(HEX[value ushr 4]).append(HEX[value and 0x0F])
        }
        return out.toString()
    }

    private val HEX = "0123456789abcdef".toCharArray()
}
