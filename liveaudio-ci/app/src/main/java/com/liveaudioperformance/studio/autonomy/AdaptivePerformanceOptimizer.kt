package com.liveaudioperformance.studio.autonomy

object AdaptivePerformanceOptimizer {
    enum class Mode { ULTRA_LOW_LATENCY, BALANCED, SAFE }

    data class Metrics(
        val callbackLoadPercent: Int,
        val underrunsLastMinute: Int,
        val thermalLevel: Int,
        val batteryPercent: Int,
    )

    data class Recommendation(
        val mode: Mode,
        val bufferBursts: Int,
        val enableHeavyAi: Boolean,
        val reason: String,
    )

    fun recommend(metrics: Metrics): Recommendation {
        val stressed = metrics.underrunsLastMinute > 0 ||
            metrics.callbackLoadPercent >= 78 ||
            metrics.thermalLevel >= 3
        val critical = metrics.underrunsLastMinute >= 3 ||
            metrics.callbackLoadPercent >= 92 ||
            metrics.thermalLevel >= 5
        return when {
            critical -> Recommendation(Mode.SAFE, 4, false, "stability-first")
            stressed -> Recommendation(Mode.BALANCED, 2, metrics.thermalLevel < 4, "adaptive-headroom")
            else -> Recommendation(Mode.ULTRA_LOW_LATENCY, 1, metrics.batteryPercent > 15, "latency-priority")
        }
    }
}
