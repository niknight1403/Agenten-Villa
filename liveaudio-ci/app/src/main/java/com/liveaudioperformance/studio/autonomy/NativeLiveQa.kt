package com.liveaudioperformance.studio.autonomy

object NativeLiveQa {
    data class Evidence(
        val unitTestsGreen: Boolean,
        val nativeLibraryPackaged: Boolean,
        val debugApkBuilt: Boolean,
        val releaseAabBuilt: Boolean,
        val engineStartedOnDevice: Boolean? = null,
        val xrunsDuringSmokeTest: Int? = null,
    )

    data class Report(
        val ciGreen: Boolean,
        val hardwareGreen: Boolean?,
        val blockers: List<String>,
    ) {
        val fullyVerified: Boolean get() = ciGreen && hardwareGreen == true
    }

    fun evaluate(evidence: Evidence): Report {
        val blockers = buildList {
            if (!evidence.unitTestsGreen) add("unit-tests")
            if (!evidence.nativeLibraryPackaged) add("native-library-packaging")
            if (!evidence.debugApkBuilt) add("debug-apk")
            if (!evidence.releaseAabBuilt) add("release-aab")
            if (evidence.engineStartedOnDevice == false) add("device-engine-start")
            if ((evidence.xrunsDuringSmokeTest ?: 0) > 0) add("device-audio-xruns")
        }
        val ciGreen = evidence.unitTestsGreen &&
            evidence.nativeLibraryPackaged &&
            evidence.debugApkBuilt &&
            evidence.releaseAabBuilt
        val hardwareGreen = when {
            evidence.engineStartedOnDevice == null || evidence.xrunsDuringSmokeTest == null -> null
            else -> evidence.engineStartedOnDevice && evidence.xrunsDuringSmokeTest == 0
        }
        return Report(ciGreen, hardwareGreen, blockers)
    }
}
