package com.liveaudioperformance.studio

import com.liveaudioperformance.studio.autonomy.AiAutomationPlanner
import com.liveaudioperformance.studio.autonomy.LiveTelemetryDashboard
import com.liveaudioperformance.studio.autonomy.PerformanceReleaseGate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PerformanceReliabilityTest {
    @Test
    fun midiMapsPadsAndMixerControls() {
        val pad = MidiPerformanceMapper.map(0x90, 36, 127)
        assertTrue(pad is MidiPerformanceAction.TriggerPad)
        assertEquals(0, (pad as MidiPerformanceAction.TriggerPad).index)
        assertEquals(1f, pad.velocity, 0.001f)

        val xfader = MidiPerformanceMapper.map(0xB0, 1, 127)
        assertTrue(xfader is MidiPerformanceAction.SetCrossfader)
        assertTrue((xfader as MidiPerformanceAction.SetCrossfader).value > 0.95f)
    }

    @Test
    fun guardedAutomationNeverAutoExecutesHighRisk() {
        val candidates = listOf(
            AiAutomationPlanner.Candidate(
                AiAutomationPlanner.Command.LOWER_MASTER,
                0.95f,
                AiAutomationPlanner.Risk.LOW,
                "peak",
            ),
            AiAutomationPlanner.Candidate(
                AiAutomationPlanner.Command.DROP_FX,
                0.99f,
                AiAutomationPlanner.Risk.HIGH,
                "drop",
            ),
        )
        val plan = AiAutomationPlanner.plan(
            candidates,
            AiAutomationPlanner.Policy(enabled = true, allowMediumRisk = true),
            alreadyExecuted = 0,
        )
        assertTrue(plan.automatic.any { it.command == AiAutomationPlanner.Command.LOWER_MASTER })
        assertFalse(plan.automatic.any { it.command == AiAutomationPlanner.Command.DROP_FX })
    }

    @Test
    fun telemetryTurnsRedOnXruns() {
        val summary = LiveTelemetryDashboard.summarize(
            LiveTelemetryDashboard.Snapshot(
                peak = 0.5f,
                xruns = 2,
                engineRunning = true,
                recording = false,
                recordingDroppedFrames = 0,
                audioFocus = true,
                outputDevices = 1,
                eventCount = 10,
            )
        )
        assertEquals(LiveTelemetryDashboard.Health.RED, summary.health)
    }

    @Test
    fun eventJournalIsBounded() {
        val journal = PerformanceEventJournal(capacity = 2)
        journal.record("a", "1", 1)
        journal.record("b", "2", 2)
        journal.record("c", "3", 3)
        assertEquals(2, journal.count())
        assertEquals("b", journal.recent().first().type)
    }

    @Test
    fun releaseGateSeparatesCiFromHardwareEvidence() {
        val report = PerformanceReleaseGate.evaluate(
            PerformanceReleaseGate.Evidence(
                unitTests = true,
                lint = true,
                debugApk = true,
                releaseAab = true,
                nativeLibraryPackaged = true,
                hardwareSmoke = null,
                zeroXruns = null,
                recordingSmoke = null,
            )
        )
        assertTrue(report.ciGreen)
        assertNull(report.deviceGreen)
        assertFalse(report.productionGreen)
    }
}
