package com.liveaudioperformance.studio.autonomy

object PerformanceReleaseGate {
    data class Evidence(
        val unitTests: Boolean,
        val lint: Boolean,
        val debugApk: Boolean,
        val releaseAab: Boolean,
        val nativeLibraryPackaged: Boolean,
        val hardwareSmoke: Boolean?,
        val zeroXruns: Boolean?,
        val recordingSmoke: Boolean?,
    )

    data class Report(
        val ciGreen: Boolean,
        val deviceGreen: Boolean?,
        val blockers: List<String>,
    ) {
        val productionGreen: Boolean get() = ciGreen && deviceGreen == true
    }

    fun evaluate(e: Evidence): Report {
        val blockers = buildList {
            if (!e.unitTests) add("unit-tests")
            if (!e.lint) add("lint")
            if (!e.debugApk) add("debug-apk")
            if (!e.releaseAab) add("release-aab")
            if (!e.nativeLibraryPackaged) add("native-library")
            if (e.hardwareSmoke == false) add("hardware-smoke")
            if (e.zeroXruns == false) add("xruns")
            if (e.recordingSmoke == false) add("recording-smoke")
        }
        val ciGreen = e.unitTests && e.lint && e.debugApk && e.releaseAab && e.nativeLibraryPackaged
        val deviceGreen = when {
            e.hardwareSmoke == null || e.zeroXruns == null || e.recordingSmoke == null -> null
            else -> e.hardwareSmoke && e.zeroXruns && e.recordingSmoke
        }
        return Report(ciGreen, deviceGreen, blockers)
    }
}
