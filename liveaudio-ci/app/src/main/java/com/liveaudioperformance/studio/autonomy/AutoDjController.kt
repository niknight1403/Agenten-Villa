package com.liveaudioperformance.studio.autonomy

class AutoDjController {
    enum class AutonomyLevel { OFF, ASSIST, GUARDED_AUTO }

    data class State(
        val level: AutonomyLevel = AutonomyLevel.ASSIST,
        val enabled: Boolean = false,
        val maxActionsPerPhrase: Int = 2,
        val executedThisPhrase: Int = 0,
    )

    data class Decision(
        val executeAutomatically: Boolean,
        val suggestion: AiPerformanceBrain.Suggestion,
        val reason: String,
    )

    var state: State = State()
        private set

    fun configure(level: AutonomyLevel, enabled: Boolean, maxActionsPerPhrase: Int = 2) {
        state = state.copy(
            level = level,
            enabled = enabled,
            maxActionsPerPhrase = maxActionsPerPhrase.coerceIn(1, 8),
            executedThisPhrase = 0,
        )
    }

    fun onNewPhrase() {
        state = state.copy(executedThisPhrase = 0)
    }

    fun decide(suggestion: AiPerformanceBrain.Suggestion): Decision {
        val canAuto = state.enabled &&
            state.level == AutonomyLevel.GUARDED_AUTO &&
            suggestion.confidence >= 0.85f &&
            state.executedThisPhrase < state.maxActionsPerPhrase &&
            suggestion.type != AiPerformanceBrain.ActionType.RESCUE
        if (canAuto) state = state.copy(executedThisPhrase = state.executedThisPhrase + 1)
        return Decision(
            executeAutomatically = canAuto,
            suggestion = suggestion,
            reason = if (canAuto) "guarded-auto-approved" else "user-confirmation-required",
        )
    }
}
