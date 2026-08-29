package com.ruko.nativemodule.audio

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import androidx.core.content.ContextCompat
import com.ruko.core.NativeErrorCode
import com.ruko.core.VoiceActivityDetector
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Owns the microphone for the duration of a protected session.
 *
 * Contract with the rest of the system:
 *
 *  - Audio is read into a reusable buffer and handed to the VAD frame by frame.
 *    Nothing is written to disk, ever, and no PCM leaves this class except as
 *    a speech segment passed to the caller's callback.
 *  - Recording only happens inside an explicit session the user started. There
 *    is no "always on" mode and there is no silent start.
 *  - `VOICE_RECOGNITION` is the source. `VOICE_CALL` and friends need a
 *    privileged permission Ruko does not and cannot hold, so Ruko hears the
 *    room, not the call stream.
 *
 * The open question this class is built around: on Android 10+ the telephony
 * stack takes priority for audio capture, so during an active cellular call a
 * normal app may receive silence. [onAllSilentDuringCall] fires when that looks
 * like it is happening, so the UI can say so instead of pretending to listen.
 * See docs/android-capabilities.md §2.1.
 */
class AudioSessionManager(
    private val context: Context,
    private val config: VoiceActivityDetector.Config = VoiceActivityDetector.Config(),
) {

    /** One detected utterance of 16-bit mono PCM at [VoiceActivityDetector.Config.sampleRateHz]. */
    fun interface SpeechListener {
        fun onSpeechSegment(pcm: ShortArray, durationMs: Int)
    }

    private val running = AtomicBoolean(false)
    private var scope: CoroutineScope? = null
    private var job: Job? = null
    private var record: AudioRecord? = null

    val isRunning: Boolean get() = running.get()

    /** Raised when the platform appears to be silencing us during a call. */
    var onAllSilentDuringCall: (() -> Unit)? = null

    var onError: ((code: String, message: String) -> Unit)? = null

    /** Live frame energy in dBFS, updated every ~20ms while running. For diagnostics. */
    @Volatile
    var lastLevelDb: Double = -80.0
        private set

    /** Current adaptive noise floor, for diagnostics. */
    @Volatile
    var noiseFloorDb: Double = -80.0
        private set

    fun hasPermission(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED

    /**
     * @return true if the session started. False means [onError] already fired
     *   with a reason; the caller should surface it rather than retrying.
     */
    @SuppressLint("MissingPermission") // guarded by hasPermission() above
    fun start(listener: SpeechListener): Boolean {
        if (!hasPermission()) {
            onError?.invoke(
                NativeErrorCode.AUDIO_PERMISSION_DENIED,
                "Ruko needs microphone access to listen during a protected session.",
            )
            return false
        }
        if (!running.compareAndSet(false, true)) return true

        val minBuffer = AudioRecord.getMinBufferSize(
            config.sampleRateHz,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
        )
        if (minBuffer <= 0) {
            running.set(false)
            onError?.invoke(NativeErrorCode.AUDIO_START_FAILED, "This device rejected the audio format.")
            return false
        }

        val recorder = try {
            AudioRecord(
                MediaRecorder.AudioSource.VOICE_RECOGNITION,
                config.sampleRateHz,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                // Headroom so a scheduling hiccup does not drop frames.
                maxOf(minBuffer, config.samplesPerFrame * BUFFER_FRAMES * Short.SIZE_BYTES),
            )
        } catch (error: IllegalArgumentException) {
            running.set(false)
            onError?.invoke(NativeErrorCode.AUDIO_START_FAILED, error.message ?: "Could not open the microphone.")
            return false
        }

        if (recorder.state != AudioRecord.STATE_INITIALIZED) {
            recorder.release()
            running.set(false)
            onError?.invoke(
                NativeErrorCode.AUDIO_START_FAILED,
                "The microphone is unavailable. Another app may be using it.",
            )
            return false
        }

        record = recorder
        recorder.startRecording()

        val sessionScope = CoroutineScope(Dispatchers.IO)
        scope = sessionScope
        job = sessionScope.launch { readLoop(recorder, listener) }
        return true
    }

    fun stop() {
        if (!running.compareAndSet(true, false)) return
        runBlocking { job?.cancelAndJoin() }
        job = null
        scope = null
        record?.let { recorder ->
            runCatching { recorder.stop() }
            recorder.release()
        }
        record = null
    }

    private suspend fun readLoop(recorder: AudioRecord, listener: SpeechListener) {
        val vad = VoiceActivityDetector(config)
        val frame = ShortArray(config.samplesPerFrame)
        val utterance = ArrayList<Short>(config.sampleRateHz * 2)

        var framesRead = 0L
        var silentFrames = 0L
        var reportedSilence = false

        while (running.get()) {
            currentCoroutineContextEnsureActive()

            val read = recorder.read(frame, 0, frame.size)
            if (read < 0) {
                onError?.invoke(NativeErrorCode.AUDIO_START_FAILED, "The microphone stopped returning data.")
                return
            }
            if (read < frame.size) continue

            framesRead++
            if (isDigitalSilence(frame)) silentFrames++

            // A stretch of *perfect* digital silence is not a quiet room — a
            // quiet room still has dither. It means the platform is handing us
            // zeros, which is what capture-concurrency denial looks like.
            if (!reportedSilence && framesRead >= SILENCE_VERDICT_FRAMES &&
                silentFrames >= framesRead * SILENCE_VERDICT_RATIO
            ) {
                reportedSilence = true
                onAllSilentDuringCall?.invoke()
            }

            lastLevelDb = vad.lastFrameDb
            noiseFloorDb = vad.noiseFloorDbFs

            when (val event = vad.accept(frame)) {
                is VoiceActivityDetector.Event.SpeechStart -> {
                    utterance.clear()
                    frame.forEach { utterance.add(it) }
                }

                is VoiceActivityDetector.Event.SpeechContinue -> {
                    if (utterance.size < MAX_UTTERANCE_SAMPLES) frame.forEach { utterance.add(it) }
                }

                is VoiceActivityDetector.Event.SpeechEnd -> {
                    if (event.durationMs >= MIN_UTTERANCE_MS && utterance.isNotEmpty()) {
                        listener.onSpeechSegment(utterance.toShortArray(), event.durationMs)
                    }
                    utterance.clear()
                }

                is VoiceActivityDetector.Event.Silence -> Unit
            }
        }
    }

    private suspend fun currentCoroutineContextEnsureActive() {
        kotlinx.coroutines.currentCoroutineContext().ensureActive()
    }

    private fun isDigitalSilence(frame: ShortArray): Boolean = frame.all { it.toInt() == 0 }

    private companion object {
        const val BUFFER_FRAMES = 10

        /** Under 200 ms is a cough or a door, not something worth transcribing. */
        const val MIN_UTTERANCE_MS = 200

        /** 30 s of audio. A hard ceiling so a stuck VAD cannot exhaust memory. */
        const val MAX_UTTERANCE_SAMPLES = 16_000 * 30

        /** ~2 s of frames before we are willing to call it silence. */
        const val SILENCE_VERDICT_FRAMES = 100L
        const val SILENCE_VERDICT_RATIO = 0.98
    }
}
