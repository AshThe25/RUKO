package com.ruko.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class InferenceBackendResolverTest {

    private fun probe(backend: InferenceBackend, available: Boolean, detail: String) =
        InferenceBackendResolver.BackendProbe(backend, available, detail)

    @Test
    fun `uses the NPU when it is genuinely available`() {
        val resolution = InferenceBackendResolver.resolve(
            listOf(
                probe(InferenceBackend.QUALCOMM, true, "libQnnHtp.so loaded"),
                probe(InferenceBackend.NNAPI, true, "vendor driver present"),
                probe(InferenceBackend.CPU, true, "always available"),
            ),
        )
        assertEquals(InferenceBackend.QUALCOMM, resolution.selected)
        assertNull(resolution.degradedReason)
    }

    @Test
    fun `falls back and records exactly why`() {
        val resolution = InferenceBackendResolver.resolve(
            listOf(
                probe(InferenceBackend.QUALCOMM, false, "libQnnHtp.so not found in APK or vendor libs"),
                probe(InferenceBackend.NNAPI, false, "no vendor neuralnetworks HAL"),
                probe(InferenceBackend.CPU, true, "always available"),
            ),
        )
        assertEquals(InferenceBackend.CPU, resolution.selected)
        val reason = assertNotNull(resolution.degradedReason)
        assertTrue("QUALCOMM" in reason)
        assertTrue("libQnnHtp.so not found" in reason)
    }

    @Test
    fun `never reports a backend the runtime did not initialise`() {
        val resolution = InferenceBackendResolver.resolve(
            listOf(
                probe(InferenceBackend.QUALCOMM, false, "HTP arch mismatch"),
                probe(InferenceBackend.NNAPI, false, "deprecated, no driver"),
                probe(InferenceBackend.CPU, true, "xnnpack"),
            ),
        )
        val info = InferenceBackendResolver.report(
            engine = "onnxruntime-android",
            model = "ruko-risk-v1",
            resolution = resolution,
            isReady = true,
            measuredLatencyMs = 41,
        )
        assertEquals(InferenceBackend.CPU, info.backend)
        assertNotNull(info.degradedReason)
    }

    @Test
    fun `resolution always succeeds because CPU is the floor`() {
        val resolution = InferenceBackendResolver.resolve(emptyList())
        assertEquals(InferenceBackend.CPU, resolution.selected)
    }

    @Test
    fun `latency stays null until something has actually run`() {
        val resolution = InferenceBackendResolver.resolve(
            listOf(probe(InferenceBackend.CPU, true, "xnnpack")),
            preference = listOf(InferenceBackend.CPU),
        )
        val info = InferenceBackendResolver.report(
            engine = "onnxruntime-android",
            model = "ruko-risk-v1",
            resolution = resolution,
            isReady = true,
            measuredLatencyMs = null,
        )
        assertNull(info.lastLatencyMs, "the Engineering screen renders null as an em dash, not a made-up number")
    }

    @Test
    fun `an unready runtime reports UNKNOWN rather than an aspirational backend`() {
        val resolution = InferenceBackendResolver.resolve(
            listOf(probe(InferenceBackend.QUALCOMM, true, "libQnnHtp.so loaded")),
        )
        val info = InferenceBackendResolver.report(
            engine = "onnxruntime-android",
            model = "ruko-risk-v1",
            resolution = resolution,
            isReady = false,
            measuredLatencyMs = null,
        )
        assertEquals(InferenceBackend.UNKNOWN, info.backend)
    }

    @Test
    fun `rules-only fallback is still local and still honest`() {
        val info = InferenceBackendResolver.rulesOnly("model artefact missing from assets")
        assertEquals(InferenceBackend.RULES, info.backend)
        assertTrue(info.isLocal)
        assertTrue(info.isReady)
        assertNull(info.lastLatencyMs)
        assertEquals("model artefact missing from assets", info.degradedReason)
    }
}
