package com.liveaudioperformance.studio.autonomy

import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BeatGridAnalyzerTest {
    @Test
    fun detectsRegularPulseNear120Bpm() {
        val sampleRate = 48_000
        val hop = 480
        val envelope = FloatArray(1200)
        val lag = 50
        for (i in envelope.indices step lag) envelope[i] = 1f

        val grid = BeatGridAnalyzer.analyzeEnvelope(envelope, hop, sampleRate)
        assertNotNull(grid)
        assertTrue(grid!!.bpm in 118.0..122.0)
        assertTrue(grid.beatTimesSeconds.isNotEmpty())
    }
}
