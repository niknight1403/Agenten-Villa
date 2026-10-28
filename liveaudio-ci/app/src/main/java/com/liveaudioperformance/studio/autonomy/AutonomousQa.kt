package com.liveaudioperformance.studio.autonomy

object AutonomousQa {
    enum class Gate { UNIT_TESTS, DEBUG_BUILD, RELEASE_BUILD, AUDIO_ENGINE, PERFORMANCE, PRIVACY }

    data class Check(val gate: Gate, val passed: Boolean, val detail: String)
    data class Report(val checks: List<Check>) {
        val green: Boolean get() = checks.all { it.passed }
        val failures: List<Check> get() = checks.filterNot { it.passed }
    }

    fun evaluate(
        unitTests: Boolean,
        debugBuild: Boolean,
        releaseBuild: Boolean,
        nativeEngineCompiled: Boolean,
        performanceHealthy: Boolean,
        privacyReviewed: Boolean,
    ): Report = Report(
        listOf(
            Check(Gate.UNIT_TESTS, unitTests, "core unit tests"),
            Check(Gate.DEBUG_BUILD, debugBuild, "installable APK"),
            Check(Gate.RELEASE_BUILD, releaseBuild, "release AAB"),
            Check(Gate.AUDIO_ENGINE, nativeEngineCompiled, "JNI/AAudio library"),
            Check(Gate.PERFORMANCE, performanceHealthy, "callback/underrun budget"),
            Check(Gate.PRIVACY, privacyReviewed, "local-first privacy review"),
        )
    )
}
