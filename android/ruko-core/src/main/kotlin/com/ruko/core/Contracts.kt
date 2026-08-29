package com.ruko.core

/**
 * Kotlin mirror of the schema files in `docs/contracts`.
 *
 * These are transport and evidence shapes only. Nothing here scores risk —
 * the risk engine is owned by ml/ and mobile/src/risk. `RiskResult` exists
 * purely so the native layer can carry a result to the Guardian without
 * understanding how it was produced.
 *
 * If you change a field here, change `docs/contracts/` and the Pydantic mirror
 * in `backend/app/models/` in the same commit.
 */

const val PROTOCOL_VERSION = "1.0.0"

/** A confidence in [0, 1]. */
typealias Confidence = Double

enum class ConversationSource { LOCAL_MODEL, RULES, DEMO }

data class ConversationEvidence(
    val authority: Confidence,
    val coercion: Confidence,
    val urgency: Confidence,
    val financialInstruction: Confidence,
    val secrecy: Confidence,
    val credentialRequest: Confidence,
    val confidence: Confidence,
    val source: ConversationSource,
    /** Measured. Null when no inference has run. Never estimated. */
    val latencyMs: Long?,
    val modelVersion: String,
    val capturedAt: String,
)

/** How a payment became visible to Ruko. Carried all the way to the audit trail. */
enum class PaymentContextSource {
    /** Parsed from AccessibilityService nodes on a real payment screen. */
    ACCESSIBILITY,

    /** The bundled RukoPayDemo app. Never presented as an interception. */
    DEMO_APP,

    /** Test injection. */
    MOCK,
}

data class PaymentEvidence(
    val active: Boolean,
    /** Integer rupees. */
    val amount: Long,
    val currency: String = "INR",
    val payee: String,
    /** Salted SHA-256. The raw VPA never leaves the device. */
    val payeeHash: String,
    val source: PaymentContextSource,
    val packageName: String?,
    val observedAt: String,
)

data class CallEvidence(
    val active: Boolean,
    val callerKnown: Boolean,
    val durationSeconds: Long,
    /**
     * True always, on stock Android. Ruko hears the room through the device
     * microphone; it cannot access the protected call stream.
     */
    val audioFromMicrophone: Boolean = true,
)

data class NotificationEvidence(
    val suspicion: Confidence,
    val matchCount: Int,
    /** Bounded, redacted. See [NotificationRelevanceFilter]. */
    val excerpts: List<String>,
    val lookbackMinutes: Int,
)

enum class RiskLevel { LOW, MEDIUM, HIGH, CRITICAL }

enum class PolicyAction {
    NONE,
    SUBTLE_WARNING,
    BLOCK_WARNING,
    BLOCK_WARNING_WITH_GUARDIAN,
}

/** Transport holder only. Produced elsewhere; never computed in this module. */
data class RiskResult(
    val score: Int,
    val level: RiskLevel,
    val reasons: List<String>,
    val policyAction: PolicyAction,
    val lowConfidence: Boolean,
    val modelVersion: String,
    val policyVersion: String,
    val evaluatedAt: String,
)

/** Which compute unit the local runtime actually initialised on. */
enum class InferenceBackend { CPU, NNAPI, QUALCOMM, RULES, UNKNOWN }

data class RuntimeInfo(
    /** e.g. "onnxruntime-android". */
    val engine: String,
    val model: String,
    /** The backend the session reported back, not the one we requested. */
    val backend: InferenceBackend,
    val isLocal: Boolean,
    val isReady: Boolean,
    /** Measured on real inference. Null until something has actually run. */
    val lastLatencyMs: Long?,
    /** Set whenever we asked for one backend and got another. */
    val degradedReason: String?,
)

/** Stable error codes surfaced to the React Native layer. */
object NativeErrorCode {
    const val AUDIO_PERMISSION_DENIED = "AUDIO_PERMISSION_DENIED"
    const val AUDIO_START_FAILED = "AUDIO_START_FAILED"
    const val AUDIO_SILENT_DURING_CALL = "AUDIO_SILENT_DURING_CALL"
    const val FGS_START_NOT_ALLOWED = "FGS_START_NOT_ALLOWED"
    const val ACCESSIBILITY_NOT_ENABLED = "ACCESSIBILITY_NOT_ENABLED"
    const val NOTIFICATION_ACCESS_NOT_ENABLED = "NOTIFICATION_ACCESS_NOT_ENABLED"
    const val OVERLAY_PERMISSION_DENIED = "OVERLAY_PERMISSION_DENIED"
    const val MODEL_NOT_PREPARED = "MODEL_NOT_PREPARED"
    const val MODEL_LOAD_FAILED = "MODEL_LOAD_FAILED"
    const val MODEL_INFERENCE_FAILED = "MODEL_INFERENCE_FAILED"
    const val NATIVE_INTERNAL_ERROR = "NATIVE_INTERNAL_ERROR"
}
