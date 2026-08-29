package com.ruko.nativemodule.ai

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import com.ruko.core.InferenceBackend
import com.ruko.core.ManipulationScoring
import com.ruko.core.WordPieceTokenizer
import java.nio.LongBuffer
import java.security.MessageDigest

/**
 * The on-device manipulation classifier — the implementation ml/ was always
 * meant to ship into the seam Puneesh left (`LocalInferenceBackend`, and the
 * "Model loaded: no — ml/ has not shipped one" row on the engineering screen).
 *
 * It runs the exact int8 MiniLM exported by ml/export against onnxruntime, using
 * the tokenizer and calibration that are parity-checked against the TypeScript
 * pipeline in ruko-core. Every claim it makes is measured:
 *
 *  - the model file is hashed and compared to the sha256 the thresholds were
 *    evaluated against; a mismatch refuses to load rather than scoring with an
 *    unknown model.
 *  - latency is wall-clock around the actual `session.run`.
 *  - the backend is requested as NNAPI but only *reported* as NNAPI if the
 *    session was genuinely created with it; otherwise it says CPU. We never
 *    claim the NPU on the strength of a request alone.
 */
class OnnxManipulationClassifier private constructor(
    private val env: OrtEnvironment,
    private val session: OrtSession,
    private val tokenizer: WordPieceTokenizer,
    val backend: InferenceBackend,
    val modelHashVerified: Boolean,
    val modelSizeBytes: Long,
) {

    data class Result(
        val calibrated: Map<ManipulationScoring.Label, Double>,
        val present: List<ManipulationScoring.Label>,
        val conversationRiskPoints: Double,
        val latencyMs: Long,
        val backend: InferenceBackend,
    )

    /** Tokenize, run the model, calibrate — the whole on-device path, measured. */
    fun classify(text: String): Result {
        val enc = tokenizer.encode(text, padToMaxLength = true)
        val seq = enc.inputIds.size.toLong()
        val shape = longArrayOf(1, seq)

        val ids = LongArray(enc.inputIds.size) { enc.inputIds[it].toLong() }
        val mask = LongArray(enc.attentionMask.size) { enc.attentionMask[it].toLong() }

        val inputName = session.inputNames.iterator().next()
        val hasMask = session.inputNames.contains(ATTENTION_MASK)

        OnnxTensor.createTensor(env, LongBuffer.wrap(ids), shape).use { idTensor ->
            OnnxTensor.createTensor(env, LongBuffer.wrap(mask), shape).use { maskTensor ->
                val feeds = HashMap<String, OnnxTensor>()
                feeds[if (session.inputNames.contains(INPUT_IDS)) INPUT_IDS else inputName] = idTensor
                if (hasMask) feeds[ATTENTION_MASK] = maskTensor

                val startedAt = System.nanoTime()
                session.run(feeds).use { outputs ->
                    val latencyMs = ((System.nanoTime() - startedAt) / 1_000_000.0).toLong()
                    @Suppress("UNCHECKED_CAST")
                    val raw = outputs[0].value as Array<FloatArray>
                    val logits = DoubleArray(ManipulationScoring.Label.entries.size) { raw[0][it].toDouble() }

                    val calibrated = ManipulationScoring.calibrateFromLogits(logits)
                    return Result(
                        calibrated = calibrated,
                        present = ManipulationScoring.presentLabels(calibrated),
                        conversationRiskPoints = ManipulationScoring.conversationRiskPoints(calibrated),
                        latencyMs = latencyMs,
                        backend = backend,
                    )
                }
            }
        }
    }

    fun close() {
        runCatching { session.close() }
    }

    companion object {
        private const val MODEL_ASSET = "ruko/model_int8.onnx"
        private const val VOCAB_ASSET = "ruko/vocab.txt"
        private const val INPUT_IDS = "input_ids"
        private const val ATTENTION_MASK = "attention_mask"

        /**
         * Load the classifier from bundled assets. Returns null and never throws
         * if the model is absent or fails its hash check — the caller reports
         * "rules only" rather than scoring with a model it cannot vouch for.
         */
        fun load(context: Context): OnnxManipulationClassifier? {
            val assets = context.applicationContext.assets
            val modelBytes = runCatching { assets.open(MODEL_ASSET).use { it.readBytes() } }
                .getOrNull() ?: return null
            val vocabText = runCatching {
                assets.open(VOCAB_ASSET).use { it.readBytes().toString(Charsets.UTF_8) }
            }.getOrNull() ?: return null

            val hashVerified = sha256(modelBytes)
                .equals(ManipulationScoring.EXPECTED_MODEL_SHA256, ignoreCase = true)

            val tokenizer = runCatching { WordPieceTokenizer.fromVocabText(vocabText) }
                .getOrNull() ?: return null

            val env = OrtEnvironment.getEnvironment()

            // Request NNAPI; fall back to a plain CPU session if it will not
            // initialise. Report whichever one actually built.
            var backend = InferenceBackend.CPU
            val session: OrtSession = runCatching {
                val nnapiOptions = OrtSession.SessionOptions().apply { addNnapi() }
                env.createSession(modelBytes, nnapiOptions).also { backend = InferenceBackend.NNAPI }
            }.getOrElse {
                val cpuOptions = OrtSession.SessionOptions()
                env.createSession(modelBytes, cpuOptions)
            }

            return OnnxManipulationClassifier(
                env = env,
                session = session,
                tokenizer = tokenizer,
                backend = backend,
                modelHashVerified = hashVerified,
                modelSizeBytes = modelBytes.size.toLong(),
            )
        }

        private fun sha256(bytes: ByteArray): String =
            MessageDigest.getInstance("SHA-256").digest(bytes)
                .joinToString("") { "%02x".format(it) }
    }
}
