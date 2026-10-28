package com.liveaudioperformance.studio.autonomy

import kotlin.math.abs

object AiPerformanceBrain {
    enum class ActionType { MIX, STEM, FX, PAD, RESCUE, ENERGY }

    data class TrackContext(
        val bpm: Double,
        val energy: Int,
        val vocalActive: Boolean,
        val phraseProgress: Float,
        val keyCompatibility: Float,
    )

    data class Suggestion(
        val type: ActionType,
        val title: String,
        val confidence: Float,
        val parameters: Map<String, Float> = emptyMap(),
    )

    fun suggest(current: TrackContext, next: TrackContext?): List<Suggestion> {
        val result = mutableListOf<Suggestion>()
        if (next != null) {
            val bpmDelta = abs(current.bpm - next.bpm)
            if (bpmDelta <= 6.0) {
                result += Suggestion(
                    ActionType.MIX,
                    "Phrase-synced transition",
                    (1f - (bpmDelta / 12.0).toFloat()).coerceIn(0.5f, 1f),
                    mapOf("targetBpm" to next.bpm.toFloat()),
                )
            }
            if (current.vocalActive && next.vocalActive) {
                result += Suggestion(ActionType.STEM, "Duck incoming vocals", 0.9f, mapOf("vocalGain" to 0.35f))
            }
            if (next.energy > current.energy + 12) {
                result += Suggestion(ActionType.ENERGY, "Build into energy lift", 0.86f, mapOf("buildAmount" to 0.7f))
            }
            if (current.keyCompatibility >= 0.75f) {
                result += Suggestion(ActionType.MIX, "Harmonic blend", current.keyCompatibility)
            }
        }
        if (current.phraseProgress >= 0.85f) {
            result += Suggestion(ActionType.FX, "End-of-phrase FX window", 0.88f, mapOf("macro" to 0.55f))
        }
        if (result.isEmpty()) result += Suggestion(ActionType.RESCUE, "Hold stable mix", 0.75f)
        return result.sortedByDescending { it.confidence }
    }
}
