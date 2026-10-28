package com.liveaudioperformance.studio.core

object ReleaseGate {
    enum class Severity { INFO, WARNING, BLOCKER }

    data class Check(
        val id: String,
        val passed: Boolean,
        val severity: Severity,
        val message: String,
    )

    data class Report(
        val checks: List<Check>,
        val ready: Boolean,
        val blockers: List<Check>,
        val warnings: List<Check>,
    )

    fun evaluate(checks: List<Check>): Report {
        val blockers = checks.filter { !it.passed && it.severity == Severity.BLOCKER }
        val warnings = checks.filter { !it.passed && it.severity == Severity.WARNING }
        return Report(
            checks = checks,
            ready = blockers.isEmpty(),
            blockers = blockers,
            warnings = warnings,
        )
    }

    fun standard(
        debugBuildPasses: Boolean,
        releaseBuildPasses: Boolean,
        audioSmokePasses: Boolean,
        noKnownCrashers: Boolean,
        privacyReviewed: Boolean,
        signedReleaseConfigured: Boolean,
    ): Report = evaluate(
        listOf(
            Check("debug-build", debugBuildPasses, Severity.BLOCKER, "Debug APK must compile."),
            Check("release-build", releaseBuildPasses, Severity.BLOCKER, "Release AAB must compile."),
            Check("audio-smoke", audioSmokePasses, Severity.BLOCKER, "Core audio flow must pass smoke validation."),
            Check("crashers", noKnownCrashers, Severity.BLOCKER, "Known crashers must be resolved."),
            Check("privacy", privacyReviewed, Severity.WARNING, "Privacy and Data Safety should be reviewed."),
            Check("signing", signedReleaseConfigured, Severity.WARNING, "Production signing must be configured before store upload."),
        )
    )
}
