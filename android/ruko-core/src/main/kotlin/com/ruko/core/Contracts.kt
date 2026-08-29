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

/**
 * Where a piece of evidence came from. Mirrors `EvidenceSource` in
 * common.schema.ts.
 *
 * This exists for honesty: the UI and the audit trail must always be able to
 * say "this came from a demo provider", and must never present a mocked signal
 * as if it were measured from the device.
 */
enum class EvidenceSource {
    /** A real local model produced this. */
    ON_DEVICE_MODEL,

    /** Deterministic on-device rules, no model. */
    ON_DEVICE_HEURISTIC,

    /** Read from a real Android API (call state, notifications). */
    ANDROID_API,

    /** Parsed from a real accessibility node tree. */
    ACCESSIBILITY,

    /** Read from the local behaviour / payee store. */
    LOCAL_STORE,

    /** Ruko's own controlled demo app: real pipeline, scripted input. */
    DEMO,

    /** Test fixture only. Must never appear in a shipped build. */
    MOCK,
}

/**
 * Every evidence block carries these. `available = false` means "we could not
 * measure this", which is emphatically NOT the same as a measured zero — an
 * unreadable payment screen must not read as a safe payment.
 */
interface EvidenceBase {
    val available: Boolean
    val source: EvidenceSource

    /** Why it is unavailable, when it is. Surfaced in the audit trail. */
    val unavailableReason: String?
}

data class ConversationEvidence(
    override val available: Boolean,
    override val source: EvidenceSource,
    override val unavailableReason: String? = null,
    val authority: Confidence,
    val coercion: Confidence,
    val urgency: Confidence,
    val financialInstruction: Confidence,
    val secrecy: Confidence,
    val credentialRequest: Confidence,
    val confidence: Confidence,
    /** Measured. Null when no inference has run. Never estimated. */
    val latencyMs: Long?,
    val modelVersion: String,
    /** Epoch milliseconds. */
    val timestamp: Long,
) : EvidenceBase

data class PaymentEvidence(
    override val available: Boolean,
    override val source: EvidenceSource,
    override val unavailableReason: String? = null,
    /** Is the user currently on a payment confirmation surface? */
    val active: Boolean,
    /**
     * Integer paise. Never rupees, never a float — rupee-only truncates
     * silently and the bug stays invisible until a demo.
     */
    val amountMinor: Long?,
    val currency: String = "INR",
    /** Display name as shown on screen. In memory only; never persisted raw. */
    val payeeDisplayName: String?,
    /** Salted SHA-256. The raw VPA never leaves the device. */
    val payeeHash: String?,
    val appPackage: String?,
    /** Epoch milliseconds. */
    val timestamp: Long,
) : EvidenceBase

data class CallEvidence(
    override val available: Boolean,
    override val source: EvidenceSource = EvidenceSource.ANDROID_API,
    override val unavailableReason: String? = null,
    val active: Boolean,
    val callerKnown: Boolean,
    val durationSeconds: Long,
    /**
     * True always, on stock Android. Ruko hears the room through the device
     * microphone; it cannot access the protected call stream.
     */
    val audioFromMicrophone: Boolean = true,
) : EvidenceBase

data class NotificationEvidence(
    override val available: Boolean = true,
    override val source: EvidenceSource = EvidenceSource.ANDROID_API,
    override val unavailableReason: String? = null,
    val suspicion: Confidence,
    val matchCount: Int,
    /** Bounded, redacted. See [NotificationRelevanceFilter]. */
    val excerpts: List<String>,
    val lookbackMinutes: Int,
) : EvidenceBase

enum class RiskLevel { LOW, MEDIUM, HIGH, CRITICAL }

enum class PolicyAction {
    /** Stay quiet. */
    NONE,

    /** A passive banner, no interruption. */
    SUBTLE_WARNING,

    /** Full-screen warning, deliberate confirmation to continue. */
    STRONG_WARNING,

    /** Full-screen intervention, "DON'T PAY" is the primary CTA. */
    BLOCK_WARNING,
}

/** One line of the "why". Mirrors `RiskReason` in risk.schema.ts. */
data class RiskReason(
    val code: String,
    val label: String,
    val points: Double,
    val family: String,
)

/**
 * Transport holder only. Produced by the engine in ml/; never computed here.
 * Mirrors `RiskResult` in risk.schema.ts.
 */
data class RiskResult(
    val sessionId: String,
    val score: Int,
    val level: RiskLevel,
    val policyAction: PolicyAction,
    val reasons: List<RiskReason>,
    val degraded: Boolean,
    val degradedReasons: List<String> = emptyList(),
    val escalateToGuardian: Boolean,
    val modelVersion: String,
    val weightsVersion: String,
    val policyVersion: String,
    val engineVersion: String,
    /** Epoch milliseconds. */
    val timestamp: Long,
    val computeMs: Double,
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
