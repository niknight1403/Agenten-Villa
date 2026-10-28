package com.liveaudioperformance.studio.core

import kotlin.math.roundToInt

class PerformanceTelemetry(private val capacity: Int = 120) {
    data class Sample(
        val timestampMs: Long,
        val callbackDurationMs: Double,
        val bufferDurationMs: Double,
        val cpuPercent: Float,
        val droppedFrames: Int = 0,
        val underruns: Int = 0,
    )

    data class Summary(
        val sampleCount: Int,
        val averageCallbackLoadPercent: Int,
        val peakCallbackLoadPercent: Int,
        val averageCpuPercent: Int,
        val totalDroppedFrames: Int,
        val totalUnderruns: Int,
        val healthy: Boolean,
    )

    private val samples = ArrayDeque<Sample>()

    @Synchronized
    fun record(sample: Sample) {
        if (samples.size >= capacity.coerceAtLeast(1)) samples.removeFirst()
        samples.addLast(sample)
    }

    @Synchronized
    fun clear() = samples.clear()

    @Synchronized
    fun summary(): Summary {
        if (samples.isEmpty()) {
            return Summary(0, 0, 0, 0, 0, 0, true)
        }
        val loads = samples.map {
            if (it.bufferDurationMs <= 0.0) 100.0
            else (it.callbackDurationMs / it.bufferDurationMs * 100.0).coerceAtLeast(0.0)
        }
        val avgLoad = loads.average().roundToInt()
        val peakLoad = loads.maxOrNull()?.roundToInt() ?: 0
        val avgCpu = samples.map { it.cpuPercent.toDouble() }.average().roundToInt()
        val dropped = samples.sumOf { it.droppedFrames.coerceAtLeast(0) }
        val underruns = samples.sumOf { it.underruns.coerceAtLeast(0) }
        return Summary(
            sampleCount = samples.size,
            averageCallbackLoadPercent = avgLoad,
            peakCallbackLoadPercent = peakLoad,
            averageCpuPercent = avgCpu,
            totalDroppedFrames = dropped,
            totalUnderruns = underruns,
            healthy = peakLoad < 80 && underruns == 0 && dropped == 0,
        )
    }
}
