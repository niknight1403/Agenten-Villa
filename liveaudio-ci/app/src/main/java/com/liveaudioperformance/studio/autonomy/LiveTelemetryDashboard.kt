package com.liveaudioperformance.studio.autonomy

object LiveTelemetryDashboard {
    enum class Health { GREEN, AMBER, RED }

    data class Snapshot(
        val peak: Float,
        val xruns: Int,
        val engineRunning: Boolean,
        val recording: Boolean,
        val recordingDroppedFrames: Int,
        val audioFocus: Boolean,
        val outputDevices: Int,
        val eventCount: Int,
    )

    data class Summary(
        val health: Health,
        val headline: String,
        val issues: List<String>,
    )

    fun summarize(snapshot: Snapshot): Summary {
        val issues = buildList {
            if (!snapshot.engineRunning) add("native-engine-offline")
            if (snapshot.xruns > 0) add("audio-xruns:" + snapshot.xruns)
            if (snapshot.peak >= 0.99f) add("master-near-clipping")
            if (snapshot.recordingDroppedFrames > 0) add("recording-drops:" + snapshot.recordingDroppedFrames)
            if (!snapshot.audioFocus) add("audio-focus-missing")
            if (snapshot.outputDevices <= 0) add("no-output-device")
        }
        val health = when {
            issues.any { it.startsWith("native-engine") || it.startsWith("audio-xruns") || it.startsWith("no-output") } -> Health.RED
            issues.isNotEmpty() -> Health.AMBER
            else -> Health.GREEN
        }
        return Summary(
            health = health,
            headline = when (health) {
                Health.GREEN -> "Live engine healthy"
                Health.AMBER -> "Live engine needs attention"
                Health.RED -> "Live engine not performance-safe"
            },
            issues = issues,
        )
    }
}
