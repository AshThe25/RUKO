package com.ruko.nativemodule.ai

import android.os.Build
import com.ruko.core.InferenceBackend
import com.ruko.core.InferenceBackendResolver
import java.io.File

/**
 * Establishes which compute backends this device can actually use, by looking
 * for the libraries each one needs rather than by assuming.
 *
 * This is the class that keeps the Engineering screen honest. It answers "could
 * we use the NPU?" — not "did we?". The second question is answered only by
 * [com.ruko.core.LocalInferenceBackend.loadModel] reporting back what it
 * genuinely initialised on.
 *
 * A probe returning `available = true` is necessary but not sufficient: QNN can
 * still fail at session creation on an HTP architecture mismatch, and when it
 * does the resolver records the fallback and the reason.
 */
object DeviceAiDiagnostics {

    /**
     * Where Qualcomm's runtime libraries live if the device has them. The
     * backend `.so` files themselves ship inside our APK; these on-device
     * libraries are what let the app talk to the DSP at all.
     */
    private val VENDOR_LIB_DIRS = listOf(
        "/vendor/lib64",
        "/vendor/lib64/rfsa/adsp",
        "/system/lib64",
    )

    private const val CDSP_RPC = "libcdsprpc.so"

    fun probeAll(): List<InferenceBackendResolver.BackendProbe> = listOf(
        probeQualcomm(),
        probeNnapi(),
        probeCpu(),
    )

    /**
     * Qualcomm HTP requires two things this can check: the RPC bridge to the
     * DSP on the device, and the QNN backend library bundled with the app.
     */
    private fun probeQualcomm(): InferenceBackendResolver.BackendProbe {
        val rpc = VENDOR_LIB_DIRS.any { File(it, CDSP_RPC).exists() }
        if (!rpc) {
            return InferenceBackendResolver.BackendProbe(
                InferenceBackend.QUALCOMM,
                available = false,
                detail = "$CDSP_RPC not present — the DSP is not reachable from an app process",
            )
        }

        val htp = runCatching { System.loadLibrary("QnnHtp") }.isSuccess
        if (!htp) {
            return InferenceBackendResolver.BackendProbe(
                InferenceBackend.QUALCOMM,
                available = false,
                detail = "libQnnHtp.so did not load — QNN backend libraries are not bundled for this ABI",
            )
        }

        return InferenceBackendResolver.BackendProbe(
            InferenceBackend.QUALCOMM,
            available = true,
            detail = "libcdsprpc.so present and libQnnHtp.so loaded on ${socModel()}",
        )
    }

    /**
     * NNAPI is deprecated from Android 15 (API 35). On a newer device it can
     * still "work" while quietly falling back to a CPU reference driver that is
     * *slower* than XNNPACK — impressive-sounding and worse. So it is reported
     * as unavailable above API 34 rather than becoming a headline claim.
     */
    private fun probeNnapi(): InferenceBackendResolver.BackendProbe = when {
        Build.VERSION.SDK_INT >= 35 -> InferenceBackendResolver.BackendProbe(
            InferenceBackend.NNAPI,
            available = false,
            detail = "NNAPI is deprecated from API 35; a vendor driver is not guaranteed and " +
                "the CPU reference fallback is slower than XNNPACK",
        )

        Build.VERSION.SDK_INT >= 27 -> InferenceBackendResolver.BackendProbe(
            InferenceBackend.NNAPI,
            available = true,
            detail = "NNAPI available on API ${Build.VERSION.SDK_INT}; driver quality unverified",
        )

        else -> InferenceBackendResolver.BackendProbe(
            InferenceBackend.NNAPI,
            available = false,
            detail = "NNAPI needs API 27+, device is ${Build.VERSION.SDK_INT}",
        )
    }

    /** Always available. This is why resolution can never fail. */
    private fun probeCpu() = InferenceBackendResolver.BackendProbe(
        InferenceBackend.CPU,
        available = true,
        detail = "XNNPACK on ${Build.SUPPORTED_ABIS.firstOrNull() ?: "unknown ABI"}",
    )

    /** `Build.SOC_MODEL` is API 31+; degrade rather than crash on older builds. */
    private fun socModel(): String =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) Build.SOC_MODEL else "unknown SoC"
}
