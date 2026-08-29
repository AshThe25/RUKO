package com.ruko.core

import kotlin.math.exp

/**
 * The scoring half of the on-device manipulation classifier — the Kotlin twin of
 * mobile/src/risk/classifier/calibration.ts and the conversation weights in
 * mobile/src/risk/weights.ts.
 *
 * Split from the tokenizer and the ONNX session on purpose: this is pure,
 * deterministic arithmetic with no Android and no model file, so it unit-tests
 * on the JVM and its numbers can be checked against the TypeScript ones to the
 * fourth decimal.
 *
 * The pipeline is: logits -> sigmoid -> per-label calibration -> (the risk
 * engine's conversation weights). Calibration exists because the model's decision
 * boundary for a label is its validation threshold, not 0.5; the rescale maps
 * each threshold onto 0.5 so a weight of "16 points" means what it says.
 */
object ManipulationScoring {

    /** The six tactics, in the exact order of the model's output logits. */
    enum class Label { AUTHORITY, COERCION, URGENCY, FINANCIAL_INSTRUCTION, SECRECY, CREDENTIAL_REQUEST }

    const val MODEL_VERSION = "ruko-manip-v1"
    const val MODEL_MAX_LENGTH = 64

    /** sha256 of the int8 model these thresholds were evaluated against. */
    const val EXPECTED_MODEL_SHA256 =
        "d65e7c689d893d0835543f9999724b4f3a4a4b756cd3003185ce69eb78362be1"
    const val VOCAB_SHA256 =
        "07eced375cec144d27c900241f3e339478dec958f92fddbc551f295c992038a3"

    /**
     * Per-label decision thresholds, calibrated on the validation split — the
     * same values in modelConfig.generated.ts. The point at which a label is
     * considered present; the calibrator rescales each onto 0.5.
     */
    val LABEL_THRESHOLDS: Map<Label, Double> = mapOf(
        Label.AUTHORITY to 0.2,
        Label.COERCION to 0.4,
        Label.URGENCY to 0.2,
        Label.FINANCIAL_INSTRUCTION to 0.37,
        Label.SECRECY to 0.4,
        Label.CREDENTIAL_REQUEST to 0.49,
    )

    /**
     * Risk-engine points per tactic (weights.ts, CONVERSATION family, max 85).
     * A calibrated score is multiplied by these to get the conversation
     * contribution to the overall risk score.
     */
    val CONVERSATION_WEIGHTS: Map<Label, Double> = mapOf(
        Label.COERCION to 24.0,
        Label.AUTHORITY to 16.0,
        Label.CREDENTIAL_REQUEST to 14.0,
        Label.FINANCIAL_INSTRUCTION to 14.0,
        Label.URGENCY to 11.0,
        Label.SECRECY to 6.0,
    )

    /** The most the conversation family can contribute on its own. */
    val CONVERSATION_MAX_POINTS: Double get() = CONVERSATION_WEIGHTS.values.sum()

    fun sigmoid(logit: Double): Double = 1.0 / (1.0 + exp(-logit))

    /**
     * Piecewise-linear rescale that maps a label's threshold onto 0.5, keeping
     * 0 at 0 and 1 at 1 and staying monotonic. Identical to calibrateScore in
     * calibration.ts.
     */
    fun calibrateScore(probability: Double, threshold: Double): Double {
        val p = if (probability.isFinite()) probability.coerceIn(0.0, 1.0) else 0.0
        val t = threshold.coerceIn(0.001, 0.999)
        return if (p < t) 0.5 * (p / t) else 0.5 + 0.5 * ((p - t) / (1 - t))
    }

    /** Sigmoid + calibrate every logit into the [0,1] "0.5 == on the fence" space. */
    fun calibrateFromLogits(logits: DoubleArray): Map<Label, Double> {
        require(logits.size == Label.entries.size) {
            "expected ${Label.entries.size} logits, got ${logits.size}"
        }
        return Label.entries.associateWith { label ->
            val prob = sigmoid(logits[label.ordinal])
            calibrateScore(prob, LABEL_THRESHOLDS.getValue(label))
        }
    }

    /** Which tactics are present: calibrated score at or above 0.5. */
    fun presentLabels(calibrated: Map<Label, Double>): List<Label> =
        Label.entries.filter { (calibrated[it] ?: 0.0) >= 0.5 }

    /**
     * The conversation family's contribution to the risk score (0..85), the
     * same product the deterministic risk engine forms: sum of calibrated score
     * times the tactic's weight.
     */
    fun conversationRiskPoints(calibrated: Map<Label, Double>): Double =
        CONVERSATION_WEIGHTS.entries.sumOf { (label, weight) -> (calibrated[label] ?: 0.0) * weight }
}
