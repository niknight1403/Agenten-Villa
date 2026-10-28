package com.liveaudioperformance.studio.core

/**
 * Integration facade for Sprints 11-20.
 *
 * Keeps real-time planning logic independent from Compose/Media3 so the same
 * contracts can later be driven by the native Oboe/AAudio engine.
 */
class ProductionPerformanceCore(
    val scheduler: PerformanceScheduler = PerformanceScheduler(),
    val pads: PadPerformanceEngine = PadPerformanceEngine(),
    val sessions: ProjectSessionStore = ProjectSessionStore(),
    val telemetry: PerformanceTelemetry = PerformanceTelemetry(),
) {
    data class QuantizedTrigger(
        val scheduledFrame: Long,
        val commandId: Long,
    )

    fun schedulePad(
        padIndex: Int,
        currentFrame: Long,
        sampleRate: Int,
        bpm: Double,
        subdivision: Int = 4,
    ): QuantizedTrigger {
        val frame = TransportClock.quantizeForward(
            frame = currentFrame,
            sampleRate = sampleRate,
            bpm = bpm,
            subdivision = subdivision,
        )
        val command = scheduler.schedule(
            frame = frame,
            type = "pad.trigger",
            payload = padIndex.toString(),
        )
        return QuantizedTrigger(frame, command.id)
    }

    fun crossfade(position: Float): MixerMath.StereoGains =
        MixerMath.equalPowerCrossfade(position)

    fun syncDeck(
        sourceBpm: Double,
        targetBpm: Double,
        sourceFrame: Long,
        targetFrame: Long,
        sampleRate: Int,
    ): DeckSyncEngine.SyncDecision = DeckSyncEngine.decide(
        sourceBpm = sourceBpm,
        targetBpm = targetBpm,
        sourceFrame = sourceFrame,
        targetFrame = targetFrame,
        sampleRate = sampleRate,
    )

    fun releaseReport(
        debugBuildPasses: Boolean,
        releaseBuildPasses: Boolean,
        audioSmokePasses: Boolean,
        noKnownCrashers: Boolean,
        privacyReviewed: Boolean,
        signedReleaseConfigured: Boolean,
    ): ReleaseGate.Report = ReleaseGate.standard(
        debugBuildPasses,
        releaseBuildPasses,
        audioSmokePasses,
        noKnownCrashers,
        privacyReviewed,
        signedReleaseConfigured,
    )
}
