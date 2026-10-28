package com.liveaudioperformance.studio.autonomy

import com.liveaudioperformance.studio.NativeDspBridge

class AutonomousProductionRuntime(
    val agents: AgentOrchestrator = AgentOrchestrator.productionDefaults(),
    val autoDj: AutoDjController = AutoDjController(),
    val projects: LocalProjectVault = LocalProjectVault(),
) {
    data class Health(
        val nativeAudioAvailable: Boolean,
        val skillsReady: Boolean,
        val localConnectors: Int,
    ) {
        val ready: Boolean get() = skillsReady && localConnectors >= 2
    }

    fun health(): Health = Health(
        nativeAudioAvailable = NativeDspBridge.isNativeEngineAvailable(),
        skillsReady = agents.canRunSkill("performance-copilot") && agents.canRunSkill("release-guardian"),
        localConnectors = agents.enabledConnectors().count { it.localFirst },
    )

    fun performancePlan(
        current: AiPerformanceBrain.TrackContext,
        next: AiPerformanceBrain.TrackContext?,
    ): List<AutoDjController.Decision> =
        AiPerformanceBrain.suggest(current, next).map(autoDj::decide)
}
