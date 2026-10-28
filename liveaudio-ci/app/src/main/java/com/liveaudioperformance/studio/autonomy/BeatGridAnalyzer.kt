package com.liveaudioperformance.studio.autonomy

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

object BeatGridAnalyzer {
    data class BeatGrid(
        val bpm: Double,
        val firstBeatSeconds: Double,
        val beatTimesSeconds: List<Double>,
        val barStartsSeconds: List<Double>,
        val confidence: Float,
    )

    fun analyzeEnvelope(
        envelope: FloatArray,
        framesPerEnvelopeSample: Int,
        sampleRate: Int,
        minBpm: Int = 70,
        maxBpm: Int = 180,
    ): BeatGrid? {
        if (envelope.size < 32 || framesPerEnvelopeSample <= 0 || sampleRate <= 0) return null
        val minLag = max(1, (sampleRate * 60.0 / maxBpm / framesPerEnvelopeSample).toInt())
        val maxLag = min(envelope.size / 2, (sampleRate * 60.0 / minBpm / framesPerEnvelopeSample).toInt())
        if (maxLag <= minLag) return null

        var bestLag = minLag
        var bestScore = Double.NEGATIVE_INFINITY
        for (lag in minLag..maxLag) {
            var score = 0.0
            for (i in lag until envelope.size) score += envelope[i] * envelope[i - lag]
            if (score > bestScore) {
                bestScore = score
                bestLag = lag
            }
        }

        val bpm = 60.0 * sampleRate / (bestLag * framesPerEnvelopeSample)
        val peakIndex = envelope.indices.maxByOrNull { envelope[it] } ?: 0
        val firstBeat = peakIndex * framesPerEnvelopeSample / sampleRate.toDouble()
        val duration = envelope.size * framesPerEnvelopeSample / sampleRate.toDouble()
        val beatSeconds = 60.0 / bpm
        val beats = buildList {
            var t = firstBeat
            while (t <= duration) {
                add(t)
                t += beatSeconds
            }
        }
        val bars = beats.filterIndexed { index, _ -> index % 4 == 0 }
        val mean = envelope.map { abs(it) }.average().coerceAtLeast(1e-6)
        val normalized = (bestScore / envelope.size / (mean * mean + 1e-6)).toFloat()
        return BeatGrid(
            bpm = bpm.coerceIn(minBpm.toDouble(), maxBpm.toDouble()),
            firstBeatSeconds = firstBeat,
            beatTimesSeconds = beats,
            barStartsSeconds = bars,
            confidence = (normalized / 10f).coerceIn(0f, 1f),
        )
    }
}
