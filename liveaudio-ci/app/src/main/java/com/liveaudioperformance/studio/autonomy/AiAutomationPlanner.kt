package com.liveaudioperformance.studio.autonomy

object AiAutomationPlanner {
    enum class Risk { LOW, MEDIUM, HIGH }
    enum class Command { SYNC_DECKS, LOWER_MASTER, BUILD_FX, DROP_FX, HOLD, SAFE_MODE }

    data class Candidate(
        val command: Command,
        val confidence: Float,
        val risk: Risk,
        val reason: String,
    )

    data class Policy(
        val enabled: Boolean = false,
        val minConfidence: Float = 0.88f,
        val allowMediumRisk: Boolean = false,
        val maxCommandsPerPhrase: Int = 2,
    )

    data class Plan(
        val automatic: List<Candidate>,
        val approvalRequired: List<Candidate>,
    )

    fun plan(candidates: List<Candidate>, policy: Policy, alreadyExecuted: Int): Plan {
        val budget = (policy.maxCommandsPerPhrase - alreadyExecuted).coerceAtLeast(0)
        val automatic = candidates
            .filter {
                policy.enabled &&
                    it.confidence >= policy.minConfidence &&
                    it.risk != Risk.HIGH &&
                    (it.risk == Risk.LOW || policy.allowMediumRisk)
            }
            .sortedByDescending { it.confidence }
            .take(budget)
        return Plan(
            automatic = automatic,
            approvalRequired = candidates.filterNot { it in automatic },
        )
    }

    fun fromCopilot(
        recommendations: List<LivePerformanceCopilot.Recommendation>,
    ): List<Candidate> = recommendations.map { rec ->
        val command = when {
            rec.title.contains("SAFE", true) -> Command.SAFE_MODE
            rec.title.contains("Master", true) -> Command.LOWER_MASTER
            rec.title.contains("synchron", true) -> Command.SYNC_DECKS
            rec.title.contains("Build", true) -> Command.BUILD_FX
            rec.title.contains("Drop", true) -> Command.DROP_FX
            else -> Command.HOLD
        }
        Candidate(
            command = command,
            confidence = rec.confidence,
            risk = when (command) {
                Command.LOWER_MASTER, Command.SAFE_MODE, Command.HOLD -> Risk.LOW
                Command.SYNC_DECKS, Command.BUILD_FX -> Risk.MEDIUM
                Command.DROP_FX -> Risk.HIGH
            },
            reason = rec.rationale,
        )
    }
}
