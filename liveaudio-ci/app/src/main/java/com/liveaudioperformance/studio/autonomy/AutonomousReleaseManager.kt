package com.liveaudioperformance.studio.autonomy

class AutonomousReleaseManager(
    private val orchestrator: AgentOrchestrator = AgentOrchestrator.productionDefaults(),
) {
    data class ReleaseState(
        val versionName: String,
        val qa: AutonomousQa.Report,
        val changelog: List<String>,
    )

    data class Decision(
        val releasable: Boolean,
        val blockers: List<String>,
        val nextActions: List<String>,
    )

    fun decide(state: ReleaseState): Decision {
        val blockers = state.qa.failures.map { it.gate.name + ":" + it.detail }
        val next = if (blockers.isEmpty()) {
            listOf("build-artifacts", "publish-internal-test")
        } else {
            listOf("diagnose-failures", "repair", "rerun-gates")
        }
        return Decision(
            releasable = blockers.isEmpty() && orchestrator.canRunSkill("release-guardian"),
            blockers = blockers,
            nextActions = next,
        )
    }
}
