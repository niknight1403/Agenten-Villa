package com.liveaudioperformance.studio.autonomy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AutonomousProductionTest {
    @Test
    fun performanceBrainCreatesGuardedTransitionSuggestions() {
        val current = AiPerformanceBrain.TrackContext(
            bpm = 128.0,
            energy = 55,
            vocalActive = true,
            phraseProgress = 0.9f,
            keyCompatibility = 0.9f,
        )
        val next = AiPerformanceBrain.TrackContext(
            bpm = 130.0,
            energy = 78,
            vocalActive = true,
            phraseProgress = 0.1f,
            keyCompatibility = 0.9f,
        )
        val suggestions = AiPerformanceBrain.suggest(current, next)
        assertTrue(suggestions.any { it.type == AiPerformanceBrain.ActionType.MIX })
        assertTrue(suggestions.any { it.type == AiPerformanceBrain.ActionType.STEM })
        assertTrue(suggestions.any { it.type == AiPerformanceBrain.ActionType.FX })
    }

    @Test
    fun autoDjOnlyExecutesHighConfidenceInGuardedMode() {
        val controller = AutoDjController()
        controller.configure(AutoDjController.AutonomyLevel.GUARDED_AUTO, enabled = true)
        val suggestion = AiPerformanceBrain.Suggestion(
            type = AiPerformanceBrain.ActionType.MIX,
            title = "test",
            confidence = 0.9f,
        )
        assertTrue(controller.decide(suggestion).executeAutomatically)
    }

    @Test
    fun optimizerFallsBackToSafeWhenUnderrunsAreCritical() {
        val recommendation = AdaptivePerformanceOptimizer.recommend(
            AdaptivePerformanceOptimizer.Metrics(
                callbackLoadPercent = 95,
                underrunsLastMinute = 4,
                thermalLevel = 2,
                batteryPercent = 80,
            )
        )
        assertEquals(AdaptivePerformanceOptimizer.Mode.SAFE, recommendation.mode)
        assertFalse(recommendation.enableHeavyAi)
    }

    @Test
    fun productionToolsAndSkillsAreAvailableOffline() {
        val agents = AgentOrchestrator.productionDefaults()
        assertTrue(agents.canRunSkill("performance-copilot"))
        assertTrue(agents.canRunSkill("release-guardian"))
        assertEquals(2, agents.enabledConnectors().count { it.localFirst })
    }

    @Test
    fun releaseManagerBlocksFailedQa() {
        val qa = AutonomousQa.evaluate(
            unitTests = true,
            debugBuild = true,
            releaseBuild = false,
            nativeEngineCompiled = true,
            performanceHealthy = true,
            privacyReviewed = true,
        )
        val decision = AutonomousReleaseManager().decide(
            AutonomousReleaseManager.ReleaseState("0.2.0", qa, emptyList())
        )
        assertFalse(decision.releasable)
        assertTrue(decision.blockers.isNotEmpty())
    }
}
