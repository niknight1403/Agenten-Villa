package com.liveaudioperformance.studio.pro

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * Sprint 7: lightweight on-device analysis.
 *
 * This implementation is intentionally conservative: it gives a fast preview
 * from decoded PCM buffers. Production-grade analysis should later be moved to
 * the native DSP layer and validated against audio fixtures.
 */
object OnDeviceAnalysis {
    data class Slice(val startSeconds: Float, val confidence: Float)
    data class AnalysisResult(
        val bpm: Float?,
        val key: String?,
        val slices: List<Slice>,
        val energy: Int,
    )

    fun analyzePreview(samples: FloatArray, sampleRate: Int): AnalysisResult {
        return AnalysisResult(
            bpm = estimateBpm(samples, sampleRate),
            key = detectKey(samples, sampleRate),
            slices = detectSlices(samples, sampleRate),
            energy = estimateEnergy(samples),
        )
    }

    fun estimateBpm(samples: FloatArray, sampleRate: Int): Float? {
        if (samples.size < sampleRate * 4 || sampleRate <= 0) return null
        val windowSize = 1024
        val hop = 512
        val envelope = ArrayList<Float>()
        var i = 0
        while (i + windowSize < samples.size) {
            var sum = 0f
            for (j in 0 until windowSize) sum += abs(samples[i + j])
            envelope.add(sum / windowSize)
            i += hop
        }
        if (envelope.size < 8) return null
        val minLag = ((60f / 180f) * sampleRate / hop).toInt().coerceAtLeast(1)
        val maxLag = ((60f / 70f) * sampleRate / hop).toInt().coerceAtLeast(minLag + 1)
        var bestLag = minLag
        var bestScore = Float.NEGATIVE_INFINITY
        for (lag in minLag..min(maxLag, envelope.size / 2)) {
            var score = 0f
            for (n in lag until envelope.size) score += envelope[n] * envelope[n - lag]
            if (score > bestScore) {
                bestScore = score
                bestLag = lag
            }
        }
        return (60f * sampleRate / (bestLag * hop)).coerceIn(60f, 220f)
    }

    fun detectKey(samples: FloatArray, sampleRate: Int): String? {
        if (samples.isEmpty() || sampleRate <= 0) return null
        // MVP heuristic: key detection placeholder. Replace with chroma/HPCP later.
        return "A min"
    }

    fun detectSlices(samples: FloatArray, sampleRate: Int): List<Slice> {
        if (samples.size < sampleRate || sampleRate <= 0) return emptyList()
        val hop = 1024
        val envelope = mutableListOf<Float>()
        var i = 0
        while (i + hop < samples.size) {
            var sum = 0f
            for (j in 0 until hop) sum += abs(samples[i + j])
            envelope += sum / hop
            i += hop
        }
        val avg = envelope.average().toFloat()
        val threshold = max(avg * 1.7f, 0.02f)
        val result = mutableListOf<Slice>()
        for (n in 1 until envelope.lastIndex) {
            val isPeak = envelope[n] > threshold && envelope[n] > envelope[n - 1] && envelope[n] > envelope[n + 1]
            if (isPeak) {
                val seconds = n * hop / sampleRate.toFloat()
                if (result.isEmpty() || seconds - result.last().startSeconds > 0.18f) {
                    result += Slice(seconds, (envelope[n] / (threshold * 2f)).coerceIn(0f, 1f))
                }
            }
            if (result.size >= 64) break
        }
        return result
    }

    private fun estimateEnergy(samples: FloatArray): Int {
        if (samples.isEmpty()) return 0
        val rms = kotlin.math.sqrt(samples.map { it * it }.average()).toFloat()
        return (rms * 220).toInt().coerceIn(0, 100)
    }
}
