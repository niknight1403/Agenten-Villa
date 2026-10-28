package com.liveaudioperformance.studio.core

import kotlin.math.PI
import kotlin.math.cos

object FxAutomationEngine {
    enum class Curve { LINEAR, EASE_IN_OUT, STEP }

    data class Automation(
        val startBeat: Double,
        val durationBeats: Double,
        val from: Float,
        val to: Float,
        val curve: Curve = Curve.EASE_IN_OUT,
    )

    fun valueAtBeat(automation: Automation, beat: Double): Float {
        require(automation.durationBeats > 0.0)
        val t = ((beat - automation.startBeat) / automation.durationBeats).coerceIn(0.0, 1.0)
        val shaped = when (automation.curve) {
            Curve.LINEAR -> t
            Curve.EASE_IN_OUT -> (1.0 - cos(t * PI)) / 2.0
            Curve.STEP -> if (t < 1.0) 0.0 else 1.0
        }
        return (automation.from + (automation.to - automation.from) * shaped.toFloat())
            .coerceIn(0f, 1f)
    }

    fun syncedDelayMs(bpm: Double, noteDivision: Int): Double {
        require(bpm > 0.0)
        require(noteDivision > 0)
        val quarterMs = 60_000.0 / bpm
        return quarterMs * (4.0 / noteDivision)
    }

    fun macro(
        name: String,
        amount: Float,
        currentBeat: Double,
    ): Map<String, Float> {
        val a = amount.coerceIn(0f, 1f)
        return when (name.lowercase()) {
            "build" -> mapOf(
                "filter" to a,
                "reverb" to (a * 0.55f),
                "delay" to (a * 0.35f),
            )
            "drop" -> mapOf(
                "filter" to (1f - a),
                "reverb" to (a * 0.15f),
                "impact" to a,
            )
            "glitch" -> mapOf(
                "repeat" to a,
                "stutter" to a,
                "phase" to ((currentBeat % 1.0) * a).toFloat(),
            )
            else -> emptyMap()
        }
    }
}
