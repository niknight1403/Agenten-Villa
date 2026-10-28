package com.liveaudioperformance.studio.core

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.log10
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.tanh

object MixerMath {
    data class StereoGains(val leftDeck: Float, val rightDeck: Float)

    fun equalPowerCrossfade(position: Float): StereoGains {
        val x = position.coerceIn(0f, 1f).toDouble()
        val angle = x * PI / 2.0
        return StereoGains(
            leftDeck = cos(angle).toFloat(),
            rightDeck = sin(angle).toFloat(),
        )
    }

    fun dbToLinear(db: Float): Float =
        10.0.pow(db.toDouble() / 20.0).toFloat()

    fun linearToDb(gain: Float): Float {
        val safe = gain.coerceAtLeast(0.000001f)
        return (20.0 * log10(safe.toDouble())).toFloat()
    }

    fun softLimit(sample: Float, drive: Float = 1.5f): Float {
        val d = drive.coerceAtLeast(0.01f)
        return (tanh(sample * d) / tanh(d)).coerceIn(-1f, 1f)
    }
}
