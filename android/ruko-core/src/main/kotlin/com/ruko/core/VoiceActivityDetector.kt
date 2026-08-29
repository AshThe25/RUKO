package com.ruko.core

import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Tier 1 of the AI stack: the cheap, always-on gate.
 *
 * Its whole job is to make sure ASR and the classifier — which are expensive —
 * only ever see frames that actually contain speech. Everything else is dropped
 * before it costs a millisecond of NPU or battery.
 *
 * Deliberately simple and fully deterministic:
 *   - short-term RMS energy per frame, in dBFS
 *   - an adaptive noise floor that tracks the quietest recent frames
 *   - a zero-crossing-rate veto that rejects broadband non-speech (taps, wind)
 *   - onset debounce and hangover so utterances are not chopped mid-word
 *
 * No model, no allocation per frame, no floating-point surprises. This runs on
 * every 20 ms of audio, so it has to stay boring.
 */
class VoiceActivityDetector(
    private val config: Config = Config(),
) {
    data class Config(
        val sampleRateHz: Int = 16_000,
        val frameMs: Int = 20,
        /** How far above the noise floor a frame must sit to count as speech. */
        val speechThresholdDb: Double = 9.0,
        /** Consecutive speech frames required before we declare an utterance. */
        val onsetFrames: Int = 3,
        /** Frames of silence tolerated inside an utterance before it ends. */
        val hangoverFrames: Int = 20,
        /** Noise floor cannot be inferred below this; guards against divide-by-zero. */
        val floorDbFs: Double = -80.0,
        /**
         * Speech ZCR sits well below this. Frames above it are broadband noise —
         * a fingernail on the mic, a chair scrape — and are vetoed.
         */
        val maxZeroCrossingRate: Double = 0.35,
        /** Utterances longer than this are force-flushed so ASR gets work early. */
        val maxUtteranceMs: Int = 8_000,
    ) {
        val samplesPerFrame: Int get() = sampleRateHz * frameMs / 1000
    }

    /** What the caller should do with this frame. */
    sealed interface Event {
        /** Frame is silence; nothing downstream should wake up. */
        data object Silence : Event

        /** An utterance just began on this frame. */
        data object SpeechStart : Event

        /** Mid-utterance. Keep buffering. */
        data object SpeechContinue : Event

        /**
         * The utterance ended. [durationMs] is speech duration excluding the
         * trailing hangover, so the caller can discard implausibly short blips.
         */
        data class SpeechEnd(val durationMs: Int, val forced: Boolean) : Event
    }

    private var noiseFloorDb = config.floorDbFs
    private var noiseFloorInitialised = false
    private var consecutiveSpeech = 0
    private var hangoverRemaining = 0
    private var inUtterance = false
    private var utteranceFrames = 0

    /** Most recent frame energy, for the Engineering screen. */
    var lastFrameDb: Double = config.floorDbFs
        private set

    /** Current adaptive noise floor, for the Engineering screen. */
    val noiseFloorDbFs: Double get() = noiseFloorDb

    /**
     * Feed exactly one frame of 16-bit mono PCM.
     *
     * @throws IllegalArgumentException if [frame] is not [Config.samplesPerFrame] long.
     */
    fun accept(frame: ShortArray): Event {
        require(frame.size == config.samplesPerFrame) {
            "expected ${config.samplesPerFrame} samples, got ${frame.size}"
        }

        val db = frameEnergyDb(frame)
        lastFrameDb = db

        if (!noiseFloorInitialised) {
            noiseFloorDb = db
            noiseFloorInitialised = true
        }

        val loudEnough = db > noiseFloorDb + config.speechThresholdDb
        val looksLikeSpeech = loudEnough && zeroCrossingRate(frame) <= config.maxZeroCrossingRate

        // Classify first, adapt second, and adapt *only* on non-speech frames.
        // Folding speech into the floor is how an energy VAD goes deaf: over a
        // long call the floor converges on the talker's level, the margin
        // collapses, and the detector stops reporting the very speech it was
        // built to catch.
        if (!looksLikeSpeech) updateNoiseFloor(db)

        return if (looksLikeSpeech) onSpeechFrame() else onSilentFrame()
    }

    /** Ends any open utterance. Call when the session stops or the mic drops. */
    fun flush(): Event {
        if (!inUtterance) return Event.Silence
        val duration = utteranceFrames * config.frameMs
        resetUtterance()
        return Event.SpeechEnd(durationMs = duration, forced = true)
    }

    fun reset() {
        noiseFloorDb = config.floorDbFs
        noiseFloorInitialised = false
        resetUtterance()
    }

    private fun onSpeechFrame(): Event {
        consecutiveSpeech++
        hangoverRemaining = config.hangoverFrames

        if (!inUtterance) {
            if (consecutiveSpeech < config.onsetFrames) return Event.Silence
            inUtterance = true
            utteranceFrames = consecutiveSpeech
            return Event.SpeechStart
        }

        utteranceFrames++
        if (utteranceFrames * config.frameMs >= config.maxUtteranceMs) {
            val duration = utteranceFrames * config.frameMs
            resetUtterance()
            // Stay hot: a forced flush is a segmentation boundary, not a stop.
            consecutiveSpeech = config.onsetFrames
            inUtterance = true
            utteranceFrames = 0
            return Event.SpeechEnd(durationMs = duration, forced = true)
        }
        return Event.SpeechContinue
    }

    private fun onSilentFrame(): Event {
        consecutiveSpeech = 0
        if (!inUtterance) return Event.Silence

        utteranceFrames++
        hangoverRemaining--
        if (hangoverRemaining > 0) return Event.SpeechContinue

        val speechFrames = utteranceFrames - config.hangoverFrames
        val duration = max(0, speechFrames) * config.frameMs
        resetUtterance()
        return Event.SpeechEnd(durationMs = duration, forced = false)
    }

    private fun resetUtterance() {
        inUtterance = false
        utteranceFrames = 0
        consecutiveSpeech = 0
        hangoverRemaining = 0
    }

    /**
     * Tracks the ambient level. Only ever called with a non-speech frame.
     *
     * Falls quickly so a newly quiet room is believed at once, and rises more
     * slowly so a single door slam does not raise the bar for the next word.
     */
    private fun updateNoiseFloor(frameDb: Double) {
        noiseFloorDb =
            if (frameDb < noiseFloorDb) {
                noiseFloorDb + (frameDb - noiseFloorDb) * FLOOR_FALL_RATE
            } else {
                noiseFloorDb + (frameDb - noiseFloorDb) * FLOOR_RISE_RATE
            }
        noiseFloorDb = max(config.floorDbFs, min(noiseFloorDb, 0.0))
    }

    private fun frameEnergyDb(frame: ShortArray): Double {
        var sumSquares = 0.0
        for (sample in frame) {
            val normalised = sample.toDouble() / Short.MAX_VALUE
            sumSquares += normalised * normalised
        }
        val rms = sqrt(sumSquares / frame.size)
        if (rms <= 0.0) return config.floorDbFs
        return max(config.floorDbFs, 20.0 * log10(rms))
    }

    private fun zeroCrossingRate(frame: ShortArray): Double {
        var crossings = 0
        for (i in 1 until frame.size) {
            if ((frame[i] >= 0) != (frame[i - 1] >= 0)) crossings++
        }
        return crossings.toDouble() / (frame.size - 1)
    }

    private companion object {
        /** Fast adaptation downward — a new quiet room is believed quickly. */
        const val FLOOR_FALL_RATE = 0.25

        /**
         * Slower adaptation upward. Only non-speech frames reach this, so the
         * rate can be brisk enough to follow a genuinely noisier room without
         * ever chasing the talker.
         */
        const val FLOOR_RISE_RATE = 0.02
    }
}
