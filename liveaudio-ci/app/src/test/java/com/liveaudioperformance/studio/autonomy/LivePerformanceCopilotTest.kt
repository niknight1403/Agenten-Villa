package com.liveaudioperformance.studio.autonomy

import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LivePerformanceCopilotTest {
    @Test
    fun xrunCreatesSafeModeRecommendation() {
        val recommendations = LivePerformanceCopilot.recommend(
            deckA = deck(128f, playing = true),
            deckB = deck(129f, playing = true),
            meters = LivePerformanceCopilot.NativeMeters(0.6f, 0.7f, true, 2),
        )
        assertTrue(recommendations.any { it.title.contains("SAFE") && it.autoEligible })
    }

    @Test
    fun compatibleDecksCreateSyncRecommendation() {
        val recommendations = LivePerformanceCopilot.recommend(
            deckA = deck(126f, playing = true),
            deckB = deck(128f, playing = true),
            meters = LivePerformanceCopilot.NativeMeters(0.5f, 0.5f, true, 0),
        )
        assertTrue(recommendations.any { it.title.contains("synchronisieren") })
    }

    @Test
    fun ciCanBeGreenWithoutPretendingHardwareWasTested() {
        val report = NativeLiveQa.evaluate(
            NativeLiveQa.Evidence(
                unitTestsGreen = true,
                nativeLibraryPackaged = true,
                debugApkBuilt = true,
                releaseAabBuilt = true,
            )
        )
        assertTrue(report.ciGreen)
        assertNull(report.hardwareGreen)
        assertFalse(report.fullyVerified)
    }

    @Test
    fun hardwareSmokeRequiresZeroXruns() {
        val report = NativeLiveQa.evaluate(
            NativeLiveQa.Evidence(
                unitTestsGreen = true,
                nativeLibraryPackaged = true,
                debugApkBuilt = true,
                releaseAabBuilt = true,
                engineStartedOnDevice = true,
                xrunsDuringSmokeTest = 0,
            )
        )
        assertTrue(report.fullyVerified)
    }

    private fun deck(bpm: Float, playing: Boolean) =
        LivePerformanceCopilot.DeckSnapshot(
            loaded = true,
            playing = playing,
            bpm = bpm,
            stemsLoaded = 2,
            vocalStemLoaded = true,
        )
}
