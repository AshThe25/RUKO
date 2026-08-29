package com.ruko.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The Kotlin scoring math must equal the TypeScript pipeline (calibration.ts,
 * weights.ts) to the fourth decimal. Golden values are computed with the exact
 * same float64 formulas in Python — see the generator in the phase-2 notes.
 */
class ManipulationScoringTest {

    private val eps = 1e-9

    @Test
    fun `calibration maps a label threshold onto one half`() {
        assertEquals(0.5, ManipulationScoring.calibrateScore(0.49, 0.49), eps)
        assertEquals(0.25, ManipulationScoring.calibrateScore(0.1, 0.2), eps)
        assertEquals(0.75, ManipulationScoring.calibrateScore(0.6, 0.2), eps)
    }

    @Test
    fun `calibration clamps out-of-range and non-finite input`() {
        assertEquals(0.0, ManipulationScoring.calibrateScore(-1.0, 0.4), eps)
        assertTrue(ManipulationScoring.calibrateScore(2.0, 0.4) <= 1.0)
        assertEquals(0.0, ManipulationScoring.calibrateScore(Double.NaN, 0.4), eps)
    }

    @Test
    fun `logits calibrate to the same scores as the TypeScript pipeline`() {
        // order: authority, coercion, urgency, financial, secrecy, credential
        val logits = doubleArrayOf(2.5, 3.1, 1.2, -0.4, -2.0, 0.8)
        val c = ManipulationScoring.calibrateFromLogits(logits)

        assertEquals(0.9525886374867228, c.getValue(ManipulationScoring.Label.AUTHORITY), 1e-12)
        assertEquals(0.9640772875490948, c.getValue(ManipulationScoring.Label.COERCION), 1e-12)
        assertEquals(0.855327989686886, c.getValue(ManipulationScoring.Label.URGENCY), 1e-12)
        assertEquals(0.5248510634028158, c.getValue(ManipulationScoring.Label.FINANCIAL_INSTRUCTION), 1e-12)
        assertEquals(0.1490036525276469, c.getValue(ManipulationScoring.Label.SECRECY), 1e-12)
        assertEquals(0.6960534128702083, c.getValue(ManipulationScoring.Label.CREDENTIAL_REQUEST), 1e-12)
    }

    @Test
    fun `conversation risk points match the TypeScript weighted sum`() {
        val logits = doubleArrayOf(2.5, 3.1, 1.2, -0.4, -2.0, 0.8)
        val c = ManipulationScoring.calibrateFromLogits(logits)
        assertEquals(65.77456557050981, ManipulationScoring.conversationRiskPoints(c), 1e-9)
    }

    @Test
    fun `conversation family maxes at eighty five points`() {
        assertEquals(85.0, ManipulationScoring.CONVERSATION_MAX_POINTS, eps)
    }

    @Test
    fun `present labels are those at or above one half`() {
        val logits = doubleArrayOf(2.5, 3.1, 1.2, -0.4, -2.0, 0.8)
        val present = ManipulationScoring.presentLabels(ManipulationScoring.calibrateFromLogits(logits))
        assertTrue(present.contains(ManipulationScoring.Label.AUTHORITY))
        assertTrue(present.contains(ManipulationScoring.Label.COERCION))
        assertTrue(!present.contains(ManipulationScoring.Label.SECRECY))
    }
}
