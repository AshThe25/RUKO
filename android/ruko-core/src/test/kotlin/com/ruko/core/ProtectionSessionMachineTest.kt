package com.ruko.core

import com.ruko.core.ProtectionSessionMachine.Signal
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ProtectionSessionMachineTest {

    @Test
    fun `idle costs nothing`() {
        val demands = ProtectionSessionMachine().demands()
        assertFalse(demands.microphoneActive)
        assertFalse(demands.foregroundServiceActive)
        assertFalse(demands.screenWatchActive)
    }

    @Test
    fun `the microphone does not run just because protection is on`() {
        val machine = ProtectionSessionMachine()
        machine.on(Signal.ProtectionEnabled)

        assertEquals(ProtectionState.MONITORING, machine.state)
        assertFalse(
            machine.demands().microphoneActive,
            "monitoring an empty room would burn battery for nothing",
        )
        assertTrue(machine.demands().screenWatchActive)
    }

    @Test
    fun `the microphone starts when a call starts`() {
        val machine = ProtectionSessionMachine()
        machine.on(Signal.ProtectionEnabled)
        machine.on(Signal.CallStarted)
        assertTrue(machine.demands().microphoneActive)
    }

    @Test
    fun `the full critical path reaches guardian escalation`() {
        val machine = ProtectionSessionMachine()
        machine.on(Signal.ProtectionEnabled)
        assertEquals(ProtectionState.MONITORING, machine.on(Signal.CallStarted))
        assertEquals(ProtectionState.PAYMENT_WATCH, machine.on(Signal.PaymentScreenDetected))
        assertEquals(ProtectionState.INVESTIGATION, machine.on(Signal.SuspiciousEvidence))

        val state = machine.on(Signal.RiskAssessed(RiskLevel.CRITICAL, guardianAvailable = true))
        assertEquals(ProtectionState.GUARDIAN_ESCALATION, state)

        val demands = machine.demands()
        assertTrue(demands.overlayVisible)
        assertTrue(demands.guardianConnected)
    }

    @Test
    fun `critical without a guardian still intervenes on the phone alone`() {
        val machine = ProtectionSessionMachine()
        machine.on(Signal.ProtectionEnabled)
        machine.on(Signal.PaymentScreenDetected)
        machine.on(Signal.SuspiciousEvidence)

        val state = machine.on(Signal.RiskAssessed(RiskLevel.CRITICAL, guardianAvailable = false))
        assertEquals(ProtectionState.INTERVENTION, state)
        assertTrue(machine.demands().overlayVisible)
        assertFalse(machine.demands().guardianConnected)
    }

    @Test
    fun `a low assessment does not interrupt`() {
        val machine = ProtectionSessionMachine()
        machine.on(Signal.ProtectionEnabled)
        machine.on(Signal.PaymentScreenDetected)
        machine.on(Signal.SuspiciousEvidence)

        val state = machine.on(Signal.RiskAssessed(RiskLevel.LOW, guardianAvailable = true))
        assertEquals(ProtectionState.PAYMENT_WATCH, state)
        assertFalse(machine.demands().overlayVisible)
    }

    @Test
    fun `a medium assessment does not raise the overlay`() {
        val machine = ProtectionSessionMachine()
        machine.on(Signal.ProtectionEnabled)
        machine.on(Signal.PaymentScreenDetected)
        machine.on(Signal.RiskAssessed(RiskLevel.MEDIUM, guardianAvailable = true))
        assertFalse(machine.demands().overlayVisible)
    }

    @Test
    fun `the warning survives the caller hanging up`() {
        val machine = ProtectionSessionMachine()
        machine.on(Signal.ProtectionEnabled)
        machine.on(Signal.CallStarted)
        machine.on(Signal.PaymentScreenDetected)
        machine.on(Signal.SuspiciousEvidence)
        machine.on(Signal.RiskAssessed(RiskLevel.CRITICAL, guardianAvailable = false))

        machine.on(Signal.CallEnded)

        assertEquals(
            ProtectionState.INTERVENTION,
            machine.state,
            "pressure to pay routinely outlives the call that created it",
        )
        assertTrue(machine.demands().overlayVisible)
    }

    @Test
    fun `dismissing the payment screen returns to monitoring`() {
        val machine = ProtectionSessionMachine()
        machine.on(Signal.ProtectionEnabled)
        machine.on(Signal.PaymentScreenDetected)
        machine.on(Signal.SuspiciousEvidence)
        assertEquals(ProtectionState.MONITORING, machine.on(Signal.PaymentScreenDismissed))
    }

    @Test
    fun `dismissing an intervention returns to watching the payment`() {
        val machine = ProtectionSessionMachine()
        machine.on(Signal.ProtectionEnabled)
        machine.on(Signal.PaymentScreenDetected)
        machine.on(Signal.RiskAssessed(RiskLevel.HIGH, guardianAvailable = false))
        assertEquals(ProtectionState.INTERVENTION, machine.state)
        assertEquals(ProtectionState.PAYMENT_WATCH, machine.on(Signal.InterventionDismissed))
    }

    @Test
    fun `turning protection off stops everything from any state`() {
        val machine = ProtectionSessionMachine()
        machine.on(Signal.ProtectionEnabled)
        machine.on(Signal.CallStarted)
        machine.on(Signal.PaymentScreenDetected)
        machine.on(Signal.RiskAssessed(RiskLevel.CRITICAL, guardianAvailable = true))

        assertEquals(ProtectionState.IDLE, machine.on(Signal.ProtectionDisabled))
        val demands = machine.demands()
        assertFalse(demands.microphoneActive)
        assertFalse(demands.foregroundServiceActive)
        assertFalse(demands.overlayVisible)
    }

    @Test
    fun `signals arriving while protection is off do nothing`() {
        val machine = ProtectionSessionMachine()
        machine.on(Signal.CallStarted)
        machine.on(Signal.PaymentScreenDetected)
        assertEquals(ProtectionState.IDLE, machine.state)
        assertFalse(machine.demands().foregroundServiceActive)
    }
}
