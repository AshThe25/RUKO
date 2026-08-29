package com.ruko.core

/**
 * The local-inference abstraction (build prompt §7, Puneesh brief §6).
 *
 * One interface, several backends, and — critically — a backend is only ever
 * *reported* as active if the runtime itself said so after initialising. We ask
 * for QUALCOMM; we display whatever came back.
 */
interface LocalInferenceBackend {
    /** Loads the model. Returns the backend the runtime actually initialised on. */
    suspend fun loadModel(): InferenceBackend

    /** Runs one inference. Implementations must record wall-clock latency. */
    suspend fun infer(input: FloatArray): InferenceResult

    /** Never a cached hope — the value the session reported. */
    fun activeBackend(): InferenceBackend

    fun release()
}

data class InferenceResult(
    val output: FloatArray,
    val latencyMs: Long,
    val backend: InferenceBackend,
) {
    // FloatArray gives identity equals/hashCode by default; make it structural
    // so tests comparing results behave the way anyone would expect.
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is InferenceResult) return false
        return output.contentEquals(other.output) &&
            latencyMs == other.latencyMs &&
            backend == other.backend
    }

    override fun hashCode(): Int =
        (output.contentHashCode() * 31 + latencyMs.hashCode()) * 31 + backend.hashCode()
}

/**
 * Picks a backend and, more importantly, refuses to lie about the one it got.
 *
 * The failure mode this exists to prevent: request the NPU, silently fall back
 * to CPU when the QNN libraries are missing, and keep showing "QUALCOMM" on the
 * Engineering screen. A judge who taps that screen and sees a claim the device
 * cannot support costs us more than an honest "CPU" ever would.
 */
object InferenceBackendResolver {

    /** One backend's availability, as established by an actual probe. */
    data class BackendProbe(
        val backend: InferenceBackend,
        val available: Boolean,
        /** Why it is or is not available. Shown verbatim in diagnostics. */
        val detail: String,
    )

    data class Resolution(
        val requested: InferenceBackend,
        val selected: InferenceBackend,
        /** Non-null whenever [selected] is worse than [requested]. */
        val degradedReason: String?,
        val probes: List<BackendProbe>,
    )

    /**
     * Preference order. CPU is last and is always available, so resolution can
     * never fail — Ruko degrades, it does not stop protecting.
     */
    val DEFAULT_PREFERENCE = listOf(
        InferenceBackend.QUALCOMM,
        InferenceBackend.NNAPI,
        InferenceBackend.CPU,
    )

    fun resolve(
        probes: List<BackendProbe>,
        preference: List<InferenceBackend> = DEFAULT_PREFERENCE,
    ): Resolution {
        val requested = preference.firstOrNull() ?: InferenceBackend.CPU
        val byBackend = probes.associateBy { it.backend }

        val selected = preference.firstOrNull { byBackend[it]?.available == true }
            ?: InferenceBackend.CPU

        val degradedReason = when {
            selected == requested -> null
            else -> {
                val why = byBackend[requested]?.detail ?: "no probe result for $requested"
                "requested $requested, using $selected: $why"
            }
        }

        return Resolution(
            requested = requested,
            selected = selected,
            degradedReason = degradedReason,
            probes = probes,
        )
    }

    /**
     * Builds the [RuntimeInfo] shown on the Engineering screen and sent to the
     * Guardian.
     *
     * @param measuredLatencyMs wall-clock latency of a real inference, or null
     *   if nothing has run yet. Callers must not substitute an estimate — the
     *   UI renders null as "—" precisely so an unmeasured value stays visibly
     *   unmeasured.
     */
    fun report(
        engine: String,
        model: String,
        resolution: Resolution,
        isReady: Boolean,
        measuredLatencyMs: Long?,
    ): RuntimeInfo = RuntimeInfo(
        engine = engine,
        model = model,
        backend = if (isReady) resolution.selected else InferenceBackend.UNKNOWN,
        isLocal = true,
        isReady = isReady,
        lastLatencyMs = measuredLatencyMs,
        degradedReason = resolution.degradedReason,
    )

    /**
     * The last line of defence: no model, no runtime, rules only. Ruko still
     * protects, and says exactly what it is running on.
     */
    fun rulesOnly(reason: String) = RuntimeInfo(
        engine = "ruko-rules",
        model = "keyword-heuristics",
        backend = InferenceBackend.RULES,
        isLocal = true,
        isReady = true,
        lastLatencyMs = null,
        degradedReason = reason,
    )
}
