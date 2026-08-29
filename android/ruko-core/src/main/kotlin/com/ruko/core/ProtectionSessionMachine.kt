package com.ruko.core

/**
 * The **native session lifecycle** machine: it decides when the microphone,
 * the foreground service and the screen watcher should be running.
 *
 * Scope note for the team: this is not the investigation orchestrator and it is
 * not the risk engine. It answers exactly one question — "what should the
 * Android layer have switched on right now?" — so we never burn battery running
 * ASR against an empty room. Deciding *what the evidence means* stays in
 * `mobile/src/agent` and `mobile/src/risk`.
 *
 * States follow build prompt §34.
 */
class ProtectionSessionMachine(
    initial: ProtectionState = ProtectionState.IDLE,
) {
    enum class ProtectionState { IDLE, MONITORING, PAYMENT_WATCH, INVESTIGATION, INTERVENTION, GUARDIAN_ESCALATION }

    /** Things the outside world tells the machine. */
    sealed interface Signal {
        data object ProtectionEnabled : Signal
        data object ProtectionDisabled : Signal
        data object CallStarted : Signal
        data object CallEnded : Signal
        data object PaymentScreenDetected : Signal
        data object PaymentScreenDismissed : Signal
        data object SuspiciousEvidence : Signal
        data class RiskAssessed(val level: RiskLevel, val guardianAvailable: Boolean) : Signal
        data object InterventionDismissed : Signal
    }

    /** What the Android layer should have running in a given state. */
    data class Demands(
        val microphoneActive: Boolean,
        val foregroundServiceActive: Boolean,
        val screenWatchActive: Boolean,
        val overlayVisible: Boolean,
        val guardianConnected: Boolean,
    )

    var state: ProtectionState = initial
        private set

    private var protectionEnabled = initial != ProtectionState.IDLE
    private var callActive = false
    private var paymentActive = false

    fun on(signal: Signal): ProtectionState {
        when (signal) {
            Signal.ProtectionEnabled -> {
                protectionEnabled = true
                if (state == ProtectionState.IDLE) state = ProtectionState.MONITORING
            }

            Signal.ProtectionDisabled -> {
                protectionEnabled = false
                callActive = false
                paymentActive = false
                state = ProtectionState.IDLE
            }

            Signal.CallStarted -> {
                callActive = true
                if (protectionEnabled && state == ProtectionState.IDLE) {
                    state = ProtectionState.MONITORING
                }
            }

            Signal.CallEnded -> {
                callActive = false
                // A call ending does not cancel an active warning: the pressure
                // to pay routinely outlives the call that created it.
                if (state == ProtectionState.MONITORING && !paymentActive) {
                    state = if (protectionEnabled) ProtectionState.MONITORING else ProtectionState.IDLE
                }
            }

            Signal.PaymentScreenDetected -> {
                paymentActive = true
                if (protectionEnabled && state.ordinal < ProtectionState.PAYMENT_WATCH.ordinal) {
                    state = ProtectionState.PAYMENT_WATCH
                }
            }

            Signal.PaymentScreenDismissed -> {
                paymentActive = false
                if (state == ProtectionState.PAYMENT_WATCH || state == ProtectionState.INVESTIGATION) {
                    state = if (protectionEnabled) ProtectionState.MONITORING else ProtectionState.IDLE
                }
            }

            Signal.SuspiciousEvidence -> {
                if (protectionEnabled && state == ProtectionState.PAYMENT_WATCH) {
                    state = ProtectionState.INVESTIGATION
                }
            }

            is Signal.RiskAssessed -> {
                state = when {
                    signal.level == RiskLevel.CRITICAL && signal.guardianAvailable ->
                        ProtectionState.GUARDIAN_ESCALATION

                    signal.level == RiskLevel.CRITICAL || signal.level == RiskLevel.HIGH ->
                        ProtectionState.INTERVENTION

                    paymentActive -> ProtectionState.PAYMENT_WATCH
                    protectionEnabled -> ProtectionState.MONITORING
                    else -> ProtectionState.IDLE
                }
            }

            Signal.InterventionDismissed -> {
                state = when {
                    paymentActive -> ProtectionState.PAYMENT_WATCH
                    protectionEnabled -> ProtectionState.MONITORING
                    else -> ProtectionState.IDLE
                }
            }
        }
        return state
    }

    /**
     * Expensive work is gated here rather than sprinkled through the services.
     * The microphone runs only while a conversation could be happening, and the
     * screen watcher only while protection is on at all.
     */
    fun demands(): Demands = when (state) {
        ProtectionState.IDLE -> Demands(
            microphoneActive = false,
            foregroundServiceActive = false,
            screenWatchActive = false,
            overlayVisible = false,
            guardianConnected = false,
        )

        ProtectionState.MONITORING -> Demands(
            microphoneActive = callActive,
            foregroundServiceActive = true,
            screenWatchActive = true,
            overlayVisible = false,
            guardianConnected = false,
        )

        ProtectionState.PAYMENT_WATCH, ProtectionState.INVESTIGATION -> Demands(
            microphoneActive = true,
            foregroundServiceActive = true,
            screenWatchActive = true,
            overlayVisible = false,
            guardianConnected = false,
        )

        ProtectionState.INTERVENTION -> Demands(
            microphoneActive = true,
            foregroundServiceActive = true,
            screenWatchActive = true,
            overlayVisible = true,
            guardianConnected = false,
        )

        ProtectionState.GUARDIAN_ESCALATION -> Demands(
            microphoneActive = true,
            foregroundServiceActive = true,
            screenWatchActive = true,
            overlayVisible = true,
            guardianConnected = true,
        )
    }
}

typealias ProtectionState = ProtectionSessionMachine.ProtectionState
