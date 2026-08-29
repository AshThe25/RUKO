package com.ruko.core

import kotlin.math.PI
import kotlin.math.sin
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertTrue

class VoiceActivityDetectorTest {

    private val config = VoiceActivityDetector.Config()
    private val frameSize = config.samplesPerFrame

    @Test
    fun `rejects a frame of the wrong length`() {
        val vad = VoiceActivityDetector()
        assertFailsWith<IllegalArgumentException> { vad.accept(ShortArray(frameSize - 1)) }
    }

    @Test
    fun `quiet room never reports speech`() {
        val vad = VoiceActivityDetector()
        repeat(100) {
            assertIs<VoiceActivityDetector.Event.Silence>(vad.accept(quiet()))
        }
    }

    @Test
    fun `a spoken burst produces start, continue and end`() {
        val vad = VoiceActivityDetector()
        repeat(20) { vad.accept(quiet()) }

        val onset = (1..config.onsetFrames).map { vad.accept(voiced()) }
        assertTrue(onset.dropLast(1).all { it is VoiceActivityDetector.Event.Silence })
        assertIs<VoiceActivityDetector.Event.SpeechStart>(onset.last())

        repeat(30) { assertIs<VoiceActivityDetector.Event.SpeechContinue>(vad.accept(voiced())) }

        var end: VoiceActivityDetector.Event.SpeechEnd? = null
        for (i in 0 until config.hangoverFrames + 5) {
            val event = vad.accept(quiet())
            if (event is VoiceActivityDetector.Event.SpeechEnd) {
                end = event
                break
            }
        }
        val speechEnd = requireNotNull(end) { "utterance never ended" }
        assertTrue(!speechEnd.forced)
        // 3 onset + 30 sustained frames of real speech, at 20 ms each.
        assertEquals((config.onsetFrames + 30) * config.frameMs, speechEnd.durationMs)
    }

    @Test
    fun `a short gap inside a sentence does not end the utterance`() {
        val vad = VoiceActivityDetector()
        repeat(20) { vad.accept(quiet()) }
        repeat(config.onsetFrames + 5) { vad.accept(voiced()) }

        // A pause shorter than the hangover window: still one utterance.
        repeat(config.hangoverFrames - 2) {
            assertIs<VoiceActivityDetector.Event.SpeechContinue>(vad.accept(quiet()))
        }
        assertIs<VoiceActivityDetector.Event.SpeechContinue>(vad.accept(voiced()))
    }

    @Test
    fun `broadband noise is vetoed by zero-crossing rate`() {
        val vad = VoiceActivityDetector()
        repeat(20) { vad.accept(quiet()) }
        // Loud enough to pass the energy gate, but alternating sign every sample.
        repeat(20) {
            assertIs<VoiceActivityDetector.Event.Silence>(vad.accept(broadbandNoise()))
        }
    }

    @Test
    fun `a very long utterance is force-flushed so ASR gets work early`() {
        val vad = VoiceActivityDetector()
        repeat(20) { vad.accept(quiet()) }

        val maxFrames = config.maxUtteranceMs / config.frameMs
        var forced: VoiceActivityDetector.Event.SpeechEnd? = null
        for (i in 0 until maxFrames + 10) {
            val event = vad.accept(voiced())
            if (event is VoiceActivityDetector.Event.SpeechEnd) {
                forced = event
                break
            }
        }
        val flush = requireNotNull(forced) { "long utterance was never flushed" }
        assertTrue(flush.forced)
        assertTrue(flush.durationMs >= config.maxUtteranceMs)
    }

    @Test
    fun `flush closes an open utterance and is idempotent`() {
        val vad = VoiceActivityDetector()
        repeat(20) { vad.accept(quiet()) }
        repeat(config.onsetFrames + 4) { vad.accept(voiced()) }

        val closed = vad.flush()
        assertIs<VoiceActivityDetector.Event.SpeechEnd>(closed)
        assertTrue((closed as VoiceActivityDetector.Event.SpeechEnd).forced)
        assertIs<VoiceActivityDetector.Event.Silence>(vad.flush())
    }

    @Test
    fun `sustained speech does not drag the noise floor up and deafen the detector`() {
        val vad = VoiceActivityDetector()
        repeat(20) { vad.accept(quiet()) }
        val floorBefore = vad.noiseFloorDbFs

        repeat(200) { vad.accept(voiced()) }

        // The floor may creep, but nowhere near the speech level.
        assertTrue(
            vad.noiseFloorDbFs < floorBefore + 6.0,
            "noise floor rose too far during speech: $floorBefore -> ${vad.noiseFloorDbFs}",
        )
    }

    // --- signal helpers -----------------------------------------------------

    /** Near-silence with a little dither, as a real mic in a quiet room gives. */
    private fun quiet(): ShortArray {
        val rng = java.util.Random(SEED)
        return ShortArray(frameSize) { (rng.nextInt(9) - 4).toShort() }
    }

    /** A 300 Hz tone: speech-like fundamental, low zero-crossing rate. */
    private fun voiced(): ShortArray = ShortArray(frameSize) { i ->
        val t = i.toDouble() / config.sampleRateHz
        (8000 * sin(2 * PI * 300 * t)).toInt().toShort()
    }

    /** Loud, but flipping sign every sample — the ZCR veto must catch it. */
    private fun broadbandNoise(): ShortArray =
        ShortArray(frameSize) { i -> (if (i % 2 == 0) 8000 else -8000).toShort() }

    private companion object {
        const val SEED = 42L
    }
}
