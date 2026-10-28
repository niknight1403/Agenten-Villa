package com.liveaudioperformance.studio.core

import kotlin.math.abs

object DeckSyncEngine {
    data class SyncDecision(
        val playbackRate: Double,
        val phaseCorrectionFrames: Long,
        val hardSeekRecommended: Boolean,
    )

    fun tempoRatio(sourceBpm: Double, targetBpm: Double): Double {
        require(sourceBpm > 0.0 && targetBpm > 0.0)
        return (targetBpm / sourceBpm).coerceIn(0.5, 2.0)
    }

    fun decide(
        sourceBpm: Double,
        targetBpm: Double,
        sourceFrame: Long,
        targetFrame: Long,
        sampleRate: Int,
        maxSoftCorrectionMs: Double = 35.0,
    ): SyncDecision {
        require(sampleRate > 0)
        val drift = targetFrame - sourceFrame
        val softLimitFrames = (sampleRate * maxSoftCorrectionMs / 1000.0).toLong()
        val hard = abs(drift) > softLimitFrames * 4
        val correction = if (hard) 0L else drift.coerceIn(-softLimitFrames, softLimitFrames)
        return SyncDecision(
            playbackRate = tempoRatio(sourceBpm, targetBpm),
            phaseCorrectionFrames = correction,
            hardSeekRecommended = hard,
        )
    }
}
